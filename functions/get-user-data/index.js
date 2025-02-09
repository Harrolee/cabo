const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGINS,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '3600'
};

exports.getUserData = async (req, res) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders).end();
    return;
  }

  // Set CORS headers for the main request
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.set(key, value);
  });

  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    // Get user profile and subscription status
    const { data: userData, error: userError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('email', email)
      .single();

    if (userError || !userData) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const { data: subscriptionData, error: subscriptionError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_email', email)
      .single();

    if (subscriptionError || !subscriptionData) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    // Check if user is in trial period (within 3 days of trial start)
    const trialEndDate = new Date(subscriptionData.trial_start_timestamp);
    trialEndDate.setDate(trialEndDate.getDate() + 3);
    const now = new Date();

    if (subscriptionData.status !== 'trial' || now > trialEndDate) {
      res.status(403).json({ error: 'Trial period has expired' });
      return;
    }

    // Return user data needed for payment form
    res.status(200).json({
      email: userData.email,
      full_name: userData.full_name,
      phone_number: userData.phone_number,
      trial_end: trialEndDate.toISOString()
    });

  } catch (error) {
    console.error('Error getting user data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}; 