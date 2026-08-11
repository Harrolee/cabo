/**
 * Account deletion, end to end.
 *
 * App Store Review Guideline 5.1.1(v) is why the feature exists, but what this
 * probe is actually for is the claim underneath it: that a member who asks to
 * be deleted is deleted. `member_goals` holds what someone is struggling with,
 * `conversation_messages` holds every word they have said to a coach, and the
 * member-media bucket holds a photograph of their face.
 *
 *   node e2e/account-deletion-probe.mjs      (from mobile/, with ENV_FILE set)
 *
 * Needs the local Supabase stack and the example roster seed. It does NOT need
 * GCS credentials or the function gateway: it drives `functions/account-deletion`
 * in process against a fake Cloud Storage JSON API, so the real
 * `@google-cloud/storage` client issues real list and delete calls and the
 * object is observably gone at the end rather than merely unreferenced.
 *
 * Four things it sets out to prove:
 *
 *   1. No row in any affected table still references the member, and the auth
 *      identity is gone, and signing back in gets a genuinely new account.
 *   2. The stored photo object is gone from the bucket.
 *   3. A coach the member created that other people subscribe to survives, and
 *      those people's threads, entitlements and roster reads survive with it —
 *      because `coach_profiles` used to cascade off both owner columns, which
 *      would have deleted it and everything hanging off it.
 *   4. If the photo cannot be deleted, nothing is deleted.
 *
 * Everything it creates is torn down at the end, including on failure: the
 * other suites assert on the exact contents of the seeded roster.
 */
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeGcs } from './harness/fake-gcs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const require = createRequire(import.meta.url);

const env = Object.fromEntries(
  fs.readFileSync(process.env.ENV_FILE, 'utf8').split('\n').filter(Boolean).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')];
  })
);

const URL_ = env.API_URL;
const ANON = env.ANON_KEY;
const SERVICE = env.SERVICE_ROLE_KEY;

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (n, ok, d = '') =>
  ok ? (pass++, console.log(`  ok    ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`));
const section = (t) => console.log(`\n### ${t}`);

const BUCKET = 'local-test-member-media';
const POCKET = 'a1000000-0000-4000-8000-000000000001';
const DEV_CREATOR_SLUG = 'dev-okafor';

// ---------------------------------------------------------------------------
// Fake Cloud Storage, then the function — in that order, because the function
// builds its Storage client at require time.
// ---------------------------------------------------------------------------
const gcs = await startFakeGcs();
process.env.STORAGE_EMULATOR_HOST = gcs.emulatorHost;
process.env.SUPABASE_URL = URL_;
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;
process.env.MEMBER_MEDIA_BUCKET = BUCKET;
process.env.PROJECT_ID = 'local-test';

const { deleteAccount } = require(path.join(repoRoot, 'functions/account-deletion/index.js'));

/** The Cloud Functions request/response pair, minus Express. */
async function callFunction({ path: p = '/', token, body = {} }) {
  const req = {
    method: 'POST',
    path: p,
    body,
    get: (h) => (h.toLowerCase() === 'authorization' ? (token ? `Bearer ${token}` : undefined) : undefined),
  };

  let status = 200;
  let payload;
  const res = {
    set: () => res,
    status: (c) => { status = c; return res; },
    json: (b) => { payload = b; return res; },
    send: (b) => { payload = b; return res; },
  };

  await deleteAccount(req, res);
  return { status, body: payload };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const stamp = Date.now();
const created = { users: [], coaches: [], creators: [], profiles: [] };

async function makeMember(label) {
  const email = `del-${label}-${stamp}@example.com`;
  const password = 'probe-password-123';
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error) throw new Error(`create ${label}: ${error.message}`);
  created.users.push(data.user.id);

  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: session, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`sign in ${label}: ${signInError.message}`);

  await admin.from('user_profiles').upsert(
    {
      user_id: data.user.id,
      email,
      full_name: `Probe ${label}`,
      display_name: `Probe ${label}`,
      auth_provider: 'email',
      coach: null,
      coach_type: null,
      onboarded_at: new Date().toISOString(),
    },
    { onConflict: 'email' }
  );
  created.profiles.push(email);

  return { id: data.user.id, email, password, client, token: session.session.access_token };
}

/** A coach owned by `owner`, optionally attributed to somebody else's creator. */
async function makeCoach({ name, owner, creatorId, listing = 'listed' }) {
  const { data, error } = await admin
    .from('coach_profiles')
    .insert({
      user_id: creatorId ? null : owner.id,
      user_email: owner.email,
      creator_id: creatorId ?? null,
      name,
      handle: `${name.toLowerCase()}${stamp}`.slice(0, 30),
      description: 'Probe fixture.',
      discipline: 'Probe fixture',
      category_slug: 'other',
      primary_response_style: 'tough_love',
      active: true,
      public: false,
      listing_status: listing,
    })
    .select('id')
    .single();
  if (error) throw new Error(`create coach ${name}: ${error.message}`);
  created.coaches.push(data.id);
  return data.id;
}

async function cleanup() {
  for (const id of created.coaches) await admin.from('coach_profiles').delete().eq('id', id);
  for (const id of created.creators) await admin.from('creator_profiles').delete().eq('id', id);
  for (const email of created.profiles) await admin.from('user_profiles').delete().eq('email', email);
  for (const id of created.users) await admin.auth.admin.deleteUser(id).catch(() => {});
  await gcs.close();
}

let exitCode = 0;
try {

// ---------------------------------------------------------------------------
section('Set up a member with a full footprint');
// ---------------------------------------------------------------------------
const alice = await makeMember('alice');   // the one who leaves
const bob   = await makeMember('bob');     // a paying subscriber to her coach

// Alice is a creator with two coaches of her own, plus one that is really
// somebody else's and only carries her address in the legacy owner column —
// the shape the five default personas are in.
const { data: aliceCreator, error: creatorError } = await admin
  .from('creator_profiles')
  .insert({
    user_id: alice.id,
    user_email: alice.email,
    display_name: 'Alice Probe',
    slug: `alice-probe-${stamp}`.slice(0, 40),
    bio: 'Personal, and should not survive her.',
    status: 'approved',
  })
  .select('id')
  .single();
check('creator profile for the departing member', !creatorError, creatorError?.message);
if (aliceCreator) created.creators.push(aliceCreator.id);

const { data: devCreator } = await admin
  .from('creator_profiles').select('id').eq('slug', DEV_CREATOR_SLUG).single();

const lonelyCoach   = await makeCoach({ name: 'Lonely', owner: alice, creatorId: aliceCreator.id, listing: 'draft' });
const popularCoach  = await makeCoach({ name: 'Popular', owner: alice, creatorId: aliceCreator.id });
const borrowedCoach = await makeCoach({ name: 'Borrowed', owner: alice, creatorId: devCreator.id });

// Alice's own data: a thread with messages, a goal, an image, a device, a
// subscription, and a photograph of her face.
const { data: convId, error: convError } = await alice.client.rpc('open_coach_conversation', { p_coach_id: POCKET });
check('thread opened', !convError && !!convId, convError?.message);

await admin.from('conversation_messages').insert([
  { conversation_id: convId, role: 'user', content: 'The thing I am most ashamed of.' },
  { conversation_id: convId, role: 'assistant', content: 'Heard.' },
]);
await admin.from('member_goals').insert({
  user_id: alice.id, coach_id: POCKET, aspiration: 'someone who finishes things', onboarding_status: 'complete',
});
await admin.from('coach_visualizations').insert({
  user_id: alice.id, coach_id: POCKET, kind: 'becoming', scene: 'a stage', status: 'ready',
  image_url: 'https://example.invalid/x.jpg',
});
await admin.from('push_devices').insert({
  user_id: alice.id, expo_token: `ExponentPushToken[probe-${stamp}]`, platform: 'ios',
});
await admin.from('coach_nudges').insert({
  user_id: alice.id, coach_id: POCKET, local_date: '2026-08-11', status: 'sent', body: 'hello',
});

const PHOTO = `member-reference/${alice.id}/reference.jpg`;
// Two objects, one under an older extension, because revocation sweeps the
// prefix rather than the one path the column happens to name — and so must this.
const STALE_PHOTO = `member-reference/${alice.id}/reference.png`;
gcs.put(BUCKET, PHOTO, Buffer.from('a photograph of her face'));
gcs.put(BUCKET, STALE_PHOTO, Buffer.from('an older one'));

const { error: photoError } = await admin
  .from('user_profiles')
  .update({
    likeness_consent: true,
    likeness_consent_at: new Date().toISOString(),
    reference_photo_url: `gs://${BUCKET}/${PHOTO}`,
    reference_photo_updated_at: new Date().toISOString(),
  })
  .eq('user_id', alice.id);
check('reference photo recorded', !photoError, photoError?.message);
check('photo objects are in the bucket to start with', gcs.list(BUCKET, `member-reference/${alice.id}/`).length === 2);

// Bob subscribes to Alice's popular coach and talks to it, so deleting it
// would take his history with it.
await admin.from('coach_subscriptions').insert({
  user_id: bob.id, user_email: bob.email, coach_id: popularCoach, status: 'active', source: 'ios_iap',
});
const { data: bobConv } = await bob.client.rpc('open_coach_conversation', { p_coach_id: popularCoach });
check('other member has a thread with her coach', !!bobConv);

const { data: beforeCounts } = await admin
  .from('coach_profiles').select('id, subscriber_count').in('id', [POCKET, popularCoach]);
const pocketBefore = beforeCounts.find((c) => c.id === POCKET)?.subscriber_count ?? 0;

// ---------------------------------------------------------------------------
section('The confirmation screen is told the truth');
// ---------------------------------------------------------------------------
{
  const { status, body } = await callFunction({ path: '/preview', token: alice.token });
  check('preview requires nothing but a session', status === 200, JSON.stringify(body));
  check('  → counts her conversations', body?.summary?.conversations === 1, JSON.stringify(body?.summary));
  check('  → counts her goals', body?.summary?.goals === 1);
  check('  → counts her images', body?.summary?.images === 1);
  check('  → says there is a photo of her', body?.summary?.hasReferencePhoto === true);
}

// ---------------------------------------------------------------------------
section('Nothing deletes by accident');
// ---------------------------------------------------------------------------
{
  const anonymous = await callFunction({ path: '/', body: { confirm: 'DELETE' } });
  check('no session, no deletion', anonymous.status === 401, JSON.stringify(anonymous.body));

  const unconfirmed = await callFunction({ path: '/', token: alice.token, body: {} });
  check('empty body is refused', unconfirmed.status === 400, JSON.stringify(unconfirmed.body));

  const wrongWord = await callFunction({ path: '/', token: alice.token, body: { confirm: 'delete-it' } });
  check('a near-miss confirmation is refused', wrongWord.status === 400, JSON.stringify(wrongWord.body));

  const truthy = await callFunction({ path: '/', token: alice.token, body: { confirm: true } });
  check('a truthy value is not a confirmation', truthy.status === 400, JSON.stringify(truthy.body));

  const { count } = await admin
    .from('user_profiles').select('id', { count: 'exact', head: true }).eq('user_id', alice.id);
  check('  → her profile is still there after all four', count === 1);
}

// ---------------------------------------------------------------------------
section('A photo we cannot delete stops the whole deletion');
// ---------------------------------------------------------------------------
{
  gcs.failMode = 'delete';
  const { status, body } = await callFunction({ path: '/', token: alice.token, body: { confirm: 'DELETE' } });

  check('refuses with a retryable status', status === 503, `${status} ${JSON.stringify(body)}`);
  check('  → and says so in words a member can act on', /photo/i.test(body?.message ?? ''), body?.message);

  const { count: profiles } = await admin
    .from('user_profiles').select('id', { count: 'exact', head: true }).eq('user_id', alice.id);
  const { count: messages } = await admin
    .from('conversation_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', convId);
  check('  → her profile survived', profiles === 1);
  check('  → her messages survived', messages === 2);
  check('  → a photo of her survived, so the account was not erased around it',
        gcs.list(BUCKET, `member-reference/${alice.id}/`).length > 0);

  /*
    The deletes go out in parallel and the sweep gives up on the first
    rejection, so one of the others can still be in flight when the flag is
    cleared. Let them land, then put the prefix back the way it was — asserting
    on the outcome of that race would be asserting on nothing.
  */
  await new Promise((resolve) => setTimeout(resolve, 500));
  gcs.failMode = null;
  gcs.put(BUCKET, PHOTO, Buffer.from('a photograph of her face'));
  gcs.put(BUCKET, STALE_PHOTO, Buffer.from('an older one'));
}

// ---------------------------------------------------------------------------
section('She deletes her account');
// ---------------------------------------------------------------------------
const deletion = await callFunction({ path: '/', token: alice.token, body: { confirm: 'DELETE' } });
check('deletion succeeds', deletion.status === 200, JSON.stringify(deletion.body));
check('  → reports both photo objects deleted', deletion.body?.photosDeleted === 2, String(deletion.body?.photosDeleted));

// ---------------------------------------------------------------------------
section('The photograph is actually gone from the bucket');
// ---------------------------------------------------------------------------
{
  check('the named object is gone', !gcs.has(BUCKET, PHOTO));
  check('the object under the older extension is gone too', !gcs.has(BUCKET, STALE_PHOTO));
  check('nothing is left under her prefix', gcs.list(BUCKET, `member-reference/${alice.id}/`).length === 0);

  // Ordering is the point of the whole design: the object goes before the row
  // that points at it, because once the row is gone nothing knows the object
  // is there.
  const deletes = gcs.calls('delete').filter((c) => c.object.includes(alice.id));
  check('the client really issued the deletes', deletes.length >= 2, JSON.stringify(deletes.map((d) => d.object)));
  check('swept by prefix, not by the column', gcs.calls('list').some((c) => c.prefix === `member-reference/${alice.id}/`));
}

// ---------------------------------------------------------------------------
section('No row anywhere still references her');
// ---------------------------------------------------------------------------
{
  const byUserId = [
    'member_goals', 'conversations', 'coach_subscriptions',
    'push_devices', 'coach_visualizations', 'coach_nudges',
  ];
  for (const table of byUserId) {
    const { count, error } = await admin
      .from(table).select('id', { count: 'exact', head: true }).eq('user_id', alice.id);
    check(`${table} has nothing for her`, !error && count === 0, error?.message ?? `count=${count}`);
  }

  const { count: profiles } = await admin
    .from('user_profiles').select('id', { count: 'exact', head: true }).eq('user_id', alice.id);
  check('user_profiles has nothing for her', profiles === 0);

  const { count: byEmail } = await admin
    .from('user_profiles').select('id', { count: 'exact', head: true }).eq('email', alice.email);
  check('  → nor under her email', byEmail === 0);

  const { count: messages } = await admin
    .from('conversation_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', convId);
  check('conversation_messages has nothing for her', messages === 0);

  const { data: authUser } = await admin.auth.admin.getUserById(alice.id);
  check('the auth identity is gone', !authUser?.user, authUser?.user?.id);
}

// ---------------------------------------------------------------------------
section('Her coaches: kept, unlisted or deleted, never orphaned');
// ---------------------------------------------------------------------------
{
  const { data: lonely } = await admin.from('coach_profiles').select('id').eq('id', lonelyCoach).maybeSingle();
  check('the coach nobody else used is deleted', !lonely);

  const { data: popular } = await admin
    .from('coach_profiles')
    .select('id, active, listing_status, user_id, user_email, creator_id')
    .eq('id', popularCoach).maybeSingle();
  check('the coach with a paying subscriber survives', !!popular);
  check('  → still active, so his thread still works', popular?.active === true);
  check('  → unlisted, so nobody new subscribes to an unowned coach', popular?.listing_status === 'unlisted');
  check('  → no longer linked to her', popular?.user_id === null && popular?.user_email === null,
        JSON.stringify({ user_id: popular?.user_id, user_email: popular?.user_email }));

  const { data: borrowed } = await admin
    .from('coach_profiles')
    .select('id, listing_status, user_id, user_email, creator_id')
    .eq('id', borrowedCoach).maybeSingle();
  check('a coach belonging to another creator is not touched', !!borrowed);
  check('  → still listed (this is the default-personas case)', borrowed?.listing_status === 'listed');
  check('  → but her personal link is cut', borrowed?.user_id === null && borrowed?.user_email === null);
  check('  → attribution intact', borrowed?.creator_id === devCreator.id);

  const { data: creator } = await admin
    .from('creator_profiles')
    .select('id, user_id, user_email, display_name, slug, bio, status')
    .eq('id', aliceCreator.id).maybeSingle();
  check('her creator profile survives only because a coach needs it', !!creator);
  check('  → detached from the account', creator?.user_id === null);
  check('  → name, bio and email scrubbed', creator?.display_name === 'Former creator' &&
        creator?.bio === null && creator?.user_email !== alice.email,
        JSON.stringify(creator));
  check('  → and the slug, which is usually a real name', !creator?.slug?.includes('alice-probe'), creator?.slug);
}

// ---------------------------------------------------------------------------
section('Nothing she left behind breaks anyone else');
// ---------------------------------------------------------------------------
{
  const { data: mine, error } = await bob.client.rpc('get_my_coaches');
  check('get_my_coaches still works for the subscriber', !error, error?.message);
  const kept = mine?.find((c) => c.coach_id === popularCoach);
  check('  → her coach is still in his list', !!kept, JSON.stringify(mine?.map((c) => c.name)));
  check('  → with his thread', !!kept?.conversation_id);
  check('  → and his entitlement', kept?.has_access === true, JSON.stringify({ status: kept?.status }));
  check('  → attributed to the scrubbed creator, not to nobody', kept?.creator_name === 'Former creator', kept?.creator_name);

  const anonClient = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: roster, error: rosterError } = await anonClient.rpc('get_coach_roster', {
    p_category: null, p_search: null, p_limit: 100, p_offset: 0,
  });
  check('get_coach_roster still works', !rosterError, rosterError?.message);
  check('  → the unlisted coach is off the roster', !roster?.some((c) => c.id === popularCoach));
  check('  → the other creator\'s coach is still on it', roster?.some((c) => c.id === borrowedCoach));

  const { data: counts } = await admin
    .from('coach_profiles').select('id, subscriber_count').in('id', [POCKET, popularCoach]);
  check('subscriber_count fell by one where she unsubscribed',
        counts.find((c) => c.id === POCKET)?.subscriber_count === pocketBefore - 1,
        JSON.stringify(counts));
  check('  → and is unchanged where the subscriber stayed',
        counts.find((c) => c.id === popularCoach)?.subscriber_count === 1,
        JSON.stringify(counts));
}

// ---------------------------------------------------------------------------
section('Signing in again is a new account, not a resurrection');
// ---------------------------------------------------------------------------
{
  const { data: again, error } = await admin.auth.admin.createUser({
    email: alice.email, password: alice.password, email_confirm: true,
  });
  check('the email can be used again', !error && !!again?.user, error?.message);

  if (again?.user) {
    created.users.push(again.user.id);
    check('  → and it is a different identity', again.user.id !== alice.id);

    const { count } = await admin
      .from('conversations').select('id', { count: 'exact', head: true }).eq('user_id', again.user.id);
    check('  → with no history', count === 0);
  }
}

// ---------------------------------------------------------------------------
section('The old access token is dead');
// ---------------------------------------------------------------------------
{
  const { status } = await callFunction({ path: '/preview', token: alice.token });
  check('a token for a deleted account authenticates nothing', status === 401);
}

} catch (error) {
  fail++;
  console.error('\nprobe threw:', error);
} finally {
  await cleanup();
}

console.log(`\n${pass} passed, ${fail} failed`);
exitCode = fail === 0 ? 0 : 1;
process.exit(exitCode);
