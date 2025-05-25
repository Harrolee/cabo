const { createClient } = require('@supabase/supabase-js');
const { Storage } = require('@google-cloud/storage');
const { v4: uuidv4 } = require('uuid');
const { z } = require('zod');

// Initialize services
const storage = new Storage();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '3600'
};

// Validation schemas
const UploadRequestSchema = z.object({
  coachId: z.string().min(1), // Allow any string for temp IDs
  fileName: z.string().min(1).max(255),
  fileSize: z.number().min(1).max(10 * 1024 * 1024), // 10MB limit
  mimeType: z.string(),
  contentType: z.enum([
    'instagram_post',
    'video_transcript', 
    'podcast_transcript',
    'written_content',
    'social_media_comment',
    'blog_post'
  ])
});

/**
 * Validate file type and size
 */
function validateFile(fileName, fileSize, mimeType, contentType) {
  const extension = fileName.split('.').pop().toLowerCase();
  
  // Define allowed extensions per content type
  const allowedExtensions = {
    instagram_post: ['txt', 'json'],
    video_transcript: ['txt', 'srt'],
    podcast_transcript: ['txt'],
    written_content: ['txt', 'md', 'doc', 'docx'],
    social_media_comment: ['txt', 'csv'],
    blog_post: ['txt', 'md', 'html']
  };
  
  const validExtensions = allowedExtensions[contentType] || [];
  
  if (!validExtensions.includes(extension)) {
    throw new Error(`Invalid file type. Allowed extensions for ${contentType}: ${validExtensions.join(', ')}`);
  }
  
  // Check file size (10MB limit)
  if (fileSize > 10 * 1024 * 1024) {
    throw new Error('File size must be less than 10MB');
  }
  
  return true;
}

/**
 * Generate signed URL for file upload
 */
async function generateSignedUploadUrl(coachId, fileName, mimeType) {
  const bucket = storage.bucket(process.env.GCP_STORAGE_BUCKET);
  
  // Generate unique file path
  const fileId = uuidv4();
  const fileExtension = fileName.split('.').pop();
  const filePath = `coach-content/${coachId}/${fileId}.${fileExtension}`;
  
  // Generate consistent timestamp
  const uploadTimestamp = new Date().toISOString();
  
  const file = bucket.file(filePath);
  
  // Generate signed URL for upload (expires in 1 hour)
  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + 60 * 60 * 1000, // 1 hour
    contentType: mimeType,
    extensionHeaders: {
      'x-goog-meta-coach-id': coachId,
      'x-goog-meta-upload-timestamp': uploadTimestamp
    }
  });
  
  return {
    signedUrl,
    filePath,
    fileId,
    uploadTimestamp,
    coachId
  };
}

/**
 * Generate signed URL for direct upload (main function)
 */
exports.generateUploadUrl = async (req, res) => {
  // Set CORS headers
  Object.keys(corsHeaders).forEach(key => {
    res.set(key, corsHeaders[key]);
  });

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    // Validate request
    const requestData = UploadRequestSchema.parse(req.body);
    const { coachId, fileName, fileSize, mimeType, contentType } = requestData;
    
    console.log(`Generating upload URL for coach ${coachId}: ${fileName}`);
    
    // Skip coach validation for temp IDs (preview mode)
    if (!coachId.startsWith('temp-id') && !coachId.startsWith('preview-coach-')) {
      // Verify coach exists and user has permission
      const { data: coach, error: coachError } = await supabase
        .from('coach_profiles')
        .select('id, user_id')
        .eq('id', coachId)
        .single();
      
      if (coachError || !coach) {
        return res.status(404).json({ error: 'Coach not found' });
      }
    }
    
    // Validate file
    validateFile(fileName, fileSize, mimeType, contentType);
    
    // Generate signed URL
    const { signedUrl, filePath, fileId, uploadTimestamp, coachId: generatedCoachId } = await generateSignedUploadUrl(
      coachId, 
      fileName, 
      mimeType
    );
    
    console.log(`Generated signed URL for file: ${filePath}`);
    
    res.json({
      success: true,
      uploadUrl: signedUrl,
      filePath: filePath,
      fileId: fileId,
      uploadTimestamp: uploadTimestamp,
      coachId: generatedCoachId,
      expiresIn: 3600, // 1 hour in seconds
      instructions: {
        method: 'PUT',
        headers: {
          'Content-Type': mimeType
        },
        note: 'Upload the file directly to the signed URL using PUT method'
      }
    });
    
  } catch (error) {
    console.error('Upload URL generation error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Invalid request data',
        details: error.errors 
      });
    }
    
    res.status(400).json({ 
      error: error.message || 'Failed to generate upload URL'
    });
  }
};

/**
 * Confirm upload and trigger processing
 */
exports.confirmUpload = async (req, res) => {
  // Set CORS headers
  Object.keys(corsHeaders).forEach(key => {
    res.set(key, corsHeaders[key]);
  });

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    const { coachId, filePath, fileName, fileSize, contentType } = req.body;
    
    console.log(`Confirming upload for coach ${coachId}: ${filePath}`);
    
    // Verify file exists in storage
    const bucket = storage.bucket(process.env.GCP_STORAGE_BUCKET);
    const file = bucket.file(filePath);
    
    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: 'File not found in storage' });
    }
    
    // Get file metadata
    const [metadata] = await file.getMetadata();
    
    // Trigger content processing
    const processingResponse = await fetch(`${process.env.COACH_CONTENT_PROCESSOR_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GCP_FUNCTION_AUTH_TOKEN}`
      },
      body: JSON.stringify({
        coachId: coachId,
        fileDetails: {
          name: fileName,
          path: filePath,
          type: metadata.contentType,
          size: parseInt(metadata.size)
        },
        contentType: contentType
      })
    });
    
    if (!processingResponse.ok) {
      console.error('Failed to trigger processing:', await processingResponse.text());
      return res.status(500).json({ error: 'Failed to trigger content processing' });
    }
    
    const processingResult = await processingResponse.json();
    
    console.log(`Content processing triggered successfully: ${processingResult.contentChunkId}`);
    
    res.json({
      success: true,
      fileUploaded: true,
      processingTriggered: true,
      contentChunkId: processingResult.contentChunkId,
      processingResult: processingResult
    });
    
  } catch (error) {
    console.error('Upload confirmation error:', error);
    res.status(500).json({ 
      error: 'Failed to confirm upload',
      message: error.message 
    });
  }
};

/**
 * Main function handler - routes requests
 */
exports.coachFileUploader = async (req, res) => {
  // Set CORS headers for all requests
  Object.keys(corsHeaders).forEach(key => {
    res.set(key, corsHeaders[key]);
  });

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    const path = req.path || '/';
    const method = req.method;

    console.log(`Request: ${method} ${path}`);

    // Route requests
    if (method === 'POST' && path === '/') {
      // Generate upload URL
      return await exports.generateUploadUrl(req, res);
    } else if (method === 'POST' && path.match(/^\/[a-f0-9-]+$/)) {
      // Confirm upload (path contains file ID)
      return await exports.confirmUpload(req, res);
    } else {
      res.status(404).json({ error: 'Endpoint not found' });
    }
  } catch (error) {
    console.error('Main handler error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}; 