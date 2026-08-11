#!/usr/bin/env node
/**
 * Prompt v1 vs v2 eval harness.
 *
 * Runs a fixed set of coaching turns through *both* prompt builders exactly as
 * `coach-response-generator/index.js#generateCoaching` assembles them, scores
 * the replies against the specific claims made for v2 in
 * `docs/prompts-and-notifications.md` §2, and writes a side-by-side report.
 *
 *   node prompt-eval/run.mjs                 # local mock, free, no network
 *   node prompt-eval/run.mjs --real --judge  # real API, costs money
 *
 * It defaults to the local stand-in (`harness/mock-openai.js`) on purpose:
 * nobody should be able to spend credits by running a file called run.mjs.
 * `--real` is the only way to reach OpenAI, and it refuses to start without a
 * key it can find on disk.
 *
 * Flags:
 *   --real            hit the live API instead of the mock
 *   --judge           add a blind pairwise judging pass (1 extra call/case)
 *   --model=<id>      default gpt-4o-mini (cheapest chat model we configure)
 *   --only=<substr>   filter cases by id, e.g. --only=medical
 *   --out=<path>      report destination
 *   --max-cases=<n>   hard cap, a spend guard for accidental big runs
 *   --rescore=<json>  re-score a previous run's saved transcripts, no API calls
 *
 * Every run writes both a markdown report and the raw transcripts as JSON, so
 * a scorer that turns out to be wrong can be fixed and the tally rebuilt
 * against the same replies for free.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { CASES } from './cases.mjs';
import { scoreReply, verdicts } from './score.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');

// The deployed copies — Cloud Functions are zipped per directory, so this is
// the code that actually runs in production, not the functions/shared/ mirror.
const FN = path.join(REPO, 'functions/coach-response-generator');
const { buildSystemPrompt, resolvePresentation, detectEmotionalNeed, detectSessionContext } =
  require(path.join(FN, 'coach-domain.js'));
const { buildSystemPromptV2, buildMessageHistory } = require(path.join(FN, 'coach-prompt-v2.js'));

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const REAL = flag('real');
const JUDGE = flag('judge');
const MODEL = value('model', 'gpt-4o-mini');
const ONLY = value('only', null);
const MAX_CASES = Number(value('max-cases', 24));
const PRESENTATION = value('presentation', 'chat');

const selected = CASES.filter((c) => (ONLY ? c.id.includes(ONLY) : true)).slice(0, MAX_CASES);

// Published per-1M token prices, for the spend line at the end. Approximate by
// definition — the invoice is the source of truth.
const PRICES = {
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
};

// ---------------------------------------------------------------------------
// Where the model lives
// ---------------------------------------------------------------------------

const MOCK_BASE = 'http://127.0.0.1:8791/v1';

/** Read a value out of terraform.tfvars without ever logging it. */
function tfvar(name) {
  const file = process.env.TFVARS_FILE || path.join(REPO, '_infra/terraform.tfvars');
  if (!fs.existsSync(file)) return '';
  const match = fs.readFileSync(file, 'utf8').match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm'));
  return match ? match[1] : '';
}

async function reachable(base) {
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'mock', messages: [{ role: 'user', content: 'ping' }] }),
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Start harness/mock-openai.js if it is not already up. */
async function ensureMock() {
  if (await reachable(MOCK_BASE)) return null;

  const script = path.join(HERE, '../harness/mock-openai.js');
  const child = spawn(process.execPath, [script], {
    cwd: path.join(HERE, '../harness'),
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: false,
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await reachable(MOCK_BASE)) return child;
    if (child.exitCode !== null) break;
  }
  child.kill();
  console.error(
    'Could not start the local mock. Install its dependency first:\n' +
      '  cd mobile/e2e/harness && npm init -y && npm install express\n' +
      'or run against the real API with --real.\n' +
      (stderr ? `\nmock said: ${stderr.trim().split('\n').slice(-3).join('\n')}` : '')
  );
  process.exit(1);
}

let API_BASE = MOCK_BASE;
let API_KEY = 'mock-key';

// ---------------------------------------------------------------------------
// Generation — identical assembly to generateCoaching()
// ---------------------------------------------------------------------------

const usage = { calls: 0, prompt: 0, completion: 0 };

async function complete(messages, maxTokens, responseFormat) {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: responseFormat ? 0 : 0.8,
      presence_penalty: responseFormat ? undefined : 0.1,
      frequency_penalty: responseFormat ? undefined : 0.1,
      ...(responseFormat ? { response_format: responseFormat } : {}),
    }),
  });

  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${body?.error?.message ?? JSON.stringify(body)}`);

  usage.calls += 1;
  usage.prompt += body.usage?.prompt_tokens ?? 0;
  usage.completion += body.usage?.completion_tokens ?? 0;

  return body.choices[0].message.content.trim();
}

function buildOptions(caseDef) {
  const emotionalNeed = detectEmotionalNeed(caseDef.message);
  const sessionContext = detectSessionContext(caseDef.message, caseDef.coach.session_contexts || []);
  return {
    emotionalNeed,
    sessionContext,
    relevantContent: caseDef.relevantContent || [],
    presentation: PRESENTATION,
    previousMessages: caseDef.history || [],
    member: caseDef.member || {},
    initiatedByCoach: false,
  };
}

/**
 * v1 gets history flattened into the system prompt and no member block, v2 gets
 * real message objects and the member block. That asymmetry is the change under
 * test, so it is reproduced rather than levelled out.
 */
function messagesFor(version, caseDef) {
  const options = buildOptions(caseDef);
  if (version === 'v1') {
    return [
      { role: 'system', content: buildSystemPrompt(caseDef.coach, options) },
      { role: 'user', content: caseDef.message },
    ];
  }
  return [
    { role: 'system', content: buildSystemPromptV2(caseDef.coach, options) },
    ...buildMessageHistory(options.previousMessages),
    { role: 'user', content: caseDef.message },
  ];
}

// ---------------------------------------------------------------------------
// Blind pairwise judge
// ---------------------------------------------------------------------------

const JUDGE_AXES = [
  ['member_grounding', 'uses what is actually known about this member rather than generic encouragement'],
  ['single_action', 'leaves them with exactly one thing to do or think about'],
  ['discipline_containment', 'stays inside the coach\'s stated discipline and boundaries'],
  ['honesty', 'pushes back or says "I do not know" instead of agreeing to be liked'],
  ['no_invention', 'invents no shared history, credentials, studies or results'],
  ['voice', 'sounds like this specific coach, at the stated length, no preamble or sign-off'],
];

const JUDGE_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'prompt_eval_judgement',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['axes', 'overall', 'note'],
      properties: {
        axes: {
          type: 'object',
          additionalProperties: false,
          required: JUDGE_AXES.map(([key]) => key),
          properties: Object.fromEntries(
            JUDGE_AXES.map(([key]) => [key, { type: 'string', enum: ['A', 'B', 'tie'] }])
          ),
        },
        overall: { type: 'string', enum: ['A', 'B', 'tie'] },
        note: { type: 'string' },
      },
    },
  },
};

async function judgeCase(caseDef, replyA, replyB) {
  const member = caseDef.member || {};
  const facts = [
    member.aspiration && `wants to become: ${member.aspiration}`,
    member.current_level && `starting from: ${member.current_level}`,
    (member.obstacles || []).length && `obstacles: ${member.obstacles.join('; ')}`,
    (member.wins || []).length && `recent wins: ${member.wins.join('; ')}`,
    `days working together: ${member.days_together ?? 0}`,
  ]
    .filter(Boolean)
    .join('\n');

  const system =
    'You are grading two candidate replies from the same coaching assistant. ' +
    'Judge only what is in front of you. Be willing to say tie. ' +
    'Do not reward length, enthusiasm, or politeness.';

  const user = [
    `COACH: ${caseDef.coach.name} — ${caseDef.coach.discipline}`,
    `BOUNDARIES: ${caseDef.coach.coaching_boundaries}`,
    `TARGET LENGTH: under 90 words.`,
    '',
    `WHAT THE COACH KNOWS ABOUT THE MEMBER:\n${facts || '(nothing)'}`,
    '',
    (caseDef.history || []).length
      ? `CONVERSATION SO FAR:\n${caseDef.history
          .map((m) => `${m.role === 'user' ? 'Member' : 'Coach'}: ${m.content}`)
          .join('\n')}`
      : 'CONVERSATION SO FAR: (none — this is their first message)',
    '',
    `MEMBER'S MESSAGE:\n${caseDef.message}`,
    '',
    `REPLY A:\n${replyA}`,
    '',
    `REPLY B:\n${replyB}`,
    '',
    'For each axis pick A, B or tie:',
    ...JUDGE_AXES.map(([key, description]) => `- ${key}: ${description}`),
    '',
    'Then pick an overall winner and give a one-sentence note naming the deciding difference.',
  ].join('\n');

  const raw = await complete(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    500,
    JUDGE_SCHEMA
  );

  try {
    return JSON.parse(raw);
  } catch {
    // The local mock does not honour json_schema; that is fine, plumbing only.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function fmtVerdict(v) {
  if (v === null) return '–';
  return v ? 'pass' : 'FAIL';
}

function axisLines(score) {
  const lines = [];
  lines.push(`words ${score.hygiene.words}, questions ${score.hygiene.questions}`);
  lines.push(`actions ${score.action.count}${score.action.count ? `: ${score.action.sentences.map((s) => `"${s}"`).join(' | ')}` : ''}`);
  if (score.member.count) lines.push(`member facts used: ${score.member.hits.join(', ')}`);
  if (score.history.claim) lines.push(`history claim: "${score.history.historyHit || score.history.credentialHit}"${score.history.cold ? ' (COLD START — invented)' : ''}`);
  if (score.recitation.lifted) lines.push(`lifted from chunk (${score.recitation.longestRun} words): "${score.recitation.snippet}"`);
  if (score.hygiene.leaked) lines.push(`leak: "${score.hygiene.leakHit}"`);
  if (score.containment) {
    lines.push(
      `declined: ${score.containment.declined ? `yes ("${score.containment.declineHit}")` : 'no'}; ` +
        `pointed somewhere: ${score.containment.referred ? `yes ("${score.containment.referralHit}")` : 'no'}` +
        (score.containment.leaked.length ? `; off-domain advice: ${score.containment.leaked.join(', ')}` : '')
    );
  }
  if (score.medical) {
    lines.push(
      `escalated: ${score.medical.escalated ? `yes ("${score.medical.escalateHit}")` : 'NO'}; ` +
        `stop advice: ${score.medical.heldOff ? `yes ("${score.medical.heldOffHit}")` : 'no'}; ` +
        `diagnosed: ${score.medical.diagnosed ? `YES ("${score.medical.diagnosisHit}")` : 'no'}; ` +
        `workaround offered: ${score.medical.offeredWorkaround ? `yes ("${score.medical.workaroundHit}")` : 'no'}`
    );
  }
  if (score.pushback) {
    lines.push(
      `pushed back: ${score.pushback.pushedBack ? `yes ("${score.pushback.pushbackHit}")` : 'NO'}; ` +
        `agreement language: ${score.pushback.agreed ? `yes ("${score.pushback.agreementHit}")` : 'no'}`
    );
  }
  return lines;
}

function buildReport(results, meta) {
  const out = [];
  out.push(`# Prompt v1 vs v2 — eval run`);
  out.push('');
  out.push(
    `Model \`${meta.model}\` · ${meta.real ? 'live OpenAI API' : 'local mock (no network)'} · ` +
      `${meta.cases} cases × 2 prompts${meta.judge ? ' + blind judge' : ''} · ${meta.timestamp}` +
      (meta.rescored ? ' · re-scored from saved transcripts' : '')
  );
  out.push('');
  out.push(
    'Generated by `mobile/e2e/prompt-eval/run.mjs`. Axes come from ' +
      '`docs/prompts-and-notifications.md` §2 — the specific claims made for v2 — not from generic quality.'
  );
  out.push('');

  // Summary table
  const axes = Object.keys(verdicts(results[0].case, results[0].v1.score));
  out.push('## Deterministic axis tally');
  out.push('');
  out.push('| axis | v1 pass | v2 pass | applicable cases |');
  out.push('| --- | --- | --- | --- |');
  for (const axis of axes) {
    let applicable = 0;
    let v1 = 0;
    let v2 = 0;
    for (const r of results) {
      if (r.v1.verdicts[axis] === null) continue;
      applicable += 1;
      if (r.v1.verdicts[axis]) v1 += 1;
      if (r.v2.verdicts[axis]) v2 += 1;
    }
    if (!applicable) continue;
    out.push(`| ${axis} | ${v1}/${applicable} | ${v2}/${applicable} | ${applicable} |`);
  }
  out.push('');

  if (meta.judge && results.some((r) => r.judge)) {
    out.push('## Blind pairwise judge');
    out.push('');
    out.push('A/B order is randomised per case and the judge is never told which prompt is which.');
    out.push('');
    const keys = JUDGE_AXES.map(([k]) => k);
    out.push(`| axis | v1 wins | v2 wins | tie |`);
    out.push('| --- | --- | --- | --- |');
    for (const key of [...keys, 'overall']) {
      let v1 = 0;
      let v2 = 0;
      let tie = 0;
      for (const r of results) {
        if (!r.judge) continue;
        const pick = key === 'overall' ? r.judge.overall : r.judge.axes[key];
        const winner = pick === 'tie' ? 'tie' : r.judgeOrder[pick];
        if (winner === 'v1') v1 += 1;
        else if (winner === 'v2') v2 += 1;
        else tie += 1;
      }
      out.push(`| ${key} | ${v1} | ${v2} | ${tie} |`);
    }
    out.push('');
  }

  const meanWords = (version) =>
    Math.round(results.reduce((sum, r) => sum + r[version].score.hygiene.words, 0) / results.length);
  out.push(`Mean reply length: v1 ${meanWords('v1')} words, v2 ${meanWords('v2')} words (limit: 90).`);
  out.push('');

  out.push('## Cases');
  for (const r of results) {
    const c = r.case;
    out.push('');
    out.push(`### ${c.id} — ${c.coach.name} (${c.coach.discipline})`);
    out.push('');
    if (c.member?.aspiration) out.push(`*Member wants to become:* ${c.member.aspiration}`);
    if (c.member?.obstacles?.length) out.push(`*Obstacles on file:* ${c.member.obstacles.join('; ')}`);
    out.push(`*Days together:* ${c.member?.days_together ?? 0} · *thread turns:* ${(c.history || []).length}`);
    out.push('');
    out.push(`**Member:** ${c.message}`);
    out.push('');
    for (const version of ['v1', 'v2']) {
      out.push(`**${version} reply:**`);
      out.push('');
      out.push(r[version].text.split('\n').map((l) => `> ${l}`).join('\n'));
      out.push('');
      out.push(axisLines(r[version].score).map((l) => `- ${l}`).join('\n'));
      out.push('');
      out.push(
        '`' +
          Object.entries(r[version].verdicts)
            .filter(([, v]) => v !== null)
            .map(([k, v]) => `${k}=${fmtVerdict(v)}`)
            .join(' ') +
          '`'
      );
      out.push('');
    }
    if (r.judge) {
      const per = Object.entries(r.judge.axes)
        .map(([k, pick]) => `${k}=${pick === 'tie' ? 'tie' : r.judgeOrder[pick]}`)
        .join(' ');
      out.push(
        `**Judge:** overall ${r.judge.overall === 'tie' ? 'tie' : r.judgeOrder[r.judge.overall]} — ${r.judge.note}`
      );
      out.push('');
      out.push('`' + per + '`');
      out.push('');
    }
  }

  out.push('');
  out.push('## Spend');
  out.push('');
  out.push(
    `${meta.usage.calls} calls · ${meta.usage.prompt} prompt tokens · ${meta.usage.completion} completion tokens` +
      (meta.cost !== null ? ` · approx $${meta.cost.toFixed(4)} at list price for \`${meta.model}\`` : '')
  );
  out.push('');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Drift guard
// ---------------------------------------------------------------------------

function checkRosterDrift() {
  const seed = path.join(REPO, 'supabase/seeds/example_roster.sql');
  if (!fs.existsSync(seed)) return;
  const text = fs.readFileSync(seed, 'utf8');
  for (const name of ['Pocket', 'June', 'Marisol']) {
    if (!text.includes(`'${name}'`)) {
      console.warn(`  ! ${name} is no longer in example_roster.sql — cases.mjs may be stale`);
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * Re-score a previous run's saved transcripts. No network, no spend — so a
 * scorer bug found while reading a report can be fixed and the tally rebuilt
 * from the same replies, rather than paying for a fresh run and comparing
 * against different text.
 */
function rescore(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byId = new Map(CASES.map((c) => [c.id, c]));

  const results = raw.results.map((row) => {
    const caseDef = byId.get(row.case);
    if (!caseDef) throw new Error(`case ${row.case} is no longer defined in cases.mjs`);
    const built = {};
    for (const version of ['v1', 'v2']) {
      const score = scoreReply(caseDef, row[version]);
      built[version] = { text: row[version], score, verdicts: verdicts(caseDef, score) };
    }
    return { case: caseDef, ...built, judge: row.judge, judgeOrder: row.judgeOrder };
  });

  return { results, meta: raw.meta };
}

async function main() {
  let mockChild = null;

  const rescoreFrom = value('rescore', null);
  if (rescoreFrom) {
    const { results, meta } = rescore(path.resolve(rescoreFrom));
    const out = value('out', rescoreFrom.replace(/\.json$/, '.md'));
    fs.writeFileSync(out, buildReport(results, { ...meta, rescored: true }));
    console.log(`rescored ${results.length} cases from saved transcripts (no API calls)`);
    console.log(`report: ${path.relative(process.cwd(), out)}`);
    printSummary(results);
    return;
  }

  if (REAL) {
    API_KEY = process.env.OPENAI_API_KEY || tfvar('openai_api_key');
    API_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    if (!API_KEY) {
      console.error(
        'No API key. Set OPENAI_API_KEY, or point TFVARS_FILE at a terraform.tfvars\n' +
          'containing openai_api_key. Refusing to run.'
      );
      process.exit(1);
    }
    console.log(`\n!! --real: this run WILL spend money. model=${MODEL}, ${selected.length} cases`);
    console.log(`   ${selected.length * 2}${JUDGE ? ` + ${selected.length} judge` : ''} completions\n`);
  } else {
    mockChild = await ensureMock();
    console.log(`\nlocal mock at ${MOCK_BASE} — no network, no spend. --real to use OpenAI.\n`);
  }

  checkRosterDrift();

  const results = [];
  for (const caseDef of selected) {
    process.stdout.write(`  ${caseDef.id} … `);

    const maxTokens = resolvePresentation(PRESENTATION).maxTokens;
    const v1Text = await complete(messagesFor('v1', caseDef), maxTokens);
    const v2Text = await complete(messagesFor('v2', caseDef), maxTokens);

    const v1 = { text: v1Text, score: scoreReply(caseDef, v1Text) };
    v1.verdicts = verdicts(caseDef, v1.score);
    const v2 = { text: v2Text, score: scoreReply(caseDef, v2Text) };
    v2.verdicts = verdicts(caseDef, v2.score);

    // Deterministic but alternating A/B assignment, so the judge cannot learn
    // a position bias that lines up with a prompt version.
    const flip = results.length % 2 === 0;
    const judgeOrder = flip ? { A: 'v1', B: 'v2' } : { A: 'v2', B: 'v1' };
    let judge = null;
    if (JUDGE) {
      judge = await judgeCase(caseDef, flip ? v1Text : v2Text, flip ? v2Text : v1Text);
    }

    results.push({ case: caseDef, v1, v2, judge, judgeOrder });
    console.log('done');
  }

  const price = PRICES[MODEL];
  const cost = price
    ? (usage.prompt / 1e6) * price.in + (usage.completion / 1e6) * price.out
    : null;

  const meta = {
    model: MODEL,
    real: REAL,
    judge: JUDGE,
    cases: selected.length,
    timestamp: new Date().toISOString(),
    usage,
    cost: REAL ? cost : 0,
  };

  const report = buildReport(results, meta);
  const defaultName = `${new Date().toISOString().slice(0, 10)}-${MODEL}${REAL ? '' : '-mock'}`;
  const out = value('out', path.join(HERE, 'results', `${defaultName}.md`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, report);

  // Raw transcripts, so the scorers can be corrected later for free.
  const jsonOut = out.replace(/\.md$/, '.json');
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        meta,
        results: results.map((r) => ({
          case: r.case.id,
          v1: r.v1.text,
          v2: r.v2.text,
          judge: r.judge,
          judgeOrder: r.judgeOrder,
        })),
      },
      null,
      2
    )
  );

  console.log(`\nreport: ${path.relative(process.cwd(), out)}`);
  console.log(
    `usage: ${usage.calls} calls, ${usage.prompt} prompt + ${usage.completion} completion tokens` +
      (REAL && cost !== null ? `, approx $${cost.toFixed(4)}` : ' (mock, $0)')
  );

  printSummary(results);

  if (mockChild) mockChild.kill();
}

/** Console summary, so a run is useful without opening the report. */
function printSummary(results) {
  const axes = Object.keys(verdicts(results[0].case, results[0].v1.score));
  console.log('\naxis                        v1      v2');
  for (const axis of axes) {
    let applicable = 0;
    let v1 = 0;
    let v2 = 0;
    for (const r of results) {
      if (r.v1.verdicts[axis] === null) continue;
      applicable += 1;
      if (r.v1.verdicts[axis]) v1 += 1;
      if (r.v2.verdicts[axis]) v2 += 1;
    }
    if (!applicable) continue;
    console.log(
      `${axis.padEnd(26)} ${String(v1).padStart(2)}/${applicable}   ${String(v2).padStart(2)}/${applicable}`
    );
  }
}

main().catch((error) => {
  console.error(`\neval failed: ${error.message}`);
  process.exit(1);
});
