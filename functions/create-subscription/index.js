const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors')({
  origin: process.env.ALLOWED_ORIGINS.split(','),
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
  credentials: true,
  maxAge: 3600
});

// This function handles the initial payment setup
exports.createSubscription = (req, res) => {
  return cors(req, res, async () => {
    console.log('Request origin:', req.headers.origin);
    console.log('Allowed origins:', process.env.ALLOWED_ORIGINS);

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      const { email } = req.body;

      // Create a Customer
      const customer = await stripe.customers.create({
        email,
      });

      // Create a subscription
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: process.env.STRIPE_PRICE_ID }], // Monthly subscription price ID
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
      });

      res.json({
        subscriptionId: subscription.id,
        clientSecret: subscription.latest_invoice.payment_intent.client_secret,
      });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}; 