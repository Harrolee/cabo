const { Storage } = require('@google-cloud/storage');
const Replicate = require('replicate');

const storage = new Storage();
const projectId = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
const bucketName = `${projectId}-image-bucket`;

// Constants for negative prompts
const NEGATIVE_PROMPT_BEFORE = ', athletic, muscular, ripped, strong, confident, joyful, smiling';
const NEGATIVE_PROMPT_AFTER = ', weak, frail, sad, nervous, anxious, dark, gloomy, skinny, thin';
const NEGATIVE_PROMPT_COMMON = 'nsfw, lowres, nudity, nude, naked, bad anatomy, bad hands, bad eyes,text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry';
const negative_prompt = (isBeforeImage) => `${NEGATIVE_PROMPT_COMMON}${isBeforeImage ? NEGATIVE_PROMPT_BEFORE : NEGATIVE_PROMPT_AFTER}`;

const PHOTOMAKER_STYLES = [
  'Cinematic',
  'Disney Charactor',
  'Fantasy art',
  'Enhance',
  'Comic book',
  'Line art',
  'Digital Art',
];

const IMAGE_MODELS = {
  STYLE: {
    id: "tencentarc/photomaker-style:467d062309da518648ba89d226490e02b8ed09b5abc15026e54e31c5a8cd0769",
    getInput: (prompt, userPhotoUrl, style, isBeforeImage = false) => ({
      prompt: prompt + "perfect eyes, natural skin",
      num_steps: 50,
      input_image: userPhotoUrl,
      num_outputs: 1,
      style_name: style,
      style_strength_ratio: 35,
      negative_prompt: negative_prompt(isBeforeImage),
      disable_safety_checker: true
    }),
    requiresImage: true
  },
  REALISTIC: {
    id: "tencentarc/photomaker:ddfc2b08d209f9fa8c1eca692712918bd449f695dabb4a958da31802a9570fe4",
    getInput: (prompt, userPhotoUrl, style, isBeforeImage = false) => ({
      prompt: prompt + "perfect eyes, natural skin",
      num_steps: 50,
      input_image: userPhotoUrl,
      num_outputs: 1,
      negative_prompt: negative_prompt(isBeforeImage),
      disable_safety_checker: true
    }),
    requiresImage: true
  },
  BACKUP: {
    id: "grandlineai/instant-id-artistic:9cad10c7870bac9d6b587f406aef28208f964454abff5c4152f7dec9b0212a9a",
    getInput: (prompt, userPhotoUrl, style, isBeforeImage = false) => ({
      image: userPhotoUrl,
      prompt: prompt + "perfect eyes, natural skin",
      negative_prompt: "cgi, render, bad quality, bad eyes, bad hands, worst quality, text, signature, watermark, extra limbs, unaestheticXL_hk1, negativeXL_D" + (isBeforeImage ? NEGATIVE_PROMPT_BEFORE : NEGATIVE_PROMPT_AFTER)
    }),
    requiresImage: true
  },
  REALVIS: {
    id: "lucataco/realvisxl-v2.0:7d6a2f9c4754477b12c14ed2a58f89bb85128edcdd581d24ce58b6926029de08",
    getInput: (prompt, userPhotoUrl, style, isBeforeImage = false) => ({
      seed: Math.floor(Math.random() * 1000000000),
      width: 1024,
      height: 1024,
      prompt: prompt + " perfect eyes, natural skin",
      scheduler: "DPMSolverMultistep",
      lora_scale: 0.6,
      num_outputs: 1,
      guidance_scale: 7,
      apply_watermark: true,
      negative_prompt: negative_prompt(isBeforeImage),
      prompt_strength: 0.8,
      num_inference_steps: 40,
      disable_safety_checker: true
    }),
    requiresImage: false
  }
};

function selectRandomImageStyle() {
  const useRealisticModel = Math.random() < 0.3;
  
  if (useRealisticModel) {
    return {
      model: IMAGE_MODELS.REALISTIC,
      style: null,
      description: 'Realistic'
    };
  }

  const randomStyle = PHOTOMAKER_STYLES[Math.floor(Math.random() * PHOTOMAKER_STYLES.length)];
  return {
    model: IMAGE_MODELS.STYLE,
    style: randomStyle,
    description: randomStyle
  };
}

async function saveImageToBucket(imageUrl, filename) {
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(`generated-images/${filename}`);
  
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    
    const buffer = await response.blob();
    const writeStream = file.createWriteStream({
      metadata: {
        contentType: 'image/png',
        cacheControl: 'public, max-age=3600',
      },
      resumable: false
    });

    return new Promise(async (resolve, reject) => {
      writeStream.on('finish', () => {
        resolve(`https://storage.googleapis.com/${bucketName}/generated-images/${filename}`);
      });
      
      writeStream.on('error', (error) => {
        console.error(`Error writing to bucket for ${filename}:`, error);
        reject(error);
      });
      
      try {
        const reader = buffer.stream().getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            writeStream.end();
            break;
          }
          if (!writeStream.write(value)) {
            await new Promise(resolve => writeStream.once('drain', resolve));
          }
        }
      } catch (error) {
        writeStream.destroy(error);
        reject(error);
      }
    });
  } catch (error) {
    console.error('Error saving image to bucket:', error);
    console.error('Failed image details:', { imageUrl, filename });
    throw error;
  }
}

async function checkForUserPhoto(phoneNumber) {
  const bucket = storage.bucket(`${projectId}-${process.env.CONVERSATION_BUCKET_NAME}`);
  
  try {
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

async function generateImage(replicate, model, prompt, userPhotoUrl, style, isBeforeImage) {
  const maxRetries = 3;
  const retryDelay = 5000; // 5 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Generating image with prompt (attempt ${attempt}/${maxRetries}):`, prompt);
      console.log('Using model:', model.id);

      const output = await replicate.run(
        model.id,
        {
          input: model.getInput(prompt, userPhotoUrl, style, isBeforeImage)
        }
      );

      if (!output || output.length === 0) {
        throw new Error('Model returned no output');
      }

      return output[0];
    } catch (error) {
      const isPaymentError = error.message?.includes('Payment Required') || 
                           error.message?.includes('spend limit');
      
      if (isPaymentError || attempt === maxRetries) {
        throw error;
      }

      console.warn(`Attempt ${attempt} failed:`, error.message);
      console.log(`Retrying in ${retryDelay/1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}

async function generateMotivationalImages(phoneNumber, beforePrompt, afterPrompt, imageStyle) {
  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
  });

  try {
    const userPhotoUrl = await checkForUserPhoto(phoneNumber);
    const hasUserPhoto = !!userPhotoUrl;
    
    // Select appropriate model based on whether we have a user photo
    const model = hasUserPhoto ? imageStyle.model : IMAGE_MODELS.REALVIS;
    const style = hasUserPhoto ? imageStyle.style : null;

    console.log('Selected model configuration:', {
      modelId: model.id,
      style,
      hasUserPhoto,
      beforePrompt,
      afterPrompt
    });

    // Generate before and after images in parallel
    const [beforeUrl, afterUrl] = await Promise.all([
      // Generate and save "before" image
      generateImage(replicate, model, beforePrompt, userPhotoUrl, style, true)
        .then(imageUrl => saveImageToBucket(imageUrl, `motivation-${Date.now()}-before.png`))
        .catch(async error => {
          console.error('Error generating before image with primary model, trying backup:', error);
          if (hasUserPhoto) {
            const backupUrl = await generateImage(replicate, IMAGE_MODELS.BACKUP, beforePrompt, userPhotoUrl, style, true);
            return saveImageToBucket(backupUrl, `motivation-${Date.now()}-before.png`);
          }
          throw error;
        }),

      // Generate and save "after" image
      generateImage(replicate, model, afterPrompt, userPhotoUrl, style, false)
        .then(imageUrl => saveImageToBucket(imageUrl, `motivation-${Date.now()}-after.png`))
        .catch(async error => {
          console.error('Error generating after image with primary model, trying backup:', error);
          if (hasUserPhoto) {
            const backupUrl = await generateImage(replicate, IMAGE_MODELS.BACKUP, afterPrompt, userPhotoUrl, style, false);
            return saveImageToBucket(backupUrl, `motivation-${Date.now()}-after.png`);
          }
          throw error;
        })
    ]);

    console.log('Successfully generated both images:', { beforeUrl, afterUrl });
    return [beforeUrl, afterUrl];
  } catch (error) {
    console.error("Error in generateMotivationalImages:", error);
    throw error;
  }
}

module.exports = {
  generateMotivationalImages,
  selectRandomImageStyle,
  saveImageToBucket,
  checkForUserPhoto
}; 