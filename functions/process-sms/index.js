const OpenAI = require('openai');
const { z } = require('zod');
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');
const { Storage } = require('@google-cloud/storage');
const { COACH_PERSONAS, SPICE_LEVEL_DESCRIPTIONS } = require('./coach-personas');

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
  shouldUpdateCoach: z.boolean(),
  coachType: z.enum(['zen_master', 'gym_bro', 'dance_teacher', 'drill_sergeant', 'frat_bro'])
    .nullable()
    .optional()
    // Only require coachType if shouldUpdateCoach is true
    .superRefine((val, ctx) => {
      if (ctx.parent?.shouldUpdateCoach && !val) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Coach type is required when updating coach preference",
        });
      }
    }),
  shouldUpdateSpice: z.boolean(),
  spiceLevel: z.number()
    .nullable()
    .optional()
    // Only require spiceLevel if shouldUpdateSpice is true
    .superRefine((val, ctx) => {
      if (ctx.parent?.shouldUpdateSpice && !val) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Spice level must be between 1 and 5 when updating spice preference",
        });
      }
      if (ctx.parent?.shouldUpdateSpice && val && (val < 1 || val > 5)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Spice level must be between 1 and 5 when updating spice preference",
        });
      }
    }),
  shouldUpdateImagePreference: z.boolean(),
  imagePreference: z.string()
    .nullable()
    .optional()
    // Only require imagePreference if shouldUpdateImagePreference is true
    .superRefine((val, ctx) => {
      if (ctx.parent?.shouldUpdateImagePreference && !val) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Image preference must not be empty when updating image preference",
        });
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

async function generateCoachResponse(userMessage, spiceLevel, conversationHistory, coach = 'gym_bro') {
  try {
    const messages = [
      {
        role: "system",
        content: `You are ${COACH_PERSONAS[coach].name}, a fitness coach responding to a user's message. Your traits:
${COACH_PERSONAS[coach].traits.map(trait => `- ${trait}`).join('\n')}

Match this spice level ${spiceLevel}/5:
${SPICE_LEVEL_DESCRIPTIONS[spiceLevel]}

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
      zen_master: {
        1: "I hear you! Remember, every step forward is progress. Keep listening to your body and stay mindful of your journey 🧘‍♀️✨",
        2: "Feel the energy flowing through you. Your transformation journey is beautiful! Share your workout victory with me 🌟",
        3: "Channel your inner strength! From gentle waves to powerful ocean - that's your journey! Tell me about today's practice 🌊",
        4: "Your transformation energy is RADIATING! Let's harness that power! Report back after your workout 💫",
        5: "UNLEASH YOUR INNER WARRIOR! From caterpillar to butterfly - METAMORPHOSIS TIME! Share your triumph 🦋"
      },
      gym_bro: {
        1: "That's what I'm talking about, fam! Keep crushing those goals! 💪 You got this!",
        2: "GAINS INCOMING! You're crushing it! Text me when you finish today's session! 🔥",
        3: "BRO! The transformation is REAL! Let's get this bread! Update me post-workout! 💪",
        4: "ABSOLUTE UNIT ALERT! You're built different fr fr! Tell me about today's GAINS! 😤",
        5: "BROOOOO LOOK AT THIS GLOW UP!!! BEAST MODE: ACTIVATED!!! HIT ME AFTER YOU DEMOLISH THIS WORKOUT!!! 🔥"
      },
      dance_teacher: {
        1: "Honey, you're giving transformation energy! Text me after your workout today! 💃",
        2: "Work it! From first position to serving looks! Let me know how today's session goes! ✨",
        3: "Oh. My. God. The transformation is SERVING! Tell me about your workout later! 💅",
        4: "WERK IT HONEY! You're giving EVERYTHING! Spill the tea after your workout! 👑",
        5: "YAAAS QUEEN! THIS GLOW UP IS EVERYTHING!!! SLAY TODAY'S WORKOUT AND TELL ME ALL ABOUT IT! 💃"
      },
      drill_sergeant: {
        1: "Progress detected, soldier! Report back after completing today's training! 🫡",
        2: "Mission: Transformation in progress! Update me post-workout, recruit! 💪",
        3: "IMPRESSIVE PROGRESS, SOLDIER! COMPLETE TODAY'S MISSION AND REPORT BACK! 🎖️",
        4: "TRANSFORMATION PROTOCOL ACTIVATED! DEMOLISH THIS WORKOUT AND GIVE ME A FULL REPORT! 🔥",
        5: "OUTSTANDING TRANSFORMATION IN PROGRESS! DESTROY THIS WORKOUT AND REPORT FOR DEBRIEFING! 🫡"
      },
      frat_bro: {
        1: "YOOO look who's getting SWOLE! Text me after you crush today's workout! 💪",
        2: "BROSKI! The gains are REAL! Hit me up post-workout! 🔥",
        3: "BROOO THIS TRANSFORMATION THO!!! ABSOLUTELY SENDING IT! Update me later! 😤",
        4: "YOOOOO LOOK AT THIS GLOW UP!!! BUILT: DIFFERENT! Tell me about today's GAINZ! 🔥",
        5: "BROOOOOO WHAT IS THIS TRANSFORMATION!!! LITERALLY INSANE!!! HMU AFTER YOU DEMOLISH THIS!!! 😤"
      }
    };

    return fallbackResponses[coach]?.[spiceLevel] || fallbackResponses.gym_bro[3];
  }
}

async function getValidAIResponse(userMessage, userData, previousError = null, attempt = 1) {
  const MAX_ATTEMPTS = 3;
  
  try {
    const messages = [
      {
        role: "system",
        content: `You are an AI that processes user requests and responds in the voice of their fitness coach. The user has selected:

Coach: ${COACH_PERSONAS[userData.coach].name}
Coach Traits:
${COACH_PERSONAS[userData.coach].traits.map(trait => `- ${trait}`).join('\n')}

Spice Level: ${userData.spice_level}/5
${SPICE_LEVEL_DESCRIPTIONS[userData.spice_level]}

You handle three types of requests:
1. Coach selection (numbers 1-5 corresponding to: zen_master, gym_bro, dance_teacher, drill_sergeant, frat_bro)
2. Spice level preferences (1-5, determining how dramatic/provocative the communication style is)
3. Image preferences (users describing what kind of people they want to see)

Respond with JSON in this format:
{
  "shouldUpdateCoach": boolean,
  "coachType": string (only when shouldUpdateCoach is true),
  "shouldUpdateSpice": boolean,
  "spiceLevel": number (1-5, only when shouldUpdateSpice is true),
  "shouldUpdateImagePreference": boolean,
  "imagePreference": string (only when shouldUpdateImagePreference is true),
  "customerResponse": string (response in the voice of their current coach)
}

When responding to general messages (not preference updates), make sure the customerResponse:
1. Matches the personality of their selected coach
2. Uses the coach's characteristic phrases and style
3. Maintains the intensity level indicated by their spice level
4. Stays focused on fitness and motivation
5. Keeps responses under 160 characters`
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
    console.log(`Error in attempt ${attempt}:`, error);
    
    if (attempt < MAX_ATTEMPTS) {
      console.log(`Retrying... Attempt ${attempt + 1} of ${MAX_ATTEMPTS}`);
      return getValidAIResponse(userMessage, userData, error, attempt + 1);
    }

    // Get coach-specific funny excuses based on their selected coach
    const coachExcuses = {
      zen_master: [
        "Taking a mindful breath... 🧘‍♀️ Please try again.",
        "The universe needs a moment... ✨ One more time?",
        "Realigning my chakras... 🌟 Try that again?",
      ],
      gym_bro: [
        "Bro, my protein shake is still loading! 🥤 Try again?",
        "Just finishing this set fam! 💪 One more rep?",
        "Taking a pre-workout break! ⚡ Hit me again?",
      ],
      dance_teacher: [
        "Honey, I lost my rhythm! 💃 Try that again?",
        "Just stretching it out... 🎵 One more time?",
        "Need to perfect that move! 💅 From the top?",
      ],
      drill_sergeant: [
        "SYSTEM MALFUNCTION, SOLDIER! TRY AGAIN!",
        "TEMPORARY TACTICAL RETREAT! REGROUP!",
        "MISSION PARAMETERS UNCLEAR! CLARIFY!",
      ],
      frat_bro: [
        "BROSKI MY BRAIN IS TOO SWOLE RN! 😤 TRY AGAIN!",
        "YOOO I'M LITERALLY DEAD RN! ☠️ ONE MORE TIME!",
        "CAN'T EVEN BRO, TOO HYPED! 🔥 HIT THAT AGAIN!",
      ]
    };

    const excuses = coachExcuses[userData.coach] || coachExcuses.gym_bro;
    throw new Error(excuses[Math.floor(Math.random() * excuses.length)]);
  }
}

// Helper function to check if a MIME type is an image
function isImageMimeType(mimeType) {
  return mimeType.startsWith('image/');
}

// Helper function to get file extension from MIME type
function getFileExtensionFromMimeType(mimeType) {
  const extensions = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/heic': 'heic'
  };
  return extensions[mimeType] || 'jpg';
}

// Function to save media to GCS
async function saveMediaToGCS(mediaUrl, phoneNumber, contentType) {
  const bucket = storage.bucket(`${projectId}-${process.env.CONVERSATION_BUCKET_NAME}`);
  const extension = getFileExtensionFromMimeType(contentType);
  // Use the full phone number (including +1) as the directory name
  const filePath = `${phoneNumber}/images/profile.${extension}`;
  const file = bucket.file(filePath);

  try {
    // Create basic auth header using Twilio credentials
    const authString = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    
    const response = await fetch(mediaUrl, {
      headers: {
        'Authorization': `Basic ${authString}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch media: ${response.statusText}`);
    }

    // Get the response as an ArrayBuffer
    const buffer = await response.arrayBuffer();

    // Upload the buffer directly to GCS
    await file.save(Buffer.from(buffer), {
      metadata: {
        contentType: response.headers.get('content-type'),
        metadata: {
          source: 'user_upload',
          uploadedAt: new Date().toISOString(),
          phoneNumber: phoneNumber
        }
      }
    });

    return `gs://${bucket.name}/${filePath}`;
  } catch (error) {
    console.error('Error saving media to GCS:', error);
    throw error;
  }
}

// Function to delete media from Twilio
async function deleteMediaFromTwilio(messageSid, mediaSid) {
  const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  try {
    await twilioClient.messages(messageSid).media(mediaSid).remove();
  } catch (error) {
    console.error('Error deleting media from Twilio:', error);
    // Don't throw error as this is not critical
  }
}

// Helper function to validate and format North American phone numbers
function formatPhoneNumber(phoneNumber) {
  // Remove all non-digit characters except leading +
  let cleaned = phoneNumber.replace(/[^\d+]/g, '');
  
  // If it starts with +1, remove it temporarily
  if (cleaned.startsWith('+1')) {
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith('1')) {
    cleaned = cleaned.substring(1);
  }
  
  // Check if we have exactly 10 digits
  if (cleaned.length !== 10) {
    return null;
  }
  
  // Return in E.164 format (+1XXXXXXXXXX)
  return `+1${cleaned}`;
}

// Main function to process incoming SMS
exports.processSms = async (req, res) => {
  try {
    const body = req.body;
    const incomingPhoneNumber = body.From;
    const messageSid = body.MessageSid;
    const numMedia = parseInt(body.NumMedia) || 0;
    const userMessage = body.Body || '';

    console.log('Incoming phone number:', incomingPhoneNumber);

    // Format and validate the phone number
    const formattedPhoneNumber = formatPhoneNumber(incomingPhoneNumber);
    
    // If the number isn't valid North American format, reject it
    if (!formattedPhoneNumber) {
      console.log('Invalid phone number format:', incomingPhoneNumber);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message("Sorry, this service is only available in North America.");
      res.set('Content-Type', 'text/xml');
      return res.send(twiml.toString());
    }

    console.log('Formatted phone number:', formattedPhoneNumber);

    // Get conversation history and user data
    const [conversationHistory, { data: userData, error: userError }] = await Promise.all([
      getConversationHistory(formattedPhoneNumber),
      supabase.from('user_profiles').select('*').eq('phone_number', formattedPhoneNumber).single()
    ]);

    console.log('User data:', userData);
    if (userError) console.error('Error fetching user:', userError);

    // Only proceed if user exists in database
    if (!userData) {
      console.log('User not found in database');
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message("Sorry, I don't recognize this number. Please sign up first!");
      res.set('Content-Type', 'text/xml');
      return res.send(twiml.toString());
    }

    let responseMessage;
    let mediaUrl;

    // Handle media if present
    if (numMedia > 0) {
      // Only process the first image if multiple are sent
      const firstMediaUrl = body['MediaUrl0'];
      const contentType = body['MediaContentType0'];
      const mediaSid = firstMediaUrl.split('/').pop();

      if (isImageMimeType(contentType)) {
        mediaUrl = await saveMediaToGCS(firstMediaUrl, formattedPhoneNumber, contentType);
        await deleteMediaFromTwilio(messageSid, mediaSid);
        
        // Generate a complimentary response about their photo
        const photoPrompt = `The user just sent a photo of themselves. Generate a brief, encouraging compliment about their appearance in your coaching style. Be genuine and uplifting. Let them know that we'll keep this photo to generate motivational images for them.`;
        responseMessage = await generateCoachResponse(photoPrompt, userData.spice_level, conversationHistory, userData.coach);
      } else {
        responseMessage = "I can only accept image files. Please try sending your photo again!";
      }
    } else {
      // Process normal text message
      const aiResponse = await getValidAIResponse(userMessage, userData);
      responseMessage = aiResponse.customerResponse;

      // Update user preferences if needed
      if (aiResponse.shouldUpdateSpice || aiResponse.shouldUpdateImagePreference || aiResponse.shouldUpdateCoach) {
        const updates = {
          updated_at: new Date().toISOString()
        };
        if (aiResponse.shouldUpdateSpice) {
          updates.spice_level = aiResponse.spiceLevel;
        }
        if (aiResponse.shouldUpdateImagePreference) {
          updates.image_preference = aiResponse.imagePreference;
        }
        if (aiResponse.shouldUpdateCoach) {
          updates.coach = aiResponse.coachType;
        }
        const { error: updateError } = await supabase
          .from('user_profiles')
          .update(updates)
          .eq('phone_number', formattedPhoneNumber);

        if (updateError) {
          console.error('Error updating user preferences:', updateError);
        }
      }
    }

    // Store the conversation
    await Promise.all([
      storeConversation(formattedPhoneNumber, userMessage),
      storeConversation(formattedPhoneNumber, responseMessage, 'assistant')
    ]);

    // Send response via Twilio
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(responseMessage);

    res.set('Content-Type', 'text/xml');
    return res.send(twiml.toString());

  } catch (error) {
    console.error('Error processing SMS:', error);
    res.status(500).send('Error processing request');
  }
}; 
