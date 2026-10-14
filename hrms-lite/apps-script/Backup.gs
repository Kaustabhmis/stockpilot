/**
 * BISCS OS — Google Sheet backup mirror
 * ------------------------------------------------------------------
 * After the move to Supabase, the live data lives in Postgres and this
 * Google Sheet becomes an automatic *backup copy*. On a schedule this
 * script signs in to the same API the app uses (as the owner), pulls every
 * table, and writes each one onto its matching tab — so the sheet always
 * holds a recent, readable snapshot you can open, export or print offline.
 *
 * Nothing here holds a database key. It authenticates with the owner login,
 * exactly like the web app, so the Supabase service key never leaves the
 * server and the database is never exposed. The only secret this script
 * keeps is the owner password, in this project's private Script Properties,
 * which you set yourself in setup (step 2 below).
 *
 * ── ONE-TIME SETUP ────────────────────────────────────────────────
 * 1. Open the "HRMS Data" sheet → Extensions → Apps Script. Paste this
 *    file in (as Backup.gs) and Save.
 * 2. Run the menu "BISCS Backup → Set owner login…" (or run setLogin() once)
 *    and enter the owner email + password. They are stored in Script
 *    Properties, not in this code.
 * 3. Run "BISCS Backup → Back up now" once and approve the permissions
 *    prompt. Check the tabs filled in.
 * 4. Run "BISCS Backup → Turn on auto-backup" to schedule it (hourly by
 *    default — change BACKUP_EVERY_HOURS below for a different cadence).
 * ------------------------------------------------------------------
 */

/* The live API endpoint (the same one the app uses). */
var BACKUP_API_URL = 'https://cquczxlfhrrrncbunbhy.supabase.co/functions/v1/api';

/* How often the auto-backup runs, in hours. 1 = hourly, 6 = four times a
   day, 24 = once a day. Change this then re-run "Turn on auto-backup". */
var BACKUP_EVERY_HOURS = 1;

/* The tabs to mirror, and the API "sheet" name for each. Left = tab title in
   this spreadsheet, right = the name the API knows it by (they are the same
   here). Remove any you do not want copied. */
var BACKUP_TABS = [
  'Settings', 'Users', 'Employees', 'Attendance', 'Holidays', 'Events',
  'Sites', 'Shifts', 'LeaveTypes', 'RequestTypes', 'Requests',
  'CtcVariables', 'CtcComponents', 'CtcValues', 'Notices',
  'ApprovalLevels', 'PayslipMail', 'Punches', 'Leave', 'Payroll',
  'Bonus', 'Gratuity', 'Increment'
];

/* ---- menu ---- */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('BISCS Backup')
    .addItem('Back up now', 'runBackup')
    .addSeparator()
    .addItem('Set owner login…', 'setLogin')
    .addItem('Turn on auto-backup', 'installBackupTrigger')
    .addItem('Turn off auto-backup', 'removeBackupTrigger')
    .addToUi();
}

/* ---- credentials (stored privately, never in code) ---- */
function setLogin() {
  var ui = SpreadsheetApp.getUi();
  var e = ui.prompt('Owner email', 'Enter the owner login email:', ui.ButtonSet.OK_CANCEL);
  if (e.getSelectedButton() !== ui.Button.OK) return;
  var p = ui.prompt('Owner password', 'Enter the owner password (stored privately):', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  PropertiesService.getScriptProperties().setProperties({
    BACKUP_EMAIL: e.getResponseText().trim(),
    BACKUP_PASSWORD: p.getResponseText()
  });
  ui.alert('Saved. Now run "Back up now" once to test.');
}

/* ---- the API call: same contract and headers the web app uses ---- */
function apiCall_(action, payload, token) {
  var body = JSON.stringify({ action: action, payload: payload || {}, token: token || '' });
  var res = UrlFetchApp.fetch(BACKUP_API_URL, {
    method: 'post',
    contentType: 'text/plain;charset=utf-8',
    payload: body,
    muteHttpExceptions: true
  });
  var text = res.getContentText();
  var out;
  try { out = JSON.parse(text); }
  catch (err) { throw new Error('API did not return JSON (HTTP ' + res.getResponseCode() + '): ' + text.slice(0, 200)); }
  if (!out || out.ok !== true) throw new Error((out && out.error) || 'API call failed: ' + action);
  return out.data;
}

function login_() {
  var props = PropertiesService.getScriptProperties();
  var email = props.getProperty('BACKUP_EMAIL');
  var pass = props.getProperty('BACKUP_PASSWORD');
  if (!email || !pass) throw new Error('No owner login set. Run "Set owner login…" first.');
  var who = apiCall_('login', { email: email, password: pass }, '');
  if (!who || !who.token) throw new Error('Login did not return a token — check the email/password.');
  return who.token;
}

/* ---- write one tab from an array of row objects ---- */
function writeTab_(ss, tabName, rows) {
  var sheet = ss.getSheetByName(tabName) || ss.insertSheet(tabName);
  rows = rows || [];

  /* Keep the tab's existing column order when it already has a header; add any
     new fields at the end. Otherwise derive the columns from the data. */
  var existing = [];
  if (sheet.getLastColumn() > 0 && sheet.getLastRow() > 0) {
    existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h).trim(); }).filter(function (h) { return h.length; });
  }
  var cols = existing.slice();
  var seen = {};
  cols.forEach(function (c) { seen[c] = true; });
  rows.forEach(function (r) {
    Object.keys(r).forEach(function (k) { if (!seen[k]) { seen[k] = true; cols.push(k); } });
  });
  if (!cols.length) { sheet.clearContents(); return 0; }

  var out = [cols];
  rows.forEach(function (r) {
    out.push(cols.map(function (c) {
      var v = r[c];
      return (v === null || v === undefined) ? '' : v;
    }));
  });

  sheet.clearContents();
  sheet.getRange(1, 1, out.length, cols.length).setValues(out);
  return rows.length;
}

/* ---- main ---- */
function runBackup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var token = login_();
  var started = new Date();
  var log = [];
  var total = 0, failed = 0;

  BACKUP_TABS.forEach(function (tab) {
    try {
      var rows = apiCall_('list', { sheet: tab }, token) || [];
      var n = writeTab_(ss, tab, rows);
      total += n;
      log.push([tab, n, 'ok']);
    } catch (err) {
      failed++;
      log.push([tab, '', String(err.message || err)]);
    }
  });

  writeStatus_(ss, started, total, failed, log);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Backup done: ' + total + ' rows across ' + (BACKUP_TABS.length - failed) + '/' +
    BACKUP_TABS.length + ' tabs.', 'BISCS Backup', 6);
}

/* ---- a small status/audit tab so you can see the last run at a glance ---- */
function writeStatus_(ss, started, total, failed, log) {
  var sheet = ss.getSheetByName('_Backup') || ss.insertSheet('_Backup');
  sheet.clearContents();
  var rows = [['Last backup', Utilities.formatDate(started, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')]];
  rows.push(['Total rows', total]);
  rows.push(['Tabs failed', failed]);
  rows.push(['', '']);
  rows.push(['Tab', 'Rows', 'Result']);
  log.forEach(function (r) { rows.push(r); });
  sheet.getRange(1, 1, rows.length, 3).setValues(rows.map(function (r) {
    return [r[0], r.length > 1 ? r[1] : '', r.length > 2 ? r[2] : ''];
  }));
}

/* ---- scheduling ---- */
function installBackupTrigger() {
  removeBackupTrigger();
  var b = ScriptApp.newTrigger('runBackup').timeBased();
  var h = Math.max(1, Math.round(BACKUP_EVERY_HOURS));
  if (h >= 24) b.everyDays(1).atHour(1);        // ~1am
  else b.everyHours(h);
  b.create();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Auto-backup is on (every ' + h + 'h).', 'BISCS Backup', 6);
}

function removeBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runBackup') ScriptApp.deleteTrigger(t);
  });
}
