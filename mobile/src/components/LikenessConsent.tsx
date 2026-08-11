/**
 * "Use my face in these pictures."
 *
 * Without this, every visualisation is deliberately faceless — shot from
 * behind or far enough away that nobody is identifiable — because the
 * identity-preserving model is only reachable with a photo and consent.
 *
 * The consent has to be worth the name, so this component holds itself to
 * three rules:
 *
 *   - The wording says what actually happens, in the order it happens: the
 *     photo is stored, it is sent to an image model, it comes back as pictures
 *     of them. No "improve your experience".
 *   - Consent and the upload are one action. There is no toggle that can be on
 *     while we hold nothing, and none that can be off while we hold something.
 *   - Turning it off deletes the file. The button says delete because it
 *     deletes, and the screen does not claim it happened until the backend
 *     says it did.
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from 'expo-router';
import { fetchLikeness, grantLikeness, revokeLikeness } from '@/lib/api';
import { theme } from '@/lib/theme';
import type { LikenessStatus } from '@/lib/types';

/**
 * Everything the member is agreeing to, in plain words. Kept as one constant
 * because it is the actual consent record — it belongs in one place, and if it
 * changes, that is a change to what people agreed to.
 */
const CONSENT_TERMS = [
  'Your photo is uploaded and stored on our servers.',
  'Each time you make a picture, it is sent to the image model that draws you, so the person in the picture looks like you.',
  'It is not shown to your coaches, not shown to anyone else, and not used to train anything.',
  'Remove it whenever you like and the file is deleted. Pictures then go back to showing you from behind or at a distance.',
];

export function LikenessConsent({ tint = theme.color.accent }: { tint?: string }) {
  const [status, setStatus] = useState<LikenessStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await fetchLikeness());
    } catch {
      // A likeness that cannot be read is treated as one that is not given.
      setStatus({ consent: false, hasPhoto: false, consentAt: null, photoUpdatedAt: null, previewUrl: null });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function pickAndUpload() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Photos access needed',
        'Allow photo access in Settings to pick a picture of yourself.'
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // Cropping to a square also re-encodes HEIC as JPEG on iOS, which is what
      // the image model can actually read.
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
      base64: true,
      exif: false,
    });

    if (result.canceled) return;

    const photoBase64 = result.assets[0]?.base64;
    if (!photoBase64) {
      Alert.alert('Could not read that photo', 'Please pick another one.');
      return;
    }

    setBusy(true);
    try {
      setStatus(await grantLikeness(photoBase64));
    } catch (error) {
      Alert.alert('Could not save your photo', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function confirmUpload() {
    Alert.alert(
      'Use your face in your pictures?',
      `${CONSENT_TERMS.join('\n\n')}\n\nOnly do this with a photo of yourself.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'I agree, pick a photo', onPress: () => void pickAndUpload() },
      ]
    );
  }

  function confirmRevoke() {
    Alert.alert(
      'Delete your photo?',
      'We delete the file and stop using your face. Pictures you have already made stay on your wall — delete those from the picture itself.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete photo',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              const result = await revokeLikeness();
              setStatus(result.likeness);
              if (!result.photoDeleted) {
                Alert.alert('Consent withdrawn', result.message ?? 'Your photo will not be used again.');
              }
            } catch (error) {
              Alert.alert('Could not remove your photo', (error as Error).message);
              void load();
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }

  const on = Boolean(status?.consent && status.hasPhoto);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        {status?.previewUrl ? (
          <Image source={{ uri: status.previewUrl }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]}>
            <Text style={styles.thumbEmptyMark}>?</Text>
          </View>
        )}
        <View style={styles.headerText}>
          <Text style={styles.title}>Your face in your pictures</Text>
          <Text style={[styles.state, on && { color: tint }]}>
            {on ? 'On — pictures are drawn to look like you' : 'Off — pictures show nobody identifiable'}
          </Text>
        </View>
      </View>

      {on ? null : (
        <View style={styles.terms}>
          {CONSENT_TERMS.map((line) => (
            <Text key={line} style={styles.term}>
              {'•'}  {line}
            </Text>
          ))}
        </View>
      )}

      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator color={tint} />
        </View>
      ) : on ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={confirmUpload}
            style={({ pressed }) => [styles.button, styles.secondary, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryText}>Replace photo</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={confirmRevoke}
            style={({ pressed }) => [styles.button, styles.destructive, pressed && styles.pressed]}
          >
            <Text style={styles.destructiveText}>Delete photo</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={confirmUpload}
          style={({ pressed }) => [styles.button, { backgroundColor: tint }, pressed && styles.pressed]}
        >
          <Text style={styles.primaryText}>Add a photo of me</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(4),
    gap: theme.space(3),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
  },
  headerText: {
    flex: 1,
    gap: theme.space(1),
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceRaised,
  },
  thumbEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  thumbEmptyMark: {
    color: theme.color.textFaint,
    fontSize: theme.font.heading,
    fontWeight: '700',
  },
  title: {
    color: theme.color.text,
    fontSize: theme.font.heading,
    fontWeight: '700',
  },
  state: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
    lineHeight: 18,
  },
  terms: {
    gap: theme.space(2),
  },
  term: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
    lineHeight: 19,
  },
  busy: {
    paddingVertical: theme.space(3),
    alignItems: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: theme.space(2),
  },
  button: {
    flex: 1,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space(3),
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  pressed: { opacity: 0.6 },
  primaryText: {
    color: '#fff',
    fontSize: theme.font.body,
    fontWeight: '700',
  },
  secondary: {
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  secondaryText: {
    color: theme.color.text,
    fontSize: theme.font.body,
    fontWeight: '600',
  },
  destructive: {
    borderWidth: 1,
    borderColor: theme.color.danger,
  },
  destructiveText: {
    color: theme.color.danger,
    fontSize: theme.font.body,
    fontWeight: '600',
  },
});
