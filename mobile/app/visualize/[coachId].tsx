import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { EmptyState, Loading, Screen } from '@/components/Screen';
import {
  NoAspirationError,
  fetchCoach,
  fetchGoals,
  fetchVisualizations,
  generateVisualization,
  setVisualizationSaved,
} from '@/lib/api';
import { theme, tintForCategory } from '@/lib/theme';
import type { MemberContext, RosterCoach, Visualization } from '@/lib/types';

const KINDS: Array<{ key: 'becoming' | 'milestone' | 'today'; label: string; blurb: string }> = [
  { key: 'becoming', label: 'Becoming', blurb: 'You, once you get there' },
  { key: 'milestone', label: 'The moment', blurb: 'A goal, actually happening' },
  { key: 'today', label: 'Today', blurb: 'The ordinary work' },
];

const CARD_WIDTH = Dimensions.get('window').width - theme.space(10);

export default function VisualizeScreen() {
  const { coachId } = useLocalSearchParams<{ coachId: string }>();
  const router = useRouter();

  const [coach, setCoach] = useState<RosterCoach | null>(null);
  const [goals, setGoals] = useState<MemberContext | null>(null);
  const [images, setImages] = useState<Visualization[]>([]);
  const [kind, setKind] = useState<'becoming' | 'milestone' | 'today'>('becoming');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [caption, setCaption] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!coachId) return;
    try {
      const [detail, goalRow, history] = await Promise.all([
        fetchCoach(coachId),
        fetchGoals(coachId).catch(() => null),
        fetchVisualizations(coachId).catch(() => []),
      ]);
      setCoach(detail);
      setGoals(goalRow);
      setImages(history);
    } finally {
      setLoading(false);
    }
  }, [coachId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function handleGenerate() {
    if (!coachId) return;
    setGenerating(true);
    setCaption(null);
    try {
      const result = await generateVisualization({ coachId, kind });
      setImages((prev) => [result.visualization, ...prev]);
      setCaption(result.caption);
    } catch (error) {
      if (error instanceof NoAspirationError) {
        Alert.alert(
          'Tell your coach first',
          `${coach?.name ?? 'Your coach'} needs to know what you're working toward before picturing it.`,
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Open chat', onPress: () => router.replace(`/chat/${coachId}`) },
          ]
        );
      } else {
        Alert.alert('Could not create the image', (error as Error).message);
      }
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return <Screen><Loading /></Screen>;

  const tint = tintForCategory(coach?.category_slug);

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.aspirationCard}>
          <Text style={styles.label}>What you told {coach?.name}</Text>
          {goals?.aspiration ? (
            <Text style={styles.aspiration}>{goals.aspiration}</Text>
          ) : (
            <Text style={styles.aspirationEmpty}>
              You haven&apos;t said yet. Have a conversation first and this fills itself in.
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/goals/${coachId}`)}>
            <Text style={[styles.editLink, { color: tint }]}>Edit</Text>
          </Pressable>
        </View>

        <View style={styles.kindRow}>
          {KINDS.map((option) => {
            const active = option.key === kind;
            return (
              <Pressable
                accessibilityRole="button"
                key={option.key}
                onPress={() => setKind(option.key)}
                style={[
                  styles.kindChip,
                  active && { borderColor: tint, backgroundColor: `${tint}1F` },
                ]}
              >
                <Text style={[styles.kindLabel, active && { color: tint }]}>{option.label}</Text>
                <Text style={styles.kindBlurb}>{option.blurb}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={handleGenerate}
          disabled={generating}
          style={({ pressed }) => [
            styles.generate,
            { backgroundColor: tint },
            (pressed || generating) && styles.pressed,
          ]}
        >
          {generating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.generateText}>Picture it</Text>
          )}
        </Pressable>
        {generating ? (
          <Text style={styles.hint}>This takes about a minute.</Text>
        ) : caption ? (
          <Text style={[styles.caption, { color: tint }]}>“{caption}”</Text>
        ) : null}

        {images.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            body="Make one and it stays on this page."
          />
        ) : (
          images.map((image) => (
            <View key={image.id} style={styles.imageCard}>
              {image.image_url ? (
                <Image
                  source={{ uri: image.image_url }}
                  style={styles.image}
                  contentFit="cover"
                  transition={220}
                />
              ) : (
                <View style={[styles.image, styles.imagePlaceholder]}>
                  <ActivityIndicator color={theme.color.textMuted} />
                </View>
              )}
              {image.scene ? <Text style={styles.scene}>{image.scene}</Text> : null}
              <Pressable
                accessibilityRole="button"
                onPress={async () => {
                  const next = !image.saved;
                  setImages((prev) =>
                    prev.map((item) => (item.id === image.id ? { ...item, saved: next } : item))
                  );
                  await setVisualizationSaved(image.id, next).catch(() => undefined);
                }}
              >
                <Text style={[styles.saveLink, image.saved && { color: tint }]}>
                  {image.saved ? '★ Saved' : '☆ Save'}
                </Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: theme.space(5),
    gap: theme.space(5),
    paddingBottom: theme.space(12),
  },
  aspirationCard: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(4),
    gap: theme.space(2),
  },
  label: {
    color: theme.color.textFaint,
    fontSize: theme.font.tiny,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  aspiration: {
    color: theme.color.text,
    fontSize: theme.font.title,
    lineHeight: 30,
    fontWeight: '600',
  },
  aspirationEmpty: {
    color: theme.color.textMuted,
    fontSize: theme.font.body,
    lineHeight: 22,
  },
  editLink: {
    fontSize: theme.font.small,
    fontWeight: '600',
  },
  kindRow: {
    flexDirection: 'row',
    gap: theme.space(2),
  },
  kindChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    padding: theme.space(3),
    gap: theme.space(1),
  },
  kindLabel: {
    color: theme.color.text,
    fontSize: theme.font.small,
    fontWeight: '700',
  },
  kindBlurb: {
    color: theme.color.textFaint,
    fontSize: theme.font.tiny,
    lineHeight: 14,
  },
  generate: {
    borderRadius: theme.radius.md,
    paddingVertical: theme.space(4),
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  pressed: { opacity: 0.6 },
  generateText: {
    color: '#fff',
    fontSize: theme.font.heading,
    fontWeight: '700',
  },
  hint: {
    color: theme.color.textFaint,
    fontSize: theme.font.small,
    textAlign: 'center',
  },
  caption: {
    fontSize: theme.font.body,
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: 22,
  },
  imageCard: {
    gap: theme.space(2),
  },
  image: {
    width: CARD_WIDTH,
    height: CARD_WIDTH * 1.25,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.surfaceRaised,
  },
  imagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scene: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
    lineHeight: 19,
  },
  saveLink: {
    color: theme.color.textFaint,
    fontSize: theme.font.small,
    fontWeight: '600',
  },
});
