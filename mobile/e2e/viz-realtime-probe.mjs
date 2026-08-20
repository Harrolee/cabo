/**
 * Exercises the visualiser guards and the realtime path the chat screen relies
 * on for coach-initiated messages.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
// The model table the function itself uses, so the assertions below cannot
// drift away from what actually ships.
import { MODELS } from '../../functions/shared/visualization.js';

const PHOTOMAKER_MODEL = MODELS.WITH_LIKENESS.id;
const SCENE_ONLY_MODEL = MODELS.SCENE_ONLY.id;

const env = Object.fromEntries(
  fs.readFileSync(process.env.ENV_FILE, 'utf8').split('\n').filter(Boolean).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')];
  })
);
const API = process.env.API_BASE || 'http://127.0.0.1:8790';
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? (pass++, console.log(`  ok    ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`)); };
const section = (t) => console.log(`\n### ${t}`);

const email = `viz${Date.now()}@example.com`;
const { data: created } = await admin.auth.admin.createUser({ email, password: 'viz-password-123', email_confirm: true });
const userId = created.user.id;
const user = createClient(env.API_URL, env.ANON_KEY, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 10 } },
});
await user.auth.signInWithPassword({ email, password: 'viz-password-123' });
const token = (await user.auth.getSession()).data.session.access_token;
await user.from('user_profiles').update({ user_id: userId, display_name: 'Viz' }).eq('email', email);

const POCKET = 'a1000000-0000-4000-8000-000000000001';
const conversationId = (await user.rpc('open_coach_conversation', { p_coach_id: POCKET })).data;

async function viz(path, body) {
  const res = await fetch(`${API}/coach-visualizer${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// --- guards -----------------------------------------------------------------
section('Visualiser refuses to invent a goal');
{
  await user.rpc('begin_goal_onboarding', { p_coach_id: POCKET });
  const r = await viz('/generate', { coachId: POCKET, kind: 'becoming' });
  check('422 no_aspiration before intake', r.status === 422 && r.body.error === 'no_aspiration',
        `${r.status} ${JSON.stringify(r.body)}`);
  check('  → message points back at the conversation',
        /tell .*what you'?re working toward/i.test(r.body.message ?? ''), r.body.message);
}

section('Visualiser requires an entitlement');
{
  await admin.from('member_goals').update({ aspiration: 'someone who can hold the pocket all night' })
    .eq('user_id', userId).eq('coach_id', POCKET);
  await admin.from('coach_subscriptions').update({ messages_used: 99 }).eq('user_id', userId).eq('coach_id', POCKET);
  const r = await viz('/generate', { coachId: POCKET, kind: 'becoming' });
  check('402 once the free tier is spent', r.status === 402, `${r.status} ${JSON.stringify(r.body)}`);
  await admin.from('coach_subscriptions')
    .update({ source: 'apple_iap', status: 'active', current_period_end: new Date(Date.now() + 30 * 864e5).toISOString() })
    .eq('user_id', userId).eq('coach_id', POCKET);
}

section('Unauthenticated access');
{
  const res = await fetch(`${API}/coach-visualizer/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coachId: POCKET }),
  });
  check('401 without a token', res.status === 401, String(res.status));
}

section('Scene generation (image model stubbed at the Replicate boundary)');
{
  const r = await viz('/generate', { coachId: POCKET, kind: 'becoming' });
  // Replicate is real here; the run may succeed or fail on network/credits.
  // Either way the row must be written and the scene must exist.
  const { data: rows } = await admin.from('coach_visualizations').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  check('a visualization row was written', (rows?.length ?? 0) >= 1, JSON.stringify(rows?.length));
  const row = rows?.[0];
  check('scene text produced', !!row?.scene, String(row?.scene));
  check('image prompt produced', !!row?.image_prompt, String(row?.image_prompt)?.slice(0, 80));
  console.log(`      scene:  ${row?.scene}`);
  console.log(`      prompt: ${row?.image_prompt?.slice(0, 140)}`);
  console.log(`      status: ${row?.status}  model: ${row?.model ?? '-'}  err: ${row?.error ?? '-'}`);
  check('no before/after language in the prompt',
        !/before|after|transformation|weight loss|slimmer/i.test(row?.image_prompt ?? ''), row?.image_prompt);
  check('no body descriptors in the prompt',
        !/\b(skinny|chubby|overweight|frail|ripped|muscular)\b/i.test(row?.image_prompt ?? ''), row?.image_prompt);
  check('scene-only model recorded with no reference photo',
        row?.model === SCENE_ONLY_MODEL, String(row?.model));

  if (r.status === 200) {
    check('generate returned 200 with an image', !!r.body?.visualization?.image_url, JSON.stringify(r.body).slice(0, 150));
    check('caption returned', !!r.body?.caption, String(r.body?.caption));
  } else {
    console.log(`      (image model unavailable: ${r.status} ${JSON.stringify(r.body).slice(0, 120)})`);
    check('failed generation is recorded, not silently dropped', row?.status === 'failed' && !!row?.error);
  }
}

// --- likeness ---------------------------------------------------------------
/*
  The identity-preserving branch, without spending anything at Replicate: what
  is under test is which model gets chosen and whether consent can be forged or
  outlived, all of which is decided before the model is ever called. The runs
  below fail at the Replicate boundary (no token in the harness) and that is
  fine — `coach_visualizations.model` is written before the call, so the choice
  is on the row either way. Failed rows also do not count toward the daily
  limit, which is why this section can sit in front of it.
*/
section('Likeness: consent is explicit, backend-only, and revocable');
{
  const status = await viz('/likeness', {});
  check('status endpoint reports no consent and no photo',
        status.status === 200 && status.body.likeness?.consent === false
          && status.body.likeness?.hasPhoto === false, JSON.stringify(status.body).slice(0, 160));

  const noConsent = await viz('/likeness/grant', { photoBase64: 'x'.repeat(64) });
  check('grant without an explicit consent flag is refused',
        noConsent.status === 400, `${noConsent.status} ${JSON.stringify(noConsent.body).slice(0, 120)}`);

  const notAnImage = await viz('/likeness/grant', {
    consent: true,
    photoBase64: Buffer.from('this is not an image, it is a sentence.').toString('base64'),
  });
  check('a file that is not an image is refused on its bytes',
        notAnImage.status === 400 && notAnImage.body.error === 'photo_unsupported_format',
        `${notAnImage.status} ${JSON.stringify(notAnImage.body).slice(0, 140)}`);

  const heicHeader = Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(64, 1),
  ]);
  const heic = await viz('/likeness/grant', { consent: true, photoBase64: heicHeader.toString('base64') });
  check('HEIC is refused with something the member can act on',
        heic.status === 400 && /heic/i.test(heic.body.message ?? ''), JSON.stringify(heic.body).slice(0, 140));

  // The member owns the row, so PostgREST will happily accept this write; the
  // trigger is what keeps consent from being self-granted.
  await user.from('user_profiles')
    .update({ likeness_consent: true, reference_photo_url: 'https://example.com/someone-else.jpg' })
    .eq('user_id', userId);
  const selfGranted = (await admin.from('user_profiles')
    .select('likeness_consent, reference_photo_url').eq('user_id', userId).maybeSingle()).data;
  check('a member cannot grant themselves consent directly',
        selfGranted?.likeness_consent === false, JSON.stringify(selfGranted));
  check('  → nor point the photo at somebody else',
        selfGranted?.reference_photo_url === null, JSON.stringify(selfGranted?.reference_photo_url));
}

section('Likeness: PhotoMaker is chosen once consent and a photo exist');
{
  // Stands in for the stored photo. A gs:// URI would be checked against the
  // bucket, which the harness has no credentials for; an external URL takes the
  // same path the model call does.
  const now = new Date().toISOString();
  await admin.from('user_profiles').update({
    reference_photo_url: 'https://example.com/reference.jpg',
    likeness_consent: true,
    likeness_consent_at: now,
    reference_photo_updated_at: now,
  }).eq('user_id', userId);

  const status = await viz('/likeness', {});
  check('status reflects the stored photo', status.body.likeness?.consent === true
        && status.body.likeness?.hasPhoto === true, JSON.stringify(status.body).slice(0, 160));

  await viz('/generate', { coachId: POCKET, kind: 'becoming' });
  const withLikeness = (await admin.from('coach_visualizations').select('model, status')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(1)).data?.[0];
  check('the generation records the PhotoMaker model',
        withLikeness?.model === PHOTOMAKER_MODEL, JSON.stringify(withLikeness));

  // The trigger word PhotoMaker needs is appended by MODELS.WITH_LIKENESS.build,
  // and appended exactly once.
  const input = MODELS.WITH_LIKENESS.build('a drummer mid-groove', 'https://example.com/reference.jpg');
  check('the prompt carries the img trigger word exactly once',
        (input.prompt.match(/\bimg\b/g) ?? []).length === 1, input.prompt);
  check('  → and the reference photo is passed as the input image',
        input.input_image === 'https://example.com/reference.jpg', String(input.input_image));
}

section('Likeness: revoking reverts the next generation to scene-only');
{
  const revoke = await viz('/likeness/revoke', {});
  check('revoke succeeds', revoke.status === 200 && revoke.body.likeness?.consent === false,
        `${revoke.status} ${JSON.stringify(revoke.body).slice(0, 140)}`);
  check('  → and reports the photo as deleted', revoke.body.photoDeleted === true,
        JSON.stringify(revoke.body).slice(0, 140));

  const cleared = (await admin.from('user_profiles')
    .select('likeness_consent, reference_photo_url, likeness_consent_at, reference_photo_updated_at')
    .eq('user_id', userId).maybeSingle()).data;
  check('both columns are cleared, not just the flag',
        cleared?.likeness_consent === false && cleared?.reference_photo_url === null
          && cleared?.likeness_consent_at === null && cleared?.reference_photo_updated_at === null,
        JSON.stringify(cleared));

  await viz('/generate', { coachId: POCKET, kind: 'becoming' });
  const afterRevoke = (await admin.from('coach_visualizations').select('model')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(1)).data?.[0];
  check('the next generation is back on the scene-only model',
        afterRevoke?.model === SCENE_ONLY_MODEL, JSON.stringify(afterRevoke));

  // A photo pointer that consent no longer covers is not a state the database
  // will even hold.
  const { error } = await admin.from('user_profiles')
    .update({ reference_photo_url: 'gs://bucket/orphan.jpg', likeness_consent: false })
    .eq('user_id', userId);
  check('a stored photo without consent is rejected by the database',
        !!error, JSON.stringify(error?.message ?? 'accepted'));
}

section('Daily limit');
{
  // Failed generations no longer count toward the quota, so only tally the rest.
  const before = (await admin.from('coach_visualizations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId).neq('status', 'failed')).count ?? 0;
  // Top the member up to the limit with rows dated now.
  const filler = Array.from({ length: Math.max(0, 3 - before) }, () => ({
    user_id: userId, coach_id: POCKET, kind: 'becoming', scene: 'filler', status: 'ready',
  }));
  if (filler.length) await admin.from('coach_visualizations').insert(filler);
  const r = await viz('/generate', { coachId: POCKET, kind: 'becoming' });
  check('429 at the daily limit', r.status === 429, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
}

section('History endpoint');
{
  const r = await viz('/history', { coachId: POCKET });
  check('history returns ready rows only', r.status === 200 && Array.isArray(r.body.visualizations)
        && r.body.visualizations.every((v) => v.status === 'ready'), JSON.stringify(r.body).slice(0, 160));
}

// --- realtime ---------------------------------------------------------------
section('Realtime: a coach-initiated message reaches an open thread');
{
  const received = [];
  const channel = user
    .channel(`thread:${conversationId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'conversation_messages',
      filter: `conversation_id=eq.${conversationId}`,
    }, (payload) => received.push(payload.new));

  const subscribed = await new Promise((resolve) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve(true);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') resolve(false);
    });
    setTimeout(() => resolve(false), 12000);
  });
  check('subscribed to the thread channel', subscribed);

  if (subscribed) {
    /*
      Wait for the event rather than sleeping a fixed interval. Realtime replays
      the WAL in order, so when this suite runs straight after the write-heavy
      ones it can still be chewing through their backlog when our insert lands —
      a fixed 4s wait then reports "realtime is broken" for what is really a
      queue that had not reached us yet. Poll to a generous ceiling instead: a
      healthy stack satisfies this in well under a second, and a genuinely
      broken one still fails, just later.
    */
    const waitFor = async (predicate, ms = 30000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (predicate()) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return predicate();
    };

    // Exactly what the nudge dispatcher does: a service-role assistant insert.
    await admin.from('conversation_messages').insert({
      conversation_id: conversationId, role: 'assistant',
      content: 'Morning. Twenty minutes on the kit today — what tempo?',
    });

    await waitFor(() => received.length >= 1);
    check('the message arrived over realtime', received.length === 1, `received ${received.length}`);
    check('  → it is the coach turn', received[0]?.role === 'assistant', JSON.stringify(received[0]?.role));
    check('  → content intact', received[0]?.content?.includes('Twenty minutes'), received[0]?.content);

    /*
      Another member's thread must not leak through the same socket. Proving a
      negative needs a positive to pin it to: subscribe as the other member too,
      and wait for *their* channel to see the message. Once it has been
      delivered there, realtime has demonstrably processed that insert, so
      "nothing arrived on our channel" means it was filtered rather than merely
      still in flight. A bare sleep here would pass just as happily against a
      realtime server that had stopped delivering anything at all.
    */
    const { data: other } = await admin.auth.admin.createUser({ email: `other${Date.now()}@example.com`, password: 'x-password-123', email_confirm: true });
    const otherClient = createClient(env.API_URL, env.ANON_KEY, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
    await otherClient.auth.signInWithPassword({ email: other.user.email, password: 'x-password-123' });
    const otherConv = (await otherClient.rpc('open_coach_conversation', { p_coach_id: POCKET })).data;

    const otherReceived = [];
    const otherChannel = otherClient
      .channel(`thread:${otherConv}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'conversation_messages',
        filter: `conversation_id=eq.${otherConv}`,
      }, (payload) => otherReceived.push(payload.new));
    const otherSubscribed = await new Promise((resolve) => {
      otherChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve(true);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') resolve(false);
      });
      setTimeout(() => resolve(false), 12000);
    });
    check('  → the other member subscribed to their own thread', otherSubscribed);

    await admin.from('conversation_messages').insert({ conversation_id: otherConv, role: 'assistant', content: 'not for you' });
    const deliveredThere = await waitFor(() => otherReceived.length >= 1);
    check('  → their message reached them', deliveredThere, `received ${otherReceived.length}`);
    check('another member\'s message did not leak in', received.length === 1, `received ${received.length}`);

    await otherClient.removeChannel(otherChannel);
  }

  await user.removeChannel(channel);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
