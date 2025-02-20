const OpenAI = require('openai');
const { COACH_PERSONAS } = require('./coach-personas');
const { scenarios } = require('./scenarios');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SPICE_LEVEL_DESCRIPTIONS = {
  1: "Keep it mild and encouraging",
  2: "Add a bit of playful teasing",
  3: "Include moderate sass and challenge",
  4: "Bring strong motivation, intensity, and drama",
  5: "Maximum intensity, risque and provocative"
};

async function generateImagePrompts(imagePreference, isImageInputModel = true) {
  const subjectDescription = isImageInputModel ? `${imagePreference} img` : imagePreference;
  
  // Select a random scenario pair
  const scenarioPairs = scenarios.scenario_pairs;
  const randomScenario = scenarioPairs[Math.floor(Math.random() * scenarioPairs.length)];
  
  // Replace 'person' with subjectDescription in both prompts
  const beforePrompt = randomScenario.before.prompt.replace(/person/g, subjectDescription);
  const afterPrompt = randomScenario.after.prompt.replace(/person/g, subjectDescription);

  const response = {
    beforePrompt,
    afterPrompt,
    theme: randomScenario.theme
  };
  return response;
}

async function generateMotivationalMessage(coach, spiceLevel, imageContext) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `Generate a motivational message (max 160 characters) to accompany before/after fitness transformation images. Use these guidelines:

Coach: ${COACH_PERSONAS[coach].name}
Coach Traits:
${COACH_PERSONAS[coach].traits.map(trait => `- ${trait}`).join('\n')}

Spice Level: ${spiceLevel}/5 (determines how risque/provocative the message is)
${SPICE_LEVEL_DESCRIPTIONS[spiceLevel]}

Image Context:
- Before Image: ${imageContext.beforePrompt}
- After Image: ${imageContext.afterPrompt}
- Image Style: ${imageContext.imageStyle}

The message should:
1. Match the coach's personality and speaking style exactly
2. Reference the specific transformation shown in the images
3. Play off the randomly selected image style (${imageContext.imageStyle}) for humor
4. Include a prompt that motivates the user to text back AFTER completing today's workout
5. Never use offensive language or body-shaming
6. Use emojis appropriate to the coach's style
7. Match the drama/intensity of the spice level
8. You can mock yourself and you can mock the user, but NEVER mock marginalized groups`
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
  generateImagePrompts,
  generateMotivationalMessage,
  SPICE_LEVEL_DESCRIPTIONS
}; 