/*
  # Mobile-first identity and durable conversations

  Two things blocked a mobile app:

    1. Identity was a US phone number. user_profiles.phone_number was NOT NULL
       with a `^\+1...` check, and every RLS policy keyed off
       `auth.jwt() ->> 'phone'`. Someone signing in with Apple has no phone.
    2. Conversations lived in a GCS bucket keyed by phone number, so the app
       had no history to render and no way to page it.

  This migration makes auth.users the canonical identity (phone becomes an
  optional channel) and moves conversations into Postgres.
*/

-- ---------------------------------------------------------------------------
-- 1. auth.users as the canonical identity
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS display_name  text,
    ADD COLUMN IF NOT EXISTS avatar_url    text,
    ADD COLUMN IF NOT EXISTS auth_provider text,
    ADD COLUMN IF NOT EXISTS onboarded_at  timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_user_id_key ON public.user_profiles(user_id)
    WHERE user_id IS NOT NULL;

-- Link existing rows to their auth user by email.
UPDATE public.user_profiles up
SET user_id = au.id
FROM auth.users au
WHERE up.user_id IS NULL
  AND lower(au.email) = lower(up.email);

UPDATE public.user_profiles
SET display_name = COALESCE(display_name, NULLIF(full_name, ''))
WHERE display_name IS NULL;

-- Phone becomes an optional delivery channel rather than the primary key.
ALTER TABLE public.user_profiles ALTER COLUMN phone_number DROP NOT NULL;
ALTER TABLE public.user_profiles ALTER COLUMN full_name    DROP NOT NULL;

ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS phone_number_format;
ALTER TABLE public.user_profiles
    ADD CONSTRAINT phone_number_format
    CHECK (phone_number IS NULL OR phone_number ~ '^\+[1-9]\d{7,14}$');

COMMENT ON CONSTRAINT phone_number_format ON public.user_profiles
    IS 'E.164, optional. SMS delivery is one channel among several, not identity.';

-- A user may now follow many coaches (see coach_subscriptions), so the old
-- "exactly one coach" constraint becomes "at most one *default SMS* coach".
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS check_coach_selection;
ALTER TABLE public.user_profiles
    ADD CONSTRAINT check_coach_selection
    CHECK (
        (coach_type = 'predefined' AND custom_coach_id IS NULL) OR
        (coach_type = 'custom'     AND custom_coach_id IS NOT NULL AND coach IS NULL) OR
        (coach_type IS NULL AND coach IS NULL AND custom_coach_id IS NULL)
    );

COMMENT ON CONSTRAINT check_coach_selection ON public.user_profiles
    IS 'The default coach for SMS. App users browse the full roster via coach_subscriptions.';

-- ---------------------------------------------------------------------------
-- 2. RLS that works for phone-less app users
-- ---------------------------------------------------------------------------

-- Matches a coach_profiles row against the caller by any identity they hold.
CREATE OR REPLACE FUNCTION public.owns_coach(p_coach_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.coach_profiles cp
        LEFT JOIN public.creator_profiles cr ON cr.id = cp.creator_id
        WHERE cp.id = p_coach_id
          AND (
                cp.user_id = auth.uid()
                OR cr.user_id = auth.uid()
                OR lower(cp.user_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                OR (auth.jwt() ->> 'phone') IS NOT NULL AND (
                      (auth.jwt() ->> 'phone') = (SELECT phone_number FROM public.user_profiles WHERE email = cp.user_email)
                   OR ('+' || (auth.jwt() ->> 'phone')) = (SELECT phone_number FROM public.user_profiles WHERE email = cp.user_email)
                )
              )
    );
$$;

GRANT EXECUTE ON FUNCTION public.owns_coach(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can view own profile"   ON public.user_profiles;
CREATE POLICY "Users can view own profile"
    ON public.user_profiles FOR SELECT
    USING (user_id = auth.uid() OR lower(auth.jwt() ->> 'email') = lower(email));

DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
CREATE POLICY "Users can update own profile"
    ON public.user_profiles FOR UPDATE
    USING (user_id = auth.uid() OR lower(auth.jwt() ->> 'email') = lower(email))
    WITH CHECK (user_id = auth.uid() OR lower(auth.jwt() ->> 'email') = lower(email));

-- Owners identified by auth.uid() (Apple / Google / email sign-in), in addition
-- to the legacy phone-claim policies which stay in place for SMS users.
DROP POLICY IF EXISTS "Owners can view their coaches by uid" ON public.coach_profiles;
CREATE POLICY "Owners can view their coaches by uid"
    ON public.coach_profiles FOR SELECT
    USING (user_id = auth.uid() OR lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

DROP POLICY IF EXISTS "Owners can insert coaches by uid" ON public.coach_profiles;
CREATE POLICY "Owners can insert coaches by uid"
    ON public.coach_profiles FOR INSERT
    WITH CHECK (user_id = auth.uid() OR lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

DROP POLICY IF EXISTS "Owners can update coaches by uid" ON public.coach_profiles;
CREATE POLICY "Owners can update coaches by uid"
    ON public.coach_profiles FOR UPDATE
    USING (user_id = auth.uid() OR lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    WITH CHECK (
        -- Publishing to the roster still requires an approved creator.
        listing_status <> 'listed'
        OR EXISTS (
            SELECT 1 FROM public.creator_profiles cr
            WHERE cr.id = coach_profiles.creator_id
              AND cr.user_id = auth.uid()
              AND cr.status = 'approved'
        )
    );

DROP POLICY IF EXISTS "Owners can delete coaches by uid" ON public.coach_profiles;
CREATE POLICY "Owners can delete coaches by uid"
    ON public.coach_profiles FOR DELETE
    USING (user_id = auth.uid() OR lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- The legacy phone-claim UPDATE policy predates listing_status and would let a
-- phone-authenticated owner list a coach without an approved creator behind it.
-- Enforce the rule in a trigger so it holds no matter which policy admitted the
-- write.
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

DROP TRIGGER IF EXISTS enforce_coach_listing_rules_trigger ON public.coach_profiles;
CREATE TRIGGER enforce_coach_listing_rules_trigger
    BEFORE INSERT OR UPDATE OF listing_status, creator_id ON public.coach_profiles
    FOR EACH ROW EXECUTE PROCEDURE public.enforce_coach_listing_rules();

-- ---------------------------------------------------------------------------
-- 3. Conversations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.conversations (
    id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at      timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at      timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,

    user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    coach_id        uuid NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,

    title           text,
    channel         text DEFAULT 'app' NOT NULL,
    last_message_at timestamptz,
    message_count   integer DEFAULT 0 NOT NULL,
    archived        boolean DEFAULT false NOT NULL,

    CONSTRAINT conversation_channel_valid CHECK (channel IN ('app', 'sms', 'web')),
    UNIQUE (user_id, coach_id, channel)
);

CREATE INDEX IF NOT EXISTS conversations_user_idx
    ON public.conversations(user_id, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS conversations_coach_idx ON public.conversations(coach_id);

CREATE TABLE IF NOT EXISTS public.conversation_messages (
    id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at      timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,

    conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    role            text NOT NULL,
    content         text NOT NULL,

    -- Generation telemetry, previously written to coach_test_messages against
    -- columns that did not exist (so every insert silently failed).
    model            text,
    latency_ms       integer,
    detected_intent  text,
    detected_context text,
    source_chunk_ids uuid[] DEFAULT '{}',
    metadata         jsonb  DEFAULT '{}',

    CONSTRAINT message_role_valid   CHECK (role IN ('user', 'assistant', 'system')),
    CONSTRAINT message_not_empty    CHECK (char_length(content) > 0)
);

CREATE INDEX IF NOT EXISTS conversation_messages_conversation_idx
    ON public.conversation_messages(conversation_id, created_at);

CREATE OR REPLACE FUNCTION public.touch_conversation_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.created_at,
      message_count   = message_count + 1,
      updated_at      = now()
  WHERE id = NEW.conversation_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS touch_conversation_on_message_trigger ON public.conversation_messages;
CREATE TRIGGER touch_conversation_on_message_trigger
    AFTER INSERT ON public.conversation_messages
    FOR EACH ROW EXECUTE PROCEDURE public.touch_conversation_on_message();

DROP TRIGGER IF EXISTS handle_conversations_updated_at ON public.conversations;
CREATE TRIGGER handle_conversations_updated_at
    BEFORE UPDATE ON public.conversations
    FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Conversation RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.conversations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own conversations" ON public.conversations;
CREATE POLICY "Users read their own conversations"
    ON public.conversations FOR SELECT
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users create conversations with coaches they can access" ON public.conversations;
CREATE POLICY "Users create conversations with coaches they can access"
    ON public.conversations FOR INSERT
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update their own conversations" ON public.conversations;
CREATE POLICY "Users update their own conversations"
    ON public.conversations FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users read messages in their conversations" ON public.conversation_messages;
CREATE POLICY "Users read messages in their conversations"
    ON public.conversation_messages FOR SELECT
    USING (
        conversation_id IN (SELECT id FROM public.conversations WHERE user_id = auth.uid())
    );

-- Clients may append their own turn; assistant turns are written by the
-- service role after generation so a client cannot forge coach output.
DROP POLICY IF EXISTS "Users append their own turns" ON public.conversation_messages;
CREATE POLICY "Users append their own turns"
    ON public.conversation_messages FOR INSERT
    WITH CHECK (
        role = 'user'
        AND conversation_id IN (SELECT id FROM public.conversations WHERE user_id = auth.uid())
    );

GRANT SELECT, INSERT, UPDATE ON public.conversations         TO authenticated;
GRANT SELECT, INSERT         ON public.conversation_messages TO authenticated;
GRANT ALL ON public.conversations         TO service_role;
GRANT ALL ON public.conversation_messages TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Helpers the app calls directly
-- ---------------------------------------------------------------------------

-- Idempotently opens the thread between the caller and a coach, creating a
-- free-tier entitlement on first contact so previews work without a purchase.
CREATE OR REPLACE FUNCTION public.open_coach_conversation(p_coach_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_conversation_id uuid;
  v_coach record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, name, active, listing_status, public AS is_public
  INTO v_coach
  FROM public.coach_profiles
  WHERE id = p_coach_id;

  IF NOT FOUND OR NOT v_coach.active THEN
    RAISE EXCEPTION 'Coach not found or inactive';
  END IF;

  IF v_coach.listing_status <> 'listed' AND NOT v_coach.is_public AND NOT public.owns_coach(p_coach_id) THEN
    RAISE EXCEPTION 'Coach is not available';
  END IF;

  INSERT INTO public.coach_subscriptions (user_id, coach_id, status, source, user_email)
  VALUES (v_user_id, p_coach_id, 'trialing', 'free_tier', auth.jwt() ->> 'email')
  ON CONFLICT (user_id, coach_id) DO NOTHING;

  INSERT INTO public.conversations (user_id, coach_id, channel, title)
  VALUES (v_user_id, p_coach_id, 'app', v_coach.name)
  ON CONFLICT (user_id, coach_id, channel) DO UPDATE SET archived = false
  RETURNING id INTO v_conversation_id;

  RETURN v_conversation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_coach_conversation(uuid) TO authenticated;

-- The app's "My Coaches" list: every coach the caller has a thread or
-- entitlement with, plus enough state to render the row.
CREATE OR REPLACE FUNCTION public.get_my_coaches()
RETURNS TABLE (
    coach_id         uuid,
    name             text,
    handle           text,
    discipline       text,
    tagline          text,
    avatar_url       text,
    category_slug    text,
    creator_name     text,
    conversation_id  uuid,
    last_message_at  timestamptz,
    message_count    integer,
    status           coach_subscription_status,
    source           entitlement_source,
    current_period_end timestamptz,
    messages_used    integer,
    free_message_quota integer,
    has_access       boolean
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
        cp.discipline,
        cp.tagline,
        cp.avatar_url,
        cp.category_slug,
        cr.display_name,
        c.id,
        c.last_message_at,
        COALESCE(c.message_count, 0),
        cs.status,
        cs.source,
        cs.current_period_end,
        COALESCE(cs.messages_used, 0),
        COALESCE(cs.free_message_quota, 0),
        public.has_coach_access(auth.uid(), cp.id)
    FROM public.coach_subscriptions cs
    JOIN public.coach_profiles cp ON cp.id = cs.coach_id
    LEFT JOIN public.creator_profiles cr ON cr.id = cp.creator_id
    LEFT JOIN public.conversations c
           ON c.coach_id = cp.id AND c.user_id = cs.user_id AND c.channel = 'app'
    WHERE cs.user_id = auth.uid()
      AND cp.active = true
    ORDER BY c.last_message_at DESC NULLS LAST, cs.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_coaches() TO authenticated;

COMMENT ON TABLE public.conversations
    IS 'One thread per (user, coach, channel). Replaces the GCS-per-phone-number blobs for app traffic.';
COMMENT ON TABLE public.conversation_messages
    IS 'Durable message history plus generation telemetry';
