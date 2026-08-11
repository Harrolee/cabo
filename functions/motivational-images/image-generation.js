/**
 * Renders one scene for an SMS member.
 *
 * What used to live here was a pair of fitness prompts run through PhotoMaker
 * with a "before" negative prompt of `weak, frail, sad, nervous, skinny,
 * chubby, overweight`. Both halves of that are gone: there is no pair, and the
 * body vocabulary now sits on the negative side of every prompt. Model choice
 * and the negative prompt come from `visualization.js`, which is the same
 * module the app's visualiser uses — an SMS member and an app member get the
 * same treatment.
 */

const { chooseModel } = require('./visualization');

const projectId = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
const bucketName = process.env.VISUALIZATION_BUCKET || `${projectId}-image-bucket`;

/**
 * Pull a URL string out of whatever Replicate hands back.
 *
 * The client library is not consistent across models: `replicate.run()` may
 * return a bare URL string, an array of them, a single `FileOutput`, or an
 * array of `FileOutput` — and `FileOutput.url()` returns a `URL` *object*, not
 * a string. Normalising here keeps that from leaking any further.
 */
function firstUrl(output) {
  const asString = (value) => {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (value instanceof URL) return value.href;
    if (typeof value.url === 'function') return asString(value.url());
    if (typeof value.url === 'string') return value.url;
    const text = String(value);
    return text.startsWith('http') ? text : null;
  };

  const candidate = Array.isArray(output)
    ? output[0]
    : output && Array.isArray(output.output)
    ? output.output[0]
    : output;

  const url = asString(candidate);

  if (!url) {
    console.error(
      'Could not extract an image URL from Replicate output. isArray=%s ctor=%s keys=%j',
      Array.isArray(output),
      output?.constructor?.name,
      output && typeof output === 'object' ? Object.keys(output).slice(0, 10) : null
    );
  }

  return url;
}

/** Replicate URLs expire; copy the image somewhere Twilio can still fetch it. */
async function saveImageToBucket(storage, imageUrl, objectName) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch generated image: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const file = storage.bucket(bucketName).file(objectName);

  await file.save(buffer, {
    contentType: 'image/jpeg',
    metadata: { cacheControl: 'public, max-age=31536000' },
  });

  return `https://storage.googleapis.com/${bucketName}/${objectName}`;
}

/**
 * A photo the member texted in, if any. Only ever consulted once they have
 * given likeness consent — see `renderScene`.
 */
async function findTextedPhoto(storage, phoneNumber) {
  const conversationBucket = `${projectId}-${process.env.CONVERSATION_BUCKET_NAME}`;

  try {
    const [files] = await storage
      .bucket(conversationBucket)
      .getFiles({ prefix: `${phoneNumber}/images/profile.` });

    if (files.length === 0) return null;

    const [signedUrl] = await files[0].getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000,
    });
    return signedUrl;
  } catch (error) {
    console.error('Error checking for a texted-in photo: %s', error.message);
    return null;
  }
}

/**
 * Generate the scene and return a durable URL for it.
 *
 * `likenessConsent` is a hard gate, not a hint. Without it we render the scene
 * with nobody identifiable in it rather than reaching for a photo the member
 * happened to text us once.
 */
async function renderScene({
  replicate,
  storage,
  imagePrompt,
  phoneNumber,
  referencePhotoUrl = null,
  likenessConsent = false,
}) {
  let reference = null;
  if (likenessConsent) {
    reference = referencePhotoUrl || (await findTextedPhoto(storage, phoneNumber));
  }

  const model = chooseModel({ referencePhotoUrl: reference, likenessConsent });
  const input = model.build(imagePrompt, reference);

  console.log('Rendering scene with %s (likeness=%s)', model.id, Boolean(reference));

  const output = await replicate.run(model.id, { input });
  const generatedUrl = firstUrl(output);
  if (!generatedUrl) throw new Error('Model returned no image');

  const objectName = `visualizations/sms/${Date.now()}.jpg`;
  const imageUrl = await saveImageToBucket(storage, generatedUrl, objectName);

  return { imageUrl, modelId: model.id, usedLikeness: Boolean(reference), input };
}

module.exports = {
  renderScene,
  saveImageToBucket,
  findTextedPhoto,
  firstUrl,
};
