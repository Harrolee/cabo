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

async function generateMotivationalImages() {
  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
  });

  try {
    const unfitOutput = await replicate.run(
      "lucataco/realvisxl-v2.0:7d6a2f9c4754477b12c14ed2a58f89bb85128edcdd581d24ce58b6926029de08",
      input={
          "seed": 1111316861,
          "width": 1024,
          "height": 1024,
          "prompt": "A realistic photo of an overweight man relaxing on a beach chair, wearing swim trunks, photorealistic style",
          "scheduler": "DPMSolverMultistep",
          "lora_scale": 0.6,
          "num_outputs": 1,
          "guidance_scale": 7,
          "apply_watermark": True,
          "negative_prompt": "(worst quality, low quality, illustration, 3d, 2d, painting, cartoons, sketch), open mouth, muscular, fit, athletic, ripped",
          "prompt_strength": 0.8,
          "num_inference_steps": 40
      }
    );
    const fitOutput = await replicate.run(
      "lucataco/realvisxl-v2.0:7d6a2f9c4754477b12c14ed2a58f89bb85128edcdd581d24ce58b6926029de08",
      input={
          "seed": 1111316861,
          "width": 1024,
          "height": 1024,
          "prompt": "A realistic photo of a muscular athletic man with six-pack abs standing confidently on a beach, wearing swim trunks, photorealistic style",
          "scheduler": "DPMSolverMultistep",
          "lora_scale": 0.6,
          "num_outputs": 1,
          "guidance_scale": 7,
          "apply_watermark": True,
          "negative_prompt": "(worst quality, low quality, illustration, 3d, 2d, painting, cartoons, sketch), open mouth, overweight, fat, unfit",
          "prompt_strength": 0.8,
          "num_inference_steps": 40
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

async function generateMotivationalMessage() {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a motivational fitness coach. Generate a short, engaging message (max 160 characters) to accompany before/after fitness transformation images. The message should be encouraging, slightly humorous, and mention both the 'before' and 'after' states. Don't use offensive language or body-shaming. Use emojis."
        },
        {
          role: "user",
          content: "Generate a motivational message for fitness transformation images."
        },
        {
          role: "assistant",
          content: "Examples of good messages:\n- You can be the wolf or you can wolf down nachos! Whichever wolf you feed wins! 💪\n- Left guy's ready for a nap. Right guy? Ready to crush it. You're somewhere in between — but guess what? You're moving in the right direction. Let's go!\n- The guy on the left started just like you. The guy on the right? Same path, same dedication — but the journey isn't a race, it's about YOU getting stronger, every day."
        }
      ],
      temperature: 0.7,
      max_tokens: 100,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error("Error generating message:", error);
    // Fallback message in case of API error
    return "Every step forward is progress. Keep pushing! 💪";
  }
}

async function sendImagesToUser(phoneNumber, images) {
  try {
    const message = await generateMotivationalMessage();
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
      .select("phone_number, full_name")
      .eq("active", true);
      console.log(`Got users`);
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
      sendImagesToUser(user.phone_number, images)
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
