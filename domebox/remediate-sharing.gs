/**
 * DOME BOX — EMERGENCY: LOCK DOWN TENANT DATABASES
 * =============================================================================
 * registerCompany() currently runs:
 *
 *     newFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
 *
 * Every customer spreadsheet ever created is therefore readable AND WRITABLE by
 * anyone who has, finds or guesses its URL — no Google sign-in required. Those
 * files contain every employee's name, email, phone, task history, performance
 * score and (today) their password in plain text.
 *
 * The file id is not secret either: it is handed to the browser at login and is
 * in every request your front end makes, so it sits in browser history, in any
 * shared screenshot, in proxy logs, and in the clipboard of anyone who has ever
 * opened devtools.
 *
 * This script removes link sharing from every tenant file in the registry.
 *
 * THIS DOES NOT BREAK YOUR APP. All reads and writes go through Apps Script,
 * which runs as you and uses SpreadsheetApp.openById — that is owner access and
 * does not depend on link sharing. The only thing that stops working is opening
 * the file as an anonymous stranger, which is the thing you want to stop.
 *
 * RUN ORDER
 *   1. auditSharing()        read-only; shows exactly what is exposed today
 *   2. lockDownAllTenants()  fixes it
 *   3. auditSharing()        confirms
 *   4. Then edit registerCompany so new files are never created exposed.
 * =============================================================================
 */

var SHARE = {
  MASTER_DB_ID: '1qO3Q2WJ7X3xOf9Xi-JyYZbi3c-zbsdwrSKqQv--dakQ',
  DIRECTORY_TAB: 'Directory',
  SHEET_ID_COL: 5,          // zero-based: column F holds the tenant sheet id
  COMPANY_COL: 0,
  DRY_RUN: true,            // set false only after reading the audit
  ALSO_LOCK_TEMPLATE: true,
};

/** Read-only. Changes nothing. Run this first. */
function auditSharing() {
  var out = ['', '=== TENANT FILE SHARING AUDIT ===', ''];
  var rows = tenantRows_();
  if (!rows.length) { Logger.log('No tenants found in the registry.'); return; }

  var exposed = 0, fine = 0, unreadable = 0;

  if (SHARE.ALSO_LOCK_TEMPLATE) {
    out.push('TEMPLATE ' + describeFile_(templateId_()));
    out.push('');
  }

  rows.forEach(function (r) {
    var id = r.sheetId, label = r.company || id;
    try {
      var f = DriveApp.getFileById(id);
      var access = String(f.getSharingAccess());
      var perm = String(f.getSharingPermission());
      var open = (access === 'ANYONE' || access === 'ANYONE_WITH_LINK');
      if (open) { exposed++; out.push('  EXPOSED  ' + label + '  [' + access + ' / ' + perm + ']'); }
      else { fine++; out.push('  ok       ' + label + '  [' + access + ']'); }

      // Explicit editors are a separate matter: locking link sharing does not
      // remove someone you deliberately added, and you may not remember adding
      // them. Listed so you can check.
      var editors = f.getEditors().map(function (e) { return e.getEmail(); });
      var owner = f.getOwner() ? f.getOwner().getEmail() : '(unknown)';
      var others = editors.filter(function (e) { return e !== owner; });
      if (others.length) out.push('           explicit editors: ' + others.join(', '));
    } catch (e) {
      unreadable++;
      out.push('  ERROR    ' + label + ': ' + e.message);
    }
  });

  out.push('');
  out.push('Exposed to anyone with the link: ' + exposed);
  out.push('Already private: ' + fine);
  if (unreadable) out.push('Could not read: ' + unreadable);
  if (exposed) {
    out.push('');
    out.push('Each exposed file is a live data breach: anyone with the URL can read');
    out.push('and edit that company\'s staff records. Run lockDownAllTenants() with');
    out.push('SHARE.DRY_RUN = false to close them.');
  }
  Logger.log(out.join('\n'));
}

function lockDownAllTenants() {
  var out = ['', '=== LOCKING DOWN TENANT FILES ===',
    SHARE.DRY_RUN ? '*** DRY RUN — nothing will be changed ***' : '*** LIVE ***', ''];
  var rows = tenantRows_();
  var fixed = 0, already = 0, failed = 0;

  if (SHARE.ALSO_LOCK_TEMPLATE) {
    var t = templateId_();
    if (t) { if (lockOne_(t, 'TEMPLATE', out)) fixed++; }
  }

  rows.forEach(function (r) {
    var res = lockOne_(r.sheetId, r.company || r.sheetId, out);
    if (res === true) fixed++; else if (res === 'already') already++; else failed++;
  });

  out.push('');
  out.push((SHARE.DRY_RUN ? 'Would close: ' : 'Closed: ') + fixed +
           '   Already private: ' + already + '   Failed: ' + failed);
  if (SHARE.DRY_RUN) out.push('\nSet SHARE.DRY_RUN = false and run again to apply.');
  else out.push('\nNow run auditSharing() to confirm, then fix registerCompany so new\n' +
                'companies are never created exposed. See SECURITY-CRITICAL.md step 2.');
  Logger.log(out.join('\n'));
}

function lockOne_(id, label, out) {
  try {
    var f = DriveApp.getFileById(id);
    var access = String(f.getSharingAccess());
    if (access !== 'ANYONE' && access !== 'ANYONE_WITH_LINK') {
      out.push('  ok       ' + label + ' (already private)');
      return 'already';
    }
    if (SHARE.DRY_RUN) { out.push('  WOULD FIX ' + label + ' [' + access + ']'); return true; }
    f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    out.push('  CLOSED   ' + label);
    return true;
  } catch (e) {
    out.push('  FAILED   ' + label + ': ' + e.message);
    return false;
  }
}

function tenantRows_() {
  try {
    var ss = SpreadsheetApp.openById(SHARE.MASTER_DB_ID);
    var sh = ss.getSheetByName(SHARE.DIRECTORY_TAB) || ss.getSheets()[0];
    var data = sh.getDataRange().getValues();
    var out = [];
    for (var i = 1; i < data.length; i++) {
      var id = data[i][SHARE.SHEET_ID_COL];
      if (id) out.push({ company: data[i][SHARE.COMPANY_COL], sheetId: String(id).trim() });
    }
    return out;
  } catch (e) {
    Logger.log('Could not read the registry: ' + e.message);
    return [];
  }
}

function templateId_() {
  try { return typeof TEMPLATE_ID !== 'undefined' ? TEMPLATE_ID : ''; } catch (e) { return ''; }
}

function describeFile_(id) {
  if (!id) return '(no template id visible from this file)';
  try {
    var f = DriveApp.getFileById(id);
    return f.getName() + '  [' + f.getSharingAccess() + ' / ' + f.getSharingPermission() + ']';
  } catch (e) { return '(' + e.message + ')'; }
}
