const { Twilio } = require("twilio");
const { Storage } = require('@google-cloud/storage');
const { generateMotivationalMessage, SPICE_LEVEL_DESCRIPTIONS } = require('./prompt-generation');

const twilioClient = new Twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const storage = new Storage();
const projectId = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;

const MESSAGES = {
  PAYMENT_LINK: '🏖️ Love your daily beach motivation? Keep the gains coming! Click here to continue your CaboFit journey: {paymentLink}',
};

async function storeConversation(phoneNumber, message, role = 'assistant') {
  const bucket = storage.bucket(`${projectId}-${process.env.CONVERSATION_BUCKET_NAME}`);
  const filename = `${phoneNumber}/conversation.json`;
  const file = bucket.file(filename);

  try {
    // Try to get existing conversation
    const [exists] = await file.exists();
    let conversation = [];
    
    if (exists) {
      const [content] = await file.download();
      conversation = JSON.parse(content.toString());
    }

    // Add new message
    conversation.push({
      role,
      content: message,
      timestamp: new Date().toISOString()
    });

    // Keep only last 50 messages
    if (conversation.length > 50) {
      conversation = conversation.slice(-50);
    }

    // Write updated conversation
    await file.save(JSON.stringify(conversation, null, 2), {
      contentType: 'application/json',
      metadata: {
        updated: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error(`Error storing conversation for ${phoneNumber}:`, error);
    throw error;
  }
}

async function sendPaymentLinkMessage(phoneNumber, email) {
  const paymentLink = `https://cabo.fit?email=${encodeURIComponent(email)}`;
  await twilioClient.messages.create({
    body: MESSAGES.PAYMENT_LINK.replace('{paymentLink}', paymentLink),
    to: phoneNumber,
    from: process.env.TWILIO_PHONE_NUMBER,
  });
  console.log(`Sent payment link to ${phoneNumber}`);
}

async function sendImagesToUser(phoneNumber, images, coach, spiceLevel, imageContext) {
  try {
    const message = await generateMotivationalMessage(coach, spiceLevel, imageContext);
    
    // Send before image first
    await twilioClient.messages.create({
      body: "",
      mediaUrl: [images[0]],
      to: phoneNumber,
      from: process.env.TWILIO_PHONE_NUMBER,
    });

    // Wait a short moment to ensure order
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Send after image with the motivational message
    await twilioClient.messages.create({
      body: message,
      mediaUrl: [images[1]],
      to: phoneNumber,
      from: process.env.TWILIO_PHONE_NUMBER,
    });

    // Store the message in conversation history
    await storeConversation(phoneNumber, message);
  } catch (error) {
    console.error(`Error sending SMS to ${phoneNumber}:`, error);
    throw error;
  }
}

module.exports = {
  sendPaymentLinkMessage,
  sendImagesToUser,
  storeConversation
}; 