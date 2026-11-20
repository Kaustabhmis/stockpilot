import { mediaStore } from '../../src/routes/media.js';
import { openStore } from '../../src/lib/store.js';
import { verifyMediaSignature } from '../../src/lib/util.js';

/**
 * Serves an uploaded file from blob storage with its real content-type.
 *
 * PUBLIC media is served to anyone and cached hard. Media belonging to a
 * subscriber-only post is served ONLY against a valid short-lived signature
 * bound to the requesting viewer.
 *
 * This is the load-bearing half of the private gallery. A browser will not put
 * an Authorization header on an <img> or <video> request, so if this endpoint
 * were open, the paywall would be cosmetic — anyone who obtained the URL, or
 * guessed a key, would have the file. The signature travels in the query string
 * precisely because that is the only channel an image request carries.
 */
export const handler = async (event) => {
  const key = decodeURIComponent((event.path || '').split('/').filter(Boolean).pop() || '');

  // Keys are generated server-side and are a single flat segment; anything with
  // a separator or traversal in it did not come from us.
  if (!key || key.includes('..') || key.includes('/') || key.includes('\\')) {
    return { statusCode: 400, body: 'Bad key' };
  }

  const store = await openStore(['Media', 'Posts']);

  const row = store.media.find((media) => media.store_key === key);
  if (!row) return { statusCode: 404, body: 'Not found' };

  // The strictest visibility of any post using this file. A file referenced by
  // even one private post stays gated — otherwise reposting the same image
  // publicly once would unlock it everywhere.
  const isPrivate = store.posts.all().some(
    (post) => post.visibility === 'SUBSCRIBERS'
           && String(post.status).toUpperCase() !== 'DELETED'
           && String(post.media_url).includes(`/media/${key}`)
  );

  if (isPrivate) {
    const params = event.queryStringParameters || {};
    const valid = verifyMediaSignature(key, params.v || '', params.e || '', params.s || '');
    if (!valid) {
      // 403 rather than 404: the file exists, the caller simply is not entitled,
      // and an expired link should read as "ask again", not "gone".
      return {
        statusCode: 403,
        headers: { 'Cache-Control': 'no-store' },
        body: 'This file is for subscribers. The link may also have expired.'
      };
    }
  }

  let buffer;
  try {
    const stored = await mediaStore().get(key, { type: 'arrayBuffer' });
    if (!stored) return { statusCode: 404, body: 'Not found' };
    buffer = Buffer.from(stored);
  } catch (err) {
    console.error('media: read failed', err);
    return { statusCode: 500, body: 'Read failed' };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': row.mime_type || 'application/octet-stream',
      'Content-Length': String(buffer.length),
      // Public files are immutable and safe to cache at the edge. Private ones
      // must never be shared between viewers by a cache, so they are marked
      // private and short-lived — the signature is per-viewer for the same
      // reason.
      'Cache-Control': isPrivate
        ? 'private, max-age=300, no-transform'
        : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff'
    },
    body: buffer.toString('base64'),
    isBase64Encoded: true
  };
};
