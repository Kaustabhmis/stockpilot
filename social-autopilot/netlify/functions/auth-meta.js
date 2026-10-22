/**
 * Facebook Login for Pages and Instagram.
 *   GET /api/auth-meta/start     → redirect to Facebook (requires login)
 *   GET /api/auth-meta/callback  → exchange code, store Page and Instagram accounts
 * Docs: https://developers.facebook.com/docs/facebook-login/guides/access-tokens
 */
import crypto from 'node:crypto';
import { GRAPH_VERSION, META_SCOPES } from './lib/config.js';
import { graph } from './lib/graph.js';
import { cookieHeader, parseCookies, requireAuth } from './lib/session.js';
import { createSheet } from './lib/sheets.js';
import { upsertAccount } from './lib/accounts.js';
import { withErrors } from './lib/http.js';

export const config = { path: ['/api/auth-meta/start', '/api/auth-meta/callback'] };

const STATE_COOKIE = 'sa_meta_state';
const STATE_PATH = '/api/auth-meta';

const redirectUri = () => `${process.env.SITE_URL.replace(/\/$/, '')}/api/auth-meta/callback`;

/**
 * Sends the user back to the Accounts page with a message.
 * @param {URLSearchParams} params query string for accounts.html
 */
function backToAccounts(params) {
  return new Response(null, { status: 302, headers: { Location: `/accounts.html?${params}` } });
}

/** Starts the login: random state in a short-lived cookie, then redirect to Facebook. */
function start(req) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const state = crypto.randomBytes(24).toString('base64url');
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: redirectUri(),
    state,
    response_type: 'code',
    scope: META_SCOPES.join(','),
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params}`,
      'Set-Cookie': cookieHeader(STATE_COOKIE, state, { maxAge: 600, path: STATE_PATH }),
    },
  });
}

/**
 * Finishes the login: checks state, exchanges the code for a long-lived user token,
 * then stores every Page (and its linked Instagram account) with the Page token.
 * @param {Request} req
 * @param {URL} url
 */
async function callback(req, url) {
  const expected = parseCookies(req)[STATE_COOKIE];
  const given = url.searchParams.get('state') || '';
  const clearState = cookieHeader(STATE_COOKIE, '', { maxAge: 0, path: STATE_PATH });
  if (!expected || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return withCookie(backToAccounts(new URLSearchParams({ error: 'Login state did not match. Please try again.' })), clearState);
  }
  const code = url.searchParams.get('code');
  if (!code) {
    const reason = url.searchParams.get('error_description') || 'Facebook login was cancelled';
    return withCookie(backToAccounts(new URLSearchParams({ error: reason })), clearState);
  }

  try {
    const shortLived = await graph('/oauth/access_token', {
      params: {
        client_id: process.env.META_APP_ID,
        client_secret: process.env.META_APP_SECRET,
        redirect_uri: redirectUri(),
        code,
      },
    });
    const longLived = await graph('/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: process.env.META_APP_ID,
        client_secret: process.env.META_APP_SECRET,
        fb_exchange_token: shortLived.access_token,
      },
    });
    const pages = await graph('/me/accounts', {
      token: longLived.access_token,
      params: { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '100' },
    });

    const sheet = createSheet();
    let instagramCount = 0;
    for (const page of pages.data || []) {
      await upsertAccount(sheet, { platform: 'facebook', external_id: page.id, name: page.name, token: page.access_token });
      const ig = page.instagram_business_account;
      if (ig) {
        instagramCount += 1;
        await upsertAccount(sheet, {
          platform: 'instagram',
          external_id: ig.id,
          name: ig.username ? `@${ig.username}` : `Instagram ${ig.id}`,
          token: page.access_token,
        });
      }
    }
    const pageCount = (pages.data || []).length;
    const message = pageCount
      ? `Connected ${pageCount} Facebook Page(s) and ${instagramCount} Instagram account(s).`
      : 'No Facebook Pages were found. Make sure you are an admin of a Page and approved the Page permissions.';
    return withCookie(backToAccounts(new URLSearchParams({ connected: pageCount ? 'meta' : '', message, error: pageCount ? '' : message })), clearState);
  } catch (err) {
    return withCookie(backToAccounts(new URLSearchParams({ error: err.message })), clearState);
  }
}

/**
 * @param {Response} res
 * @param {string} cookie
 */
function withCookie(res, cookie) {
  res.headers.append('Set-Cookie', cookie);
  return res;
}

export default withErrors(async (req) => {
  const url = new URL(req.url);
  if (url.pathname.endsWith('/start')) return start(req);
  if (url.pathname.endsWith('/callback')) return callback(req, url);
  return new Response('Not found', { status: 404 });
});
