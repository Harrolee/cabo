/**
 * The same control as on the visualiser, reachable from Settings.
 *
 * Consent that can only be withdrawn from the screen that benefits from it is
 * not really withdrawable, so it lives somewhere permanent too — next to the
 * account, where people look when they want something about them removed.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { LikenessConsent } from '@/components/LikenessConsent';
import { Screen } from '@/components/Screen';
import { theme } from '@/lib/theme';

export default function LikenessScreen() {
  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Your coaches can picture you having got where you are going. By default those pictures
          show nobody identifiable — from behind, or far enough away. Give us a photo and they show
          you.
        </Text>

        <LikenessConsent />

        <Text style={styles.footnote}>
          We only ever hold the one photo. Replacing it deletes the previous one, and deleting it
          leaves us with nothing.
        </Text>
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
  intro: {
    color: theme.color.textMuted,
    fontSize: theme.font.body,
    lineHeight: 22,
  },
  footnote: {
    color: theme.color.textFaint,
    fontSize: theme.font.small,
    lineHeight: 19,
  },
});
