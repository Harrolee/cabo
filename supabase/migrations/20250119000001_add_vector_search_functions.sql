-- Enable the vector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Function to match coach content based on vector similarity
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
    cc.content_type,
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

-- Function to find similar voice samples for a coach
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
    cc.content_type,
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

-- Function to get coach statistics
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
      FROM coach_content_chunks 
      WHERE coach_id = get_coach_stats.coach_id AND processed = true
    ),
    'voice_samples', (
      SELECT COUNT(*) 
      FROM coach_content_chunks 
      WHERE coach_id = get_coach_stats.coach_id AND voice_sample = true
    ),
    'total_words', (
      SELECT COALESCE(SUM(word_count), 0) 
      FROM coach_content_chunks 
      WHERE coach_id = get_coach_stats.coach_id AND processed = true
    ),
    'content_types', (
      SELECT json_object_agg(content_type, count)
      FROM (
        SELECT content_type, COUNT(*) as count
        FROM coach_content_chunks 
        WHERE coach_id = get_coach_stats.coach_id AND processed = true
        GROUP BY content_type
      ) t
    ),
    'avg_energy_level', (
      SELECT ROUND(AVG(energy_level), 1)
      FROM coach_content_chunks 
      WHERE coach_id = get_coach_stats.coach_id AND energy_level IS NOT NULL
    ),
    'test_message_count', (
      SELECT COUNT(*) 
      FROM coach_test_messages 
      WHERE coach_id = get_coach_stats.coach_id
    )
  ) INTO result;
  
  RETURN result;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION match_coach_content TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION find_voice_samples TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_coach_stats TO anon, authenticated, service_role; 