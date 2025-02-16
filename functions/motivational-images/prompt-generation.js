const OpenAI = require('openai');
const { COACH_PERSONAS } = require('./coach-personas');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SPICE_LEVEL_DESCRIPTIONS = {
  1: "Keep it mild and encouraging",
  2: "Add a bit of playful teasing",
  3: "Include moderate sass and challenge",
  4: "Bring strong motivation and intensity",
  5: "Maximum intensity and dramatic flair"
};

async function generateActionModifier() {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "Generate a short, specific beach fitness activity description (2-4 words) that would work well for showing a fitness transformation:\n1. Must be an active, exercise-oriented activity\n2. Should demonstrate physical capability and movement\n3. Must be clearly visible and photographable\n4. Should work for both 'before' (struggling with) and 'after' (excelling at) contexts\n\nGood examples:\n- 'sprinting through waves'\n- 'doing beach pushups'\n- 'playing beach volleyball'\n- 'practicing beach yoga'\n\nAvoid passive or low-energy activities like building sandcastles, sunbathing, or walking."
        },
        {
          role: "user",
          content: "Generate an active beach fitness activity."
        }
      ],
      temperature: 0.8,
      max_tokens: 50,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error("Error generating action modifier:", error);
    const fallbackActions = [
      "playing beach volleyball",
      "sprinting on shoreline",
      "doing beach pushups",
      "practicing beach yoga",
      "surfing on waves",
      "playing beach soccer",
      "doing burpees on sand",
      "playing beach tennis",
      "doing beach workouts",
      "running beach sprints",
      "doing beach exercises",
      "playing beach sports"
    ];
    return fallbackActions[Math.floor(Math.random() * fallbackActions.length)];
  }
}

async function generateImagePrompts(imagePreference, coach, spiceLevel, actionModifier, isImageInputModel = true) {
  try {
    const subjectDescription = isImageInputModel ? `${imagePreference} img` : imagePreference;
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `Generate two image prompts for a before/after fitness transformation. Use these guidelines:

Coach: ${COACH_PERSONAS[coach].name}
Coach Traits:
${COACH_PERSONAS[coach].traits.map(trait => `- ${trait}`).join('\n')}
Subject: ${subjectDescription} ${isImageInputModel ? '(this exact phrase must be used to describe the subject)' : ''}  (Gender, age, race, etc MUST be included)
Spice Level: ${spiceLevel}/5 (determines intensity and drama of the scene)
Activity: ${actionModifier}

Coach Influences (use these to inform the setting/scenario/mood):
- Gym Bro: High-energy beach sports, weight training scenes, protein shake moments
- Dance Teacher: Graceful movements, performance settings, rhythm-based activities
- Drill Sergeant: Military-style training, obstacle courses, disciplined routines
- Zen Master: Peaceful settings, meditation spots, nature-connected activities
- Frat Bro: Party vibes, social sports, group activities

Prompt Structure (keep each section brief and focused):
1. Subject Introduction (2-3 key terms):
   "${subjectDescription}, [defining features]"

2. Physical State (3-4 specific attributes):
   - Before: "soft rounded body, thick waist, slouched posture, slightly pudgy build, low muscle tone, looks winded"
   - After: "toned muscles, defined core, confident stance"

3. Action & Setting (MUST use the provided activity "${actionModifier}"):
   Combine the provided activity with coach's style influence
   Example: if activity is "playing volleyball" and coach is Dance Teacher:
   "gracefully playing volleyball on the beach with dance-like movements"

4. Technical Details (if needed):
   - Lighting: "golden hour lighting", "dramatic side lighting"
   - Camera: "medium shot", "action shot"

The prompts should:
1. Be concise  (max 15 words)and focused on visual elements
2. Use specific, renderable attributes
3. Do not use coach-speak or narrative language
4. Use "swimwear" instead of specific terms
5. Keep descriptions technically neutral but scene/setting coach-influenced
6. Place key physical descriptors near the start
7. Never include inappropriate content
8. The prompts should not reference each other
9. Both prompts MUST contain the same subject description, for example 'Average-sized 24-year-old white woman'
10. Both prompts MUST contain the same subject description, for example 'Average-sized 24-year-old white woman'


Return JSON in this format:
{
  "beforePrompt": "prompt for the starting point image",
  "afterPrompt": "prompt for the transformation result image"
}`
        }
      ],
      temperature: 0.7,
    });

    const response = JSON.parse(completion.choices[0].message.content);
    console.log('Generated image prompts:', response);
    return response;
  } catch (error) {
    console.error("Error generating image prompts:", error);
    // Fallback to basic prompts with correct subject format
    return {
      beforePrompt: `A realistic photo of a ${subjectDescription} with a pudgy build and low muscle tone, looking winded while ${actionModifier} on the beach, wearing beach attire that fits a bit snugly`,
      afterPrompt: `A realistic photo of a fit and athletic ${subjectDescription}, confidently ${actionModifier} on the beach, wearing beach attire that shows off their toned physique`
    };
  }
}

async function generateMotivationalMessage(coach, spiceLevel, imageContext) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `Generate a motivational message (max 160 characters) to accompany before/after fitness transformation images. Use these guidelines:

Coach: ${COACH_PERSONAS[coach].name}
Coach Traits:
${COACH_PERSONAS[coach].traits.map(trait => `- ${trait}`).join('\n')}

Spice Level: ${spiceLevel}/5 (determines how dramatic/provocative the message is)
${SPICE_LEVEL_DESCRIPTIONS[spiceLevel]}

Image Context:
- Before Image: ${imageContext.beforePrompt}
- After Image: ${imageContext.afterPrompt}
- Image Style: ${imageContext.imageStyle}

The message should:
1. Match the coach's personality and speaking style exactly
2. Reference the specific transformation shown in the images
3. Play off the randomly selected image style (${imageContext.imageStyle}) for humor
4. Include a prompt for the user to text back AFTER completing today's workout
5. Never use offensive language or body-shaming
6. Use emojis appropriate to the coach's style
7. Match the drama/intensity of the spice level
8. You can mock yourself and you can mock the user if appropriate, but NEVER mock marginalized groups`
        },
        {
          role: "user",
          content: "Generate a motivational message for these specific transformation images."
        }
      ],
      temperature: 0.7,
      max_tokens: 100,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error("Error generating message:", error);
    // Fallback messages based on coach and spice level
    const fallbackMessages = {
      zen_master: {
        1: "Every step of your journey matters. Listen to your body and celebrate your progress! Text me after your workout today 🧘‍♀️✨",
        2: "Feel the energy flowing through you. Your transformation journey is beautiful! Share your workout victory with me 🌟",
        3: "Channel your inner strength! From gentle waves to powerful ocean - that's your journey! Tell me about today's practice 🌊",
        4: "Your transformation energy is RADIATING! Let's harness that power! Report back after your workout 💫",
        5: "UNLEASH YOUR INNER WARRIOR! From caterpillar to butterfly - METAMORPHOSIS TIME! Share your triumph 🦋"
      },
      gym_bro: {
        1: "Looking good fam! Keep up that awesome progress! Hit me up after your workout today 💪",
        2: "GAINS INCOMING! You're crushing it! Text me when you finish today's session! 🔥",
        3: "BRO! The transformation is REAL! Let's get this bread! Update me post-workout! 💪",
        4: "ABSOLUTE UNIT ALERT! You're built different fr fr! Tell me about today's GAINS! 😤",
        5: "BROOOOO LOOK AT THIS GLOW UP!!! BEAST MODE: ACTIVATED!!! HIT ME AFTER YOU DEMOLISH THIS WORKOUT!!! 🔥"
      },
      dance_teacher: {
        1: "Honey, you're giving transformation energy! Text me after your workout today! 💃",
        2: "Work it! From first position to serving looks! Let me know how today's session goes! ✨",
        3: "Oh. My. God. The transformation is SERVING! Tell me about your workout later! 💅",
        4: "WERK IT HONEY! You're giving EVERYTHING! Spill the tea after your workout! 👑",
        5: "YAAAS QUEEN! THIS GLOW UP IS EVERYTHING!!! SLAY TODAY'S WORKOUT AND TELL ME ALL ABOUT IT! 💃"
      },
      drill_sergeant: {
        1: "Progress detected, soldier! Report back after completing today's training! 🫡",
        2: "Mission: Transformation in progress! Update me post-workout, recruit! 💪",
        3: "IMPRESSIVE PROGRESS, SOLDIER! COMPLETE TODAY'S MISSION AND REPORT BACK! 🎖️",
        4: "TRANSFORMATION PROTOCOL ACTIVATED! DEMOLISH THIS WORKOUT AND GIVE ME A FULL REPORT! 🔥",
        5: "OUTSTANDING TRANSFORMATION IN PROGRESS! DESTROY THIS WORKOUT AND REPORT FOR DEBRIEFING! 🫡"
      },
      frat_bro: {
        1: "YOOO look who's getting SWOLE! Text me after you crush today's workout! 💪",
        2: "BROSKI! The gains are REAL! Hit me up post-workout! 🔥",
        3: "BROOO THIS TRANSFORMATION THO!!! ABSOLUTELY SENDING IT! Update me later! 😤",
        4: "YOOOOO LOOK AT THIS GLOW UP!!! BUILT: DIFFERENT! Tell me about today's GAINZ! 🔥",
        5: "BROOOOOO WHAT IS THIS TRANSFORMATION!!! LITERALLY INSANE!!! HMU AFTER YOU DEMOLISH THIS!!! 😤"
      }
    };

    return fallbackMessages[coach]?.[spiceLevel] || fallbackMessages.gym_bro[3];
  }
}

module.exports = {
  generateActionModifier,
  generateImagePrompts,
  generateMotivationalMessage,
  SPICE_LEVEL_DESCRIPTIONS
}; 