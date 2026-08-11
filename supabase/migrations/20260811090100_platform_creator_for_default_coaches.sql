/*
  # The default coaches belong to the platform, not to a person

  `20250531093301_add_predefined_coaches.sql` seeded the five original personas
  (Zen Master, Gym Bro, Dance Teacher, Drill Sergeant, Frat Bro) against
  whichever `user_profiles` row belonged to the founder's own phone number, and
  `20260810120100_creators_and_coach_subscriptions.sql` then backfilled a
  `creator_profiles` row for every account that owned a coach. Net effect: the
  platform's own default coaches are attributed to one person's personal
  account, and `get_coach_roster()` shows their name under all five.

  This introduces a creator that is the platform — `user_id IS NULL`, so it is
  not tied to any auth account, nobody can sign in "as" it, and the
  "creator always has access to their own coaches" branch of `has_coach_access`
  cannot match it — and repoints the five seeded coaches at it.

  What this deliberately does not touch: `coach_profiles.user_email`, which is
  `NOT NULL REFERENCES user_profiles(email)` and therefore cannot be pointed at
  an account that does not exist. Attribution in the roster comes from
  `creator_id`, which is what this fixes; `user_email` stays as the legacy
  owner link that the pre-creator RLS policies still read.

  Idempotent, and a no-op in three separate ways: on a database where the seed
  never ran (the original migration skips itself when that phone number is
  absent, so the five rows may not exist at all), on a re-run, and if the
  `cabo` slug has somehow been claimed by a real creator.
*/

DO $$
DECLARE
  -- Fixed so re-runs and other environments converge on the same row.
  v_platform_id  uuid := '00000000-0000-4000-8000-0000000000ca';
  v_creator_id   uuid;
  v_repointed    integer;
BEGIN
  INSERT INTO public.creator_profiles (
      id, user_id, user_email, display_name, slug, bio, status, revenue_share_bps
  )
  SELECT
      v_platform_id,
      NULL,
      -- Not a mailbox anyone signs in with; the column is NOT NULL and is only
      -- used for payout correspondence, which the platform does not need.
      'coaches@cabo.fit',
      'Cabo',
      'cabo',
      'The default coaches that ship with Cabo.',
      'approved',
      -- The platform is not paying itself a creator share.
      0
  WHERE NOT EXISTS (
      SELECT 1 FROM public.creator_profiles WHERE id = v_platform_id OR slug = 'cabo'
  );

  SELECT id INTO v_creator_id
  FROM public.creator_profiles
  WHERE id = v_platform_id AND user_id IS NULL;

  IF v_creator_id IS NULL THEN
    RAISE NOTICE 'Platform creator not available (slug "cabo" is held by someone else); leaving coach attribution alone.';
    RETURN;
  END IF;

  UPDATE public.coach_profiles
  SET creator_id = v_creator_id
  WHERE id IN (
      '11111111-1111-1111-1111-111111111111',  -- Zen Master
      '22222222-2222-2222-2222-222222222222',  -- Gym Bro
      '33333333-3333-3333-3333-333333333333',  -- Dance Teacher
      '44444444-4444-4444-4444-444444444444',  -- Drill Sergeant
      '55555555-5555-5555-5555-555555555555'   -- Frat Bro
    )
    AND creator_id IS DISTINCT FROM v_creator_id;

  GET DIAGNOSTICS v_repointed = ROW_COUNT;
  RAISE NOTICE 'Default coaches repointed at the platform creator: %', v_repointed;
END $$;

COMMENT ON TABLE public.creator_profiles
    IS 'People who publish coaches on the platform and get paid for them. The row with user_id IS NULL and slug ''cabo'' is the platform itself, which owns the default coaches.';
