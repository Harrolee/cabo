/**
 * Deletes a member's account, for real.
 *
 *   POST /preview   {}                     -> what deleting would destroy
 *   POST /          { confirm: "DELETE" }  -> destroys it
 *
 * Both require a Supabase JWT, and the only account this can delete is the one
 * that JWT belongs to. There is no id parameter: an endpoint that takes a user
 * id is one authorization bug away from letting anybody delete anybody.
 *
 * App Store Review Guideline 5.1.1(v) is why this exists, but the shape is
 * driven by what is actually stored. `member_goals` holds what someone is
 * struggling with, `conversation_messages` holds every word they have said to a
 * coach, and `user_profiles.reference_photo_url` points at a photograph of
 * their face. So the order is deliberate:
 *
 *   1. delete the reference photo objects from the member-media bucket
 *   2. delete every public-schema row (`delete_member_account`, one transaction)
 *   3. delete the auth.users row through GoTrue's admin API
 *
 * The photo goes first for the same reason `coach-visualizer`'s likeness
 * revocation deletes it first: a pointer cleared while the object survives is
 * not an erasure, and once the row is gone nothing knows the object is there.
 * If step 1 cannot be completed we stop before step 2 — an orphaned photograph
 * of somebody who no longer has an account is the one outcome worse than a
 * failed deletion, and the member can retry.
 *
 * What this does NOT do, and says so in the app before the member commits:
 * cancel their Apple subscriptions. Those are held by Apple against their Apple
 * ID, not by us, and nothing we can call from here touches them.
 */

const { createClient } = require('@supabase/supabase-js');
const { Storage } = require('@google-cloud/storage');
const { z } = require('zod');
const { deleteReferencePhotos, referencePrefix } = require('./reference-photo');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const storage = new Storage();

const PROJECT_ID = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
const MEMBER_MEDIA_BUCKET = process.env.MEMBER_MEDIA_BUCKET || `${PROJECT_ID}-member-media`;

/*
  Not a boolean, and not optional. The client has to send the same word the
  member typed, so a malformed or replayed request cannot delete an account and
  neither can a stray `{}` from a retry.
*/
const DeleteRequest = z.object({
  confirm: z.literal('DELETE'),
});

async function resolveCaller(req) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

/**
 * What the confirmation screen shows: counts, in the member's own terms, read
 * live rather than guessed at. Best effort — a count that fails to load must
 * not block someone from deleting their account.
 */
async function handlePreview(req, res) {
  const caller = await resolveCaller(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });

  const count = async (table) => {
    const { count: n, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', caller.id);
    return error ? null : n ?? 0;
  };

  const [conversations, goals, images, subscriptions] = await Promise.all([
    count('conversations'),
    count('member_goals'),
    count('coach_visualizations'),
    count('coach_subscriptions'),
  ]);

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('reference_photo_url')
    .eq('user_id', caller.id)
    .maybeSingle();

  return res.json({
    success: true,
    summary: {
      conversations,
      goals,
      images,
      subscriptions,
      hasReferencePhoto: Boolean(profile?.reference_photo_url),
    },
  });
}

/**
 * Sweep the member's whole prefix in the member-media bucket.
 *
 * By prefix rather than by the URI in `reference_photo_url`, exactly as
 * revocation does: a photo stored under an older extension, or one orphaned by
 * a grant that failed halfway, is still a photograph of this person's face and
 * must not survive them deleting their account.
 *
 * One retry, because the common failure here is a transient 5xx from GCS and
 * making somebody ask twice to be deleted is a bad experience for no reason.
 */
async function purgeMemberMedia(userId) {
  const attempt = () =>
    deleteReferencePhotos({ storage, bucketName: MEMBER_MEDIA_BUCKET, userId });

  try {
    return await attempt();
  } catch (error) {
    console.warn('Member media sweep failed, retrying once:', error.message);
    return attempt();
  }
}

async function handleDelete(req, res) {
  const caller = await resolveCaller(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });

  DeleteRequest.parse(req.body || {});

  // 1. The photograph, first.
  let photosDeleted;
  try {
    photosDeleted = await purgeMemberMedia(caller.id);
  } catch (error) {
    console.error('Could not delete member media; aborting deletion:', error.message);
    return res.status(503).json({
      error: 'media_delete_failed',
      message:
        'We could not delete your stored photo just now, and we will not delete your ' +
        'account while a photo of you is still stored. Please try again in a few minutes.',
    });
  }

  // 2. Everything in the database, in one transaction.
  const { data: summary, error: rpcError } = await supabase.rpc('delete_member_account', {
    p_user_id: caller.id,
  });

  if (rpcError) {
    console.error('delete_member_account failed:', rpcError);
    return res.status(500).json({
      error: 'account_delete_failed',
      message: 'We could not delete your account just now. Please try again in a moment.',
    });
  }

  // 3. The identity itself. GoTrue's admin API rather than a DELETE on
  //    auth.users, so identities, sessions and refresh tokens go with it and
  //    the current access token stops working.
  const { error: authError } = await supabase.auth.admin.deleteUser(caller.id);

  if (authError) {
    /*
      Their data is already gone, so this is not a partial deletion in any sense
      the member would care about — but the login would still work and would
      hand them a blank account they did not ask for. Say it failed and let them
      retry; step 2 is a no-op the second time.
    */
    console.error('auth.users delete failed after data removal:', authError);
    return res.status(500).json({
      error: 'account_delete_failed',
      message: 'We removed your data but could not finish closing your account. Please try again.',
    });
  }

  console.log(
    'Account deleted: user=%s photos=%d summary=%j',
    caller.id,
    photosDeleted,
    summary
  );

  return res.json({
    success: true,
    photosDeleted,
    prefix: referencePrefix(caller.id),
    summary,
  });
}

exports.deleteAccount = async (req, res) => {
  res.set('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGINS || '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const path = (req.path || '/').replace(/\/+$/, '') || '/';

  try {
    if (path.endsWith('/preview')) return await handlePreview(req, res);
    return await handleDelete(req, res);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Reaching this means the client sent something other than the typed
      // confirmation; it is a bug in the client, not something to retry.
      return res.status(400).json({
        error: 'confirmation_required',
        message: 'Deleting an account has to be confirmed explicitly.',
      });
    }

    console.error('account-deletion error:', error);
    return res.status(500).json({
      error: 'account_delete_failed',
      message: 'We could not delete your account just now. Please try again in a moment.',
    });
  }
};
