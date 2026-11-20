/**
 * Behaviours that only exist on the Postgres backend, or that only a real
 * database can prove. These are the things a mock would have got wrong, and the
 * reason the Postgres tests run against an actual server.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pgHarness, PG_URL } from './harness-pg.mjs';

if (!PG_URL) {
  test('postgres specifics', { skip: 'TEST_DATABASE_URL is not set' }, () => {});
} else {
  const harness = await pgHarness();
  const { openStore } = harness;
  const { transact } = await import('../src/lib/store.js');
  const iso = (ms) => new Date(ms).toISOString();

  test('BIGINT and NUMERIC come back as numbers, not strings', async () => {
    await harness.reset();

    let store = await openStore(['Payments']);
    store.payments.insert({
      id: 'p1', user_id: 'u1', purpose: 'SUBSCRIPTION',
      amount_paise: 2990000000,          // comfortably past INT4
      commission_paise: 448500000,
      net_paise: 2541500000,
      commission_percent: 15.5,
      status: 'PAID', mode: 'RAZORPAY'
    });
    await store.flush();

    store = await openStore(['Payments']);
    const row = store.payments.byId('p1');

    // node-postgres hands BIGINT and NUMERIC back as STRINGS. Without coercion
    // in the store layer, "2990000000" + 0 would concatenate and every money
    // total in the app would be quietly wrong.
    assert.equal(typeof row.amount_paise, 'number');
    assert.equal(row.amount_paise, 2990000000);
    assert.equal(typeof row.commission_percent, 'number');
    assert.equal(row.commission_percent, 15.5);
    assert.equal(row.net_paise + row.commission_paise, 2990000000);
  });

  test("'' round-trips as '' while being a real NULL in the column", async () => {
    await harness.reset();

    let store = await openStore(['Users']);
    store.users.insert({
      id: 'u1', full_name: 'No Dates', username: 'nodates', email: 'n@d.com',
      status: 'ACTIVE', verified_at: '', status_changed_at: ''
    });
    await store.flush();

    // The Sheets backend has no NULL, so every route was written against ''.
    // Both backends must agree on that, or the routes would need to know which
    // one they are talking to.
    store = await openStore(['Users']);
    assert.equal(store.users.byId('u1').verified_at, '');
    assert.equal(store.users.byId('u1').status_changed_at, '');

    // ...but underneath it is a genuine NULL, not the string "". Storing ""
    // in a TIMESTAMPTZ would have failed outright; storing the epoch would have
    // been worse, because "verified at 1970" reads as a real date.
    const { rows } = await harness.sql(
      `SELECT verified_at IS NULL AS is_null, pg_typeof(verified_at)::text AS type
         FROM users WHERE id = 'u1'`
    );
    assert.equal(rows[0].is_null, true);
    assert.equal(rows[0].type, 'timestamp with time zone');
  });

  test('a real timestamp keeps its value across the round trip', async () => {
    await harness.reset();
    const when = '2026-03-04T05:06:07.000Z';

    let store = await openStore(['Users']);
    store.users.insert({
      id: 'u3', full_name: 'Dated', username: 'dated', email: 'd@d.com',
      status: 'ACTIVE', verified_at: when
    });
    await store.flush();

    store = await openStore(['Users']);
    assert.equal(store.users.byId('u3').verified_at, when);
  });

  test('a failure inside transact rolls the whole thing back', async () => {
    await harness.reset();

    await assert.rejects(() => transact(['Users', 'Posts'], async (store) => {
      store.users.insert({
        id: 'u1', full_name: 'Half Written', username: 'half', email: 'h@w.com', status: 'ACTIVE'
      });
      store.posts.insert({
        id: 'p1', author_id: 'u1', status: 'ACTIVE', caption: 'should not survive',
        created_at: iso(Date.now()), expires_at: iso(Date.now() + 86400000)
      });
      await store.flush();
      throw new Error('boom, after the writes');
    }), /boom/);

    // This is the guarantee the spreadsheet cannot offer at all: on Sheets the
    // user row would already be appended and only the error would tell you.
    const store = await openStore(['Users', 'Posts']);
    assert.equal(store.users.all().length, 0, 'user survived a rolled-back transaction');
    assert.equal(store.posts.all().length, 0, 'post survived a rolled-back transaction');
  });

  test('the partial unique index allows many unpaid orders but one paid id', async () => {
    await harness.reset();

    // Several CREATED payments all hold '' in payment_id, and must coexist. This
    // is why the index is `WHERE payment_id <> ''` and not `IS NOT NULL`.
    await harness.seed('Payments', [
      { id: 'r1', user_id: 'u1', purpose: 'TIP', order_id: 'order_1', payment_id: '', status: 'CREATED' },
      { id: 'r2', user_id: 'u1', purpose: 'TIP', order_id: 'order_2', payment_id: '', status: 'CREATED' },
      { id: 'r3', user_id: 'u1', purpose: 'TIP', order_id: 'order_3', payment_id: '', status: 'CREATED' }
    ]);

    const store = await openStore(['Payments']);
    assert.equal(store.payments.all().length, 3);

    // But the same real gateway id twice is a replay, and must be impossible.
    await assert.rejects(
      () => harness.seed('Payments', [
        { id: 'r4', user_id: 'u1', purpose: 'TIP', order_id: 'order_4', payment_id: 'pay_x', status: 'PAID' },
        { id: 'r5', user_id: 'u1', purpose: 'TIP', order_id: 'order_5', payment_id: 'pay_x', status: 'PAID' }
      ]),
      /unique|duplicate/i
    );
  });

  test('one live subscription per pair is enforced by the database', async () => {
    await harness.reset();

    await harness.seed('Subscriptions', [
      { id: 's1', subscriber_id: 'fan1', celebrity_id: 'celeb1', status: 'ACTIVE',
        created_at: iso(Date.now()), expires_at: iso(Date.now() + 86400000) }
    ]);

    await assert.rejects(() => harness.seed('Subscriptions', [
      { id: 's2', subscriber_id: 'fan1', celebrity_id: 'celeb1', status: 'ACTIVE',
        created_at: iso(Date.now()), expires_at: iso(Date.now() + 86400000) }
    ]), /unique|duplicate/i, 'a second live subscription for the pair was allowed');

    // A cancelled one alongside a live one is fine — the index is partial.
    await harness.seed('Subscriptions', [
      { id: 's3', subscriber_id: 'fan1', celebrity_id: 'celeb1', status: 'CANCELLED',
        created_at: iso(Date.now()), expires_at: iso(Date.now() + 86400000) }
    ]);
    const store = await openStore(['Subscriptions']);
    assert.equal(store.subscriptions.all().length, 2);
  });

  test('openStore loads many tables in one round trip', async () => {
    await harness.reset();

    const before = harness.writes();
    const store = await openStore([
      'Users', 'Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions', 'Saves', 'Payments'
    ]);

    assert.equal(Object.keys(store.tables).length, 8);
    // A read must not write, and eight tables must not be eight queries — a
    // serverless function pays network latency per round trip.
    assert.equal(harness.writes(), before);
  });

  test.after(() => harness.teardown());
}
