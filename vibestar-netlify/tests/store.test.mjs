import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeSheets } from './fake-sheets.mjs';

delete process.env.DATABASE_URL;
const fake = installFakeSheets();

const { openStore, TABLES, columnsOf, TABLE_NAMES } = await import('../src/lib/store.js');

/** Lays down header rows for every table plus the lock cell. */
function freshSheet() {
  for (const table of TABLE_NAMES) fake.seed(table, columnsOf(table));
  fake.seed('_Lock', ['lock'], [{ lock: '' }]);
}

test('every table has a header row and no duplicate columns', () => {
  for (const table of TABLE_NAMES) {
    const columns = columnsOf(table);
    assert.ok(columns.length > 0, `${table} has no columns`);
    assert.equal(new Set(columns).size, columns.length, `${table} has a duplicate column`);
    assert.equal(columns[0], Object.keys(TABLES[table])[0]);
  }
});

test('sessions and login attempts are not spreadsheet tables', () => {
  // They live in Blobs: both are touched on every request and Sheets cannot
  // index, so a session lookup would mean reading the whole table each time.
  assert.ok(!TABLE_NAMES.includes('Sessions'));
  assert.ok(!TABLE_NAMES.includes('LoginAttempts'));
});

test('insert then read back preserves types across the wire', async () => {
  freshSheet();

  let store = await openStore(['Users']);
  store.users.insert({
    id: 'u1', full_name: 'Ada L', username: 'ada', email: 'ada@example.com',
    password_hash: 'h', password_salt: 's', role: 'CELEBRITY',
    monthly_price: 499, is_admin: true, verified_follower_count: 12000,
    verification_status: 'APPROVED', status: 'ACTIVE',
    created_at: '2026-01-01T00:00:00.000Z'
  });
  await store.flush();

  store = await openStore(['Users']);
  const row = store.users.byId('u1');

  assert.equal(row.full_name, 'Ada L');
  // The three coercions that a spreadsheet gets wrong if nothing enforces them.
  assert.equal(row.monthly_price, 499);
  assert.equal(typeof row.monthly_price, 'number');
  assert.equal(row.is_admin, true);
  assert.equal(typeof row.is_admin, 'boolean');
  assert.equal(row.created_at, '2026-01-01T00:00:00.000Z');
  // Unset columns come back as empty, not as the string "undefined".
  assert.equal(row.bio, '');
  assert.equal(row.verified_at, '');
});

test('a boolean false survives the round trip as false, not as empty', async () => {
  freshSheet();

  let store = await openStore(['Payments']);
  store.payments.insert({ id: 'p1', user_id: 'u1', purpose: 'TIP', signature_verified: false });
  await store.flush();

  store = await openStore(['Payments']);
  assert.equal(store.payments.byId('p1').signature_verified, false);
});

test('update writes to the row it was read from', async () => {
  freshSheet();

  let store = await openStore(['Posts']);
  for (const id of ['a', 'b', 'c']) {
    store.posts.insert({ id, author_id: 'u1', caption: `caption ${id}`, status: 'ACTIVE' });
  }
  await store.flush();

  store = await openStore(['Posts']);
  store.posts.update(store.posts.byId('b'), { caption: 'edited' });
  await store.flush();

  store = await openStore(['Posts']);
  assert.equal(store.posts.byId('a').caption, 'caption a');
  assert.equal(store.posts.byId('b').caption, 'edited');
  assert.equal(store.posts.byId('c').caption, 'caption c');
});

test('deleting several rows at once removes exactly those rows', async () => {
  freshSheet();

  let store = await openStore(['Likes']);
  for (const id of ['l1', 'l2', 'l3', 'l4', 'l5']) {
    store.likes.insert({ id, post_id: 'p1', user_id: id });
  }
  await store.flush();
  assert.equal(fake.rowCount('Likes'), 5);

  // Deleting a low row shifts everything below it up. If flush issued these in
  // ascending order the wrong records would go — this is the regression guard.
  store = await openStore(['Likes']);
  store.likes.remove(store.likes.byId('l2'));
  store.likes.remove(store.likes.byId('l4'));
  await store.flush();

  store = await openStore(['Likes']);
  assert.deepEqual(store.likes.all().map((r) => r.id), ['l1', 'l3', 'l5']);
});

test('an update and a delete in the same flush both land correctly', async () => {
  freshSheet();

  let store = await openStore(['Comments']);
  for (const id of ['c1', 'c2', 'c3', 'c4']) {
    store.comments.insert({ id, post_id: 'p1', user_id: 'u1', content: id, status: 'ACTIVE' });
  }
  await store.flush();

  store = await openStore(['Comments']);
  store.comments.remove(store.comments.byId('c1'));       // shifts c2..c4 up one
  store.comments.update(store.comments.byId('c4'), { content: 'survived' });
  await store.flush();

  store = await openStore(['Comments']);
  assert.deepEqual(store.comments.all().map((r) => r.id), ['c2', 'c3', 'c4']);
  assert.equal(store.comments.byId('c4').content, 'survived');
});

test('a row inserted and removed in the same request is never written', async () => {
  freshSheet();

  const store = await openStore(['Follows']);
  const row = store.follows.insert({ id: 'f1', follower_id: 'a', followee_id: 'b' });
  store.follows.remove(row);
  await store.flush();

  assert.equal(fake.rowCount('Follows'), 0);
});

test('reads are visible to the rest of the request before the flush', async () => {
  freshSheet();

  const store = await openStore(['Posts']);
  store.posts.insert({ id: 'p9', author_id: 'u1', caption: 'unwritten', status: 'ACTIVE' });

  // Read-your-writes without a round trip, which is what lets a handler emit a
  // notification and then count it in the same response.
  assert.equal(store.posts.byId('p9').caption, 'unwritten');
  assert.equal(fake.rowCount('Posts'), 0);

  await store.flush();
  assert.equal(fake.rowCount('Posts'), 1);
});

test('one request reads every declared table in a single API call', async () => {
  freshSheet();
  const before = fake.stats.reads;

  await openStore(['Users', 'Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions']);

  // Six tables, one batchGet. This is the whole reason the router declares
  // tables per route.
  assert.equal(fake.stats.reads - before, 1);
});

test('a flush touching several tables costs one append call per table, not per row', async () => {
  freshSheet();

  const store = await openStore(['Posts', 'Likes']);
  for (let i = 0; i < 10; i += 1) store.likes.insert({ id: `l${i}`, post_id: 'p1', user_id: `u${i}` });
  store.posts.insert({ id: 'p1', author_id: 'u1', status: 'ACTIVE' });

  const before = fake.stats.writes;
  await store.flush();

  assert.equal(fake.stats.writes - before, 2);
  assert.equal(fake.rowCount('Likes'), 10);
});

test('a blank row left by a hand edit is skipped, not read as a record', async () => {
  freshSheet();
  fake.seed('Users', columnsOf('Users'), [
    { id: 'u1', full_name: 'Real', username: 'real', email: 'r@e.com', status: 'ACTIVE' },
    {},   // someone cleared a row in the browser instead of deleting it
    { id: 'u2', full_name: 'Also Real', username: 'also', email: 'a@e.com', status: 'ACTIVE' }
  ]);

  const store = await openStore(['Users']);
  assert.deepEqual(store.users.all().map((r) => r.id), ['u1', 'u2']);
});

test('a row edited by hand after a blank gap still updates in place', async () => {
  freshSheet();
  fake.seed('Users', columnsOf('Users'), [
    { id: 'u1', full_name: 'One', username: 'one', email: '1@e.com', status: 'ACTIVE' },
    {},
    { id: 'u2', full_name: 'Two', username: 'two', email: '2@e.com', status: 'ACTIVE' }
  ]);

  let store = await openStore(['Users']);
  store.users.update(store.users.byId('u2'), { full_name: 'Two Edited' });
  await store.flush();

  store = await openStore(['Users']);
  assert.equal(store.users.byId('u1').full_name, 'One');
  assert.equal(store.users.byId('u2').full_name, 'Two Edited');
});

test('the access token is minted once and reused', async () => {
  freshSheet();
  const before = fake.stats.tokenMints;

  await openStore(['Users']);
  await openStore(['Posts']);
  await openStore(['Likes']);

  // Cached until it nears expiry; three reads must not mean three OAuth trips.
  assert.equal(fake.stats.tokenMints - before, 0);
});

test.after(() => fake.restore());
