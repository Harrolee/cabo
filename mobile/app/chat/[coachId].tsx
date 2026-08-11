import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ErrorState, Loading, Screen } from '@/components/Screen';
import {
  SubscriptionRequiredError,
  beginGoalOnboarding,
  fetchCoach,
  fetchMessages,
  markConversationRead,
  openConversation,
  sendMessage,
} from '@/lib/api';
import { ensurePush, setActiveConversation } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { formatPrice, theme, tintForCategory } from '@/lib/theme';
import type { ChatMessage, OnboardingState, RosterCoach } from '@/lib/types';

/** Rows rendered before the server has confirmed them. */
const isLocal = (message: ChatMessage) => message.id.startsWith('local-');

/**
 * Fold a server row into the thread.
 *
 * Both turns arrive twice — once optimistically from `handleSend`, once over
 * realtime — and the realtime copy can land either side of the HTTP response.
 * Matching on (role, content) lets the authoritative row replace its local
 * stand-in in place, instead of appending a duplicate.
 */
function mergeServerMessage(prev: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  if (prev.some((message) => message.id === incoming.id)) return prev;

  const localIndex = prev.findIndex(
    (message) =>
      isLocal(message) && message.role === incoming.role && message.content === incoming.content
  );

  if (localIndex === -1) return [...prev, incoming];

  const next = [...prev];
  next[localIndex] = incoming;
  return next;
}

export default function ChatScreen() {
  const { coachId } = useLocalSearchParams<{ coachId: string }>();
  const router = useRouter();
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const [coach, setCoach] = useState<RosterCoach | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paywalled, setPaywalled] = useState(false);
  const [freeLeft, setFreeLeft] = useState<number | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  // Asked once, after the member has actually exchanged messages — a cold
  // permission prompt at launch gets denied and iOS never asks again.
  const pushAsked = useRef(false);

  const load = useCallback(async () => {
    if (!coachId) return;
    setLoading(true);
    try {
      const [detail, threadId] = await Promise.all([
        fetchCoach(coachId),
        openConversation(coachId),
      ]);
      setCoach(detail);
      setConversationId(threadId);
      setMessages(await fetchMessages(threadId));
      // Creates the goals row so the coach's first questions are recorded.
      void beginGoalOnboarding(coachId).catch(() => undefined);
      void markConversationRead(threadId);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Could not open this conversation');
    } finally {
      setLoading(false);
    }
  }, [coachId]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    Live thread. A coach's scheduled message is written server-side, so without
    this the member would see the notification banner and then an empty thread
    until they pulled to refresh.
  */
  useEffect(() => {
    if (!conversationId) return;

    setActiveConversation(conversationId);
    void markConversationRead(conversationId);

    const channel = supabase
      .channel(`thread:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversation_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          setMessages((prev) => mergeServerMessage(prev, payload.new as ChatMessage));
          void markConversationRead(conversationId);
        }
      )
      .subscribe();

    return () => {
      setActiveConversation(null);
      void supabase.removeChannel(channel);
    };
  }, [conversationId]);

  async function handleSend(text?: string) {
    const body = (text ?? draft).trim();
    if (!body || !conversationId || !coachId || sending) return;

    setDraft('');
    setSending(true);
    setError(null);

    // Optimistic user bubble so the thread never feels stalled. The `local-`
    // prefix is what lets the authoritative row replace it when it arrives.
    const optimistic: ChatMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content: body,
      created_at: new Date().toISOString(),
      pending: true,
    };
    setMessages((prev) => mergeServerMessage(prev, optimistic));

    try {
      const reply = await sendMessage({ coachId, conversationId, message: body });

      /*
        Both turns are persisted server-side and also arrive over realtime. Go
        through the same merge so whichever lands first wins and the other is
        folded into it — appending here unconditionally is what duplicated the
        user's own message in the thread.
      */
      setMessages((prev) => {
        const confirmed = prev.map((message) =>
          message.id === optimistic.id ? { ...message, pending: false } : message
        );
        return mergeServerMessage(confirmed, {
          id: `local-assistant-${Date.now()}`,
          role: 'assistant',
          content: reply.response,
          created_at: new Date().toISOString(),
        });
      });
      setFreeLeft(reply.metadata?.freeMessagesRemaining ?? null);
      setOnboarding(reply.metadata?.onboarding ?? null);

      /*
        Ask for notifications once the coach has just finished intake — the one
        moment the member has clear context for why the app would message them.
      */
      if (!pushAsked.current && reply.metadata?.onboarding?.complete) {
        pushAsked.current = true;
        void ensurePush();
      }
    } catch (err) {
      if (err instanceof SubscriptionRequiredError) {
        // Drop the optimistic bubble — the message was never delivered.
        setMessages((prev) => prev.filter((message) => message.id !== optimistic.id));
        setDraft(body);
        setPaywalled(true);
      } else {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === optimistic.id ? { ...message, pending: false, failed: true } : message
          )
        );
        setError((err as Error).message ?? 'Message failed to send');
      }
    } finally {
      setSending(false);
    }
  }

  if (loading) return <Screen><Loading /></Screen>;
  if (error && !coach) {
    return (
      <Screen>
        <ErrorState message={error} onRetry={load} />
      </Screen>
    );
  }

  const tint = tintForCategory(coach?.category_slug);
  const price = formatPrice(coach?.price_cents, coach?.currency ?? 'USD');
  const showIntro = messages.length === 0;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title: coach?.name ?? 'Chat',
          headerRight: () =>
            coach ? (
              <View style={styles.headerActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/visualize/${coach.id}`)} hitSlop={10}>
                  <Text style={[styles.headerLink, { color: tint }]}>Becoming</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/coach/${coach.id}`)} hitSlop={10}>
                  <Text style={styles.headerLinkMuted}>Profile</Text>
                </Pressable>
              </View>
            ) : null,
        }}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => <Bubble message={item} tint={tint} />}
          ListHeaderComponent={
            showIntro && coach ? (
              <Intro coach={coach} tint={tint} onPrompt={(prompt) => void handleSend(prompt)} />
            ) : null
          }
          ListFooterComponent={
            sending ? (
              <View style={[styles.bubble, styles.coachBubble, styles.typing]}>
                <ActivityIndicator size="small" color={theme.color.textMuted} />
                <Text style={styles.typingText}>{coach?.name} is typing…</Text>
              </View>
            ) : null
          }
        />

        {onboarding?.active ? (
          <Text style={styles.intakeBanner}>
            {coach?.name} is getting to know you
            {onboarding.turn && onboarding.maxTurns
              ? ` · ${onboarding.turn}/${onboarding.maxTurns}`
              : ''}
          </Text>
        ) : null}

        {onboarding?.complete && onboarding.turn ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => coach && router.push(`/goals/${coach.id}`)}>
            <Text style={styles.intakeDone}>Goal saved — tap to review or edit</Text>
          </Pressable>
        ) : null}

        {freeLeft !== null && freeLeft <= 2 && !paywalled ? (
          <Text style={styles.quotaBanner}>
            {freeLeft > 0
              ? `${freeLeft} free message${freeLeft === 1 ? '' : 's'} left with ${coach?.name}`
              : 'That was your last free message'}
          </Text>
        ) : null}

        {paywalled ? (
          <Paywall
            coachName={coach?.name ?? 'this coach'}
            price={price}
            onSubscribe={() => coach && router.push(`/coach/${coach.id}`)}
          />
        ) : (
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={() => void handleSend()}
            disabled={sending}
            placeholder={`Message ${coach?.name ?? 'your coach'}…`}
          />
        )}

        {error && coach ? <Text style={styles.inlineError}>{error}</Text> : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Intro({
  coach,
  tint,
  onPrompt,
}: {
  coach: RosterCoach;
  tint: string;
  onPrompt: (prompt: string) => void;
}) {
  return (
    <View style={styles.intro}>
      <Text style={[styles.introDiscipline, { color: tint }]}>
        {coach.discipline ?? 'Coach'}
      </Text>
      <Text style={styles.introMessage}>
        {coach.intro_message ?? `Hi, I'm ${coach.name}. What are you working on?`}
      </Text>

      {coach.starter_prompts?.length ? (
        <View style={styles.promptList}>
          {coach.starter_prompts.map((prompt) => (
            <Pressable
              accessibilityRole="button"
              key={prompt}
              onPress={() => onPrompt(prompt)}
              style={({ pressed }) => [
                styles.promptChip,
                { borderColor: `${tint}66` },
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.promptChipText}>{prompt}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Bubble({ message, tint }: { message: ChatMessage; tint: string }) {
  const isUser = message.role === 'user';
  return (
    <View style={[styles.bubbleRow, isUser ? styles.alignRight : styles.alignLeft]}>
      <View
        style={[
          styles.bubble,
          isUser ? styles.userBubble : styles.coachBubble,
          message.pending && styles.bubblePending,
          message.failed && styles.bubbleFailed,
        ]}
      >
        <Text style={[styles.bubbleText, isUser && styles.userBubbleText]}>{message.content}</Text>
      </View>
      {message.failed ? <Text style={styles.failedNote}>Not delivered</Text> : null}
    </View>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  disabled: boolean;
  placeholder: string;
}) {
  const canSend = value.trim().length > 0 && !disabled;
  return (
    <View style={styles.composer}>
      <TextInput
        style={styles.composerInput}
        value={value}
        onChangeText={onChange}
        // Multiline inputs surface as a TextView with no implicit name, so
        // VoiceOver announces nothing without this.
        accessibilityLabel={placeholder}
        placeholder={placeholder}
        placeholderTextColor={theme.color.textFaint}
        multiline
        maxLength={2000}
        editable={!disabled}
      />
      <Pressable
        onPress={onSend}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Send message"
        style={({ pressed }) => [styles.sendButton, (!canSend || pressed) && styles.pressed]}
      >
        <Text style={styles.sendButtonText}>↑</Text>
      </Pressable>
    </View>
  );
}

function Paywall({
  coachName,
  price,
  onSubscribe,
}: {
  coachName: string;
  price: string | null;
  onSubscribe: () => void;
}) {
  return (
    <View style={styles.paywall}>
      <Text style={styles.paywallTitle}>Keep going with {coachName}</Text>
      <Text style={styles.paywallBody}>
        You have used your free messages. Subscribe for unlimited conversation
        {price ? ` — ${price}/month, cancel anytime.` : '.'}
      </Text>
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.paywallButton, pressed && styles.pressed]}
        onPress={onSubscribe}
      >
        <Text style={styles.paywallButtonText}>
          {price ? `Subscribe · ${price}/mo` : 'See subscription'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: {
    padding: theme.space(4),
    gap: theme.space(2),
    flexGrow: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(4),
  },
  headerLink: {
    fontSize: theme.font.small,
    fontWeight: '700',
  },
  headerLinkMuted: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
    fontWeight: '600',
  },
  intakeBanner: {
    color: theme.color.textFaint,
    fontSize: theme.font.tiny,
    textAlign: 'center',
    paddingVertical: theme.space(2),
  },
  intakeDone: {
    color: theme.color.positive,
    fontSize: theme.font.small,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: theme.space(2),
  },

  intro: {
    padding: theme.space(4),
    marginBottom: theme.space(4),
    gap: theme.space(3),
  },
  introDiscipline: {
    fontSize: theme.font.small,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  introMessage: {
    color: theme.color.text,
    fontSize: theme.font.title,
    lineHeight: 30,
    fontWeight: '600',
  },
  promptList: {
    gap: theme.space(2),
    marginTop: theme.space(2),
  },
  promptChip: {
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
  },
  promptChipText: {
    color: theme.color.textMuted,
    fontSize: theme.font.body,
  },

  bubbleRow: {
    width: '100%',
  },
  alignLeft: { alignItems: 'flex-start' },
  alignRight: { alignItems: 'flex-end' },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
    borderRadius: theme.radius.lg,
  },
  userBubble: {
    backgroundColor: theme.color.bubbleUser,
    borderBottomRightRadius: theme.radius.sm,
  },
  coachBubble: {
    backgroundColor: theme.color.bubbleCoach,
    borderBottomLeftRadius: theme.radius.sm,
  },
  bubblePending: { opacity: 0.55 },
  bubbleFailed: { backgroundColor: theme.color.danger },
  bubbleText: {
    color: theme.color.text,
    fontSize: theme.font.body,
    lineHeight: 21,
  },
  userBubbleText: { color: '#fff' },
  failedNote: {
    color: theme.color.danger,
    fontSize: theme.font.tiny,
    marginTop: theme.space(1),
  },

  typing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(2),
    alignSelf: 'flex-start',
  },
  typingText: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
  },

  quotaBanner: {
    color: theme.color.warning,
    fontSize: theme.font.small,
    textAlign: 'center',
    paddingVertical: theme.space(2),
  },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.space(2),
    padding: theme.space(3),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.border,
  },
  composerInput: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.space(4),
    paddingTop: theme.space(3),
    paddingBottom: theme.space(3),
    color: theme.color.text,
    fontSize: theme.font.body,
    // Explicit: iOS reuses native TextInput views and does not clear
    // letterSpacing when the prop is absent, so a previously-rendered
    // spaced field (the sign-in code box) bleeds into this one.
    letterSpacing: 0,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonText: {
    color: '#fff',
    fontSize: theme.font.title,
    fontWeight: '700',
    lineHeight: 24,
  },
  pressed: { opacity: 0.5 },

  paywall: {
    padding: theme.space(5),
    gap: theme.space(3),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  paywallTitle: {
    color: theme.color.text,
    fontSize: theme.font.heading,
    fontWeight: '700',
  },
  paywallBody: {
    color: theme.color.textMuted,
    fontSize: theme.font.body,
    lineHeight: 21,
  },
  paywallButton: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space(4),
    alignItems: 'center',
  },
  paywallButtonText: {
    color: '#fff',
    fontSize: theme.font.heading,
    fontWeight: '700',
  },

  inlineError: {
    color: theme.color.danger,
    fontSize: theme.font.small,
    textAlign: 'center',
    paddingBottom: theme.space(2),
  },
});
