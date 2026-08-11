/**
 * Push notifications.
 *
 * Coaches reach out on their own schedule. That used to be an SMS; now it is a
 * notification that opens the coach's thread, with the message already waiting
 * in it.
 *
 * Two deliberate choices:
 *
 *  - Permission is NOT requested at launch. A cold "Allow notifications?" before
 *    someone has met a coach gets denied, and iOS only asks once. `ensurePush`
 *    is called after the first real exchange instead.
 *  - The token is stored server-side against the account, not just held in
 *    memory, because the dispatcher runs when the app is closed.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

export interface CoachNotificationData {
  type?: string;
  coachId?: string;
  conversationId?: string;
}

/**
 * Foreground behaviour. A banner still shows while the app is open, except in
 * the thread it belongs to — that message is already on screen.
 */
let activeConversationId: string | null = null;

export function setActiveConversation(conversationId: string | null) {
  activeConversationId = conversationId;
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as CoachNotificationData;
    const inThisThread =
      Boolean(activeConversationId) && data?.conversationId === activeConversationId;

    return {
      // shouldShowAlert is deprecated in favour of the banner/list pair, but
      // this SDK version still requires it in the type.
      shouldShowAlert: !inThisThread,
      shouldShowBanner: !inThisThread,
      shouldShowList: true,
      shouldPlaySound: !inThisThread,
      shouldSetBadge: !inThisThread,
    };
  },
});

/** Android needs an explicit channel or notifications arrive silently. */
async function configureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('coach-messages', {
    name: 'Messages from your coaches',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

/**
 * The EAS project the push token is minted against.
 *
 * `eas init` writes it to `extra.eas.projectId` in app.json, which is where
 * `Constants.expoConfig.extra` surfaces it. In a build made by EAS itself the
 * value also arrives on `Constants.easConfig`, so both are checked: the first
 * covers `expo run:ios` and Expo Go, the second an EAS build.
 */
function resolveProjectId(): string | undefined {
  const id =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as any)?.easConfig?.projectId ??
    undefined;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

export type PushPermission = 'granted' | 'denied' | 'unavailable';

/** Where we already stand, without prompting. */
export async function getPushPermission(): Promise<PushPermission> {
  if (!Device.isDevice) return 'unavailable';
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted' ? 'granted' : 'denied';
}

/**
 * Ask for permission (if not already decided), get a token, and register it.
 *
 * Safe to call repeatedly — registration is an upsert keyed on the token, so
 * reopening the app just refreshes `last_seen_at`.
 */
export async function ensurePush(): Promise<PushPermission> {
  if (!Device.isDevice) {
    // The simulator cannot receive push at all; do not burn the iOS prompt.
    return 'unavailable';
  }

  await configureAndroidChannel();

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;

  if (status !== 'granted' && existing.canAskAgain) {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }

  if (status !== 'granted') return 'denied';

  try {
    const projectId = resolveProjectId();
    if (!projectId) {
      console.warn(
        'No EAS project id in app.json (extra.eas.projectId) — run `eas init` ' +
          'in mobile/. Without it a build cannot mint a push token.'
      );
    }
    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    await registerToken(token.data);
    return 'granted';
  } catch (error) {
    console.warn('Could not obtain a push token:', error);
    return 'denied';
  }
}

async function registerToken(expoToken: string) {
  /*
    Goes through an RPC rather than a table upsert: the token is unique per
    install, so when a second account signs in on the same device the upsert
    resolves to an UPDATE of the previous owner's row and RLS refuses it. The
    function reassigns ownership instead.
  */
  const { error } = await supabase.rpc('register_push_device', {
    p_expo_token: expoToken,
    p_platform: Platform.OS === 'android' ? 'android' : 'ios',
    p_device_name: Device.modelName ?? null,
    p_app_version: Constants.expoConfig?.version ?? null,
  });

  if (error) console.warn('Could not register push device:', error.message);
}

/**
 * On sign-out, stop this device receiving the previous account's coaches.
 *
 * Disables rather than deletes, and only while the caller still owns the row —
 * deleting would also remove a registration another account has since claimed.
 * Re-registering on the next sign-in flips it back on.
 */
export async function unregisterThisDevice() {
  try {
    const projectId = resolveProjectId();
    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    await supabase.rpc('release_push_device', { p_expo_token: token.data });
  } catch {
    // No token to release; nothing to clean up.
  }
}

export async function clearBadge() {
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // Badge support is best-effort.
  }
}

/**
 * Subscribe to taps. Returns an unsubscribe function.
 *
 * Also replays a notification that launched the app from cold, which
 * `addNotificationResponseReceivedListener` alone does not deliver.
 */
export function onNotificationOpened(handler: (data: CoachNotificationData) => void) {
  Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      if (response) handler(response.notification.request.content.data as CoachNotificationData);
    })
    .catch(() => undefined);

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    handler(response.notification.request.content.data as CoachNotificationData);
  });

  return () => subscription.remove();
}
