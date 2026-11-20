/**
 * Postgres harness for the shared route spec.
 *
 * Runs against a REAL PostgreSQL database — the schema in db/schema.sql, applied
 * by npm run migrate — not a mock. That is the only way this proves anything:
 * the behaviours worth checking here are the ones a mock would get wrong, like
 * BIGINT arriving as a string, NULL timestamps, and partial unique indexes.
 *
 * Set TEST_DATABASE_URL to point it somewhere. The tests skip if it is unset, so
 * the suite still runs on a machine with no Postgres.
 *
 *   TEST_DATABASE_URL='postgres://postgres@127.0.0.1:5433/vibestar_test' npm test
 */
import pg from 'pg';

export const PG_URL = process.env.TEST_DATABASE_URL || '';

export async function pgHarness() {
  process.env.DATABASE_URL = PG_URL;
  delete process.env.GOOGLE_SHEET_ID;      // dispatcher must pick Postgres
  process.env.VIBESTAR_LOCAL_KV = '1';     // sessions in-process, no Netlify runtime
  process.env.URL = 'https://vibestar.test';
  process.env.MEDIA_URL_SECRET = 'test-media-secret';

  const store = await import('../src/lib/store.js');
  const { TABLE_NAMES, sqlNameOf, columnsOf, TABLES, T } = await import('../src/lib/tables.js');

  if (store.BACKEND !== 'POSTGRES') {
    throw new Error(`expected the Postgres backend, got ${store.BACKEND}`);
  }

  const pool = new pg.Pool({ connectionString: PG_URL, max: 2 });

  // Count writes by watching what the app actually sends, so the
  // "reading the feed writes nothing" assertion means the same on both backends.
  let writeCount = 0;
  const { getPool } = await import('../src/lib/store-pg.js');
  const appPool = getPool();
  const realQuery = appPool.query.bind(appPool);
  appPool.query = (...args) => {
    if (/^\s*(INSERT|UPDATE|DELETE)/i.test(String(args[0]))) writeCount += 1;
    return realQuery(...args);
  };
  // Writes inside a transaction go through a checked-out client, so patch those
  // too. Note the callback guard: pool.query() internally calls this.connect(cb),
  // and the callback form returns undefined rather than a promise — awaiting it
  // yields undefined and every query then fails on `client.query`.
  const realConnect = appPool.connect.bind(appPool);
  const countingClient = (client) => {
    if (!client || client.__counting) return client;
    const clientQuery = client.query.bind(client);
    client.__counting = true;
    client.query = (...inner) => {
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(String(inner[0]))) writeCount += 1;
      return clientQuery(...inner);
    };
    return client;
  };

  appPool.connect = (...args) => {
    if (typeof args[0] === 'function') {
      const callback = args[0];
      return realConnect((err, client, release) => callback(err, countingClient(client), release));
    }
    return realConnect(...args).then(countingClient);
  };

  /**
   * Fixture insert, straight to SQL — deliberately not via the store, so a bug
   * in the store's own insert path cannot hide by also corrupting the fixtures.
   *
   * Columns that would be null are omitted so the schema default applies, the
   * same rule the store uses: `created_at NOT NULL DEFAULT now()` must accept a
   * fixture that simply does not mention it.
   */
  async function seedTable(table, rows) {
    if (!rows.length) return;
    const types = TABLES[table];

    const valueFor = (row, column) => {
      const value = row[column];
      if (value === undefined || value === null || (types[column] === T.TS && value === '')) return null;
      if (types[column] === T.TS) return new Date(value).toISOString();
      return value;
    };

    // Grouped by shape, since one INSERT carries one column list.
    const shapeOf = (row) => columnsOf(table)
      .filter((column) => valueFor(row, column) !== null).join(',');

    const groups = new Map();
    for (const row of rows) {
      const shape = shapeOf(row);
      if (!groups.has(shape)) groups.set(shape, []);
      groups.get(shape).push(row);
    }

    for (const [shape, group] of groups) {
      const columns = shape.split(',').filter(Boolean);
      const params = [];
      const tuples = group.map((row) => {
        const placeholders = columns.map((column) => {
          params.push(valueFor(row, column));
          return `$${params.length}`;
        });
        return `(${placeholders.join(', ')})`;
      });

      await pool.query(
        `INSERT INTO ${sqlNameOf(table)} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`,
        params
      );
    }
  }

  return {
    label: 'postgres',
    openStore: store.openStore,

    async reset() {
      // One TRUNCATE, so no ordering worries and the sequence state is clean.
      await pool.query(
        `TRUNCATE ${TABLE_NAMES.map(sqlNameOf).join(', ')} RESTART IDENTITY CASCADE`
      );
    },

    seed: seedTable,
    /** Raw SQL, for asserting on what is physically in the column. */
    sql: (text, params = []) => pool.query(text, params),
    writes: () => writeCount,
    // Real unique indexes, so the database refuses duplicates outright.
    enforcesUniqueness: true,

    stubRazorpay({ amount = 29900, status = 'captured', orderId = 'order_1' } = {}) {
      process.env.RAZORPAY_KEY_ID = 'rzp_test_abc';
      process.env.RAZORPAY_KEY_SECRET = 'secret_xyz';

      const json = (body, code = 200) => new Response(JSON.stringify(body), {
        status: code, headers: { 'Content-Type': 'application/json' }
      });

      globalThis.fetch = async (input) => {
        const url = input instanceof URL ? input : new URL(String(input));
        if (!url.href.startsWith('https://api.razorpay.com')) {
          throw new Error(`unexpected request to ${url.href}`);
        }
        if (url.pathname.endsWith('/orders')) return json({ id: orderId, amount, currency: 'INR' });
        if (url.pathname.includes('/payments/')) {
          return json({ id: url.pathname.split('/').pop(), order_id: orderId, amount, status, currency: 'INR' });
        }
        return json({ error: { description: 'unexpected' } }, 400);
      };
    },

    async teardown() {
      await pool.end();
      await store.closePool();
    }
  };
}
