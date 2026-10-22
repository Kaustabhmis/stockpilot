/**
 * Dispatches one publish target to the right platform publisher and normalises the outcome.
 */
import { CHAR_LIMITS } from './config.js';
import { decrypt } from './crypto.js';
import { publishToFacebook } from './publishers/facebook.js';
import { publishToInstagram } from './publishers/instagram.js';
import { publishToLinkedIn } from './publishers/linkedin.js';

/** Which caption limit applies to each account platform. */
const LIMIT_KEY = { facebook: 'facebook', instagram: 'instagram', linkedin_person: 'linkedin', linkedin_org: 'linkedin' };

/** @param {string} error */
const fail = (error) => ({ ok: false, error });

/**
 * Turns a media path (`/media/x.jpg`) into the public URL Meta and LinkedIn must fetch.
 * @param {string} path
 */
function absoluteUrl(path) {
  if (/^https?:\/\//.test(path)) return path;
  const site = (process.env.SITE_URL || '').replace(/\/$/, '');
  if (!site) throw new Error('SITE_URL is not configured');
  return `${site}${path}`;
}

/** @param {{ platform: string, external_id: string }} account */
function linkedInAuthor(account) {
  const kind = account.platform === 'linkedin_org' ? 'organization' : 'person';
  return `urn:li:${kind}:${account.external_id}`;
}

/**
 * Publishes one target. Never throws.
 * @param {{
 *   account: Record<string, any>,
 *   post: Record<string, any>,
 *   caption: string
 * }} input account and post are records from the Sheet (account carries the encrypted token)
 * @returns {Promise<{ ok: boolean, pending?: boolean, containerId?: string, remoteId?: string, permalink?: string, error?: string }>}
 */
export async function publishTarget({ account, post, caption }) {
  try {
    if (account.platform === 'linkedin_org' && process.env.LINKEDIN_ORG_ENABLED !== 'true') {
      return fail('Company Page publishing is turned off (LINKEDIN_ORG_ENABLED)');
    }
    if (account.expires_at && Date.parse(account.expires_at) < Date.now()) {
      return fail('This account token has expired. Reconnect it in Accounts.');
    }

    const limitKey = LIMIT_KEY[account.platform];
    const limit = CHAR_LIMITS[limitKey];
    if (caption.length > limit) return fail(`The caption is ${caption.length} characters; the ${limitKey} limit is ${limit}`);

    const mediaPath = post.media_urls?.[0];
    if (post.media_type !== 'none' && !mediaPath) return fail('This post has no media attached');
    const mediaUrl = mediaPath ? absoluteUrl(mediaPath) : undefined;

    let token;
    try {
      token = decrypt(account.access_token_enc);
    } catch {
      return fail('The stored token could not be read. Reconnect this account in Accounts.');
    }

    const mediaType = post.media_type;
    if (account.platform === 'facebook') {
      return publishToFacebook({ pageId: account.external_id, token, caption, mediaType, mediaUrl });
    }
    if (account.platform === 'instagram') {
      return publishToInstagram({ igUserId: account.external_id, token, caption, mediaType, mediaUrl });
    }
    return publishToLinkedIn({ author: linkedInAuthor(account), token, caption, mediaType, mediaUrl });
  } catch (err) {
    return fail(err.message);
  }
}
