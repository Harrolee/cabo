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

// Zod schema for validating OpenAI response
const responseSchema = z.object({
  spiceLevel: z.number().min(1).max(5).int(),
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
          content: "You are an AI that analyzes user responses to the question 'How 🌶️SPICY🌶️ do you like your workout motivation messages?\n< 1 - 5 >, < PT Clinic - Psycho Frat Bro >?' You must respond with JSON in the format {\"spiceLevel\": X, \"customerResponse\": \"message\"} where X is a number from 1-5. The customerResponse should be a short, fun confirmation matching their preferred spice level:\n\n1: gentle and encouraging, focus on health and wellbeing\n2: slightly motivational, focus on progress and consistency\n3: sassy dance teacher energy (passive-aggressive, pushing you because \"you can do better\", mix of encouragement and sass, phrases like \"Oh honey...\" and \"I KNOW you can do better than THAT\")\n4: high energy gym bro (caps, emojis, phrases like 'CRUSH IT', 'GET AFTER IT', 'NO EXCUSES')\n5 (ultra spicy): ULTRA toxic gym bro (ridiculous, over-the-top, phrases like 'ABSOLUTE UNIT', 'BEAST MODE ENGAGED', 'YOU'RE BUILT DIFFERENT', random noises like 'AUUUGH', nonsensical motivational phrases)\n\nOnly give level 5 if they explicitly request level 5 or ultra/extreme/insane spice. Base the spiceLevel on the user's message sentiment and content. Respond ONLY with the JSON."
        },
        {
          role: "user",
          content: `Question: How 🌶️SPICY🌶️ do you like your workout motivation messages?\n< 1 - 5 >, < PT Clinic - Psycho Frat Bro >?\nUser's response: ${userMessage}`
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

    // Store the spice level in Supabase
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ 
        spice_level: parsedResponse.spiceLevel,
        updated_at: new Date().toISOString()
      })
      .eq('phone_number', userPhone);

    if (updateError) {
      console.error('Error updating spice level:', updateError);
      throw updateError;
    }

    console.log(`Updated spice level to ${parsedResponse.spiceLevel} for user ${userPhone}`);

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing SMS:', error);
    res.status(500).send('Internal Server Error');
  }
}; 
