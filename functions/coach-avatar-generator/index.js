const { createClient } = require('@supabase/supabase-js');
const { generateCoachAvatars } = require('./avatar-generation');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '3600'
};

/**
 * Main function to generate coach avatars
 */
exports.generateCoachAvatar = async (req, res) => {
  // Set CORS headers
  Object.keys(corsHeaders).forEach(key => {
    res.set(key, corsHeaders[key]);
  });

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  // Only allow POST for uploads
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Ensure content-type is multipart/form-data
  const contentType = req.get('content-type') || req.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    console.warn('Invalid content-type for upload:', contentType);
    return res.status(400).json({ error: 'Content-Type must be multipart/form-data' });
  }

  // Handle file upload
  upload.single('selfie')(req, res, async (err) => {
    if (err) {
      console.error('Upload error:', err);
      return res.status(400).json({ 
        error: err.message || 'File upload failed'
      });
    }

    try {
      const { coachId } = req.body;
      const file = req.file;

      if (!coachId) {
        return res.status(400).json({ error: 'coachId is required' });
      }

      if (!file) {
        return res.status(400).json({ error: 'Selfie image is required' });
      }

      console.log(`Processing avatar generation for coach ${coachId}`);
      console.log(`File info: ${file.originalname}, ${file.mimetype}, ${file.size} bytes`);

      // Generate avatars
      const result = await generateCoachAvatars(coachId, file.buffer, file.mimetype);

      res.status(200).json({
        success: true,
        coachId: coachId,
        avatars: result.avatars,
        selfieStoragePath: result.selfieUrl,
        failedStyles: result.failedStyles,
        message: `Generated ${result.avatars.length} avatar options`
      });

    } catch (error) {
      console.error('Avatar generation error:', error);
      res.status(500).json({ 
        error: error.message || 'Failed to generate avatars',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });
};

/**
 * Function to save selected avatar to coach profile
 */
exports.saveSelectedAvatar = async (req, res) => {
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
    const { coachId, selectedAvatarUrl, avatarStyle, originalSelfieUrl } = req.body;

    if (!coachId || !selectedAvatarUrl || !avatarStyle) {
      return res.status(400).json({ 
        error: 'coachId, selectedAvatarUrl, and avatarStyle are required' 
      });
    }

    console.log(`Saving selected avatar for coach ${coachId}: ${avatarStyle}`);

    // Update coach profile with selected avatar
    const { data, error } = await supabase
      .from('coach_profiles')
      .update({
        avatar_url: selectedAvatarUrl,
        avatar_style: avatarStyle,
        original_selfie_url: originalSelfieUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', coachId)
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      throw error;
    }

    res.status(200).json({
      success: true,
      coach: data,
      message: 'Avatar saved successfully'
    });

  } catch (error) {
    console.error('Save avatar error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to save selected avatar'
    });
  }
}; 