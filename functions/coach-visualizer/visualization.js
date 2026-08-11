/**
 * "See yourself, becoming."
 *
 * The old image pipeline picked a random before/after pair out of
 * `scenarios.json` and swapped the word "person" for the user's
 * `image_preference`. Every user in every discipline got the same handful of
 * gym scenes, and the "before" image was explicitly prompted toward *weak,
 * frail, sad, nervous* — a shame-based frame that only ever made sense for one
 * vertical, and arguably not even there.
 *
 * The retool: the member tells the coach who they want to become during
 * intake, and that sentence becomes the image. A drummer sees themselves
 * holding a room; a songwriter sees the finished record; a yoga teacher sees a
 * steady handstand at sunrise. No before. No transformation pairing. One
 * aspirational scene, specific to them.
 */

/**
 * Turn an aspiration into something a diffusion model can actually render.
 *
 * Aspirations are abstract ("someone who can sit in with any band"). Diffusion
 * models need a scene: subject, action, place, light, framing. This is the one
 * job worth an LLM call in the pipeline.
 */
const SCENE_SCHEMA = {
  name: 'visualization_scene',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['scene', 'image_prompt', 'caption'],
    properties: {
      scene: {
        type: 'string',
        description: 'One plain sentence describing the moment, for the member to read.',
      },
      image_prompt: {
        type: 'string',
        description:
          'A photographic prompt: subject, action, setting, lighting, lens, mood. No text, no logos, no collage.',
      },
      caption: {
        type: 'string',
        description: 'A short line from the coach, in their voice, under 100 characters.',
      },
    },
  },
};

const KIND_BRIEFS = {
  becoming:
    'The moment they are working toward — them, fully inhabiting the thing they said they want to become. ' +
    'Not a fantasy version of them: the same person, further along.',
  milestone:
    'The specific goal they named, achieved. Concrete and modest rather than epic — the actual moment it would happen.',
  today:
    'An ordinary moment from the practice itself, today. Unglamorous, warm, real. The work rather than the reward.',
};

/**
 * Build the scene brief. Everything about the person comes from what they told
 * their coach; nothing is inferred from demographics.
 */
function buildScenePrompt({ coach, member, kind = 'becoming' }) {
  const discipline = coach.discipline || 'their practice';
  const visual = member.visual || {};

  const known = [
    member.aspiration ? `Wants to become: ${member.aspiration}` : null,
    member.current_level ? `Currently: ${member.current_level}` : null,
    Array.isArray(member.goals) && member.goals.length
      ? `Goals: ${member.goals.slice(0, 4).join('; ')}`
      : null,
    member.motivation ? `Why it matters: ${member.motivation}` : null,
    visual.setting ? `A place they pictured themselves: ${visual.setting}` : null,
    visual.self ? `How they want to be depicted: ${visual.self}` : null,
    visual.avoid ? `Must not appear: ${visual.avoid}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `You write image briefs for a coaching app. A member of ${coach.name}'s ${discipline} practice is going to see one picture of themselves.

What we know about them:
${known || '(nothing yet — keep the scene about the discipline itself, not about them specifically)'}

What to depict: ${KIND_BRIEFS[kind] || KIND_BRIEFS.becoming}

Rules for the image prompt:
- One person, one moment, one place. No collages, no before/after, no split frames.
- Describe what they are DOING, not what they look like. Competence is shown through action and posture.
- Ground it in ${discipline} specifically — the real equipment, the real room, the real posture.
- Give it real light: time of day, source, direction.
- Photographic, candid, documentary. Not a stock photo, not an advertisement, not a magazine cover.
- Absolutely no text, words, logos, or signage in the image.
- Do not describe body size, weight, attractiveness, or age. The picture is about capability, not appearance.
- Do not depict a crowd's admiration or a trophy. Achievement is in their hands and their focus.

The caption is one line from ${coach.name} to this member about the image, in ${coach.name}'s voice.`;
}

async function generateScene({ openai, model, coach, member, kind = 'becoming' }) {
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: buildScenePrompt({ coach, member, kind }) },
      {
        role: 'user',
        content: 'Write the brief for this member.',
      },
    ],
    max_tokens: 400,
    temperature: 0.9,
    response_format: { type: 'json_schema', json_schema: SCENE_SCHEMA },
  });

  return JSON.parse(completion.choices[0].message.content);
}

/**
 * Shared negative prompt.
 *
 * Note what is gone from the 2024 version: it used to push the "before" image
 * toward `weak, frail, sad, nervous, skinny, chubby, overweight`. Body
 * descriptors are now on the *negative* side for every image, because none of
 * these disciplines are about how someone looks.
 */
const NEGATIVE_PROMPT = [
  'text, words, letters, watermark, signature, logo, caption, subtitles',
  'collage, split screen, before and after, diptych, multiple panels',
  'nsfw, nudity, suggestive',
  'deformed hands, extra fingers, missing fingers, bad anatomy, extra limbs',
  'lowres, blurry, jpeg artifacts, worst quality, oversaturated',
  'stock photo, advertisement, magazine cover, staged smile',
].join(', ');

/**
 * Model selection.
 *
 * PhotoMaker keeps the member's own face, which is the whole point — a generic
 * stranger achieving your goal is not motivating. It needs a reference photo
 * and explicit likeness consent; without both we fall back to a model that
 * renders the scene with no identifiable person.
 */
const MODELS = {
  WITH_LIKENESS: {
    id: 'tencentarc/photomaker:ddfc2b08d209f9fa8c1eca692712918bd449f695dabb4a958da31802a9570fe4',
    build: (prompt, referencePhotoUrl) => ({
      // PhotoMaker requires the literal trigger word "img" after the subject.
      prompt: `${prompt} img, natural skin, sharp focus, perfect eyes`,
      input_image: referencePhotoUrl,
      num_steps: 50,
      num_outputs: 1,
      style_strength_ratio: 25,
      negative_prompt: NEGATIVE_PROMPT,
    }),
  },
  SCENE_ONLY: {
    id: 'black-forest-labs/flux-schnell',
    build: (prompt) => ({
      prompt: `${prompt}. Shot from behind or at a distance so no face is identifiable.`,
      num_outputs: 1,
      aspect_ratio: '3:4',
      output_format: 'jpg',
      output_quality: 90,
    }),
  },
};

function chooseModel({ referencePhotoUrl, likenessConsent }) {
  return referencePhotoUrl && likenessConsent ? MODELS.WITH_LIKENESS : MODELS.SCENE_ONLY;
}

module.exports = {
  SCENE_SCHEMA,
  KIND_BRIEFS,
  NEGATIVE_PROMPT,
  MODELS,
  buildScenePrompt,
  generateScene,
  chooseModel,
};
