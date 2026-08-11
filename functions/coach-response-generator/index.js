const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const { z } = require('zod');
const {
  detectEmotionalNeed,
  detectSessionContext,
  resolvePresentation,
  buildSystemPrompt,
  EMOTIONAL_NEEDS,
} = require('./coach-domain');
const { buildSystemPromptV2, buildMessageHistory } = require('./coach-prompt-v2');
const {
  runOnboardingTurn,
  mergeGoals,
  needsOnboarding,
  MAX_ONBOARDING_TURNS,
} = require('./goal-onboarding');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o';
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-ada-002';
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || '';

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

const BaseRequest = z.object({
  userMessage: z.string().min(1).max(4000),
  presentation: z.enum(['sms', 'chat', 'longform']).optional(),
  conversationId: z.string().uuid().optional(),
  /*
    Coach-initiated turns (the nudge dispatcher) pass a synthetic instruction as
    `userMessage`. It steers generation but must never appear in the member's
    thread as something they said.
  */
  suppressUserTurn: z.boolean().optional(),
  /* Service-to-service only: whose thread this is. */
  onBehalfOfUserId: z.string().uuid().optional(),
  userContext: z
    .object({
      emotionalNeed: z.enum(EMOTIONAL_NEEDS).optional(),
      sessionContext: z.string().max(60).optional(),
      previousMessages: z
        .array(
          z.object({
            role: z.enum(['user', 'assistant']),
            content: z.string(),
            timestamp: z.string().optional(),
          })
        )
        .optional(),
    })
    .optional(),
});

const CoachIdVariant = BaseRequest.extend({ coachId: z.string().uuid() });

const CoachSnapshotVariant = BaseRequest.extend({
  coachSnapshot: z
    .object({
      name: z.string().default('Sample Coach'),
      handle: z.string().optional(),
      description: z.string().optional(),
      discipline: z.string().optional(),
      tagline: z.string().optional(),
      expertise: z.array(z.string()).optional(),
      domain_lexicon: z.record(z.any()).optional(),
      session_contexts: z.array(z.string()).optional(),
      coaching_boundaries: z.string().optional(),
      prompt_version: z.enum(['v1', 'v2']).optional(),
      primary_response_style: z.string().optional(),
      secondary_response_style: z.string().optional(),
      emotional_response_map: z.record(z.any()).optional(),
      communication_traits: z.record(z.any()).optional(),
      voice_patterns: z.record(z.any()).optional(),
      catchphrases: z.array(z.string()).optional(),
      vocabulary_preferences: z.record(z.any()).optional(),
      avatar_url: z.string().optional(),
      avatar_style: z.string().optional(),
    })
    .passthrough(),
});

const GenerateResponseRequest = z.union([CoachIdVariant, CoachSnapshotVariant]);

// ---------------------------------------------------------------------------
// Callers
// ---------------------------------------------------------------------------

function isInternalCall(req) {
  const provided = req.get('x-internal-key');
  // Constant-time-ish: an empty configured key must never match.
  return Boolean(INTERNAL_SERVICE_KEY) && provided === INTERNAL_SERVICE_KEY;
}

async function resolveCaller(req) {
  const header = req.get('authorization') || req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return null;

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch (error) {
    console.warn('Failed to resolve caller from token:', error.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Context loading
// ---------------------------------------------------------------------------

async function findRelevantContent(coachId, userMessage, limit = 3) {
  try {
    const embedding = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: userMessage,
    });

    const { data, error } = await supabase.rpc('match_coach_content', {
      coach_id: coachId,
      query_embedding: embedding.data[0].embedding,
      match_threshold: 0.7,
      match_count: limit,
    });

    if (error) {
      console.error('Vector search error:', error);
      return [];
    }
    return data || [];
  } catch (error) {
    console.error('Error finding relevant content:', error);
    return [];
  }
}

async function loadThreadHistory(conversationId, turns = 8) {
  const { data, error } = await supabase
    .from('conversation_messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(turns);

  if (error) {
    console.warn('Failed to load thread history:', error.message);
    return [];
  }

  return (data || [])
    .reverse()
    .map((row) => ({ role: row.role, content: row.content, timestamp: row.created_at }));
}

async function loadMemberContext(userId, coachId) {
  if (!userId || !coachId) return {};
  const { data, error } = await supabase.rpc('get_member_context', {
    p_user_id: userId,
    p_coach_id: coachId,
  });
  if (error) {
    console.warn('Could not load member context:', error.message);
    return {};
  }
  return data || {};
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * v1 is the 2024 prompt, kept verbatim in behaviour so coaches tuned against it
 * are not changed underneath their creator. v2 is the rebuilt one; see
 * coach-prompt-v2.js for what differs.
 */
async function generateCoaching(coach, userMessage, options) {
  const profile = resolvePresentation(options.presentation);
  const version = coach.prompt_version === 'v1' ? 'v1' : 'v2';

  const messages =
    version === 'v1'
      ? [
          { role: 'system', content: buildSystemPrompt(coach, options) },
          { role: 'user', content: userMessage },
        ]
      : [
          { role: 'system', content: buildSystemPromptV2(coach, options) },
          ...buildMessageHistory(options.previousMessages),
          { role: 'user', content: userMessage },
        ];

  const completion = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages,
    max_tokens: profile.maxTokens,
    temperature: 0.8,
    presence_penalty: 0.1,
    frequency_penalty: 0.1,
  });

  return { text: completion.choices[0].message.content.trim(), promptVersion: version };
}

/** Persist the extraction and advance the intake state machine. */
async function saveOnboardingProgress({ userId, coachId, member, learned, complete }) {
  const merged = mergeGoals(member, learned);
  const turns = (member.onboarding_turns || 0) + 1;

  const { error } = await supabase.from('member_goals').upsert(
    {
      user_id: userId,
      coach_id: coachId,
      ...merged,
      onboarding_turns: turns,
      onboarding_status: complete ? 'complete' : 'in_progress',
    },
    { onConflict: 'user_id,coach_id' }
  );

  if (error) console.error('Failed to save onboarding progress:', error);
  return { turns, merged };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

exports.generateCoachResponse = async (req, res) => {
  const startTime = Date.now();

  res.set('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGINS || '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-internal-key');
  res.set('Access-Control-Max-Age', '3600');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    const requestData = GenerateResponseRequest.parse(req.body);
    const { userMessage, userContext = {}, conversationId } = requestData;
    const presentation = requestData.presentation || (conversationId ? 'chat' : 'sms');
    const internal = isInternalCall(req);

    // `suppressUserTurn` and `onBehalfOfUserId` are how a coach speaks first.
    // Both are service-only; a member could otherwise write into someone
    // else's thread or forge an unattributed turn.
    if (!internal && (requestData.suppressUserTurn || requestData.onBehalfOfUserId)) {
      return res.status(403).json({ error: 'suppressUserTurn and onBehalfOfUserId require service credentials' });
    }

    const caller = internal ? null : await resolveCaller(req);
    const suppressUserTurn = Boolean(requestData.suppressUserTurn);

    let coach;
    let coachId = null;

    if ('coachId' in requestData) {
      coachId = requestData.coachId;
      const { data: dbCoach, error: coachError } = await supabase
        .from('coach_profiles')
        .select('*')
        .eq('id', coachId)
        .eq('active', true)
        .single();

      if (coachError || !dbCoach) {
        return res.status(404).json({ error: 'Coach not found or inactive' });
      }
      coach = dbCoach;
    } else {
      coach = requestData.coachSnapshot;
    }

    // ---- Thread -----------------------------------------------------------
    let thread = null;
    if (conversationId) {
      const { data: conversation, error: threadError } = await supabase
        .from('conversations')
        .select('id, user_id, coach_id')
        .eq('id', conversationId)
        .single();

      if (threadError || !conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      if (!internal && (!caller || conversation.user_id !== caller.id)) {
        return res.status(403).json({ error: 'Conversation not found for this user' });
      }
      if (coachId && conversation.coach_id !== coachId) {
        return res.status(400).json({ error: 'Conversation does not belong to this coach' });
      }
      thread = conversation;
    }

    const memberId = caller?.id || thread?.user_id || requestData.onBehalfOfUserId || null;

    // ---- Entitlement ------------------------------------------------------
    // Only enforced for member-initiated turns. A coach-initiated nudge is
    // already gated by due_coach_nudges, which checks access itself.
    if (caller && coachId) {
      const { data: allowed, error: accessError } = await supabase.rpc('has_coach_access', {
        p_user_id: caller.id,
        p_coach_id: coachId,
      });

      if (accessError) {
        console.error('Access check failed:', accessError);
        return res.status(500).json({ error: 'Could not verify coach access' });
      }
      if (!allowed) {
        return res.status(402).json({
          error: 'subscription_required',
          message: `Subscribe to ${coach.name} to keep the conversation going.`,
          coachId,
        });
      }
    }

    // ---- Context ----------------------------------------------------------
    const previousMessages =
      userContext.previousMessages && userContext.previousMessages.length > 0
        ? userContext.previousMessages
        : thread
        ? await loadThreadHistory(thread.id)
        : [];

    const member = coachId ? await loadMemberContext(memberId, coachId) : {};

    // ---- Mode: intake or coaching ----------------------------------------
    const intake =
      coachId &&
      memberId &&
      !suppressUserTurn &&
      needsOnboarding(coach, member);

    let responseText;
    let promptVersion;
    let onboardingState = null;
    // Only populated on the coaching path; intake does not classify intent.
    let detected = null;

    if (intake) {
      const turn = await runOnboardingTurn({
        openai,
        model: CHAT_MODEL,
        coach,
        member,
        history: buildMessageHistory(previousMessages),
        userMessage,
      });

      responseText = turn.reply;
      promptVersion = 'onboarding';

      const saved = await saveOnboardingProgress({
        userId: memberId,
        coachId,
        member,
        learned: turn.learned,
        complete: turn.complete,
      });

      onboardingState = {
        active: !turn.complete,
        complete: turn.complete,
        turn: saved.turns,
        maxTurns: MAX_ONBOARDING_TURNS,
        captured: saved.merged,
      };
    } else {
      const emotionalNeed = userContext.emotionalNeed || detectEmotionalNeed(userMessage);
      const sessionContext =
        userContext.sessionContext ||
        detectSessionContext(userMessage, coach.session_contexts || []);

      const relevantContent = coachId ? await findRelevantContent(coachId, userMessage) : [];

      const generated = await generateCoaching(coach, userMessage, {
        emotionalNeed,
        sessionContext,
        relevantContent,
        presentation,
        previousMessages,
        member,
        initiatedByCoach: suppressUserTurn,
      });

      responseText = generated.text;
      promptVersion = generated.promptVersion;

      onboardingState = { active: false, complete: true };
      detected = { emotionalNeed, sessionContext, relevantContent };
    }

    const latencyMs = Date.now() - startTime;

    // ---- Persist ----------------------------------------------------------
    let assistantMessageId = null;
    if (thread) {
      const rows = [];

      if (!suppressUserTurn) {
        rows.push({
          conversation_id: thread.id,
          role: 'user',
          content: userMessage,
          detected_intent: detected?.emotionalNeed ?? null,
          detected_context: detected?.sessionContext ?? null,
        });
      }

      rows.push({
        conversation_id: thread.id,
        role: 'assistant',
        content: responseText,
        model: CHAT_MODEL,
        latency_ms: latencyMs,
        detected_intent: detected?.emotionalNeed ?? null,
        detected_context: detected?.sessionContext ?? null,
        source_chunk_ids: (detected?.relevantContent || []).map((c) => c.id).filter(Boolean),
        metadata: {
          presentation,
          prompt_version: promptVersion,
          initiated_by: suppressUserTurn ? 'coach' : 'member',
        },
      });

      const { data: inserted, error: persistError } = await supabase
        .from('conversation_messages')
        .insert(rows)
        .select('id, role');

      if (persistError) {
        console.error('Failed to persist conversation messages:', persistError);
      } else {
        assistantMessageId = (inserted || []).find((row) => row.role === 'assistant')?.id ?? null;
      }
    }

    // ---- Metering ---------------------------------------------------------
    // Intake and coach-initiated messages are free: charging someone for
    // answering "what are you working on?" is a bad first impression.
    let freeMessagesRemaining = null;
    if (caller && coachId && !intake && !suppressUserTurn) {
      const { data: remaining, error: meterError } = await supabase.rpc('consume_free_message', {
        p_user_id: caller.id,
        p_coach_id: coachId,
      });
      if (meterError) console.error('Failed to meter free message:', meterError);
      else freeMessagesRemaining = remaining;
    }

    res.json({
      success: true,
      response: responseText,
      metadata: {
        coachId,
        coachName: coach.name,
        discipline: coach.discipline || null,
        responseStyle: coach.primary_response_style,
        emotionalNeed: detected?.emotionalNeed ?? null,
        sessionContext: detected?.sessionContext ?? null,
        presentation,
        promptVersion,
        model: CHAT_MODEL,
        relevantContentCount: detected?.relevantContent?.length ?? 0,
        responseLength: responseText.length,
        latencyMs,
        freeMessagesRemaining,
        assistantMessageId,
        onboarding: onboardingState,
      },
    });
  } catch (error) {
    console.error('Response generation error:', error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }

    res.status(500).json({
      error: 'internal_error',
      message: 'Your coach could not reply just now. Please try again.',
    });
  }
};
