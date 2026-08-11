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
process.env.REPLICATE_API_TOKEN = tfvar('replicate_api_key');
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

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`\nlocal function gateway on http://127.0.0.1:${PORT}`));
