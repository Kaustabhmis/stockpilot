/**
 * WhatsApp Campaign Automation — single-file build (GENERATED, do not edit).
 * Source of truth: whatsapp-automation/src/*.gs. Rebuild with tools/build-single-file.js.
 * Paste into one Apps Script file named Code.gs and use src/appsscript.json as the manifest.
 */
/* ============================== Constants.gs ============================== */

/**
 * Constants.gs
 * Sheet names, column schemas, statuses and form field mapping.
 *
 * Nothing in this file is client-specific. Every business detail (name, image,
 * website, phone, CTA, message, audience) arrives through the Google Form.
 */

const SYSTEM_VERSION = '1.0.0';

const SHEETS = {
  SETTINGS: 'SETTINGS',
  FORM_RESPONSES: 'FORM_RESPONSES',
  CLIENTS: 'CLIENTS',
  CONTACTS: 'CONTACTS',
  CAMPAIGNS: 'CAMPAIGNS',
  MESSAGE_QUEUE: 'MESSAGE_QUEUE',
  LOGS: 'LOGS',
  RESPONSES: 'RESPONSES',
  TEMPLATES: 'TEMPLATES',
  DASHBOARD: 'DASHBOARD',
};

const HEADERS = {
  SETTINGS: ['Key', 'Value', 'Description'],
  CLIENTS: ['Client ID', 'Business Name', 'Client Email', 'Business Phone', 'Website', 'Status', 'Created At', 'Updated At', 'Access Code Hash', 'Last Login',
    'Plan', 'Maytapi Phone ID', 'Monthly Quota', 'Valid Until'],
  CONTACTS: [
    'Contact ID', 'Client ID', 'Name', 'Phone', 'Email', 'Company', 'Tags', 'Audience', 'Opt In', 'Status',
    'Last Sent', 'Last Message ID', 'Last Response', 'Created At', 'Updated At', 'Source',
  ],
  CAMPAIGNS: [
    'Campaign ID', 'Client ID', 'Client Name', 'Campaign Name', 'Status', 'Message', 'Image File ID', 'Image URL',
    'Website URL', 'Store Phone', 'CTA Text', 'CTA Type', 'CTA Value', 'Target Audience', 'Send Mode',
    'Schedule Date', 'Schedule Time', 'Timezone', 'Created At', 'Updated At', 'Submitted By', 'Notes',
  ],
  MESSAGE_QUEUE: [
    'Queue ID', 'Campaign ID', 'Client ID', 'Contact ID', 'Phone', 'Name', 'Rendered Message', 'Image File ID',
    'Image URL', 'CTA Type', 'CTA Text', 'CTA Value', 'Status', 'Attempts', 'Scheduled At', 'Started At',
    'Sent At', 'Message ID', 'Error', 'Last Attempt', 'Created At', 'Sender Phone ID',
  ],
  LOGS: [
    'Timestamp', 'Level', 'Action', 'Client ID', 'Campaign ID', 'Contact ID', 'Phone', 'Message ID',
    'HTTP Status', 'Result', 'Error', 'Details',
  ],
  RESPONSES: [
    'Timestamp', 'Client ID', 'Campaign ID', 'Phone', 'Name', 'Message ID', 'Message Type', 'Message Text',
    'Event Type', 'Status', 'Raw Payload', 'Processed',
  ],
  TEMPLATES: [
    'Template ID', 'Template Name', 'Trigger', 'Reply Type', 'Reply Text', 'Image URL', 'Button Text',
    'Button Type', 'Button Value', 'Active', 'Client ID',
  ],
};

const CAMPAIGN_STATUS = {
  DRAFT: 'DRAFT',
  VALIDATING: 'VALIDATING',
  READY: 'READY',
  SCHEDULED: 'SCHEDULED',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  ERROR: 'ERROR',
};

const QUEUE_STATUS = {
  PENDING: 'PENDING',       // waiting for its first send attempt
  PROCESSING: 'PROCESSING', // currently being sent by an execution
  QUEUED: 'QUEUED',         // waiting for a retry (backoff / rate limit)
  SENT: 'SENT',             // accepted by Maytapi
  DELIVERED: 'DELIVERED',   // delivery ack received via webhook
  READ: 'READ',             // read ack received via webhook
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',       // e.g. opted out after queueing
  CANCELLED: 'CANCELLED',
};

/** Progression rank used so a late "delivered" ack never downgrades a "read" row. */
const QUEUE_STATUS_RANK = { SENT: 1, DELIVERED: 2, READ: 3 };

const CTA_TYPES = ['URL', 'PHONE', 'QUICK_REPLY'];

const SEND_MODES = { NOW: 'SEND NOW', SCHEDULE: 'SCHEDULE' };

const LOG_LEVEL = { INFO: 'INFO', SUCCESS: 'SUCCESS', WARNING: 'WARNING', ERROR: 'ERROR' };

/**
 * Google Form question titles. Each key accepts several aliases so the admin can
 * rename questions slightly without breaking the parser.
 */
const FORM_FIELDS = {
  businessName: ['Client / Business Name', 'Business Name', 'Client Name'],
  campaignName: ['Campaign Name'],
  message: ['Campaign Message', 'Message'],
  image: ['Campaign Image', 'Image'],
  website: ['Website / Landing Page URL', 'Website', 'Landing Page URL'],
  storePhone: ['Store / Business Phone Number', 'Business Phone Number', 'Store Phone'],
  ctaText: ['CTA Button Text', 'CTA Text'],
  ctaType: ['CTA Button Type', 'CTA Type'],
  ctaValue: ['CTA Button Value', 'CTA Value'],
  audience: ['Target Audience', 'Audience'],
  date: ['Campaign Date', 'Schedule Date'],
  time: ['Campaign Time', 'Schedule Time'],
  email: ['Client Email', 'Email Address', 'Email'],
  notes: ['Additional Notes', 'Notes'],
  sendMode: ['Send Mode'],
};

/** Personalisation variables supported in campaign messages and reply templates. */
const TEMPLATE_VARIABLES = ['Name', 'Phone', 'Email', 'Company', 'ClientName', 'CampaignName', 'StorePhone', 'Website'];

/** WhatsApp-accepted image MIME types for regular image messages. */
const SUPPORTED_IMAGE_MIME = ['image/jpeg', 'image/png'];

/* ============================== Config.gs ============================== */

/**
 * Config.gs
 * Configuration: Script Properties (secrets) + SETTINGS sheet (operational values).
 *
 * SECRETS LIVE ONLY IN SCRIPT PROPERTIES:
 *   MAYTAPI_PRODUCT_ID, MAYTAPI_PHONE_ID, MAYTAPI_API_TOKEN   (required)
 *   WEBHOOK_SECRET, ADMIN_EMAIL, DEFAULT_COUNTRY_CODE, TIMEZONE, MEDIA_BASE_URL (optional)
 *
 * The API token is never written to a sheet, a log row, console output or an email.
 */

const SECRET_PROPERTY_KEYS = ['MAYTAPI_API_TOKEN', 'WEBHOOK_SECRET'];
const REQUIRED_PROPERTY_KEYS = ['MAYTAPI_PRODUCT_ID', 'MAYTAPI_PHONE_ID', 'MAYTAPI_API_TOKEN'];
const OPTIONAL_PROPERTY_KEYS = ['WEBHOOK_SECRET', 'ADMIN_EMAIL', 'DEFAULT_COUNTRY_CODE', 'TIMEZONE', 'MEDIA_BASE_URL'];

/** Default SETTINGS rows: [Key, Value, Description]. Seeded by setupSystem() when missing. */
const SETTINGS_DEFAULTS = [
  ['DEFAULT_COUNTRY_CODE', '91', 'Country code prefixed to local numbers (no +). Script Property of the same name overrides.'],
  ['TIMEZONE', 'Asia/Kolkata', 'IANA timezone used for scheduling and "today" counts. Script Property of the same name overrides.'],
  ['BATCH_SIZE', '10', 'Maximum messages sent per queue execution.'],
  ['DELAY_MIN_MS', '3000', 'Minimum randomised delay between two sends (ms).'],
  ['DELAY_MAX_MS', '7000', 'Maximum randomised delay between two sends (ms).'],
  ['DAILY_SEND_LIMIT', '100', 'Maximum campaign messages per day across all clients (sending-number protection).'],
  ['MAX_RETRIES', '3', 'Maximum send attempts for transient failures.'],
  ['RETRY_BASE_MINUTES', '5', 'Exponential backoff base: retry after base * 2^(attempt-1) minutes.'],
  ['QUEUE_INTERVAL_MINUTES', '5', 'Scheduler trigger frequency. Allowed: 1, 5, 10, 15, 30.'],
  ['WEBHOOK_URL', '', 'Deployed Web App /exec URL (without ?key=). Filled by "Configure Webhook" if empty.'],
  ['MEDIA_MODE', 'BASE64', 'BASE64 = send Drive image bytes inline (file stays private). URL = send a public HTTPS URL (Image URL column or MEDIA_BASE_URL).'],
  ['IMAGE_CTA_STYLE', 'IMAGE_THEN_BUTTONS', 'IMAGE_THEN_BUTTONS = image message, then text with interactive button. CAPTION_LINK = single image message with the CTA written into the caption.'],
  ['CTA_FALLBACK_TO_TEXT', 'YES', 'If Maytapi rejects the button payload, send the CTA as a text link instead.'],
  ['MAX_IMAGE_MB', '5', 'Largest accepted campaign image (WhatsApp image limit is 5 MB).'],
  ['CTA_TEXT_MAX_LENGTH', '20', 'Maximum CTA button label length (WhatsApp button titles are limited to 20 characters).'],
  ['DEFAULT_CONTACT_NAME', 'Customer', 'Used for {{Name}} when a contact has no name.'],
  ['REQUIRE_ADMIN_APPROVAL', 'NO', 'YES = "Send Now" campaigns wait in READY until the admin clicks Start Campaign.'],
  ['NOTIFY_ADMIN', 'YES', 'Email ADMIN_EMAIL (Script Property) on every campaign submission.'],
  ['AUTO_REPLY_ENABLED', 'YES', 'Answer incoming keywords using the TEMPLATES sheet.'],
  ['OPT_OUT_KEYWORDS', 'STOP,UNSUBSCRIBE,REMOVE,NO', 'Whole-message keywords that unsubscribe the sender (case-insensitive).'],
  ['OPT_OUT_REPLY', 'You have been unsubscribed and will not receive further promotional messages.', 'Confirmation sent after an opt-out. Leave blank to send nothing.'],
  ['CREATE_INBOUND_CONTACTS', 'YES', 'Unknown numbers that message in are added to CONTACTS as leads with Opt In = NO.'],
  ['AUDIENCE_OPTIONS', 'ALL_OPTED_IN,VIP,LEADS,CUSTOMERS', 'Checkbox options used by "Create Campaign Form".'],
  ['SYSTEM_NAME', 'WhatsApp Campaign Automation', 'Signature used in client emails.'],
];

let CONFIG_CACHE_ = null;

/**
 * Returns the merged configuration. Secrets are included only for the API layer;
 * never log or display the returned object.
 */
function getConfig_(forceReload) {
  if (CONFIG_CACHE_ && !forceReload) return CONFIG_CACHE_;
  const props = PropertiesService.getScriptProperties().getProperties();
  const settings = readSettings_();

  const pick = (key, fallback) => {
    if (props[key] !== undefined && String(props[key]).trim() !== '') return String(props[key]).trim();
    if (settings[key] !== undefined && String(settings[key]).trim() !== '') return String(settings[key]).trim();
    return fallback;
  };
  const num = (key, fallback) => {
    const n = Number(pick(key, fallback));
    return isFinite(n) ? n : Number(fallback);
  };
  const yes = (key, fallback) => /^(YES|Y|TRUE|1)$/i.test(pick(key, fallback));

  let ssTz = 'Asia/Kolkata';
  try { ssTz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(); } catch (err) { /* web app w/o active ss */ }

  CONFIG_CACHE_ = {
    // Secrets / identity (Script Properties only — never read from the sheet).
    productId: String(props.MAYTAPI_PRODUCT_ID || '').trim(),
    phoneId: String(props.MAYTAPI_PHONE_ID || '').trim(),
    apiToken: String(props.MAYTAPI_API_TOKEN || '').trim(),
    webhookSecret: String(props.WEBHOOK_SECRET || '').trim(),
    adminEmail: String(props.ADMIN_EMAIL || '').trim(),
    mediaBaseUrl: String(props.MEDIA_BASE_URL || '').trim().replace(/\/+$/, ''),

    defaultCountryCode: pick('DEFAULT_COUNTRY_CODE', '91').replace(/\D/g, ''),
    timezone: pick('TIMEZONE', ssTz),
    batchSize: Math.max(1, num('BATCH_SIZE', 10)),
    delayMinMs: Math.max(0, num('DELAY_MIN_MS', 3000)),
    delayMaxMs: Math.max(0, num('DELAY_MAX_MS', 7000)),
    dailySendLimit: Math.max(0, num('DAILY_SEND_LIMIT', 100)),
    maxRetries: Math.max(1, num('MAX_RETRIES', 3)),
    retryBaseMinutes: Math.max(1, num('RETRY_BASE_MINUTES', 5)),
    queueIntervalMinutes: num('QUEUE_INTERVAL_MINUTES', 5),
    webhookUrl: pick('WEBHOOK_URL', ''),
    mediaMode: pick('MEDIA_MODE', 'BASE64').toUpperCase(),
    imageCtaStyle: pick('IMAGE_CTA_STYLE', 'IMAGE_THEN_BUTTONS').toUpperCase(),
    ctaFallbackToText: yes('CTA_FALLBACK_TO_TEXT', 'YES'),
    maxImageMb: num('MAX_IMAGE_MB', 5),
    ctaTextMaxLength: num('CTA_TEXT_MAX_LENGTH', 20),
    defaultContactName: pick('DEFAULT_CONTACT_NAME', 'Customer'),
    requireAdminApproval: yes('REQUIRE_ADMIN_APPROVAL', 'NO'),
    notifyAdmin: yes('NOTIFY_ADMIN', 'YES'),
    autoReplyEnabled: yes('AUTO_REPLY_ENABLED', 'YES'),
    optOutKeywords: pick('OPT_OUT_KEYWORDS', 'STOP,UNSUBSCRIBE,REMOVE,NO')
      .split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
    optOutReply: settings.OPT_OUT_REPLY !== undefined ? String(settings.OPT_OUT_REPLY) : SETTINGS_DEFAULTS.find(r => r[0] === 'OPT_OUT_REPLY')[1],
    createInboundContacts: yes('CREATE_INBOUND_CONTACTS', 'YES'),
    audienceOptions: pick('AUDIENCE_OPTIONS', 'ALL_OPTED_IN,VIP,LEADS,CUSTOMERS')
      .split(',').map(s => s.trim()).filter(Boolean),
    systemName: pick('SYSTEM_NAME', 'WhatsApp Campaign Automation'),
    _settingsContainSecrets: Object.keys(settings).some(k => /TOKEN|SECRET|API_KEY/i.test(k)),
  };
  if (CONFIG_CACHE_.delayMaxMs < CONFIG_CACHE_.delayMinMs) CONFIG_CACHE_.delayMaxMs = CONFIG_CACHE_.delayMinMs;
  return CONFIG_CACHE_;
}

/** Reads SETTINGS into a {key: value} map. Missing sheet => empty map. */
function readSettings_() {
  const out = {};
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SETTINGS);
    if (!sheet || sheet.getLastRow() < 2) return out;
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(r => {
      const key = String(r[0] || '').trim();
      if (key) out[key] = r[1];
    });
  } catch (err) {
    console.warn('readSettings_: ' + err.message);
  }
  return out;
}

/**
 * Validates configuration. Returns { ok, errors[], warnings[] } — never includes secret values.
 */
function validateConfig_(cfg) {
  cfg = cfg || getConfig_(true);
  const errors = [];
  const warnings = [];
  if (!cfg.productId) errors.push('Script Property MAYTAPI_PRODUCT_ID is missing.');
  if (!cfg.phoneId) errors.push('Script Property MAYTAPI_PHONE_ID is missing.');
  if (!cfg.apiToken) errors.push('Script Property MAYTAPI_API_TOKEN is missing.');
  if (cfg.phoneId && !/^\d+$/.test(cfg.phoneId)) warnings.push('MAYTAPI_PHONE_ID is normally numeric — check the value in the Maytapi console.');
  if (!cfg.defaultCountryCode) errors.push('DEFAULT_COUNTRY_CODE is empty.');
  try { Utilities.formatDate(new Date(), cfg.timezone, 'yyyy'); } catch (err) { errors.push('TIMEZONE "' + cfg.timezone + '" is not a valid IANA timezone.'); }
  if (['BASE64', 'URL'].indexOf(cfg.mediaMode) < 0) errors.push('MEDIA_MODE must be BASE64 or URL.');
  if (['IMAGE_THEN_BUTTONS', 'CAPTION_LINK'].indexOf(cfg.imageCtaStyle) < 0) errors.push('IMAGE_CTA_STYLE must be IMAGE_THEN_BUTTONS or CAPTION_LINK.');
  if ([1, 5, 10, 15, 30].indexOf(cfg.queueIntervalMinutes) < 0) errors.push('QUEUE_INTERVAL_MINUTES must be 1, 5, 10, 15 or 30.');
  if (!cfg.webhookSecret) warnings.push('WEBHOOK_SECRET is not set — the webhook will accept unauthenticated requests.');
  if (!cfg.adminEmail) warnings.push('ADMIN_EMAIL is not set — admin notifications are disabled.');
  if (cfg._settingsContainSecrets) warnings.push('SETTINGS sheet contains a TOKEN/SECRET-like key. Remove it — secrets belong in Script Properties only.');
  return { ok: errors.length === 0, errors: errors, warnings: warnings };
}

/** Menu helper: store Maytapi credentials in Script Properties via prompts (never in the sheet). */
function setMaytapiCredentials() {
  requireAdmin_();
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const ask = (key, label, secret) => {
    const current = props.getProperty(key);
    const hint = current ? (secret ? ' (currently set — leave blank to keep)' : ' (current: ' + current + ' — leave blank to keep)') : '';
    const r = ui.prompt('Maytapi credentials', label + hint, ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) throw new Error('CANCELLED');
    const v = r.getResponseText().trim();
    if (v) props.setProperty(key, v);
  };
  try {
    ask('MAYTAPI_PRODUCT_ID', 'Maytapi Product ID', false);
    ask('MAYTAPI_PHONE_ID', 'Maytapi Phone ID (the platform sending number, NOT a client store phone)', false);
    ask('MAYTAPI_API_TOKEN', 'Maytapi API Token', true);
    ask('WEBHOOK_SECRET', 'Webhook secret (any long random string; optional)', true);
    ask('ADMIN_EMAIL', 'Administrator email (optional)', false);
  } catch (err) {
    if (err.message === 'CANCELLED') return;
    throw err;
  }
  CONFIG_CACHE_ = null;
  const v = validateConfig_(getConfig_(true));
  ui.alert('Credentials saved to Script Properties.\n\n' + formatValidation_(v));
}

/** Generates a random WEBHOOK_SECRET if none exists. Returns true when one was created. */
function ensureWebhookSecret_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('WEBHOOK_SECRET')) return false;
  props.setProperty('WEBHOOK_SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  CONFIG_CACHE_ = null;
  return true;
}

function formatValidation_(v) {
  const lines = [];
  if (v.ok) lines.push('Configuration OK.');
  v.errors.forEach(e => lines.push('ERROR: ' + e));
  v.warnings.forEach(w => lines.push('Warning: ' + w));
  return lines.join('\n');
}

/** Removes any secret value from a string before it is logged or stored. */
function redactSecrets_(text) {
  if (text === null || text === undefined) return '';
  let s = String(text);
  try {
    const props = PropertiesService.getScriptProperties();
    SECRET_PROPERTY_KEYS.forEach(k => {
      const v = props.getProperty(k);
      if (v && v.length >= 6) s = s.split(v).join('***');
    });
  } catch (err) { /* ignore */ }
  return s.replace(/("?x-maytapi-key"?\s*[:=]\s*"?)[^",\s}]+/gi, '$1***');
}

/* ============================== Utils.gs ============================== */

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

/* ============================== Campaigns.gs ============================== */

/**
 * Campaigns.gs
 * Validation, client records, campaign lifecycle, scheduling and test sends.
 */

/* ============================== VALIDATION ============================== */

/**
 * Validates raw form input. Image processing is included.
 * @return { errors[], warnings[], data } — data holds normalised values.
 */
function validateCampaignInput_(input) {
  const cfg = getConfig_();
  const errors = [];
  const warnings = [];
  const data = {};

  data.businessName = String(input.businessName || '').trim();
  data.campaignName = String(input.campaignName || '').trim();
  data.message = String(input.message || '').trim();
  data.email = String(input.email || '').trim().toLowerCase();
  data.notes = String(input.notes || '').trim();

  if (!data.businessName) errors.push('Client / Business Name is required.');
  if (!data.campaignName) errors.push('Campaign Name is required.');
  if (!data.message) errors.push('Campaign Message is required.');
  if (data.message.length > 4096) errors.push('Campaign Message is longer than 4096 characters.');
  if (!isValidEmail_(data.email)) errors.push('Client Email is missing or invalid.');

  // Unknown {{variables}} are removed at send time; warn so the client knows.
  const unknown = (data.message.match(/\{\{\s*([^}]+?)\s*\}\}/g) || [])
    .map(v => v.replace(/[{}\s]/g, ''))
    .filter(v => TEMPLATE_VARIABLES.map(t => t.toLowerCase()).indexOf(v.replace(/_/g, '').toLowerCase()) < 0);
  if (unknown.length) warnings.push('Unknown variables will be removed from the message: ' + unknown.join(', '));

  // Website
  data.website = '';
  if (String(input.website || '').trim()) {
    data.website = normalizeUrl_(input.website);
    if (!data.website) errors.push('Website / Landing Page URL "' + input.website + '" is not a valid web address.');
  }

  // Store phone (client's public number — NOT the Maytapi sending number)
  data.storePhone = '';
  if (String(input.storePhone || '').trim()) {
    data.storePhone = normalizePhoneNumber(input.storePhone);
    if (!data.storePhone) errors.push('Store / Business Phone Number "' + input.storePhone + '" is invalid.');
  }

  // Image (optional: text-only campaigns are allowed)
  data.imageFileId = '';
  data.imageName = '';
  if (input.imageRef && String(input.imageRef).trim()) {
    const img = processCampaignImage_(input.imageRef);
    if (!img.ok) errors.push(img.error);
    else { data.imageFileId = img.fileId; data.imageName = img.fileName; }
  } else {
    warnings.push('No image uploaded — the campaign will be sent as text only.');
  }
  if (data.imageFileId && data.message.length > 1024 && cfg.imageCtaStyle === 'CAPTION_LINK') {
    errors.push('With an image, the message must be at most 1024 characters (WhatsApp caption limit).');
  }

  // CTA
  data.ctaType = String(input.ctaType || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (data.ctaType === 'NONE' || data.ctaType === 'NO_BUTTON') data.ctaType = '';
  data.ctaText = String(input.ctaText || '').trim();
  data.ctaValue = String(input.ctaValue || '').trim();
  if (data.ctaType || data.ctaText) {
    if (CTA_TYPES.indexOf(data.ctaType) < 0) errors.push('CTA Button Type must be URL, PHONE or QUICK_REPLY.');
    if (!data.ctaText) errors.push('CTA Button Text is required when a CTA type is chosen.');
    else if (data.ctaText.length > cfg.ctaTextMaxLength) errors.push('CTA Button Text must be at most ' + cfg.ctaTextMaxLength + ' characters (currently ' + data.ctaText.length + ').');

    if (data.ctaType === 'URL') {
      if (!data.ctaValue) data.ctaValue = data.website ? '{{Website}}' : '';
      const resolved = /\{\{\s*website\s*\}\}/i.test(data.ctaValue) ? data.website : normalizeUrl_(data.ctaValue);
      if (!resolved) errors.push('CTA Button Value must be a valid URL (or leave blank to use the Website).');
      else if (!/\{\{/.test(data.ctaValue)) data.ctaValue = resolved;
    } else if (data.ctaType === 'PHONE') {
      if (!data.ctaValue) data.ctaValue = data.storePhone ? '{{StorePhone}}' : '';
      const resolved = /\{\{\s*store_?phone\s*\}\}/i.test(data.ctaValue) ? data.storePhone : normalizePhoneNumber(data.ctaValue);
      if (!resolved) errors.push('CTA Button Value must be a valid phone number (or leave blank to use the Store Phone).');
      else if (!/\{\{/.test(data.ctaValue)) data.ctaValue = resolved;
    } else if (data.ctaType === 'QUICK_REPLY') {
      if (!data.ctaValue) data.ctaValue = data.ctaText.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      if (data.ctaValue.length > 256) errors.push('Quick reply value is too long.');
    }
  }

  // Audience
  data.audience = normalizeAudience_(input.audience);
  if (!data.audience) errors.push('Target Audience is required.');
  else {
    const bad = data.audience.split(',').filter(t => !/^(ALL|ALL_OPTED_IN|(TAG|AUDIENCE):[A-Z0-9 _.\-]+|[A-Z0-9 _.\-]+)$/.test(t));
    if (bad.length) errors.push('Target Audience contains invalid values: ' + bad.join(', '));
  }

  // Send mode / schedule
  const mode = String(input.sendMode || '').trim().toUpperCase();
  data.sendMode = mode.indexOf('SCHEDULE') === 0 ? SEND_MODES.SCHEDULE : (mode.indexOf('NOW') >= 0 ? SEND_MODES.NOW : '');
  if (!data.sendMode) errors.push('Send Mode must be "Send Now" or "Schedule".');
  data.timezone = cfg.timezone;
  data.scheduleDate = parseDateValue_(input.date);
  data.scheduleTime = parseTimeValue_(input.time);
  if (data.sendMode === SEND_MODES.SCHEDULE) {
    if (!data.scheduleDate) errors.push('Campaign Date is missing or invalid.');
    if (!data.scheduleTime) errors.push('Campaign Time is missing or invalid.');
    if (data.scheduleDate && data.scheduleTime) {
      const when = buildDateTime_(data.scheduleDate, data.scheduleTime, cfg.timezone);
      if (!when) errors.push('Campaign Date/Time could not be interpreted.');
      else if (when.getTime() < Date.now() - 5 * 60 * 1000) errors.push('Campaign Date/Time (' + data.scheduleDate + ' ' + data.scheduleTime + ' ' + cfg.timezone + ') is in the past.');
    }
  } else if (data.sendMode === SEND_MODES.NOW) {
    data.scheduleDate = '';
    data.scheduleTime = '';
  }

  return { errors: errors, warnings: warnings, data: data };
}

/** "vip, Tag:Kolkata" -> "VIP,TAG:KOLKATA" */
function normalizeAudience_(value) {
  if (Array.isArray(value)) value = value.join(',');
  return String(value || '').split(/[,;\n]/)
    .map(s => s.trim().toUpperCase().replace(/\s*:\s*/, ':'))
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(',');
}

/* ============================== AUDIENCE ============================== */

/**
 * Audience resolvers. Add a new prefix here to extend targeting (e.g. "CITY:", "SPEND>").
 * Each resolver receives (argument, contactInfo) and returns true when the contact matches.
 */
const AUDIENCE_RESOLVERS = {
  ALL: () => true,
  ALL_OPTED_IN: () => true,
  TAG: (arg, c) => c.tags.indexOf(arg) >= 0,
  AUDIENCE: (arg, c) => c.audiences.indexOf(arg) >= 0,
  // Plain token: matches the Audience column or a tag (e.g. VIP, LEADS, KOLKATA).
  _DEFAULT: (arg, c) => c.audiences.indexOf(arg) >= 0 || c.tags.indexOf(arg) >= 0,
};

function contactMatchesAudience_(contact, audience) {
  const split = v => String(v || '').split(/[,;|]/).map(s => s.trim().toUpperCase()).filter(Boolean);
  const info = { tags: split(contact['Tags']), audiences: split(contact['Audience']) };
  return String(audience || '').split(',').filter(Boolean).some(token => {
    if (AUDIENCE_RESOLVERS[token]) return AUDIENCE_RESOLVERS[token]('', info);
    const i = token.indexOf(':');
    if (i > 0 && AUDIENCE_RESOLVERS[token.slice(0, i)]) return AUDIENCE_RESOLVERS[token.slice(0, i)](token.slice(i + 1).trim(), info);
    return AUDIENCE_RESOLVERS._DEFAULT(token, info);
  });
}

/** Marketing eligibility. Opt-out (Opt In != YES) always wins over audience selection. */
function isContactEligible_(contact, clientId) {
  return String(contact['Client ID']).trim() === String(clientId).trim() &&
    isYes_(contact['Opt In']) &&
    /^active$/i.test(String(contact['Status'] || '').trim());
}

function countAudience_(clientId, audience) {
  try {
    return readTable_(SHEETS.CONTACTS).rows
      .filter(c => isContactEligible_(c, clientId) && contactMatchesAudience_(c, audience) && normalizePhoneNumber(c['Phone'])).length;
  } catch (err) {
    return 0;
  }
}

/* ============================== CLIENTS ============================== */

/** Finds a client by email (then by business name) or creates one. Returns the client ID. */
function findOrCreateClient_(data) {
  const table = readTable_(SHEETS.CLIENTS);
  const existing = table.rows.find(r => String(r['Client Email']).trim().toLowerCase() === data.email) ||
    table.rows.find(r => String(r['Business Name']).trim().toLowerCase() === data.businessName.toLowerCase());
  const now = new Date();
  if (existing) {
    const updates = { 'Updated At': now };
    if (data.storePhone) updates['Business Phone'] = data.storePhone;
    if (data.website) updates['Website'] = data.website;
    if (data.businessName) updates['Business Name'] = data.businessName;
    updateFields_(table, existing._row, updates);
    return String(existing['Client ID']);
  }
  const clientId = newClientId_();
  appendObject_(SHEETS.CLIENTS, {
    'Client ID': clientId,
    'Business Name': data.businessName,
    'Client Email': data.email,
    'Business Phone': data.storePhone,
    'Website': data.website,
    'Status': 'Active',
    'Created At': now,
    'Updated At': now,
  });
  logEvent_(LOG_LEVEL.INFO, 'CLIENT_CREATED', { clientId: clientId, result: data.businessName });
  return clientId;
}

/* ============================== CAMPAIGN RECORDS ============================== */

function getCampaign_(campaignId) {
  const table = readTable_(SHEETS.CAMPAIGNS);
  return { table: table, row: findRow_(table, 'Campaign ID', campaignId) };
}

function setCampaignStatus_(campaignId, status, note) {
  const c = getCampaign_(campaignId);
  if (!c.row) throw new Error('Campaign ' + campaignId + ' not found.');
  const fields = { 'Status': status, 'Updated At': new Date() };
  if (note) fields['Notes'] = truncate_((c.row['Notes'] ? c.row['Notes'] + '\n' : '') + '[' + nowInTz_('yyyy-MM-dd HH:mm') + '] ' + note, 5000);
  updateFields_(c.table, c.row._row, fields);
  logEvent_(LOG_LEVEL.INFO, 'CAMPAIGN_STATUS', { campaignId: campaignId, clientId: c.row['Client ID'], result: status, details: note || '' });
}

function isDuplicateCampaign_(clientId, data) {
  return readTable_(SHEETS.CAMPAIGNS).rows.some(r =>
    String(r['Client ID']) === clientId &&
    String(r['Campaign Name']).trim().toLowerCase() === data.campaignName.toLowerCase() &&
    String(r['Send Mode']) === data.sendMode &&
    cellDateStr_(r['Schedule Date']) === data.scheduleDate &&
    cellTimeStr_(r['Schedule Time']) === data.scheduleTime &&
    [CAMPAIGN_STATUS.CANCELLED, CAMPAIGN_STATUS.ERROR, CAMPAIGN_STATUS.COMPLETED].indexOf(String(r['Status'])) < 0);
}

/** Scheduled send time of a campaign row, or null. */
function campaignScheduledAt_(row) {
  return buildDateTime_(cellDateStr_(row['Schedule Date']), cellTimeStr_(row['Schedule Time']), String(row['Timezone'] || getConfig_().timezone));
}

/** Schedule cells are stored as plain text, but tolerate Sheets auto-converting them. */
function cellDateStr_(v) {
  return v instanceof Date ? parseDateValue_(v) : String(v || '').trim();
}

function cellTimeStr_(v) {
  return v instanceof Date ? parseTimeValue_(v) : String(v || '').trim();
}

/* ============================== LIFECYCLE ============================== */

/** Builds the queue (if needed) and activates the campaign. */
function startCampaign_(campaignId) {
  const c = getCampaign_(campaignId);
  if (!c.row) throw new Error('Campaign ' + campaignId + ' not found.');
  const status = String(c.row['Status']);
  if ([CAMPAIGN_STATUS.COMPLETED, CAMPAIGN_STATUS.CANCELLED, CAMPAIGN_STATUS.ACTIVE].indexOf(status) >= 0) {
    return { ok: false, message: 'Campaign is ' + status + ' and cannot be started.' };
  }
  const built = buildCampaignQueue_(campaignId);
  const pending = countQueue_(campaignId, [QUEUE_STATUS.PENDING, QUEUE_STATUS.QUEUED]);
  if (!pending) {
    setCampaignStatus_(campaignId, CAMPAIGN_STATUS.ERROR, 'No eligible (opted-in, active) contacts matched audience ' + c.row['Target Audience']);
    return { ok: false, message: 'No eligible contacts matched the audience. Campaign set to ERROR.' };
  }
  setCampaignStatus_(campaignId, CAMPAIGN_STATUS.ACTIVE, 'Started with ' + pending + ' queued message(s) (' + built.added + ' new).');
  return { ok: true, message: 'Campaign ACTIVE with ' + pending + ' queued message(s).' };
}

function pauseCampaign_(campaignId) {
  const c = getCampaign_(campaignId);
  if (!c.row) throw new Error('Campaign ' + campaignId + ' not found.');
  if ([CAMPAIGN_STATUS.ACTIVE, CAMPAIGN_STATUS.SCHEDULED, CAMPAIGN_STATUS.READY].indexOf(String(c.row['Status'])) < 0) {
    return { ok: false, message: 'Only ACTIVE, SCHEDULED or READY campaigns can be paused.' };
  }
  setCampaignStatus_(campaignId, CAMPAIGN_STATUS.PAUSED, 'Paused (was ' + c.row['Status'] + ').');
  return { ok: true, message: 'Campaign paused. Queued messages are kept.' };
}

function resumeCampaign_(campaignId) {
  const c = getCampaign_(campaignId);
  if (!c.row) throw new Error('Campaign ' + campaignId + ' not found.');
  if (String(c.row['Status']) !== CAMPAIGN_STATUS.PAUSED) return { ok: false, message: 'Campaign is not paused.' };
  const pending = countQueue_(campaignId, [QUEUE_STATUS.PENDING, QUEUE_STATUS.QUEUED]);
  const when = campaignScheduledAt_(c.row);
  if (!pending && String(c.row['Send Mode']) === SEND_MODES.SCHEDULE && when && when.getTime() > Date.now()) {
    setCampaignStatus_(campaignId, CAMPAIGN_STATUS.SCHEDULED, 'Resumed; waiting for schedule.');
    return { ok: true, message: 'Campaign resumed and SCHEDULED for ' + when.toISOString() + '.' };
  }
  if (!pending) {
    setCampaignStatus_(campaignId, CAMPAIGN_STATUS.READY, 'Resumed.');
    return startCampaign_(campaignId);
  }
  setCampaignStatus_(campaignId, CAMPAIGN_STATUS.ACTIVE, 'Resumed with ' + pending + ' pending message(s).');
  return { ok: true, message: 'Campaign resumed (' + pending + ' pending).' };
}

function cancelCampaign_(campaignId) {
  const c = getCampaign_(campaignId);
  if (!c.row) throw new Error('Campaign ' + campaignId + ' not found.');
  if ([CAMPAIGN_STATUS.COMPLETED, CAMPAIGN_STATUS.CANCELLED].indexOf(String(c.row['Status'])) >= 0) {
    return { ok: false, message: 'Campaign is already ' + c.row['Status'] + '.' };
  }
  const cancelled = updateQueueStatusWhere_(campaignId, [QUEUE_STATUS.PENDING, QUEUE_STATUS.QUEUED], QUEUE_STATUS.CANCELLED, 'Campaign cancelled');
  setCampaignStatus_(campaignId, CAMPAIGN_STATUS.CANCELLED, 'Cancelled; ' + cancelled + ' unsent message(s) cancelled.');
  return { ok: true, message: 'Campaign cancelled. ' + cancelled + ' unsent message(s) cancelled.' };
}

/**
 * Activates SCHEDULED campaigns whose time has arrived:
 * SCHEDULED -> (build queue) -> ACTIVE. Runs under the scheduler lock, and the status
 * change prevents a second activation.
 */
function activateScheduledCampaigns_() {
  const table = readTable_(SHEETS.CAMPAIGNS);
  const now = Date.now();
  let activated = 0;
  table.rows.filter(r => String(r['Status']) === CAMPAIGN_STATUS.SCHEDULED).forEach(r => {
    const id = String(r['Campaign ID']);
    const when = campaignScheduledAt_(r);
    if (!when) {
      setCampaignStatus_(id, CAMPAIGN_STATUS.ERROR, 'Schedule date/time could not be interpreted.');
      return;
    }
    if (when.getTime() > now) return;
    try {
      setCampaignStatus_(id, CAMPAIGN_STATUS.VALIDATING, 'Schedule reached; building queue.');
      const res = startCampaign_(id);
      if (res.ok) activated++;
    } catch (err) {
      setCampaignStatus_(id, CAMPAIGN_STATUS.ERROR, 'Activation failed: ' + err.message);
    }
  });
  return activated;
}

/** ACTIVE campaigns with nothing left to send become COMPLETED. */
function completeFinishedCampaigns_() {
  const campaigns = readTable_(SHEETS.CAMPAIGNS).rows.filter(r => String(r['Status']) === CAMPAIGN_STATUS.ACTIVE);
  if (!campaigns.length) return;
  const queue = readTable_(SHEETS.MESSAGE_QUEUE).rows;
  const open = {};
  queue.forEach(q => {
    if ([QUEUE_STATUS.PENDING, QUEUE_STATUS.QUEUED, QUEUE_STATUS.PROCESSING].indexOf(String(q['Status'])) >= 0) open[q['Campaign ID']] = true;
  });
  campaigns.forEach(c => {
    if (!open[c['Campaign ID']]) setCampaignStatus_(String(c['Campaign ID']), CAMPAIGN_STATUS.COMPLETED, 'All messages processed.');
  });
}

/* ============================== TEST MESSAGE ============================== */

/**
 * Sends ONE message for a campaign to a single admin-supplied number.
 * Never touches the queue or the campaign audience. Personalised as "TEST CUSTOMER".
 */
function sendTestMessage(campaignId, testPhone) {
  requireAdmin_();
  const interactive = !campaignId;
  const ui = interactive ? SpreadsheetApp.getUi() : null;
  if (interactive) {
    campaignId = promptCampaignId_('Send Test Message');
    if (!campaignId) return;
    const p = ui.prompt('Send Test Message', 'Test phone number (only this number will receive the message):', ui.ButtonSet.OK_CANCEL);
    if (p.getSelectedButton() !== ui.Button.OK) return;
    testPhone = p.getResponseText();
  }
  const report = msg => { if (ui) ui.alert(msg); else console.log(msg); return msg; };

  const cfg = getConfig_(true);
  const v = validateConfig_(cfg);
  if (!v.ok) return report('Cannot send test — configuration errors:\n' + v.errors.join('\n'));

  const c = getCampaign_(campaignId);
  if (!c.row) return report('Campaign ' + campaignId + ' not found.');
  const phone = normalizePhoneNumber(testPhone);
  if (!phone) return report('Invalid test phone number.');

  const contact = { Name: 'TEST CUSTOMER', Phone: phone, Email: '', Company: '' };
  const spec = buildSpecForContact_(c.row, contact, phone);
  const invalid = validateMessageSpec_(spec, cfg);
  if (invalid) return report('Campaign payload invalid: ' + invalid);
  if (spec.imageFileId || spec.imageUrl) {
    const m = resolveMedia_(spec, cfg, {});
    if (!m.ok) return report('Media invalid: ' + m.error);
  }

  // Send from the same number the tenant's campaign would use.
  const r = sendCampaignMessage_(spec, cfgForClient_(clientsById_()[String(c.row['Client ID'])], cfg), {});
  logEvent_(r.success ? LOG_LEVEL.SUCCESS : LOG_LEVEL.ERROR, 'TEST_MESSAGE', {
    campaignId: campaignId, clientId: c.row['Client ID'], phone: phone, messageId: r.messageId,
    httpStatus: r.httpStatus, result: r.success ? (r.fallbackUsed ? 'SENT (text CTA fallback)' : 'SENT') : 'FAILED', error: r.error,
  });
  return report(r.success
    ? 'Test message sent to ' + maskPhone_(phone) + (r.fallbackUsed ? '\n\nNote: Maytapi rejected the button payload; the CTA was sent as a text link. Check LOGS → BUTTON_FALLBACK.' : '') + '\nMessage ID(s): ' + r.messageId
    : 'Test failed (HTTP ' + r.httpStatus + '): ' + r.error);
}

/* ============================== ClientApi.gs ============================== */

/**
 * ClientApi.gs
 * Server side of the client dashboard (ClientApp.html), served by the Web App's doGet().
 *
 * Every api* function:
 *   - takes the session token first and resolves it with requireSession_() (Security.gs),
 *   - only reads/writes rows whose Client ID equals the session's client,
 *   - returns plain JSON (no Date objects) as { ok: true, ... } or { ok: false, error, code }.
 * Business values (name, email) always come from the CLIENTS row, never from the browser,
 * so a client cannot create campaigns for another business.
 */

const MAX_UPLOAD_ROWS = 5000;
const CREATIVES_FOLDER_NAME = 'WhatsApp Campaign Creatives';

/** Serves the dashboard page. */
function serveClientApp_() {
  const html = typeof CLIENT_APP_HTML_ !== 'undefined'
    ? CLIENT_APP_HTML_                                            // single-file build (dist/Code.gs)
    : HtmlService.createHtmlOutputFromFile('ClientApp').getContent(); // multi-file project
  return HtmlService.createHtmlOutput(html)
    .setTitle(getConfig_().systemName)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT); // no embedding by other sites
}

/** Wraps an API handler: session check, error shaping, logging. */
function apiCall_(token, action, handler) {
  try {
    const session = requireSession_(token);
    const result = handler(session) || {};
    return Object.assign({ ok: true }, result);
  } catch (err) {
    if (err.code === 'AUTH') return { ok: false, code: 'AUTH', error: err.message };
    logEvent_(LOG_LEVEL.ERROR, 'API_' + action, { error: err.message, details: err.stack });
    return { ok: false, error: err.message || 'Something went wrong. Please try again.' };
  }
}

/* ============================== AUTH ============================== */

function apiLogin(email, accessCode) {
  try {
    const s = loginClient_(email, accessCode);
    return Object.assign({ ok: true, token: s.token }, buildBootstrap_(s.clientId));
  } catch (err) {
    return { ok: false, code: err.code || 'ERROR', error: err.code === 'AUTH' ? err.message : 'Sign-in failed. Please try again.' };
  }
}

function apiLogout(token) {
  logoutClient_(token);
  return { ok: true };
}

/* ============================== DATA ============================== */

function apiBootstrap(token) {
  return apiCall_(token, 'BOOTSTRAP', s => buildBootstrap_(s.clientId));
}

function buildBootstrap_(clientId) {
  const cfg = getConfig_(true);
  const client = findRow_(readTable_(SHEETS.CLIENTS), 'Client ID', clientId);
  const contacts = readTable_(SHEETS.CONTACTS).rows.filter(c => String(c['Client ID']) === clientId);
  const eligible = contacts.filter(c => isContactEligible_(c, clientId) && normalizePhoneNumber(c['Phone']));

  const lists = {};
  eligible.forEach(c => {
    String(c['Tags'] || '').split(/[,;|]/).map(t => t.trim()).filter(Boolean).forEach(t => {
      const key = t.toUpperCase();
      lists[key] = lists[key] || { name: t, count: 0 };
      lists[key].count++;
    });
  });

  return {
    profile: {
      clientId: clientId,
      businessName: String(client['Business Name'] || ''),
      email: String(client['Client Email'] || ''),
      phone: client['Business Phone'] ? '+' + normalizePhoneNumber(client['Business Phone']) : '',
      website: String(client['Website'] || ''),
    },
    settings: {
      timezone: cfg.timezone,
      today: todayKey_(),
      nowTime: nowInTz_('HH:mm'),
      ctaTextMaxLength: cfg.ctaTextMaxLength,
      maxImageMb: cfg.maxImageMb,
      maxUploadRows: MAX_UPLOAD_ROWS,
      imageCtaStyle: cfg.imageCtaStyle,
      defaultContactName: cfg.defaultContactName,
      defaultCountryCode: cfg.defaultCountryCode,
      variables: TEMPLATE_VARIABLES,
      systemName: cfg.systemName,
    },
    stats: {
      contacts: contacts.length,
      optedIn: eligible.length,
      optedOut: contacts.filter(c => !isYes_(c['Opt In'])).length,
    },
    lists: Object.keys(lists).sort().map(k => lists[k]),
    subscription: (function () {
      const ent = tenantEntitlement_(client, monthlySentByClient_(readTable_(SHEETS.MESSAGE_QUEUE).rows)[clientId] || 0);
      return {
        plan: ent.plan, validUntil: ent.validUntil, quota: ent.quota, used: ent.used, remaining: ent.remaining,
        canSend: ent.ok, reason: ent.reason, dedicatedNumber: ent.dedicatedNumber,
      };
    })(),
    campaigns: clientCampaignSummaries_(clientId),
  };
}

function clientCampaignSummaries_(clientId) {
  const campaigns = readTable_(SHEETS.CAMPAIGNS).rows.filter(c => String(c['Client ID']) === clientId);
  const stats = {};
  readTable_(SHEETS.MESSAGE_QUEUE).rows.forEach(q => {
    if (String(q['Client ID']) !== clientId) return;
    const st = String(q['Status']);
    const p = stats[q['Campaign ID']] || (stats[q['Campaign ID']] = { recipients: 0, sent: 0, delivered: 0, read: 0, failed: 0, pending: 0 });
    if (st !== QUEUE_STATUS.CANCELLED && st !== QUEUE_STATUS.SKIPPED) p.recipients++;
    if ([QUEUE_STATUS.SENT, QUEUE_STATUS.DELIVERED, QUEUE_STATUS.READ].indexOf(st) >= 0) p.sent++;
    if (st === QUEUE_STATUS.DELIVERED || st === QUEUE_STATUS.READ) p.delivered++;
    if (st === QUEUE_STATUS.READ) p.read++;
    if (st === QUEUE_STATUS.FAILED) p.failed++;
    if ([QUEUE_STATUS.PENDING, QUEUE_STATUS.QUEUED, QUEUE_STATUS.PROCESSING].indexOf(st) >= 0) p.pending++;
  });
  const replies = {};
  readTable_(SHEETS.RESPONSES).rows.forEach(r => {
    if (String(r['Client ID']) === clientId && String(r['Event Type']) === 'message' && r['Campaign ID']) {
      replies[r['Campaign ID']] = (replies[r['Campaign ID']] || 0) + 1;
    }
  });
  return campaigns.slice().reverse().map(c => {
    const id = String(c['Campaign ID']);
    const created = toDate_(c['Created At']);
    return {
      id: id,
      name: String(c['Campaign Name'] || ''),
      status: String(c['Status'] || ''),
      sendMode: String(c['Send Mode'] || ''),
      scheduleDate: cellDateStr_(c['Schedule Date']),
      scheduleTime: cellTimeStr_(c['Schedule Time']),
      timezone: String(c['Timezone'] || ''),
      createdAt: created ? Utilities.formatDate(created, getConfig_().timezone, 'yyyy-MM-dd HH:mm') : '',
      audience: String(c['Target Audience'] || ''),
      hasImage: !!String(c['Image File ID'] || c['Image URL'] || '').trim(),
      message: String(c['Message'] || ''),
      ctaType: String(c['CTA Type'] || ''),
      ctaText: String(c['CTA Text'] || ''),
      ctaValue: String(c['CTA Value'] || ''),
      website: String(c['Website URL'] || ''),
      storePhone: c['Store Phone'] ? '+' + normalizePhoneNumber(c['Store Phone']) : '',
      stats: Object.assign({ recipients: 0, sent: 0, delivered: 0, read: 0, failed: 0, pending: 0 }, stats[id] || {}),
      replies: replies[id] || 0,
    };
  });
}

/* ============================== AUDIENCE ============================== */

/** { all: true } or { lists: ['VIP', 'Diwali 2026'] } -> audience string understood by Campaigns.gs */
function audienceFromSelection_(sel) {
  sel = sel || {};
  if (sel.all) return 'ALL_OPTED_IN';
  const lists = (sel.lists || []).map(sanitizeListName_).filter(Boolean);
  return lists.map(l => 'TAG:' + l.toUpperCase()).join(',');
}

function sanitizeListName_(name) {
  return String(name || '').replace(/[^A-Za-z0-9 _.\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function apiCountAudience(token, selection) {
  return apiCall_(token, 'COUNT_AUDIENCE', s => {
    const audience = audienceFromSelection_(selection);
    return { count: audience ? countAudience_(s.clientId, audience) : 0 };
  });
}

/* ============================== CONTACT UPLOAD ============================== */

/**
 * Imports customers parsed in the browser from Excel/CSV.
 * payload = { listName, consent: true, rows: [{ name, phone, email, company, tags, optIn }] }
 * - New numbers are added for this client only, tagged with the list name.
 * - Existing numbers are updated (name/email/company/tags) but an opted-out customer is
 *   NEVER re-subscribed by an upload. A file value of NO opts the customer out.
 */
function apiUploadContacts(token, payload) {
  return apiCall_(token, 'UPLOAD_CONTACTS', s => {
    payload = payload || {};
    if (payload.consent !== true) throw new Error('Please confirm that these customers agreed to receive WhatsApp messages from your business.');
    const listName = sanitizeListName_(payload.listName);
    if (!listName) throw new Error('Please enter a list name (letters, numbers, spaces, . _ -).');
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) throw new Error('The file has no customer rows.');
    if (rows.length > MAX_UPLOAD_ROWS) throw new Error('Maximum ' + MAX_UPLOAD_ROWS + ' customers per upload. Split the file and upload again.');

    const cfg = getConfig_();
    const now = new Date();
    const source = 'UPLOAD "' + listName + '" by ' + s.client['Client Email'] + ' on ' + nowInTz_('yyyy-MM-dd HH:mm') + ' (consent confirmed)';
    const table = readTable_(SHEETS.CONTACTS);
    const existing = {};
    table.rows.forEach(c => {
      if (String(c['Client ID']) !== s.clientId) return;
      const p = normalizePhoneNumber(c['Phone']);
      if (p && !existing[p]) existing[p] = c;
    });

    const seen = {};
    const toAdd = [];
    const invalidRows = [];
    let updated = 0, duplicatesInFile = 0, keptOptedOut = 0;
    const clean = v => String(v === undefined || v === null ? '' : v).trim().slice(0, 200);
    const mergeTags = (a, b) => {
      const out = [];
      String(a || '').split(/[,;|]/).concat(String(b || '').split(/[,;|]/)).map(t => t.trim()).filter(Boolean).forEach(t => {
        if (!out.some(x => x.toUpperCase() === t.toUpperCase())) out.push(t);
      });
      return out.join(', ');
    };

    rows.forEach((r, i) => {
      const phone = normalizePhoneNumber(r && r.phone, cfg.defaultCountryCode);
      if (!phone) { invalidRows.push(i + 2); return; } // +2: header row + 1-based
      if (seen[phone]) { duplicatesInFile++; return; }
      seen[phone] = true;
      const fileSaysNo = /^(NO|N|FALSE|0|OPT.?OUT|UNSUBSCRIBED)$/i.test(clean(r.optIn));
      const tags = mergeTags(r.tags, listName);
      const ex = existing[phone];
      if (ex) {
        if (!isYes_(ex['Opt In']) && !fileSaysNo) keptOptedOut++;
        ex['Name'] = clean(r.name) || ex['Name'];
        ex['Email'] = clean(r.email) || ex['Email'];
        ex['Company'] = clean(r.company) || ex['Company'];
        ex['Tags'] = mergeTags(ex['Tags'], tags);
        if (fileSaysNo) ex['Opt In'] = 'NO';
        ex['Updated At'] = now;
        writeRowObject_(table, ex);
        updated++;
      } else {
        toAdd.push({
          'Client ID': s.clientId, 'Name': clean(r.name), 'Phone': phone, 'Email': clean(r.email),
          'Company': clean(r.company), 'Tags': tags, 'Audience': '', 'Opt In': fileSaysNo ? 'NO' : 'YES',
          'Status': 'Active', 'Created At': now, 'Updated At': now, 'Source': source,
        });
      }
    });

    if (toAdd.length) {
      const ids = newContactIds_(toAdd.length);
      toAdd.forEach((c, i) => { c['Contact ID'] = ids[i]; });
      appendObjects_(SHEETS.CONTACTS, toAdd);
    }
    logEvent_(LOG_LEVEL.SUCCESS, 'CONTACTS_UPLOADED', {
      clientId: s.clientId, result: toAdd.length + ' added, ' + updated + ' updated',
      details: { list: listName, rows: rows.length, invalid: invalidRows.length, duplicatesInFile: duplicatesInFile, keptOptedOut: keptOptedOut, consent: true },
    });
    return {
      list: listName, added: toAdd.length, updated: updated, invalid: invalidRows.length,
      invalidRows: invalidRows.slice(0, 20), duplicatesInFile: duplicatesInFile, keptOptedOut: keptOptedOut,
      bootstrap: buildBootstrap_(s.clientId),
    };
  });
}

/* ============================== CAMPAIGNS ============================== */

/**
 * Creates a campaign from the dashboard.
 * p = { campaignName, message, imageDataUrl, website, storePhone, ctaType, ctaText, ctaValue,
 *       audience: { all } | { lists: [] }, sendMode: 'NOW' | 'SCHEDULE', date: 'yyyy-MM-dd', time: 'HH:mm' }
 */
function apiCreateCampaign(token, p) {
  return apiCall_(token, 'CREATE_CAMPAIGN', s => {
    p = p || {};
    const audience = audienceFromSelection_(p.audience);
    if (!audience) return { created: false, errors: ['Choose who should receive this campaign.'] };

    let imageFileId = '';
    if (p.imageDataUrl) {
      const saved = saveCreativeToDrive_(s.clientId, p.imageDataUrl);
      if (!saved.ok) return { created: false, errors: [saved.error] };
      imageFileId = saved.fileId;
    }

    const input = {
      businessName: s.client['Business Name'],
      email: s.client['Client Email'],
      campaignName: p.campaignName,
      message: p.message,
      imageRef: imageFileId,
      website: p.website || s.client['Website'],
      storePhone: p.storePhone || s.client['Business Phone'],
      ctaText: p.ctaType && p.ctaType !== 'NONE' ? p.ctaText : '',
      ctaType: p.ctaType && p.ctaType !== 'NONE' ? p.ctaType : '',
      ctaValue: p.ctaType && p.ctaType !== 'NONE' ? p.ctaValue : '',
      audience: audience,
      sendMode: p.sendMode === 'SCHEDULE' ? 'Schedule' : 'Send Now',
      date: p.sendMode === 'SCHEDULE' ? p.date : '',
      time: p.sendMode === 'SCHEDULE' ? p.time : '',
      notes: 'Created from client dashboard',
    };
    const res = createCampaignFromInput_(input, 'DASHBOARD', { silent: true, expectedClientId: s.clientId });
    if (!res.ok && imageFileId) {
      try { DriveApp.getFileById(imageFileId).setTrashed(true); } catch (err) { /* ignore */ }
    }
    return {
      created: res.ok, campaignId: res.campaignId || '', status: res.status || '',
      errors: res.errors || [], warnings: res.warnings || [],
      campaigns: res.ok ? clientCampaignSummaries_(s.clientId) : undefined,
    };
  });
}

/** Saves a processed creative (data URL) privately in Drive: <root>/WhatsApp Campaign Creatives/<Client ID>/ */
function saveCreativeToDrive_(clientId, dataUrl) {
  const m = String(dataUrl).match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return { ok: false, error: 'The image must be a JPG or PNG.' };
  const bytes = Utilities.base64Decode(m[2]);
  const maxBytes = getConfig_().maxImageMb * 1024 * 1024;
  if (bytes.length > maxBytes) return { ok: false, error: 'The processed image is larger than ' + getConfig_().maxImageMb + ' MB.' };
  try {
    const folder = creativesFolder_(clientId);
    const ext = m[1] === 'image/png' ? 'png' : 'jpg';
    const name = clientId + '_' + nowInTz_('yyyyMMdd_HHmmss') + '.' + ext;
    const file = folder.createFile(Utilities.newBlob(bytes, m[1], name));
    return { ok: true, fileId: file.getId() };
  } catch (err) {
    return { ok: false, error: 'Could not save the image to Google Drive: ' + err.message };
  }
}

function creativesFolder_(clientId) {
  const props = PropertiesService.getScriptProperties();
  let root = null;
  const rootId = props.getProperty('CREATIVES_FOLDER_ID');
  if (rootId) { try { root = DriveApp.getFolderById(rootId); } catch (err) { root = null; } }
  if (!root) {
    root = DriveApp.createFolder(CREATIVES_FOLDER_NAME);
    props.setProperty('CREATIVES_FOLDER_ID', root.getId());
  }
  const it = root.getFoldersByName(clientId);
  return it.hasNext() ? it.next() : root.createFolder(clientId);
}

function clientCampaignRow_(clientId, campaignId) {
  const c = getCampaign_(String(campaignId || ''));
  if (!c.row || String(c.row['Client ID']) !== clientId) throw new Error('Campaign not found.');
  return c.row;
}

function apiCancelCampaign(token, campaignId) {
  return apiCall_(token, 'CANCEL_CAMPAIGN', s => {
    const row = clientCampaignRow_(s.clientId, campaignId);
    const allowed = [CAMPAIGN_STATUS.READY, CAMPAIGN_STATUS.SCHEDULED, CAMPAIGN_STATUS.ACTIVE, CAMPAIGN_STATUS.PAUSED];
    if (allowed.indexOf(String(row['Status'])) < 0) throw new Error('This campaign can no longer be cancelled.');
    const r = cancelCampaign_(String(row['Campaign ID']));
    return { message: r.message, campaigns: clientCampaignSummaries_(s.clientId) };
  });
}

/**
 * Returns a campaign's image for the protected (canvas + watermark) preview only.
 * The Drive file itself is never shared or linked.
 */
function apiGetCampaignImage(token, campaignId) {
  return apiCall_(token, 'CAMPAIGN_IMAGE', s => {
    const row = clientCampaignRow_(s.clientId, campaignId);
    const fileId = String(row['Image File ID'] || '').trim();
    if (!fileId) return { image: '' };
    const blob = DriveApp.getFileById(fileId).getBlob();
    return { image: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
  });
}

/* ============================== Code.gs ============================== */

/**
 * Code.gs
 * Entry points: setupSystem(), the onOpen() menu and menu action wrappers.
 */

/** Simple trigger: adds the "WhatsApp Automation" menu. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('WhatsApp Automation')
    .addItem('Setup System', 'setupSystem')
    .addItem('Set Maytapi Credentials', 'setMaytapiCredentials')
    .addItem('Create Campaign Form', 'createCampaignForm')
    .addSeparator()
    .addItem('Create Client Login', 'createClientLogin')
    .addItem('Reset Client Access Code', 'resetClientAccessCode')
    .addItem('Show Client Dashboard URL', 'showDashboardUrl')
    .addSeparator()
    .addItem('Test Maytapi Connection', 'testMaytapiConnection')
    .addSeparator()
    .addItem('Send Test Message', 'menuSendTestMessage')
    .addItem('Build Campaign Queue', 'menuBuildCampaignQueue')
    .addItem('Start Campaign', 'menuStartCampaign')
    .addItem('Pause Campaign', 'menuPauseCampaign')
    .addItem('Resume Campaign', 'menuResumeCampaign')
    .addItem('Cancel Campaign', 'menuCancelCampaign')
    .addItem('Process Queue Now', 'menuProcessQueueNow')
    .addItem('Retry Failed Messages', 'retryFailedMessages')
    .addItem('Reprocess Form Response', 'reprocessFormResponse')
    .addSeparator()
    .addItem('Install Triggers', 'installTriggers')
    .addItem('Remove Triggers', 'removeTriggers')
    .addItem('List Triggers', 'listTriggers')
    .addItem('Configure Webhook', 'configureWebhook')
    .addItem('View Dashboard', 'viewDashboard')
    .addToUi();
}

/**
 * Creates any missing sheets, headers, settings and starter templates.
 * Never deletes or overwrites existing data; missing columns are appended at the end.
 */
function setupSystem() {
  requireAdmin_();
  const ss = ss_();
  const report = [];

  // FORM_RESPONSES: adopt a linked "Form Responses N" tab if one exists.
  if (!ss.getSheetByName(SHEETS.FORM_RESPONSES)) {
    const linked = ss.getSheets().find(s => { try { return !!s.getFormUrl(); } catch (err) { return false; } });
    if (linked) { linked.setName(SHEETS.FORM_RESPONSES); report.push('Renamed linked form sheet to FORM_RESPONSES'); }
    else {
      const s = ss.insertSheet(SHEETS.FORM_RESPONSES);
      s.getRange(1, 1).setValue('Link the Google Form here (run "Create Campaign Form", or Form → Responses → Link to Sheets, then rename the tab to FORM_RESPONSES).');
      report.push('Created FORM_RESPONSES placeholder');
    }
  }

  Object.keys(HEADERS).forEach(name => {
    let sheet = ss.getSheetByName(name);
    const headers = HEADERS[name];
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      report.push('Created ' + name);
    } else {
      const lastCol = Math.max(sheet.getLastColumn(), 1);
      const current = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
      const missing = headers.filter(h => current.indexOf(h) < 0);
      if (current.every(h => !h)) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        report.push('Added headers to ' + name);
      } else if (missing.length) {
        sheet.getRange(1, sheet.getLastColumn() + 1, 1, missing.length).setValues([missing]);
        report.push(name + ': added columns ' + missing.join(', '));
      }
    }
    styleHeader_(sheet);
  });

  if (!ss.getSheetByName(SHEETS.DASHBOARD)) { ss.insertSheet(SHEETS.DASHBOARD); report.push('Created DASHBOARD'); }

  // Text formats so Sheets doesn't turn phones into numbers or schedules into dates.
  setTextColumns_(SHEETS.CONTACTS, ['Phone', 'Contact ID', 'Client ID']);
  setTextColumns_(SHEETS.CLIENTS, ['Business Phone', 'Maytapi Phone ID', 'Valid Until', 'Access Code Hash']);
  setTextColumns_(SHEETS.CAMPAIGNS, ['Store Phone', 'Schedule Date', 'Schedule Time', 'CTA Value']);
  setTextColumns_(SHEETS.MESSAGE_QUEUE, ['Phone', 'CTA Value', 'Message ID', 'Sender Phone ID']);
  setTextColumns_(SHEETS.RESPONSES, ['Phone', 'Message ID']);
  setTextColumns_(SHEETS.SETTINGS, ['Value']);

  // Seed missing SETTINGS keys (existing values untouched).
  const settings = readTable_(SHEETS.SETTINGS);
  const have = settings.rows.map(r => String(r['Key']).trim());
  const add = SETTINGS_DEFAULTS.filter(d => have.indexOf(d[0]) < 0).map(d => ({ Key: d[0], Value: d[1], Description: d[2] }));
  if (add.length) { appendObjects_(SHEETS.SETTINGS, add); report.push('SETTINGS: added ' + add.length + ' key(s)'); }

  // Starter auto-reply templates (only when TEMPLATES is empty). All generic.
  if (!readTable_(SHEETS.TEMPLATES).rows.length) {
    const starters = [
      ['Offers', 'offer,offers,view offers', 'TEXT', 'Hi {{Name}}! Thanks for your interest in {{ClientName}} offers. Our latest offers are available at {{Website}} or call us at {{StorePhone}}.'],
      ['Store info', 'store,address,location,visit', 'TEXT', 'You can visit {{ClientName}} or browse online at {{Website}}. For directions or appointments call {{StorePhone}}.'],
      ['Call us', 'call,phone,contact', 'BUTTONS', 'Speak to the {{ClientName}} team directly:', '', 'Call Store', 'PHONE', '{{StorePhone}}'],
      ['Help menu', 'hi,hello,help,menu', 'TEXT', 'Hi {{Name}}! Reply OFFER for current offers, STORE for store details, CALL for our phone number, or STOP to unsubscribe.'],
    ];
    const ids = newTemplateIds_(starters.length);
    appendObjects_(SHEETS.TEMPLATES, starters.map((s, i) => ({
      'Template ID': ids[i], 'Template Name': s[0], 'Trigger': s[1], 'Reply Type': s[2], 'Reply Text': s[3],
      'Image URL': s[4] || '', 'Button Text': s[5] || '', 'Button Type': s[6] || '', 'Button Value': s[7] || '', 'Active': 'YES',
    })));
    report.push('TEMPLATES: added starter replies');
  }

  addValidations_();
  refreshDashboard();

  const v = validateConfig_(getConfig_(true));
  logEvent_(LOG_LEVEL.SUCCESS, 'SETUP_SYSTEM', { result: 'OK', details: report.join('; ') });
  const msg = (report.length ? report.join('\n') : 'All sheets already present.') + '\n\n' + formatValidation_(v) +
    '\n\nNext: Set Maytapi Credentials → Create Campaign Form → Deploy Web App → Configure Webhook → Install Triggers.';
  try { SpreadsheetApp.getUi().alert('Setup complete', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (err) { console.log(msg); }
}

function styleHeader_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (!lastCol) return;
  sheet.getRange(1, 1, 1, lastCol).setFontWeight('bold').setBackground('#e8f5e9');
  sheet.setFrozenRows(1);
}

function setTextColumns_(name, headers) {
  const table = readTable_(name);
  headers.forEach(h => {
    if (table.col[h]) table.sheet.getRange(2, table.col[h], Math.max(1, table.sheet.getMaxRows() - 1), 1).setNumberFormat('@');
  });
}

function addValidations_() {
  const list = values => SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(true).build();
  const apply = (name, header, rule) => {
    const t = readTable_(name);
    if (t.col[header]) t.sheet.getRange(2, t.col[header], Math.max(1, t.sheet.getMaxRows() - 1), 1).setDataValidation(rule);
  };
  apply(SHEETS.CONTACTS, 'Opt In', list(['YES', 'NO']));
  apply(SHEETS.CONTACTS, 'Status', list(['Active', 'Inactive']));
  apply(SHEETS.CLIENTS, 'Status', list(['Active', 'Suspended', 'Inactive']));
  apply(SHEETS.CAMPAIGNS, 'Status', list(Object.keys(CAMPAIGN_STATUS)));
  apply(SHEETS.CAMPAIGNS, 'CTA Type', list(CTA_TYPES.concat([''])));
  apply(SHEETS.TEMPLATES, 'Reply Type', list(['TEXT', 'IMAGE', 'BUTTONS']));
  apply(SHEETS.TEMPLATES, 'Button Type', list(CTA_TYPES));
  apply(SHEETS.TEMPLATES, 'Active', list(['YES', 'NO']));
}

/* ============================== MENU WRAPPERS ============================== */

function menuSendTestMessage() { sendTestMessage(); }

function menuBuildCampaignQueue() {
  runCampaignAction_('Build Campaign Queue', id => {
    const r = buildCampaignQueue_(id);
    return r.added + ' message(s) queued. Duplicates skipped: ' + r.duplicates + '. Invalid phones: ' + r.skipped + '.\n(Queue is sent only while the campaign is ACTIVE — use Start Campaign.)';
  });
}

function menuStartCampaign() { runCampaignAction_('Start Campaign', id => startCampaign_(id).message); }
function menuPauseCampaign() { runCampaignAction_('Pause Campaign', id => pauseCampaign_(id).message); }
function menuResumeCampaign() { runCampaignAction_('Resume Campaign', id => resumeCampaign_(id).message); }

function menuCancelCampaign() {
  const ui = SpreadsheetApp.getUi();
  runCampaignAction_('Cancel Campaign', id => {
    if (ui.alert('Cancel ' + id + '?', 'Unsent messages will be cancelled. This cannot be undone.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return 'Not cancelled.';
    return cancelCampaign_(id).message;
  });
}

function menuProcessQueueNow() {
  requireAdmin_();
  const r = processMessageQueue_();
  refreshDashboard();
  SpreadsheetApp.getUi().alert(r.skippedRun ? 'Another queue run is in progress — try again shortly.'
    : r.dailyLimitReached ? 'Daily send limit reached.'
    : r.error ? 'Configuration invalid — see LOGS.'
    : 'Sent: ' + r.sent + ', failed: ' + r.failed + ', scheduled for retry: ' + r.retried + '.');
}

function runCampaignAction_(title, fn) {
  requireAdmin_();
  const ui = SpreadsheetApp.getUi();
  const id = promptCampaignId_(title);
  if (!id) return;
  try {
    const msg = fn(id);
    refreshDashboard();
    ui.alert(title, msg, ui.ButtonSet.OK);
  } catch (err) {
    logEvent_(LOG_LEVEL.ERROR, title.toUpperCase().replace(/\s+/g, '_'), { campaignId: id, error: err.message });
    ui.alert(title, 'Error: ' + err.message, ui.ButtonSet.OK);
  }
}

/* ============================== Dashboard.gs ============================== */

/**
 * Dashboard.gs
 * Script-generated summary (refreshed by trigger every 30 min, after menu actions,
 * and on demand via "View Dashboard").
 */

function refreshDashboard() {
  const sheet = getSheet_(SHEETS.DASHBOARD);
  const clients = readTable_(SHEETS.CLIENTS).rows;
  const contacts = readTable_(SHEETS.CONTACTS).rows;
  const campaigns = readTable_(SHEETS.CAMPAIGNS).rows;
  const queue = readTable_(SHEETS.MESSAGE_QUEUE).rows;
  const replies = readTable_(SHEETS.RESPONSES).rows.filter(r => String(r['Event Type']) === 'message');
  const today = todayKey_();

  const st = q => String(q['Status']);
  const delivered = s => s === QUEUE_STATUS.DELIVERED || s === QUEUE_STATUS.READ;
  const sentLike = s => s === QUEUE_STATUS.SENT || delivered(s);

  const kpis = [
    ['Total Clients', clients.length],
    ['Total Contacts', contacts.length],
    ['Opted-In Contacts', contacts.filter(c => isYes_(c['Opt In'])).length],
    ['Active Campaigns', campaigns.filter(c => String(c['Status']) === CAMPAIGN_STATUS.ACTIVE).length],
    ['Scheduled Campaigns', campaigns.filter(c => String(c['Status']) === CAMPAIGN_STATUS.SCHEDULED).length],
    ['Pending Messages', queue.filter(q => [QUEUE_STATUS.PENDING, QUEUE_STATUS.QUEUED, QUEUE_STATUS.PROCESSING].indexOf(st(q)) >= 0).length],
    ['Messages Sent', queue.filter(q => sentLike(st(q))).length],
    ['Messages Failed', queue.filter(q => st(q) === QUEUE_STATUS.FAILED).length],
    ['Messages Delivered', queue.filter(q => delivered(st(q))).length],
    ['Messages Read', queue.filter(q => st(q) === QUEUE_STATUS.READ).length],
    ['Replies', replies.length],
    ["Today's Sent", queue.filter(q => dateKey_(toDate_(q['Sent At'])) === today).length],
    ["Today's Failed", queue.filter(q => st(q) === QUEUE_STATUS.FAILED && dateKey_(toDate_(q['Last Attempt'])) === today).length],
  ];

  const perCampaign = {};
  queue.forEach(q => {
    const id = q['Campaign ID'];
    const p = perCampaign[id] || (perCampaign[id] = { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0 });
    const s = st(q);
    if (s !== QUEUE_STATUS.CANCELLED && s !== QUEUE_STATUS.SKIPPED) p.queued++;
    if (sentLike(s)) p.sent++;
    if (delivered(s)) p.delivered++;
    if (s === QUEUE_STATUS.READ) p.read++;
    if (s === QUEUE_STATUS.FAILED) p.failed++;
  });
  const repliesBy = {};
  replies.forEach(r => { if (r['Campaign ID']) repliesBy[r['Campaign ID']] = (repliesBy[r['Campaign ID']] || 0) + 1; });

  const table = campaigns.slice().reverse().map(c => {
    const p = perCampaign[c['Campaign ID']] || { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
    return [
      c['Campaign ID'] + ' – ' + c['Campaign Name'], c['Client Name'], c['Target Audience'],
      p.queued, p.sent, p.delivered, p.read, p.failed, repliesBy[c['Campaign ID']] || 0, c['Status'],
    ];
  });

  sheet.clear();
  sheet.getRange(1, 1).setValue('WhatsApp Campaign Dashboard').setFontSize(16).setFontWeight('bold');
  sheet.getRange(2, 1).setValue('Updated ' + nowInTz_('yyyy-MM-dd HH:mm') + ' (' + getConfig_().timezone + ')').setFontColor('#666666');

  sheet.getRange(4, 1, 1, 2).setValues([['Metric', 'Value']]).setFontWeight('bold').setBackground('#1f7a4d').setFontColor('#ffffff');
  sheet.getRange(5, 1, kpis.length, 2).setValues(kpis);

  const top = 5 + kpis.length + 2;
  const head = ['Campaign', 'Client', 'Audience', 'Queued', 'Sent', 'Delivered', 'Read', 'Failed', 'Replies', 'Status'];
  sheet.getRange(top, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#1f7a4d').setFontColor('#ffffff');
  if (table.length) sheet.getRange(top + 1, 1, table.length, head.length).setValues(table);

  // Tenants (clients you sell the service to): plan, sending number and usage.
  const used = monthlySentByClient_(queue);
  const tz = getConfig_().timezone;
  const tenantRows = clients.map(c => {
    const id = String(c['Client ID']);
    const ent = tenantEntitlement_(c, used[id] || 0);
    const lastLogin = toDate_(c['Last Login']);
    return [
      id + ' – ' + c['Business Name'], ent.plan || '—', String(c['Status'] || ''),
      String(c['Maytapi Phone ID'] || '').trim() ? 'Dedicated (' + c['Maytapi Phone ID'] + ')' : 'Shared',
      ent.used, ent.quota === null ? 'Unlimited' : ent.quota, ent.remaining === null ? '—' : ent.remaining,
      ent.validUntil || '—', contacts.filter(x => isContactEligible_(x, id)).length,
      lastLogin ? Utilities.formatDate(lastLogin, tz, 'yyyy-MM-dd HH:mm') : '—',
      ent.ok ? 'OK' : ent.reason,
    ];
  });
  const tTop = top + table.length + 3;
  const tHead = ['Tenant', 'Plan', 'Status', 'Sending Number', 'Sent This Month', 'Monthly Quota', 'Remaining', 'Valid Until', 'Opted-In Contacts', 'Last Login', 'Can Send'];
  sheet.getRange(tTop - 1, 1).setValue('Tenants').setFontWeight('bold');
  sheet.getRange(tTop, 1, 1, tHead.length).setValues([tHead]).setFontWeight('bold').setBackground('#1f7a4d').setFontColor('#ffffff');
  if (tenantRows.length) sheet.getRange(tTop + 1, 1, tenantRows.length, tHead.length).setValues(tenantRows);
  sheet.autoResizeColumns(1, 11);
  sheet.setFrozenRows(0);
}

function viewDashboard() {
  requireAdmin_();
  refreshDashboard();
  ss_().setActiveSheet(getSheet_(SHEETS.DASHBOARD));
}

/* ============================== Email.gs ============================== */

/**
 * Email.gs
 * Client confirmations, validation-failure emails and admin notifications.
 * Emails never contain credentials or other clients' data.
 */

function sendConfirmationEmail_(campaign, status, warnings) {
  const cfg = getConfig_();
  const to = String(campaign['Submitted By'] || '').trim();
  if (!isValidEmail_(to)) return;
  const scheduled = String(campaign['Send Mode']) === SEND_MODES.SCHEDULE
    ? cellDateStr_(campaign['Schedule Date']) + ' ' + cellTimeStr_(campaign['Schedule Time']) + ' (' + campaign['Timezone'] + ')'
    : 'Send Now';
  const lines = [
    'Hello ' + campaign['Client Name'] + ',',
    '',
    'Your WhatsApp campaign has been successfully submitted.',
    '',
    'Campaign:',
    String(campaign['Campaign Name']),
    '',
    'Campaign ID:',
    String(campaign['Campaign ID']),
    '',
    'Scheduled:',
    scheduled,
    '',
    'Status:',
    status === CAMPAIGN_STATUS.READY ? 'READY (awaiting final approval)' : status,
  ];
  if (warnings && warnings.length) {
    lines.push('', 'Please note:');
    warnings.forEach(w => lines.push('• ' + w));
  }
  lines.push('', 'Regards,', cfg.systemName);
  safeSendEmail_(to, 'Campaign Submitted – ' + campaign['Campaign Name'], lines.join('\n'));
}

function sendAttentionEmail_(input, problems) {
  const cfg = getConfig_();
  const to = String(input.email || '').trim();
  if (!isValidEmail_(to)) return;
  const lines = [
    'Hello ' + (input.businessName || 'there') + ',',
    '',
    'Your WhatsApp campaign' + (input.campaignName ? ' "' + input.campaignName + '"' : '') + ' could not be accepted yet. Please correct the following and submit the form again:',
    '',
  ];
  problems.forEach(p => lines.push('• ' + p));
  lines.push('', 'Regards,', cfg.systemName);
  safeSendEmail_(to, 'Campaign Submission Requires Attention', lines.join('\n'));
}

function notifyAdminOfSubmission_(d, campaignId, status, errors, warnings) {
  const cfg = getConfig_();
  if (!cfg.notifyAdmin || !cfg.adminEmail) return;
  const lines = [
    'Client: ' + d.businessName + ' <' + d.email + '>',
    'Campaign: ' + d.campaignName,
    'Campaign ID: ' + (campaignId || '—'),
    'Schedule: ' + (d.sendMode === SEND_MODES.SCHEDULE ? d.scheduleDate + ' ' + d.scheduleTime + ' ' + d.timezone : d.sendMode || '—'),
    'Audience: ' + (d.audience || '—'),
    'CTA: ' + (d.ctaType ? d.ctaType + ' "' + d.ctaText + '" → ' + d.ctaValue : 'none'),
    'Website: ' + (d.website || '—'),
    'Store phone: ' + (d.storePhone ? '+' + d.storePhone : '—'),
    'Image: ' + (d.imageFileId ? d.imageName + ' (' + d.imageFileId + ')' : 'none'),
    'Validation result: ' + status,
  ];
  if (errors && errors.length) lines.push('', 'Errors:', ...errors.map(e => '• ' + e));
  if (warnings && warnings.length) lines.push('', 'Warnings:', ...warnings.map(w => '• ' + w));
  lines.push('', 'Spreadsheet: ' + ss_().getUrl());
  safeSendEmail_(cfg.adminEmail, '[WhatsApp Automation] ' + status + ' – ' + (d.campaignName || 'campaign submission'), lines.join('\n'));
}

function notifyAdmin_(subject, body) {
  const cfg = getConfig_();
  if (!cfg.adminEmail) return;
  safeSendEmail_(cfg.adminEmail, '[WhatsApp Automation] ' + subject, redactSecrets_(body) + '\n\nSpreadsheet: ' + ss_().getUrl());
}

function safeSendEmail_(to, subject, body) {
  try {
    if (MailApp.getRemainingDailyQuota() < 1) {
      logEvent_(LOG_LEVEL.WARNING, 'EMAIL_QUOTA', { error: 'Mail quota exhausted; email to ' + to.replace(/^(.).*(@.*)$/, '$1***$2') + ' not sent.' });
      return false;
    }
    MailApp.sendEmail({ to: to, subject: subject, body: body, name: getConfig_().systemName });
    return true;
  } catch (err) {
    logEvent_(LOG_LEVEL.ERROR, 'EMAIL_FAILED', { error: err.message, details: subject });
    return false;
  }
}

/* ============================== Forms.gs ============================== */

/**
 * Forms.gs
 * Google Form intake: onFormSubmit (installable trigger) and form generator.
 */

/**
 * Installable "On form submit" trigger (spreadsheet or form). Main campaign entry point.
 * Never throws back to Google: every failure is logged and emailed.
 */
function onFormSubmit(e) {
  let input = null;
  try {
    // Only genuine trigger events carry live Range / FormResponse objects. Plain objects (for
    // example sent from a browser via google.script.run) are rejected.
    const realRange = e && e.range && typeof e.range.getSheet === 'function';
    const realResponse = e && e.response && typeof e.response.getItemResponses === 'function';
    if (!realRange && !realResponse) throw new Error('onFormSubmit must be run by its form-submit trigger. Use "Install Triggers".');
    input = readFormInput_(e);
    return createCampaignFromInput_(input, 'FORM');
  } catch (err) {
    logEvent_(LOG_LEVEL.ERROR, 'FORM_SUBMIT_FAILED', { error: err.message, details: err.stack });
    if (input && isValidEmail_(input.email)) {
      sendAttentionEmail_(input, ['We could not process your submission because of a system error. Our team has been notified.']);
    }
    notifyAdmin_('Campaign submission failed', 'Error: ' + err.message + '\n\nInput: ' + safeJson_(input && Object.assign({}, input, { message: truncate_(input.message, 200) })));
    return null;
  }
}

/**
 * Validates and stores one campaign. Shared by the Google Form, reprocessing and the client dashboard.
 * opts.silent           — don't email validation problems (the dashboard shows them inline)
 * opts.expectedClientId — the record must belong to this client (dashboard sessions)
 * @return { ok, campaignId, status, errors, warnings }
 */
function createCampaignFromInput_(input, source, opts) {
  opts = opts || {};
  const cfg = getConfig_(true);
  const v = validateCampaignInput_(input);
  const d = v.data;

  if (v.errors.length) {
    logEvent_(LOG_LEVEL.WARNING, 'FORM_VALIDATION_FAILED', {
      result: 'REJECTED', error: v.errors.join(' | '),
      details: { business: d.businessName, campaign: d.campaignName, email: d.email ? d.email.replace(/^(.).*(@.*)$/, '$1***$2') : '' },
    });
    if (!opts.silent) {
      if (isValidEmail_(d.email)) sendAttentionEmail_(input, v.errors);
      notifyAdminOfSubmission_(d, null, 'REJECTED', v.errors, v.warnings);
    }
    return { ok: false, errors: v.errors, warnings: v.warnings };
  }

  const clientId = findOrCreateClient_(d);
  if (opts.expectedClientId && clientId !== opts.expectedClientId) {
    throw new Error('Client mismatch while creating campaign (expected ' + opts.expectedClientId + ', got ' + clientId + ').');
  }
  if (isDuplicateCampaign_(clientId, d)) {
    const errors = ['A campaign named "' + d.campaignName + '" with the same schedule has already been submitted.'];
    logEvent_(LOG_LEVEL.WARNING, 'DUPLICATE_CAMPAIGN', { clientId: clientId, result: 'REJECTED', error: errors[0] });
    if (!opts.silent) sendAttentionEmail_(input, errors);
    return { ok: false, errors: errors, warnings: v.warnings };
  }

  // Tenant subscription: suspended or expired accounts cannot create campaigns.
  const ent = tenantEntitlementById_(clientId);
  if (!ent.ok && !/quota/i.test(ent.reason)) {
    const errors = ['Your account cannot launch campaigns right now: ' + ent.reason + ' Please contact your service provider.'];
    logEvent_(LOG_LEVEL.WARNING, 'TENANT_BLOCKED', { clientId: clientId, result: 'REJECTED', error: ent.reason });
    if (!opts.silent) sendAttentionEmail_(input, errors);
    return { ok: false, errors: errors, warnings: v.warnings };
  }

  const campaignId = newCampaignId_();
  const now = new Date();
  const audienceSize = countAudience_(clientId, d.audience);
  const warnings = v.warnings.slice();
  if (ent.remaining !== null && audienceSize > ent.remaining) {
    warnings.push('This campaign targets ' + audienceSize + ' customers but only ' + ent.remaining + ' messages remain in this month\'s plan. Sending pauses when the quota is reached.');
  }
  if (!audienceSize) warnings.push('No opted-in active contacts currently match audience "' + d.audience + '". Contacts must be added before the send time.');

  appendObject_(SHEETS.CAMPAIGNS, {
    'Campaign ID': campaignId,
    'Client ID': clientId,
    'Client Name': d.businessName,
    'Campaign Name': d.campaignName,
    'Status': CAMPAIGN_STATUS.VALIDATING,
    'Message': d.message,
    'Image File ID': d.imageFileId,
    'Image URL': '',
    'Website URL': d.website,
    'Store Phone': d.storePhone,
    'CTA Text': d.ctaText,
    'CTA Type': d.ctaType,
    'CTA Value': d.ctaValue,
    'Target Audience': d.audience,
    'Send Mode': d.sendMode,
    'Schedule Date': d.scheduleDate,
    'Schedule Time': d.scheduleTime,
    'Timezone': d.timezone,
    'Created At': now,
    'Updated At': now,
    'Submitted By': d.email,
    'Notes': [d.notes, warnings.length ? 'Warnings: ' + warnings.join(' | ') : ''].filter(Boolean).join('\n'),
  });
  logEvent_(LOG_LEVEL.SUCCESS, 'CAMPAIGN_CREATED', { clientId: clientId, campaignId: campaignId, result: d.sendMode, details: { source: source, audience: d.audience, audienceSize: audienceSize } });

  // Decide the next status.
  let status;
  if (d.sendMode === SEND_MODES.SCHEDULE) {
    status = CAMPAIGN_STATUS.SCHEDULED;
    setCampaignStatus_(campaignId, status, 'Scheduled for ' + d.scheduleDate + ' ' + d.scheduleTime + ' ' + d.timezone + '.');
  } else if (cfg.requireAdminApproval) {
    status = CAMPAIGN_STATUS.READY;
    setCampaignStatus_(campaignId, status, 'Awaiting admin approval (REQUIRE_ADMIN_APPROVAL=YES).');
  } else {
    setCampaignStatus_(campaignId, CAMPAIGN_STATUS.READY, 'Send Now requested.');
    const res = startCampaign_(campaignId); // builds the queue; the scheduler trigger sends it
    status = res.ok ? CAMPAIGN_STATUS.ACTIVE : CAMPAIGN_STATUS.ERROR;
    if (!res.ok) warnings.push(res.message);
  }

  const campaign = getCampaign_(campaignId).row;
  sendConfirmationEmail_(campaign, status, warnings);
  notifyAdminOfSubmission_(d, campaignId, status, [], warnings);
  return { ok: true, campaignId: campaignId, status: status, errors: [], warnings: warnings };
}

/**
 * Builds a normalised input object from any of the three event shapes:
 *  - spreadsheet trigger with e.range (typed cell values — preferred)
 *  - form trigger with e.response (FormResponse)
 */
function readFormInput_(e) {
  const answers = {};
  if (e.range && e.range.getSheet) {
    const sheet = e.range.getSheet();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const values = sheet.getRange(e.range.getRow(), 1, 1, headers.length).getValues()[0];
    headers.forEach((h, i) => { answers[String(h).trim().toLowerCase()] = values[i]; });
  } else if (e.response && e.response.getItemResponses) {
    e.response.getItemResponses().forEach(ir => {
      const v = ir.getResponse();
      answers[ir.getItem().getTitle().trim().toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
    });
    try { answers['email address'] = e.response.getRespondentEmail(); } catch (err) { /* not collected */ }
  } else {
    throw new Error('Unrecognised form submit event.');
  }

  const get = key => {
    const aliases = FORM_FIELDS[key];
    for (let i = 0; i < aliases.length; i++) {
      const v = answers[aliases[i].toLowerCase()];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return '';
  };
  return {
    businessName: get('businessName'),
    campaignName: get('campaignName'),
    message: get('message'),
    imageRef: get('image'),
    website: get('website'),
    storePhone: get('storePhone'),
    ctaText: get('ctaText'),
    ctaType: get('ctaType'),
    ctaValue: get('ctaValue'),
    audience: get('audience'),
    date: get('date'),
    time: get('time'),
    email: String(get('email') || '').trim(),
    notes: get('notes'),
    sendMode: get('sendMode'),
  };
}

/** Admin tool: re-run campaign creation for a FORM_RESPONSES row (e.g. after fixing contacts). */
function reprocessFormResponse() {
  requireAdmin_();
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Reprocess Form Response', 'Row number in ' + SHEETS.FORM_RESPONSES + ':', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const row = Number(r.getResponseText());
  const sheet = getSheet_(SHEETS.FORM_RESPONSES);
  if (!(row >= 2 && row <= sheet.getLastRow())) return ui.alert('Invalid row.');
  const res = createCampaignFromInput_(readFormInput_({ range: sheet.getRange(row, 1) }), 'REPROCESS');
  ui.alert(res.ok ? 'Created ' + res.campaignId + ' (' + res.status + ')' : 'Rejected:\n' + res.errors.join('\n'));
}

/**
 * Creates the client-facing Google Form linked to this spreadsheet.
 * NOTE: Apps Script's FormApp cannot create File Upload questions. After running this,
 * open the form and add a "File upload" question titled exactly "Campaign Image"
 * (allow: Images, max 1 file, 10 MB). The script then reads it automatically.
 */
function createCampaignForm() {
  requireAdmin_();
  const cfg = getConfig_(true);
  const ss = ss_();
  const form = FormApp.create('WhatsApp Campaign Request');
  form.setDescription('Submit your WhatsApp marketing campaign. You will receive a confirmation email once it has been validated.')
    .setCollectEmail(false)
    .setConfirmationMessage('Thank you! Your campaign has been submitted. Watch your inbox for the confirmation email.');

  form.addTextItem().setTitle(FORM_FIELDS.businessName[0]).setRequired(true);
  form.addTextItem().setTitle(FORM_FIELDS.campaignName[0]).setRequired(true);
  form.addParagraphTextItem().setTitle(FORM_FIELDS.message[0]).setRequired(true)
    .setHelpText('Personalise with: ' + TEMPLATE_VARIABLES.map(v => '{{' + v + '}}').join(' ') +
      '\nExample: Hi {{Name}}, discover our latest collection. Call us at {{StorePhone}}.');
  form.addSectionHeaderItem().setTitle('Campaign Image')
    .setHelpText('ADMIN: add a "File upload" question titled "Campaign Image" here (FormApp cannot create it automatically).');
  form.addTextItem().setTitle(FORM_FIELDS.website[0]).setRequired(false)
    .setValidation(FormApp.createTextValidation().requireTextIsUrl().setHelpText('Enter a full URL, e.g. https://example.com').build());
  form.addTextItem().setTitle(FORM_FIELDS.storePhone[0]).setRequired(true)
    .setHelpText('Your public business number (used for the Call button and {{StorePhone}}). Include country code if outside +' + cfg.defaultCountryCode + '.');
  form.addTextItem().setTitle(FORM_FIELDS.ctaText[0]).setRequired(false)
    .setHelpText('Button label, max ' + cfg.ctaTextMaxLength + ' characters, e.g. "Explore Collection".');
  form.addMultipleChoiceItem().setTitle(FORM_FIELDS.ctaType[0]).setRequired(true)
    .setChoiceValues(['URL', 'PHONE', 'QUICK_REPLY', 'NONE'])
    .setHelpText('URL opens a link, PHONE calls your store, QUICK_REPLY sends a keyword back, NONE = no button.');
  form.addTextItem().setTitle(FORM_FIELDS.ctaValue[0]).setRequired(false)
    .setHelpText('URL: https://… (blank = Website). PHONE: number (blank = Store Phone). QUICK_REPLY: keyword, e.g. offers.');
  form.addCheckboxItem().setTitle(FORM_FIELDS.audience[0]).setRequired(true)
    .setChoiceValues(cfg.audienceOptions).showOtherOption(true)
    .setHelpText('Use "Other" for TAG:<tag>, e.g. TAG:KOLKATA.');
  form.addMultipleChoiceItem().setTitle(FORM_FIELDS.sendMode[0]).setRequired(true).setChoiceValues(['Send Now', 'Schedule']);
  form.addDateItem().setTitle(FORM_FIELDS.date[0]).setRequired(false).setHelpText('Required when Send Mode = Schedule.');
  form.addTimeItem().setTitle(FORM_FIELDS.time[0]).setRequired(false).setHelpText('Timezone: ' + cfg.timezone + '. Required when Send Mode = Schedule.');
  form.addTextItem().setTitle(FORM_FIELDS.email[0]).setRequired(true)
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().build());
  form.addParagraphTextItem().setTitle(FORM_FIELDS.notes[0]).setRequired(false);

  // Link responses to this spreadsheet and rename the new tab to FORM_RESPONSES.
  const before = ss.getSheets().map(s => s.getSheetId());
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();
  const created = ss_().getSheets().find(s => before.indexOf(s.getSheetId()) < 0);
  if (created) {
    const placeholder = ss.getSheetByName(SHEETS.FORM_RESPONSES);
    if (placeholder && placeholder.getLastRow() <= 1 && !placeholder.getFormUrl()) ss.deleteSheet(placeholder);
    if (!ss.getSheetByName(SHEETS.FORM_RESPONSES)) created.setName(SHEETS.FORM_RESPONSES);
  }

  PropertiesService.getScriptProperties().setProperty('CAMPAIGN_FORM_ID', form.getId());
  logEvent_(LOG_LEVEL.SUCCESS, 'FORM_CREATED', { result: form.getId() });
  const msg = 'Form created.\n\nEdit: ' + form.getEditUrl() + '\nShare with clients: ' + form.getPublishedUrl() +
    '\n\nNEXT STEPS:\n1. Open the edit link and add a "File upload" question titled "Campaign Image" (images only, 1 file).\n2. Run "Install Triggers".';
  try { SpreadsheetApp.getUi().alert(msg); } catch (err) { console.log(msg); }
  return form.getId();
}

/* ============================== Maytapi.gs ============================== */

/**
 * Maytapi.gs
 * Thin, isolated API layer for Maytapi (https://maytapi.com/documentation).
 *
 * ---------------------------------------------------------------------------
 * API CONTRACT USED HERE  — re-check against the live docs before go-live
 * ---------------------------------------------------------------------------
 * Base URL ............ https://api.maytapi.com/api/{product_id}
 * Auth header ......... x-maytapi-key: {API token}
 * Send ................ POST /{phone_id}/sendMessage
 *   text  ............. { "to_number": "<intl digits>", "type": "text",  "message": "<text>" }
 *   media ............. { "to_number": "...", "type": "media", "message": "<https URL | data:<mime>;base64,...>",
 *                         "text": "<caption>", "filename": "<optional>" }
 *   buttons ........... { "to_number": "...", "type": "buttons", "message": "<body>", "buttons": [ ... ] }
 * Success response .... { "success": true, "data": { "chatId": "...", "msgId": "..." } }
 * Error response ...... { "success": false, "message": "..." }
 * Connection checks ... GET /listPhones, GET /{phone_id}/status
 * Webhook ............. POST /setWebhook  { "webhook": "<url>" }
 *
 * Text, media, status, listPhones and setWebhook are Maytapi's long-standing core
 * endpoints. Interactive BUTTON messages are flagged by Maytapi as a newer/BETA
 * feature and their schema has changed over time, so the button JSON is built in
 * ONE function (buildButtonsPayload_) and every button send automatically falls
 * back to a plain-text CTA if Maytapi rejects it (CTA_FALLBACK_TO_TEXT=YES).
 * Run "Send Test Message" after any Maytapi change to confirm the live format.
 *
 * List and carousel messages are intentionally NOT implemented: they could not be
 * verified against the current documentation, and guessing payloads is unsafe.
 * ---------------------------------------------------------------------------
 *
 * Every function returns:
 *   { success, httpStatus, messageId, response, error, retryable, rateLimited, authError, stopBatch }
 * The API token never appears in a return value, log row or exception message.
 */

const MAYTAPI_BASE_URL = 'https://api.maytapi.com/api';

/**
 * Low-level request. `path` is relative to /api/{product_id}, e.g. '/123/sendMessage'.
 */
function maytapiRequest_(method, path, payload, cfg) {
  cfg = cfg || getConfig_();
  if (!cfg.productId || !cfg.apiToken) {
    return failResult_(0, 'Maytapi credentials are not configured (Script Properties).', { authError: true, stopBatch: true });
  }
  const url = MAYTAPI_BASE_URL + '/' + encodeURIComponent(cfg.productId) + path;
  const options = {
    method: (method || 'get').toLowerCase(),
    contentType: 'application/json',
    headers: { 'x-maytapi-key': cfg.apiToken },
    muteHttpExceptions: true,
    followRedirects: true,
  };
  if (payload !== undefined && payload !== null) options.payload = JSON.stringify(payload);

  let res;
  try {
    res = UrlFetchApp.fetch(url, options);
  } catch (err) {
    // Network error / timeout: transient.
    return failResult_(0, 'Network error: ' + redactSecrets_(err.message), { retryable: true });
  }

  const status = res.getResponseCode();
  const text = res.getContentText() || '';
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (err) { json = null; }

  const apiSuccess = json && typeof json === 'object' && json.success !== false;
  const ok = status >= 200 && status < 300 && (json ? apiSuccess : true);
  const data = json && json.data;
  const messageId = (data && !Array.isArray(data) && (data.msgId || data.id || data.messageId)) || (json && json.msgId) || '';
  const response = json || truncate_(text, 2000);

  if (ok) {
    return { success: true, httpStatus: status, messageId: String(messageId || ''), response: response, error: '' };
  }
  const errorText = redactSecrets_(
    (json && (json.message || json.error || (json.data && json.data.message))) || truncate_(text, 500) || ('HTTP ' + status)
  );
  return classifyFailure_(status, errorText, response);
}

function failResult_(status, error, flags) {
  return Object.assign({
    success: false, httpStatus: status, messageId: '', response: null, error: error,
    retryable: false, rateLimited: false, authError: false, stopBatch: false,
  }, flags || {});
}

/** Decides whether a failure is transient, permanent, rate-limited or batch-stopping. */
function classifyFailure_(status, errorText, response) {
  const msg = String(errorText || '').toLowerCase();
  const r = failResult_(status, errorText);
  r.response = response;
  if (status === 429 || /rate.?limit|too many|throttl/.test(msg)) {
    r.rateLimited = true; r.retryable = true; r.stopBatch = true;
  } else if (status === 401 || status === 403 || /unauthori[sz]ed|invalid (api )?(key|token)|forbidden/.test(msg)) {
    r.authError = true; r.stopBatch = true;
  } else if (/not\s+connected|disconnected|\bqr\b|phone.*(offline|inactive|not active|loading)/.test(msg)) {
    // Sending phone problem: every message would fail. Keep items, stop the batch.
    r.retryable = true; r.stopBatch = true;
  } else if (/invalid.*(number|phone)|not.*(registered|exist|on whatsapp)|wrong number/.test(msg)) {
    r.retryable = false;
  } else if (status === 0 || status === 408 || status >= 500) {
    r.retryable = true;
  } else if (status >= 200 && status < 300) {
    // HTTP 200 with success:false and an unrecognised reason — treat as transient.
    r.retryable = true;
  } else {
    r.retryable = false; // other 4xx: bad request, won't fix itself
  }
  return r;
}

function phonePath_(cfg, endpoint) {
  return '/' + encodeURIComponent(cfg.phoneId) + '/' + endpoint;
}

/* ============================== MESSAGE TYPES ============================== */

function sendMaytapiText_(toNumber, text, cfg) {
  cfg = cfg || getConfig_();
  return maytapiRequest_('post', phonePath_(cfg, 'sendMessage'), {
    to_number: toNumber,
    type: 'text',
    message: String(text || ''),
  }, cfg);
}

/**
 * @param media  https URL or data URI (data:<mime>;base64,...) — see Media.gs
 * @param caption optional caption text
 */
function sendMaytapiMedia_(toNumber, media, caption, filename, cfg) {
  cfg = cfg || getConfig_();
  const payload = { to_number: toNumber, type: 'media', message: media };
  if (caption) payload.text = String(caption);
  if (filename) payload.filename = filename;
  return maytapiRequest_('post', phonePath_(cfg, 'sendMessage'), payload, cfg);
}

/**
 * Sends an interactive button message.
 * @param buttons [{ type: 'URL'|'PHONE'|'QUICK_REPLY', text, value }]
 */
function sendMaytapiButtons_(toNumber, body, buttons, cfg) {
  cfg = cfg || getConfig_();
  return maytapiRequest_('post', phonePath_(cfg, 'sendMessage'), buildButtonsPayload_(toNumber, body, buttons), cfg);
}

/**
 * THE ONLY PLACE THE BUTTON SCHEMA IS DEFINED.
 * Maytapi button entries (per its "Buttons Message" example):
 *   quick reply -> { "id": "<payload>", "text": "<label>" }
 *   url         -> { "text": "<label>", "url": "https://..." }
 *   phone       -> { "text": "<label>", "phoneNumber": "+<intl number>" }
 * If Maytapi changes this format, edit here only.
 */
function buildButtonsPayload_(toNumber, body, buttons) {
  return {
    to_number: toNumber,
    type: 'buttons',
    message: String(body || ''),
    buttons: (buttons || []).map((b, i) => {
      const type = String(b.type || '').toUpperCase();
      if (type === 'URL') return { text: b.text, url: b.value };
      if (type === 'PHONE') return { text: b.text, phoneNumber: '+' + String(b.value).replace(/\D/g, '') };
      return { id: String(b.value || ('btn_' + (i + 1))), text: b.text };
    }),
  };
}

/** Not implemented on purpose — see file header. */
function sendMaytapiList_() {
  return failResult_(0, 'List messages are not enabled: payload not verified against the current Maytapi documentation.');
}

/** Not implemented on purpose — see file header. */
function sendMaytapiCarousel_() {
  return failResult_(0, 'Carousel messages are not enabled: payload not verified against the current Maytapi documentation.');
}

/* ============================== ACCOUNT / CONNECTION ============================== */

function maytapiListPhones_(cfg) {
  return maytapiRequest_('get', '/listPhones', null, cfg);
}

function maytapiPhoneStatus_(cfg) {
  cfg = cfg || getConfig_();
  return maytapiRequest_('get', phonePath_(cfg, 'status'), null, cfg);
}

function maytapiSetWebhook_(webhookUrl, cfg) {
  return maytapiRequest_('post', '/setWebhook', { webhook: webhookUrl }, cfg);
}

/**
 * Menu / editor: checks credentials, that MAYTAPI_PHONE_ID belongs to the product,
 * and the phone's connection status. Prints nothing secret.
 */
function testMaytapiConnection() {
  requireAdmin_();
  const cfg = getConfig_(true);
  const v = validateConfig_(cfg);
  const lines = [formatValidation_(v)];
  let ok = v.ok;
  if (v.ok) {
    const phones = maytapiListPhones_(cfg);
    if (!phones.success) {
      ok = false;
      lines.push('listPhones failed (HTTP ' + phones.httpStatus + '): ' + phones.error);
    } else {
      const list = Array.isArray(phones.response) ? phones.response : (phones.response && phones.response.data) || [];
      const match = Array.isArray(list) ? list.find(p => String(p.id) === String(cfg.phoneId)) : null;
      lines.push('Product reachable. Phones on product: ' + (Array.isArray(list) ? list.length : 'unknown') + '.');
      if (Array.isArray(list) && !match) { ok = false; lines.push('MAYTAPI_PHONE_ID was NOT found on this product.'); }
      if (match) lines.push('Sending phone: ' + maskPhone_(match.number || '') + ' (status: ' + (match.status || 'n/a') + ')');
      // Tenant dedicated numbers must also exist on this product.
      if (Array.isArray(list)) {
        readTable_(SHEETS.CLIENTS).rows.forEach(c => {
          const pid = String(c['Maytapi Phone ID'] || '').trim();
          if (!pid) return;
          const p = list.find(x => String(x.id) === pid);
          if (!p) { ok = false; lines.push('Tenant ' + c['Client ID'] + ': Maytapi Phone ID ' + pid + ' NOT found on this product.'); }
          else lines.push('Tenant ' + c['Client ID'] + ': phone ' + maskPhone_(p.number || '') + ' (status: ' + (p.status || 'n/a') + ')');
        });
      }
    }
    const st = maytapiPhoneStatus_(cfg);
    if (st.success) {
      const s = st.response && (st.response.status || st.response.data || st.response);
      lines.push('Phone status: ' + truncate_(safeJson_(s), 300));
    } else {
      lines.push('Phone status check failed (HTTP ' + st.httpStatus + '): ' + st.error);
    }
  }
  logEvent_(ok ? LOG_LEVEL.SUCCESS : LOG_LEVEL.ERROR, 'TEST_CONNECTION', { result: ok ? 'OK' : 'FAILED', details: lines.join(' | ') });
  try { SpreadsheetApp.getUi().alert('Maytapi connection test', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK); } catch (err) { console.log(lines.join('\n')); }
  return { ok: ok, details: lines };
}

/* ============================== Media.gs ============================== */

/**
 * Media.gs
 * Campaign image handling, isolated behind two functions:
 *
 *   processCampaignImage_(fileRef)  -> validates the Form upload, returns { fileId, ... }
 *   resolveMedia_(spec, cfg, cache) -> returns the value Maytapi's media "message" field receives
 *
 * MEDIA MODES (SETTINGS → MEDIA_MODE)
 *   BASE64 (default) — The Drive file's bytes are read by Apps Script and sent inline as a
 *                      data URI (data:image/jpeg;base64,...). Maytapi's media message accepts
 *                      either a public URL or base64 content, so the client's Drive file
 *                      never has to be made public. No extra hosting is required.
 *   URL              — Maytapi downloads the image from a public HTTPS URL. The URL is taken
 *                      from the campaign's "Image URL" column (admin can paste a CDN/S3/
 *                      Cloudinary/website link) or built as MEDIA_BASE_URL + "/" + file name.
 *
 * We deliberately do NOT build Google Drive "sharing"/"uc?export" links: they are not a
 * documented media host, can return HTML interstitials instead of image bytes, and would
 * require making the client's file public. To add another host later (S3, Cloudinary,
 * Firebase Storage…), add a branch in resolveMedia_ — nothing else in the system changes.
 */

/**
 * Validates the File Upload answer of the Google Form.
 * @param fileRef Drive URL(s) as stored in the response sheet, a bare file ID, or an
 *                array of IDs (FormResponse.getResponse() for file-upload items).
 * @return { ok, fileId, fileName, mimeType, sizeBytes, error }
 */
function processCampaignImage_(fileRef) {
  const cfg = getConfig_();
  const fileId = extractDriveFileId_(fileRef);
  if (!fileId) return { ok: false, error: 'No campaign image was uploaded or the file reference could not be read.' };

  let file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (err) {
    return { ok: false, fileId: fileId, error: 'The uploaded image could not be opened in Google Drive (deleted or no permission).' };
  }
  try {
    if (file.isTrashed()) return { ok: false, fileId: fileId, error: 'The uploaded image is in the Drive trash.' };
    const mimeType = file.getMimeType();
    const sizeBytes = file.getSize();
    if (String(mimeType).indexOf('image/') !== 0) {
      return { ok: false, fileId: fileId, error: 'The uploaded file is not an image (type: ' + mimeType + ').' };
    }
    if (SUPPORTED_IMAGE_MIME.indexOf(mimeType) < 0) {
      return { ok: false, fileId: fileId, error: 'Unsupported image format (' + mimeType + '). Please upload a JPG or PNG.' };
    }
    if (sizeBytes > cfg.maxImageMb * 1024 * 1024) {
      return { ok: false, fileId: fileId, error: 'Image is ' + (sizeBytes / 1048576).toFixed(1) + ' MB; the maximum is ' + cfg.maxImageMb + ' MB.' };
    }
    return { ok: true, fileId: fileId, fileName: file.getName(), mimeType: mimeType, sizeBytes: sizeBytes, error: '' };
  } catch (err) {
    return { ok: false, fileId: fileId, error: 'Google Drive error while reading the image: ' + err.message };
  }
}

/** Extracts the first Drive file ID from a URL, comma-separated list, array or bare ID. */
function extractDriveFileId_(ref) {
  if (!ref) return '';
  if (Array.isArray(ref)) ref = ref[0];
  const s = String(ref).split(',')[0].trim();
  if (!s) return '';
  let m = s.match(/[?&]id=([-\w]{20,})/);
  if (m) return m[1];
  m = s.match(/\/d\/([-\w]{20,})/);
  if (m) return m[1];
  if (/^[-\w]{20,}$/.test(s)) return s;
  return '';
}

/**
 * Returns { ok, media, filename, error } for a message spec { imageFileId, imageUrl }.
 * `cache` (optional object) memoises base64 per file within one execution.
 */
function resolveMedia_(spec, cfg, cache) {
  cfg = cfg || getConfig_();
  cache = cache || {};
  const fileId = String(spec.imageFileId || '').trim();
  const explicitUrl = String(spec.imageUrl || '').trim();

  if (cfg.mediaMode === 'URL' || (!fileId && explicitUrl)) {
    let url = explicitUrl;
    if (!url && fileId && cfg.mediaBaseUrl) {
      try { url = cfg.mediaBaseUrl + '/' + encodeURIComponent(DriveApp.getFileById(fileId).getName()); } catch (err) { url = ''; }
    }
    if (!/^https:\/\//i.test(url)) {
      return { ok: false, error: 'MEDIA_MODE=URL requires a public HTTPS Image URL (campaign "Image URL" column or MEDIA_BASE_URL).' };
    }
    return { ok: true, media: url, filename: url.split('/').pop().split('?')[0] || 'image' };
  }

  if (!fileId) return { ok: false, error: 'Campaign has no image.' };
  if (cache[fileId]) return cache[fileId];
  try {
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    const mime = blob.getContentType();
    if (SUPPORTED_IMAGE_MIME.indexOf(mime) < 0) return { ok: false, error: 'Unsupported image type ' + mime };
    const result = {
      ok: true,
      media: 'data:' + mime + ';base64,' + Utilities.base64Encode(blob.getBytes()),
      filename: file.getName(),
    };
    cache[fileId] = result;
    return result;
  } catch (err) {
    return { ok: false, error: 'Could not read campaign image from Drive: ' + err.message };
  }
}

/* ============================== Messaging.gs ============================== */

/**
 * Messaging.gs
 * Turns a "message spec" into Maytapi calls. Shared by the queue processor,
 * test messages and automated replies, so all three behave identically.
 *
 * spec = {
 *   phone:       '919876543210',
 *   text:        'rendered message',
 *   imageFileId: 'Drive file id' (optional),
 *   imageUrl:    'https://…'     (optional, MEDIA_MODE=URL),
 *   cta:         { type: 'URL'|'PHONE'|'QUICK_REPLY', text: 'Explore Now', value: '…' } (optional)
 * }
 */

/** Validates a spec before any API call. Returns '' or an error string. */
function validateMessageSpec_(spec, cfg) {
  if (!spec.phone || !normalizePhoneNumber(spec.phone)) return 'Invalid recipient phone number.';
  const hasImage = !!(spec.imageFileId || spec.imageUrl);
  if (!String(spec.text || '').trim() && !hasImage) return 'Message is empty.';
  if (String(spec.text || '').length > 4096) return 'Message exceeds the 4096-character WhatsApp limit.';
  if (spec.cta) {
    const err = validateCta_(spec.cta, cfg);
    if (err) return err;
  }
  return '';
}

/** Validates an already-rendered CTA. */
function validateCta_(cta, cfg) {
  cfg = cfg || getConfig_();
  const type = String(cta.type || '').toUpperCase();
  if (CTA_TYPES.indexOf(type) < 0) return 'CTA type must be URL, PHONE or QUICK_REPLY.';
  if (!String(cta.text || '').trim()) return 'CTA button text is empty.';
  if (String(cta.text).length > cfg.ctaTextMaxLength) return 'CTA button text must be at most ' + cfg.ctaTextMaxLength + ' characters.';
  if (type === 'URL' && !normalizeUrl_(cta.value)) return 'CTA URL is not a valid web address.';
  if (type === 'PHONE' && !normalizePhoneNumber(cta.value)) return 'CTA phone number is invalid.';
  if (type === 'QUICK_REPLY' && !String(cta.value || '').trim()) return 'Quick reply value is empty.';
  return '';
}

/** Text form of a CTA, used for CAPTION_LINK style and the button fallback. */
function ctaAsText_(cta) {
  if (!cta) return '';
  const type = String(cta.type).toUpperCase();
  if (type === 'URL') return '👉 ' + cta.text + ': ' + normalizeUrl_(cta.value);
  if (type === 'PHONE') return '📞 ' + cta.text + ': +' + normalizePhoneNumber(cta.value);
  return '💬 ' + cta.text + ' — reply "' + cta.value + '"';
}

function withCtaText_(text, cta) {
  const line = ctaAsText_(cta);
  return line ? (String(text || '').trim() + '\n\n' + line).trim() : String(text || '');
}

/**
 * Sends a spec. Returns the Maytapi-style result plus:
 *   messageIds[]  all message IDs created (image + button message)
 *   partial       true if the image went out but the follow-up text did not (do NOT retry)
 *   fallbackUsed  true if buttons were replaced by a text CTA
 */
function sendCampaignMessage_(spec, cfg, mediaCache) {
  cfg = cfg || getConfig_();
  const invalid = validateMessageSpec_(spec, cfg);
  if (invalid) return Object.assign(failResult_(0, invalid), { messageIds: [] });

  const to = normalizePhoneNumber(spec.phone);
  const text = String(spec.text || '');
  const cta = spec.cta && spec.cta.type ? {
    type: String(spec.cta.type).toUpperCase(),
    text: String(spec.cta.text).trim(),
    value: String(spec.cta.type).toUpperCase() === 'URL' ? normalizeUrl_(spec.cta.value) : String(spec.cta.value).trim(),
  } : null;

  let media = null;
  if (spec.imageFileId || spec.imageUrl) {
    media = resolveMedia_(spec, cfg, mediaCache);
    if (!media.ok) return Object.assign(failResult_(0, media.error), { messageIds: [] });
  }

  // 1) No CTA: one message.
  if (!cta) {
    const r = media ? sendMaytapiMedia_(to, media.media, captionSafe_(text), media.filename, cfg) : sendMaytapiText_(to, text, cfg);
    return finalize_(r, [r]);
  }

  // 2) CTA as text inside the caption/body (single bubble, always supported).
  if (cfg.imageCtaStyle === 'CAPTION_LINK') {
    const body = withCtaText_(text, cta);
    const r = media ? sendMaytapiMedia_(to, media.media, captionSafe_(body), media.filename, cfg) : sendMaytapiText_(to, body, cfg);
    return finalize_(r, [r]);
  }

  // 3) IMAGE_THEN_BUTTONS: image first (no caption), then the message with an interactive button.
  const results = [];
  if (media) {
    const r1 = sendMaytapiMedia_(to, media.media, '', media.filename, cfg);
    results.push(r1);
    if (!r1.success) return finalize_(r1, results);
  }
  const r2 = sendMaytapiButtons_(to, text, [cta], cfg);
  results.push(r2);
  if (r2.success) return finalize_(r2, results);

  // Button payload rejected (non-transient) => text fallback so the customer still gets the CTA.
  if (cfg.ctaFallbackToText && !r2.retryable && !r2.authError) {
    logEvent_(LOG_LEVEL.WARNING, 'BUTTON_FALLBACK', { phone: to, httpStatus: r2.httpStatus, error: r2.error, details: 'Buttons rejected; sending CTA as text.' });
    const r3 = sendMaytapiText_(to, withCtaText_(text, cta), cfg);
    results.push(r3);
    const out = finalize_(r3, results);
    out.fallbackUsed = true;
    if (!r3.success && media) out.partial = true;
    return out;
  }
  const out = finalize_(r2, results);
  if (media) out.partial = true; // image already delivered — retrying would duplicate it
  return out;
}

function captionSafe_(text) {
  // WhatsApp captions are limited to 1024 characters.
  return truncate_(text, 1024);
}

function finalize_(last, results) {
  const out = Object.assign({}, last);
  out.messageIds = results.filter(r => r.success && r.messageId).map(r => r.messageId);
  out.messageId = out.messageIds.join(',');
  out.partial = false;
  out.fallbackUsed = false;
  return out;
}

/** Builds the spec for a CAMPAIGNS row + contact (used by tests; the queue stores pre-rendered values). */
function buildSpecForContact_(campaign, contact, phone) {
  const ctaType = String(campaign['CTA Type'] || '').toUpperCase();
  return {
    phone: phone,
    text: renderTemplate(campaign['Message'], contact, campaign),
    imageFileId: campaign['Image File ID'],
    imageUrl: campaign['Image URL'],
    cta: CTA_TYPES.indexOf(ctaType) >= 0 ? {
      type: ctaType,
      text: renderTemplate(campaign['CTA Text'], contact, campaign),
      value: renderTemplate(campaign['CTA Value'], contact, campaign),
    } : null,
  };
}

/* ============================== Public.gs ============================== */

/**
 * Public.gs
 * Admin-only public entry points with the names used in the specification.
 *
 * The real implementations end in "_" (private), so google.script.run calls from the
 * client dashboard cannot reach them. These wrappers let the administrator run them from
 * the script editor or menu, and refuse anyone else (see requireAdmin_ in Security.gs).
 * Internal code always calls the "_" versions.
 */

/** Returns the configuration with secrets masked. */
function getConfig(forceReload) {
  requireAdmin_();
  const cfg = Object.assign({}, getConfig_(forceReload));
  cfg.apiToken = cfg.apiToken ? '***' : '';
  cfg.webhookSecret = cfg.webhookSecret ? '***' : '';
  return cfg;
}

function validateConfig() { requireAdmin_(); return validateConfig_(); }

function maytapiRequest(method, path, payload) { requireAdmin_(); return maytapiRequest_(method, path, payload); }
function sendMaytapiText(toNumber, text) { requireAdmin_(); return sendMaytapiText_(toNumber, text); }
function sendMaytapiMedia(toNumber, media, caption, filename) { requireAdmin_(); return sendMaytapiMedia_(toNumber, media, caption, filename); }
function sendMaytapiButtons(toNumber, body, buttons) { requireAdmin_(); return sendMaytapiButtons_(toNumber, body, buttons); }
function sendMaytapiList() { requireAdmin_(); return sendMaytapiList_(); }
function sendMaytapiCarousel() { requireAdmin_(); return sendMaytapiCarousel_(); }
function maytapiListPhones() { requireAdmin_(); return maytapiListPhones_(); }
function maytapiPhoneStatus() { requireAdmin_(); return maytapiPhoneStatus_(); }
function maytapiSetWebhook(webhookUrl) { requireAdmin_(); return maytapiSetWebhook_(webhookUrl); }

function processCampaignImage(fileRef) { requireAdmin_(); return processCampaignImage_(fileRef); }
function buildCampaignQueue(campaignId) { requireAdmin_(); return buildCampaignQueue_(campaignId); }
function startCampaign(campaignId) { requireAdmin_(); return startCampaign_(campaignId); }
function pauseCampaign(campaignId) { requireAdmin_(); return pauseCampaign_(campaignId); }
function resumeCampaign(campaignId) { requireAdmin_(); return resumeCampaign_(campaignId); }
function cancelCampaign(campaignId) { requireAdmin_(); return cancelCampaign_(campaignId); }
function activateScheduledCampaigns() { requireAdmin_(); return activateScheduledCampaigns_(); }
function processMessageQueue() { requireAdmin_(); return processMessageQueue_(); }
function retryFailedMessages(campaignId) { requireAdmin_(); return retryFailedMessages_(campaignId); }

/** Returns the webhook URL including its secret key — admin only. */
function getWebhookUrl() { requireAdmin_(); return getWebhookUrl_(); }

/* ============================== Queue.gs ============================== */

/**
 * Queue.gs
 * Queue building, batch processing with locking, throttling, retries and the scheduler.
 */

const MAX_EXECUTION_MS = 4.5 * 60 * 1000;     // stay well below Apps Script's 6-minute limit
const STUCK_PROCESSING_MS = 15 * 60 * 1000;   // PROCESSING rows older than this were interrupted

/**
 * Creates personalised MESSAGE_QUEUE rows for every eligible contact of a campaign.
 * Eligible = same Client ID, Opt In = YES, Status = Active, valid phone, audience match.
 * Duplicates (same campaign + phone) are never queued twice.
 * @return { added, skipped, duplicates }
 */
function buildCampaignQueue_(campaignId) {
  const cfg = getConfig_();
  const c = getCampaign_(campaignId);
  if (!c.row) throw new Error('Campaign ' + campaignId + ' not found.');
  const campaign = c.row;
  if ([CAMPAIGN_STATUS.CANCELLED, CAMPAIGN_STATUS.COMPLETED].indexOf(String(campaign['Status'])) >= 0) {
    throw new Error('Campaign ' + campaignId + ' is ' + campaign['Status'] + '.');
  }
  const clientId = String(campaign['Client ID']);
  const audience = String(campaign['Target Audience']);

  const existing = {};
  readTable_(SHEETS.MESSAGE_QUEUE).rows.forEach(q => {
    if (String(q['Campaign ID']) === campaignId) existing[normalizePhoneNumber(q['Phone'])] = true;
  });

  const contacts = readTable_(SHEETS.CONTACTS).rows;
  const now = new Date();
  const items = [];
  let skipped = 0;
  let duplicates = 0;
  const ctaType = String(campaign['CTA Type'] || '').toUpperCase();

  contacts.forEach(contact => {
    if (!isContactEligible_(contact, clientId) || !contactMatchesAudience_(contact, audience)) return;
    const phone = normalizePhoneNumber(contact['Phone'], cfg.defaultCountryCode);
    if (!phone) { skipped++; return; }
    if (existing[phone]) { duplicates++; return; }
    existing[phone] = true;
    const spec = buildSpecForContact_(campaign, contact, phone);
    items.push({
      'Campaign ID': campaignId,
      'Client ID': clientId,
      'Contact ID': contact['Contact ID'],
      'Phone': phone,
      'Name': contact['Name'],
      'Rendered Message': spec.text,
      'Image File ID': campaign['Image File ID'],
      'Image URL': campaign['Image URL'],
      'CTA Type': spec.cta ? ctaType : '',
      'CTA Text': spec.cta ? spec.cta.text : '',
      'CTA Value': spec.cta ? spec.cta.value : '',
      'Status': QUEUE_STATUS.PENDING,
      'Attempts': 0,
      'Scheduled At': now,
      'Created At': now,
    });
  });

  if (items.length) {
    const ids = newQueueIds_(items.length);
    items.forEach((it, i) => { it['Queue ID'] = ids[i]; });
    appendObjects_(SHEETS.MESSAGE_QUEUE, items);
  }
  logEvent_(LOG_LEVEL.INFO, 'QUEUE_BUILT', {
    campaignId: campaignId, clientId: clientId, result: items.length + ' queued',
    details: { added: items.length, invalidPhones: skipped, duplicates: duplicates, audience: audience },
  });
  return { added: items.length, skipped: skipped, duplicates: duplicates };
}

function countQueue_(campaignId, statuses) {
  return readTable_(SHEETS.MESSAGE_QUEUE).rows
    .filter(q => String(q['Campaign ID']) === campaignId && statuses.indexOf(String(q['Status'])) >= 0).length;
}

/** Bulk status change for one campaign (or all campaigns when campaignId is '*'). Returns count. */
function updateQueueStatusWhere_(campaignId, fromStatuses, toStatus, error) {
  const table = readTable_(SHEETS.MESSAGE_QUEUE);
  let n = 0;
  table.rows.forEach(q => {
    if ((campaignId === '*' || String(q['Campaign ID']) === campaignId) && fromStatuses.indexOf(String(q['Status'])) >= 0) {
      q['Status'] = toStatus;
      if (error !== undefined) q['Error'] = error;
      writeRowObject_(table, q);
      n++;
    }
  });
  return n;
}

/**
 * Sends up to BATCH_SIZE due messages. Safe to call from a trigger every minute:
 * a script lock prevents overlapping executions.
 */
function processMessageQueue_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    console.log('processMessageQueue: another execution holds the lock; skipping.');
    return { sent: 0, skippedRun: true };
  }
  try {
    return processMessageQueueLocked_();
  } finally {
    lock.releaseLock();
  }
}

function processMessageQueueLocked_() {
  const started = Date.now();
  const cfg = getConfig_(true);
  const v = validateConfig_(cfg);
  if (!v.ok) {
    logEvent_(LOG_LEVEL.ERROR, 'QUEUE_CONFIG_INVALID', { error: v.errors.join(' ') });
    return { sent: 0, error: 'config' };
  }

  const queue = readTable_(SHEETS.MESSAGE_QUEUE);
  const campaigns = {};
  readTable_(SHEETS.CAMPAIGNS).rows.forEach(r => { campaigns[r['Campaign ID']] = r; });
  const contactsTable = readTable_(SHEETS.CONTACTS);
  const contacts = {};
  contactsTable.rows.forEach(r => { contacts[r['Contact ID']] = r; });

  // Recover rows left in PROCESSING by an execution that died (timeout/crash).
  // Delivery is unknown, so they are marked FAILED (not resent automatically) to avoid duplicates.
  queue.rows.forEach(q => {
    const startedAt = toDate_(q['Started At']);
    if (String(q['Status']) === QUEUE_STATUS.PROCESSING && (!startedAt || Date.now() - startedAt.getTime() > STUCK_PROCESSING_MS)) {
      q['Status'] = QUEUE_STATUS.FAILED;
      q['Error'] = 'INTERRUPTED: execution stopped mid-send; delivery unknown. Use "Retry Failed Messages" to resend.';
      writeRowObject_(queue, q);
      logEvent_(LOG_LEVEL.WARNING, 'QUEUE_INTERRUPTED', { campaignId: q['Campaign ID'], contactId: q['Contact ID'], phone: q['Phone'] });
    }
  });

  // ---- Multi-tenant limits -------------------------------------------------
  // DAILY_SEND_LIMIT protects each WhatsApp number (per sending phone ID per day).
  // Monthly Quota / Valid Until / Status are per tenant (CLIENTS row).
  const clients = clientsById_();
  const today = todayKey_();
  const sentTodayByPhone = {};
  queue.rows.forEach(q => {
    if (dateKey_(toDate_(q['Sent At'])) !== today) return;
    const pid = String(q['Sender Phone ID'] || cfg.phoneId);
    sentTodayByPhone[pid] = (sentTodayByPhone[pid] || 0) + 1;
  });
  const usedThisMonth = monthlySentByClient_(queue.rows);
  const entitlement = {};
  const blockedCampaigns = {};
  const blockedPhones = {};

  const now = Date.now();
  const due = queue.rows.filter(q => {
    const st = String(q['Status']);
    if (st !== QUEUE_STATUS.PENDING && st !== QUEUE_STATUS.QUEUED) return false;
    const camp = campaigns[q['Campaign ID']];
    if (!camp || String(camp['Status']) !== CAMPAIGN_STATUS.ACTIVE) return false;
    const at = toDate_(q['Scheduled At']);
    return !at || at.getTime() <= now;
  }).sort((a, b) => (toDate_(a['Scheduled At']) || 0) - (toDate_(b['Scheduled At']) || 0));

  const mediaCache = {};
  let sent = 0, failed = 0, retried = 0, attempted = 0, dailyLimitHit = false;

  for (let i = 0; i < due.length && attempted < cfg.batchSize; i++) {
    if (Date.now() - started > MAX_EXECUTION_MS) {
      logEvent_(LOG_LEVEL.WARNING, 'QUEUE_TIME_BUDGET', { details: 'Stopping early to avoid the Apps Script timeout; next run continues.' });
      break;
    }
    const q = due[i];
    const clientId = String(q['Client ID']);
    const campaignId = String(q['Campaign ID']);
    if (blockedCampaigns[campaignId]) continue;
    const ctx = { campaignId: campaignId, clientId: clientId, contactId: q['Contact ID'], phone: q['Phone'] };

    // Tenant entitlement: suspended / expired / out of quota => pause the campaign (items are kept).
    const client = clients[clientId];
    if (!entitlement[clientId]) entitlement[clientId] = tenantEntitlement_(client, usedThisMonth[clientId] || 0);
    const ent = entitlement[clientId];
    if (!ent.ok || (ent.remaining !== null && ent.remaining <= 0)) {
      blockedCampaigns[campaignId] = true;
      setCampaignStatus_(campaignId, CAMPAIGN_STATUS.PAUSED, 'Sending paused: ' + (ent.reason || 'Monthly message quota reached.') + ' Resume after renewal.');
      logEvent_(LOG_LEVEL.WARNING, 'TENANT_LIMIT', Object.assign({ result: 'PAUSED', error: ent.reason || 'quota reached' }, ctx));
      continue;
    }

    // Per-number daily protection.
    const clientCfg = cfgForClient_(client, cfg);
    const phoneId = String(clientCfg.phoneId);
    if (blockedPhones[phoneId]) continue;
    if ((sentTodayByPhone[phoneId] || 0) >= cfg.dailySendLimit) {
      blockedPhones[phoneId] = true;
      dailyLimitHit = true;
      console.log('Daily send limit reached for phone ' + phoneId);
      continue;
    }

    // Opt-out always wins, even after queueing.
    const contact = contacts[q['Contact ID']];
    // Re-read Opt In right before sending so an opt-out received mid-batch is honoured.
    if (contact) contact['Opt In'] = contactsTable.sheet.getRange(contact._row, contactsTable.col['Opt In']).getValue();
    if (!contact || !isYes_(contact['Opt In']) || !/^active$/i.test(String(contact['Status'] || ''))) {
      q['Status'] = QUEUE_STATUS.SKIPPED;
      q['Error'] = 'Contact opted out, inactive or deleted before send.';
      writeRowObject_(queue, q);
      logEvent_(LOG_LEVEL.WARNING, 'SEND_SKIPPED', Object.assign({ result: 'SKIPPED', error: q['Error'] }, ctx));
      continue;
    }

    if (attempted > 0) randomDelay_(cfg);
    attempted++;
    q['Status'] = QUEUE_STATUS.PROCESSING;
    q['Started At'] = new Date();
    q['Last Attempt'] = new Date();
    q['Attempts'] = Number(q['Attempts'] || 0) + 1;
    q['Sender Phone ID'] = phoneId;
    writeRowObject_(queue, q);
    SpreadsheetApp.flush();

    let r;
    try {
      r = sendCampaignMessage_({
        phone: q['Phone'],
        text: q['Rendered Message'],
        imageFileId: q['Image File ID'],
        imageUrl: q['Image URL'],
        cta: q['CTA Type'] ? { type: q['CTA Type'], text: q['CTA Text'], value: q['CTA Value'] } : null,
      }, clientCfg, mediaCache);
    } catch (err) {
      r = Object.assign(failResult_(0, 'Unexpected error: ' + err.message, { retryable: true }), { messageIds: [] });
    }

    if (r.success) {
      q['Status'] = QUEUE_STATUS.SENT;
      q['Sent At'] = new Date();
      q['Message ID'] = r.messageId;
      q['Error'] = r.fallbackUsed ? 'Buttons rejected by API; CTA sent as text.' : '';
      writeRowObject_(queue, q);
      updateFields_(contactsTable, contact._row, { 'Last Sent': new Date(), 'Last Message ID': r.messageId, 'Updated At': new Date() });
      sent++;
      sentTodayByPhone[phoneId] = (sentTodayByPhone[phoneId] || 0) + 1;
      ent.used++;
      if (ent.remaining !== null) ent.remaining--;
      logEvent_(LOG_LEVEL.SUCCESS, 'MESSAGE_SENT', Object.assign({ messageId: r.messageId, httpStatus: r.httpStatus, result: 'SENT' }, ctx));
    } else {
      const attempts = Number(q['Attempts']);
      q['Error'] = truncate_(r.error, 1000);
      if (r.rateLimited) {
        q['Status'] = QUEUE_STATUS.QUEUED;
        q['Attempts'] = attempts - 1; // rate limiting is not the message's fault
        q['Scheduled At'] = new Date(Date.now() + cfg.retryBaseMinutes * 60000);
        retried++;
      } else if (r.retryable && !r.partial && attempts < cfg.maxRetries) {
        q['Status'] = QUEUE_STATUS.QUEUED;
        q['Scheduled At'] = new Date(Date.now() + cfg.retryBaseMinutes * Math.pow(2, attempts - 1) * 60000);
        retried++;
      } else {
        q['Status'] = QUEUE_STATUS.FAILED;
        if (r.partial) q['Error'] = 'PARTIAL: image sent, text/CTA failed — ' + q['Error'];
        if (r.messageId) q['Message ID'] = r.messageId;
        failed++;
      }
      writeRowObject_(queue, q);
      logEvent_(q['Status'] === QUEUE_STATUS.FAILED ? LOG_LEVEL.ERROR : LOG_LEVEL.WARNING, 'MESSAGE_FAILED', Object.assign({
        httpStatus: r.httpStatus, result: q['Status'], error: r.error,
        details: { attempts: attempts, retryable: !!r.retryable, rateLimited: !!r.rateLimited, partial: !!r.partial, senderPhoneId: phoneId },
      }, ctx));

      if (r.authError) {
        // The API token is shared by every tenant: stop everything.
        logEvent_(LOG_LEVEL.ERROR, 'QUEUE_BATCH_STOPPED', Object.assign({ error: r.error, details: 'Authentication problem — check Maytapi credentials.' }, ctx));
        notifyAdmin_('Maytapi authentication error', 'Queue processing stopped: ' + r.error);
        break;
      }
      if (r.stopBatch) {
        // Rate limit or a disconnected phone affects only this sending number.
        blockedPhones[phoneId] = true;
        logEvent_(LOG_LEVEL.ERROR, 'QUEUE_BATCH_STOPPED', Object.assign({ error: r.error, details: 'Rate limit or sending-phone problem on phone ' + phoneId + ' — other numbers continue; this one resumes next run.' }, ctx));
      }
    }
  }

  completeFinishedCampaigns_();
  if (attempted) console.log('Queue run: sent=' + sent + ' failed=' + failed + ' retry=' + retried);
  return { sent: sent, failed: failed, retried: retried, dailyLimitReached: dailyLimitHit && !attempted };
}

/**
 * Resets FAILED messages to PENDING (attempts cleared) for one campaign or all ('*').
 * Re-activates COMPLETED campaigns that get messages back.
 */
function retryFailedMessages_(campaignId) {
  const interactive = campaignId === undefined;
  if (interactive) {
    const ui = SpreadsheetApp.getUi();
    const r = ui.prompt('Retry Failed Messages', 'Campaign ID (or * for all campaigns):', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    campaignId = r.getResponseText().trim() || '*';
  }
  const table = readTable_(SHEETS.MESSAGE_QUEUE);
  const touched = {};
  let n = 0;
  table.rows.forEach(q => {
    if (String(q['Status']) !== QUEUE_STATUS.FAILED) return;
    if (campaignId !== '*' && String(q['Campaign ID']) !== campaignId) return;
    if (/^Invalid recipient/i.test(String(q['Error']))) return; // permanent: bad number
    q['Status'] = QUEUE_STATUS.PENDING;
    q['Attempts'] = 0;
    q['Scheduled At'] = new Date();
    q['Error'] = '';
    writeRowObject_(table, q);
    touched[q['Campaign ID']] = true;
    n++;
  });
  const campaigns = readTable_(SHEETS.CAMPAIGNS);
  Object.keys(touched).forEach(id => {
    const row = findRow_(campaigns, 'Campaign ID', id);
    if (row && [CAMPAIGN_STATUS.COMPLETED, CAMPAIGN_STATUS.ERROR].indexOf(String(row['Status'])) >= 0) {
      setCampaignStatus_(id, CAMPAIGN_STATUS.ACTIVE, 'Re-activated to retry failed messages.');
    }
  });
  logEvent_(LOG_LEVEL.INFO, 'RETRY_FAILED', { campaignId: campaignId === '*' ? '' : campaignId, result: n + ' reset' });
  if (interactive) SpreadsheetApp.getUi().alert(n + ' failed message(s) reset to PENDING.');
  return n;
}

/**
 * Time-driven entry point: activates due scheduled campaigns, then sends a batch.
 * Holds the script lock for both steps so two runs never activate the same campaign.
 */
function runScheduler() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    try {
      const n = activateScheduledCampaigns_();
      if (n) logEvent_(LOG_LEVEL.INFO, 'SCHEDULER', { result: n + ' campaign(s) activated' });
    } catch (err) {
      logEvent_(LOG_LEVEL.ERROR, 'SCHEDULER_ACTIVATE', { error: err.message });
    }
    processMessageQueueLocked_();
  } catch (err) {
    logEvent_(LOG_LEVEL.ERROR, 'SCHEDULER', { error: err.message, details: err.stack });
  } finally {
    lock.releaseLock();
  }
}

/* ============================== Security.gs ============================== */

/**
 * Security.gs
 * Admin guard, client logins (email + access code) and dashboard sessions.
 *
 * WHY AN ADMIN GUARD IS NEEDED
 * The client dashboard is served by this script's Web App (HtmlService). Any page served
 * that way can call ANY public (non "_") server function through google.script.run, and
 * the Web App executes as the owner. So every admin action is either private ("_") or
 * starts with requireAdmin_(), which only passes when the person running the code is
 * also the account it runs as (Sheet menu / script editor). Anonymous dashboard visitors
 * have an empty active user and are rejected. Dashboard calls go through api* functions
 * (ClientApi.gs), which require a valid client session instead.
 */

const SESSION_TTL_SECONDS = 6 * 60 * 60;   // CacheService maximum
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_SECONDS = 15 * 60;

/** Throws unless running as the present user (menu/editor), never for web-app visitors. */
function requireAdmin_() {
  let active = '';
  let effective = '';
  try { active = String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (err) { active = ''; }
  try { effective = String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (err) { effective = ''; }
  if (!active || active !== effective) {
    throw new Error('Administrator access required. Run this from the spreadsheet menu or script editor.');
  }
}

/* ============================== ACCESS CODES ============================== */

function hashAccessCode_(code, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + String(code).trim().toUpperCase(), Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function newAccessCode_() {
  // 10 characters from an unambiguous alphabet (~50 bits), grouped for readability.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now(), Utilities.Charset.UTF_8);
  let code = '';
  for (let i = 0; i < 10; i++) code += alphabet.charAt((bytes[i] & 0xff) % alphabet.length);
  return code.slice(0, 5) + '-' + code.slice(5);
}

/** Stores a fresh access code hash for a client row and returns the plain code (shown once). */
function issueAccessCode_(clientId) {
  const table = readTable_(SHEETS.CLIENTS);
  const row = findRow_(table, 'Client ID', clientId);
  if (!row) throw new Error('Client ' + clientId + ' not found.');
  const code = newAccessCode_();
  const salt = Utilities.getUuid().replace(/-/g, '');
  updateFields_(table, row._row, { 'Access Code Hash': salt + ':' + hashAccessCode_(code, salt), 'Updated At': new Date() });
  logEvent_(LOG_LEVEL.INFO, 'ACCESS_CODE_ISSUED', { clientId: clientId });
  return code;
}

function verifyAccessCode_(stored, code) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 2 || !code) return false;
  const actual = hashAccessCode_(code, parts[0]);
  // Constant-time comparison.
  let diff = actual.length ^ parts[1].length;
  for (let i = 0; i < Math.min(actual.length, parts[1].length); i++) diff |= actual.charCodeAt(i) ^ parts[1].charCodeAt(i);
  return diff === 0;
}

/** Menu: create (or update) a client and issue a dashboard access code. */
function createClientLogin() {
  requireAdmin_();
  const ui = SpreadsheetApp.getUi();
  const ask = (label, required) => {
    const r = ui.prompt('Create Client Login', label, ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) throw new Error('CANCELLED');
    const v = r.getResponseText().trim();
    if (required && !v) throw new Error(label + ' is required.');
    return v;
  };
  try {
    const businessName = ask('Business name', true);
    const email = ask('Client login email', true).toLowerCase();
    if (!isValidEmail_(email)) throw new Error('Invalid email.');
    const phone = ask('Store / business phone (optional)', false);
    const website = ask('Website (optional)', false);
    const clientId = findOrCreateClient_({
      businessName: businessName, email: email,
      storePhone: phone ? normalizePhoneNumber(phone) : '', website: website ? normalizeUrl_(website) : '',
    });
    const code = issueAccessCode_(clientId);
    ui.alert('Client login ready',
      'Client: ' + businessName + ' (' + clientId + ')\nLogin email: ' + email + '\nAccess code: ' + code +
      '\nDashboard: ' + (dashboardUrl_() || '(deploy the Web App first)') +
      '\n\nShare the access code privately. It is stored only as a hash and cannot be shown again.', ui.ButtonSet.OK);
  } catch (err) {
    if (err.message === 'CANCELLED') return;
    ui.alert('Create Client Login', 'Error: ' + err.message, ui.ButtonSet.OK);
  }
}

/** Menu: issue a new access code. The old code and every open session for that client stop working. */
function resetClientAccessCode() {
  requireAdmin_();
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Reset Client Access Code', 'Client ID (e.g. CLI-2026-0001):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  try {
    const code = issueAccessCode_(r.getResponseText().trim());
    ui.alert('New access code: ' + code + '\n\nShare it privately. It cannot be shown again.');
  } catch (err) {
    ui.alert('Error: ' + err.message);
  }
}

/** Menu: shows the client dashboard URL. */
function showDashboardUrl() {
  requireAdmin_();
  SpreadsheetApp.getUi().alert('Client dashboard URL', dashboardUrl_() || 'Deploy the Web App first (Deploy → New deployment → Web app).', SpreadsheetApp.getUi().ButtonSet.OK);
}

function dashboardUrl_() {
  const cfg = getConfig_(true);
  let base = cfg.webhookUrl;
  if (!base) { try { base = ScriptApp.getService().getUrl(); } catch (err) { base = ''; } }
  return String(base || '').replace(/\?.*$/, '');
}

/* ============================== SESSIONS ============================== */

function authError_(message) {
  const err = new Error(message || 'Your session has expired. Please sign in again.');
  err.code = 'AUTH';
  return err;
}

/**
 * Verifies email + access code. Returns { token, clientId }.
 * Failed attempts are rate-limited per email.
 */
function loginClient_(email, code) {
  email = String(email || '').trim().toLowerCase();
  code = String(code || '').trim().toUpperCase();
  if (!isValidEmail_(email) || !code) throw authError_('Enter your email and access code.');
  const cache = CacheService.getScriptCache();
  const failKey = 'loginfail_' + Utilities.base64EncodeWebSafe(email).slice(0, 200);
  const failures = Number(cache.get(failKey) || 0);
  if (failures >= LOGIN_MAX_FAILURES) throw authError_('Too many attempts. Try again in 15 minutes.');

  const table = readTable_(SHEETS.CLIENTS);
  const row = table.rows.find(r => String(r['Client Email']).trim().toLowerCase() === email);
  const ok = row && /^active$/i.test(String(row['Status'] || '')) && verifyAccessCode_(row['Access Code Hash'], code);
  if (!ok) {
    cache.put(failKey, String(failures + 1), LOGIN_LOCK_SECONDS);
    logEvent_(LOG_LEVEL.WARNING, 'CLIENT_LOGIN_FAILED', { details: email.replace(/^(.).*(@.*)$/, '$1***$2') });
    throw authError_('Email or access code is incorrect.');
  }
  cache.remove(failKey);
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  // The session remembers which code it was issued for, so a reset invalidates it.
  const codeTag = String(row['Access Code Hash']).slice(0, 16);
  cache.put('sess_' + token, JSON.stringify({ clientId: String(row['Client ID']), email: email, codeTag: codeTag }), SESSION_TTL_SECONDS);
  updateFields_(table, row._row, { 'Last Login': new Date() });
  logEvent_(LOG_LEVEL.INFO, 'CLIENT_LOGIN', { clientId: row['Client ID'] });
  return { token: token, clientId: String(row['Client ID']) };
}

/** Resolves a session token to { clientId, client } or throws an AUTH error. Sliding expiry. */
function requireSession_(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(String(token))) throw authError_();
  const cache = CacheService.getScriptCache();
  const raw = cache.get('sess_' + token);
  if (!raw) throw authError_();
  const s = JSON.parse(raw);
  const client = findRow_(readTable_(SHEETS.CLIENTS), 'Client ID', s.clientId);
  if (!client || !/^active$/i.test(String(client['Status'] || '')) || String(client['Access Code Hash']).slice(0, 16) !== s.codeTag) {
    cache.remove('sess_' + token);
    throw authError_('This account is not active. Contact your service provider.');
  }
  cache.put('sess_' + token, raw, SESSION_TTL_SECONDS);
  return { token: token, clientId: s.clientId, client: client };
}

function logoutClient_(token) {
  if (token && /^[a-f0-9]{64}$/.test(String(token))) CacheService.getScriptCache().remove('sess_' + token);
}

/* ============================== Tenants.gs ============================== */

/**
 * Tenants.gs
 * Multi-tenant controls. Each row in CLIENTS is a tenant (a business you sell the service to).
 *
 * Per-tenant columns in CLIENTS (all optional; edited by the administrator):
 *   Status            Active | Suspended   (Suspended blocks dashboard login and all sending)
 *   Plan              free text shown to the client, e.g. "Starter", "Pro"
 *   Maytapi Phone ID  the tenant's own WhatsApp number inside your Maytapi product.
 *                     Blank = the platform's shared number (Script Property MAYTAPI_PHONE_ID).
 *                     This is always admin-controlled; a client's Store Phone never changes it.
 *   Monthly Quota     max campaign messages per calendar month. Blank = unlimited.
 *   Valid Until       last day of the subscription (yyyy-MM-dd). Blank = no expiry.
 *
 * Isolation guarantees (enforced elsewhere, relied on here): campaigns only queue contacts
 * with the same Client ID; dashboard sessions only read/write their own Client ID; webhook
 * events arriving on a tenant's dedicated number are scoped to that tenant.
 */

function clientsById_() {
  const map = {};
  readTable_(SHEETS.CLIENTS).rows.forEach(r => { map[String(r['Client ID'])] = r; });
  return map;
}

/** The Maytapi phone ID this tenant sends from. */
function tenantPhoneId_(client, cfg) {
  cfg = cfg || getConfig_();
  const own = client ? String(client['Maytapi Phone ID'] || '').trim() : '';
  return own || cfg.phoneId;
}

/** Copy of the config whose phoneId is the tenant's sending number. */
function cfgForClient_(client, cfg) {
  cfg = cfg || getConfig_();
  return Object.assign({}, cfg, { phoneId: tenantPhoneId_(client, cfg) });
}

/** Clients that own `phoneId` as a dedicated number (empty for the shared platform number). */
function tenantsForPhoneId_(phoneId, cfg) {
  cfg = cfg || getConfig_();
  const id = String(phoneId || '').trim();
  if (!id || id === String(cfg.phoneId)) return [];
  return readTable_(SHEETS.CLIENTS).rows.filter(r => String(r['Maytapi Phone ID'] || '').trim() === id);
}

/** Every phone ID this deployment sends from (platform + tenant numbers). */
function knownPhoneIds_(cfg) {
  cfg = cfg || getConfig_();
  const ids = {};
  if (cfg.phoneId) ids[String(cfg.phoneId)] = true;
  readTable_(SHEETS.CLIENTS).rows.forEach(r => {
    const id = String(r['Maytapi Phone ID'] || '').trim();
    if (id) ids[id] = true;
  });
  return Object.keys(ids);
}

function monthKey_(d) {
  return d instanceof Date && !isNaN(d) ? Utilities.formatDate(d, getConfig_().timezone, 'yyyy-MM') : '';
}

/** { clientId: messages sent this calendar month } from MESSAGE_QUEUE rows. */
function monthlySentByClient_(queueRows) {
  const month = monthKey_(new Date());
  const out = {};
  queueRows.forEach(q => {
    if (monthKey_(toDate_(q['Sent At'])) === month) out[q['Client ID']] = (out[q['Client ID']] || 0) + 1;
  });
  return out;
}

/**
 * Can this tenant send right now?
 * @return { ok, reason, plan, quota, used, remaining, validUntil, dedicatedNumber }
 */
function tenantEntitlement_(client, usedThisMonth) {
  const plan = String((client && client['Plan']) || '').trim();
  const quotaRaw = String((client && client['Monthly Quota']) || '').trim();
  const quota = quotaRaw === '' ? null : Math.max(0, Number(quotaRaw) || 0);
  const used = Number(usedThisMonth || 0);
  const validUntil = client ? cellDateStr_(client['Valid Until']) : '';
  const out = {
    ok: true, reason: '', plan: plan, quota: quota, used: used,
    remaining: quota === null ? null : Math.max(0, quota - used),
    validUntil: validUntil,
    dedicatedNumber: !!(client && String(client['Maytapi Phone ID'] || '').trim()),
  };
  if (!client) { out.ok = false; out.reason = 'Client record not found.'; }
  else if (!/^active$/i.test(String(client['Status'] || ''))) { out.ok = false; out.reason = 'Account is ' + (client['Status'] || 'inactive') + '.'; }
  else if (validUntil && validUntil < todayKey_()) { out.ok = false; out.reason = 'Subscription expired on ' + validUntil + '.'; }
  else if (quota !== null && used >= quota) { out.ok = false; out.reason = 'Monthly message quota (' + quota + ') reached.'; }
  return out;
}

/** Entitlement for one client ID, counting this month's usage from the queue. */
function tenantEntitlementById_(clientId) {
  const client = clientsById_()[clientId];
  const used = monthlySentByClient_(readTable_(SHEETS.MESSAGE_QUEUE).rows)[clientId] || 0;
  return tenantEntitlement_(client, used);
}

/* ============================== Triggers.gs ============================== */

/**
 * Triggers.gs
 * Installable triggers. installTriggers() is idempotent: it never creates duplicates.
 *
 *   onFormSubmit     — installable "On form submit" on this spreadsheet
 *   runScheduler     — every QUEUE_INTERVAL_MINUTES: activate scheduled campaigns + send a batch
 *   refreshDashboard — every 30 minutes
 */

const MANAGED_TRIGGER_HANDLERS = ['onFormSubmit', 'runScheduler', 'refreshDashboard', 'processMessageQueue', 'activateScheduledCampaigns'];

function installTriggers() {
  requireAdmin_();
  const cfg = getConfig_(true);
  const existing = ScriptApp.getProjectTriggers();
  const has = fn => existing.some(t => t.getHandlerFunction() === fn);
  const created = [];

  if (!has('onFormSubmit')) {
    ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss_()).onFormSubmit().create();
    created.push('onFormSubmit (on form submit)');
  }
  if (!has('runScheduler')) {
    const minutes = [1, 5, 10, 15, 30].indexOf(cfg.queueIntervalMinutes) >= 0 ? cfg.queueIntervalMinutes : 5;
    ScriptApp.newTrigger('runScheduler').timeBased().everyMinutes(minutes).create();
    created.push('runScheduler (every ' + minutes + ' min)');
  }
  if (!has('refreshDashboard')) {
    ScriptApp.newTrigger('refreshDashboard').timeBased().everyMinutes(30).create();
    created.push('refreshDashboard (every 30 min)');
  }
  logEvent_(LOG_LEVEL.SUCCESS, 'INSTALL_TRIGGERS', { result: created.length + ' created', details: created.join(', ') || 'all present' });
  const msg = created.length ? 'Installed:\n' + created.join('\n') : 'All triggers already installed.';
  try { SpreadsheetApp.getUi().alert(msg + '\n\n' + describeTriggers_()); } catch (err) { console.log(msg); }
}

function removeTriggers() {
  requireAdmin_();
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (MANAGED_TRIGGER_HANDLERS.indexOf(t.getHandlerFunction()) >= 0) { ScriptApp.deleteTrigger(t); n++; }
  });
  logEvent_(LOG_LEVEL.WARNING, 'REMOVE_TRIGGERS', { result: n + ' removed' });
  try { SpreadsheetApp.getUi().alert(n + ' trigger(s) removed. Campaigns will not send until triggers are reinstalled.'); } catch (err) { console.log(n + ' removed'); }
}

function listTriggers() {
  requireAdmin_();
  const text = describeTriggers_();
  try { SpreadsheetApp.getUi().alert('Project triggers', text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (err) { console.log(text); }
  return text;
}

function describeTriggers_() {
  const list = ScriptApp.getProjectTriggers().map(t => '• ' + t.getHandlerFunction() + ' — ' + String(t.getEventType()));
  return list.length ? 'Current triggers:\n' + list.join('\n') : 'No triggers installed.';
}

/* ============================== Webhook.gs ============================== */

/**
 * Webhook.gs
 * Web App endpoints (doGet health check, doPost Maytapi webhook), automated replies
 * and opt-out handling.
 *
 * MAYTAPI WEBHOOK EVENTS (one JSON body per POST, field "type" identifies the event):
 *   "message" — incoming message:
 *       { type, product_id, phone_id, message: { type, text, fromMe, id, ... },
 *         user: { id: "<digits>@c.us", name, phone }, conversation: "<digits>@c.us",
 *         conversation_name, receiver, timestamp }
 *   "ack"     — delivery status of messages we sent:
 *       { type: "ack", product_id, phone_id, data: [ { msgId, ackType: "sent"|"delivered"|"read"|"failed", ackCode, chatId, time } ] }
 *   "status"  — sending phone state changes;  "error" — account/phone errors.
 * Parsing is defensive: unknown/missing fields never crash the handler, the raw payload
 * is always stored in RESPONSES, and unrecognised events are logged for review.
 *
 * SECURITY: Maytapi does not sign webhook requests, and Apps Script web apps cannot read
 * request headers. The webhook URL therefore carries a secret query parameter
 * (?key=WEBHOOK_SECRET) which is set via "Configure Webhook" and checked on every call.
 */

/**
 * GET: serves the client dashboard. ?health=1 returns a JSON health check (no secrets).
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.health !== undefined || p.format === 'json') {
    let configured = false;
    try { configured = validateConfig_(getConfig_(true)).ok; } catch (err) { configured = false; }
    return jsonOut_({
      status: 'ok',
      service: 'whatsapp-campaign-automation',
      version: SYSTEM_VERSION,
      configured: configured,
      time: new Date().toISOString(),
    });
  }
  return serveClientApp_();
}

/** Maytapi webhook receiver. Always returns 200 + JSON so Maytapi does not retry-storm. */
function doPost(e) {
  const cfg = getConfig_(true);
  try {
    if (cfg.webhookSecret) {
      const key = e && e.parameter ? String(e.parameter.key || '') : '';
      if (key !== cfg.webhookSecret) {
        logEvent_(LOG_LEVEL.WARNING, 'WEBHOOK_REJECTED', { error: 'Missing or invalid webhook key.' });
        return jsonOut_({ ok: false, error: 'unauthorized' });
      }
    }
    const raw = e && e.postData ? e.postData.contents : '';
    let payload;
    try { payload = JSON.parse(raw || '{}'); } catch (err) {
      logEvent_(LOG_LEVEL.WARNING, 'WEBHOOK_BAD_JSON', { error: err.message, details: truncate_(raw, 500) });
      return jsonOut_({ ok: false, error: 'invalid json' });
    }
    // Accept events for the platform number and every tenant's dedicated number; ignore others.
    const phoneId = String(payload.phone_id || payload.phoneId || '');
    if (phoneId && knownPhoneIds_(cfg).indexOf(phoneId) < 0) return jsonOut_({ ok: true, ignored: 'unknown phone' });

    const type = String(payload.type || '').toLowerCase();
    if (type === 'message') handleIncomingMessage_(payload, raw, cfg);
    else if (type === 'ack') handleAck_(payload, raw);
    else {
      recordResponse_({ eventType: type || 'unknown', status: payload.status || '', raw: raw, processed: 'LOGGED' });
      logEvent_(type === 'error' ? LOG_LEVEL.ERROR : LOG_LEVEL.INFO, 'WEBHOOK_' + (type || 'UNKNOWN').toUpperCase(), { details: truncate_(raw, 1000) });
      if (type === 'error') notifyAdmin_('Maytapi error event', truncate_(raw, 2000));
    }
    return jsonOut_({ ok: true });
  } catch (err) {
    logEvent_(LOG_LEVEL.ERROR, 'WEBHOOK_ERROR', { error: err.message, details: err.stack });
    return jsonOut_({ ok: false, error: 'internal' });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ============================== INCOMING MESSAGES ============================== */

function handleIncomingMessage_(payload, raw, cfg) {
  const m = payload.message || {};
  if (m.fromMe === true || m.fromMe === 'true') return; // our own outgoing messages echo back
  const conversation = String(payload.conversation || (payload.user && payload.user.id) || '');
  if (/@g\.us$/.test(conversation)) return; // group chats are out of scope

  // Webhook senders may redeliver the same event (Apps Script answers POSTs with a 302
  // redirect, which some senders treat as a failure). Process each message ID once.
  if (m.id && isDuplicateEvent_('msg:' + m.id)) return;

  const phone = normalizePhoneNumber((payload.user && payload.user.phone) || conversation.split('@')[0]);
  const name = (payload.user && payload.user.name) || payload.conversation_name || '';
  const text = String(m.text || m.caption || m.body || '').trim();

  // Tenant scope: a message to a tenant's dedicated number belongs to that tenant only.
  // On the shared platform number, the tenant is inferred from the last campaign received.
  const phoneId = String(payload.phone_id || payload.phoneId || cfg.phoneId || '');
  const dedicated = tenantsForPhoneId_(phoneId, cfg).map(c => String(c['Client ID']));
  const scope = dedicated.length ? dedicated : null;
  const replyCfg = Object.assign({}, cfg, { phoneId: phoneId || cfg.phoneId }); // reply from the receiving number
  const ctx = resolveContactContext_(phone, scope);

  const base = {
    clientId: ctx.clientId, campaignId: ctx.campaignId, phone: phone, name: name,
    messageId: m.id || '', messageType: m.type || '', text: text, eventType: 'message', raw: raw,
  };
  if (!phone) {
    recordResponse_(Object.assign(base, { status: 'IGNORED', processed: 'NO: unreadable sender' }));
    return;
  }

  // Track the response on the contact (or create an inbound lead).
  touchContactResponse_(ctx, phone, name, text, cfg);

  // 1) Opt-out keywords override everything.
  const upper = text.toUpperCase().replace(/[^\w ]/g, '').trim();
  if (upper && cfg.optOutKeywords.indexOf(upper) >= 0) {
    const n = optOutPhone_(phone, 'Keyword "' + upper + '"', scope);
    if (cfg.optOutReply) sendMaytapiText_(phone, cfg.optOutReply, replyCfg);
    recordResponse_(Object.assign(base, { status: 'OPTED_OUT', processed: 'YES: opt-out (' + n + ' contact record(s))' }));
    return;
  }

  // 2) Keyword auto-replies from TEMPLATES.
  let processed = 'NO: no matching template';
  if (cfg.autoReplyEnabled) {
    const candidates = replyCandidates_(m, text, ctx.campaign);
    const tpl = findReplyTemplate_(candidates, ctx.clientId);
    if (tpl) {
      const r = sendTemplateReply_(tpl, phone, ctx, replyCfg);
      processed = r.success ? 'YES: replied with ' + tpl['Template ID'] : 'ERROR: ' + r.error;
      logEvent_(r.success ? LOG_LEVEL.SUCCESS : LOG_LEVEL.ERROR, 'AUTO_REPLY', {
        clientId: ctx.clientId, campaignId: ctx.campaignId, contactId: ctx.contact && ctx.contact['Contact ID'],
        phone: phone, messageId: r.messageId, httpStatus: r.httpStatus, result: tpl['Template ID'], error: r.error,
      });
    }
  }
  recordResponse_(Object.assign(base, { status: 'RECEIVED', processed: processed }));
}

/** True if this event key was already seen in the last 6 hours (script cache). */
function isDuplicateEvent_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const k = 'wh_' + Utilities.base64EncodeWebSafe(String(key)).slice(0, 200);
    if (cache.get(k)) return true;
    cache.put(k, '1', 21600);
  } catch (err) { /* cache unavailable: fall through and process */ }
  return false;
}

/** Text, button payloads and (for QUICK_REPLY campaigns) the campaign's CTA value. */
function replyCandidates_(m, text, campaign) {
  const out = [text, m.payload, m.selectedButtonId, m.buttonId, m.button_id, m.selectedId, m.selectedRowId]
    .filter(v => v !== undefined && v !== null && String(v).trim() !== '')
    .map(v => String(v).trim().toLowerCase());
  if (campaign && String(campaign['CTA Type']).toUpperCase() === 'QUICK_REPLY' &&
      text.toLowerCase() === String(campaign['CTA Text']).trim().toLowerCase()) {
    out.push(String(campaign['CTA Value']).trim().toLowerCase());
  }
  return out;
}

/**
 * Finds the most recent campaign this phone received, plus the matching contact.
 * `scope` (array of Client IDs) limits the search to those tenants; null = all tenants.
 */
function resolveContactContext_(phone, scope) {
  const ctx = { clientId: scope && scope.length === 1 ? scope[0] : '', campaignId: '', campaign: null, contact: null, contactsTable: null };
  if (!phone) return ctx;
  const inScope = id => !scope || scope.indexOf(String(id)) >= 0;
  let latest = null;
  readTable_(SHEETS.MESSAGE_QUEUE).rows.forEach(q => {
    if (normalizePhoneNumber(q['Phone']) !== phone || !inScope(q['Client ID'])) return;
    const t = toDate_(q['Sent At']) || toDate_(q['Created At']);
    if (t && (!latest || t > latest.t)) latest = { t: t, q: q };
  });
  if (latest) {
    ctx.clientId = String(latest.q['Client ID']);
    ctx.campaignId = String(latest.q['Campaign ID']);
    ctx.campaign = getCampaign_(ctx.campaignId).row;
  }
  ctx.contactsTable = readTable_(SHEETS.CONTACTS);
  const matches = ctx.contactsTable.rows.filter(c => normalizePhoneNumber(c['Phone']) === phone && inScope(c['Client ID']));
  ctx.contact = matches.find(c => String(c['Client ID']) === ctx.clientId) || matches[0] || null;
  if (ctx.contact && !ctx.clientId) ctx.clientId = String(ctx.contact['Client ID'] || '');
  return ctx;
}

function touchContactResponse_(ctx, phone, name, text, cfg) {
  const now = new Date();
  if (ctx.contact) {
    updateFields_(ctx.contactsTable, ctx.contact._row, { 'Last Response': truncate_(text, 500), 'Updated At': now });
    return;
  }
  if (!cfg.createInboundContacts) return;
  // Unknown sender => lead. Opt In stays NO: messaging us is not marketing consent.
  appendObject_(SHEETS.CONTACTS, {
    'Contact ID': newContactIds_(1)[0], 'Client ID': ctx.clientId, 'Name': name, 'Phone': phone,
    'Tags': 'INBOUND', 'Audience': 'LEADS', 'Opt In': 'NO', 'Status': 'Active',
    'Last Response': truncate_(text, 500), 'Created At': now, 'Updated At': now,
  });
  logEvent_(LOG_LEVEL.INFO, 'LEAD_CREATED', { clientId: ctx.clientId, phone: phone });
}

/**
 * Opt-out: Opt In = NO and unsent queue items skipped for this phone.
 * scope = null (shared platform number): every tenant's record — the customer cannot tell
 *         which business a shared number represents, so we stop all marketing to them.
 * scope = [clientId] (tenant's dedicated number): only that tenant's records.
 * Returns the number of contact records changed.
 */
function optOutPhone_(phone, reason, scope) {
  const inScope = id => !scope || scope.indexOf(String(id)) >= 0;
  const contacts = readTable_(SHEETS.CONTACTS);
  let n = 0;
  contacts.rows.forEach(c => {
    if (normalizePhoneNumber(c['Phone']) === phone && inScope(c['Client ID'])) {
      updateFields_(contacts, c._row, { 'Opt In': 'NO', 'Updated At': new Date() });
      n++;
    }
  });
  const queue = readTable_(SHEETS.MESSAGE_QUEUE);
  queue.rows.forEach(q => {
    if (normalizePhoneNumber(q['Phone']) === phone && inScope(q['Client ID']) && [QUEUE_STATUS.PENDING, QUEUE_STATUS.QUEUED].indexOf(String(q['Status'])) >= 0) {
      updateFields_(queue, q._row, { 'Status': QUEUE_STATUS.SKIPPED, 'Error': 'Recipient opted out' });
    }
  });
  logEvent_(LOG_LEVEL.WARNING, 'OPT_OUT', { clientId: scope ? scope.join(',') : '', phone: phone, result: n + ' record(s)', details: reason + (scope ? '' : ' (shared number: all tenants)') });
  return n;
}

/* ============================== AUTO-REPLY ENGINE ============================== */

/**
 * First active template whose comma-separated Trigger list contains a candidate (case-insensitive).
 * Templates with this tenant's Client ID win over shared templates (blank Client ID).
 * Other tenants' templates are never used.
 */
function findReplyTemplate_(candidates, clientId) {
  if (!candidates.length) return null;
  const matches = t => String(t['Trigger'] || '').split(',')
    .map(s => s.trim().toLowerCase()).filter(Boolean)
    .some(trigger => candidates.indexOf(trigger) >= 0);
  const templates = readTable_(SHEETS.TEMPLATES).rows.filter(t => isYes_(t['Active']));
  const own = clientId ? templates.filter(t => String(t['Client ID'] || '').trim() === String(clientId)) : [];
  const shared = templates.filter(t => !String(t['Client ID'] || '').trim());
  return own.find(matches) || shared.find(matches) || null;
}

function sendTemplateReply_(tpl, phone, ctx, cfg) {
  const contact = ctx.contact || { Name: '', Phone: phone };
  const campaign = ctx.campaign || clientAsCampaign_(ctx.clientId);
  const type = String(tpl['Reply Type'] || 'TEXT').toUpperCase();
  const image = String(tpl['Image URL'] || '').trim();
  const spec = { phone: phone, text: renderTemplate(tpl['Reply Text'], contact, campaign) };
  if (image && (type === 'IMAGE' || type === 'BUTTONS')) {
    if (/^https:\/\//i.test(image)) spec.imageUrl = image; else spec.imageFileId = extractDriveFileId_(image);
  }
  if (type === 'BUTTONS' && tpl['Button Type']) {
    spec.cta = {
      type: String(tpl['Button Type']).toUpperCase(),
      text: renderTemplate(tpl['Button Text'], contact, campaign),
      value: renderTemplate(tpl['Button Value'], contact, campaign),
    };
  }
  return sendCampaignMessage_(spec, cfg, {});
}

/** Minimal campaign-like object from CLIENTS so {{StorePhone}}/{{Website}} work in replies. */
function clientAsCampaign_(clientId) {
  if (!clientId) return {};
  const c = findRow_(readTable_(SHEETS.CLIENTS), 'Client ID', clientId);
  return c ? { 'Client Name': c['Business Name'], 'Store Phone': c['Business Phone'], 'Website URL': c['Website'] } : {};
}

/* ============================== ACKS ============================== */

function handleAck_(payload, raw) {
  const acks = Array.isArray(payload.data) ? payload.data : (payload.data ? [payload.data] : []);
  if (!acks.length) {
    recordResponse_({ eventType: 'ack', status: 'EMPTY', raw: raw, processed: 'NO: no ack data' });
    return;
  }
  const queue = readTable_(SHEETS.MESSAGE_QUEUE);
  const byMsgId = {};
  queue.rows.forEach(q => String(q['Message ID'] || '').split(',').map(s => s.trim()).filter(Boolean).forEach(id => { byMsgId[id] = q; }));

  acks.forEach(a => {
    const msgId = String(a.msgId || a.id || a.messageId || '');
    const status = ackToStatus_(a);
    const q = byMsgId[msgId];
    let processed = 'NO: message not in queue';
    if (q && status) {
      const current = String(q['Status']);
      if (status === QUEUE_STATUS.FAILED) {
        updateFields_(queue, q._row, { 'Status': QUEUE_STATUS.FAILED, 'Error': 'Delivery failed (ack)' });
        processed = 'YES: FAILED';
      } else if ((QUEUE_STATUS_RANK[status] || 0) > (QUEUE_STATUS_RANK[current] || 0)) {
        updateFields_(queue, q._row, { 'Status': status });
        q['Status'] = status;
        processed = 'YES: ' + status;
      } else {
        processed = 'YES: no change (' + current + ')';
      }
    }
    recordResponse_({
      clientId: q ? q['Client ID'] : '', campaignId: q ? q['Campaign ID'] : '',
      phone: q ? q['Phone'] : normalizePhoneNumber(String(a.chatId || '').split('@')[0]),
      name: q ? q['Name'] : '', messageId: msgId, eventType: 'ack', status: status || String(a.ackType || a.ackCode || ''),
      raw: safeJson_(a), processed: processed,
    });
  });
}

function ackToStatus_(a) {
  const t = String(a.ackType || a.status || '').toLowerCase();
  if (t === 'read' || t === 'played' || t === 'viewed') return QUEUE_STATUS.READ;
  if (t === 'delivered' || t === 'received') return QUEUE_STATUS.DELIVERED;
  if (t === 'sent' || t === 'server') return QUEUE_STATUS.SENT;
  if (t === 'failed' || t === 'error') return QUEUE_STATUS.FAILED;
  const code = Number(a.ackCode);
  if (code >= 3) return QUEUE_STATUS.READ;
  if (code === 2) return QUEUE_STATUS.DELIVERED;
  if (code === 1) return QUEUE_STATUS.SENT;
  if (code < 0) return QUEUE_STATUS.FAILED;
  return '';
}

function recordResponse_(r) {
  appendObject_(SHEETS.RESPONSES, {
    'Timestamp': new Date(),
    'Client ID': r.clientId || '',
    'Campaign ID': r.campaignId || '',
    'Phone': r.phone || '',
    'Name': r.name || '',
    'Message ID': r.messageId || '',
    'Message Type': r.messageType || '',
    'Message Text': truncate_(r.text || '', 2000),
    'Event Type': r.eventType || '',
    'Status': r.status || '',
    'Raw Payload': truncate_(redactSecrets_(r.raw || ''), 45000),
    'Processed': r.processed || '',
  });
}

/* ============================== WEBHOOK SETUP ============================== */

/**
 * Returns the webhook URL including the secret key. Uses SETTINGS → WEBHOOK_URL if set,
 * otherwise ScriptApp.getService().getUrl() (the deployed Web App URL).
 */
function getWebhookUrl_() {
  const cfg = getConfig_(true);
  let base = cfg.webhookUrl;
  if (!base) { try { base = ScriptApp.getService().getUrl(); } catch (err) { base = ''; } }
  if (!base) return '';
  base = base.replace(/\?.*$/, '');
  return cfg.webhookSecret ? base + '?key=' + encodeURIComponent(cfg.webhookSecret) : base;
}

/** Menu: creates a webhook secret if needed and registers the URL with Maytapi (setWebhook). */
function configureWebhook() {
  requireAdmin_();
  ensureWebhookSecret_();
  const cfg = getConfig_(true);
  const v = validateConfig_(cfg);
  const ui = SpreadsheetApp.getUi();
  if (!v.ok) return ui.alert('Fix configuration first:\n' + v.errors.join('\n'));
  const url = getWebhookUrl_();
  if (!url) return ui.alert('No Web App URL found. Deploy → New deployment → Web app (Execute as: Me, Access: Anyone), then paste the /exec URL into SETTINGS → WEBHOOK_URL.');
  if (/\/dev(\?|$)/.test(url)) return ui.alert('The URL is a /dev test URL, which Maytapi cannot call. Paste the deployed /exec URL into SETTINGS → WEBHOOK_URL.');

  const r = maytapiSetWebhook_(url, cfg);
  if (r.success) {
    const settings = readTable_(SHEETS.SETTINGS);
    const row = findRow_(settings, 'Key', 'WEBHOOK_URL');
    if (row && !String(row['Value']).trim()) updateFields_(settings, row._row, { 'Value': url.replace(/\?.*$/, '') });
  }
  logEvent_(r.success ? LOG_LEVEL.SUCCESS : LOG_LEVEL.ERROR, 'CONFIGURE_WEBHOOK', { httpStatus: r.httpStatus, result: r.success ? 'OK' : 'FAILED', error: r.error });
  ui.alert(r.success
    ? 'Webhook registered with Maytapi:\n' + url.replace(/key=[^&]+/, 'key=***')
    : 'setWebhook failed (HTTP ' + r.httpStatus + '): ' + r.error);
}

/* ============================== ClientApp.html (embedded) ============================== */

const CLIENT_APP_HTML_ = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<base target=\"_top\">\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<title>Campaign Studio</title>\n<style>\n  :root {\n    --bg: #f4f6f5; --surface: #ffffff; --surface-2: #f8faf9; --text: #17201b; --muted: #5d6b63;\n    --line: #e1e7e3; --brand: #128c4a; --brand-dark: #0b6b38; --brand-soft: #e6f4ec;\n    --danger: #c0392b; --danger-soft: #fdecea; --warn: #9a6400; --warn-soft: #fff4dc;\n    --info-soft: #e8f0fe; --radius: 14px; --shadow: 0 1px 2px rgba(0,0,0,.05), 0 6px 20px rgba(0,0,0,.06);\n    --wa-bg: #efe7dd; --wa-bubble: #ffffff; --wa-header: #075e54; --wa-link: #027eb5;\n    --nav-h: 64px;\n  }\n  * { box-sizing: border-box; }\n  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text);\n    font: 15px/1.45 -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif;\n    -webkit-text-size-adjust: 100%; }\n  button, input, select, textarea { font: inherit; color: inherit; }\n  h1, h2, h3 { margin: 0; line-height: 1.25; }\n  h1 { font-size: 22px; } h2 { font-size: 18px; } h3 { font-size: 15px; }\n  .muted { color: var(--muted); } .small { font-size: 13px; } .hidden { display: none !important; }\n  a { color: var(--brand-dark); }\n\n  /* ---------- Buttons & inputs ---------- */\n  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px;\n    padding: 10px 18px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface);\n    cursor: pointer; font-weight: 600; transition: background .15s, border-color .15s; }\n  .btn:hover { background: var(--surface-2); }\n  .btn:disabled { opacity: .55; cursor: not-allowed; }\n  .btn.primary { background: var(--brand); border-color: var(--brand); color: #fff; }\n  .btn.primary:hover { background: var(--brand-dark); }\n  .btn.danger { color: var(--danger); border-color: #f0c4be; }\n  .btn.block { width: 100%; }\n  .btn.sm { min-height: 36px; padding: 6px 12px; font-size: 14px; }\n  label.field { display: block; margin-bottom: 14px; }\n  label.field > span { display: block; font-weight: 600; font-size: 14px; margin-bottom: 6px; }\n  .input, select.input, textarea.input { width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid var(--line);\n    border-radius: 10px; background: var(--surface); outline: none; }\n  .input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }\n  textarea.input { min-height: 140px; resize: vertical; }\n  .hint { font-size: 12.5px; color: var(--muted); margin-top: 5px; }\n  .row { display: flex; gap: 12px; flex-wrap: wrap; } .row > * { flex: 1 1 160px; }\n  .seg { display: flex; flex-wrap: wrap; gap: 6px; }\n  .seg button { flex: 1 1 auto; min-height: 40px; border: 1px solid var(--line); background: var(--surface);\n    border-radius: 999px; padding: 6px 14px; cursor: pointer; font-weight: 600; font-size: 14px; }\n  .seg button.on { background: var(--brand-soft); border-color: var(--brand); color: var(--brand-dark); }\n  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }\n  .chip { border: 1px dashed #b9c8bf; background: var(--surface-2); border-radius: 999px; padding: 4px 10px;\n    font-size: 12.5px; cursor: pointer; }\n  .check { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--line);\n    border-radius: 10px; background: var(--surface); cursor: pointer; margin-bottom: 8px; }\n  .check input { width: 20px; height: 20px; margin: 2px 0 0; accent-color: var(--brand); flex: none; }\n\n  /* ---------- Cards, alerts ---------- */\n  .card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow);\n    padding: 18px; margin-bottom: 16px; }\n  .card h2 { margin-bottom: 12px; }\n  .alert { padding: 12px 14px; border-radius: 10px; margin-bottom: 14px; font-size: 14px; }\n  .alert.error { background: var(--danger-soft); color: #8a2318; }\n  .alert.warn { background: var(--warn-soft); color: #6b4600; }\n  .alert.ok { background: var(--brand-soft); color: var(--brand-dark); }\n  .alert.info { background: var(--info-soft); color: #1d3f8f; }\n  .alert ul { margin: 6px 0 0 18px; padding: 0; }\n  .kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px; }\n  .kpi { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px; }\n  .kpi .v { font-size: 24px; font-weight: 700; } .kpi .l { font-size: 13px; color: var(--muted); }\n  .pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: .02em; }\n  .pill.ACTIVE, .pill.COMPLETED { background: var(--brand-soft); color: var(--brand-dark); }\n  .pill.SCHEDULED, .pill.READY, .pill.VALIDATING { background: var(--info-soft); color: #1d3f8f; }\n  .pill.PAUSED { background: var(--warn-soft); color: var(--warn); }\n  .pill.CANCELLED, .pill.ERROR { background: var(--danger-soft); color: var(--danger); }\n  .bar { height: 8px; background: var(--surface-2); border-radius: 999px; overflow: hidden; border: 1px solid var(--line); }\n  .bar > i { display: block; height: 100%; background: var(--brand); }\n  table.tbl { width: 100%; border-collapse: collapse; font-size: 13.5px; }\n  .tbl th, .tbl td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }\n  .tbl th { background: var(--surface-2); font-weight: 700; }\n  .scroll-x { overflow-x: auto; -webkit-overflow-scrolling: touch; border: 1px solid var(--line); border-radius: 10px; }\n\n  /* ---------- Login ---------- */\n  #login { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }\n  #login .card { width: 100%; max-width: 400px; padding: 26px; }\n  .logo { width: 48px; height: 48px; border-radius: 14px; background: var(--brand); color: #fff; display: grid; place-items: center;\n    font-weight: 800; font-size: 22px; margin-bottom: 14px; }\n\n  /* ---------- App shell ---------- */\n  header.top { position: sticky; top: 0; z-index: 20; background: var(--surface); border-bottom: 1px solid var(--line);\n    display: flex; align-items: center; gap: 12px; padding: 10px 16px; padding-top: max(10px, env(safe-area-inset-top)); }\n  header.top .who { flex: 1; min-width: 0; }\n  header.top .who b { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n  .avatar { width: 38px; height: 38px; border-radius: 50%; background: var(--brand); color: #fff; display: grid; place-items: center;\n    font-weight: 800; flex: none; }\n  main { max-width: 1200px; margin: 0 auto; padding: 16px 16px calc(var(--nav-h) + 24px + env(safe-area-inset-bottom)); }\n  nav.tabs { position: fixed; bottom: 0; left: 0; right: 0; z-index: 30; background: var(--surface); border-top: 1px solid var(--line);\n    display: grid; grid-template-columns: repeat(4, 1fr); height: calc(var(--nav-h) + env(safe-area-inset-bottom));\n    padding-bottom: env(safe-area-inset-bottom); }\n  nav.tabs button { border: 0; background: none; display: flex; flex-direction: column; align-items: center; justify-content: center;\n    gap: 3px; font-size: 11.5px; font-weight: 600; color: var(--muted); cursor: pointer; }\n  nav.tabs button svg { width: 22px; height: 22px; }\n  nav.tabs button.on { color: var(--brand); }\n  .view-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }\n\n  /* ---------- Create campaign ---------- */\n  .steps { display: flex; gap: 6px; margin-bottom: 14px; }\n  .steps button { flex: 1; border: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 8px 6px;\n    font-size: 13px; font-weight: 700; color: var(--muted); cursor: pointer; }\n  .steps button.on { border-color: var(--brand); color: var(--brand-dark); background: var(--brand-soft); }\n  .steps button.done { color: var(--brand-dark); }\n  .create-grid { display: grid; grid-template-columns: 1fr; gap: 16px; }\n  .preview-col { display: none; }\n  .drop { border: 2px dashed #bccbc2; border-radius: var(--radius); padding: 22px 14px; text-align: center; background: var(--surface-2);\n    cursor: pointer; position: relative; }\n  .drop.drag { border-color: var(--brand); background: var(--brand-soft); }\n  .drop input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }\n  .thumb-row { display: flex; align-items: center; gap: 12px; margin-top: 10px; }\n  .thumb-row canvas { width: 72px; height: 72px; border-radius: 10px; object-fit: cover; background: #ddd; }\n  details.more { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin-bottom: 14px; background: var(--surface-2); }\n  details.more summary { cursor: pointer; font-weight: 600; font-size: 14px; }\n  details.more[open] summary { margin-bottom: 10px; }\n  .fab-preview { position: fixed; right: 16px; bottom: calc(var(--nav-h) + 16px + env(safe-area-inset-bottom)); z-index: 25;\n    border-radius: 999px; box-shadow: 0 6px 18px rgba(18,140,74,.35); }\n  .sheet { position: fixed; inset: 0; z-index: 50; background: rgba(10,20,15,.55); display: flex; align-items: flex-end; justify-content: center; }\n  .sheet .panel { background: var(--bg); width: 100%; max-width: 480px; max-height: 92vh; overflow: auto; border-radius: 18px 18px 0 0;\n    padding: 14px 14px calc(18px + env(safe-area-inset-bottom)); }\n  .sheet .panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }\n  .summary dl { display: grid; grid-template-columns: 120px 1fr; gap: 8px 12px; margin: 0; font-size: 14px; }\n  .summary dt { color: var(--muted); } .summary dd { margin: 0; word-break: break-word; }\n  .list-check { max-height: 260px; overflow: auto; }\n\n  /* ---------- WhatsApp preview (protected) ---------- */\n  .protected { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; position: relative; }\n  .protected canvas, .protected img { pointer-events: none; -webkit-user-drag: none; }\n  .protected .shield { position: absolute; inset: 0; z-index: 5; background: transparent; }\n  .phone { width: 100%; max-width: 360px; margin: 0 auto; border-radius: 28px; background: #111; padding: 10px; box-shadow: var(--shadow); }\n  .screen { border-radius: 20px; overflow: hidden; background: var(--wa-bg);\n    background-image: radial-gradient(rgba(0,0,0,.035) 1px, transparent 1px); background-size: 14px 14px; }\n  .wa-head { background: var(--wa-header); color: #fff; display: flex; align-items: center; gap: 10px; padding: 10px 12px; }\n  .wa-head .avatar { width: 32px; height: 32px; background: #cfd8dc; color: #37474f; font-size: 14px; }\n  .wa-head b { display: block; font-size: 14px; } .wa-head span { font-size: 11.5px; opacity: .8; }\n  .chat { padding: 12px 10px 16px; min-height: 380px; display: flex; flex-direction: column; gap: 6px; }\n  .bubble { align-self: flex-start; max-width: 88%; background: var(--wa-bubble); border-radius: 0 10px 10px 10px; padding: 4px;\n    box-shadow: 0 1px .5px rgba(0,0,0,.13); position: relative; }\n  .bubble + .bubble { border-radius: 10px; }\n  .bubble canvas { display: block; width: 100%; border-radius: 7px; }\n  .bubble .txt { padding: 4px 6px 2px; font-size: 14px; white-space: pre-wrap; word-wrap: break-word; color: #111b21; }\n  .bubble .time { text-align: right; font-size: 10.5px; color: #667781; padding: 0 6px 2px; }\n  .bubble .cta { border-top: 1px solid #e9edef; margin-top: 4px; padding: 9px 6px 5px; text-align: center; color: var(--wa-link);\n    font-weight: 600; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 6px; }\n  .bubble .cta svg { width: 16px; height: 16px; }\n  .wm-note { text-align: center; font-size: 11.5px; color: var(--muted); margin-top: 8px; }\n  body.privacy .protected .screen { filter: blur(22px); }\n  body.privacy .protected::after { content: \"Preview hidden while this window is not in focus — tap to continue\"; position: absolute; inset: 40% 10% auto;\n    z-index: 6; background: rgba(0,0,0,.75); color: #fff; padding: 12px; border-radius: 10px; text-align: center; font-size: 13px; }\n\n  /* ---------- Toast / loading ---------- */\n  #toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(var(--nav-h) + 20px + env(safe-area-inset-bottom));\n    background: #1d2a23; color: #fff; padding: 10px 16px; border-radius: 10px; z-index: 60; font-size: 14px; max-width: 90vw; box-shadow: var(--shadow); }\n  #busy { position: fixed; inset: 0; background: rgba(255,255,255,.6); z-index: 70; display: grid; place-items: center; }\n  .spinner { width: 42px; height: 42px; border-radius: 50%; border: 4px solid var(--brand-soft); border-top-color: var(--brand); animation: spin 1s linear infinite; }\n  @keyframes spin { to { transform: rotate(360deg); } }\n\n  /* ---------- Larger screens ---------- */\n  @media (min-width: 640px) { .kpis { grid-template-columns: repeat(4, 1fr); } }\n  @media (min-width: 960px) {\n    :root { --nav-h: 0px; }\n    nav.tabs { position: sticky; top: 59px; height: auto; grid-template-columns: none; display: flex; justify-content: center; gap: 4px;\n      border-top: 0; border-bottom: 1px solid var(--line); padding: 6px; z-index: 19; }\n    nav.tabs button { flex-direction: row; font-size: 14px; padding: 8px 16px; border-radius: 10px; gap: 8px; }\n    nav.tabs button.on { background: var(--brand-soft); }\n    nav.tabs button svg { width: 18px; height: 18px; }\n    main { padding-bottom: 32px; }\n    .create-grid { grid-template-columns: minmax(0, 1fr) 380px; align-items: start; }\n    .preview-col { display: block; position: sticky; top: 120px; }\n    .fab-preview { display: none; }\n    #toast { bottom: 24px; }\n  }\n  @media print { .protected, .preview-col, .sheet { display: none !important; } body::before { content: \"Printing is disabled for campaign previews.\"; } }\n</style>\n</head>\n<body>\n\n<!-- ======================= LOGIN ======================= -->\n<section id=\"login\" class=\"hidden\">\n  <div class=\"card\">\n    <div class=\"logo\" id=\"loginLogo\">W</div>\n    <h1 id=\"loginTitle\">Campaign Studio</h1>\n    <p class=\"muted small\" style=\"margin:6px 0 18px\">Create WhatsApp ads, upload your customers and launch campaigns.</p>\n    <div id=\"loginError\" class=\"alert error hidden\"></div>\n    <form id=\"loginForm\" autocomplete=\"on\">\n      <label class=\"field\"><span>Email</span><input class=\"input\" type=\"email\" id=\"loginEmail\" autocomplete=\"username\" required></label>\n      <label class=\"field\"><span>Access code</span><input class=\"input\" type=\"password\" id=\"loginCode\" autocomplete=\"current-password\" placeholder=\"XXXXX-XXXXX\" required></label>\n      <button class=\"btn primary block\" type=\"submit\" id=\"loginBtn\">Sign in</button>\n    </form>\n    <p class=\"hint\" style=\"margin-top:14px\">Your access code is provided by your service provider.</p>\n  </div>\n</section>\n\n<!-- ======================= APP ======================= -->\n<section id=\"app\" class=\"hidden\">\n  <header class=\"top\">\n    <div class=\"avatar\" id=\"hdrAvatar\">?</div>\n    <div class=\"who\"><b id=\"hdrName\">—</b><span class=\"muted small\" id=\"hdrPlan\"></span></div>\n    <button class=\"btn sm\" id=\"logoutBtn\" type=\"button\">Sign out</button>\n  </header>\n\n  <nav class=\"tabs\" id=\"tabs\">\n    <button data-view=\"overview\" class=\"on\" type=\"button\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M3 12l9-8 9 8\"/><path d=\"M5 10v10h14V10\"/></svg>Home</button>\n    <button data-view=\"create\" type=\"button\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"3\"/><path d=\"M12 8v8M8 12h8\"/></svg>Create</button>\n    <button data-view=\"customers\" type=\"button\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"9\" cy=\"8\" r=\"3.5\"/><path d=\"M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5\"/><path d=\"M16 4.5a3.5 3.5 0 010 7M18.5 14.8c1.6.9 2.7 2.6 3 5.2\"/></svg>Customers</button>\n    <button data-view=\"campaigns\" type=\"button\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M4 6h16M4 12h16M4 18h10\"/></svg>Campaigns</button>\n  </nav>\n\n  <main>\n    <!-- ---------- OVERVIEW ---------- -->\n    <div id=\"view-overview\" class=\"view\">\n      <div class=\"view-head\"><h1>Welcome back</h1><button class=\"btn primary\" data-go=\"create\" type=\"button\">+ New campaign</button></div>\n      <div id=\"subAlert\"></div>\n      <div class=\"kpis\" id=\"kpis\"></div>\n      <div class=\"card\">\n        <h2>Plan &amp; usage</h2>\n        <div id=\"planBox\"></div>\n      </div>\n      <div class=\"card\">\n        <div class=\"view-head\" style=\"margin-bottom:8px\"><h2>Recent campaigns</h2><button class=\"btn sm\" data-go=\"campaigns\" type=\"button\">View all</button></div>\n        <div id=\"recentList\"></div>\n      </div>\n    </div>\n\n    <!-- ---------- CREATE ---------- -->\n    <div id=\"view-create\" class=\"view hidden\">\n      <div class=\"view-head\"><h1>Create campaign</h1></div>\n      <div class=\"steps\" id=\"steps\">\n        <button data-step=\"1\" class=\"on\" type=\"button\">1. Ad</button>\n        <button data-step=\"2\" type=\"button\">2. Audience &amp; time</button>\n        <button data-step=\"3\" type=\"button\">3. Review</button>\n      </div>\n      <div class=\"create-grid\">\n        <div>\n          <!-- Step 1 -->\n          <div id=\"step-1\" class=\"card\">\n            <label class=\"field\"><span>Campaign name</span><input class=\"input\" id=\"cName\" maxlength=\"80\" placeholder=\"e.g. Festive Offer\"></label>\n\n            <div class=\"field\">\n              <span style=\"display:block;font-weight:600;font-size:14px;margin-bottom:6px\">Ad image</span>\n              <div class=\"drop\" id=\"drop\">\n                <input type=\"file\" id=\"imgInput\" accept=\"image/jpeg,image/png,image/webp\">\n                <div><b>Tap to upload</b> or drag an image here</div>\n                <div class=\"hint\">JPG, PNG or WEBP. It will be optimised for WhatsApp automatically.</div>\n              </div>\n              <div class=\"thumb-row hidden\" id=\"thumbRow\">\n                <canvas id=\"thumb\" width=\"144\" height=\"144\"></canvas>\n                <div style=\"flex:1\"><div class=\"small\" id=\"imgInfo\"></div><button class=\"btn sm\" id=\"imgRemove\" type=\"button\" style=\"margin-top:6px\">Remove image</button></div>\n              </div>\n            </div>\n\n            <details class=\"more\" id=\"overlayBox\">\n              <summary>Add text on the image (optional)</summary>\n              <label class=\"field\"><span>Headline</span><input class=\"input\" id=\"ovHead\" maxlength=\"60\" placeholder=\"e.g. Festive Sale – Up to 30% Off\"></label>\n              <label class=\"field\"><span>Sub-text</span><input class=\"input\" id=\"ovSub\" maxlength=\"90\" placeholder=\"e.g. This weekend only\"></label>\n              <div class=\"row\">\n                <label class=\"field\"><span>Position</span>\n                  <select class=\"input\" id=\"ovPos\"><option value=\"bottom\">Bottom</option><option value=\"top\">Top</option></select></label>\n                <label class=\"field\"><span>Band colour</span><input class=\"input\" type=\"color\" id=\"ovColor\" value=\"#0b6b38\" style=\"padding:4px;height:44px\"></label>\n              </div>\n            </details>\n\n            <label class=\"field\"><span>Message</span>\n              <textarea class=\"input\" id=\"cMsg\" maxlength=\"1024\" placeholder=\"Hi {{Name}}, …\"></textarea>\n              <div class=\"chips\" id=\"varChips\"></div>\n              <div class=\"hint\"><span id=\"msgCount\">0</span>/1024 · *bold* _italic_ ~strike~ work in WhatsApp</div>\n            </label>\n\n            <div class=\"field\">\n              <span style=\"display:block;font-weight:600;font-size:14px;margin-bottom:6px\">Button</span>\n              <div class=\"seg\" id=\"ctaSeg\" style=\"margin-bottom:14px\">\n                <button data-cta=\"NONE\" type=\"button\">None</button>\n                <button data-cta=\"URL\" class=\"on\" type=\"button\">Website</button>\n                <button data-cta=\"PHONE\" type=\"button\">Call</button>\n                <button data-cta=\"QUICK_REPLY\" type=\"button\">Quick reply</button>\n              </div>\n            </div>\n            <div id=\"ctaFields\">\n              <div class=\"row\">\n                <label class=\"field\"><span>Button text</span><input class=\"input\" id=\"ctaText\" placeholder=\"Explore Now\"><div class=\"hint\" id=\"ctaTextHint\"></div></label>\n                <label class=\"field\"><span id=\"ctaValueLabel\">Link</span><input class=\"input\" id=\"ctaValue\"><div class=\"hint\" id=\"ctaValueHint\"></div></label>\n              </div>\n            </div>\n            <details class=\"more\">\n              <summary>Business details used in the message</summary>\n              <div class=\"row\">\n                <label class=\"field\"><span>Website</span><input class=\"input\" id=\"cWebsite\" placeholder=\"https://\"></label>\n                <label class=\"field\"><span>Store phone</span><input class=\"input\" id=\"cStorePhone\" inputmode=\"tel\"></label>\n              </div>\n              <label class=\"field\"><span>Preview customer name</span><input class=\"input\" id=\"cPreviewName\" maxlength=\"40\"></label>\n            </details>\n            <div id=\"step1Err\"></div>\n            <button class=\"btn primary block\" id=\"toStep2\" type=\"button\">Next: audience &amp; time</button>\n          </div>\n\n          <!-- Step 2 -->\n          <div id=\"step-2\" class=\"card hidden\">\n            <h2>Who should receive it?</h2>\n            <label class=\"check\"><input type=\"radio\" name=\"aud\" value=\"all\" checked><div><b>All my opted-in customers</b><div class=\"small muted\" id=\"allCount\"></div></div></label>\n            <label class=\"check\"><input type=\"radio\" name=\"aud\" value=\"lists\"><div><b>Selected customer lists</b><div class=\"small muted\">Choose one or more uploaded lists</div></div></label>\n            <div id=\"listPicker\" class=\"list-check hidden\" style=\"margin:4px 0 10px 12px\"></div>\n            <div class=\"alert info\" id=\"audCount\">Recipients: …</div>\n\n            <h2 style=\"margin-top:18px\">When?</h2>\n            <div class=\"seg\" id=\"whenSeg\" style=\"margin-bottom:12px\">\n              <button data-when=\"NOW\" class=\"on\" type=\"button\">Send now</button>\n              <button data-when=\"SCHEDULE\" type=\"button\">Schedule</button>\n            </div>\n            <div class=\"row hidden\" id=\"schedFields\">\n              <label class=\"field\"><span>Date</span><input class=\"input\" type=\"date\" id=\"sDate\"></label>\n              <label class=\"field\"><span>Time</span><input class=\"input\" type=\"time\" id=\"sTime\"></label>\n            </div>\n            <div class=\"hint\" id=\"tzHint\"></div>\n            <div id=\"step2Err\" style=\"margin-top:12px\"></div>\n            <div class=\"row\" style=\"margin-top:12px\">\n              <button class=\"btn\" data-step-go=\"1\" type=\"button\">Back</button>\n              <button class=\"btn primary\" id=\"toStep3\" type=\"button\">Next: review</button>\n            </div>\n          </div>\n\n          <!-- Step 3 -->\n          <div id=\"step-3\" class=\"card hidden\">\n            <h2>Review &amp; launch</h2>\n            <div class=\"summary\" id=\"summary\"></div>\n            <div style=\"margin:16px 0\" id=\"reviewPreviewWrap\"><div id=\"reviewPreview\"></div></div>\n            <div id=\"launchErr\"></div>\n            <div class=\"row\">\n              <button class=\"btn\" data-step-go=\"2\" type=\"button\">Back</button>\n              <button class=\"btn primary\" id=\"launchBtn\" type=\"button\">Launch campaign</button>\n            </div>\n          </div>\n\n          <!-- Done -->\n          <div id=\"step-done\" class=\"card hidden\">\n            <div class=\"alert ok\" id=\"doneMsg\"></div>\n            <div id=\"doneWarn\"></div>\n            <div class=\"row\">\n              <button class=\"btn\" data-go=\"campaigns\" type=\"button\">View campaigns</button>\n              <button class=\"btn primary\" id=\"newAgain\" type=\"button\">Create another</button>\n            </div>\n          </div>\n        </div>\n\n        <aside class=\"preview-col\"><div id=\"livePreview\"></div></aside>\n      </div>\n      <button class=\"btn primary fab-preview\" id=\"fabPreview\" type=\"button\">👁 Preview</button>\n    </div>\n\n    <!-- ---------- CUSTOMERS ---------- -->\n    <div id=\"view-customers\" class=\"view hidden\">\n      <div class=\"view-head\"><h1>Customers</h1></div>\n      <div class=\"kpis\" id=\"custKpis\"></div>\n      <div class=\"card\">\n        <h2>Upload customers</h2>\n        <p class=\"muted small\" style=\"margin-top:-6px\">Excel (.xlsx, .xls) or CSV. Required column: phone number. Optional: name, email, company, tags, opt-in.\n          <a href=\"#\" id=\"sampleCsv\">Download a sample file</a></p>\n        <div class=\"drop\" id=\"custDrop\">\n          <input type=\"file\" id=\"custInput\" accept=\".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\">\n          <div><b>Tap to choose a file</b> or drag it here</div>\n          <div class=\"hint\">Up to <span id=\"maxRows\">5000</span> customers per upload</div>\n        </div>\n        <div id=\"parseBox\" class=\"hidden\" style=\"margin-top:14px\">\n          <div class=\"alert info\" id=\"parseInfo\"></div>\n          <h3 style=\"margin-bottom:8px\">Match your columns</h3>\n          <div class=\"row\" id=\"mapFields\"></div>\n          <h3 style=\"margin:6px 0 8px\">Preview</h3>\n          <div class=\"scroll-x\"><table class=\"tbl\" id=\"parsePreview\"></table></div>\n          <label class=\"field\" style=\"margin-top:14px\"><span>List name</span>\n            <input class=\"input\" id=\"listName\" maxlength=\"40\" placeholder=\"e.g. Diwali 2026 customers\">\n            <div class=\"hint\">Customers are tagged with this name so you can target them later.</div></label>\n          <label class=\"check\"><input type=\"checkbox\" id=\"consent\"><div class=\"small\"><b>I confirm these customers agreed to receive WhatsApp messages from my business.</b>\n            Customers who previously replied STOP will stay unsubscribed.</div></label>\n          <div id=\"uploadErr\"></div>\n          <button class=\"btn primary block\" id=\"importBtn\" type=\"button\">Import customers</button>\n        </div>\n        <div id=\"uploadResult\"></div>\n      </div>\n      <div class=\"card\">\n        <h2>Your lists</h2>\n        <div id=\"listsTable\"></div>\n      </div>\n    </div>\n\n    <!-- ---------- CAMPAIGNS ---------- -->\n    <div id=\"view-campaigns\" class=\"view hidden\">\n      <div class=\"view-head\"><h1>Campaigns</h1><button class=\"btn sm\" id=\"refreshBtn\" type=\"button\">↻ Refresh</button></div>\n      <div id=\"campaignList\"></div>\n    </div>\n  </main>\n</section>\n\n<!-- Preview sheet (mobile + campaign previews) -->\n<div class=\"sheet hidden\" id=\"sheet\">\n  <div class=\"panel\">\n    <div class=\"panel-head\"><h2 id=\"sheetTitle\">Preview</h2><button class=\"btn sm\" id=\"sheetClose\" type=\"button\">Close</button></div>\n    <div id=\"sheetBody\"></div>\n  </div>\n</div>\n<div id=\"toast\" class=\"hidden\"></div>\n<div id=\"busy\" class=\"hidden\"><div class=\"spinner\"></div></div>\n\n<script>\n(function () {\n  'use strict';\n\n  /* =================================================================\n   * State & helpers\n   * ================================================================= */\n  var S = {\n    token: null, boot: null, view: 'overview', step: 1,\n    image: null,          // { original: HTMLImageElement|ImageBitmap, final: dataURL, finalImg: Image, bytes }\n    cta: 'URL', when: 'NOW', aud: 'all', lists: [], audCount: null,\n    upload: null,         // { header: [], rows: [[]], map: {} }\n  };\n  var $ = function (id) { return document.getElementById(id); };\n  var qsa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };\n  function esc(s) { return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]; }); }\n  function show(el, on) { (typeof el === 'string' ? $(el) : el).classList.toggle('hidden', !on); }\n  function toast(msg) { var t = $('toast'); t.textContent = msg; show(t, true); clearTimeout(toast._t); toast._t = setTimeout(function () { show(t, false); }, 3200); }\n  function busy(on) { show('busy', on); }\n  function alertBox(kind, title, items) {\n    if (!title && (!items || !items.length)) return '';\n    return '<div class=\"alert ' + kind + '\">' + (title ? esc(title) : '') +\n      (items && items.length ? '<ul>' + items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>' : '') + '</div>';\n  }\n  function store(k, v) { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }\n  function load(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }\n\n  /** google.script.run as a Promise. Expired sessions return to the login screen. */\n  function api(fn) {\n    var args = Array.prototype.slice.call(arguments, 1);\n    return new Promise(function (resolve, reject) {\n      google.script.run\n        .withSuccessHandler(function (r) {\n          if (r && r.ok === false && r.code === 'AUTH' && fn !== 'apiLogin') { signOut(r.error); return reject(new Error(r.error)); }\n          resolve(r);\n        })\n        .withFailureHandler(function (e) { reject(e instanceof Error ? e : new Error(String(e && e.message || e))); })[fn].apply(null, args);\n    });\n  }\n\n  function digits(s) { return String(s || '').replace(/\\D/g, ''); }\n  function normPhone(p) {\n    var raw = String(p || '').trim(); if (!raw) return '';\n    var plus = raw.charAt(0) === '+'; var d = digits(raw);\n    if (!plus) { if (d.indexOf('00') === 0) d = d.slice(2); else { d = d.replace(/^0+/, ''); if (d.length <= 10) d = (S.boot ? S.boot.settings.defaultCountryCode : '') + d; } }\n    return d.length >= 8 && d.length <= 15 ? d : '';\n  }\n  function normUrl(u) {\n    u = String(u || '').trim(); if (!u) return '';\n    if (!/^[a-z][a-z0-9+.-]*:\\/\\//i.test(u)) u = 'https://' + u;\n    return /^https?:\\/\\/[^\\s/?#]+\\.[^\\s/?#]+([/?#][^\\s]*)?$/i.test(u) ? u : '';\n  }\n\n  /** Mirrors the server's renderTemplate(): case/space-insensitive, unknown variables removed. */\n  function renderVars(text, previewName) {\n    var p = S.boot.profile;\n    var sp = normPhone($('cStorePhone').value);\n    var vars = {\n      name: previewName || S.boot.settings.defaultContactName, phone: '', email: '', company: '',\n      clientname: p.businessName, campaignname: $('cName').value.trim(),\n      storephone: sp ? '+' + sp : $('cStorePhone').value.trim(), website: normUrl($('cWebsite').value) || $('cWebsite').value.trim(),\n    };\n    return String(text || '').replace(/\\{\\{\\s*([A-Za-z_][\\w ]*?)\\s*\\}\\}/g, function (m, k) {\n      k = k.replace(/[\\s_]/g, '').toLowerCase();\n      return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : '';\n    });\n  }\n  /** WhatsApp-style formatting for the preview (after escaping). */\n  function waFormat(t) {\n    return esc(t).replace(/\\*([^*\\n]+)\\*/g, '<b>$1</b>').replace(/_([^_\\n]+)_/g, '<i>$1</i>').replace(/~([^~\\n]+)~/g, '<s>$1</s>');\n  }\n\n  /* =================================================================\n   * Auth\n   * ================================================================= */\n  function showLogin(msg) {\n    show('app', false); show('login', true);\n    $('loginError').textContent = msg || ''; show('loginError', !!msg);\n  }\n  function signOut(msg) {\n    if (S.token) { try { google.script.run.apiLogout(S.token); } catch (e) { /* ignore */ } }\n    S.token = null; store('cs_token', null); showLogin(msg);\n  }\n  $('loginForm').addEventListener('submit', function (e) {\n    e.preventDefault();\n    var btn = $('loginBtn'); btn.disabled = true; btn.textContent = 'Signing in…'; show('loginError', false);\n    api('apiLogin', $('loginEmail').value, $('loginCode').value).then(function (r) {\n      btn.disabled = false; btn.textContent = 'Sign in';\n      if (!r || !r.ok) { $('loginError').textContent = (r && r.error) || 'Sign-in failed.'; show('loginError', true); return; }\n      S.token = r.token; store('cs_token', r.token); $('loginCode').value = '';\n      startApp(r);\n    }).catch(function (err) { btn.disabled = false; btn.textContent = 'Sign in'; $('loginError').textContent = err.message; show('loginError', true); });\n  });\n  $('logoutBtn').addEventListener('click', function () { signOut(); });\n\n  function startApp(boot) {\n    S.boot = boot;\n    show('login', false); show('app', true);\n    renderShell(); resetCreate(); go(S.view || 'overview');\n  }\n\n  /* =================================================================\n   * Navigation\n   * ================================================================= */\n  function go(view) {\n    S.view = view;\n    qsa('.view').forEach(function (v) { show(v, v.id === 'view-' + view); });\n    qsa('#tabs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-view') === view); });\n    if (view === 'overview') renderOverview();\n    if (view === 'customers') renderCustomers();\n    if (view === 'campaigns') renderCampaigns();\n    if (view === 'create') { renderPreviewTargets(); refreshAudienceCount(); }\n    window.scrollTo(0, 0);\n  }\n  qsa('#tabs button').forEach(function (b) { b.addEventListener('click', function () { go(b.getAttribute('data-view')); }); });\n  document.addEventListener('click', function (e) {\n    var g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); go(g.getAttribute('data-go')); }\n  });\n\n  function renderShell() {\n    var p = S.boot.profile, sub = S.boot.subscription || {};\n    $('hdrName').textContent = p.businessName;\n    $('hdrAvatar').textContent = (p.businessName || '?').trim().charAt(0).toUpperCase();\n    $('hdrPlan').textContent = (sub.plan ? sub.plan + ' plan' : '') + (sub.validUntil ? ' · valid until ' + sub.validUntil : '');\n    document.title = p.businessName + ' · ' + S.boot.settings.systemName;\n  }\n\n  /* =================================================================\n   * Overview\n   * ================================================================= */\n  function sumStats(key) { return S.boot.campaigns.reduce(function (n, c) { return n + (c.stats[key] || 0); }, 0); }\n  function renderOverview() {\n    var b = S.boot, sub = b.subscription || {};\n    var active = b.campaigns.filter(function (c) { return c.status === 'ACTIVE'; }).length;\n    var sched = b.campaigns.filter(function (c) { return c.status === 'SCHEDULED'; }).length;\n    var sent = sumStats('sent'), delivered = sumStats('delivered'), read = sumStats('read');\n    var replies = b.campaigns.reduce(function (n, c) { return n + c.replies; }, 0);\n    $('kpis').innerHTML = [\n      ['Opted-in customers', b.stats.optedIn], ['Active / scheduled', active + ' / ' + sched],\n      ['Messages sent', sent], ['Delivered', sent ? Math.round(delivered / sent * 100) + '%' : '—'],\n      ['Read', sent ? Math.round(read / sent * 100) + '%' : '—'], ['Replies', replies],\n      ['Campaigns', b.campaigns.length], ['Opted out', b.stats.optedOut],\n    ].map(function (k) { return '<div class=\"kpi\"><div class=\"v\">' + esc(k[1]) + '</div><div class=\"l\">' + esc(k[0]) + '</div></div>'; }).join('');\n    $('subAlert').innerHTML = sub.canSend === false ? alertBox('warn', 'Sending is paused: ' + sub.reason + ' Please contact your service provider.') : '';\n    var pct = sub.quota ? Math.min(100, Math.round(sub.used / sub.quota * 100)) : 0;\n    $('planBox').innerHTML =\n      '<div class=\"summary\"><dl>' +\n      '<dt>Plan</dt><dd>' + esc(sub.plan || 'Standard') + '</dd>' +\n      '<dt>Valid until</dt><dd>' + esc(sub.validUntil || 'No expiry') + '</dd>' +\n      '<dt>This month</dt><dd>' + esc(sub.used || 0) + (sub.quota !== null && sub.quota !== undefined ? ' of ' + esc(sub.quota) + ' messages' : ' messages (unlimited plan)') + '</dd>' +\n      '<dt>Sending number</dt><dd>' + (sub.dedicatedNumber ? 'Your dedicated WhatsApp number' : 'Shared platform number') + '</dd>' +\n      '</dl></div>' + (sub.quota ? '<div class=\"bar\" style=\"margin-top:12px\"><i style=\"width:' + pct + '%\"></i></div>' : '');\n    $('recentList').innerHTML = b.campaigns.length ? b.campaigns.slice(0, 4).map(campaignRow).join('') : '<p class=\"muted\">No campaigns yet. Create your first one!</p>';\n  }\n  function campaignRow(c) {\n    var when = c.sendMode === 'SCHEDULE' ? c.scheduleDate + ' ' + c.scheduleTime : 'Sent on submit · ' + c.createdAt;\n    return '<div style=\"display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)\">' +\n      '<div style=\"min-width:0\"><b style=\"display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\">' + esc(c.name) + '</b><span class=\"small muted\">' + esc(when) + '</span></div>' +\n      '<div style=\"text-align:right;flex:none\"><span class=\"pill ' + esc(c.status) + '\">' + esc(c.status) + '</span><div class=\"small muted\">' + c.stats.sent + '/' + c.stats.recipients + ' sent</div></div></div>';\n  }\n\n  /* =================================================================\n   * Create: image processing (resize, optimise, optional text band)\n   * ================================================================= */\n  function loadImageFromFile(file) {\n    return new Promise(function (resolve, reject) {\n      var url = URL.createObjectURL(file); var img = new Image();\n      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };\n      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('This file could not be read as an image.')); };\n      img.src = url;\n    });\n  }\n  function wrapLines(ctx, text, maxW) {\n    var words = String(text).split(/\\s+/), lines = [], line = '';\n    words.forEach(function (w) { var t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; });\n    if (line) lines.push(line); return lines.slice(0, 3);\n  }\n  function hexToRgba(hex, a) { var n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }\n  function dataUrlBytes(d) { return Math.round((d.length - d.indexOf(',') - 1) * 3 / 4); }\n\n  /** Draws the final creative and returns a JPEG data URL under the size limit. */\n  function buildCreative() {\n    if (!S.image) return Promise.resolve(null);\n    var src = S.image.original, maxSide = 1600;\n    var scale = Math.min(1, maxSide / Math.max(src.naturalWidth || src.width, src.naturalHeight || src.height));\n    var w = Math.round((src.naturalWidth || src.width) * scale), h = Math.round((src.naturalHeight || src.height) * scale);\n    var c = document.createElement('canvas'); c.width = w; c.height = h;\n    var ctx = c.getContext('2d');\n    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);\n    ctx.drawImage(src, 0, 0, w, h);\n\n    var head = $('ovHead').value.trim(), sub = $('ovSub').value.trim();\n    if (head || sub) {\n      var pad = Math.round(w * 0.05), hs = Math.max(18, Math.round(w * 0.062)), ss = Math.max(13, Math.round(w * 0.038));\n      ctx.font = '800 ' + hs + 'px -apple-system, Segoe UI, Roboto, Arial, sans-serif';\n      var hl = head ? wrapLines(ctx, head, w - pad * 2) : [];\n      ctx.font = '500 ' + ss + 'px -apple-system, Segoe UI, Roboto, Arial, sans-serif';\n      var sl = sub ? wrapLines(ctx, sub, w - pad * 2) : [];\n      var bandH = pad * 1.6 + hl.length * hs * 1.15 + sl.length * ss * 1.3;\n      var top = $('ovPos').value === 'top';\n      var y0 = top ? 0 : h - bandH, color = $('ovColor').value || '#0b6b38';\n      var g = ctx.createLinearGradient(0, top ? 0 : y0, 0, top ? bandH : h);\n      g.addColorStop(top ? 0 : 1, hexToRgba(color, 0.95)); g.addColorStop(top ? 1 : 0, hexToRgba(color, 0.72));\n      ctx.fillStyle = g; ctx.fillRect(0, y0, w, bandH);\n      ctx.fillStyle = '#fff'; ctx.textBaseline = 'top';\n      var y = y0 + pad * 0.8;\n      ctx.font = '800 ' + hs + 'px -apple-system, Segoe UI, Roboto, Arial, sans-serif';\n      hl.forEach(function (l) { ctx.fillText(l, pad, y); y += hs * 1.15; });\n      ctx.font = '500 ' + ss + 'px -apple-system, Segoe UI, Roboto, Arial, sans-serif';\n      sl.forEach(function (l) { ctx.fillText(l, pad, y + ss * 0.15); y += ss * 1.3; });\n    }\n    // Optimise: JPEG, shrinking quality then size until under the limit (~90% of max for safety).\n    var limit = (S.boot.settings.maxImageMb || 5) * 1024 * 1024 * 0.9, q = 0.88, data = c.toDataURL('image/jpeg', q);\n    while (dataUrlBytes(data) > limit && q > 0.5) { q -= 0.08; data = c.toDataURL('image/jpeg', q); }\n    if (dataUrlBytes(data) > limit) { var c2 = document.createElement('canvas'); c2.width = Math.round(w * 0.7); c2.height = Math.round(h * 0.7);\n      c2.getContext('2d').drawImage(c, 0, 0, c2.width, c2.height); data = c2.toDataURL('image/jpeg', 0.8); }\n    return new Promise(function (resolve) {\n      var img = new Image(); img.onload = function () { S.image.final = data; S.image.finalImg = img; S.image.bytes = dataUrlBytes(data); resolve(data); }; img.src = data;\n    });\n  }\n  var rebuildTimer = null;\n  function scheduleRebuild() { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(function () { buildCreative().then(afterCreative); }, 250); }\n  function afterCreative() {\n    if (S.image && S.image.finalImg) {\n      var t = $('thumb'), ctx = t.getContext('2d'), im = S.image.finalImg, s = Math.max(t.width / im.width, t.height / im.height);\n      ctx.clearRect(0, 0, t.width, t.height);\n      ctx.drawImage(im, (t.width - im.width * s) / 2, (t.height - im.height * s) / 2, im.width * s, im.height * s);\n      $('imgInfo').textContent = im.width + '×' + im.height + ' · ' + (S.image.bytes / 1024 / 1024).toFixed(2) + ' MB optimised JPG';\n    }\n    renderPreviewTargets();\n  }\n  function handleImageFile(file) {\n    if (!file) return;\n    if (!/^image\\//.test(file.type)) { toast('Please choose an image file.'); return; }\n    busy(true);\n    loadImageFromFile(file).then(function (img) { S.image = { original: img }; show('thumbRow', true); return buildCreative(); })\n      .then(function () { busy(false); afterCreative(); })\n      .catch(function (err) { busy(false); toast(err.message); });\n  }\n  $('imgInput').addEventListener('change', function (e) { handleImageFile(e.target.files[0]); e.target.value = ''; });\n  bindDrop('drop', handleImageFile);\n  $('imgRemove').addEventListener('click', function () { S.image = null; show('thumbRow', false); renderPreviewTargets(); });\n  ['ovHead', 'ovSub', 'ovPos', 'ovColor'].forEach(function (id) { $(id).addEventListener('input', scheduleRebuild); });\n\n  function bindDrop(id, cb) {\n    var d = $(id);\n    ['dragenter', 'dragover'].forEach(function (ev) { d.addEventListener(ev, function (e) { e.preventDefault(); d.classList.add('drag'); }); });\n    ['dragleave', 'drop'].forEach(function (ev) { d.addEventListener(ev, function (e) { e.preventDefault(); d.classList.remove('drag'); }); });\n    d.addEventListener('drop', function (e) { if (e.dataTransfer.files && e.dataTransfer.files[0]) cb(e.dataTransfer.files[0]); });\n  }\n\n  /* =================================================================\n   * Create: message, CTA, fields\n   * ================================================================= */\n  function resetCreate() {\n    var p = S.boot.profile, st = S.boot.settings;\n    S.step = 1; S.image = null; S.cta = 'URL'; S.when = 'NOW'; S.aud = 'all'; S.lists = [];\n    ['cName', 'cMsg', 'ctaText', 'ctaValue', 'ovHead', 'ovSub', 'sDate', 'sTime'].forEach(function (id) { $(id).value = ''; });\n    $('cWebsite').value = p.website || ''; $('cStorePhone').value = p.phone || ''; $('cPreviewName').value = st.defaultContactName || 'Customer';\n    $('cMsg').value = 'Hi {{Name}},\\n\\n';\n    $('ctaText').maxLength = st.ctaTextMaxLength; show('thumbRow', false);\n    $('varChips').innerHTML = st.variables.map(function (v) { return '<button type=\"button\" class=\"chip\" data-var=\"' + esc(v) + '\">{{' + esc(v) + '}}</button>'; }).join('');\n    $('tzHint').textContent = 'Time zone: ' + st.timezone;\n    $('sDate').min = st.today;\n    qsa('input[name=aud]').forEach(function (r) { r.checked = r.value === 'all'; });\n    setSeg('ctaSeg', 'data-cta', 'URL'); setSeg('whenSeg', 'data-when', 'NOW'); updateCtaFields(); show('schedFields', false);\n    ['step1Err', 'step2Err', 'launchErr'].forEach(function (id) { $(id).innerHTML = ''; });\n    setStep(1); updateMsgCount();\n  }\n  function setSeg(id, attr, val) { qsa('#' + id + ' button').forEach(function (b) { b.classList.toggle('on', b.getAttribute(attr) === val); }); }\n  $('varChips').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-var]'); if (!b) return;\n    var ta = $('cMsg'), ins = '{{' + b.getAttribute('data-var') + '}}', s = ta.selectionStart || ta.value.length;\n    ta.value = ta.value.slice(0, s) + ins + ta.value.slice(ta.selectionEnd || s); ta.focus(); ta.selectionStart = ta.selectionEnd = s + ins.length;\n    updateMsgCount(); renderPreviewTargets();\n  });\n  function updateMsgCount() { $('msgCount').textContent = $('cMsg').value.length; }\n  ['cMsg', 'cName', 'ctaText', 'ctaValue', 'cWebsite', 'cStorePhone', 'cPreviewName'].forEach(function (id) {\n    $(id).addEventListener('input', function () { updateMsgCount(); renderPreviewTargets(); });\n  });\n  $('ctaSeg').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-cta]'); if (!b) return;\n    S.cta = b.getAttribute('data-cta'); setSeg('ctaSeg', 'data-cta', S.cta); $('ctaValue').value = ''; updateCtaFields(); renderPreviewTargets();\n  });\n  function updateCtaFields() {\n    var t = S.cta; show('ctaFields', t !== 'NONE');\n    var max = S.boot.settings.ctaTextMaxLength;\n    $('ctaTextHint').textContent = 'Max ' + max + ' characters';\n    var ph = { URL: ['Explore Now', 'Link', 'https://… (blank = your website)'], PHONE: ['Call Store', 'Phone number', 'Blank = your store phone'], QUICK_REPLY: ['View Offers', 'Reply keyword', 'e.g. offers — your auto-reply for this word is sent back'] }[t];\n    if (ph) { $('ctaText').placeholder = ph[0]; $('ctaValueLabel').textContent = ph[1]; $('ctaValueHint').textContent = ph[2]; $('ctaValue').placeholder = t === 'URL' ? 'https://' : ''; }\n  }\n  function ctaResolved() {\n    var t = S.cta; if (t === 'NONE') return null;\n    var text = $('ctaText').value.trim() || $('ctaText').placeholder, v = $('ctaValue').value.trim();\n    if (t === 'URL') v = normUrl(v || $('cWebsite').value);\n    if (t === 'PHONE') { v = normPhone(v || $('cStorePhone').value); v = v ? '+' + v : ''; }\n    if (t === 'QUICK_REPLY') v = v || text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');\n    return { type: t, text: text, value: v };\n  }\n\n  function validateStep1() {\n    var errs = [], max = S.boot.settings.ctaTextMaxLength, cta = ctaResolved();\n    if (!$('cName').value.trim()) errs.push('Enter a campaign name.');\n    if (!$('cMsg').value.trim() || $('cMsg').value.trim() === 'Hi {{Name}},') errs.push('Write your message.');\n    if ($('cWebsite').value.trim() && !normUrl($('cWebsite').value)) errs.push('Website is not a valid web address.');\n    if ($('cStorePhone').value.trim() && !normPhone($('cStorePhone').value)) errs.push('Store phone number is not valid.');\n    if (cta) {\n      if (!$('ctaText').value.trim()) errs.push('Enter the button text.');\n      else if ($('ctaText').value.trim().length > max) errs.push('Button text must be at most ' + max + ' characters.');\n      if (cta.type === 'URL' && !cta.value) errs.push('Enter a valid link for the button (or a website).');\n      if (cta.type === 'PHONE' && !cta.value) errs.push('Enter a valid phone number for the button (or a store phone).');\n    }\n    $('step1Err').innerHTML = alertBox('error', errs.length ? 'Please fix:' : '', errs);\n    return !errs.length;\n  }\n\n  /* =================================================================\n   * Create: steps, audience, schedule, launch\n   * ================================================================= */\n  function setStep(n) {\n    S.step = n;\n    ['1', '2', '3'].forEach(function (k) { show('step-' + k, String(n) === k); });\n    show('step-done', n === 'done');\n    show('steps', n !== 'done');\n    qsa('#steps button').forEach(function (b) { var k = +b.getAttribute('data-step'); b.classList.toggle('on', k === n); b.classList.toggle('done', n !== 'done' && k < n); });\n    if (n === 3) renderSummary();\n    renderPreviewTargets(); window.scrollTo(0, 0);\n  }\n  $('steps').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-step]'); if (!b) return; var n = +b.getAttribute('data-step');\n    if (n > 1 && !validateStep1()) return setStep(1);\n    if (n > 2 && !validateStep2()) return setStep(2);\n    setStep(n);\n  });\n  document.addEventListener('click', function (e) { var b = e.target.closest('[data-step-go]'); if (b) setStep(+b.getAttribute('data-step-go')); });\n  $('toStep2').addEventListener('click', function () { if (validateStep1()) setStep(2); });\n  $('toStep3').addEventListener('click', function () { if (validateStep2()) setStep(3); });\n  $('newAgain').addEventListener('click', function () { resetCreate(); renderPreviewTargets(); });\n\n  function renderListPicker() {\n    var lists = S.boot.lists;\n    $('allCount').textContent = S.boot.stats.optedIn + ' customers';\n    $('listPicker').innerHTML = lists.length ? lists.map(function (l) {\n      return '<label class=\"check\"><input type=\"checkbox\" value=\"' + esc(l.name) + '\"' + (S.lists.indexOf(l.name) >= 0 ? ' checked' : '') + '><div><b>' + esc(l.name) + '</b><div class=\"small muted\">' + l.count + ' opted-in</div></div></label>';\n    }).join('') : '<p class=\"muted small\">No lists yet — upload customers first.</p>';\n  }\n  qsa('input[name=aud]').forEach(function (r) { r.addEventListener('change', function () { S.aud = r.value; show('listPicker', S.aud === 'lists'); refreshAudienceCount(); }); });\n  $('listPicker').addEventListener('change', function () {\n    S.lists = qsa('#listPicker input:checked').map(function (i) { return i.value; }); refreshAudienceCount();\n  });\n  function audienceSel() { return S.aud === 'all' ? { all: true } : { lists: S.lists.slice() }; }\n  var countSeq = 0;\n  function refreshAudienceCount() {\n    if (!S.boot) return; renderListPicker(); show('listPicker', S.aud === 'lists');\n    if (S.aud === 'lists' && !S.lists.length) { S.audCount = 0; $('audCount').textContent = 'Select at least one list.'; return; }\n    var seq = ++countSeq; $('audCount').textContent = 'Counting recipients…';\n    api('apiCountAudience', S.token, audienceSel()).then(function (r) {\n      if (seq !== countSeq || !r.ok) return; S.audCount = r.count;\n      var sub = S.boot.subscription || {}, extra = sub.remaining !== null && sub.remaining !== undefined && r.count > sub.remaining ? ' · only ' + sub.remaining + ' messages left this month' : '';\n      $('audCount').textContent = 'Recipients: ' + r.count + ' opted-in customer' + (r.count === 1 ? '' : 's') + extra;\n    }).catch(function () { /* handled */ });\n  }\n  $('whenSeg').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-when]'); if (!b) return; S.when = b.getAttribute('data-when'); setSeg('whenSeg', 'data-when', S.when);\n    show('schedFields', S.when === 'SCHEDULE');\n    if (S.when === 'SCHEDULE' && !$('sDate').value) { $('sDate').value = S.boot.settings.today; }\n  });\n  function validateStep2() {\n    var errs = [];\n    if (S.aud === 'lists' && !S.lists.length) errs.push('Select at least one customer list.');\n    if (S.audCount === 0) errs.push('No opted-in customers match this selection. Upload customers first.');\n    if (S.when === 'SCHEDULE') {\n      if (!$('sDate').value) errs.push('Choose a date.');\n      if (!$('sTime').value) errs.push('Choose a time.');\n      if ($('sDate').value && $('sDate').value < S.boot.settings.today) errs.push('The date is in the past.');\n    }\n    if (S.boot.subscription && S.boot.subscription.canSend === false && !/quota/i.test(S.boot.subscription.reason)) errs.push(S.boot.subscription.reason + ' Please contact your service provider.');\n    $('step2Err').innerHTML = alertBox('error', errs.length ? 'Please fix:' : '', errs);\n    return !errs.length;\n  }\n  function renderSummary() {\n    var cta = ctaResolved();\n    var when = S.when === 'NOW' ? 'Immediately after launch' : $('sDate').value + ' at ' + $('sTime').value + ' (' + S.boot.settings.timezone + ')';\n    var aud = S.aud === 'all' ? 'All opted-in customers' : S.lists.join(', ');\n    $('summary').innerHTML = '<dl>' +\n      '<dt>Campaign</dt><dd>' + esc($('cName').value) + '</dd>' +\n      '<dt>Recipients</dt><dd>' + esc(aud) + (S.audCount !== null ? ' (' + S.audCount + ')' : '') + '</dd>' +\n      '<dt>When</dt><dd>' + esc(when) + '</dd>' +\n      '<dt>Image</dt><dd>' + (S.image ? 'Yes' : 'No (text only)') + '</dd>' +\n      '<dt>Button</dt><dd>' + (cta ? esc(cta.text) + ' → ' + esc(cta.value) : 'None') + '</dd>' +\n      '</dl>';\n  }\n  $('launchBtn').addEventListener('click', function () {\n    if (!validateStep1()) return setStep(1);\n    if (!validateStep2()) return setStep(2);\n    var cta = ctaResolved(), btn = $('launchBtn');\n    var payload = {\n      campaignName: $('cName').value.trim(), message: $('cMsg').value,\n      imageDataUrl: S.image ? S.image.final : '', website: $('cWebsite').value.trim(), storePhone: $('cStorePhone').value.trim(),\n      ctaType: cta ? cta.type : 'NONE', ctaText: cta ? $('ctaText').value.trim() : '',\n      ctaValue: cta ? ($('ctaValue').value.trim() || (cta.type === 'QUICK_REPLY' ? cta.value : '')) : '',\n      audience: audienceSel(), sendMode: S.when, date: $('sDate').value, time: $('sTime').value,\n    };\n    btn.disabled = true; busy(true); $('launchErr').innerHTML = '';\n    api('apiCreateCampaign', S.token, payload).then(function (r) {\n      btn.disabled = false; busy(false);\n      if (!r.ok) { $('launchErr').innerHTML = alertBox('error', r.error); return; }\n      if (!r.created) { $('launchErr').innerHTML = alertBox('error', 'The campaign could not be launched:', r.errors); return; }\n      if (r.campaigns) S.boot.campaigns = r.campaigns;\n      $('doneMsg').innerHTML = '<b>Campaign ' + esc(r.campaignId) + ' is ' + esc(r.status) + '.</b><br>' +\n        (r.status === 'SCHEDULED' ? 'It will be sent at the scheduled time.' : r.status === 'ACTIVE' ? 'Messages are being sent in small batches.' : r.status === 'READY' ? 'It will be sent after final approval.' : 'Check the campaign for details.');\n      $('doneWarn').innerHTML = alertBox('warn', r.warnings && r.warnings.length ? 'Please note:' : '', r.warnings || []);\n      setStep('done');\n    }).catch(function (err) { btn.disabled = false; busy(false); $('launchErr').innerHTML = alertBox('error', err.message); });\n  });\n\n  /* =================================================================\n   * Protected WhatsApp preview\n   * Deterrents: canvas rendering (no image URL/element to save), tiled watermark baked into\n   * the preview pixels, no selection / context menu / drag / long-press, blur when the window\n   * loses focus, print disabled. NOTE: no website can block OS screenshots or a phone camera;\n   * the watermark makes any captured preview identifiable and unusable as a final creative.\n   * ================================================================= */\n  function drawPreviewImage(canvas, img, label) {\n    var w = 560, h = Math.round(w * img.height / img.width);\n    canvas.width = w; canvas.height = h;\n    var ctx = canvas.getContext('2d');\n    ctx.drawImage(img, 0, 0, w, h);\n    ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(-Math.PI / 6);\n    ctx.font = '700 22px -apple-system, Segoe UI, Roboto, Arial, sans-serif'; ctx.textAlign = 'center';\n    var step = 150, span = Math.max(w, h) * 1.5;\n    for (var y = -span; y < span; y += step / 1.6) {\n      for (var x = -span; x < span; x += step * 2.2) {\n        ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillText(label, x, y);\n        ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillText(label, x + 1.5, y + 1.5);\n      }\n    }\n    ctx.restore();\n  }\n  var ICONS = {\n    URL: '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5\"/></svg>',\n    PHONE: '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2\"/></svg>',\n    QUICK_REPLY: '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M9 14L4 9l5-5\"/><path d=\"M4 9h10a6 6 0 010 12h-2\"/></svg>',\n  };\n  function ctaLine(cta) {\n    if (cta.type === 'URL') return '👉 ' + cta.text + ': ' + cta.value;\n    if (cta.type === 'PHONE') return '📞 ' + cta.text + ': ' + cta.value;\n    return '💬 ' + cta.text + ' — reply \"' + cta.value + '\"';\n  }\n  /** data = { business, text, img (Image|null), cta|null } */\n  function buildPreview(target, data) {\n    var label = 'PREVIEW · ' + data.business;\n    var time = new Date().toTimeString().slice(0, 5);\n    var captionStyle = S.boot.settings.imageCtaStyle === 'CAPTION_LINK';\n    var html = '<div class=\"protected\"><div class=\"phone\"><div class=\"screen\">' +\n      '<div class=\"wa-head\"><div class=\"avatar\">' + esc((data.business || '?').charAt(0).toUpperCase()) + '</div><div><b>' + esc(data.business) + '</b><span>WhatsApp</span></div></div>' +\n      '<div class=\"chat\">';\n    var textHtml = waFormat(data.text || '');\n    var ctaHtml = data.cta ? '<div class=\"cta\">' + (ICONS[data.cta.type] || '') + esc(data.cta.text) + '</div>' : '';\n    if (data.img && captionStyle) {\n      var cap = data.text + (data.cta ? '\\n\\n' + ctaLine(data.cta) : '');\n      html += '<div class=\"bubble\"><canvas data-img=\"1\"></canvas>' + (cap.trim() ? '<div class=\"txt\">' + waFormat(cap) + '</div>' : '') + '<div class=\"time\">' + time + '</div></div>';\n    } else {\n      if (data.img) html += '<div class=\"bubble\"><canvas data-img=\"1\"></canvas>' + (data.cta || data.text ? '' : '<div class=\"time\">' + time + '</div>') + '</div>';\n      if (data.text || data.cta) html += '<div class=\"bubble\">' + (data.text ? '<div class=\"txt\">' + textHtml + '</div>' : '') + '<div class=\"time\">' + time + '</div>' + ctaHtml + '</div>';\n    }\n    if (!data.img && !data.text && !data.cta) html += '<p class=\"muted small\" style=\"text-align:center;margin-top:40%\">Your ad preview appears here</p>';\n    html += '</div></div></div><div class=\"shield\"></div></div><div class=\"wm-note\">Watermarked preview · download disabled</div>';\n    target.innerHTML = html;\n    var cv = target.querySelector('canvas[data-img]');\n    if (cv && data.img) drawPreviewImage(cv, data.img, label);\n  }\n  function currentPreviewData() {\n    return { business: S.boot.profile.businessName, text: renderVars($('cMsg').value, $('cPreviewName').value.trim()),\n      img: S.image && S.image.finalImg, cta: ctaResolved() };\n  }\n  function renderPreviewTargets() {\n    if (!S.boot || S.view !== 'create') return;\n    var d = currentPreviewData();\n    buildPreview($('livePreview'), d);\n    if (S.step === 3) buildPreview($('reviewPreview'), d);\n    if (!$('sheet').classList.contains('hidden') && $('sheet').getAttribute('data-mode') === 'live') buildPreview($('sheetBody'), d);\n  }\n  function openSheet(title, mode) { $('sheetTitle').textContent = title; $('sheet').setAttribute('data-mode', mode); show('sheet', true); }\n  $('fabPreview').addEventListener('click', function () { openSheet('Preview', 'live'); buildPreview($('sheetBody'), currentPreviewData()); });\n  $('sheetClose').addEventListener('click', function () { show('sheet', false); $('sheetBody').innerHTML = ''; });\n  $('sheet').addEventListener('click', function (e) { if (e.target === $('sheet')) { show('sheet', false); $('sheetBody').innerHTML = ''; } });\n\n  // Global deterrents\n  function inProtected(e) { return e.target && e.target.closest && e.target.closest('.protected'); }\n  ['contextmenu', 'dragstart', 'selectstart', 'copy', 'cut'].forEach(function (ev) {\n    document.addEventListener(ev, function (e) { if (inProtected(e) || ev === 'contextmenu' && e.target.tagName === 'CANVAS') e.preventDefault(); });\n  });\n  function privacy(on) { document.body.classList.toggle('privacy', !!on); }\n  document.addEventListener('keydown', function (e) {\n    var k = (e.key || '').toLowerCase();\n    if (k === 'printscreen') { privacy(true); try { navigator.clipboard.writeText(''); } catch (err) { /* ignore */ } setTimeout(function () { privacy(false); }, 1500); }\n    if ((e.ctrlKey || e.metaKey) && (k === 's' || k === 'p')) { e.preventDefault(); toast('Saving and printing are disabled.'); }\n    if (e.metaKey && e.shiftKey) privacy(true); // macOS screenshot shortcuts start with Cmd+Shift\n  });\n  document.addEventListener('keyup', function (e) { if (!e.metaKey && document.hasFocus()) privacy(false); });\n  window.addEventListener('blur', function () { privacy(true); });\n  window.addEventListener('focus', function () { privacy(false); });\n  document.addEventListener('visibilitychange', function () { privacy(document.hidden); });\n  document.addEventListener('pointerdown', function () { if (document.hasFocus()) privacy(false); });\n\n  /* =================================================================\n   * Customers: Excel / CSV upload\n   * ================================================================= */\n  var FIELDS = [\n    { key: 'phone', label: 'Phone *', re: /phone|mobile|whats ?app|cell|number|contact/i },\n    { key: 'name', label: 'Name', re: /^name$|full ?name|customer|first ?name|client/i },\n    { key: 'email', label: 'Email', re: /e-?mail/i },\n    { key: 'company', label: 'Company', re: /company|business|organi[sz]ation|firm/i },\n    { key: 'tags', label: 'Tags / group', re: /tag|group|segment|category|city|label/i },\n    { key: 'optIn', label: 'Opt-in', re: /opt|consent|subscri/i },\n  ];\n  function renderCustomers() {\n    var b = S.boot;\n    $('maxRows').textContent = b.settings.maxUploadRows;\n    $('custKpis').innerHTML = [['Total customers', b.stats.contacts], ['Opted-in', b.stats.optedIn], ['Opted-out', b.stats.optedOut], ['Lists', b.lists.length]]\n      .map(function (k) { return '<div class=\"kpi\"><div class=\"v\">' + esc(k[1]) + '</div><div class=\"l\">' + esc(k[0]) + '</div></div>'; }).join('');\n    $('listsTable').innerHTML = b.lists.length\n      ? '<div class=\"scroll-x\"><table class=\"tbl\"><tr><th>List / tag</th><th>Opted-in customers</th></tr>' + b.lists.map(function (l) { return '<tr><td>' + esc(l.name) + '</td><td>' + l.count + '</td></tr>'; }).join('') + '</table></div>'\n      : '<p class=\"muted\">No lists yet. Upload your first customer file above.</p>';\n  }\n  function loadScript(src) {\n    return new Promise(function (resolve, reject) {\n      if (window.XLSX) return resolve();\n      var s = document.createElement('script'); s.src = src; s.onload = function () { resolve(); };\n      s.onerror = function () { reject(new Error('Could not load the spreadsheet reader. Check your connection.')); }; document.head.appendChild(s);\n    });\n  }\n  var XLSX_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';\n  function cellStr(v) { if (v == null) return ''; if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v); return String(v).trim(); }\n  function handleCustomerFile(file) {\n    if (!file) return;\n    if (!/\\.(csv|xlsx|xls)$/i.test(file.name)) { toast('Please choose a .csv, .xlsx or .xls file.'); return; }\n    busy(true); $('uploadResult').innerHTML = '';\n    loadScript(XLSX_SRC).then(function () { return file.arrayBuffer(); }).then(function (buf) {\n      var wb = window.XLSX.read(buf, { type: 'array', raw: false, cellDates: false });\n      var ws = wb.Sheets[wb.SheetNames[0]];\n      var rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })\n        .map(function (r) { return r.map(cellStr); })\n        .filter(function (r) { return r.some(function (c) { return c !== ''; }); });\n      busy(false);\n      if (rows.length < 2) { toast('The file needs a header row and at least one customer.'); return; }\n      var header = rows[0].map(function (h, i) { return h || ('Column ' + (i + 1)); });\n      var data = rows.slice(1);\n      var map = {};\n      FIELDS.forEach(function (f) { var idx = header.findIndex(function (h, i) { return f.re.test(h) && Object.keys(map).every(function (k) { return map[k] !== i; }); }); map[f.key] = idx; });\n      if (map.phone < 0) map.phone = header.findIndex(function (h, i) { return data.slice(0, 20).some(function (r) { return digits(r[i]).length >= 10; }); });\n      S.upload = { header: header, rows: data, map: map, fileName: file.name };\n      if (!$('listName').value) $('listName').value = file.name.replace(/\\.[^.]+$/, '').replace(/[^A-Za-z0-9 _.\\-]/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 40);\n      renderUploadPreview();\n    }).catch(function (err) { busy(false); toast(err.message); });\n  }\n  function renderUploadPreview() {\n    var u = S.upload, max = S.boot.settings.maxUploadRows;\n    $('mapFields').innerHTML = FIELDS.map(function (f) {\n      return '<label class=\"field\"><span>' + esc(f.label) + '</span><select class=\"input\" data-map=\"' + f.key + '\"><option value=\"-1\">— not in file —</option>' +\n        u.header.map(function (h, i) { return '<option value=\"' + i + '\"' + (u.map[f.key] === i ? ' selected' : '') + '>' + esc(h) + '</option>'; }).join('') + '</select></label>';\n    }).join('');\n    var valid = u.map.phone >= 0 ? u.rows.filter(function (r) { return normPhone(r[u.map.phone]); }).length : 0;\n    $('parseInfo').innerHTML = '<b>' + esc(u.fileName) + '</b>: ' + u.rows.length + ' rows · ' + valid + ' with a valid phone number' +\n      (u.rows.length > max ? '<br><b>Only the first ' + max + ' rows can be imported at once.</b>' : '');\n    var cols = FIELDS.filter(function (f) { return u.map[f.key] >= 0; });\n    $('parsePreview').innerHTML = '<tr>' + cols.map(function (f) { return '<th>' + esc(f.label.replace(' *', '')) + '</th>'; }).join('') + '</tr>' +\n      u.rows.slice(0, 8).map(function (r) { return '<tr>' + cols.map(function (f) { return '<td>' + esc(r[u.map[f.key]]) + '</td>'; }).join('') + '</tr>'; }).join('');\n    show('parseBox', true);\n  }\n  $('mapFields').addEventListener('change', function (e) { var s = e.target.closest('[data-map]'); if (!s) return; S.upload.map[s.getAttribute('data-map')] = +s.value; renderUploadPreview(); });\n  $('consent').addEventListener('change', function () { $('uploadErr').innerHTML = ''; });\n  $('custInput').addEventListener('change', function (e) { handleCustomerFile(e.target.files[0]); e.target.value = ''; });\n  bindDrop('custDrop', handleCustomerFile);\n  $('importBtn').addEventListener('click', function () {\n    var u = S.upload, errs = [];\n    if (!u) return;\n    if (u.map.phone < 0) errs.push('Choose which column contains the phone number.');\n    if (!$('listName').value.trim()) errs.push('Enter a list name.');\n    if (!$('consent').checked) errs.push('Please confirm your customers agreed to receive WhatsApp messages.');\n    $('uploadErr').innerHTML = alertBox('error', errs.length ? 'Please fix:' : '', errs);\n    if (errs.length) return;\n    var get = function (r, k) { return u.map[k] >= 0 ? r[u.map[k]] : ''; };\n    var rows = u.rows.slice(0, S.boot.settings.maxUploadRows).map(function (r) {\n      return { phone: get(r, 'phone'), name: get(r, 'name'), email: get(r, 'email'), company: get(r, 'company'), tags: get(r, 'tags'), optIn: get(r, 'optIn') };\n    });\n    busy(true);\n    api('apiUploadContacts', S.token, { listName: $('listName').value.trim(), consent: true, rows: rows }).then(function (r) {\n      busy(false);\n      if (!r.ok) { $('uploadErr').innerHTML = alertBox('error', r.error); return; }\n      S.boot = r.bootstrap; S.upload = null; show('parseBox', false); $('consent').checked = false; $('listName').value = '';\n      var notes = [];\n      if (r.invalid) notes.push(r.invalid + ' row(s) skipped: invalid phone number' + (r.invalidRows.length ? ' (rows ' + r.invalidRows.join(', ') + (r.invalid > r.invalidRows.length ? ', …' : '') + ')' : ''));\n      if (r.duplicatesInFile) notes.push(r.duplicatesInFile + ' duplicate number(s) in the file were merged');\n      if (r.keptOptedOut) notes.push(r.keptOptedOut + ' customer(s) previously unsubscribed and stay unsubscribed');\n      $('uploadResult').innerHTML = alertBox('ok', 'Imported into \"' + r.list + '\": ' + r.added + ' new, ' + r.updated + ' updated.') + alertBox('warn', '', notes);\n      renderCustomers(); toast('Customers imported');\n    }).catch(function (err) { busy(false); $('uploadErr').innerHTML = alertBox('error', err.message); });\n  });\n  $('sampleCsv').addEventListener('click', function (e) {\n    e.preventDefault();\n    var csv = 'Name,Phone,Email,Company,Tags,Opt In\\nAsha Sharma,9876543210,asha@example.com,,VIP,YES\\nRavi Kumar,+919812345678,,,\"Kolkata, Regular\",YES\\n';\n    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'customers-sample.csv';\n    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);\n  });\n\n  /* =================================================================\n   * Campaigns list\n   * ================================================================= */\n  function renderCampaigns() {\n    var list = S.boot.campaigns;\n    if (!list.length) { $('campaignList').innerHTML = '<div class=\"card\"><p class=\"muted\">No campaigns yet.</p><button class=\"btn primary\" data-go=\"create\" type=\"button\">Create your first campaign</button></div>'; return; }\n    $('campaignList').innerHTML = list.map(function (c) {\n      var s = c.stats, pct = s.recipients ? Math.round(s.sent / s.recipients * 100) : 0;\n      var when = c.sendMode === 'SCHEDULE' ? 'Scheduled ' + c.scheduleDate + ' ' + c.scheduleTime + ' (' + c.timezone + ')' : 'Send now · created ' + c.createdAt;\n      var canCancel = ['READY', 'SCHEDULED', 'ACTIVE', 'PAUSED'].indexOf(c.status) >= 0;\n      return '<div class=\"card\">' +\n        '<div class=\"view-head\" style=\"margin-bottom:6px\"><div style=\"min-width:0\"><h2 style=\"overflow:hidden;text-overflow:ellipsis\">' + esc(c.name) + '</h2><span class=\"small muted\">' + esc(c.id) + ' · ' + esc(when) + '</span></div><span class=\"pill ' + esc(c.status) + '\">' + esc(c.status) + '</span></div>' +\n        '<div class=\"bar\" style=\"margin:10px 0 8px\"><i style=\"width:' + pct + '%\"></i></div>' +\n        '<div class=\"small muted\" style=\"margin-bottom:12px\">' + s.sent + ' of ' + s.recipients + ' sent · ' + s.delivered + ' delivered · ' + s.read + ' read · ' + s.failed + ' failed · ' + c.replies + ' replies</div>' +\n        '<div class=\"row\"><button class=\"btn sm\" data-preview=\"' + esc(c.id) + '\" type=\"button\">Preview</button>' +\n        (canCancel ? '<button class=\"btn sm danger\" data-cancel=\"' + esc(c.id) + '\" type=\"button\">Cancel</button>' : '') + '</div></div>';\n    }).join('');\n  }\n  $('campaignList').addEventListener('click', function (e) {\n    var p = e.target.closest('[data-preview]'), x = e.target.closest('[data-cancel]');\n    if (p) previewCampaign(p.getAttribute('data-preview'));\n    if (x && confirm('Cancel this campaign? Messages not yet sent will not be sent.')) {\n      busy(true);\n      api('apiCancelCampaign', S.token, x.getAttribute('data-cancel')).then(function (r) {\n        busy(false); if (!r.ok) return toast(r.error); S.boot.campaigns = r.campaigns; renderCampaigns(); toast('Campaign cancelled');\n      }).catch(function (err) { busy(false); toast(err.message); });\n    }\n  });\n  function previewCampaign(id) {\n    var c = S.boot.campaigns.find(function (x) { return x.id === id; }); if (!c) return;\n    var cta = c.ctaType ? { type: c.ctaType, text: c.ctaText, value: c.ctaType === 'URL' ? (c.ctaValue.indexOf('{{') >= 0 ? c.website : c.ctaValue) : c.ctaType === 'PHONE' ? (c.ctaValue.indexOf('{{') >= 0 ? c.storePhone : '+' + digits(c.ctaValue)) : c.ctaValue } : null;\n    var text = c.message.replace(/\\{\\{\\s*([A-Za-z_][\\w ]*?)\\s*\\}\\}/g, function (m, k) {\n      k = k.replace(/[\\s_]/g, '').toLowerCase();\n      return { name: S.boot.settings.defaultContactName, clientname: S.boot.profile.businessName, campaignname: c.name, storephone: c.storePhone, website: c.website }[k] || '';\n    });\n    openSheet(c.name, 'campaign');\n    var data = { business: S.boot.profile.businessName, text: text, img: null, cta: cta };\n    buildPreview($('sheetBody'), data);\n    if (!c.hasImage) return;\n    api('apiGetCampaignImage', S.token, id).then(function (r) {\n      if (!r.ok || !r.image) return;\n      var img = new Image(); img.onload = function () { data.img = img; buildPreview($('sheetBody'), data); r.image = null; }; img.src = r.image;\n    }).catch(function () { /* ignore */ });\n  }\n  $('refreshBtn').addEventListener('click', function () {\n    busy(true);\n    api('apiBootstrap', S.token).then(function (r) { busy(false); if (r.ok) { S.boot = r; renderShell(); renderCampaigns(); toast('Updated'); } })\n      .catch(function (err) { busy(false); toast(err.message); });\n  });\n\n  /* =================================================================\n   * Boot\n   * ================================================================= */\n  var saved = load('cs_token');\n  if (saved) {\n    S.token = saved; busy(true);\n    api('apiBootstrap', saved).then(function (r) { busy(false); if (r.ok) startApp(r); else showLogin(); })\n      .catch(function () { busy(false); showLogin(); });\n  } else {\n    showLogin();\n  }\n})();\n</script>\n</body>\n</html>\n";
