const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors')({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : true,
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
  maxAge: 3600
});
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.cancelStripeSubscription = (req, res) => {
  return cors(req, res, async () => {
    if (req.method === 'OPTIONS') {
      return res.status(204).send('');
    }
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
    }

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header', code: 'UNAUTHORIZED' });
      }
      const token = authHeader.split(' ')[1];

      const { data: { user }, error: authError } = await supabase.auth.getUser(token);

      if (authError || !user) {
        console.error('User authentication error:', authError);
        return res.status(401).json({ error: 'Unauthorized: Failed to authenticate user', code: 'AUTH_FAILED', details: authError?.message });
      }

      const userEmail = user.email;

      // Get user's phone number from user_profiles
      const { data: userProfile, error: userProfileError } = await supabase
        .from('user_profiles')
        .select('phone_number')
        .eq('email', userEmail)
        .single();

      if (userProfileError || !userProfile) {
        console.error('User profile lookup error:', userProfileError);
        return res.status(404).json({ 
          error: 'User profile not found for email: ' + userEmail,
          code: 'USER_PROFILE_NOT_FOUND'
        });
      }

      // Get subscription details using phone_number
      const { data: existingSubscription, error: dbReadError } = await supabase
        .from('subscriptions')
        .select('stripe_subscription_id, status, user_phone')
        .eq('user_phone', userProfile.phone_number)
        .order('created_at', { ascending: false })
        .limit(1)
        .single(); // Assuming one active/trial subscription per user_phone

      if (dbReadError) {
        // Handle case where no subscription is found specifically if that's the error
        if (dbReadError.code === 'PGRST116') { // PostgREST code for "Searched for one row but found 0"
             return res.status(404).json({
                error: 'No active subscription found for this user.',
                code: 'SUBSCRIPTION_NOT_FOUND'
            });
        }
        console.error('Database read error fetching subscription:', dbReadError);
        return res.status(500).json({ 
          error: 'Failed to read subscription data',
          code: 'DATABASE_ERROR'
        });
      }

      if (!existingSubscription || !existingSubscription.stripe_subscription_id) {
        return res.status(404).json({
          error: 'No Stripe subscription ID found for this user.',
          code: 'STRIPE_SUBSCRIPTION_ID_NOT_FOUND'
        });
      }

      if (existingSubscription.status === 'cancelled') {
        return res.status(200).json({
          message: 'Subscription is already cancelled.',
          code: 'ALREADY_CANCELLED',
          subscriptionId: existingSubscription.stripe_subscription_id
        });
      }

      // Cancel the subscription with Stripe
      // By default, this cancels immediately and prorates.
      // To cancel at period end: await stripe.subscriptions.update(existingSubscription.stripe_subscription_id, {cancel_at_period_end: true});
      const stripeCancellation = await stripe.subscriptions.del(existingSubscription.stripe_subscription_id);

      // Update subscription status in your database
      const { error: updateError } = await supabase
        .from('subscriptions')
        .update({ 
          status: 'cancelled',
          // current_period_end: stripeCancellation.cancel_at_period_end ? new Date(stripeCancellation.current_period_end * 1000) : new Date(), // Adjust if using cancel_at_period_end
        })
        .eq('user_phone', existingSubscription.user_phone) // Use user_phone from fetched sub for safety
        .eq('stripe_subscription_id', existingSubscription.stripe_subscription_id); // Ensure we update the correct one

      if (updateError) {
        console.error('Failed to update subscription status in DB:', updateError);
        // Critical: Stripe subscription is cancelled, but DB update failed.
        // Consider logging this for manual reconciliation.
        return res.status(500).json({
          error: 'Subscription cancelled with Stripe, but failed to update status in our records. Please contact support.',
          code: 'DB_UPDATE_FAILED_POST_STRIPE_CANCEL',
          stripeSubscriptionId: existingSubscription.stripe_subscription_id
        });
      }

      res.status(200).json({
        message: 'Subscription cancelled successfully.',
        code: 'CANCELLED_SUCCESSFULLY',
        subscriptionId: existingSubscription.stripe_subscription_id,
        stripeStatus: stripeCancellation.status
      });

    } catch (error) {
      console.error('Unexpected error during subscription cancellation:', error);
      let errorCode = 'UNKNOWN_ERROR';
      if (error.type === 'StripeCardError') errorCode = 'STRIPE_CARD_ERROR';
      else if (error.type) errorCode = error.type.toUpperCase().replace(/ /g, '_'); 
      
      res.status(error.statusCode || 500).json({ 
        error: error.message || 'An unexpected error occurred.',
        code: errorCode,
        details: error.raw ? error.raw.message : undefined
      });
    }
  });
}; 