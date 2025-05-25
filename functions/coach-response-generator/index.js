const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const fetch = require('node-fetch');
const { z } = require('zod');

// Initialize services
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Validation schemas
const GenerateResponseRequest = z.object({
  coachId: z.string().uuid(),
  userMessage: z.string().min(1).max(1000),
  userContext: z.object({
    emotionalNeed: z.enum(['encouragement', 'commiseration', 'pity', 'celebration', 'advice', 'accountability', 'check_in']).optional(),
    situation: z.enum(['pre_workout', 'post_workout', 'struggling', 'plateau', 'beginner', 'advanced', 'injury_recovery']).optional(),
    previousMessages: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
      timestamp: z.string()
    })).optional()
  }).optional()
});

/**
 * Response style patterns mapped to coaching styles
 */
const RESPONSE_STYLES = {
  tough_love: {
    personality: "Direct, challenging coach who never coddles and redirects complaints into action. Uses firm but supportive language.",
    patterns: [
      "No excuses, let's focus on solutions",
      "I hear you, but what are you going to DO about it?",
      "Champions are made in moments like this",
      "Stop making excuses and start making progress"
    ],
    tone: "firm, direct, action-oriented"
  },
  empathetic_mirror: {
    personality: "Understanding coach who validates feelings first, then motivates from a place of empathy and connection.",
    patterns: [
      "I completely understand how you're feeling",
      "That sounds really challenging, and your feelings are valid",
      "Many people go through exactly what you're experiencing",
      "Let's work through this together"
    ],
    tone: "warm, validating, supportive"
  },
  reframe_master: {
    personality: "Optimistic coach who always finds the positive angle and helps people see opportunities in challenges.",
    patterns: [
      "Here's another way to look at this situation",
      "What if this is actually an opportunity to",
      "The silver lining here is",
      "This challenge is preparing you for"
    ],
    tone: "positive, reframing, opportunity-focused"
  },
  data_driven: {
    personality: "Evidence-based coach who uses facts, research, and metrics to support advice and motivation.",
    patterns: [
      "Studies show that",
      "The data indicates",
      "Research has proven",
      "Statistically speaking"
    ],
    tone: "factual, evidence-based, logical"
  },
  story_teller: {
    personality: "Relatable coach who shares personal anecdotes and experiences to connect and motivate.",
    patterns: [
      "I remember when I",
      "This reminds me of a time when",
      "I had a client who",
      "Let me tell you about"
    ],
    tone: "personal, narrative, experiential"
  },
  cheerleader: {
    personality: "High-energy, enthusiastic coach full of excitement and celebration.",
    patterns: [
      "YES! You've got this!",
      "I'm SO proud of you!",
      "This is AMAZING progress!",
      "Keep that incredible energy going!"
    ],
    tone: "enthusiastic, celebratory, high-energy"
  },
  wise_mentor: {
    personality: "Calm, thoughtful coach who provides deeper wisdom and life lessons.",
    patterns: [
      "In my experience",
      "The deeper lesson here is",
      "True growth comes from",
      "Remember that this journey is about"
    ],
    tone: "calm, wise, philosophical"
  }
};

/**
 * Detect emotional need from user message
 */
function detectEmotionalNeed(message) {
  const lowercaseMessage = message.toLowerCase();
  
  // Celebration keywords
  if (lowercaseMessage.includes('pr') || lowercaseMessage.includes('personal record') || 
      lowercaseMessage.includes('achieved') || lowercaseMessage.includes('accomplished') ||
      lowercaseMessage.includes('hit my goal') || lowercaseMessage.includes('succeeded')) {
    return 'celebration';
  }
  
  // Struggle/pity keywords
  if (lowercaseMessage.includes('tired') || lowercaseMessage.includes('exhausted') ||
      lowercaseMessage.includes('can\'t') || lowercaseMessage.includes('impossible') ||
      lowercaseMessage.includes('giving up') || lowercaseMessage.includes('quit')) {
    return 'commiseration';
  }
  
  // Advice keywords
  if (lowercaseMessage.includes('what should') || lowercaseMessage.includes('how do i') ||
      lowercaseMessage.includes('advice') || lowercaseMessage.includes('recommend') ||
      lowercaseMessage.includes('help me') || lowercaseMessage.includes('what do you think')) {
    return 'advice';
  }
  
  // Accountability keywords
  if (lowercaseMessage.includes('supposed to') || lowercaseMessage.includes('committed to') ||
      lowercaseMessage.includes('promised') || lowercaseMessage.includes('accountability')) {
    return 'accountability';
  }
  
  // Default to encouragement
  return 'encouragement';
}

/**
 * Detect situation from user message
 */
function detectSituation(message) {
  const lowercaseMessage = message.toLowerCase();
  
  if (lowercaseMessage.includes('before') || lowercaseMessage.includes('about to') ||
      lowercaseMessage.includes('getting ready')) {
    return 'pre_workout';
  }
  
  if (lowercaseMessage.includes('finished') || lowercaseMessage.includes('completed') ||
      lowercaseMessage.includes('just did') || lowercaseMessage.includes('after')) {
    return 'post_workout';
  }
  
  if (lowercaseMessage.includes('stuck') || lowercaseMessage.includes('plateau') ||
      lowercaseMessage.includes('same weight') || lowercaseMessage.includes('not progressing')) {
    return 'plateau';
  }
  
  if (lowercaseMessage.includes('struggling') || lowercaseMessage.includes('difficult') ||
      lowercaseMessage.includes('hard time')) {
    return 'struggling';
  }
  
  if (lowercaseMessage.includes('new to') || lowercaseMessage.includes('beginner') ||
      lowercaseMessage.includes('first time') || lowercaseMessage.includes('starting')) {
    return 'beginner';
  }
  
  return null; // No specific situation detected
}

/**
 * Find relevant content using vector similarity search
 */
async function findRelevantContent(coachId, userMessage, limit = 3) {
  try {
    // Generate embedding for user message
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: userMessage,
    });
    
    const userEmbedding = embeddingResponse.data[0].embedding;
    
    // Use Supabase's vector similarity search
    const { data: similarContent, error } = await supabase.rpc(
      'match_coach_content',
      {
        coach_id: coachId,
        query_embedding: userEmbedding,
        match_threshold: 0.7,
        match_count: limit
      }
    );
    
    if (error) {
      console.error('Vector search error:', error);
      return [];
    }
    
    return similarContent || [];
  } catch (error) {
    console.error('Error finding relevant content:', error);
    return [];
  }
}

/**
 * Build conversation context from previous messages
 */
function buildConversationContext(previousMessages = []) {
  if (!previousMessages || previousMessages.length === 0) {
    return "";
  }
  
  const recentMessages = previousMessages.slice(-4); // Last 4 messages for context
  const contextString = recentMessages
    .map(msg => `${msg.role === 'user' ? 'User' : 'Coach'}: ${msg.content}`)
    .join('\n');
  
  return `\n\nPrevious conversation context:\n${contextString}\n\n`;
}

/**
 * Generate AI response using coach personality and content
 */
async function generateCoachResponse(coach, userMessage, userContext = {}, relevantContent = []) {
  const responseStyle = RESPONSE_STYLES[coach.primary_response_style] || RESPONSE_STYLES.empathetic_mirror;
  const communicationTraits = coach.communication_traits || {};
  const voicePatterns = coach.voice_patterns || {};
  
  // Detect context if not provided
  const emotionalNeed = userContext.emotionalNeed || detectEmotionalNeed(userMessage);
  const situation = userContext.situation || detectSituation(userMessage);
  
  // Build conversation context
  const conversationContext = buildConversationContext(userContext.previousMessages);
  
  // Prepare voice characteristics
  const energyLevel = communicationTraits.energy_level || 5;
  const directness = communicationTraits.directness || 5;
  const emotionFocus = communicationTraits.emotion_focus || 5;
  
  const voiceDescription = `
Energy Level: ${energyLevel}/10 (${energyLevel > 7 ? 'high energy' : energyLevel > 4 ? 'moderate energy' : 'calm'})
Directness: ${directness}/10 (${directness > 7 ? 'very direct' : directness > 4 ? 'moderately direct' : 'gentle'})
Approach: ${emotionFocus > 6 ? 'emotion-focused' : emotionFocus < 4 ? 'logic-focused' : 'balanced'}
Sentence Structure: ${voicePatterns.sentence_structure || 'mixed_varied'}
Vocabulary: ${voicePatterns.vocabulary_level || 'professional'}
`;

  // Include catchphrases if available
  const catchphrases = coach.catchphrases && coach.catchphrases.length > 0 
    ? `\nKnown catchphrases: ${coach.catchphrases.slice(0, 3).join(', ')}`
    : '';
  
  // Prepare relevant content context
  const contentContext = relevantContent.length > 0
    ? `\n\nRelevant examples from ${coach.name}'s content:\n${relevantContent.map(content => 
        `- ${content.content.substring(0, 200)}...`
      ).join('\n')}`
    : '';
  
  const systemPrompt = `You are ${coach.name}, an AI fitness coach with the following characteristics:

CORE PERSONALITY: ${responseStyle.personality}

RESPONSE STYLE: ${coach.primary_response_style}
- Tone: ${responseStyle.tone}
- Typical patterns: ${responseStyle.patterns.join('; ')}

VOICE CHARACTERISTICS:
${voiceDescription}${catchphrases}

CONTEXT:
- User's emotional need: ${emotionalNeed}
- User's situation: ${situation || 'general'}
- Your description: ${coach.description || 'Not provided'}${contentContext}

INSTRUCTIONS:
1. Respond as ${coach.name} in your authentic voice and style
2. Address the user's ${emotionalNeed} need appropriately
3. Keep responses conversational and under 160 characters for SMS
4. Match your energy level (${energyLevel}/10) and directness (${directness}/10)
5. Use your typical response patterns when appropriate
6. Be helpful while staying true to your personality
${catchphrases ? '7. Naturally incorporate your catchphrases when fitting' : ''}

${conversationContext}

Respond to this user message: "${userMessage}"`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      max_tokens: 150,
      temperature: 0.8,
      presence_penalty: 0.1,
      frequency_penalty: 0.1
    });

    return completion.choices[0].message.content.trim();
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw new Error('Failed to generate response');
  }
}

/**
 * Main Cloud Function entry point
 */
exports.generateCoachResponse = async (req, res) => {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGINS || '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Max-Age', '3600');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    // Validate request
    const requestData = GenerateResponseRequest.parse(req.body);
    const { coachId, userMessage, userContext = {} } = requestData;
    
    console.log(`Generating response for coach ${coachId}: "${userMessage}"`);
    
    // Get coach data
    const { data: coach, error: coachError } = await supabase
      .from('coach_profiles')
      .select('*')
      .eq('id', coachId)
      .eq('active', true)
      .single();
    
    if (coachError || !coach) {
      return res.status(404).json({ error: 'Coach not found or inactive' });
    }
    
    // Find relevant content using vector search
    console.log('Finding relevant content...');
    const relevantContent = await findRelevantContent(coachId, userMessage);
    
    // Generate response
    console.log('Generating AI response...');
    const response = await generateCoachResponse(coach, userMessage, userContext, relevantContent);
    
    // Log the interaction (optional - for analytics)
    try {
      await supabase.from('coach_test_messages').insert({
        coach_id: coachId,
        user_message: userMessage,
        coach_response: response,
        user_context: userContext,
        emotional_need: userContext.emotionalNeed || detectEmotionalNeed(userMessage),
        situation: userContext.situation || detectSituation(userMessage),
        relevant_content_ids: relevantContent.map(c => c.id),
        response_time_ms: Date.now() - req.startTime
      });
    } catch (logError) {
      console.warn('Failed to log interaction:', logError);
      // Don't fail the request if logging fails
    }
    
    console.log(`Generated response: "${response}"`);
    
    res.json({
      success: true,
      response: response,
      metadata: {
        coachName: coach.name,
        responseStyle: coach.primary_response_style,
        emotionalNeed: userContext.emotionalNeed || detectEmotionalNeed(userMessage),
        situation: userContext.situation || detectSituation(userMessage),
        relevantContentCount: relevantContent.length,
        responseLength: response.length
      }
    });
    
  } catch (error) {
    console.error('Response generation error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Invalid request data',
        details: error.errors 
      });
    }
    
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}; 