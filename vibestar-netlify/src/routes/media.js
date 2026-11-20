import { getStore } from '@netlify/blobs';
import {
  ALLOWED_IMAGE_TYPES, ALLOWED_VIDEO_TYPES,
  MEDIA_MAX_IMAGE_BYTES, MEDIA_MAX_VIDEO_BYTES, MEDIA_MAX_AVATAR_BYTES, env
} from '../lib/config.js';
import { ok, fail, newId, isAdminUser } from '../lib/util.js';

/**
 * MEDIA STORAGE
 *
 * Netlify Blobs, served back through /media/:key with a real content-type. That
 * matters twice over: <video> works (Drive hotlinks never did), and Open Graph
 * images resolve to a normal HTTPS URL a crawler can fetch, so link previews
 * carry the actual picture.
 */
const STORE_NAME = 'vibestar-media';

export function mediaStore() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

const EXTENSIONS = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov'
};

export async function uploadMedia({ store, user, body }) {
  // AVATAR and BANNER uploads are open to everyone, because every account has a
  // profile to decorate. POST uploads stay creator-only, since only creators
  // publish to the feed.
  const requested = String(body?.purpose || 'POST').toUpperCase();
  const purpose = ['AVATAR', 'BANNER'].includes(requested) ? requested : 'POST';
  if (purpose === 'POST' && user.role !== 'CELEBRITY') {
    return fail('Only creator accounts can publish media.');
  }

  const mimeType = String(body?.mimeType || '').toLowerCase().split(';')[0].trim();
  const isImage = ALLOWED_IMAGE_TYPES.includes(mimeType);
  const isVideo = ALLOWED_VIDEO_TYPES.includes(mimeType);

  // A profile picture or banner is a still image by definition.
  if (purpose !== 'POST' && !isImage) {
    return fail(`A profile ${purpose === 'BANNER' ? 'banner' : 'picture'} must be an image.`);
  }

  // SVG is excluded on purpose: it can carry script, and it would be served
  // from our own origin where that script would be same-origin.
  if (!isImage && !isVideo) {
    return fail('Unsupported file type. Use JPEG, PNG, WebP, GIF, MP4 or WebM.');
  }

  const base64 = String(body?.data || '').replace(/^data:[^,]*,/, '').replace(/\s/g, '');
  if (!base64) return fail('No file data was received.');

  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    return fail('That file could not be read.');
  }

  const cap = purpose !== 'POST'
    ? MEDIA_MAX_AVATAR_BYTES
    : (isVideo ? MEDIA_MAX_VIDEO_BYTES : MEDIA_MAX_IMAGE_BYTES);
  if (buffer.length > cap) {
    return fail(`${isVideo ? 'Video' : 'Image'} is too large (${Math.round(buffer.length / 1048576)}MB). `
              + `Limit is ${Math.round(cap / 1048576)}MB.`);
  }
  if (!buffer.length) return fail('That file is empty.');

  // The stored key is generated, never derived from the client's filename.
  const key = `${newId('media')}.${EXTENSIONS[mimeType] || 'bin'}`;

  try {
    await mediaStore().set(key, buffer, { metadata: { mimeType, ownerId: user.id } });
  } catch (err) {
    return fail(`That file could not be stored: ${err?.message || err}`);
  }

  const url = `${env.siteUrl()}/media/${key}`;
  const id = newId('med');

  // The file itself lives in Blobs; the spreadsheet keeps only the ledger row,
  // which is what the admin storage view and the delete path read.
  store.media.insert({
    id,
    owner_id: user.id,
    store_key: key,
    kind: isVideo ? 'VIDEO' : 'IMAGE',
    mime_type: mimeType,
    bytes: buffer.length,
    url,
    created_at: new Date().toISOString()
  });

  return ok({ url, key, id, purpose, kind: isVideo ? 'VIDEO' : 'IMAGE', bytes: buffer.length, mimeType });
}

export async function getMediaLimits() {
  return ok({
    imageTypes: ALLOWED_IMAGE_TYPES,
    videoTypes: ALLOWED_VIDEO_TYPES,
    maxImageBytes: MEDIA_MAX_IMAGE_BYTES,
    maxVideoBytes: MEDIA_MAX_VIDEO_BYTES,
    maxAvatarBytes: MEDIA_MAX_AVATAR_BYTES
  });
}

export async function deleteMedia({ store, user, body }) {
  const row = store.media.byId(String(body?.mediaId || ''));
  if (!row) return fail('That file no longer exists.');
  if (row.owner_id !== user.id && !isAdminUser(user)) {
    return fail('You can only delete your own uploads.');
  }

  try {
    await mediaStore().delete(row.store_key);
  } catch {
    // Already gone from the store; still drop the row so the ledger is honest.
  }

  store.media.remove(row);
  return ok({ message: 'File deleted.' });
}
