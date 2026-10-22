/**
 * LinkedIn publishing with the Posts API and the Images API (text and single image).
 * Video is added in Phase 4.
 * Docs: https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api
 *       https://learn.microsoft.com/linkedin/marketing/community-management/shares/images-api
 */
import { LINKEDIN_RESTLI_VERSION, LINKEDIN_VERSION } from '../config.js';

const API = 'https://api.linkedin.com';

/**
 * @param {string} token
 * @param {Record<string, string>} [extra]
 */
function headers(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    'LinkedIn-Version': LINKEDIN_VERSION,
    'X-Restli-Protocol-Version': LINKEDIN_RESTLI_VERSION,
    ...extra,
  };
}

/**
 * @param {string} step what was being done
 * @param {Response} res
 * @param {any} data
 */
async function failure(step, res, data) {
  if (res.status === 401) return `${step}: the LinkedIn token is no longer valid. Reconnect LinkedIn in Accounts.`;
  return `${step} failed (${res.status}): ${data.message || data.serviceErrorCode || 'unknown error'}`;
}

/**
 * Uploads an image: initializeUpload → PUT the bytes. Returns the image URN.
 * @param {string} author person or organization URN
 * @param {string} token
 * @param {string} mediaUrl public URL of the JPEG
 */
async function uploadImage(author, token, mediaUrl) {
  const init = await fetch(`${API}/rest/images?action=initializeUpload`, {
    method: 'POST',
    headers: headers(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
  });
  const initData = await init.json().catch(() => ({}));
  if (!init.ok) throw new Error(await failure('Image upload setup', init, initData));

  const source = await fetch(mediaUrl);
  if (!source.ok) throw new Error(`Could not read the image (${source.status})`);
  const bytes = await source.arrayBuffer();

  const put = await fetch(initData.value.uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: bytes,
  });
  if (!put.ok) throw new Error(`Image upload failed (${put.status})`);
  return initData.value.image;
}

/**
 * Publishes a text or single-image post to a personal profile or company Page.
 * Never throws.
 * @param {{ author: string, token: string, caption: string, mediaType: string, mediaUrl?: string }} input
 * @returns {Promise<{ ok: boolean, remoteId?: string, permalink?: string, error?: string }>}
 */
export async function publishToLinkedIn({ author, token, caption, mediaType, mediaUrl }) {
  try {
    if (mediaType === 'video') return { ok: false, error: 'LinkedIn video is not supported yet' };

    const body = {
      author,
      commentary: caption,
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
    if (mediaType === 'image' && mediaUrl) {
      body.content = { media: { id: await uploadImage(author, token, mediaUrl) } };
    }

    const res = await fetch(`${API}/rest/posts`, {
      method: 'POST',
      headers: headers(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: await failure('Publishing', res, data) };
    }
    const urn = res.headers.get('x-restli-id') || '';
    return {
      ok: true,
      remoteId: urn,
      permalink: urn ? `https://www.linkedin.com/feed/update/${urn}/` : 'https://www.linkedin.com/feed/',
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Lists the company Pages the member administers. Used only when LINKEDIN_ORG_ENABLED=true.
 * @param {string} token
 * @returns {Promise<{ id: string, name: string }[]>}
 */
export async function listOrganizations(token) {
  const acls = await fetch(`${API}/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`, {
    headers: headers(token),
  });
  const aclData = await acls.json().catch(() => ({}));
  if (!acls.ok) throw new Error(await failure('Loading company Pages', acls, aclData));

  const orgs = [];
  for (const element of aclData.elements || []) {
    const id = String(element.organization || '').split(':').pop();
    if (!id) continue;
    const res = await fetch(`${API}/rest/organizations/${id}`, { headers: headers(token) });
    const data = await res.json().catch(() => ({}));
    orgs.push({ id, name: data.localizedName || `Company Page ${id}` });
  }
  return orgs;
}
