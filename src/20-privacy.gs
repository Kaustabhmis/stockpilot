// ===========================================================================
// PRIVACY — erasing a company, or one person, when they ask
// ===========================================================================
//
// Run by the owner of this installation from the Apps Script editor, never
// from the website: an erasure that a stolen session could trigger would be a
// worse hole than the one it closes. Both functions need a typed confirmation
// so a mis-click on ▶ Run does nothing.
//
// WHAT IS KEPT, AND WHY
//   - Invoices (Master > Invoices). Indian GST law requires a seller to keep
//     tax invoices for at least 8 years; deleting them would be the offence.
//   - A person's username on tasks, approvals and meetings they took part in,
//     so the company's own history still adds up. Their name, email, phone,
//     password and leave reasons are removed; the username is all that stays.
//   - The ErrorLog, which holds no personal fields (emails there are masked).
// ===========================================================================

/**
 * Erases one company: its workspace sheet and every backup of it go to the
 * Drive bin (emptied by Google after 30 days), and its rows leave the
 * Directory, Global_Users, Billing and Reset_Tokens tabs.
 *
 *   eraseCompanyData('owner@company.com', 'ERASE owner@company.com')
 */
function eraseCompanyData(ownerEmail, confirm) {
  var email = String(ownerEmail || '').trim().toLowerCase();
  if (!email) return privacyLog_('Give the owner\'s email: eraseCompanyData(\'owner@company.com\', \'ERASE owner@company.com\')');
  if (String(confirm || '').trim() !== 'ERASE ' + email) {
    return privacyLog_('Nothing erased. To confirm, the second argument must be exactly: ERASE ' + email);
  }
  var master = SpreadsheetApp.openById(CFG().masterId);
  var hit = privacyCompany_(master, email);
  if (!hit) return privacyLog_('No company is registered to ' + email + '. Nothing erased.');

  var sheetId = hit.sheetId, done = [];
  try { DriveApp.getFileById(sheetId).setTrashed(true); done.push('workspace sheet moved to the Drive bin'); }
  catch (e) { done.push('workspace sheet could not be opened (' + e.message + ')'); }

  /* Backups are named "... [first 12 of the sheet id]" by backup.gs. */
  var key = '[' + String(sheetId).slice(0, 12) + ']', binned = 0;
  try {
    var it = DriveApp.searchFiles('title contains "' + key.replace(/"/g, '') + '" and trashed = false');
    while (it.hasNext()) { var f = it.next(); if (String(f.getName()).indexOf(key) >= 0) { f.setTrashed(true); binned++; } }
  } catch (e) { done.push('backups could not be searched (' + e.message + ')'); }
  done.push(binned + ' backup' + (binned === 1 ? '' : 's') + ' moved to the Drive bin');

  var emails = {};
  privacyDropRows_(master, TAB.GLOBAL, function (r) {
    if (String(r[2]).trim() !== sheetId) return false;
    emails[String(r[0]).trim().toLowerCase()] = true; return true;
  }, done);
  emails[email] = true;
  privacyDropRows_(master, TAB.DIRECTORY, function (r) { return String(r[5]).trim() === sheetId; }, done);
  privacyDropRows_(master, 'Billing', function (r) { return String(r[0]).trim() === sheetId; }, done);
  privacyDropRows_(master, TAB.TOKENS, function (r) { return !!emails[String(r[1]).trim().toLowerCase()]; }, done);

  return privacyLog_('Erased ' + hit.company + ':\n  - ' + done.join('\n  - ') +
    '\nKept: its invoices (GST law, 8 years). Empty the Drive bin to remove the files at once.');
}

/**
 * Erases one person inside a company: name, email, phone and password are
 * cleared, they are deactivated and signed out, their leave reasons are
 * removed, and they can no longer sign in. Their username stays on the
 * company's own records so its history still adds up.
 *
 *   erasePerson('owner@company.com', 'person@company.com', 'ERASE person@company.com')
 */
function erasePerson(companyOwnerEmail, person, confirm) {
  var owner = String(companyOwnerEmail || '').trim().toLowerCase();
  var who = String(person || '').trim().toLowerCase();
  if (!owner || !who) return privacyLog_('Use: erasePerson(\'owner@company.com\', \'person@company.com\', \'ERASE person@company.com\')');
  if (String(confirm || '').trim() !== 'ERASE ' + who) {
    return privacyLog_('Nothing erased. To confirm, the third argument must be exactly: ERASE ' + who);
  }
  var master = SpreadsheetApp.openById(CFG().masterId);
  var hit = privacyCompany_(master, owner);
  if (!hit) return privacyLog_('No company is registered to ' + owner + '. Nothing erased.');

  var ss = SpreadsheetApp.openById(hit.sheetId);
  var u = findUserByEmailOrName_(ss, who);
  if (!u) return privacyLog_('Nobody in ' + hit.company + ' has the email or username ' + who + '.');
  if (u.email.toLowerCase() === owner) {
    return privacyLog_(who + ' owns ' + hit.company + '. Erase the whole company with eraseCompanyData, ' +
      'or make someone else the owner first.');
  }

  var sh = ss.getSheetByName(TAB.USERS), row = u.rowIndex;
  [['Name', 'Former member'], ['Password', ''], ['Email', ''], ['Phone', ''],
   ['Active', false], ['WhatsApp OptIn', false]].forEach(function (c) {
    if (U[c[0]] != null) sh.getRange(row, U[c[0]] + 1).setValue(c[1]);
  });

  var done = ['name, email, phone and password cleared; deactivated'];
  var leave = ss.getSheetByName(TAB.LEAVE);
  if (leave) {
    var d = leave.getDataRange().getValues(), n = 0;
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][0]).trim() === u.username && d[i][3]) { leave.getRange(i + 1, 4).setValue(''); n++; }
    }
    done.push(n + ' leave reason' + (n === 1 ? '' : 's') + ' cleared');
  }
  endSessions_({ ss: ss, sheetId: hit.sheetId }, u.username);
  done.push('signed out everywhere');

  var mail = u.email.toLowerCase();
  if (mail) {
    privacyDropRows_(master, TAB.GLOBAL, function (r) {
      return String(r[0]).trim().toLowerCase() === mail && String(r[2]).trim() === hit.sheetId; }, done);
    privacyDropRows_(master, TAB.TOKENS, function (r) { return String(r[1]).trim().toLowerCase() === mail; }, done);
  }
  return privacyLog_('Erased ' + u.username + ' in ' + hit.company + ':\n  - ' + done.join('\n  - ') +
    '\nKept: the username on tasks and meetings they took part in, so the company\'s history adds up.' +
    '\nBackups taken before today still hold the old row; they age out under the backup schedule.');
}

/** The Directory row a company was registered under, by its owner's email. */
function privacyCompany_(master, email) {
  var dir = master.getSheetByName(TAB.DIRECTORY);
  if (!dir) return null;
  var d = dir.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][1]).trim().toLowerCase() === email && d[i][5]) {
      return { company: String(d[i][0]), sheetId: String(d[i][5]).trim() };
    }
  }
  return null;
}

/** Deletes matching rows from the bottom up, so the row numbers stay right. */
function privacyDropRows_(ss, tab, match, done) {
  var sh = ss.getSheetByName(tab);
  if (!sh) return;
  var d = sh.getDataRange().getValues(), n = 0;
  for (var i = d.length - 1; i >= 1; i--) { if (match(d[i])) { sh.deleteRow(i + 1); n++; } }
  done.push(n + ' row' + (n === 1 ? '' : 's') + ' removed from ' + tab);
}

function privacyLog_(msg) { Logger.log(msg); return msg; }
