/**
 * The authorization matrix on `coach-avatar-generator` (#44).
 *
 * This endpoint is deliberately reachable without a session, because
 * `/coach-builder/*` is the pre-signup funnel and the avatar step happens
 * before anyone has an account. That makes "who may call this, and what does it
 * cost them" the whole security story, so it is asserted here rather than left
 * to review.
 *
 * The real `index.js` is loaded with `./avatar-generation` replaced by a stub
 * that records its calls — the same technique `prompt-eval/crisis-probe.mjs`
 * uses on `openai`. Nothing reaches Replicate, so this spends no credits, and
 * the stub is what lets the important assertion be made at all: that a rejected
 * call never reaches generation. A 403 that still burned a credit would look
 * identical from the outside.
 *
 * Supabase is NOT stubbed. Token verification and the ownership lookup run
 * against the local stack, so what is proved here is the real check and not a
 * fake that agrees with itself.
 *
 *   cd mobile && ENV_FILE=/path/to/local.env node e2e/avatar-auth-probe.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const FN = path.join(REPO, 'functions/coach-avatar-generator');

const env = Object.fromEntries(
  fs.readFileSync(process.env.ENV_FILE, 'utf8').split('\n').filter(Boolean).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')];
  })
);

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? (pass++, console.log(`  ok    ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`)); };
const section = (t) => console.log(`\n### ${t}`);

const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// --- fixtures ---------------------------------------------------------------

const stamp = Date.now();
const mk = async (tag) => {
  const email = `avatar-${tag}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'avatar-password-123', email_confirm: true });
  if (error) throw new Error(`createUser(${tag}): ${error.message}`);
  const client = createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: 'avatar-password-123' });
  if (signInError) throw new Error(`signIn(${tag}): ${signInError.message}`);
  const token = (await client.auth.getSession()).data.session.access_token;
  return { id: data.user.id, email, token };
};

const owner = await mk('owner');
const stranger = await mk('stranger');

const { data: coachRow, error: coachError } = await admin.from('coach_profiles').insert({
  user_id: owner.id,
  user_email: owner.email,
  name: 'Probe Coach',
  handle: `probe-coach-${stamp}`,
  primary_response_style: 'wise_mentor',
}).select('id').single();
if (coachError) throw new Error(`coach insert: ${coachError.message}`);
const COACH_ID = coachRow.id;

// --- load the function with generation stubbed ------------------------------

// Read at module scope by index.js, so they must be set before the require.
process.env.SUPABASE_URL = env.API_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SERVICE_ROLE_KEY;
process.env.ALLOWED_ORIGINS = 'https://cabo.fit,https://www.cabo.fit';
process.env.UNAUTH_RATE_LIMIT = '3';
process.env.UNAUTH_WINDOW_MS = '3600000';

const generation = { calls: [] };
const avatarGenerationStub = {
  AVATAR_STYLES: ['Realistic', 'Digital Art'],
  generateCoachAvatars: async (coachId, buffer, mime, options) => {
    generation.calls.push({ coachId, bytes: buffer?.length ?? 0, mime, options });
    return { avatars: [{ style: options?.style || 'Realistic', url: 'https://example.test/a.png' }], selfieUrl: 's/1', failedStyles: [] };
  },
};

/*
  `functions/coach-avatar-generator/` has no node_modules of its own, and this
  probe deliberately does not require one to be installed. Its two remaining
  imports are resolved here instead:

    @supabase/supabase-js — the REAL client, resolved from `mobile/`. Token
      verification and the ownership lookup have to be genuine or this proves
      nothing.
    multer — a stub. Only the JSON body path is exercised, but `multer()` runs
      at module scope, so something has to answer.
*/
const multerStub = Object.assign(
  () => ({ single: () => (req, res, cb) => cb(new Error('multipart is not exercised by this probe')) }),
  { memoryStorage: () => ({}) }
);

const originalLoad = Module._load;
Module._load = function patched(request, ...rest) {
  if (request === './avatar-generation') return avatarGenerationStub;
  if (request === '@supabase/supabase-js') return { createClient };
  if (request === 'multer') return multerStub;
  return originalLoad.call(this, request, ...rest);
};
let handler;
try {
  ({ generateCoachAvatar: handler } = require(path.join(FN, 'index.js')));
} finally {
  Module._load = originalLoad;
}

// --- driver -----------------------------------------------------------------

const SELFIE = `data:image/jpeg;base64,${Buffer.from('not-really-a-jpeg').toString('base64')}`;

const call = async ({ token, body, method = 'POST', origin, contentType = 'application/json' }) => {
  const headers = { 'content-type': contentType };
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;

  const captured = { headers: {} };
  const res = {
    set(k, v) { if (typeof k === 'object') Object.assign(captured.headers, k); else captured.headers[k.toLowerCase()] = v; return res; },
    status(code) { captured.status = code; return res; },
    json(payload) { captured.body = payload; return res; },
    send(payload) { captured.body = payload; return res; },
  };
  await handler({ method, body, ip: '203.0.113.9', get: (h) => headers[h.toLowerCase()], headers }, res);
  return captured;
};

const generationCount = () => generation.calls.length;

// --- the matrix -------------------------------------------------------------

section('Preflight and method');
{
  const pre = await call({ method: 'OPTIONS', origin: 'https://cabo.fit' });
  check('OPTIONS is a 204 preflight', pre.status === 204, String(pre.status));
  const get = await call({ method: 'GET' });
  check('GET is rejected', get.status === 405, String(get.status));
}

section('An anonymous caller may not touch a real coach');
{
  const before = generationCount();
  const r = await call({ body: { coachId: COACH_ID, selfie_base64: SELFIE, style: 'Realistic' } });
  check('403 for a real coach id without a token', r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);
  check('  → nothing was generated', generationCount() === before, `${generationCount() - before} call(s)`);
}

section('A garbage token is not a token');
{
  const before = generationCount();
  const r = await call({ token: 'not-a-real-jwt', body: { coachId: COACH_ID, selfie_base64: SELFIE, style: 'Realistic' } });
  check('an unverifiable bearer falls back to anonymous, so 403', r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);
  check('  → nothing was generated', generationCount() === before);
}

section('Anonymous callers pay for one style at a time');
{
  const before = generationCount();
  const noStyle = await call({ body: { coachId: `temp-${stamp}`, selfie_base64: SELFIE } });
  check('400 when style is omitted', noStyle.status === 400, `${noStyle.status} ${JSON.stringify(noStyle.body)}`);
  check('  → nothing was generated, so the fan-out never happens', generationCount() === before);

  const ok = await call({ body: { coachId: `temp-${stamp}`, selfie_base64: SELFIE, style: 'Realistic' } });
  check('the pre-signup builder path still works', ok.status === 200, `${ok.status} ${JSON.stringify(ok.body)}`);
  check('  → exactly one generation', generationCount() === before + 1, `${generationCount() - before}`);
  check('  → and it was for the single style asked for', generation.calls.at(-1)?.options?.style === 'Realistic');
}

section('The anonymous ceiling is a ceiling');
{
  // UNAUTH_RATE_LIMIT is 3 for this run and one has already been spent above.
  const body = { coachId: `temp-${stamp}`, selfie_base64: SELFIE, style: 'Realistic' };
  const second = await call({ body });
  const third = await call({ body });
  check('the second and third calls are allowed', second.status === 200 && third.status === 200,
        `${second.status}/${third.status}`);

  const before = generationCount();
  const fourth = await call({ body });
  check('the fourth is a 429', fourth.status === 429, `${fourth.status} ${JSON.stringify(fourth.body)}`);
  check('  → it carries Retry-After', Boolean(fourth.headers['retry-after']), JSON.stringify(fourth.headers));
  check('  → and it cost nothing', generationCount() === before);
}

section('A signed-in caller may only touch their own coach');
{
  const before = generationCount();
  const notMine = await call({ token: stranger.token, body: { coachId: COACH_ID, selfie_base64: SELFIE, style: 'Realistic' } });
  check('403 for a coach the caller does not own', notMine.status === 403, `${notMine.status} ${JSON.stringify(notMine.body)}`);
  check('  → nothing was generated', generationCount() === before);

  const mine = await call({ token: owner.token, body: { coachId: COACH_ID, selfie_base64: SELFIE, style: 'Realistic' } });
  check('the owner is allowed', mine.status === 200, `${mine.status} ${JSON.stringify(mine.body)}`);
  check('  → generated against their own coach', generation.calls.at(-1)?.coachId === COACH_ID);
}

section('Being signed in is not the same as being rate-limited');
{
  // The anonymous bucket for this IP is already spent; an owner must still pass.
  const r = await call({ token: owner.token, body: { coachId: COACH_ID, selfie_base64: SELFIE } });
  check('an owner may still fan out to every style', r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  check('  → the anonymous ceiling does not apply to them', r.status !== 429);
}

section('CORS names the origins instead of every origin');
{
  const allowed = await call({ method: 'OPTIONS', origin: 'https://cabo.fit' });
  check('an allowed origin is echoed back', allowed.headers['access-control-allow-origin'] === 'https://cabo.fit',
        JSON.stringify(allowed.headers['access-control-allow-origin']));
  const evil = await call({ method: 'OPTIONS', origin: 'https://evil.example' });
  check('an unknown origin is not', evil.headers['access-control-allow-origin'] === undefined,
        JSON.stringify(evil.headers['access-control-allow-origin']));
  check('  → and it is never the wildcard', evil.headers['access-control-allow-origin'] !== '*');
}

section('Cleanup');
{
  await admin.from('coach_profiles').delete().eq('id', COACH_ID);
  for (const u of [owner, stranger]) await admin.auth.admin.deleteUser(u.id);
  const { data } = await admin.from('coach_profiles').select('id').eq('id', COACH_ID);
  check('probe rows removed', (data ?? []).length === 0);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
