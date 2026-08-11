# Push, in-app chat, prompt v2, and goal-driven visualisation

Second pass on the multi-domain platform (see `multi-domain-coaches.md` for the
first). Four connected changes.

## 1. Push replaces SMS as the outbound channel

Proactive coaching was a 9am Twilio SMS from `motivational-images`. For app
users it is now a push notification that opens the coach's thread, with the
message already in it.

```
Cloud Scheduler (hourly, :05)
  └─ coach-nudges /dispatch
       ├─ due_coach_nudges()          who is due, in their own timezone
       ├─ claim coach_nudges row      unique per (user, coach, local day)
       ├─ coach-response-generator    the message, in the coach's voice
       │    suppressUserTurn: true    the steering prompt is not shown to them
       ├─ conversation_messages       so it survives the notification
       └─ Expo Push API               one call per device
```

**Timing.** Each member has `nudge_hour` and `quiet_hours_*` in their own
`timezone`, so the sweep runs hourly rather than daily. It fires within a
3-hour window of the target hour — if the dispatcher is down overnight, nobody
wakes up to a backlog.

**Idempotency.** `coach_nudges` is unique on `(user_id, coach_id, local_date)`
and the row is claimed *before* generation. Overlapping runs and webhook
retries lose the insert and stop.

**Cadence** is measured against `last_nudge_at`, not a schedule table, so
'weekly' means "at least 6 days since the last one" and self-corrects after a
missed run.

**Dead tokens.** Expo's ticket and receipt responses are both reconciled;
`DeviceNotRegistered` disables the row rather than retrying forever.

**Existing SMS users are untouched.** `user_profiles.notification_channel`
backfills to `'sms'` for every row that existed, and only new app signups
default to `'push'`. `fetchActiveUsers` in `motivational-images` now filters to
`notification_channel = 'sms'`, so nobody gets both.

### In-app chat

- `conversation_messages` is on the `supabase_realtime` publication, so a
  coach-initiated message appears in an open thread without a refetch.
- Foreground notifications are suppressed for the thread you are already
  looking at.
- `conversations.last_read_at` + `unread_message_count()` drive the unread
  badges; `get_my_coaches()` returns the count and a preview.
- Permission is requested **after** the first real exchange, not at launch.
  iOS asks once, and a cold prompt before you have met a coach gets denied.

## 2. Prompt v2

`coach_profiles.prompt_version` selects between them, so a coach tuned against
the 2024 prompt is not changed underneath its creator. Existing rows are pinned
to `v1`; new rows default to `v2`.

What was wrong with v1 (`coach-domain.js`, still shipping):

- One interpolated string mixing identity, channel rules and the member's
  message — with the message pasted into the system prompt *and* sent as the
  user turn.
- Conversation history flattened into a `Them:/You:` transcript inside the
  system prompt, which both weakens it and puts member text in the instruction
  channel.
- It knew who the coach was and nothing about who it was talking to.
- Retrieved content framed as material to draw on, which invited recitation.
- No anti-sycophancy or "say you don't know" rule.

v2 (`coach-prompt-v2.js`):

- Delimited sections: `<identity>`, `<voice>`, `<domain_language>`,
  `<member>`, `<your_material>`, `<situation>`, `<boundaries>`,
  `<output_rules>`.
- Real message objects for history; the member's message appears exactly once.
- Voice knobs rendered as behaviour ("say the hard thing in the first
  sentence") rather than "Directness: 8/10".
- The `<member>` block carries aspiration, level, obstacles, wins and days
  together.
- Retrieved chunks framed as *evidence of voice*, explicitly not as answers.
- Output rules last, concrete, and including: one action per message, don't
  agree just because they said it, say you don't know.

## 3. Conversational goal intake

First contact with a coach runs an intake rather than a form. The same model
call writes the reply and extracts what it learned, under a strict JSON schema.

- At most 6 turns, hard-stopped in code regardless of what the model says.
- One question per message; nulls rather than guesses.
- `mergeGoals` only fills gaps and appends, so a later vague answer cannot
  overwrite an earlier specific one (verified: "hold the pocket all night"
  survives a subsequent "get better at drums").
- Intake messages are **not** metered — charging someone for answering "what
  are you working on?" is a bad first impression.
- The member can correct anything at `goals/[coachId]`, because extraction will
  sometimes be subtly wrong.

Creators author their own intake in `coach_profiles.onboarding_questions`, so a
drum teacher asks different questions than a songwriter.

## 4. Visualisation: what you want to become

The old pipeline picked a random before/after pair from `scenarios.json` and
substituted the user's `image_preference` for the word "person". Every user in
every discipline got the same gym scenes, and the "before" image was explicitly
prompted toward *weak, frail, sad, nervous, skinny, chubby, overweight*.

`coach-visualizer` replaces it:

- The scene comes from `member_goals.aspiration` — what they told their coach
  they want to become. No aspiration, no image; the function returns
  `no_aspiration` and the app sends them back to the conversation rather than
  inventing a goal for them.
- An LLM turns the abstract aspiration into a photographic brief (subject,
  action, place, light), because diffusion models need a scene, not an
  identity statement.
- Three kinds: `becoming`, `milestone`, `today`.
- No before/after, no transformation pairing, no crowd's admiration, no trophy.
- Body descriptors moved to the **negative** prompt for every image. None of
  these disciplines are about how someone looks.
- Likeness uses PhotoMaker with the member's reference photo, and only with
  explicit `likeness_consent`; otherwise it renders the scene with no
  identifiable person.
- 3 images per member per day.

## Migrations

| File | Contents |
| ---- | -------- |
| `20260810130000_push_notifications_and_channels.sql` | `push_devices`, notification channel + timing, per-coach cadence, `coach_nudges` outbox, unread state, realtime, `due_coach_nudges()` |
| `20260810140000_member_goals_and_visualization.sql` | `member_goals`, creator intake questions, `prompt_version`, `coach_visualizations`, `get_member_context()` |

Verified by applying the full chain from scratch against Postgres 16 + pgvector
and exercising the rules: device gating, idempotent claim, mute, cadence
windows, quiet hours (including the midnight wrap), expired entitlements, the
SMS-channel exclusion, and unread/mark-read.

## Configuration

New Terraform variables: `expo_access_token`, `internal_service_key`,
`nudge_batch_size`, `openai_chat_model`, `visualization_daily_limit`.

`internal_service_key` is a shared secret. The dispatcher sends it as
`x-internal-key` to ask the generator for a coach-initiated turn;
`suppressUserTurn` and `onBehalfOfUserId` are rejected without it, since
otherwise a member could write into someone else's thread.

The app needs an **EAS project id** in `app.json` (`extra.eas.projectId`) before
`getExpoPushTokenAsync` will return a token. `eas init` sets it.

## Verified end to end

Driven against a real local Supabase (Postgres + PostgREST + Auth + Realtime)
with the functions running over HTTP, and the app itself built and driven on an
iOS simulator. 92 automated checks in `mobile/e2e/`, plus a manual pass through
sign-in → roster → coach detail → intake → goals → visualiser → notification
settings.

Bugs this surfaced and fixed:

| Bug | Symptom |
| --- | ------- |
| Duplicate user messages in the thread | The realtime handler only de-duped *assistant* rows by content, so the server's copy of the user's own turn was appended after the optimistic one. Reconciliation now matches on (role, content) and replaces the local stand-in whichever copy lands first. |
| A device could never change hands | `push_devices.expo_token` is unique, so a second account signing in on the same install hit an RLS refusal on the upsert — silently, since the client only warns. That account would never receive a notification again. Registration now goes through `register_push_device()`, which reassigns ownership; sign-out disables rather than deletes. |
| Raw infrastructure errors shown to members | A failed image generation put a full Google Cloud JSON error into a UI alert. All four functions now return a generic message on 5xx and log the detail; the client refuses to render a 5xx body regardless. |
| Replicate output mishandled | `replicate.run()` returns an array of `FileOutput` whose `.url()` yields a `URL` object, not a string. The extractor returned that object and gave an opaque "Model returned no image" on any other shape. Now normalises string / URL / FileOutput / array / `{output}` and logs the shape when it cannot. |
| Failed generations burned the daily quota | The limit counted every row including failures, so our own errors used up a member's three images. Failures are excluded. |
| Search box rendered with broken letter-spacing | iOS reuses native `TextInput` views and does not clear `letterSpacing` when the prop is absent, so the sign-in code field's spacing bled into the roster search — the first screen after every email signup. Pinned to `0` on the affected inputs. |
| Coach avatar clipped in half | `headerTransparent: true` was defeated by the shared `headerStyle` background painting over the hero. |
| 21 buttons invisible to VoiceOver | `Pressable`s without `accessibilityRole`, including every primary CTA. Also added labels to the multiline chat composer and the goal fields, which announced nothing. |

Not verified, and why:

- **Real model output.** The OpenAI account has no credits (`insufficient_quota`),
  so generation ran against a local stand-in that returns schema-valid
  structured output. Everything around the model — routing, extraction merging,
  persistence, metering, auth — is covered; the prose quality of v2 is not.
- **Actual push delivery to a device.** Simulators cannot receive remote push.
  The dispatcher was run for real against the Expo Push API, which rejected the
  synthetic token with `DeviceNotRegistered` and correctly disabled it, so the
  send path and dead-token pruning are exercised; a real handset is not.
- **StoreKit purchases.** Needs a signed build and App Store Connect products.
  The entitlement and paywall logic around it is covered.
- **Image upload.** Replicate genuinely generated images; the upload fails
  locally because there is no GCS bucket.

## Known follow-ups

- **The nudge dispatcher is untested against live Expo push.** The scheduling
  logic is verified in SQL; the delivery path has not run against a real
  device. `/coach-nudges/preview` exists for exactly that check.
- **Prompt v2 is not A/B'd.** Existing coaches stay on v1 until someone flips
  them. There is no eval harness comparing the two.
- **`motivational-images` still owns the SMS path** and is still fitness-only.
  Its `scenarios.json` before/after pairs are now dead weight for app users but
  still drive SMS users.
- **No push receipt cron.** `/receipts` exists but nothing calls it on a
  schedule; dead tokens are currently only pruned via ticket errors.
- **Visualisation has no reference-photo upload flow** in the app, so every
  image currently renders scene-only. `user_profiles.reference_photo_url` and
  `likeness_consent` are wired but unpopulated.
- **`get_member_context` is service-role only**, so the app reads
  `member_goals` directly under RLS. Two paths to the same data.
