/**
 * A single dark palette. The roster is image-forward — coach avatars and cover
 * art carry the colour — so the chrome stays out of the way.
 */
export const theme = {
  color: {
    bg: '#0B0B0F',
    surface: '#15151C',
    surfaceRaised: '#1E1E28',
    border: '#2A2A36',
    text: '#F4F4F6',
    textMuted: '#9A9AA8',
    textFaint: '#6A6A78',
    accent: '#7C5CFF',
    accentSoft: '#2A2145',
    positive: '#3FBF7F',
    warning: '#E8A33D',
    danger: '#E5484D',
    bubbleUser: '#7C5CFF',
    bubbleCoach: '#1E1E28',
  },
  space: (n: number) => n * 4,
  radius: {
    sm: 8,
    md: 14,
    lg: 20,
    pill: 999,
  },
  font: {
    display: 30,
    title: 22,
    heading: 17,
    body: 15,
    small: 13,
    tiny: 11,
  },
} as const;

/** Deterministic accent per coach so the roster does not read as one grey wall. */
const CATEGORY_TINTS: Record<string, string> = {
  fitness: '#FF6B4A',
  movement: '#4AC6FF',
  music: '#B36BFF',
  creative: '#FFB43D',
  wellness: '#3FBF7F',
  nutrition: '#8FD44A',
  business: '#5C7CFF',
  academic: '#FF7FA8',
  lifestyle: '#FFD24A',
  other: '#9A9AA8',
};

export function tintForCategory(slug?: string | null): string {
  if (!slug) return CATEGORY_TINTS.other;
  return CATEGORY_TINTS[slug] ?? CATEGORY_TINTS.other;
}

export function formatPrice(cents?: number | null, currency = 'USD'): string | null {
  if (cents == null) return null;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}
