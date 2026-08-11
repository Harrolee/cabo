export type CoachSubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'grace_period'
  | 'expired'
  | 'cancelled'
  | 'revoked';

export type EntitlementSource =
  | 'apple_iap'
  | 'google_play'
  | 'stripe'
  | 'promo'
  | 'free_tier'
  | 'creator_comp';

/** One row of `get_coach_roster()`. */
export interface RosterCoach {
  id: string;
  name: string;
  handle: string | null;
  tagline: string | null;
  description: string | null;
  discipline: string | null;
  category_slug: string | null;
  category_label: string | null;
  category_emoji: string | null;
  expertise: string[] | null;
  starter_prompts: string[] | null;
  intro_message: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
  subscriber_count: number;
  average_rating: number | null;
  featured_rank: number | null;
  creator_id: string | null;
  creator_name: string | null;
  creator_slug: string | null;
  creator_avatar_url: string | null;
  ios_product_id: string | null;
  price_cents: number | null;
  currency: string | null;
  period: string | null;
}

/** One row of `get_my_coaches()`. */
export interface MyCoach {
  coach_id: string;
  name: string;
  handle: string | null;
  discipline: string | null;
  tagline: string | null;
  avatar_url: string | null;
  category_slug: string | null;
  creator_name: string | null;
  conversation_id: string | null;
  last_message_at: string | null;
  message_count: number;
  status: CoachSubscriptionStatus | null;
  source: EntitlementSource | null;
  current_period_end: string | null;
  messages_used: number;
  free_message_quota: number;
  has_access: boolean;
  unread_count: number;
  last_message_preview: string | null;
  notifications_enabled: boolean;
  nudge_cadence: NudgeCadence;
}

export type NudgeCadence = 'daily' | 'few_times_week' | 'weekly' | 'off';

export type NotificationChannel = 'push' | 'sms' | 'none';

/** What the member told this coach they are working toward. */
export interface MemberGoals {
  id: string;
  coach_id: string;
  aspiration: string | null;
  goals: string[];
  current_level: string | null;
  obstacles: string[];
  motivation: string | null;
  horizon: string | null;
  commitment: { days_per_week?: number; minutes_per_session?: number };
  wins: string[];
  onboarding_status: 'not_started' | 'in_progress' | 'complete' | 'skipped';
  onboarding_turns: number;
}

export interface Visualization {
  id: string;
  coach_id: string | null;
  kind: 'becoming' | 'milestone' | 'today';
  scene: string | null;
  image_url: string | null;
  status: 'pending' | 'ready' | 'failed';
  saved: boolean;
  created_at: string;
}

/**
 * Whether the member has agreed to their own face being used, and whether we
 * are holding a photo of them. Both come from the backend — the app never
 * writes either directly, and a stored photo without consent is not a state the
 * backend will report.
 */
export interface LikenessStatus {
  consent: boolean;
  hasPhoto: boolean;
  consentAt: string | null;
  photoUpdatedAt: string | null;
  /** Short-lived signed URL, for showing the member what we hold. */
  previewUrl: string | null;
}

export interface NotificationPreferences {
  notification_channel: NotificationChannel;
  nudge_hour: number;
  quiet_hours_start: number;
  quiet_hours_end: number;
  timezone: string | null;
}

export interface CoachCategory {
  slug: string;
  label: string;
  description: string | null;
  emoji: string | null;
  sort_order: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  /** Set on optimistic rows that have not been confirmed by the server yet. */
  pending?: boolean;
  failed?: boolean;
}

/** Intake progress, returned alongside a reply while the coach is still asking. */
export interface OnboardingState {
  active: boolean;
  complete: boolean;
  turn?: number;
  maxTurns?: number;
}
