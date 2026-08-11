/*
  # One read path for a member's goals

  `get_member_context()` shipped as `SECURITY DEFINER` granted to `service_role`,
  so only the Cloud Functions could call it. The app therefore read
  `member_goals` directly under RLS and got a different shape back — two
  representations of the same data, drifting apart, and the client's one was
  missing `days_together`, which only this function computes.

  The function wins, because it is the shape the prompt is written against and
  it is the only one that can join `coach_subscriptions` for "how long we have
  been at this". This migration makes it callable by the member themselves:

    1. An ownership guard. `SECURITY DEFINER` bypasses the RLS on
       `member_goals`, so the check RLS would have made has to be made here:
       a caller may only ask for their own context. The service role (which
       carries no `sub` claim, and acts on the member's behalf inside the
       functions) may still ask for anyone.

    2. EXECUTE revoked from PUBLIC. Postgres grants EXECUTE on a new function
       to PUBLIC by default, so the original `GRANT ... TO service_role` never
       actually kept anybody out — `anon` could already have read any member's
       goals given their user id. The guard above closes that; the REVOKE means
       an unauthenticated caller cannot even reach it.

    3. `goal_id` added to the payload, so one round trip distinguishes "the
       intake has never run" from "the row exists but is still empty", which
       is what the goals screen keys its empty state off. It also saves
       `coach-visualizer` a second query for the same id.

  Writes are unchanged: the member still updates `member_goals` directly under
  the "Members manage their own goals" policy.
*/

CREATE OR REPLACE FUNCTION public.get_member_context(p_user_id uuid, p_coach_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_role   text := COALESCE(auth.jwt() ->> 'role', '');
  v_result jsonb;
BEGIN
  IF v_role <> 'service_role' AND (v_caller IS NULL OR v_caller <> p_user_id) THEN
    RAISE EXCEPTION 'Not authorized to read another member''s context'
      USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
      'goal_id',        mg.id,
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
      'days_together',  GREATEST(0, COALESCE(EXTRACT(DAY FROM now() - cs.created_at)::int, 0))
  )
  INTO v_result
  FROM public.user_profiles up
  LEFT JOIN public.member_goals mg
         ON mg.user_id = p_user_id AND mg.coach_id = p_coach_id
  LEFT JOIN public.coach_subscriptions cs
         ON cs.user_id = p_user_id AND cs.coach_id = p_coach_id
  WHERE up.user_id = p_user_id
  LIMIT 1;

  RETURN v_result;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_member_context(uuid, uuid) FROM PUBLIC;
REVOKE ALL    ON FUNCTION public.get_member_context(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_member_context(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_member_context(uuid, uuid)
    IS 'The single read path for a member''s goals: the prompt, the visualiser and the app all call this. Callers may only ask for themselves; the service role may ask for anyone.';
