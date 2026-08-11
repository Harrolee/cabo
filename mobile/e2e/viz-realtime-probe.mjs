/**
 * Exercises the visualiser guards and the realtime path the chat screen relies
 * on for coach-initiated messages.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync(process.env.ENV_FILE, 'utf8').split('\n').filter(Boolean).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')];
  })
);
const API = 'http://127.0.0.1:8790';
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

  if (r.status === 200) {
    check('generate returned 200 with an image', !!r.body?.visualization?.image_url, JSON.stringify(r.body).slice(0, 150));
    check('caption returned', !!r.body?.caption, String(r.body?.caption));
  } else {
    console.log(`      (image model unavailable: ${r.status} ${JSON.stringify(r.body).slice(0, 120)})`);
    check('failed generation is recorded, not silently dropped', row?.status === 'failed' && !!row?.error);
  }
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
    // Exactly what the nudge dispatcher does: a service-role assistant insert.
    await admin.from('conversation_messages').insert({
      conversation_id: conversationId, role: 'assistant',
      content: 'Morning. Twenty minutes on the kit today — what tempo?',
    });

    await new Promise((r) => setTimeout(r, 4000));
    check('the message arrived over realtime', received.length === 1, `received ${received.length}`);
    check('  → it is the coach turn', received[0]?.role === 'assistant', JSON.stringify(received[0]?.role));
    check('  → content intact', received[0]?.content?.includes('Twenty minutes'), received[0]?.content);

    // Another member's thread must not leak through the same socket.
    const { data: other } = await admin.auth.admin.createUser({ email: `other${Date.now()}@example.com`, password: 'x-password-123', email_confirm: true });
    const otherClient = createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false } });
    await otherClient.auth.signInWithPassword({ email: other.user.email, password: 'x-password-123' });
    const otherConv = (await otherClient.rpc('open_coach_conversation', { p_coach_id: POCKET })).data;
    await admin.from('conversation_messages').insert({ conversation_id: otherConv, role: 'assistant', content: 'not for you' });
    await new Promise((r) => setTimeout(r, 3000));
    check('another member\'s message did not leak in', received.length === 1, `received ${received.length}`);
  }

  await user.removeChannel(channel);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
