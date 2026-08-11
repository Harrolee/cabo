const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  // Signature verification is a 400 (Stripe should not retry — secret is wrong).
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook signature error: ${err.message}`);
  }

  // Handler errors are a 500 so Stripe retries with backoff.
  try {
    switch (event.type) {
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
      default:
        console.log('Unhandled Stripe event type:', event.type);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook handler error:', {
      eventType: event.type,
      eventId: event.id,
      message: err.message,
      stack: err.stack,
    });
    res.status(500).send(`Webhook handler error: ${err.message}`);
  }
};

async function handleSubscriptionCreated(subscription) {
  const customer = await stripe.customers.retrieve(subscription.customer);
  
  // Get user's phone number from their profile
  const { data: userProfile, error: userError } = await supabase
    .from('user_profiles')
    .select('phone_number')
    .eq('email', customer.email)
    .single();

  if (userError || !userProfile) {
    console.error('Error finding user profile:', userError);
    throw new Error('User profile not found');
  }
  
  // Store subscription info in Supabase
  await supabase.from('subscriptions').insert({
    user_phone: userProfile.phone_number,
    stripe_customer_id: customer.id,
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    current_period_end: new Date(subscription.current_period_end * 1000),
  });
}

async function handleSubscriptionUpdated(subscription) {
  // Update subscription status in database
  await supabase
    .from('subscriptions')
    .update({
      status: subscription.status,
      current_period_end: new Date(subscription.current_period_end * 1000),
    })
    .eq('stripe_subscription_id', subscription.id);
}

async function handleSubscriptionDeleted(subscription) {
  // Mark subscription as cancelled in database
  await supabase
    .from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('stripe_subscription_id', subscription.id);
}

async function handlePaymentSucceeded(invoice) {
  // Update payment status in database
  await supabase
    .from('subscriptions')
    .update({ 
      last_payment_status: 'succeeded',
      last_payment_date: new Date(),
    })
    .eq('stripe_customer_id', invoice.customer);
}

async function handlePaymentFailed(invoice) {
  // Update payment status and notify user
  await supabase
    .from('subscriptions')
    .update({ 
      last_payment_status: 'failed',
      last_payment_date: new Date(),
    })
    .eq('stripe_customer_id', invoice.customer);
} 