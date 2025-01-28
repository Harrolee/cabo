const OpenAI = require('openai');
const { z } = require('zod');
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

    // Use our new retry mechanism
    const parsedResponse = await getValidAIResponse(userMessage);

    // Send a confirmation message back to the user
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await twilioClient.messages.create({
      body: parsedResponse.customerResponse,
      to: userPhone,
      from: process.env.TWILIO_PHONE_NUMBER,
    });

    // Format phone number by removing '+1' country code
    const formattedPhone = userPhone.replace('+1', '');

    // Check if the user exists
    const { data: existingUser, error: fetchError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('phone_number', formattedPhone)
      .single();

    if (fetchError) {
      console.error('Error fetching user:', fetchError);
      throw fetchError;
    }

    if (!existingUser) {
      console.log(`No profile found for phone number: ${formattedPhone}. Skipping update.`);
      return res.status(200).send('OK');
    }

    console.log('Existing user found, updating profile');

    // Update the database based on the parsed response
    if (existingUser) {
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
          .eq('phone_number', formattedPhone);

        if (updateError) {
          console.error('Error updating user profile:', updateError);
          throw updateError;
        }

        console.log(`Successfully updated profile for ${formattedPhone}`, updates);
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing SMS:', error);
    res.status(500).send('Internal Server Error');
  }
}; 
