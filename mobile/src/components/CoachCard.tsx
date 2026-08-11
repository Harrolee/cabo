import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme, formatPrice, tintForCategory } from '@/lib/theme';
import type { RosterCoach } from '@/lib/types';
import { CoachAvatar } from './CoachAvatar';

interface Props {
  coach: RosterCoach;
  onPress: () => void;
}

export function CoachCard({ coach, onPress }: Props) {
  const tint = tintForCategory(coach.category_slug);
  const price = formatPrice(coach.price_cents, coach.currency ?? 'USD');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${coach.name}, ${coach.discipline ?? 'coach'}`}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.row}>
        <CoachAvatar
          name={coach.name}
          avatarUrl={coach.avatar_url}
          categorySlug={coach.category_slug}
          size={56}
        />

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={styles.name} numberOfLines={1}>
              {coach.name}
            </Text>
            {price ? <Text style={styles.price}>{price}/mo</Text> : null}
          </View>

          {/* The discipline is the whole point — it is what makes a drummer
              legible next to a yoga instructor. */}
          <Text style={[styles.discipline, { color: tint }]} numberOfLines={1}>
            {coach.discipline ?? coach.category_label ?? 'Coach'}
          </Text>

          {coach.tagline ? (
            <Text style={styles.tagline} numberOfLines={2}>
              {coach.tagline}
            </Text>
          ) : null}

          <View style={styles.metaRow}>
            {coach.creator_name ? (
              <Text style={styles.meta} numberOfLines={1}>
                by {coach.creator_name}
              </Text>
            ) : null}
            {coach.subscriber_count > 0 ? (
              <Text style={styles.meta}>
                {coach.subscriber_count.toLocaleString()} subscriber
                {coach.subscriber_count === 1 ? '' : 's'}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(4),
    marginBottom: theme.space(3),
  },
  cardPressed: {
    opacity: 0.7,
  },
  row: {
    flexDirection: 'row',
    gap: theme.space(3),
  },
  body: {
    flex: 1,
    gap: theme.space(1),
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space(2),
  },
  name: {
    flexShrink: 1,
    color: theme.color.text,
    fontSize: theme.font.heading,
    fontWeight: '700',
  },
  price: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
    fontWeight: '600',
  },
  discipline: {
    fontSize: theme.font.small,
    fontWeight: '600',
  },
  tagline: {
    color: theme.color.textMuted,
    fontSize: theme.font.body,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space(3),
    marginTop: theme.space(1),
  },
  meta: {
    color: theme.color.textFaint,
    fontSize: theme.font.tiny,
  },
});
