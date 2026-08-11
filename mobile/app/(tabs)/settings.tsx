import React, { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { IapUnavailableError, restoreCoachSubscriptions } from '@/lib/iap';
import { unregisterThisDevice } from '@/lib/notifications';
import { theme } from '@/lib/theme';

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [restoring, setRestoring] = useState(false);

  async function handleRestore() {
    setRestoring(true);
    try {
      const count = await restoreCoachSubscriptions();
      Alert.alert(
        count > 0 ? 'Purchases restored' : 'Nothing to restore',
        count > 0
          ? `Restored ${count} subscription${count === 1 ? '' : 's'}.`
          : 'We could not find any active subscriptions on this Apple ID.'
      );
    } catch (error) {
      Alert.alert(
        'Restore failed',
        error instanceof IapUnavailableError
          ? error.message
          : (error as Error).message ?? 'Please try again.'
      );
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Screen edges={[]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Section title="Account">
          <Row label="Signed in as" value={user?.email ?? 'Apple ID'} />
        </Section>

        <Section title="Notifications">
          <Text style={styles.note}>
            Your coaches message you here instead of by text. Choose when, and mute any coach
            individually.
          </Text>
          <Action
            label="Notification settings"
            onPress={() => router.push('/notification-settings')}
          />
        </Section>

        <Section title="Subscriptions">
          <Text style={styles.note}>
            Each coach is a separate subscription billed through your Apple ID. Manage or cancel
            them in the App Store.
          </Text>
          <Action
            label="Manage subscriptions"
            onPress={() => Linking.openURL('https://apps.apple.com/account/subscriptions')}
          />
          <Action
            label={restoring ? 'Restoring…' : 'Restore purchases'}
            disabled={restoring}
            onPress={handleRestore}
          />
        </Section>

        <Section title="Legal">
          <Action
            label="Terms of Service"
            onPress={() => Linking.openURL('https://cabofit.app/terms')}
          />
          <Action
            label="Privacy Policy"
            onPress={() => Linking.openURL('https://cabofit.app/privacy')}
          />
        </Section>

        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}
          onPress={() =>
            Alert.alert('Sign out?', 'Your subscriptions stay on your Apple ID.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Sign out',
                style: 'destructive',
                onPress: async () => {
                  // Otherwise this device keeps receiving the previous
                  // account's coach notifications.
                  await unregisterThisDevice();
                  await signOut();
                },
              },
            ])
          }
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Action({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, (pressed || disabled) && styles.pressed]}
    >
      <Text style={styles.actionLabel}>{label}</Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: theme.space(5),
    gap: theme.space(6),
    paddingBottom: theme.space(12),
  },
  section: {
    gap: theme.space(2),
  },
  sectionTitle: {
    color: theme.color.textFaint,
    fontSize: theme.font.tiny,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: theme.space(1),
  },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    overflow: 'hidden',
  },
  note: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
    lineHeight: 19,
    padding: theme.space(4),
    paddingBottom: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space(3),
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(4),
  },
  pressed: {
    opacity: 0.5,
  },
  rowLabel: {
    color: theme.color.textMuted,
    fontSize: theme.font.body,
  },
  rowValue: {
    flexShrink: 1,
    color: theme.color.text,
    fontSize: theme.font.body,
  },
  actionLabel: {
    color: theme.color.text,
    fontSize: theme.font.body,
  },
  chevron: {
    color: theme.color.textFaint,
    fontSize: theme.font.title,
  },
  signOut: {
    alignItems: 'center',
    paddingVertical: theme.space(4),
  },
  signOutText: {
    color: theme.color.danger,
    fontSize: theme.font.body,
    fontWeight: '600',
  },
});
