/*
  # Push notifications replace SMS as the outbound channel

  Proactive coaching used to be a daily Twilio SMS driven by
  `motivational-images`. On mobile that becomes a push notification that opens
  the coach's thread, and the message itself lands in `conversation_messages`
  so it is still there when the person comes back a day later.

    1. push_devices        - Expo push tokens, one row per device
    2. notification_channel- 'push' | 'sms' | 'none', per user
    3. nudge settings      - cadence and mute, per (user, coach)
    4. coach_nudges        - outbox: idempotency, retry state, analytics
    5. unread state        - conversations.last_read_at + unread counts
    6. realtime            - so a nudge appears in an open thread immediately

  Existing SMS users are backfilled to 'sms' and keep behaving exactly as they
  do today. Only accounts created by the app default to 'push'.
*/

-- ---------------------------------------------------------------------------
-- 1. Devices
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.push_devices (
    id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at    timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at    timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,

    user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Expo push token (ExponentPushToken[...]). Using Expo's service rather
    -- than raw APNs keeps one code path for iOS and Android.
    expo_token    text NOT NULL UNIQUE,
    platform      text NOT NULL,
    device_name   text,
    app_version   text,

    enabled       boolean DEFAULT true NOT NULL,
    last_seen_at  timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    -- Bumped when Expo reports a delivery error; the token is disabled once
    -- Expo says DeviceNotRegistered.
    failure_count integer DEFAULT 0 NOT NULL,
    last_error    text,

    CONSTRAINT push_platform_valid CHECK (platform IN ('ios', 'android')),
    CONSTRAINT expo_token_format   CHECK (expo_token ~ '^(ExponentPushToken|ExpoPushToken)\[.+\]$')
);

CREATE INDEX IF NOT EXISTS push_devices_user_idx    ON public.push_devices(user_id) WHERE enabled;
CREATE INDEX IF NOT EXISTS push_devices_enabled_idx ON public.push_devices(enabled);

DROP TRIGGER IF EXISTS handle_push_devices_updated_at ON public.push_devices;
CREATE TRIGGER handle_push_devices_updated_at
    BEFORE UPDATE ON public.push_devices
    FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Per-user channel and timing
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS notification_channel text,
    -- Local hour (0-23) to send the daily nudge. `timezone` already exists.
    ADD COLUMN IF NOT EXISTS nudge_hour           integer DEFAULT 9,
    ADD COLUMN IF NOT EXISTS quiet_hours_start    integer DEFAULT 21,
    ADD COLUMN IF NOT EXISTS quiet_hours_end      integer DEFAULT 8;

-- Everyone who exists today reached us by SMS; do not silently stop texting
-- them. Only new app accounts get 'push'.
UPDATE public.user_profiles
SET notification_channel = 'sms'
WHERE notification_channel IS NULL;

ALTER TABLE public.user_profiles
    ALTER COLUMN notification_channel SET DEFAULT 'push';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_channel_valid') THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT notification_channel_valid
      CHECK (notification_channel IN ('push', 'sms', 'none'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nudge_hour_valid') THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT nudge_hour_valid
      CHECK (nudge_hour IS NULL OR (nudge_hour BETWEEN 0 AND 23));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiet_hours_valid') THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT quiet_hours_valid
      CHECK (
        (quiet_hours_start IS NULL OR quiet_hours_start BETWEEN 0 AND 23) AND
        (quiet_hours_end   IS NULL OR quiet_hours_end   BETWEEN 0 AND 23)
      );
  END IF;
END $$;

COMMENT ON COLUMN public.user_profiles.notification_channel
    IS 'push = notify in-app (default for app signups); sms = legacy Twilio path; none = quiet';

-- ---------------------------------------------------------------------------
-- 3. Per-coach nudge settings
-- ---------------------------------------------------------------------------

ALTER TABLE public.coach_subscriptions
    ADD COLUMN IF NOT EXISTS notifications_enabled boolean DEFAULT true NOT NULL,
    ADD COLUMN IF NOT EXISTS nudge_cadence         text    DEFAULT 'daily' NOT NULL,
    ADD COLUMN IF NOT EXISTS last_nudge_at         timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nudge_cadence_valid') THEN
    ALTER TABLE public.coach_subscriptions
      ADD CONSTRAINT nudge_cadence_valid
      CHECK (nudge_cadence IN ('daily', 'few_times_week', 'weekly', 'off'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Outbox
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.coach_nudges (
    id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at      timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at      timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,

    user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    coach_id        uuid NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
    conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
    message_id      uuid REFERENCES public.conversation_messages(id) ON DELETE SET NULL,

    -- The user's local calendar day, so a retry inside the same day is a no-op
    -- and a timezone change cannot double-send.
    local_date      date NOT NULL,
    status          text DEFAULT 'pending' NOT NULL,
    body            text,
    error           text,
    delivered_count integer DEFAULT 0 NOT NULL,

    CONSTRAINT nudge_status_valid CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
    UNIQUE (user_id, coach_id, local_date)
);

CREATE INDEX IF NOT EXISTS coach_nudges_user_idx   ON public.coach_nudges(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coach_nudges_status_idx ON public.coach_nudges(status);

DROP TRIGGER IF EXISTS handle_coach_nudges_updated_at ON public.coach_nudges;
CREATE TRIGGER handle_coach_nudges_updated_at
    BEFORE UPDATE ON public.coach_nudges
    FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Read state
-- ---------------------------------------------------------------------------

ALTER TABLE public.conversations
    ADD COLUMN IF NOT EXISTS last_read_at timestamptz;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.conversations
    SET last_read_at = now()
    WHERE id = p_conversation_id AND user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.unread_message_count(p_conversation_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT count(*)::integer
    FROM public.conversation_messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.conversation_id = p_conversation_id
      AND m.role = 'assistant'
      AND (c.last_read_at IS NULL OR m.created_at > c.last_read_at);
$$;

GRANT EXECUTE ON FUNCTION public.unread_message_count(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. get_my_coaches gains unread + notification state
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_my_coaches();

CREATE FUNCTION public.get_my_coaches()
RETURNS TABLE (
    coach_id           uuid,
    name               text,
    handle             text,
    discipline         text,
    tagline            text,
    avatar_url         text,
    category_slug      text,
    creator_name       text,
    conversation_id    uuid,
    last_message_at    timestamptz,
    message_count      integer,
    unread_count       integer,
    last_message_preview text,
    status             coach_subscription_status,
    source             entitlement_source,
    current_period_end timestamptz,
    messages_used      integer,
    free_message_quota integer,
    has_access         boolean,
    notifications_enabled boolean,
    nudge_cadence      text
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
        COALESCE((
            SELECT count(*)::integer
            FROM public.conversation_messages m
            WHERE m.conversation_id = c.id
              AND m.role = 'assistant'
              AND (c.last_read_at IS NULL OR m.created_at > c.last_read_at)
        ), 0),
        (
            SELECT m.content
            FROM public.conversation_messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.created_at DESC
            LIMIT 1
        ),
        cs.status,
        cs.source,
        cs.current_period_end,
        COALESCE(cs.messages_used, 0),
        COALESCE(cs.free_message_quota, 0),
        public.has_coach_access(auth.uid(), cp.id),
        cs.notifications_enabled,
        cs.nudge_cadence
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

-- ---------------------------------------------------------------------------
-- 7. Which (user, coach) pairs are due right now
-- ---------------------------------------------------------------------------

/** Handles windows that wrap midnight, e.g. 21:00 -> 08:00. */
CREATE OR REPLACE FUNCTION public.in_quiet_hours(
    p_hour  integer,
    p_start integer,
    p_end   integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_start IS NULL OR p_end IS NULL THEN false
        WHEN p_start = p_end                  THEN false
        WHEN p_start < p_end                  THEN p_hour >= p_start AND p_hour < p_end
        ELSE p_hour >= p_start OR p_hour < p_end
    END;
$$;

/*
  Called hourly by the dispatcher. A pair is due when, in the user's own
  timezone, the clock has reached their nudge hour, the cadence allows it, and
  nothing has been queued for them today.

  Cadence is enforced against last_nudge_at rather than a schedule table:
  'weekly' means "at least 6 days since the last one", which self-corrects if
  the dispatcher misses a run.
*/
CREATE OR REPLACE FUNCTION public.due_coach_nudges(p_limit integer DEFAULT 200)
RETURNS TABLE (
    user_id         uuid,
    coach_id        uuid,
    conversation_id uuid,
    local_date      date,
    coach_name      text,
    discipline      text,
    display_name    text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH candidate AS (
        SELECT
            cs.user_id,
            cs.coach_id,
            cs.nudge_cadence,
            cs.last_nudge_at,
            cp.name       AS coach_name,
            cp.discipline,
            up.display_name,
            COALESCE(up.timezone, 'UTC')  AS tz,
            COALESCE(up.nudge_hour, 9)    AS nudge_hour,
            up.quiet_hours_start,
            up.quiet_hours_end
        FROM public.coach_subscriptions cs
        JOIN public.coach_profiles cp ON cp.id = cs.coach_id AND cp.active
        JOIN public.user_profiles  up ON up.user_id = cs.user_id
        WHERE cs.notifications_enabled
          AND cs.nudge_cadence <> 'off'
          AND up.active
          AND up.notification_channel = 'push'
          -- Only nudge people who can actually reply.
          AND public.has_coach_access(cs.user_id, cs.coach_id)
          AND EXISTS (
              SELECT 1 FROM public.push_devices d
              WHERE d.user_id = cs.user_id AND d.enabled
          )
    ),
    localised AS (
        SELECT
            c.*,
            (now() AT TIME ZONE c.tz)              AS local_now,
            (now() AT TIME ZONE c.tz)::date        AS local_date,
            EXTRACT(HOUR FROM (now() AT TIME ZONE c.tz))::int AS local_hour
        FROM candidate c
    )
    SELECT
        l.user_id,
        l.coach_id,
        conv.id,
        l.local_date,
        l.coach_name,
        l.discipline,
        l.display_name
    FROM localised l
    LEFT JOIN public.conversations conv
           ON conv.user_id = l.user_id AND conv.coach_id = l.coach_id AND conv.channel = 'app'
    WHERE l.local_hour >= l.nudge_hour
      -- Do not fire a whole day's backlog if the dispatcher was down.
      AND l.local_hour < l.nudge_hour + 3
      AND NOT public.in_quiet_hours(l.local_hour, l.quiet_hours_start, l.quiet_hours_end)
      AND CASE l.nudge_cadence
            WHEN 'daily'          THEN l.last_nudge_at IS NULL OR l.last_nudge_at < now() - interval '20 hours'
            WHEN 'few_times_week' THEN l.last_nudge_at IS NULL OR l.last_nudge_at < now() - interval '2 days'
            WHEN 'weekly'         THEN l.last_nudge_at IS NULL OR l.last_nudge_at < now() - interval '6 days'
            ELSE false
          END
      AND NOT EXISTS (
          SELECT 1 FROM public.coach_nudges n
          WHERE n.user_id = l.user_id
            AND n.coach_id = l.coach_id
            AND n.local_date = l.local_date
      )
    ORDER BY l.last_nudge_at NULLS FIRST
    LIMIT GREATEST(1, LEAST(p_limit, 1000));
$$;

GRANT EXECUTE ON FUNCTION public.in_quiet_hours(integer, integer, integer) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.due_coach_nudges(integer)                 TO service_role;

-- ---------------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_nudges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own devices" ON public.push_devices;
CREATE POLICY "Users manage their own devices"
    ON public.push_devices FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users read their own nudges" ON public.coach_nudges;
CREATE POLICY "Users read their own nudges"
    ON public.coach_nudges FOR SELECT
    USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_devices TO authenticated;
GRANT SELECT                         ON public.coach_nudges TO authenticated;
GRANT ALL ON public.push_devices TO service_role;
GRANT ALL ON public.coach_nudges TO service_role;

-- Let the app change its own per-coach notification settings without opening
-- up the billing columns on the same row.
DROP POLICY IF EXISTS "Users update their own notification settings" ON public.coach_subscriptions;
CREATE POLICY "Users update their own notification settings"
    ON public.coach_subscriptions FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.protect_subscription_billing_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- No end user on the request (migrations, iap-validator) => trusted.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.status                  := OLD.status;
  NEW.source                  := OLD.source;
  NEW.product_id              := OLD.product_id;
  NEW.original_transaction_id := OLD.original_transaction_id;
  NEW.latest_transaction_id   := OLD.latest_transaction_id;
  NEW.purchase_token          := OLD.purchase_token;
  NEW.current_period_end      := OLD.current_period_end;
  NEW.messages_used           := OLD.messages_used;
  NEW.free_message_quota      := OLD.free_message_quota;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_subscription_billing_fields_trigger ON public.coach_subscriptions;
CREATE TRIGGER protect_subscription_billing_fields_trigger
    BEFORE UPDATE ON public.coach_subscriptions
    FOR EACH ROW EXECUTE PROCEDURE public.protect_subscription_billing_fields();

GRANT UPDATE ON public.coach_subscriptions TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Realtime, so a nudge lands in an open thread without a refetch
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'conversation_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_messages;
    END IF;
  ELSE
    RAISE NOTICE 'supabase_realtime publication not present; skipping realtime setup';
  END IF;
END $$;

COMMENT ON TABLE public.push_devices IS 'Expo push tokens; one row per install, disabled when Expo reports DeviceNotRegistered';
COMMENT ON TABLE public.coach_nudges IS 'Outbox for proactive coach messages. Unique per (user, coach, local day) so retries cannot double-send.';
