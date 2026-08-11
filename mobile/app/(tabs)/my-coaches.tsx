import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { CoachAvatar } from '@/components/CoachAvatar';
import { EmptyState, ErrorState, Loading, Screen } from '@/components/Screen';
import { fetchMyCoaches } from '@/lib/api';
import { theme, tintForCategory } from '@/lib/theme';
import type { MyCoach } from '@/lib/types';

export default function MyCoachesScreen() {
  const router = useRouter();
  const [coaches, setCoaches] = useState<MyCoach[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      setCoaches(await fetchMyCoaches());
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Could not load your coaches');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refresh on focus: a purchase or a new message elsewhere changes this list.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen edges={[]}>
      <FlatList
        data={coaches}
        keyExtractor={(item) => item.coach_id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor={theme.color.textMuted}
          />
        }
        renderItem={({ item }) => (
          <CoachRow coach={item} onPress={() => router.push(`/chat/${item.coach_id}`)} />
        )}
        ListEmptyComponent={
          error ? (
            <ErrorState message={error} onRetry={() => load()} />
          ) : (
            <EmptyState
              title="No coaches yet"
              body="Head to Discover and start a conversation. Your first few messages with any coach are free."
            />
          )
        }
      />
    </Screen>
  );
}

function CoachRow({ coach, onPress }: { coach: MyCoach; onPress: () => void }) {
  const tint = tintForCategory(coach.category_slug);
  const status = describeStatus(coach);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <CoachAvatar
        name={coach.name}
        avatarUrl={coach.avatar_url}
        categorySlug={coach.category_slug}
        size={52}
      />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.name} numberOfLines={1}>
            {coach.name}
          </Text>
          <View style={styles.rowMeta}>
            {coach.last_message_at ? (
              <Text style={styles.timestamp}>{relativeTime(coach.last_message_at)}</Text>
            ) : null}
            {coach.unread_count > 0 ? (
              <View style={[styles.unreadDot, { backgroundColor: tint }]}>
                <Text style={styles.unreadCount}>
                  {coach.unread_count > 9 ? '9+' : coach.unread_count}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        <Text style={[styles.discipline, { color: tint }]} numberOfLines={1}>
          {coach.discipline ?? 'Coach'}
        </Text>

        {/* An unread coach message outranks the entitlement line — it is the
            reason they opened the app. */}
        {coach.unread_count > 0 && coach.last_message_preview ? (
          <Text style={styles.preview} numberOfLines={2}>
            {coach.last_message_preview}
          </Text>
        ) : (
          <Text style={[styles.status, status.warn && styles.statusWarn]} numberOfLines={1}>
            {status.label}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

/** Turns the entitlement into one line a person can act on. */
function describeStatus(coach: MyCoach): { label: string; warn: boolean } {
  if (!coach.has_access) {
    return coach.source === 'free_tier'
      ? { label: 'Free messages used up — subscribe to continue', warn: true }
      : { label: 'Subscription ended — tap to resubscribe', warn: true };
  }

  if (coach.source === 'free_tier') {
    const left = Math.max(0, coach.free_message_quota - coach.messages_used);
    return { label: `${left} free message${left === 1 ? '' : 's'} left`, warn: left <= 1 };
  }

  if (coach.message_count === 0) {
    return { label: 'Subscribed — say hello', warn: false };
  }

  return { label: `${coach.message_count} messages`, warn: false };
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  list: {
    padding: theme.space(5),
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    gap: theme.space(3),
    paddingVertical: theme.space(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.border,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowBody: {
    flex: 1,
    gap: theme.space(1),
    justifyContent: 'center',
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.space(2),
  },
  name: {
    flexShrink: 1,
    color: theme.color.text,
    fontSize: theme.font.heading,
    fontWeight: '700',
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(2),
  },
  timestamp: {
    color: theme.color.textFaint,
    fontSize: theme.font.tiny,
  },
  unreadDot: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadCount: {
    color: '#fff',
    fontSize: theme.font.tiny,
    fontWeight: '800',
  },
  preview: {
    color: theme.color.text,
    fontSize: theme.font.small,
    lineHeight: 18,
  },
  discipline: {
    fontSize: theme.font.small,
    fontWeight: '600',
  },
  status: {
    color: theme.color.textFaint,
    fontSize: theme.font.small,
  },
  statusWarn: {
    color: theme.color.warning,
  },
});
