/**
 * Util.gs — shared helpers: sheet access, config, hashing, responses.
 * All files in an Apps Script project share one global scope.
 */

var SHEETS = {
  REFERRERS: 'Referrers',
  SESSIONS:  'Sessions',
  REFERRALS: 'Referrals',
  DEALS:     'Deals',
  PAYOUTS:   'Payouts',
  CONFIG:    'Config',
  AUDIT:     'AuditLog'
};

var HEADERS = {
  Referrers: ['ID','Name','Phone','Email','City','PassHash','Salt','ReferralCode','Status','KYCStatus',
              'PAN','BankName','AccountNumber','IFSC','UPI','CreatedAt','LastLogin'],
  Sessions:  ['TokenHash','ReferrerID','CreatedAt','Expires'],
  Referrals: ['ID','ReferrerID','ReferralCode','BuyerName','BuyerPhone','BuyerEmail','PropertyID',
              'PropertyTitle','Budget','BHK','Location','Notes','Stage','StageUpdatedAt','StageNote',
              'DuplicateOf','Source','CreatedAt'],
  Deals:     ['ID','ReferralID','ReferrerID','DealValue','BrokeragePct','BrokerageAmount','SharePct',
              'GrossCommission','PlatformFeePct','PlatformFeeAmount','CommissionAfterFee',
              'TdsPct','TdsAmount','NetPayable','Stage','BookingDate',
              'RegistrationDate','CreatedAt','UpdatedAt'],
  Payouts:   ['ID','ReferrerID','DealID','Amount','Mode','Reference','Status','PaidAt','Notes','CreatedAt'],
  Config:    ['Key','Value','Note'],
  AuditLog:  ['Timestamp','Actor','Action','Entity','EntityID','Details']
};

/** Stage machine for a referral. A referral only becomes a Deal at `booked`. */
var REFERRAL_STAGES = ['new','contacted','visit_scheduled','visited','negotiation','booked',
                       'registered','rejected','duplicate','expired'];

/** Stage machine for a deal. Commission is payable once `registered`. */
var DEAL_STAGES = ['booked','registered','payable','paid','cancelled'];

function ss_() {
  return SpreadsheetApp.getActive();
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Sheet missing: ' + name + ' — run setup() once from the Apps Script editor.');
  return sh;
}

/** Reads a whole tab as an array of objects keyed by header name. */
function readAll_(name) {
  var values = sheet_(name).getDataRange().getValues();
  if (values.length < 2) return [];
  var head = values[0];
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (row.join('') === '') continue;
    var o = { _row: r + 1 };
    for (var c = 0; c < head.length; c++) o[head[c]] = row[c];
    out.push(o);
  }
  return out;
}

function findBy_(name, field, value) {
  var rows = readAll_(name);
  var needle = String(value).trim().toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][field]).trim().toLowerCase() === needle) return rows[i];
  }
  return null;
}

/** Appends one object, ordering the cells by the tab's header row. */
function append_(name, obj) {
  var sh = sheet_(name);
  var head = HEADERS[name];
  var row = head.map(function (h) { return obj[h] === undefined ? '' : obj[h]; });
  sh.appendRow(row);
  return obj;
}

/** Updates named fields on one already-read row (needs obj._row). */
function update_(name, rowNumber, patch) {
  var sh = sheet_(name);
  var head = HEADERS[name];
  Object.keys(patch).forEach(function (k) {
    var i = head.indexOf(k);
    if (i >= 0) sh.getRange(rowNumber, i + 1).setValue(patch[k]);
  });
}

// ---------------------------------------------------------------- config

function getConfig() {
  var cache = CacheService.getScriptCache().get('cfg');
  if (cache) return JSON.parse(cache);
  var cfg = {};
  readAll_(SHEETS.CONFIG).forEach(function (r) { cfg[String(r.Key).trim()] = r.Value; });
  CacheService.getScriptCache().put('cfg', JSON.stringify(cfg), 60);
  return cfg;
}

function cfgNum_(key, fallback) {
  var v = getConfig()[key];
  return (v === '' || v === undefined || v === null || isNaN(Number(v))) ? fallback : Number(v);
}

// ---------------------------------------------------------------- ids & crypto

function uuid_() {
  return Utilities.getUuid();
}

function shortId_(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

/** Human-friendly referral code, e.g. GB7K4M2Q. Avoids 0/O and 1/I. */
function makeReferralCode_() {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (var attempt = 0; attempt < 20; attempt++) {
    var code = 'GB';
    for (var i = 0; i < 6; i++) code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    if (!findBy_(SHEETS.REFERRERS, 'ReferralCode', code)) return code;
  }
  throw new Error('Could not allocate a referral code');
}

function b64_(bytes) {
  return Utilities.base64Encode(bytes);
}

/**
 * Iterated SHA-256 with a per-user salt and a server-side pepper.
 * Apps Script has no bcrypt/argon2; iteration raises the cost of an offline
 * guess, and the pepper lives in Script Properties, never in the sheet.
 */
function hashPassword_(password, salt) {
  var pepper = PropertiesService.getScriptProperties().getProperty('PEPPER') || '';
  var data = Utilities.newBlob(salt + '|' + password + '|' + pepper).getBytes();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, data);
  for (var i = 0; i < 12000; i++) {
    digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, digest);
  }
  return b64_(digest);
}

function hashToken_(token) {
  return b64_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
}

/** Constant-time-ish compare so a wrong password can't be timed byte by byte. */
function safeEqual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------- misc

/** Normalises an Indian mobile number to 10 digits so duplicates actually match. */
function normPhone_(phone) {
  var d = String(phone || '').replace(/\D/g, '');
  if (d.length > 10) d = d.slice(-10);
  return d;
}

function isValidPhone_(phone) {
  return /^[6-9]\d{9}$/.test(normPhone_(phone));
}

function isValidEmail_(email) {
  return !email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email).trim());
}

function nowIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}

function daysFromNow_(days) {
  return Utilities.formatDate(new Date(Date.now() + days * 86400000),
                              Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}

function audit_(actor, action, entity, entityId, details) {
  try {
    append_(SHEETS.AUDIT, {
      Timestamp: nowIso_(), Actor: actor || 'anon', Action: action,
      Entity: entity || '', EntityID: entityId || '',
      Details: typeof details === 'string' ? details : JSON.stringify(details || {})
    });
  } catch (err) {
    // Never let audit failure break the request it is describing.
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ok_(data)  { return json_({ ok: true,  data: data || {} }); }
function err_(msg, code) { return json_({ ok: false, error: msg, code: code || 'error' }); }
