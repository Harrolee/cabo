# Coaches — mobile app

Expo / React Native app for the coach marketplace. Audience members browse a
roster of coaches across any discipline, chat with them, and subscribe to
individual coaches through the App Store.

## Run it

```sh
cp .env.example .env      # fill in the Supabase + Cloud Functions values
npm install
npx expo run:ios          # development build, needed for in-app purchases
```

`npx expo start` (Expo Go) works for everything **except** purchases —
`react-native-iap` is a native module, so `lib/iap.ts` reports it as unavailable
and the paywall explains why rather than crashing.

## Structure

```
app/                     expo-router routes
  _layout.tsx            auth gate + navigation shell
  sign-in.tsx            Sign in with Apple, or email one-time code
  (tabs)/roster.tsx      the coach roster: search, category filter, paging
  (tabs)/my-coaches.tsx  threads + entitlement state per coach
  (tabs)/settings.tsx    account, manage/restore subscriptions
  coach/[id].tsx         coach detail and the subscribe CTA
  chat/[coachId].tsx     the conversation
src/
  contexts/AuthContext   Supabase session + user_profiles bootstrapping
  lib/api.ts             every backend call the app makes
  lib/iap.ts             StoreKit wrapper, isolated so it can be swapped
  lib/theme.ts           palette, spacing, per-category tints
  components/            CoachCard, CoachAvatar, CategoryFilter, Screen states
```

## How it talks to the backend

Reads go straight to Supabase under RLS:

| What | Call |
| ---- | ---- |
| Categories | `coach_categories` table |
| Roster | `get_coach_roster(category, search, limit, offset)` |
| Coach detail | `coach_profiles` + joins |
| My coaches | `get_my_coaches()` |
| Open a thread | `open_coach_conversation(coach_id)` |
| History | `conversation_messages` table |

Writes that need trust go through Cloud Functions with the Supabase JWT in the
`Authorization` header:

| What | Call |
| ---- | ---- |
| Send a message | `POST /coach-response-generator` |
| Validate a purchase | `POST /iap-validator/verify` |
| Restore purchases | `POST /iap-validator/restore` |

The client never writes an assistant message or an entitlement — RLS forbids
both. That is what stops someone forging coach output or a subscription.

## Free tier and the paywall

`open_coach_conversation` creates a `free_tier` entitlement on first contact, so
anyone can try a coach without paying. Each generated reply burns one message.
When the quota runs out, `/coach-response-generator` answers `402` and the chat
screen swaps the composer for a paywall instead of showing an error.

## Purchases

Each coach is its own auto-renewing subscription, mapped in
`coach_iap_products`. At purchase time the app sets `appAccountToken` to the
Supabase user id — this is the only link between a store transaction and an
account that survives a reinstall, and Apple's renewal webhooks carry no other
user context.

The flow is: StoreKit purchase → `POST /iap-validator/verify` (verifies the JWS
against Apple's certificate chain and writes the entitlement) →
`finishTransaction`. Acknowledging last means a crash mid-flow leaves the
transaction pending for StoreKit to retry, rather than losing a paid purchase.

## Before shipping to the App Store

- Create the subscriptions in App Store Connect and insert matching rows in
  `coach_iap_products`.
- Point App Store Server Notifications V2 at
  `<API_URL>/iap-validator/apple-notifications`.
- Set `APPLE_BUNDLE_ID`, `APPLE_APP_APPLE_ID` and `APPLE_ROOT_CERTS_BASE64` on
  the `iap-validator` function (see `functions/iap-validator/README.md`).
- Register `com.cabo.coaches` on the Apple Developer account with the Push
  Notifications capability. As of the last check it was **not** registered — the
  account holds no bundle id under `com.cabo.*`.

## Assets

`assets/` holds the icon, the Android adaptive foreground, the splash and the
Android notification icon. They are generated, not hand-drawn:

```sh
python3 assets/generate-assets.py    # needs Pillow
```

Edit the mark in that script and re-run rather than editing the PNGs. `icon.png`
is deliberately written without an alpha channel — the App Store rejects icons
that have one.

## EAS

`eas init` has been run: `extra.eas.projectId` and `owner` in `app.json` point
at the real Expo project, which is what `getExpoPushTokenAsync()` mints a push
token against. `resolveProjectId()` in `src/lib/notifications.ts` reads it from
`Constants.expoConfig.extra.eas.projectId`, falling back to `Constants.easConfig`
for builds made by EAS itself. If it ever resolves to nothing, `ensurePush()`
logs a warning and returns `'denied'` rather than failing silently.

`eas.json` carries the build profiles: `development` (dev client, internal
distribution, device not simulator), `preview` (internal distribution), and
`production` (auto-incrementing build number).

A device build is what actually exercises push — the simulator cannot receive
it, and `ensurePush()` returns `'unavailable'` there rather than burning the iOS
permission prompt:

```sh
npx expo run:ios --device        # or: eas build --profile development --platform ios
```

A successful run puts a row in `push_devices` with an `ExponentPushToken[...]`.
