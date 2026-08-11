const functions = require('@google-cloud/functions-framework');
const cors = require('cors')({ origin: true });
const { Storage } = require('@google-cloud/storage');
const { createClient } = require('@supabase/supabase-js');

// Initialize clients
const storage = new Storage();
const projectId = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
const conversationBucketName = `${projectId}-${process.env.CONVERSATION_BUCKET_NAME}`;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Admin authorization: require a valid Supabase session token whose email is in ADMIN_EMAILS
async function requireAdmin(req, res) {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
    if (!token) {
      res.status(401).json({ error: 'Missing Authorization header' });
      return null;
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data || !data.user) {
      res.status(401).json({ error: 'Invalid token' });
      return null;
    }

    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    const adminPhones = (process.env.ADMIN_PHONES || '').split(',').map((e) => e.trim()).filter(Boolean);
    const userEmail = (data.user.email || '').toLowerCase();
    const userPhone = data.user.phone || data.user.phone_number || '';
    if (!adminEmails.includes(userEmail) && !adminPhones.includes(userPhone)) {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    }

    return data.user;
  } catch (err) {
    console.error('Admin auth error:', err);
    res.status(500).json({ error: 'Auth error' });
    return null;
  }
}

async function listUsers(req, res) {
  const { page = '1', pageSize = '50', search = '' } = req.query;
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const sizeNum = Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), 200);
  const from = (pageNum - 1) * sizeNum;
  const to = from + sizeNum - 1;

  let query = supabaseAdmin
    .from('user_profiles')
    .select(`phone_number, full_name, spice_level, coach, coach_type, custom_coach_id, image_preference, email, active, created_at, updated_at, subscription:subscriptions!user_phone(status, trial_start_timestamp)`, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (search) {
    // Very simple search across email, phone, name
    query = query.or(
      `email.ilike.%${search}%,phone_number.ilike.%${search}%,full_name.ilike.%${search}%`
    );
  }

  const { data, error, count } = await query;
  if (error) {
    console.error('Error listing users:', error);
    res.status(500).json({ error: 'Failed to list users' });
    return;
  }

  const results = (data || []).map((u) => ({
    ...u,
    subscriptions: u.subscription ? [u.subscription] : [],
  }));

  res.json({ users: results, total: count || 0, page: pageNum, pageSize: sizeNum });
}

async function getUserDetail(req, res, phone) {
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select(`phone_number, full_name, spice_level, coach, coach_type, custom_coach_id, image_preference, email, active, created_at, updated_at, subscription:subscriptions!user_phone(status, trial_start_timestamp)`) 
    .eq('phone_number', phone)
    .single();

  if (error || !data) {
    console.error('Error getting user:', error);
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({
    ...data,
    subscriptions: data.subscription ? [data.subscription] : [],
  });
}

async function updateUser(req, res, phone) {
  const allowed = ['full_name', 'spice_level', 'coach', 'coach_type', 'custom_coach_id', 'image_preference', 'active'];
  const payload = {};
  for (const key of allowed) {
    if (key in req.body) payload[key] = req.body[key];
  }

  if (Object.keys(payload).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .update(payload)
    .eq('phone_number', phone)
    .select()
    .single();

  if (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
    return;
  }

  res.json(data);
}

// ---------------------------------------------------------------------------
// Creators
//
// Approval is a platform action: protect_creator_platform_fields() silently
// restores status, revenue_share_bps and the payout columns on any write that
// carries an end-user JWT. These handlers run on the service role, where
// auth.uid() is null and the trigger stands aside — which is exactly why they
// live behind requireAdmin() in a Cloud Function and not in the browser.
// ---------------------------------------------------------------------------

const CREATOR_STATUSES = ['pending', 'approved', 'suspended'];
const CREATOR_COLUMNS =
  'id, created_at, updated_at, user_id, user_email, display_name, slug, bio, avatar_url, website_url, social_links, status, revenue_share_bps, payout_provider, payout_account_id';

async function attachCoachCounts(creators) {
  if (!creators || creators.length === 0) return creators || [];
  const ids = creators.map((c) => c.id);
  const { data, error } = await supabaseAdmin
    .from('coach_profiles')
    .select('id, creator_id, listing_status')
    .in('creator_id', ids);

  if (error) {
    console.error('Error counting coaches for creators:', error);
    return creators.map((c) => ({ ...c, coach_counts: null }));
  }

  const counts = new Map();
  for (const coach of data || []) {
    const bucket = counts.get(coach.creator_id) || { total: 0, listed: 0, in_review: 0 };
    bucket.total += 1;
    if (coach.listing_status === 'listed') bucket.listed += 1;
    if (coach.listing_status === 'in_review') bucket.in_review += 1;
    counts.set(coach.creator_id, bucket);
  }

  return creators.map((c) => ({
    ...c,
    coach_counts: counts.get(c.id) || { total: 0, listed: 0, in_review: 0 },
  }));
}

async function listCreators(req, res) {
  const { page = '1', pageSize = '50', search = '', status = '' } = req.query;
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const sizeNum = Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), 200);
  const from = (pageNum - 1) * sizeNum;
  const to = from + sizeNum - 1;

  let query = supabaseAdmin
    .from('creator_profiles')
    .select(CREATOR_COLUMNS, { count: 'exact' })
    // Pending applications are the queue this page exists to work through.
    .order('status', { ascending: true })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (status) {
    if (!CREATOR_STATUSES.includes(status)) {
      res.status(400).json({ error: `Unknown status "${status}"` });
      return;
    }
    query = query.eq('status', status);
  }

  if (search) {
    const escaped = search.replace(/[%,()]/g, '');
    query = query.or(
      `display_name.ilike.%${escaped}%,slug.ilike.%${escaped}%,user_email.ilike.%${escaped}%`
    );
  }

  const { data, error, count } = await query;
  if (error) {
    console.error('Error listing creators:', error);
    res.status(500).json({ error: 'Failed to list creators' });
    return;
  }

  const creators = await attachCoachCounts(data || []);
  res.json({ creators, total: count || 0, page: pageNum, pageSize: sizeNum });
}

async function getCreatorCoaches(req, res, creatorId) {
  const { data, error } = await supabaseAdmin
    .from('coach_profiles')
    .select('id, name, handle, tagline, discipline, category_slug, listing_status, active, created_at')
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading creator coaches:', error);
    res.status(500).json({ error: 'Failed to load coaches' });
    return;
  }
  res.json({ coaches: data || [] });
}

async function updateCreator(req, res, creatorId) {
  const payload = {};

  if ('status' in req.body) {
    if (!CREATOR_STATUSES.includes(req.body.status)) {
      res.status(400).json({ error: `status must be one of ${CREATOR_STATUSES.join(', ')}` });
      return;
    }
    payload.status = req.body.status;
  }

  if ('revenue_share_bps' in req.body) {
    const bps = Number(req.body.revenue_share_bps);
    if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
      res.status(400).json({ error: 'revenue_share_bps must be an integer between 0 and 10000' });
      return;
    }
    payload.revenue_share_bps = bps;
  }

  for (const key of ['payout_provider', 'payout_account_id']) {
    if (key in req.body) payload[key] = req.body[key] || null;
  }

  if (Object.keys(payload).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' });
    return;
  }

  const { data: creator, error } = await supabaseAdmin
    .from('creator_profiles')
    .update(payload)
    .eq('id', creatorId)
    .select(CREATOR_COLUMNS)
    .single();

  if (error || !creator) {
    console.error('Error updating creator:', error);
    res.status(error ? 500 : 404).json({ error: error ? 'Failed to update creator' : 'Creator not found' });
    return;
  }

  // Approval is what the creator was waiting on, so anything they already
  // submitted for review goes live with it. Suspension is the mirror image.
  let coachesChanged = [];
  if (payload.status === 'approved') {
    const { data, error: listError } = await supabaseAdmin
      .from('coach_profiles')
      .update({ listing_status: 'listed', public: true })
      .eq('creator_id', creatorId)
      .eq('listing_status', 'in_review')
      .select('id, name, listing_status');
    if (listError) console.error('Error listing queued coaches:', listError);
    coachesChanged = data || [];
  } else if (payload.status === 'suspended') {
    const { data, error: unlistError } = await supabaseAdmin
      .from('coach_profiles')
      .update({ listing_status: 'unlisted', public: false })
      .eq('creator_id', creatorId)
      .eq('listing_status', 'listed')
      .select('id, name, listing_status');
    if (unlistError) console.error('Error unlisting coaches:', unlistError);
    coachesChanged = data || [];
  }

  res.json({ ...creator, coaches_changed: coachesChanged });
}

async function getChat(req, res, phone) {
  try {
    const file = storage.bucket(conversationBucketName).file(`${phone}/conversation.json`);
    const [exists] = await file.exists();
    if (!exists) {
      res.json({ conversation: [] });
      return;
    }
    const [content] = await file.download();
    const conversation = JSON.parse(content.toString());
    res.json({ conversation });
  } catch (err) {
    console.error('Error reading conversation:', err);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
}

functions.http('adminApi', (req, res) => {
  return cors(req, res, async () => {
    // Basic router
    const user = await requireAdmin(req, res);
    if (!user) return; // response already sent

    const method = req.method.toUpperCase();
    const url = new URL(req.url, 'https://example.com');
    const path = url.pathname || '/';

    try {
      if (method === 'GET' && path === '/users') {
        await listUsers(req, res);
        return;
      }

      if (method === 'GET' && path === '/creators') {
        await listCreators(req, res);
        return;
      }

      if (path.startsWith('/creators/')) {
        const rest = path.slice('/creators/'.length);
        const [creatorId, sub] = rest.split('/');
        if (method === 'PATCH' && !sub) {
          await updateCreator(req, res, creatorId);
          return;
        }
        if (method === 'GET' && sub === 'coaches') {
          await getCreatorCoaches(req, res, creatorId);
          return;
        }
      }

      if (path.startsWith('/users/')) {
        const rest = path.slice('/users/'.length);
        const [phone, sub] = rest.split('/');
        if (method === 'GET' && !sub) {
          await getUserDetail(req, res, phone);
          return;
        }
        if (method === 'PATCH' && !sub) {
          await updateUser(req, res, phone);
          return;
        }
        if (method === 'GET' && sub === 'chat') {
          await getChat(req, res, phone);
          return;
        }
      }

      res.status(404).json({ error: 'Not found' });
    } catch (err) {
      console.error('Unhandled adminApi error:', err);
      res.status(500).json({ error: 'Internal error' });
    }
  });
});


