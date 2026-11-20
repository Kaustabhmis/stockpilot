/* eslint-disable no-undef */
import { newId } from './util.js';
import { sleep } from './platform.js';
import {
  T, TABLES, TABLE_NAMES, LOCK_TAB, columnsOf, widthOf
} from './tables.js';

export { TABLES, TABLE_NAMES, LOCK_TAB, columnsOf, widthOf } from './tables.js';
export { isActive, liveSubscription, livePost } from './tables.js';

/**
 * THE APPS SCRIPT BACKEND
 *
 * Same interface as store-sheets.js and store-pg.js, so no route knows the
 * difference. What changes is that everything here is a native call rather than
 * an HTTP request, and that has three consequences worth knowing:
 *
 *   1. NO QUOTA IN THE SAME SENSE. SpreadsheetApp is not the Sheets REST API, so
 *      the ~300-reads-a-minute ceiling does not apply. Apps Script has its own
 *      limits — a 6-minute execution cap and a daily runtime budget — but a feed
 *      read no longer competes with everyone else's for a per-minute allowance.
 *
 *   2. A REAL LOCK. LockService gives genuine mutual exclusion, so the
 *      claim-pause-read-back mutex the REST backend has to emulate is
 *      unnecessary here. This is the one respect in which the Apps Script
 *      version is better than the Netlify+Sheets version.
 *
 *   3. SYNCHRONOUS IO. Reads and writes block. The interface stays async so the
 *      shared route code is unchanged; the promises simply resolve immediately.
 */

function spreadsheet() {
  // Container-bound scripts get the active spreadsheet; a standalone script
  // needs the id in Script Properties.
  const id = typeof PropertiesService !== 'undefined'
    ? PropertiesService.getScriptProperties().getProperty('GOOGLE_SHEET_ID')
    : '';

  if (id) return SpreadsheetApp.openById(id);

  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error(
      'No spreadsheet. Either bind this script to a spreadsheet (Extensions → '
      + 'Apps Script from inside the sheet) or set GOOGLE_SHEET_ID in '
      + 'Project Settings → Script properties.'
    );
  }
  return active;
}

function sheetFor(name) {
  const sheet = spreadsheet().getSheetByName(name);
  if (!sheet) throw new Error(`No tab named "${name}". Run setUpSpreadsheet() once.`);
  return sheet;
}

// ------------------------------------------------------------ coercion
function decode(value, type) {
  if (value === undefined || value === null || value === '') {
    return type === T.INT || type === T.NUM ? 0 : (type === T.BOOL ? false : '');
  }
  switch (type) {
    case T.INT: return Math.trunc(Number(value)) || 0;
    case T.NUM: return Number(value) || 0;
    case T.BOOL: {
      if (value === true) return true;
      const s = String(value).trim().toUpperCase();
      return s === 'TRUE' || s === 'YES' || s === '1';
    }
    case T.TS: {
      // A cell the operator retyped by hand can come back as a Date object.
      if (value instanceof Date) return value.toISOString();
      return String(value);
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
    // A leading ' stops Sheets treating a value as a formula or a date.
    default: {
      const text = String(value);
      return /^[=+\-@]/.test(text) ? `'${text}` : text;
    }
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

  async flush() {
    if (!this.dirty) return;

    // Updates before deletes, for the same reason as the REST backend: a delete
    // shifts every row beneath it, so positions read earlier stop being true.
    if (this.pendingUpdates.size) {
      for (const row of this.pendingUpdates) {
        if (!row._row || row._row < 2) continue;
        const values = objectToRow(row._table, row);
        sheetFor(row._table)
          .getRange(row._row, 1, 1, values.length)
          .setValues([values]);
      }
      this.pendingUpdates.clear();
    }

    if (this.pendingDeletes.length) {
      const byTable = groupBy(this.pendingDeletes, (row) => row._table);
      for (const [table, rows] of Object.entries(byTable)) {
        const sheet = sheetFor(table);
        // Highest row first, so the remaining indices stay valid.
        [...new Set(rows.map((row) => row._row))]
          .filter((n) => n > 1)
          .sort((a, b) => b - a)
          .forEach((rowNumber) => sheet.deleteRow(rowNumber));
      }
      this.pendingDeletes = [];
    }

    if (this.pendingAppends.length) {
      const byTable = groupBy(this.pendingAppends, (row) => row._table);
      for (const [table, rows] of Object.entries(byTable)) {
        const sheet = sheetFor(table);
        const values = rows.map((row) => objectToRow(table, row));
        const firstRow = sheet.getLastRow() + 1;

        // One setValues for the whole batch rather than appendRow per record.
        sheet.getRange(firstRow, 1, values.length, widthOf(table)).setValues(values);
        rows.forEach((row, index) => {
          row._row = firstRow + index;
          delete row._new;
        });
      }
      this.pendingAppends = [];
    }

    SpreadsheetApp.flush();
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

export async function openStore(names) {
  const wanted = [...new Set(names)];
  for (const name of wanted) {
    if (!TABLES[name]) throw new Error(`Unknown table "${name}".`);
  }

  const tables = {};
  for (const name of wanted) {
    const sheet = sheetFor(name);
    const lastRow = sheet.getLastRow();
    const rows = [];

    if (lastRow > 1) {
      const grid = sheet.getRange(2, 1, lastRow - 1, widthOf(name)).getValues();
      for (let i = 0; i < grid.length; i += 1) {
        const cells = grid[i];
        // A wholly blank line is a gap left by a hand edit, not a record.
        if (cells.every((cell) => cell === '' || cell === null || cell === undefined)) continue;
        rows.push(rowToObject(name, cells, i + 2));
      }
    }
    tables[name] = new Table(null, name, rows);
  }

  const store = new Store(tables);
  for (const table of Object.values(tables)) table.store = store;
  return store;
}

// ----------------------------------------------------------------- lock
/**
 * LockService — a real mutex, which is the one thing this platform does better
 * than the Netlify+Sheets deployment. No claim-and-read-back dance, and the lock
 * releases when the script ends even if it throws.
 */
export async function withLock(fn, { timeoutMs = 20_000 } = {}) {
  const lock = LockService.getScriptLock();
  const deadline = Date.now() + timeoutMs;

  /**
   * tryLock is asked for a short slice at a time rather than the whole timeout.
   *
   * Waiting the full timeout inside one tryLock call would be simpler, but it
   * gives up the chance to notice the holder finishing early, and it makes the
   * behaviour untestable — a mocked LockService cannot block. Retrying in slices
   * with a sleep between them behaves the same way in production and can
   * actually be exercised by a test.
   */
  let held = false;
  while (Date.now() < deadline) {
    if (lock.tryLock(Math.min(2000, Math.max(200, deadline - Date.now())))) { held = true; break; }
    await sleep(150);
  }

  if (!held) throw new Error('The spreadsheet is busy. Please try again in a moment.');

  try {
    return await fn();
  } finally {
    lock.releaseLock();
  }
}

export async function transact(names, fn) {
  return withLock(async () => {
    const store = await openStore(names);
    const result = await fn(store);
    await store.flush();
    return result;
  });
}

/** Creates every tab with its header row. Idempotent; run once after install. */
export function createSpreadsheetTabs() {
  const book = spreadsheet();
  const made = [];

  for (const table of TABLE_NAMES) {
    let sheet = book.getSheetByName(table);
    if (!sheet) { sheet = book.insertSheet(table); made.push(table); }

    const headers = columnsOf(table);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  // Present for parity with the REST backend, which needs it as a mutex cell.
  // LockService covers that here, so the tab is unused — created anyway so one
  // spreadsheet can serve both deployments.
  if (!book.getSheetByName(LOCK_TAB)) {
    book.insertSheet(LOCK_TAB).getRange(1, 1).setValue('lock');
  }

  return `Ready. ${TABLE_NAMES.length} tables (${made.length} created).`;
}

export { newId };
