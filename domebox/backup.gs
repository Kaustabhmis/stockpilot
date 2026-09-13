/**
 * DOME BOX — BACKUPS
 * =============================================================================
 * Sheets keeps version history, but that is not a backup. It does not survive
 * the failures that actually happen: a customer's own admin bulk-deleting rows
 * and nobody noticing for a week, a script writing across a sheet, a file moved
 * out of a Drive you can reach, or access revoked during a billing dispute.
 *
 * This takes a dated copy of every tenant spreadsheet each night, prunes old
 * ones, and emails you when something fails — because a backup job that fails
 * silently is worse than none: you believe you are covered.
 *
 * RESTORE IS DELIBERATELY NOT AUTOMATIC. Nothing here writes to a live tenant
 * sheet. restoreTenantToNewFile() makes a fresh copy from a backup and hands
 * you the id; repointing the registry is a human decision, because by the time
 * you are restoring, the live file may hold real work created after the backup.
 * =============================================================================
 */

var BACKUP = {
  FOLDER_ID: '',            // Drive folder for backups. Blank = created on first run.
  FOLDER_NAME: 'Dome Box Backups',
  KEEP_DAILY: 30,           // daily copies retained per tenant
  KEEP_MONTHLY: 12,         // plus the 1st of each month, retained a year
  ALERT_TO: 'info@biscsindia.com',
  MAX_PER_RUN: 60,          // Drive copy is slow; stay inside the 6-minute limit
  DRY_RUN: false,           // reading and copying only — safe to leave false
};

// ===========================================================================
// PURE HELPERS — unit-tested in Node
// ===========================================================================

/** Backup file name. Sorting these lexically also sorts them by date. */
function backupName(company, sheetId, date) {
  var stamp = ymd(date);
  var safe = String(company || 'tenant').replace(/[\\/:*?"<>|\[\]]/g, '-').slice(0, 60).trim();
  return stamp + '  ' + safe + '  [' + String(sheetId).slice(0, 12) + ']';
}

/** Pulls the date and tenant id back out of a name written by backupName. */
function parseBackupName(name) {
  var m = String(name || '').match(/^(\d{4}-\d{2}-\d{2})\s+(.*?)\s+\[([^\]]+)\]$/);
  if (!m) return null;
  return { date: m[1], company: m[2], sheetKey: m[3] };
}

/**
 * Which backups to delete. Keeps the most recent KEEP_DAILY, plus the 1st of
 * each month up to KEEP_MONTHLY, and never returns anything it cannot date —
 * an unparseable name is left alone rather than guessed at and deleted.
 */
function backupsToPrune(names, cfg, today) {
  cfg = cfg || BACKUP;
  var parsed = [];
  names.forEach(function (n) {
    var p = parseBackupName(n);
    if (p) parsed.push({ name: n, date: p.date });
  });
  parsed.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });

  var keep = {}, dailyKept = 0, monthlyKept = 0, seenMonth = {};
  parsed.forEach(function (p) {
    if (dailyKept < cfg.KEEP_DAILY) { keep[p.name] = true; dailyKept++; return; }
    var month = p.date.slice(0, 7);
    var isFirst = p.date.slice(8, 10) === '01';
    if (isFirst && !seenMonth[month] && monthlyKept < cfg.KEEP_MONTHLY) {
      keep[p.name] = true; seenMonth[month] = true; monthlyKept++;
    }
  });
  return parsed.filter(function (p) { return !keep[p.name]; }).map(function (p) { return p.name; });
}

/** Did every tenant get a copy today? */
function backupCoverage(tenants, namesToday) {
  var have = {};
  namesToday.forEach(function (n) {
    var p = parseBackupName(n);
    if (p) have[p.sheetKey] = true;
  });
  var missing = tenants.filter(function (t) { return !have[String(t.sheetId).slice(0, 12)]; });
  return { total: tenants.length, backedUp: tenants.length - missing.length, missing: missing };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BACKUP: BACKUP, backupName: backupName, parseBackupName: parseBackupName,
    backupsToPrune: backupsToPrune, backupCoverage: backupCoverage,
  };
}

// ===========================================================================
// APPS SCRIPT I/O
// ===========================================================================

function installBackupSchedule() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupAllTenants') ScriptApp.deleteTrigger(t);
  });
  // 02:00 — after the day's work, before the morning digest.
  ScriptApp.newTrigger('backupAllTenants').timeBased().atHour(2).everyDays(1).create();
  Logger.log('Nightly backup installed for 02:00. Run backupAllTenants() once by hand now, ' +
    'then run verifyLatestBackup() to confirm it actually worked.');
}

function backupFolder_() {
  if (BACKUP.FOLDER_ID) return DriveApp.getFolderById(BACKUP.FOLDER_ID);
  var it = DriveApp.getFoldersByName(BACKUP.FOLDER_NAME);
  if (it.hasNext()) return it.next();
  var f = DriveApp.createFolder(BACKUP.FOLDER_NAME);
  Logger.log('Created backup folder "' + BACKUP.FOLDER_NAME + '" — id ' + f.getId() +
    '\nPut that id in BACKUP.FOLDER_ID so it is never ambiguous.');
  return f;
}

function backupAllTenants() {
  var started = new Date();
  var log = ['', '=== BACKUP ' + started.toDateString() + ' ===',
    BACKUP.DRY_RUN ? '*** DRY RUN ***' : ''];
  var failures = [], copied = 0, pruned = 0;

  var tenants;
  try {
    tenants = loadTenants_(log);
    if (!tenants || !tenants.length) throw new Error('registry returned no tenants');
  } catch (e) {
    backupAlert_('Dome Box backup FAILED to start', 'Could not read the tenant registry.\n\n' +
      e.message + '\n\nNo tenant was backed up tonight.');
    log.push('FATAL: ' + e.message);
    Logger.log(log.join('\n'));
    return;
  }

  var folder = backupFolder_();
  var today = new Date();

  for (var i = 0; i < tenants.length && copied < BACKUP.MAX_PER_RUN; i++) {
    var t = tenants[i];
    var name = backupName(t.company, t.sheetId, today);
    try {
      // Skip if tonight's copy already exists — makes the job safe to re-run.
      if (folder.getFilesByName(name).hasNext()) { log.push('  = ' + name + ' (already there)'); continue; }
      if (BACKUP.DRY_RUN) { log.push('  → would copy ' + name); copied++; continue; }
      DriveApp.getFileById(t.sheetId).makeCopy(name, folder);
      copied++;
      log.push('  ✓ ' + name);
    } catch (e) {
      failures.push({ company: t.company, sheetId: t.sheetId, error: e.message });
      log.push('  ✗ ' + (t.company || t.sheetId) + ': ' + e.message);
    }
  }

  // Prune per tenant, so one busy tenant cannot age out another's history.
  try {
    var byTenant = {};
    var files = folder.getFiles();
    while (files.hasNext()) {
      var f = files.next(), p = parseBackupName(f.getName());
      if (!p) continue;
      (byTenant[p.sheetKey] = byTenant[p.sheetKey] || []).push(f);
    }
    Object.keys(byTenant).forEach(function (key) {
      var list = byTenant[key];
      var drop = backupsToPrune(list.map(function (f) { return f.getName(); }), BACKUP, today);
      var dropSet = {}; drop.forEach(function (n) { dropSet[n] = true; });
      list.forEach(function (f) {
        if (!dropSet[f.getName()]) return;
        if (BACKUP.DRY_RUN) { log.push('  → would prune ' + f.getName()); pruned++; return; }
        f.setTrashed(true); pruned++;
      });
    });
  } catch (e) {
    log.push('  ! prune failed: ' + e.message);   // never fatal: copies matter more than tidiness
  }

  var mins = Math.round((new Date() - started) / 600) / 100;
  log.push('');
  log.push('Copied: ' + copied + '   Pruned: ' + pruned + '   Failed: ' + failures.length +
    '   (' + mins + ' min)');
  if (copied < tenants.length && copied >= BACKUP.MAX_PER_RUN) {
    log.push('! Hit MAX_PER_RUN. Remaining tenants are NOT backed up — split the run or raise the cap.');
  }

  if (failures.length || copied < tenants.length) {
    backupAlert_('Dome Box backup: ' + failures.length + ' failed, ' + copied + '/' + tenants.length + ' copied',
      log.join('\n'));
  }
  backupLog_(started, copied, tenants.length, failures.length, mins);
  Logger.log(log.join('\n'));
}

/**
 * Proves last night actually worked, rather than trusting that it did. Opens
 * the newest copy for each tenant and compares tab names and row counts against
 * the live file — a zero-row copy is the failure mode that matters, because it
 * looks exactly like a success in a file listing.
 */
function verifyLatestBackup() {
  var log = ['', '=== VERIFY BACKUPS ==='];
  var tenants = loadTenants_(log) || [];
  var folder = backupFolder_();

  var latest = {};
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next(), p = parseBackupName(f.getName());
    if (!p) continue;
    var k = p.sheetKey;
    if (!latest[k] || latest[k].date < p.date) latest[k] = { file: f, date: p.date };
  }

  var bad = [];
  tenants.forEach(function (t) {
    var key = String(t.sheetId).slice(0, 12);
    var entry = latest[key];
    var label = t.company || t.sheetId;
    if (!entry) { bad.push(label + ': NO BACKUP AT ALL'); log.push('  ✗ ' + label + ': none'); return; }

    var ageDays = dayDiff(new Date(), parseYmd(entry.date));
    try {
      var live = SpreadsheetApp.openById(t.sheetId);
      var copy = SpreadsheetApp.openById(entry.file.getId());
      var liveTabs = live.getSheets().map(function (s) { return s.getName(); }).sort();
      var copyTabs = copy.getSheets().map(function (s) { return s.getName(); }).sort();
      var liveRows = live.getSheets().reduce(function (n, s) { return n + s.getLastRow(); }, 0);
      var copyRows = copy.getSheets().reduce(function (n, s) { return n + s.getLastRow(); }, 0);

      var problems = [];
      if (ageDays > 1) problems.push(ageDays + ' days stale');
      if (copyTabs.join('|') !== liveTabs.join('|')) problems.push('tabs differ');
      if (copyRows === 0) problems.push('COPY IS EMPTY');
      // Live grows after the copy was taken; shrinking badly is the alarming direction.
      else if (copyRows < liveRows * 0.5) problems.push('copy has ' + copyRows + ' rows vs live ' + liveRows);

      if (problems.length) { bad.push(label + ': ' + problems.join('; ')); log.push('  ✗ ' + label + ' — ' + problems.join('; ')); }
      else log.push('  ✓ ' + label + ' — ' + entry.date + ', ' + copyTabs.length + ' tabs, ' + copyRows + ' rows');
    } catch (e) {
      bad.push(label + ': cannot open backup (' + e.message + ')');
      log.push('  ✗ ' + label + ': ' + e.message);
    }
  });

  log.push('');
  log.push(bad.length ? bad.length + ' PROBLEM(S) — see above' : 'All ' + tenants.length + ' tenants have a good, current backup.');
  if (bad.length) backupAlert_('Dome Box backup verification found ' + bad.length + ' problem(s)', log.join('\n'));
  Logger.log(log.join('\n'));
}

/**
 * Restore. Copies a backup to a NEW file and returns its id; it never writes
 * over the live sheet. Repointing the registry is your decision, because the
 * live file probably holds work created after this backup was taken, and that
 * work would be destroyed by an in-place restore.
 */
function restoreTenantToNewFile(sheetIdOrCompany, dateYmd) {
  var folder = backupFolder_(), best = null;
  var files = folder.getFiles();
  var needle = String(sheetIdOrCompany || '').toLowerCase();

  while (files.hasNext()) {
    var f = files.next(), p = parseBackupName(f.getName());
    if (!p) continue;
    var matches = p.sheetKey.toLowerCase() === needle.slice(0, 12) ||
                  p.company.toLowerCase().indexOf(needle) > -1;
    if (!matches) continue;
    if (dateYmd && p.date !== dateYmd) continue;
    if (!best || best.date < p.date) best = { file: f, date: p.date, company: p.company };
  }

  if (!best) {
    Logger.log('No backup found for "' + sheetIdOrCompany + '"' + (dateYmd ? ' on ' + dateYmd : '') +
      '.\nRun listBackups() to see what exists.');
    return null;
  }
  var restored = best.file.makeCopy('RESTORED ' + best.date + ' ' + best.company, folder);
  Logger.log([
    'Restored to a NEW file. Nothing live was touched.',
    '  name : ' + restored.getName(),
    '  id   : ' + restored.getId(),
    '  url  : ' + restored.getUrl(),
    '',
    'Next, by hand:',
    '  1. Open it and confirm the data is what you expect.',
    '  2. Copy anything the live sheet gained after ' + best.date + ' into it, or the other way.',
    '  3. Only then point the registry row at this id.',
  ].join('\n'));
  return restored.getId();
}

function listBackups(filter) {
  var folder = backupFolder_(), rows = [];
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next(), p = parseBackupName(f.getName());
    if (!p) continue;
    if (filter && f.getName().toLowerCase().indexOf(String(filter).toLowerCase()) < 0) continue;
    rows.push(p.date + '  ' + p.company + '  ' + Math.round(f.getSize() / 1024) + ' KB');
  }
  rows.sort().reverse();
  Logger.log(rows.length ? rows.join('\n') : 'No backups found.');
  return rows;
}

function backupLog_(started, copied, total, failed, mins) {
  try {
    if (!REG.SHEET_ID) return;
    var ss = SpreadsheetApp.openById(REG.SHEET_ID);
    var sh = ss.getSheetByName('BackupLog');
    if (!sh) { sh = ss.insertSheet('BackupLog'); sh.appendRow(['when','copied','tenants','failed','minutes']); sh.setFrozenRows(1); }
    sh.appendRow([started, copied, total, failed, mins]);
  } catch (e) { /* logging must never be the thing that breaks the backup */ }
}

function backupAlert_(subject, body) {
  try {
    MailApp.sendEmail({ to: BACKUP.ALERT_TO, subject: subject, body: body, name: 'Dome Box' });
  } catch (e) { Logger.log('Could not send backup alert: ' + e.message); }
}
