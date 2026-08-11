-- ---------------------------------------------------------------------------
-- Repair the three functions in 20250527195807_add_vector_search_functions.sql.
--
-- All three failed at execution time on live Postgres. `match_coach_content`
-- is the one that mattered: it is the RAG retrieval path, so every coach has
-- been answering without any of its creator's uploaded content, and the caller
-- turned the error into an empty result. See #27.
--
--   match_coach_content  RETURNS TABLE declares column 3 as `text`, but
--                        coach_content_chunks.content_type is the
--                        `coach_content_type` enum. plpgsql RETURN QUERY
--                        refuses the mismatch:
--                        "Returned type coach_content_type does not match
--                         expected type text in column 3".
--
--   find_voice_samples   The identical defect, same column, same message. No
--                        caller in the repo, so it has been dead since it was
--                        written without anyone noticing.
--
--   get_coach_stats      A different bug: `WHERE coach_id = get_coach_stats.coach_id`
--                        leaves the bare `coach_id` ambiguous between the
--                        plpgsql parameter and the table column, so the
--                        function raises before returning. It also aggregates
--                        the enum with json_object_agg, which has no enum
--                        overload. Also uncalled.
--
-- The fix casts to `text` in the body rather than redeclaring the columns as
-- `coach_content_type`. Two reasons, and they both point the same way:
--
--   1. It keeps every signature byte-identical, so CREATE OR REPLACE applies
--      cleanly and the existing grants survive. Redeclaring the return type
--      would need DROP FUNCTION plus a re-GRANT, which is a wider blast radius
--      for a bug fix.
--   2. It is what broke this in the first place. 20260810120000 added values to
--      `coach_content_type` with ALTER TYPE ... ADD VALUE. A body that casts to
--      text cannot be broken by a future ADD VALUE; a body that returns the
--      enum re-arms the same trap for whoever extends the taxonomy next.
--
-- Callers already read column 3 as a string, so nothing downstream changes.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION match_coach_content(
  coach_id UUID,
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  content_type TEXT,
  intent_tags TEXT[],
  situation_tags TEXT[],
  voice_sample BOOLEAN,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cc.id,
    cc.content,
    cc.content_type::text,
    cc.intent_tags,
    cc.situation_tags,
    cc.voice_sample,
    1 - (cc.embedding <=> query_embedding) AS similarity
  FROM coach_content_chunks cc
  WHERE
    cc.coach_id = match_coach_content.coach_id
    AND cc.processed = true
    AND 1 - (cc.embedding <=> query_embedding) > match_threshold
  ORDER BY cc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION find_voice_samples(
  coach_id UUID,
  limit_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  content_type TEXT,
  sentence_structure TEXT,
  energy_level INT,
  catchphrases TEXT[],
  word_count INT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cc.id,
    cc.content,
    cc.content_type::text,
    cc.sentence_structure,
    cc.energy_level,
    cp.catchphrases,
    cc.word_count
  FROM coach_content_chunks cc
  JOIN coach_profiles cp ON cp.id = cc.coach_id
  WHERE
    cc.coach_id = find_voice_samples.coach_id
    AND cc.voice_sample = true
    AND cc.processed = true
  ORDER BY cc.created_at DESC
  LIMIT limit_count;
END;
$$;

CREATE OR REPLACE FUNCTION get_coach_stats(coach_id UUID)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'total_content_chunks', (
      SELECT COUNT(*)
      FROM coach_content_chunks cc
      WHERE cc.coach_id = get_coach_stats.coach_id AND cc.processed = true
    ),
    'voice_samples', (
      SELECT COUNT(*)
      FROM coach_content_chunks cc
      WHERE cc.coach_id = get_coach_stats.coach_id AND cc.voice_sample = true
    ),
    'total_words', (
      SELECT COALESCE(SUM(cc.word_count), 0)
      FROM coach_content_chunks cc
      WHERE cc.coach_id = get_coach_stats.coach_id AND cc.processed = true
    ),
    'content_types', (
      SELECT json_object_agg(t.content_type, t.count)
      FROM (
        SELECT cc.content_type::text AS content_type, COUNT(*) AS count
        FROM coach_content_chunks cc
        WHERE cc.coach_id = get_coach_stats.coach_id AND cc.processed = true
        GROUP BY cc.content_type
      ) t
    ),
    'avg_energy_level', (
      SELECT ROUND(AVG(cc.energy_level), 1)
      FROM coach_content_chunks cc
      WHERE cc.coach_id = get_coach_stats.coach_id AND cc.energy_level IS NOT NULL
    ),
    'test_message_count', (
      SELECT COUNT(*)
      FROM coach_test_messages ctm
      WHERE ctm.coach_id = get_coach_stats.coach_id
    )
  ) INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION match_coach_content IS
  'Vector retrieval over a coach''s uploaded content. content_type is cast to text so extending the coach_content_type enum cannot break the return signature again (#27).';
