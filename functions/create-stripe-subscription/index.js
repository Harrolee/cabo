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

exports.createStripeSubscription = (req, res) => {
  return cors(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      const { email, paymentMethodId } = req.body;

      if (!email || !paymentMethodId) {
        return res.status(400).json({ 
          error: 'Missing required fields: email and paymentMethodId are required',
          code: 'MISSING_FIELDS'
        });
      }

      // First check if we already have a customer
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

      // Verify subscription status
      if (subscription.status !== 'trial') {
        return res.status(400).json({
          error: 'Invalid subscription status',
          code: 'INVALID_STATUS'
        });
      }

      let customerId = subscription?.stripe_customer_id;

      try {
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

        // Attach the payment method to the customer
        try {
          await stripe.paymentMethods.attach(paymentMethodId, {
            customer: customerId,
          });
        } catch (attachError) {
          console.error('Payment method attachment error:', attachError);
          return res.status(400).json({
            error: 'Invalid payment method or already attached',
            code: 'PAYMENT_METHOD_ERROR'
          });
        }

        // Set it as the default payment method
        await stripe.customers.update(customerId, {
          invoice_settings: {
            default_payment_method: paymentMethodId,
          },
        });

        // Create the subscription
        const stripeSubscription = await stripe.subscriptions.create({
          customer: customerId,
          items: [{ price: process.env.STRIPE_PRICE_ID }],
          default_payment_method: paymentMethodId,
          expand: ['latest_invoice'],
        });

        // Update subscription status in database
        const { error: updateError } = await supabase
          .from('subscriptions')
          .update({ 
            status: 'active',
            stripe_subscription_id: stripeSubscription.id
          })
          .eq('user_email', email);

        if (updateError) {
          // Log error but don't fail the request since Stripe subscription was created
          console.error('Failed to update subscription status:', updateError);
        }

        res.json({
          subscriptionId: stripeSubscription.id,
          status: stripeSubscription.status,
          currentPeriodEnd: stripeSubscription.current_period_end,
        });

      } catch (stripeError) {
        console.error('Stripe API error:', stripeError);
        res.status(400).json({
          error: stripeError.message,
          code: 'STRIPE_ERROR'
        });
      }

    } catch (error) {
      console.error('Unexpected error:', error);
      res.status(500).json({ 
        error: 'An unexpected error occurred',
        code: 'UNKNOWN_ERROR'
      });
    }
  });
}; 