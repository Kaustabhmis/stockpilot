/**
 * POST /api/login { password } → sets the signed session cookie.
 * Failed attempts are counted per IP in Blobs: 5 failures lock login for 15 minutes.
 */
import crypto from 'node:crypto';
import { LOGIN_RATE } from './lib/config.js';
import { errorResponse, HttpError, json, readJson, withErrors } from './lib/http.js';
import { rateLimitStore } from './lib/store.js';
import { createSessionToken, sessionCookie } from './lib/session.js';

export const config = { path: '/api/login' };

/** @param {string} value */
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/**
 * Compares two strings in constant time by hashing them to equal length first.
 * @param {string} given
 */
function passwordMatches(given) {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) throw new HttpError(500, 'DASHBOARD_PASSWORD is not configured');
  return crypto.timingSafeEqual(Buffer.from(sha256(given)), Buffer.from(sha256(expected)));
}

export default withErrors(async (req, context) => {
  if (req.method !== 'POST') return errorResponse(405, 'Use POST');

  const ip = context.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown';
  const key = `ip-${sha256(ip)}`;
  const store = rateLimitStore();
  const now = Date.now();
  const state = (await store.get(key, { type: 'json' })) || { fails: [] };
  const recent = state.fails.filter((time) => now - time < LOGIN_RATE.windowMs);
  if (recent.length >= LOGIN_RATE.maxFailures) {
    const retryAfter = Math.ceil((recent[0] + LOGIN_RATE.windowMs - now) / 1000);
    return errorResponse(429, 'Too many failed attempts. Try again in 15 minutes.', { 'Retry-After': String(retryAfter) });
  }

  const { password } = await readJson(req);
  if (typeof password !== 'string' || !passwordMatches(password)) {
    recent.push(now);
    await store.setJSON(key, { fails: recent });
    return errorResponse(401, 'Wrong password');
  }

  if (recent.length) await store.delete(key);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(createSessionToken()) });
});
