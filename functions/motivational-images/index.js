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

// Constants
const TRIAL_DURATION_DAYS = 3;
const DEFAULT_SPICE_LEVEL = 2;
const MESSAGES = {
  PAYMENT_LINK: '🏖️ Love your daily beach motivation? Keep the gains coming! Click here to continue your CaboFit journey: {paymentLink}',
};

/**
 * @typedef {Object} UserSubscription
 * @property {string} status - The subscription status ('trial' or 'active')
 * @property {string} trial_start_timestamp - ISO timestamp when trial started
 */

/**
 * @typedef {Object} UserProfile
 * @property {string} phone_number - User's phone number
 * @property {string} email - User's email
 * @property {string} full_name - User's full name
 * @property {number} spice_level - Message spice level (1-5)
 * @property {string} image_preference - User's image preference
 * @property {UserSubscription[]} subscriptions - User's subscription data
 */

/**
 * Calculates the number of days since trial start
 * @param {string} trialStartTimestamp - ISO timestamp of trial start
 * @returns {number} Number of days since trial started
 */
function getDaysSinceTrialStart(trialStartTimestamp) {
  const trialStart = new Date(trialStartTimestamp);
  return Math.floor((new Date() - trialStart) / (1000 * 60 * 60 * 24));
}

/**
 * Sends a payment link message to the user
 * @param {string} phoneNumber - User's phone number
 * @param {string} email - User's email
 * @returns {Promise<void>}
 */
async function sendPaymentLinkMessage(phoneNumber, email) {
  const paymentLink = `https://cabo.fit?email=${encodeURIComponent(email)}`;
  await twilioClient.messages.create({
    body: MESSAGES.PAYMENT_LINK.replace('{paymentLink}', paymentLink),
    to: phoneNumber,
    from: process.env.TWILIO_PHONE_NUMBER,
  });
  console.log(`Sent payment link to ${phoneNumber}`);
}

/**
 * Determines user's subscription status and required action
 * @param {UserProfile} user - User profile data
 * @returns {{ shouldSendImages: boolean, shouldSendPaymentLink: boolean }}
 */
function getUserStatus(user) {
  const subscription = Array.isArray(user.subscriptions) 
    ? user.subscriptions[0] 
    : user.subscriptions;

  if (!subscription || !subscription.status) {
    return { shouldSendImages: false, shouldSendPaymentLink: false };
  }

  const daysSinceTrialStart = getDaysSinceTrialStart(subscription.trial_start_timestamp);

  // Active trial period (days 1-3)
  if (subscription.status === 'trial' && daysSinceTrialStart < TRIAL_DURATION_DAYS) {
    console.log(`User ${user.phone_number} is in active trial period`);
    return { shouldSendImages: true, shouldSendPaymentLink: false };
  }

  // Payment link day (day 4)
  if (subscription.status === 'trial' && daysSinceTrialStart === TRIAL_DURATION_DAYS) {
    console.log(`User ${user.phone_number} is on payment link day`);
    return { shouldSendImages: false, shouldSendPaymentLink: true };
  }

  // Expired trial
  if (subscription.status === 'trial' && daysSinceTrialStart > TRIAL_DURATION_DAYS) {
    console.log(`User ${user.phone_number} has expired trial`);
    return { shouldSendImages: false, shouldSendPaymentLink: false };
  }

  // Active subscription
  console.log(`User ${user.phone_number} has status: ${subscription.status}`);
  return { 
    shouldSendImages: subscription.status === 'active', 
    shouldSendPaymentLink: false 
  };
}

/**
 * Processes a single user - generates and sends appropriate content
 * @param {UserProfile} user - User profile data
 * @returns {Promise<void>}
 */
async function processUser(user) {
  try {
    const { shouldSendImages, shouldSendPaymentLink } = getUserStatus(user);

    if (shouldSendPaymentLink) {
      await sendPaymentLinkMessage(user.phone_number, user.email);
      return;
    }

    if (shouldSendImages) {
      const images = await generateMotivationalImages(user.image_preference, user.phone_number);
      
      if (!images || images.length === 0) {
        throw new Error(`No images were generated for user ${user.phone_number}`);
      }

      await sendImagesToUser(
        user.phone_number, 
        images, 
        user.spice_level || DEFAULT_SPICE_LEVEL
      );

      console.log(`Successfully sent images to ${user.phone_number}`);
    }
  } catch (error) {
    console.error(`Error processing user ${user.phone_number}:`, error);
    // Continue with other users even if one fails
  }
}

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

async function checkForUserPhoto(phoneNumber) {
  const bucket = storage.bucket(`${projectId}-${process.env.CONVERSATION_BUCKET_NAME}`);
  
  try {
    // Check for image file in the user's images directory
    const [files] = await bucket.getFiles({
      prefix: `${phoneNumber}/images/profile.`
    });
    
    if (files.length > 0) {
      const file = files[0];
      const [signedUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 15 * 60 * 1000 // 15 minutes
      });
      console.log(`Found user photo for ${phoneNumber} at ${file.name}`);
      return signedUrl;
    }
    console.log(`No user photo found for ${phoneNumber}`);
    return null;
  } catch (error) {
    console.error(`Error checking for user photo: ${error}`);
    return null;
  }
}

const PHOTOMAKER_STYLES = [
  'Cinematic',
  'Disney Character',
  'Digital Art',
  'Photographic',
  'Fantasy art',
  'Neonpunk',
  'Enhance',
  'Comic book',
  'Lowpoly',
  'Line art'
];

const IMAGE_MODELS = {
  STYLE: {
    id: "tencentarc/photomaker-style:467d062309da518648ba89d226490e02b8ed09b5abc15026e54e31c5a8cd0769",
    getInput: (prompt, userPhotoUrl, style, isBeforeImage = false) => ({
      prompt,
      num_steps: 50,
      input_image: userPhotoUrl,
      num_outputs: 1,
      style_name: style,
      style_strength_ratio: 35,
      negative_prompt: `nsfw, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry${isBeforeImage ? ', athletic, muscular, ripped' : ''}`
    })
  },
  REALISTIC: {
    id: "tencentarc/photomaker:ddfc2b08d209f9fa8c1eca692712918bd449f695dabb4a958da31802a9570fe4",
    getInput: (prompt, userPhotoUrl, style, isBeforeImage = false) => ({
      prompt,
      num_steps: 50,
      input_image: userPhotoUrl,
      num_outputs: 1,
      negative_prompt: `nsfw, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry${isBeforeImage ? ', athletic, muscular, ripped' : ''}`
    })
  }
};

function selectRandomImageStyle() {
  // 30% chance of getting realistic model
  const useRealisticModel = Math.random() < 0.3;
  
  if (useRealisticModel) {
    return {
      model: IMAGE_MODELS.REALISTIC,
      style: null,
      description: 'Realistic'
    };
  }

  // Otherwise use style model with random style
  const randomStyle = PHOTOMAKER_STYLES[Math.floor(Math.random() * PHOTOMAKER_STYLES.length)];
  return {
    model: IMAGE_MODELS.STYLE,
    style: randomStyle,
    description: randomStyle
  };
}

async function generateMotivationalImages(imagePreference, phoneNumber) {
  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
  });

  try {
    // Default to diverse representation if no preference specified
    const preference = imagePreference || "ambiguously non-white male";
    const actionModifier = await generateActionModifier();
    const randomSeed = Math.floor(Math.random() * 1000000000);
    
    // Check if user has uploaded a photo
    const userPhotoUrl = await checkForUserPhoto(phoneNumber);
    
    if (userPhotoUrl) {
      console.log(`Generating personalized images for user ${phoneNumber}`);
      
      // Select one random style for both images
      const imageStyle = selectRandomImageStyle();
      console.log(`Using style: ${imageStyle.description} for both images`);

      // Generate "before" image - regular body type version of user
      const beforeOutput = await replicate.run(
        imageStyle.model.id,
        {
          input: imageStyle.model.getInput(
            `A photo of a ${preference} img with a regular body type, on the beach, wearing beach attire, ${actionModifier}, photorealistic style`,
            userPhotoUrl,
            imageStyle.style,
            true // isBeforeImage = true
          )
        }
      );

      // Save before image first
      const beforeUrl = await saveImageToBucket(
        beforeOutput[0], 
        `motivation-${Date.now()}-before.png`
      );

      // Generate "after" image - athletic version of user
      const afterOutput = await replicate.run(
        imageStyle.model.id,
        {
          input: imageStyle.model.getInput(
            `A photo of an athletic and fit ${preference} img, on the beach, wearing beach attire, ${actionModifier}, photorealistic style`,
            userPhotoUrl,
            imageStyle.style,
            false // isBeforeImage = false
          )
        }
      );

      // Save after image second
      const afterUrl = await saveImageToBucket(
        afterOutput[0],
        `motivation-${Date.now()}-after.png`
      );

      return [beforeUrl, afterUrl];
    }

    // If no user photo, use existing flow with RealVisXL model
    const beforeOutput = await replicate.run(
      "lucataco/realvisxl-v2.0:7d6a2f9c4754477b12c14ed2a58f89bb85128edcdd581d24ce58b6926029de08",
      {
        input: {
          seed: randomSeed,
          width: 1024,
          height: 1024,
          prompt: `A realistic photo of a ${preference} with a regular body type, slightly pudgy, on the beach, wearing swim trunks and beach attire, photorealistic style, ${actionModifier}`,
          lora_scale: 0.6,
          scheduler: "DPMSolverMultistep",
          num_outputs: 1,
          guidance_scale: 7,
          apply_watermark: true,
          negative_prompt: "nsfw, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, athletic, muscular, ripped",
          prompt_strength: 0.8,
          num_inference_steps: 40
        }
      }
    );

    // Save before image first
    const beforeUrl = await saveImageToBucket(
      beforeOutput[0],
      `motivation-${Date.now()}-before.png`
    );

    const afterOutput = await replicate.run(
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
          negative_prompt: "nsfw, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry",
          prompt_strength: 0.8,
          num_inference_steps: 40
        }
      }
    );

    // Save after image second
    const afterUrl = await saveImageToBucket(
      afterOutput[0],
      `motivation-${Date.now()}-after.png`
    );

    return [beforeUrl, afterUrl];
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

The message should:
1. Reference both the 'before' and 'after' states
2. Include a prompt for the user to text back AFTER completing today's workout
3. Never use offensive language or body-shaming
4. Use emojis appropriately for the spice level
5. You can mock yourself and you can mock the user if appropriate, but NEVER mock marginalized groups, disabilities, religions, or historically abused people.`
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
      1: "Every step of your journey matters. Listen to your body and celebrate your progress! Text me after your workout today 🧘‍♀️✨",
      2: "LETS GET THESE GAINS FAM! You're crushing it! 💪 Hit me up after your workout today!",
      3: "Oh honey... look at you werking it! That's giving transformation energy! 💃✨ Text me after today's sweat sesh!",
      4: "MISSION STATUS: TRANSFORMATION IN PROGRESS! REPORT BACK AFTER TODAY'S TRAINING, SOLDIER! 🫡",
      5: "ABSOLUTE UNIT ALERT!!! BUILT: DIFFERENT 😤 MISSION: CRUSH TODAY'S WORKOUT 💪 YO TEXT ME AFTER YOU DEMOLISH IT!!!"
    };
    return fallbackMessages[spiceLevel] || fallbackMessages[3];
  }
}

// Add function to store conversation in GCS
async function storeConversation(phoneNumber, message, role = 'assistant') {
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

  } catch (error) {
    console.error(`Error storing conversation for ${phoneNumber}:`, error);
    throw error;
  }
}

async function sendImagesToUser(phoneNumber, images, spiceLevel) {
  try {
    const message = await generateMotivationalMessage(spiceLevel);
    
    // Send before image first
    await twilioClient.messages.create({
      body: "Your starting point... 🌅",
      mediaUrl: [images[0]],
      to: phoneNumber,
      from: process.env.TWILIO_PHONE_NUMBER,
    });

    // Wait a short moment to ensure order
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Send after image with the motivational message
    await twilioClient.messages.create({
      body: message,
      mediaUrl: [images[1]],
      to: phoneNumber,
      from: process.env.TWILIO_PHONE_NUMBER,
    });

    // Store the message in conversation history
    await storeConversation(phoneNumber, message);
  } catch (error) {
    console.error(`Error sending SMS to ${phoneNumber}:`, error);
    throw error;
  }
}

exports.sendMotivationalImages = async (event, context) => {
  try {
    // Get all active users and their subscription status
    console.log('Starting to fetch active users');
    const { data: users, error } = await supabaseClient
      .from("user_profiles")
      .select(`
        phone_number, 
        full_name, 
        spice_level, 
        image_preference,
        email,
        subscription:subscriptions!user_phone(
          status,
          trial_start_timestamp
        )
      `)
      .eq("active", true);
    
    if (error) {
      console.error('Error fetching users:', error);
      throw new Error(`Error fetching users: ${error.message}`);
    }

    if (!users || users.length === 0) {
      console.log('No active users found');
      return {
        statusCode: 200,
        body: "No active users found to send images to",
      };
    }

    // Transform the data to match our expected structure
    const transformedUsers = users.map(user => ({
      ...user,
      subscriptions: user.subscription ? [user.subscription] : []
    }));

    // Process each user individually
    await Promise.all(transformedUsers.map(processUser));

    return {
      statusCode: 200,
      body: `Completed image generation and sending process for ${transformedUsers.length} users`,
    };
  } catch (error) {
    console.error("Error in sendMotivationalImages:", error);
    return {
      statusCode: 500,
      body: `Error: ${error.message}`,
    };
  }
};
