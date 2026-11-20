import crypto from 'node:crypto';
import { env } from './config.js';

/**
 * GOOGLE SHEETS TRANSPORT
 *
 * Talks to the Sheets REST API v4 with a service-account JWT. No googleapis
 * dependency: the whole client is one token mint plus four calls, and pulling a
 * 50MB SDK into a Lambda for that would cost more cold-start than it saves.
 *
 * The quota is the thing to design around. Sheets allows roughly 300 reads and
 * 60 writes per minute per project. Every call here is therefore batched:
 * a request reads all the tabs it needs in ONE batchGet, and writes as many
 * ranges as it can in ONE batchUpdate.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// ------------------------------------------------------------------ auth
let cachedToken = null;   // { value, expiresAt }

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The private key arrives from an environment variable, where newlines cannot
 * survive literally — Netlify stores it with \n as two characters.
 */
function privateKey() {
  const raw = env.googlePrivateKey();
  if (!raw) throw new Error('GOOGLE_PRIVATE_KEY is not set.');
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const email = env.googleClientEmail();
  if (!email) throw new Error('GOOGLE_CLIENT_EMAIL is not set.');

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600
  }));

  const signature = base64url(
    crypto.createSign('RSA-SHA256').update(`${header}.${claim}`).sign(privateKey())
  );

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${signature}`
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(`Google rejected the service account: ${data.error_description || data.error || response.status}`);
  }

  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

// ----------------------------------------------------------------- calls
async function api(path, { method = 'GET', body = null, query: params = {} } = {}) {
  const id = env.spreadsheetId();
  if (!id) throw new Error('GOOGLE_SHEET_ID is not set.');

  const url = new URL(`${SHEETS_API}/${encodeURIComponent(id)}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
    else if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `HTTP ${response.status}`;
    const err = new Error(`Sheets API: ${message}`);
    err.status = response.status;
    // 429 is the quota ceiling; the caller retries this one rather than failing.
    err.rateLimited = response.status === 429 || /quota/i.test(message);
    throw err;
  }
  return data;
}

/** Retries only what is worth retrying: quota pushback and transient 5xx. */
async function withRetry(fn, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const retryable = err.rateLimited || (err.status >= 500 && err.status < 600);
      if (!retryable || attempt === attempts - 1) throw err;
      // 400ms, 800ms, 1600ms — enough to cross a quota window boundary.
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  throw lastError;
}

// ------------------------------------------------------------- addressing
export function columnLetter(index) {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Tab names are quoted so a name with a space cannot break the A1 range. */
function tabRange(tab, a1) {
  return `'${String(tab).replace(/'/g, "''")}'!${a1}`;
}

// ------------------------------------------------------------------ read
/**
 * Reads several tabs in one HTTP call.
 * Returns { tabName: [[cell, ...], ...] } including the header row.
 */
export async function batchGet(tabs, widths) {
  const ranges = tabs.map((tab, i) => tabRange(tab, `A1:${columnLetter(widths[i] - 1)}`));

  const data = await withRetry(() => api('/values:batchGet', {
    query: {
      ranges,
      // Numbers come back as numbers and our ISO strings stay strings, instead
      // of everything arriving pre-formatted for display.
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    }
  }));

  const out = {};
  (data.valueRanges || []).forEach((range, index) => {
    out[tabs[index]] = range.values || [];
  });
  return out;
}

// ----------------------------------------------------------------- write
/** Appends rows to a tab. Returns the 1-based sheet row of the first one. */
export async function append(tab, rows, width) {
  if (!rows.length) return 0;

  const data = await withRetry(() => api(
    `/values/${encodeURIComponent(tabRange(tab, `A1:${columnLetter(width - 1)}`))}:append`,
    {
      method: 'POST',
      // RAW matters: USER_ENTERED would reinterpret an ISO timestamp as a Sheets
      // date serial and a leading "+" or "=" as a formula.
      query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
      body: { values: rows }
    }
  ));

  const updated = data?.updates?.updatedRange || '';
  const match = /![A-Z]+(\d+)/.exec(updated);
  return match ? Number(match[1]) : 0;
}

/** Writes several whole rows in one call. Each entry is { tab, row, values }. */
export async function batchUpdate(writes, width) {
  if (!writes.length) return;

  await withRetry(() => api('/values:batchUpdate', {
    method: 'POST',
    body: {
      valueInputOption: 'RAW',
      data: writes.map(({ tab, row, values }) => ({
        range: tabRange(tab, `A${row}:${columnLetter((width[tab] || values.length) - 1)}${row}`),
        values: [values]
      }))
    }
  }));
}

/** Writes a single cell. Used by the lock, which must not batch. */
export async function setCell(tab, a1, value) {
  await withRetry(() => api(`/values/${encodeURIComponent(tabRange(tab, a1))}`, {
    method: 'PUT',
    query: { valueInputOption: 'RAW' },
    body: { values: [[value]] }
  }));
}

export async function getCell(tab, a1) {
  const data = await withRetry(() => api(`/values/${encodeURIComponent(tabRange(tab, a1))}`, {
    query: { valueRenderOption: 'UNFORMATTED_VALUE' }
  }));
  return data?.values?.[0]?.[0] ?? '';
}

// ---------------------------------------------------------------- delete
let sheetIdCache = null;

/** Tab name → numeric sheetId, which is what deleteDimension needs. */
export async function sheetIds() {
  if (sheetIdCache) return sheetIdCache;

  const data = await withRetry(() => api('', { query: { fields: 'sheets.properties(sheetId,title)' } }));
  sheetIdCache = {};
  for (const sheet of data.sheets || []) {
    sheetIdCache[sheet.properties.title] = sheet.properties.sheetId;
  }
  return sheetIdCache;
}

/**
 * Deletes rows by 1-based sheet row number.
 *
 * Descending order is not a nicety: deleting row 5 shifts row 9 up to row 8, so
 * ascending deletion would remove the wrong records. Highest first means every
 * remaining index is still valid when its turn comes.
 */
export async function deleteRows(tab, rowNumbers) {
  const rows = [...new Set(rowNumbers.filter((n) => n > 1))].sort((a, b) => b - a);
  if (!rows.length) return;

  const ids = await sheetIds();
  const sheetId = ids[tab];
  if (sheetId === undefined) throw new Error(`No tab named "${tab}" in the spreadsheet.`);

  await withRetry(() => api(':batchUpdate', {
    method: 'POST',
    body: {
      requests: rows.map((row) => ({
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row }
        }
      }))
    }
  }));
}

// -------------------------------------------------------------- creation
export async function addTab(title, headers) {
  const ids = await sheetIds();
  if (ids[title] === undefined) {
    await withRetry(() => api(':batchUpdate', {
      method: 'POST',
      body: { requests: [{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }] }
    }));
    sheetIdCache = null;
  }
  await setRow(title, 1, headers);
}

export async function setRow(tab, row, values) {
  await withRetry(() => api(
    `/values/${encodeURIComponent(tabRange(tab, `A${row}:${columnLetter(values.length - 1)}${row}`))}`,
    { method: 'PUT', query: { valueInputOption: 'RAW' }, body: { values: [values] } }
  ));
}

export async function clearTab(tab, width) {
  await withRetry(() => api(
    `/values/${encodeURIComponent(tabRange(tab, `A2:${columnLetter(width - 1)}`))}:clear`,
    { method: 'POST', body: {} }
  ));
}

/** Cheap connectivity probe used by the setup script and the health endpoint. */
export async function spreadsheetTitle() {
  const data = await withRetry(() => api('', { query: { fields: 'properties.title' } }));
  return data?.properties?.title || '';
}
