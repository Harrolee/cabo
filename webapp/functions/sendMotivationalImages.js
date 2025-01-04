const { Twilio } = require("twilio");
const { createClient } = require("@supabase/supabase-js");
const Replicate = require("replicate");

// Initialize Twilio client
const twilioClient = new Twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Initialize Supabase client
const supabaseClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Generate images using Replicate API
async function generateMotivationalImages(prompt = "A motivational fitness scene with dynamic lighting and inspiring atmosphere, photorealistic") {
  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
  });

  try {
    const output = await replicate.run(
      "stability-ai/stable-diffusion:db21e45d3f7023abc2a46ee38a23973f6dce16bb082a930b0c49861f96d1e5bf",
      {
        input: {
          prompt: prompt,
          num_outputs: 2,
          guidance_scale: 7.5,
          num_inference_steps: 50
        }
      }
    );

    // Replicate returns an array of image URLs directly
    return output;
  } catch (error) {
    console.error("Error generating images:", error);
    throw error;
  }
}

// Function to send images via SMS
async function sendImagesToUser(phoneNumber, images) {
  try {
    for (const imageUrl of images) {
      await twilioClient.messages.create({
        body: "Here's your daily motivation! 💪",
        mediaUrl: [imageUrl],
        to: phoneNumber,
        from: process.env.TWILIO_PHONE_NUMBER,
      });
      // Add a small delay between messages to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error(`Error sending SMS to ${phoneNumber}:`, error);
    throw error;
  }
}

exports.sendMotivationalImages = async (event, context) => {
  try {
    // 1. Generate motivational images
    const images = await generateMotivationalImages();
    
    if (!images || images.length === 0) {
      throw new Error("No images were generated");
    }

    // 2. Get all users from the database
    const { data: users, error } = await supabaseClient
      .from("user_profile")
      .select("phone_number, name")
      .eq("active", true);  // Only select active users

    if (error) {
      throw new Error(`Error fetching users: ${error.message}`);
    }

    if (!users || users.length === 0) {
      return {
        statusCode: 200,
        body: "No active users found to send images to",
      };
    }

    // 3. Send images to each user
    const sendPromises = users.map((user) =>
      sendImagesToUser(user.phone_number, images)
    );

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
