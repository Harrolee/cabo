const { createClient } = require("@supabase/supabase-js");
const { generateActionModifier, generateImagePrompts } = require('./prompt-generation');
const { generateMotivationalImages, selectRandomImageStyle, checkForUserPhoto } = require('./image-generation');
const { sendPaymentLinkMessage, sendImagesToUser } = require('./messaging');

const supabaseClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TRIAL_DURATION_DAYS = 3;
const DEFAULT_SPICE_LEVEL = 2;

/**
 * @typedef {Object} UserSubscription
 * @property {string} status - The subscription status ('trial' or 'active')
 * @property {string} trial_start_timestamp - ISO timestamp when trial started
 */

/**
 * @typedef {Object} UserProfile
 * @property {string} phone_number - User's phone number
 * @property {string} email - User's email
 * @property {string} full_name - User's full name
 * @property {number} spice_level - Message spice level (1-5)
 * @property {string} image_preference - User's image preference
 * @property {UserSubscription[]} subscriptions - User's subscription data
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
 * @param {UserProfile} user - User profile data
 * @returns {{ shouldSendImages: boolean, shouldSendPaymentLink: boolean }}
 */
function getUserStatus(user) {

  // TODO: remove this after the beta ends
  return { 
    shouldSendImages: true, 
    shouldSendPaymentLink: false 
  };

  const subscription = Array.isArray(user.subscriptions) 
    ? user.subscriptions[0] 
    : user.subscriptions;

  if (!subscription || !subscription.status) {
    return { shouldSendImages: false, shouldSendPaymentLink: false };
  }

  const daysSinceTrialStart = getDaysSinceTrialStart(subscription.trial_start_timestamp);

  // Active trial period (days 1-3)
  if (subscription.status === 'trial' && daysSinceTrialStart < TRIAL_DURATION_DAYS) {
    console.log(`User ${user.phone_number} is in active trial period`);
    return { shouldSendImages: true, shouldSendPaymentLink: false };
  }

  // Payment link day (day 4)
  if (subscription.status === 'trial' && daysSinceTrialStart === TRIAL_DURATION_DAYS) {
    console.log(`User ${user.phone_number} is on payment link day`);
    return { shouldSendImages: false, shouldSendPaymentLink: true };
  }

  // Expired trial
  if (subscription.status === 'trial' && daysSinceTrialStart > TRIAL_DURATION_DAYS) {
    console.log(`User ${user.phone_number} has expired trial`);
    return { shouldSendImages: false, shouldSendPaymentLink: false };
  }

  // Active subscription
  console.log(`User ${user.phone_number} has status: ${subscription.status}`);
  return { 
    shouldSendImages: subscription.status === 'active', 
    shouldSendPaymentLink: false 
  };
}

/**
 * Processes a single user - generates and sends appropriate content
 * @param {UserProfile} user - User profile data
 * @returns {Promise<void>}
 */
async function processUser(user) {
  try {
    const { shouldSendImages, shouldSendPaymentLink } = getUserStatus(user);

    if (shouldSendPaymentLink) {
      await sendPaymentLinkMessage(user.phone_number, user.email);
      return;
    }

    if (shouldSendImages) {
      // Check if user has a photo first to determine which model we'll use
      const hasUserPhoto = await checkForUserPhoto(user.phone_number) !== null;
      
      // Get image prompts and generate images
      const actionModifier = await generateActionModifier();
      const { beforePrompt, afterPrompt } = await generateImagePrompts(
        user.image_preference,
        actionModifier,
        hasUserPhoto // Pass whether we'll use an image input model
      );

      // Select image style
      const imageStyle = selectRandomImageStyle();
      console.log(`Using style: ${imageStyle.description} for images`);

      const images = await generateMotivationalImages(
        user.phone_number,
        beforePrompt,
        afterPrompt,
        imageStyle
      );
      
      if (!images || images.length === 0) {
        throw new Error(`No images were generated for user ${user.phone_number}`);
      }

      // Create image context for message generation
      const imageContext = {
        beforePrompt,
        afterPrompt,
        imageStyle: imageStyle.description,
        actionModifier
      };

      await sendImagesToUser(
        user.phone_number,
        images,
        user.coach,
        user.spice_level || DEFAULT_SPICE_LEVEL,
        imageContext
      );

      console.log(`Successfully sent images to ${user.phone_number}`);
    }
  } catch (error) {
    console.error(`Error processing user ${user.phone_number}:`, error);
    // Continue with other users even if one fails
  }
}

/**
 * Fetches all active users with their subscription status
 * @returns {Promise<UserProfile[]>} Array of user profiles
 */
async function fetchActiveUsers() {
  const { data: users, error } = await supabaseClient
    .from("user_profiles")
    .select(`
      phone_number, 
      full_name, 
      spice_level,
      coach,
      image_preference,
      email,
      subscription:subscriptions!user_phone(
        status,
        trial_start_timestamp
      )
    `)
    .eq("active", true);
  
  if (error) {
    console.error('Error fetching users:', error);
    throw new Error(`Error fetching users: ${error.message}`);
  }

  if (!users || users.length === 0) {
    console.log('No active users found');
    return [];
  }

  // Transform the data to match our expected structure
  return users.map(user => ({
    ...user,
    subscriptions: user.subscription ? [user.subscription] : []
  }));
}

module.exports = {
  processUser,
  fetchActiveUsers,
  getUserStatus,
  getDaysSinceTrialStart
}; 