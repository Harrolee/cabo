import { supabase } from '../main';

// Mirrors the creator_slug_format CHECK on creator_profiles. Kept here so the
// form can reject a bad handle before Postgres has to.
export const CREATOR_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const CREATOR_SLUG_RULE =
  '3–40 characters: lowercase letters, numbers and hyphens, starting and ending with a letter or number.';

// Everything else on creator_profiles — status, revenue_share_bps, the payout
// columns — is platform-owned. A creator never sends them; the database
// discards them if they try.
export const CREATOR_EDITABLE_FIELDS = [
  'display_name',
  'slug',
  'bio',
  'avatar_url',
  'website_url',
  'social_links',
];

export const CREATOR_SOCIAL_PLATFORMS = [
  { key: 'instagram', label: 'Instagram', placeholder: '@handle or profile URL' },
  { key: 'youtube', label: 'YouTube', placeholder: 'Channel URL' },
  { key: 'tiktok', label: 'TikTok', placeholder: '@handle or profile URL' },
  { key: 'x', label: 'X / Twitter', placeholder: '@handle or profile URL' },
  { key: 'spotify', label: 'Spotify', placeholder: 'Artist URL' },
];

export const CREATOR_PENDING_MESSAGE =
  'Your creator account is still under review. You can keep building and previewing — we will publish this coach to the roster as soon as you are approved.';

export const CREATOR_SUSPENDED_MESSAGE =
  'Your creator account is suspended, so coaches cannot be published. Get in touch and we will take another look.';

/** Turn a display name into a plausible starting handle. */
export function slugifyCreatorName(value) {
  return (value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

/** Returns a human-readable problem with the handle, or null when it is fine. */
export function validateCreatorSlug(slug) {
  const value = (slug || '').trim();
  if (!value) return 'Pick a handle — it becomes your public creator URL.';
  if (value !== value.toLowerCase()) return `Handles are lowercase. Try "${value.toLowerCase()}".`;
  if (value.length < 3) return 'Handles need at least 3 characters.';
  if (value.length > 40) return 'Handles can be at most 40 characters.';
  if (/[^a-z0-9-]/.test(value)) return `Handles can only contain lowercase letters, numbers and hyphens — ${CREATOR_SLUG_RULE}`;
  if (!CREATOR_SLUG_PATTERN.test(value)) return `Handles must start and end with a letter or number — ${CREATOR_SLUG_RULE}`;
  return null;
}

export function validateCreatorForm(form) {
  const errors = {};
  if (!form.display_name || !form.display_name.trim()) {
    errors.display_name = 'Tell people what to call you.';
  }
  const slugError = validateCreatorSlug(form.slug);
  if (slugError) errors.slug = slugError;
  for (const field of ['avatar_url', 'website_url']) {
    const value = (form[field] || '').trim();
    if (value && !/^https?:\/\/\S+$/i.test(value)) {
      errors[field] = 'Use a full URL starting with http:// or https://';
    }
  }
  return errors;
}

/** Only ever sends the columns a creator owns. */
export function creatorSubmission(form) {
  const payload = {};
  for (const field of CREATOR_EDITABLE_FIELDS) {
    const value = form[field];
    if (field === 'social_links') {
      const links = {};
      for (const [key, link] of Object.entries(value || {})) {
        if (link && String(link).trim()) links[key] = String(link).trim();
      }
      payload.social_links = links;
    } else {
      const trimmed = typeof value === 'string' ? value.trim() : value;
      payload[field] = trimmed || null;
    }
  }
  payload.display_name = (form.display_name || '').trim();
  payload.slug = (form.slug || '').trim().toLowerCase();
  return payload;
}

/** The signed-in user's creator profile, or null if they have not made one. */
export async function fetchMyCreatorProfile() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return null;

  const { data, error } = await supabase
    .from('creator_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.warn('Failed to load creator profile:', error);
    return null;
  }
  return data || null;
}

export async function isCreatorSlugAvailable(slug) {
  const { data, error } = await supabase.rpc('creator_slug_available', { p_slug: slug });
  if (error) {
    // Availability is a courtesy check; the unique constraint is the real one.
    console.warn('Handle availability check failed:', error);
    return true;
  }
  return data !== false;
}

export async function createCreatorProfile(form) {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error('You must be signed in to become a creator.');

  const payload = {
    ...creatorSubmission(form),
    user_id: user.id,
    user_email: user.email,
  };

  const { data, error } = await supabase
    .from('creator_profiles')
    .insert(payload)
    .select()
    .single();

  if (error) throw new Error(describeCreatorError(error, payload.slug));
  return data;
}

export async function updateCreatorProfile(creatorId, form) {
  const payload = creatorSubmission(form);
  const { data, error } = await supabase
    .from('creator_profiles')
    .update(payload)
    .eq('id', creatorId)
    .select()
    .single();

  if (error) throw new Error(describeCreatorError(error, payload.slug));
  return data;
}

/** Postgres errors, said out loud. */
export function describeCreatorError(error, slug) {
  const code = error?.code;
  const message = error?.message || '';

  if (code === '23505' || /duplicate key/i.test(message)) {
    if (/creator_profiles_user_id_key/.test(message)) {
      return 'You already have a creator profile on this account.';
    }
    return slug
      ? `The handle "${slug}" is already taken. Try another.`
      : 'That handle is already taken. Try another.';
  }
  if (code === '23514' || /violates check constraint/i.test(message)) {
    if (/creator_slug_format/.test(message)) {
      return `That handle is not valid — ${CREATOR_SLUG_RULE}`;
    }
    return 'Some of those details are not valid. Check the highlighted fields and try again.';
  }
  if (code === '42501' || /row-level security|insufficient/i.test(message)) {
    return 'You are not allowed to change that. Sign in again and retry.';
  }
  return message || 'Something went wrong. Please try again.';
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

export const LISTING_LABELS = {
  draft: 'Draft',
  in_review: 'In review',
  listed: 'Listed',
  unlisted: 'Unlisted',
  rejected: 'Rejected',
};

export function listingBadgeClass(status) {
  switch (status) {
    case 'listed': return 'bg-green-100 text-green-800';
    case 'in_review': return 'bg-yellow-100 text-yellow-800';
    case 'unlisted': return 'bg-orange-100 text-orange-800';
    case 'rejected': return 'bg-red-100 text-red-800';
    default: return 'bg-gray-100 text-gray-700';
  }
}

/**
 * enforce_coach_listing_rules() raises insufficient_privilege, and the RLS
 * WITH CHECK on coach_profiles fails with the same SQLSTATE. Either way the
 * cause is the same and the creator should hear it in their own terms.
 */
export function describeListingError(error) {
  const code = error?.code;
  const message = error?.message || '';
  if (code === '42501' || /insufficient|row-level security|no approved creator/i.test(message)) {
    return CREATOR_PENDING_MESSAGE;
  }
  return message || 'Could not update this coach. Please try again.';
}

/**
 * Walks a coach along draft → in_review → listed.
 *
 * Submitting for review is always allowed; reaching the roster is not. A
 * pending creator lands on in_review and is told why, rather than being handed
 * a Postgres error.
 *
 * Returns { listing_status, listed, message }.
 */
export async function publishCoach(coach, creator) {
  if (!creator) {
    const err = new Error('Create your creator profile before publishing a coach.');
    err.needsCreatorProfile = true;
    throw err;
  }

  // Coaches built before the creator profile existed have no creator_id.
  if (coach.creator_id !== creator.id) {
    const { error } = await supabase
      .from('coach_profiles')
      .update({ creator_id: creator.id })
      .eq('id', coach.id);
    if (error) throw new Error(describeListingError(error));
  }

  if (coach.listing_status !== 'in_review' && coach.listing_status !== 'listed') {
    const { error } = await supabase
      .from('coach_profiles')
      .update({ listing_status: 'in_review' })
      .eq('id', coach.id);
    if (error) throw new Error(describeListingError(error));
  }

  if (creator.status !== 'approved') {
    return {
      listing_status: 'in_review',
      listed: false,
      message: creator.status === 'suspended' ? CREATOR_SUSPENDED_MESSAGE : CREATOR_PENDING_MESSAGE,
    };
  }

  const { error } = await supabase
    .from('coach_profiles')
    .update({ listing_status: 'listed', public: true, active: true })
    .eq('id', coach.id);

  if (error) {
    // The creator row said approved but the database disagreed — trust the
    // database and leave the coach queued.
    return {
      listing_status: 'in_review',
      listed: false,
      message: describeListingError(error),
    };
  }

  return {
    listing_status: 'listed',
    listed: true,
    message: `${coach.name} is live on the roster.`,
  };
}

export async function unlistCoach(coach) {
  const { error } = await supabase
    .from('coach_profiles')
    .update({ listing_status: 'unlisted', public: false })
    .eq('id', coach.id);
  if (error) throw new Error(describeListingError(error));
  return { listing_status: 'unlisted', listed: false, message: `${coach.name} has been taken off the roster.` };
}
