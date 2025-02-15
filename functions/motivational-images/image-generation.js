const { Storage } = require('@google-cloud/storage');
const Replicate = require('replicate');

const storage = new Storage();
const projectId = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
const bucketName = `${projectId}-image-bucket`;

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

async function generateMotivationalImages(imagePreference, phoneNumber, coach, spiceLevel, beforePrompt, afterPrompt, imageStyle) {
  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
  });

  try {
    const userPhotoUrl = await checkForUserPhoto(phoneNumber);
    
    if (userPhotoUrl) {
      console.log(`Generating personalized images for user ${phoneNumber}`);

      // Generate "before" image - regular body type version of user
      const beforeOutput = await replicate.run(
        imageStyle.model.id,
        {
          input: imageStyle.model.getInput(
            beforePrompt,
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
            afterPrompt,
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
    const randomSeed = Math.floor(Math.random() * 1000000000);
    
    // Note: For RealVisXL model, we don't use the 'img' keyword in prompts
    const beforeOutput = await replicate.run(
      "lucataco/realvisxl-v2.0:7d6a2f9c4754477b12c14ed2a58f89bb85128edcdd581d24ce58b6926029de08",
      {
        input: {
          seed: randomSeed,
          width: 1024,
          height: 1024,
          prompt: beforePrompt,
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
          prompt: afterPrompt,
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

module.exports = {
  generateMotivationalImages,
  selectRandomImageStyle,
  saveImageToBucket,
  checkForUserPhoto
}; 