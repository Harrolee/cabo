/**
 * Twilio delivery for the daily image.
 *
 * One image, one caption — not a before/after pair. The caption is written by
 * the coach as part of the scene brief, so it is in that coach's voice and
 * about that coach's discipline; there is no shared "motivational message"
 * template left to make a drummer sound like a personal trainer.
 */

const projectId = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;

const MESSAGES = {
  PAYMENT_LINK:
    '🔥 Enjoying your daily coaching? Keep it going here: {paymentLink}',
};

async function storeConversation(storage, phoneNumber, message, role = 'assistant') {
  const bucket = storage.bucket(`${projectId}-${process.env.CONVERSATION_BUCKET_NAME}`);
  const file = bucket.file(`${phoneNumber}/conversation.json`);

  try {
    const [exists] = await file.exists();
    let conversation = [];

    if (exists) {
      const [content] = await file.download();
      conversation = JSON.parse(content.toString());
    }

    conversation.push({ role, content: message, timestamp: new Date().toISOString() });

    // Keep only last 50 messages
    if (conversation.length > 50) conversation = conversation.slice(-50);

    await file.save(JSON.stringify(conversation, null, 2), {
      contentType: 'application/json',
      metadata: { updated: new Date().toISOString() },
    });
  } catch (error) {
    console.error(`Error storing conversation for ${phoneNumber}:`, error);
    throw error;
  }
}

async function sendPaymentLinkMessage({ twilio, phoneNumber, email }) {
  const paymentLink = `https://cabo.fit?email=${encodeURIComponent(email)}`;
  await twilio.messages.create({
    body: MESSAGES.PAYMENT_LINK.replace('{paymentLink}', paymentLink),
    to: phoneNumber,
    from: process.env.TWILIO_PHONE_NUMBER,
  });
  console.log(`Sent payment link to ${phoneNumber}`);
}

/** Send the rendered scene as a single MMS with the coach's caption. */
async function sendVisualizationToUser({ twilio, storage, phoneNumber, imageUrl, caption }) {
  const body = caption || '';

  await twilio.messages.create({
    body,
    mediaUrl: [imageUrl],
    to: phoneNumber,
    from: process.env.TWILIO_PHONE_NUMBER,
  });

  if (body) await storeConversation(storage, phoneNumber, body);
}

module.exports = {
  MESSAGES,
  sendPaymentLinkMessage,
  sendVisualizationToUser,
  storeConversation,
};
