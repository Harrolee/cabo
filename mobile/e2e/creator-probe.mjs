/**
 * The creator onboarding and publishing path, end to end, through PostgREST as
 * a real authenticated user — so RLS, protect_creator_platform_fields() and
 * enforce_coach_listing_rules() are all genuinely in play.
 *
 * The shape of the run mirrors the acceptance criteria on the issue:
 *   a brand-new account creates a creator profile, builds a coach, and fails
 *   to list it; the platform approves them; the coach then lists and shows up
 *   in get_coach_roster(). Nothing the creator submits moves status or
 *   revenue_share_bps.
 *
 * Approval is done on the service-role client, which is exactly what the
 * admin-api Cloud Function does behind requireAdmin() — the trigger stands
 * aside only when auth.uid() is null.
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

const stamp = Date.now().toString(36);
const PASSWORD = 'creator-probe-123';

async function makeUser(prefix) {
  const email = `${prefix}${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);
  return { email, id: data.user.id, client };
}

const creatorUser = await makeUser('creator');
const otherUser = await makeUser('other');

// ---------------------------------------------------------------------------
section('A brand-new account creates a creator profile');
// ---------------------------------------------------------------------------

let creator;
{
  // The handle format is enforced in the database as well as in the form.
  const { error: badSlug } = await creatorUser.client.from('creator_profiles').insert({
    user_id: creatorUser.id, user_email: creatorUser.email,
    display_name: 'Bad Slug', slug: 'Not A Slug',
  });
  check('malformed handle rejected', badSlug?.code === '23514',
        `${badSlug?.code} ${badSlug?.message}`);
  check('  → names the slug constraint, so the UI can explain it',
        /creator_slug_format/.test(badSlug?.message || ''), badSlug?.message);

  const slug = `probe-drummer-${stamp}`;

  const { data: freeBefore } = await creatorUser.client.rpc('creator_slug_available', { p_slug: slug });
  check('creator_slug_available: free handle', freeBefore === true, String(freeBefore));

  // Everything platform-owned is sent deliberately here: none of it may stick.
  const { data, error } = await creatorUser.client.from('creator_profiles').insert({
    user_id: creatorUser.id,
    user_email: creatorUser.email,
    display_name: 'Probe Drummer',
    slug,
    bio: 'Fifteen years behind a kit.',
    website_url: 'https://example.com',
    social_links: { instagram: '@probedrummer' },
    status: 'approved',
    revenue_share_bps: 10000,
    payout_provider: 'manual',
    payout_account_id: 'acct_attacker',
  }).select().single();

  check('creator profile created', !error && !!data, error?.message);
  creator = data;
  check('  → status is pending, not what the client asked for', data?.status === 'pending', data?.status);
  check('  → revenue_share_bps is the platform default', data?.revenue_share_bps === 7000, String(data?.revenue_share_bps));
  check('  → payout columns ignored', data?.payout_provider === null && data?.payout_account_id === null,
        `${data?.payout_provider} / ${data?.payout_account_id}`);
  check('  → user_email taken from the session', data?.user_email === creatorUser.email, data?.user_email);

  const { data: freeAfter } = await otherUser.client.rpc('creator_slug_available', { p_slug: slug });
  check('creator_slug_available: taken handle, even though RLS hides the row',
        freeAfter === false, String(freeAfter));

  const { error: dupe } = await creatorUser.client.from('creator_profiles').insert({
    user_id: creatorUser.id, user_email: creatorUser.email,
    display_name: 'Second Profile', slug: `probe-second-${stamp}`,
  });
  check('one creator profile per account', dupe?.code === '23505', `${dupe?.code} ${dupe?.message}`);
}

// ---------------------------------------------------------------------------
section('Pending creator builds a coach');
// ---------------------------------------------------------------------------

let coach;
{
  const { data, error } = await creatorUser.client.from('coach_profiles').insert({
    user_id: creatorUser.id,
    user_email: creatorUser.email,
    creator_id: creator.id,
    name: 'Pocket Probe',
    handle: `pocket-probe-${stamp}`,
    description: 'Groove and timekeeping.',
    discipline: 'Drum kit',
    category_slug: 'music',
    tagline: 'Find the pocket.',
    expertise: ['groove', 'timekeeping'],
    starter_prompts: ['My fills always rush.'],
    primary_response_style: 'wise_mentor',
  }).select().single();

  check('coach created with creator_id attached', !error && data?.creator_id === creator.id, error?.message);
  coach = data;
  check('  → starts as a draft', data?.listing_status === 'draft', data?.listing_status);

  // The creator may build and preview: reading and editing their own draft works.
  const { error: editErr } = await creatorUser.client.from('coach_profiles')
    .update({ tagline: 'Find the pocket, keep the pocket.' }).eq('id', coach.id);
  check('pending creator can still edit their draft', !editErr, editErr?.message);
}

// ---------------------------------------------------------------------------
section('A coach cannot be credited to someone else’s creator profile');
// ---------------------------------------------------------------------------
{
  const { data: victim } = await admin.from('creator_profiles').insert({
    user_id: otherUser.id, user_email: otherUser.email,
    display_name: 'Approved Stranger', slug: `probe-stranger-${stamp}`, status: 'approved',
  }).select().single();

  const { error } = await creatorUser.client.from('coach_profiles')
    .update({ creator_id: victim.id }).eq('id', coach.id);
  check('borrowing an approved creator_id is refused', error?.code === '42501',
        `${error?.code} ${error?.message}`);

  const { data: stillMine } = await creatorUser.client
    .from('coach_profiles').select('creator_id').eq('id', coach.id).single();
  check('  → attribution unchanged', stillMine?.creator_id === creator.id, stillMine?.creator_id);
}

// ---------------------------------------------------------------------------
section('Publishing fails while the creator is under review');
// ---------------------------------------------------------------------------
{
  // Step one of the publish control: submitting for review always works.
  const { error: reviewErr } = await creatorUser.client.from('coach_profiles')
    .update({ listing_status: 'in_review' }).eq('id', coach.id);
  check('draft → in_review is allowed', !reviewErr, reviewErr?.message);

  // Step two is not.
  const { error } = await creatorUser.client.from('coach_profiles')
    .update({ listing_status: 'listed', public: true }).eq('id', coach.id);
  check('in_review → listed is refused', !!error, 'no error raised');
  check('  → as insufficient_privilege, which the web app renders as ' +
        '“your creator account is still under review”',
        error?.code === '42501', `${error?.code} ${error?.message}`);

  const { data: after } = await creatorUser.client
    .from('coach_profiles').select('listing_status').eq('id', coach.id).single();
  check('  → the coach stays queued at in_review', after?.listing_status === 'in_review', after?.listing_status);

  const { data: roster } = await anon.rpc('get_coach_roster', {
    p_category: null, p_search: null, p_limit: 100, p_offset: 0,
  });
  check('  → and is absent from get_coach_roster()',
        !(roster || []).some((c) => c.id === coach.id), 'found on the roster');
}

// ---------------------------------------------------------------------------
section('The creator cannot approve themselves');
// ---------------------------------------------------------------------------
{
  const { error } = await creatorUser.client.from('creator_profiles')
    .update({ status: 'approved', revenue_share_bps: 10000, payout_account_id: 'acct_attacker' })
    .eq('id', creator.id);
  check('self-approval write is accepted but neutered', !error, error?.message);

  const { data } = await creatorUser.client
    .from('creator_profiles').select('status, revenue_share_bps, payout_account_id')
    .eq('id', creator.id).single();
  check('  → status still pending', data?.status === 'pending', data?.status);
  check('  → revenue_share_bps still 7000', data?.revenue_share_bps === 7000, String(data?.revenue_share_bps));
  check('  → payout account still empty', data?.payout_account_id === null, data?.payout_account_id);

  // Profile edits the creator does own still land.
  const { error: bioErr } = await creatorUser.client.from('creator_profiles')
    .update({ bio: 'Fifteen years behind a kit, five of them teaching.' }).eq('id', creator.id);
  check('  → but their own fields still save', !bioErr, bioErr?.message);
}

// ---------------------------------------------------------------------------
section('An admin approves them (service role, as admin-api does)');
// ---------------------------------------------------------------------------
{
  const { data, error } = await admin.from('creator_profiles')
    .update({ status: 'approved' }).eq('id', creator.id).select().single();
  check('approval lands on the service role', !error && data?.status === 'approved',
        error?.message || data?.status);
  creator = data;

  // admin-api promotes whatever the creator already submitted for review.
  const { data: promoted, error: promoteErr } = await admin.from('coach_profiles')
    .update({ listing_status: 'listed', public: true })
    .eq('creator_id', creator.id).eq('listing_status', 'in_review')
    .select('id, listing_status');
  check('queued coaches are published with the approval',
        !promoteErr && promoted?.length === 1 && promoted[0].id === coach.id,
        promoteErr?.message || JSON.stringify(promoted));

  const { data: roster } = await anon.rpc('get_coach_roster', {
    p_category: null, p_search: null, p_limit: 100, p_offset: 0,
  });
  const listed = (roster || []).find((c) => c.id === coach.id);
  check('the coach appears in get_coach_roster()', !!listed, 'not on the roster');
  check('  → credited to the creator', listed?.creator_name === 'Probe Drummer', listed?.creator_name);
  check('  → with their handle', listed?.creator_slug === creator.slug, listed?.creator_slug);
  check('  → and its own domain fields', listed?.discipline === 'Drum kit' && listed?.category_slug === 'music',
        `${listed?.discipline} / ${listed?.category_slug}`);
}

// ---------------------------------------------------------------------------
section('An approved creator can now publish from the app');
// ---------------------------------------------------------------------------
let secondCoach;
{
  const { data } = await creatorUser.client.from('coach_profiles').insert({
    user_id: creatorUser.id, user_email: creatorUser.email, creator_id: creator.id,
    name: 'Second Probe', handle: `second-probe-${stamp}`,
    discipline: 'Snare rudiments', category_slug: 'music',
    primary_response_style: 'cheerleader',
  }).select().single();
  secondCoach = data;

  const { error: reviewErr } = await creatorUser.client.from('coach_profiles')
    .update({ listing_status: 'in_review' }).eq('id', secondCoach.id);
  check('draft → in_review', !reviewErr, reviewErr?.message);

  const { error: listErr } = await creatorUser.client.from('coach_profiles')
    .update({ listing_status: 'listed', public: true }).eq('id', secondCoach.id);
  check('in_review → listed now succeeds as the creator themselves', !listErr, listErr?.message);

  const { data: roster } = await anon.rpc('get_coach_roster', {
    p_category: null, p_search: null, p_limit: 100, p_offset: 0,
  });
  check('  → and it reaches the roster', (roster || []).some((c) => c.id === secondCoach.id), 'not on the roster');

  // Unlisting is the creator's own to do.
  const { error: unlistErr } = await creatorUser.client.from('coach_profiles')
    .update({ listing_status: 'unlisted', public: false }).eq('id', secondCoach.id);
  check('the creator can take it back off the roster', !unlistErr, unlistErr?.message);
}

// ---------------------------------------------------------------------------
section('Suspension pulls the listings');
// ---------------------------------------------------------------------------
{
  await admin.from('creator_profiles').update({ status: 'suspended' }).eq('id', creator.id);
  const { data: pulled } = await admin.from('coach_profiles')
    .update({ listing_status: 'unlisted', public: false })
    .eq('creator_id', creator.id).eq('listing_status', 'listed')
    .select('id');
  check('listed coaches are unlisted with the suspension', pulled?.length === 1, JSON.stringify(pulled));

  const { data: roster } = await anon.rpc('get_coach_roster', {
    p_category: null, p_search: null, p_limit: 100, p_offset: 0,
  });
  check('  → nothing of theirs is left on the roster',
        !(roster || []).some((c) => c.id === coach.id || c.id === secondCoach.id), 'still listed');

  const { error } = await creatorUser.client.from('coach_profiles')
    .update({ listing_status: 'listed' }).eq('id', coach.id);
  check('  → and a suspended creator cannot re-list', error?.code === '42501',
        `${error?.code} ${error?.message}`);
}

// ---------------------------------------------------------------------------
section('Cleanup');
// ---------------------------------------------------------------------------
{
  await admin.from('coach_profiles').delete().in('id', [coach.id, secondCoach.id]);
  await admin.from('creator_profiles').delete().in('user_id', [creatorUser.id, otherUser.id]);
  await admin.auth.admin.deleteUser(creatorUser.id);
  await admin.auth.admin.deleteUser(otherUser.id);
  check('probe rows removed', true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
