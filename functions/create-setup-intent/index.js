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

      // Check if we already have a customer
      const { data: subscription, error: dbReadError } = await supabase
        .from('subscriptions')
        .select('stripe_customer_id, status')
        .eq('user_email', email)
        .single();

      if (dbReadError) {
        console.error('Database read error:', dbReadError);
        return res.status(500).json({ 
          error: 'Failed to read subscription data',
          code: 'DATABASE_ERROR'
        });
      }

      let customerId = subscription?.stripe_customer_id;

      // If no customer exists, create one
      if (!customerId) {
        const customer = await stripe.customers.create({ email });
        customerId = customer.id;

        const { error: dbError } = await supabase
          .from('subscriptions')
          .update({ stripe_customer_id: customerId })
          .eq('user_email', email);

        if (dbError) {
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