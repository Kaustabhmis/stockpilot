/**
 * POST /api/logout → clears the session cookie.
 */
import { errorResponse, json, withErrors } from './lib/http.js';
import { cookieHeader, requireAuth, SESSION_COOKIE } from './lib/session.js';

export const config = { path: '/api/logout' };

export default withErrors(async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  if (req.method !== 'POST') return errorResponse(405, 'Use POST');
  return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader(SESSION_COOKIE, '', { maxAge: 0 }) });
});
