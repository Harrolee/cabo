import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface AuthValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  appleSignInAvailable: boolean;
  signInWithApple: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<void>;
  verifyEmailOtp: (email: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

/**
 * Makes sure the signed-in user has a `user_profiles` row.
 *
 * The web funnel created this row from a phone number. App users sign in with
 * Apple and may not even have an email we can see, so the profile is created
 * here, keyed on auth.users.id.
 */
async function ensureProfile(user: User, fallbackName?: string | null) {
  const { data: existing, error: readError } = await supabase
    .from('user_profiles')
    .select('id, user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (readError) {
    console.warn('Could not read profile:', readError.message);
    return;
  }
  if (existing) return;

  // An SMS user who now signs in on mobile already has a row keyed by email;
  // adopt it rather than creating a duplicate.
  if (user.email) {
    const { data: byEmail } = await supabase
      .from('user_profiles')
      .select('id, user_id')
      .eq('email', user.email)
      .maybeSingle();

    if (byEmail && !byEmail.user_id) {
      await supabase.from('user_profiles').update({ user_id: user.id }).eq('id', byEmail.id);
      return;
    }
    if (byEmail) return;
  }

  const { error: insertError } = await supabase.from('user_profiles').insert({
    user_id: user.id,
    email: user.email ?? `${user.id}@users.noreply.cabo.app`,
    display_name: fallbackName ?? user.user_metadata?.full_name ?? null,
    full_name: fallbackName ?? user.user_metadata?.full_name ?? null,
    auth_provider: user.app_metadata?.provider ?? 'unknown',
    coach: null,
    coach_type: null,
    onboarded_at: new Date().toISOString(),
  });

  if (insertError) console.warn('Could not create profile:', insertError.message);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [appleSignInAvailable, setAppleSignInAvailable] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next?.user) void ensureProfile(next.user);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync()
      .then(setAppleSignInAvailable)
      .catch(() => setAppleSignInAvailable(false));
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      appleSignInAvailable,

      async signInWithApple() {
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
        });

        if (!credential.identityToken) {
          throw new Error('Apple did not return an identity token');
        }

        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
        });
        if (error) throw error;

        // Apple only ever sends the name on the very first authorization.
        const name = credential.fullName
          ? [credential.fullName.givenName, credential.fullName.familyName]
              .filter(Boolean)
              .join(' ')
          : null;
        if (data.user) await ensureProfile(data.user, name || null);
      },

      async signInWithEmail(email: string) {
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
          options: { shouldCreateUser: true },
        });
        if (error) throw error;
      },

      async verifyEmailOtp(email: string, token: string) {
        const { data, error } = await supabase.auth.verifyOtp({
          email: email.trim().toLowerCase(),
          token: token.trim(),
          type: 'email',
        });
        if (error) throw error;
        if (data.user) await ensureProfile(data.user);
      },

      async signOut() {
        await supabase.auth.signOut();
      },
    }),
    [session, loading, appleSignInAvailable]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
