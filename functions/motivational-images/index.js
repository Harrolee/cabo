const { Twilio } = require("twilio");
const { createClient } = require("@supabase/supabase-js");
const Replicate = require("replicate");
const { Storage } = require('@google-cloud/storage');
const OpenAI = require('openai');

const twilioClient = new Twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const supabaseClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const storage = new Storage();
const projectId = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
const bucketName = `${projectId}-image-bucket`;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function saveImageToBucket(imageUrl, filename) {
  try {
    const bucket = storage.bucket(bucketName);
    const response = await fetch(imageUrl);
    const buffer = await response.blob();
    
    const file = bucket.file(`generated-images/${filename}`);
    const writeStream = file.createWriteStream({
      metadata: {
        contentType: 'image/png',
        cacheControl: 'public, max-age=3600',
      },
    });

    const reader = buffer.stream().getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writeStream.write(value);
    }
    writeStream.end();

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    return `https://storage.googleapis.com/${bucketName}/generated-images/${filename}`;
  } catch (error) {
    console.error('Error saving image to bucket:', error);
    throw error;
  }
}

async function generateActionModifier() {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "Generate a short, specific beach activity description (2-4 words) that would work well in both these contexts:\n1. 'A realistic photo of an overweight man wearing swim trunks, [activity]'\n2. 'A realistic photo of a muscular athletic man wearing swim trunks, [activity]'\nThe activity should be something active and photographable, like 'playing volleyball' or 'running along shoreline'. Feel free to get creative and over the top here."
        },
        {
          role: "user",
          content: "Generate a beach activity."
        }
      ],
      temperature: 0.7,
      max_tokens: 50,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error("Error generating action modifier:", error);
    const fallbackActions = [
      "playing beach volleyball",
      "running along shoreline",
      "throwing a frisbee",
      "doing beach yoga",
      "surfing on waves",
      "playing in the waves",
      "building sandcastles",
      "jogging on sand",
      "swimming in ocean",
      "playing beach soccer"
    ];
    return fallbackActions[Math.floor(Math.random() * fallbackActions.length)];
  }
}

async function generateMotivationalImages() {
  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
  });

  try {
    const actionModifier = await generateActionModifier();
    const randomSeed = Math.floor(Math.random() * 1000000000); // 1111316861 was the original seed. Keep it in case the random seeds suck

    const unfitOutput = await replicate.run(
      "lucataco/realvisxl-v2.0:7d6a2f9c4754477b12c14ed2a58f89bb85128edcdd581d24ce58b6926029de08",
      {
        input: {
          seed: randomSeed,
          width: 1024,
          height: 1024,
          prompt: `A realistic photo of an overweight man wearing swim trunks, photorealistic style, ${actionModifier}`,
          scheduler: "DPMSolverMultistep",
          lora_scale: 0.6,
          num_outputs: 1,
          guidance_scale: 7,
          apply_watermark: true,
          negative_prompt: "(worst quality, low quality, illustration, 3d, 2d, painting, cartoons, sketch), open mouth, muscular, fit, athletic, ripped",
          prompt_strength: 0.8,
          num_inference_steps: 40
        }
      }
    );
    const fitOutput = await replicate.run(
      "lucataco/realvisxl-v2.0:7d6a2f9c4754477b12c14ed2a58f89bb85128edcdd581d24ce58b6926029de08",
      {
        input: {
          seed: randomSeed,
          width: 1024,
          height: 1024,
          prompt: `A realistic photo of a muscular athletic man with six-pack abs wearing swim trunks, photorealistic style, ${actionModifier}`,
          scheduler: "DPMSolverMultistep",
          lora_scale: 0.6,
          num_outputs: 1,
          guidance_scale: 7,
          apply_watermark: true,
          negative_prompt: "(worst quality, low quality, illustration, 3d, 2d, painting, cartoons, sketch), open mouth, overweight, fat, unfit",
          prompt_strength: 0.8,
          num_inference_steps: 40
        }
      }
    );

    const outputs = [...unfitOutput, ...fitOutput];
    const publicUrls = await Promise.all(
      outputs.map((output, index) => 
        saveImageToBucket(output, `motivation-${Date.now()}-${index}.png`)
      )
    );

    return publicUrls;
  } catch (error) {
    console.error("Error generating images:", error);
    throw error;
  }
}

async function generateMotivationalMessage(spiceLevel) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are a motivational fitness coach generating a message (max 160 characters) to accompany before/after fitness transformation images. Generate a message matching spice level ${spiceLevel}/5:

1: gentle and encouraging, focus on health and wellbeing
2: slightly motivational, focus on progress and consistency
3: sassy dance teacher energy (passive-aggressive, pushing you because "you can do better", mix of encouragement and sass, phrases like "Oh honey..." and "I KNOW you can do better than THAT")
4: high energy gym bro (caps, emojis, phrases like 'CRUSH IT', 'GET AFTER IT', 'NO EXCUSES')
5: ULTRA toxic gym bro (ridiculous, over-the-top, phrases like 'ABSOLUTE UNIT', 'BEAST MODE', random noises like 'AUUUGH', nonsensical motivational phrases)

The message should reference both the 'before' and 'after' states. Never use offensive language or body-shaming. Use emojis appropriately for the spice level. NEVER mock marginalized groups, disabilities, religions, or historically abused people.`
        },
        {
          role: "user",
          content: "Generate a motivational message for fitness transformation images."
        }
      ],
      temperature: 0.7,
      max_tokens: 100,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error("Error generating message:", error);
    // Fallback messages based on spice level
    const fallbackMessages = {
      1: "Every step forward is progress. You're on a journey to a healthier you! 💫",
      2: "Keep pushing! Small changes lead to big results 💪",
      3: "Oh honey... I've seen what you can do and this is NOT it. But we're getting there! 💅✨",
      4: "CRUSH IT! Time to level up! NO EXCUSES, ONLY RESULTS! 💪😤",
      5: "AUUUGH! BEAST MODE ENGAGED! YOU'RE BUILT DIFFERENT! 😤💪🦍"
    };
    return fallbackMessages[spiceLevel] || fallbackMessages[3];
  }
}

async function sendImagesToUser(phoneNumber, images, spiceLevel) {
  try {
    const message = await generateMotivationalMessage(spiceLevel);
    await twilioClient.messages.create({
      body: message,
      mediaUrl: images,
      to: phoneNumber,
      from: process.env.TWILIO_PHONE_NUMBER,
    });
  } catch (error) {
    console.error(`Error sending SMS to ${phoneNumber}:`, error);
    throw error;
  }
}

exports.sendMotivationalImages = async (event, context) => {
  try {
    const { data: users, error } = await supabaseClient
      .from("user_profiles")
      .select("phone_number, full_name, spice_level")
      .eq("active", true);
    
    if (error) {
      throw new Error(`Error fetching users: ${error.message}`);
    }

    if (!users || users.length === 0) {
      return {
        statusCode: 200,
        body: "No active users found to send images to",
      };
    }

    const images = await generateMotivationalImages();
    
    if (!images || images.length === 0) {
      throw new Error("No images were generated");
    }

    console.log(`constructing promises`);
    
    const sendPromises = users.map((user) =>
      sendImagesToUser(
        user.phone_number, 
        images, 
        user.spice_level || 3 // Default to level 3 if not set
      )
    );
  
    console.log(`sending images`);
    await Promise.all(sendPromises);

    return {
      statusCode: 200,
      body: `Successfully sent images to ${users.length} users`,
    };
  } catch (error) {
    console.error("Error in sendMotivationalImages:", error);
    return {
      statusCode: 500,
      body: `Error: ${error.message}`,
    };
  }
};
