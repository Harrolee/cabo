const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors')({
  origin: process.env.ALLOWED_ORIGINS.split(','),
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
  maxAge: 3600
});
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.createSetupIntent = (req, res) => {
  return cors(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ 
          error: 'Missing required field: email',
          code: 'MISSING_FIELDS'
        });
      }

      // Get user's phone number
      const { data: userProfile, error: userError } = await supabase
        .from('user_profiles')
        .select('phone_number')
        .eq('email', email)
        .single();

      if (userError || !userProfile) {
        console.error('User lookup error:', userError);
        return res.status(404).json({ 
          error: 'User not found',
          code: 'NOT_FOUND'
        });
      }

      // Check if we have an existing subscription
      const { data: subscription, error: dbReadError } = await supabase
        .from('subscriptions')
        .select('stripe_customer_id, status')
        .eq('user_phone', userProfile.phone_number)
        .single();

      if (dbReadError) {
        console.error('Database read error:', dbReadError);
        return res.status(500).json({ 
          error: 'Failed to read subscription data',
          code: 'DATABASE_ERROR'
        });
      }

      if (!subscription) {
        return res.status(404).json({
          error: 'No subscription found',
          code: 'NOT_FOUND'
        });
      }

      if (subscription.status !== 'trial') {
        return res.status(400).json({
          error: 'Invalid subscription status',
          code: 'INVALID_STATUS'
        });
      }

      let customerId = subscription.stripe_customer_id;

      // If no customer exists, create one and update existing subscription
      if (!customerId) {
        const customer = await stripe.customers.create({ email });
        customerId = customer.id;

        const { error: dbError } = await supabase
          .from('subscriptions')
          .update({ stripe_customer_id: customerId })
          .eq('user_phone', userProfile.phone_number);

        if (dbError) {
          console.error('Database error:', dbError);
          throw new Error('Failed to update subscription with customer ID');
        }
      }

      // Create SetupIntent
      const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ['card'],
        usage: 'off_session',
      });

      res.json({ clientSecret: setupIntent.client_secret });

    } catch (error) {
      console.error('Unexpected error:', error);
      res.status(500).json({ 
        error: 'An unexpected error occurred',
        code: 'UNKNOWN_ERROR'
      });
    }
  });
}; 