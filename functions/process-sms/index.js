const OpenAI = require('openai');
const { z } = require('zod');
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');
const { Storage } = require('@google-cloud/storage');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const storage = new Storage();
const projectId = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;

// Update the Zod schema for validating OpenAI response
const responseSchema = z.object({
  shouldUpdateSpice: z.boolean(),
  spiceLevel: z.number()
    .optional()
    .default(2)
    // Only require spiceLevel if shouldUpdateSpice is true
    .superRefine((val, ctx) => {
      if (ctx.parent?.shouldUpdateSpice) {
        // If we're updating spice, validate the range
        if (val < 1 || val > 5) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Spice level must be between 1 and 5 when updating spice preference",
          });
        }
      }
    }),
  shouldUpdateImagePreference: z.boolean(),
  imagePreference: z.string()
    .optional()
    .default("ambiguously non-white male")
    // Only require imagePreference if shouldUpdateImagePreference is true
    .superRefine((val, ctx) => {
      if (ctx.parent?.shouldUpdateImagePreference) {
        // If we're updating image preference, validate it's not empty
        if (!val || val.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Image preference must not be empty when updating image preference",
          });
        }
      }
    }),
  customerResponse: z.string()
});

async function getConversationHistory(phoneNumber) {
  const bucket = storage.bucket(`${projectId}-${process.env.CONVERSATION_BUCKET_NAME}`);
  const filename = `${phoneNumber}/conversation.json`;
  const file = bucket.file(filename);

  try {
    const [exists] = await file.exists();
    if (!exists) {
      return [];
    }

    const [content] = await file.download();
    return JSON.parse(content.toString());
  } catch (error) {
    console.error(`Error retrieving conversation for ${phoneNumber}:`, error);
    return [];
  }
}

async function storeConversation(phoneNumber, message, role = 'user') {
  const bucket = storage.bucket(`${projectId}-${process.env.CONVERSATION_BUCKET_NAME}`);
  const filename = `${phoneNumber}/conversation.json`;
  const file = bucket.file(filename);

  try {
    // Try to get existing conversation
    const [exists] = await file.exists();
    let conversation = [];
    
    if (exists) {
      const [content] = await file.download();
      conversation = JSON.parse(content.toString());
    }

    // Add new message
    conversation.push({
      role,
      content: message,
      timestamp: new Date().toISOString()
    });

    // Keep only last 50 messages
    if (conversation.length > 50) {
      conversation = conversation.slice(-50);
    }

    // Write updated conversation
    await file.save(JSON.stringify(conversation, null, 2), {
      contentType: 'application/json',
      metadata: {
        updated: new Date().toISOString()
      }
    });

    return conversation;
  } catch (error) {
    console.error(`Error storing conversation for ${phoneNumber}:`, error);
    throw error;
  }
}

async function generateCoachResponse(userMessage, spiceLevel, conversationHistory) {
  try {
    const messages = [
      {
        role: "system",
        content: `You are a fitness coach responding to a user's message. Match this spice level ${spiceLevel}/5:

1️⃣ Gentle & Encouraging 🧘‍♀️
- Radiates peaceful zen energy
- Uses phrases like "Listen to your body" and "Every step counts"
- Probably doing yoga right now
- Might suggest a green smoothie
- Always ends with "Namaste" or "You're doing amazing sweetie"

2️⃣ High Energy Gym Bro 🏋️‍♂️
- Enthusiastic but not overwhelming
- Loves saying "Let's get this bread!" unironically
- Calls everyone "fam" or "bro"
- Excessive use of the 💪 emoji
- Always talking about "gains"

3️⃣ Sassy Dance Teacher 💃
- Full of sass and attitude
- "Oh honey..." is their favorite phrase
- Everything is "giving" something
- Snaps fingers for emphasis
- Might make you do jazz hands

4️⃣ Drill Sergeant 🫡
- TYPES IN ALL CAPS
- Everything is a "MISSION" or "OBJECTIVE"
- Calls workouts "TRAINING OPERATIONS"
- Zero tolerance for excuses
- Probably doing pushups while typing

5️⃣ Toxic Frat Bro 😤
- ABSOLUTELY UNHINGED ENERGY
- Random keyboard smashing ("ASDKJHASD")
- Excessive emojis
- Makes up words like "SWOLEPOCALYPSE"
- Everything is "BUILT DIFFERENT"

Keep responses under 160 characters. Be encouraging and helpful while maintaining character. Never use offensive language or mock protected groups.`
      },
      ...conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      {
        role: "user",
        content: userMessage
      }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages,
      temperature: 0.7,
      max_tokens: 100,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error("Error generating coach response:", error);
    const fallbackResponses = {
      1: "I hear you! Remember, every step forward is progress. Keep listening to your body and stay mindful of your journey 🧘‍♀️✨",
      2: "That's what I'm talking about, fam! Keep crushing those goals! 💪 You got this!",
      3: "Werk it, honey! You're giving me everything I need to see! Keep that energy up! 💃",
      4: "OUTSTANDING EFFORT, SOLDIER! MAINTAIN THAT MOMENTUM! VICTORY AWAITS! 🫡",
      5: "YOOOOO ABSOLUTE BEAST MODE!!! YOU'RE BUILT DIFFERENT FR FR!!! 😤💪"
    };
    return fallbackResponses[spiceLevel] || fallbackResponses[3];
  }
}

async function getValidAIResponse(userMessage, previousError = null, attempt = 1) {
  const MAX_ATTEMPTS = 3;
  
  try {
    const messages = [
      {
        role: "system",
        content: `You are an AI that processes two types of user requests:

1. Spice level preferences for workout messages (responding to "How 🌶️SPICY🌶️ do you like your workout motivation messages?")
Spice levels:
1: gentle & encouraging 🧘‍♀️
2: high energy gym bro 🏋️‍♂️
3: sassy dance teacher 💃
4: drill sergeant 🫡
5: toxic frat bro 😤

2. Image preferences for workout motivation pictures (users can describe what kind of people they want to see)

Respond with JSON in this format:
{
  "shouldUpdateSpice": boolean,
  "spiceLevel": number (1-5, only required when shouldUpdateSpice is true),
  "shouldUpdateImagePreference": boolean,
  "imagePreference": string (only required when shouldUpdateImagePreference is true),
  "customerResponse": string
}

If the user is setting their spice level, set shouldUpdateSpice to true and include an appropriate confirmation message.
If the user is describing their image preferences, set shouldUpdateImagePreference to true and include a confirmation message.
If the user is doing both, set both to true and confirm both changes.
For any other messages, set both to false and provide an appropriate customerResponse.`
      },
      {
        role: "user",
        content: `User's message: ${userMessage}`
      }
    ];

    // If this is a retry, add the error context
    if (previousError) {
      messages.push({
        role: "system",
        content: `Your last response was invalid. Please fix the following validation error and try again: ${JSON.stringify(previousError, null, 2)}`
      });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages,
      temperature: 0.7,
    });

    const aiResponse = completion.choices[0].message.content;
    console.log(`AI response attempt ${attempt}:`, aiResponse);

    // Parse and validate the JSON response
    const parsedResponse = JSON.parse(aiResponse);
    responseSchema.parse(parsedResponse);
    
    return parsedResponse;

  } catch (error) {
    console.error(`Error in attempt ${attempt}:`, error);
    
    if (attempt < MAX_ATTEMPTS) {
      console.log(`Retrying... Attempt ${attempt + 1} of ${MAX_ATTEMPTS}`);
      return getValidAIResponse(userMessage, error, attempt + 1);
    }

    // If we've exhausted our retries, throw a user-friendly error
    const funnyExcuses = [
      "Sorry fam, my AI trainer is off getting their protein shake! 🥤 Try that again?",
      "Oops! The AI is busy doing hot yoga right now! 🧘‍♀️ One more time?",
      "ERROR 404: BRAIN TOO SWOLE 💪 Maybe rephrase that?",
      "The AI is stuck in a squat position! 🏋️‍♂️ Try again?",
      "Currently getting cupped, back in 5! ⭕ Mind trying again?",
      "SYSTEM OVERLOAD: TOO MANY GAINS 😤 One more rep- I mean, try?"
    ];
    
    throw new Error(funnyExcuses[Math.floor(Math.random() * funnyExcuses.length)]);
  }
}

exports.processSms = async (req, res) => {
  try {
    const twilioSignature = req.headers['x-twilio-signature'];
    const url = process.env.FUNCTION_URL;
    
    const isValid = twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      twilioSignature,
      url,
      req.body
    );
    
    console.log('Request validation result:', isValid);

    const userMessage = req.body.Body;
    const userPhone = req.body.From;

    // Get existing conversation history first
    const conversationHistory = await getConversationHistory(userPhone);

    // Store user's message in conversation history
    await storeConversation(userPhone, userMessage, 'user');

    // Get user's spice level
    const { data: userProfile, error: userError } = await supabase
      .from('user_profiles')
      .select('spice_level')
      .eq('phone_number', userPhone)
      .single();

    if (userError) {
      console.error('Error fetching user profile:', userError);
      throw userError;
    }

    const spiceLevel = userProfile?.spice_level || 3;

    // First, check if it's a spice level or image preference update
    const parsedResponse = await getValidAIResponse(userMessage);

    if (parsedResponse.shouldUpdateSpice || parsedResponse.shouldUpdateImagePreference) {
      // Handle preference updates as before
      const updates = {};
      
      if (parsedResponse.shouldUpdateSpice) {
        updates.spice_level = parsedResponse.spiceLevel;
      }
      
      if (parsedResponse.shouldUpdateImagePreference) {
        updates.image_preference = parsedResponse.imagePreference;
      }
      
      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString();
        
        const { error: updateError } = await supabase
          .from('user_profiles')
          .update(updates)
          .eq('phone_number', userPhone);

        if (updateError) {
          console.error('Error updating user profile:', updateError);
          throw updateError;
        }
      }
    }

    // Generate coach's response based on conversation history
    const coachResponse = await generateCoachResponse(
      userMessage,
      spiceLevel,
      conversationHistory
    );

    // Store coach's response in conversation history
    await storeConversation(userPhone, coachResponse, 'assistant');

    // Send the response back to the user
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await twilioClient.messages.create({
      body: coachResponse,
      to: userPhone,
      from: process.env.TWILIO_PHONE_NUMBER,
    });

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing SMS:', error);
    res.status(500).send('Internal Server Error');
  }
}; 
