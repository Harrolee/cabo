import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { EmptyState, Loading, Screen } from '@/components/Screen';
import { fetchCoach, fetchGoals, updateGoals } from '@/lib/api';
import { theme, tintForCategory } from '@/lib/theme';
import type { MemberGoals, RosterCoach } from '@/lib/types';

/**
 * What the coach believes about you, and a way to correct it.
 *
 * The intake extracts this from conversation, which means it will sometimes be
 * subtly wrong. Showing it back is the cheapest way to keep the coaching honest
 * — and the aspiration here is what the visualiser renders.
 */
export default function GoalsScreen() {
  const { coachId } = useLocalSearchParams<{ coachId: string }>();
  const router = useRouter();

  const [coach, setCoach] = useState<RosterCoach | null>(null);
  const [goals, setGoals] = useState<MemberGoals | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [aspiration, setAspiration] = useState('');
  const [currentLevel, setCurrentLevel] = useState('');
  const [motivation, setMotivation] = useState('');

  const load = useCallback(async () => {
    if (!coachId) return;
    try {
      const [detail, row] = await Promise.all([fetchCoach(coachId), fetchGoals(coachId)]);
      setCoach(detail);
      setGoals(row);
      setAspiration(row?.aspiration ?? '');
      setCurrentLevel(row?.current_level ?? '');
      setMotivation(row?.motivation ?? '');
    } finally {
      setLoading(false);
    }
  }, [coachId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function handleSave() {
    if (!coachId) return;
    setSaving(true);
    try {
      await updateGoals(coachId, {
        aspiration: aspiration.trim() || null,
        current_level: currentLevel.trim() || null,
        motivation: motivation.trim() || null,
      });
      router.back();
    } catch (error) {
      Alert.alert('Could not save', (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Screen><Loading /></Screen>;

  if (!goals) {
    return (
      <Screen>
        <EmptyState
          title="Nothing recorded yet"
          body={`Have a conversation with ${coach?.name ?? 'your coach'} and this fills itself in.`}
        />
      </Screen>
    );
  }

  const tint = tintForCategory(coach?.category_slug);
  const dirty =
    aspiration !== (goals.aspiration ?? '') ||
    currentLevel !== (goals.current_level ?? '') ||
    motivation !== (goals.motivation ?? '');

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardDismissMode="on-drag">
        <Text style={styles.intro}>
          This is what {coach?.name} is working from. Change anything that isn&apos;t right.
        </Text>

        <Field
          label="What you want to become"
          hint="The one that matters most — it shapes every reply, and it's what gets pictured."
          value={aspiration}
          onChange={setAspiration}
          multiline
          tint={tint}
        />
        <Field
          label="Where you're starting from"
          value={currentLevel}
          onChange={setCurrentLevel}
          multiline
          tint={tint}
        />
        <Field
          label="Why it matters"
          value={motivation}
          onChange={setMotivation}
          multiline
          tint={tint}
        />

        {goals.goals?.length ? (
          <ReadOnlyList label="Goals you named" items={goals.goals} tint={tint} />
        ) : null}
        {goals.obstacles?.length ? (
          <ReadOnlyList label="What's got in the way" items={goals.obstacles} tint={tint} />
        ) : null}
        {goals.wins?.length ? (
          <ReadOnlyList label="Wins so far" items={goals.wins} tint={theme.color.positive} />
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={handleSave}
          disabled={!dirty || saving}
          style={({ pressed }) => [
            styles.save,
            { backgroundColor: tint },
            (!dirty || saving || pressed) && styles.pressed,
          ]}
        >
          <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  multiline,
  tint,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  multiline?: boolean;
  tint: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: tint }]}>{label}</Text>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChange}
        accessibilityLabel={label}
        multiline={multiline}
        placeholder="Not set"
        placeholderTextColor={theme.color.textFaint}
      />
    </View>
  );
}

function ReadOnlyList({ label, items, tint }: { label: string; items: string[]; tint: string }) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: tint }]}>{label}</Text>
      {items.map((item) => (
        <Text key={item} style={styles.listItem}>
          • {item}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: theme.space(5),
    gap: theme.space(6),
    paddingBottom: theme.space(12),
  },
  intro: {
    color: theme.color.textMuted,
    fontSize: theme.font.body,
    lineHeight: 22,
  },
  field: {
    gap: theme.space(2),
  },
  fieldLabel: {
    fontSize: theme.font.tiny,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  fieldHint: {
    color: theme.color.textFaint,
    fontSize: theme.font.small,
    lineHeight: 18,
  },
  input: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    padding: theme.space(4),
    color: theme.color.text,
    fontSize: theme.font.body,
    // Explicit: iOS reuses native TextInput views and does not clear
    // letterSpacing when the prop is absent, so a previously-rendered
    // spaced field (the sign-in code box) bleeds into this one.
    letterSpacing: 0,
  },
  inputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  listItem: {
    color: theme.color.textMuted,
    fontSize: theme.font.body,
    lineHeight: 22,
  },
  save: {
    borderRadius: theme.radius.md,
    paddingVertical: theme.space(4),
    alignItems: 'center',
  },
  pressed: { opacity: 0.5 },
  saveText: {
    color: '#fff',
    fontSize: theme.font.heading,
    fontWeight: '700',
  },
});
