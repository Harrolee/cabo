const OpenAI = require('openai');
const { z } = require('zod');
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');
const { Storage } = require('@google-cloud/storage');
const { COACH_PERSONAS, SPICE_LEVEL_DESCRIPTIONS } = require('./coach-personas');
const fetch = require('node-fetch');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const storage = new Storage();
const projectId = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;

const responseSchema = z.object({
  shouldUpdateCoach: z.boolean(),
  // Predefined coach (legacy)
  coachType: z.enum(['zen_master', 'gym_bro', 'dance_teacher', 'drill_sergeant', 'frat_bro']).nullable().optional(),
  // Custom coach support
  customCoachId: z.string().uuid().nullable().optional(),
  customCoachHandle: z.string().nullable().optional(),
  shouldUpdateSpice: z.boolean(),
  spiceLevel: z.number()
    .nullable()
    .optional()
    .superRefine((val, ctx) => {
      if (ctx.parent?.shouldUpdateSpice && !val) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Spice level must be between 1 and 5 when updating spice preference" });
      }
      if (ctx.parent?.shouldUpdateSpice && val && (val < 1 || val > 5)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Spice level must be between 1 and 5 when updating spice preference" });
      }
    }),
  shouldUpdateImagePreference: z.boolean(),
  imagePreference: z.string().nullable().optional().superRefine((val, ctx) => {
    if (ctx.parent?.shouldUpdateImagePreference && !val) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Image preference must not be empty when updating image preference" });
    }
  }),
  customerResponse: z.string()
});

// Add this new function to get coach data (predefined or custom)
async function getCoachData(userData) {
  if (userData.coach_type === 'custom' && userData.custom_coach_id) {
    try {
      // Fetch custom coach from database
      const { data: customCoach, error } = await supabase
        .from('coach_profiles')
        .select('*')
        .eq('id', userData.custom_coach_id)
        .single();

      if (error) {
        console.error('Error fetching custom coach:', error);
        // Fallback to default predefined coach
        return {
          type: 'predefined',
          data: COACH_PERSONAS.gym_bro,
          name: 'gym_bro'
        };
      }

      // Convert custom coach to format expected by the system
      return {
        type: 'custom',
        data: {
          name: customCoach.name,
          traits: [
            `Primary style: ${customCoach.primary_response_style?.replace('_', ' ')}`,
            `Secondary style: ${customCoach.secondary_response_style?.replace('_', ' ')}`,
            `Energy level: ${customCoach.communication_traits?.energy_level || 5}/10`,
            `Directness: ${customCoach.communication_traits?.directness || 5}/10`,
            `Formality: ${customCoach.communication_traits?.formality || 5}/10`
          ],
          activities: ['Custom coaching', 'Personalized motivation', 'AI-powered guidance']
        },
        id: customCoach.id,
        handle: customCoach.handle
      };
    } catch (error) {
      console.error('Error in getCoachData:', error);
      // Fallback to default
      return {
        type: 'predefined',
        data: COACH_PERSONAS.gym_bro,
        name: 'gym_bro'
      };
    }
  } else {
    // Use predefined coach
    const coachName = userData.coach || 'gym_bro';
    return {
      type: 'predefined',
      data: COACH_PERSONAS[coachName],
      name: coachName
    };
  }
}

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

// Update the generateCoachResponse function to handle custom coaches
async function generateCoachResponse(userMessage, spiceLevel, conversationHistory, userData) {
  try {
    const coachInfo = await getCoachData(userData);
    
    let systemPrompt;
    
    if (coachInfo.type === 'custom') {
      // Use orchestrator first; fallback to direct generator
      try {
        const orchestratorUrl = `${process.env.GCP_FUNCTION_BASE_URL}/engagement-orchestrator`;
        const oResp = await fetch(orchestratorUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: userData.phone_number,
            coachId: coachInfo.id,
            userMessage,
            plan_key: 'chat_text_only'
          })
        });
        if (oResp.ok) {
          const oJson = await oResp.json();
          return oJson.content?.text || "I'm having trouble responding right now. Please try again!";
        }
        console.error('Orchestrator call failed, falling back:', await oResp.text());
      } catch (orchestratorError) {
        console.error('Error calling orchestrator:', orchestratorError);
      }

      try {
        const response = await fetch(`${process.env.GCP_FUNCTION_BASE_URL}/coach-response-generator`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            coachId: coachInfo.id,
            userMessage: userMessage,
            userContext: {
              emotionalNeed: 'encouragement',
              situation: 'general',
              previousMessages: conversationHistory.slice(-5).map(msg => ({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content,
                timestamp: msg.timestamp
              }))
            }
          })
        });

        if (response.ok) {
          const data = await response.json();
          return data.response;
        } else {
          console.error('Custom coach response failed, falling back to predefined');
        }
      } catch (error) {
        console.error('Error calling custom coach generator:', error);
      }
    }
    
    // Predefined coach logic (original code)
    systemPrompt = `You are ${coachInfo.data.name}, a fitness coach focused on practical outcomes and encouragement. Your traits: ${coachInfo.data.traits.map(trait => `- ${trait}`).join('\n')}
Your responses should always include:
1. Acknowledge their input
2. Give ONE specific, actionable item
3. Ask for ONE specific metric or update

Example:
"Nice work on the squats! If you feel ready, push yourself even harder next time. Text me your max reps at the new weight 💪"

Match this spice level ${spiceLevel}/5:
${SPICE_LEVEL_DESCRIPTIONS[spiceLevel]}

Keep responses under 160 characters. Never give vague encouragement without actionable items. Maintain your character but never use offensive language or mock protected groups.`;

    const messages = [
      {
        role: "system",
        content: systemPrompt
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
      model: "gpt-4o",
      messages,
      temperature: 0.7,
      max_tokens: 100,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error("Error generating coach response:", error);
    
    // Enhanced fallback that works for both predefined and custom coaches
    const fallbackResponses = [
      "Keep pushing! You're doing great! 💪",
      "Every step counts! Tell me about your next workout! 🔥",
      "Progress is progress! What's your goal for today? ✨",
      "You've got this! Share your victory with me! 🎯"
    ];
    
    return fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
  }
}

async function getValidAIResponse(userMessage, userData, previousError = null, attempt = 1) {
  const maxAttempts = 3;
  
  if (attempt > maxAttempts) {
    console.error(`Failed to get valid AI response after ${maxAttempts} attempts`);
    return {
      shouldUpdateCoach: false,
      shouldUpdateSpice: false,
      shouldUpdateImagePreference: false,
      customerResponse: "I'm having trouble understanding right now. Could you try rephrasing that?"
    };
  }

  try {
    const coachInfo = await getCoachData(userData);
    
    const publicCoaches = userData.publicCoaches || [];
    const publicCoachList = publicCoaches.map(c => `- ${c.name}${c.handle ? ` (@${c.handle})` : ''} [${c.id}]`).join('\n');

    const systemPrompt = `You are an AI assistant for a fitness coaching app.
User's current coach: ${coachInfo.data.name}
Spice Level: ${userData.spice_level}/5
Traits:\n${coachInfo.data.traits.map(trait => `- ${trait}`).join('\n')}

Your tasks:
1) Detect if the user wants to change their coach (natural language like "switch to @handle" or a coach name)
2) Detect if they want to change spice level
3) Detect if they want to change image preference
4) Generate a short friendly SMS reply

Available predefined coach types: "zen_master", "gym_bro", "dance_teacher", "drill_sergeant", "frat_bro"
Available public custom coaches:\n${publicCoachList || '(none)'}

IMPORTANT:
- If switching to a custom coach, you MUST return either customCoachId (preferred) or customCoachHandle (like "actualrobot" without the @).
- If switching to a predefined coach, set coachType to one of the predefined values.
- When not switching, set coachType, customCoachId, and customCoachHandle to null.

${previousError ? `Previous attempt failed with error: ${previousError}. Please fix the issue.` : ''}

Return JSON exactly in this schema:
{
  "shouldUpdateCoach": boolean,
  "coachType": "zen_master" | "gym_bro" | "dance_teacher" | "drill_sergeant" | "frat_bro" | null,
  "customCoachId": string | null,
  "customCoachHandle": string | null,
  "shouldUpdateSpice": boolean,
  "spiceLevel": number (1-5) | null,
  "shouldUpdateImagePreference": boolean,
  "imagePreference": string | null,
  "customerResponse": string
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 300,
    });

    const responseText = completion.choices[0].message.content.trim();
    console.log("Raw AI response:", responseText);

    // Robust JSON parsing: strip code fences and extract JSON object
    function parseJsonLoose(text) {
      try {
        return JSON.parse(text);
      } catch (_) {
        // Strip triple backticks and optional language hint
        let cleaned = text.replace(/^```[a-zA-Z]*\n?/m, '').replace(/```$/m, '').trim();
        try { return JSON.parse(cleaned); } catch (_) {}
        // Extract the first {...} block
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) {
          return JSON.parse(match[0]);
        }
        throw new Error('Could not parse JSON');
      }
    }

    let parsedResponse;
    try {
      parsedResponse = parseJsonLoose(responseText);
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      throw new Error(`Invalid JSON response: ${responseText}`);
    }

    const validatedResponse = responseSchema.parse(parsedResponse);
    console.log("Validated AI response:", validatedResponse);
    
    return validatedResponse;
  } catch (error) {
    console.error(`AI response attempt ${attempt} failed:`, error);
    return await getValidAIResponse(userMessage, userData, error.message, attempt + 1);
  }
}

// Helper function to check if a MIME type is an image
function isImageMimeType(mimeType) {
  return mimeType && mimeType.startsWith('image/');
}

// Helper function to get file extension from MIME type
function getFileExtensionFromMimeType(mimeType) {
  const mimeToExt = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp'
  };
  return mimeToExt[mimeType] || 'jpg';
}

// Function to save media to GCS
async function saveMediaToGCS(mediaUrl, phoneNumber, contentType) {
  try {
    const response = await fetch(mediaUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch media: ${response.statusText}`);
    }

    const buffer = await response.buffer();
    const fileExtension = getFileExtensionFromMimeType(contentType);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${phoneNumber}/${timestamp}.${fileExtension}`;
    
    const bucket = storage.bucket(`${projectId}-image-bucket`);
    const file = bucket.file(fileName);
    
    await file.save(buffer, {
      metadata: {
        contentType: contentType,
        metadata: {
          phoneNumber: phoneNumber,
          uploadedAt: new Date().toISOString()
        }
      }
    });

    console.log(`Media saved to GCS: ${fileName}`);
    return fileName;
  } catch (error) {
    console.error('Error saving media to GCS:', error);
    throw error;
  }
}

// Function to delete media from Twilio
async function deleteMediaFromTwilio(messageSid, mediaSid) {
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages(messageSid).media(mediaSid).remove();
    console.log(`Deleted media ${mediaSid} from message ${messageSid}`);
  } catch (error) {
    console.error('Error deleting media from Twilio:', error);
  }
}

// Helper function to validate and format North American phone numbers
function formatPhoneNumber(phoneNumber) {
  if (!phoneNumber) return null;
  
  let cleaned = phoneNumber.replace(/\D/g, '');
  
  if (cleaned.length === 10) {
    cleaned = '1' + cleaned;
  }
  
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return '+' + cleaned;
  }
  
  return phoneNumber.startsWith('+') ? phoneNumber : '+' + phoneNumber;
}

/**
 * Try to find a public coach by @handle or by name
 */
async function findPublicCoachByQuery(rawQuery) {
  if (!rawQuery) return null;
  const query = String(rawQuery).trim();

  // Prefer handle if present
  const handleMatch = query.match(/@([a-z0-9_]+)/i);
  if (handleMatch) {
    const handle = handleMatch[1].toLowerCase();
    const { data: coachByHandle, error: handleError } = await supabase
      .from('coach_profiles')
      .select('id, name, handle, public')
      .ilike('handle', handle)
      .eq('public', true)
      .limit(1)
      .maybeSingle();
    if (!handleError && coachByHandle) return coachByHandle;
  }

  // Fallback: fuzzy name match
  const namePhrase = query.replace(/coach/gi, '').trim();
  if (namePhrase.length > 0) {
    const { data: coachByName, error: nameError } = await supabase
      .from('coach_profiles')
      .select('id, name, handle, public')
      .ilike('name', `%${namePhrase}%`)
      .eq('public', true)
      .order('name', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!nameError && coachByName) return coachByName;
  }

  return null;
}

async function listPublicCoaches(limit = 50) {
  const { data, error } = await supabase
    .from('coach_profiles')
    .select('id, name, handle, public, active')
    .eq('public', true)
    .eq('active', true)
    .order('name', { ascending: true })
    .limit(limit);
  if (error) {
    console.warn('Failed to list public coaches:', error);
    return [];
  }
  return data || [];
}

// Main function to process incoming SMS
exports.processSms = async (req, res) => {
  console.log('SMS processing started');
  console.log('Request body:', req.body);

  try {
    const { Body: messageBody, From: fromNumber, MediaUrl0, MediaContentType0, MessageSid, NumMedia } = req.body;
    
    if (!messageBody && !MediaUrl0) {
      console.log('No message body or media found');
      return res.status(400).send('No message content');
    }

    const normalizedPhoneNumber = formatPhoneNumber(fromNumber);
    console.log(`Processing message from: ${fromNumber} -> ${normalizedPhoneNumber}`);

    // Update the user data fetch to include custom coach information
    const { data: userData, error: userError } = await supabase
      .from('user_profiles')
      .select(`
        coach, 
        coach_type, 
        custom_coach_id, 
        spice_level, 
        image_preference,
        coach_profiles!custom_coach_id(id, name, handle, primary_response_style, secondary_response_style, communication_traits)
      `)
      .eq('phone_number', normalizedPhoneNumber)
      .single();

    if (userError) {
      console.error('Error fetching user data:', userError);
      return res.status(500).send('Error fetching user data');
    }

    if (!userData) {
      console.log('User not found for phone number:', normalizedPhoneNumber);
      return res.status(404).send('User not found');
    }

    console.log('User data:', userData);

    const conversationHistory = await getConversationHistory(normalizedPhoneNumber);
    let responseMessage;

    if (MediaUrl0 && isImageMimeType(MediaContentType0)) {
      console.log('Processing image message');
      
      try {
        const gcsFileName = await saveMediaToGCS(MediaUrl0, normalizedPhoneNumber, MediaContentType0);
        await deleteMediaFromTwilio(MessageSid, req.body.MediaSid0);
        
        const photoPrompt = messageBody || "I'm sharing a photo with you!";
        await storeConversation(normalizedPhoneNumber, `[Photo shared] ${photoPrompt}`);
        
        // Pass userData instead of just coach name
        responseMessage = await generateCoachResponse(photoPrompt, userData.spice_level, conversationHistory, userData);
        
      } catch (error) {
        console.error('Error processing image:', error);
        responseMessage = "Thanks for sharing! I'm having trouble processing your image right now, but keep up the great work! 💪";
      }
    } else {
      console.log('Processing text message');
      await storeConversation(normalizedPhoneNumber, messageBody);

      // Provide AI a full list of available coaches (predefined + custom public)
      const publicCoaches = await listPublicCoaches(100);
      const aiResponse = await getValidAIResponse(messageBody, { ...userData, publicCoaches });

      // Collect preference updates based on parsed intent
      let updateData = {};
      if (aiResponse.shouldUpdateCoach || aiResponse.shouldUpdateSpice || aiResponse.shouldUpdateImagePreference) {
        if (aiResponse.shouldUpdateCoach) {
          if (aiResponse.customCoachId || aiResponse.customCoachHandle) {
            let customId = aiResponse.customCoachId;
            if (!customId && aiResponse.customCoachHandle) {
              const handle = aiResponse.customCoachHandle.replace(/^@/, '');
              const { data: match, error: hErr } = await supabase
                .from('coach_profiles')
                .select('id')
                .ilike('handle', handle)
                .eq('public', true)
                .eq('active', true)
                .limit(1)
                .maybeSingle();
              if (!hErr && match) customId = match.id;
            }
            if (customId) {
              updateData.coach_type = 'custom';
              updateData.custom_coach_id = customId;
              updateData.coach = null;
            }
          } else if (aiResponse.coachType) {
            updateData.coach = aiResponse.coachType;
            updateData.coach_type = 'predefined';
            updateData.custom_coach_id = null;
          }
        }

        if (aiResponse.shouldUpdateSpice && aiResponse.spiceLevel) {
          updateData.spice_level = aiResponse.spiceLevel;
        }

        if (aiResponse.shouldUpdateImagePreference && aiResponse.imagePreference) {
          updateData.image_preference = aiResponse.imagePreference;
        }

        if (Object.keys(updateData).length > 0) {
          const { error: updateError } = await supabase
            .from('user_profiles')
            .update(updateData)
            .eq('phone_number', normalizedPhoneNumber);

          if (updateError) {
            console.error('Error updating user preferences:', updateError);
          } else {
            console.log('Updated user preferences:', updateData);
          }
        }
      }

      // Unify voice: for custom coaches, generate reply via coach-response-generator path
      const effectiveUserData = { ...userData, ...updateData };
      if (effectiveUserData.coach_type === 'custom' && effectiveUserData.custom_coach_id) {
        try {
          responseMessage = await generateCoachResponse(
            messageBody,
            effectiveUserData.spice_level,
            conversationHistory,
            effectiveUserData
          );
        } catch (error) {
          console.error('Custom coach generation failed, falling back to parsed response:', error);
          responseMessage = aiResponse.customerResponse;
        }
      } else {
        // Predefined coaches keep existing path
        responseMessage = aiResponse.customerResponse;
      }
    }

    await storeConversation(normalizedPhoneNumber, responseMessage, 'assistant');

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(responseMessage);

    res.type('text/xml');
    res.send(twiml.toString());
    
    console.log('SMS processing completed successfully');
    
  } catch (error) {
    console.error('Error in SMS processing:', error);
    
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("I'm having some technical difficulties right now. Please try again later! 💪");
    
    res.type('text/xml');
    res.send(twiml.toString());
  }
}; 
