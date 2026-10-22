/**
 * Facebook Page publishing (text, photo, video).
 * Docs: https://developers.facebook.com/docs/pages-api/posts
 */
import { graph } from '../graph.js';

/**
 * Publishes to a Page. Never throws; returns a result object instead.
 * @param {{ pageId: string, token: string, caption: string, mediaType: string, mediaUrl?: string }} input
 * @returns {Promise<{ ok: boolean, remoteId?: string, permalink?: string, error?: string }>}
 */
export async function publishToFacebook({ pageId, token, caption, mediaType, mediaUrl }) {
  try {
    if (mediaType === 'video') {
      const res = await graph(`/${pageId}/videos`, {
        method: 'POST',
        token,
        params: { file_url: mediaUrl, description: caption },
      });
      return { ok: true, remoteId: res.id, permalink: `https://www.facebook.com/${pageId}/videos/${res.id}/` };
    }
    if (mediaType === 'image') {
      const res = await graph(`/${pageId}/photos`, {
        method: 'POST',
        token,
        params: { url: mediaUrl, message: caption, published: 'true' },
      });
      const postId = res.post_id || res.id;
      return { ok: true, remoteId: postId, permalink: await permalinkFor(postId, token) };
    }
    const res = await graph(`/${pageId}/feed`, { method: 'POST', token, params: { message: caption } });
    return { ok: true, remoteId: res.id, permalink: await permalinkFor(res.id, token) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * @param {string} id
 * @param {string} token
 * @returns {Promise<string>} the post's permalink, or a generic facebook.com link
 */
async function permalinkFor(id, token) {
  try {
    const data = await graph(`/${id}`, { token, params: { fields: 'permalink_url' } });
    return data.permalink_url || `https://www.facebook.com/${id}`;
  } catch {
    return `https://www.facebook.com/${id}`;
  }
}
