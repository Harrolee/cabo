#!/usr/bin/env node
/**
 * Provision one auto-renewing App Store subscription per sellable coach, and
 * mirror the result into `coach_iap_products`.
 *
 * Why this is a script and not a one-off: the App Store Connect API refuses
 * `POST /v1/apps` ("The resource 'apps' does not allow 'CREATE'"), so the app
 * record itself has to be made by hand in the App Store Connect web UI. Once it
 * exists, everything downstream of it — subscription groups, subscriptions,
 * localizations, prices, availability and the DB mapping — is automatable, and
 * this is that automation. It is idempotent: re-running it reconciles rather
 * than duplicates.
 *
 *   node scripts/provision-appstore-subscriptions.mjs            # dry run
 *   node scripts/provision-appstore-subscriptions.mjs --apply    # write
 *   node scripts/provision-appstore-subscriptions.mjs --apply --skip-db
 *
 * Credentials:
 *   App Store Connect  ~/.appstoreconnect/private_keys/config.json  (key_id,
 *                      issuer_id, key_path). Never printed.
 *   Supabase           SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, falling back
 *                      to `supabase_url` / `supabase_service_role_key` in
 *                      _infra/terraform.tfvars (gitignored).
 *
 * Subscription-group topology: ONE GROUP PER COACH, deliberately.
 * Subscriptions inside a single group are mutually exclusive — the App Store
 * treats a purchase in a group the customer already subscribes to as an
 * upgrade/crossgrade and cancels the old one. `coach_subscriptions` is
 * UNIQUE (user_id, coach_id), i.e. one entitlement per pairing with no cap on
 * how many coaches a user may hold at once, and the paywall in
 * mobile/app/chat/[coachId].tsx is evaluated per coach. Sharing one group would
 * therefore make subscribing to a second coach silently cancel the first. Per-
 * coach groups also give each coach its own line in the customer's Manage
 * Subscriptions screen and its own introductory-offer eligibility.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'com.cabo.coaches';
const PRICE_CENTS = 499;
const CURRENCY = 'USD';
const BASE_TERRITORY = 'USA';
const PERIOD = 'monthly';
const APPLE_PERIOD = 'ONE_MONTH';

const APPLY = process.argv.includes('--apply');
const SKIP_DB = process.argv.includes('--skip-db');
const ASC_BASE = 'https://api.appstoreconnect.apple.com';

/* -------------------------------------------------------------------------
 * App Store Connect: ES256 JWT, no dependencies.
 * ---------------------------------------------------------------------- */

function ascConfig() {
  const cfgPath = path.join(os.homedir(), '.appstoreconnect/private_keys/config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const keyPath = cfg.key_path.replace(/^~/, os.homedir());
  return { keyId: cfg.key_id, issuerId: cfg.issuer_id, keyPath };
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function ascToken() {
  const { keyId, issuerId, keyPath } = ascConfig();
  const key = crypto.createPrivateKey(fs.readFileSync(keyPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({ iss: issuerId, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' })
  );
  // Node emits DER; JOSE wants the raw r||s pair.
  const sig = crypto.sign(null, Buffer.from(`${header}.${payload}`), {
    key,
    dsaEncoding: 'ieee-p1363',
  });
  return `${header}.${payload}.${b64url(sig)}`;
}

async function asc(method, endpoint, { params, body } = {}) {
  const url = new URL(endpoint.startsWith('http') ? endpoint : ASC_BASE + endpoint);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${ascToken()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = (json?.errors || []).map((e) => `${e.title}: ${e.detail}`).join('; ');
    throw new Error(`${method} ${url.pathname} -> ${res.status} ${detail || text}`);
  }
  return json;
}

/** GET every page of a collection. */
async function ascAll(endpoint, params) {
  const out = [];
  let next = null;
  do {
    const page = next
      ? await asc('GET', next)
      : await asc('GET', endpoint, { params: { limit: 200, ...(params || {}) } });
    out.push(...(page.data || []));
    next = page.links?.next || null;
  } while (next);
  return out;
}

/* -------------------------------------------------------------------------
 * Supabase
 * ---------------------------------------------------------------------- */

function tfvar(name) {
  const file = path.join(REPO_ROOT, '_infra/terraform.tfvars');
  if (!fs.existsSync(file)) return null;
  const m = fs
    .readFileSync(file, 'utf8')
    .match(new RegExp(`^\\s*${name}\\s*=\\s*"([^"]*)"`, 'm'));
  return m ? m[1] : null;
}

const SUPABASE_URL = (process.env.SUPABASE_URL || tfvar('supabase_url') || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || tfvar('supabase_service_role_key') || '';

async function rest(method, endpoint, { params, body, prefer } = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1${endpoint}`);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${endpoint} -> ${res.status} ${text}`);
  return json;
}

/* -------------------------------------------------------------------------
 * Naming. Apple caps the display name at 30 chars and the description at 45.
 * ---------------------------------------------------------------------- */

const productIdFor = (handle) => `coach.${handle}.monthly`;
const groupRefFor = (handle) => `coach-${handle}`;
const clamp = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const displayNameFor = (coach) => clamp(`${coach.name} Monthly`, 30);
const descriptionFor = (coach) => clamp(`Unlimited coaching with ${coach.name}.`, 45);

/* -------------------------------------------------------------------------
 * Which coaches are for sale
 * ---------------------------------------------------------------------- */

async function sellableCoaches() {
  // `listing_status` arrives with 20260810120000_generalize_coach_domain.sql,
  // which backfills 'listed' for every active+public coach. Fall back to that
  // same predicate when the column is not there yet so a pre-migration project
  // still yields the right roster.
  try {
    return await rest('GET', '/coach_profiles', {
      params: {
        select: 'id,name,handle',
        active: 'eq.true',
        listing_status: 'eq.listed',
        order: 'created_at',
      },
    });
  } catch (err) {
    if (!/listing_status/.test(String(err))) throw err;
    console.warn('! coach_profiles.listing_status is missing — the 20260810 migrations have');
    console.warn('  not been applied to this project. Falling back to active AND public,');
    console.warn('  which is exactly what the migration backfills to listing_status=listed.');
    return rest('GET', '/coach_profiles', {
      params: { select: 'id,name,handle', active: 'eq.true', public: 'eq.true', order: 'created_at' },
    });
  }
}

/* -------------------------------------------------------------------------
 * App Store Connect reconciliation
 * ---------------------------------------------------------------------- */

async function findApp() {
  const apps = await ascAll('/v1/apps', { 'filter[bundleId]': BUNDLE_ID });
  return apps.find((a) => a.attributes.bundleId === BUNDLE_ID) || null;
}

async function ensureGroup(appId, coach, log) {
  const referenceName = groupRefFor(coach.handle);
  const groups = await ascAll(`/v1/apps/${appId}/subscriptionGroups`);
  const existing = groups.find((g) => g.attributes.referenceName === referenceName);
  if (existing) {
    log(`  group ${referenceName} exists (${existing.id})`);
    return existing.id;
  }
  if (!APPLY) {
    log(`  would create group ${referenceName}`);
    return null;
  }
  const created = await asc('POST', '/v1/subscriptionGroups', {
    body: {
      data: {
        type: 'subscriptionGroups',
        attributes: { referenceName },
        relationships: { app: { data: { type: 'apps', id: appId } } },
      },
    },
  });
  log(`  created group ${referenceName} (${created.data.id})`);
  return created.data.id;
}

async function ensureGroupLocalization(groupId, coach, log) {
  const locs = await ascAll(`/v1/subscriptionGroups/${groupId}/subscriptionGroupLocalizations`);
  if (locs.some((l) => l.attributes.locale === 'en-US')) return;
  if (!APPLY) return log('  would add en-US group localization');
  await asc('POST', '/v1/subscriptionGroupLocalizations', {
    body: {
      data: {
        type: 'subscriptionGroupLocalizations',
        attributes: { name: clamp(coach.name, 30), locale: 'en-US' },
        relationships: { subscriptionGroup: { data: { type: 'subscriptionGroups', id: groupId } } },
      },
    },
  });
  log('  added en-US group localization');
}

async function ensureSubscription(groupId, coach, log) {
  const productId = productIdFor(coach.handle);
  const subs = await ascAll(`/v1/subscriptionGroups/${groupId}/subscriptions`);
  const existing = subs.find((s) => s.attributes.productId === productId);
  if (existing) {
    log(`  subscription ${productId} exists (${existing.id}, ${existing.attributes.state})`);
    return existing.id;
  }
  if (!APPLY) {
    log(`  would create subscription ${productId}`);
    return null;
  }
  const created = await asc('POST', '/v1/subscriptions', {
    body: {
      data: {
        type: 'subscriptions',
        attributes: {
          name: displayNameFor(coach),
          productId,
          subscriptionPeriod: APPLE_PERIOD,
          familySharable: false,
          groupLevel: 1,
          reviewNote: `Unlocks unlimited chat with the "${coach.name}" coach inside the app.`,
        },
        relationships: { group: { data: { type: 'subscriptionGroups', id: groupId } } },
      },
    },
  });
  log(`  created subscription ${productId} (${created.data.id})`);
  return created.data.id;
}

async function ensureSubscriptionLocalization(subId, coach, log) {
  const locs = await ascAll(`/v1/subscriptions/${subId}/subscriptionLocalizations`);
  if (locs.some((l) => l.attributes.locale === 'en-US')) return;
  if (!APPLY) return log('  would add en-US subscription localization');
  await asc('POST', '/v1/subscriptionLocalizations', {
    body: {
      data: {
        type: 'subscriptionLocalizations',
        attributes: {
          name: displayNameFor(coach),
          description: descriptionFor(coach),
          locale: 'en-US',
        },
        relationships: { subscription: { data: { type: 'subscriptions', id: subId } } },
      },
    },
  });
  log('  added en-US subscription localization');
}

async function ensurePrice(subId, log) {
  const prices = await ascAll(`/v1/subscriptions/${subId}/prices`, {
    'filter[territory]': BASE_TERRITORY,
  });
  if (prices.length) return log(`  price already set (${prices.length} schedule entr(ies))`);

  const points = await ascAll(`/v1/subscriptions/${subId}/pricePoints`, {
    'filter[territory]': BASE_TERRITORY,
  });
  const want = (PRICE_CENTS / 100).toFixed(2);
  const exact = points.find((p) => Number(p.attributes.customerPrice).toFixed(2) === want);
  // Apple's tiers are fixed; if 4.99 is ever retired, take the nearest one.
  const chosen =
    exact ||
    points.sort(
      (a, b) =>
        Math.abs(a.attributes.customerPrice - PRICE_CENTS / 100) -
        Math.abs(b.attributes.customerPrice - PRICE_CENTS / 100)
    )[0];
  if (!chosen) throw new Error(`no ${BASE_TERRITORY} price points for subscription ${subId}`);
  const label = `${BASE_TERRITORY} ${chosen.attributes.customerPrice}`;
  if (!APPLY) return log(`  would set price ${label} (point ${chosen.id})`);
  await asc('POST', '/v1/subscriptionPrices', {
    body: {
      data: {
        type: 'subscriptionPrices',
        attributes: { preserveCurrentPrice: false },
        relationships: {
          subscription: { data: { type: 'subscriptions', id: subId } },
          subscriptionPricePoint: { data: { type: 'subscriptionPricePoints', id: chosen.id } },
          territory: { data: { type: 'territories', id: BASE_TERRITORY } },
        },
      },
    },
  });
  log(`  set price ${label}`);
}

async function ensureAvailability(subId, territoryIds, log) {
  try {
    const current = await asc('GET', `/v1/subscriptions/${subId}/subscriptionAvailability`);
    if (current?.data) return log('  availability already configured');
  } catch (err) {
    if (!/404/.test(String(err))) throw err;
  }
  if (!APPLY) return log(`  would open availability in ${territoryIds.length} territories`);
  await asc('POST', '/v1/subscriptionAvailabilities', {
    body: {
      data: {
        type: 'subscriptionAvailabilities',
        attributes: { availableInNewTerritories: true },
        relationships: {
          subscription: { data: { type: 'subscriptions', id: subId } },
          availableTerritories: {
            data: territoryIds.map((id) => ({ type: 'territories', id })),
          },
        },
      },
    },
  });
  log(`  opened availability in ${territoryIds.length} territories`);
}

/* -------------------------------------------------------------------------
 * coach_iap_products reconciliation
 * ---------------------------------------------------------------------- */

async function reconcileDb(coaches, log) {
  const wanted = new Map(coaches.map((c) => [productIdFor(c.handle), c]));
  let rows;
  try {
    rows = await rest('GET', '/coach_iap_products', {
      params: { select: 'id,coach_id,platform,product_id,period,price_cents,currency,active', platform: 'eq.ios' },
    });
  } catch (err) {
    if (/does not exist/.test(String(err))) {
      console.warn('! coach_iap_products does not exist on this project. Apply the 20260810');
      console.warn('  migrations first, then re-run with --apply.');
      return;
    }
    throw err;
  }

  const byProduct = new Map(rows.map((r) => [r.product_id, r]));

  for (const [productId, coach] of wanted) {
    const row = byProduct.get(productId);
    if (!row) {
      log(`  ${APPLY ? 'insert' : 'would insert'} ${productId} -> ${coach.handle}`);
      if (APPLY) {
        await rest('POST', '/coach_iap_products', {
          body: {
            coach_id: coach.id,
            platform: 'ios',
            product_id: productId,
            period: PERIOD,
            price_cents: PRICE_CENTS,
            currency: CURRENCY,
            active: true,
          },
          prefer: 'return=minimal,resolution=merge-duplicates',
        });
      }
      continue;
    }
    const drift =
      row.coach_id !== coach.id ||
      row.period !== PERIOD ||
      row.price_cents !== PRICE_CENTS ||
      row.currency !== CURRENCY ||
      row.active !== true;
    if (!drift) {
      log(`  ${productId} already correct`);
      continue;
    }
    log(`  ${APPLY ? 'update' : 'would update'} ${productId} -> ${PRICE_CENTS} ${CURRENCY}/${PERIOD}`);
    if (APPLY) {
      await rest('PATCH', '/coach_iap_products', {
        params: { id: `eq.${row.id}` },
        body: {
          coach_id: coach.id,
          period: PERIOD,
          price_cents: PRICE_CENTS,
          currency: CURRENCY,
          active: true,
        },
        prefer: 'return=minimal',
      });
    }
  }

  // Anything on iOS that is not one of our products is stale seed/demo data.
  // Deactivate rather than delete: get_coach_roster() filters on active, and a
  // deleted row cannot be audited later.
  for (const row of rows) {
    if (wanted.has(row.product_id) || row.active !== true) continue;
    log(`  ${APPLY ? 'deactivate' : 'would deactivate'} stale ${row.product_id} (${row.price_cents})`);
    if (APPLY) {
      await rest('PATCH', '/coach_iap_products', {
        params: { id: `eq.${row.id}` },
        body: { active: false },
        prefer: 'return=minimal',
      });
    }
  }
}

/* ---------------------------------------------------------------------- */

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or fill _infra/terraform.tfvars');
  }
  console.log(APPLY ? 'MODE: apply' : 'MODE: dry run (pass --apply to write)');

  const app = await findApp();
  if (!app) {
    console.error(`\nNo App Store Connect app record for ${BUNDLE_ID}.`);
    console.error('The API does not allow creating apps (POST /v1/apps is rejected with');
    console.error("\"The resource 'apps' does not allow 'CREATE'\"), so create it once by hand:");
    console.error('  App Store Connect -> Apps -> + -> New App');
    console.error(`    Platform iOS, Bundle ID ${BUNDLE_ID}, SKU cabo-coaches, Primary language English (U.S.)`);
    console.error('Then re-run this script. Nothing has been changed.');
    process.exitCode = 1;
    return;
  }
  console.log(`app ${app.attributes.name} (${app.id}) bundle ${app.attributes.bundleId}`);
  console.log(`apple_app_apple_id = "${app.id}"`);

  const coaches = await sellableCoaches();
  console.log(`\n${coaches.length} sellable coach(es): ${coaches.map((c) => c.handle).join(', ')}`);

  const territoryIds = (await ascAll('/v1/territories')).map((t) => t.id);

  for (const coach of coaches) {
    console.log(`\n${coach.handle} — ${coach.name}`);
    const log = (m) => console.log(m);
    const groupId = await ensureGroup(app.id, coach, log);
    if (!groupId) continue; // dry run, nothing downstream to inspect yet
    await ensureGroupLocalization(groupId, coach, log);
    const subId = await ensureSubscription(groupId, coach, log);
    if (!subId) continue;
    await ensureSubscriptionLocalization(subId, coach, log);
    await ensurePrice(subId, log);
    await ensureAvailability(subId, territoryIds, log);
  }

  if (SKIP_DB) return;
  console.log('\ncoach_iap_products');
  await reconcileDb(coaches, (m) => console.log(m));
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
});
