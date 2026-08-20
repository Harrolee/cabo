# End-to-end probes

Eight suites that exercise the backend the way the app does — through
PostgREST as a real `anon`/`authenticated` user, so RLS is actually in play,
and through the Cloud Functions over HTTP.

| Suite | Covers |
| ----- | ------ |
| `rls-probe.mjs` | Roster, profile bootstrap, thread creation, message write permissions, unread counts, notification settings, push-device handover, cross-tenant isolation |
| `flow-probe.mjs` | Goal intake, prompt v1/v2 selection, free-tier metering, the 402 paywall, entitlement restore, coach-initiated nudges, `suppressUserTurn` auth, the nudge dispatcher sweep |
| `viz-realtime-probe.mjs` | Visualiser guards (`no_aspiration`, entitlement, daily limit), prompt hygiene, likeness consent and reference photos, and realtime delivery of a coach-initiated message |
| `sms-image-probe.mjs` | The daily SMS image job across three disciplines: channel scoping, coach resolution, goal-driven prompts, likeness consent, and that no member can receive fitness before/after imagery |
| `club-probe.mjs` | Clubs: seats granted through `coach_subscriptions` so `has_coach_access()` stays the only gate, the invite-on-signup path, revocation by removal / deletion / club lapse, and the negatives — a member cannot enumerate the squad, read what the club pays, or mint themselves a seat |
| `creator-probe.mjs` | Creator onboarding and publishing: profile creation, `protect_creator_platform_fields()` and `enforce_coach_listing_rules()`, that publishing fails while under review, that a creator can neither approve themselves nor credit a coach to someone else, and that suspension pulls the listings |
| `account-deletion-probe.mjs` | Account deletion: that no row in any affected table survives, that the reference photo **object** is gone from the bucket, what happens to coaches the member created and to the people subscribed to them, and that a photo we cannot delete stops the whole deletion |
| `avatar-auth-probe.mjs` | Who may call `coach-avatar-generator` and what it costs them: the pre-signup builder path stays open, anonymous callers are held to one style and an IP ceiling, a real coach id needs a token, an owner may only touch their own coach, and every rejection is proved to reach generation zero times |

## Setting up a local stack

The standard Supabase ports are often taken by another project, so run this one
on a shifted range in a scratch directory:

```sh
mkdir -p /tmp/cabo-local/supabase
cp -R supabase/migrations /tmp/cabo-local/supabase/
cp supabase/config.toml   /tmp/cabo-local/supabase/
mkdir -p /tmp/cabo-local/supabase/seeds
cp supabase/seeds/example_roster.sql /tmp/cabo-local/supabase/seeds/

# shift 543xx -> 548xx, rename the project, and load the example roster
python3 - <<'PY'
import re
p = '/tmp/cabo-local/supabase/config.toml'
s = open(p).read()
s = s.replace('project_id = "supabase"', 'project_id = "cabo-localtest"')
s = re.sub(r'\b543(\d\d)\b', lambda m: '548' + m.group(1), s)
s = s.replace("sql_paths = ['./seed.sql']", "sql_paths = ['./seeds/*.sql']")
open(p, 'w').write(s)
PY

cd /tmp/cabo-local && supabase start
supabase status -o env > /tmp/cabo-local/local.env
```

## Running the functions locally

`function-gateway.js` mounts each Cloud Function under `/<function-name>`, which
reproduces how Cloud Run presents them (`req.path` inside the function is the
remainder), so the routing in each function is genuinely exercised.

```sh
cd mobile/e2e/harness
npm init -y >/dev/null && npm install express

# Terminal 1 — model stand-in (returns schema-valid structured output)
node mock-openai.js

# Terminal 2 — the functions
ENV_FILE=/tmp/cabo-local/local.env node function-gateway.js
```

Both paid APIs are opt-in, and neither is reachable unless you ask for it:

- `USE_REAL_OPENAI=1` hits the live chat API instead of the mock.
- `USE_REAL_REPLICATE=1` makes real image predictions.

Each reads its key (`openai_api_key` / `replicate_api_key`) from
`_infra/terraform.tfvars` only when set, and the gateway refuses to start if you
ask for one without a key. **Set either and you are spending real money.**

Replicate used to be wired up unconditionally, which meant every local
`viz-realtime-probe.mjs` run billed real predictions and made that suite slow
and intermittently red on a third-party network round trip. It is now off by
default: predictions fail immediately at the boundary, which is exactly what
that suite's likeness assertions already assumed, since
`coach_visualizations.model` is written before the call and the model *choice*
is what is under test.

The mock exists so the pipeline can be tested without spending credits — and
because what is under test here is the routing, extraction merging,
persistence, metering and auth, not the model's prose.

## Running the probes

```sh
cd mobile
ENV_FILE=/tmp/cabo-local/local.env node e2e/rls-probe.mjs
ENV_FILE=/tmp/cabo-local/local.env node e2e/club-probe.mjs
ENV_FILE=/tmp/cabo-local/local.env node e2e/flow-probe.mjs
ENV_FILE=/tmp/cabo-local/local.env node e2e/viz-realtime-probe.mjs
ENV_FILE=/tmp/cabo-local/local.env node e2e/sms-image-probe.mjs
ENV_FILE=/tmp/cabo-local/local.env node e2e/account-deletion-probe.mjs
ENV_FILE=/tmp/cabo-local/local.env node e2e/creator-probe.mjs
ENV_FILE=/tmp/cabo-local/local.env node e2e/avatar-auth-probe.mjs
```

A green run across all eight is 403 checks. `creator-probe.mjs` needs neither
the gateway nor the mock model — it goes through PostgREST only.

`avatar-auth-probe.mjs` needs the stack but not the gateway. It loads the real
`functions/coach-avatar-generator/index.js` with `./avatar-generation` replaced
by a recording stub — the technique `prompt-eval/crisis-probe.mjs` uses on
`openai` — so it spends no Replicate credits, and it resolves that function's
`@supabase/supabase-js` and `multer` itself rather than needing an `npm install`
in the function directory. Supabase is deliberately *not* stubbed: token
verification and the ownership lookup run against the real stack. The stub is
what makes the load-bearing assertion possible — that a rejected call reaches
generation zero times, since a 403 that still burned a credit looks identical
from the outside.

`sms-image-probe.mjs` needs the mock model but not the gateway: it calls the
daily job's modules in-process and fakes Replicate, Twilio and GCS, so it needs
no Twilio or Replicate credentials and spends nothing.

`account-deletion-probe.mjs` needs neither the gateway nor the mock model. It
drives `functions/account-deletion` in process against `harness/fake-gcs.mjs`,
a four-endpoint stand-in for the Cloud Storage JSON API that
`@google-cloud/storage` talks to when `STORAGE_EMULATOR_HOST` is set — which is
what lets it assert that the member's photo *object* is gone rather than that
the column pointing at it is empty. It creates its own coaches, creators and
members and removes all of them afterwards, including on failure, because the
other suites assert on the exact contents of the seeded roster.

They run from `mobile/` for `@supabase/supabase-js` resolution and exit non-zero
on any failure.

Ports are overridable, so a second stack can run beside the first without the
two gateways fighting over 8790: `PORT` on both harness processes,
`MOCK_OPENAI_URL` on the gateway, and `API_BASE` on the probes.

`MOCK_OPENAI_URL` means the OpenAI *base* URL (`http://127.0.0.1:8791/v1`) to
the gateway, because the SDK appends the route itself, but
`sms-image-probe.mjs` calls the endpoint directly and needs
`.../v1/chat/completions`. The probe now accepts either form; if you write your
own harness, note that a mismatch here returns 404 and reads as twenty
unrelated failures ("no scene was sent", "0 Replicate calls") rather than as a
wiring mistake.

Realtime replays the WAL in order, so `viz-realtime-probe.mjs` run straight
after the write-heavy suites may see its event arrive seconds late while the
backlog drains. Its realtime assertions wait for delivery rather than sleeping
a fixed interval, and the no-leak assertion is pinned to a positive delivery on
a second subscription — a bare sleep would pass just as happily against a
realtime server that had stopped delivering anything at all. Keep that shape if
you add realtime coverage.

The visualiser's likeness endpoints need GCS credentials to store or delete a
photo, so `/likeness/grant` cannot be exercised locally. Everything the choice
between PhotoMaker and scene-only depends on — consent, the trigger that keeps
members from granting it to themselves, revocation, and which model each
generation records — is covered without them.

## Driving the app itself

```sh
cat > mobile/.env <<EOF
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54821
EXPO_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY from local.env>
EXPO_PUBLIC_API_URL=http://127.0.0.1:8790
EOF

npx expo run:ios
```

Sign-in codes land in the local mail catcher at <http://127.0.0.1:54824>.

## `prompt-eval/` — v1 vs v2

A separate thing from the probes: no database, no functions, no HTTP. It calls
both prompt builders directly, exactly the way
`coach-response-generator/index.js#generateCoaching` assembles them, and scores
the replies against the claims made for prompt v2 in
`docs/prompts-and-notifications.md` §2.

```sh
cd mobile/e2e
node prompt-eval/run.mjs                          # local mock, free
node prompt-eval/run.mjs --real --judge           # live API, spends money
node prompt-eval/run.mjs --rescore=prompt-eval/results/<run>.json
```

## `prompt-eval/crisis-probe.mjs` — the #30 safety net

Crisis escalation is the one behaviour that must not depend on a model
choosing to comply, so it has its own suite. No database, no HTTP, no network,
no credits — it runs anywhere `node` does:

```sh
cd mobile/e2e
node prompt-eval/crisis-probe.mjs
```

It covers the detector (what must fire, and the drumming and songwriting
phrases that must not), locale resolution from what `user_profiles` actually
carries, the four properties the reply has to have, the mirrored copies of
`functions/shared/crisis.js` being byte-identical, and a hostile creator
persona failing to displace the rule from either prompt version. The last
section loads the real `coach-response-generator` handler with the `openai`
module replaced by a stub that throws, and asserts a crisis message still comes
back naming 988 — then checks an ordinary message *does* reach for the model,
so the stub is not merely inert.

One-time setup: `cd functions/coach-response-generator && npm install`, same
for `functions/coach-nudges`.

`run.mjs` carries the same invariants as a startup assertion, and its crisis
cases exercise the code path in the position production uses — before
generation, no model call. `--no-safety-net` disables it, which is how the
"what the prompt rule alone is worth" numbers in
`results/2026-08-11-crisis-prompt-rule-only.md` were produced.

**It defaults to the mock and needs `--real` to reach OpenAI**, which it will
refuse to do without a key in `OPENAI_API_KEY` or `openai_api_key` in
`_infra/terraform.tfvars` (`TFVARS_FILE` overrides the path). The default model
is `gpt-4o-mini`; the committed run cost $0.006 for 36 completions. The mock is
started automatically if it is not already listening.

- `cases.mjs` — twelve cases: the three seeded coaches × {a real coaching turn,
  something outside the discipline, a medical problem, a bad plan they want
  approved}. The out-of-discipline cases are cold starts (day 0, empty thread)
  so that "last time you said…" is provably invented.
- `score.mjs` — one function per claim, each returning the text it matched so
  you can disagree with the regex by reading the report.
- `--judge` adds a blind pairwise pass: A/B order alternates and the judge is
  never told which prompt is which.
- `--no-chunks` runs with retrieval returning nothing, which is what production
  does today (`match_coach_content` fails on every call and the caller
  swallows it). Run both ways: a verdict that only holds when retrieval works
  is not a verdict about the system as deployed.
- Every run first asserts that the two prompts it is about to compare are
  structurally distinct — v1 headings present and v2 tags absent, and vice
  versa. The harness never reads `coach_profiles`, so `prompt_version` in a
  database cannot influence which path is exercised, but "we compared v1 and
  v2" is worthless if both sides were quietly the same prompt.
- Every run writes `results/<date>-<model>.md` **and** the raw transcripts as
  `.json`, so a scorer bug can be fixed and the tally rebuilt with `--rescore`
  instead of paying for a second run against different text.

Do not read a single run as settled: one sample per case at temperature 0.8
separates large differences, not small ones.

## `harness/supabase-shim.sql`

A minimal stand-in for the parts of a Supabase project the migrations touch
(`auth.users`, `auth.uid()`, `auth.jwt()`, the three roles). Enough to apply the
whole migration chain against a bare `pgvector/pgvector:pg16` container for a
fast syntax and semantics check without booting the full stack:

```sh
docker run -d --name cabo-sqlcheck -e POSTGRES_PASSWORD=pw pgvector/pgvector:pg16
docker cp mobile/e2e/harness/supabase-shim.sql cabo-sqlcheck:/tmp/shim.sql
docker exec -i cabo-sqlcheck psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/shim.sql
for f in supabase/migrations/*.sql; do
  docker cp "$f" cabo-sqlcheck:/tmp/m.sql
  docker exec -i cabo-sqlcheck psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/m.sql || echo "FAIL $f"
done
```
