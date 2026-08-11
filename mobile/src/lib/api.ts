import { API_URL, getAccessToken, supabase } from './supabase';
import type {
  ChatMessage,
  CoachCategory,
  LikenessStatus,
  MemberGoals,
  MyCoach,
  NotificationPreferences,
  NudgeCadence,
  OnboardingState,
  RosterCoach,
  Visualization,
} from './types';

/**
 * Thrown when the backend says the caller has run out of free messages and
 * needs to subscribe. The chat screen turns this into a paywall rather than an
 * error toast.
 */
export class SubscriptionRequiredError extends Error {
  coachId: string;
  constructor(coachId: string, message: string) {
    super(message);
    this.name = 'SubscriptionRequiredError';
    this.coachId = coachId;
  }
}

async function callFunction<T>(path: string, body: unknown): Promise<T> {
  if (!API_URL) throw new Error('EXPO_PUBLIC_API_URL is not configured');

  const token = await getAccessToken();
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 402) {
      throw new SubscriptionRequiredError(
        payload.coachId ?? '',
        payload.message ?? 'Subscribe to keep chatting.'
      );
    }

    /*
      4xx bodies carry a message written for the member. 5xx bodies must not be
      rendered even if the server sends detail — a stack or a cloud-provider
      JSON blob in an alert is worse than saying nothing useful.
    */
    if (response.status >= 500) {
      console.warn(`${path} failed (${response.status}):`, payload);
      throw new Error('Something went wrong on our end. Please try again.');
    }

    throw new Error(payload.message || payload.error || `Request failed (${response.status})`);
  }

  return payload as T;
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export async function fetchCategories(): Promise<CoachCategory[]> {
  const { data, error } = await supabase
    .from('coach_categories')
    .select('slug, label, description, emoji, sort_order')
    .eq('active', true)
    .order('sort_order');

  if (error) throw error;
  return (data ?? []) as CoachCategory[];
}

export async function fetchRoster(options: {
  category?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}): Promise<RosterCoach[]> {
  const { data, error } = await supabase.rpc('get_coach_roster', {
    p_category: options.category ?? null,
    p_search: options.search?.trim() ? options.search.trim() : null,
    p_limit: options.limit ?? 40,
    p_offset: options.offset ?? 0,
  });

  if (error) throw error;
  return (data ?? []) as RosterCoach[];
}

/**
 * Detail view for one coach. Read straight off the tables (RLS already limits
 * this to listed coaches) so the roster's LIMIT does not hide a deep link.
 */
export async function fetchCoach(coachId: string): Promise<RosterCoach | null> {
  const { data, error } = await supabase
    .from('coach_profiles')
    .select(
      `id, name, handle, tagline, description, discipline, category_slug,
       expertise, starter_prompts, intro_message, avatar_url, cover_image_url,
       subscriber_count, average_rating, featured_rank, creator_id,
       coach_categories ( label, emoji ),
       creator_profiles ( display_name, slug, avatar_url ),
       coach_iap_products ( product_id, price_cents, currency, period, platform, active )`
    )
    .eq('id', coachId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as Record<string, any>;
  const category = row.coach_categories ?? {};
  const creator = row.creator_profiles ?? {};
  const product = (row.coach_iap_products ?? []).find(
    (p: any) => p.platform === 'ios' && p.active
  );

  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    tagline: row.tagline,
    description: row.description,
    discipline: row.discipline,
    category_slug: row.category_slug,
    category_label: category.label ?? null,
    category_emoji: category.emoji ?? null,
    expertise: row.expertise,
    starter_prompts: row.starter_prompts,
    intro_message: row.intro_message,
    avatar_url: row.avatar_url,
    cover_image_url: row.cover_image_url,
    subscriber_count: row.subscriber_count ?? 0,
    average_rating: row.average_rating,
    featured_rank: row.featured_rank,
    creator_id: row.creator_id,
    creator_name: creator.display_name ?? null,
    creator_slug: creator.slug ?? null,
    creator_avatar_url: creator.avatar_url ?? null,
    ios_product_id: product?.product_id ?? null,
    price_cents: product?.price_cents ?? null,
    currency: product?.currency ?? null,
    period: product?.period ?? null,
  };
}

// ---------------------------------------------------------------------------
// My coaches
// ---------------------------------------------------------------------------

export async function fetchMyCoaches(): Promise<MyCoach[]> {
  const { data, error } = await supabase.rpc('get_my_coaches');
  if (error) throw error;
  return (data ?? []) as MyCoach[];
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

/** Idempotently opens the thread and starts the free tier on first contact. */
export async function openConversation(coachId: string): Promise<string> {
  const { data, error } = await supabase.rpc('open_coach_conversation', {
    p_coach_id: coachId,
  });
  if (error) throw error;
  return data as string;
}

export async function fetchMessages(conversationId: string, limit = 100): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('conversation_messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as ChatMessage[];
}

export interface CoachReply {
  response: string;
  metadata: {
    coachName: string;
    discipline: string | null;
    freeMessagesRemaining: number | null;
    latencyMs: number;
    promptVersion: string;
    onboarding: OnboardingState | null;
  };
}

/**
 * Ask the coach. The function persists both turns, so the client does not
 * write the message itself — it refetches (or appends) after the reply lands.
 */
export async function sendMessage(params: {
  coachId: string;
  conversationId: string;
  message: string;
}): Promise<CoachReply> {
  return callFunction<CoachReply>('/coach-response-generator', {
    coachId: params.coachId,
    conversationId: params.conversationId,
    userMessage: params.message,
    presentation: 'chat',
  });
}

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

export async function verifyPurchase(params: {
  jws: string;
}): Promise<{ entitlement: { coachId: string; status: string } }> {
  return callFunction('/iap-validator/verify', {
    platform: 'ios',
    jws: params.jws,
  });
}

export async function restorePurchases(transactions: string[]) {
  return callFunction<{ restored: Array<{ coachId?: string; status?: string; error?: string }> }>(
    '/iap-validator/restore',
    { platform: 'ios', transactions }
  );
}


// ---------------------------------------------------------------------------
// Read state
// ---------------------------------------------------------------------------

export async function markConversationRead(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_conversation_read', {
    p_conversation_id: conversationId,
  });
  if (error) console.warn('Could not mark conversation read:', error.message);
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

/** Creates the row if it does not exist, so the intake can start. */
export async function beginGoalOnboarding(coachId: string): Promise<string> {
  const { data, error } = await supabase.rpc('begin_goal_onboarding', { p_coach_id: coachId });
  if (error) throw error;
  return data as string;
}

export async function fetchGoals(coachId: string): Promise<MemberGoals | null> {
  const { data, error } = await supabase
    .from('member_goals')
    .select(
      'id, coach_id, aspiration, goals, current_level, obstacles, motivation, horizon, commitment, wins, onboarding_status, onboarding_turns'
    )
    .eq('coach_id', coachId)
    .maybeSingle();

  if (error) throw error;
  return (data as MemberGoals) ?? null;
}

/** Members can correct anything the intake got wrong. */
export async function updateGoals(
  coachId: string,
  patch: Partial<Pick<MemberGoals, 'aspiration' | 'goals' | 'current_level' | 'obstacles' | 'motivation' | 'horizon'>>
): Promise<void> {
  const { error } = await supabase.from('member_goals').update(patch).eq('coach_id', coachId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Visualisation
// ---------------------------------------------------------------------------

export class NoAspirationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoAspirationError';
  }
}

export async function generateVisualization(params: {
  coachId: string;
  kind?: 'becoming' | 'milestone' | 'today';
}): Promise<{ visualization: Visualization; caption: string }> {
  try {
    return await callFunction('/coach-visualizer/generate', {
      coachId: params.coachId,
      kind: params.kind ?? 'becoming',
    });
  } catch (error) {
    // The backend refuses to invent a goal on the member's behalf; surface
    // that as a nudge back into the conversation rather than an error.
    if ((error as Error).message?.includes('no_aspiration')) {
      throw new NoAspirationError((error as Error).message);
    }
    throw error;
  }
}

export async function fetchVisualizations(coachId?: string): Promise<Visualization[]> {
  const { visualizations } = await callFunction<{ visualizations: Visualization[] }>(
    '/coach-visualizer/history',
    coachId ? { coachId } : {}
  );
  return visualizations;
}

export async function setVisualizationSaved(id: string, saved: boolean): Promise<void> {
  const { error } = await supabase.from('coach_visualizations').update({ saved }).eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Likeness: the member's reference photo
// ---------------------------------------------------------------------------

/*
  These three go through the Cloud Function rather than PostgREST on purpose.
  The columns behind them are trigger-protected against direct writes, because
  consent to store a face has to come with the file being stored, and
  withdrawing it has to come with the file being deleted. Splitting those apart
  is exactly the failure mode to avoid.
*/

export async function fetchLikeness(): Promise<LikenessStatus> {
  const { likeness } = await callFunction<{ likeness: LikenessStatus }>('/coach-visualizer/likeness', {});
  return likeness;
}

/** Uploads the photo and records consent in the same call. */
export async function grantLikeness(photoBase64: string): Promise<LikenessStatus> {
  const { likeness } = await callFunction<{ likeness: LikenessStatus }>(
    '/coach-visualizer/likeness/grant',
    { consent: true, photoBase64 }
  );
  return likeness;
}

/**
 * Withdraws consent and deletes the stored photo.
 *
 * `photoDeleted` is false in the rare case where consent was withdrawn but the
 * file survived the attempt; the screen says so rather than claiming an
 * erasure that has not happened yet.
 */
export async function revokeLikeness(): Promise<{
  likeness: LikenessStatus;
  photoDeleted: boolean;
  message?: string;
}> {
  return callFunction('/coach-visualizer/likeness/revoke', {});
}

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

export async function fetchNotificationPreferences(): Promise<NotificationPreferences | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data, error } = await supabase
    .from('user_profiles')
    .select('notification_channel, nudge_hour, quiet_hours_start, quiet_hours_end, timezone')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (error) throw error;
  return (data as NotificationPreferences) ?? null;
}

export async function updateNotificationPreferences(
  patch: Partial<NotificationPreferences>
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;

  const { error } = await supabase.from('user_profiles').update(patch).eq('user_id', auth.user.id);
  if (error) throw error;
}

/** Per-coach mute and cadence. Billing columns on the same row are trigger-protected. */
export async function updateCoachNotifications(
  coachId: string,
  patch: { notifications_enabled?: boolean; nudge_cadence?: NudgeCadence }
): Promise<void> {
  const { error } = await supabase
    .from('coach_subscriptions')
    .update(patch)
    .eq('coach_id', coachId);
  if (error) throw error;
}

/** Fires a real notification to this account's devices, to prove the wiring. */
export async function sendTestNotification(coachId: string) {
  return callFunction<{ success: boolean; ok: number }>('/coach-nudges/preview', { coachId });
}
