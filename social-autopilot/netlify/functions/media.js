/**
 * Public GET /media/:file — serves stored images with the right Content-Type.
 * Only names of the form <uuid>.<ext> under the media/ prefix are served.
 * Public on purpose: Meta and LinkedIn fetch these URLs. The UUID keeps them unguessable.
 */
import { mediaStore } from './lib/store.js';

export const config = { path: '/media/:file' };

const FILE_PATTERN = /^[a-f0-9-]{36}\.(jpg|png|mp4)$/;

/** @param {number} status */
const notFound = (status = 404) => new Response('Not found', { status, headers: { 'Content-Type': 'text/plain' } });

export default async (req, context) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(405);
  const file = context.params.file;
  if (!FILE_PATTERN.test(file)) return notFound();

  const result = await mediaStore().getWithMetadata(`media/${file}`, { type: 'arrayBuffer' });
  if (!result) return notFound();

  return new Response(req.method === 'HEAD' ? null : result.data, {
    headers: {
      'Content-Type': result.metadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
