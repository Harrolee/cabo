const { Twilio } = require("twilio");
const { createClient } = require("@supabase/supabase-js");

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

// Placeholder function for image generation API
async function generateMotivationalImages() {
  // TODO: Replace with actual API call to image generation service
  return [
    "https://placeholder.com/motivation1.jpg",
    "https://placeholder.com/motivation2.jpg",
  ];
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
    }
  } catch (error) {
    console.error(`Error sending SMS to ${phoneNumber}:`, error);
  }
}

exports.sendMotivationalImages = async (event, context) => {
  try {
    // 1. Generate motivational images
    const images = await generateMotivationalImages();

    // 2. Get all users from the database
    const { data: users, error } = await supabaseClient
      .from("user_profile")
      .select("phone_number, name");

    if (error) {
      throw new Error(`Error fetching users: ${error.message}`);
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
