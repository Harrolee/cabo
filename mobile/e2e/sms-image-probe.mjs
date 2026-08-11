/**
 * The daily SMS image job, end to end, for members in three different
 * disciplines.
 *
 * The question this answers is the one from issue #13: can a non-fitness SMS
 * subscriber still receive a fitness before/after pair? It drives the real
 * `functions/motivational-images` pipeline against the real database, with
 * fakes only at the three boundaries that cost money or need credentials
 * (Replicate, Twilio, GCS). The scene brief goes to the same mock model the
 * other probes use.
 *
 *   node e2e/sms-image-probe.mjs        (from mobile/, with ENV_FILE set)
 *
 * Needs the local Supabase stack, the example roster seed, and
 * `node harness/mock-openai.js`. It does NOT need Twilio or Replicate
 * credentials.
 */
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const require = createRequire(import.meta.url);

const env = Object.fromEntries(
  fs.readFileSync(process.env.ENV_FILE, 'utf8').split('\n').filter(Boolean).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')];
  })
);

const MOCK_MODEL = process.env.MOCK_OPENAI_URL || 'http://127.0.0.1:8791/v1/chat/completions';

// The function reads these at require time.
process.env.PROJECT_ID = 'local-test';
process.env.CONVERSATION_BUCKET_NAME = 'conversations';
process.env.TWILIO_PHONE_NUMBER = '+15550001111';
process.env.OPENAI_CHAT_MODEL = 'mock';

const FN = path.join(repoRoot, 'functions/motivational-images');
const { fetchActiveUsers, processUser, pickKind } = require(path.join(FN, 'user-management.js'));
const sharedViz = fs.readFileSync(path.join(repoRoot, 'functions/shared/visualization.js'), 'utf8');
const copiedViz = fs.readFileSync(path.join(FN, 'visualization.js'), 'utf8');

const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? (pass++, console.log(`  ok    ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`)); };
const section = (t) => console.log(`\n### ${t}`);

const POCKET = 'a1000000-0000-4000-8000-000000000001';   // drums
const MARISOL = 'a1000000-0000-4000-8000-000000000003';  // yoga

// Anything that would betray the old fitness scenario table leaking back in.
const GYM = /\b(gym|squat|treadmill|barbell|dumbbell|bench press|beach body|six[- ]pack|abs|weight loss|workout)\b/i;
const SHAME = /\b(weak|frail|skinny|chubby|overweight|flabby|slimmer|before and after|transformation pair)\b/i;
const PAIR = /\b(before\s*\/\s*after|before and after|split screen|diptych)\b/i;

// ---------------------------------------------------------------------------
// Boundaries we stub: an image host, Replicate, Twilio, GCS.
// ---------------------------------------------------------------------------

// A real HTTP source for the "generated" image, so the bucket-copy step runs
// for real rather than being stubbed out.
const JPEG = Buffer.from('ffd8ffdb0043000101010101010101010101010101010101ffd9', 'hex');
const imageHost = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'image/jpeg' });
  res.end(JPEG);
});
await new Promise((resolve) => imageHost.listen(8793, '127.0.0.1', resolve));

/** Thin shim over the mock model's HTTP contract — no OpenAI SDK required. */
function recordingModel() {
  const briefs = [];
  return {
    briefs,
    chat: {
      completions: {
        create: async (body) => {
          briefs.push(body.messages.find((m) => m.role === 'system')?.content ?? '');
          const res = await fetch(MOCK_MODEL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error(`mock model ${res.status}`);
          return res.json();
        },
      },
    },
  };
}

function recordingReplicate() {
  const runs = [];
  return {
    runs,
    run: async (id, options) => {
      runs.push({ id, input: options.input });
      return ['http://127.0.0.1:8793/generated.jpg'];
    },
  };
}

function recordingTwilio() {
  const sent = [];
  return { sent, messages: { create: async (message) => { sent.push(message); return { sid: `SM${sent.length}` }; } } };
}

function recordingStorage() {
  const saved = [];
  return {
    saved,
    bucket: (bucketName) => ({
      getFiles: async () => [[]],
      file: (objectName) => ({
        save: async (buffer) => { saved.push({ bucketName, objectName, bytes: buffer.length }); },
        exists: async () => [false],
        download: async () => [Buffer.from('[]')],
        getSignedUrl: async () => ['http://127.0.0.1:8793/reference.jpg'],
      }),
    }),
  };
}

function harness() {
  const openai = recordingModel();
  const replicate = recordingReplicate();
  const twilio = recordingTwilio();
  const storage = recordingStorage();
  return { deps: { supabase: admin, openai, replicate, twilio, storage }, openai, replicate, twilio, storage };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const stamp = Date.now().toString().slice(-7);
let seq = 0;
const nextPhone = () => `+1253${stamp}${seq++}`.slice(0, 15);

async function makeMember({ label, coachId = null, coachHandle = null, channel = 'sms', aspiration = null, withAuthUser = true, imagePreference = null }) {
  const email = `sms-${label}-${stamp}@example.com`;
  const phone = nextPhone();

  let userId = null;
  if (withAuthUser) {
    const { data } = await admin.auth.admin.createUser({ email, password: 'sms-probe-password', email_confirm: true });
    userId = data.user.id;
  }

  const profile = {
    email,
    phone_number: phone,
    full_name: label,
    display_name: label,
    active: true,
    notification_channel: channel,
    user_id: userId,
    coach: coachHandle,
    coach_type: coachHandle ? 'predefined' : 'custom',
    custom_coach_id: coachHandle ? null : coachId,
  };
  if (imagePreference) profile.image_preference = imagePreference;

  // Signing someone up already creates a profile row (on_auth_user_created),
  // so take whichever of insert/update applies.
  const { data: existing } = await admin.from('user_profiles').select('id').eq('email', email).maybeSingle();
  const { error } = existing
    ? await admin.from('user_profiles').update(profile).eq('id', existing.id)
    : await admin.from('user_profiles').insert(profile);
  if (error) throw new Error(`${label}: ${error.message}`);

  const { error: subError } = await admin.from('subscriptions').insert({
    user_phone: phone,
    status: 'active',
    trial_start_timestamp: new Date(Date.now() - 30 * 864e5).toISOString(),
    current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
  });
  if (subError) throw new Error(`${label} subscription: ${subError.message}`);

  if (aspiration && userId && coachId) {
    const { error: goalError } = await admin.from('member_goals').insert({
      user_id: userId,
      coach_id: coachId,
      aspiration,
      onboarding_status: 'complete',
    });
    if (goalError) throw new Error(`${label} goals: ${goalError.message}`);
  }

  return { label, email, phone, userId };
}

section('Fixtures');
const drummer = await makeMember({
  label: 'drummer',
  coachId: POCKET,
  aspiration: 'someone who can sit in with any band and hold the pocket all night',
  imagePreference: 'a Black woman in her thirties',
});
const yogi = await makeMember({
  label: 'yogi',
  coachId: MARISOL,
  aspiration: 'a teacher who can hold a steady handstand and a steadier room',
});
// A legacy fitness member: predefined persona, no auth user, no goals on file.
// The five personas are `coach_profiles` rows keyed by handle (inserted by
// 20250531093301); the local stack only has the example roster, so stand one up.
const { error: personaError } = await admin.from('coach_profiles').upsert({
  user_email: 'demo.drummer@example.com',
  name: 'Gym Bro',
  handle: 'gym_bro',
  discipline: 'Strength training',
  category_slug: 'fitness',
  expertise: ['weight lifting', 'crossfit', 'HIIT', 'strength programming'],
  primary_response_style: 'cheerleader',
  active: true,
}, { onConflict: 'handle', ignoreDuplicates: true });
if (personaError) throw new Error(`gym_bro persona: ${personaError.message}`);
const lifter = await makeMember({ label: 'lifter', coachHandle: 'gym_bro', withAuthUser: false });
// Subscribed to a coach that no longer resolves (deactivated by its creator).
const { data: retired, error: retiredError } = await admin.from('coach_profiles').insert({
  user_email: 'demo.drummer@example.com',
  name: `Retired ${stamp}`,
  handle: `retired-${stamp}`,
  discipline: 'Kendo',
  category_slug: 'other',
  primary_response_style: 'wise_mentor',
  active: false,
}).select('id').single();
if (retiredError) throw new Error(`retired coach: ${retiredError.message}`);
const orphan = await makeMember({ label: 'orphan', coachId: retired.id });
// An app member on push must never be picked up by this job.
const appUser = await makeMember({ label: 'appuser', coachId: POCKET, channel: 'push' });
check('fixtures created', true, `${drummer.phone} ${yogi.phone} ${lifter.phone}`);

// ---------------------------------------------------------------------------

section('The job only claims SMS members');
const users = await fetchActiveUsers({ supabase: admin });
const byPhone = new Map(users.map((u) => [u.phone_number, u]));
check('drummer is in scope', byPhone.has(drummer.phone));
check('yogi is in scope', byPhone.has(yogi.phone));
check('legacy fitness member is in scope', byPhone.has(lifter.phone));
check('the push member is NOT in scope', !byPhone.has(appUser.phone));
check('every row selected is on the sms channel',
      users.every((u) => u.notification_channel === 'sms' && u.phone_number),
      users.map((u) => u.notification_channel).join(','));

// ---------------------------------------------------------------------------

section('A drumming member gets drumming');
{
  const h = harness();
  const result = await processUser(byPhone.get(drummer.phone), h.deps);
  check('a scene was sent', result.sent === 'visualization', JSON.stringify(result));
  check('  → kind is "becoming" (they have an aspiration)', result.kind === 'becoming', result.kind);

  const brief = h.openai.briefs[0] ?? '';
  check('brief names the coach discipline', /Drum set/.test(brief));
  check('brief carries their own aspiration', /hold the pocket all night/.test(brief));
  check('brief carries image_preference as "how to depict them"',
        /How they want to be depicted: a Black woman in her thirties/.test(brief));
  check('brief forbids before/after framing', /No collages, no before\/after, no split frames/.test(brief));
  check('brief never mentions the gym', !GYM.test(brief), brief.match(GYM)?.[0]);

  check('exactly one Replicate call', h.replicate.runs.length === 1, String(h.replicate.runs.length));
  const prompt = h.replicate.runs[0]?.input?.prompt ?? '';
  console.log(`      prompt: ${prompt.slice(0, 140)}`);
  check('  → the image is about drums', /drum/i.test(prompt), prompt);
  check('  → no gym imagery', !GYM.test(prompt), prompt.match(GYM)?.[0]);
  check('  → no shame vocabulary', !SHAME.test(prompt), prompt.match(SHAME)?.[0]);
  check('  → not a pair', !PAIR.test(prompt), prompt.match(PAIR)?.[0]);
  check('  → scene-only model without likeness consent',
        h.replicate.runs[0]?.id?.includes('flux'), h.replicate.runs[0]?.id);

  check('exactly one text message', h.twilio.sent.length === 1, String(h.twilio.sent.length));
  const sms = h.twilio.sent[0];
  check('  → exactly one image attached', sms?.mediaUrl?.length === 1, JSON.stringify(sms?.mediaUrl));
  check('  → the caption is the coach\'s', /Pocket/.test(sms?.body ?? ''), sms?.body);
  check('  → the caption is not fitness boilerplate', !GYM.test(sms?.body ?? ''), sms?.body);
  check('the image was copied into our own bucket',
        h.storage.saved.some((s) => s.objectName.startsWith('visualizations/sms/')),
        JSON.stringify(h.storage.saved));

  const { data: rows } = await admin.from('coach_visualizations').select('*').eq('user_id', drummer.userId);
  check('a visualization row was recorded', rows?.length === 1, String(rows?.length));
  check('  → attributed to the drumming coach', rows?.[0]?.coach_id === POCKET, rows?.[0]?.coach_id);
}

section('A yoga member gets yoga — same code, no branch');
{
  const h = harness();
  const result = await processUser(byPhone.get(yogi.phone), h.deps);
  check('a scene was sent', result.sent === 'visualization', JSON.stringify(result));

  const prompt = h.replicate.runs[0]?.input?.prompt ?? '';
  console.log(`      prompt: ${prompt.slice(0, 140)}`);
  check('the image is about yoga', /yoga|breath/i.test(prompt), prompt);
  check('  → nothing about drums leaked across', !/drum/i.test(prompt), prompt);
  check('  → no gym imagery', !GYM.test(prompt), prompt.match(GYM)?.[0]);
  check('  → no shame vocabulary', !SHAME.test(prompt), prompt.match(SHAME)?.[0]);
  check('  → not a pair', !PAIR.test(prompt), prompt.match(PAIR)?.[0]);
  check('one image, one message', h.twilio.sent.length === 1 && h.twilio.sent[0].mediaUrl.length === 1);
}

section('A legacy fitness member still gets fitness');
{
  const h = harness();
  const result = await processUser(byPhone.get(lifter.phone), h.deps);
  check('a scene was sent', result.sent === 'visualization', JSON.stringify(result));
  check('  → kind is "today" (nothing on file to aspire to)', result.kind === 'today', result.kind);

  const brief = h.openai.briefs[0] ?? '';
  check('brief resolves the persona to its discipline', /Strength training/.test(brief));
  check('brief still forbids before/after framing', /No collages, no before\/after, no split frames/.test(brief));
  check('brief still forbids body descriptors',
        /Do not describe body size, weight, attractiveness, or age/.test(brief));

  const prompt = h.replicate.runs[0]?.input?.prompt ?? '';
  check('no shame vocabulary', !SHAME.test(prompt), prompt.match(SHAME)?.[0]);
  check('still a single image', h.twilio.sent.length === 1 && h.twilio.sent[0].mediaUrl.length === 1);
}

section('An unresolvable coach sends nothing at all');
{
  const h = harness();
  const result = await processUser(byPhone.get(orphan.phone), h.deps);
  check('skipped with no_coach', result.skipped === 'no_coach', JSON.stringify(result));
  check('  → no model call', h.openai.briefs.length === 0);
  check('  → no image generated', h.replicate.runs.length === 0);
  check('  → no message sent', h.twilio.sent.length === 0);
}

section('Likeness is used only with consent');
{
  await admin.from('user_profiles')
    .update({ likeness_consent: true, reference_photo_url: 'http://127.0.0.1:8793/reference.jpg' })
    .eq('phone_number', drummer.phone);

  const refreshed = await fetchActiveUsers({ supabase: admin });
  const consenting = refreshed.find((u) => u.phone_number === drummer.phone);
  const h = harness();
  await processUser(consenting, h.deps);

  const run = h.replicate.runs[0];
  check('switches to the likeness model', run?.id?.includes('photomaker'), run?.id);
  check('  → the reference photo is passed', !!run?.input?.input_image, JSON.stringify(run?.input?.input_image));
  const negative = run?.input?.negative_prompt ?? '';
  check('  → negative prompt rules out before/after', /before and after/.test(negative), negative);
  check('  → negative prompt carries no shame framing',
        !/\bweak\b|\bfrail\b|\bsad\b|\bnervous\b|\bskinny\b|\bchubby\b|\boverweight\b/.test(negative), negative);
}

// ---------------------------------------------------------------------------

section('The fitness scenario table is gone for good');
{
  for (const gone of ['scenarios.js', 'prompt-generation.js', 'descriptors.js', 'coach-personas.js']) {
    check(`${gone} deleted`, !fs.existsSync(path.join(FN, gone)));
  }

  const sources = fs.readdirSync(FN).filter((f) => f.endsWith('.js'))
    .map((f) => ({ f, text: fs.readFileSync(path.join(FN, f), 'utf8') }));

  // The prose in these files discusses the old framing on purpose; what must
  // not survive is the prompt fragment itself.
  const offenders = sources.filter(({ text }) => /weak, frail, sad, nervous/.test(text.replace(/^\s*\*.*$/gm, '')));
  check('no "weak, frail, sad, nervous" prompt survives', offenders.length === 0,
        offenders.map((o) => o.f).join(','));

  check('visualization.js is an exact copy of functions/shared/visualization.js', sharedViz === copiedViz);
  check('pickKind is aspiration-driven', pickKind({ aspiration: 'x' }) === 'becoming' && pickKind({}) === 'today');
}

imageHost.close();
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
