-- ---------------------------------------------------------------------------
-- Clubs as a first-class entity (issue #31)
--
-- The go-to-market moved from individual creators to clubs, academies and
-- studios: one head coach whose expertise is rationed across 60-200 members.
-- The org supplies both the coach and the members.
--
-- Shape: a new `clubs` table rather than a flag on `creator_profiles`.
-- creator_profiles models a *seller* -- it carries revenue_share_bps,
-- payout_provider and payout_account_id, all protected by
-- protect_creator_platform_fields(). A club is a *buyer*. Overloading the row
-- would leave those three columns meaning nothing-or-something depending on a
-- flag, and every creator query would grow a "but is it a club" branch. A club
-- still owns coaches, so it points at a creator_profiles row via creator_id
-- rather than becoming one.
--
-- Entitlement deliberately does NOT get a second mechanism. Seats are issued as
-- `coach_subscriptions` rows with source = 'creator_comp', so has_coach_access()
-- remains the single gate every read path already calls. What is new is
-- `coach_subscriptions.club_id`, which records that a seat came from a club so
-- revocation can find exactly those rows and nothing else.
--
-- Grants follow docs/grant-matrix.md: every SECURITY DEFINER function here is
-- revoked from PUBLIC and anon before any deliberate grant. See #25.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.clubs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    slug                text NOT NULL UNIQUE,
    name                text NOT NULL,
    -- The creator whose coaches this club offers its members.
    creator_id          uuid REFERENCES public.creator_profiles(id) ON DELETE SET NULL,
    status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'lapsed', 'suspended')),
    -- Commercial columns. authenticated is never granted SELECT on these; an
    -- owner reads them through club_billing(), which checks ownership. A member
    -- must not be able to see what their club pays.
    seats               integer NOT NULL DEFAULT 0 CHECK (seats >= 0),
    plan                text,
    billing_email       text,
    external_billing_ref text,
    notes               text
);

COMMENT ON TABLE public.clubs IS
    'An organisation that buys coach access on behalf of its members';
COMMENT ON COLUMN public.clubs.creator_id IS
    'The creator row whose coaches this club offers. A club owns coaches; it is not itself a seller.';

CREATE TABLE IF NOT EXISTS public.club_members (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    club_id       uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
    -- NULL until an invited person actually signs up. The invite is keyed on
    -- email; claim_club_invites() links it on account creation.
    user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    invited_email text,
    role          text NOT NULL DEFAULT 'member'
                  CHECK (role IN ('owner', 'coach', 'member')),
    status        text NOT NULL DEFAULT 'invited'
                  CHECK (status IN ('invited', 'active', 'removed')),
    invited_at    timestamptz NOT NULL DEFAULT now(),
    joined_at     timestamptz,
    removed_at    timestamptz,
    CONSTRAINT club_member_identified CHECK (user_id IS NOT NULL OR invited_email IS NOT NULL)
);

-- One membership per person per club, counting invited-but-not-yet-signed-up
-- separately since user_id is still null there.
CREATE UNIQUE INDEX IF NOT EXISTS club_members_club_user_uniq
    ON public.club_members (club_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS club_members_club_email_uniq
    ON public.club_members (club_id, lower(invited_email)) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS club_members_user_idx ON public.club_members (user_id);

-- Which coaches a club offers. Explicit rather than "every coach the creator
-- owns", so a club can pilot with one coach without exposing the rest.
CREATE TABLE IF NOT EXISTS public.club_coaches (
    club_id    uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
    coach_id   uuid NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (club_id, coach_id)
);

-- Marks a seat as club-granted. Revocation targets exactly these rows.
ALTER TABLE public.coach_subscriptions
    ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS coach_subscriptions_club_idx
    ON public.coach_subscriptions (club_id) WHERE club_id IS NOT NULL;

DROP TRIGGER IF EXISTS clubs_updated_at ON public.clubs;
CREATE TRIGGER clubs_updated_at BEFORE UPDATE ON public.clubs
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS club_members_updated_at ON public.club_members;
CREATE TRIGGER club_members_updated_at BEFORE UPDATE ON public.club_members
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Membership predicates
--
-- Both are SECURITY DEFINER for a specific reason: the RLS policies on
-- club_members need to ask "is the caller an owner of this club", which is
-- itself a question about club_members. Asking it through a policy-bound query
-- recurses. A SECURITY DEFINER function reads the table with RLS bypassed and
-- breaks the cycle.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_club_owner(p_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.club_members m
        WHERE m.club_id = p_club_id
          AND m.user_id = auth.uid()
          AND m.role IN ('owner', 'coach')
          AND m.status = 'active'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_club_member(p_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.club_members m
        WHERE m.club_id = p_club_id
          AND m.user_id = auth.uid()
          AND m.status = 'active'
    );
$$;

REVOKE ALL ON FUNCTION public.is_club_owner(uuid)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_club_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_club_owner(uuid)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_club_member(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Seat granting and revocation
--
-- The awkward case, handled explicitly: a member may already be paying for the
-- same coach out of their own pocket. A club seat must never overwrite a paid
-- entitlement, because revoking the seat later would then cancel a subscription
-- the member bought. So the upsert only takes over rows that are free_tier or
-- already club-granted, and leaves apple_iap / google_play / stripe rows alone.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.grant_club_seat(p_club_id uuid, p_user_id uuid, p_coach_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.coach_subscriptions
        (user_id, coach_id, status, source, club_id, started_at, current_period_end)
    VALUES
        (p_user_id, p_coach_id, 'active', 'creator_comp', p_club_id, now(), NULL)
    ON CONFLICT (user_id, coach_id) DO UPDATE
        SET status             = 'active',
            source             = 'creator_comp',
            club_id            = EXCLUDED.club_id,
            current_period_end = NULL,
            updated_at         = now()
        WHERE public.coach_subscriptions.source IN ('free_tier', 'creator_comp', 'promo');
END;
$$;

-- Revoke every seat this club granted to this member. Used by the triggers
-- below; never leaves a removed member able to keep talking.
CREATE OR REPLACE FUNCTION public.revoke_club_seats(p_club_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count integer;
BEGIN
    UPDATE public.coach_subscriptions
       SET status = 'revoked', updated_at = now()
     WHERE club_id = p_club_id
       AND (p_user_id IS NULL OR user_id = p_user_id)
       AND status <> 'revoked';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_club_seat(uuid, uuid, uuid)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_club_seats(uuid, uuid)      FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_club_seat(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_club_seats(uuid, uuid)     TO service_role;

-- 3a. Removing a member revokes their seats, immediately and by any path --
--     a status flip, or an outright DELETE of the membership row.
CREATE OR REPLACE FUNCTION public.club_membership_revocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.user_id IS NOT NULL THEN
            PERFORM public.revoke_club_seats(OLD.club_id, OLD.user_id);
        END IF;
        RETURN OLD;
    END IF;

    IF NEW.status = 'removed' AND OLD.status <> 'removed' AND NEW.user_id IS NOT NULL THEN
        PERFORM public.revoke_club_seats(NEW.club_id, NEW.user_id);
        NEW.removed_at := COALESCE(NEW.removed_at, now());
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS club_members_revoke ON public.club_members;
CREATE TRIGGER club_members_revoke
    BEFORE UPDATE ON public.club_members
    FOR EACH ROW EXECUTE FUNCTION public.club_membership_revocation();

DROP TRIGGER IF EXISTS club_members_revoke_delete ON public.club_members;
CREATE TRIGGER club_members_revoke_delete
    BEFORE DELETE ON public.club_members
    FOR EACH ROW EXECUTE FUNCTION public.club_membership_revocation();

-- 3b. A club that lapses or is suspended revokes every seat it granted.
--     Re-activating does NOT silently re-grant: that is a deliberate act, so
--     the owner calls club_add_members() again.
CREATE OR REPLACE FUNCTION public.club_status_revocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status <> 'active' AND OLD.status = 'active' THEN
        PERFORM public.revoke_club_seats(NEW.id, NULL);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clubs_status_revoke ON public.clubs;
CREATE TRIGGER clubs_status_revoke
    AFTER UPDATE OF status ON public.clubs
    FOR EACH ROW EXECUTE FUNCTION public.club_status_revocation();

-- ---------------------------------------------------------------------------
-- 4. Adding members in one action
--
-- Takes a list of emails. People who already have an account are granted
-- immediately; people who do not get an 'invited' row that claim_club_invites()
-- converts when they sign up. Returns a count of each so the caller can report
-- honestly rather than claiming ten seats when six landed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.club_add_members(p_club_id uuid, p_emails text[])
RETURNS TABLE (granted integer, invited integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email   text;
    v_uid     uuid;
    v_coach   uuid;
    v_granted integer := 0;
    v_invited integer := 0;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.clubs WHERE id = p_club_id AND status = 'active') THEN
        RAISE EXCEPTION 'club % is not active', p_club_id USING ERRCODE = 'check_violation';
    END IF;

    FOREACH v_email IN ARRAY p_emails LOOP
        SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower(v_email);

        IF v_uid IS NULL THEN
            INSERT INTO public.club_members (club_id, invited_email, role, status)
            VALUES (p_club_id, lower(v_email), 'member', 'invited')
            ON CONFLICT DO NOTHING;
            v_invited := v_invited + 1;
        ELSE
            INSERT INTO public.club_members (club_id, user_id, invited_email, role, status, joined_at)
            VALUES (p_club_id, v_uid, lower(v_email), 'member', 'active', now())
            ON CONFLICT (club_id, user_id) WHERE user_id IS NOT NULL
            DO UPDATE SET status = 'active', removed_at = NULL, joined_at = COALESCE(public.club_members.joined_at, now());

            FOR v_coach IN SELECT coach_id FROM public.club_coaches WHERE club_id = p_club_id LOOP
                PERFORM public.grant_club_seat(p_club_id, v_uid, v_coach);
            END LOOP;
            v_granted := v_granted + 1;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_granted, v_invited;
END;
$$;

-- When an invited person signs up, link the invite and grant their seats.
CREATE OR REPLACE FUNCTION public.claim_club_invites()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    r     record;
    v_coach uuid;
BEGIN
    FOR r IN
        SELECT m.id, m.club_id
        FROM public.club_members m
        JOIN public.clubs c ON c.id = m.club_id
        WHERE m.user_id IS NULL
          AND lower(m.invited_email) = lower(NEW.email)
          AND m.status = 'invited'
          AND c.status = 'active'
    LOOP
        UPDATE public.club_members
           SET user_id = NEW.id, status = 'active', joined_at = now()
         WHERE id = r.id;

        FOR v_coach IN SELECT coach_id FROM public.club_coaches WHERE club_id = r.club_id LOOP
            PERFORM public.grant_club_seat(r.club_id, NEW.id, v_coach);
        END LOOP;
    END LOOP;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS claim_club_invites_on_signup ON auth.users;
CREATE TRIGGER claim_club_invites_on_signup
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.claim_club_invites();

-- Owner-facing roster. Returns membership only -- no conversation content, no
-- goal text. #32 builds engagement aggregates on top of this.
CREATE OR REPLACE FUNCTION public.club_roster(p_club_id uuid)
RETURNS TABLE (
    member_id     uuid,
    user_id       uuid,
    display_name  text,
    invited_email text,
    role          text,
    status        text,
    joined_at     timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT m.id, m.user_id, up.display_name, m.invited_email, m.role, m.status, m.joined_at
    FROM public.club_members m
    LEFT JOIN public.user_profiles up ON up.user_id = m.user_id
    WHERE m.club_id = p_club_id
      AND public.is_club_owner(p_club_id)
    ORDER BY m.status, m.joined_at NULLS LAST;
$$;

-- Commercial columns, owner only. authenticated has no SELECT on these columns
-- at the table level, so this function is the only way to read them.
CREATE OR REPLACE FUNCTION public.club_billing(p_club_id uuid)
RETURNS TABLE (seats integer, seats_used bigint, plan text, billing_email text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT c.seats,
           (SELECT count(*) FROM public.club_members m
             WHERE m.club_id = c.id AND m.status = 'active'),
           c.plan, c.billing_email, c.status
    FROM public.clubs c
    WHERE c.id = p_club_id
      AND public.is_club_owner(p_club_id);
$$;

REVOKE ALL ON FUNCTION public.club_add_members(uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_club_invites()           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.club_roster(uuid)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.club_billing(uuid)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.club_membership_revocation()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.club_status_revocation()       FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_add_members(uuid, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.club_roster(uuid)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.club_billing(uuid)             TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. RLS
--
-- The rule that matters: a member may confirm their own membership and see the
-- club's name, but must not be able to enumerate who else is in it. Squad
-- membership is not public information -- who trains where is exactly the kind
-- of thing a member has not consented to sharing.
-- ---------------------------------------------------------------------------

ALTER TABLE public.clubs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_coaches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members see their own clubs" ON public.clubs;
CREATE POLICY "Members see their own clubs" ON public.clubs
    FOR SELECT TO authenticated
    USING (public.is_club_member(id));

DROP POLICY IF EXISTS "Owners update their club" ON public.clubs;
CREATE POLICY "Owners update their club" ON public.clubs
    FOR UPDATE TO authenticated
    USING (public.is_club_owner(id))
    WITH CHECK (public.is_club_owner(id));

DROP POLICY IF EXISTS "Members see only their own membership" ON public.club_members;
CREATE POLICY "Members see only their own membership" ON public.club_members
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR public.is_club_owner(club_id));

DROP POLICY IF EXISTS "Members see coaches of their club" ON public.club_coaches;
CREATE POLICY "Members see coaches of their club" ON public.club_coaches
    FOR SELECT TO authenticated
    USING (public.is_club_member(club_id));

-- ---------------------------------------------------------------------------
-- 6. Grants
--
-- Column-scoped on clubs: the commercial columns are simply not granted, so no
-- policy mistake can leak them. club_billing() is the owner's read path.
-- ---------------------------------------------------------------------------

REVOKE ALL ON public.clubs        FROM anon, authenticated;
REVOKE ALL ON public.club_members FROM anon, authenticated;
REVOKE ALL ON public.club_coaches FROM anon, authenticated;

GRANT SELECT (id, slug, name, status, creator_id, created_at) ON public.clubs TO authenticated;
GRANT UPDATE (name, slug)                                     ON public.clubs TO authenticated;
GRANT SELECT ON public.club_members TO authenticated;
GRANT SELECT ON public.club_coaches TO authenticated;

GRANT ALL ON public.clubs        TO service_role;
GRANT ALL ON public.club_members TO service_role;
GRANT ALL ON public.club_coaches TO service_role;
