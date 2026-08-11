/**
 * StoreKit wrapper.
 *
 * Deliberately thin and isolated: `react-native-iap` is a native module, so it
 * is absent in Expo Go and in the web preview. Everything here degrades to a
 * clear "not available" rather than crashing the roster, and the rest of the
 * app only ever sees the three functions at the bottom.
 *
 * The purchase itself is never trusted. We hand the signed transaction to
 * /iap-validator, which verifies it against Apple's certificate chain and
 * writes the entitlement. The UI waits for that call, not for StoreKit.
 */
import { Platform } from 'react-native';
import { restorePurchases, verifyPurchase } from './api';

type IapModule = typeof import('react-native-iap');

let iap: IapModule | null = null;
let initPromise: Promise<boolean> | null = null;

export class IapUnavailableError extends Error {
  constructor() {
    super(
      'In-app purchases need a development build. Run `npx expo run:ios` — they are not available in Expo Go.'
    );
    this.name = 'IapUnavailableError';
  }
}

function loadModule(): IapModule | null {
  if (iap) return iap;
  try {
    // Required lazily so a missing native module cannot break app start-up.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    iap = require('react-native-iap') as IapModule;
    return iap;
  } catch {
    return null;
  }
}

export async function initIap(): Promise<boolean> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const module = loadModule();
    if (!module) return false;
    try {
      await module.initConnection();
      return true;
    } catch (error) {
      console.warn('IAP connection failed:', error);
      return false;
    }
  })();

  return initPromise;
}

export async function isIapAvailable(): Promise<boolean> {
  return initIap();
}

export interface StoreProduct {
  productId: string;
  localizedPrice: string;
  title: string;
}

/** Ask the store for real localized pricing. Falls back to our DB copy. */
export async function fetchStoreProducts(productIds: string[]): Promise<StoreProduct[]> {
  if (productIds.length === 0) return [];
  const ready = await initIap();
  if (!ready || !iap) return [];

  try {
    const subscriptions = await iap.getSubscriptions({ skus: productIds });
    return subscriptions.map((item: any) => ({
      productId: item.productId,
      localizedPrice: item.localizedPrice ?? '',
      title: item.title ?? item.productId,
    }));
  } catch (error) {
    console.warn('Failed to load store products:', error);
    return [];
  }
}

/**
 * Buy a coach subscription and return once the server has granted access.
 *
 * `appAccountToken` carries the Supabase user id into the transaction. It is
 * the only binding between a store purchase and an account that survives a
 * reinstall, and renewal webhooks carry no other user context — the validator
 * depends on it.
 */
export async function purchaseCoachSubscription(params: {
  productId: string;
  userId: string;
}): Promise<{ coachId: string; status: string }> {
  const ready = await initIap();
  if (!ready || !iap) throw new IapUnavailableError();

  const purchase: any = await iap.requestSubscription({
    sku: params.productId,
    // iOS-only; Android uses obfuscatedAccountIdAndroid.
    appAccountToken: params.userId,
    obfuscatedAccountIdAndroid: params.userId,
  });

  const result = Array.isArray(purchase) ? purchase[0] : purchase;
  const jws = result?.transactionReceipt ?? result?.jwsRepresentationIOS;

  if (!jws) {
    throw new Error('The store did not return a signed transaction');
  }

  const { entitlement } = await verifyPurchase({ jws });

  // Only acknowledge once our side has recorded the entitlement, so a crash
  // between purchase and grant leaves the transaction pending for retry.
  try {
    await iap.finishTransaction({ purchase: result, isConsumable: false });
  } catch (error) {
    console.warn('finishTransaction failed (entitlement already granted):', error);
  }

  return entitlement;
}

/** Re-sync entitlements after a reinstall or on a new device. */
export async function restoreCoachSubscriptions(): Promise<number> {
  const ready = await initIap();
  if (!ready || !iap) throw new IapUnavailableError();

  const purchases: any[] = await iap.getAvailablePurchases();
  const transactions = purchases
    .map((p) => p.transactionReceipt ?? p.jwsRepresentationIOS)
    .filter(Boolean) as string[];

  if (transactions.length === 0) return 0;

  const { restored } = await restorePurchases(transactions);
  return restored.filter((entry) => !entry.error).length;
}

export async function endIapConnection(): Promise<void> {
  if (!iap) return;
  try {
    await iap.endConnection();
  } catch {
    // Nothing useful to do if teardown fails.
  }
  initPromise = null;
}
