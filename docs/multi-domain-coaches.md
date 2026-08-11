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

One creator is the platform itself: slug `cabo`, `user_id IS NULL`, no payout
share. The five original fitness personas (Zen Master, Gym Bro, Dance Teacher,
Drill Sergeant, Frat Bro) belong to it, because they ship with the product
rather than being anyone's work. They were seeded against the founder's own
account and so were attributed to them personally in the roster until
`20260811090100`.

Anyone can sign themselves up at `/creator` in the web app. The form sends only
the columns a creator owns; `protect_creator_platform_fields()` discards
`status`, `revenue_share_bps` and the payout columns on **insert as well as
update**, so a new profile always lands `pending` on the standard split however
the request was shaped. Approval is a platform action performed by the admin
dashboard through `admin-api`, which holds the service role key server-side —
the trigger only stands aside when `auth.uid()` is null.

Publishing walks `draft → in_review → listed` from the coach card in
`/my-coaches`. Submitting for review always succeeds; reaching the roster does
not, and the `insufficient_privilege` a pending creator gets back is rendered as
"your creator account is still under review" rather than as a Postgres error.
Approving a creator publishes whatever they already queued; suspending one pulls
their listings back to `unlisted`.

### Identity

`user_profiles.user_id` references `auth.users`, phone became optional and E.164
rather than US-only, and RLS accepts `auth.uid()` or the email claim alongside
the legacy phone claim. Nothing about the existing SMS funnel changed.

### Deleting an account

App Store Review Guideline 5.1.1(v) requires an app that creates accounts to
delete them from inside the app, so Settings → Delete account leads to a screen
that names what will be destroyed and gates on typing the word DELETE. The work
happens in `functions/account-deletion`, in this order and for this reason:

1. **The reference photo objects, first.** Swept by prefix across the whole
   `member-reference/<user id>/` path rather than by the URI in
   `reference_photo_url`, exactly as `coach-visualizer`'s likeness revocation
   does, so a photo stored under an older extension cannot survive. The
   member-media bucket sets `soft_delete_policy` retention to 0 so this is real.
   If it fails, **nothing else happens** — an orphaned photograph of somebody
   who no longer has an account is worse than a deletion they have to retry.
2. **Every public-schema row**, through `delete_member_account()`, one
   transaction, service role only.
3. **The `auth.users` row**, through GoTrue's admin API so identities, sessions
   and refresh tokens go with it.

**Decided: coaches the member created are not deleted with them, and not
orphaned either.** `20260812090000` first defuses the two foreign keys that made
the question urgent — `coach_profiles.user_id` and `.user_email` both cascaded,
so deleting one person destroyed every coach they owned and, through those,
other members' subscriptions, threads and goals. Both are now `ON DELETE SET
NULL`, and the function decides explicitly instead:

| Case | Outcome |
| ---- | ------- |
| Attributed to another creator (this is the five default personas, which still carry the founder's address in the legacy `user_email` column) | **Detached.** `user_id` and `user_email` cleared; listing and attribution untouched. |
| Theirs, and other members are subscribed or have threads | **Retained and unlisted.** It keeps working for the people paying for it; nobody new can subscribe to a coach with nobody behind it. |
| Theirs, and nobody else uses it | **Deleted**, with its content chunks and store products. |

Their `creator_profiles` row is deleted if no coach still points at it, and
otherwise survives with `user_id`, name, slug, bio, avatar, links, email and
payout details all replaced — a row left sitting there with somebody's name and
payout account in it is not deletion.

**Apple subscriptions are not cancelled by any of this**, because they belong to
the Apple ID rather than to the Cabo account and nothing on our side can touch
them. The confirmation screen says so in a warning block above the confirmation
field, with a link to the App Store subscription settings, because finding that
out from the next charge is how someone becomes justifiably angry — and is an
App Review risk in its own right.

`get_coach_roster()` and `get_my_coaches()` both `LEFT JOIN creator_profiles`
and are unaffected; `coach_profiles.subscriber_count` stays honest because the
`AFTER DELETE` trigger on `coach_subscriptions` recomputes it per row.
`account-deletion-probe.mjs` asserts all of that, and that the photo object is
genuinely gone from the bucket.

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

## Decision: SMS stays, and the daily image was generalised

**Decided: generalise the daily image job rather than retire it or freeze it**
(issue #13, options were retire / generalise / freeze).

The reasoning is a product bet about acquisition, not about any measurement of
the current install base: **signing up over SMS is meaningfully less friction
than asking someone to download an app.** Someone can be texting a coach a
minute after hearing about it, with no store page, no account creation and no
install. That is worth keeping as a real, first-class channel, and keeping it
means the outbound content on that channel has to work for every discipline on
the roster — not just the fitness personas that predate the split. Retiring the
job would have thrown the channel away to save maintaining one function; the
freeze option would have kept a fitness-shaped job alive and simply refused to
serve anyone else.

There is no production user base yet, which made this cheaper than it looks:
there is no back-compatibility to preserve with what the old scenario table
produced, so the implementation is the clean generalised one rather than a
migration that tiptoes around live output.

What changed in `functions/motivational-images`:

- `scenarios.js` (472 lines of fitness before/after pairs), `descriptors.js`
  and `prompt-generation.js` are deleted, along with the local copy of
  `COACH_PERSONAS`. The whole "substitute the member's `image_preference` for
  the word *person* in a canned gym scene" approach is gone.
- The job now runs the same pipeline the app's visualiser runs: it resolves the
  member's coach row, reads `get_member_context`, and renders the scene through
  `functions/shared/visualization.js` (copied in per directory, as Cloud
  Functions are zipped per-function). A drummer gets a kit, a yoga teacher gets
  a mat, and there is no branch in the job that knows about any discipline.
- With an aspiration on file the image is `becoming`; without one it is
  `today` — an ordinary moment from the practice — rather than a guess at who
  they want to be. `image_preference` survives only as a fallback for
  `member_goals.visual.self`, i.e. "how do you want to be depicted".
- **The shame framing is gone.** The old "before" image was prompted toward
  `weak, frail, sad, nervous, skinny, chubby, overweight`. There is no before
  image any more, and body descriptors sit on the *negative* side of every
  prompt, exactly as they do for app users.
- One image and one caption per send, in the coach's own voice, instead of a
  pair plus a generated "transformation" message.
- If the coach cannot be resolved, **nothing is sent**. There is no fitness
  default left to fall back to, which is what makes "a non-fitness SMS member
  cannot receive gym imagery" a property of the code rather than a hope.
- Likeness is used only with explicit `likeness_consent`, matching the app.
- The `trigger-daily-motivation` scheduler job in `_infra/main.tf` stays, since
  the channel stays.

`mobile/e2e/sms-image-probe.mjs` is the proof: it drives the real job against
the real database for a drumming member, a yoga member and a legacy fitness
member, and asserts on the actual model input.

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
| `20260811090100_platform_creator_for_default_coaches.sql` | The `cabo` platform creator; the five default coaches repointed at it |
| `20260811120000_service_role_grants_for_legacy_tables.sql` | Explicit `service_role` DML on `user_profiles` / `subscriptions`, which the SMS job reads with the service key |
| `20260811120100_creator_self_signup.sql` | INSERT guard on the platform-owned creator columns, one profile per account, `creator_slug_available`, coach attribution guard |
| `20260811120200_prompt_v2_rollout.sql` | Moves every coach to prompt v2, logging previous values so the rollout is exactly reversible |
| `20260812090000_account_deletion.sql` | `coach_profiles`' two owner foreign keys stop cascading; `delete_member_account()` |

All of them are idempotent and verified by applying the full migration chain
from scratch against Postgres 16 + pgvector.

`supabase/seeds/example_roster.sql` seeds a drummer, a songwriter and a yoga
instructor. It is a seed, not a migration — run it by hand on dev/staging.

## Known follow-ups

- **Web app still shows the fitness framing.** `HeroCoachPage`, the coach
  builder questionnaire and `MobileOnboarding` all speak fitness and hardcode
  `COACH_PERSONAS`. The data model behind them is already domain-agnostic;
  the copy and the builder form are not.
- **Google Play billing** is stubbed. `/iap-validator/verify` returns 501 for
  Android rather than granting anything.
- **Approved creators' payout terms are readable by any signed-in user.**
  `authenticated` holds table-level `SELECT` on `creator_profiles`, and the
  "Anyone can view approved creators" policy admits every approved row — so
  `revenue_share_bps` and `payout_account_id` come with it. `anon` is limited to
  the public columns; `authenticated` is not, because a creator has to be able
  to read their own split. Splitting the two needs a view or a definer function.
- **Revenue split is recorded, not paid.** `revenue_share_bps` is stored; there
  is no payout job.
- **The coach detail read fails for `anon`.** Selecting `coach_profiles` with
  embedded joins returns `permission denied for table user_profiles`, because
  the legacy phone-era policies (`Users can view their own coaches`) subquery
  `user_profiles` directly instead of going through the `SECURITY DEFINER`
  `owns_coach()`, and `anon` has no grant on that table. Reproducible on `main`
  and visible as four failures in `rls-probe.mjs`; the fix is to rewrite those
  three policies in terms of `owns_coach()`, which is what the newer `by uid`
  policies already do.
- **SMS members have no way to give likeness consent.** The daily image now
  honours `likeness_consent` strictly, and nothing in the SMS flow asks for it,
  so every SMS image renders scene-only until that is wired up.
- **Predefined personas must exist as `coach_profiles` rows.** They are
  inserted conditionally by `20250531093301_add_predefined_coaches.sql`; where
  the row is missing, the daily image job skips that member rather than
  guessing a discipline.
