# Grant matrix

The intended privilege for every object in `public`, per role. This is the
reviewable artifact issue #25 asks for: if the live schema and this table
disagree, one of them is a bug.

`REFERENCES`, `TRIGGER` and `TRUNCATE` are granted broadly by Supabase defaults
and are omitted throughout — they are noise, not intent. Only `SELECT`,
`INSERT`, `UPDATE`, `DELETE` and `EXECUTE` are stated.

## The rule that caused this

**Postgres grants `EXECUTE` on every new function to `PUBLIC` by default.** A
`GRANT EXECUTE ... TO service_role` next to a `SECURITY DEFINER` function
therefore excludes nobody — the function stays callable by `anon`, whose key
ships in the web bundle and is readable by anyone who opens devtools.

Every new `SECURITY DEFINER` function needs an explicit
`REVOKE ALL ... FROM PUBLIC, anon` and *then* a deliberate grant. This is
enforced by `security_definer_grant_audit()`, asserted in `rls-probe.mjs`, so
the next function that forgets fails the probes rather than shipping.

## Roles

| Role | Who holds it |
| --- | --- |
| `anon` | Any unauthenticated visitor. The key is public — treat this as "the internet". |
| `authenticated` | A signed-in member. Row scoping comes from RLS on `auth.uid()`, **not** from the grant. |
| `service_role` | The Cloud Functions. Bypasses RLS entirely; the grant is the only control. |

## Tables

| Table | anon | authenticated | service_role | RLS | Notes |
| --- | --- | --- | --- | --- | --- |
| `coach_categories` | SELECT | SELECT | ALL | on | Public taxonomy. |
| `coach_profiles` | SELECT | SELECT, INSERT, UPDATE, DELETE | ALL | on | Anon sees listed+active rows only, via policy. |
| `coach_iap_products` | SELECT | SELECT | ALL | on | Prices are public; the roster shows them logged-out. |
| `creator_profiles` | SELECT *(7 columns)* | SELECT, INSERT, UPDATE | ALL | on | Column-scoped for anon: `id, slug, display_name, bio, avatar_url, website_url, social_links`. Payout and revenue-share columns are **not** among them. |
| `coach_content_chunks` | — | ALL | ALL | on | Creator-authored source material. |
| `coach_test_messages` | — | ALL | ALL | on | Builder scratch space. |
| `coach_subscriptions` | — | SELECT, INSERT, UPDATE | ALL | on | Entitlement rows. `UPDATE` is narrowed by `protect_subscription_billing_fields()`. |
| `conversations` | — | SELECT, INSERT, UPDATE | ALL | on | |
| `conversation_messages` | — | SELECT, INSERT | ALL | on | No UPDATE/DELETE for members: a thread is append-only. |
| `member_goals` | — | ALL | ALL | on | |
| `coach_visualizations` | — | SELECT, UPDATE | ALL | on | Members do not create these; the visualiser does. |
| `push_devices` | — | ALL | ALL | on | |
| `coach_nudges` | — | SELECT | ALL | on | Read-only to the member; the dispatcher writes. |
| `coach_prompt_version_rollout` | — | — | — | on | Platform-only, reached through `SECURITY DEFINER` functions. |
| `user_profiles` | — | SELECT, UPDATE | SELECT, INSERT, UPDATE, DELETE | on | `UPDATE` is narrowed by `protect_likeness_fields()`. **Anon must never hold SELECT** — see below. |
| `subscriptions` | — | SELECT | SELECT, INSERT, UPDATE, DELETE | on | Legacy billing table. |
| `clubs` | — | SELECT *(6 columns)*, UPDATE *(name, slug)* | ALL | on | Column-scoped: `id, slug, name, status, creator_id, created_at`. The commercial columns (`seats`, `plan`, `billing_email`, `external_billing_ref`, `notes`) are **not granted to `authenticated` at all** — an owner reads them through `club_billing()`. A policy mistake therefore cannot leak them. |
| `club_members` | — | SELECT | ALL | on | Policy: own row, or any row if `is_club_owner()`. A member must not be able to enumerate the squad. |
| `club_coaches` | — | SELECT | ALL | on | Visible to members of that club. |

### Why `anon` must not hold SELECT on `user_profiles`

An RLS predicate is evaluated as the **invoking** role, not the table owner. So
a policy on table A that subqueries table B forces every reader of A to hold
`SELECT` on B.

Four legacy policies on `coach_profiles` did exactly this — they matched a coach
to its owner by looking the caller's phone number up in `user_profiles`. Their
mere existence made the logged-out coach detail page fail with
`permission denied for table user_profiles`, which is what four assertions in
`rls-probe.mjs` were failing on. The tempting fix — granting `anon` SELECT on
`user_profiles` — would have exposed every member's email, phone number,
timezone and reference photo URL to the internet.

They were dropped instead (`20260812120000_grant_discipline_sweep.sql`). The
uid/email policies that replaced them in the multi-domain work already cover
owner access and touch no other table.

## `SECURITY DEFINER` functions

These bypass RLS by design. The grant is the entire access control.

### Deliberately public

| Function | Reachable by | Why it is safe |
| --- | --- | --- |
| `get_coach_roster(text,text,int,int)` | anon, authenticated, service_role | Reads listed+active coaches only. This is the logged-out browse. |
| `get_coach_by_handle(text)` | anon, authenticated, service_role | Same, for a single coach. |

These two are the allowlist inside `security_definer_grant_audit()`. Adding to
that list is a deliberate act and should be argued for in the PR.

### Caller-scoped — `authenticated`

Bodies filter on `auth.uid()`. Granted to `authenticated`, never `anon`.

`begin_goal_onboarding(uuid)`, `get_my_coaches()`, `mark_conversation_read(uuid)`,
`open_coach_conversation(uuid)`, `register_push_device(text,text,text,text)`,
`release_push_device(text)`, `creator_slug_available(text)`, `owns_coach(uuid)`,
`unread_message_count(uuid)`, `has_coach_access(uuid,uuid)`,
`get_member_context(uuid,uuid)`, `is_club_owner(uuid)`, `is_club_member(uuid)`,
`club_roster(uuid)`, `club_billing(uuid)`, `club_member_activity(uuid)`,
`club_engagement_summary(uuid)`, `club_engagement_timeseries(uuid,int)`,
`club_min_cohort()`

The four club-engagement functions carry a constraint the grant alone cannot
express: **none of them may return `conversation_messages.content`.** A club
owner must not be able to read what their members told a coach — members
disclose injuries they are hiding, why they stopped coming, and (see #30)
mental-health crises. An AI summary of a named member's thread is still
disclosure.

`content` therefore appears in no `RETURNS TABLE` in
`20260812140000_club_engagement.sql`, and `club-probe.mjs` plants recognisable
strings in a member's messages and scans every field of every owner-reachable
payload for them. `coach_nudges.body` is excluded on the same grounds: it is
coach-authored, so it looks safe, but nudges are generated from the member's
goals and can quote them back.

`is_club_owner` / `is_club_member` are `SECURITY DEFINER` for a structural
reason, not convenience: the RLS policies on `club_members` need to ask "is the
caller an owner of this club", which is itself a question about `club_members`.
Asking it through a policy-bound query recurses. Reading the table with RLS
bypassed breaks the cycle.

`club_roster` and `club_billing` are granted to `authenticated` but each embeds
`is_club_owner(p_club_id)` in its own `WHERE`, so a non-owner gets zero rows
rather than an error. That is deliberate: it means an owner of club A probing
club B learns nothing about whether club B exists.

`has_coach_access` and `get_member_context` take a `p_user_id` rather than
reading `auth.uid()` directly, because the Cloud Functions call them on a
member's behalf. Both now short-circuit when `auth.uid()` is set and does not
match `p_user_id`, so a signed-in member cannot ask about anyone else.
`service_role` runs with `auth.uid() = NULL` and is unaffected.

### Backend only — `service_role`

No client role has any business calling these.

`due_coach_nudges(int)`, `consume_free_message(uuid,uuid)`,
`delete_member_account(uuid)`, `revert_prompt_version_rollout()`,
`create_user_with_trial(text,text,text,text)`, `get_or_create_user(text,text,text)`,
`check_subscription_access(text)`, `get_trial_days_remaining(text)`,
`can_publish_coaches(text)`, `search_similar_content(uuid,vector,int)`,
`security_definer_grant_audit()`, `club_add_members(uuid,text[])`,
`grant_club_seat(uuid,uuid,uuid)`, `revoke_club_seats(uuid,uuid)`

Seat granting is backend-only on purpose. If `grant_club_seat` were reachable by
`authenticated`, any signed-in member could mint themselves a comped entitlement
to any coach — the entitlement system's own bypass. `club-probe.mjs` asserts
both `anon` and a signed-in member get `42501` from all three.

### Trigger functions

`handle_new_user`, `handle_updated_at`, `enforce_coach_listing_rules`,
`protect_creator_platform_fields`, `protect_likeness_fields`,
`protect_subscription_billing_fields`, `sync_coach_subscriber_count`,
`touch_conversation_on_message`, `coach_profiles_refresh_search_document`

Revoked from everyone. Postgres refuses a direct call of a function returning
`trigger`, so this costs nothing; triggers fire as the table owner regardless of
`EXECUTE` grants.

## What was actually exploitable before this

Verified on a from-scratch stack using only the anon key over PostgREST, then
re-verified as `42501 permission denied` afterwards.

| Function | Result as anon | Severity |
| --- | --- | --- |
| `due_coach_nudges(int)` | Returned another member's `user_id`, `display_name`, coach name and discipline. No `auth.uid()` filter exists in it at all — it was written as a service_role dispatcher query. | **High.** Discloses that a named person is being coached, and on what. |
| `consume_free_message(uuid,uuid)` | Incremented `messages_used` three times over three unauthenticated calls, exhausting a member's free tier. | **Medium.** Unauthenticated write; denial of the free tier. |
| `has_coach_access(uuid,uuid)` | Returned `true` for an arbitrary member id — and the id needed to drive it leaks from `due_coach_nudges`. | **Medium.** Entitlement oracle. |
| `check_subscription_access(text)`, `get_trial_days_remaining(text)`, `can_publish_coaches(text)` | Answered questions about an arbitrary email address. | **Low–medium.** Subscriber-enumeration oracle. |
| `create_user_with_trial(...)`, `get_or_create_user(...)` | Executed as anon and reached their `INSERT`. | **Medium.** Unauthenticated account-creation path. |
| `begin_goal_onboarding`, `open_coach_conversation`, `register_push_device`, `release_push_device`, `mark_conversation_read`, `get_my_coaches`, `unread_message_count`, `owns_coach`, `creator_slug_available` | Callable, but bodies are `auth.uid()`-scoped, so they no-opped. `release_push_device` returned `204` and changed nothing. | **None observed.** Revoked anyway — "the body happens to check" is not an access control. |

## Errors that read as absence

The third failure mode behind #25: a `PostgREST` permission error and a
legitimate empty result are not the same thing, and several call sites treated
them identically. A permission failure that reads as "no consent" or "no rows"
turns a loud failure into silent wrong behaviour.

When reading through PostgREST, check `error` before trusting `data`. See
`functions/coach-visualizer` for the instance that motivated this — the
visualiser discarded the error from its `user_profiles` read, which reads
exactly like "the member has not granted likeness consent".
