/**
 * Code.gs — entry points, router and one-time setup.
 *
 * DEPLOY TWICE from this same project (Deploy > New deployment > Web app):
 *
 *   1. PUBLIC API   Execute as: Me   Who has access: Anyone
 *      Used by the static site (index/signup/login/dashboard/refer).
 *      Put this /exec URL in web/assets/config.js.
 *
 *   2. ADMIN CONSOLE  Execute as: Me   Who has access: Only myself
 *      Open this /exec URL in your browser — it serves the admin page itself.
 *      Because Google gates the URL, only your account can reach it and no
 *      admin password ever has to exist.
 *
 * Run setup() once from the editor before deploying.
 */

// ---------------------------------------------------------------- HTTP

function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
    return route_(String(body.action || ''), body.payload || {}, body.token || '');
  } catch (error) {
    return err_('Request failed: ' + error.message, 'exception');
  }
}

/** GET serves the admin console; on the public deployment it stays locked. */
function doGet(e) {
  var action = e && e.parameter ? String(e.parameter.action || '') : '';

  // Tiny public endpoints so the landing page can render before any POST.
  if (action === 'rates') return actionRates_();
  if (action === 'ping')  return ok_({ pong: true, time: nowIso_() });

  if (!isAdmin_()) {
    return HtmlService.createHtmlOutput(
      '<p style="font:16px system-ui;padding:24px">Not authorised. Open the admin deployment ' +
      '(Who has access: <b>Only myself</b>) while signed in as the sheet owner.</p>'
    );
  }
  return HtmlService.createTemplateFromFile('Admin')
    .evaluate()
    .setTitle('Referral Admin')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Router. Public actions need no token; the rest resolve a referrer session.
 * Admin actions are not routed here at all — they run through google.script.run
 * from the private deployment, so they can never be reached by the public API.
 */
function route_(action, payload, token) {
  var publicActions = {
    'signup': actionSignup_,
    'login':  actionLogin_,
    'logout': actionLogout_,
    'quote':  actionQuote_,
    'rates':  function () { return actionRates_(); }
  };
  if (publicActions[action]) return publicActions[action](payload);

  // submitLead works logged in or not: a token attributes the lead to that
  // referrer, otherwise the form's referral code decides who gets credit.
  if (action === 'submitLead') {
    return actionSubmitLead_(payload, resolveSession_(token));
  }

  var authedActions = {
    'me':             function (p, me) { return ok_({ referrer: publicReferrer_(me) }); },
    'myReferrals':    actionMyReferrals_,
    'myEarnings':     actionMyEarnings_,
    'myPayouts':      actionMyPayouts_,
    'updateProfile':  actionUpdateProfile_,
    'changePassword': actionChangePassword_
  };
  if (!authedActions[action]) return err_('Unknown action: ' + action, 'unknown_action');

  var me = resolveSession_(token);
  if (!me) return err_('Please log in again', 'unauthorised');
  return authedActions[action](payload, me);
}

// ---------------------------------------------------------------- admin RPC
// Called only via google.script.run from Admin.html on the private deployment.
// Each one re-checks isAdmin_() rather than trusting the caller.

function adminGuard_(fn, p) {
  if (!isAdmin_()) return { ok: false, error: 'Not authorised', code: 'forbidden' };
  return JSON.parse(fn(p || {}).getContent());
}

function adminListReferrals(p)   { return adminGuard_(actionAdminReferrals_, p); }
function adminListReferrers(p)   { return adminGuard_(actionAdminReferrers_, p); }
function adminUpdateStage(p)     { return adminGuard_(actionAdminUpdateStage_, p); }
function adminCreateDeal(p)      { return adminGuard_(actionAdminCreateDeal_, p); }
function adminUpdateDeal(p)      { return adminGuard_(actionAdminUpdateDeal_, p); }
function adminRecordPayout(p)    { return adminGuard_(actionAdminRecordPayout_, p); }
function adminUpdateReferrer(p)  { return adminGuard_(actionAdminUpdateReferrer_, p); }
function adminRates()            { return adminGuard_(function () { return actionRates_(); }, {}); }

// ---------------------------------------------------------------- setup

/**
 * Creates every tab with its header row, seeds Config, and generates the
 * password pepper. Safe to re-run: existing tabs and values are left alone.
 */
function setup() {
  var book = ss_();

  Object.keys(HEADERS).forEach(function (name) {
    var sh = book.getSheetByName(name);
    if (!sh) sh = book.insertSheet(name);
    var head = HEADERS[name];
    var current = sh.getRange(1, 1, 1, Math.max(head.length, sh.getLastColumn() || 1)).getValues()[0];
    if (String(current[0] || '') !== head[0]) {
      sh.getRange(1, 1, 1, head.length).setValues([head]);
    }
    sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#f1f3f4');
    sh.setFrozenRows(1);
  });

  // Numbers typed as "2,3" must never become dates again — the old sheet lost
  // 48 cells that way. Force plain text on the free-text numeric columns.
  forcePlainText_(SHEETS.REFERRALS, ['Budget', 'BHK']);
  forcePlainText_(SHEETS.REFERRERS, ['Phone', 'AccountNumber', 'IFSC', 'PAN']);

  seedConfig_();

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PEPPER')) props.setProperty('PEPPER', Utilities.getUuid() + Utilities.getUuid());

  // Remove the default empty sheet if it is still there and unused.
  var def = book.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && book.getSheets().length > 1) book.deleteSheet(def);

  SpreadsheetApp.flush();
  return 'Setup complete. Tabs ready: ' + Object.keys(HEADERS).join(', ');
}

function forcePlainText_(sheetName, columns) {
  var sh = sheet_(sheetName);
  var head = HEADERS[sheetName];
  columns.forEach(function (c) {
    var i = head.indexOf(c);
    if (i < 0) return;
    sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
  });
}

var DEFAULT_CONFIG = [
  ['brand_name', 'Grihobazar Partners', 'Shown across the referral site'],
  ['brokerage_pct', 2, 'Brokerage you earn on a deal, as % of deal value'],
  ['tier_threshold', 10000000, 'Deal value at or above which the higher share applies (₹1 Cr)'],
  ['tier_low_pct', 15, '% of brokerage shared with the referrer BELOW the threshold'],
  ['tier_high_pct', 20, '% of brokerage shared with the referrer AT/ABOVE the threshold'],
  ['tds_pct', 2, 'TDS deducted from the referrer commission — confirm the rate with your CA'],
  ['attribution_lock_days', 90, 'First referrer owns a buyer phone for this many days'],
  ['payout_days_after_registration', 15, 'Promised payout window after registration'],
  ['admin_emails', '', 'Extra admin emails (same Workspace domain only)'],
  ['notify_email', '', 'Where new-lead emails are sent; blank disables them'],
  ['support_phone', '', 'Shown to referrers for help'],
  ['support_email', '', 'Shown to referrers for help']
];

function seedConfig_() {
  var sh = sheet_(SHEETS.CONFIG);
  var existing = {};
  readAll_(SHEETS.CONFIG).forEach(function (r) { existing[String(r.Key).trim()] = true; });
  DEFAULT_CONFIG.forEach(function (row) {
    if (!existing[row[0]]) sh.appendRow(row);
  });
}

/** Housekeeping: drop expired sessions. Attach a daily time-driven trigger. */
function purgeExpiredSessions() {
  var sh = sheet_(SHEETS.SESSIONS);
  var now = new Date();
  readAll_(SHEETS.SESSIONS)
    .filter(function (s) { return new Date(s.Expires) < now; })
    .sort(function (a, b) { return b._row - a._row; })
    .forEach(function (s) { sh.deleteRow(s._row); });
}

/** Housekeeping: stale `new`/`contacted` leads age out so the board stays honest. */
function expireStaleReferrals() {
  var days = cfgNum_('attribution_lock_days', 90);
  var cutoff = new Date(Date.now() - days * 86400000);
  readAll_(SHEETS.REFERRALS).forEach(function (r) {
    var stage = String(r.Stage).toLowerCase();
    if (stage !== 'new' && stage !== 'contacted') return;
    if (new Date(r.CreatedAt) >= cutoff) return;
    update_(SHEETS.REFERRALS, r._row, {
      Stage: 'expired', StageUpdatedAt: nowIso_(),
      StageNote: 'Auto-expired after ' + days + ' days with no progress'
    });
  });
}
