/*
  # Account deletion

  App Store Review Guideline 5.1.1(v): an app that creates accounts must let
  people delete them from inside the app. Cabo creates them two ways (Sign in
  with Apple, email OTP) and had no delete path at all.

  This is not only a compliance chore. `member_goals` holds what someone is
  struggling with, `conversation_messages` holds their coaching history, and
  `user_profiles.reference_photo_url` points at a photograph of their face. A
  member who asks to be deleted has to actually be deleted.

  Three things live here:

    1. Two foreign keys that would have made deletion catastrophic.
    2. `delete_member_account(uuid)` — the whole public-schema cascade, in one
       transaction, callable only by the service role.
    3. A policy for coaches the departing member created, because "cascade" and
       "orphan" are both wrong answers there.

  The storage object behind `reference_photo_url` is *not* deleted here — SQL
  cannot reach a GCS bucket. `functions/account-deletion` deletes the object
  first and calls this function second, which is the same ordering the likeness
  revocation path in `coach-visualizer` uses and for the same reason: an erasure
  that only cleared a pointer is not an erasure.
*/

-- ---------------------------------------------------------------------------
-- 1. Two foreign keys that turned "delete one member" into "delete the roster"
-- ---------------------------------------------------------------------------

/*
  `coach_profiles` was written when a coach belonged to the account that built
  it, before creators existed and before anybody could subscribe to somebody
  else's coach. Both of its owner links cascade:

      user_id    uuid REFERENCES auth.users(id)          ON DELETE CASCADE
      user_email text REFERENCES user_profiles(email)     ON DELETE CASCADE

  So deleting one auth.users row silently deletes every coach that person owns,
  and each of those cascades into `coach_subscriptions`, `conversations`,
  `conversation_messages`, `member_goals`, `coach_content_chunks`,
  `coach_iap_products` and `coach_nudges` — for *other people*, who are paying
  Apple for that coach every month.

  Worse in practice: `20250531093301_add_predefined_coaches.sql` seeded the five
  default personas against the founder's own `user_profiles` row, and
  `20260811090100` deliberately left `user_email` alone when it repointed their
  attribution at the platform creator. The founder deleting their own account
  would have taken Zen Master, Gym Bro, Dance Teacher, Drill Sergeant and Frat
  Bro with it.

  Ownership is a link, not a life dependency. Both become SET NULL, which means
  the worst case is now an unowned coach rather than a deleted one — and
  `delete_member_account` below never leans on either, it decides explicitly.
*/

ALTER TABLE public.coach_profiles DROP CONSTRAINT IF EXISTS coach_profiles_user_id_fkey;
ALTER TABLE public.coach_profiles
    ADD CONSTRAINT coach_profiles_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- NOT NULL has to go with it: SET NULL cannot fire on a NOT NULL column, and a
-- detached coach genuinely has no owner email to record.
ALTER TABLE public.coach_profiles ALTER COLUMN user_email DROP NOT NULL;

ALTER TABLE public.coach_profiles DROP CONSTRAINT IF EXISTS coach_profiles_user_email_fkey;
ALTER TABLE public.coach_profiles
    ADD CONSTRAINT coach_profiles_user_email_fkey
    FOREIGN KEY (user_email) REFERENCES public.user_profiles(email) ON DELETE SET NULL;

COMMENT ON COLUMN public.coach_profiles.user_email
    IS 'Legacy owner link, read by the pre-creator RLS policies. NULL once the owning account is deleted; attribution comes from creator_id.';

/*
  The RLS policies that read `user_email` compare it with
  `lower(auth.jwt() ->> ''email'')`. NULL never equals anything, so a detached
  coach simply has no owner by that route — which is the intent. The `user_id`
  branch behaves the same way. No policy needs changing.
*/

-- ---------------------------------------------------------------------------
-- 2. The cascade
-- ---------------------------------------------------------------------------

/*
  One function rather than a list of DELETEs in JavaScript, for three reasons:
  it is a single transaction (a half-deleted account is worse than a live one),
  it can read `auth.users` to catch legacy profile rows that were never linked
  by `user_id`, and the ordering constraints below live next to the schema they
  depend on instead of in a comment in another language.

  Returns a JSON summary so the caller can log what actually went, and so the
  probe can assert on it.

  Not deleted here, on purpose:
    * the `auth.users` row — the caller does that through GoTrue's admin API so
      identities, sessions and refresh tokens go with it;
    * the reference photo object — the caller deletes that first.
*/
CREATE OR REPLACE FUNCTION public.delete_member_account(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email        text;
  v_emails       text[];
  v_phones       text[];
  v_creator_ids  uuid[];
  v_coach        record;
  v_deleted      jsonb := '{}'::jsonb;
  v_n            integer;
  v_coaches_deleted  uuid[] := '{}';
  v_coaches_retained uuid[] := '{}';
  v_coaches_detached uuid[] := '{}';
  v_creators_deleted uuid[] := '{}';
  v_creators_kept    uuid[] := '{}';
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'delete_member_account requires a user id';
  END IF;

  -- The auth row is the identity; the email is how the legacy, phone-era rows
  -- are linked. Read it before anything else deletes it.
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = p_user_id;

  /*
    A member may hold more than one `user_profiles` row historically: one keyed
    by `user_id` (app sign-in) and one keyed by `email` or by `id` = the auth id
    (the SMS funnel, and `handle_new_user`'s ON CONFLICT (id) insert). Collect
    every address and phone they own so nothing is missed.
  */
  SELECT array_agg(DISTINCT lower(email)) FILTER (WHERE email IS NOT NULL),
         array_agg(DISTINCT phone_number) FILTER (WHERE phone_number IS NOT NULL)
    INTO v_emails, v_phones
    FROM public.user_profiles
   WHERE user_id = p_user_id
      OR id = p_user_id
      OR (v_email IS NOT NULL AND lower(email) = v_email);

  v_emails := COALESCE(v_emails, '{}');
  IF v_email IS NOT NULL AND NOT (v_email = ANY(v_emails)) THEN
    v_emails := v_emails || v_email;
  END IF;
  v_phones := COALESCE(v_phones, '{}');

  SELECT COALESCE(array_agg(id), '{}') INTO v_creator_ids
    FROM public.creator_profiles
   WHERE user_id = p_user_id
      OR (array_length(v_emails, 1) IS NOT NULL AND lower(user_email) = ANY(v_emails));

  -- -------------------------------------------------------------------------
  -- 2a. Coaches this member owns
  -- -------------------------------------------------------------------------
  /*
    Three outcomes, and the difference matters:

      detached  The coach is attributed to somebody else's creator — most
                importantly the platform creator, which owns the five default
                personas but still carries the founder's address in the legacy
                `user_email` column. Only the personal link is cut.

      retained  Their own coach, but other members are subscribed to it. Those
                people are paying Apple monthly; deleting it would take their
                threads and their goals with it. The coach stays and keeps
                working for its existing subscribers, unowned and unlisted so
                nobody new can subscribe to a coach with nobody behind it.

      deleted   Their own coach that nobody else uses. Their creation, their
                data, and no one is harmed by it going.
  */
  FOR v_coach IN
    SELECT cp.id, cp.creator_id
      FROM public.coach_profiles cp
     WHERE cp.user_id = p_user_id
        OR (array_length(v_emails, 1) IS NOT NULL AND lower(cp.user_email) = ANY(v_emails))
        OR (array_length(v_creator_ids, 1) IS NOT NULL AND cp.creator_id = ANY(v_creator_ids))
  LOOP
    IF v_coach.creator_id IS NOT NULL
       AND NOT (v_coach.creator_id = ANY(v_creator_ids)) THEN
      UPDATE public.coach_profiles
         SET user_id = NULL, user_email = NULL
       WHERE id = v_coach.id;
      v_coaches_detached := v_coaches_detached || v_coach.id;

    ELSIF EXISTS (
        SELECT 1 FROM public.coach_subscriptions cs
         WHERE cs.coach_id = v_coach.id AND cs.user_id <> p_user_id
      ) OR EXISTS (
        SELECT 1 FROM public.conversations c
         WHERE c.coach_id = v_coach.id AND c.user_id <> p_user_id
      ) THEN
      UPDATE public.coach_profiles
         SET user_id        = NULL,
             user_email     = NULL,
             listing_status = 'unlisted'
       WHERE id = v_coach.id;
      v_coaches_retained := v_coaches_retained || v_coach.id;

    ELSE
      -- Cascades coach_content_chunks, coach_test_messages, coach_iap_products,
      -- coach_prompt_version_rollout, and this member's own rows against it.
      DELETE FROM public.coach_profiles WHERE id = v_coach.id;
      v_coaches_deleted := v_coaches_deleted || v_coach.id;
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 2b. The member's own rows
  -- -------------------------------------------------------------------------
  /*
    Ordered leaf-first. Every one of these would also fall out of the
    `auth.users` cascade, but doing it here means it happens in this
    transaction, it happens even for the legacy rows that were never linked to
    `auth.users` at all, and the row counts are reportable.
  */

  DELETE FROM public.coach_nudges WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('coach_nudges', v_n);

  DELETE FROM public.coach_visualizations WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('coach_visualizations', v_n);

  DELETE FROM public.conversation_messages
   WHERE conversation_id IN (SELECT id FROM public.conversations WHERE user_id = p_user_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('conversation_messages', v_n);

  DELETE FROM public.conversations WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('conversations', v_n);

  DELETE FROM public.member_goals WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('member_goals', v_n);

  -- The AFTER DELETE trigger on this table recomputes
  -- coach_profiles.subscriber_count per row, so the roster's counts stay honest
  -- without anything here touching them.
  DELETE FROM public.coach_subscriptions WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('coach_subscriptions', v_n);

  DELETE FROM public.push_devices WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('push_devices', v_n);

  /*
    The legacy Stripe/SMS subscription. `subscriptions.user_phone` references
    `user_profiles(phone_number)` with no ON DELETE action at all, so leaving
    one behind does not orphan anything — it makes the `user_profiles` delete
    below fail outright.
  */
  IF array_length(v_phones, 1) IS NOT NULL THEN
    DELETE FROM public.subscriptions WHERE user_phone = ANY(v_phones);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('subscriptions', v_n);
  ELSE
    v_deleted := v_deleted || jsonb_build_object('subscriptions', 0);
  END IF;

  -- -------------------------------------------------------------------------
  -- 2c. Creator profile
  -- -------------------------------------------------------------------------
  /*
    `creator_profiles.user_id` is already ON DELETE SET NULL, which by itself
    would leave the row sitting there with the person's name, bio, avatar,
    email and payout account in it. That is not deletion.

    If nothing points at it any more, it goes. If a retained coach still needs a
    creator to be attributed to, the row survives with every personal field
    replaced — the slug too, because slugs are usually somebody's name and they
    appear in the public roster.
  */
  IF array_length(v_creator_ids, 1) IS NOT NULL THEN
    FOR v_coach IN SELECT unnest(v_creator_ids) AS id LOOP
      IF EXISTS (SELECT 1 FROM public.coach_profiles WHERE creator_id = v_coach.id) THEN
        UPDATE public.creator_profiles
           SET user_id           = NULL,
               user_email        = 'deleted@invalid',
               display_name      = 'Former creator',
               -- The slug check caps the whole thing at 40 characters, so the
               -- id is truncated; 16 hex digits is still unique in practice and
               -- the row keeps its real id anyway.
               slug              = 'former-creator-' || left(replace(v_coach.id::text, '-', ''), 16),
               bio               = NULL,
               avatar_url        = NULL,
               website_url       = NULL,
               social_links      = '{}'::jsonb,
               payout_provider   = NULL,
               payout_account_id = NULL,
               status            = 'suspended'
         WHERE id = v_coach.id;
        v_creators_kept := v_creators_kept || v_coach.id;
      ELSE
        DELETE FROM public.creator_profiles WHERE id = v_coach.id;
        v_creators_deleted := v_creators_deleted || v_coach.id;
      END IF;
    END LOOP;
  END IF;

  -- -------------------------------------------------------------------------
  -- 2d. The profile itself
  -- -------------------------------------------------------------------------
  /*
    Last, because `coach_profiles.user_email` referenced it and `subscriptions`
    still does. `id = p_user_id` catches the rows `handle_new_user` created
    before `user_id` existed as a column.
  */
  DELETE FROM public.user_profiles
   WHERE user_id = p_user_id
      OR id = p_user_id
      OR (array_length(v_emails, 1) IS NOT NULL AND lower(email) = ANY(v_emails));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('user_profiles', v_n);

  RETURN jsonb_build_object(
    'user_id',           p_user_id,
    'deleted',           v_deleted,
    'coaches_deleted',   to_jsonb(v_coaches_deleted),
    'coaches_retained',  to_jsonb(v_coaches_retained),
    'coaches_detached',  to_jsonb(v_coaches_detached),
    'creators_deleted',  to_jsonb(v_creators_deleted),
    'creators_retained', to_jsonb(v_creators_kept)
  );
END;
$$;

COMMENT ON FUNCTION public.delete_member_account(uuid)
    IS 'Erases every public-schema row belonging to a member, in one transaction. The caller deletes the reference photo object first and the auth.users row afterwards. Service role only.';

/*
  Service role only, and explicitly revoked from everyone else. A member cannot
  be allowed to call this with somebody else''s id, and the function takes the
  id as an argument rather than reading auth.uid() precisely because its only
  caller has no end user on the request.
*/
REVOKE ALL ON FUNCTION public.delete_member_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_member_account(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_member_account(uuid) TO service_role;
