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
  widen_(ss.getSheetByName(TAB.MEETING_ITEMS), MEETING_ITEM_COLS);
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
var SCHEMA_VERSION = '2026-11b';

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
    if (!r.ok) problems.push(c[0] + ' column ' + r.at + ' is "' + r.found + '" where Domebox needs "' + r.expected + '"');
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
  if (c) { c._cache = {}; c._scoreOpts = null; c._dirty = true; }
}

/* ---------- speed: a company's change counter and a short read cache --------
   Every request used to read the whole Tasks tab, and every 30-second check
   sent the whole board back even when nothing had changed.

   The change counter: a value per company, in Apps Script's own cache, that
   changes whenever anything in the company is written through the app (a
   write calls dropCache_, and the router renews the counter when the request
   ends, after the writes are flushed). A screen that already has the current
   counter is told "nothing changed" instead of being sent the board again.

   The Tasks cache: the Tasks tab as last read, for 30 seconds, under the
   counter — so a write anywhere in the app makes the next read fresh. An edit
   typed straight into the sheet shows within 30 seconds. Reads only: every
   write still finds its row in the live sheet and checks the task's ID first,
   and the Users tab is never cached, because a person's row is written by its
   position. Nothing leaves Google: CacheService is part of Apps Script.

   Script Property SPEED = off switches both off at once. */
var SPEED_CACHE_SECONDS = 30, SPEED_VERSION_SECONDS = 21600, SPEED_CHUNK = 90000, SPEED_MAX_CHUNKS = 10;

function speedOn_() {
  try { return String(PropertiesService.getScriptProperties().getProperty('SPEED') || '').toLowerCase() !== 'off'; }
  catch (e) { return false; }
}

/** The company's change counter, with the date so a new day is always "changed". */
function companyVersion_(ctx) {
  if (ctx._version) return ctx._version;
  var cache = CacheService.getScriptCache(), key = 'ver:' + ctx.sheetId, v = cache.get(key);
  if (!v) { v = Utilities.getUuid().slice(0, 8); cache.put(key, v, SPEED_VERSION_SECONDS); }
  return (ctx._version = v + ':' + ymd(new Date()));
}

/** Called when anything in a company has been written: every screen and cached read is now stale. */
function bumpVersion_(sheetId) {
  if (!sheetId) return;
  try { CacheService.getScriptCache().put('ver:' + sheetId, Utilities.getUuid().slice(0, 8), SPEED_VERSION_SECONDS); }
  catch (e) {}
}

/** The end of a request that wrote: make the writes visible, then renew the counter. */
function finishWrites_() {
  var c = CURRENT_CTX;
  if (!c || !c._dirty) return;
  c._dirty = false; c._version = null;
  try { SpreadsheetApp.flush(); } catch (e) {}
  bumpVersion_(c.sheetId);
}

/* Dates do not survive JSON, and the code below the cache tests for them. */
function packRows_(rows) {
  return JSON.stringify(rows.map(function (r) {
    return r.map(function (v) { return v instanceof Date ? { d: v.getTime() } : v; });
  }));
}
function unpackRows_(s) {
  return JSON.parse(s).map(function (r) {
    return r.map(function (v) { return v && typeof v === 'object' && typeof v.d === 'number' ? new Date(v.d) : v; });
  });
}

/**
 * Run from the editor: how long one company's Tasks tab takes to read from the
 * sheet, and from the cache, so the gain is measured rather than assumed.
 */
function speedCheck() {
  var out = ['', '=== SPEED CHECK ===', speedOn_() ? 'Speed-ups are ON.' : 'Speed-ups are OFF (Script Property SPEED = off).', ''];
  allTenants_().slice(0, 10).forEach(function (t) {
    try {
      var ctx = { ss: SpreadsheetApp.openById(t.sheetId), sheetId: t.sheetId };
      var a = Date.now(), rows = ctx.ss.getSheetByName(TAB.TASKS).getDataRange().getValues().length, live = Date.now() - a;
      tasksValues_(ctx);                       // fills the cache
      var b = Date.now(); tasksValues_({ ss: ctx.ss, sheetId: t.sheetId }); var cached = Date.now() - b;
      out.push('  ' + t.company + ': ' + rows + ' rows — from the sheet ' + live + ' ms, from the cache ' + cached + ' ms');
    } catch (e) { out.push('  ' + t.company + ': ' + e.message); }
  });
  return say_(out);
}

/** The Tasks tab's values: from the 30-second cache when the company has not changed, else live. */
function tasksValues_(ctx) {
  var live = function () { return ctx.ss.getSheetByName(TAB.TASKS).getDataRange().getValues(); };
  /* After a write in this same request the sheet is the only truth. */
  if (ctx._dirty || !ctx.sheetId || !speedOn_()) return live();
  var cache = CacheService.getScriptCache(), key = 't:' + ctx.sheetId + ':' + companyVersion_(ctx);
  try {
    var n = Number(cache.get(key + ':n') || 0);
    if (n > 0) {
      var parts = [];
      for (var i = 0; i < n; i++) { var p = cache.get(key + ':' + i); if (p === null) { parts = null; break; } parts.push(p); }
      if (parts) {
        var bytes = Utilities.base64Decode(parts.join(''));
        return unpackRows_(Utilities.ungzip(Utilities.newBlob(bytes, 'application/x-gzip')).getDataAsString());
      }
    }
  } catch (e) {}
  var d = live();
  try {
    var packed = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(packRows_(d))).getBytes());
    var chunks = Math.ceil(packed.length / SPEED_CHUNK);
    /* Too big for the cache: read it live, as before. */
    if (chunks <= SPEED_MAX_CHUNKS) {
      for (var j = 0; j < chunks; j++) cache.put(key + ':' + j, packed.slice(j * SPEED_CHUNK, (j + 1) * SPEED_CHUNK), SPEED_CACHE_SECONDS);
      cache.put(key + ':n', String(chunks), SPEED_CACHE_SECONDS);
    }
  } catch (e) {}
  return d;
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
    var d = tasksValues_(ctx);
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
    archivedOn: r[T['Archived On']] ? toIso_(r[T['Archived On']]) : '',
    stage: String(r[T['Stage']] || '').trim(),
    isArchived: !!r[T['Archived On']] || isArchived_(status, r[T['Date Created']], history),
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
  /* Closed more than a year ago and moved to Tasks_Archive: say so, rather
     than "no longer exists", which reads as lost data. */
  var cold = ctx.ss.getSheetByName(TAB.TASKS_ARCHIVE);
  if (cold && cold.getLastRow() > 1 && cold.getRange(2, 1, cold.getLastRow() - 1, 1).getValues()
        .some(function (r) { return String(r[0]) === String(taskId); })) {
    throw new Error('This task was closed over a year ago and is kept in the archive. It can be read, not changed.');
  }
  return null;
}

function writeTaskField_(hit, col, value) {
  /* The row number was read earlier in this request. If rows moved since —
     the monthly archive removes closed rows — writing by number would land on
     a different task. Check the ID is still there, and find it again if not. */
  var id = String(hit.task.id);
  if (String(hit.sheet.getRange(hit.rowIndex, T['ID'] + 1).getValue()) !== id) {
    var ids = hit.sheet.getRange(1, T['ID'] + 1, hit.sheet.getLastRow(), 1).getValues();
    var at = -1;
    for (var i = 1; i < ids.length; i++) if (String(ids[i][0]) === id) { at = i + 1; break; }
    if (at < 0) throw new Error('That task has just moved to the archive. Refresh and try again.');
    hit.rowIndex = at;
  }
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

function updateCategories_(ctx, categories, renames) {
  requireManager_(ctx); blockIfStopped_(ctx);
  var list = [], seen = {};
  (categories || []).forEach(function (c) {
    c = String(c).trim();
    if (c && !seen[c.toLowerCase()]) { seen[c.toLowerCase()] = true; list.push(c); }
  });
  var sh = ctx.ss.getSheetByName(TAB.SETTINGS) || ctx.ss.insertSheet(TAB.SETTINGS);
  /* Column A only. This used to clear the whole sheet, which would now take the
     priority levels in B and C with it. */
  clearColumn_(sh, 1);
  if (list.length) sh.getRange(1, 1, list.length, 1).setValues(list.map(function (c) { return [c]; }));
  /* A rename is a rename: the tasks filed under the old name move with it,
     or the board's category filter would split one kind of work in two. */
  var moved = 0;
  (renames || []).forEach(function (r) {
    var from = String(r && r.from || '').trim(), to = String(r && r.to || '').trim();
    if (from && to && from !== to) moved += renameCategoryOnTasks_(ctx, from, to);
  });
  dropCache_(ctx);
  return { status: 'success', categories: list, tasksMoved: moved };
}

function renameCategoryOnTasks_(ctx, from, to) {
  var sh = ctx.ss.getSheetByName(TAB.TASKS);
  if (!sh || sh.getLastRow() < 2) return 0;
  var col = T['Job Category'] + 1, n = sh.getLastRow() - 1;
  var vals = sh.getRange(2, col, n, 1).getValues(), changed = 0;
  vals.forEach(function (v) { if (String(v[0]).trim() === from) { v[0] = to; changed++; } });
  if (changed) { sh.getRange(2, col, n, 1).setValues(vals); dropCache_(ctx); }
  return changed;
}

/** A manager who types a new category while assigning adds it to the list. */
function learnCategory_(ctx, name) {
  name = String(name || '').trim();
  if (!name || (ctx.actor.role !== 'Admin' && ctx.actor.role !== 'HOD')) return;
  var cats = readCategories_(ctx);
  if (cats.some(function (c) { return c.toLowerCase() === name.toLowerCase(); })) return;
  var sh = ctx.ss.getSheetByName(TAB.SETTINGS) || ctx.ss.insertSheet(TAB.SETTINGS);
  var colA = sh.getLastRow() ? sh.getRange(1, 1, sh.getLastRow(), 1).getValues() : [];
  var at = colA.length;
  while (at > 0 && !String(colA[at - 1][0] || '').trim()) at--;
  /* An empty column A reads as the default list; keep those when adding one. */
  if (at === 0) { cats.forEach(function (c, i) { sh.getRange(i + 1, 1).setValue(c); }); at = cats.length; }
  sh.getRange(at + 1, 1).setValue(name);
  dropCache_(ctx);
}

/* ---------- the tab bar, as the company's Admin arranges it ---------------- */
var TAB_KEYS = ['tasks','priority','projects','meetings','goals','board','reports','team'];
var TAB_ALWAYS = ['tasks','team'];   // the board, and the way to manage people and settings

function readTabLayout_(ctx) {
  var raw = safeJson_(readSetting_(ctx, 'tabLayout', ''), {});
  return cleanTabLayout_(raw);
}

function cleanTabLayout_(raw) {
  var order = [], seen = {};
  (raw && raw.order || []).forEach(function (k) { if (TAB_KEYS.indexOf(k) > -1 && !seen[k]) { seen[k] = true; order.push(k); } });
  TAB_KEYS.forEach(function (k) { if (!seen[k]) order.push(k); });
  var hidden = (raw && raw.hidden || []).filter(function (k, i, a) {
    return TAB_KEYS.indexOf(k) > -1 && TAB_ALWAYS.indexOf(k) < 0 && a.indexOf(k) === i; });
  return { order: order, hidden: hidden };
}

/* ---------------------------------------------------------------------------
   TASK STAGES — designed by the Admin for the whole company

   To do, For review and Verified are always there (approval and the score
   depend on them) but can be renamed. Between To do and For review sit the
   company's own working stages, in order: "In progress" by default; any can
   be renamed, added (up to six) or removed. With none, To do goes straight
   to For review. Underneath, a task at a working stage is still In Progress,
   so every rule and every score that reads statuses reads it the same way.
--------------------------------------------------------------------------- */
var STAGE_DEFAULTS = { names: { approval: 'Needs approval', todo: 'To do', review: 'For review', done: 'Verified' },
                       work: ['In progress'] };
var STAGE_MAX_WORK = 6, STAGE_MAX_LEN = 30;

function cleanStages_(raw, strict) {
  raw = raw || {};
  var out = { names: {}, work: [] }, seen = {};
  var take = function (v, fallback, what) {
    var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    if (!s) { if (strict) throw new Error('Give the ' + what + ' stage a name.'); s = fallback; }
    if (s.length > STAGE_MAX_LEN) { if (strict) throw new Error('Keep stage names under ' + STAGE_MAX_LEN + ' characters: "' + s + '".'); s = s.slice(0, STAGE_MAX_LEN); }
    var k = s.toLowerCase();
    if (seen[k]) { if (strict) throw new Error('Two stages are both called "' + s + '". Give each its own name.'); return null; }
    seen[k] = true;
    return s;
  };
  ['approval', 'todo', 'review', 'done'].forEach(function (k) {
    out.names[k] = take((raw.names || {})[k], STAGE_DEFAULTS.names[k], STAGE_DEFAULTS.names[k]) || STAGE_DEFAULTS.names[k];
  });
  var work = Array.isArray(raw.work) ? raw.work : STAGE_DEFAULTS.work;
  if (strict && work.length > STAGE_MAX_WORK) throw new Error('Up to ' + STAGE_MAX_WORK + ' working stages.');
  work.slice(0, STAGE_MAX_WORK).forEach(function (w) { var s = take(w, '', 'working'); if (s) out.work.push(s); });
  return out;
}
function readStages_(ctx) {
  return cached_(ctx, 'stages', function () {
    var raw = readSetting_(ctx, 'taskStages', '');
    return raw ? cleanStages_(safeJson_(raw, {}), false) : cleanStages_(STAGE_DEFAULTS, false);
  });
}
function saveStages_(ctx, stages) {
  requireAdmin_(ctx); blockIfStopped_(ctx);
  var clean = cleanStages_(stages || {}, true);
  writeSetting_(ctx, 'taskStages', JSON.stringify(clean));
  dropCache_(ctx);
  return { status: 'success', stages: clean, message: 'Task stages saved for everybody in the company.' };
}

/* ---------- the company's working days, holidays and reminder times ------ */
/* Domebox only. Lite keeps Monday to Friday and the 9, 3 and 5 reminders, so
   in Lite these always read as the defaults and cannot be saved. */
function readCalendar_(ctx) {
  return cached_(ctx, 'calendar', function () {
    if (isLite_()) return cleanCalendar({}, false);
    return cleanCalendar(safeJson_(readSetting_(ctx, 'workCalendar', ''), {}), false);
  });
}
/** What the browser needs: today's off days and the holiday list. */
function calendarView_(cal) {
  return { off: offDaysOn(cal.weekly, new Date()), holidays: cal.holidays };
}
/* The off days count from today. Earlier weeks keep the pattern they were
   worked and scored under, so last month's scores never move because the
   company changed its week this month. */
function saveCalendar_(ctx, form) {
  if (isLite_()) throw new Error('Working days and holidays are part of Domebox, not Domebox Lite.');
  requireAdmin_(ctx); blockIfStopped_(ctx);
  form = form || {};
  var cur = readCalendar_(ctx), today = ymd(new Date());
  var off = cleanCalendar({ weekly: [{ from: today, off: form.off }] }, true).weekly[0].off;
  var weekly = cur.weekly.slice();
  if (offDaysOn(weekly, new Date()).join() !== off.join()) {
    if (weekly[weekly.length - 1].from === today) weekly.pop();
    weekly.push({ from: today, off: off });
  }
  var clean = cleanCalendar({ weekly: weekly, holidays: form.holidays }, true);
  writeSetting_(ctx, 'workCalendar', JSON.stringify(clean));
  dropCache_(ctx);
  return { status: 'success', calendar: calendarView_(clean),
           message: 'Working days and holidays saved. Reminders and scores follow them from today.' };
}

function readReminders_(ctx) {
  return cached_(ctx, 'reminders', function () {
    if (isLite_()) return cleanReminders({}, false);
    return cleanReminders(safeJson_(readSetting_(ctx, 'reminders', ''), {}), false);
  });
}
function saveReminders_(ctx, form) {
  if (isLite_()) throw new Error('Choosing reminder times is part of Domebox, not Domebox Lite.');
  requireAdmin_(ctx); blockIfStopped_(ctx);
  var clean = cleanReminders(form || {}, true);
  writeSetting_(ctx, 'reminders', JSON.stringify(clean));
  dropCache_(ctx);
  return { status: 'success', reminders: clean,
           message: clean.hours.length ? 'Reminders will go at ' + hoursText(clean.hours) + '.'
                                       : 'Saved. No timed reminders will go out.' };
}

function saveTabLayout_(ctx, layout) {
  requireAdmin_(ctx); blockIfStopped_(ctx);
  var clean = cleanTabLayout_(layout || {});
  writeSetting_(ctx, 'tabLayout', JSON.stringify(clean));
  return { status: 'success', layout: clean, message: 'Tabs saved for everybody in the company.' };
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
  if (String(username).trim() !== ctx.actor.username) requireCanManage_(ctx, String(username).trim());
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
  return scoringCalendar(readCalendar_(ctx), map);
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
