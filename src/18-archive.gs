// ===========================================================================
// COLD STORAGE — tasks closed more than a year ago move to Tasks_Archive
// ===========================================================================
//
// Every request reads the whole Tasks tab. A company of fifty assigns tens of
// thousands of tasks a year, and nearly all of them are closed — read on every
// 30-second poll for no reason. Work closed more than ARCHIVE_AFTER_DAYS ago
// moves, row for row, to a Tasks_Archive tab in the same spreadsheet: the
// customer's data never leaves their file, and nothing is ever deleted that
// has not first been written to the archive and read back.
//
// What reads which:
//   - the everyday paths (board, priority, assigning, updating, meetings,
//     the org chart) read Tasks only — that is the point of moving rows.
//   - anything that adds up history (reports for past periods, the
//     leaderboard, appraisals, accountability, goal progress, projects, the
//     Archive search) reads both, through readAllTasks_, so no number anybody
//     has seen changes because a row moved.
//
// What never moves, however old:
//   - anything not closed (Verified, Completed, Rejected, Cancelled).
//   - the newest occurrence of a repeating task — it is the template the next
//     one is copied from; a yearly job closed last year is due again soon.
//   - anything an open task is blocked by.
//   - any stage of a project that still has a stage not ready to move: a
//     project moves whole or not at all, so it never shows up half-empty.
//
// Run order for an operator: previewTaskArchive (changes nothing), then
// archiveOldTasks. installTaskArchiveSchedule runs it on the 1st of each
// month at about 2 am.

var ARCHIVE_AFTER_DAYS = 365;
var ARCHIVE_TIME_BUDGET_MS = 4.5 * 60 * 1000;
var CLOSED_FOR_ARCHIVE = ['Verified', 'Completed', 'Rejected', 'Cancelled'];

function previewTaskArchive() { return runTaskArchive_(true); }
function archiveOldTasks() { return runTaskArchive_(false); }

function installTaskArchiveSchedule() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'archiveOldTasks') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('archiveOldTasks').timeBased().onMonthDay(1).atHour(2).create();
  return say_(['archiveOldTasks will run on the 1st of every month, around 2 am.']);
}

function runTaskArchive_(dryRun) {
  var out = ['', dryRun ? '=== TASK ARCHIVE PREVIEW — nothing is changed ===' : '=== ARCHIVING OLD TASKS ===',
             'Moves work closed more than ' + ARCHIVE_AFTER_DAYS + ' days ago to the Tasks_Archive tab, in the same file.', ''];
  var tenants = allTenants_();
  if (!tenants.length) { out.push('No customers found. Is MASTER_DB_ID set?'); return say_(out); }
  var total = 0, started = Date.now();
  for (var i = 0; i < tenants.length; i++) {
    var t = tenants[i];
    /* Apps Script stops a run at six minutes. Stop between customers, well
       before that, rather than be cut off half way through one. */
    if (Date.now() - started > ARCHIVE_TIME_BUDGET_MS) {
      out.push('  Time limit near — stopped before ' + t.company + ' (' + (tenants.length - i) +
               ' customer(s) left). Run archiveOldTasks again to carry on; finished ones are skipped quickly.');
      break;
    }
    var ss;
    try { ss = SpreadsheetApp.openById(t.sheetId); }
    catch (e) { out.push('  ' + t.company + ': cannot be opened (' + e.message + ') — skipped'); continue; }
    try {
      var r = moveToColdStore_(ss, dryRun, new Date());
      total += r.moved;
      out.push('  ' + t.company + ': ' + r.message);
    } catch (e) {
      out.push('  ' + t.company + ': STOPPED — ' + e.message + ' (nothing was removed from Tasks)');
    }
  }
  out.push('');
  out.push((dryRun ? 'Would move ' : 'Moved ') + total + ' task(s) in all.');
  if (dryRun) out.push('Looks right? Back up the spreadsheets, then run archiveOldTasks.');
  return say_(out);
}

/** When a raw Tasks row was closed: its last history entry, else its creation date. */
function rowClosedAt_(row) {
  var h = safeJson_(row[T['History JSON']], []);
  var d = h.length ? new Date(h[h.length - 1].date) : new Date(row[T['Date Created']]);
  return isNaN(d) ? null : d;
}

/**
 * Which data rows (0-based, header excluded) may move. Pure, so it is tested
 * on its own: every rule in the header comment is enforced here.
 */
function pickForColdStore_(rows, now, afterDays) {
  var cutoff = new Date(now.getTime() - (afterDays || ARCHIVE_AFTER_DAYS) * 86400000);
  var id = function (r) { return String(r[T['ID']] || ''); };
  var closed = function (r) { return CLOSED_FOR_ARCHIVE.indexOf(String(r[T['Status']])) > -1; };

  var hasChild = {}, blocking = {};
  rows.forEach(function (r) {
    var parent = String(r[T['Spawned By']] || '');
    if (parent) hasChild[parent] = true;
    if (!closed(r)) safeJson_(r[T['Blocked By']], []).forEach(function (b) { blocking[String(b)] = true; });
  });

  var ok = rows.map(function (r) {
    if (!id(r) || !closed(r)) return false;
    var at = rowClosedAt_(r);
    if (!at || at >= cutoff) return false;
    var freq = String(r[T['Frequency']] || 'One Time');
    if (freq && freq !== 'One Time' && !hasChild[id(r)]) return false;
    if (blocking[id(r)]) return false;
    return true;
  });

  /* A project moves whole or not at all. */
  var projectOk = {};
  rows.forEach(function (r, i) {
    var p = String(r[T['Project ID']] || '');
    if (!p) return;
    projectOk[p] = (projectOk[p] !== false) && ok[i];
  });
  var picked = [];
  rows.forEach(function (r, i) {
    var p = String(r[T['Project ID']] || '');
    if (ok[i] && (!p || projectOk[p])) picked.push(i);
  });
  return picked;
}

/**
 * Copies the chosen rows to Tasks_Archive, reads them back, and only then
 * removes them from Tasks. Re-runnable: a row already in the archive (a run
 * that stopped between the copy and the removal) is not copied twice, and
 * the readers ignore an archive row whose ID is still in Tasks.
 */
function moveToColdStore_(ss, dryRun, now) {
  var tasks = ss.getSheetByName(TAB.TASKS);
  if (!tasks) return { moved: 0, message: 'no Tasks tab — nothing to do' };
  var check = schemaCheck_(tasks, TASK_COLS);
  if (!check.ok || check.add) {
    throw new Error('the Tasks tab is not on the current layout — run migrateAllTenants first');
  }
  return withLock_(function () {
    var all = tasks.getDataRange().getValues();
    var rows = all.slice(1);
    var picked = pickForColdStore_(rows, now || new Date());
    if (!picked.length) return { moved: 0, message: 'nothing old enough to move (' + rows.length + ' tasks)' };
    if (dryRun) return { moved: picked.length, message: 'would move ' + picked.length + ' of ' + rows.length + ' tasks' };

    var cold = ss.getSheetByName(TAB.TASKS_ARCHIVE);
    if (!cold) {
      cold = ss.insertSheet(TAB.TASKS_ARCHIVE);
      cold.getRange(1, 1, 1, TASK_COLS.length).setValues([TASK_COLS]);
      cold.setFrozenRows(1);
    } else {
      var cc = schemaCheck_(cold, TASK_COLS);
      if (!cc.ok) throw new Error('Tasks_Archive column ' + cc.at + ' is "' + cc.found + '", expected "' + cc.expected + '"');
      widen_(cold, TASK_COLS);
    }

    var already = {};
    if (cold.getLastRow() > 1) {
      cold.getRange(2, 1, cold.getLastRow() - 1, 1).getValues()
        .forEach(function (r) { already[String(r[0])] = true; });
    }
    var width = TASK_COLS.length;
    var copy = picked.filter(function (i) { return !already[String(rows[i][T['ID']])]; }).map(function (i) {
      var r = rows[i].slice(0, width);
      while (r.length < width) r.push('');
      return r;
    });
    if (copy.length) cold.getRange(cold.getLastRow() + 1, 1, copy.length, width).setValues(copy);

    /* Read back before removing anything. */
    var there = {};
    cold.getRange(2, 1, cold.getLastRow() - 1, 1).getValues().forEach(function (r) { there[String(r[0])] = true; });
    var missing = picked.filter(function (i) { return !there[String(rows[i][T['ID']])]; });
    if (missing.length) throw new Error(missing.length + ' row(s) did not reach Tasks_Archive');

    /* Remove from the bottom up, in contiguous runs, so row numbers above the
       run being deleted never shift underneath us. */
    var sheetRows = picked.map(function (i) { return i + 2; }).sort(function (a, b) { return b - a; });
    var k = 0;
    while (k < sheetRows.length) {
      var end = sheetRows[k], start = end;
      while (k + 1 < sheetRows.length && sheetRows[k + 1] === start - 1) { k++; start--; }
      tasks.deleteRows(start, end - start + 1);
      k++;
    }
    return { moved: picked.length, message: 'moved ' + picked.length + ' of ' + rows.length +
             ' tasks; ' + (rows.length - picked.length) + ' stay on the board side' };
  });
}

/** Tasks moved to cold storage, as tasks. Rows whose ID is still live are skipped. */
function readColdTasks_(ctx) {
  return cached_(ctx, 'coldTasks', function () {
    var sh = ctx.ss.getSheetByName(TAB.TASKS_ARCHIVE);
    if (!sh || sh.getLastRow() < 2) return [];
    var live = {};
    readTasks_(ctx).forEach(function (t) { live[t.id] = true; });
    var names = {};
    readUsers_(ctx).forEach(function (u) { names[u.username] = u.name; });
    var d = sh.getDataRange().getValues(), out = [];
    for (var i = 1; i < d.length; i++) {
      var id = String(d[i][T['ID']] || '');
      if (!id || live[id]) continue;
      var t = rowToTask_(d[i], i + 1, names);
      t.isArchived = true;
      t.coldStore = true;
      out.push(t);
    }
    return out;
  });
}

/** Every task, live and cold — for anything that adds up history. */
function readAllTasks_(ctx) {
  return cached_(ctx, 'allTasks', function () { return readTasks_(ctx).concat(readColdTasks_(ctx)); });
}
