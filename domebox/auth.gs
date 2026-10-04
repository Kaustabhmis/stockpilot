/**
 * DOME BOX — AUTHENTICATION
 * =============================================================================
 * Replaces two things that are currently broken in a way that cannot be patched
 * around:
 *
 * 1. PASSWORDS ARE STORED IN PLAIN TEXT.
 *    Users!C holds the actual password, Global_Users!B holds it again, and
 *    Directory!C a third time. getUsersList() returns it to the browser. Anyone
 *    who opens a tenant sheet — which until now was anyone with the link — reads
 *    every employee's password. People reuse passwords, so the damage does not
 *    stop at your product.
 *
 * 2. THE SERVER TRUSTS THE BROWSER ABOUT WHO YOU ARE.
 *    doPost does `const user = params.user` and then acts on it. Nothing is
 *    verified. Anyone who knows a sheetId can post
 *    {action:'getUsersList', sheetId:'…', user:{role:'Admin'}} and receive that
 *    company's entire staff list including passwords. They can also delete
 *    users, reassign tasks, or read everything.
 *
 * MIGRATION IS TRANSPARENT. verifyPassword_ accepts a stored plaintext value,
 * and on a successful login immediately rewrites it as a hash. No flag day, no
 * forced reset, no customer locked out. After a few weeks, run
 * countUnmigratedPasswords() and reset the stragglers.
 * =============================================================================
 */

var AUTH = {
  ITERATIONS: 1000,       // see the note on cost below
  SESSION_HOURS: 12,
  PEPPER_PROP: 'AUTH_PEPPER',
  TOKEN_PROP: 'TOKEN_SECRET',
};

/**
 * One-time setup. Generates the two server-side secrets and stores them in
 * Script Properties, where a leaked spreadsheet cannot reach them.
 *
 * The pepper is what makes a stolen Users sheet useless on its own: without it
 * the hashes cannot be checked offline at any speed. Keep it. If you lose it,
 * every password must be reset.
 */
function initAuthSecrets() {
  var p = PropertiesService.getScriptProperties();
  var made = [];
  if (!p.getProperty(AUTH.PEPPER_PROP)) { p.setProperty(AUTH.PEPPER_PROP, Utilities.getUuid() + Utilities.getUuid()); made.push('AUTH_PEPPER'); }
  if (!p.getProperty(AUTH.TOKEN_PROP)) { p.setProperty(AUTH.TOKEN_PROP, Utilities.getUuid() + Utilities.getUuid()); made.push('TOKEN_SECRET'); }
  Logger.log(made.length
    ? 'Created: ' + made.join(', ') + '\nBack these up somewhere safe. Losing AUTH_PEPPER means every password must be reset.'
    : 'Both secrets already exist. Nothing changed.');
}

function authPepper_() {
  var v = PropertiesService.getScriptProperties().getProperty(AUTH.PEPPER_PROP);
  if (!v) throw new Error('AUTH_PEPPER is not set. Run initAuthSecrets() once.');
  return v;
}
function tokenSecret_() {
  var v = PropertiesService.getScriptProperties().getProperty(AUTH.TOKEN_PROP);
  if (!v) throw new Error('TOKEN_SECRET is not set. Run initAuthSecrets() once.');
  return v;
}

function toHex_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += ('0' + (bytes[i] & 0xFF).toString(16)).slice(-2);
  return s;
}

/**
 * Iterated HMAC-SHA256 over salt + pepper.
 *
 * On cost: Apps Script's Utilities.computeHmacSha256Signature is not fast, and
 * login runs inside a 30-second request, so this cannot use the iteration counts
 * you would pick in a normal backend. 1000 is roughly 1–2 seconds here — slow
 * enough to matter, not slow enough to time out. The real defence is the pepper:
 * an attacker holding the Users sheet still cannot test a single guess without
 * it. Measure with benchmarkHash() on your own account and tune.
 */
function hashPassword_(password, salt) {
  var pepper = authPepper_();
  var acc = String(salt) + ':' + String(password) + ':' + pepper;
  var bytes = Utilities.computeHmacSha256Signature(acc, pepper);
  for (var i = 1; i < AUTH.ITERATIONS; i++) {
    bytes = Utilities.computeHmacSha256Signature(bytes, pepper);
  }
  return 'v1$' + AUTH.ITERATIONS + '$' + salt + '$' + toHex_(bytes);
}

function makePasswordHash(password) {
  return hashPassword_(password, Utilities.getUuid().replace(/-/g, '').slice(0, 16));
}

function isHashed_(stored) { return /^v1\$\d+\$/.test(String(stored || '')); }

/** Length-independent comparison, so timing does not leak how much matched. */
function safeEquals_(a, b) {
  a = String(a == null ? '' : a); b = String(b == null ? '' : b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Returns { ok, needsUpgrade }. needsUpgrade true means the stored value was
 * plaintext and the caller should write back makePasswordHash(password).
 */
function verifyPassword_(password, stored) {
  if (stored == null || stored === '') return { ok: false, needsUpgrade: false };
  if (!isHashed_(stored)) {
    // Legacy plaintext. Accept it once, then upgrade.
    return { ok: safeEquals_(String(password), String(stored)), needsUpgrade: true };
  }
  var parts = String(stored).split('$');
  if (parts.length !== 4) return { ok: false, needsUpgrade: false };
  var iters = Number(parts[1]), salt = parts[2];
  var was = AUTH.ITERATIONS;
  try {
    AUTH.ITERATIONS = iters;              // verify at the cost it was written with
    return { ok: safeEquals_(hashPassword_(password, salt), stored), needsUpgrade: false };
  } finally { AUTH.ITERATIONS = was; }
}

/* ---------------------------------------------------------------------------
   SESSION TOKENS
   The server stops asking the browser who it is. The token is signed with a
   secret the browser never sees, carries the identity, and expires.
   ------------------------------------------------------------------------- */

function issueToken(sheetId, username, role) {
  var exp = Date.now() + AUTH.SESSION_HOURS * 3600 * 1000;
  var body = [sheetId, username, role, exp].join('|');
  var sig = toHex_(Utilities.computeHmacSha256Signature(body, tokenSecret_()));
  return Utilities.base64EncodeWebSafe(body) + '.' + sig;
}

/**
 * Returns the identity the token proves, or throws. Every protected route must
 * call this and use what it returns — never params.user.
 */
function requireSession(token) {
  if (!token) throw new Error('Not signed in.');
  var bits = String(token).split('.');
  if (bits.length !== 2) throw new Error('Session is invalid. Please sign in again.');
  var body;
  try { body = Utilities.newBlob(Utilities.base64DecodeWebSafe(bits[0])).getDataAsString(); }
  catch (e) { throw new Error('Session is invalid. Please sign in again.'); }

  var expect = toHex_(Utilities.computeHmacSha256Signature(body, tokenSecret_()));
  if (!safeEquals_(expect, bits[1])) throw new Error('Session is invalid. Please sign in again.');

  var f = body.split('|');
  if (f.length !== 4) throw new Error('Session is invalid. Please sign in again.');
  if (Number(f[3]) < Date.now()) throw new Error('Session has expired. Please sign in again.');

  return { sheetId: f[0], username: f[1], role: f[2], expires: Number(f[3]) };
}

/** Routes that only an Admin may call. */
function requireAdmin(session) {
  if (!session || session.role !== 'Admin') throw new Error('That action needs an Admin account.');
  return session;
}

/* ---------------------------------------------------------------------------
   LOGIN THROTTLE — a password that is one of the top thousand is found in
   minutes without this, and nothing in the current code slows anyone down.
   ------------------------------------------------------------------------- */
var LOGIN_LIMIT = { MAX: 8, WINDOW_MIN: 15 };

function loginAllowed_(key) {
  var cache = CacheService.getScriptCache();
  var k = 'lg_' + Utilities.base64EncodeWebSafe(String(key).toLowerCase()).slice(0, 80);
  var n = Number(cache.get(k) || 0);
  return { ok: n < LOGIN_LIMIT.MAX, attempts: n, key: k };
}
function recordFailedLogin_(state) {
  CacheService.getScriptCache().put(state.key, String(state.attempts + 1), LOGIN_LIMIT.WINDOW_MIN * 60);
}
function clearLoginFailures_(state) { CacheService.getScriptCache().remove(state.key); }

/* ---------------------------------------------------------------------------
   OPERATIONAL HELPERS
   ------------------------------------------------------------------------- */

function benchmarkHash() {
  var t = Date.now();
  makePasswordHash('benchmark-only-not-a-real-password');
  var ms = Date.now() - t;
  Logger.log('One hash at ' + AUTH.ITERATIONS + ' iterations: ' + ms + ' ms.\n' +
    (ms > 4000 ? 'Too slow for a login request — lower AUTH.ITERATIONS.'
     : ms < 200 ? 'Comfortably fast; you can raise AUTH.ITERATIONS.'
     : 'Reasonable. Logins will feel normal.'));
}

/** How much plaintext is still out there. Run weekly after rollout. */
function countUnmigratedPasswords() {
  var out = ['', '=== PLAINTEXT PASSWORDS REMAINING ===', ''];
  var total = 0, plain = 0;
  /* Resolved through the shared config rather than a constant in another file,
     so this works whether auth.gs is bundled into code.gs or run on its own. */
  var masterId = (typeof CFG === 'function' && CFG().masterId) ||
                 (typeof SHARE !== 'undefined' && SHARE.MASTER_DB_ID) || '';
  if (!masterId) { Logger.log('MASTER_DB_ID is not configured.'); return; }
  var master = SpreadsheetApp.openById(masterId);

  var g = master.getSheetByName('Global_Users');
  if (g) {
    var gd = g.getDataRange().getValues();
    var gp = 0;
    for (var i = 1; i < gd.length; i++) { total++; if (gd[i][1] && !isHashed_(gd[i][1])) { gp++; plain++; } }
    out.push('Global_Users: ' + gp + ' of ' + (gd.length - 1) + ' still plaintext');
  }

  var tenants = (typeof allTenants_ === 'function') ? allTenants_()
              : (typeof tenantRows_ === 'function') ? tenantRows_() : [];
  tenants.forEach(function (r) {
    try {
      var sh = SpreadsheetApp.openById(r.sheetId).getSheetByName('Users');
      if (!sh) return;
      var d = sh.getDataRange().getValues(), p = 0;
      for (var i = 1; i < d.length; i++) { total++; if (d[i][2] && !isHashed_(d[i][2])) { p++; plain++; } }
      if (p) out.push('  ' + (r.company || r.sheetId) + ': ' + p + ' of ' + (d.length - 1));
    } catch (e) { out.push('  ' + (r.company || r.sheetId) + ': ' + e.message); }
  });

  out.push('');
  out.push(plain + ' plaintext passwords remain across ' + total + ' records.');
  out.push(plain === 0 ? 'Migration complete.'
    : 'These upgrade automatically as each person next signs in. Force-reset the\n' +
      'remainder once the number stops falling.');
  Logger.log(out.join('\n'));
}
