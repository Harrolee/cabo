/*
  # Add Coach Builder Tables Migration
  
  1. New Tables
    - coach_profiles: User-created AI coach personalities
    - coach_content_chunks: Content uploaded for voice/style analysis
    - coach_test_messages: Validation tests for coach responses
  
  2. Features
    - Row Level Security (RLS) 
    - Vector support for AI similarity search
    - Integration with existing user_profiles table
    - Automated timestamp management
*/

-- Enable vector extension for embeddings (if not already enabled)
CREATE EXTENSION IF NOT EXISTS vector;

-- Create coach response style enum
CREATE TYPE coach_response_style AS ENUM (
    'tough_love',
    'empathetic_mirror', 
    'reframe_master',
    'data_driven',
    'story_teller',
    'cheerleader',
    'wise_mentor'
);

-- Create coach content type enum  
CREATE TYPE coach_content_type AS ENUM (
    'instagram_post',
    'video_transcript',
    'podcast_transcript', 
    'written_content',
    'social_media_comment',
    'blog_post'
);

-- Create coach_profiles table
CREATE TABLE public.coach_profiles (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Link to existing user system
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    user_email text NOT NULL REFERENCES user_profiles(email) ON DELETE CASCADE,
    
    -- Basic Info
    name text NOT NULL,
    handle text UNIQUE,
    description text,
    
    -- Personality Configuration
    primary_response_style coach_response_style NOT NULL,
    secondary_response_style coach_response_style,
    emotional_response_map jsonb DEFAULT '{}',
    communication_traits jsonb DEFAULT '{}',
    
    -- Voice Configuration  
    voice_patterns jsonb DEFAULT '{}',
    catchphrases text[] DEFAULT '{}',
    vocabulary_preferences jsonb DEFAULT '{}',
    
    -- Content Processing Status
    content_processed boolean DEFAULT false,
    total_content_pieces integer DEFAULT 0,
    processing_status text DEFAULT 'pending', -- 'pending', 'processing', 'complete', 'error'
    
    -- Settings
    active boolean DEFAULT true,
    max_daily_interactions integer DEFAULT 100,
    
    -- Metadata
    public boolean DEFAULT false, -- For sharing coaches
    preview_sessions integer DEFAULT 0,
    total_conversations integer DEFAULT 0,
    
    -- Constraints
    CONSTRAINT handle_format CHECK (handle ~ '^[a-zA-Z0-9_-]{3,30}$'),
    CONSTRAINT max_interactions_positive CHECK (max_daily_interactions > 0)
);

-- Create coach_content_chunks table
CREATE TABLE public.coach_content_chunks (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- References
    coach_id uuid REFERENCES coach_profiles(id) ON DELETE CASCADE,
    
    -- Content
    content text NOT NULL,
    content_type coach_content_type NOT NULL,
    source_url text,
    file_name text,
    file_path text, -- Path in GCP Storage
    
    -- Tagging Dimensions
    intent_tags text[] DEFAULT '{}', -- 'motivation', 'advice', 'celebration', etc.
    situation_tags text[] DEFAULT '{}', -- 'pre_workout', 'struggling', 'plateau', etc. 
    emotional_need_tags text[] DEFAULT '{}', -- 'encouragement', 'commiseration', etc.
    response_style_tags text[] DEFAULT '{}', -- 'tough_love', 'empathetic', etc.
    
    -- Voice Characteristics
    voice_sample boolean DEFAULT false,
    sentence_structure text,
    energy_level integer CHECK (energy_level >= 1 AND energy_level <= 10),
    
    -- Vector Storage for similarity search
    embedding vector(1536), -- OpenAI embedding size
    
    -- Processing Status
    processed boolean DEFAULT false,
    processing_error text,
    
    -- Metadata
    word_count integer,
    engagement_metrics jsonb DEFAULT '{}',
    
    -- Constraints
    CONSTRAINT content_not_empty CHECK (char_length(content) > 0),
    CONSTRAINT word_count_positive CHECK (word_count IS NULL OR word_count >= 0)
);

-- Create coach_test_messages table for validation
CREATE TABLE public.coach_test_messages (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- References
    coach_id uuid REFERENCES coach_profiles(id) ON DELETE CASCADE,
    
    -- Test Data
    test_message text NOT NULL,
    expected_response_style coach_response_style,
    expected_emotional_need text,
    
    -- Results
    actual_response text,
    response_generated_at timestamptz,
    human_rating integer CHECK (human_rating >= 1 AND human_rating <= 5),
    automated_score integer CHECK (automated_score >= 1 AND automated_score <= 100),
    
    -- Test Metadata
    test_scenario text,
    validation_notes text,
    
    -- Constraints
    CONSTRAINT test_message_not_empty CHECK (char_length(test_message) > 0)
);

-- Create indexes for performance
CREATE INDEX coach_profiles_user_email_idx ON public.coach_profiles(user_email);
CREATE INDEX coach_profiles_handle_idx ON public.coach_profiles(handle);
CREATE INDEX coach_profiles_active_idx ON public.coach_profiles(active);
CREATE INDEX coach_profiles_public_idx ON public.coach_profiles(public);
CREATE INDEX coach_profiles_primary_style_idx ON public.coach_profiles(primary_response_style);

CREATE INDEX coach_content_chunks_coach_id_idx ON public.coach_content_chunks(coach_id);
CREATE INDEX coach_content_chunks_type_idx ON public.coach_content_chunks(content_type);
CREATE INDEX coach_content_chunks_processed_idx ON public.coach_content_chunks(processed);
CREATE INDEX coach_content_chunks_voice_sample_idx ON public.coach_content_chunks(voice_sample);

CREATE INDEX coach_test_messages_coach_id_idx ON public.coach_test_messages(coach_id);
CREATE INDEX coach_test_messages_rating_idx ON public.coach_test_messages(human_rating);

-- Vector similarity search index
CREATE INDEX coach_content_chunks_embedding_idx ON public.coach_content_chunks 
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Enable Row Level Security
ALTER TABLE public.coach_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_content_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_test_messages ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for coach_profiles
CREATE POLICY "Users can view their own coaches"
    ON public.coach_profiles FOR SELECT
    USING (
        (auth.jwt() ->> 'phone' = (SELECT phone_number FROM user_profiles WHERE email = user_email)) OR
        (('+' || (auth.jwt() ->> 'phone')) = (SELECT phone_number FROM user_profiles WHERE email = user_email))
    );

CREATE POLICY "Users can view public coaches"
    ON public.coach_profiles FOR SELECT
    USING (public = true);

CREATE POLICY "Users can create coaches"
    ON public.coach_profiles FOR INSERT
    WITH CHECK (
        (auth.jwt() ->> 'phone' = (SELECT phone_number FROM user_profiles WHERE email = user_email)) OR
        (('+' || (auth.jwt() ->> 'phone')) = (SELECT phone_number FROM user_profiles WHERE email = user_email))
    );

CREATE POLICY "Users can update their own coaches"
    ON public.coach_profiles FOR UPDATE
    USING (
        (auth.jwt() ->> 'phone' = (SELECT phone_number FROM user_profiles WHERE email = user_email)) OR
        (('+' || (auth.jwt() ->> 'phone')) = (SELECT phone_number FROM user_profiles WHERE email = user_email))
    )
    WITH CHECK (
        (auth.jwt() ->> 'phone' = (SELECT phone_number FROM user_profiles WHERE email = user_email)) OR
        (('+' || (auth.jwt() ->> 'phone')) = (SELECT phone_number FROM user_profiles WHERE email = user_email))
    );

CREATE POLICY "Users can delete their own coaches"
    ON public.coach_profiles FOR DELETE
    USING (
        (auth.jwt() ->> 'phone' = (SELECT phone_number FROM user_profiles WHERE email = user_email)) OR
        (('+' || (auth.jwt() ->> 'phone')) = (SELECT phone_number FROM user_profiles WHERE email = user_email))
    );

-- Create RLS policies for coach_content_chunks
CREATE POLICY "Users can view content for their own coaches"
    ON public.coach_content_chunks FOR SELECT
    USING (
        coach_id IN (
            SELECT id FROM coach_profiles 
            WHERE (auth.jwt() ->> 'phone' = (SELECT phone_number FROM user_profiles WHERE email = user_email)) OR
                  (('+' || (auth.jwt() ->> 'phone')) = (SELECT phone_number FROM user_profiles WHERE email = user_email))
        )
    );

CREATE POLICY "Users can insert content for their own coaches"
    ON public.coach_content_chunks FOR INSERT
    WITH CHECK (
        coach_id IN (
            SELECT id FROM coach_profiles 
            WHERE (auth.jwt() ->> 'phone' = (SELECT phone_number FROM user_profiles WHERE email = user_email)) OR
                  (('+' || (auth.jwt() ->> 'phone')) = (SELECT phone_number FROM user_profiles WHERE email = user_email))
        )
    );

CREATE POLICY "Users can update content for their own coaches"
    ON public.coach_content_chunks FOR UPDATE
    USING (
        coach_id IN (
            SELECT id FROM coach_profiles 
            WHERE (auth.jwt() ->> 'phone' = (SELECT phone_number FROM user_profiles WHERE email = user_email)) OR
                  (('+' || (auth.jwt() ->> 'phone')) = (SELECT phone_number FROM user_profiles WHERE email = user_email))
        )
    )
    WITH CHECK (
        coach_id IN (
            SELECT id FROM coach_profiles 
            WHERE (auth.jwt() ->> 'phone' = (SELECT phone_number FROM user_profiles WHERE email = user_email)) OR
                  (('+' || (auth.jwt() ->> 'phone')) = (SELECT phone_number FROM user_profiles WHERE email = user_email))
        )
    );

CREATE POLICY "Users can delete content for their own coaches"
    ON public.coach_content_chunks FOR DELETE
    USING (
        coach_id IN (
            SELECT id FROM coach_profiles 
            WHERE (auth.jwt() ->> 'phone' = (SELECT phone_number FROM user_profiles WHERE email = user_email)) OR
                  (('+' || (auth.jwt() ->> 'phone')) = (SELECT phone_number FROM user_profiles WHERE email = user_email))
        )
    );

-- Similar policies for coach_test_messages
CREATE POLICY "Users can view test messages for their own coaches"
    ON public.coach_test_messages FOR SELECT
    USING (
        coach_id IN (
            SELECT id FROM coach_profiles 
            WHERE (auth.jwt() ->> 'phone' = (SELECT phone_number FROM user_profiles WHERE email = user_email)) OR
                  (('+' || (auth.jwt() ->> 'phone')) = (SELECT phone_number FROM user_profiles WHERE email = user_email))
        )
    );

CREATE POLICY "Users can insert test messages for their own coaches"
    ON public.coach_test_messages FOR INSERT
    WITH CHECK (
        coach_id IN (
            SELECT id FROM coach_profiles 
            WHERE (auth.jwt() ->> 'phone' = (SELECT phone_number FROM user_profiles WHERE email = user_email)) OR
                  (('+' || (auth.jwt() ->> 'phone')) = (SELECT phone_number FROM user_profiles WHERE email = user_email))
        )
    );

CREATE POLICY "Users can update test messages for their own coaches"
    ON public.coach_test_messages FOR UPDATE
    USING (
        coach_id IN (
            SELECT id FROM coach_profiles 
            WHERE (auth.jwt() ->> 'phone' = (SELECT phone_number FROM user_profiles WHERE email = user_email)) OR
                  (('+' || (auth.jwt() ->> 'phone')) = (SELECT phone_number FROM user_profiles WHERE email = user_email))
        )
    )
    WITH CHECK (
        coach_id IN (
            SELECT id FROM coach_profiles 
            WHERE (auth.jwt() ->> 'phone' = (SELECT phone_number FROM user_profiles WHERE email = user_email)) OR
                  (('+' || (auth.jwt() ->> 'phone')) = (SELECT phone_number FROM user_profiles WHERE email = user_email))
        )
    );

-- Add updated_at triggers for new tables
CREATE TRIGGER handle_coach_profiles_updated_at
    BEFORE UPDATE ON public.coach_profiles
    FOR EACH ROW
    EXECUTE PROCEDURE public.handle_updated_at();

CREATE TRIGGER handle_coach_content_chunks_updated_at
    BEFORE UPDATE ON public.coach_content_chunks
    FOR EACH ROW
    EXECUTE PROCEDURE public.handle_updated_at();

CREATE TRIGGER handle_coach_test_messages_updated_at
    BEFORE UPDATE ON public.coach_test_messages
    FOR EACH ROW
    EXECUTE PROCEDURE public.handle_updated_at();

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_content_chunks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_test_messages TO authenticated;

-- Allow service role (GCP Cloud Functions) to access all coach data
GRANT ALL ON public.coach_profiles TO service_role;
GRANT ALL ON public.coach_content_chunks TO service_role;
GRANT ALL ON public.coach_test_messages TO service_role;

-- Add helpful comments
COMMENT ON TABLE public.coach_profiles IS 'User-created AI coach personalities for the Coach Builder system';
COMMENT ON TABLE public.coach_content_chunks IS 'Content uploaded by users to train their AI coaches voice and style';
COMMENT ON TABLE public.coach_test_messages IS 'Test messages and validation results for AI coach responses';

COMMENT ON COLUMN coach_profiles.handle IS 'Unique URL-friendly identifier for the coach (e.g. @my-coach)';
COMMENT ON COLUMN coach_profiles.primary_response_style IS 'Main personality trait that defines how the coach responds';
COMMENT ON COLUMN coach_profiles.content_processed IS 'Whether uploaded content has been analyzed by AI';
COMMENT ON COLUMN coach_content_chunks.embedding IS 'Vector embedding for semantic similarity search';
COMMENT ON COLUMN coach_content_chunks.voice_sample IS 'Whether this content is a good example of the coaches voice';
COMMENT ON COLUMN coach_test_messages.human_rating IS 'Human rating of response quality (1-5 stars)';

-- Helper functions for Coach Builder
CREATE OR REPLACE FUNCTION public.get_coach_by_handle(p_handle text)
RETURNS TABLE (
    id uuid,
    name text,
    description text,
    primary_response_style coach_response_style,
    public boolean,
    user_email text
)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT 
        id,
        name,
        description,
        primary_response_style,
        public,
        user_email
    FROM coach_profiles 
    WHERE handle = p_handle AND active = true;
$$;

CREATE OR REPLACE FUNCTION public.search_similar_content(
    p_coach_id uuid,
    p_query_embedding vector(1536),
    p_limit integer DEFAULT 5
)
RETURNS TABLE (
    id uuid,
    content text,
    content_type coach_content_type,
    similarity_score float
)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT 
        cc.id,
        cc.content,
        cc.content_type,
        1 - (cc.embedding <=> p_query_embedding) as similarity_score
    FROM coach_content_chunks cc
    WHERE cc.coach_id = p_coach_id 
        AND cc.processed = true
        AND cc.embedding IS NOT NULL
    ORDER BY cc.embedding <=> p_query_embedding
    LIMIT p_limit;
$$; 