/**
 * Drives the real conversation pipeline: goal intake -> prompt v2 coaching ->
 * free-tier metering -> paywall -> coach-initiated nudge.
 * Uses the live OpenAI key via the local function gateway.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

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

const email = `flow${Date.now()}@example.com`;
const { data: created } = await admin.auth.admin.createUser({ email, password: 'flow-password-123', email_confirm: true });
const userId = created.user.id;
const user = createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false } });
await user.auth.signInWithPassword({ email, password: 'flow-password-123' });
const { data: { session } } = await user.auth.getSession();
const token = session.access_token;

await user.from('user_profiles').update({ user_id: userId, display_name: 'Sam' }).eq('email', email);

const POCKET = 'a1000000-0000-4000-8000-000000000001';
const MARISOL = 'a1000000-0000-4000-8000-000000000003';

const conversationId = (await user.rpc('open_coach_conversation', { p_coach_id: POCKET })).data;
await user.rpc('begin_goal_onboarding', { p_coach_id: POCKET });

async function say(message, coachId = POCKET, convId = conversationId) {
  const res = await fetch(`${API}/coach-response-generator`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ coachId, conversationId: convId, userMessage: message, presentation: 'chat' }),
  });
  return { status: res.status, body: await res.json() };
}

// --- intake -----------------------------------------------------------------
section('Conversational goal intake (real model calls)');
const intakeScript = [
  "hey, just signed up",
  "I want to be able to sit in with any band and hold the pocket all night",
  "I've been playing about two years, mostly bedroom practice to records",
  "my time falls apart as soon as I add the hi-hat, and I keep quitting after a week",
  "maybe 4 days a week, 30 minutes",
];

let last;
for (const [i, line] of intakeScript.entries()) {
  last = await say(line);
  if (last.status !== 200) { check(`turn ${i + 1}`, false, JSON.stringify(last.body)); break; }
  const ob = last.body.metadata.onboarding;
  console.log(`  [${i + 1}] you: ${line}`);
  console.log(`      ${last.body.metadata.coachName}: ${last.body.response}`);
  console.log(`      (mode=${last.body.metadata.promptVersion} onboarding.active=${ob?.active} turn=${ob?.turn})`);
  if (ob?.complete) break;
}

check('intake ran and completed', last?.body?.metadata?.onboarding?.complete === true,
      JSON.stringify(last?.body?.metadata?.onboarding));
check('intake used the onboarding path', last?.body?.metadata?.promptVersion === 'onboarding',
      last?.body?.metadata?.promptVersion);

const { data: goals } = await user.from('member_goals').select('*').eq('coach_id', POCKET).maybeSingle();
console.log('\n  extracted:', JSON.stringify({
  aspiration: goals?.aspiration, current_level: goals?.current_level,
  goals: goals?.goals, obstacles: goals?.obstacles, commitment: goals?.commitment,
}, null, 2).split('\n').join('\n  '));
check('aspiration captured', !!goals?.aspiration, String(goals?.aspiration));
check('current level captured', !!goals?.current_level, String(goals?.current_level));
check('obstacles captured', (goals?.obstacles?.length ?? 0) > 0, JSON.stringify(goals?.obstacles));
check('commitment captured', !!goals?.commitment?.days_per_week, JSON.stringify(goals?.commitment));
check('status is complete', goals?.onboarding_status === 'complete', goals?.onboarding_status);

// --- coaching ---------------------------------------------------------------
section('Coaching turn on prompt v2');
{
  await admin.from('coach_profiles').update({ prompt_version: 'v2' }).eq('id', POCKET);
  const reply = await say("I sat down to practice and my hands felt like bricks. Kind of want to skip today.");
  check('coaching reply returned', reply.status === 200, JSON.stringify(reply.body).slice(0, 200));
  check('used prompt v2', reply.body?.metadata?.promptVersion === 'v2', reply.body?.metadata?.promptVersion);
  console.log(`      Pocket: ${reply.body?.response}`);
  const text = (reply.body?.response ?? '').toLowerCase();
  check('reply is domain-specific, not generic motivation',
        /drum|kit|hi-?hat|pocket|click|groove|stick|practice|time|hand/.test(text), reply.body?.response);
  check('honours the SMS-length escape (chat is longer than 160 chars allowed)',
        (reply.body?.response ?? '').length > 40);
  check('free message metered', typeof reply.body?.metadata?.freeMessagesRemaining === 'number',
        String(reply.body?.metadata?.freeMessagesRemaining));
}

// --- retrieval --------------------------------------------------------------
/*
  #27: `match_coach_content` failed on every call and the caller turned the
  error into `[]`, so coaches answered without any of their creator's uploaded
  content and nothing said so. Both halves are asserted here — that content
  actually arrives, and that "no content" is reported as success rather than as
  a failure. The failure branch itself needs a broken database, so it lives in
  `functions/coach-response-generator/retrieval.test.mjs` instead.

  The embedding matches what `harness/mock-openai.js` returns for any input, so
  cosine similarity is 1 and the threshold is not what is under test.
*/
section('Creator content reaches the prompt (RAG retrieval)');
{
  /*
    Float32-rounded on purpose: `harness/mock-openai.js` returns the vector
    base64-encoded, which is what the OpenAI SDK asks for and decodes into a
    Float32Array. Seeding the float64 originals would still match — cosine
    similarity stays ~1 — but rounding here means the probe compares the bytes
    the generator will actually send.
  */
  const mockEmbedding = Array.from(
    new Float32Array(Array.from({ length: 1536 }, (_, i) => Math.sin(i) * 0.01))
  );

  /*
    First, the coach as it stands: nothing uploaded. This must read as a
    successful retrieval that found nothing, NOT as a failure. Conflating the
    two is precisely what let #27 hide. Pocket is used rather than a second
    coach because a fresh conversation would enter goal intake, which does not
    retrieve at all and would report `null` for a different and correct reason.
  */
  const empty = await say('what tempo should I aim for?');
  check('a coach with nothing uploaded still answers', empty.status === 200,
        JSON.stringify(empty.body).slice(0, 200));
  check('  → retrieval attempted', empty.body?.metadata?.retrievalFailed !== null,
        'null means it never ran');
  check('  → and empty is success, not failure',
        empty.body?.metadata?.retrievalFailed === false &&
        empty.body?.metadata?.relevantContentCount === 0,
        `retrievalFailed=${empty.body?.metadata?.retrievalFailed}, count=${empty.body?.metadata?.relevantContentCount}`);

  // A content_type only added by 20260810120000 — the enum extension that
  // broke the function's return signature in the first place.
  const { error: seedError } = await admin.from('coach_content_chunks').insert({
    coach_id: POCKET,
    content: 'Sit behind the beat. If it feels late to you it is probably right to everyone else.',
    content_type: 'lesson_notes',
    processed: true,
    voice_sample: true,
    embedding: JSON.stringify(mockEmbedding),
  });
  check('seeded a chunk of creator content', !seedError, seedError?.message);

  const { data: direct, error: rpcError } = await admin.rpc('match_coach_content', {
    coach_id: POCKET, query_embedding: mockEmbedding, match_threshold: 0.5, match_count: 5,
  });
  check('match_coach_content executes at all', !rpcError, rpcError?.message);
  check('  → and returns the chunk', (direct?.length ?? 0) >= 1, `got ${direct?.length ?? 0}`);
  check('  → content_type survives as text', typeof direct?.[0]?.content_type === 'string',
        JSON.stringify(direct?.[0]?.content_type));

  const reply = await say('how late should I be sitting on this groove?');
  check('reply generated with retrieval in play', reply.status === 200,
        JSON.stringify(reply.body).slice(0, 200));
  check('chunks reached the prompt', (reply.body?.metadata?.relevantContentCount ?? 0) >= 1,
        `relevantContentCount=${reply.body?.metadata?.relevantContentCount}`);
  check('retrieval reported as healthy', reply.body?.metadata?.retrievalFailed === false,
        String(reply.body?.metadata?.retrievalFailed));

  // The chunk ids are recorded, so which content shaped a reply is answerable.
  const { data: msgs } = await admin.from('conversation_messages')
    .select('source_chunk_ids, metadata').eq('conversation_id', conversationId)
    .eq('role', 'assistant').order('created_at', { ascending: false }).limit(1);
  check('source_chunk_ids persisted on the reply', (msgs?.[0]?.source_chunk_ids?.length ?? 0) >= 1,
        JSON.stringify(msgs?.[0]?.source_chunk_ids));
  check('no retrieval_failed marker on a healthy reply',
        msgs?.[0]?.metadata?.retrieval_failed === undefined,
        JSON.stringify(msgs?.[0]?.metadata));

  await admin.from('coach_content_chunks').delete().eq('coach_id', POCKET);
}

// --- prompt v1 still works --------------------------------------------------
section('Prompt v1 still reachable (parallel, not replaced)');
{
  await admin.from('coach_profiles').update({ prompt_version: 'v1' }).eq('id', POCKET);
  const reply = await say("what should I warm up with?");
  check('v1 reply returned', reply.status === 200, JSON.stringify(reply.body).slice(0, 200));
  check('reported as v1', reply.body?.metadata?.promptVersion === 'v1', reply.body?.metadata?.promptVersion);
  await admin.from('coach_profiles').update({ prompt_version: 'v2' }).eq('id', POCKET);
}

// --- metering + paywall -----------------------------------------------------
section('Free tier exhaustion -> 402 paywall');
{
  const { data: sub } = await user.from('coach_subscriptions').select('messages_used, free_message_quota').eq('coach_id', POCKET).maybeSingle();
  console.log(`  used ${sub.messages_used}/${sub.free_message_quota}`);
  let sawPaywall = false;
  for (let i = 0; i < 8; i++) {
    const r = await say('another question');
    if (r.status === 402) { sawPaywall = true; check('402 returned once quota is gone', true); break; }
    if (r.status !== 200) { check('unexpected status', false, `${r.status} ${JSON.stringify(r.body)}`); break; }
  }
  check('paywall eventually triggers', sawPaywall);

  const { data: after } = await user.from('coach_subscriptions').select('messages_used').eq('coach_id', POCKET).maybeSingle();
  check('metering did not run past the wall', after.messages_used <= 6, String(after.messages_used));
}

// --- entitlement restores access -------------------------------------------
section('Granting a paid entitlement restores access');
{
  await admin.from('coach_subscriptions')
    .update({ source: 'apple_iap', status: 'active', current_period_end: new Date(Date.now() + 30 * 864e5).toISOString() })
    .eq('user_id', userId).eq('coach_id', POCKET);
  const r = await say('ok I subscribed — where do I start?');
  check('paid member can chat again', r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 150)}`);
  check('paid member is not metered', r.body?.metadata?.freeMessagesRemaining === null,
        String(r.body?.metadata?.freeMessagesRemaining));
}

// --- coach-initiated nudge --------------------------------------------------
section('Coach-initiated nudge (the push payload path)');
{
  const before = (await user.from('conversation_messages').select('id').eq('conversation_id', conversationId)).data.length;

  const res = await fetch(`${API}/coach-response-generator`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': 'local-internal-key' },
    body: JSON.stringify({
      coachId: POCKET, conversationId,
      userMessage: "Open today's conversation with Sam yourself — they have not written first. Reference drumming specifically and give them one thing to do today. Ask one question they can answer in a sentence.",
      presentation: 'chat', suppressUserTurn: true,
    }),
  });
  const body = await res.json();
  check('internal call accepted', res.status === 200, `${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  console.log(`      Pocket (unprompted): ${body.response}`);
  check('returns assistantMessageId for the outbox', !!body.metadata?.assistantMessageId, String(body.metadata?.assistantMessageId));

  const msgs = (await user.from('conversation_messages').select('role,content').eq('conversation_id', conversationId).order('created_at')).data;
  check('exactly one message added (no synthetic user turn)', msgs.length === before + 1, `${before} -> ${msgs.length}`);
  check('the added message is from the coach', msgs[msgs.length - 1].role === 'assistant');
  check('the steering prompt is NOT in the thread',
        !msgs.some((m) => m.role === 'user' && m.content.includes('Open today')),
        JSON.stringify(msgs.filter(m => m.content.includes('Open today')).map(m => m.role)));
}

section('suppressUserTurn is rejected without the service key');
{
  const res = await fetch(`${API}/coach-response-generator`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ coachId: POCKET, conversationId, userMessage: 'sneaky', suppressUserTurn: true }),
  });
  check('403 for a member trying to forge an unattributed turn', res.status === 403, String(res.status));

  const res2 = await fetch(`${API}/coach-response-generator`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': 'wrong-key' },
    body: JSON.stringify({ coachId: POCKET, conversationId, userMessage: 'sneaky', suppressUserTurn: true }),
  });
  check('403 for a wrong internal key', res2.status === 403, String(res2.status));
}

// --- a different discipline -------------------------------------------------
section('A second discipline uses its own language');
{
  const yogaConv = (await user.rpc('open_coach_conversation', { p_coach_id: MARISOL })).data;
  await user.rpc('begin_goal_onboarding', { p_coach_id: MARISOL });
  const r = await say('I have twenty minutes and no energy today', MARISOL, yogaConv);
  check('yoga coach replies', r.status === 200, JSON.stringify(r.body).slice(0, 150));
  console.log(`      Marisol: ${r.body?.response}`);
  const text = (r.body?.response ?? '').toLowerCase();
  check('no drumming vocabulary leaked in', !/drum|hi-?hat|snare|paradiddle/.test(text), r.body?.response);
  check('no forbidden lexicon ("gains")', !/\bgains\b/.test(text), r.body?.response);
}

// --- nudge dispatcher -------------------------------------------------------
section('Nudge dispatcher sweep');
{
  await admin.from('push_devices').upsert({
    user_id: userId, expo_token: 'ExponentPushToken[flow-probe-device]', platform: 'ios', enabled: true,
  }, { onConflict: 'expo_token' });
  await admin.from('user_profiles').update({
    notification_channel: 'push', timezone: 'UTC', nudge_hour: new Date().getUTCHours(),
    quiet_hours_start: 0, quiet_hours_end: 0, active: true,
  }).eq('user_id', userId);
  await admin.from('coach_subscriptions').update({ notifications_enabled: true, nudge_cadence: 'daily', last_nudge_at: null })
    .eq('user_id', userId);

  const { data: due } = await admin.rpc('due_coach_nudges', { p_limit: 10 });
  check('dispatcher sees the member as due', (due?.length ?? 0) >= 1, JSON.stringify(due?.map(d => d.coach_name)));

  const res = await fetch(`${API}/coach-nudges/dispatch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const body = await res.json();
  console.log('  dispatch result:', JSON.stringify(body));
  check('dispatch completes', res.status === 200, JSON.stringify(body).slice(0, 200));

  const { data: nudges } = await admin.from('coach_nudges').select('status,body,error,delivered_count').eq('user_id', userId);
  console.log('  outbox:', JSON.stringify(nudges?.map(n => ({ status: n.status, delivered: n.delivered_count, err: n.error, body: n.body?.slice(0, 80) })), null, 2).split('\n').join('\n  '));
  check('a nudge row was written', (nudges?.length ?? 0) >= 1);
  check('the nudge message was generated', nudges?.some((n) => !!n.body), JSON.stringify(nudges?.map(n => n.status)));

  const res2 = await fetch(`${API}/coach-nudges/dispatch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const body2 = await res2.json();
  check('second sweep is a no-op (idempotent)', body2.considered === 0 || body2.sent === 0, JSON.stringify(body2));
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
