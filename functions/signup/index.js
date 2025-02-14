const cors = require('cors')({
  origin: process.env.ALLOWED_ORIGINS.split(','),
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 3600
});
const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');
const { Storage } = require('@google-cloud/storage');

// Initialize Supabase client
const getSupabase = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize Storage client
const storage = new Storage();
const projectId = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Message templates
const getPreferencesMessage = (name) => `Ready for Cabo, ${name}? 💪

First, tell us: How 🌶️SPICY🌶️ do you like your workout motivation messages?
< 1 - 5 >
1️⃣: gentle & encouraging 🧘‍♀️
2️⃣: high energy gym bro 🏋️‍♂️
3️⃣: sassy dance teacher 💃
4️⃣: drill sergeant 🫡
5️⃣: toxic frat bro 😤

Next up: Help us personalize your daily beach transformations! 🏖️

Describe yourself in a few words - the more specific, the better! Examples:
- "a fit woman in her 40s"
- "a middle-aged irish/italian dad"
- "a stocky skater girl"
- "an energetic grandma in her 60s"

✨ BONUS LEVEL UNLOCKED ✨
Want to see YOUR face in these transformations? Send us a selfie and we'll make it happen! 🤳

Reply with:
1. Your spice level (1-5)
2. Your description
3. Optional: A selfie!

(You can change any of these later by texting this number) 📱`;

async function initializeConversation(phoneNumber, name) {
  const bucket = storage.bucket(`${projectId}-${process.env.CONVERSATION_BUCKET_NAME}`);
  const filename = `${phoneNumber}/conversation.json`;
  const file = bucket.file(filename);

  try {
    const initialConversation = [
      {
        role: 'assistant',
        content: getPreferencesMessage(name),
        timestamp: new Date().toISOString()
      }
    ];

    await file.save(JSON.stringify(initialConversation, null, 2), {
      contentType: 'application/json',
      metadata: {
        created: new Date().toISOString()
      }
    });

    console.log(`Initialized conversation for ${phoneNumber}`);
  } catch (error) {
    console.error(`Error initializing conversation for ${phoneNumber}:`, error);
    // Don't fail signup if conversation init fails
  }
}

exports.handleSignup = (req, res) => {
  // Log incoming request details
  console.log('Incoming request:', {
    method: req.method,
    headers: req.headers,
    origin: req.headers.origin,
    allowedOrigins: process.env.ALLOWED_ORIGINS.split(',')
  });

  return cors(req, res, async () => {
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
      console.log('Starting Supabase transaction');

      // Create user profile and trial subscription
      const { data, error } = await supabase.rpc('create_user_with_trial', {
        p_phone: phone,
        p_name: name,
        p_email: email,
        p_image_preference: "an athletic person with an ambiguous ethnicity"
      });

      if (error) {
        console.error('Supabase error:', error);
        
        if (error.code === '23505' && error.message.includes('phone_number')) {
          return res.status(409).json({
            success: false,
            message: 'This phone number has already been registered'
          });
        }
        
        throw error;
      }

      // Initialize conversation history
      await initializeConversation(phone, name);

      // Send welcome SMS
      try {
        await twilioClient.messages.create({
          body: getPreferencesMessage(name),
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