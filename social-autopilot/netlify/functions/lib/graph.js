/**
 * Minimal Meta Graph API client. Adds appsecret_proof when META_APP_SECRET is set.
 * Docs: https://developers.facebook.com/docs/graph-api/guides/secure-requests
 */
import crypto from 'node:crypto';
import { GRAPH_VERSION } from './config.js';

export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Error codes from Meta that the owner can act on. */
const FRIENDLY = {
  190: 'The access token has expired or was revoked. Reconnect this account in Accounts.',
  10: 'Missing permission. Reconnect and approve every permission on the Facebook login screen.',
  200: 'Missing permission. Reconnect and approve every permission on the Facebook login screen.',
};

/**
 * @param {string} token
 * @returns {string} hex HMAC of the token with the app secret
 */
export function appSecretProof(token) {
  return crypto.createHmac('sha256', process.env.META_APP_SECRET || '').update(token).digest('hex');
}

/**
 * Calls the Graph API. GET sends parameters in the query string; other methods send a form body.
 * Throws an Error whose message is safe to show.
 * @param {string} path e.g. `/me/accounts`
 * @param {{ method?: string, token?: string, params?: Record<string, string> }} [options]
 * @returns {Promise<any>}
 */
export async function graph(path, { method = 'GET', token, params = {} } = {}) {
  const body = { ...params };
  if (token) {
    body.access_token = token;
    if (process.env.META_APP_SECRET) body.appsecret_proof = appSecretProof(token);
  }
  let url = `${GRAPH_BASE}${path}`;
  const init = { method };
  if (method === 'GET') url += `?${new URLSearchParams(body)}`;
  else init.body = new URLSearchParams(body);

  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const code = data.error?.code;
    throw new Error(FRIENDLY[code] || data.error?.message || `Meta API error (${res.status})`);
  }
  return data;
}
