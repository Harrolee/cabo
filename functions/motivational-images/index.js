const { createClient } = require('@supabase/supabase-js');
const { COACH_PERSONAS } = require('../process-sms/coach-personas');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function generateCoachMessage(coach, spiceLevel, imageStyle) {
  const coachMessages = {
    zen_master: `I've created a vision of your transformation journey in ${imageStyle} style. Take a moment to reflect... Does this resonate with your inner vision? We can adjust your image preferences if needed. 🧘‍♀️✨`,
    gym_bro: `YO CHECK THIS OUT FAM! Made you this sick ${imageStyle} transformation preview! Does this match your vibe or should we switch up the style? Let me know! 💪🔥`,
    dance_teacher: `Darling, I've choreographed this ${imageStyle} transformation just for you! Does it capture your essence or shall we try a different style? 💃✨`,
    drill_sergeant: `ATTENTION! Generated your transformation preview in ${imageStyle} style! REPORT BACK if this matches your vision or if we need to MODIFY! 🫡`,
    frat_bro: `BROOO! Just whipped up this INSANE ${imageStyle} transformation pic! You vibing with it or should we send it different?! 🔥`
  };

  return coachMessages[coach] || coachMessages.gym_bro;
}

exports.sendMotivationalImages = async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: phoneNumber'
      });
    }

    // Get user data for coach preferences
    const { data: userData, error: userError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('phone_number', phoneNumber)
      .single();

    if (userError || !userData) {
      console.error('Error fetching user data:', userError);
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Call send-user-image function for before image
    const beforeResponse = await fetch(`${process.env.FUNCTION_BASE_URL}/send-user-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phoneNumber,
        prompt: "person at start of fitness journey, natural pose, casual clothing",
        useUserPhoto: true
      })
    });

    if (!beforeResponse.ok) {
      throw new Error(`Error generating before image: ${beforeResponse.statusText}`);
    }

    const beforeData = await beforeResponse.json();

    // Call send-user-image function for after image
    const afterResponse = await fetch(`${process.env.FUNCTION_BASE_URL}/send-user-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phoneNumber,
        prompt: "person after fitness transformation, confident pose, athletic clothing",
        useUserPhoto: true
      })
    });

    if (!afterResponse.ok) {
      throw new Error(`Error generating after image: ${afterResponse.statusText}`);
    }

    const afterData = await afterResponse.json();

    // Generate coach message
    const coachMessage = await generateCoachMessage(
      userData.coach,
      userData.spice_level,
      beforeData.style // Use the style from the first image
    );

    // Send final message with both images
    const messageResponse = await fetch(`${process.env.FUNCTION_BASE_URL}/send-user-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phoneNumber,
        message: coachMessage,
        mediaUrls: [beforeData.imageUrl, afterData.imageUrl]
      })
    });

    if (!messageResponse.ok) {
      throw new Error(`Error sending message: ${messageResponse.statusText}`);
    }

    res.json({
      success: true,
      beforeUrl: beforeData.imageUrl,
      afterUrl: afterData.imageUrl,
      style: beforeData.style
    });

  } catch (error) {
    console.error('Error in sendMotivationalImages:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
