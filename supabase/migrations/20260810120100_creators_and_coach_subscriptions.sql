/*
  # Creators, per-coach entitlements, and in-app purchase products

  The old model gave a user exactly one coach (user_profiles.coach XOR
  user_profiles.custom_coach_id) and exactly one platform-level Stripe
  subscription keyed by phone number. A marketplace needs the inverse: a
  creator owns coaches, an audience member subscribes to as many coaches as
  they like, and each subscription can be entitled by a different rail
  (Apple IAP on mobile, Stripe on web, promo codes for comps).

    1. creator_profiles   - the drummer / songwriter / yoga instructor
    2. coach_iap_products - App Store & Play product ids per coach
    3. coach_subscriptions- many-to-many audience <-> coach entitlements
    4. has_coach_access() - single source of truth for "can they chat?"
    5. get_coach_roster() - the browse/search endpoint the app calls
*/

-- ---------------------------------------------------------------------------
-- 1. Creators
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.creator_profiles (
    id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at   timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at   timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,

    user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    user_email   text NOT NULL,

    display_name text NOT NULL,
    slug         text UNIQUE NOT NULL,
    bio          text,
    avatar_url   text,
    website_url  text,
    social_links jsonb DEFAULT '{}',

    -- Payouts. revenue_share_bps is the creator's cut in basis points; the
    -- platform keeps the remainder after store fees.
    payout_provider    text,
    payout_account_id  text,
    revenue_share_bps  integer DEFAULT 7000 NOT NULL,

    status       text DEFAULT 'pending' NOT NULL,

    CONSTRAINT creator_slug_format    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
    CONSTRAINT creator_status_valid   CHECK (status IN ('pending', 'approved', 'suspended')),
    CONSTRAINT creator_share_in_range CHECK (revenue_share_bps BETWEEN 0 AND 10000),
    CONSTRAINT creator_payout_valid   CHECK (payout_provider IS NULL OR payout_provider IN ('stripe_connect', 'manual'))
);

CREATE INDEX IF NOT EXISTS creator_profiles_user_id_idx ON public.creator_profiles(user_id);
CREATE INDEX IF NOT EXISTS creator_profiles_email_idx   ON public.creator_profiles(user_email);
CREATE INDEX IF NOT EXISTS creator_profiles_status_idx  ON public.creator_profiles(status);

ALTER TABLE public.coach_profiles
    ADD COLUMN IF NOT EXISTS creator_id uuid REFERENCES public.creator_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS coach_profiles_creator_id_idx ON public.coach_profiles(creator_id);

-- Every existing coach owner becomes an approved creator, so the five seeded
-- personas and any already-built custom coaches keep an owner in the new model.
INSERT INTO public.creator_profiles (user_id, user_email, display_name, slug, status, bio)
SELECT DISTINCT ON (up.email)
    up.id,
    up.email,
    COALESCE(NULLIF(up.full_name, ''), split_part(up.email, '@', 1)),
    -- Slug must match ^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$: strip non-alphanumerics,
    -- clamp the readable part, and always land on a hex suffix.
    COALESCE(
        NULLIF(
            btrim(left(regexp_replace(lower(split_part(up.email, '@', 1)), '[^a-z0-9]+', '-', 'g'), 24), '-'),
            ''
        ),
        'creator'
    ) || '-' || substr(md5(up.email), 1, 6),
    'approved',
    NULL
FROM public.user_profiles up
WHERE EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.user_email = up.email)
  AND NOT EXISTS (SELECT 1 FROM public.creator_profiles c WHERE c.user_email = up.email)
ORDER BY up.email, up.created_at;

UPDATE public.coach_profiles cp
SET creator_id = c.id
FROM public.creator_profiles c
WHERE cp.creator_id IS NULL AND c.user_email = cp.user_email;

-- ---------------------------------------------------------------------------
-- 2. Store products
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.coach_iap_products (
    id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at  timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at  timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,

    coach_id    uuid NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
    platform    text NOT NULL,
    product_id  text NOT NULL,
    period      text NOT NULL DEFAULT 'monthly',
    price_cents integer,
    currency    text DEFAULT 'USD',
    active      boolean DEFAULT true NOT NULL,

    CONSTRAINT iap_platform_valid CHECK (platform IN ('ios', 'android', 'web')),
    CONSTRAINT iap_period_valid   CHECK (period   IN ('monthly', 'yearly', 'lifetime')),
    UNIQUE (platform, product_id)
);

CREATE INDEX IF NOT EXISTS coach_iap_products_coach_idx ON public.coach_iap_products(coach_id);

-- ---------------------------------------------------------------------------
-- 3. Per-coach entitlements
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'public' AND t.typname = 'coach_subscription_status') THEN
    CREATE TYPE coach_subscription_status AS ENUM (
      'trialing', 'active', 'grace_period', 'expired', 'cancelled', 'revoked'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'public' AND t.typname = 'entitlement_source') THEN
    CREATE TYPE entitlement_source AS ENUM (
      'apple_iap', 'google_play', 'stripe', 'promo', 'free_tier', 'creator_comp'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.coach_subscriptions (
    id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at  timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at  timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,

    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user_email  text,
    coach_id    uuid NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,

    status      coach_subscription_status NOT NULL DEFAULT 'trialing',
    source      entitlement_source        NOT NULL DEFAULT 'free_tier',

    -- Store bookkeeping. original_transaction_id is Apple's stable subscription
    -- identity across renewals; purchase_token is the Play equivalent.
    product_id              text,
    original_transaction_id text,
    latest_transaction_id   text,
    purchase_token          text,
    environment             text,

    started_at         timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    current_period_end timestamptz,
    cancelled_at       timestamptz,
    auto_renew         boolean DEFAULT true NOT NULL,

    -- Free-tier metering: how many messages this pairing gets before paying.
    messages_used      integer DEFAULT 0 NOT NULL,
    free_message_quota integer DEFAULT 5 NOT NULL,

    UNIQUE (user_id, coach_id),
    CONSTRAINT coach_sub_environment_valid CHECK (environment IS NULL OR environment IN ('sandbox', 'production'))
);

-- One store transaction can only ever back one entitlement row.
CREATE UNIQUE INDEX IF NOT EXISTS coach_subscriptions_original_txn_idx
    ON public.coach_subscriptions (source, original_transaction_id)
    WHERE original_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS coach_subscriptions_user_idx   ON public.coach_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS coach_subscriptions_coach_idx  ON public.coach_subscriptions(coach_id);
CREATE INDEX IF NOT EXISTS coach_subscriptions_status_idx ON public.coach_subscriptions(status);

-- ---------------------------------------------------------------------------
-- 4. Timestamps
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS handle_creator_profiles_updated_at ON public.creator_profiles;
CREATE TRIGGER handle_creator_profiles_updated_at
    BEFORE UPDATE ON public.creator_profiles
    FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

DROP TRIGGER IF EXISTS handle_coach_iap_products_updated_at ON public.coach_iap_products;
CREATE TRIGGER handle_coach_iap_products_updated_at
    BEFORE UPDATE ON public.coach_iap_products
    FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

DROP TRIGGER IF EXISTS handle_coach_subscriptions_updated_at ON public.coach_subscriptions;
CREATE TRIGGER handle_coach_subscriptions_updated_at
    BEFORE UPDATE ON public.coach_subscriptions
    FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- Keep coach_profiles.subscriber_count honest without an extra query per read.
CREATE OR REPLACE FUNCTION public.sync_coach_subscriber_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coach_id uuid := COALESCE(NEW.coach_id, OLD.coach_id);
BEGIN
  UPDATE public.coach_profiles
  SET subscriber_count = (
      SELECT count(*) FROM public.coach_subscriptions
      WHERE coach_id = v_coach_id
        AND status IN ('trialing', 'active', 'grace_period')
  )
  WHERE id = v_coach_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sync_coach_subscriber_count_trigger ON public.coach_subscriptions;
CREATE TRIGGER sync_coach_subscriber_count_trigger
    AFTER INSERT OR UPDATE OF status OR DELETE ON public.coach_subscriptions
    FOR EACH ROW EXECUTE PROCEDURE public.sync_coach_subscriber_count();

-- ---------------------------------------------------------------------------
-- 5. Access check
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_coach_access(p_user_id uuid, p_coach_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
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
    );
$$;

COMMENT ON FUNCTION public.has_coach_access(uuid, uuid)
    IS 'Single source of truth for whether a user may converse with a coach';

-- Atomically burn one free-tier message. Returns the number of free messages
-- left afterwards, or NULL when the pairing is not on the free tier (paid
-- subscribers are not metered).
CREATE OR REPLACE FUNCTION public.consume_free_message(p_user_id uuid, p_coach_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining integer;
BEGIN
  UPDATE public.coach_subscriptions
  SET messages_used = messages_used + 1
  WHERE user_id = p_user_id
    AND coach_id = p_coach_id
    AND source = 'free_tier'
  RETURNING GREATEST(0, free_message_quota - messages_used) INTO v_remaining;

  RETURN v_remaining;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_free_message(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Roster
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_coach_roster(
    p_category   text    DEFAULT NULL,
    p_search     text    DEFAULT NULL,
    p_limit      integer DEFAULT 40,
    p_offset     integer DEFAULT 0
)
RETURNS TABLE (
    id                uuid,
    name              text,
    handle            text,
    tagline           text,
    description       text,
    discipline        text,
    category_slug     text,
    category_label    text,
    category_emoji    text,
    expertise         text[],
    starter_prompts   text[],
    intro_message     text,
    avatar_url        text,
    cover_image_url   text,
    subscriber_count  integer,
    average_rating    numeric,
    featured_rank     integer,
    creator_id        uuid,
    creator_name      text,
    creator_slug      text,
    creator_avatar_url text,
    ios_product_id    text,
    price_cents       integer,
    currency          text,
    period            text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        cp.id,
        cp.name,
        cp.handle,
        cp.tagline,
        cp.description,
        cp.discipline,
        cp.category_slug,
        cc.label,
        cc.emoji,
        cp.expertise,
        cp.starter_prompts,
        cp.intro_message,
        cp.avatar_url,
        cp.cover_image_url,
        cp.subscriber_count,
        cp.average_rating,
        cp.featured_rank,
        cp.creator_id,
        cr.display_name,
        cr.slug,
        cr.avatar_url,
        p.product_id,
        p.price_cents,
        p.currency,
        p.period
    FROM public.coach_profiles cp
    LEFT JOIN public.coach_categories cc ON cc.slug = cp.category_slug
    LEFT JOIN public.creator_profiles cr ON cr.id = cp.creator_id
    LEFT JOIN LATERAL (
        SELECT product_id, price_cents, currency, period
        FROM public.coach_iap_products
        WHERE coach_id = cp.id AND platform = 'ios' AND active = true
        ORDER BY created_at
        LIMIT 1
    ) p ON true
    WHERE cp.active = true
      AND cp.listing_status = 'listed'
      AND (p_category IS NULL OR cp.category_slug = p_category)
      AND (
            p_search IS NULL
            OR btrim(p_search) = ''
            OR cp.search_document @@ websearch_to_tsquery('english', p_search)
          )
    ORDER BY
        cp.featured_rank NULLS LAST,
        CASE WHEN p_search IS NULL OR btrim(p_search) = '' THEN 0
             ELSE -ts_rank(cp.search_document, websearch_to_tsquery('english', p_search)) END,
        cp.subscriber_count DESC,
        cp.created_at
    LIMIT  GREATEST(1, LEAST(p_limit, 100))
    OFFSET GREATEST(0, p_offset);
$$;

COMMENT ON FUNCTION public.get_coach_roster(text, text, integer, integer)
    IS 'Public coach roster with category filter and full-text search';

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.creator_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_iap_products  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view approved creators" ON public.creator_profiles;
CREATE POLICY "Anyone can view approved creators"
    ON public.creator_profiles FOR SELECT
    USING (status = 'approved' OR user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create their own creator profile" ON public.creator_profiles;
CREATE POLICY "Users can create their own creator profile"
    ON public.creator_profiles FOR INSERT
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Creators can update their own profile" ON public.creator_profiles;
CREATE POLICY "Creators can update their own profile"
    ON public.creator_profiles FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Approval state and payout terms belong to the platform, not the creator.
-- A trigger is used rather than a WITH CHECK subquery so the guard cannot be
-- confused by RLS recursion on the same table.
CREATE OR REPLACE FUNCTION public.protect_creator_platform_fields()
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
    BEFORE UPDATE ON public.creator_profiles
    FOR EACH ROW EXECUTE PROCEDURE public.protect_creator_platform_fields();

DROP POLICY IF EXISTS "Anyone can read products for listed coaches" ON public.coach_iap_products;
CREATE POLICY "Anyone can read products for listed coaches"
    ON public.coach_iap_products FOR SELECT
    USING (
        active = true
        AND coach_id IN (
            SELECT id FROM public.coach_profiles
            WHERE active = true AND listing_status = 'listed'
        )
    );

DROP POLICY IF EXISTS "Users can view their own coach subscriptions" ON public.coach_subscriptions;
CREATE POLICY "Users can view their own coach subscriptions"
    ON public.coach_subscriptions FOR SELECT
    USING (user_id = auth.uid());

-- Clients may only ever create the free tier for themselves. Paid entitlements
-- are written by the service role after the store receipt is verified.
DROP POLICY IF EXISTS "Users can start a free tier for themselves" ON public.coach_subscriptions;
CREATE POLICY "Users can start a free tier for themselves"
    ON public.coach_subscriptions FOR INSERT
    WITH CHECK (
        user_id = auth.uid()
        AND source = 'free_tier'
        AND status = 'trialing'
        AND original_transaction_id IS NULL
        AND purchase_token IS NULL
    );

GRANT SELECT, INSERT         ON public.coach_subscriptions TO authenticated;
GRANT SELECT                 ON public.coach_iap_products  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.creator_profiles    TO authenticated;
GRANT ALL ON public.creator_profiles    TO service_role;
GRANT ALL ON public.coach_iap_products  TO service_role;
GRANT ALL ON public.coach_subscriptions TO service_role;

GRANT EXECUTE ON FUNCTION public.has_coach_access(uuid, uuid)                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_coach_roster(text, text, integer, integer)    TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Coach visibility now follows listing_status too
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Anyone can view public coaches" ON public.coach_profiles;
CREATE POLICY "Anyone can view public coaches"
    ON public.coach_profiles FOR SELECT
    USING ((public = true OR listing_status = 'listed') AND active = true);

COMMENT ON TABLE public.creator_profiles    IS 'People who publish coaches on the platform and get paid for them';
COMMENT ON TABLE public.coach_subscriptions IS 'Per-coach entitlements; a user may hold many, one per coach';
COMMENT ON TABLE public.coach_iap_products  IS 'App Store / Play product identifiers backing each coach subscription';
