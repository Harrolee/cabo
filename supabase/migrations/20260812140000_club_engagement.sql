-- ---------------------------------------------------------------------------
-- Club engagement dashboard (issue #32)
--
-- The club owner needs to know whether the thing is working. The hard part is
-- what they must NOT be able to see.
--
-- A member discloses things to a coach that they would never say to the person
-- who runs their club: injuries they are hiding, why they stopped coming,
-- personal circumstances. #30 exists because members disclose mental-health
-- crises in these threads. Surfacing any of that to an owner would be a serious
-- breach and would destroy the candour the coaching depends on.
--
-- So every function here is built on activity signals and counts. None of them
-- reads `conversation_messages.content`, and none of them can be made to --
-- `content` does not appear in a single RETURNS TABLE in this file, and
-- club-probe asserts that at runtime rather than trusting review.
--
-- Also excluded, less obviously: `coach_nudges.body`. It is coach-authored
-- rather than member-authored, so it looks safe, but nudges are generated from
-- the member's own goals and can quote them back. It stays out.
--
-- What IS allowed, per the issue: message counts, last-active dates, streaks,
-- active/dormant counts, engagement over time, nudge response rate.
--
-- Themed aggregates ("6 members asked about knee pain") are deliberately NOT
-- in v1. With a ten-person squad the minimum cohort size that would make them
-- non-attributable is most of the squad, at which point they say nothing. The
-- issue says to leave it out if in doubt. It is out. MIN_COHORT below records
-- the threshold for whoever revisits this.
-- ---------------------------------------------------------------------------

-- The smallest group that may be described in aggregate without the
-- description being traceable to an individual. Referenced by any future themed
-- aggregate; nothing in v1 renders below it.
CREATE OR REPLACE FUNCTION public.club_min_cohort()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 5 $$;

COMMENT ON FUNCTION public.club_min_cohort() IS
    'Minimum cohort size before an aggregate may be shown. With a 10-person squad, "2 members asked about X" is close to identifying.';

-- ---------------------------------------------------------------------------
-- Per-member activity. This is the actionable one: the dormant list is what a
-- head coach actually does something with.
--
-- Returns when someone last spoke and how much, never what they said.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_member_activity(p_club_id uuid)
RETURNS TABLE (
    member_id        uuid,
    user_id          uuid,
    display_name     text,
    role             text,
    joined_at        timestamptz,
    last_active_at   timestamptz,
    days_since_active integer,
    messages_30d     bigint,
    messages_total   bigint,
    state            text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH member AS (
        SELECT m.id, m.user_id, m.role, m.joined_at, up.display_name
        FROM public.club_members m
        LEFT JOIN public.user_profiles up ON up.user_id = m.user_id
        WHERE m.club_id = p_club_id
          AND m.status = 'active'
          AND m.user_id IS NOT NULL
    ),
    -- Only the member's own turns count as activity. A coach nudge landing in
    -- the thread is not the member engaging.
    activity AS (
        SELECT c.user_id,
               max(cm.created_at)                                             AS last_active_at,
               count(*) FILTER (WHERE cm.created_at > now() - interval '30 days') AS messages_30d,
               count(*)                                                       AS messages_total
        FROM public.conversations c
        JOIN public.conversation_messages cm ON cm.conversation_id = c.id
        JOIN public.club_coaches cc ON cc.coach_id = c.coach_id AND cc.club_id = p_club_id
        WHERE cm.role = 'user'
        GROUP BY c.user_id
    )
    SELECT
        m.id,
        m.user_id,
        m.display_name,
        m.role,
        m.joined_at,
        a.last_active_at,
        CASE WHEN a.last_active_at IS NULL THEN NULL
             ELSE EXTRACT(DAY FROM now() - a.last_active_at)::int END,
        COALESCE(a.messages_30d, 0),
        COALESCE(a.messages_total, 0),
        CASE
            WHEN a.last_active_at IS NULL                              THEN 'never'
            WHEN a.last_active_at > now() - interval '7 days'          THEN 'active'
            WHEN a.last_active_at > now() - interval '14 days'         THEN 'slowing'
            ELSE 'dormant'
        END
    FROM member m
    LEFT JOIN activity a ON a.user_id = m.user_id
    WHERE public.is_club_owner(p_club_id)
    ORDER BY a.last_active_at NULLS FIRST;
$$;

-- ---------------------------------------------------------------------------
-- Squad-level summary.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_engagement_summary(p_club_id uuid)
RETURNS TABLE (
    members_total       bigint,
    active_this_week    bigint,
    slowing             bigint,
    dormant_14d         bigint,
    never_messaged      bigint,
    messages_this_week  bigint,
    nudges_sent_30d     bigint,
    nudges_replied_30d  bigint,
    nudge_response_rate numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH a AS (
        SELECT * FROM public.club_member_activity(p_club_id)
    ),
    nudge AS (
        SELECT
            count(*) AS sent,
            count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM public.conversation_messages cm
                WHERE cm.conversation_id = n.conversation_id
                  AND cm.role = 'user'
                  AND cm.created_at BETWEEN n.created_at AND n.created_at + interval '48 hours'
            )) AS replied
        FROM public.coach_nudges n
        JOIN public.club_members m ON m.user_id = n.user_id AND m.club_id = p_club_id AND m.status = 'active'
        JOIN public.club_coaches cc ON cc.coach_id = n.coach_id AND cc.club_id = p_club_id
        WHERE n.created_at > now() - interval '30 days'
          AND n.status = 'sent'
    )
    SELECT
        (SELECT count(*) FROM a),
        (SELECT count(*) FROM a WHERE state = 'active'),
        (SELECT count(*) FROM a WHERE state = 'slowing'),
        (SELECT count(*) FROM a WHERE state = 'dormant'),
        (SELECT count(*) FROM a WHERE state = 'never'),
        (SELECT COALESCE(sum(cnt), 0) FROM (
            SELECT count(*) AS cnt
            FROM public.conversations c
            JOIN public.conversation_messages cm ON cm.conversation_id = c.id
            JOIN public.club_coaches cc ON cc.coach_id = c.coach_id AND cc.club_id = p_club_id
            JOIN public.club_members m ON m.user_id = c.user_id AND m.club_id = p_club_id AND m.status = 'active'
            WHERE cm.role = 'user' AND cm.created_at > now() - interval '7 days'
        ) s),
        (SELECT sent FROM nudge),
        (SELECT replied FROM nudge),
        (SELECT CASE WHEN sent = 0 THEN NULL
                     ELSE round((replied::numeric / sent) * 100, 1) END FROM nudge)
    WHERE public.is_club_owner(p_club_id);
$$;

-- ---------------------------------------------------------------------------
-- Engagement over time. Counts per day, nothing else.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_engagement_timeseries(p_club_id uuid, p_days integer DEFAULT 30)
RETURNS TABLE (day date, active_members bigint, messages bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT d.day::date,
           count(DISTINCT c.user_id),
           count(cm.id)
    FROM generate_series(
             (now() - make_interval(days => GREATEST(1, LEAST(p_days, 365))))::date,
             now()::date,
             interval '1 day') AS d(day)
    LEFT JOIN public.conversations c
           ON EXISTS (SELECT 1 FROM public.club_coaches cc
                       WHERE cc.coach_id = c.coach_id AND cc.club_id = p_club_id)
          AND EXISTS (SELECT 1 FROM public.club_members m
                       WHERE m.user_id = c.user_id AND m.club_id = p_club_id AND m.status = 'active')
    LEFT JOIN public.conversation_messages cm
           ON cm.conversation_id = c.id
          AND cm.role = 'user'
          AND cm.created_at::date = d.day::date
    WHERE public.is_club_owner(p_club_id)
    GROUP BY d.day
    ORDER BY d.day;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Per docs/grant-matrix.md: revoke the PUBLIC default first, then grant
-- deliberately. Each function embeds is_club_owner() in its own WHERE, so a
-- non-owner gets zero rows rather than an error -- an owner of club A probing
-- club B learns nothing about whether club B exists.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.club_member_activity(uuid)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.club_engagement_summary(uuid)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.club_engagement_timeseries(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.club_min_cohort()                       FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.club_member_activity(uuid)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.club_engagement_summary(uuid)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.club_engagement_timeseries(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.club_min_cohort()                       TO authenticated, service_role;
