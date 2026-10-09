// ===========================================================================
// TENANT DATA ACCESS
// ===========================================================================

function ensureTenantTabs_(ss) {
  mkTab_(ss, TAB.USERS, USER_COLS);
  mkTab_(ss, TAB.TASKS, TASK_COLS);
  mkTab_(ss, TAB.KRA, ['Job Profile','KRA Title','Description','Weight','Grid/KPI']);
  mkTab_(ss, TAB.REVIEWS, ['Month','Employee','Performance Score','Delegation Score','Final Score','Date']);
  mkTab_(ss, TAB.LEAVE, ['Username','From','To','Reason','Approved']);
  mkTab_(ss, TAB.COOKIES, COOKIE_COLS);
  mkTab_(ss, TAB.DIRECTION, DIRECTION_COLS);
  mkTab_(ss, TAB.GOALS, GOAL_COLS);
  mkTab_(ss, TAB.NUMBERS, NUMBER_COLS);
  mkTab_(ss, TAB.NUMBER_LOG, NUMBER_LOG_COLS);
  mkTab_(ss, TAB.MEETINGS, MEETING_COLS);
  mkTab_(ss, TAB.MEETING_ITEMS, MEETING_ITEM_COLS);
  var set = ss.getSheetByName(TAB.SETTINGS);
  if (!set) {
    set = ss.insertSheet(TAB.SETTINGS);
    set.getRange(1, 1, DEFAULT_CATEGORIES.length, 1)
       .setValues(DEFAULT_CATEGORIES.map(function (c) { return [c]; }));
  }
  /* A tenant created before a column existed is widened in place rather than
     rebuilt, so adding a feature never costs anyone their data. */
  widen_(ss.getSheetByName(TAB.TASKS), TASK_COLS);
  widen_(ss.getSheetByName(TAB.USERS), USER_COLS);
  widen_(ss.getSheetByName(TAB.COOKIES), COOKIE_COLS);
  return ss;
}

/* ---------------------------------------------------------------------------
   UPGRADING AN EXISTING CUSTOMER'S SHEET

   ensureTenantTabs_ used to run only when a company signed up, so a customer
   who joined before a column existed never got it. The docs said existing
   sheets "widen in place"; nothing actually widened them.

   The schema is positional — column 16 IS "Spawned By" because it is the
   16th — so widening is only safe if the columns that are already there are
   the ones we think they are. A customer who once added their own "Notes"
   column after column 15 would have it treated as Spawned By, and the first
   task update would write over their notes. So the header row is compared
   first, and a sheet that does not match is left exactly as it is and
   reported, never adjusted. A workspace that will not open until support
   looks at it is a bad day; one that silently overwrites a customer's column
   is a lost customer.

   It runs at most once per sheet per schema version, remembered in Script
   Properties, so the cost on a normal request is one property read.
--------------------------------------------------------------------------- */
/* Bumped whenever TASK_COLS, USER_COLS or the tab list grows, so a sheet
   upgraded under the previous version is checked and widened again. */
var SCHEMA_VERSION = '2026-10b';

/** A1-style column letter: 1 -> A, 27 -> AA. Used in what the operator reads. */
function colLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * Compares row 1 with what the code expects, without changing anything.
 *
 * Within the columns this code uses (1 .. cols.length), each heading must be
 * the expected one, or blank — and a blank one only if the whole column under
 * it is empty, because a blank heading over somebody's data is still
 * somebody's data. Past the last column this code uses, anything goes: those
 * are the customer's own, and nothing here ever writes there.
 */
function schemaCheck_(sheet, cols) {
  if (!sheet) return { ok: true, missing: true, add: cols.length };
  var last = sheet.getLastColumn(), rows = sheet.getLastRow();
  if (last === 0) return { ok: true, add: cols.length };
  var head = sheet.getRange(1, 1, 1, last).getValues()[0].map(function (h) { return String(h).trim(); });
  var add = 0;
  for (var i = 0; i < cols.length; i++) {
    var h = head[i] || '';
    if (h === cols[i]) continue;
    if (h) return { ok: false, at: colLetter_(i + 1), found: h, expected: cols[i] };
    if (i < last && rows > 1) {
      var below = sheet.getRange(2, i + 1, rows - 1, 1).getValues();
      for (var r = 0; r < below.length; r++) {
        if (String(below[r][0]).trim()) return { ok: false, at: colLetter_(i + 1), found: '(no heading, but has data)', expected: cols[i] };
      }
    }
    add++;
  }
  return { ok: true, add: add, extra: Math.max(0, last - cols.length) };
}

/**
 * Brings one tenant up to the current schema, or explains why it will not.
 * @return {{ok:boolean, changed:boolean, problems:string[], added:string[]}}
 */
function upgradeTenantSchema_(ss, dryRun) {
  var problems = [], added = [];
  var checks = [[TAB.TASKS, TASK_COLS], [TAB.USERS, USER_COLS], [TAB.COOKIES, COOKIE_COLS]];
  checks.forEach(function (c) {
    var r = schemaCheck_(ss.getSheetByName(c[0]), c[1]);
    if (!r.ok) problems.push(c[0] + ' column ' + r.at + ' is "' + r.found + '" where Dome Box needs "' + r.expected + '"');
    else if (r.add) added.push(c[0] + ' +' + r.add + ' column' + (r.add === 1 ? '' : 's'));
  });
  ['Users','Tasks','KRA_Master','Reviews','Leave','Cookie_Points','Settings',
   TAB.DIRECTION, TAB.GOALS, TAB.NUMBERS, TAB.NUMBER_LOG, TAB.MEETINGS, TAB.MEETING_ITEMS].forEach(function (n) {
    if (!ss.getSheetByName(n)) added.push('new ' + n + ' tab');
  });
  if (problems.length) return { ok: false, changed: false, problems: problems, added: [] };
  if (dryRun || !added.length) return { ok: true, changed: false, problems: [], added: added };
  ensureTenantTabs_(ss);
  return { ok: true, changed: true, problems: [], added: added };
}

/** Lazy, once-per-sheet upgrade on the request path. Never throws on success. */
function ensureTenantSchema_(ss, sheetId) {
  var p = PropertiesService.getScriptProperties(), key = 'SCHEMA_' + sheetId;
  if (p.getProperty(key) === SCHEMA_VERSION) return;
  var r = withLock_(function () {
    if (p.getProperty(key) === SCHEMA_VERSION) return { ok: true };
    var res = upgradeTenantSchema_(ss, false);
    if (res.ok) p.setProperty(key, SCHEMA_VERSION);
    return res;
  });
  if (!r.ok) {
    logError_('schema:' + sheetId, r.problems.join('; '));
    try { sendOpsMail_(CFG().mailFrom, 'A workspace needs a column check before it can open',
      'Sheet ' + sheetId + ' was not upgraded, so that nothing in it is overwritten:\n\n  ' +
      r.problems.join('\n  ') + '\n\nRun previewMigration() for the full picture.'); } catch (e) {}
    throw new Error('Your workspace needs a quick check by our team before it can open. ' +
                    'Nothing has been changed or lost — we have been told and will be in touch.');
  }
}

/* Writes each MISSING heading into its own column. It used to append from the
   last used column, which was right only while nothing existed past the old
   schema: a customer's own column at, say, AD would have had our headings
   written after it, at the wrong positions. Only call this after schemaCheck_
   has passed. */
function widen_(sheet, cols) {
  if (!sheet) return;
  var last = sheet.getLastColumn();
  var head = last ? sheet.getRange(1, 1, 1, Math.min(last, cols.length)).getValues()[0] : [];
  for (var i = 0; i < cols.length; i++) {
    if (String(head[i] == null ? '' : head[i]).trim() === '') sheet.getRange(1, i + 1).setValue(cols[i]);
  }
}

function blankUserRow_() { return USER_COLS.map(function () { return ''; }); }
function blankTaskRow_() { return TASK_COLS.map(function () { return ''; }); }

/* ---------- users -------------------------------------------------------- */

/* ---------------------------------------------------------------------------
   PER-REQUEST CACHE

   A handler reads the same sheet many times over: readUsers_ alone is called
   from a dozen places, and getDataRange() is a round trip to Sheets every time.
   Apps Script gives each request its own execution, so caching for the life of
   a request is both safe and the natural scope.

   The rule is invalidation, not cleverness: ANY write drops the whole cache
   (dropCache_). Reads are cheap and correctness is not, so there is no attempt
   to work out which key a given write affected — a stale user list read back
   after an edit is the kind of bug that takes a week to find.
   ------------------------------------------------------------------------- */
function cached_(ctx, key, fn) {
  if (!ctx._cache) ctx._cache = {};
  if (!(key in ctx._cache)) ctx._cache[key] = fn();
  return ctx._cache[key];
}

/* Called with no argument from the low-level writers, which do not carry a ctx:
   there is only ever one request in flight, so CURRENT_CTX is unambiguous. */
function dropCache_(ctx) {
  var c = ctx || CURRENT_CTX;
  if (c) { c._cache = {}; c._scoreOpts = null; }
}

function readUsers_(ctx) {
  return cached_(ctx, 'users', function () {
    var sh = ctx.ss.getSheetByName(TAB.USERS);
    var d = sh.getDataRange().getValues();
    var out = [];
    for (var i = 1; i < d.length; i++) {
      if (!d[i][U['Username']] && !d[i][U['Email']]) continue;
      out.push(rowToUser_(d[i], i + 1));
    }
    return out;
  });
}

function rowToUser_(r, rowIndex) {
  return {
    name: r[U['Name']], username: String(r[U['Username']] || '').trim(),
    email: String(r[U['Email']] || '').trim(), role: r[U['Role']] || 'Doer',
    jobProfile: r[U['Job Profile']] || '', dept: r[U['Dept']] || '',
    phone: r[U['Phone']] || '', manager: String(r[U['Manager']] || '').trim(),
    /* Active unless something explicitly says otherwise. The old schema had
       nine user columns and no Active column at all, so on every existing
       customer's sheet this cell does not exist — it reads as undefined, not
       as ''. Testing for '' or true read every one of those people as
       deactivated, which would have locked out every existing user at every
       existing company on the day of the switch. */
    active: !/^(false|no|inactive|0)$/i.test(String(r[U['Active']] == null ? '' : r[U['Active']]).trim()),
    wipLimit: (r[U['WIP Limit']] == null || r[U['WIP Limit']] === '') ? null : Number(r[U['WIP Limit']]),
    kras: safeJson_(r[U['KRAs JSON']], []),
    waOptIn: r[U['WhatsApp OptIn']] === true || String(r[U['WhatsApp OptIn']]).toLowerCase() === 'true',
    rowIndex: rowIndex,
  };
}

function findUser_(ss, username) {
  var d = ss.getSheetByName(TAB.USERS).getDataRange().getValues();
  var key = String(username || '').trim().toLowerCase();
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][U['Username']] || '').trim().toLowerCase() === key) return rowToUser_(d[i], i + 1);
  }
  return null;
}

function findUserByEmailOrName_(ss, key) {
  var d = ss.getSheetByName(TAB.USERS).getDataRange().getValues();
  key = String(key || '').trim().toLowerCase();
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][U['Email']] || '').trim().toLowerCase() === key ||
        String(d[i][U['Username']] || '').trim().toLowerCase() === key) return rowToUser_(d[i], i + 1);
  }
  return null;
}

function getUserField_(ss, rowIndex, col) {
  return ss.getSheetByName(TAB.USERS).getRange(rowIndex, U[col] + 1).getValue();
}
function setUserField_(ss, rowIndex, col, value) {
  ss.getSheetByName(TAB.USERS).getRange(rowIndex, U[col] + 1).setValue(value);
  dropCache_();
}

/* ---------- tasks -------------------------------------------------------- */

function readTasks_(ctx) {
  return cached_(ctx, 'tasks', function () {
    var d = ctx.ss.getSheetByName(TAB.TASKS).getDataRange().getValues();
    var names = {};
    readUsers_(ctx).forEach(function (u) { names[u.username] = u.name; });
    var out = [];
    for (var i = 1; i < d.length; i++) {
      if (!d[i][T['ID']]) continue;
      out.push(rowToTask_(d[i], i + 1, names));
    }
    return out;
});
}

function rowToTask_(r, rowIndex, names) {
  names = names || {};
  var history = safeJson_(r[T['History JSON']], []);
  var status = r[T['Status']] || 'Pending';
  return {
    id: String(r[T['ID']]),
    createdDate: toIso_(r[T['Date Created']]),
    due: toYmd_(r[T['Due Date']]),
    title: r[T['Title']] || '', desc: r[T['Description']] || '',
    by: String(r[T['Assigned By']] || '').trim(),
    to: String(r[T['Assigned To']] || '').trim(),
    assignee: String(r[T['Assigned To']] || '').trim(),   // engine field name
    raisedBy: String(r[T['Assigned By']] || '').trim(),
    approver: String(r[T['Approver Manager']] || r[T['Assigned By']] || '').trim(),
    approverManager: String(r[T['Approver Manager']] || '').trim(),
    status: status, kra: r[T['KRA Tag']] || '', priority: r[T['Priority']] || 'Medium',
    frequency: r[T['Frequency']] || 'One Time',
    cadence: r[T['Frequency']] || 'One Time',
    reworkCount: Number(r[T['Reworks']] || 0),
    history: history,
    jobCategory: r[T['Job Category']] || 'General',
    spawnedBy: String(r[T['Spawned By']] || ''),
    blockedBy: safeJson_(r[T['Blocked By']], []),
    subtasks: safeJson_(r[T['Subtasks JSON']], []),
    delegateTo: String(r[T['Delegate To']] || '').trim(),
    projectId: String(r[T['Project ID']] || '').trim(),
    projectName: String(r[T['Project']] || '').trim(),
    stageNo: Number(r[T['Stage No']] || 0),
    stageCount: Number(r[T['Stage Count']] || 0),
    stageGate: String(r[T['Stage Gate']] || '').trim() || 'sequential',
    repeatUntil: toYmd_(r[T['Repeat Until']]),
    repeatCount: Number(r[T['Repeat Count']] || 0),
    repeatMade: Number(r[T['Repeat Made']] || 0),
    goal: String(r[T['Goal']] || '').trim(),
    raisedIn: String(r[T['Raised In']] || '').trim(),
    isArchived: isArchived_(status, r[T['Date Created']], history),
    toName: names[String(r[T['Assigned To']] || '').trim()] || r[T['Assigned To']] || '',
    byName: names[String(r[T['Assigned By']] || '').trim()] || r[T['Assigned By']] || '',
    rowIndex: rowIndex,
  };
}

/** Closed work drops out of the active board after a week, as it did before. */
function isArchived_(status, created, history) {
  if (['Verified','Completed','Rejected','Cancelled'].indexOf(status) < 0) return false;
  var last = new Date(created);
  if (history && history.length) {
    var d = new Date(history[history.length - 1].date);
    if (!isNaN(d)) last = d;
  }
  if (isNaN(last)) return false;
  return Math.ceil(Math.abs(new Date() - last) / 86400000) > 7;
}

/**
 * What this person is allowed to see.
 *
 * Kept here, in one place, because it was written inline in getDashboard and
 * the getTasks route did not have it — so any signed-in Doer could ask for the
 * raw list and read every task in the company, including work they were never
 * part of. One rule, called by everything that hands tasks to a browser.
 */
function visibleTasks_(ctx, tasks) {
  var me = ctx.actor;
  if (me.role === ROLE.ADMIN) return tasks;
  return tasks.filter(function (t) {
    return t.assignee === me.username || t.by === me.username ||
           t.approver === me.username || t.delegateTo === me.username;
  });
}

function findTaskRow_(ctx, taskId) {
  var sh = ctx.ss.getSheetByName(TAB.TASKS);
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][T['ID']]) === String(taskId)) {
      var names = {};
      readUsers_(ctx).forEach(function (u) { names[u.username] = u.name; });
      return { sheet: sh, rowIndex: i + 1, raw: d[i], task: rowToTask_(d[i], i + 1, names) };
    }
  }
  return null;
}

function writeTaskField_(hit, col, value) {
  hit.sheet.getRange(hit.rowIndex, T[col] + 1).setValue(value);
  dropCache_();
}

function appendHistory_(hit, status, actorName, note, extra) {
  var h = safeJson_(hit.raw[T['History JSON']], []);
  var entry = { date: new Date().toISOString(), status: status, user: actorName, note: note || '' };
  if (extra) for (var k in extra) entry[k] = extra[k];
  h.push(entry);
  writeTaskField_(hit, 'History JSON', JSON.stringify(h));
  return h;
}

/* ---------- misc tabs ---------------------------------------------------- */

function readCategories_(ctx) {
  return cached_(ctx, 'cats', function () {
    var sh = ctx.ss.getSheetByName(TAB.SETTINGS);
    if (!sh) return DEFAULT_CATEGORIES.slice();
    var d = sh.getDataRange().getValues();
    var out = d.map(function (r) { return String(r[0] || '').trim(); })
               .filter(function (c) { return c; });
    return out.length ? out : DEFAULT_CATEGORIES.slice();
});
}

function updateCategories_(ctx, categories) {
  requireManager_(ctx); blockIfStopped_(ctx);
  var list = (categories || []).map(function (c) { return String(c).trim(); })
                               .filter(function (c) { return c; });
  var sh = ctx.ss.getSheetByName(TAB.SETTINGS) || ctx.ss.insertSheet(TAB.SETTINGS);
  /* Column A only. This used to clear the whole sheet, which would now take the
     priority levels in B and C with it. */
  clearColumn_(sh, 1);
  if (list.length) sh.getRange(1, 1, list.length, 1).setValues(list.map(function (c) { return [c]; }));
  dropCache_(ctx);
  return { status: 'success', categories: list };
}

function clearColumn_(sh, col) {
  var rows = sh.getLastRow();
  if (rows > 0) sh.getRange(1, col, rows, 1).clearContent();
}

/* ---------- named settings ------------------------------------------------
   Settings column D holds a key and E its value, beside the job categories in
   A and the priority levels in B/C. One more pair of columns rather than a new
   tab, for the same reason as the priorities: an existing tenant sheet gains
   them without a single cell moving. */
function readSettings_(ctx) {
  return cached_(ctx, 'settings', function () {
    var sh = ctx.ss.getSheetByName(TAB.SETTINGS);
    if (!sh || sh.getLastRow() === 0) return {};
    var d = sh.getRange(1, 4, sh.getLastRow(), 2).getValues(), out = {};
    for (var i = 0; i < d.length; i++) {
      var k = String(d[i][0] || '').trim();
      if (k) out[k] = String(d[i][1] == null ? '' : d[i][1]).trim();
    }
    return out;
  });
}

function readSetting_(ctx, key, fallback) {
  var v = readSettings_(ctx)[key];
  return (v === undefined || v === '') ? fallback : v;
}

function writeSetting_(ctx, key, value) {
  return withLock_(function () {
    var sh = ctx.ss.getSheetByName(TAB.SETTINGS) || ctx.ss.insertSheet(TAB.SETTINGS);
    var rows = sh.getLastRow();
    var d = rows ? sh.getRange(1, 4, rows, 1).getValues() : [];
    for (var i = 0; i < d.length; i++) {
      if (String(d[i][0] || '').trim() === key) {
        sh.getRange(i + 1, 5).setValue(value);
        dropCache_(ctx);
        return value;
      }
    }
    sh.getRange(rows + 1, 4, 1, 2).setValues([[key, value]]);
    dropCache_(ctx);
    return value;
  });
}

/* ---------- priority levels ----------------------------------------------
   Settings column B holds the level name and C its weight, beside the job
   categories already in A. Appended rather than given a tab of their own so an
   existing tenant sheet gains them without anything being moved. */
function readPriorities_(ctx) {
  return cached_(ctx, 'prio', function () {
    var sh = ctx.ss.getSheetByName(TAB.SETTINGS);
    if (!sh || sh.getLastRow() === 0) return DEFAULT_PRIORITIES.slice();
    var d = sh.getRange(1, 2, sh.getLastRow(), 2).getValues();
    var out = [];
    for (var i = 0; i < d.length; i++) {
      var name = String(d[i][0] || '').trim();
      if (!name) continue;
      var w = Number(d[i][1]);
      out.push({ name: name, weight: (isNaN(w) || w <= 0) ? 2 : w });
    }
    return out.length ? out : DEFAULT_PRIORITIES.slice();
});
}

function updatePriorities_(ctx, levels) {
  requireManager_(ctx); blockIfStopped_(ctx);
  var seen = {}, list = [];
  (levels || []).forEach(function (l) {
    var name = String((l && l.name) || '').trim();
    if (!name) return;
    if (seen[name.toLowerCase()]) throw new Error('"' + name + '" is listed twice.');
    seen[name.toLowerCase()] = true;
    var w = Math.round(Number(l.weight));
    if (isNaN(w) || w < 1 || w > 10) {
      throw new Error('Give "' + name + '" a weight between 1 and 10. ' +
        'The weight is how much more a task at this level counts in a score than one at weight 1.');
    }
    list.push({ name: name, weight: w });
  });
  if (!list.length) throw new Error('Keep at least one priority level.');

  /* A level still on open work cannot be deleted out from under it: the task
     would be left pointing at a name nothing recognises, and it would quietly
     be scored as Medium from then on. */
  var inUse = {};
  readTasks_(ctx).forEach(function (t) {
    if (isOpen(t.status) && t.priority) inUse[t.priority] = (inUse[t.priority] || 0) + 1; });
  var lost = Object.keys(inUse).filter(function (p) {
    return !list.some(function (l) { return l.name === p; }); });
  if (lost.length) {
    throw new Error('"' + lost[0] + '" is still on ' + inUse[lost[0]] + ' open task(s). ' +
      'Move that work to another level first, or keep this one.');
  }

  var sh = ctx.ss.getSheetByName(TAB.SETTINGS) || ctx.ss.insertSheet(TAB.SETTINGS);
  clearColumn_(sh, 2); clearColumn_(sh, 3);
  sh.getRange(1, 2, list.length, 2)
    .setValues(list.map(function (l) { return [l.name, l.weight]; }));
  dropCache_(ctx);
  return { status: 'success', priorities: list,
    message: list.length + ' priority level(s) saved.' };
}

function readLeave_(ctx) {
  return cached_(ctx, 'leave', function () {
    var sh = ctx.ss.getSheetByName(TAB.LEAVE);
    if (!sh) return [];
    var d = sh.getDataRange().getValues(), out = [];
    for (var i = 1; i < d.length; i++) {
      if (!d[i][0]) continue;
      out.push({ username: String(d[i][0]).trim(), from: toYmd_(d[i][1]), to: toYmd_(d[i][2]),
                 reason: d[i][3] || '', approved: d[i][4] !== false });
    }
    return out;
});
}

function setLeave_(ctx, username, from, to, reason) {
  requireManager_(ctx); blockIfStopped_(ctx);
  if (!username || !from) throw new Error('Pick a person and a start date.');
  var sh = mkTab_(ctx.ss, TAB.LEAVE, ['Username','From','To','Reason','Approved']);
  sh.appendRow([String(username).trim(), from, to || from, reason || '', true]);
  dropCache_(ctx);
  return { status: 'success', message: 'Leave recorded. It will not count against their score.' };
}

/** The calendar the scoring engine uses so leave is not charged as lateness. */
function leaveCalendar_(ctx) {
  var map = {};
  readLeave_(ctx).forEach(function (l) {
    if (!l.approved) return;
    (map[l.username] = map[l.username] || []).push({ from: l.from, to: l.to });
  });
  return { weekend: [0, 6], holidays: [], leave: map };
}

/* ---------- small helpers ------------------------------------------------ */

function safeJson_(v, fallback) {
  if (v == null || v === '') return fallback;
  if (typeof v === 'object') return v;
  try { var p = JSON.parse(v); return p == null ? fallback : p; } catch (e) { return fallback; }
}
function toYmd_(v) {
  if (!v) return '';
  if (v instanceof Date) return ymd(v);
  var s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  var d = new Date(s);
  return isNaN(d) ? '' : ymd(d);
}
function toIso_(v) {
  if (!v) return new Date().toISOString();
  var d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? new Date().toISOString() : d.toISOString();
}
function newTaskId_() {
  return 'T' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1000);
}
function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
