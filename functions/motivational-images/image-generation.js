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
      negative_prompt: `nsfw, lowres, nudity, nude, naked, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry${isBeforeImage ? ', athletic, muscular, ripped' : ''}`,
      disable_safety_checker: true
    })
  },
  REALISTIC: {
    id: "tencentarc/photomaker:ddfc2b08d209f9fa8c1eca692712918bd449f695dabb4a958da31802a9570fe4",
    getInput: (prompt, userPhotoUrl, style, isBeforeImage = false) => ({
      prompt,
      num_steps: 50,
      input_image: userPhotoUrl,
      num_outputs: 1,
      negative_prompt: `nsfw, lowres, nudity, nude, naked, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry${isBeforeImage ? ', athletic, muscular, ripped' : ''}`,
      disable_safety_checker: true
    })
  },
  BACKUP: {
    id: "grandlineai/instant-id-artistic:9cad10c7870bac9d6b587f406aef28208f964454abff5c4152f7dec9b0212a9a",
    getInput: (prompt, userPhotoUrl, style, isBeforeImage = false) => ({
      image: userPhotoUrl,
      prompt,
      negative_prompt: "cgi, render, bad quality, worst quality, text, signature, watermark, extra limbs, unaestheticXL_hk1, negativeXL_D"
    })
  }
};

const PHOTOMAKER_STYLES = [
  'Cinematic',
  'Disney Character',
  'Fantasy art',
  'Enhance',
  'Comic book',
  'Line art',
  'Digital Art',
];
// 'Neonpunk',
// 'Photographic',
// 'Lowpoly',

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
      resumable: false // Disable resumable uploads for small files
    });

    // Set up error handling for the write stream
    writeStream.on('error', (error) => {
      console.error(`Error writing to bucket for ${filename}:`, error);
      writeStream.end();
      throw error;
    });

    return new Promise(async (resolve, reject) => {
      writeStream.on('finish', () => {
        resolve(`https://storage.googleapis.com/${bucketName}/generated-images/${filename}`);
      });
      
      writeStream.on('error', reject);
      
      try {
        const reader = buffer.stream().getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            writeStream.end();
            break;
          }
          // Handle backpressure
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

async function generateMotivationalImages(phoneNumber, beforePrompt, afterPrompt, imageStyle) {
  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
  });

  try {
    const userPhotoUrl = await checkForUserPhoto(phoneNumber);
    
    if (userPhotoUrl) {
      console.log(`Generating personalized images for user ${phoneNumber}`);
      console.log('Model config:', {
        modelId: imageStyle.model.id,
        style: imageStyle.style,
        beforePrompt
      });

      // Generate "before" image - regular body type version of user
      console.log('Generating before image...');
      let beforeOutput = await replicate.run(
        imageStyle.model.id,
        {
          input: imageStyle.model.getInput(
            beforePrompt,
            userPhotoUrl,
            imageStyle.style,
            true // isBeforeImage = true
          )
        }
      ).catch(error => {
        console.error('Replicate API error for before image:', error);
        console.error('API input:', {
          modelId: imageStyle.model.id,
          input: imageStyle.model.getInput(
            beforePrompt,
            userPhotoUrl,
            imageStyle.style,
            true
          )
        });
        throw error;
      });

      // If primary model returns no output, try backup model
      if (!beforeOutput || beforeOutput.length === 0) {
        console.log('Primary model returned no output for before image, trying backup model...');
        beforeOutput = await replicate.run(
          IMAGE_MODELS.BACKUP.id,
          {
            input: IMAGE_MODELS.BACKUP.getInput(
              beforePrompt,
              userPhotoUrl,
              imageStyle.style,
              true
            )
          }
        );
      }

      if (!beforeOutput || beforeOutput.length === 0) {
        throw new Error('Both primary and backup models returned no output for before image');
      }

      console.log('Before image generated successfully:', beforeOutput[0]);

      // Save before image first
      console.log('Saving before image to bucket...');
      const beforeUrl = await saveImageToBucket(
        beforeOutput[0], 
        `motivation-${Date.now()}-before.png`
      );
      console.log('Before image saved successfully:', beforeUrl);

      // Generate "after" image - athletic version of user
      console.log('Generating after image...');
      let afterOutput = await replicate.run(
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

      // If primary model returns no output, try backup model
      if (!afterOutput || afterOutput.length === 0) {
        console.log('Primary model returned no output for after image, trying backup model...');
        afterOutput = await replicate.run(
          IMAGE_MODELS.BACKUP.id,
          {
            input: IMAGE_MODELS.BACKUP.getInput(
              afterPrompt,
              userPhotoUrl,
              imageStyle.style,
              false
            )
          }
        );
      }

      if (!afterOutput || afterOutput.length === 0) {
        throw new Error('Both primary and backup models returned no output for after image');
      }

      console.log('After image generated successfully:', afterOutput[0]);

      // Save after image second
      console.log('Saving after image to bucket...');
      const afterUrl = await saveImageToBucket(
        afterOutput[0],
        `motivation-${Date.now()}-after.png`
      );
      console.log('After image saved successfully:', afterUrl);

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
          prompt: beforePrompt + "perfect eyes, natural skin",
          lora_scale: 0.6,
          scheduler: "DPMSolverMultistep",
          num_outputs: 1,
          guidance_scale: 7,
          apply_watermark: true,
          negative_prompt: "nsfw, nude, nudity, naked, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, athletic, muscular, ripped",
          prompt_strength: 0.8,
          num_inference_steps: 40,
          disable_safety_checker: true
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
          prompt: afterPrompt + "perfect eyes, natural skin",
          scheduler: "DPMSolverMultistep",
          lora_scale: 0.6,
          num_outputs: 1,
          guidance_scale: 7,
          apply_watermark: true,
          negative_prompt: "nsfw, nude, nudity, naked, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry",
          prompt_strength: 0.8,
          num_inference_steps: 40,
          disable_safety_checker: true
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