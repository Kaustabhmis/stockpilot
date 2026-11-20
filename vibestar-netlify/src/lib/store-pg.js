import pg from 'pg';
import { newId } from './util.js';
import { env } from './config.js';
import {
  T, TABLES, TABLE_NAMES, columnsOf, primaryKeyOf, sqlNameOf
} from './tables.js';

export { TABLES, TABLE_NAMES, columnsOf, widthOf, LOCK_TAB } from './tables.js';
export { isActive, liveSubscription, livePost } from './tables.js';

/**
 * THE SUPABASE / POSTGRES BACKEND
 *
 * Presents exactly the interface store-sheets.js does — openStore, transact,
 * withLock, and the same Table methods — so not one line of any route module
 * knows which backend is underneath. That was the point of putting a store layer
 * there in the first place.
 *
 * WHAT THIS BUYS, in order of how much it matters:
 *
 *   1. No rate ceiling. Sheets allows ~300 reads and ~60 writes a minute for the
 *      whole project. That, not code, was the limit on concurrent users.
 *   2. Real transactions. A payment settles atomically instead of relying on a
 *      mutex held across a read and a write.
 *   3. Real unique indexes, so duplicate usernames and double settlements are
 *      impossible rather than merely prevented by careful code.
 *
 * WHAT IS DELIBERATELY NOT DONE HERE: this loads whole tables per request, the
 * same as the Sheets backend, rather than pushing filters into SQL. It is a
 * compatibility layer, and an honest one — Postgres reading a few thousand rows
 * is nothing next to a Sheets round trip, and keeping one code path is worth
 * more right now than idiomatic queries. The place that changes is when the feed
 * gets pagination, which is where SQL starts genuinely earning its keep.
 */

// ------------------------------------------------------------------ pool
let pool = null;

/**
 * One pool per warm container. Serverless opens many short-lived connections, so
 * this must be Supabase's POOLED connection string (port 6543, the pgBouncer
 * one) — the direct 5432 string will exhaust the connection limit under load.
 */
export function getPool() {
  if (pool) return pool;

  const connectionString = env.databaseUrl();
  if (!connectionString) throw new Error('DATABASE_URL is not set.');

  const local = /localhost|127\.0\.0\.1/.test(connectionString);
  pool = new pg.Pool({
    connectionString,
    // Supabase terminates TLS with a certificate chain Node does not ship a root
    // for. The connection is still encrypted; only chain verification is
    // relaxed, which is what every Supabase client does.
    ssl: local ? false : { rejectUnauthorized: false },
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000
  });

  pool.on('error', (err) => console.error('pg pool error', err));
  return pool;
}

export async function closePool() {
  if (pool) { const p = pool; pool = null; await p.end(); }
}

// -------------------------------------------------------------- coercion
/**
 * SQL value to the shape the routes expect.
 *
 * Two of these are not optional. BIGINT and NUMERIC come back from node-postgres
 * as STRINGS, so `amount_paise` would be "29900" and arithmetic on it would
 * concatenate. And a NULL timestamp becomes '', because the Sheets backend has
 * no NULL and every route was written against that convention.
 */
function fromSql(value, type) {
  if (value === null || value === undefined) {
    return type === T.INT || type === T.NUM ? 0 : (type === T.BOOL ? false : '');
  }
  switch (type) {
    case T.INT: return Math.trunc(Number(value)) || 0;
    case T.NUM: return Number(value) || 0;
    case T.BOOL: return value === true || value === 'true' || value === 't';
    case T.TS: {
      /**
       * Always normalised to a strict ISO-Z string.
       *
       * This matters more than it looks. openStore reads through json_agg, and
       * Postgres renders a timestamptz in JSON as "2026-03-04T05:06:07+00:00" —
       * valid, parseable, and NOT what the Sheets backend produces. Left alone,
       * every createdAt in the API would change format depending on which
       * database was behind it, and any client comparing timestamps as strings
       * would quietly break on one of them.
       */
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? '' : date.toISOString();
    }
    default: return String(value);
  }
}

/** The reverse: '' becomes NULL for a timestamp, so the column stays honest. */
function toSql(value, type) {
  if (value === undefined || value === null) return type === T.TS ? null : (
    type === T.INT || type === T.NUM ? 0 : (type === T.BOOL ? false : ''));

  switch (type) {
    case T.INT: return Math.trunc(Number(value) || 0);
    case T.NUM: return Number(value) || 0;
    case T.BOOL: return Boolean(value);
    case T.TS: {
      if (value === '') return null;
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    default: return String(value);
  }
}

function rowFromSql(table, row) {
  const types = TABLES[table];
  const object = { _table: table, _key: row[primaryKeyOf(table)] };
  for (const column of Object.keys(types)) {
    object[column] = fromSql(row[column], types[column]);
  }
  return object;
}

// ---------------------------------------------------------------- table
/** Identical surface to the Sheets Table, so route code is unchanged. */
class Table {
  constructor(store, name, rows) {
    this.store = store;
    this.name = name;
    this.rows = rows;
  }

  all() { return this.rows; }
  find(predicate) { return this.rows.find(predicate) || null; }
  filter(predicate) { return this.rows.filter(predicate); }
  count(predicate) { return predicate ? this.rows.reduce((n, r) => n + (predicate(r) ? 1 : 0), 0) : this.rows.length; }
  byId(id) { return id ? this.find((row) => row.id === id) : null; }

  insert(values) {
    const row = { _table: this.name, _new: true };
    for (const column of columnsOf(this.name)) {
      row[column] = values[column] !== undefined ? values[column] : defaultFor(this.name, column);
    }
    row._key = row[primaryKeyOf(this.name)];
    this.rows.push(row);
    this.store.pendingAppends.push(row);
    return row;
  }

  update(row, patch) {
    Object.assign(row, patch);
    if (!row._new) this.store.pendingUpdates.add(row);
    return row;
  }

  updateWhere(predicate, patch) {
    const matched = this.filter(predicate);
    matched.forEach((row) => this.update(row, patch));
    return matched;
  }

  remove(row) {
    const index = this.rows.indexOf(row);
    if (index >= 0) this.rows.splice(index, 1);

    if (row._new) {
      const queued = this.store.pendingAppends.indexOf(row);
      if (queued >= 0) this.store.pendingAppends.splice(queued, 1);
      return;
    }
    this.store.pendingUpdates.delete(row);
    this.store.pendingDeletes.push(row);
  }

  removeWhere(predicate) {
    const matched = this.filter(predicate);
    matched.forEach((row) => this.remove(row));
    return matched;
  }
}

function defaultFor(table, column) {
  const type = TABLES[table][column];
  if (type === T.INT || type === T.NUM) return 0;
  if (type === T.BOOL) return false;
  return '';
}

// ---------------------------------------------------------------- store
class Store {
  constructor(tables, client) {
    this.tables = tables;
    this.client = client;      // set inside transact, so writes join that transaction
    this.pendingAppends = [];
    this.pendingUpdates = new Set();
    this.pendingDeletes = [];
    for (const [name, table] of Object.entries(tables)) this[lower(name)] = table;
  }

  get dirty() {
    return this.pendingAppends.length > 0 || this.pendingUpdates.size > 0 || this.pendingDeletes.length > 0;
  }

  async flush() {
    if (!this.dirty) return;

    const run = this.client
      ? (sql, params) => this.client.query(sql, params)
      : (sql, params) => getPool().query(sql, params);

    // Deletes first here, unlike the Sheets backend. There, updates had to go
    // before deletes because a delete shifted every row position beneath it.
    // Rows are addressed by primary key now, so order is free — and doing
    // deletes first means a delete-then-reinsert of the same key works.
    if (this.pendingDeletes.length) {
      const byTable = groupBy(this.pendingDeletes, (row) => row._table);
      for (const [table, rows] of Object.entries(byTable)) {
        const key = primaryKeyOf(table);
        await run(
          `DELETE FROM ${sqlNameOf(table)} WHERE ${key} = ANY($1::text[])`,
          [rows.map((row) => row._key)]
        );
      }
      this.pendingDeletes = [];
    }

    if (this.pendingUpdates.size) {
      for (const row of this.pendingUpdates) {
        const table = row._table;
        const types = TABLES[table];
        const key = primaryKeyOf(table);
        const columns = columnsOf(table).filter((column) => column !== key);

        const params = columns.map((column) => toSql(row[column], types[column]));
        const assignments = columns.map((column, i) => `${column} = $${i + 1}`);
        params.push(row._key);

        await run(
          `UPDATE ${sqlNameOf(table)} SET ${assignments.join(', ')} WHERE ${key} = $${params.length}`,
          params
        );
      }
      this.pendingUpdates.clear();
    }

    if (this.pendingAppends.length) {
      /**
       * On INSERT, a column whose value is null is OMITTED rather than sent as
       * NULL, so the schema's DEFAULT applies — `created_at TIMESTAMPTZ NOT NULL
       * DEFAULT now()` would otherwise reject an insert that simply did not
       * mention it, even though the Sheets backend accepts exactly that.
       *
       * On UPDATE the opposite is right: there, null means "clear this", which is
       * how the reminder stamps get re-armed on a renewal.
       *
       * A multi-row INSERT needs one column list, so rows are grouped by which
       * columns they omit. In practice a batch is uniform and this is one group.
       */
      const shapeOf = (row) => {
        const types = TABLES[row._table];
        return columnsOf(row._table)
          .filter((column) => toSql(row[column], types[column]) !== null)
          .join(',');
      };

      const groups = groupBy(this.pendingAppends, (row) => `${row._table}|${shapeOf(row)}`);

      for (const rows of Object.values(groups)) {
        const table = rows[0]._table;
        const types = TABLES[table];
        const columns = shapeOf(rows[0]).split(',').filter(Boolean);

        const params = [];
        const tuples = rows.map((row) => {
          const placeholders = columns.map((column) => {
            params.push(toSql(row[column], types[column]));
            return `$${params.length}`;
          });
          return `(${placeholders.join(', ')})`;
        });

        await run(
          `INSERT INTO ${sqlNameOf(table)} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`,
          params
        );
        rows.forEach((row) => { delete row._new; });
      }
      this.pendingAppends = [];
    }
  }
}

function lower(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function groupBy(items, key) {
  return items.reduce((acc, item) => {
    const k = key(item);
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}

// ----------------------------------------------------------------- open
/**
 * Loads the named tables.
 *
 * Issued as one round trip using a UNION of json aggregates, so ten tables cost
 * one query rather than ten. Not for quota reasons — there is no quota here —
 * but because a serverless function pays network latency per round trip, and on
 * a pooled Supabase connection that is the dominant cost.
 */
export async function openStore(names, client = null) {
  const wanted = [...new Set(names)];
  for (const name of wanted) {
    if (!TABLES[name]) throw new Error(`Unknown table "${name}".`);
  }

  const tables = {};
  if (!wanted.length) {
    const store = new Store(tables, client);
    return store;
  }

  const query = wanted
    .map((name, i) => `SELECT $${i + 1}::text AS t, `
      + `coalesce(json_agg(x.*), '[]'::json) AS rows FROM ${sqlNameOf(name)} x`)
    .join(' UNION ALL ');

  const runner = client || getPool();
  const { rows: results } = await runner.query(query, wanted);

  const byName = new Map(results.map((result) => [result.t, result.rows]));
  for (const name of wanted) {
    const raw = byName.get(name) || [];
    tables[name] = new Table(null, name, raw.map((row) => rowFromSql(name, row)));
  }

  const store = new Store(tables, client);
  for (const table of Object.values(tables)) table.store = store;
  return store;
}

// ----------------------------------------------------------------- lock
/**
 * A transaction plus an advisory lock.
 *
 * The Sheets backend emulates this with a mutex cell — claim, pause, read back —
 * because it has nothing better. Here it is a real BEGIN/COMMIT, so a failure
 * halfway through rolls back rather than leaving a half-applied change, and
 * pg_advisory_xact_lock gives the same mutual exclusion for free and releases
 * automatically when the transaction ends, even if the function is killed.
 *
 * The lock is deliberately global, matching the Sheets behaviour exactly so both
 * backends serialise the same operations. Postgres could do far better — per-row
 * SELECT … FOR UPDATE — and that is the obvious next refinement, but making the
 * two backends behave identically is worth more than the concurrency today.
 */
const ADVISORY_LOCK_KEY = 20260819;

export async function withLock(fn, { timeoutMs = 12_000 } = {}) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '${Math.max(1000, timeoutMs)}ms'`);
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_KEY]);

    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    if (/lock_timeout|canceling statement/i.test(String(err.message))) {
      throw new Error('The database is busy. Please try again in a moment.');
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * openStore + withLock, for the "read fresh, mutate, write" shape.
 *
 * The store is loaded on the locked connection, so its reads see the state the
 * lock is protecting and its writes commit with it atomically.
 */
export async function transact(names, fn) {
  return withLock(async (client) => {
    const store = await openStore(names, client);
    const result = await fn(store);
    await store.flush();
    return result;
  });
}

export { newId };
