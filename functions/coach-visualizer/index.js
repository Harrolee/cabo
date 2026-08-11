/**
 * Renders the member's aspiration as an image.
 *
 * Replaces the fitness before/after pipeline for app users: instead of a random
 * scenario pair from a fixed table, the scene comes from what the member told
 * their coach they want to become.
 *
 *   POST /generate          { coachId, kind? }        -> creates and returns a visualization
 *   POST /history           { coachId? }              -> what has been made for this member
 *   POST /likeness                                    -> consent + stored photo status
 *   POST /likeness/grant    { consent, photoBase64 }  -> store a reference photo
 *   POST /likeness/revoke                             -> delete it and withdraw consent
 *
 * All require a Supabase JWT. Generation is slow (30-90s on Replicate) so the
 * row is written as `pending` first and the app can poll or subscribe.
 *
 * The likeness endpoints are the only writers of `user_profiles.likeness_consent`
 * and `reference_photo_url` — a database trigger keeps members from setting
 * either directly, so consent cannot be self-granted and the pointer cannot be
 * aimed at a photograph of someone who never agreed to any of this.
 */

const { createClient } = require('@supabase/supabase-js');
const { Storage } = require('@google-cloud/storage');
const OpenAI = require('openai');
const Replicate = require('replicate');
const { z } = require('zod');
const { MODELS, generateScene, chooseModel } = require('./visualization');
const {
  InvalidPhotoError,
  decodeReferencePhoto,
  deleteReferencePhotos,
  referencePhotoExists,
  signReferencePhoto,
  storeReferencePhoto,
} = require('./reference-photo');

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
/*
  Reference photos live apart from generated images: that bucket is public-read
  for the finished pictures, and a photograph of a member must never be. This
  one has public access prevention on and soft delete off, so "delete" means
  the bytes are gone rather than recoverable for a week.
*/
const MEMBER_MEDIA_BUCKET = process.env.MEMBER_MEDIA_BUCKET || `${PROJECT_ID}-member-media`;
// One generation costs real money; this is the guard against a member holding
// down the button.
const DAILY_LIMIT = Number(process.env.VISUALIZATION_DAILY_LIMIT || 3);

const GenerateRequest = z.object({
  coachId: z.string().uuid(),
  kind: z.enum(['becoming', 'milestone', 'today']).optional(),
});

/*
  `consent` is a required literal `true` rather than a boolean the client may
  omit: consent to a face being stored and sent to an image model has to be an
  affirmative act, and a request that forgets to say so is a bug, not a grant.
*/
const GrantLikenessRequest = z.object({
  consent: z.literal(true),
  photoBase64: z.string().min(32),
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

// ---------------------------------------------------------------------------
// Likeness: consent and the reference photo
// ---------------------------------------------------------------------------

const LIKENESS_COLUMNS = 'reference_photo_url, likeness_consent, likeness_consent_at, reference_photo_updated_at';

async function readLikenessRow(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select(LIKENESS_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || {};
}

/** Clear both columns together — the CHECK constraint requires it. */
async function clearLikenessColumns(userId) {
  const { error } = await supabase
    .from('user_profiles')
    .update({
      reference_photo_url: null,
      likeness_consent: false,
      likeness_consent_at: null,
      reference_photo_updated_at: null,
    })
    .eq('user_id', userId);
  if (error) throw error;
}

/**
 * Delete every stored photo for this member.
 *
 * Called on revocation, before a replacement is written, and whenever anything
 * finds a stored photo that consent no longer covers. Failures are surfaced to
 * the caller: an erasure that did not happen must never be reported as one.
 */
function deleteStoredPhotos(userId) {
  return deleteReferencePhotos({ storage, bucketName: MEMBER_MEDIA_BUCKET, userId });
}

/**
 * What the generator is allowed to use, right now.
 *
 * Consent and the stored file are checked together, and disagreement is always
 * resolved against using the photo:
 *
 *   consent withdrawn but a photo is still pointed at  -> delete it, scene only
 *   consent held but the object is gone                -> forget it, scene only
 *
 * so a member who has revoked cannot be rendered by a stale row, and a leftover
 * object gets collected the next time anyone looks.
 */
async function resolveLikeness(userId, profile) {
  const storedUri = profile?.reference_photo_url || null;
  const consent = Boolean(profile?.likeness_consent);

  if (!consent) {
    if (storedUri) {
      // Should be unreachable (the constraint forbids it) but if it ever
      // happens the photo is the thing that has to go.
      try {
        await deleteStoredPhotos(userId);
        await clearLikenessColumns(userId);
      } catch (error) {
        console.error('Could not clear an unconsented reference photo:', error.message);
      }
    }
    return { consent: false, referenceUrl: null };
  }

  if (!storedUri) return { consent: true, referenceUrl: null };

  // A URL that is not ours (legacy rows, support fixes) is passed through as
  // given; anything in our own bucket is signed fresh and briefly.
  if (!storedUri.startsWith('gs://')) return { consent: true, referenceUrl: storedUri };

  if (!(await referencePhotoExists({ storage, uri: storedUri }))) {
    console.warn('Reference photo pointer with no object behind it; clearing.');
    await clearLikenessColumns(userId);
    return { consent: false, referenceUrl: null };
  }

  return { consent: true, referenceUrl: await signReferencePhoto({ storage, uri: storedUri }) };
}

/** What the app renders: never the stored URI, only a short-lived preview. */
async function likenessStatus(userId, profile) {
  const row = profile || (await readLikenessRow(userId));
  const storedUri = row.reference_photo_url || null;

  let previewUrl = null;
  if (storedUri?.startsWith('gs://')) {
    previewUrl = await signReferencePhoto({ storage, uri: storedUri }).catch(() => null);
  } else if (storedUri) {
    previewUrl = storedUri;
  }

  return {
    consent: Boolean(row.likeness_consent),
    hasPhoto: Boolean(storedUri),
    consentAt: row.likeness_consent_at ?? null,
    photoUpdatedAt: row.reference_photo_updated_at ?? null,
    previewUrl,
  };
}

async function handleLikenessStatus(req, res) {
  const caller = await resolveCaller(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });

  const profile = await readLikenessRow(caller.id);
  // Reading the status is also a chance to notice an inconsistency and correct
  // it in the member's favour.
  if (profile.reference_photo_url && !profile.likeness_consent) {
    await resolveLikeness(caller.id, profile);
    return res.json({ success: true, likeness: await likenessStatus(caller.id) });
  }

  return res.json({ success: true, likeness: await likenessStatus(caller.id, profile) });
}

async function handleLikenessGrant(req, res) {
  const caller = await resolveCaller(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });

  const { photoBase64 } = GrantLikenessRequest.parse(req.body || {});
  const { buffer, mime } = decodeReferencePhoto({ photoBase64 });

  const stored = await storeReferencePhoto({
    storage,
    bucketName: MEMBER_MEDIA_BUCKET,
    userId: caller.id,
    buffer,
    mime,
  });

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('user_profiles')
    .update({
      reference_photo_url: stored.uri,
      likeness_consent: true,
      likeness_consent_at: now,
      reference_photo_updated_at: now,
    })
    .eq('user_id', caller.id);

  if (error) {
    // Never leave a photo behind that nothing is tracking.
    await deleteStoredPhotos(caller.id).catch((cleanupError) =>
      console.error('Orphaned reference photo after a failed grant:', cleanupError.message)
    );
    throw error;
  }

  return res.json({ success: true, likeness: await likenessStatus(caller.id) });
}

const REVOKED = {
  consent: false,
  hasPhoto: false,
  consentAt: null,
  photoUpdatedAt: null,
  previewUrl: null,
};

/**
 * Withdrawal.
 *
 * The file goes first, then the columns — that order is what closes the window
 * the other way round would leave open: a generation already in flight is
 * holding a signed URL, and deleting the object makes that URL 404 rather than
 * letting one last picture through.
 *
 * If the delete fails we revoke anyway. A member who has said stop must stop
 * being used immediately, whatever the bucket is doing. `photoDeleted: false`
 * says so plainly instead of reporting an erasure that did not happen, and the
 * next status or generate call sweeps the leftover.
 */
async function handleLikenessRevoke(req, res) {
  const caller = await resolveCaller(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });

  const profile = await readLikenessRow(caller.id);

  const storedUri = profile.reference_photo_url;
  let photoDeleted = true;

  if (storedUri?.startsWith('gs://')) {
    try {
      await deleteStoredPhotos(caller.id);
    } catch (error) {
      photoDeleted = false;
      console.error('Reference photo delete failed during revoke:', error.message);
    }
  } else if (storedUri) {
    // A pointer at something we never stored (legacy rows, support fixes):
    // clearing it is the whole erasure. Sweep our own prefix anyway in case an
    // older upload is still sitting there, but do not report a failure to
    // delete a file we do not have.
    await deleteStoredPhotos(caller.id).catch((error) =>
      console.warn('Prefix sweep during revoke of an external pointer:', error.message)
    );
  }

  await clearLikenessColumns(caller.id);

  return res.json({
    success: true,
    photoDeleted,
    likeness: REVOKED,
    ...(photoDeleted
      ? {}
      : {
          message:
            'Your consent is withdrawn and your photo will not be used again, but the stored ' +
            'file could not be deleted just now. We will keep trying.',
        }),
  });
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

  const profile = await readLikenessRow(caller.id);
  const likeness = await resolveLikeness(caller.id, profile);

  const { data: goalRow } = await supabase
    .from('member_goals')
    .select('id')
    .eq('user_id', caller.id)
    .eq('coach_id', coachId)
    .maybeSingle();

  const scene = await generateScene({ openai, model: CHAT_MODEL, coach, member, kind });

  // PhotoMaker only when there is a photo we can still reach *and* consent that
  // still stands; anything else renders nobody identifiable.
  const model = chooseModel({
    referencePhotoUrl: likeness.referenceUrl,
    likenessConsent: likeness.consent,
  });

  const { data: record, error: insertError } = await supabase
    .from('coach_visualizations')
    .insert({
      user_id: caller.id,
      coach_id: coachId,
      goal_id: goalRow?.id ?? null,
      kind,
      scene: scene.scene,
      image_prompt: scene.image_prompt,
      // Recorded before the call, not after, so a failed generation still says
      // which model was asked — and so "did this use my face?" is answerable
      // from the row either way.
      model: model.id,
      status: 'pending',
    })
    .select()
    .single();

  if (insertError) throw insertError;

  try {
    /*
      Last look before the photo leaves the building. Generation is slow and
      the member may have revoked in the seconds since we resolved: if so, the
      object is already deleted (revoke deletes first), so the signed URL would
      404 — but sending it at all is the wrong shape, so don't.
    */
    if (model.id === MODELS.WITH_LIKENESS.id) {
      const stillConsented = (await readLikenessRow(caller.id)).likeness_consent;
      if (!stillConsented) {
        await supabase
          .from('coach_visualizations')
          .update({ status: 'failed', error: 'likeness_consent_withdrawn' })
          .eq('id', record.id);

        return res.status(409).json({
          error: 'likeness_consent_withdrawn',
          message: 'Your photo was removed while this was generating. Try again for a scene-only picture.',
        });
      }
    }

    const output = await replicate.run(
      model.id,
      { input: model.build(scene.image_prompt, likeness.referenceUrl) }
    );

    const generatedUrl = firstUrl(output);
    if (!generatedUrl) throw new Error('Model returned no image');

    const imageUrl = await persistImage(generatedUrl, caller.id);

    const { data: ready } = await supabase
      .from('coach_visualizations')
      .update({ image_url: imageUrl, status: 'ready' })
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
    if (path.endsWith('/likeness/grant')) return await handleLikenessGrant(req, res);
    if (path.endsWith('/likeness/revoke')) return await handleLikenessRevoke(req, res);
    if (path.endsWith('/likeness')) return await handleLikenessStatus(req, res);
    return await handleGenerate(req, res);
  } catch (error) {
    // The member can act on these: wrong format, too big, consent not given.
    if (error instanceof InvalidPhotoError) {
      return res.status(400).json({ error: error.code, message: error.message });
    }
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    // Never hand an internal error to the client: it is not actionable and it
    // leaks infrastructure detail (bucket names, stack shapes) into a UI alert.
    console.error('coach-visualizer error:', error);

    if (path.includes('/likeness')) {
      return res.status(500).json({
        error: 'likeness_update_failed',
        message: 'Could not save that just now. Please try again in a moment.',
      });
    }

    return res.status(500).json({
      error: 'generation_failed',
      message: 'Could not create the image right now. Please try again in a moment.',
    });
  }
};
