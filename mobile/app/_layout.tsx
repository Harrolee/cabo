import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { Loading } from '@/components/Screen';
import { endIapConnection, initIap } from '@/lib/iap';
import { clearBadge, onNotificationOpened } from '@/lib/notifications';
import { theme } from '@/lib/theme';

function RootNavigator() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === 'sign-in';

    if (!session && !inAuthGroup) {
      router.replace('/sign-in');
    } else if (session && inAuthGroup) {
      router.replace('/(tabs)/roster');
    }
  }, [session, loading, segments, router]);

  // Tapping a coach's notification opens their thread. Registered once the
  // session exists so a cold start from a notification lands after the auth
  // gate rather than being swallowed by the redirect above.
  useEffect(() => {
    if (!session) return;

    void clearBadge();

    return onNotificationOpened((data) => {
      if (data?.coachId) router.push(`/chat/${data.coachId}`);
    });
  }, [session, router]);

  if (loading) return <Loading />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.color.bg },
        headerTintColor: theme.color.text,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.color.bg },
      }}
    >
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="coach/[id]"
        options={{
          title: '',
          headerTransparent: true,
          // headerTransparent alone is not enough: the shared headerStyle above
          // still paints an opaque background over the hero avatar.
          headerStyle: { backgroundColor: 'transparent' },
        }}
      />
      <Stack.Screen name="chat/[coachId]" options={{ title: '' }} />
      <Stack.Screen name="goals/[coachId]" options={{ title: 'Your goal' }} />
      <Stack.Screen name="visualize/[coachId]" options={{ title: 'Becoming' }} />
      <Stack.Screen name="notification-settings" options={{ title: 'Notifications' }} />
      <Stack.Screen name="likeness" options={{ title: 'Your photo' }} />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    // Warm the StoreKit connection so the first paywall does not stall. Safe to
    // call where the native module is missing — it resolves false.
    void initIap();
    return () => {
      void endIapConnection();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
