/**
 * GET /api/features → switches and limits the browser needs before it renders.
 */
import { CHAR_LIMITS } from './lib/config.js';
import { json, withErrors } from './lib/http.js';
import { requireAuth } from './lib/session.js';

export const config = { path: '/api/features' };

export default withErrors(async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  return json({
    linkedinOrg: process.env.LINKEDIN_ORG_ENABLED === 'true',
    charLimits: CHAR_LIMITS,
  });
});
