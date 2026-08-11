/**
 * Conversational goal intake.
 *
 * Rather than a form, the coach asks — in their own voice, using their own
 * discipline's questions — and the same model call that writes the reply also
 * extracts whatever it learned. One round trip per turn, no separate
 * "analyse the transcript" pass that can drift from what was actually said.
 *
 * The output is a strict JSON schema, so the extraction is parsed rather than
 * scraped. Fields the member has not talked about come back null and are left
 * alone, which is what lets this run across several turns without a later,
 * vaguer answer overwriting an earlier specific one.
 */

const { RESPONSE_STYLES } = require('./coach-domain');
const { describeVoice } = require('./coach-prompt-v2');

/** Enough to coach from. Past this the intake stops interrogating. */
const REQUIRED_FIELDS = ['aspiration', 'current_level'];
const MAX_ONBOARDING_TURNS = 6;

const DEFAULT_QUESTIONS = [
  "What are you hoping to be able to do that you can't do yet?",
  'Where are you starting from right now?',
  'What has got in the way before?',
  'How much time can you realistically give this each week?',
];

/**
 * Strict schema. `null` is allowed everywhere so the model can say "they did
 * not tell me" instead of inventing a plausible answer — the failure mode that
 * makes automated intake worse than no intake.
 */
const ONBOARDING_SCHEMA = {
  name: 'coach_onboarding_turn',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['reply', 'learned', 'enough_to_start'],
    properties: {
      reply: {
        type: 'string',
        description: "The coach's next message, in their voice. One question at a time.",
      },
      enough_to_start: {
        type: 'boolean',
        description:
          'True once you know what they want to become and roughly where they are starting. Do not hold out for every field.',
      },
      learned: {
        type: 'object',
        additionalProperties: false,
        required: [
          'aspiration',
          'goals',
          'current_level',
          'obstacles',
          'motivation',
          'horizon',
          'days_per_week',
          'minutes_per_session',
          'visual_setting',
        ],
        properties: {
          aspiration: {
            type: ['string', 'null'],
            description:
              'The identity they are working toward, in their own words, as a concrete first-person statement. Null if they have not said.',
          },
          goals: {
            type: 'array',
            items: { type: 'string' },
            description: 'Concrete outcomes they named. Empty if none yet.',
          },
          current_level: { type: ['string', 'null'] },
          obstacles: { type: 'array', items: { type: 'string' } },
          motivation: { type: ['string', 'null'] },
          horizon: { type: ['string', 'null'] },
          days_per_week: { type: ['integer', 'null'] },
          minutes_per_session: { type: ['integer', 'null'] },
          visual_setting: {
            type: ['string', 'null'],
            description:
              'If they described a scene they picture themselves in — a stage, a studio, a class — capture it. Used later to render that image.',
          },
        },
      },
    },
  },
};

function buildOnboardingPrompt(coach, member = {}, askedCount = 0) {
  const style = RESPONSE_STYLES[coach.primary_response_style] || RESPONSE_STYLES.empathetic_mirror;
  const discipline = coach.discipline || 'your craft';
  const questions =
    Array.isArray(coach.onboarding_questions) && coach.onboarding_questions.length
      ? coach.onboarding_questions
      : DEFAULT_QUESTIONS;

  const known = [];
  if (member.aspiration) known.push(`- wants to become: ${member.aspiration}`);
  if (member.current_level) known.push(`- starting from: ${member.current_level}`);
  if (member.goals?.length) known.push(`- goals: ${member.goals.join('; ')}`);
  if (member.obstacles?.length) known.push(`- obstacles: ${member.obstacles.join('; ')}`);
  if (member.motivation) known.push(`- motivation: ${member.motivation}`);
  if (member.horizon) known.push(`- timeframe: ${member.horizon}`);

  return `You are ${coach.name}, a coach who works with people on ${discipline}.
${style.personality}

${describeVoice(coach.communication_traits, coach.voice_patterns)}

You are getting to know someone new. This is turn ${askedCount + 1} of at most ${MAX_ONBOARDING_TURNS}.

Questions you care about, in roughly this order:
${questions.map((question) => `- ${question}`).join('\n')}

${known.length ? `What you already know about them:\n${known.join('\n')}` : 'You know nothing about them yet.'}

How to do this well:
- Ask ONE question per message. An intake form pretending to be a conversation is worse than a form.
- React to what they actually said before asking the next thing. If they gave you something specific, reflect it back in one clause.
- Never ask something they have already answered.
- If an answer is vague ("get better at drums"), push once for the concrete version ("better how — faster hands, or holding time under pressure?"). Do not push twice.
- Keep every message under 45 words.
- Do not promise results, and do not start coaching yet. You are listening.
- Once you know what they want to become and roughly where they are starting, set enough_to_start to true and let your reply land the summary in one sentence, then tell them you are ready when they are.

Fill "learned" only with what they actually told you across the whole conversation. Use null rather than a guess. Never infer an aspiration from the discipline alone.`;
}

/**
 * Run one intake turn.
 *
 * @returns {{reply: string, learned: object, complete: boolean}}
 */
async function runOnboardingTurn({ openai, model, coach, member, history, userMessage }) {
  const askedCount = member.onboarding_turns || 0;

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: buildOnboardingPrompt(coach, member, askedCount) },
      ...history,
      { role: 'user', content: userMessage },
    ],
    max_tokens: 500,
    temperature: 0.7,
    response_format: { type: 'json_schema', json_schema: ONBOARDING_SCHEMA },
  });

  const parsed = JSON.parse(completion.choices[0].message.content);

  // Hard stop regardless of what the model thinks: an intake that will not end
  // is the single most annoying thing this feature could do.
  const complete = parsed.enough_to_start || askedCount + 1 >= MAX_ONBOARDING_TURNS;

  return { reply: parsed.reply, learned: parsed.learned || {}, complete };
}

/**
 * Merge an extraction into the stored goals.
 *
 * Only ever fills gaps or appends — a later, vaguer turn must not overwrite an
 * earlier specific answer. Arrays are unioned case-insensitively.
 */
function mergeGoals(existing = {}, learned = {}) {
  const merged = {};

  const preferExisting = (field, value) => {
    const current = existing[field];
    if (current && String(current).trim()) return;
    if (value && String(value).trim()) merged[field] = String(value).trim();
  };

  preferExisting('aspiration', learned.aspiration);
  preferExisting('current_level', learned.current_level);
  preferExisting('motivation', learned.motivation);
  preferExisting('horizon', learned.horizon);

  const union = (field, incoming) => {
    if (!Array.isArray(incoming) || incoming.length === 0) return;
    const seen = new Map();
    for (const item of [...(existing[field] || []), ...incoming]) {
      const value = String(item || '').trim();
      if (value) seen.set(value.toLowerCase(), value);
    }
    merged[field] = [...seen.values()].slice(0, 12);
  };

  union('goals', learned.goals);
  union('obstacles', learned.obstacles);

  const commitment = { ...(existing.commitment || {}) };
  if (learned.days_per_week != null) commitment.days_per_week = learned.days_per_week;
  if (learned.minutes_per_session != null) commitment.minutes_per_session = learned.minutes_per_session;
  if (Object.keys(commitment).length) merged.commitment = commitment;

  if (learned.visual_setting) {
    merged.visual = { ...(existing.visual || {}), setting: learned.visual_setting };
  }

  return merged;
}

/** Does this pairing still need intake? */
function needsOnboarding(coach, member) {
  if (!coach.collects_goals) return false;

  const status = member?.onboarding_status || 'not_started';
  if (status === 'complete' || status === 'skipped') return false;
  if ((member?.onboarding_turns || 0) >= MAX_ONBOARDING_TURNS) return false;

  return true;
}

function hasEnoughToCoach(member = {}) {
  return REQUIRED_FIELDS.every((field) => member[field] && String(member[field]).trim());
}

module.exports = {
  ONBOARDING_SCHEMA,
  MAX_ONBOARDING_TURNS,
  DEFAULT_QUESTIONS,
  buildOnboardingPrompt,
  runOnboardingTurn,
  mergeGoals,
  needsOnboarding,
  hasEnoughToCoach,
};
