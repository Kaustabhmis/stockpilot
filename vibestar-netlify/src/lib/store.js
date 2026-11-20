/**
 * BACKEND SELECTION
 *
 * VibeStar runs on either database, chosen by environment variable:
 *
 *   DATABASE_URL set          → Supabase / Postgres
 *   GOOGLE_SHEET_ID set       → Google Sheets
 *
 * Every route imports from this file and none of them knows the difference. The
 * two backends implement the same interface — openStore, transact, withLock, and
 * the same Table methods — which is what makes switching a matter of setting an
 * environment variable rather than a rewrite.
 *
 * Postgres wins if both are set, and says so, because someone who has configured
 * a real database almost certainly means to use it. Choosing silently would be
 * the wrong call: writing to the wrong database is not a thing to discover from
 * behaviour.
 */
import { env } from './config.js';

/**
 * Running inside Apps Script? Then the spreadsheet is reachable natively through
 * SpreadsheetApp, which is both faster than the REST API and free of its
 * per-minute quota — and LockService gives a real mutex. So that wins outright,
 * with no configuration.
 *
 * The generated Code.gs does not include this file at all; the check is what
 * lets the test suite run the same route spec against the Apps Script store
 * under a mocked Utilities.
 */
const isAppsScript = typeof globalThis.SpreadsheetApp !== 'undefined';

const hasPostgres = Boolean(env.databaseUrl());
const hasSheets = Boolean(env.spreadsheetId());

if (!isAppsScript && !hasPostgres && !hasSheets) {
  throw new Error(
    'No database configured. Set DATABASE_URL for Supabase/Postgres, '
    + 'or GOOGLE_SHEET_ID with GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY for Google Sheets. '
    + 'See README.md.'
  );
}

if (!isAppsScript && hasPostgres && hasSheets) {
  console.warn(
    '[vibestar] Both DATABASE_URL and GOOGLE_SHEET_ID are set. Using Postgres. '
    + 'Unset DATABASE_URL to go back to Google Sheets.'
  );
}

export const BACKEND = isAppsScript ? 'APPS_SCRIPT' : (hasPostgres ? 'POSTGRES' : 'SHEETS');

const backend = isAppsScript
  ? await import('./store-gas.js')
  : (hasPostgres ? await import('./store-pg.js') : await import('./store-sheets.js'));

export const {
  openStore, transact, withLock,
  TABLES, TABLE_NAMES, columnsOf, widthOf, LOCK_TAB,
  isActive, liveSubscription, livePost, newId
} = backend;

/** Postgres only; a no-op on Sheets. Used by scripts so the process can exit. */
export const closePool = backend.closePool || (async () => {});
