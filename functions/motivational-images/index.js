const { Twilio } = require("twilio");
const { createClient } = require("@supabase/supabase-js");
const Replicate = require("replicate");
const { Storage } = require('@google-cloud/storage');

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

async function sendImagesToUser(phoneNumber, images) {
  try {
    await twilioClient.messages.create({
      body: "You can be the wolf or you can wolf down nachos! Whichever wolf you feed wins! 💪",
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
