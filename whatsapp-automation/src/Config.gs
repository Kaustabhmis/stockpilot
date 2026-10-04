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
