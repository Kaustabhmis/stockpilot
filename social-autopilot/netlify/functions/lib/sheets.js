/**
 * Google Sheets as the database: one spreadsheet, one tab per table, row 1 = headers.
 * Columns are matched by header name, so their order in the Sheet does not matter.
 * Talks to the REST API with a service-account JWT (no client library needed).
 * Docs: https://developers.google.com/workspace/sheets/api/reference/rest
 */
import crypto from 'node:crypto';
import { SHEET_SCHEMA } from './config.js';
import { HttpError } from './http.js';

const SHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

/** Columns stored as JSON text, with their fallback when empty. */
const JSON_COLUMNS = { media_urls: [], video_plan: null };
const BOOLEAN_COLUMNS = new Set(['auto_approve', 'active']);

/** Access token shared by warm invocations; refreshed a minute before it expires. */
let cachedToken = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {number} index 0-based column index → A, B, … Z, AA … */
function columnLetter(index) {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * Converts a JS value to the text stored in a cell.
 * Arrays and objects become JSON, booleans become TRUE/FALSE, null/undefined become ''.
 * @param {unknown} value
 * @returns {string}
 */
export function serialize(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Turns a raw sheet row into a record: parses JSON and boolean columns, drops the `_row` marker.
 * @param {Record<string, any>} row
 * @returns {Record<string, any>}
 */
export function toRecord(row) {
  const { _row, ...cells } = row;
  const record = {};
  for (const [key, raw] of Object.entries(cells)) {
    if (Object.hasOwn(JSON_COLUMNS, key)) {
      try {
        record[key] = raw ? JSON.parse(raw) : JSON_COLUMNS[key];
      } catch {
        record[key] = JSON_COLUMNS[key];
      }
    } else if (BOOLEAN_COLUMNS.has(key)) {
      record[key] = raw === 'TRUE';
    } else {
      record[key] = raw;
    }
  }
  return record;
}

/** @returns {string} the private key with escaped newlines restored */
function privateKeyFromEnv() {
  return (process.env.GOOGLE_PRIVATE_KEY || '').replace(/^"|"$/g, '').replace(/\\n/g, '\n');
}

/**
 * Builds the RS256-signed JWT assertion that Google exchanges for an access token.
 * @param {string} email
 * @param {string} privateKey
 * @param {number} nowSec
 */
function signJwt(email, privateKey, nowSec) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 }),
  ).toString('base64url');
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(privateKey, 'base64url');
  return `${header}.${claims}.${signature}`;
}

/** @returns {Promise<string>} a valid access token for the service account */
async function getAccessToken() {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > nowSec) return cachedToken.value;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = privateKeyFromEnv();
  if (!email || !privateKey.includes('BEGIN')) throw new HttpError(500, 'Google service account is not configured');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signJwt(email, privateKey, nowSec),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Google sign-in failed: ${data.error_description || res.status}`);
  cachedToken = { value: data.access_token, expiresAt: nowSec + data.expires_in };
  return cachedToken.value;
}

/**
 * Maps a Sheets API failure to a message the dashboard can show.
 * @param {number} status
 * @param {any} data
 */
function sheetsError(status, data) {
  if (status === 403) {
    return new HttpError(502, 'Google Sheets denied access. Share the Sheet with the service account email as Editor.');
  }
  if (status === 404) return new HttpError(502, 'Google Sheet not found. Check SHEET_ID.');
  return new HttpError(502, `Google Sheets error (${status}): ${data?.error?.message || 'unknown error'}`);
}

/**
 * One Sheets REST call. Retries once after a 429 (rate limit).
 * @param {string} path appended to `/{SHEET_ID}`, e.g. `/values:batchGet?…` or `:batchUpdate`
 * @param {{ method?: string, body?: unknown }} [options]
 */
async function sheetsRequest(path, { method = 'GET', body } = {}) {
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) throw new HttpError(500, 'SHEET_ID is not configured');
  for (let attempt = 1; ; attempt++) {
    const token = await getAccessToken();
    const res = await fetch(`${SHEETS_URL}/${sheetId}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt === 1) {
      await sleep(1500);
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw sheetsError(res.status, data);
    return data;
  }
}

/**
 * Parses a tab's values (row 1 = headers) into objects keyed by header name.
 * @param {string[][]} values
 * @param {string} name
 */
function parseTab(values, name) {
  const headers = (values[0] || []).map((h) => String(h).trim());
  if (!headers.length) throw new HttpError(500, `Tab "${name}" has no header row. Run npm run setup-sheet.`);
  const rows = values
    .slice(1)
    .map((cells, index) => {
      const row = { _row: index + 2 };
      headers.forEach((header, i) => {
        row[header] = cells[i] ?? '';
      });
      return row;
    })
    .filter((row) => headers.some((header) => row[header] !== ''));
  return { headers, rows };
}

/**
 * A per-request Sheets client. Each function invocation creates its own, so cached
 * tab data never goes stale across requests.
 */
export function createSheet() {
  /** @type {Map<string, { headers: string[], rows: Record<string, any>[] }>} */
  const tabs = new Map();
  /** @type {Map<string, number> | null} */
  let sheetIds = null;

  /**
   * Loads several tabs in one batchGet call (skips tabs already loaded).
   * @param {string[]} names
   */
  async function preload(names) {
    const missing = [...new Set(names)].filter((name) => !tabs.has(name));
    if (!missing.length) return;
    const query = missing.map((name) => `ranges=${encodeURIComponent(name)}`).join('&');
    const data = await sheetsRequest(`/values:batchGet?${query}&valueRenderOption=FORMATTED_VALUE`);
    data.valueRanges.forEach((range, i) => tabs.set(missing[i], parseTab(range.values || [], missing[i])));
  }

  /** @param {string} name */
  async function tab(name) {
    await preload([name]);
    return tabs.get(name);
  }

  /** @param {string} name */
  async function getRows(name) {
    return (await tab(name)).rows;
  }

  /**
   * @param {string} name
   * @param {string} id
   */
  async function findById(name, id) {
    return (await getRows(name)).find((row) => row.id === id) || null;
  }

  /**
   * Appends several records in one call.
   * @param {string} name
   * @param {Record<string, unknown>[]} records
   */
  async function appendRows(name, records) {
    if (!records.length) return records;
    const { headers } = await tab(name);
    const values = records.map((record) => headers.map((header) => serialize(record[header])));
    await sheetsRequest(
      `/values/${encodeURIComponent(name)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: { values } },
    );
    tabs.delete(name);
    return records;
  }

  /**
   * @param {string} name
   * @param {Record<string, unknown>} record
   */
  async function appendRow(name, record) {
    return (await appendRows(name, [record]))[0];
  }

  /**
   * Updates several rows with one values:batchUpdate call. Only the given fields change.
   * Returns the updated raw rows.
   * @param {string} name
   * @param {{ id: string, patch: Record<string, unknown> }[]} updates
   */
  async function updateRows(name, updates) {
    const { headers, rows } = await tab(name);
    const data = [];
    const updated = [];
    for (const { id, patch } of updates) {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) continue;
      const cells = headers.map((header) => (header in patch ? serialize(patch[header]) : (row[header] ?? '')));
      data.push({
        range: `${name}!A${row._row}:${columnLetter(headers.length - 1)}${row._row}`,
        values: [cells],
      });
      headers.forEach((header, i) => {
        if (header in patch) row[header] = cells[i];
      });
      updated.push(row);
    }
    if (!data.length) return [];
    await sheetsRequest('/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'RAW', data } });
    return updated;
  }

  /** @param {string} name */
  async function getSheetId(name) {
    if (!sheetIds) {
      const meta = await sheetsRequest('?fields=sheets.properties(sheetId,title)');
      sheetIds = new Map(meta.sheets.map((sheet) => [sheet.properties.title, sheet.properties.sheetId]));
    }
    return sheetIds.get(name);
  }

  /**
   * Deletes rows by id in one batchUpdate. Bottom rows go first so indexes stay valid.
   * @param {string} name
   * @param {string[]} ids
   * @returns {Promise<number>} number of rows deleted
   */
  async function deleteRows(name, ids) {
    const rows = (await getRows(name)).filter((row) => ids.includes(row.id)).sort((a, b) => b._row - a._row);
    if (!rows.length) return 0;
    const sheetId = await getSheetId(name);
    await sheetsRequest(':batchUpdate', {
      method: 'POST',
      body: {
        requests: rows.map((row) => ({
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: row._row - 1, endIndex: row._row },
          },
        })),
      },
    });
    tabs.delete(name);
    return rows.length;
  }

  return { preload, getRows, findById, appendRow, appendRows, updateRows, deleteRows };
}

/**
 * Creates any missing tabs and writes header rows into empty row-1 cells.
 * Safe to run more than once: existing data is never overwritten.
 * @returns {Promise<string[]>} names of tabs that were created
 */
export async function ensureSchema() {
  const meta = await sheetsRequest('?fields=sheets.properties.title');
  const existing = new Set(meta.sheets.map((sheet) => sheet.properties.title));
  const names = Object.keys(SHEET_SCHEMA);

  const created = names.filter((name) => !existing.has(name));
  if (created.length) {
    await sheetsRequest(':batchUpdate', {
      method: 'POST',
      body: { requests: created.map((title) => ({ addSheet: { properties: { title } } })) },
    });
  }

  const firstRows = await sheetsRequest(
    `/values:batchGet?${names.map((name) => `ranges=${encodeURIComponent(`${name}!A1:ZZ1`)}`).join('&')}`,
  );
  const headerWrites = names
    .map((name, i) => ({ name, empty: !firstRows.valueRanges[i].values?.length }))
    .filter((entry) => entry.empty)
    .map(({ name }) => ({ range: `${name}!A1`, values: [SHEET_SCHEMA[name]] }));
  if (headerWrites.length) {
    await sheetsRequest('/values:batchUpdate', {
      method: 'POST',
      body: { valueInputOption: 'RAW', data: headerWrites },
    });
  }
  return created;
}
