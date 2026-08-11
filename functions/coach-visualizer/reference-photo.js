/**
 * The member's reference photo.
 *
 * PhotoMaker can only keep someone's face if it has a picture of that face, so
 * this is the one place in the product that stores a photograph of a member.
 * That makes it biometric-adjacent, and everything here is shaped by two rules:
 *
 *   1. The file is never public. It lives in a private bucket and is handed to
 *      the image model as a signed URL that expires in minutes, so a leaked
 *      link is worthless within the hour and worthless immediately once the
 *      object is gone.
 *   2. Withdrawing consent deletes the file. Not a flag, not a lifecycle rule
 *      a week later — the object. `deleteReferencePhotos` sweeps the whole
 *      per-member prefix rather than the single path we think we wrote, so a
 *      photo stored under an older extension cannot survive a revocation.
 *
 * Storage layout mirrors `coach-avatar-generator`'s selfie handling (private
 * object + v4 signed URL for the model to fetch), one prefix per member:
 *
 *   member-reference/<user id>/reference.<ext>
 */

const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

/** What PhotoMaker can actually read. HEIC is rejected with a clear message. */
const ALLOWED_MIME_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Short by design: it only has to survive one `replicate.run` call, and a short
 * window is the difference between "revoked" and "revoked, mostly".
 */
const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

class InvalidPhotoError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'InvalidPhotoError';
    this.code = code;
  }
}

const referencePrefix = (userId) => `member-reference/${userId}/`;
const referenceObjectName = (userId, mime) =>
  `${referencePrefix(userId)}reference.${ALLOWED_MIME_TYPES[mime]}`;

function parseGsUri(uri) {
  if (typeof uri !== 'string') return null;
  const match = uri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  return match ? { bucket: match[1], name: match[2] } : null;
}

/**
 * Trust the bytes, not the client's content type — an `image/jpeg` label on a
 * PDF should not end up in the bucket, and a HEIC mislabelled as JPEG would
 * fail deep inside the model with an unreadable error instead of here.
 */
function sniffImageType(buffer) {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii');
    if (/^(heic|heix|hevc|heim|heis|hevm|mif1|msf1)$/.test(brand)) return 'image/heic';
  }
  return null;
}

/**
 * Decode what the app sent into bytes we are willing to store.
 * Throws `InvalidPhotoError` with a message written for the member.
 */
function decodeReferencePhoto({ photoBase64 }) {
  const payload = String(photoBase64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!payload) {
    throw new InvalidPhotoError('photo_missing', 'No photo was included.');
  }

  // Guard before allocating: base64 is ~4/3 of the decoded size.
  if (payload.length > MAX_PHOTO_BYTES * 1.4) {
    throw new InvalidPhotoError('photo_too_large', 'That photo is too large. Please pick one under 6MB.');
  }

  const buffer = Buffer.from(payload, 'base64');
  if (buffer.length === 0) {
    throw new InvalidPhotoError('photo_unreadable', 'That photo could not be read. Please try another.');
  }
  if (buffer.length > MAX_PHOTO_BYTES) {
    throw new InvalidPhotoError('photo_too_large', 'That photo is too large. Please pick one under 6MB.');
  }

  const detected = sniffImageType(buffer);
  if (detected === 'image/heic') {
    throw new InvalidPhotoError(
      'photo_unsupported_format',
      'That photo is in Apple\'s HEIC format. Crop it in Photos first, or pick a JPEG.'
    );
  }
  if (!detected || !ALLOWED_MIME_TYPES[detected]) {
    throw new InvalidPhotoError(
      'photo_unsupported_format',
      'That file is not a JPEG, PNG or WebP image.'
    );
  }

  return { buffer, mime: detected };
}

async function storeReferencePhoto({ storage, bucketName, userId, buffer, mime }) {
  // Replacing a photo must not leave the old one behind under a different
  // extension, so clear the prefix before writing.
  await deleteReferencePhotos({ storage, bucketName, userId });

  const name = referenceObjectName(userId, mime);
  await storage.bucket(bucketName).file(name).save(buffer, {
    contentType: mime,
    resumable: false,
    metadata: { cacheControl: 'private, no-store' },
  });

  return { uri: `gs://${bucketName}/${name}`, name };
}

/**
 * Delete every object stored for this member. Returns how many were removed.
 * Throws if the delete fails — the caller decides what to tell the member, but
 * it must never be reported as a successful erasure.
 */
async function deleteReferencePhotos({ storage, bucketName, userId }) {
  const [files] = await storage.bucket(bucketName).getFiles({ prefix: referencePrefix(userId) });
  await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
  return files.length;
}

/** True only if the object is really still there. */
async function referencePhotoExists({ storage, uri }) {
  const location = parseGsUri(uri);
  if (!location) return false;
  const [exists] = await storage.bucket(location.bucket).file(location.name).exists();
  return exists;
}

/** A read URL the image model can fetch, valid for minutes rather than days. */
async function signReferencePhoto({ storage, uri, ttlMs = SIGNED_URL_TTL_MS }) {
  const location = parseGsUri(uri);
  if (!location) return null;

  const [signedUrl] = await storage
    .bucket(location.bucket)
    .file(location.name)
    .getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + ttlMs });

  return signedUrl;
}

module.exports = {
  ALLOWED_MIME_TYPES,
  MAX_PHOTO_BYTES,
  SIGNED_URL_TTL_MS,
  InvalidPhotoError,
  decodeReferencePhoto,
  deleteReferencePhotos,
  parseGsUri,
  referenceObjectName,
  referencePrefix,
  referencePhotoExists,
  signReferencePhoto,
  sniffImageType,
  storeReferencePhoto,
};
