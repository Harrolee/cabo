const { Storage } = require('@google-cloud/storage');
const Replicate = require('replicate');

const storage = new Storage();
const projectId = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
const bucketName = `${projectId}-image-bucket`;
const contentBucketName = `${projectId}-coach-content`;

// Avatar styles (from motivational-images styles)
const AVATAR_STYLES = [
  'Digital Art',
  'Comic book', 
  'Disney Charactor', // Note: keeping original spelling from existing code
];

const AVATAR_MODELS = {
  STYLE: {
    id: "tencentarc/photomaker-style:467d062309da518648ba89d226490e02b8ed09b5abc15026e54e31c5a8cd0769",
    getInput: (prompt, userPhotoUrl, style) => ({
      prompt: prompt + " professional headshot, perfect eyes, natural skin, clean background",
      num_steps: 50,
      input_image: userPhotoUrl,
      num_outputs: 1,
      style_name: style,
      style_strength_ratio: 35,
      negative_prompt: "nsfw, lowres, nudity, nude, naked, bad anatomy, bad hands, bad eyes, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, casual clothes, gym clothes, workout clothes",
      disable_safety_checker: true
    }),
    requiresImage: true
  },
  REALISTIC: {
    id: "tencentarc/photomaker:ddfc2b08d209f9fa8c1eca692712918bd449f695dabb4a958da31802a9570fe4",
    getInput: (prompt, userPhotoUrl) => ({
      prompt: prompt + " professional headshot, perfect eyes, natural skin, clean background",
      num_steps: 50,
      input_image: userPhotoUrl,
      num_outputs: 1,
      negative_prompt: "nsfw, lowres, nudity, nude, naked, bad anatomy, bad hands, bad eyes, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, casual clothes, gym clothes, workout clothes",
      disable_safety_checker: true
    }),
    requiresImage: true
  }
};

const AVATAR_PROMPTS = {
  'Digital Art': 'professional fitness coach portrait, digital art style, confident expression, business casual attire',
  'Comic book': 'professional fitness coach portrait, comic book art style, heroic pose, confident expression',
  'Disney Charactor': 'professional fitness coach portrait, Disney animation style, friendly expression, professional attire'
};

async function saveImageToBucket(imageUrl, filename) {
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(`generated-images/coach-avatars/${filename}`);
  
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
        resolve(`https://storage.googleapis.com/${bucketName}/generated-images/coach-avatars/${filename}`);
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
    throw error;
  }
}

async function storeSelfie(coachId, imageBuffer, mimeType) {
  const bucket = storage.bucket(contentBucketName);
  const extension = mimeType.includes('jpeg') ? 'jpg' : 'png';
  const filename = `coach-content/${coachId}/selfie.${extension}`;
  const file = bucket.file(filename);
  
  try {
    await file.save(imageBuffer, {
      metadata: {
        contentType: mimeType,
        cacheControl: 'private, max-age=86400',
      },
      resumable: false
    });

    // Generate signed URL for internal use (24 hours)
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
    });

    return {
      storagePath: filename,
      signedUrl: signedUrl
    };
  } catch (error) {
    console.error('Error storing selfie:', error);
    throw error;
  }
}

async function generateAvatar(replicate, model, prompt, userPhotoUrl, style = null) {
  const maxRetries = 3;
  const retryDelay = 5000; // 5 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Generating avatar with prompt (attempt ${attempt}/${maxRetries}):`, prompt);
      console.log('Using model:', model.id);

      const output = await replicate.run(
        model.id,
        {
          input: model.getInput(prompt, userPhotoUrl, style)
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

async function generateCoachAvatars(coachId, imageBuffer, mimeType) {
  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
  });

  try {
    // Store the original selfie
    console.log(`Storing selfie for coach ${coachId}`);
    const selfieResult = await storeSelfie(coachId, imageBuffer, mimeType);
    
    // Generate avatars in each style
    console.log(`Generating avatars for coach ${coachId} in ${AVATAR_STYLES.length} styles`);
    const avatarResults = await Promise.allSettled(
      AVATAR_STYLES.map(async (style) => {
        try {
          const prompt = AVATAR_PROMPTS[style];
          const model = AVATAR_MODELS.STYLE;
          
          // Generate avatar
          const imageUrl = await generateAvatar(replicate, model, prompt, selfieResult.signedUrl, style);
          
          // Save to bucket
          const filename = `${coachId}-${style.toLowerCase().replace(/\s+/g, '-')}.png`;
          const publicUrl = await saveImageToBucket(imageUrl, filename);
          
          return {
            style: style,
            url: publicUrl,
            filename: filename
          };
        } catch (error) {
          console.error(`Failed to generate ${style} avatar:`, error);
          throw error;
        }
      })
    );

    // Process results
    const successfulAvatars = [];
    const failedStyles = [];

    avatarResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successfulAvatars.push(result.value);
      } else {
        failedStyles.push(AVATAR_STYLES[index]);
        console.error(`Failed to generate ${AVATAR_STYLES[index]} avatar:`, result.reason);
      }
    });

    if (successfulAvatars.length === 0) {
      throw new Error('Failed to generate any avatars');
    }

    console.log(`Successfully generated ${successfulAvatars.length} avatars for coach ${coachId}`);
    
    return {
      avatars: successfulAvatars,
      selfieUrl: selfieResult.storagePath,
      failedStyles: failedStyles
    };
  } catch (error) {
    console.error("Error in generateCoachAvatars:", error);
    throw error;
  }
}

module.exports = {
  generateCoachAvatars,
  AVATAR_STYLES,
  storeSelfie,
  saveImageToBucket
}; 