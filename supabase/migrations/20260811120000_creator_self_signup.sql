/*
  # Creator self-signup guards

  Becoming a creator used to be a manual INSERT run by the platform, so the
  only guard on `creator_profiles` was `protect_creator_platform_fields()`,
  which fires on UPDATE. Now that an end user can create their own row from the
  web app, INSERT is a write path an untrusted client controls — and today it
  can set `status = 'approved'` and `revenue_share_bps` on the way in.

    1. protect_creator_platform_fields() also guards INSERT
    2. one creator profile per account
    3. creator_slug_available() so the client can pre-check a handle that RLS
       would otherwise hide
    4. enforce_coach_listing_rules() also refuses a creator_id you do not own
*/

-- ---------------------------------------------------------------------------
-- 1. Platform fields are platform-owned on INSERT as well as UPDATE
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_creator_platform_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- No end user on the request (migrations, service-role writes) => trusted.
  -- Approval, payout terms and the revenue split are all set through this path.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A creator signs themselves up as themselves, pending review, on the
    -- standard split. Anything the client sent for these columns is discarded
    -- rather than rejected, so the form never has to know they exist.
    NEW.user_id           := auth.uid();
    NEW.user_email        := COALESCE(NULLIF(auth.jwt() ->> 'email', ''), NEW.user_email);
    NEW.status            := 'pending';
    NEW.revenue_share_bps := 7000;  -- keep in sync with the column default
    NEW.payout_provider   := NULL;
    NEW.payout_account_id := NULL;
    RETURN NEW;
  END IF;

  NEW.status            := OLD.status;
  NEW.revenue_share_bps := OLD.revenue_share_bps;
  NEW.payout_provider   := OLD.payout_provider;
  NEW.payout_account_id := OLD.payout_account_id;
  NEW.user_email        := OLD.user_email;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_creator_platform_fields_trigger ON public.creator_profiles;
CREATE TRIGGER protect_creator_platform_fields_trigger
    BEFORE INSERT OR UPDATE ON public.creator_profiles
    FOR EACH ROW EXECUTE PROCEDURE public.protect_creator_platform_fields();

COMMENT ON FUNCTION public.protect_creator_platform_fields()
    IS 'Approval state, payout terms and the revenue split belong to the platform, on every end-user write';

-- ---------------------------------------------------------------------------
-- 2. One creator profile per account
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS creator_profiles_user_id_key
    ON public.creator_profiles (user_id)
    WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Handle availability
-- ---------------------------------------------------------------------------

-- "Anyone can view approved creators" hides pending and suspended rows, so a
-- client-side SELECT would report a taken handle as free and the insert would
-- then fail on the unique constraint. This answers the narrow question without
-- leaking the row.
CREATE OR REPLACE FUNCTION public.creator_slug_available(p_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
       AND NOT EXISTS (
             SELECT 1 FROM public.creator_profiles
             WHERE slug = p_slug
               AND (user_id IS NULL OR user_id <> auth.uid())
           );
$$;

COMMENT ON FUNCTION public.creator_slug_available(text)
    IS 'True when the handle is well formed and not already held by another creator';

GRANT EXECUTE ON FUNCTION public.creator_slug_available(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. A signed-out browse can see the creator behind a coach
-- ---------------------------------------------------------------------------

-- "Anyone can view approved creators" was written with anon in mind, but anon
-- never got a table grant, so the coach-detail embed
-- (`creator_profiles ( display_name, slug, avatar_url )`) fails outright for a
-- signed-out reader. Grant the public face only — the payout account and the
-- revenue split are nobody else's business.
GRANT SELECT (
    id, created_at, updated_at, display_name, slug, bio,
    avatar_url, website_url, social_links, status
) ON public.creator_profiles TO anon;

-- ---------------------------------------------------------------------------
-- 5. A coach may only be attributed to a creator profile its owner holds
-- ---------------------------------------------------------------------------

-- The listing check alone asked "is NEW.creator_id an approved creator?", not
-- "is it yours". The RLS WITH CHECK does ask, but the legacy phone-claim UPDATE
-- policy is permissive and ORs with it, so the ownership half has to live in
-- the trigger too.
CREATE OR REPLACE FUNCTION public.enforce_coach_listing_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- No end user on the request (migrations, service-role writes) => trusted.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.creator_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.creator_id IS DISTINCT FROM OLD.creator_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.creator_profiles cr
      WHERE cr.id = NEW.creator_id AND cr.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Coach % cannot be credited to a creator profile you do not own', NEW.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.listing_status = 'listed'
     AND (TG_OP = 'INSERT' OR OLD.listing_status IS DISTINCT FROM 'listed') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.creator_profiles cr
      WHERE cr.id = NEW.creator_id AND cr.status = 'approved'
    ) THEN
      RAISE EXCEPTION 'Coach % cannot be listed: it has no approved creator', NEW.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
