/**
 * LinkedIn OAuth (Sign In with OpenID Connect + Share on LinkedIn).
 *   GET /api/auth-linkedin/start     → redirect to LinkedIn (requires login)
 *   GET /api/auth-linkedin/callback  → exchange code, store the personal profile
 *                                      and, if LINKEDIN_ORG_ENABLED=true, company Pages
 * Docs: https://learn.microsoft.com/linkedin/shared/authentication/authorization-code-flow
 */
import crypto from 'node:crypto';
import { LINKEDIN_ORG_SCOPES, LINKEDIN_SCOPES } from './lib/config.js';
import { upsertAccount } from './lib/accounts.js';
import { cookieHeader, parseCookies, requireAuth } from './lib/session.js';
import { createSheet } from './lib/sheets.js';
import { withErrors } from './lib/http.js';
import { listOrganizations } from './lib/publishers/linkedin.js';

export const config = { path: ['/api/auth-linkedin/start', '/api/auth-linkedin/callback'] };

const STATE_COOKIE = 'sa_linkedin_state';
const STATE_PATH = '/api/auth-linkedin';
const orgEnabled = () => process.env.LINKEDIN_ORG_ENABLED === 'true';

const redirectUri = () => `${process.env.SITE_URL.replace(/\/$/, '')}/api/auth-linkedin/callback`;

/** @param {string} params query string for accounts.html */
const backToAccounts = (params) => new Response(null, { status: 302, headers: { Location: `/accounts.html?${params}` } });

/** @param {Request} req */
function start(req) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const state = crypto.randomBytes(24).toString('base64url');
  const scopes = orgEnabled() ? [...LINKEDIN_SCOPES, ...LINKEDIN_ORG_SCOPES] : LINKEDIN_SCOPES;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.LINKEDIN_CLIENT_ID,
    redirect_uri: redirectUri(),
    state,
    scope: scopes.join(' '),
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://www.linkedin.com/oauth/v2/authorization?${params}`,
      'Set-Cookie': cookieHeader(STATE_COOKIE, state, { maxAge: 600, path: STATE_PATH }),
    },
  });
}

/**
 * @param {Request} req
 * @param {URL} url
 */
async function callback(req, url) {
  const clearState = cookieHeader(STATE_COOKIE, '', { maxAge: 0, path: STATE_PATH });
  const expected = parseCookies(req)[STATE_COOKIE] || '';
  const given = url.searchParams.get('state') || '';
  const stateOk = expected && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  const finish = (res) => {
    res.headers.append('Set-Cookie', clearState);
    return res;
  };
  if (!stateOk) return finish(backToAccounts(new URLSearchParams({ error: 'Login state did not match. Please try again.' })));
  const code = url.searchParams.get('code');
  if (!code) {
    return finish(backToAccounts(new URLSearchParams({ error: url.searchParams.get('error_description') || 'LinkedIn login was cancelled' })));
  }

  try {
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(),
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET,
      }),
    });
    const token = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !token.access_token) {
      throw new Error(`LinkedIn did not issue a token (${tokenRes.status}): ${token.error_description || 'unknown error'}`);
    }
    const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

    const userRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const user = await userRes.json().catch(() => ({}));
    if (!userRes.ok || !user.sub) throw new Error('Could not read the LinkedIn profile');

    const sheet = createSheet();
    await upsertAccount(sheet, {
      platform: 'linkedin_person',
      external_id: user.sub,
      name: user.name || 'LinkedIn profile',
      token: token.access_token,
      expiresAt,
    });

    let message = 'Connected your LinkedIn profile.';
    let error = '';
    if (orgEnabled()) {
      try {
        const orgs = await listOrganizations(token.access_token);
        for (const org of orgs) {
          await upsertAccount(sheet, {
            platform: 'linkedin_org',
            external_id: org.id,
            name: org.name,
            token: token.access_token,
            expiresAt,
          });
        }
        message = `Connected your LinkedIn profile and ${orgs.length} company Page(s).`;
      } catch (err) {
        error = `Connected your profile, but company Pages could not be loaded: ${err.message}`;
      }
    }
    return finish(backToAccounts(new URLSearchParams({ connected: 'linkedin', message, error })));
  } catch (err) {
    return finish(backToAccounts(new URLSearchParams({ error: err.message })));
  }
}

export default withErrors(async (req) => {
  const url = new URL(req.url);
  if (url.pathname.endsWith('/start')) return start(req);
  if (url.pathname.endsWith('/callback')) return callback(req, url);
  return new Response('Not found', { status: 404 });
});
