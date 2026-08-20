const { createClient } = require('@supabase/supabase-js');
const { generateCoachAvatars, AVATAR_STYLES } = require('./avatar-generation');
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

/**
 * The caller's address, as seen from behind Cloud Run's front end.
 *
 * `X-Forwarded-For` is checked first and the *left-most* entry taken: Express
 * only populates `req.ip` from that header when `trust proxy` is set, which the
 * functions framework does not do here, so `req.ip` is the front end's own
 * address. Keying the limiter on it would put every anonymous caller in one
 * bucket and turn a per-IP ceiling into a global one — the pre-signup avatar
 * step would start returning 429 to everybody after a handful of builds, which
 * is precisely the funnel this endpoint exists to serve.
 *
 * Left-most rather than right-most because Google appends the immediate peer;
 * the originating client is the first entry. It is client-supplied and so
 * spoofable — that is inherent to IP rate limiting and is why this is a cost
 * ceiling rather than an access control. The access control is the `temp-`
 * prefix check and the token check above.
 */
function clientIp(req) {
  const forwarded = req.get('x-forwarded-for') || '';
  const first = forwarded.split(',')[0].trim();
  return first || req.ip || 'unknown';
}

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
        supported_styles: AVATAR_STYLES,
      });
    }

    // 3. IP rate limit
    const ip = clientIp(req);
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

/*
  There is no second export here on purpose. A `saveSelectedAvatar` handler used
  to live below this line: it took a `coachId` and an avatar URL from the request
  body and wrote them straight onto that row in `coach_profiles`, with no token
  check and no ownership check.

  Terraform gives this directory exactly one `entry_point`, `generateCoachAvatar`
  (`_infra/cloud_functions.tf`), so a second export is not deployed and not
  reachable — the webapp's old calls to `/coach-avatar-generator/save-avatar`
  (removed in #22) hit the generator above, which does not route on path.

  PR #46 restored the handler with `resolveCaller()` and `isCoachOwner()` in
  front of it, which fixes the IDOR but leaves it dead. It is removed again here
  rather than shipped dormant: an unreachable write path is one Terraform line
  away from being live, and the next person to add that line will not
  necessarily re-derive why the checks matter. Both helpers are still above, so
  bringing saving back is a small change — give it an `entry_point` and a caller
  in the same PR, and keep the ownership check.
*/
