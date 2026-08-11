import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';

export function Screen({
  children,
  edges = ['top'],
}: {
  children: React.ReactNode;
  edges?: Edge[];
}) {
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {children}
    </SafeAreaView>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={theme.color.accent} />
      {label ? <Text style={styles.centeredText}>{label}</Text> : null}
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.centered}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.centeredText}>{body}</Text> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.centered}>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={styles.centeredText}>{message}</Text>
      {onRetry ? (
        <Text style={styles.retry} onPress={onRetry}>
          Try again
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.color.bg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space(8),
    gap: theme.space(2),
  },
  centeredText: {
    color: theme.color.textMuted,
    fontSize: theme.font.body,
    textAlign: 'center',
    lineHeight: 21,
  },
  emptyTitle: {
    color: theme.color.text,
    fontSize: theme.font.title,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorTitle: {
    color: theme.color.danger,
    fontSize: theme.font.heading,
    fontWeight: '700',
  },
  retry: {
    color: theme.color.accent,
    fontSize: theme.font.body,
    fontWeight: '600',
    marginTop: theme.space(2),
  },
});
