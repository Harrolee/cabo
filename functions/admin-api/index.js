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


