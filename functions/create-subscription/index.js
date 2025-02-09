const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors')({
  origin: process.env.ALLOWED_ORIGINS.split(','),
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
  credentials: true,
  maxAge: 3600
});

// This function creates a payment intent for the subscription
exports.setupStripeSubscription = (req, res) => {
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

      // Create a SetupIntent for the subscription
      const setupIntent = await stripe.setupIntents.create({
        customer: customer.id,
        payment_method_types: ['card'],
        metadata: {
          email: email // Store email for webhook processing
        }
      });

      res.json({
        customerId: customer.id,
        clientSecret: setupIntent.client_secret,
      });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}; 