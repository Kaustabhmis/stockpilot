import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { installFakeSheets } from './fake-sheets.mjs';

delete process.env.DATABASE_URL;
const fake = installFakeSheets();

const { openStore, columnsOf, TABLE_NAMES } = await import('../src/lib/store.js');
const { createSession } = await import('../src/lib/auth.js');
const { handler } = await import('../netlify/functions/api.js');

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();

const scrypt = (password, salt) => new Promise((resolve, reject) =>
  crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 },
    (err, key) => (err ? reject(err) : resolve(key.toString('hex')))));

async function freshSheet() {
  for (const table of TABLE_NAMES) fake.seed(table, columnsOf(table));
  fake.seed('_Lock', ['lock'], [{ lock: '' }]);

  const salt = 'abc123';
  const hash = await scrypt('demo1234', salt);
  const base = { password_hash: hash, password_salt: salt, status: 'ACTIVE', created_at: iso(Date.now()) };

  fake.seed('Users', columnsOf('Users'), [
    { ...base, id: 'admin1', full_name: 'Admin', username: 'admin', email: 'admin@v.app', role: 'FAN', is_admin: 'TRUE' },
    { ...base, id: 'celeb1', full_name: 'Aarohi', username: 'aarohi', email: 'a@v.app', role: 'CELEBRITY', monthly_price: 299 },
    { ...base, id: 'fan1', full_name: 'Rahul', username: 'rahul', email: 'r@v.app', role: 'FAN' }
  ]);
}

/** Invokes the router the way Netlify does. */
async function post(action, body = {}, token = '') {
  const response = await handler({
    httpMethod: 'POST',
    path: `/.netlify/functions/api/${action}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body)
  });
  return { status: response.statusCode, body: JSON.parse(response.body) };
}

test('an unknown action is a 404, and GET is refused', async () => {
  await freshSheet();

  assert.equal((await post('noSuchThing')).status, 404);

  const wrongMethod = await handler({ httpMethod: 'GET', path: '/.netlify/functions/api/logIn' });
  assert.equal(wrongMethod.statusCode, 400);
});

test('a USER route without a token is 401, not a crash', async () => {
  await freshSheet();

  const result = await post('getPublicFeed');
  assert.equal(result.status, 401);
  assert.equal(result.body.error, 'SESSION_EXPIRED');
});

test('an ADMIN route with an ordinary session is 403', async () => {
  await freshSheet();
  const token = await createSession('fan1');

  const result = await post('adminListUsers', {}, token);
  assert.equal(result.status, 403);
  assert.equal(result.body.error, 'FORBIDDEN');
});

test('an admin session reaches an ADMIN route', async () => {
  await freshSheet();
  const token = await createSession('admin1');

  const result = await post('adminListUsers', {}, token);
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.users.length, 3);
});

test('a locked write costs 3 reads and 3 writes, and nothing more', async () => {
  await freshSheet();
  const reads = fake.stats.reads;
  const writes = fake.stats.writes;

  const result = await post('signUp', {
    fullName: 'Brand New', username: 'brandnew', email: 'bn@v.app', password: 'password123'
  });
  assert.equal(result.body.ok, true);

  // This is the real price of mutual exclusion on a spreadsheet, and the reason
  // only signup, payment, subscription and verification pay it:
  //   reads  — claim the lock, read it back, then load the tables fresh
  //   writes — claim, flush the change, release
  // The route declares no tables, so the router itself loads nothing.
  assert.equal(fake.stats.reads - reads, 3, 'lock read cost changed');
  assert.equal(fake.stats.writes - writes, 3, 'lock write cost changed');
});

test('a whole authenticated request is one read and at most one write', async () => {
  await freshSheet();
  const token = await createSession('celeb1');

  const reads = fake.stats.reads;
  const writes = fake.stats.writes;

  const result = await post('createPost', { caption: 'hello world', visibility: 'PUBLIC' }, token);

  assert.equal(result.body.ok, true);
  assert.equal(fake.stats.reads - reads, 1, 'more than one batched read');
  assert.equal(fake.stats.writes - writes, 1, 'more than one batched write');
});

test('a read-only request writes nothing at all', async () => {
  await freshSheet();
  const token = await createSession('fan1');

  const writes = fake.stats.writes;
  const result = await post('getCreators', {}, token);

  assert.equal(result.body.ok, true);
  assert.equal(fake.stats.writes, writes);
});

test('a malformed body is a 400 rather than a 500', async () => {
  await freshSheet();

  const response = await handler({
    httpMethod: 'POST',
    path: '/.netlify/functions/api/logIn',
    headers: {},
    body: '{not json'
  });
  assert.equal(response.statusCode, 400);
});

test('an internal failure returns a generic message, never the spreadsheet id', async () => {
  await freshSheet();
  const token = await createSession('fan1');

  // Break the transport underneath the handler.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error(`boom: sheet ${process.env.GOOGLE_SHEET_ID} row 7`); };

  try {
    const result = await post('getPublicFeed', {}, token);
    assert.equal(result.status, 500);
    assert.ok(!result.body.error.includes(process.env.GOOGLE_SHEET_ID));
    assert.ok(!result.body.error.includes('row 7'));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a quota failure is reported as retryable, not as a generic error', async () => {
  await freshSheet();
  const token = await createSession('fan1');

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input : new URL(String(input));
    if (url.href.includes('/v4/spreadsheets/')) {
      return new Response(JSON.stringify({ error: { message: 'Quota exceeded for reads' } }),
        { status: 429, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input, init);
  };

  try {
    const result = await post('getPublicFeed', {}, token);
    assert.equal(result.status, 500);
    // The operator can act on this and the user should simply try again, so it
    // is the one failure worth naming.
    assert.match(result.body.error, /rate limit/i);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('logging out revokes the token', async () => {
  await freshSheet();
  const token = await createSession('fan1');

  assert.equal((await post('getCreators', {}, token)).status, 200);
  assert.equal((await post('logOut', {}, token)).status, 200);
  assert.equal((await post('getCreators', {}, token)).status, 401);
});

test('every route declares its tables', async () => {
  // A missing declaration means the handler reads an undefined table at runtime,
  // which a route test only catches if it happens to cover that route.
  const source = await (await import('node:fs/promises')).readFile(
    new URL('../netlify/functions/api.js', import.meta.url), 'utf8');

  const entries = [...source.matchAll(/^\s{2}(\w+):\s*\{([^}]*)\}/gm)];
  assert.ok(entries.length >= 50, `only found ${entries.length} routes`);

  for (const [, name, definition] of entries) {
    assert.match(definition, /level:/, `${name} has no level`);
    assert.match(definition, /tables:/, `${name} has no tables declaration`);
  }
});

test.after(() => fake.restore());
