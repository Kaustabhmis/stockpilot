/**
 * Instagram Business/Creator publishing: create a media container, wait until it is
 * FINISHED, then media_publish. Images must be JPEG.
 * Docs: https://developers.facebook.com/docs/instagram-platform/content-publishing
 */
import { PUBLISH_BUDGET_MS } from '../config.js';
import { graph } from '../graph.js';

const POLL_INTERVAL_MS = 3000;

/**
 * Publishes to an Instagram account. If the video is still processing when the time budget
 * runs out, returns `{ ok: false, pending: true, containerId }` so the scheduled job can finish it.
 * Never throws.
 * @param {{ igUserId: string, token: string, caption: string, mediaType: string, mediaUrl?: string }} input
 * @returns {Promise<{ ok: boolean, pending?: boolean, containerId?: string, remoteId?: string, permalink?: string, error?: string }>}
 */
export async function publishToInstagram({ igUserId, token, caption, mediaType, mediaUrl }) {
  try {
    if (mediaType === 'none' || !mediaUrl) return { ok: false, error: 'Instagram needs an image or a video' };

    const params = mediaType === 'video'
      ? { media_type: 'REELS', video_url: mediaUrl, caption }
      : { image_url: mediaUrl, caption };
    const { id: containerId } = await graph(`/${igUserId}/media`, { method: 'POST', token, params });

    const state = await waitForContainer(containerId, token, Date.now() + PUBLISH_BUDGET_MS);
    if (state === 'PENDING') return { ok: false, pending: true, containerId };
    if (state !== 'FINISHED') return { ok: false, error: `Instagram could not process the media (${state})` };

    const { id } = await graph(`/${igUserId}/media_publish`, {
      method: 'POST',
      token,
      params: { creation_id: containerId },
    });
    return { ok: true, remoteId: id, permalink: await permalinkFor(id, token) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Polls a media container until it is ready.
 * @param {string} containerId
 * @param {string} token
 * @param {number} deadline epoch ms
 * @returns {Promise<'FINISHED' | 'PENDING' | string>} final status, or 'PENDING' if the deadline passed
 */
export async function waitForContainer(containerId, token, deadline) {
  for (;;) {
    const { status_code: status, status: detail } = await graph(`/${containerId}`, {
      token,
      params: { fields: 'status_code,status' },
    });
    if (status === 'FINISHED') return 'FINISHED';
    if (status === 'ERROR' || status === 'EXPIRED') return detail || status;
    if (Date.now() + POLL_INTERVAL_MS > deadline) return 'PENDING';
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * @param {string} id media id
 * @param {string} token
 * @returns {Promise<string>}
 */
async function permalinkFor(id, token) {
  try {
    const data = await graph(`/${id}`, { token, params: { fields: 'permalink' } });
    return data.permalink || '';
  } catch {
    return '';
  }
}
