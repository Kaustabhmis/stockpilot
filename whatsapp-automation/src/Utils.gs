/**
 * Utils.gs
 * Sheet access, ID generation, phone normalisation, templating, dates and logging.
 */

/* ============================== SHEET HELPERS ============================== */

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(name) {
  const sheet = ss_().getSheetByName(name);
  if (!sheet) throw new Error('Sheet "' + name + '" not found. Run "Setup System" first.');
  return sheet;
}

/**
 * Reads a sheet into objects keyed by header. Each row object carries `_row`
 * (1-based sheet row number).
 */
function readTable_(name) {
  const sheet = getSheet_(name);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return { sheet: sheet, headers: [], rows: [], col: {} };
  const values = sheet.getRange(1, 1, Math.max(lastRow, 1), lastCol).getValues();
  const headers = values[0].map(h => String(h).trim());
  const col = {};
  headers.forEach((h, i) => { if (h) col[h] = i + 1; });
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row.every(v => v === '' || v === null)) continue;
    const obj = { _row: r + 1 };
    headers.forEach((h, i) => { if (h) obj[h] = row[i]; });
    rows.push(obj);
  }
  return { sheet: sheet, headers: headers, rows: rows, col: col };
}

/** Converts an object into a row array following the sheet's current header order. */
function objectToRow_(headers, obj) {
  return headers.map(h => (obj[h] === undefined || obj[h] === null ? '' : obj[h]));
}

/** Appends one object row. Returns the row number. */
function appendObject_(name, obj) {
  return appendObjects_(name, [obj]);
}

/**
 * Appends many object rows in a single write. Returns the first row number written.
 * A short document lock serialises appends from concurrent executions (webhook,
 * scheduler, form submit) so two writers never pick the same empty row.
 */
function appendObjects_(name, objs) {
  if (!objs.length) return 0;
  const sheet = getSheet_(name);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const data = objs.map(o => objectToRow_(headers, o));
  const lock = LockService.getDocumentLock() || LockService.getUserLock();
  lock.waitLock(30000);
  try {
    const start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, data.length, headers.length).setValues(data);
    SpreadsheetApp.flush();
    return start;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Updates only the given fields of a row (by header name).
 * `table` is the readTable_ result for the same sheet (used for column lookup).
 */
function updateFields_(table, rowNumber, fields) {
  Object.keys(fields).forEach(key => {
    const c = table.col[key];
    if (!c) throw new Error('Column "' + key + '" not found in ' + table.sheet.getName());
    table.sheet.getRange(rowNumber, c).setValue(fields[key]);
  });
}

/** Writes a whole row object back (one API call). */
function writeRowObject_(table, rowObj) {
  table.sheet.getRange(rowObj._row, 1, 1, table.headers.length).setValues([objectToRow_(table.headers, rowObj)]);
}

function findRow_(table, header, value) {
  const needle = String(value).trim();
  return table.rows.find(r => String(r[header]).trim() === needle) || null;
}

/* ============================== IDS ============================== */

/**
 * Generates sequential IDs like CLI-2026-0001 / CMP-2026-0001 / QUE-2026-000001.
 * Counters live in Script Properties and are seeded from the sheet if missing, so
 * IDs stay unique even if properties are reset.
 */
function nextIds_(prefix, width, count, sheetName, idHeader) {
  count = count || 1;
  const lock = LockService.getDocumentLock() || LockService.getUserLock();
  lock.waitLock(30000);
  try {
    const year = Utilities.formatDate(new Date(), getConfig_().timezone, 'yyyy');
    const key = 'SEQ_' + prefix + '_' + year;
    const props = PropertiesService.getScriptProperties();
    let current = Number(props.getProperty(key));
    if (!isFinite(current) || !props.getProperty(key)) current = maxExistingSeq_(prefix, year, sheetName, idHeader);
    const ids = [];
    for (let i = 1; i <= count; i++) ids.push(prefix + '-' + year + '-' + String(current + i).padStart(width, '0'));
    props.setProperty(key, String(current + count));
    return ids;
  } finally {
    lock.releaseLock();
  }
}

function maxExistingSeq_(prefix, year, sheetName, idHeader) {
  if (!sheetName) return 0;
  try {
    const table = readTable_(sheetName);
    const re = new RegExp('^' + prefix + '-' + year + '-(\\d+)$');
    return table.rows.reduce((max, r) => {
      const m = String(r[idHeader] || '').match(re);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
  } catch (err) {
    return 0;
  }
}

function newClientId_() { return nextIds_('CLI', 4, 1, SHEETS.CLIENTS, 'Client ID')[0]; }
function newCampaignId_() { return nextIds_('CMP', 4, 1, SHEETS.CAMPAIGNS, 'Campaign ID')[0]; }
function newContactIds_(n) { return nextIds_('CON', 5, n, SHEETS.CONTACTS, 'Contact ID'); }
function newQueueIds_(n) { return nextIds_('QUE', 6, n, SHEETS.MESSAGE_QUEUE, 'Queue ID'); }
function newTemplateIds_(n) { return nextIds_('TPL', 3, n, SHEETS.TEMPLATES, 'Template ID'); }

/* ============================== PHONE ============================== */

/**
 * Normalises a phone number to international digits without "+" (Maytapi's to_number format).
 *
 *   9876543210      -> 919876543210   (local number: country code added)
 *   +919876543210   -> 919876543210
 *   919876543210    -> 919876543210   (already international: unchanged, never 9191...)
 *   09876543210     -> 919876543210   (trunk 0 removed)
 *   0091 98765 43210-> 919876543210
 *
 * Returns '' when the number cannot be valid (E.164 allows at most 15 digits).
 */
function normalizePhoneNumber(phone, countryCode) {
  if (phone === null || phone === undefined) return '';
  let raw = String(phone).trim();
  if (!raw) return '';
  // Numbers stored by Sheets in scientific notation, e.g. 9.19876543210E11
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(raw)) raw = Number(raw).toFixed(0);
  raw = raw.replace(/@c\.us$|@s\.whatsapp\.net$/i, '');
  const hasPlus = raw.charAt(0) === '+';
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  const cc = String(countryCode || getConfig_().defaultCountryCode || '').replace(/\D/g, '');

  if (hasPlus) {
    // Explicit international format: trust it.
  } else if (digits.indexOf('00') === 0) {
    digits = digits.substring(2); // international dialling prefix
  } else {
    digits = digits.replace(/^0+/, ''); // national trunk prefix
    // 10 digits or fewer => local number without country code.
    // More than 10 digits => already contains a country code; never prefix again.
    if (digits.length <= 10 && cc) digits = cc + digits;
  }
  if (digits.length < 8 || digits.length > 15) return '';
  return digits;
}

/** Masks a phone for logs: 919876543210 -> 91******3210 */
function maskPhone_(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length <= 6) return d ? '***' + d.slice(-2) : '';
  return d.slice(0, 2) + '*'.repeat(d.length - 6) + d.slice(-4);
}

/* ============================== TEMPLATES ============================== */

/**
 * Replaces {{Variable}} placeholders. Matching is case-insensitive and tolerant of
 * spaces ({{ name }}). Unknown variables are removed (never shown to customers)
 * and never throw.
 */
function renderTemplate(template, contact, campaign) {
  if (template === null || template === undefined) return '';
  contact = contact || {};
  campaign = campaign || {};
  const cfg = getConfig_();
  const vars = {
    name: firstNonEmpty_(contact.Name, contact.name, cfg.defaultContactName),
    phone: firstNonEmpty_(contact.Phone, contact.phone),
    email: firstNonEmpty_(contact.Email, contact.email),
    company: firstNonEmpty_(contact.Company, contact.company),
    clientname: firstNonEmpty_(campaign['Client Name'], campaign.clientName),
    campaignname: firstNonEmpty_(campaign['Campaign Name'], campaign.campaignName),
    storephone: formatDisplayPhone_(firstNonEmpty_(campaign['Store Phone'], campaign.storePhone)),
    website: firstNonEmpty_(campaign['Website URL'], campaign.website),
  };
  return String(template).replace(/\{\{\s*([A-Za-z_][\w ]*?)\s*\}\}/g, (match, key) => {
    const k = key.replace(/[\s_]/g, '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(vars, k)) return String(vars[k] === undefined ? '' : vars[k]);
    console.warn('renderTemplate: unknown variable ' + match + ' removed');
    return '';
  });
}

function firstNonEmpty_() {
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function formatDisplayPhone_(phone) {
  const n = normalizePhoneNumber(phone);
  return n ? '+' + n : String(phone || '');
}

/* ============================== VALIDATION ============================== */

/** Returns a normalised https URL or '' if invalid. Adds https:// when the scheme is missing. */
function normalizeUrl_(url) {
  let u = String(url || '').trim();
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'https://' + u;
  if (!/^https?:\/\/[^\s/?#]+\.[^\s/?#]+([/?#][^\s]*)?$/i.test(u)) return '';
  return u;
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function isYes_(v) {
  return v === true || /^(YES|Y|TRUE)$/i.test(String(v || '').trim());
}

/* ============================== DATES ============================== */

function nowInTz_(fmt) {
  return Utilities.formatDate(new Date(), getConfig_().timezone, fmt || 'yyyy-MM-dd HH:mm:ss');
}

function todayKey_() {
  return nowInTz_('yyyy-MM-dd');
}

function dateKey_(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  return Utilities.formatDate(d, getConfig_().timezone, 'yyyy-MM-dd');
}

/**
 * Parses a Form/Sheet date value into 'yyyy-MM-dd'. Accepts Date objects (sheet
 * cells, read in the spreadsheet timezone), ISO strings and locale strings.
 */
function parseDateValue_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validYmd_(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) {
    // Ambiguous d/m vs m/d: follow the spreadsheet locale (en_US => month first).
    const monthFirst = /^en_US$/i.test(ss_().getSpreadsheetLocale());
    return monthFirst ? validYmd_(+m[3], +m[1], +m[2]) : validYmd_(+m[3], +m[2], +m[1]);
  }
  return '';
}

function validYmd_(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

/** Parses a Form/Sheet time value into 'HH:mm'. */
function parseTimeValue_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, ss_().getSpreadsheetTimeZone(), 'HH:mm');
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/);
  if (!m) return '';
  let h = +m[1];
  const min = +m[2];
  if (m[3]) {
    if (h < 1 || h > 12) return '';
    const pm = /p/i.test(m[3]);
    h = (h % 12) + (pm ? 12 : 0);
  }
  if (h > 23 || min > 59) return '';
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

/** Builds an absolute Date from 'yyyy-MM-dd' + 'HH:mm' interpreted in `tz`. */
function buildDateTime_(dateStr, timeStr, tz) {
  if (!dateStr || !timeStr) return null;
  const noon = new Date(dateStr + 'T12:00:00Z');
  if (isNaN(noon)) return null;
  const z = Utilities.formatDate(noon, tz, 'Z'); // e.g. +0530
  const offset = z.slice(0, 3) + ':' + z.slice(3);
  const d = new Date(dateStr + 'T' + timeStr + ':00' + offset);
  return isNaN(d) ? null : d;
}

function toDate_(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  if (v === '' || v === null || v === undefined) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

/* ============================== LOGGING ============================== */

/**
 * Writes a LOGS row. Phones are masked and secrets redacted.
 * ctx: { clientId, campaignId, contactId, phone, messageId, httpStatus, result, error, details }
 */
function logEvent_(level, action, ctx) {
  ctx = ctx || {};
  const details = ctx.details === undefined ? '' :
    (typeof ctx.details === 'string' ? ctx.details : safeJson_(ctx.details));
  const row = {
    'Timestamp': new Date(),
    'Level': level,
    'Action': action,
    'Client ID': ctx.clientId || '',
    'Campaign ID': ctx.campaignId || '',
    'Contact ID': ctx.contactId || '',
    'Phone': ctx.phone ? maskPhone_(ctx.phone) : '',
    'Message ID': ctx.messageId || '',
    'HTTP Status': ctx.httpStatus === undefined ? '' : ctx.httpStatus,
    'Result': ctx.result || '',
    'Error': truncate_(redactSecrets_(ctx.error || ''), 2000),
    'Details': truncate_(redactSecrets_(details), 5000),
  };
  try {
    appendObject_(SHEETS.LOGS, row);
  } catch (err) {
    console.error('logEvent_ failed: ' + err.message);
  }
  const line = '[' + level + '] ' + action + (row['Campaign ID'] ? ' ' + row['Campaign ID'] : '') + (row.Error ? ' — ' + row.Error : '');
  if (level === LOG_LEVEL.ERROR) console.error(line); else console.log(line);
}

function safeJson_(obj) {
  try { return JSON.stringify(obj); } catch (err) { return String(obj); }
}

function truncate_(s, max) {
  s = String(s === undefined || s === null ? '' : s);
  return s.length > max ? s.substring(0, max - 3) + '...' : s;
}

function randomDelay_(cfg) {
  const ms = cfg.delayMinMs + Math.floor(Math.random() * (cfg.delayMaxMs - cfg.delayMinMs + 1));
  Utilities.sleep(ms);
}

/** Prompt helper for menu actions: uses the selected row of CAMPAIGNS when possible. */
function promptCampaignId_(title) {
  const ui = SpreadsheetApp.getUi();
  let suggestion = '';
  try {
    const sheet = ss_().getActiveSheet();
    if (sheet.getName() === SHEETS.CAMPAIGNS || sheet.getName() === SHEETS.MESSAGE_QUEUE) {
      const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const idx = header.indexOf('Campaign ID');
      const r = sheet.getActiveRange().getRow();
      if (idx >= 0 && r > 1) suggestion = String(sheet.getRange(r, idx + 1).getValue()).trim();
    }
  } catch (err) { /* ignore */ }
  const res = ui.prompt(title, 'Campaign ID' + (suggestion ? ' (leave blank for ' + suggestion + ')' : '') + ':', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return '';
  return res.getResponseText().trim() || suggestion;
}
