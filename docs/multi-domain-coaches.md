# Multi-domain coaches

How the platform went from "an SMS fitness coach" to "a roster of coaches in any
discipline, subscribed to individually from a mobile app".

## What was in the way

| Problem | Where it lived |
| ------- | -------------- |
| Fitness was hardcoded | The system prompt said "AI fitness coach"; the situation vocabulary was `pre_workout` / `plateau` / `injury_recovery`; the roster was five personas in a `coach_type` enum |
| One coach per user | `user_profiles.coach` XOR `custom_coach_id`, enforced by `check_coach_selection` |
| Billing was platform-level | A single Stripe subscription keyed by phone number. No per-creator entitlement, no revenue split |
| Identity was a US phone number | `phone_number NOT NULL` with a `^\+1…` check, and RLS policies keyed on `auth.jwt() ->> 'phone'`. Someone signing in with Apple has no phone |
| Conversations were untyped blobs | JSON in a GCS bucket keyed by phone number. The app had no history to render |
| Interaction logging was broken | `coach-response-generator` inserted into `coach_test_messages` using columns that do not exist on it, so every insert failed silently inside a `catch` |

## What replaced it

### The coach carries its own domain

`coach_profiles` gained `discipline`, `expertise[]`, `domain_lexicon`,
`session_contexts[]`, `starter_prompts[]`, `intro_message`,
`coaching_boundaries` and a `category_slug` into the extensible
`coach_categories` table. The prompt builder
(`functions/shared/coach-domain.js`) reads all of it, so a drummer's coach talks
about ghost notes and the click while a yoga teacher's talks about breath and
drishti — same code, same response styles.

`session_contexts` are creator-authored, which is what makes the situation
detection domain-agnostic: `detectSessionContext()` scores the message against
*this coach's* labels instead of a hardcoded workout list.

Response styles (`tough_love`, `wise_mentor`, …) were already about *manner*
rather than subject matter, so they carried over unchanged.

### Many coaches per person

`coach_subscriptions` is a per-(user, coach) entitlement with its own status and
source (`apple_iap`, `stripe`, `free_tier`, `creator_comp`, …).
`has_coach_access(user, coach)` is the single place that decides whether a
conversation may continue; everything else calls it.

`user_profiles.coach` / `custom_coach_id` survive, demoted to "the default coach
for SMS".

### Creators

`creator_profiles` owns coaches and carries the payout terms
(`revenue_share_bps`, default 70%). A coach can only reach `listing_status =
'listed'` when an approved creator stands behind it, enforced by a trigger so
the rule holds regardless of which RLS policy admitted the write.

### Identity

`user_profiles.user_id` references `auth.users`, phone became optional and E.164
rather than US-only, and RLS accepts `auth.uid()` or the email claim alongside
the legacy phone claim. Nothing about the existing SMS funnel changed.

### Conversations

`conversations` (one per user/coach/channel) and `conversation_messages`
(durable history plus generation telemetry) replace the GCS blobs for app
traffic. `coach-response-generator` now writes both turns here — which is also
the fix for the silently-failing log insert.

Clients may append `role = 'user'` only; assistant turns are written by the
service role, so a client cannot forge coach output.

### Payments

Web keeps Stripe. Mobile uses per-coach StoreKit subscriptions, mapped in
`coach_iap_products` and validated by the new `iap-validator` function against
Apple's certificate chain. See `functions/iap-validator/README.md`.

## Free tier

`open_coach_conversation()` creates a `free_tier` entitlement on first contact.
Each reply burns one message via `consume_free_message()`. Free access is
*metered*, not timed — `has_coach_access` deliberately excludes `free_tier` rows
from the status/period branch so a `trialing` free row cannot grant unlimited
access.

## Migrations

| File | Contents |
| ---- | -------- |
| `20260810120000_generalize_coach_domain.sql` | Categories, domain columns, roster search, backfill |
| `20260810120100_creators_and_coach_subscriptions.sql` | Creators, entitlements, store products, `has_coach_access`, `get_coach_roster` |
| `20260810120200_app_identity_and_conversations.sql` | `auth.users` identity, conversations, `open_coach_conversation`, `get_my_coaches` |

All three are idempotent and verified by applying the full migration chain from
scratch against Postgres 16 + pgvector.

`supabase/seeds/example_roster.sql` seeds a drummer, a songwriter and a yoga
instructor. It is a seed, not a migration — run it by hand on dev/staging.

## Known follow-ups

- **Web app still shows the fitness framing.** `HeroCoachPage`, the coach
  builder questionnaire and `MobileOnboarding` all speak fitness and hardcode
  `COACH_PERSONAS`. The data model behind them is already domain-agnostic;
  the copy and the builder form are not.
- **Google Play billing** is stubbed. `/iap-validator/verify` returns 501 for
  Android rather than granting anything.
- **Creator onboarding** has no UI. Creating a `creator_profiles` row and
  approving it is a manual insert today.
- **Revenue split is recorded, not paid.** `revenue_share_bps` is stored; there
  is no payout job.
- **`motivational-images`** is still entirely fitness-specific and only makes
  sense for fitness coaches.
