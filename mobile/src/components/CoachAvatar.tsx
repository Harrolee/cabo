import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { theme, tintForCategory } from '@/lib/theme';

interface Props {
  name: string;
  avatarUrl?: string | null;
  categorySlug?: string | null;
  size?: number;
}

/**
 * Falls back to a tinted monogram. Most creators will not have uploaded an
 * avatar on day one, and an empty grey circle makes the roster look broken.
 */
export function CoachAvatar({ name, avatarUrl, categorySlug, size = 56 }: Props) {
  const tint = tintForCategory(categorySlug);
  const dimensions = { width: size, height: size, borderRadius: size / 2 };

  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={[dimensions, styles.image]}
        contentFit="cover"
        transition={180}
      />
    );
  }

  return (
    <View style={[dimensions, styles.fallback, { backgroundColor: `${tint}26`, borderColor: tint }]}>
      <Text style={[styles.monogram, { color: tint, fontSize: size * 0.4 }]}>
        {name.trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: theme.color.surfaceRaised,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  monogram: {
    fontWeight: '700',
  },
});
