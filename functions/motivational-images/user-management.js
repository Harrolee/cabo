/**
 * The daily image job, for members who are still on SMS.
 *
 * It used to pick a random fitness before/after pair out of a 472-line
 * scenario table and swap the word "person" for the member's
 * `image_preference`. That only ever made sense for a gym, and it would have
 * texted a drumming subscriber a picture of a squat rack.
 *
 * It now runs the same pipeline the app's visualiser runs: resolve the
 * member's coach, read what that member told the coach they want to become,
 * and render that one scene. Everything discipline-specific comes from the
 * coach row, so a drummer gets a kit and a yoga teacher gets a mat, with no
 * branch in this file.
 *
 * The hard rule this file enforces: if the coach cannot be resolved, nothing
 * is sent. There is no fitness default to fall back to.
 */

const { resolveDeps } = require('./clients');
const { generateScene } = require('./visualization');
const { renderScene } = require('./image-generation');
const { sendPaymentLinkMessage, sendVisualizationToUser } = require('./messaging');

const TRIAL_DURATION_DAYS = 3;
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o';

/**
 * @typedef {Object} UserSubscription
 * @property {string} status - The subscription status ('trial' or 'active')
 * @property {string} trial_start_timestamp - ISO timestamp when trial started
 */

/**
 * Calculates the number of days since trial start
 * @param {string} trialStartTimestamp - ISO timestamp of trial start
 * @returns {number} Number of days since trial started
 */
function getDaysSinceTrialStart(trialStartTimestamp) {
  const trialStart = new Date(trialStartTimestamp);
  return Math.floor((new Date() - trialStart) / (1000 * 60 * 60 * 24));
}

/**
 * Determines user's subscription status and required action
 * @returns {{ shouldSendImages: boolean, shouldSendPaymentLink: boolean }}
 */
function getUserStatus(user) {
  const subscription = Array.isArray(user.subscriptions)
    ? user.subscriptions[0]
    : user.subscriptions;

  if (!subscription || !subscription.status) {
    return { shouldSendImages: false, shouldSendPaymentLink: false };
  }

  const daysSinceTrialStart = getDaysSinceTrialStart(subscription.trial_start_timestamp);

  // Active trial period (days 1-3)
  if (subscription.status === 'trial' && daysSinceTrialStart < TRIAL_DURATION_DAYS) {
    return { shouldSendImages: true, shouldSendPaymentLink: false };
  }

  // Payment link day (day 4)
  if (subscription.status === 'trial' && daysSinceTrialStart === TRIAL_DURATION_DAYS) {
    return { shouldSendImages: false, shouldSendPaymentLink: true };
  }

  // Expired trial
  if (subscription.status === 'trial' && daysSinceTrialStart > TRIAL_DURATION_DAYS) {
    return { shouldSendImages: false, shouldSendPaymentLink: false };
  }

  // Active subscription
  return {
    shouldSendImages: subscription.status === 'active',
    shouldSendPaymentLink: false,
  };
}

/**
 * Find the coach row behind this member's SMS thread.
 *
 * Custom coaches are referenced directly; the five predefined personas are
 * rows in `coach_profiles` too, keyed by handle, and each carries its own
 * discipline since the domain generalisation. Returning `null` is a real
 * answer and means "do not text this person" — inventing a fitness coach here
 * is exactly the bug this job used to have.
 */
async function resolveCoach(supabase, user) {
  const columns = 'id, name, discipline, category_slug, active';

  if (user.custom_coach_id) {
    const { data, error } = await supabase
      .from('coach_profiles')
      .select(columns)
      .eq('id', user.custom_coach_id)
      .eq('active', true)
      .maybeSingle();

    if (error) console.error('Coach lookup failed for %s: %s', user.custom_coach_id, error.message);
    return data || null;
  }

  if (user.coach) {
    const { data, error } = await supabase
      .from('coach_profiles')
      .select(columns)
      .eq('handle', user.coach)
      .eq('active', true)
      .maybeSingle();

    if (error) console.error('Coach lookup failed for handle %s: %s', user.coach, error.message);
    return data || null;
  }

  return null;
}

/**
 * What the coach knows about this member.
 *
 * Legacy SMS rows predate `auth.users`, so there may be no `user_id` to look
 * goals up by. That is fine: with no aspiration on file the scene brief falls
 * back to the discipline itself, which is still the member's discipline.
 */
async function loadMemberContext(supabase, user, coachId) {
  let member = {};

  if (user.user_id) {
    const { data, error } = await supabase.rpc('get_member_context', {
      p_user_id: user.user_id,
      p_coach_id: coachId,
    });
    if (error) console.error('get_member_context failed for %s: %s', user.user_id, error.message);
    member = data || {};
  }

  // `member_goals.visual` is the app's answer to "how should we picture you".
  // `image_preference` is the SMS answer to the same question, and it is the
  // only part of the old prompt substitution worth keeping.
  const visual = { ...(member.visual || {}) };
  if (!visual.self && user.image_preference) visual.self = user.image_preference;

  return { ...member, visual };
}

/**
 * With an aspiration on file, show them that. Without one, show them an
 * ordinary moment from the practice rather than guessing at who they want to
 * become.
 */
function pickKind(member) {
  return member.aspiration ? 'becoming' : 'today';
}

/** Best-effort history row, so an SMS member's images show up like an app member's. */
async function recordVisualization(supabase, { user, coach, kind, scene, imageUrl, modelId }) {
  if (!user.user_id) return;

  const { error } = await supabase.from('coach_visualizations').insert({
    user_id: user.user_id,
    coach_id: coach.id,
    kind,
    scene: scene.scene,
    image_prompt: scene.image_prompt,
    image_url: imageUrl,
    model: modelId,
    status: 'ready',
  });

  if (error) console.error('Could not record visualization for %s: %s', user.user_id, error.message);
}

/**
 * Processes a single user - generates and sends the day's image.
 * @param {Object} user - user profile row from fetchActiveUsers
 * @param {Object} [injected] - service clients; production uses the real ones
 * @returns {Promise<{sent?: string, skipped?: string}>}
 */
async function processUser(user, injected) {
  const deps = resolveDeps(injected);

  try {
    const { shouldSendImages, shouldSendPaymentLink } = getUserStatus(user);

    if (shouldSendPaymentLink) {
      await sendPaymentLinkMessage({
        twilio: deps.twilio,
        phoneNumber: user.phone_number,
        email: user.email,
      });
      return { sent: 'payment_link' };
    }

    if (!shouldSendImages) return { skipped: 'not_entitled' };

    const coach = await resolveCoach(deps.supabase, user);
    if (!coach) {
      console.warn('No coach resolved for %s — sending nothing', user.phone_number);
      return { skipped: 'no_coach' };
    }

    const member = await loadMemberContext(deps.supabase, user, coach.id);
    const kind = pickKind(member);

    const scene = await generateScene({
      openai: deps.openai,
      model: CHAT_MODEL,
      coach,
      member,
      kind,
    });

    const { imageUrl, modelId } = await renderScene({
      replicate: deps.replicate,
      storage: deps.storage,
      imagePrompt: scene.image_prompt,
      phoneNumber: user.phone_number,
      referencePhotoUrl: user.reference_photo_url,
      likenessConsent: user.likeness_consent === true,
    });

    await sendVisualizationToUser({
      twilio: deps.twilio,
      storage: deps.storage,
      phoneNumber: user.phone_number,
      imageUrl,
      caption: scene.caption,
    });

    await recordVisualization(deps.supabase, { user, coach, kind, scene, imageUrl, modelId });

    console.log('Sent a %s scene to %s (%s)', kind, user.phone_number, coach.discipline);
    return { sent: 'visualization', kind, coachId: coach.id };
  } catch (error) {
    console.error(`Error processing user ${user.phone_number}:`, error);
    // Continue with other users even if one fails
    return { skipped: 'error', error: error.message };
  }
}

/**
 * Fetches all active users with their subscription status
 *
 * Only users still on the SMS channel. App users are reached by the
 * coach-nudges dispatcher instead, which pushes a notification and writes the
 * message into their in-app thread — texting them as well would double up.
 */
async function fetchActiveUsers(injected) {
  const { supabase } = resolveDeps(injected);

  const { data: users, error } = await supabase
    .from('user_profiles')
    .select(`
      user_id,
      phone_number,
      full_name,
      display_name,
      spice_level,
      coach,
      coach_type,
      custom_coach_id,
      image_preference,
      reference_photo_url,
      likeness_consent,
      email,
      notification_channel,
      subscription:subscriptions!user_phone(
        status,
        trial_start_timestamp
      )
    `)
    .eq('active', true)
    .eq('notification_channel', 'sms')
    .not('phone_number', 'is', null);

  if (error) {
    console.error('Error fetching users:', error);
    throw new Error(`Error fetching users: ${error.message}`);
  }

  if (!users || users.length === 0) {
    console.log('No active users found');
    return [];
  }

  // Transform the data to match our expected structure
  return users.map((user) => ({
    ...user,
    subscriptions: user.subscription ? [user.subscription] : [],
  }));
}

module.exports = {
  processUser,
  fetchActiveUsers,
  getUserStatus,
  getDaysSinceTrialStart,
  resolveCoach,
  loadMemberContext,
  pickKind,
};
