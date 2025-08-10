const { z } = require('zod');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

// Minimal orchestrator: text generation via existing coach-response-generator;
// image steps are stubbed for now and can be implemented later.

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const OrchestrateRequest = z.object({
  userId: z.string().optional(),
  phone: z.string().optional(),
  coachId: z.string().uuid().optional(),
  userMessage: z.string().optional(),
  plan_key: z.string().optional(),
  overrides: z.record(z.any()).optional()
});

// Simple plan registry (phase 1)
const PLANS = {
  daily_before_after_supportive: {
    policy_profile: 'default',
    presentation_profile: 'sms_short',
    steps: [
      { type: 'image', variants: ['before', 'after'], style: 'auto' },
      { type: 'text', tonePreset: 'supportive', image_refs: ['after'] },
    ],
  },
  chat_text_only: {
    policy_profile: 'default',
    presentation_profile: 'sms_short',
    steps: [ { type: 'text', tonePreset: 'supportive' } ],
  },
};

async function loadUserByPhone(phone) {
  if (!phone) return null;
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, phone_number, coach, coach_type, custom_coach_id, spice_level, image_preference')
    .eq('phone_number', phone)
    .maybeSingle();
  if (error) {
    console.warn('Failed to load user by phone:', error);
    return null;
  }
  return data;
}

function resolvePlan(planKey) {
  if (planKey && PLANS[planKey]) return PLANS[planKey];
  return PLANS.chat_text_only;
}

async function runTextStep({ coachId, userMessage, userContext }) {
  const url = `${process.env.GCP_FUNCTION_BASE_URL}/coach-response-generator`;
  const body = coachId
    ? { coachId, userMessage, userContext }
    : { userMessage, userContext, coachSnapshot: { name: 'Sample Coach', primary_response_style: 'empathetic_mirror' } };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Text generation failed: ${resp.status} ${text}`);
  }
  const json = await resp.json();
  return json.response;
}

exports.orchestrateEngagement = async (req, res) => {
  res.set('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGINS || '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Max-Age', '3600');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    const input = OrchestrateRequest.parse(req.body || {});
    const plan = resolvePlan(input.plan_key);

    // Load user context if provided by phone
    const user = input.phone ? await loadUserByPhone(input.phone) : null;
    const coachId = input.coachId || user?.custom_coach_id || null;
    const userMessage = input.userMessage || '';

    const content = { images: [], text: '', metadata: { plan_key: input.plan_key || 'chat_text_only' } };

    for (const step of plan.steps) {
      if (step.type === 'text') {
        const text = await runTextStep({ coachId, userMessage, userContext: {} });
        content.text = text;
      } else if (step.type === 'image') {
        // Phase 1: stub, to be implemented with adapters to existing image gen
        content.metadata.image_step = { status: 'not_implemented', variants: step.variants };
      }
    }

    return res.json({ success: true, content });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('Orchestrator error:', err);
    return res.status(500).json({ error: 'Internal error', message: err.message });
  }
};


