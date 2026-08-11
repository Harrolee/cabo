/**
 * Retrieval over a coach's uploaded content.
 *
 * Split out of index.js for one reason: the failure mode. This path was broken
 * for its entire life and nothing noticed, because a `match_coach_content`
 * error was coerced into `[]` — which is exactly what a coach with no uploaded
 * content returns. An error that reads as a legitimate negative is the bug
 * class in #25, and it cost us the whole RAG path here (#27).
 *
 * So retrieval reports three outcomes, not two:
 *
 *   { ok: true,  chunks: [...] }              this coach has content
 *   { ok: true,  chunks: [] }                 this coach has none — legitimate
 *   { ok: false, chunks: [], reason, detail } retrieval FAILED — not the same
 *
 * Callers must not collapse the third into the second. `chunks` is always an
 * array so a caller that only wants to build a prompt can use it directly, but
 * `ok` is what tells you whether the empty array means anything.
 *
 * The client and the embedder are injected rather than imported so the failure
 * branch is reachable from a test without a broken database and without a test
 * hook in the production path.
 */

const RETRIEVAL_FAILED = 'retrieval_failed';
const EMBEDDING_FAILED = 'embedding_failed';

async function findRelevantContent({ supabase, embed, coachId, userMessage, limit = 3, threshold = 0.7 }) {
  let embedding;
  try {
    embedding = await embed(userMessage);
  } catch (error) {
    // The model call, not the database. Distinguished because the operator
    // fixes them in different places.
    console.error(
      `[retrieval] ${EMBEDDING_FAILED} coach=${coachId}: ${error.message} — ` +
      'coach will answer without its creator content'
    );
    return { ok: false, chunks: [], reason: EMBEDDING_FAILED, detail: error.message };
  }

  let data;
  let error;
  try {
    ({ data, error } = await supabase.rpc('match_coach_content', {
      coach_id: coachId,
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: limit,
    }));
  } catch (thrown) {
    /*
      A transport-level fault rather than a PostgREST error body. Degrade
      instead of failing the member's whole message — an answer without the
      creator's content beats no answer — but record it, which is the part the
      old code did not do.
    */
    error = { message: thrown.message };
  }

  if (error) {
    console.error(
      `[retrieval] ${RETRIEVAL_FAILED} coach=${coachId}: ${error.message} — ` +
      'this is NOT "no content", the coach is answering blind'
    );
    return { ok: false, chunks: [], reason: RETRIEVAL_FAILED, detail: error.message };
  }

  return { ok: true, chunks: data || [] };
}

module.exports = { findRelevantContent, RETRIEVAL_FAILED, EMBEDDING_FAILED };
