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
          content: "Generate a short, specific beach activity description (2-4 words) that would work well in both these contexts:\n1. 'A realistic photo of an overweight [preference] wearing beach clothes, [activity]'\n2. 'A realistic photo of a fit and athletic [preference] wearing beach clothes, [activity]'\nThe activity should be something active and photographable. Focus on activities like 'playing volleyball', 'running along shoreline', 'swimming in waves', 'doing beach yoga', etc."
        },
        {
          role: "user",
          content: "Generate a beach activity."
        }
      ],
      temperature: 1.0,
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
      "playing beach soccer",
      "doing beach pushups",
      "playing beach tennis",
      "tossing football",
      "stretching on beach",
      "doing beach sprints"
    ];
    return fallbackActions[Math.floor(Math.random() * fallbackActions.length)];
  }
}

async function generateMotivationalImages(imagePreference) {
  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
  });

  try {
    const actionModifier = await generateActionModifier();
    const randomSeed = Math.floor(Math.random() * 1000000000); // 1111316861 was the original seed

    // Default to diverse representation if no preference specified
    const preference = imagePreference || "ambiguously non-white male";
    
    const unfitOutput = await replicate.run(
      "lucataco/realvisxl-v2.0:7d6a2f9c4754477b12c14ed2a58f89bb85128edcdd581d24ce58b6926029de08",
      {
        input: {
          seed: randomSeed,
          width: 1024,
          height: 1024,
          prompt: `A realistic photo of an overweight ${preference}, on the beach, wearing swim trunks and beach attire, photorealistic style, ${actionModifier}`,
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
          prompt: `A realistic photo of a fit and athletic ${preference}, on the beach, wearing swim trunks and beach attire, photorealistic style, ${actionModifier}`,
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
          content: `You are a motivational fitness coach generating a message (max 160 characters) to accompany before/after fitness transformation images. Match this spice level ${spiceLevel}/5:

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

The message should reference both the 'before' and 'after' states. Never use offensive language or body-shaming. Use emojis appropriately for the spice level. You can mock yourself and you can mock the user if you think it's appropriate, but NEVER mock marginalized groups, disabilities, religions, or historically abused people.`
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
      1: "Every step of your journey matters. Listen to your body and celebrate your progress! 🧘‍♀️✨",
      2: "LETS GET THESE GAINS FAM! You're crushing it! 💪",
      3: "Oh honey... look at you werking it! That's giving transformation energy! 💃✨",
      4: "MISSION STATUS: TRANSFORMATION IN PROGRESS! KEEP PUSHING, SOLDIER! 🫡",
      5: "ABSOLUTE UNIT ALERT!!! BUILT: DIFFERENT 😤 MISSION: ACCOMPLISHED 💪 SWOLEPOCALYPSE: INITIATED"
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
      .select("phone_number, full_name, spice_level, image_preference")
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

    console.log(`Generating personalized images for ${users.length} users`);
    
    // Generate and send images for each user individually
    const sendPromises = users.map(async (user) => {
      try {
        const images = await generateMotivationalImages(user.image_preference);
        
        if (!images || images.length === 0) {
          throw new Error(`No images were generated for user ${user.phone_number}`);
        }

        await sendImagesToUser(
          user.phone_number, 
          images, 
          user.spice_level || 2
        );

        console.log(`Successfully sent images to ${user.phone_number}`);
      } catch (error) {
        console.error(`Error processing user ${user.phone_number}:`, error);
        // Continue with other users even if one fails
      }
    });
  
    await Promise.all(sendPromises);

    return {
      statusCode: 200,
      body: `Completed image generation and sending process for ${users.length} users`,
    };
  } catch (error) {
    console.error("Error in sendMotivationalImages:", error);
    return {
      statusCode: 500,
      body: `Error: ${error.message}`,
    };
  }
};
