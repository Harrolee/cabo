import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { CoachAvatar } from '@/components/CoachAvatar';
import { ErrorState, Loading, Screen } from '@/components/Screen';
import { useAuth } from '@/contexts/AuthContext';
import { fetchCoach, fetchMyCoaches } from '@/lib/api';
import { IapUnavailableError, purchaseCoachSubscription } from '@/lib/iap';
import { formatPrice, theme, tintForCategory } from '@/lib/theme';
import type { MyCoach, RosterCoach } from '@/lib/types';

export default function CoachDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [coach, setCoach] = useState<RosterCoach | null>(null);
  const [entitlement, setEntitlement] = useState<MyCoach | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [detail, mine] = await Promise.all([fetchCoach(id), fetchMyCoaches()]);
      if (!detail) {
        setError('This coach is no longer available.');
        return;
      }
      setCoach(detail);
      setEntitlement(mine.find((entry) => entry.coach_id === id) ?? null);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Could not load this coach');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function handleSubscribe() {
    if (!coach?.ios_product_id || !user) return;

    setPurchasing(true);
    try {
      await purchaseCoachSubscription({ productId: coach.ios_product_id, userId: user.id });
      await load();
      router.push(`/chat/${coach.id}`);
    } catch (err) {
      // A cancelled StoreKit sheet is a normal outcome, not a failure.
      const code = (err as any)?.code;
      if (code === 'E_USER_CANCELLED') return;
      Alert.alert(
        'Purchase failed',
        err instanceof IapUnavailableError
          ? err.message
          : (err as Error).message ?? 'Please try again.'
      );
    } finally {
      setPurchasing(false);
    }
  }

  if (loading) return <Screen><Loading /></Screen>;
  if (error || !coach) {
    return (
      <Screen>
        <ErrorState message={error ?? 'Coach not found'} onRetry={load} />
      </Screen>
    );
  }

  const tint = tintForCategory(coach.category_slug);
  const price = formatPrice(coach.price_cents, coach.currency ?? 'USD');
  const hasAccess = entitlement?.has_access ?? false;
  const freeLeft = entitlement
    ? Math.max(0, entitlement.free_message_quota - entitlement.messages_used)
    : null;
  const onFreeTier = entitlement?.source === 'free_tier';

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <CoachAvatar
            name={coach.name}
            avatarUrl={coach.avatar_url}
            categorySlug={coach.category_slug}
            size={96}
          />
          <Text style={styles.name}>{coach.name}</Text>
          <Text style={[styles.discipline, { color: tint }]}>
            {coach.discipline ?? coach.category_label ?? 'Coach'}
          </Text>
          {coach.creator_name ? (
            <Text style={styles.creator}>by {coach.creator_name}</Text>
          ) : null}
          {coach.tagline ? <Text style={styles.tagline}>{coach.tagline}</Text> : null}
        </View>

        {coach.description ? (
          <Section title="About">
            <Text style={styles.body}>{coach.description}</Text>
          </Section>
        ) : null}

        {coach.expertise && coach.expertise.length > 0 ? (
          <Section title="What they help with">
            <View style={styles.tagRow}>
              {coach.expertise.map((item) => (
                <View key={item} style={[styles.tag, { borderColor: `${tint}66` }]}>
                  <Text style={[styles.tagText, { color: tint }]}>{item}</Text>
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        {coach.starter_prompts && coach.starter_prompts.length > 0 ? (
          <Section title="Try asking">
            {coach.starter_prompts.map((prompt) => (
              <Text key={prompt} style={styles.prompt}>
                “{prompt}”
              </Text>
            ))}
          </Section>
        ) : null}

        <Section title="Subscription">
          <Text style={styles.body}>
            {price
              ? `${price} per ${coach.period === 'yearly' ? 'year' : 'month'}, billed through your Apple ID. Cancel anytime in Settings.`
              : 'This coach has no subscription configured yet.'}
          </Text>
          {onFreeTier && freeLeft !== null ? (
            <Text style={styles.freeNote}>
              {freeLeft > 0
                ? `You have ${freeLeft} free message${freeLeft === 1 ? '' : 's'} left with ${coach.name}.`
                : `You have used your free messages with ${coach.name}.`}
            </Text>
          ) : null}
        </Section>
      </ScrollView>

      <View style={styles.footer}>
        {hasAccess ? (
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
            onPress={() => router.push(`/chat/${coach.id}`)}
          >
            <Text style={styles.ctaText}>
              {entitlement && entitlement.message_count > 0 ? 'Continue chatting' : 'Start chatting'}
            </Text>
          </Pressable>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.cta,
                (pressed || purchasing || !coach.ios_product_id) && styles.ctaPressed,
              ]}
              disabled={purchasing || !coach.ios_product_id}
              onPress={handleSubscribe}
            >
              {purchasing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.ctaText}>
                  {price ? `Subscribe · ${price}/mo` : 'Unavailable'}
                </Text>
              )}
            </Pressable>
            {/* First contact is free, so let people in before the paywall. */}
            {!entitlement ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/chat/${coach.id}`)}>
                <Text style={styles.secondaryLink}>Try a few messages free</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: theme.space(5),
    paddingTop: theme.space(20),
    paddingBottom: theme.space(8),
    gap: theme.space(7),
  },
  hero: {
    alignItems: 'center',
    gap: theme.space(2),
  },
  name: {
    color: theme.color.text,
    fontSize: theme.font.display,
    fontWeight: '800',
    textAlign: 'center',
  },
  discipline: {
    fontSize: theme.font.heading,
    fontWeight: '600',
    textAlign: 'center',
  },
  creator: {
    color: theme.color.textFaint,
    fontSize: theme.font.small,
  },
  tagline: {
    color: theme.color.textMuted,
    fontSize: theme.font.body,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: theme.space(1),
  },
  section: {
    gap: theme.space(3),
  },
  sectionTitle: {
    color: theme.color.textFaint,
    fontSize: theme.font.tiny,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  body: {
    color: theme.color.textMuted,
    fontSize: theme.font.body,
    lineHeight: 22,
  },
  freeNote: {
    color: theme.color.warning,
    fontSize: theme.font.small,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space(2),
  },
  tag: {
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(1.5),
  },
  tagText: {
    fontSize: theme.font.small,
    fontWeight: '600',
  },
  prompt: {
    color: theme.color.textMuted,
    fontSize: theme.font.body,
    fontStyle: 'italic',
    lineHeight: 22,
  },
  footer: {
    padding: theme.space(5),
    paddingTop: theme.space(3),
    gap: theme.space(3),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.border,
    backgroundColor: theme.color.bg,
  },
  cta: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space(4),
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  ctaPressed: {
    opacity: 0.6,
  },
  ctaText: {
    color: '#fff',
    fontSize: theme.font.heading,
    fontWeight: '700',
  },
  secondaryLink: {
    color: theme.color.accent,
    fontSize: theme.font.small,
    fontWeight: '600',
    textAlign: 'center',
  },
});
