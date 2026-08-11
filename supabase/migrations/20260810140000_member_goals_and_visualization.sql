/*
  # Goals, prompt versioning, and "who you want to become" visualisation

  Two gaps this closes:

  1. The coach knew who *it* was but nothing about who it was talking to. Every
     reply was generated from the coach's persona alone, so it could not
     reference the person's actual goal, level, or obstacles. `member_goals`
     captures that once, conversationally, and the prompt reads it on every turn.

  2. Image generation was hardwired to fitness before/after pairs from a fixed
     scenario table. The interesting thing to render is not "thinner" — it is
     the identity the person said they are working toward. A drummer wants to
     see themselves playing a packed room; a songwriter wants to see the
     finished record. `member_goals.aspiration` drives that, and
     `coach_visualizations` records what was made.

  Also adds `coach_profiles.prompt_version` so the rebuilt prompt can ship
  alongside the 2024 one rather than replacing it in place.
*/

-- ---------------------------------------------------------------------------
-- 1. What the member is here for
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.member_goals (
    id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at  timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at  timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,

    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    coach_id    uuid NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,

    -- The identity statement. First person, present tense, concrete:
    -- "someone who can sit in with any band and hold the pocket all night".
    -- This is the single most important field: it grounds the coaching AND it
    -- is what the visualiser renders.
    aspiration      text,
    -- Concrete outcomes they named, e.g. 'play a gig by spring'.
    goals           text[] DEFAULT '{}',
    -- Where they are starting from, in their own words.
    current_level   text,
    -- What has stopped them before. The most useful thing a coach can know.
    obstacles       text[] DEFAULT '{}',
    -- Why it matters to them.
    motivation      text,
    horizon         text,
    -- {"days_per_week": 4, "minutes_per_session": 30}
    commitment      jsonb  DEFAULT '{}',
    -- Accumulated over time by the coach, not asked for up front.
    wins            text[] DEFAULT '{}',

    /*
      How to picture them, for image generation:
        self        - how they want to be depicted
        setting     - where the aspirational scene happens
        style       - photographic / illustrated / cinematic
        avoid       - anything they do not want rendered
      Falls back to user_profiles.image_preference when empty.
    */
    visual          jsonb DEFAULT '{}',

    onboarding_status text DEFAULT 'not_started' NOT NULL,
    onboarding_turns  integer DEFAULT 0 NOT NULL,
    -- Anything the extractor picked up that has no column of its own.
    notes           jsonb DEFAULT '{}',

    CONSTRAINT onboarding_status_valid
        CHECK (onboarding_status IN ('not_started', 'in_progress', 'complete', 'skipped')),
    UNIQUE (user_id, coach_id)
);

CREATE INDEX IF NOT EXISTS member_goals_user_idx  ON public.member_goals(user_id);
CREATE INDEX IF NOT EXISTS member_goals_coach_idx ON public.member_goals(coach_id);

DROP TRIGGER IF EXISTS handle_member_goals_updated_at ON public.member_goals;
CREATE TRIGGER handle_member_goals_updated_at
    BEFORE UPDATE ON public.member_goals
    FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Creator-authored intake, per discipline
-- ---------------------------------------------------------------------------

ALTER TABLE public.coach_profiles
    /*
      What this coach asks a new member. A drum teacher opens with "what do you
      play along to?"; a songwriter opens with "what's the last thing you
      finished?". Left empty, the onboarding falls back to a generic set.
    */
    ADD COLUMN IF NOT EXISTS onboarding_questions text[] DEFAULT '{}',
    -- 'v1' is the 2024 single-string prompt; 'v2' is the rebuilt one.
    -- Deliberately added WITHOUT a default: a default would be materialised into
    -- every existing row, so the 'v1' backfill below could never match and every
    -- coach already in production would be silently switched to the v2 prompt.
    -- The default is set to 'v2' after the backfill instead.
    ADD COLUMN IF NOT EXISTS prompt_version       text,
    -- Creator opt-out: some coaches are drop-in, not goal-driven.
    ADD COLUMN IF NOT EXISTS collects_goals       boolean DEFAULT true NOT NULL,
    ADD COLUMN IF NOT EXISTS supports_visualization boolean DEFAULT true NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_version_valid') THEN
    ALTER TABLE public.coach_profiles
      ADD CONSTRAINT prompt_version_valid CHECK (prompt_version IN ('v1', 'v2'));
  END IF;
END $$;

-- Existing coaches keep the prompt they were tuned against; only new rows
-- default to v2. Flip a coach with: update coach_profiles set prompt_version='v2'.
UPDATE public.coach_profiles SET prompt_version = 'v1' WHERE prompt_version IS NULL;

-- Only now does 'v2' become the default, so it applies to rows created from
-- here on rather than retroactively to the existing roster.
ALTER TABLE public.coach_profiles ALTER COLUMN prompt_version SET DEFAULT 'v2';

UPDATE public.coach_profiles SET onboarding_questions = ARRAY[
    'What are you hoping to be able to do that you can''t do yet?',
    'Where are you starting from right now?',
    'What has got in the way before?',
    'How much time can you realistically give this each week?'
] WHERE onboarding_questions = '{}' OR onboarding_questions IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Generated visualisations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.coach_visualizations (
    id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at   timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,

    user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    coach_id     uuid REFERENCES public.coach_profiles(id) ON DELETE SET NULL,
    goal_id      uuid REFERENCES public.member_goals(id) ON DELETE SET NULL,

    -- 'becoming'  the aspirational scene
    -- 'milestone' a specific goal, achieved
    -- 'today'     a small scene from the practice itself
    kind         text DEFAULT 'becoming' NOT NULL,
    scene        text,
    image_prompt text,
    image_url    text,
    model        text,
    status       text DEFAULT 'pending' NOT NULL,
    error        text,
    -- Whether the member kept it. Feeds "your wall" in the app.
    saved        boolean DEFAULT false NOT NULL,

    CONSTRAINT visualization_kind_valid   CHECK (kind IN ('becoming', 'milestone', 'today')),
    CONSTRAINT visualization_status_valid CHECK (status IN ('pending', 'ready', 'failed'))
);

CREATE INDEX IF NOT EXISTS coach_visualizations_user_idx
    ON public.coach_visualizations(user_id, created_at DESC);

-- Where the member's reference photo lives, so PhotoMaker can keep their face.
ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS reference_photo_url text,
    -- Explicit consent: their likeness is only used if they say so.
    ADD COLUMN IF NOT EXISTS likeness_consent    boolean DEFAULT false NOT NULL;

COMMENT ON COLUMN public.user_profiles.likeness_consent
    IS 'Member opted in to having their own face used in generated visualisations';

-- ---------------------------------------------------------------------------
-- 4. Reads the app and the functions need
-- ---------------------------------------------------------------------------

/** Everything the prompt needs about a member, in one round trip. */
CREATE OR REPLACE FUNCTION public.get_member_context(p_user_id uuid, p_coach_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'display_name',   COALESCE(up.display_name, up.full_name),
        'timezone',       up.timezone,
        'aspiration',     mg.aspiration,
        'goals',          COALESCE(mg.goals, '{}'),
        'current_level',  mg.current_level,
        'obstacles',      COALESCE(mg.obstacles, '{}'),
        'motivation',     mg.motivation,
        'horizon',        mg.horizon,
        'commitment',     COALESCE(mg.commitment, '{}'::jsonb),
        'wins',           COALESCE(mg.wins, '{}'),
        'visual',         COALESCE(mg.visual, '{}'::jsonb),
        'onboarding_status', COALESCE(mg.onboarding_status, 'not_started'),
        'onboarding_turns',  COALESCE(mg.onboarding_turns, 0),
        'days_together',  GREATEST(0, EXTRACT(DAY FROM now() - cs.created_at)::int)
    )
    FROM public.user_profiles up
    LEFT JOIN public.member_goals mg
           ON mg.user_id = p_user_id AND mg.coach_id = p_coach_id
    LEFT JOIN public.coach_subscriptions cs
           ON cs.user_id = p_user_id AND cs.coach_id = p_coach_id
    WHERE up.user_id = p_user_id
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_member_context(uuid, uuid) TO service_role;

/** Idempotent start for the intake conversation. */
CREATE OR REPLACE FUNCTION public.begin_goal_onboarding(p_coach_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  INSERT INTO public.member_goals (user_id, coach_id, onboarding_status)
  VALUES (v_user_id, p_coach_id, 'in_progress')
  ON CONFLICT (user_id, coach_id) DO UPDATE
    SET onboarding_status = CASE
          WHEN public.member_goals.onboarding_status = 'complete' THEN 'complete'
          ELSE 'in_progress'
        END
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.begin_goal_onboarding(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.member_goals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_visualizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members manage their own goals" ON public.member_goals;
CREATE POLICY "Members manage their own goals"
    ON public.member_goals FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Members read their own visualizations" ON public.coach_visualizations;
CREATE POLICY "Members read their own visualizations"
    ON public.coach_visualizations FOR SELECT
    USING (user_id = auth.uid());

-- Members may only flip `saved`; the row itself is written by the generator.
DROP POLICY IF EXISTS "Members can save their own visualizations" ON public.coach_visualizations;
CREATE POLICY "Members can save their own visualizations"
    ON public.coach_visualizations FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_goals         TO authenticated;
GRANT SELECT, UPDATE                 ON public.coach_visualizations TO authenticated;
GRANT ALL ON public.member_goals         TO service_role;
GRANT ALL ON public.coach_visualizations TO service_role;

COMMENT ON TABLE public.member_goals
    IS 'What each member wants from each coach. Gathered conversationally, read by the prompt on every turn.';
COMMENT ON COLUMN public.member_goals.aspiration
    IS 'First-person identity statement. Grounds the coaching and drives the visualiser.';
COMMENT ON TABLE public.coach_visualizations
    IS 'Generated images of the member inhabiting the identity in member_goals.aspiration';
