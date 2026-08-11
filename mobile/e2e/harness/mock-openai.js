/**
 * Minimal OpenAI stand-in so the pipeline can be exercised without credits.
 *
 * It is deliberately not "smart": it returns schema-valid structured output and
 * a reply that echoes discipline vocabulary out of the system prompt. That is
 * enough to test everything that is actually mine — routing, extraction
 * merging, persistence, metering, the paywall, suppressUserTurn, the nudge
 * outbox — without testing GPT-4o, which is not under test here.
 */
const express = require('express');

const app = express();
app.use(express.json({ limit: '4mb' }));

function reply(content) {
  return {
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'mock',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  };
}

/** Pull the discipline out of the system prompt so replies stay on-topic. */
function disciplineFrom(system) {
  const m = system.match(/You coach people on ([^.\n]+)/) || system.match(/coach who works with people on ([^.\n]+)/);
  return m ? m[1].trim() : 'your practice';
}

app.post('/v1/chat/completions', (req, res) => {
  const { messages = [], response_format } = req.body;
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const userTurns = messages.filter((m) => m.role === 'user').map((m) => m.content);
  const latest = userTurns[userTurns.length - 1] ?? '';
  const transcript = userTurns.join(' \n ').toLowerCase();
  const schemaName = response_format?.json_schema?.name;

  if (schemaName === 'coach_onboarding_turn') {
    // Extract only what the member actually said, mirroring the real contract.
    const learned = {
      aspiration: /want to be able to|i want to|sit in with|hold the pocket/.test(transcript)
        ? 'someone who can sit in with any band and hold the pocket all night'
        : null,
      goals: /gig/.test(transcript) ? ['play a gig by spring'] : [],
      current_level: /two years|bedroom/.test(transcript) ? 'two years of bedroom practice' : null,
      obstacles: /falls apart|quitting|hi-?hat/.test(transcript)
        ? ['time falls apart when adding the hi-hat', 'quits after about a week']
        : [],
      motivation: /because|matters|love/.test(transcript) ? 'wants to play with other people' : null,
      horizon: /spring|month|year/.test(transcript) ? 'by spring' : null,
      days_per_week: /(\d+)\s*days?\s*a\s*week/.test(transcript)
        ? Number(transcript.match(/(\d+)\s*days?\s*a\s*week/)[1]) : null,
      minutes_per_session: /(\d+)\s*min/.test(transcript)
        ? Number(transcript.match(/(\d+)\s*min/)[1]) : null,
      visual_setting: /stage|club|band|gig/.test(transcript) ? 'a small packed club stage' : null,
    };

    // "Enough to start" once aspiration + level are known, matching the real rule.
    const enough = Boolean(learned.aspiration && learned.current_level && learned.days_per_week);

    return res.json(reply(JSON.stringify({
      reply: enough
        ? `Got it — ${learned.aspiration}, four days a week. That's workable. Ready when you are.`
        : `Right. Tell me more about where you're at with ${disciplineFrom(system)}.`,
      enough_to_start: enough,
      learned,
    })));
  }

  if (schemaName === 'visualization_scene') {
    // Echo the coach's discipline and the member's own words back out, the way
    // a real model would. Nothing here is discipline-aware on its own, which is
    // the point: if the brief says drumming the scene is drumming, and if it
    // says yoga the scene is yoga, with no branch in the pipeline.
    const brief = system.match(/A member of (.+?)'s (.+?) practice is going to see/);
    const coachName = brief?.[1] ?? 'your coach';
    const discipline = (brief?.[2] ?? 'their practice').toLowerCase();
    const aspiration = system.match(/Wants to become: (.+)/)?.[1]?.toLowerCase() ?? null;
    const setting = system.match(/A place they pictured themselves: (.+)/)?.[1] ?? null;
    const self = system.match(/How they want to be depicted: (.+)/)?.[1] ?? null;

    return res.json(reply(JSON.stringify({
      scene: aspiration
        ? `You in the middle of ${discipline} — ${aspiration}.`
        : `You in the middle of ${discipline}, on an ordinary day.`,
      image_prompt:
        `${self || 'A person'} deep in ${discipline}` +
        `${setting ? ` in ${setting}` : ''}` +
        `${aspiration ? `, working toward being ${aspiration}` : ''}` +
        ', hands busy, warm side light from a window, shallow depth of field, ' +
        'candid documentary photograph',
      caption: `${coachName}: this is what ${discipline} looks like on a good day.`,
    })));
  }

  // Plain coaching turn. Echo discipline vocabulary so downstream assertions
  // about domain-specificity are meaningful.
  const discipline = disciplineFrom(system);
  const isCoachInitiated = /You are opening this conversation/.test(system);
  const knowsMember = /<member>/.test(system);
  const promptVersion = /<output_rules>/.test(system) ? 'v2' : 'v1';

  return res.json(reply(
    `${isCoachInitiated ? 'Morning. ' : ''}` +
    `[${promptVersion}${knowsMember ? '+member' : ''}] Working on ${discipline} today. ` +
    `You said: "${String(latest).slice(0, 60)}". Slow it down until it's boring, then bring the hi-hat back in. ` +
    `What tempo did you land on?`
  ));
});

/*
  The embedding format matters, and getting it wrong is silent.

  Since v4.7 the OpenAI SDK sends `encoding_format: 'base64'` whenever the
  caller did not pick one, and then decodes the response itself. Handing it a
  plain JSON array of 1536 numbers does not fail — it gets run through
  `Buffer.from(array)`, which truncates every float to one byte, and the 1536
  bytes are then reinterpreted as 384 float32s. The caller receives a
  well-formed 384-dimension vector, and the only symptom is
  `different vector dimensions 1536 and 384` from pgvector, far from the cause.

  So honour the requested format. Returning floats when floats were asked for
  keeps this usable from curl.
*/
const MOCK_VECTOR = Array.from({ length: 1536 }, (_, i) => Math.sin(i) * 0.01);

app.post('/v1/embeddings', (req, res) => {
  const inputs = Array.isArray(req.body.input) ? req.body.input : [req.body.input];
  const asBase64 = req.body.encoding_format === 'base64';
  const embedding = asBase64
    ? Buffer.from(new Float32Array(MOCK_VECTOR).buffer).toString('base64')
    : MOCK_VECTOR;

  res.json({
    object: 'list',
    model: 'mock-embedding',
    data: inputs.map((_, index) => ({ object: 'embedding', index, embedding })),
    usage: { prompt_tokens: 10, total_tokens: 10 },
  });
});

// Overridable so a second stack can run alongside the first.
const PORT = Number(process.env.PORT || 8791);
app.listen(PORT, () => console.log(`mock openai on http://127.0.0.1:${PORT}/v1`));
