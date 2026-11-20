import {
  batchGet, append, batchUpdate, deleteRows, getCell, setCell
} from './sheets.js';
import { newId } from './util.js';
import {
  T, TABLES, LOCK_TAB, TABLE_NAMES, columnsOf, widthOf, primaryKeyOf
} from './tables.js';

/**
 * THE GOOGLE SHEETS BACKEND
 *
 * Each table is a tab; row 1 holds the column names. A request opens a store
 * with exactly the tables it needs — one batchGet, however many tables — works
 * against plain JavaScript objects, then flushes every change in one write.
 *
 * Three things this has to get right, because a spreadsheet gives none of them:
 *
 *   1. TYPES. Cells are strings and numbers, so every column declares a type.
 *   2. ROW IDENTITY. A row's address is its position, and positions move when
 *      anything above is deleted. Updates are therefore applied before deletes
 *      within a flush, and any read-modify-write that must not race is done
 *      inside a lock against a freshly loaded store.
 *   3. MUTUAL EXCLUSION. Postgres has unique indexes; a spreadsheet has none.
 *      Uniqueness is enforced by holding the lock, re-reading, and checking.
 *
 * The Postgres backend in store-pg.js presents this same interface, which is
 * why no route knows which one it is talking to.
 */
export { TABLES, TABLE_NAMES, LOCK_TAB, columnsOf, widthOf } from './tables.js';
export { isActive, liveSubscription, livePost } from './tables.js';

/**
 * THE RELATIONAL LAYER OVER GOOGLE SHEETS
 *
 * Each table is a tab; row 1 holds the column names. A request opens a store
 * with exactly the tables it needs — one batchGet, however many tables — works
 * against plain JavaScript objects, then flushes every change in one write.
 *
 * Three things this has to get right, because a spreadsheet gives none of them:
 *
 *   1. TYPES. Cells are strings and numbers. Every column declares a type so
 *      `is_admin` comes back as a boolean and not the string "TRUE".
 *   2. ROW IDENTITY. A row's address is its position, and positions move when
 *      anything above is deleted. Updates are therefore applied before deletes
 *      within a flush, and any read-modify-write that must not race is done
 *      inside a lock against a freshly loaded store.
 *   3. MUTUAL EXCLUSION. Postgres had unique indexes; a spreadsheet has none.
 *      Uniqueness is enforced by holding the lock, re-reading, and checking.
 */

// ------------------------------------------------------------ coercion
function decode(value, type) {
  if (value === undefined || value === null || value === '') {
    return type === T.INT || type === T.NUM ? 0 : (type === T.BOOL ? false : '');
  }
  switch (type) {
    case T.INT: return Math.trunc(Number(value)) || 0;
    case T.NUM: return Number(value) || 0;
    case T.BOOL: {
      const s = String(value).trim().toUpperCase();
      return s === 'TRUE' || s === 'YES' || s === '1';
    }
    default: return String(value);
  }
}

function encode(value, type) {
  if (value === undefined || value === null) return '';
  switch (type) {
    case T.INT: return Math.trunc(Number(value) || 0);
    case T.NUM: return Number(value) || 0;
    case T.BOOL: return value ? 'TRUE' : 'FALSE';
    case T.TS: {
      if (value === '') return '';
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? '' : date.toISOString();
    }
    default: return String(value);
  }
}

function rowToObject(table, cells, sheetRow) {
  const types = TABLES[table];
  const object = { _row: sheetRow, _table: table };
  Object.keys(types).forEach((column, index) => {
    object[column] = decode(cells[index], types[column]);
  });
  return object;
}

function objectToRow(table, object) {
  const types = TABLES[table];
  return Object.keys(types).map((column) => encode(object[column], types[column]));
}

// ---------------------------------------------------------------- table
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

  /**
   * Adds a row. It is visible to the rest of this request immediately —
   * read-your-writes without a round trip — and appended on flush.
   */
  insert(values) {
    const row = { _row: 0, _table: this.name, _new: true };
    for (const column of columnsOf(this.name)) {
      row[column] = values[column] !== undefined ? values[column] : defaultFor(this.name, column);
    }
    this.rows.push(row);
    this.store.pendingAppends.push(row);
    return row;
  }

  update(row, patch) {
    Object.assign(row, patch);
    // A row that has not been written yet needs no update entry: the append
    // will carry the patched values.
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
      // Never written, so cancel the append instead of deleting a real row.
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
  constructor(tables) {
    this.tables = tables;
    this.pendingAppends = [];
    this.pendingUpdates = new Set();
    this.pendingDeletes = [];
    for (const [name, table] of Object.entries(tables)) this[lower(name)] = table;
  }

  get dirty() {
    return this.pendingAppends.length > 0 || this.pendingUpdates.size > 0 || this.pendingDeletes.length > 0;
  }

  /**
   * Applies everything in one pass.
   *
   * Order is load-bearing. Updates address rows by position, and a delete
   * shifts every row beneath it, so updates must be written while the
   * positions they were read at are still true. Appends go last because they
   * do not depend on any index at all.
   */
  async flush() {
    if (!this.dirty) return;

    const widths = {};
    for (const name of Object.keys(this.tables)) widths[name] = widthOf(name);

    if (this.pendingUpdates.size) {
      const writes = [...this.pendingUpdates].map((row) => ({
        tab: row._table,
        row: row._row,
        values: objectToRow(row._table, row)
      })).filter((write) => write.row > 1);
      await batchUpdate(writes, widths);
      this.pendingUpdates.clear();
    }

    if (this.pendingDeletes.length) {
      const byTable = groupBy(this.pendingDeletes, (row) => row._table);
      for (const [table, rows] of Object.entries(byTable)) {
        await deleteRows(table, rows.map((row) => row._row));
      }
      this.pendingDeletes = [];
    }

    if (this.pendingAppends.length) {
      const byTable = groupBy(this.pendingAppends, (row) => row._table);
      for (const [table, rows] of Object.entries(byTable)) {
        const firstRow = await append(table, rows.map((row) => objectToRow(table, row)), widthOf(table));
        rows.forEach((row, index) => {
          row._row = firstRow ? firstRow + index : 0;
          delete row._new;
        });
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

/**
 * Loads the named tables in a single API call.
 *
 * Deliberately not cached across requests. A spreadsheet is editable by hand
 * and by other function invocations, so a stale cache would not merely serve
 * old reads — it would make a write land on the wrong row.
 */
export async function openStore(names) {
  const wanted = [...new Set(names)];
  for (const name of wanted) {
    if (!TABLES[name]) throw new Error(`Unknown table "${name}".`);
  }

  // A route that needs nothing loaded — signing up, signing out — must not pay
  // for a round trip, and the API rejects a batchGet with no ranges anyway.
  if (!wanted.length) return new Store({});

  const raw = await batchGet(wanted, wanted.map(widthOf));

  const tables = {};
  for (const name of wanted) {
    const grid = raw[name] || [];
    const rows = [];
    // Row 1 is the header; sheet rows are 1-based, so data starts at 2.
    for (let i = 1; i < grid.length; i += 1) {
      const cells = grid[i] || [];
      // Sheets omits trailing empties, and a wholly blank row is a gap left by
      // a hand edit rather than a record.
      if (!cells.length || cells.every((c) => c === '' || c === undefined || c === null)) continue;
      rows.push(rowToObject(name, cells, i + 1));
    }
    tables[name] = new Table(null, name, rows);
  }

  const store = new Store(tables);
  for (const table of Object.values(tables)) table.store = store;
  return store;
}

// ----------------------------------------------------------------- lock
const LOCK_TTL_MS = 15_000;
const LOCK_CELL = 'A2';

/**
 * A mutex on a single cell.
 *
 * Claim, pause, read back. Sheets serialises writes, so if two callers claim at
 * once the cell ends up holding exactly one of the two ids and only that caller
 * sees its own token on the read-back. The other backs off.
 *
 * Not free — an acquire/release pair costs three API calls against a 60/min
 * write quota — so this wraps only the operations where a lost race would
 * corrupt something: creating an account, settling a payment, taking a
 * subscription. Reads never take it.
 */
export async function withLock(fn, { timeoutMs = 12_000 } = {}) {
  const holder = newId('lock');
  const deadline = Date.now() + timeoutMs;
  let acquired = false;

  while (Date.now() < deadline) {
    const current = String(await getCell(LOCK_TAB, LOCK_CELL) || '');
    const [, expiresAt] = current.split('|');

    const free = !current || !expiresAt || Number(expiresAt) < Date.now();
    if (free) {
      await setCell(LOCK_TAB, LOCK_CELL, `${holder}|${Date.now() + LOCK_TTL_MS}`);
      // Let a competing write land before deciding who won.
      await sleep(300);
      const readBack = String(await getCell(LOCK_TAB, LOCK_CELL) || '');
      if (readBack.startsWith(`${holder}|`)) { acquired = true; break; }
    }

    await sleep(250 + Math.floor(Math.random() * 250));
  }

  if (!acquired) {
    throw new Error('The spreadsheet is busy. Please try again in a moment.');
  }

  try {
    return await fn();
  } finally {
    // Best effort. If the release fails the TTL clears it within 15 seconds,
    // which is why the lock carries an expiry at all.
    try { await setCell(LOCK_TAB, LOCK_CELL, ''); } catch { /* TTL will clear it */ }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** openStore + withLock, for the common "read fresh, mutate, write" shape. */
export async function transact(names, fn) {
  return withLock(async () => {
    const store = await openStore(names);
    const result = await fn(store);
    await store.flush();
    return result;
  });
}

export { newId };
