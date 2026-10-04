// ===========================================================================
// TENANT DATA ACCESS
// ===========================================================================

function ensureTenantTabs_(ss) {
  mkTab_(ss, TAB.USERS, USER_COLS);
  mkTab_(ss, TAB.TASKS, TASK_COLS);
  mkTab_(ss, TAB.KRA, ['Job Profile','KRA Title','Description','Weight','Grid/KPI']);
  mkTab_(ss, TAB.REVIEWS, ['Month','Employee','Performance Score','Delegation Score','Final Score','Date']);
  mkTab_(ss, TAB.LEAVE, ['Username','From','To','Reason','Approved']);
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
  return ss;
}

function widen_(sheet, cols) {
  if (!sheet) return;
  var last = sheet.getLastColumn();
  if (last >= cols.length) return;
  sheet.getRange(1, last + 1, 1, cols.length - last)
       .setValues([cols.slice(last)]);
}

function blankUserRow_() { return USER_COLS.map(function () { return ''; }); }
function blankTaskRow_() { return TASK_COLS.map(function () { return ''; }); }

/* ---------- users -------------------------------------------------------- */

function readUsers_(ctx) {
  var sh = ctx.ss.getSheetByName(TAB.USERS);
  var d = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < d.length; i++) {
    if (!d[i][U['Username']] && !d[i][U['Email']]) continue;
    out.push(rowToUser_(d[i], i + 1));
  }
  return out;
}

function rowToUser_(r, rowIndex) {
  return {
    name: r[U['Name']], username: String(r[U['Username']] || '').trim(),
    email: String(r[U['Email']] || '').trim(), role: r[U['Role']] || 'Doer',
    jobProfile: r[U['Job Profile']] || '', dept: r[U['Dept']] || '',
    phone: r[U['Phone']] || '', manager: String(r[U['Manager']] || '').trim(),
    active: r[U['Active']] === '' || r[U['Active']] === true || String(r[U['Active']]).toLowerCase() === 'true',
    wipLimit: r[U['WIP Limit']] === '' ? null : Number(r[U['WIP Limit']]),
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
}

/* ---------- tasks -------------------------------------------------------- */

function readTasks_(ctx) {
  var d = ctx.ss.getSheetByName(TAB.TASKS).getDataRange().getValues();
  var names = {};
  readUsers_(ctx).forEach(function (u) { names[u.username] = u.name; });
  var out = [];
  for (var i = 1; i < d.length; i++) {
    if (!d[i][T['ID']]) continue;
    out.push(rowToTask_(d[i], i + 1, names));
  }
  return out;
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
  var sh = ctx.ss.getSheetByName(TAB.SETTINGS);
  if (!sh) return DEFAULT_CATEGORIES.slice();
  var d = sh.getDataRange().getValues();
  var out = d.map(function (r) { return String(r[0] || '').trim(); })
             .filter(function (c) { return c; });
  return out.length ? out : DEFAULT_CATEGORIES.slice();
}

function updateCategories_(ctx, categories) {
  requireManager_(ctx); blockIfStopped_(ctx);
  var list = (categories || []).map(function (c) { return String(c).trim(); })
                               .filter(function (c) { return c; });
  var sh = ctx.ss.getSheetByName(TAB.SETTINGS) || ctx.ss.insertSheet(TAB.SETTINGS);
  sh.clear();
  if (list.length) sh.getRange(1, 1, list.length, 1).setValues(list.map(function (c) { return [c]; }));
  return { status: 'success', categories: list };
}

function readLeave_(ctx) {
  var sh = ctx.ss.getSheetByName(TAB.LEAVE);
  if (!sh) return [];
  var d = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < d.length; i++) {
    if (!d[i][0]) continue;
    out.push({ username: String(d[i][0]).trim(), from: toYmd_(d[i][1]), to: toYmd_(d[i][2]),
               reason: d[i][3] || '', approved: d[i][4] !== false });
  }
  return out;
}

function setLeave_(ctx, username, from, to, reason) {
  requireManager_(ctx); blockIfStopped_(ctx);
  if (!username || !from) throw new Error('Pick a person and a start date.');
  var sh = mkTab_(ctx.ss, TAB.LEAVE, ['Username','From','To','Reason','Approved']);
  sh.appendRow([String(username).trim(), from, to || from, reason || '', true]);
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
