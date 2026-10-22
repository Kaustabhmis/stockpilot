/**
 * POST /api/upload-media — stores a JPEG (raw request body) in Blobs and returns its /media/ URL.
 * The browser converts images to JPEG before uploading, which Instagram requires.
 */
import crypto from 'node:crypto';
import { UPLOAD_MAX_BYTES } from './lib/config.js';
import { errorResponse, HttpError, json, withErrors } from './lib/http.js';
import { mediaStore } from './lib/store.js';
import { requireAuth } from './lib/session.js';

export const config = { path: '/api/upload-media' };

export default withErrors(async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  if (req.method !== 'POST') return errorResponse(405, 'Use POST');

  const type = (req.headers.get('content-type') || '').split(';')[0].trim();
  if (type !== 'image/jpeg') throw new HttpError(415, 'Upload a JPEG image');

  const bytes = await req.arrayBuffer();
  if (bytes.byteLength === 0) throw new HttpError(400, 'The file is empty');
  if (bytes.byteLength > UPLOAD_MAX_BYTES) throw new HttpError(413, 'The image is larger than 5 MB');
  const magic = new Uint8Array(bytes.slice(0, 3));
  if (magic.length < 3 || magic[0] !== 0xff || magic[1] !== 0xd8 || magic[2] !== 0xff) {
    throw new HttpError(415, 'The file is not a JPEG');
  }

  const file = `${crypto.randomUUID()}.jpg`;
  await mediaStore().set(`media/${file}`, bytes, { metadata: { contentType: 'image/jpeg' } });
  return json({ url: `/media/${file}` }, 201);
});
