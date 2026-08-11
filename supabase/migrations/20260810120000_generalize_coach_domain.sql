/*
  # Generalize the coach model to arbitrary domains

  Until now a "coach" was implicitly a fitness coach: the discipline was baked
  into prompts, the situation vocabulary was workout-shaped ('pre_workout',
  'plateau', 'injury_recovery'), and the roster was the five hardcoded personas.

  This migration makes the discipline a property of the coach row so a drummer,
  a songwriter and a yoga instructor can all live on the same platform:

    1. coach_categories  - extensible lookup so new verticals need no migration
    2. coach_profiles    - discipline, expertise, domain lexicon, session
                           contexts, starter prompts, boundaries, listing state
    3. full-text search over the roster
    4. backfill: every existing coach becomes a 'fitness' coach

  Nothing here is destructive; every existing column keeps its meaning.
*/

-- ---------------------------------------------------------------------------
-- 1. Category lookup
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.coach_categories (
    slug         text PRIMARY KEY,
    label        text NOT NULL,
    description  text,
    emoji        text,
    sort_order   integer DEFAULT 100 NOT NULL,
    active       boolean DEFAULT true NOT NULL,
    created_at   timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT coach_category_slug_format CHECK (slug ~ '^[a-z0-9_]{2,40}$')
);

INSERT INTO public.coach_categories (slug, label, description, emoji, sort_order) VALUES
    ('fitness',   'Fitness & Training',  'Strength, conditioning, running, sport-specific training', '💪', 10),
    ('movement',  'Movement & Body',     'Yoga, pilates, dance, mobility, martial arts',             '🧘', 20),
    ('music',     'Music',               'Instruments, production, songwriting, performance',        '🎸', 30),
    ('creative',  'Creative Practice',   'Writing, visual art, film, design, craft',                 '🎨', 40),
    ('wellness',  'Wellness & Mindset',  'Meditation, sleep, stress, habits, recovery',              '🌿', 50),
    ('nutrition', 'Food & Nutrition',    'Cooking, meal planning, nutrition coaching',               '🥗', 60),
    ('business',  'Work & Business',     'Career, founders, sales, leadership, productivity',        '📈', 70),
    ('academic',  'Learning & Skills',   'Languages, exam prep, technical skills, study habits',     '📚', 80),
    ('lifestyle', 'Lifestyle',           'Style, home, relationships, parenting, finance',           '✨', 90),
    ('other',     'Other',               'Everything that does not fit a bucket yet',                '🌀', 999)
ON CONFLICT (slug) DO UPDATE
    SET label       = EXCLUDED.label,
        description = EXCLUDED.description,
        emoji       = EXCLUDED.emoji,
        sort_order  = EXCLUDED.sort_order;

ALTER TABLE public.coach_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read coach categories" ON public.coach_categories;
CREATE POLICY "Anyone can read coach categories"
    ON public.coach_categories FOR SELECT
    USING (active = true);

GRANT SELECT ON public.coach_categories TO anon, authenticated;
GRANT ALL    ON public.coach_categories TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Domain columns on coach_profiles
-- ---------------------------------------------------------------------------

ALTER TABLE public.coach_profiles
    ADD COLUMN IF NOT EXISTS category_slug        text
        REFERENCES public.coach_categories(slug) ON UPDATE CASCADE,
    -- Human-readable specialty, e.g. 'Jazz drumming', 'Vinyasa yoga', 'Songwriting'.
    ADD COLUMN IF NOT EXISTS discipline           text,
    ADD COLUMN IF NOT EXISTS tagline              text,
    -- What this coach can actually help with. Fed to the model as capabilities.
    ADD COLUMN IF NOT EXISTS expertise            text[] DEFAULT '{}',
    -- Domain vocabulary: { "use": [...], "avoid": [...], "concepts": [...] }
    ADD COLUMN IF NOT EXISTS domain_lexicon       jsonb  DEFAULT '{}',
    -- Discipline-specific situations, replacing the hardcoded workout enum.
    -- A drummer's are 'practice_session' / 'before_a_gig' / 'stuck_on_a_fill'.
    ADD COLUMN IF NOT EXISTS session_contexts     text[] DEFAULT '{}',
    -- First thing an audience member sees when they open a fresh thread.
    ADD COLUMN IF NOT EXISTS intro_message        text,
    ADD COLUMN IF NOT EXISTS starter_prompts      text[] DEFAULT '{}',
    -- Safety rail authored by the creator: what this coach declines to do.
    ADD COLUMN IF NOT EXISTS coaching_boundaries  text,
    -- Roster lifecycle, independent of `public` (which stays for back-compat).
    ADD COLUMN IF NOT EXISTS listing_status       text DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS cover_image_url      text,
    -- Denormalised roster sort signals.
    ADD COLUMN IF NOT EXISTS subscriber_count     integer DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS average_rating       numeric(3,2),
    ADD COLUMN IF NOT EXISTS featured_rank        integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coach_listing_status_valid') THEN
    ALTER TABLE public.coach_profiles
      ADD CONSTRAINT coach_listing_status_valid
      CHECK (listing_status IN ('draft', 'in_review', 'listed', 'unlisted', 'rejected'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Backfill: existing coaches are fitness coaches
-- ---------------------------------------------------------------------------

UPDATE public.coach_profiles
SET category_slug = 'fitness'
WHERE category_slug IS NULL;

ALTER TABLE public.coach_profiles
    ALTER COLUMN category_slug SET DEFAULT 'other';

UPDATE public.coach_profiles
SET discipline = COALESCE(discipline, 'General fitness')
WHERE discipline IS NULL;

-- The five seeded personas keep working, now with an explicit domain.
UPDATE public.coach_profiles SET
    discipline       = 'Mindful movement & recovery',
    category_slug    = 'movement',
    expertise        = ARRAY['yoga', 'meditation', 'stretching', 'mindful walking', 'breathwork'],
    session_contexts = ARRAY['before_practice', 'after_practice', 'feeling_scattered', 'injury_recovery', 'building_a_habit']
WHERE handle = 'zen_master';

UPDATE public.coach_profiles SET
    discipline       = 'Strength training',
    expertise        = ARRAY['weight lifting', 'crossfit', 'HIIT', 'strength programming', 'bodyweight training'],
    session_contexts = ARRAY['pre_workout', 'post_workout', 'plateau', 'deload_week', 'first_time_lifting']
WHERE handle = 'gym_bro';

UPDATE public.coach_profiles SET
    discipline       = 'Dance & expressive movement',
    category_slug    = 'movement',
    expertise        = ARRAY['dance cardio', 'choreography', 'flexibility', 'performance confidence'],
    session_contexts = ARRAY['before_class', 'learning_choreo', 'stage_fright', 'plateau']
WHERE handle = 'dance_teacher';

UPDATE public.coach_profiles SET
    discipline       = 'Bootcamp & endurance',
    expertise        = ARRAY['boot camp training', 'endurance', 'obstacle courses', 'discipline systems'],
    session_contexts = ARRAY['pre_workout', 'post_workout', 'skipped_a_session', 'race_prep']
WHERE handle = 'drill_sergeant';

UPDATE public.coach_profiles SET
    discipline       = 'High-intensity transformation',
    expertise        = ARRAY['transformation challenges', 'power lifting', 'intense cardio'],
    session_contexts = ARRAY['pre_workout', 'post_workout', 'lost_motivation', 'challenge_week']
WHERE handle = 'frat_bro';

-- Anything already flagged public is, by definition, listed.
UPDATE public.coach_profiles
SET listing_status = CASE WHEN public = true AND active = true THEN 'listed' ELSE 'draft' END
WHERE listing_status IS NULL OR listing_status = 'draft';

-- ---------------------------------------------------------------------------
-- 4. Roster search
-- ---------------------------------------------------------------------------

-- Maintained by trigger rather than GENERATED: array_to_string is only STABLE,
-- so a generated column over `expertise` is rejected as non-immutable.
ALTER TABLE public.coach_profiles
    ADD COLUMN IF NOT EXISTS search_document tsvector;

CREATE OR REPLACE FUNCTION public.coach_profiles_refresh_search_document()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_document :=
      setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(NEW.discipline, '')), 'A') ||
      setweight(to_tsvector('english', replace(coalesce(NEW.handle, ''), '_', ' ')), 'B') ||
      setweight(to_tsvector('english', coalesce(NEW.tagline, '')), 'B') ||
      setweight(to_tsvector('english', array_to_string(coalesce(NEW.expertise, '{}'), ' ')), 'B') ||
      setweight(to_tsvector('english', coalesce(NEW.description, '')), 'C');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS coach_profiles_search_document_trigger ON public.coach_profiles;
CREATE TRIGGER coach_profiles_search_document_trigger
    BEFORE INSERT OR UPDATE OF name, discipline, handle, tagline, expertise, description
    ON public.coach_profiles
    FOR EACH ROW EXECUTE PROCEDURE public.coach_profiles_refresh_search_document();

-- Backfill everything that existed before the trigger.
UPDATE public.coach_profiles SET name = name WHERE search_document IS NULL;

CREATE INDEX IF NOT EXISTS coach_profiles_search_idx
    ON public.coach_profiles USING gin (search_document);
CREATE INDEX IF NOT EXISTS coach_profiles_category_idx
    ON public.coach_profiles (category_slug);
CREATE INDEX IF NOT EXISTS coach_profiles_listing_status_idx
    ON public.coach_profiles (listing_status);

-- ---------------------------------------------------------------------------
-- 5. Wider content taxonomy (creators upload lesson notes, not just IG posts)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_value text;
BEGIN
  FOREACH v_value IN ARRAY ARRAY[
    'lesson_notes', 'newsletter', 'course_material', 'qa_transcript',
    'live_session_transcript', 'liner_notes', 'practice_log'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'coach_content_type' AND e.enumlabel = v_value
    ) THEN
      EXECUTE format('ALTER TYPE coach_content_type ADD VALUE %L', v_value);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Comments
-- ---------------------------------------------------------------------------

COMMENT ON TABLE  public.coach_categories IS 'Extensible verticals for the coach roster; add rows, not migrations';
COMMENT ON COLUMN public.coach_profiles.discipline IS 'Free-text specialty, e.g. "Jazz drumming" or "Vinyasa yoga". Injected into the system prompt.';
COMMENT ON COLUMN public.coach_profiles.expertise IS 'What this coach can help with; drives roster copy and prompt capabilities';
COMMENT ON COLUMN public.coach_profiles.domain_lexicon IS 'Domain vocabulary hints: {"use":[],"avoid":[],"concepts":[]}';
COMMENT ON COLUMN public.coach_profiles.session_contexts IS 'Discipline-specific situations replacing the old hardcoded workout enum';
COMMENT ON COLUMN public.coach_profiles.coaching_boundaries IS 'Creator-authored refusal policy, injected into the system prompt';
COMMENT ON COLUMN public.coach_profiles.listing_status IS 'draft | in_review | listed | unlisted | rejected';
