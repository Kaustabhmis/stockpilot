/**
 * Signed session cookie (HMAC-SHA256, SESSION_SECRET) and the requireAuth guard.
 * Token format: `base64url(payload).base64url(hmac)`, payload = { sub, exp }.
 */
import crypto from 'node:crypto';
import { SESSION_TTL_SECONDS } from './config.js';
import { errorResponse } from './http.js';

export const SESSION_COOKIE = 'sa_session';
const SUBJECT = 'owner';

/** @returns {string} the signing secret; throws if it is missing or too short */
function signingSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be set (at least 32 characters)');
  return secret;
}

/** @param {string} payload */
function sign(payload) {
  return crypto.createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

/**
 * Creates a signed session token valid for SESSION_TTL_SECONDS.
 * @param {number} [now=Date.now()]
 * @returns {string}
 */
export function createSessionToken(now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ sub: SUBJECT, exp: now + SESSION_TTL_SECONDS * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/**
 * Checks signature (constant time) and expiry.
 * @param {unknown} token
 * @param {number} [now=Date.now()]
 * @returns {boolean}
 */
export function verifySessionToken(token, now = Date.now()) {
  if (typeof token !== 'string') return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.sub === SUBJECT && typeof data.exp === 'number' && data.exp > now;
  } catch {
    return false;
  }
}

/**
 * Reads cookies from the request.
 * @param {Request} req
 * @returns {Record<string, string>}
 */
export function parseCookies(req) {
  const cookies = {};
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

/**
 * Set-Cookie value with the security attributes the app requires.
 * @param {string} name
 * @param {string} value
 * @param {{ maxAge: number, path?: string }} options
 */
export function cookieHeader(name, value, { maxAge, path = '/' }) {
  return `${name}=${value}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

/** @param {string} token */
export function sessionCookie(token) {
  return cookieHeader(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SECONDS });
}

/**
 * Guard for protected functions. Returns null when the request is logged in,
 * otherwise a 401 Response to return immediately.
 * @param {Request} req
 * @returns {Response | null}
 */
export function requireAuth(req) {
  if (verifySessionToken(parseCookies(req)[SESSION_COOKIE])) return null;
  return errorResponse(401, 'Please log in');
}
