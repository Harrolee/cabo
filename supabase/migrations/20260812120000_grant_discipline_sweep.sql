-- ---------------------------------------------------------------------------
-- Grant discipline sweep (issue #25)
--
-- Four agents independently hit the same class of bug: a missing, over-broad or
-- unenforced grant. This migration closes the class rather than another
-- instance of it.
--
-- The root cause is that Postgres grants EXECUTE on every new function to
-- PUBLIC by default. A `GRANT EXECUTE ... TO service_role` sitting next to a
-- SECURITY DEFINER function therefore excludes nobody: the function stays
-- callable by `anon`, and `anon`'s key ships in the web bundle.
--
-- Verified against a from-scratch stack before this migration, using only the
-- anon key over PostgREST:
--
--   * due_coach_nudges(int)        returned another member's user_id,
--                                 display_name, coach name and discipline.
--                                 It has no auth.uid() filter at all -- it was
--                                 written as a service_role dispatcher query.
--                                 This is the serious one: it discloses that a
--                                 named person is being coached, and on what.
--   * consume_free_message(uuid,uuid)
--                                 incremented a member's messages_used three
--                                 times over three unauthenticated calls,
--                                 exhausting their free tier.
--   * has_coach_access(uuid,uuid) returned true for an arbitrary member id --
--                                 an entitlement oracle, and the id needed to
--                                 drive it leaks from due_coach_nudges.
--   * check_subscription_access(text), get_trial_days_remaining(text),
--     can_publish_coaches(text)   answer questions about an arbitrary email.
--
-- Functions whose bodies are already scoped by auth.uid() (register_push_device,
-- release_push_device, open_coach_conversation, ...) were callable but not
-- exploitable -- release_push_device returned 204 and changed nothing. They are
-- revoked here anyway: "the body happens to check" is not an access control.
--
-- Idempotent: every statement is REVOKE/GRANT/DROP ... IF EXISTS or a DO block
-- that recomputes from catalog state, so this re-applies cleanly.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Legacy phone-based policies on coach_profiles
--
-- These predate the multi-domain work and match a coach to its owner by
-- looking the caller's phone number up in user_profiles. An RLS predicate is
-- evaluated as the *invoking* role, so their mere existence forces every
-- reader of coach_profiles -- including anon -- to hold SELECT on
-- user_profiles. anon does not, and must not.
--
-- That is why the coach detail query fails with
-- `permission denied for table user_profiles` on a from-scratch stack: four
-- assertions in rls-probe.mjs, all one root cause.
--
-- They are redundant. "Owners can {view,update,delete} coaches by uid" already
-- match on user_id = auth.uid() OR user_email = the JWT email, and the legacy
-- policies join through that same user_email. Dropping them removes the
-- user_profiles dependency without narrowing owner access.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view their own coaches"   ON public.coach_profiles;
DROP POLICY IF EXISTS "Users can update their own coaches" ON public.coach_profiles;
DROP POLICY IF EXISTS "Users can delete their own coaches" ON public.coach_profiles;
DROP POLICY IF EXISTS "Users can create coaches"           ON public.coach_profiles;

-- ---------------------------------------------------------------------------
-- 2. Revoke the PUBLIC default from every SECURITY DEFINER function
--
-- Done from the catalog rather than by listing names, so a function added by a
-- migration that forgets its REVOKE is still covered on the next deploy. The
-- deliberate grants are re-applied in section 3; anything not named there ends
-- up callable by nobody but its owner, which is the correct default.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_depend d
           ON d.objid = p.oid
          AND d.classid = 'pg_proc'::regclass
          AND d.deptype = 'e'          -- extension-owned; leave alone
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND d.objid IS NULL
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Deliberate grants
--
-- The full intended matrix lives in docs/grant-matrix.md. Anything absent from
-- this list is intentionally callable only by its owner and service_role.
-- ---------------------------------------------------------------------------

-- 3a. Public surface. Deliberately reachable by a logged-out visitor: this is
--     the marketing/roster path, and every one of these reads only listed,
--     active coaches.
GRANT EXECUTE ON FUNCTION public.get_coach_roster(text, text, integer, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_coach_by_handle(text)                      TO anon, authenticated, service_role;

-- 3b. Caller-scoped. Bodies filter on auth.uid(); granted to authenticated only.
GRANT EXECUTE ON FUNCTION public.begin_goal_onboarding(uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_coaches()                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_coach_conversation(uuid)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_push_device(text, text, text, text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_push_device(text)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_slug_available(text)                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owns_coach(uuid)                               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unread_message_count(uuid)                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_coach_access(uuid, uuid)                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_member_context(uuid, uuid)                 TO authenticated, service_role;

-- 3c. Backend only. No client role has any business calling these.
GRANT EXECUTE ON FUNCTION public.due_coach_nudges(integer)                      TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_free_message(uuid, uuid)               TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_member_account(uuid)                    TO service_role;
GRANT EXECUTE ON FUNCTION public.revert_prompt_version_rollout()                TO service_role;
GRANT EXECUTE ON FUNCTION public.create_user_with_trial(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_or_create_user(text, text, text)           TO service_role;
GRANT EXECUTE ON FUNCTION public.check_subscription_access(text)                TO service_role;
GRANT EXECUTE ON FUNCTION public.get_trial_days_remaining(text)                 TO service_role;
GRANT EXECUTE ON FUNCTION public.can_publish_coaches(text)                      TO service_role;
GRANT EXECUTE ON FUNCTION public.search_similar_content(uuid, vector, integer)  TO service_role;

-- Trigger functions are never invoked directly -- Postgres refuses a plain
-- SELECT of a function returning `trigger` -- so the revoke above costs
-- nothing and is left in place without a matching grant. Triggers themselves
-- continue to fire as the table owner regardless of EXECUTE grants.

-- ---------------------------------------------------------------------------
-- 4. has_coach_access: stop authenticated callers probing other members
--
-- Revoking anon closes the unauthenticated oracle, but the function still took
-- an arbitrary p_user_id from any logged-in caller. Guard it: when there is a
-- JWT subject, it must be asking about itself. service_role and the internal
-- SECURITY DEFINER callers (due_coach_nudges) run with auth.uid() = NULL and
-- are unaffected.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_coach_access(p_user_id uuid, p_coach_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    -- Guard only. The entitlement logic below is unchanged from
    -- 20260810120100_creators_and_coach_subscriptions.sql; if you edit one,
    -- edit both.
    SELECT CASE WHEN auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN false ELSE (
        EXISTS (
            SELECT 1
            FROM public.coach_subscriptions cs
            WHERE cs.user_id = p_user_id
              AND cs.coach_id = p_coach_id
              AND (
                    -- Paid / comped: access follows the entitlement window.
                    (cs.source <> 'free_tier'
                      AND cs.status IN ('active', 'trialing', 'grace_period')
                      AND (cs.current_period_end IS NULL OR cs.current_period_end > now()))
                    -- Free tier is metered, not timed: it ends when the quota is
                    -- burned, regardless of the 'trialing' status on the row.
                    OR (cs.source = 'free_tier' AND cs.messages_used < cs.free_message_quota)
                  )
        )
        -- A creator always has access to their own coaches.
        OR EXISTS (
            SELECT 1
            FROM public.coach_profiles cp
            JOIN public.creator_profiles cr ON cr.id = cp.creator_id
            WHERE cp.id = p_coach_id AND cr.user_id = p_user_id
        )
    ) END;
$$;

REVOKE ALL ON FUNCTION public.has_coach_access(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_coach_access(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Explicit table grants for the legacy tables
--
-- Tables predating the multi-domain work inherited whatever the local stack
-- happened to allow. State the intent instead.
-- ---------------------------------------------------------------------------

REVOKE ALL ON public.user_profiles FROM anon;
REVOKE ALL ON public.subscriptions FROM anon;
GRANT SELECT, UPDATE                 ON public.user_profiles TO authenticated;
GRANT SELECT                         ON public.subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Drift detector
--
-- Returns one row per SECURITY DEFINER function in `public` that PUBLIC or anon
-- can still execute, minus a documented allowlist. rls-probe.mjs asserts this
-- is empty, so a future migration that adds a SECURITY DEFINER function without
-- a REVOKE fails the probes instead of shipping.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.security_definer_grant_audit()
RETURNS TABLE (function_signature text, offending_role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p.oid::regprocedure::text, r.rolename
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_depend d
           ON d.objid = p.oid
          AND d.classid = 'pg_proc'::regclass
          AND d.deptype = 'e'
    CROSS JOIN LATERAL (VALUES ('public'), ('anon')) AS r(rolename)
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND d.objid IS NULL
      AND has_function_privilege(r.rolename, p.oid, 'EXECUTE')
      -- Deliberately public: the logged-out roster and coach detail pages.
      AND p.oid::regprocedure::text NOT IN (
            'get_coach_roster(text,text,integer,integer)',
            'get_coach_by_handle(text)'
          )
    ORDER BY 1, 2;
$$;

REVOKE ALL ON FUNCTION public.security_definer_grant_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_definer_grant_audit() TO service_role;
