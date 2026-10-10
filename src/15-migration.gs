// ===========================================================================
// MIGRATING EXISTING CUSTOMERS
// ===========================================================================
/**
 * DOME BOX — MOVING EXISTING CUSTOMERS ONTO THE NEW BUILD
 * =============================================================================
 * Two functions, both runnable from the editor's Run button:
 *
 *   previewMigration()     reads every customer, changes nothing, reports
 *   migrateAllTenants()    does it, under the lock, and reports the same way
 *
 * NOTHING IS COPIED OR MOVED. Each customer keeps the spreadsheet they already
 * have. The new code reads it where it is; the upgrade only ADDS — new column
 * headers after the old ones, and any tab that did not exist yet. No existing
 * row, cell or tab is rewritten, renamed, reordered or deleted.
 *
 * What it checks, per customer, before it touches anything:
 *
 *   · the sheet opens at all — a deleted or unshared file is reported, not
 *     guessed around
 *   · the existing header row is the one this code expects, column for column.
 *     The schema is positional, so a customer who once added their own column
 *     would have it overwritten by the first new field written there. Those
 *     sheets are reported and LEFT ALONE.
 *   · everyone in the Users tab can actually sign in. Sign-in looks people up
 *     in Global_Users; the old code wrote them there, but anybody added to a
 *     sheet by hand was not, and would be locked out after the switch. They
 *     are added to Global_Users with the password already in their row, so
 *     they sign in exactly as before.
 *
 * Run previewMigration() first and read it. A customer listed under NEEDS A
 * LOOK will not open on the new build until their sheet is sorted out — on
 * purpose, because the alternative is writing over their data.
 * =============================================================================
 */

function previewMigration() { return runMigration_(true); }
function migrateAllTenants() { return runMigration_(false); }

function runMigration_(dryRun) {
  var out = ['', dryRun ? '=== MIGRATION PREVIEW — nothing is changed ===' : '=== MIGRATING CUSTOMERS ===', ''];
  var c = CFG();
  if (!c.masterId) { out.push('MASTER_DB_ID is not set. Run setupDomeBox().'); return say_(out); }

  var master = SpreadsheetApp.openById(c.masterId);
  var global = master.getSheetByName(TAB.GLOBAL);
  var known = {};
  if (global) global.getDataRange().getValues().slice(1).forEach(function (r) {
    known[String(r[0]).trim().toLowerCase() + '|' + String(r[2]).trim()] = true;
  });

  var tenants = allTenants_();
  var ready = [], fine = [], trouble = [], backfilled = 0;
  var p = PropertiesService.getScriptProperties();

  tenants.forEach(function (t) {
    var ss;
    try { ss = SpreadsheetApp.openById(t.sheetId); }
    catch (e) { trouble.push(t.company + ' — the sheet cannot be opened (' + e.message + ')'); return; }

    var r = upgradeTenantSchema_(ss, dryRun);
    if (!r.ok) { trouble.push(t.company + ' — ' + r.problems.join('; ')); return; }

    var tasks = Math.max(0, (ss.getSheetByName(TAB.TASKS) ? ss.getSheetByName(TAB.TASKS).getLastRow() : 1) - 1);
    var urs = ss.getSheetByName(TAB.USERS);
    var rows = urs ? urs.getDataRange().getValues().slice(1) : [];

    /* People who would be locked out: in the Users tab, not in Global_Users. */
    var missing = rows.filter(function (u) {
      var em = String(u[U['Email']] || '').trim().toLowerCase();
      return em && !known[em + '|' + t.sheetId];
    });
    if (!dryRun && missing.length) {
      withLock_(function () {
        missing.forEach(function (u) {
          var em = String(u[U['Email']]).trim().toLowerCase();
          global.appendRow([em, u[U['Password']], t.sheetId, String(u[U['Username']] || '').trim()]);
          known[em + '|' + t.sheetId] = true;
          backfilled++;
        });
      });
    }

    if (!dryRun) p.setProperty('SCHEMA_' + t.sheetId, SCHEMA_VERSION);
    var line = t.company + ' — ' + rows.length + (rows.length === 1 ? ' person, ' : ' people, ') +
      tasks + (tasks === 1 ? ' task' : ' tasks') +
      (r.added.length ? '; ' + (dryRun ? 'will add ' : 'added ') + r.added.join(', ') : '; already current') +
      (missing.length ? '; ' + missing.length + ' person' + (missing.length === 1 ? '' : 's') +
        (dryRun ? ' would be locked out — will be fixed' : ' given sign-in access') : '');
    (r.added.length || missing.length ? ready : fine).push(line);
  });

  out.push(tenants.length + ' customer' + (tenants.length === 1 ? '' : 's') + ' in the registry.');
  out.push('');
  if (ready.length) {
    out.push(dryRun ? '--- WILL BE UPGRADED (' + ready.length + ') ---' : '--- UPGRADED (' + ready.length + ') ---');
    ready.forEach(function (l) { out.push('  ' + l); });
    out.push('');
  }
  if (fine.length) {
    out.push('--- ALREADY CURRENT (' + fine.length + ') ---');
    fine.forEach(function (l) { out.push('  ' + l); });
    out.push('');
  }
  if (trouble.length) {
    out.push('--- NEEDS A LOOK (' + trouble.length + ') — LEFT EXACTLY AS THEY ARE ---');
    trouble.forEach(function (l) { out.push('  ' + l); });
    out.push('');
    out.push('  These will not open on the new build until fixed, so nothing in them is');
    out.push('  overwritten. It is almost always a column somebody added by hand. Move it');
    out.push('  past the last column Dome Box uses — Tasks: ' + colLetter_(TASK_COLS.length + 1) +
             ' or later; Users: ' + colLetter_(USER_COLS.length + 1) + ' or later —');
    out.push('  then run previewMigration() again.');
    out.push('');
  }
  out.push('Nothing is copied, moved or deleted. Old columns, rows and tabs are never');
  out.push('rewritten — new columns go after them, new tabs beside them.');
  if (dryRun) {
    out.push('');
    out.push(trouble.length ? 'Sort out NEEDS A LOOK, then run migrateAllTenants().'
                            : 'Looks good. Back up, then run migrateAllTenants().');
  } else if (backfilled) {
    out.push(backfilled + ' person' + (backfilled === 1 ? '' : 's') + ' who could not have signed in now can, with the password they already had.');
  }
  return say_(out);
}

function say_(lines) { var t = lines.join('\n'); Logger.log(t); return t; }
