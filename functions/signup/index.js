const cors = require('cors')({
  origin: process.env.ALLOWED_ORIGINS.split(','),
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 3600
});
const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');
const { Storage } = require('@google-cloud/storage');
const { COACH_PERSONAS, SPICE_LEVEL_DESCRIPTIONS } = require('./coach-personas');

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

First, choose your personal fitness coach! Each has their own style:

1️⃣ Zen Master 🧘‍♀️
- Peaceful and mindful
- Focuses on holistic wellness
- Perfect for mindful fitness

2️⃣ Gym Bro 🏋️‍♂️
- High energy and positive
- All about those gains
- Great for strength goals

3️⃣ Dance Teacher 💃
- Sassy and stylish
- Makes fitness fun
- Perfect for rhythm lovers

4️⃣ Drill Sergeant 🫡
- Disciplined and structured
- No-nonsense approach
- Great for strict routines

5️⃣ Frat Bro 😤
- Over-the-top energy
- Extreme motivation
- Perfect for intense training

Next, set your 🌶️SPICE LEVEL🌶️ (1-5):
This determines how dramatic and surprising your coach's messages will be:
1: Gentle & supportive
2: Moderately motivating
3: Notably challenging
4: Intensely motivating
5: Extremely dramatic

Finally: Help us personalize your daily beach transformations! 🏖️
Describe yourself in a few words - the more specific, the better! Examples:
- "a fit woman in her 40s"
- "a middle-aged irish/italian dad"
- "a stocky skater girl"
- "an energetic grandma in her 60s"

✨ BONUS LEVEL UNLOCKED ✨
Want to see YOUR face in these transformations? Send us a selfie and we'll make it happen! 🤳

Reply with:
1. Your coach number (1-5)
2. Your spice level (1-5)
3. Your description
4. Optional: A selfie!

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

  } catch (error) {
    console.error(`Error initializing conversation for ${phoneNumber}:`, error);
    // Don't fail signup if conversation init fails
  }
}

exports.handleSignup = (req, res) => {
  return cors(req, res, async () => {
    if (req.method === 'OPTIONS') {
      return res.status(204).send();
    }

    try {
      const { phone, name, email } = req.body;

      if (!phone || !name || !email) {
        return res.status(400).json({
          success: false,
          message: 'Phone, name, and email are required'
        });
      }

      const supabase = getSupabase();

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

      const { data: authUserData, error: authError } = await supabase.auth.admin.createUser({
        email: email,
        phone: phone,
        email_confirm: true, // Email is provided by user, considered verified for this step
        phone_confirm: true, // Phone is provided by user, considered verified for this step
        user_metadata: { name: name } // Optional: store name here too
      });

      if (authError) {
        // Log the error. If user already exists, it's not a critical failure for the signup flow.
        if (authError.message && authError.message.toLowerCase().includes('user already registered')) {
          console.warn('Supabase auth user already exists for:', email, authError.message);
        } else {
          console.error('Error creating Supabase auth user:', authError);
        }
      }

      // Initialize conversation history
      await initializeConversation(phone, name);

      try {
        await twilioClient.messages.create({
          body: getPreferencesMessage(name),
          to: phone,
          from: process.env.TWILIO_PHONE_NUMBER,
        });
      } catch (smsError) {
        console.error('Error sending welcome SMS:', smsError);
        // Don't fail the signup if SMS fails
      }

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