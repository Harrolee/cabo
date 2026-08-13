/**
 * Clubs (issue #31): seats, comped entitlements, invites and revocation.
 *
 * Creates its own club, coach, creator and members and removes all of them
 * afterwards, including on failure, because the other suites assert on the
 * exact contents of the seeded roster.
 *
 * The load-bearing assertions are the negative ones. A club owner buying access
 * for a squad must not become a way to enumerate who is in that squad, or to
 * read what the club pays.
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

const stamp = Date.now();
const created = { users: [], clubs: [], coaches: [], creators: [] };

async function signIn(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: 'probe-password-123' });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return c;
}

async function makeUser(email) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: 'probe-password-123', email_confirm: true,
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  created.users.push(data.user.id);
  return data.user.id;
}

async function cleanup() {
  for (const id of created.clubs)   await admin.from('clubs').delete().eq('id', id);
  for (const id of created.coaches) await admin.from('coach_profiles').delete().eq('id', id);
  for (const id of created.creators) await admin.from('creator_profiles').delete().eq('id', id);
  for (const id of created.users)   await admin.auth.admin.deleteUser(id).catch(() => {});
}

try {
  // --- fixtures -------------------------------------------------------------
  section('Fixtures: a club, a head coach, an owner');

  const ownerId = await makeUser(`club-owner-${stamp}@example.com`);

  const { data: creator, error: creatorErr } = await admin.from('creator_profiles').insert({
    user_id: ownerId, user_email: `club-owner-${stamp}@example.com`,
    display_name: 'Northside Athletic', slug: `northside-${stamp}`, status: 'approved',
  }).select('id').single();
  check('creator row for the club', !creatorErr && !!creator, creatorErr?.message);
  created.creators.push(creator.id);

  const { data: coach, error: coachErr } = await admin.from('coach_profiles').insert({
    name: 'Coach Ada', creator_id: creator.id, discipline: 'Middle-distance running',
    primary_response_style: 'wise_mentor',
    active: true, listing_status: 'listed', public: false,
    user_email: `club-owner-${stamp}@example.com`,
  }).select('id').single();
  check('club coach', !coachErr && !!coach, coachErr?.message);
  created.coaches.push(coach.id);

  const { data: club, error: clubErr } = await admin.from('clubs').insert({
    slug: `northside-ac-${stamp}`, name: 'Northside AC', creator_id: creator.id,
    seats: 12, plan: 'pilot', billing_email: `billing-${stamp}@example.com`,
  }).select('id').single();
  check('club created', !clubErr && !!club, clubErr?.message);
  created.clubs.push(club.id);

  await admin.from('club_coaches').insert({ club_id: club.id, coach_id: coach.id });
  await admin.from('club_members').insert({
    club_id: club.id, user_id: ownerId, invited_email: `club-owner-${stamp}@example.com`,
    role: 'owner', status: 'active', joined_at: new Date().toISOString(),
  });
  check('coach attached and owner seated', true);

  // --- ten members in one action -------------------------------------------
  section('Ten members added and granted access in one action');

  const memberEmails = [];
  const uidByEmail = new Map();
  for (let i = 0; i < 6; i++) {
    const e = `club-member-${i}-${stamp}@example.com`;
    uidByEmail.set(e, await makeUser(e));
    memberEmails.push(e);
  }
  // Four who have not signed up yet — the invite path.
  const inviteEmails = [];
  for (let i = 6; i < 10; i++) inviteEmails.push(`club-invitee-${i}-${stamp}@example.com`);

  const { data: addResult, error: addErr } = await admin.rpc('club_add_members', {
    p_club_id: club.id, p_emails: [...memberEmails, ...inviteEmails],
  });
  const r = Array.isArray(addResult) ? addResult[0] : addResult;
  check('club_add_members in one call', !addErr, addErr?.message);
  check('  → 6 existing accounts granted', r?.granted === 6, JSON.stringify(r));
  check('  → 4 invited pending signup', r?.invited === 4, JSON.stringify(r));

  let allAccess = true;
  for (const e of memberEmails) {
    const { data: ok } = await admin.rpc('has_coach_access',
      { p_user_id: uidByEmail.get(e), p_coach_id: coach.id });
    if (!ok) allAccess = false;
  }
  check('every granted member passes has_coach_access()', allAccess);

  const { data: seatRows } = await admin.from('coach_subscriptions')
    .select('user_id, source, status, club_id').eq('club_id', club.id);
  check('  → seats are coach_subscriptions rows, not a parallel mechanism',
        seatRows?.length === 6 && seatRows.every(s => s.source === 'creator_comp' && s.status === 'active'),
        JSON.stringify(seatRows?.length));

  // --- invite claim ---------------------------------------------------------
  section('An invited member signs up');
  const inviteeId = await makeUser(inviteEmails[0]);
  const { data: inviteeAccess } = await admin.rpc('has_coach_access', {
    p_user_id: inviteeId, p_coach_id: coach.id,
  });
  check('signing up claims the invite and grants the seat', inviteeAccess === true);

  const { data: claimed } = await admin.from('club_members')
    .select('status, user_id').eq('club_id', club.id).eq('invited_email', inviteEmails[0]).single();
  check('  → membership row linked and activated',
        claimed?.status === 'active' && claimed?.user_id === inviteeId, JSON.stringify(claimed));

  // --- revocation -----------------------------------------------------------
  section('Removing a member revokes access immediately');
  const victimEmail = memberEmails[0];
  const { data: victimRow } = await admin.from('club_members')
    .select('id, user_id').eq('club_id', club.id).eq('invited_email', victimEmail).single();

  const { data: beforeRevoke } = await admin.rpc('has_coach_access', {
    p_user_id: victimRow.user_id, p_coach_id: coach.id,
  });
  check('member has access before removal', beforeRevoke === true);

  await admin.from('club_members').update({ status: 'removed' }).eq('id', victimRow.id);

  const { data: afterRevoke } = await admin.rpc('has_coach_access', {
    p_user_id: victimRow.user_id, p_coach_id: coach.id,
  });
  check('has_coach_access() is false the moment they are removed', afterRevoke === false,
        `got ${afterRevoke}`);

  const { data: revokedRow } = await admin.from('coach_subscriptions')
    .select('status').eq('user_id', victimRow.user_id).eq('coach_id', coach.id).single();
  check('  → the entitlement row is revoked, not deleted', revokedRow?.status === 'revoked',
        JSON.stringify(revokedRow));

  // Deleting the membership row outright must revoke too.
  const { data: victim2 } = await admin.from('club_members')
    .select('id, user_id').eq('club_id', club.id).eq('invited_email', memberEmails[1]).single();
  await admin.from('club_members').delete().eq('id', victim2.id);
  const { data: afterDelete } = await admin.rpc('has_coach_access', {
    p_user_id: victim2.user_id, p_coach_id: coach.id,
  });
  check('deleting the membership row revokes too (no back door)', afterDelete === false,
        `got ${afterDelete}`);

  // --- a paid subscription must survive ------------------------------------
  section('A club seat must not clobber a subscription the member paid for');
  const payerEmail = memberEmails[2];
  const { data: payerRow } = await admin.from('club_members')
    .select('user_id').eq('club_id', club.id).eq('invited_email', payerEmail).single();
  await admin.from('coach_subscriptions').update({
    source: 'apple_iap', status: 'active', original_transaction_id: 'txn-probe-1', club_id: null,
  }).eq('user_id', payerRow.user_id).eq('coach_id', coach.id);

  await admin.rpc('club_add_members', { p_club_id: club.id, p_emails: [payerEmail] });
  const { data: paidAfter } = await admin.from('coach_subscriptions')
    .select('source, club_id').eq('user_id', payerRow.user_id).eq('coach_id', coach.id).single();
  check('re-granting leaves the paid row alone', paidAfter?.source === 'apple_iap',
        JSON.stringify(paidAfter));
  check('  → and does not mark it club-granted (so revocation cannot cancel it)',
        paidAfter?.club_id === null, JSON.stringify(paidAfter));

  // --- what a member may and may not see ------------------------------------
  section('A member may not enumerate the squad');
  const memberClient = await signIn(memberEmails[3]);
  const { data: memberRow } = await admin.from('club_members')
    .select('user_id').eq('club_id', club.id).eq('invited_email', memberEmails[3]).single();

  const { data: visibleMembers } = await memberClient.from('club_members').select('id, user_id');
  check('member sees only their own membership row',
        visibleMembers?.length === 1 && visibleMembers[0].user_id === memberRow.user_id,
        `saw ${visibleMembers?.length} rows`);

  const { data: visibleClub } = await memberClient.from('clubs').select('id, name, slug');
  check('member may see the club they belong to', visibleClub?.length === 1, JSON.stringify(visibleClub));

  for (const col of ['seats', 'plan', 'billing_email', 'external_billing_ref']) {
    const { error } = await memberClient.from('clubs').select(col).limit(1);
    check(`member may NOT read clubs.${col}`, !!error, error ? '' : 'column was readable!');
  }

  const { data: memberBilling } = await memberClient.rpc('club_billing', { p_club_id: club.id });
  check('club_billing() returns nothing to a member', (memberBilling?.length ?? 0) === 0,
        JSON.stringify(memberBilling));

  const { data: memberRoster } = await memberClient.rpc('club_roster', { p_club_id: club.id });
  check('club_roster() returns nothing to a member', (memberRoster?.length ?? 0) === 0,
        JSON.stringify(memberRoster));

  // --- what the owner may see -----------------------------------------------
  section('The owner may see their own club, and only their own');
  const ownerClient = await signIn(`club-owner-${stamp}@example.com`);

  const { data: ownerRoster } = await ownerClient.rpc('club_roster', { p_club_id: club.id });
  check('owner reads the roster', (ownerRoster?.length ?? 0) >= 8, `got ${ownerRoster?.length}`);
  check('  → roster carries no conversation content',
        ownerRoster?.every(m => !('content' in m) && !('goal' in m)), JSON.stringify(Object.keys(ownerRoster?.[0] ?? {})));

  const { data: ownerBilling } = await ownerClient.rpc('club_billing', { p_club_id: club.id });
  check('owner reads billing', ownerBilling?.[0]?.plan === 'pilot', JSON.stringify(ownerBilling));

  // A second club, to prove cross-club isolation.
  const { data: club2 } = await admin.from('clubs').insert({
    slug: `southside-${stamp}`, name: 'Southside AC', seats: 5, plan: 'pilot',
    billing_email: `other-${stamp}@example.com`,
  }).select('id').single();
  created.clubs.push(club2.id);

  const { data: crossRoster } = await ownerClient.rpc('club_roster', { p_club_id: club2.id });
  check('owner of club A cannot read club B roster', (crossRoster?.length ?? 0) === 0,
        JSON.stringify(crossRoster));
  const { data: crossBilling } = await ownerClient.rpc('club_billing', { p_club_id: club2.id });
  check('owner of club A cannot read club B billing', (crossBilling?.length ?? 0) === 0,
        JSON.stringify(crossBilling));
  const { data: crossClub } = await ownerClient.from('clubs').select('id').eq('id', club2.id);
  check('owner of club A cannot even see club B', (crossClub?.length ?? 0) === 0,
        JSON.stringify(crossClub));

  // --- club lapses ----------------------------------------------------------
  section('A club that lapses revokes every seat');
  const { data: stillActive } = await admin.from('coach_subscriptions')
    .select('user_id').eq('club_id', club.id).eq('status', 'active');
  check('seats active before the lapse', (stillActive?.length ?? 0) > 0, `${stillActive?.length}`);

  await admin.from('clubs').update({ status: 'lapsed' }).eq('id', club.id);

  const { data: afterLapse } = await admin.from('coach_subscriptions')
    .select('user_id').eq('club_id', club.id).eq('status', 'active');
  check('no club-granted seat survives the lapse', (afterLapse?.length ?? 0) === 0,
        `${afterLapse?.length} still active`);

  const { data: lapsedAccess } = await admin.rpc('has_coach_access', {
    p_user_id: memberRow.user_id, p_coach_id: coach.id,
  });
  check('  → and has_coach_access() agrees', lapsedAccess === false, `got ${lapsedAccess}`);

  // --- anon ------------------------------------------------------------------
  section('Grant matrix — clubs are invisible to anon');
  for (const t of ['clubs', 'club_members', 'club_coaches']) {
    const { data, error } = await anon.from(t).select('*').limit(1);
    check(`anon may NOT read ${t}`, !!error || (data?.length ?? 0) === 0,
          error ? '' : `returned ${data?.length} rows`);
  }
  for (const [fn, args] of [
    ['club_add_members', { p_club_id: club.id, p_emails: ['x@example.com'] }],
    ['club_roster',      { p_club_id: club.id }],
    ['club_billing',     { p_club_id: club.id }],
    ['grant_club_seat',  { p_club_id: club.id, p_user_id: ownerId, p_coach_id: coach.id }],
    ['revoke_club_seats',{ p_club_id: club.id, p_user_id: ownerId }],
    ['is_club_owner',    { p_club_id: club.id }],
  ]) {
    const { error } = await anon.rpc(fn, args);
    check(`anon may NOT call ${fn}()`, error?.code === '42501', error ? `got ${error.code}` : 'call succeeded!');
  }

  // A signed-in member must not be able to mint themselves a seat.
  for (const [fn, args] of [
    ['grant_club_seat',   { p_club_id: club.id, p_user_id: memberRow.user_id, p_coach_id: coach.id }],
    ['club_add_members',  { p_club_id: club.id, p_emails: ['x@example.com'] }],
    ['revoke_club_seats', { p_club_id: club.id, p_user_id: ownerId }],
  ]) {
    const { error } = await memberClient.rpc(fn, args);
    check(`a member may NOT call ${fn}()`, error?.code === '42501',
          error ? `got ${error.code}` : 'call succeeded!');
  }
} catch (err) {
  check(`probe threw: ${err.message}`, false);
} finally {
  await cleanup();
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
