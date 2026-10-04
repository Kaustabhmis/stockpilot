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
