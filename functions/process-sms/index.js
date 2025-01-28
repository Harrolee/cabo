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
  spiceLevel: z.number().min(1).max(5).int(),
  shouldUpdateImagePreference: z.boolean(),
  imagePreference: z.string(),
  customerResponse: z.string()
});

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

    // Send message to OpenAI with specific prompt
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
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
  "spiceLevel": number (1-5),
  "shouldUpdateImagePreference": boolean,
  "imagePreference": string,
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
      ],
      temperature: 0.7,
    });

    const aiResponse = completion.choices[0].message.content;
    console.log('OpenAI response:', aiResponse);

    // Parse and validate the JSON response
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(aiResponse);
      responseSchema.parse(parsedResponse);
    } catch (error) {
      console.error('JSON parsing or validation error:', error);
      throw new Error('Invalid response format from AI');
    }

    // Send a confirmation message back to the user
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await twilioClient.messages.create({
      body: parsedResponse.customerResponse + ` (Spice Level: ${parsedResponse.spiceLevel}/5) 💪`,
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
