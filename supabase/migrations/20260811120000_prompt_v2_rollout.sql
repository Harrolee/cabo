/*
  Roll every coach onto prompt v2.

  Migration …140000 shipped `coach_profiles.prompt_version` and intended to
  pin existing coaches to 'v1' so nobody's tuned coach changed underneath
  them. That deliberate caution has now been paid off by evidence rather than
  by assumption: `mobile/e2e/prompt-eval/` runs a fixed set of coaching turns
  through both prompt builders and scores them against the specific claims
  made for v2 in `docs/prompts-and-notifications.md` §2.

  It was run twice — once simulating retrieval working, once with retrieval
  returning nothing, which is what production does today while
  `match_coach_content` is broken. Two results hold in both runs, and they are
  what this migration rests on: v1 referenced a member's own goal, obstacle or
  commitment in *zero* of eighteen opportunities where v2 managed five, and v2
  gives one action in two-thirds the words (blind judge 20-4 on single-action).
  Everything else moved between runs, including the judge's overall verdict,
  which is a dead heat under today's conditions. So this is a narrow win on the
  two structural differences rather than a broad one — hence the care taken
  below to make it undoable.

  Not evidence for this change: v2's claim about framing retrieved chunks as
  voice evidence. That cannot be tested while retrieval returns nothing, and
  with chunks injected by hand neither version recited from them.

  Medical handling is a wash — and inadequate in both, which is a
  prompt-independent follow-up, not a reason to stay on v1.

  Two things this migration is careful about.

  1. It is reversible *exactly*. Every row it changes is recorded with the
     value it had, so `revert_prompt_version_rollout()` puts the fleet back
     the way it was rather than blanket-setting 'v1'.

  2. It is idempotent, and it does not fight a human. A coach that has already
     been rolled is in the log, so a later `UPDATE coach_profiles SET
     prompt_version = 'v1'` — a creator opting back — survives this file being
     re-applied.

  Note that on a project where …140000 ran against existing rows, PostgreSQL's
  ADD COLUMN … DEFAULT 'v2' already backfilled them to 'v2' and that file's
  `WHERE prompt_version IS NULL` update matched nothing. On such a project this
  migration correctly finds nothing to do and logs nothing. It is written to be
  right either way rather than to assume which happened.
*/

-- ---------------------------------------------------------------------------
-- What we changed, so we can change it back
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.coach_prompt_version_rollout (
    coach_id         uuid PRIMARY KEY REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
    previous_version text        NOT NULL,
    rolled_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.coach_prompt_version_rollout IS
    'One row per coach moved to prompt v2 by 20260811120000, with the version it held before. Drives revert_prompt_version_rollout().';

-- Ops-only table: no policies, so only the service role (which bypasses RLS)
-- can see it. Members and creators have no business reading it.
ALTER TABLE public.coach_prompt_version_rollout ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- The flip
-- ---------------------------------------------------------------------------

WITH to_roll AS (
    SELECT c.id, COALESCE(c.prompt_version, 'v1') AS previous_version
    FROM public.coach_profiles c
    LEFT JOIN public.coach_prompt_version_rollout r ON r.coach_id = c.id
    WHERE r.coach_id IS NULL                          -- never rolled before
      AND COALESCE(c.prompt_version, 'v1') IS DISTINCT FROM 'v2'
),
logged AS (
    INSERT INTO public.coach_prompt_version_rollout (coach_id, previous_version)
    SELECT id, previous_version FROM to_roll
    ON CONFLICT (coach_id) DO NOTHING
    RETURNING coach_id
)
UPDATE public.coach_profiles
   SET prompt_version = 'v2'
 WHERE id IN (SELECT coach_id FROM logged);

-- ---------------------------------------------------------------------------
-- Undo
-- ---------------------------------------------------------------------------

/**
 * Put every coach this migration touched back on the version it held, and
 * forget the rollout. Safe to call twice; returns how many rows moved.
 *
 *     select public.revert_prompt_version_rollout();
 *
 * To opt a single coach back to v1 without reverting the whole fleet, just
 * update the row — the rollout log means this migration will not undo it:
 *
 *     update public.coach_profiles set prompt_version = 'v1' where id = '…';
 */
CREATE OR REPLACE FUNCTION public.revert_prompt_version_rollout()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.coach_profiles c
     SET prompt_version = r.previous_version
    FROM public.coach_prompt_version_rollout r
   WHERE r.coach_id = c.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  DELETE FROM public.coach_prompt_version_rollout;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.revert_prompt_version_rollout() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revert_prompt_version_rollout() TO service_role;
