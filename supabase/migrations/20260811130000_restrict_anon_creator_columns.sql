-- Restrict what `anon` can read from creator_profiles.
--
-- 20260810120100 granted anon SELECT on the whole table so that the
-- "Anyone can view approved creators" policy could fire at all — without a
-- table grant the logged-out coach detail page failed with
-- "permission denied for table creator_profiles", because grants are checked
-- before RLS.
--
-- But RLS restricts ROWS, not COLUMNS. The row policy admits approved
-- creators; the table grant then exposed every column of them, including:
--
--   user_email         NOT NULL, so always populated
--   payout_account_id  payment account identifier
--   payout_provider    payment routing
--   revenue_share_bps  per-creator commercial terms
--
-- The anon key ships in the web bundle, so that was internet-reachable. It
-- mattered little while the only creators were the platform row and the
-- founder; it matters as soon as creators sign themselves up
-- (20260811120100).
--
-- Column-level grants rather than a view, deliberately: the only anon read
-- path is the embedded join in mobile/src/lib/api.ts, which selects
-- display_name, slug and avatar_url. Column grants keep that join working
-- untouched, where swapping in a view would need a client change to match.
--
-- Idempotent: REVOKE and GRANT are both safe to repeat.

REVOKE SELECT ON public.creator_profiles FROM anon;

-- The public face of a creator: what a logged-out visitor needs to see who
-- stands behind a coach. Nothing here is sensitive.
GRANT SELECT (
    id,
    display_name,
    slug,
    bio,
    avatar_url,
    website_url,
    social_links
) ON public.creator_profiles TO anon;

-- authenticated keeps table-level SELECT for now: a creator must be able to
-- read their own status and revenue_share_bps. That is a real remaining gap —
-- any signed-in user can read every approved creator's payout columns — and
-- needs a view or definer function to fix properly, since the split depends on
-- whether the row is yours. Tracked separately; not widened here.

DO $$
BEGIN
    RAISE NOTICE 'anon SELECT on creator_profiles narrowed to public presentation columns';
END $$;
