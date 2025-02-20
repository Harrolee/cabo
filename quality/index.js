require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const moment = require('moment');
const Replicate = require('replicate');
// const { Storage } = require('@google-cloud/storage');

// Validate required environment variables
if (!process.env.REPLICATE_API_KEY) {
  throw new Error('REPLICATE_API_KEY environment variable is required. Please add it to your .env file.');
}

const NEGATIVE_PROMPT_BEFORE = ', weak, frail, sad, anxious, dark, gloomy, skinny, thin';
const NEGATIVE_PROMPT_AFTER = ', athletic, muscular, ripped, strong, confident, joyful, smiling';
const NEGATIVE_PROMPT_COMMON = 'nsfw, lowres, nudity, nude, naked, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry';
const negative_prompt = (isBeforeImage) => `${NEGATIVE_PROMPT_COMMON}${isBeforeImage ? NEGATIVE_PROMPT_AFTER : NEGATIVE_PROMPT_BEFORE}`;

const PHOTOMAKER_STYLES = [
  'Cinematic',
  'Disney Charactor',
  'Fantasy art',
  'Enhance',
  'Comic book',
  'Line art',
  'Digital Art',
  'Neonpunk',
  'Photographic',
  'Lowpoly',
];

const IMAGE_MODELS = {
  STYLE: {
    id: "tencentarc/photomaker-style:467d062309da518648ba89d226490e02b8ed09b5abc15026e54e31c5a8cd0769",
    getInput: (prompt, userPhotoUrl, style, isBeforeImage = false) => ({
      prompt: prompt + "perfect eyes, natural skin",
      num_steps: 50,
      input_image: userPhotoUrl,
      num_outputs: 1,
      style_name: style || 'Enhance', // Default to Enhance if no style provided
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
      negative_prompt: "cgi, render, bad quality, worst quality, text, signature, watermark, extra limbs, unaestheticXL_hk1, negativeXL_D" + (isBeforeImage ? NEGATIVE_PROMPT_BEFORE : NEGATIVE_PROMPT_AFTER)
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

class QualityRunner {
  constructor(scenariosPath, outputDir = 'output') {
    this.replicate = new Replicate({
      auth: process.env.REPLICATE_API_KEY,
    });
    this.scenariosPath = scenariosPath;
    this.outputDir = outputDir;
    this.modelKeys = Object.keys(IMAGE_MODELS);
  }

  async loadImageUrl(imageUrl) {
    try {
      // Handle local file paths by uploading to a temporary URL service
      if (imageUrl.startsWith('./') || imageUrl.startsWith('/')) {
        // For now, we'll throw an error since local files aren't supported
        throw new Error('Local file paths are not supported. Please provide a publicly accessible URL.');
      }
      
      // For web URLs, verify they're accessible
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to access image URL: ${response.status} ${response.statusText}`);
      }
      
      return imageUrl;
    } catch (error) {
      console.error('Error loading image:', error);
      throw error;
    }
  }

  selectStyle(styleSplit) {
    if (!styleSplit) {
      // If no style split provided, return a random style
      return PHOTOMAKER_STYLES[Math.floor(Math.random() * PHOTOMAKER_STYLES.length)];
    }

    // Validate style split
    const invalidStyles = Object.keys(styleSplit).filter(style => !PHOTOMAKER_STYLES.includes(style));
    if (invalidStyles.length > 0) {
      throw new Error(`Invalid styles in photomaker_style_split: ${invalidStyles.join(', ')}`);
    }

    // Calculate total weight
    const totalWeight = Object.values(styleSplit).reduce((a, b) => a + b, 0);
    if (totalWeight === 0) {
      throw new Error('At least one style weight must be greater than 0');
    }

    // Generate random number between 0 and total weight
    let random = Math.random() * totalWeight;
    
    // Select style based on weights
    for (const [style, weight] of Object.entries(styleSplit)) {
      if (weight === 0) continue;
      
      random -= weight;
      if (random <= 0) {
        return style;
      }
    }

    // Fallback to first style with non-zero weight
    return Object.entries(styleSplit).find(([_, weight]) => weight > 0)[0];
  }

  selectModel(modelSplit, hasSubjectImage) {
    // Default to equal weights if not specified
    const weights = modelSplit ? modelSplit.split(':').map(Number) : [1, 1, 1, 1];
    
    // Validate weights length
    if (weights.length !== this.modelKeys.length) {
      throw new Error(`Model split must have ${this.modelKeys.length} values`);
    }

    // Calculate total weight
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight === 0) {
      throw new Error('At least one model weight must be greater than 0');
    }

    // Generate random number between 0 and total weight
    let random = Math.random() * totalWeight;
    
    // Select model based on weights
    for (let i = 0; i < weights.length; i++) {
      if (weights[i] === 0) continue;
      
      const model = IMAGE_MODELS[this.modelKeys[i]];
      
      // Skip models that require images if we don't have one
      if (!hasSubjectImage && model.requiresImage) {
        continue;
      }
      
      random -= weights[i];
      if (random <= 0) {
        return model;
      }
    }

    // Fallback to REALVIS if no suitable model found
    return IMAGE_MODELS.REALVIS;
  }

  async generateImage(model, prompt, negativePrompt, isBeforeImage = false, subjectImageUrl = null, styleSplit = null, imageSubjectDescription = null) {
    const maxRetries = 3;
    const retryDelay = 5000; // 5 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Generating image with prompt (attempt ${attempt}/${maxRetries}):`, prompt);
        console.log('Using model:', model.id);
        
        // Replace 'person' with custom subject description if provided
        if (imageSubjectDescription) {
          // For tencentarc/photomaker models, append 'img' to the subject description
          const subjectDesc = model.id.startsWith('tencentarc/photomaker') 
            ? `${imageSubjectDescription} img`
            : imageSubjectDescription;
          prompt = prompt.replace(/person/g, subjectDesc);
        }

        let imageUrl = null;
        if (subjectImageUrl && model.requiresImage) {
          imageUrl = await this.loadImageUrl(subjectImageUrl);
        }

        // Select style if using STYLE model
        const style = model === IMAGE_MODELS.STYLE ? this.selectStyle(styleSplit) : null;
        if (style) {
          console.log('Using PhotoMaker style:', style);
        }
        
        const output = await this.replicate.run(
          model.id,
          {
            input: model.getInput(prompt, imageUrl, style, isBeforeImage)
          }
        );

        console.log('Raw Replicate output:', JSON.stringify(output, null, 2));

        if (!output || output.length === 0 || !output[0]) {
          console.error('Invalid output format. Expected array with URL, got:', typeof output, Array.isArray(output) ? 'array' : 'non-array');
          throw new Error('Model returned no valid output URL');
        }

        if (typeof output === 'string') {
          return output; // Handle case where output is directly the URL
        } else if (Array.isArray(output) && output.length > 0) {
          return output[0]; // Handle array case
        } else if (typeof output === 'object' && output.output) {
          return Array.isArray(output.output) ? output.output[0] : output.output; // Handle object with output field
        }

        throw new Error(`Unexpected output format from Replicate API: ${JSON.stringify(output)}`);
      } catch (error) {
        const isPaymentError = error.message?.includes('Payment Required') || 
                             error.message?.includes('spend limit');
        
        // If it's a payment error or we're out of retries, throw the error
        if (isPaymentError || attempt === maxRetries) {
          throw error;
        }

        console.warn(`Attempt ${attempt} failed:`, error.message);
        console.log(`Retrying in ${retryDelay/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  async saveImage(imageUrl, outputPath) {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
      }
      
      const buffer = await response.arrayBuffer();
      await fs.writeFile(outputPath, Buffer.from(buffer));
      
      console.log(`Image saved to: ${outputPath}`);
    } catch (error) {
      console.error('Error saving image:', error);
      throw error;
    }
  }

  async run() {
    try {
      // Load scenarios
      const scenarios = require(this.scenariosPath);
      
      // Create timestamp-based directory
      const timestamp = moment().format('YYYY-MM-DD-HH-mm-ss');
      const runDir = path.join(this.outputDir, timestamp);
      await fs.mkdir(runDir, { recursive: true });

      // Track failed generations
      const failures = [];

      // Save info.json with run metadata
      const runInfo = {
        timestamp,
        models: IMAGE_MODELS,
        scenarios: scenarios
      };
      await fs.writeFile(
        path.join(runDir, 'info.json'), 
        JSON.stringify(runInfo, null, 2)
      );

      // Process scenario pairs in parallel with a concurrency limit
      const concurrencyLimit = 3; // Adjust this based on your needs and API limits
      const chunks = [];
      for (let i = 0; i < scenarios.scenario_pairs.length; i += concurrencyLimit) {
        chunks.push(scenarios.scenario_pairs.slice(i, i + concurrencyLimit));
      }

      // Add timeout wrapper function
      const withTimeout = (promise, timeoutMs = 300000) => { // 5 minute timeout
        return Promise.race([
          promise,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
          )
        ]);
      };

      for (const chunk of chunks) {
        const hasSubjectImage = !!scenarios.subject_image_url;
        
        try {
          // Process each chunk of scenarios in parallel with timeout
          await withTimeout(Promise.all(chunk.map(async (pair) => {
            try {
              const themeDir = path.join(runDir, pair.theme);
              await fs.mkdir(themeDir, { recursive: true });

              // Generate before and after images in parallel
              const results = await Promise.allSettled([
                // Generate before image
                (async () => {
                  const beforeModel = this.selectModel(scenarios.model_split, hasSubjectImage);
                  const style = beforeModel === IMAGE_MODELS.STYLE ? this.selectStyle(scenarios.photomaker_style_split) : null;
                  const url = await this.generateImage(
                    beforeModel,
                    pair.before.prompt,
                    pair.before.negative_prompt,
                    true,
                    scenarios.subject_image_url,
                    scenarios.photomaker_style_split,
                    scenarios.imageSubjectDescription
                  );
                  return {
                    type: 'before',
                    url,
                    model: beforeModel,
                    style
                  };
                })(),
                // Generate after image
                (async () => {
                  const afterModel = this.selectModel(scenarios.model_split, hasSubjectImage);
                  const style = afterModel === IMAGE_MODELS.STYLE ? this.selectStyle(scenarios.photomaker_style_split) : null;
                  const url = await this.generateImage(
                    afterModel,
                    pair.after.prompt,
                    pair.after.negative_prompt,
                    false,
                    scenarios.subject_image_url,
                    scenarios.photomaker_style_split,
                    scenarios.imageSubjectDescription
                  );
                  return {
                    type: 'after',
                    url,
                    model: afterModel,
                    style
                  };
                })()
              ]);

              // Process results and save successful generations
              for (const result of results) {
                if (result.status === 'fulfilled') {
                  const { type, url, model, style } = result.value;
                  
                  if (!url) {
                    throw new Error(`No URL returned for ${type} image generation`);
                  }

                  const title = type === 'before' ? pair.before.title : pair.after.title;
                  
                  // Create filename with model name and style (if applicable)
                  const modelName = Object.keys(IMAGE_MODELS).find(key => IMAGE_MODELS[key] === model);
                  const stylePrefix = style ? `[${style}]` : '';
                  const filename = `[${modelName}]${stylePrefix}${title}.png`;
                  
                  await this.saveImage(
                    url,
                    path.join(themeDir, filename)
                  );
                } else {
                  const error = result.reason;
                  failures.push({
                    theme: pair.theme,
                    type: error?.type || 'unknown',
                    error: error?.message || 'Unknown error',
                    timestamp: new Date().toISOString()
                  });
                  console.error(`Failed to generate ${pair.theme} ${error?.type || ''} image:`, error);
                  
                  // Check for payment errors immediately
                  if (error?.message?.includes('Payment Required') || 
                      error?.message?.includes('spend limit')) {
                    throw new Error('Payment limit reached');
                  }
                }
              }

              console.log(`Completed scenario: ${pair.theme} at ${new Date().toISOString()}`);
            } catch (error) {
              console.error(`Error processing scenario ${pair.theme}:`, error);
              failures.push({
                theme: pair.theme,
                error: error.message,
                timestamp: new Date().toISOString()
              });
              
              // Rethrow payment errors to stop processing
              if (error.message?.includes('Payment Required') || 
                  error.message?.includes('spend limit') ||
                  error.message === 'Payment limit reached') {
                throw error;
              }
            }
          })));
        } catch (error) {
          console.error('Error processing chunk:', error);
          
          // Stop processing if payment error
          if (error.message?.includes('Payment Required') || 
              error.message?.includes('spend limit') ||
              error.message === 'Payment limit reached') {
            console.error('Payment limit reached. Stopping further processing.');
            break;
          }
        }

        // Add a small delay between chunks to prevent rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Save failure report
      if (failures.length > 0) {
        await fs.writeFile(
          path.join(runDir, 'failures.json'),
          JSON.stringify(failures, null, 2)
        );
        console.warn(`Quality run completed with ${failures.length} failures. See failures.json for details.`);
      } else {
        console.log('Quality run completed successfully.');
      }

      return runDir;
    } catch (error) {
      console.error('Error in quality run:', error);
      throw error;
    }
  }
}

// Export the QualityRunner class
module.exports = QualityRunner; 