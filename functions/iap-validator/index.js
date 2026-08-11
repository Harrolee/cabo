/**
 * In-app purchase validation and entitlement management.
 *
 * The web app bills through Stripe at the platform level (one subscription per
 * phone number). The mobile app bills per coach through the App Store, so this
 * function is the bridge between a store transaction and a row in
 * `coach_subscriptions`.
 *
 * Routes (all POST):
 *   /verify               client hands us a StoreKit 2 signed transaction
 *   /apple-notifications  App Store Server Notifications V2 webhook
 *   /google-notifications Play Real-time Developer Notifications (Pub/Sub push)
 *   /restore              re-sync every entitlement the caller can prove
 *
 * Trust model: nothing the client says is believed. The signed payload is
 * verified against Apple's certificate chain, and the entitlement is derived
 * from the decoded transaction, never from the request body.
 */

const { createClient } = require('@supabase/supabase-js');
const { z } = require('zod');
const {
  SignedDataVerifier,
  Environment,
} = require('@apple/app-store-server-library');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID;
const APPLE_APP_ID = process.env.APPLE_APP_APPLE_ID
  ? Number(process.env.APPLE_APP_APPLE_ID)
  : undefined;

// ---------------------------------------------------------------------------
// Apple signed-data verification
// ---------------------------------------------------------------------------

/**
 * Apple's root certificates, supplied as a comma-separated list of base64 DER
 * blobs. Fetch them with `scripts/fetch-apple-root-certs.sh`. We deliberately
 * fail closed: without the roots there is no way to tell a real receipt from a
 * forged one, so the function refuses to grant anything.
 */
function loadAppleRootCertificates() {
  const raw = process.env.APPLE_ROOT_CERTS_BASE64;
  if (!raw || !raw.trim()) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => Buffer.from(entry, 'base64'));
}

const appleRootCertificates = loadAppleRootCertificates();

// One verifier per environment; sandbox and production sign with different
// chains and a TestFlight build will send sandbox payloads.
const verifierCache = new Map();

function getAppleVerifier(environment) {
  if (appleRootCertificates.length === 0) {
    throw new Error(
      'APPLE_ROOT_CERTS_BASE64 is not configured; refusing to verify App Store payloads'
    );
  }
  if (!APPLE_BUNDLE_ID) {
    throw new Error('APPLE_BUNDLE_ID is not configured');
  }

  if (!verifierCache.has(environment)) {
    verifierCache.set(
      environment,
      new SignedDataVerifier(
        appleRootCertificates,
        /* enableOnlineChecks */ true,
        environment,
        APPLE_BUNDLE_ID,
        APPLE_APP_ID
      )
    );
  }
  return verifierCache.get(environment);
}

/**
 * Read the unverified `environment` claim just to pick the right verifier, then
 * verify for real. Peeking at an unverified payload is safe here because the
 * only thing we take from it is which certificate chain to check against — a
 * lie simply makes verification fail.
 */
function peekEnvironment(jws) {
  try {
    const payload = JSON.parse(
      Buffer.from(jws.split('.')[1], 'base64url').toString('utf8')
    );
    const claimed = payload.environment || payload.data?.environment;
    return claimed === 'Sandbox' ? Environment.SANDBOX : Environment.PRODUCTION;
  } catch (error) {
    return Environment.PRODUCTION;
  }
}

async function verifyAppleTransaction(jws) {
  const environment = peekEnvironment(jws);
  try {
    const verifier = getAppleVerifier(environment);
    return {
      transaction: await verifier.verifyAndDecodeTransaction(jws),
      environment,
    };
  } catch (error) {
    // A production build talking to sandbox (and vice versa) is common enough
    // during review that it is worth one retry against the other chain.
    const fallback =
      environment === Environment.PRODUCTION ? Environment.SANDBOX : Environment.PRODUCTION;
    const verifier = getAppleVerifier(fallback);
    return {
      transaction: await verifier.verifyAndDecodeTransaction(jws),
      environment: fallback,
    };
  }
}

async function verifyAppleNotification(signedPayload) {
  const environment = peekEnvironment(signedPayload);
  try {
    const verifier = getAppleVerifier(environment);
    return { notification: await verifier.verifyAndDecodeNotification(signedPayload), environment };
  } catch (error) {
    const fallback =
      environment === Environment.PRODUCTION ? Environment.SANDBOX : Environment.PRODUCTION;
    const verifier = getAppleVerifier(fallback);
    return { notification: await verifier.verifyAndDecodeNotification(signedPayload), environment: fallback };
  }
}

// ---------------------------------------------------------------------------
// Entitlement writing
// ---------------------------------------------------------------------------

/**
 * Apple notification types mapped onto our entitlement lifecycle. Anything not
 * listed leaves the current status untouched and only refreshes the dates.
 */
const NOTIFICATION_STATUS = {
  SUBSCRIBED: 'active',
  DID_RENEW: 'active',
  OFFER_REDEEMED: 'active',
  DID_FAIL_TO_RENEW: 'grace_period',
  GRACE_PERIOD_EXPIRED: 'expired',
  EXPIRED: 'expired',
  REFUND: 'revoked',
  REVOKE: 'revoked',
};

async function findCoachForProduct(productId, platform) {
  const { data, error } = await supabase
    .from('coach_iap_products')
    .select('coach_id, product_id, platform')
    .eq('platform', platform)
    .eq('product_id', productId)
    .maybeSingle();

  if (error) {
    console.error('Failed to look up product %s:', productId, error);
    return null;
  }
  return data?.coach_id || null;
}

/**
 * Write (or refresh) the entitlement. Keyed on
 * (source, original_transaction_id) so replays and webhook retries converge on
 * the same row instead of stacking duplicates.
 */
async function upsertEntitlement({
  userId,
  userEmail,
  coachId,
  source,
  status,
  productId,
  originalTransactionId,
  latestTransactionId,
  expiresAt,
  autoRenew,
  environment,
}) {
  const payload = {
    user_id: userId,
    user_email: userEmail || null,
    coach_id: coachId,
    source,
    status,
    product_id: productId,
    original_transaction_id: originalTransactionId,
    latest_transaction_id: latestTransactionId,
    current_period_end: expiresAt,
    auto_renew: autoRenew ?? true,
    environment,
    cancelled_at: status === 'cancelled' || status === 'revoked' ? new Date().toISOString() : null,
  };

  // A user who previously chatted on the free tier already has a row for this
  // pairing, so upsert on (user_id, coach_id) and let the paid values win.
  const { data, error } = await supabase
    .from('coach_subscriptions')
    .upsert(payload, { onConflict: 'user_id,coach_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function applyAppleTransaction(transaction, environment, caller) {
  const productId = transaction.productId;
  const coachId = await findCoachForProduct(productId, 'ios');

  if (!coachId) {
    const error = new Error(`No coach is mapped to App Store product ${productId}`);
    error.statusCode = 422;
    throw error;
  }

  // appAccountToken is set by the app at purchase time and carries the Supabase
  // user id. Prefer it — it is the only binding between a store transaction and
  // an account that survives a reinstall on a different account.
  const tokenUserId = transaction.appAccountToken || null;
  const userId = tokenUserId || caller?.id;

  if (!userId) {
    const error = new Error('Cannot attribute this purchase to a user');
    error.statusCode = 400;
    throw error;
  }

  if (caller && tokenUserId && tokenUserId !== caller.id) {
    const error = new Error('This purchase belongs to a different account');
    error.statusCode = 403;
    throw error;
  }

  const expiresAt = transaction.expiresDate
    ? new Date(transaction.expiresDate).toISOString()
    : null;
  const revoked = Boolean(transaction.revocationDate);
  const expired = expiresAt && new Date(expiresAt) <= new Date();

  return upsertEntitlement({
    userId,
    userEmail: caller?.email,
    coachId,
    source: 'apple_iap',
    status: revoked ? 'revoked' : expired ? 'expired' : 'active',
    productId,
    originalTransactionId: transaction.originalTransactionId,
    latestTransactionId: transaction.transactionId,
    expiresAt,
    autoRenew: !revoked,
    environment: environment === Environment.SANDBOX ? 'sandbox' : 'production',
  });
}

// ---------------------------------------------------------------------------
// Google Play
// ---------------------------------------------------------------------------

/**
 * Play verification needs the Android Publisher API and a service account with
 * the "View financial data" grant. Wired as a distinct path rather than a
 * silent no-op so an Android build fails loudly instead of granting for free.
 */
async function verifyGooglePurchase() {
  const error = new Error(
    'Google Play verification is not configured yet. Set GOOGLE_PLAY_PACKAGE_NAME and grant the ' +
      'function service account Android Publisher access, then implement the purchases.subscriptionsv2.get call.'
  );
  error.statusCode = 501;
  throw error;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function resolveCaller(req) {
  const header = req.get('authorization') || req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const VerifyRequest = z.object({
  platform: z.enum(['ios', 'android']),
  // StoreKit 2 signed transaction (`VerificationResult.jwsRepresentation`).
  jws: z.string().min(20).optional(),
  purchaseToken: z.string().min(10).optional(),
  productId: z.string().optional(),
});

const RestoreRequest = z.object({
  platform: z.enum(['ios', 'android']),
  transactions: z.array(z.string().min(20)).max(50),
});

async function handleVerify(req, res) {
  const caller = await resolveCaller(req);
  if (!caller) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const body = VerifyRequest.parse(req.body || {});

  if (body.platform === 'android') {
    await verifyGooglePurchase();
    return;
  }

  if (!body.jws) {
    return res.status(400).json({ error: 'jws is required for iOS purchases' });
  }

  const { transaction, environment } = await verifyAppleTransaction(body.jws);
  const entitlement = await applyAppleTransaction(transaction, environment, caller);

  return res.json({
    success: true,
    entitlement: {
      coachId: entitlement.coach_id,
      status: entitlement.status,
      productId: entitlement.product_id,
      currentPeriodEnd: entitlement.current_period_end,
      environment: entitlement.environment,
    },
  });
}

async function handleRestore(req, res) {
  const caller = await resolveCaller(req);
  if (!caller) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const body = RestoreRequest.parse(req.body || {});
  if (body.platform === 'android') {
    await verifyGooglePurchase();
    return;
  }

  const results = [];
  for (const jws of body.transactions) {
    try {
      const { transaction, environment } = await verifyAppleTransaction(jws);
      const entitlement = await applyAppleTransaction(transaction, environment, caller);
      results.push({ coachId: entitlement.coach_id, status: entitlement.status });
    } catch (error) {
      console.warn('Skipping unrestorable transaction:', error.message);
      results.push({ error: error.message });
    }
  }

  return res.json({ success: true, restored: results });
}

async function handleAppleNotification(req, res) {
  const signedPayload = req.body?.signedPayload;
  if (!signedPayload) {
    return res.status(400).json({ error: 'signedPayload is required' });
  }

  const { notification, environment } = await verifyAppleNotification(signedPayload);
  const { notificationType, subtype, data } = notification;

  console.log('App Store notification: %s/%s', notificationType, subtype || '-');

  if (!data?.signedTransactionInfo) {
    // TEST notifications and consumption requests carry no transaction.
    return res.json({ success: true, ignored: notificationType });
  }

  const verifier = getAppleVerifier(environment);
  const transaction = await verifier.verifyAndDecodeTransaction(data.signedTransactionInfo);
  const renewalInfo = data.signedRenewalInfo
    ? await verifier.verifyAndDecodeRenewalInfo(data.signedRenewalInfo)
    : null;

  // Renewals arrive with no user context, so the existing row is the only link
  // back to an account.
  const { data: existing, error: lookupError } = await supabase
    .from('coach_subscriptions')
    .select('id, user_id, user_email, coach_id')
    .eq('source', 'apple_iap')
    .eq('original_transaction_id', transaction.originalTransactionId)
    .maybeSingle();

  if (lookupError) throw lookupError;

  const userId = existing?.user_id || transaction.appAccountToken || null;
  if (!userId) {
    console.warn(
      'No entitlement found for original transaction %s and no appAccountToken; nothing to update',
      transaction.originalTransactionId
    );
    return res.json({ success: true, ignored: 'unattributable' });
  }

  const coachId = existing?.coach_id || (await findCoachForProduct(transaction.productId, 'ios'));
  if (!coachId) {
    console.warn('No coach mapped to product %s', transaction.productId);
    return res.json({ success: true, ignored: 'unmapped_product' });
  }

  let status = NOTIFICATION_STATUS[notificationType];
  if (notificationType === 'DID_FAIL_TO_RENEW' && subtype !== 'GRACE_PERIOD') {
    status = 'expired';
  }
  if (notificationType === 'DID_CHANGE_RENEWAL_STATUS') {
    status = subtype === 'AUTO_RENEW_DISABLED' ? 'cancelled' : 'active';
  }
  if (!status) {
    const expiresAt = transaction.expiresDate ? new Date(transaction.expiresDate) : null;
    status = expiresAt && expiresAt <= new Date() ? 'expired' : 'active';
  }

  await upsertEntitlement({
    userId,
    userEmail: existing?.user_email,
    coachId,
    source: 'apple_iap',
    status,
    productId: transaction.productId,
    originalTransactionId: transaction.originalTransactionId,
    latestTransactionId: transaction.transactionId,
    expiresAt: transaction.expiresDate ? new Date(transaction.expiresDate).toISOString() : null,
    autoRenew: renewalInfo ? renewalInfo.autoRenewStatus === 1 : status === 'active',
    environment: environment === Environment.SANDBOX ? 'sandbox' : 'production',
  });

  return res.json({ success: true, notificationType, status });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

exports.iapValidator = async (req, res) => {
  res.set('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGINS || '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Max-Age', '3600');

  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Cloud Functions gen2 keeps the function name in the path when invoked
  // through the shared base URL, so match on the suffix.
  const path = (req.path || '/').replace(/\/+$/, '') || '/';

  try {
    if (path.endsWith('/verify')) return await handleVerify(req, res);
    if (path.endsWith('/restore')) return await handleRestore(req, res);
    if (path.endsWith('/apple-notifications')) return await handleAppleNotification(req, res);
    if (path.endsWith('/google-notifications')) {
      // Play RTDN arrives as a Pub/Sub push envelope; acknowledge and no-op
      // until Play billing is turned on, so Google stops retrying.
      console.log('Received Play notification before Play billing is configured');
      return res.status(204).send('');
    }

    return res.status(404).json({ error: 'Unknown route', path });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    const status = error.statusCode || 500;
    if (status >= 500) {
      // 4xx messages are written for the member; 5xx are internal and must not
      // be echoed back into a purchase-failure alert.
      console.error('IAP validator error:', error);
      return res.status(status).json({
        error: 'internal_error',
        message: 'We could not confirm that purchase right now. It will be restored automatically.',
      });
    }
    console.warn('IAP validator rejected request:', error.message);
    return res.status(status).json({ error: error.message });
  }
};
