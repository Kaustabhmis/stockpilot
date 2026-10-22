/**
 * Integration tests for the data path: data.js, save-post.js and publish-now.js run against
 * an in-memory fake of the Google Sheets and Meta Graph APIs. Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
Object.assign(process.env, {
  SHEET_ID: 'sheet-test',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'bot@test.iam.gserviceaccount.com',
  GOOGLE_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
  SESSION_SECRET: crypto.randomBytes(48).toString('base64url'),
  TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
  SITE_URL: 'https://app.test',
  META_APP_SECRET: 'meta-secret',
});

const SCHEMA = {
  Posts: ['id', 'theme_id', 'master_text', 'media_type', 'media_urls', 'video_plan', 'status', 'scheduled_at', 'auto_approve', 'created_at', 'updated_at'],
  Targets: ['id', 'post_id', 'account_id', 'caption', 'status', 'remote_post_id', 'permalink', 'error', 'attempts', 'published_at'],
  Accounts: ['id', 'platform', 'external_id', 'name', 'access_token_enc', 'expires_at', 'connected_at', 'active'],
  Profile: ['key', 'value'],
};

/** In-memory spreadsheet: tab name → rows (row 0 = headers). */
const tabs = new Map(Object.entries(SCHEMA).map(([name, headers]) => [name, [headers]]));
const tabIds = new Map(Object.keys(SCHEMA).map((name, i) => [name, i]));

/** Routes the Google Sheets REST calls the app makes to the in-memory tabs. */
function sheetsFake(url, init) {
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/^\/v4\/spreadsheets\/sheet-test/, '');
  const body = init.body ? JSON.parse(init.body) : null;

  if (path === '' && parsed.searchParams.get('fields')?.startsWith('sheets.properties')) {
    return json({ sheets: [...tabs.keys()].map((title) => ({ properties: { title, sheetId: tabIds.get(title) } })) });
  }
  if (path.startsWith('/values:batchGet')) {
    const names = parsed.searchParams.getAll('ranges').map((r) => r.split('!')[0]);
    return json({ valueRanges: names.map((name) => ({ range: name, values: tabs.get(name) || [] })) });
  }
  if (path.startsWith('/values/') && path.includes(':append')) {
    const name = decodeURIComponent(path.slice('/values/'.length).split(':append')[0]);
    tabs.get(name).push(...body.values);
    return json({});
  }
  if (path === '/values:batchUpdate') {
    for (const { range, values } of body.data) {
      const [name, cells] = range.split('!');
      const rowNumber = Number(cells.match(/\d+/)[0]);
      const rows = tabs.get(name);
      while (rows.length < rowNumber) rows.push([]);
      rows[rowNumber - 1] = values[0];
    }
    return json({});
  }
  if (path === ':batchUpdate') {
    for (const request of body.requests) {
      if (request.deleteDimension) {
        const { sheetId, startIndex } = request.deleteDimension.range;
        const name = [...tabIds.keys()].find((n) => tabIds.get(n) === sheetId);
        tabs.get(name).splice(startIndex, 1);
      }
    }
    return json({});
  }
  throw new Error(`Unhandled Sheets call: ${init.method} ${path}`);
}

/** Routes the Meta Graph calls used by the Facebook publisher. */
function graphFake(url, init) {
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/^\/v26\.0/, '');
  if (path === '/123/feed' && init.method === 'POST') return json({ id: '123_456' });
  if (path === '/123_456') return json({ permalink_url: 'https://www.facebook.com/page/posts/456' });
  return json({ error: { message: `unexpected ${path}`, code: 100 } }, 400);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  if (href.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'g-token', expires_in: 3600 });
  if (href.startsWith('https://sheets.googleapis.com/')) return sheetsFake(href, init);
  if (href.startsWith('https://graph.facebook.com/')) return graphFake(href, init);
  return realFetch(url, init);
};

const { createSessionToken, SESSION_COOKIE } = await import('../netlify/functions/lib/session.js');
const { encrypt } = await import('../netlify/functions/lib/crypto.js');
const dataFn = (await import('../netlify/functions/data.js')).default;
const savePostFn = (await import('../netlify/functions/save-post.js')).default;
const publishFn = (await import('../netlify/functions/publish-now.js')).default;

const cookie = `${SESSION_COOKIE}=${createSessionToken()}`;

/**
 * @param {string} path
 * @param {string} method
 * @param {unknown} [body]
 */
function call(path, method = 'GET', body) {
  return new Request(`https://app.test${path}`, {
    method,
    headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Seeds one connected Facebook Page. */
function seedAccount() {
  tabs.get('Accounts').push([
    'acct-1', 'facebook', '123', 'Test Page', encrypt('page-token'), '', '2026-10-01T00:00:00.000Z', 'TRUE',
  ]);
}

test('unauthenticated requests are refused', async () => {
  const res = await dataFn(new Request('https://app.test/api/data/Posts'), { params: { tab: 'Posts' } });
  assert.equal(res.status, 401);
});

test('create, save with targets, publish, and read back without secrets', async () => {
  seedAccount();

  const created = await dataFn(call('/api/data/Posts', 'POST', { master_text: 'Hello world', media_type: 'none' }), {
    params: { tab: 'Posts' },
  });
  assert.equal(created.status, 201);
  const post = await created.json();
  assert.equal(post.status, 'draft');
  assert.match(post.id, /^[0-9a-f-]{36}$/);

  const saved = await savePostFn(call('/api/save-post', 'POST', {
    post_id: post.id,
    master_text: 'Hello world',
    media_type: 'none',
    targets: [{ account_id: 'acct-1', caption: 'Hello from Facebook' }],
  }));
  assert.equal(saved.status, 200);
  const { targets } = await saved.json();
  assert.equal(targets.length, 1);
  assert.equal(targets[0].caption, 'Hello from Facebook');

  const published = await publishFn(call('/api/publish-now', 'POST', { post_id: post.id }));
  const result = await published.json();
  assert.equal(result.post_status, 'published');
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[0].permalink, 'https://www.facebook.com/page/posts/456');

  const stored = tabs.get('Targets').find((row) => row[1] === post.id);
  const headers = SCHEMA.Targets;
  assert.equal(stored[headers.indexOf('status')], 'published');
  assert.equal(stored[headers.indexOf('remote_post_id')], '123_456');

  const accounts = await (await dataFn(call('/api/data/Accounts'), { params: { tab: 'Accounts' } })).json();
  assert.equal(accounts.length, 1);
  assert.equal('access_token_enc' in accounts[0], false, 'token must never reach the browser');
  assert.equal(accounts[0].active, true);
});

test('published posts cannot be re-saved, and a published target is not sent twice', async () => {
  const post = tabs.get('Posts').find((row) => row[6] === 'published');
  const res = await savePostFn(call('/api/save-post', 'POST', { post_id: post[0], targets: [] }));
  assert.equal(res.status, 409);
  const again = await publishFn(call('/api/publish-now', 'POST', { post_id: post[0] }));
  assert.equal(again.status, 409);
});

test('Accounts cannot be created or deleted through the data API', async () => {
  const create = await dataFn(call('/api/data/Accounts', 'POST', { platform: 'facebook' }), { params: { tab: 'Accounts' } });
  assert.equal(create.status, 403);
  const remove = await dataFn(call('/api/data/Accounts/acct-1', 'DELETE'), { params: { tab: 'Accounts', id: 'acct-1' } });
  assert.equal(remove.status, 403);
});

test('disconnecting clears the token and marks the account inactive', async () => {
  const res = await dataFn(call('/api/data/Accounts/acct-1', 'PUT', { active: false }), {
    params: { tab: 'Accounts', id: 'acct-1' },
  });
  assert.equal(res.status, 200);
  const row = tabs.get('Accounts').find((r) => r[0] === 'acct-1');
  assert.equal(row[7], 'FALSE');
  assert.equal(row[4], '');
});

test('deleting a post also deletes its targets', async () => {
  const post = tabs.get('Posts')[1];
  const before = tabs.get('Targets').length;
  const res = await dataFn(call(`/api/data/Posts/${post[0]}`, 'DELETE'), { params: { tab: 'Posts', id: post[0] } });
  assert.equal(res.status, 204);
  assert.equal(tabs.get('Targets').length, before - 1);
  assert.equal(tabs.get('Posts').some((r) => r[0] === post[0]), false);
});
