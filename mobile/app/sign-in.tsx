import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/contexts/AuthContext';
import { theme } from '@/lib/theme';

export default function SignInScreen() {
  const { signInWithApple, signInWithEmail, verifyEmailOtp, appleSignInAvailable } = useAuth();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err: any) {
      // The user backing out of the Apple sheet is not an error worth showing.
      if (err?.code === 'ERR_REQUEST_CANCELED') return;
      setError(err?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Find your coach</Text>
            <Text style={styles.subtitle}>
              Drummers, songwriters, yoga teachers and more — each one trained on their own
              voice, ready to text back.
            </Text>
          </View>

          <View style={styles.actions}>
            {appleSignInAvailable ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                cornerRadius={theme.radius.md}
                style={styles.appleButton}
                onPress={() => run(signInWithApple)}
              />
            ) : null}

            {appleSignInAvailable ? (
              <View style={styles.dividerRow}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.divider} />
              </View>
            ) : null}

            {!codeSent ? (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="you@example.com"
                  placeholderTextColor={theme.color.textFaint}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  editable={!busy}
                />
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.primaryButton,
                    (pressed || busy || !email.includes('@')) && styles.buttonMuted,
                  ]}
                  disabled={busy || !email.includes('@')}
                  onPress={() =>
                    run(async () => {
                      await signInWithEmail(email);
                      setCodeSent(true);
                    })
                  }
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Email me a code</Text>
                  )}
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.hint}>We sent a six-digit code to {email}.</Text>
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  placeholder="123456"
                  placeholderTextColor={theme.color.textFaint}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  maxLength={6}
                  editable={!busy}
                />
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.primaryButton,
                    (pressed || busy || code.length < 6) && styles.buttonMuted,
                  ]}
                  disabled={busy || code.length < 6}
                  onPress={() => run(() => verifyEmailOtp(email, code))}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Continue</Text>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setCodeSent(false);
                    setCode('');
                  }}
                >
                  <Text style={styles.linkText}>Use a different email</Text>
                </Pressable>
              </>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>

          <Text style={styles.legal}>
            Subscriptions are billed through your Apple ID and renew monthly until cancelled.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    padding: theme.space(6),
    justifyContent: 'space-between',
  },
  header: {
    marginTop: theme.space(16),
    gap: theme.space(3),
  },
  title: {
    color: theme.color.text,
    fontSize: theme.font.display,
    fontWeight: '800',
  },
  subtitle: {
    color: theme.color.textMuted,
    fontSize: theme.font.body,
    lineHeight: 22,
  },
  actions: {
    gap: theme.space(3),
  },
  appleButton: {
    height: 50,
    width: '100%',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
    marginVertical: theme.space(1),
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: theme.color.border,
  },
  dividerText: {
    color: theme.color.textFaint,
    fontSize: theme.font.small,
  },
  input: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(4),
    color: theme.color.text,
    fontSize: theme.font.body,
    // Explicit: iOS reuses native TextInput views and does not clear
    // letterSpacing when the prop is absent, so a previously-rendered
    // spaced field (the sign-in code box) bleeds into this one.
    letterSpacing: 0,
  },
  codeInput: {
    textAlign: 'center',
    letterSpacing: 8,
    fontSize: theme.font.title,
  },
  primaryButton: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space(4),
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  buttonMuted: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: theme.font.heading,
    fontWeight: '700',
  },
  hint: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
    textAlign: 'center',
  },
  linkText: {
    color: theme.color.accent,
    fontSize: theme.font.small,
    textAlign: 'center',
    paddingVertical: theme.space(2),
  },
  error: {
    color: theme.color.danger,
    fontSize: theme.font.small,
    textAlign: 'center',
  },
  legal: {
    color: theme.color.textFaint,
    fontSize: theme.font.tiny,
    textAlign: 'center',
    lineHeight: 16,
  },
});
