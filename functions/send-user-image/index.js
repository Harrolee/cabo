const { Storage } = require('@google-cloud/storage');
const Replicate = require('replicate');
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

const storage = new Storage();
const projectId = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
const bucketName = `${projectId}-image-bucket`;

// Import image generation utilities
const {
  IMAGE_MODELS,
  PHOTOMAKER_STYLES,
  selectRandomImageStyle,
  generateImage,
  saveImageToBucket,
  checkForUserPhoto
} = require('./image-generation');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Handles generating and sending an image to a user
 * @param {Object} req Cloud Function request context
 * @param {Object} res Cloud Function response context
 */
exports.sendUserImage = async (req, res) => {
  try {
    // Validate request
    const { phoneNumber, prompt, message, useUserPhoto = true } = req.body;
    
    if (!phoneNumber || !prompt) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: phoneNumber and prompt are required'
      });
    }

    // Get user data for coach preferences
    const { data: userData, error: userError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('phone_number', phoneNumber)
      .single();

    if (userError || !userData) {
      console.error('Error fetching user data:', userError);
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Initialize Replicate client
    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });

    // Get user's photo if needed
    let userPhotoUrl = null;
    if (useUserPhoto) {
      userPhotoUrl = await checkForUserPhoto(phoneNumber);
    }
    const hasUserPhoto = !!userPhotoUrl;

    // Select appropriate style and model
    const imageStyle = selectRandomImageStyle();
    const model = hasUserPhoto ? imageStyle.model : IMAGE_MODELS.REALVIS;
    const style = hasUserPhoto ? imageStyle.style : null;

    console.log('Selected model configuration:', {
      modelId: model.id,
      style,
      hasUserPhoto,
      prompt
    });

    // Generate image
    const imageUrl = await generateImage(replicate, model, prompt, userPhotoUrl, style, false)
      .then(url => saveImageToBucket(url, `generated-${Date.now()}.png`))
      .catch(async error => {
        console.error('Error generating image with primary model, trying backup:', error);
        if (hasUserPhoto) {
          const backupUrl = await generateImage(replicate, IMAGE_MODELS.BACKUP, prompt, userPhotoUrl, style, false);
          return saveImageToBucket(backupUrl, `generated-${Date.now()}.png`);
        }
        throw error;
      });

    // Send via Twilio if message is provided
    if (message) {
      const twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );

      await twilioClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phoneNumber,
        mediaUrl: [imageUrl]
      });
    }

    res.json({
      success: true,
      imageUrl,
      style: imageStyle.description
    });

  } catch (error) {
    console.error('Error in sendUserImage:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}; 