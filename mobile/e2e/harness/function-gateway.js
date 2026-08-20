/**
 * Local stand-in for the Cloud Functions base URL.
 *
 * In production each function is its own Cloud Run service reached at
 * `<base>/<function-name>/<rest>`, and the function sees `req.path = /<rest>`.
 * Mounting each handler under `app.use('/<name>', handler)` reproduces exactly
 * that, so the path routing inside the functions is genuinely exercised.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');

const FUNCTIONS_DIR = path.resolve(__dirname, '../../../functions');
const ENV_FILE = process.env.ENV_FILE || path.join(__dirname, 'local.env');
const localEnv = Object.fromEntries(
  fs
    .readFileSync(ENV_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, '')];
    })
);

const TFVARS = process.env.TFVARS_FILE || path.resolve(__dirname, '../../../_infra/terraform.tfvars');
const tfvars = fs.existsSync(TFVARS) ? fs.readFileSync(TFVARS, 'utf8') : '';
function tfvar(name) {
  const match = tfvars.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm'));
  return match ? match[1] : '';
}

process.env.SUPABASE_URL = localEnv.API_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = localEnv.SERVICE_ROLE_KEY;
process.env.OPENAI_API_KEY = tfvar('openai_api_key');
/*
  Replicate is opt-in, like OpenAI, and for the same reason: it costs money.

  This used to read `replicate_api_key` from terraform.tfvars unconditionally,
  so every local `viz-realtime-probe.mjs` run made real, billed predictions —
  while the probe's own comments said the opposite ("without spending anything
  at Replicate... the runs below fail at the Replicate boundary (no token in the
  harness)"). It also made that suite slow and intermittently red, because the
  assertions then depended on a network round trip to a third party.

  Without USE_REAL_REPLICATE=1 the token is left unset, predictions fail
  immediately at the boundary, and the probe asserts what it always meant to:
  that the model choice and the failure handling are correct. The chosen model
  is written to `coach_visualizations.model` before the call, so nothing about
  that coverage needs a real prediction.
*/
if (process.env.USE_REAL_REPLICATE === '1') {
  process.env.REPLICATE_API_TOKEN = tfvar('replicate_api_key');
  if (!process.env.REPLICATE_API_TOKEN) {
    console.error('USE_REAL_REPLICATE=1 but no replicate_api_key found');
    process.exit(1);
  }
  console.warn('USE_REAL_REPLICATE=1 — predictions will be billed to the real account');
} else {
  delete process.env.REPLICATE_API_TOKEN;
}
process.env.OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o';
// USE_REAL_OPENAI=1 to hit the live API; otherwise the local stand-in.
if (process.env.USE_REAL_OPENAI !== '1') {
  process.env.OPENAI_BASE_URL = process.env.MOCK_OPENAI_URL || 'http://127.0.0.1:8791/v1';
}
process.env.INTERNAL_SERVICE_KEY = 'local-internal-key';
process.env.ALLOWED_ORIGINS = '*';
process.env.PROJECT_ID = 'local-test';
process.env.NUDGE_BATCH_SIZE = '25';
process.env.VISUALIZATION_DAILY_LIMIT = '3';

// Only the real-API path needs a key; the mock does not.
if (process.env.USE_REAL_OPENAI === '1' && !process.env.OPENAI_API_KEY) {
  console.error('USE_REAL_OPENAI=1 but no openai_api_key found');
  process.exit(1);
}
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'mock-key';

const PORT = Number(process.env.PORT || 8790);
const app = express();
// Wide enough for a base64 reference photo (6MB decoded) on its way to the
// visualiser's likeness endpoints.
app.use(express.json({ limit: '12mb' }));

function mount(route, dir, exportName) {
  const mod = require(path.join(FUNCTIONS_DIR, dir, 'index.js'));
  const handler = mod[exportName];
  if (typeof handler !== 'function') throw new Error(`${dir}: missing export ${exportName}`);
  app.use(route, (req, res) => {
    console.log(`→ ${route}${req.path === '/' ? '' : req.path}`);
    handler(req, res).catch?.((error) => {
      console.error(`${route} threw:`, error);
      if (!res.headersSent) res.status(500).json({ error: error.message });
    });
  });
  console.log(`mounted ${route}  (${dir}#${exportName})`);
}

process.env.COACH_RESPONSE_GENERATOR_URL = `http://127.0.0.1:${PORT}/coach-response-generator`;

mount('/coach-response-generator', 'coach-response-generator', 'generateCoachResponse');
mount('/coach-nudges', 'coach-nudges', 'coachNudges');
mount('/coach-visualizer', 'coach-visualizer', 'coachVisualizer');
/*
  Mounted so the app's Settings flow can be driven end to end against a local
  stack. It reaches a real bucket, so deleting an account through the gateway
  needs GCS credentials — `account-deletion-probe.mjs` drives the same handler
  in process against a fake Cloud Storage API instead, and needs none.
*/
mount('/account-deletion', 'account-deletion', 'deleteAccount');

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`\nlocal function gateway on http://127.0.0.1:${PORT}`));
