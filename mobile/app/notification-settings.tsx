import React, { useCallback, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Loading, Screen } from '@/components/Screen';
import {
  fetchMyCoaches,
  fetchNotificationPreferences,
  sendTestNotification,
  updateCoachNotifications,
  updateNotificationPreferences,
} from '@/lib/api';
import { ensurePush, getPushPermission, type PushPermission } from '@/lib/notifications';
import { theme, tintForCategory } from '@/lib/theme';
import type { MyCoach, NotificationPreferences, NudgeCadence } from '@/lib/types';

const CADENCES: Array<{ key: NudgeCadence; label: string }> = [
  { key: 'daily', label: 'Daily' },
  { key: 'few_times_week', label: 'A few times a week' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'off', label: 'Never' },
];

const HOURS = [6, 7, 8, 9, 10, 12, 17, 18, 19, 20];

function formatHour(hour: number) {
  const suffix = hour < 12 ? 'am' : 'pm';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}${suffix}`;
}

export default function NotificationSettingsScreen() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [coaches, setCoaches] = useState<MyCoach[]>([]);
  const [permission, setPermission] = useState<PushPermission>('denied');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [preferences, mine, status] = await Promise.all([
      fetchNotificationPreferences(),
      fetchMyCoaches(),
      getPushPermission(),
    ]);
    setPrefs(preferences);
    setCoaches(mine);
    setPermission(status);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function patchPrefs(patch: Partial<NotificationPreferences>) {
    setPrefs((prev) => (prev ? { ...prev, ...patch } : prev));
    await updateNotificationPreferences(patch).catch((error) =>
      Alert.alert('Could not save', error.message)
    );
  }

  async function patchCoach(coachId: string, patch: { notifications_enabled?: boolean; nudge_cadence?: NudgeCadence }) {
    setCoaches((prev) =>
      prev.map((coach) => (coach.coach_id === coachId ? { ...coach, ...patch } : coach))
    );
    await updateCoachNotifications(coachId, patch).catch((error) =>
      Alert.alert('Could not save', error.message)
    );
  }

  if (loading) return <Screen><Loading /></Screen>;

  const pushOff = permission !== 'granted';

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {pushOff ? (
          <View style={styles.warning}>
            <Text style={styles.warningTitle}>
              {permission === 'unavailable'
                ? 'Push needs a real device'
                : 'Notifications are turned off'}
            </Text>
            <Text style={styles.warningBody}>
              {permission === 'unavailable'
                ? 'Simulators cannot receive push notifications. Everything below still saves.'
                : 'Your coaches cannot reach you until you allow notifications.'}
            </Text>
            {permission === 'denied' ? (
              <Pressable
                accessibilityRole="button"
                onPress={async () => {
                  const next = await ensurePush();
                  setPermission(next);
                  // iOS only shows the prompt once; after that it is a
                  // Settings trip and there is no point pretending otherwise.
                  if (next !== 'granted') void Linking.openSettings();
                }}
              >
                <Text style={styles.warningAction}>Turn on notifications</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <Section title="When">
          <Text style={styles.note}>
            Coaches reach out around this time, in your own timezone
            {prefs?.timezone ? ` (${prefs.timezone})` : ''}.
          </Text>
          <View style={styles.chipWrap}>
            {HOURS.map((hour) => {
              const active = prefs?.nudge_hour === hour;
              return (
                <Pressable
                  accessibilityRole="button"
                  key={hour}
                  onPress={() => patchPrefs({ nudge_hour: hour })}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {formatHour(hour)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Section title="Quiet hours">
          <Text style={styles.note}>
            Nothing arrives between {formatHour(prefs?.quiet_hours_start ?? 21)} and{' '}
            {formatHour(prefs?.quiet_hours_end ?? 8)}.
          </Text>
        </Section>

        <Section title="Per coach">
          {coaches.length === 0 ? (
            <Text style={styles.note}>You have no coaches yet.</Text>
          ) : (
            coaches.map((coach) => (
              <View key={coach.coach_id} style={styles.coachRow}>
                <View style={styles.coachHeader}>
                  <View style={styles.coachName}>
                    <Text style={styles.coachTitle}>{coach.name}</Text>
                    <Text
                      style={[styles.coachDiscipline, { color: tintForCategory(coach.category_slug) }]}
                      numberOfLines={1}
                    >
                      {coach.discipline ?? 'Coach'}
                    </Text>
                  </View>
                  <Switch
                    value={coach.notifications_enabled}
                    onValueChange={(value) =>
                      patchCoach(coach.coach_id, { notifications_enabled: value })
                    }
                    trackColor={{ true: theme.color.accent, false: theme.color.border }}
                  />
                </View>

                {coach.notifications_enabled ? (
                  <View style={styles.chipWrap}>
                    {CADENCES.map((cadence) => {
                      const active = coach.nudge_cadence === cadence.key;
                      return (
                        <Pressable
                          accessibilityRole="button"
                          key={cadence.key}
                          onPress={() => patchCoach(coach.coach_id, { nudge_cadence: cadence.key })}
                          style={[styles.chip, active && styles.chipActive]}
                        >
                          <Text style={[styles.chipText, active && styles.chipTextActive]}>
                            {cadence.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            ))
          )}
        </Section>

        {coaches.length > 0 && !pushOff ? (
          <Pressable
            accessibilityRole="button"
            onPress={async () => {
              try {
                await sendTestNotification(coaches[0].coach_id);
                Alert.alert('Sent', 'Check your notifications in a moment.');
              } catch (error) {
                Alert.alert('Could not send', (error as Error).message);
              }
            }}
          >
            <Text style={styles.testLink}>Send me a test notification</Text>
          </Pressable>
        ) : null}
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

const styles = StyleSheet.create({
  content: {
    padding: theme.space(5),
    gap: theme.space(6),
    paddingBottom: theme.space(12),
  },
  warning: {
    backgroundColor: theme.color.accentSoft,
    borderRadius: theme.radius.md,
    padding: theme.space(4),
    gap: theme.space(2),
  },
  warningTitle: {
    color: theme.color.text,
    fontSize: theme.font.heading,
    fontWeight: '700',
  },
  warningBody: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
    lineHeight: 19,
  },
  warningAction: {
    color: theme.color.accent,
    fontSize: theme.font.body,
    fontWeight: '700',
    paddingTop: theme.space(1),
  },
  section: { gap: theme.space(2) },
  sectionTitle: {
    color: theme.color.textFaint,
    fontSize: theme.font.tiny,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(4),
    gap: theme.space(3),
  },
  note: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
    lineHeight: 19,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space(2),
  },
  chip: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2),
  },
  chipActive: {
    borderColor: theme.color.accent,
    backgroundColor: theme.color.accentSoft,
  },
  chipText: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
    fontWeight: '600',
  },
  chipTextActive: {
    color: theme.color.text,
  },
  coachRow: {
    gap: theme.space(3),
    paddingVertical: theme.space(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.border,
  },
  coachHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space(3),
  },
  coachName: { flex: 1, gap: 2 },
  coachTitle: {
    color: theme.color.text,
    fontSize: theme.font.body,
    fontWeight: '700',
  },
  coachDiscipline: {
    fontSize: theme.font.tiny,
    fontWeight: '600',
  },
  testLink: {
    color: theme.color.accent,
    fontSize: theme.font.body,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: theme.space(3),
  },
});
