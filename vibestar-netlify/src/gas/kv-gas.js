/* eslint-disable no-undef */
/**
 * SESSIONS AND LOGIN THROTTLING, APPS SCRIPT EDITION.
 *
 * Same interface as src/lib/kv.js, which uses Netlify Blobs.
 *
 * Sessions live in a spreadsheet tab here, and that is a deliberate reversal of
 * the Netlify decision. There, sessions were kept OUT of the spreadsheet because
 * resolving a token meant an HTTP round trip against a 300-reads-per-minute
 * quota. SpreadsheetApp has no such quota and the read is a native call, so the
 * tab is both cheap and durable — better than CacheService, which expires after
 * six hours and would log everybody out twice a day.
 *
 * Throttle counters DO go in CacheService: they are worthless after fifteen
 * minutes by definition, and writing a row per failed login attempt would grow
 * the spreadsheet for no reason.
 */

const SESSION_TAB = 'Sessions';
const SESSION_COLUMNS = ['token', 'user_id', 'created_at', 'expires_at'];

function book() {
  const id = PropertiesService.getScriptProperties().getProperty('GOOGLE_SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function sessionSheet() {
  const spreadsheet = book();
  let sheet = spreadsheet.getSheetByName(SESSION_TAB);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SESSION_TAB);
    sheet.getRange(1, 1, 1, SESSION_COLUMNS.length)
      .setValues([SESSION_COLUMNS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readSessions() {
  const sheet = sessionSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet.getRange(2, 1, lastRow - 1, SESSION_COLUMNS.length).getValues()
    .map((cells, index) => ({
      row: index + 2,
      token: String(cells[0] || ''),
      userId: String(cells[1] || ''),
      expiresAt: cells[3] instanceof Date ? cells[3].getTime() : Date.parse(String(cells[3] || '')) || 0
    }))
    .filter((entry) => entry.token);
}

export async function putSession(token, userId, expiresAtMs) {
  const sheet = sessionSheet();
  sheet.appendRow([
    token, userId, new Date().toISOString(), new Date(expiresAtMs).toISOString()
  ]);
}

export async function readSession(token) {
  if (!token) return '';

  const match = readSessions().find((entry) => entry.token === String(token));
  if (!match) return '';

  if (!match.expiresAt || match.expiresAt <= Date.now()) {
    // Cleaned up as encountered, so dead rows do not accumulate unboundedly
    // while waiting for the nightly sweep.
    try { sessionSheet().deleteRow(match.row); } catch (err) { /* already gone */ }
    return '';
  }
  return match.userId;
}

export async function deleteSession(token) {
  if (!token) return;
  const match = readSessions().find((entry) => entry.token === String(token));
  if (match) sessionSheet().deleteRow(match.row);
}

/** Every session for one user, which is what makes a suspension bite at once. */
export async function deleteUserSessions(userId) {
  const doomed = readSessions().filter((entry) => entry.userId === String(userId));
  const sheet = sessionSheet();

  // Highest row first: deleting shifts everything beneath up.
  doomed.map((entry) => entry.row).sort((a, b) => b - a)
    .forEach((row) => sheet.deleteRow(row));

  return doomed.length;
}

/** Drops expired rows. Called by the nightly maintenance trigger. */
export function pruneSessions() {
  const now = Date.now();
  const expired = readSessions().filter((entry) => !entry.expiresAt || entry.expiresAt <= now);
  const sheet = sessionSheet();

  expired.map((entry) => entry.row).sort((a, b) => b - a)
    .forEach((row) => sheet.deleteRow(row));

  return expired.length;
}

// ------------------------------------------------------------- throttling
const throttleKey = (email) => `login:${String(email).toLowerCase()}`;

export async function readThrottle(email) {
  try {
    const raw = CacheService.getScriptCache().get(throttleKey(email));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

export async function writeThrottle(email, record) {
  try {
    // 15 minutes, matching LOGIN_WINDOW_MS — after which the record is
    // meaningless and the cache dropping it is the correct outcome.
    CacheService.getScriptCache().put(throttleKey(email), JSON.stringify(record), 900);
  } catch (err) { /* throttling is a mitigation, never a hard dependency */ }
}

export async function clearThrottle(email) {
  try {
    CacheService.getScriptCache().remove(throttleKey(email));
  } catch (err) { /* already gone */ }
}
