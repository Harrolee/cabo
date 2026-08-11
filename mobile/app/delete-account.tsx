/**
 * Deleting your account.
 *
 * App Store Review Guideline 5.1.1(v) requires this to be reachable from inside
 * the app, and specifically not a link out to a website. It is a full screen
 * rather than an alert for two reasons: there is more to say than an alert can
 * hold, and the thing that has to be said loudest — that we cannot cancel an
 * Apple subscription for you — has to be read *before* the member commits, not
 * discovered afterwards when the next charge lands.
 *
 * The gate is typing the word DELETE. A destructive, irreversible action should
 * not be one mis-tap away, and a two-button alert is exactly one mis-tap.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/contexts/AuthContext';
import { deleteAccount, fetchDeletionSummary, type DeletionSummary } from '@/lib/api';
import { unregisterThisDevice } from '@/lib/notifications';
import { theme } from '@/lib/theme';

const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';
const CONFIRMATION_WORD = 'DELETE';

export default function DeleteAccountScreen() {
  const router = useRouter();
  const { signOut } = useAuth();

  const [summary, setSummary] = useState<DeletionSummary | null>(null);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    // Best effort. Not being able to count someone's conversations is no reason
    // to stop them deleting their account.
    fetchDeletionSummary()
      .then(setSummary)
      .catch(() => setSummary(null));
  }, []);

  const confirmed = typed.trim().toUpperCase() === CONFIRMATION_WORD;

  async function handleDelete() {
    if (!confirmed || deleting) return;
    setDeleting(true);

    try {
      await deleteAccount();

      // The account is gone; this device must stop receiving its coaches'
      // notifications, and the stale session has to go before the router sends
      // us back to sign-in.
      await unregisterThisDevice().catch(() => {});
      await signOut();

      router.replace('/sign-in');
      Alert.alert(
        'Account deleted',
        'Your account and everything in it is gone. If you had subscriptions, cancel them in the App Store so you are not charged again.'
      );
    } catch (error) {
      Alert.alert('Could not delete your account', (error as Error).message ?? 'Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.lede}>
          This deletes your account and everything in it, permanently. It cannot be undone and we
          cannot get any of it back for you.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>What gets destroyed</Text>
          <Bullet text="Every conversation with every coach, and every message in it" count={summary?.conversations} />
          <Bullet text="The goals and obstacles you told your coaches about" count={summary?.goals} />
          <Bullet text="Every picture your coaches made of you" count={summary?.images} />
          <Bullet text="Your coach subscriptions and free-message allowances" count={summary?.subscriptions} />
          <Bullet
            text={
              summary?.hasReferencePhoto
                ? 'The photo of your face, deleted from storage and not recoverable'
                : 'Any photo of you we hold, deleted from storage'
            }
          />
          <Bullet text="Your profile, notification settings and registered devices" />
        </View>

        {/*
          The single most important thing on this screen. An Apple subscription
          belongs to the Apple ID, not to the Cabo account, and nothing we can
          do from here cancels one. Someone who deletes their account and keeps
          being billed is entitled to be furious about it.
        */}
        <View style={[styles.card, styles.warningCard]}>
          <Text style={styles.warningTitle}>This does not cancel your subscriptions</Text>
          <Text style={styles.warningBody}>
            Coach subscriptions are billed by Apple against your Apple ID. Deleting your Cabo
            account does not stop them and we cannot stop them for you — you will keep being
            charged until you cancel them yourself in the App Store.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => Linking.openURL(APPLE_SUBSCRIPTIONS_URL)}
            style={({ pressed }) => [styles.warningLink, pressed && styles.pressed]}
          >
            <Text style={styles.warningLinkText}>Manage subscriptions in the App Store ›</Text>
          </Pressable>
        </View>

        <View style={styles.confirmBlock}>
          <Text style={styles.confirmLabel}>
            Type {CONFIRMATION_WORD} to confirm you want all of this destroyed.
          </Text>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder={CONFIRMATION_WORD}
            placeholderTextColor={theme.color.textFaint}
            autoCapitalize="characters"
            autoCorrect={false}
            spellCheck={false}
            editable={!deleting}
            accessibilityLabel={`Type ${CONFIRMATION_WORD} to confirm`}
            style={styles.input}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !confirmed || deleting }}
          disabled={!confirmed || deleting}
          onPress={handleDelete}
          style={({ pressed }) => [
            styles.deleteButton,
            (!confirmed || deleting) && styles.deleteButtonDisabled,
            pressed && styles.pressed,
          ]}
        >
          {deleting ? (
            <ActivityIndicator color={theme.color.text} />
          ) : (
            <Text style={styles.deleteButtonText}>Delete my account</Text>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={deleting}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
        >
          <Text style={styles.cancelText}>Keep my account</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

/** `count` is optional: unknown reads as no number rather than as zero. */
function Bullet({ text, count }: { text: string; count?: number | null }) {
  return (
    <View style={styles.bullet}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>
        {text}
        {typeof count === 'number' ? <Text style={styles.bulletCount}> ({count})</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: theme.space(5),
    gap: theme.space(5),
    paddingBottom: theme.space(12),
  },
  lede: {
    color: theme.color.text,
    fontSize: theme.font.body,
    lineHeight: 22,
  },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(4),
    gap: theme.space(2),
  },
  cardTitle: {
    color: theme.color.textFaint,
    fontSize: theme.font.tiny,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: theme.space(1),
  },
  bullet: {
    flexDirection: 'row',
    gap: theme.space(2),
  },
  bulletDot: {
    color: theme.color.textFaint,
    fontSize: theme.font.body,
    lineHeight: 21,
  },
  bulletText: {
    flex: 1,
    color: theme.color.textMuted,
    fontSize: theme.font.body,
    lineHeight: 21,
  },
  bulletCount: {
    color: theme.color.text,
    fontWeight: '600',
  },
  warningCard: {
    borderColor: theme.color.warning,
    backgroundColor: theme.color.surfaceRaised,
  },
  warningTitle: {
    color: theme.color.warning,
    fontSize: theme.font.heading,
    fontWeight: '700',
  },
  warningBody: {
    color: theme.color.text,
    fontSize: theme.font.body,
    lineHeight: 21,
  },
  warningLink: {
    paddingTop: theme.space(2),
  },
  warningLinkText: {
    color: theme.color.accent,
    fontSize: theme.font.body,
    fontWeight: '600',
  },
  confirmBlock: {
    gap: theme.space(2),
  },
  confirmLabel: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
    lineHeight: 19,
  },
  input: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.color.border,
    color: theme.color.text,
    fontSize: theme.font.title,
    fontWeight: '700',
    letterSpacing: 3,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
    textAlign: 'center',
  },
  deleteButton: {
    backgroundColor: theme.color.danger,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    paddingVertical: theme.space(4),
  },
  deleteButtonDisabled: {
    opacity: 0.35,
  },
  deleteButtonText: {
    color: theme.color.text,
    fontSize: theme.font.heading,
    fontWeight: '700',
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: theme.space(3),
  },
  cancelText: {
    color: theme.color.textMuted,
    fontSize: theme.font.body,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.6,
  },
});
