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
  CLIENTS: ['Client ID', 'Business Name', 'Client Email', 'Business Phone', 'Website', 'Status', 'Created At', 'Updated At'],
  CONTACTS: [
    'Contact ID', 'Client ID', 'Name', 'Phone', 'Email', 'Company', 'Tags', 'Audience', 'Opt In', 'Status',
    'Last Sent', 'Last Message ID', 'Last Response', 'Created At', 'Updated At',
  ],
  CAMPAIGNS: [
    'Campaign ID', 'Client ID', 'Client Name', 'Campaign Name', 'Status', 'Message', 'Image File ID', 'Image URL',
    'Website URL', 'Store Phone', 'CTA Text', 'CTA Type', 'CTA Value', 'Target Audience', 'Send Mode',
    'Schedule Date', 'Schedule Time', 'Timezone', 'Created At', 'Updated At', 'Submitted By', 'Notes',
  ],
  MESSAGE_QUEUE: [
    'Queue ID', 'Campaign ID', 'Client ID', 'Contact ID', 'Phone', 'Name', 'Rendered Message', 'Image File ID',
    'Image URL', 'CTA Type', 'CTA Text', 'CTA Value', 'Status', 'Attempts', 'Scheduled At', 'Started At',
    'Sent At', 'Message ID', 'Error', 'Last Attempt', 'Created At',
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
    'Button Type', 'Button Value', 'Active',
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
function getConfig(forceReload) {
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
function validateConfig(cfg) {
  cfg = cfg || getConfig(true);
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
  const v = validateConfig(getConfig(true));
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
    const year = Utilities.formatDate(new Date(), getConfig().timezone, 'yyyy');
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

  const cc = String(countryCode || getConfig().defaultCountryCode || '').replace(/\D/g, '');

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
  const cfg = getConfig();
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
  return Utilities.formatDate(new Date(), getConfig().timezone, fmt || 'yyyy-MM-dd HH:mm:ss');
}

function todayKey_() {
  return nowInTz_('yyyy-MM-dd');
}

function dateKey_(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  return Utilities.formatDate(d, getConfig().timezone, 'yyyy-MM-dd');
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
  const cfg = getConfig();
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
    const img = processCampaignImage(input.imageRef);
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
  return buildDateTime_(cellDateStr_(row['Schedule Date']), cellTimeStr_(row['Schedule Time']), String(row['Timezone'] || getConfig().timezone));
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
function startCampaign(campaignId) {
  const c = getCampaign_(campaignId);
  if (!c.row) throw new Error('Campaign ' + campaignId + ' not found.');
  const status = String(c.row['Status']);
  if ([CAMPAIGN_STATUS.COMPLETED, CAMPAIGN_STATUS.CANCELLED, CAMPAIGN_STATUS.ACTIVE].indexOf(status) >= 0) {
    return { ok: false, message: 'Campaign is ' + status + ' and cannot be started.' };
  }
  const built = buildCampaignQueue(campaignId);
  const pending = countQueue_(campaignId, [QUEUE_STATUS.PENDING, QUEUE_STATUS.QUEUED]);
  if (!pending) {
    setCampaignStatus_(campaignId, CAMPAIGN_STATUS.ERROR, 'No eligible (opted-in, active) contacts matched audience ' + c.row['Target Audience']);
    return { ok: false, message: 'No eligible contacts matched the audience. Campaign set to ERROR.' };
  }
  setCampaignStatus_(campaignId, CAMPAIGN_STATUS.ACTIVE, 'Started with ' + pending + ' queued message(s) (' + built.added + ' new).');
  return { ok: true, message: 'Campaign ACTIVE with ' + pending + ' queued message(s).' };
}

function pauseCampaign(campaignId) {
  const c = getCampaign_(campaignId);
  if (!c.row) throw new Error('Campaign ' + campaignId + ' not found.');
  if ([CAMPAIGN_STATUS.ACTIVE, CAMPAIGN_STATUS.SCHEDULED, CAMPAIGN_STATUS.READY].indexOf(String(c.row['Status'])) < 0) {
    return { ok: false, message: 'Only ACTIVE, SCHEDULED or READY campaigns can be paused.' };
  }
  setCampaignStatus_(campaignId, CAMPAIGN_STATUS.PAUSED, 'Paused (was ' + c.row['Status'] + ').');
  return { ok: true, message: 'Campaign paused. Queued messages are kept.' };
}

function resumeCampaign(campaignId) {
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
    return startCampaign(campaignId);
  }
  setCampaignStatus_(campaignId, CAMPAIGN_STATUS.ACTIVE, 'Resumed with ' + pending + ' pending message(s).');
  return { ok: true, message: 'Campaign resumed (' + pending + ' pending).' };
}

function cancelCampaign(campaignId) {
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
function activateScheduledCampaigns() {
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
      const res = startCampaign(id);
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

  const cfg = getConfig(true);
  const v = validateConfig(cfg);
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

  const r = sendCampaignMessage_(spec, cfg, {});
  logEvent_(r.success ? LOG_LEVEL.SUCCESS : LOG_LEVEL.ERROR, 'TEST_MESSAGE', {
    campaignId: campaignId, clientId: c.row['Client ID'], phone: phone, messageId: r.messageId,
    httpStatus: r.httpStatus, result: r.success ? (r.fallbackUsed ? 'SENT (text CTA fallback)' : 'SENT') : 'FAILED', error: r.error,
  });
  return report(r.success
    ? 'Test message sent to ' + maskPhone_(phone) + (r.fallbackUsed ? '\n\nNote: Maytapi rejected the button payload; the CTA was sent as a text link. Check LOGS → BUTTON_FALLBACK.' : '') + '\nMessage ID(s): ' + r.messageId
    : 'Test failed (HTTP ' + r.httpStatus + '): ' + r.error);
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
  setTextColumns_(SHEETS.CLIENTS, ['Business Phone']);
  setTextColumns_(SHEETS.CAMPAIGNS, ['Store Phone', 'Schedule Date', 'Schedule Time', 'CTA Value']);
  setTextColumns_(SHEETS.MESSAGE_QUEUE, ['Phone', 'CTA Value', 'Message ID']);
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

  const v = validateConfig(getConfig(true));
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
  apply(SHEETS.CLIENTS, 'Status', list(['Active', 'Inactive']));
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
    const r = buildCampaignQueue(id);
    return r.added + ' message(s) queued. Duplicates skipped: ' + r.duplicates + '. Invalid phones: ' + r.skipped + '.\n(Queue is sent only while the campaign is ACTIVE — use Start Campaign.)';
  });
}

function menuStartCampaign() { runCampaignAction_('Start Campaign', id => startCampaign(id).message); }
function menuPauseCampaign() { runCampaignAction_('Pause Campaign', id => pauseCampaign(id).message); }
function menuResumeCampaign() { runCampaignAction_('Resume Campaign', id => resumeCampaign(id).message); }

function menuCancelCampaign() {
  const ui = SpreadsheetApp.getUi();
  runCampaignAction_('Cancel Campaign', id => {
    if (ui.alert('Cancel ' + id + '?', 'Unsent messages will be cancelled. This cannot be undone.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return 'Not cancelled.';
    return cancelCampaign(id).message;
  });
}

function menuProcessQueueNow() {
  const r = processMessageQueue();
  refreshDashboard();
  SpreadsheetApp.getUi().alert(r.skippedRun ? 'Another queue run is in progress — try again shortly.'
    : r.dailyLimitReached ? 'Daily send limit reached.'
    : r.error ? 'Configuration invalid — see LOGS.'
    : 'Sent: ' + r.sent + ', failed: ' + r.failed + ', scheduled for retry: ' + r.retried + '.');
}

function runCampaignAction_(title, fn) {
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
  sheet.getRange(2, 1).setValue('Updated ' + nowInTz_('yyyy-MM-dd HH:mm') + ' (' + getConfig().timezone + ')').setFontColor('#666666');

  sheet.getRange(4, 1, 1, 2).setValues([['Metric', 'Value']]).setFontWeight('bold').setBackground('#1f7a4d').setFontColor('#ffffff');
  sheet.getRange(5, 1, kpis.length, 2).setValues(kpis);

  const top = 5 + kpis.length + 2;
  const head = ['Campaign', 'Client', 'Audience', 'Queued', 'Sent', 'Delivered', 'Read', 'Failed', 'Replies', 'Status'];
  sheet.getRange(top, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#1f7a4d').setFontColor('#ffffff');
  if (table.length) sheet.getRange(top + 1, 1, table.length, head.length).setValues(table);
  sheet.autoResizeColumns(1, head.length);
  sheet.setFrozenRows(0);
}

function viewDashboard() {
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
  const cfg = getConfig();
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
  const cfg = getConfig();
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
  const cfg = getConfig();
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
  const cfg = getConfig();
  if (!cfg.adminEmail) return;
  safeSendEmail_(cfg.adminEmail, '[WhatsApp Automation] ' + subject, redactSecrets_(body) + '\n\nSpreadsheet: ' + ss_().getUrl());
}

function safeSendEmail_(to, subject, body) {
  try {
    if (MailApp.getRemainingDailyQuota() < 1) {
      logEvent_(LOG_LEVEL.WARNING, 'EMAIL_QUOTA', { error: 'Mail quota exhausted; email to ' + to.replace(/^(.).*(@.*)$/, '$1***$2') + ' not sent.' });
      return false;
    }
    MailApp.sendEmail({ to: to, subject: subject, body: body, name: getConfig().systemName });
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
    if (!e) throw new Error('onFormSubmit must be run by its trigger (no event object). Use "Install Triggers".');
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
 * Validates and stores one campaign. Shared by onFormSubmit and reprocessFormResponse.
 * @return { ok, campaignId, status, errors, warnings }
 */
function createCampaignFromInput_(input, source) {
  const cfg = getConfig(true);
  const v = validateCampaignInput_(input);
  const d = v.data;

  if (v.errors.length) {
    logEvent_(LOG_LEVEL.WARNING, 'FORM_VALIDATION_FAILED', {
      result: 'REJECTED', error: v.errors.join(' | '),
      details: { business: d.businessName, campaign: d.campaignName, email: d.email ? d.email.replace(/^(.).*(@.*)$/, '$1***$2') : '' },
    });
    if (isValidEmail_(d.email)) sendAttentionEmail_(input, v.errors);
    notifyAdminOfSubmission_(d, null, 'REJECTED', v.errors, v.warnings);
    return { ok: false, errors: v.errors, warnings: v.warnings };
  }

  const clientId = findOrCreateClient_(d);
  if (isDuplicateCampaign_(clientId, d)) {
    const errors = ['A campaign named "' + d.campaignName + '" with the same schedule has already been submitted.'];
    logEvent_(LOG_LEVEL.WARNING, 'DUPLICATE_CAMPAIGN', { clientId: clientId, result: 'REJECTED', error: errors[0] });
    sendAttentionEmail_(input, errors);
    return { ok: false, errors: errors, warnings: v.warnings };
  }

  const campaignId = newCampaignId_();
  const now = new Date();
  const audienceSize = countAudience_(clientId, d.audience);
  const warnings = v.warnings.slice();
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
    const res = startCampaign(campaignId); // builds the queue; the scheduler trigger sends it
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
 *  - spreadsheet trigger with e.namedValues only
 *  - form trigger with e.response (FormResponse)
 */
function readFormInput_(e) {
  const answers = {};
  if (e.range && e.range.getSheet) {
    const sheet = e.range.getSheet();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const values = sheet.getRange(e.range.getRow(), 1, 1, headers.length).getValues()[0];
    headers.forEach((h, i) => { answers[String(h).trim().toLowerCase()] = values[i]; });
  } else if (e.namedValues) {
    Object.keys(e.namedValues).forEach(k => {
      const v = e.namedValues[k];
      answers[String(k).trim().toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
    });
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
  const cfg = getConfig(true);
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
function maytapiRequest(method, path, payload, cfg) {
  cfg = cfg || getConfig();
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

function sendMaytapiText(toNumber, text, cfg) {
  cfg = cfg || getConfig();
  return maytapiRequest('post', phonePath_(cfg, 'sendMessage'), {
    to_number: toNumber,
    type: 'text',
    message: String(text || ''),
  }, cfg);
}

/**
 * @param media  https URL or data URI (data:<mime>;base64,...) — see Media.gs
 * @param caption optional caption text
 */
function sendMaytapiMedia(toNumber, media, caption, filename, cfg) {
  cfg = cfg || getConfig();
  const payload = { to_number: toNumber, type: 'media', message: media };
  if (caption) payload.text = String(caption);
  if (filename) payload.filename = filename;
  return maytapiRequest('post', phonePath_(cfg, 'sendMessage'), payload, cfg);
}

/**
 * Sends an interactive button message.
 * @param buttons [{ type: 'URL'|'PHONE'|'QUICK_REPLY', text, value }]
 */
function sendMaytapiButtons(toNumber, body, buttons, cfg) {
  cfg = cfg || getConfig();
  return maytapiRequest('post', phonePath_(cfg, 'sendMessage'), buildButtonsPayload_(toNumber, body, buttons), cfg);
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
function sendMaytapiList() {
  return failResult_(0, 'List messages are not enabled: payload not verified against the current Maytapi documentation.');
}

/** Not implemented on purpose — see file header. */
function sendMaytapiCarousel() {
  return failResult_(0, 'Carousel messages are not enabled: payload not verified against the current Maytapi documentation.');
}

/* ============================== ACCOUNT / CONNECTION ============================== */

function maytapiListPhones(cfg) {
  return maytapiRequest('get', '/listPhones', null, cfg);
}

function maytapiPhoneStatus(cfg) {
  cfg = cfg || getConfig();
  return maytapiRequest('get', phonePath_(cfg, 'status'), null, cfg);
}

function maytapiSetWebhook(webhookUrl, cfg) {
  return maytapiRequest('post', '/setWebhook', { webhook: webhookUrl }, cfg);
}

/**
 * Menu / editor: checks credentials, that MAYTAPI_PHONE_ID belongs to the product,
 * and the phone's connection status. Prints nothing secret.
 */
function testMaytapiConnection() {
  const cfg = getConfig(true);
  const v = validateConfig(cfg);
  const lines = [formatValidation_(v)];
  let ok = v.ok;
  if (v.ok) {
    const phones = maytapiListPhones(cfg);
    if (!phones.success) {
      ok = false;
      lines.push('listPhones failed (HTTP ' + phones.httpStatus + '): ' + phones.error);
    } else {
      const list = Array.isArray(phones.response) ? phones.response : (phones.response && phones.response.data) || [];
      const match = Array.isArray(list) ? list.find(p => String(p.id) === String(cfg.phoneId)) : null;
      lines.push('Product reachable. Phones on product: ' + (Array.isArray(list) ? list.length : 'unknown') + '.');
      if (Array.isArray(list) && !match) { ok = false; lines.push('MAYTAPI_PHONE_ID was NOT found on this product.'); }
      if (match) lines.push('Sending phone: ' + maskPhone_(match.number || '') + ' (status: ' + (match.status || 'n/a') + ')');
    }
    const st = maytapiPhoneStatus(cfg);
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
 *   processCampaignImage(fileRef)  -> validates the Form upload, returns { fileId, ... }
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
function processCampaignImage(fileRef) {
  const cfg = getConfig();
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
  cfg = cfg || getConfig();
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
  cfg = cfg || getConfig();
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
  cfg = cfg || getConfig();
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
    const r = media ? sendMaytapiMedia(to, media.media, captionSafe_(text), media.filename, cfg) : sendMaytapiText(to, text, cfg);
    return finalize_(r, [r]);
  }

  // 2) CTA as text inside the caption/body (single bubble, always supported).
  if (cfg.imageCtaStyle === 'CAPTION_LINK') {
    const body = withCtaText_(text, cta);
    const r = media ? sendMaytapiMedia(to, media.media, captionSafe_(body), media.filename, cfg) : sendMaytapiText(to, body, cfg);
    return finalize_(r, [r]);
  }

  // 3) IMAGE_THEN_BUTTONS: image first (no caption), then the message with an interactive button.
  const results = [];
  if (media) {
    const r1 = sendMaytapiMedia(to, media.media, '', media.filename, cfg);
    results.push(r1);
    if (!r1.success) return finalize_(r1, results);
  }
  const r2 = sendMaytapiButtons(to, text, [cta], cfg);
  results.push(r2);
  if (r2.success) return finalize_(r2, results);

  // Button payload rejected (non-transient) => text fallback so the customer still gets the CTA.
  if (cfg.ctaFallbackToText && !r2.retryable && !r2.authError) {
    logEvent_(LOG_LEVEL.WARNING, 'BUTTON_FALLBACK', { phone: to, httpStatus: r2.httpStatus, error: r2.error, details: 'Buttons rejected; sending CTA as text.' });
    const r3 = sendMaytapiText(to, withCtaText_(text, cta), cfg);
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
function buildCampaignQueue(campaignId) {
  const cfg = getConfig();
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
function processMessageQueue() {
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
  const cfg = getConfig(true);
  const v = validateConfig(cfg);
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

  const today = todayKey_();
  const sentToday = queue.rows.filter(q => dateKey_(toDate_(q['Sent At'])) === today).length;
  let dailyRemaining = cfg.dailySendLimit - sentToday;
  if (dailyRemaining <= 0) {
    console.log('Daily send limit reached (' + cfg.dailySendLimit + ').');
    return { sent: 0, dailyLimitReached: true };
  }

  const now = Date.now();
  const due = queue.rows.filter(q => {
    const st = String(q['Status']);
    if (st !== QUEUE_STATUS.PENDING && st !== QUEUE_STATUS.QUEUED) return false;
    const camp = campaigns[q['Campaign ID']];
    if (!camp || String(camp['Status']) !== CAMPAIGN_STATUS.ACTIVE) return false;
    const at = toDate_(q['Scheduled At']);
    return !at || at.getTime() <= now;
  }).sort((a, b) => (toDate_(a['Scheduled At']) || 0) - (toDate_(b['Scheduled At']) || 0));

  const batch = due.slice(0, Math.min(cfg.batchSize, dailyRemaining));
  const mediaCache = {};
  let sent = 0, failed = 0, retried = 0;

  for (let i = 0; i < batch.length; i++) {
    if (Date.now() - started > MAX_EXECUTION_MS) {
      logEvent_(LOG_LEVEL.WARNING, 'QUEUE_TIME_BUDGET', { details: 'Stopping early to avoid the Apps Script timeout; next run continues.' });
      break;
    }
    const q = batch[i];
    const campaign = campaigns[q['Campaign ID']];
    const ctx = { campaignId: q['Campaign ID'], clientId: q['Client ID'], contactId: q['Contact ID'], phone: q['Phone'] };

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

    q['Status'] = QUEUE_STATUS.PROCESSING;
    q['Started At'] = new Date();
    q['Last Attempt'] = new Date();
    q['Attempts'] = Number(q['Attempts'] || 0) + 1;
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
      }, cfg, mediaCache);
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
      dailyRemaining--;
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
        details: { attempts: attempts, retryable: !!r.retryable, rateLimited: !!r.rateLimited, partial: !!r.partial },
      }, ctx));

      if (r.stopBatch) {
        logEvent_(LOG_LEVEL.ERROR, 'QUEUE_BATCH_STOPPED', Object.assign({ error: r.error, details: r.authError ? 'Authentication problem — check Maytapi credentials.' : 'Rate limit or sending-phone problem — will resume on next run.' }, ctx));
        if (r.authError) notifyAdmin_('Maytapi authentication error', 'Queue processing stopped: ' + r.error);
        break;
      }
    }

    if (i < batch.length - 1) randomDelay_(cfg);
  }

  completeFinishedCampaigns_();
  if (batch.length) console.log('Queue run: sent=' + sent + ' failed=' + failed + ' retry=' + retried);
  return { sent: sent, failed: failed, retried: retried };
}

/**
 * Resets FAILED messages to PENDING (attempts cleared) for one campaign or all ('*').
 * Re-activates COMPLETED campaigns that get messages back.
 */
function retryFailedMessages(campaignId) {
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
      const n = activateScheduledCampaigns();
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
  const cfg = getConfig(true);
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
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (MANAGED_TRIGGER_HANDLERS.indexOf(t.getHandlerFunction()) >= 0) { ScriptApp.deleteTrigger(t); n++; }
  });
  logEvent_(LOG_LEVEL.WARNING, 'REMOVE_TRIGGERS', { result: n + ' removed' });
  try { SpreadsheetApp.getUi().alert(n + ' trigger(s) removed. Campaigns will not send until triggers are reinstalled.'); } catch (err) { console.log(n + ' removed'); }
}

function listTriggers() {
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

/** Health/status endpoint. Exposes no secrets or data. */
function doGet(e) {
  let configured = false;
  try { configured = validateConfig(getConfig(true)).ok; } catch (err) { configured = false; }
  return jsonOut_({
    status: 'ok',
    service: 'whatsapp-campaign-automation',
    version: SYSTEM_VERSION,
    configured: configured,
    time: new Date().toISOString(),
  });
}

/** Maytapi webhook receiver. Always returns 200 + JSON so Maytapi does not retry-storm. */
function doPost(e) {
  const cfg = getConfig(true);
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
    // Ignore events for other Maytapi phones on the same product.
    const phoneId = payload.phone_id || payload.phoneId;
    if (phoneId && cfg.phoneId && String(phoneId) !== String(cfg.phoneId)) return jsonOut_({ ok: true, ignored: 'other phone' });

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
  const ctx = resolveContactContext_(phone);

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
    const n = optOutPhone_(phone, 'Keyword "' + upper + '"');
    if (cfg.optOutReply) sendMaytapiText(phone, cfg.optOutReply, cfg);
    recordResponse_(Object.assign(base, { status: 'OPTED_OUT', processed: 'YES: opt-out (' + n + ' contact record(s))' }));
    return;
  }

  // 2) Keyword auto-replies from TEMPLATES.
  let processed = 'NO: no matching template';
  if (cfg.autoReplyEnabled) {
    const candidates = replyCandidates_(m, text, ctx.campaign);
    const tpl = findReplyTemplate_(candidates);
    if (tpl) {
      const r = sendTemplateReply_(tpl, phone, ctx, cfg);
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

/** Finds the most recent campaign this phone received, plus the matching contact. */
function resolveContactContext_(phone) {
  const ctx = { clientId: '', campaignId: '', campaign: null, contact: null, contactsTable: null };
  if (!phone) return ctx;
  let latest = null;
  readTable_(SHEETS.MESSAGE_QUEUE).rows.forEach(q => {
    if (normalizePhoneNumber(q['Phone']) !== phone) return;
    const t = toDate_(q['Sent At']) || toDate_(q['Created At']);
    if (t && (!latest || t > latest.t)) latest = { t: t, q: q };
  });
  if (latest) {
    ctx.clientId = String(latest.q['Client ID']);
    ctx.campaignId = String(latest.q['Campaign ID']);
    ctx.campaign = getCampaign_(ctx.campaignId).row;
  }
  ctx.contactsTable = readTable_(SHEETS.CONTACTS);
  const matches = ctx.contactsTable.rows.filter(c => normalizePhoneNumber(c['Phone']) === phone);
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
 * Opt-out: Opt In = NO on EVERY contact record with this phone (the sending number is
 * shared across clients) and unsent queue items are skipped. Returns records changed.
 */
function optOutPhone_(phone, reason) {
  const contacts = readTable_(SHEETS.CONTACTS);
  let n = 0;
  contacts.rows.forEach(c => {
    if (normalizePhoneNumber(c['Phone']) === phone) {
      updateFields_(contacts, c._row, { 'Opt In': 'NO', 'Updated At': new Date() });
      n++;
    }
  });
  const queue = readTable_(SHEETS.MESSAGE_QUEUE);
  queue.rows.forEach(q => {
    if (normalizePhoneNumber(q['Phone']) === phone && [QUEUE_STATUS.PENDING, QUEUE_STATUS.QUEUED].indexOf(String(q['Status'])) >= 0) {
      updateFields_(queue, q._row, { 'Status': QUEUE_STATUS.SKIPPED, 'Error': 'Recipient opted out' });
    }
  });
  logEvent_(LOG_LEVEL.WARNING, 'OPT_OUT', { phone: phone, result: n + ' record(s)', details: reason });
  return n;
}

/* ============================== AUTO-REPLY ENGINE ============================== */

/** First active template whose comma-separated Trigger list contains a candidate (case-insensitive). */
function findReplyTemplate_(candidates) {
  if (!candidates.length) return null;
  const templates = readTable_(SHEETS.TEMPLATES).rows.filter(t => isYes_(t['Active']));
  return templates.find(t => String(t['Trigger'] || '').split(',')
    .map(s => s.trim().toLowerCase()).filter(Boolean)
    .some(trigger => candidates.indexOf(trigger) >= 0)) || null;
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
function getWebhookUrl() {
  const cfg = getConfig(true);
  let base = cfg.webhookUrl;
  if (!base) { try { base = ScriptApp.getService().getUrl(); } catch (err) { base = ''; } }
  if (!base) return '';
  base = base.replace(/\?.*$/, '');
  return cfg.webhookSecret ? base + '?key=' + encodeURIComponent(cfg.webhookSecret) : base;
}

/** Menu: creates a webhook secret if needed and registers the URL with Maytapi (setWebhook). */
function configureWebhook() {
  ensureWebhookSecret_();
  const cfg = getConfig(true);
  const v = validateConfig(cfg);
  const ui = SpreadsheetApp.getUi();
  if (!v.ok) return ui.alert('Fix configuration first:\n' + v.errors.join('\n'));
  const url = getWebhookUrl();
  if (!url) return ui.alert('No Web App URL found. Deploy → New deployment → Web app (Execute as: Me, Access: Anyone), then paste the /exec URL into SETTINGS → WEBHOOK_URL.');
  if (/\/dev(\?|$)/.test(url)) return ui.alert('The URL is a /dev test URL, which Maytapi cannot call. Paste the deployed /exec URL into SETTINGS → WEBHOOK_URL.');

  const r = maytapiSetWebhook(url, cfg);
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
