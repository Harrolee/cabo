/**
 * Renders the member's aspiration as an image.
 *
 * Replaces the fitness before/after pipeline for app users: instead of a random
 * scenario pair from a fixed table, the scene comes from what the member told
 * their coach they want to become.
 *
 *   POST /generate   { coachId, kind? }  -> creates and returns a visualization
 *   POST /history    { coachId? }        -> what has been made for this member
 *
 * Both require a Supabase JWT. Generation is slow (30-90s on Replicate) so the
 * row is written as `pending` first and the app can poll or subscribe.
 */

const { createClient } = require('@supabase/supabase-js');
const { Storage } = require('@google-cloud/storage');
const OpenAI = require('openai');
const Replicate = require('replicate');
const { z } = require('zod');
const { generateScene, chooseModel } = require('./visualization');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const storage = new Storage();

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o';
const PROJECT_ID = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
const BUCKET_NAME = process.env.VISUALIZATION_BUCKET || `${PROJECT_ID}-image-bucket`;
// One generation costs real money; this is the guard against a member holding
// down the button.
const DAILY_LIMIT = Number(process.env.VISUALIZATION_DAILY_LIMIT || 3);

const GenerateRequest = z.object({
  coachId: z.string().uuid(),
  kind: z.enum(['becoming', 'milestone', 'today']).optional(),
});

async function resolveCaller(req) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

/** Copy the model output into our own bucket; Replicate URLs expire. */
async function persistImage(sourceUrl, userId) {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Could not download generated image: ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  const objectName = `visualizations/${userId}/${Date.now()}.jpg`;
  const file = storage.bucket(BUCKET_NAME).file(objectName);

  await file.save(buffer, {
    contentType: 'image/jpeg',
    metadata: { cacheControl: 'public, max-age=31536000' },
  });

  return `https://storage.googleapis.com/${BUCKET_NAME}/${objectName}`;
}

/**
 * Pull a URL string out of whatever Replicate hands back.
 *
 * The client library is not consistent across models: `replicate.run()` may
 * return a bare URL string, an array of them, a single `FileOutput`, or an
 * array of `FileOutput` — and `FileOutput.url()` returns a `URL` *object*, not
 * a string. Normalising to a string here keeps that leaking any further.
 */
function firstUrl(output) {
  const asString = (value) => {
    if (!value) return null;
    if (typeof value === 'string') return value;
    // URL instance, or anything with a usable toString.
    if (value instanceof URL) return value.href;
    if (typeof value.url === 'function') return asString(value.url());
    if (typeof value.url === 'string') return value.url;
    const text = String(value);
    return text.startsWith('http') ? text : null;
  };

  const candidate = Array.isArray(output)
    ? output[0]
    : output && Array.isArray(output.output)
    ? output.output[0]
    : output;

  const url = asString(candidate);

  if (!url) {
    // Without this, an unexpected shape surfaces as a bare "no image" and
    // there is nothing in the logs to diagnose it from.
    console.error(
      'Could not extract an image URL from Replicate output. isArray=%s ctor=%s keys=%j',
      Array.isArray(output),
      output?.constructor?.name,
      output && typeof output === 'object' ? Object.keys(output).slice(0, 10) : null
    );
  }

  return url;
}

async function handleGenerate(req, res) {
  const caller = await resolveCaller(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });

  const { coachId, kind = 'becoming' } = GenerateRequest.parse(req.body || {});

  const { data: allowed, error: accessError } = await supabase.rpc('has_coach_access', {
    p_user_id: caller.id,
    p_coach_id: coachId,
  });
  if (accessError) throw accessError;
  if (!allowed) {
    return res.status(402).json({ error: 'subscription_required', coachId });
  }

  // Only successful generations count against the limit — burning someone's
  // daily quota on our own failures is the wrong way round.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('coach_visualizations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', caller.id)
    .neq('status', 'failed')
    .gte('created_at', since);

  if ((count ?? 0) >= DAILY_LIMIT) {
    return res.status(429).json({
      error: 'daily_limit_reached',
      message: `You can create ${DAILY_LIMIT} images a day. Try again tomorrow.`,
    });
  }

  const { data: coach, error: coachError } = await supabase
    .from('coach_profiles')
    .select('id, name, discipline, supports_visualization, primary_response_style, communication_traits, voice_patterns')
    .eq('id', coachId)
    .eq('active', true)
    .single();

  if (coachError || !coach) return res.status(404).json({ error: 'Coach not found' });
  if (!coach.supports_visualization) {
    return res.status(422).json({ error: 'This coach does not offer visualisations' });
  }

  const member = (await supabase.rpc('get_member_context', {
    p_user_id: caller.id,
    p_coach_id: coachId,
  })).data || {};

  // Without an aspiration there is nothing meaningful to render — send them
  // back to the conversation rather than inventing a goal for them.
  if (!member.aspiration && kind === 'becoming') {
    return res.status(422).json({
      error: 'no_aspiration',
      message: `Tell ${coach.name} what you're working toward first, then I can show you.`,
    });
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('reference_photo_url, likeness_consent, image_preference')
    .eq('user_id', caller.id)
    .maybeSingle();

  const scene = await generateScene({ openai, model: CHAT_MODEL, coach, member, kind });

  const { data: record, error: insertError } = await supabase
    .from('coach_visualizations')
    .insert({
      user_id: caller.id,
      coach_id: coachId,
      // get_member_context already carries the goals row id, so this does not
      // need a second query for it.
      goal_id: member.goal_id ?? null,
      kind,
      scene: scene.scene,
      image_prompt: scene.image_prompt,
      status: 'pending',
    })
    .select()
    .single();

  if (insertError) throw insertError;

  const model = chooseModel({
    referencePhotoUrl: profile?.reference_photo_url,
    likenessConsent: profile?.likeness_consent,
  });

  try {
    const output = await replicate.run(
      model.id,
      { input: model.build(scene.image_prompt, profile?.reference_photo_url) }
    );

    const generatedUrl = firstUrl(output);
    if (!generatedUrl) throw new Error('Model returned no image');

    const imageUrl = await persistImage(generatedUrl, caller.id);

    const { data: ready } = await supabase
      .from('coach_visualizations')
      .update({ image_url: imageUrl, model: model.id, status: 'ready' })
      .eq('id', record.id)
      .select()
      .single();

    return res.json({ success: true, visualization: ready, caption: scene.caption });
  } catch (error) {
    await supabase
      .from('coach_visualizations')
      .update({ status: 'failed', error: String(error.message).slice(0, 500) })
      .eq('id', record.id);
    throw error;
  }
}

async function handleHistory(req, res) {
  const caller = await resolveCaller(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });

  let query = supabase
    .from('coach_visualizations')
    .select('id, coach_id, kind, scene, image_url, status, saved, created_at')
    .eq('user_id', caller.id)
    .eq('status', 'ready')
    .order('created_at', { ascending: false })
    .limit(50);

  if (req.body?.coachId) query = query.eq('coach_id', req.body.coachId);

  const { data, error } = await query;
  if (error) throw error;

  return res.json({ success: true, visualizations: data || [] });
}

exports.coachVisualizer = async (req, res) => {
  res.set('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGINS || '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const path = (req.path || '/').replace(/\/+$/, '') || '/';

  try {
    if (path.endsWith('/history')) return await handleHistory(req, res);
    return await handleGenerate(req, res);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    // Never hand an internal error to the client: it is not actionable and it
    // leaks infrastructure detail (bucket names, stack shapes) into a UI alert.
    console.error('coach-visualizer error:', error);
    return res.status(500).json({
      error: 'generation_failed',
      message: 'Could not create the image right now. Please try again in a moment.',
    });
  }
};
