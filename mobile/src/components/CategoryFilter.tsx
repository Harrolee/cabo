import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { theme, tintForCategory } from '@/lib/theme';
import type { CoachCategory } from '@/lib/types';

interface Props {
  categories: CoachCategory[];
  selected: string | null;
  onSelect: (slug: string | null) => void;
}

export function CategoryFilter({ categories, selected, onSelect }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      <Chip label="All" active={selected === null} tint={theme.color.accent} onPress={() => onSelect(null)} />
      {categories.map((category) => (
        <Chip
          key={category.slug}
          label={`${category.emoji ?? ''} ${category.label}`.trim()}
          active={selected === category.slug}
          tint={tintForCategory(category.slug)}
          onPress={() => onSelect(selected === category.slug ? null : category.slug)}
        />
      ))}
    </ScrollView>
  );
}

function Chip({
  label,
  active,
  tint,
  onPress,
}: {
  label: string;
  active: boolean;
  tint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.chip,
        active && { backgroundColor: `${tint}26`, borderColor: tint },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.label, active && { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: theme.space(2),
    paddingHorizontal: theme.space(5),
    paddingVertical: theme.space(2),
  },
  chip: {
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(2),
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  pressed: {
    opacity: 0.6,
  },
  label: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
    fontWeight: '600',
  },
});
