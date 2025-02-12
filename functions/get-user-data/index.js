const cors = require('cors')({
  origin: process.env.ALLOWED_ORIGINS.split(','),
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 3600
});
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client with service role key to bypass RLS
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

exports.getUserData = (req, res) => {
  // Log incoming request details
  console.log('Incoming request:', {
    method: req.method,
    headers: req.headers,
    origin: req.headers.origin,
    allowedOrigins: process.env.ALLOWED_ORIGINS.split(',')
  });

  return cors(req, res, async () => {
    // Log that we passed CORS middleware
    console.log('Passed CORS middleware');

    if (req.method === 'OPTIONS') {
      console.log('Handling OPTIONS request');
      return res.status(204).send();
    }

    try {
      const { email } = req.body;

      if (!email) {
        res.status(400).json({ error: 'Email is required' });
        return;
      }

      // Get user profile with service role (bypassing RLS)
      const { data: userData, error: userError } = await supabase
        .from('user_profiles')
        .select('email, full_name, phone_number')
        .eq('email', email)
        .single();

      if (userError || !userData) {
        console.error('User lookup error:', userError);
        res.status(404).json({ error: 'User not found' });
        return;
      }

      // Get subscription data with service role (bypassing RLS)
      const { data: subscriptionData, error: subscriptionError } = await supabase
        .from('subscriptions')
        .select('trial_start_timestamp, status')
        .eq('user_phone', userData.phone_number)
        .single();

      if (subscriptionError || !subscriptionData) {
        console.error('Subscription lookup error:', subscriptionError);
        res.status(404).json({ error: 'Subscription not found' });
        return;
      }

      // Calculate trial end date
      const trialEndDate = new Date(subscriptionData.trial_start_timestamp);
      trialEndDate.setDate(trialEndDate.getDate() + 3);

      // Return user data needed for payment form
      res.status(200).json({
        email: userData.email,
        full_name: userData.full_name,
        phone_number: userData.phone_number,
        trial_end: trialEndDate.toISOString(),
        subscription_status: subscriptionData.status
      });

    } catch (error) {
      console.error('Error getting user data:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}; 