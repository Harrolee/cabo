/**
 * The half of #27 a database probe cannot reach.
 *
 * The positive path — a coach with content gets chunks into its prompt — is
 * covered end to end by `mobile/e2e/flow-probe.mjs`. What that cannot do is
 * break `match_coach_content` on purpose, and the failure branch is the part
 * that actually hid the bug for this long. So it is exercised here with an
 * injected client instead.
 *
 *   node --test functions/coach-response-generator/retrieval.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { findRelevantContent, RETRIEVAL_FAILED, EMBEDDING_FAILED } =
  require('./retrieval.js');

const EMBEDDING = Array.from({ length: 1536 }, () => 0.01);
const embed = async () => EMBEDDING;

/** Runs `fn` with console.error captured, returning what it logged. */
async function capturingErrors(fn) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(' '));
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = original;
  }
}

test('a coach with content returns its chunks', async () => {
  const supabase = {
    rpc: async () => ({ data: [{ id: 'c1', content: 'behind the beat' }], error: null }),
  };
  const out = await findRelevantContent({ supabase, embed, coachId: 'x', userMessage: 'hi' });
  assert.equal(out.ok, true);
  assert.equal(out.chunks.length, 1);
});

test('a coach with no content is a success, not a failure', async () => {
  const supabase = { rpc: async () => ({ data: [], error: null }) };
  const out = await findRelevantContent({ supabase, embed, coachId: 'x', userMessage: 'hi' });
  assert.equal(out.ok, true, 'an empty roster of chunks is a legitimate answer');
  assert.deepEqual(out.chunks, []);
  assert.equal(out.reason, undefined);
});

test('a retrieval error is NOT reported as an empty result', async () => {
  // The exact error the enum/text mismatch produced in production.
  const supabase = {
    rpc: async () => ({
      data: null,
      error: {
        message:
          'structure of query does not match function result type: Returned type ' +
          'coach_content_type does not match expected type text in column 3',
      },
    }),
  };

  const { result, lines } = await capturingErrors(() =>
    findRelevantContent({ supabase, embed, coachId: 'pocket', userMessage: 'hi' })
  );

  assert.equal(result.ok, false, 'this is the whole point: it must not look like success');
  assert.equal(result.reason, RETRIEVAL_FAILED);
  assert.deepEqual(result.chunks, [], 'chunks stays an array so prompt building still works');
  assert.match(result.detail, /coach_content_type/);
  assert.equal(lines.length, 1, 'the failure is logged exactly once');
  assert.match(lines[0], /retrieval_failed/);
  assert.match(lines[0], /pocket/, 'the log names the coach, so it is actionable');
});

test('the two empty results are distinguishable from each other', async () => {
  const noContent = await findRelevantContent({
    supabase: { rpc: async () => ({ data: [], error: null }) },
    embed, coachId: 'x', userMessage: 'hi',
  });
  const { result: broken } = await capturingErrors(() =>
    findRelevantContent({
      supabase: { rpc: async () => ({ data: null, error: { message: 'boom' } }) },
      embed, coachId: 'x', userMessage: 'hi',
    })
  );

  assert.deepEqual(noContent.chunks, broken.chunks, 'both hand back an empty array…');
  assert.notEqual(noContent.ok, broken.ok, '…and the caller can still tell them apart');
});

test('an embedding failure is reported separately from a query failure', async () => {
  const supabase = {
    rpc: async () => assert.fail('must not query after the embedding failed'),
  };
  const { result, lines } = await capturingErrors(() =>
    findRelevantContent({
      supabase,
      embed: async () => { throw new Error('429 rate limit'); },
      coachId: 'x',
      userMessage: 'hi',
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, EMBEDDING_FAILED, 'a model outage is not a database bug');
  assert.match(lines[0], /embedding_failed/);
});

test('a transport fault degrades the answer but is still recorded', async () => {
  const supabase = { rpc: async () => { throw new Error('socket hang up'); } };
  const { result, lines } = await capturingErrors(() =>
    findRelevantContent({ supabase, embed, coachId: 'x', userMessage: 'hi' })
  );

  // Degrade: the member still gets coached, just without creator content.
  assert.deepEqual(result.chunks, []);
  // But loudly: the old code returned a bare [] here and told nobody.
  assert.equal(result.ok, false);
  assert.equal(result.reason, RETRIEVAL_FAILED);
  assert.match(result.detail, /socket hang up/);
  assert.equal(lines.length, 1);
});
