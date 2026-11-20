import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { installFakeAppsScript } from './fake-apps-script.mjs';

/**
 * Executes the GENERATED Code.gs.
 *
 * The route spec already proves the shared logic works on the Apps Script store.
 * This proves something different and equally necessary: that the bundler's
 * output is valid, loadable, single-scope JavaScript with working entry points.
 * A bundling mistake — a stripped export that was actually needed, two modules
 * in the wrong order, a `const` read before its declaration — shows up here and
 * nowhere else.
 */
const CODE_GS = path.resolve(import.meta.dirname, '../../apps-script/vibestar/Code.gs');
const INDEX_HTML = path.resolve(import.meta.dirname, '../../apps-script/vibestar/Index.html');

if (!existsSync(CODE_GS)) {
  test('apps script bundle', { skip: 'run npm run build:gas first' }, () => {});
} else {
  const fake = installFakeAppsScript();
  const source = readFileSync(CODE_GS, 'utf8');

  // Apps Script evaluates every file into one global scope and then calls a
  // named function. Reproducing that is what makes this a real test of the
  // bundle rather than of the modules it came from.
  const load = new Function(`
    ${source}
    return {
      apiCall, doGet, doPost, setUpSpreadsheet, runMaintenance, seedDemoData,
      TABLE_NAMES, badgeFor, hashPassword, verifyPassword, newSalt
    };
  `);

  let gas;
  test('the generated Code.gs loads as a single scope', () => {
    // Throws on a syntax error, a duplicate declaration, or a const read before
    // its declaration — the three things concatenation gets wrong.
    gas = load();
    assert.equal(typeof gas.apiCall, 'function');
    assert.equal(typeof gas.doGet, 'function');
    assert.equal(typeof gas.setUpSpreadsheet, 'function');
    assert.equal(gas.TABLE_NAMES.length, 13);
  });

  test('setUpSpreadsheet creates every tab', () => {
    const message = gas.setUpSpreadsheet();
    assert.match(message, /Ready\. 13 tables/);
    assert.match(message, /Drive access granted/);
  });

  test('the platform shim computes real hashes through Utilities', async () => {
    const salt = gas.newSalt();
    assert.equal(salt.length, 32);

    const hash = await gas.hashPassword('correct horse', salt);
    // Apps Script has no scrypt, so the tag must say pbkdf2.
    assert.match(hash, /^pbkdf2\$\d+\$[a-f0-9]{64}$/);

    assert.equal(await gas.verifyPassword('correct horse', salt, hash), true);
    assert.equal(await gas.verifyPassword('wrong horse', salt, hash), false);
  });

  test('signup, login and a post work end to end through apiCall', async () => {
    gas.setUpSpreadsheet();

    const signUp = JSON.parse(await gas.apiCall('signUp', {
      fullName: 'Gas Creator', username: 'gascreator', email: 'gas@v.app',
      password: 'password123', role: 'CELEBRITY'
    }, ''));
    assert.equal(signUp.ok, true, signUp.error);
    assert.ok(signUp.token);

    // The session came back from the Sessions tab, which is where the Apps
    // Script build keeps them — unlike the Netlify build, which uses Blobs.
    const resumed = JSON.parse(await gas.apiCall('resumeSession', {}, signUp.token));
    assert.equal(resumed.ok, true);
    assert.equal(resumed.user.username, 'gascreator');

    const posted = JSON.parse(await gas.apiCall('createPost', {
      caption: 'first post from apps script', visibility: 'PUBLIC'
    }, signUp.token));
    assert.equal(posted.ok, true, posted.error);

    const feed = JSON.parse(await gas.apiCall('getPublicFeed', {}, signUp.token));
    assert.equal(feed.ok, true);
    assert.equal(feed.posts.length, 1);
    assert.equal(feed.posts[0].caption, 'first post from apps script');

    // And the row is genuinely in the spreadsheet.
    assert.equal(fake.rowCount('Users'), 1);
    assert.equal(fake.rowCount('Posts'), 1);
  });

  test('apiCall enforces the same authorisation levels', async () => {
    gas.setUpSpreadsheet();

    const noToken = JSON.parse(await gas.apiCall('getPublicFeed', {}, ''));
    assert.equal(noToken.ok, false);
    assert.equal(noToken.error, 'SESSION_EXPIRED');

    const signUp = JSON.parse(await gas.apiCall('signUp', {
      fullName: 'Plain Fan', username: 'plainfan', email: 'fan@v.app', password: 'password123'
    }, ''));
    const forbidden = JSON.parse(await gas.apiCall('adminListUsers', {}, signUp.token));
    assert.equal(forbidden.error, 'FORBIDDEN');

    const unknown = JSON.parse(await gas.apiCall('noSuchAction', {}, signUp.token));
    assert.equal(unknown.error, 'Not found');
  });

  test('a duplicate username is refused under LockService', async () => {
    gas.setUpSpreadsheet();

    const first = JSON.parse(await gas.apiCall('signUp', {
      fullName: 'One', username: 'contested', email: 'one@v.app', password: 'password123'
    }, ''));
    assert.equal(first.ok, true);

    const second = JSON.parse(await gas.apiCall('signUp', {
      fullName: 'Two', username: 'CONTESTED', email: 'two@v.app', password: 'password123'
    }, ''));
    assert.equal(second.ok, false);
    assert.match(second.error, /taken/i);
  });

  test('doGet returns a page and carries the share parameter', () => {
    const output = gas.doGet({ parameter: { p: 'post_123' } });
    assert.ok(output, 'doGet returned nothing');
  });

  test('runMaintenance completes and reports', async () => {
    gas.setUpSpreadsheet();
    const result = await gas.runMaintenance();

    assert.deepEqual(result.failures, []);
    assert.equal(typeof result.expired, 'number');
    assert.equal(typeof result.prunedSessions, 'number');
  });

  test('the generated Index.html uses google.script.run, not fetch', () => {
    const html = readFileSync(INDEX_HTML, 'utf8');

    assert.match(html, /google\.script\.run/);
    assert.match(html, /\.apiCall\(fnName, payload/);
    // The Netlify transport must be gone, or every call would 404.
    assert.ok(!/fetch\(\s*['"`]\/api\//.test(html), 'the fetch transport survived');
    // app.js is inlined; there is no static host to serve it.
    assert.ok(!/<script\s+src=["']\/app\.js/.test(html), 'app.js is still referenced externally');
    assert.match(html, /VIBESTAR_SHARED_POST/);
  });

  test.after(() => fake.restore());
}
