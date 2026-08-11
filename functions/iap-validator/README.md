# iap-validator

Turns an App Store purchase into a row in `coach_subscriptions`.

The web app bills at the platform level through Stripe. The mobile app bills
**per coach** through StoreKit, because that is what Apple requires for digital
content and because the marketplace model needs entitlements scoped to a single
creator's coach rather than to the whole app.

## Routes

All routes are `POST`.

| Route                   | Auth                      | Purpose |
| ----------------------- | ------------------------- | ------- |
| `/verify`               | Supabase JWT              | Client hands over a StoreKit 2 signed transaction right after purchase |
| `/restore`              | Supabase JWT              | Re-sync every current entitlement (Restore Purchases) |
| `/apple-notifications`  | Apple signature           | App Store Server Notifications V2: renewals, refunds, expiry |
| `/google-notifications` | —                         | Play RTDN placeholder; acknowledges and no-ops until Play billing is on |

Nothing the client claims is trusted. The JWS is verified against Apple's
certificate chain and the entitlement is derived from the decoded transaction.

## Configuration

| Variable | Required | Notes |
| -------- | -------- | ----- |
| `SUPABASE_URL` | yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Writes entitlements past RLS |
| `APPLE_BUNDLE_ID` | yes | e.g. `com.cabo.coaches` |
| `APPLE_APP_APPLE_ID` | yes for production | Numeric App Store app id |
| `APPLE_ROOT_CERTS_BASE64` | yes | Comma-separated base64 DER of Apple's root CAs |
| `ALLOWED_ORIGINS` | no | CORS |

Without `APPLE_ROOT_CERTS_BASE64` the function **fails closed** — it refuses to
grant anything rather than trusting an unverifiable payload.

Populate it with:

```sh
./scripts/fetch-apple-root-certs.sh
```

## Wiring up a coach for sale

1. Create an auto-renewing subscription in App Store Connect. Use a product id
   that encodes the coach, e.g. `coach.marisol.monthly`.
2. Insert the mapping:

```sql
insert into coach_iap_products (coach_id, platform, product_id, period, price_cents, currency)
values ('<coach uuid>', 'ios', 'coach.marisol.monthly', 'monthly', 999, 'USD');
```

`get_coach_roster()` joins this in, so the app knows which product to buy the
moment the coach appears in the roster.

## appAccountToken

The app **must** set `appAccountToken` to the Supabase user id when starting a
purchase. It is the only binding between a store transaction and an account
that survives a reinstall, and renewal notifications carry no other user
context. `handleVerify` rejects a transaction whose `appAccountToken` belongs to
a different account than the caller.
