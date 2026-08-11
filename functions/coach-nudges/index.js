/**
 * Proactive coach outreach over push.
 *
 * This replaces the daily Twilio SMS for app users. For each (user, coach)
 * pair that is due, it asks the coach to open a conversation in their own
 * voice, appends that message to the thread so it survives the notification,
 * and sends a push that deep-links straight into the thread.
 *
 * Routes (POST):
 *   /dispatch  cron entry point (hourly). Sweeps everyone who is due.
 *   /preview   authenticated: generate + deliver one nudge to the caller, for
 *              testing notification plumbing on a real device.
 *   /receipts  cron: reconcile Expo push receipts and prune dead tokens.
 *
 * Idempotency lives in the `coach_nudges` outbox, which is unique per
 * (user, coach, local day). A retried or overlapping cron run is a no-op.
 */

const { createClient } = require('@supabase/supabase-js');
const { z } = require('zod');
const { detectCrisis } = require('./crisis');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPT_URL = 'https://exp.host/--/api/v2/push/getPushReceipts';
const RESPONSE_GENERATOR_URL = process.env.COACH_RESPONSE_GENERATOR_URL;

// Expo accepts up to 100 messages per request.
const PUSH_CHUNK_SIZE = 100;
// How many pairs one cron tick will handle. Keeps the function inside its
// timeout; the next tick picks up whatever is left because nothing was queued.
const DISPATCH_BATCH = Number(process.env.NUDGE_BATCH_SIZE || 100);

// ---------------------------------------------------------------------------
// Expo push
// ---------------------------------------------------------------------------

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Send to Expo. Returns one ticket per message, in request order, so the
 * caller can map failures back to the token that caused them.
 */
async function sendExpoPush(messages) {
  const tickets = [];

  for (const batch of chunk(messages, PUSH_CHUNK_SIZE)) {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        ...(process.env.EXPO_ACCESS_TOKEN
          ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Expo push failed: ${response.status} ${text}`);
    }

    const payload = await response.json();
    tickets.push(...(payload.data || []));
  }

  return tickets;
}

/**
 * Apply Expo's per-message verdict. `DeviceNotRegistered` means the app was
 * uninstalled or the token rotated; that token is dead and must not be retried
 * or Expo will eventually rate-limit us.
 */
async function applyTicketOutcomes(tokens, tickets) {
  const dead = [];
  const failed = [];

  tickets.forEach((ticket, index) => {
    const token = tokens[index];
    if (!token) return;

    if (ticket.status === 'ok') return;

    const code = ticket.details?.error;
    if (code === 'DeviceNotRegistered') {
      dead.push(token);
    } else {
      failed.push({ token, message: ticket.message || code || 'unknown' });
    }
  });

  if (dead.length > 0) {
    await supabase
      .from('push_devices')
      .update({ enabled: false, last_error: 'DeviceNotRegistered' })
      .in('expo_token', dead);
    console.log('Disabled %d unregistered device(s)', dead.length);
  }

  for (const entry of failed) {
    // No atomic increment through PostgREST; read-modify-write is fine here
    // because the value is only advisory.
    const { data: device } = await supabase
      .from('push_devices')
      .select('failure_count')
      .eq('expo_token', entry.token)
      .maybeSingle();

    await supabase
      .from('push_devices')
      .update({
        failure_count: (device?.failure_count ?? 0) + 1,
        last_error: entry.message,
      })
      .eq('expo_token', entry.token);
  }

  return { dead: dead.length, failed: failed.length, ok: tickets.length - dead.length - failed.length };
}

async function devicesFor(userIds) {
  if (userIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('push_devices')
    .select('user_id, expo_token')
    .in('user_id', userIds)
    .eq('enabled', true);

  if (error) throw error;

  const byUser = new Map();
  for (const row of data || []) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id).push(row.expo_token);
  }
  return byUser;
}

/** Notification bodies get truncated by the OS; keep the teaser short. */
function teaser(text, max = 140) {
  const collapsed = String(text || '').replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Message generation
// ---------------------------------------------------------------------------

/**
 * Ask the coach to start the conversation. This goes through the same
 * domain-agnostic generator as a reply, so a drummer opens with drumming and a
 * yoga teacher opens with practice — no shared "motivational" template.
 */
async function generateNudge({ coachId, conversationId, displayName, discipline }) {
  if (!RESPONSE_GENERATOR_URL) {
    throw new Error('COACH_RESPONSE_GENERATOR_URL is not configured');
  }

  const prompt =
    `Open today's conversation with ${displayName || 'them'} yourself — they have not written first. ` +
    `Reference ${discipline || 'their practice'} specifically and give them one thing to do or think about today. ` +
    `Ask one question they can answer in a sentence. Do not greet them as if this is your first ever message.`;

  const response = await fetch(RESPONSE_GENERATOR_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Service-to-service: the generator trusts the service key for the
      // internal `systemUserId` path rather than an end-user JWT.
      'x-internal-key': process.env.INTERNAL_SERVICE_KEY || '',
    },
    body: JSON.stringify({
      coachId,
      conversationId,
      userMessage: prompt,
      presentation: 'chat',
      suppressUserTurn: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Generation failed: ${response.status} ${text}`);
  }

  const payload = await response.json();
  return { text: payload.response, messageId: payload.metadata?.assistantMessageId ?? null };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function ensureConversation(userId, coachId, coachName) {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
    .eq('coach_id', coachId)
    .eq('channel', 'app')
    .maybeSingle();

  if (existing) return existing.id;

  const { data, error } = await supabase
    .from('conversations')
    .insert({ user_id: userId, coach_id: coachId, channel: 'app', title: coachName })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

// ---------------------------------------------------------------------------
// Safety hold
// ---------------------------------------------------------------------------

/*
  #30, step 6. A nudge is unprompted outbound cheerfulness on a timer. Sending
  one — "give me one thing you'll do today, what's it going to be?" — to someone
  who told their coach yesterday that they were not safe is its own harm, and it
  happens without anyone reading the thread first.

  So the sweep holds off for a window after any crisis interaction. Two sources,
  because either one alone has a gap:

    1. `metadata->>safety_intervention` on the assistant message, written by
       coach-response-generator when the code path fired.
    2. The member's own recent messages, re-run through the same detector. This
       catches threads that predate this deploy and any path that stored a
       message without the flag.

  It is a hold, not a block: HOLD_HOURS later the normal cadence resumes. The
  member can still write at any time, and the crisis reply itself said so
  ("message me when you've talked to someone"). Going quiet forever would be
  the other failure — the coach vanishing exactly when they said they wouldn't.
*/
const CRISIS_HOLD_HOURS = Number(process.env.NUDGE_CRISIS_HOLD_HOURS || 72);

async function usersOnSafetyHold(userIds) {
  const held = new Set();
  if (userIds.length === 0) return held;

  const since = new Date(Date.now() - CRISIS_HOLD_HOURS * 3600 * 1000).toISOString();

  const { data: conversations, error: convError } = await supabase
    .from('conversations')
    .select('id, user_id')
    .in('user_id', userIds);

  if (convError) {
    // Fail closed on the safety question: if the thread history cannot be read,
    // hold every candidate rather than nudge into an unknown state.
    console.error('Could not read conversations for the crisis hold, holding all:', convError.message);
    return new Set(userIds);
  }

  const owner = new Map((conversations || []).map((row) => [row.id, row.user_id]));
  if (owner.size === 0) return held;

  const { data: messages, error: msgError } = await supabase
    .from('conversation_messages')
    .select('conversation_id, role, content, metadata, created_at')
    .in('conversation_id', [...owner.keys()])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000);

  if (msgError) {
    console.error('Could not read recent messages for the crisis hold, holding all:', msgError.message);
    return new Set(userIds);
  }

  for (const row of messages || []) {
    const userId = owner.get(row.conversation_id);
    if (!userId) continue;

    if (row.metadata?.safety_intervention === 'crisis_escalation') {
      held.add(userId);
      continue;
    }
    if (row.role === 'user' && detectCrisis(row.content).crisis) {
      held.add(userId);
    }
  }

  return held;
}

async function dispatchOne(due, tokensByUser, onSafetyHold = new Set()) {
  const tokens = tokensByUser.get(due.user_id) || [];
  if (tokens.length === 0) return { skipped: 'no_devices' };

  /*
    Claimed before it is skipped, on purpose: the unique index on
    (user, coach, local_date) means the next hourly tick cannot try again today.
  */
  if (onSafetyHold.has(due.user_id)) {
    const { error: holdError } = await supabase.from('coach_nudges').insert({
      user_id: due.user_id,
      coach_id: due.coach_id,
      conversation_id: due.conversation_id,
      local_date: due.local_date,
      status: 'skipped',
      error: `held: crisis disclosure within ${CRISIS_HOLD_HOURS}h`,
    });
    if (holdError && holdError.code !== '23505') throw holdError;
    console.warn('Nudge held for user %s: crisis disclosure inside the hold window', due.user_id);
    return { skipped: 'safety_hold' };
  }

  // Claim the slot first. The unique index on (user, coach, local_date) means
  // a concurrent run loses this insert and stops, so nobody is nudged twice.
  const { data: claim, error: claimError } = await supabase
    .from('coach_nudges')
    .insert({
      user_id: due.user_id,
      coach_id: due.coach_id,
      conversation_id: due.conversation_id,
      local_date: due.local_date,
      status: 'pending',
    })
    .select('id')
    .single();

  if (claimError) {
    if (claimError.code === '23505') return { skipped: 'already_claimed' };
    throw claimError;
  }

  try {
    const conversationId =
      due.conversation_id || (await ensureConversation(due.user_id, due.coach_id, due.coach_name));

    const { text, messageId } = await generateNudge({
      coachId: due.coach_id,
      conversationId,
      displayName: due.display_name,
      discipline: due.discipline,
    });

    const tickets = await sendExpoPush(
      tokens.map((token) => ({
        to: token,
        title: due.coach_name,
        body: teaser(text),
        sound: 'default',
        badge: 1,
        // The app reads this on tap to route straight into the thread.
        data: {
          type: 'coach_nudge',
          coachId: due.coach_id,
          conversationId,
        },
        channelId: 'coach-messages',
        categoryId: 'coach_message',
      }))
    );

    const outcome = await applyTicketOutcomes(tokens, tickets);

    await supabase
      .from('coach_nudges')
      .update({
        status: outcome.ok > 0 ? 'sent' : 'failed',
        conversation_id: conversationId,
        message_id: messageId,
        body: text,
        delivered_count: outcome.ok,
        error: outcome.ok > 0 ? null : 'no device accepted the push',
      })
      .eq('id', claim.id);

    if (outcome.ok > 0) {
      await supabase
        .from('coach_subscriptions')
        .update({ last_nudge_at: new Date().toISOString() })
        .eq('user_id', due.user_id)
        .eq('coach_id', due.coach_id);
    }

    return { delivered: outcome.ok, dead: outcome.dead };
  } catch (error) {
    await supabase
      .from('coach_nudges')
      .update({ status: 'failed', error: String(error.message).slice(0, 500) })
      .eq('id', claim.id);
    throw error;
  }
}

async function handleDispatch(req, res) {
  const { data: due, error } = await supabase.rpc('due_coach_nudges', {
    p_limit: DISPATCH_BATCH,
  });

  if (error) throw error;

  const pairs = due || [];
  if (pairs.length === 0) {
    return res.json({ success: true, considered: 0, sent: 0 });
  }

  const userIds = [...new Set(pairs.map((p) => p.user_id))];
  const tokensByUser = await devicesFor(userIds);
  const onSafetyHold = await usersOnSafetyHold(userIds);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let held = 0;

  // Sequential on purpose: this fans out to an LLM call per pair, and a burst
  // of concurrent generations is the fastest way to hit a rate limit.
  for (const pair of pairs) {
    try {
      const result = await dispatchOne(pair, tokensByUser, onSafetyHold);
      if (result.skipped === 'safety_hold') {
        held += 1;
        skipped += 1;
      } else if (result.skipped) skipped += 1;
      else if (result.delivered > 0) sent += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      console.error('Nudge failed for user %s coach %s: %s', pair.user_id, pair.coach_id, err.message);
    }
  }

  console.log(
    'Nudge sweep: considered=%d sent=%d skipped=%d (held=%d) failed=%d',
    pairs.length,
    sent,
    skipped,
    held,
    failed
  );
  return res.json({ success: true, considered: pairs.length, sent, skipped, held, failed });
}

// ---------------------------------------------------------------------------
// Preview (device testing)
// ---------------------------------------------------------------------------

const PreviewRequest = z.object({ coachId: z.string().uuid() });

async function handlePreview(req, res) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  if (authError || !auth?.user) return res.status(401).json({ error: 'Authentication required' });

  const { coachId } = PreviewRequest.parse(req.body || {});
  const userId = auth.user.id;

  const tokensByUser = await devicesFor([userId]);
  const tokens = tokensByUser.get(userId) || [];
  if (tokens.length === 0) {
    return res.status(422).json({ error: 'No push-enabled device registered for this account' });
  }

  const { data: coach, error: coachError } = await supabase
    .from('coach_profiles')
    .select('id, name, discipline')
    .eq('id', coachId)
    .eq('active', true)
    .single();

  if (coachError || !coach) return res.status(404).json({ error: 'Coach not found' });

  const conversationId = await ensureConversation(userId, coachId, coach.name);
  const tickets = await sendExpoPush(
    tokens.map((expoToken) => ({
      to: expoToken,
      title: coach.name,
      body: `This is what a message from ${coach.name} looks like.`,
      sound: 'default',
      data: { type: 'coach_nudge', coachId, conversationId },
      channelId: 'coach-messages',
    }))
  );

  const outcome = await applyTicketOutcomes(tokens, tickets);
  return res.json({ success: outcome.ok > 0, ...outcome });
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

/**
 * Expo tickets only say "accepted". The receipt, available a few minutes
 * later, says whether APNs/FCM actually took it. This is where most
 * DeviceNotRegistered results really show up.
 */
async function handleReceipts(req, res) {
  const ids = Array.isArray(req.body?.ticketIds) ? req.body.ticketIds : [];
  if (ids.length === 0) return res.json({ success: true, checked: 0 });

  const response = await fetch(EXPO_RECEIPT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.EXPO_ACCESS_TOKEN
        ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({ ids: ids.slice(0, 1000) }),
  });

  if (!response.ok) {
    throw new Error(`Receipt lookup failed: ${response.status}`);
  }

  const { data } = await response.json();
  let unregistered = 0;

  for (const receipt of Object.values(data || {})) {
    if (receipt.status === 'error' && receipt.details?.error === 'DeviceNotRegistered') {
      unregistered += 1;
      const expoToken = receipt.details?.expoPushToken;
      if (expoToken) {
        await supabase
          .from('push_devices')
          .update({ enabled: false, last_error: 'DeviceNotRegistered' })
          .eq('expo_token', expoToken);
      }
    }
  }

  return res.json({ success: true, checked: Object.keys(data || {}).length, unregistered });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/*
  Exported for `mobile/e2e/prompt-eval/crisis-probe.mjs`, which drives the
  safety hold against a stubbed database. Not part of the function's contract —
  Cloud Functions only ever calls `coachNudges`.
*/
exports._internals = { usersOnSafetyHold, CRISIS_HOLD_HOURS };

exports.coachNudges = async (req, res) => {
  res.set('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGINS || '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const path = (req.path || '/').replace(/\/+$/, '') || '/';

  try {
    if (path.endsWith('/preview')) return await handlePreview(req, res);
    if (path.endsWith('/receipts')) return await handleReceipts(req, res);
    // Cloud Scheduler posts to the bare function URL.
    return await handleDispatch(req, res);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('coach-nudges error:', error);
    return res.status(500).json({ error: 'internal_error', message: 'Something went wrong.' });
  }
};
