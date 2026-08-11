# End-to-end probes

Three suites that exercise the backend the way the app does — through
PostgREST as a real `anon`/`authenticated` user, so RLS is actually in play,
and through the Cloud Functions over HTTP.

| Suite | Covers |
| ----- | ------ |
| `rls-probe.mjs` | Roster, profile bootstrap, thread creation, message write permissions, unread counts, notification settings, push-device handover, cross-tenant isolation |
| `flow-probe.mjs` | Goal intake, prompt v1/v2 selection, free-tier metering, the 402 paywall, entitlement restore, coach-initiated nudges, `suppressUserTurn` auth, the nudge dispatcher sweep |
| `viz-realtime-probe.mjs` | Visualiser guards (`no_aspiration`, entitlement, daily limit), prompt hygiene, and realtime delivery of a coach-initiated message |

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

Set `USE_REAL_OPENAI=1` on the gateway to hit the live API instead of the mock;
it reads `openai_api_key` / `replicate_api_key` from `_infra/terraform.tfvars`.

The mock exists so the pipeline can be tested without spending credits — and
because what is under test here is the routing, extraction merging,
persistence, metering and auth, not the model's prose.

## Running the probes

```sh
cd mobile
ENV_FILE=/tmp/cabo-local/local.env node e2e/rls-probe.mjs
ENV_FILE=/tmp/cabo-local/local.env node e2e/flow-probe.mjs
ENV_FILE=/tmp/cabo-local/local.env node e2e/viz-realtime-probe.mjs
```

They run from `mobile/` for `@supabase/supabase-js` resolution and exit non-zero
on any failure.

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
