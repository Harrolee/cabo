const { createClient } = require('@supabase/supabase-js');
const { generateCoachAvatars } = require('./avatar-generation');
const multer = require('multer');

// Initialize Supabase (service-role for storage/coach_profiles writes)
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

// CORS — use the deploy's actual origins instead of wildcard
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

function setCors(res, origin) {
  if (allowedOrigins.length === 0) {
    res.set('Access-Control-Allow-Origin', '*');
  } else if (origin && allowedOrigins.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Max-Age', '3600');
}

// ---------------------------------------------------------------------------
// Simple in-memory IP rate limiter for unauthenticated callers.
// Resets on cold start (Cloud Functions), which is fine — the ceiling is
// per-invocation, not per-deploy.
// ---------------------------------------------------------------------------
const UNAUTH_RATE_LIMIT = parseInt(process.env.UNAUTH_RATE_LIMIT || '6', 10); // generations per window
const UNAUTH_WINDOW_MS = parseInt(process.env.UNAUTH_WINDOW_MS || '3600000', 10); // 1 hour
const ipHits = new Map(); // ip -> { count, windowStart }

function checkIpRateLimit(ip) {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now - entry.windowStart > UNAUTH_WINDOW_MS) {
    ipHits.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: UNAUTH_RATE_LIMIT - 1 };
  }
  entry.count += 1;
  if (entry.count > UNAUTH_RATE_LIMIT) {
    return { allowed: false, remaining: 0, retryAfter: UNAUTH_WINDOW_MS - (now - entry.windowStart) };
  }
  return { allowed: true, remaining: UNAUTH_RATE_LIMIT - entry.count };
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Extract and verify the Supabase JWT. Returns the authenticated user or null.
 */
async function resolveCaller(req) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

/**
 * Check whether `userId` owns the coach profile `coachId`.
 */
async function isCoachOwner(userId, coachId) {
  const { data, error } = await supabase
    .from('coach_profiles')
    .select('id')
    .eq('id', coachId)
    .eq('user_id', userId)
    .single();
  return !error && !!data;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Main function to generate coach avatars.
 *
 * Two callers, two auth paths:
 *
 *   1. CoachAvatarEdit (logged-in user editing an existing coach):
 *      – Sends Authorization: Bearer <supabase JWT>.
 *      – Function verifies the token and checks coach ownership.
 *
 *   2. AvatarUpload (pre-signup coach builder):
 *      – No session, by design.
 *      – IP rate-limited. style is required (prevents fan-out to every
 *        style in a single anonymous call, capping Replicate cost per
 *        request to one generation).
 *      – coachId must start with "temp-" so a caller cannot target a
 *        real coach through the anonymous path.
 */
exports.generateCoachAvatar = async (req, res) => {
  const origin = req.get('origin') || '';
  setCors(res, origin);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ------------------------------------------------------------------
  // Auth resolution
  // ------------------------------------------------------------------
  const caller = await resolveCaller(req);
  const isAnonymous = !caller;

  // ------------------------------------------------------------------
  // Parse body (supports both JSON and multipart)
  // ------------------------------------------------------------------
  const contentType = (req.get('content-type') || req.get('Content-Type') || '').toLowerCase();
  let coachId, imageBuffer, mimeType, style, prompt;

  if (contentType.includes('application/json')) {
    try {
      const body = req.body || {};
      coachId = body.coachId;
      style = body.style;
      prompt = body.prompt;

      if (!coachId) {
        return res.status(400).json({ error: 'coachId is required' });
      }

      if (body.selfie_base64) {
        const base64 = body.selfie_base64.replace(/^data:[^;]+;base64,/, '');
        imageBuffer = Buffer.from(base64, 'base64');
        mimeType = body.selfie_mime || 'image/jpeg';
      } else if (body.selfie_url) {
        const fetchResp = await fetch(body.selfie_url);
        if (!fetchResp.ok) {
          return res.status(400).json({ error: `Failed to fetch selfie_url: ${fetchResp.status}` });
        }
        const arr = await fetchResp.arrayBuffer();
        imageBuffer = Buffer.from(arr);
        mimeType = fetchResp.headers.get('content-type') || (body.selfie_mime || 'image/jpeg');
      } else {
        return res.status(400).json({ error: 'Provide selfie_base64 or selfie_url' });
      }
    } catch (error) {
      console.error('Avatar generation (JSON) error:', error);
      return res.status(500).json({ error: error.message || 'Failed to generate avatars' });
    }
  } else if (contentType.includes('multipart/form-data')) {
    // Multipart upload path
    try {
      await new Promise((resolve, reject) => {
        upload.single('selfie')(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      coachId = req.body?.coachId;
      style = req.body?.style;
      prompt = req.body?.prompt;

      if (!coachId) {
        return res.status(400).json({ error: 'coachId is required' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Selfie image is required' });
      }

      imageBuffer = req.file.buffer;
      mimeType = req.file.mimetype;
    } catch (error) {
      console.error('Upload error:', error);
      return res.status(400).json({ error: error.message || 'File upload failed' });
    }
  } else {
    return res.status(400).json({ error: 'Content-Type must be multipart/form-data or application/json' });
  }

  // ------------------------------------------------------------------
  // Anonymous caller guards
  // ------------------------------------------------------------------
  if (isAnonymous) {
    // 1. Only pre-signup temp coaches allowed through the anonymous path.
    if (!coachId || !coachId.startsWith('temp-')) {
      return res.status(403).json({ error: 'Authentication required for real coach IDs' });
    }

    // 2. Require a single style — anonymous callers cannot fan out to
    //    every style, which would burn N Replicate credits per call.
    if (!style) {
      return res.status(400).json({
        error: 'style is required for unauthenticated requests (set to one of the supported styles)',
        supported_styles: require('./avatar-generation').AVATAR_STYLES,
      });
    }

    // 3. IP rate limit
    const ip = req.ip || req.get('x-forwarded-for') || 'unknown';
    const rateCheck = checkIpRateLimit(ip);
    if (!rateCheck.allowed) {
      res.set('Retry-After', String(Math.ceil(rateCheck.retryAfter / 1000)));
      return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
    }
  }

  // ------------------------------------------------------------------
  // Authenticated caller guards
  // ------------------------------------------------------------------
  if (!isAnonymous) {
    // Verify coach ownership
    const owned = await isCoachOwner(caller.id, coachId);
    if (!owned) {
      return res.status(403).json({ error: 'You do not own this coach profile' });
    }
  }

  // ------------------------------------------------------------------
  // Generate avatars
  // ------------------------------------------------------------------
  console.log(`Generating avatars for coach ${coachId} (anonymous: ${isAnonymous})`);

  try {
    const result = await generateCoachAvatars(coachId, imageBuffer, mimeType, { style, prompt });
    return res.status(200).json({
      success: true,
      coachId,
      avatars: result.avatars,
      selfieStoragePath: result.selfieUrl,
      failedStyles: result.failedStyles,
      message: `Generated ${result.avatars.length} avatar options`
    });
  } catch (error) {
    console.error('Avatar generation error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to generate avatars',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};

/**
 * Save selected avatar to coach profile.
 * Requires authentication and coach ownership.
 */
exports.saveSelectedAvatar = async (req, res) => {
  const origin = req.get('origin') || '';
  setCors(res, origin);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  const caller = await resolveCaller(req);
  if (!caller) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const { coachId, selectedAvatarUrl, avatarStyle, originalSelfieUrl } = req.body;

    if (!coachId || !selectedAvatarUrl || !avatarStyle) {
      return res.status(400).json({
        error: 'coachId, selectedAvatarUrl, and avatarStyle are required'
      });
    }

    const owned = await isCoachOwner(caller.id, coachId);
    if (!owned) {
      return res.status(403).json({ error: 'You do not own this coach profile' });
    }

    console.log(`Saving selected avatar for coach ${coachId}: ${avatarStyle}`);

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
