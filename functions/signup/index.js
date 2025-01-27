const cors = require('cors')({
  origin: process.env.ALLOWED_ORIGINS.split(','),
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 3600
});
const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');

// Initialize Supabase client
const getSupabase = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

exports.handleSignup = (req, res) => {
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
      const { phone, name, email } = req.body;
      console.log('Processing signup request for:', { name, phone: phone?.slice(-4), email }); 
      
      if (!phone || !name || !email) {
        console.log('Validation failed: missing required fields');
        return res.status(400).json({
          success: false,
          message: 'Phone, name, and email are required'
        });
      }

      const supabase = getSupabase();
      console.log('Attempting Supabase insert');

      const { error } = await supabase
        .from('user_profiles')
        .insert([{ 
          phone_number: phone,
          full_name: name,
          email: email
        }]);

      if (error) {
        console.error('Supabase error:', error);
        
        // Check for duplicate phone number error
        if (error.code === '23505' && error.message.includes('phone_number')) {
          return res.status(409).json({
            success: false,
            message: 'This phone number has already been registered'
          });
        }
        
        throw error;
      }

      // Send welcome SMS
      try {
        await twilioClient.messages.create({
          body: `Welcome to Workout Motivation, ${name}!💪\n\nHow SPICY do you like your workout motivation messages?\n\n🌶️< 1 - 5 >, < PT Clinic - Psycho Frat Bro >?🌶️`,
          to: phone,
          from: process.env.TWILIO_PHONE_NUMBER,
        });
        console.log('Welcome SMS sent successfully');
      } catch (smsError) {
        console.error('Error sending welcome SMS:', smsError);
        // Don't fail the signup if SMS fails
      }

      console.log('Signup successful');
      res.status(200).json({ 
        success: true, 
        message: 'Successfully signed up!' 
      });
    } catch (error) {
      console.error('Signup error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to sign up' 
      });
    }
  });
};