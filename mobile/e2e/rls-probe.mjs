/**
 * Exercises everything the mobile app does, through PostgREST as a real
 * anon/authenticated user — so RLS is actually in play, unlike the earlier
 * superuser tests.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync(process.env.ENV_FILE, 'utf8')
    .split('\n').filter(Boolean)
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, '')];
    })
);

const URL = env.API_URL;
const ANON = env.ANON_KEY;
const SERVICE = env.SERVICE_ROLE_KEY;

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
function section(t) { console.log(`\n### ${t}`); }

// --- anon roster ------------------------------------------------------------
section('Anonymous roster (what an unauthenticated browse hits)');
{
  const { data, error } = await anon.rpc('get_coach_roster', {
    p_category: null, p_search: null, p_limit: 40, p_offset: 0,
  });
  check('get_coach_roster as anon', !error && data?.length === 3, error?.message ?? `got ${data?.length}`);

  const { data: music } = await anon.rpc('get_coach_roster', { p_category: 'music', p_search: null, p_limit: 40, p_offset: 0 });
  check('category filter', music?.length === 1 && music[0].name === 'Pocket', JSON.stringify(music?.map(c => c.name)));

  const { data: search } = await anon.rpc('get_coach_roster', { p_category: null, p_search: 'lyric writing', p_limit: 40, p_offset: 0 });
  check('full-text search', search?.length === 1 && search[0].name === 'June', JSON.stringify(search?.map(c => c.name)));

  const { data: cats, error: catErr } = await anon.from('coach_categories').select('slug,label').eq('active', true);
  check('coach_categories readable by anon', !catErr && cats.length >= 10, catErr?.message);

  // The detail query the app runs, with its embedded joins.
  const { data: detail, error: detailErr } = await anon
    .from('coach_profiles')
    .select(`id, name, discipline, category_slug, expertise, starter_prompts, intro_message,
             coach_categories ( label, emoji ),
             creator_profiles ( display_name, slug, avatar_url ),
             coach_iap_products ( product_id, price_cents, currency, period, platform, active )`)
    .eq('id', 'a1000000-0000-4000-8000-000000000001')
    .maybeSingle();
  check('coach detail embedded joins', !detailErr && detail?.name === 'Pocket', detailErr?.message);
  check('  → category joined', detail?.coach_categories?.label === 'Music', JSON.stringify(detail?.coach_categories));
  check('  → creator joined', detail?.creator_profiles?.display_name?.includes('Okafor'), JSON.stringify(detail?.creator_profiles));
  check('  → ios product joined', Array.isArray(detail?.coach_iap_products) && detail.coach_iap_products.length === 1,
        JSON.stringify(detail?.coach_iap_products));
}

// --- create a member --------------------------------------------------------
section('Member signs up');
const email = `probe${Date.now()}@example.com`;
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email, password: 'probe-password-123', email_confirm: true,
});
check('create auth user', !createErr && !!created?.user, createErr?.message);
const userId = created.user.id;

const user = createClient(URL, ANON, { auth: { persistSession: false } });
const { error: signInErr } = await user.auth.signInWithPassword({ email, password: 'probe-password-123' });
check('sign in', !signInErr, signInErr?.message);

// What AuthContext.ensureProfile does.
section('Profile bootstrap (AuthContext.ensureProfile)');
{
  const { data: existing } = await user.from('user_profiles').select('id, user_id').eq('user_id', userId).maybeSingle();
  if (!existing) {
    const { data: byEmail } = await user.from('user_profiles').select('id, user_id').eq('email', email).maybeSingle();
    if (byEmail && !byEmail.user_id) {
      const { error } = await user.from('user_profiles').update({ user_id: userId }).eq('id', byEmail.id);
      check('adopt existing profile by email', !error, error?.message);
    } else if (!byEmail) {
      const { error } = await user.from('user_profiles').insert({
        user_id: userId, email, display_name: 'Probe', full_name: 'Probe',
        auth_provider: 'email', coach: null, coach_type: null,
        onboarded_at: new Date().toISOString(),
      });
      check('insert new profile', !error, error?.message);
    } else {
      check('profile already linked', true);
    }
  } else {
    check('profile auto-created by auth trigger and linked', true);
  }

  const { data: profile, error } = await user.from('user_profiles').select('user_id, email, notification_channel, nudge_hour').maybeSingle();
  check('member can read own profile', !error && profile?.user_id === userId, error?.message ?? JSON.stringify(profile));
  check('notification_channel defaults to push for app signup', profile?.notification_channel === 'push', profile?.notification_channel);
}

const POCKET = 'a1000000-0000-4000-8000-000000000001';

// --- conversation -----------------------------------------------------------
section('Open a thread');
let conversationId;
{
  const { data, error } = await user.rpc('open_coach_conversation', { p_coach_id: POCKET });
  check('open_coach_conversation', !error && !!data, error?.message);
  conversationId = data;

  const { data: again } = await user.rpc('open_coach_conversation', { p_coach_id: POCKET });
  check('idempotent', again === conversationId);

  const { data: subs, error: subErr } = await user.from('coach_subscriptions').select('source,status,free_message_quota').eq('coach_id', POCKET);
  check('free tier created', !subErr && subs?.[0]?.source === 'free_tier', subErr?.message ?? JSON.stringify(subs));

  // get_member_context() is the one read path for goal data: the prompt, the
  // visualiser and fetchGoals() all read this shape. A null goal_id is how the
  // app tells "the intake has never run" from "it ran and found nothing".
  const { data: before, error: beforeErr } = await user.rpc('get_member_context', {
    p_user_id: userId, p_coach_id: POCKET,
  });
  check('get_member_context before intake → goal_id null', !beforeErr && before?.goal_id === null,
        beforeErr?.message ?? JSON.stringify(before));

  const { data: goalId, error: goalErr } = await user.rpc('begin_goal_onboarding', { p_coach_id: POCKET });
  check('begin_goal_onboarding', !goalErr && !!goalId, goalErr?.message);

  const { data: ctx, error: ctxErr } = await user.rpc('get_member_context', {
    p_user_id: userId, p_coach_id: POCKET,
  });
  check('member reads own context (what fetchGoals calls)', !ctxErr && ctx?.goal_id === goalId,
        ctxErr?.message ?? JSON.stringify(ctx));
  check('  → onboarding_status carried', ctx?.onboarding_status === 'in_progress', JSON.stringify(ctx?.onboarding_status));
  check('  → days_together computed', typeof ctx?.days_together === 'number' && ctx.days_together >= 0,
        JSON.stringify(ctx?.days_together));

  const { data: svcCtx, error: svcErr } = await admin.rpc('get_member_context', {
    p_user_id: userId, p_coach_id: POCKET,
  });
  check('service role reads any member (the Cloud Functions path)', !svcErr && svcCtx?.goal_id === goalId, svcErr?.message);

  const { error: anonCtxErr } = await anon.rpc('get_member_context', { p_user_id: userId, p_coach_id: POCKET });
  check('anon may NOT read a member context', !!anonCtxErr, anonCtxErr ? '' : 'call succeeded!');

  // The row itself stays readable under RLS because the app writes to it.
  const { data: goals, error: gErr } = await user.from('member_goals').select('*').eq('coach_id', POCKET).maybeSingle();
  check('member_goals row visible under RLS (the write path)', !gErr && goals?.onboarding_status === 'in_progress',
        gErr?.message ?? JSON.stringify(goals));
}

section('Message write permissions');
{
  const { error: userTurnErr } = await user.from('conversation_messages')
    .insert({ conversation_id: conversationId, role: 'user', content: 'hello' });
  check('member may append their own turn', !userTurnErr, userTurnErr?.message);

  const { error: forgeErr } = await user.from('conversation_messages')
    .insert({ conversation_id: conversationId, role: 'assistant', content: 'forged coach reply' });
  check('member may NOT forge an assistant turn', !!forgeErr, forgeErr ? '' : 'insert succeeded!');

  const { data: msgs } = await user.from('conversation_messages').select('role,content').eq('conversation_id', conversationId);
  check('thread readable', msgs?.length === 1, JSON.stringify(msgs));
}

section('my coaches / unread');
{
  await admin.from('conversation_messages').insert({ conversation_id: conversationId, role: 'assistant', content: 'Morning. What are you working on?' });
  const { data, error } = await user.rpc('get_my_coaches');
  check('get_my_coaches', !error && data?.length === 1, error?.message);
  check('unread_count = 1', data?.[0]?.unread_count === 1, String(data?.[0]?.unread_count));
  check('preview present', !!data?.[0]?.last_message_preview, JSON.stringify(data?.[0]?.last_message_preview));
  await user.rpc('mark_conversation_read', { p_conversation_id: conversationId });
  const { data: after } = await user.rpc('get_my_coaches');
  check('unread clears after read', after?.[0]?.unread_count === 0, String(after?.[0]?.unread_count));
}

section('Notification settings the app writes');
{
  const { error } = await user.rpc('register_push_device', {
    p_expo_token: 'ExponentPushToken[probe-device]', p_platform: 'ios',
    p_device_name: 'Probe', p_app_version: '1.0.0',
  });
  check('register push device', !error, error?.message);

  // The device changes hands: a second account signs in on the same install.
  // This is the case that used to fail silently and kill push for that account.
  const { data: handover } = await admin.auth.admin.createUser({
    email: `handover${Date.now()}@example.com`, password: 'handover-password-123', email_confirm: true,
  });
  const second = createClient(URL, ANON, { auth: { persistSession: false } });
  await second.auth.signInWithPassword({ email: handover.user.email, password: 'handover-password-123' });
  const { error: reclaimErr } = await second.rpc('register_push_device', {
    p_expo_token: 'ExponentPushToken[probe-device]', p_platform: 'ios',
    p_device_name: 'Probe', p_app_version: '1.0.0',
  });
  check('a second account can reclaim the same device', !reclaimErr, reclaimErr?.message);

  const { data: owned } = await admin.from('push_devices')
    .select('user_id, enabled').eq('expo_token', 'ExponentPushToken[probe-device]').maybeSingle();
  check('  → ownership moved to the new account', owned?.user_id === handover.user.id, JSON.stringify(owned));
  check('  → and it is enabled', owned?.enabled === true);

  const { data: staleView } = await user.from('push_devices')
    .select('id').eq('expo_token', 'ExponentPushToken[probe-device]');
  check('  → previous owner can no longer see it', (staleView?.length ?? 0) === 0, JSON.stringify(staleView));

  await second.rpc('release_push_device', { p_expo_token: 'ExponentPushToken[probe-device]' });
  const { data: released } = await admin.from('push_devices')
    .select('enabled').eq('expo_token', 'ExponentPushToken[probe-device]').maybeSingle();
  check('sign-out disables rather than deletes', released?.enabled === false, JSON.stringify(released));

  const { error: prefErr } = await user.from('user_profiles')
    .update({ nudge_hour: 7, quiet_hours_start: 22, quiet_hours_end: 7 }).eq('user_id', userId);
  check('update notification prefs', !prefErr, prefErr?.message);

  const { error: cadenceErr } = await user.from('coach_subscriptions')
    .update({ nudge_cadence: 'weekly', notifications_enabled: false }).eq('coach_id', POCKET);
  check('update per-coach cadence', !cadenceErr, cadenceErr?.message);

  const { data: check1 } = await user.from('coach_subscriptions').select('nudge_cadence,notifications_enabled,status,source,messages_used').eq('coach_id', POCKET).maybeSingle();
  check('  → cadence persisted', check1?.nudge_cadence === 'weekly', JSON.stringify(check1));

  // The trigger must silently restore billing columns.
  await user.from('coach_subscriptions')
    .update({ status: 'active', source: 'apple_iap', messages_used: 0, free_message_quota: 9999 }).eq('coach_id', POCKET);
  const { data: check2 } = await user.from('coach_subscriptions').select('status,source,free_message_quota').eq('coach_id', POCKET).maybeSingle();
  check('member may NOT self-grant a paid entitlement', check2?.status === 'trialing' && check2?.source === 'free_tier' && check2?.free_message_quota === 5,
        JSON.stringify(check2));
}

section('Goal editing');
{
  const { error } = await user.from('member_goals')
    .update({ aspiration: 'someone who can hold the pocket all night', current_level: 'two years bedroom practice' })
    .eq('coach_id', POCKET);
  check('member edits own goals', !error, error?.message);

  const { data } = await user.from('member_goals').select('aspiration').eq('coach_id', POCKET).maybeSingle();
  check('  → persisted', data?.aspiration?.includes('pocket'), JSON.stringify(data));
}

section('Cross-tenant isolation');
{
  const { data: other } = await admin.auth.admin.createUser({ email: `other${Date.now()}@example.com`, password: 'other-password-123', email_confirm: true });
  const otherClient = createClient(URL, ANON, { auth: { persistSession: false } });
  await otherClient.auth.signInWithPassword({ email: other.user.email, password: 'other-password-123' });

  const { data: theirMsgs } = await otherClient.from('conversation_messages').select('id').eq('conversation_id', conversationId);
  check('another member cannot read this thread', (theirMsgs?.length ?? 0) === 0, JSON.stringify(theirMsgs));

  const { data: theirGoals } = await otherClient.from('member_goals').select('id');
  check('another member cannot read these goals', (theirGoals?.length ?? 0) === 0, JSON.stringify(theirGoals));

  // SECURITY DEFINER bypasses the policy above, so the function guards itself.
  const { error: crossCtxErr } = await otherClient.rpc('get_member_context', {
    p_user_id: userId, p_coach_id: POCKET,
  });
  check('another member cannot read this context', !!crossCtxErr, crossCtxErr ? '' : 'call succeeded!');

  const { data: theirCoaches } = await otherClient.rpc('get_my_coaches');
  check('get_my_coaches is per-caller', (theirCoaches?.length ?? 0) === 0, JSON.stringify(theirCoaches?.length));

  const { data: theirDevices } = await otherClient.from('push_devices').select('id');
  check('another member cannot see this device', (theirDevices?.length ?? 0) === 0, JSON.stringify(theirDevices));
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
