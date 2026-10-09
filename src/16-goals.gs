// ===========================================================================
// GOALS, VALUES AND KEY NUMBERS
// ===========================================================================
/**
 * DOME BOX — WHERE THE COMPANY IS GOING
 * =============================================================================
 * Four things, set up once and then lived with every week:
 *
 *   Purpose      why the company exists. One sentence.
 *   Values       how people here behave, each with a short code — the letter
 *                a team shouts in a meeting — and what it looks like in practice.
 *   Goals        what the company will achieve: Year goals for the financial
 *                year, and Quarter goals underneath them. Each has an owner and
 *                a status: On course, At risk, Done, Dropped.
 *   Key numbers  the few weekly figures that say whether the week went well,
 *                each with a target and whether higher or lower is better.
 *
 * THE PART THAT MAKES IT MORE THAN A WALL POSTER
 *
 * Everything else in Dome Box can point at these. A task or a whole project
 * says which goal it serves; a cookie award says which value it recognised; a
 * roadblock or a key number says which goal it threatens. So a goal's progress
 * is not somebody's optimistic percentage — it is the share of the work linked
 * to it that has actually been verified.
 *
 * Quarters follow the Indian financial year by default (April to March, Q1 =
 * Apr–Jun), because that is how an MSME's accountant, bank and GST returns
 * count. A company on the calendar year sets fyStartMonth to 1.
 * =============================================================================
 */

var GOAL_STATUSES = ['On course', 'At risk', 'Done', 'Dropped'];
var GOAL_LEVELS = ['year', 'quarter'];
var VALUE_CODE_MAX = 3;

/* ---------- the financial calendar -------------------------------------- */

function fyStartMonth_(ctx) {
  var m = Number(readSetting_(ctx, 'fyStartMonth', 4));
  return (m >= 1 && m <= 12) ? m : 4;
}

/**
 * The financial year and quarter a date falls in.
 *   fyPeriod_(2026-10-09, 4) -> { year: 'FY26-27', quarter: 'FY26-27 Q3', q: 3, ... }
 *   fyPeriod_(2027-02-01, 4) -> Q4 of FY26-27, not Q1 of 2027.
 */
function fyPeriod_(date, startMonth) {
  var d = date ? new Date(date) : new Date();
  var sm = (Number(startMonth) || 4) - 1;                // 0-based
  var y = d.getFullYear(), m = d.getMonth();
  var fy = m >= sm ? y : y - 1;
  var q = Math.floor(((m - sm + 12) % 12) / 3) + 1;
  var two = function (n) { return String(n).slice(-2); };
  var label = sm === 0 ? 'FY' + fy : 'FY' + two(fy) + '-' + two(fy + 1);
  var qFrom = new Date(fy, sm + (q - 1) * 3, 1);
  var qTo = new Date(fy, sm + q * 3, 0);
  return { year: label, quarter: label + ' Q' + q, q: q, fyStart: fy,
           from: ymd(qFrom), to: ymd(qTo),
           yearFrom: ymd(new Date(fy, sm, 1)), yearTo: ymd(new Date(fy + 1, sm, 0)) };
}

/** The quarters worth offering in a picker: this year's four and next Q1. */
function quarterChoices_(ctx) {
  var sm = fyStartMonth_(ctx), now = fyPeriod_(new Date(), sm), out = [];
  for (var i = 0; i < 5; i++) {
    var d = new Date(now.fyStart, sm - 1 + i * 3, 15);
    out.push(fyPeriod_(d, sm).quarter);
  }
  return out;
}

/* ---------- reading ------------------------------------------------------ */

function tab_(ctx, name, cols) {
  return ctx.ss.getSheetByName(name) || mkTab_(ctx.ss, name, cols);
}

function readDirection_(ctx) {
  return cached_(ctx, 'direction', function () {
    var sh = ctx.ss.getSheetByName(TAB.DIRECTION);
    var out = { purpose: '', values: [] };
    if (!sh) return out;
    sh.getDataRange().getValues().slice(1).forEach(function (r, i) {
      var kind = String(r[0] || '').trim();
      if (kind === 'purpose') out.purpose = String(r[2] || '');
      else if (kind === 'value' && String(r[2] || '').trim()) {
        out.values.push({ code: String(r[1] || '').trim(), title: String(r[2]).trim(),
                          detail: String(r[3] || ''), order: Number(r[4]) || i, row: i + 2 });
      }
    });
    out.values.sort(function (a, b) { return a.order - b.order; });
    return out;
  });
}

function readGoals_(ctx) {
  return cached_(ctx, 'goals', function () {
    var sh = ctx.ss.getSheetByName(TAB.GOALS);
    if (!sh) return [];
    return sh.getDataRange().getValues().slice(1).map(function (r, i) { r.row_ = i + 2; return r; })
      .filter(function (r) { return r[0]; })
      .map(function (r) {
        return { id: String(r[0]), level: String(r[1] || 'quarter'), period: String(r[2] || ''),
                 title: String(r[3] || ''), detail: String(r[4] || ''),
                 owner: String(r[5] || '').trim(), parent: String(r[6] || '').trim(),
                 status: GOAL_STATUSES.indexOf(String(r[7])) > -1 ? String(r[7]) : 'On course',
                 note: String(r[8] || ''), created: toIso_(r[9]), updated: toIso_(r[10]), row: r.row_ };
      });
  });
}

function goalById_(ctx, id) {
  id = String(id || '').trim();
  if (!id) return null;
  return readGoals_(ctx).filter(function (g) { return g.id === id; })[0] || null;
}

/**
 * How far along a goal really is: the share of the work linked to it that has
 * been verified. Cancelled and rejected work is not counted either way —
 * dropping a task should not make a goal look closer to done.
 * A Year goal counts the work linked to it and to every Quarter goal under it.
 */
function goalProgress_(goal, goals, tasks) {
  var ids = [goal.id];
  if (goal.level === 'year') {
    goals.forEach(function (g) { if (g.parent === goal.id) ids.push(g.id); });
  }
  var linked = tasks.filter(function (t) {
    return t.goal && ids.indexOf(t.goal) > -1 && t.status !== 'Cancelled' && t.status !== 'Rejected';
  });
  var done = linked.filter(function (t) { return t.status === 'Verified'; }).length;
  var overdue = linked.filter(function (t) {
    return isOpen(t.status) && t.due && dayDiff(new Date(), parseYmd(t.due)) > 0; }).length;
  return { total: linked.length, done: done, overdue: overdue,
           percent: linked.length ? Math.round(done / linked.length * 100) : null };
}

/* ---------- the page ----------------------------------------------------- */

function getDirection_(ctx) {
  var dir = readDirection_(ctx), goals = readGoals_(ctx), tasks = readTasks_(ctx);
  var names = {};
  readUsers_(ctx).forEach(function (u) { names[u.username] = u.name; });
  var sm = fyStartMonth_(ctx), now = fyPeriod_(new Date(), sm);

  var withProgress = goals.map(function (g) {
    var p = goalProgress_(g, goals, tasks);
    return { id: g.id, level: g.level, period: g.period, title: g.title, detail: g.detail,
             owner: g.owner, ownerName: names[g.owner] || g.owner, parent: g.parent,
             status: g.status, note: g.note, updated: g.updated, progress: p };
  });

  return { status: 'success', purpose: dir.purpose, values: dir.values.map(function (v) {
      return { code: v.code, title: v.title, detail: v.detail }; }),
    goals: withProgress, statuses: GOAL_STATUSES,
    now: { year: now.year, quarter: now.quarter, from: now.from, to: now.to },
    quarters: quarterChoices_(ctx), fyStartMonth: sm,
    numbers: readNumbersWithLog_(ctx, names),
    canEdit: ctx.actor.role !== ROLE.DOER, canEditValues: ctx.actor.role === ROLE.ADMIN };
}

/* ---------- purpose and values (Admin) ----------------------------------- */

function saveDirection_(ctx, form) {
  requireAdmin_(ctx); blockIfStopped_(ctx);
  form = form || {};
  var purpose = String(form.purpose || '').trim();
  var values = (form.values || []).map(function (v) {
    return { code: String(v.code || '').trim().toUpperCase().slice(0, VALUE_CODE_MAX),
             title: String(v.title || '').trim(), detail: String(v.detail || '').trim() };
  }).filter(function (v) { return v.title; });

  if (values.length > 12) throw new Error('Twelve values at most. A list nobody can remember is not a set of values.');
  var seen = {};
  values.forEach(function (v) {
    var k = v.title.toLowerCase();
    if (seen[k]) throw new Error('"' + v.title + '" is listed twice.');
    seen[k] = true;
    if (v.code && seen['#' + v.code]) throw new Error('Two values share the code "' + v.code + '".');
    if (v.code) seen['#' + v.code] = true;
  });

  return withLock_(function () {
    var sh = tab_(ctx, TAB.DIRECTION, DIRECTION_COLS);
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, DIRECTION_COLS.length).clearContent();
    var rows = [['purpose', '', purpose, '', 0]].concat(values.map(function (v, i) {
      return ['value', v.code, v.title, v.detail, i + 1]; }));
    sh.getRange(2, 1, rows.length, DIRECTION_COLS.length).setValues(rows);
    dropCache_(ctx);
    return { status: 'success', message: 'Saved. ' + values.length + ' value' + (values.length === 1 ? '' : 's') + '.' };
  });
}

/** A value by its code or its title — what a tag can be written as. */
function valueByTag_(ctx, tag) {
  tag = String(tag || '').trim();
  if (!tag) return null;
  var t = tag.toLowerCase();
  return readDirection_(ctx).values.filter(function (v) {
    return v.code.toLowerCase() === t || v.title.toLowerCase() === t; })[0] || null;
}

/* ---------- goals -------------------------------------------------------- */

function saveGoal_(ctx, form) {
  requireManager_(ctx); blockIfStopped_(ctx);
  form = form || {};
  var title = String(form.title || '').trim();
  if (!title) throw new Error('Give the goal a title.');
  if (title.length > 140) throw new Error('Keep the title under 140 characters — the detail goes below it.');
  var level = GOAL_LEVELS.indexOf(form.level) > -1 ? form.level : 'quarter';
  var period = String(form.period || '').trim();
  var sm = fyStartMonth_(ctx), now = fyPeriod_(new Date(), sm);
  if (!period) period = level === 'year' ? now.year : now.quarter;
  if (level === 'quarter' && !/ Q[1-4]$/.test(period)) throw new Error('Pick the quarter this goal belongs to.');
  if (level === 'year' && / Q[1-4]$/.test(period)) period = period.replace(/ Q[1-4]$/, '');

  var owner = String(form.owner || ctx.actor.username).trim();
  if (!findUser_(ctx.ss, owner)) throw new Error('The owner is not in this workspace.');
  var parent = String(form.parent || '').trim();
  if (parent) {
    var pg = goalById_(ctx, parent);
    if (!pg || pg.level !== 'year') throw new Error('A quarter goal can only sit under a year goal.');
    if (level === 'year') parent = '';
  }
  var status = GOAL_STATUSES.indexOf(form.status) > -1 ? form.status : 'On course';

  return withLock_(function () {
    var sh = tab_(ctx, TAB.GOALS, GOAL_COLS);
    var now2 = new Date();
    if (form.id) {
      var g = goalById_(ctx, form.id);
      if (!g) throw new Error('That goal no longer exists.');
      sh.getRange(g.row, 2, 1, 10).setValues([[level, period, title, String(form.detail || ''),
        owner, parent, status, String(form.note || g.note || ''), g.created ? new Date(g.created) : now2, now2]]);
      dropCache_(ctx);
      return { status: 'success', id: g.id, message: 'Goal updated.' };
    }
    var id = 'G-' + Utilities.getUuid().slice(0, 8);
    sh.appendRow([id, level, period, title, String(form.detail || ''), owner, parent, status, '', now2, now2]);
    dropCache_(ctx);
    return { status: 'success', id: id, message: (level === 'year' ? 'Year' : 'Quarter') + ' goal added.' };
  });
}

/**
 * Just the status, and a line on why. Open to the goal's owner as well as
 * managers — the person closest to the goal is the one who knows it is at risk,
 * and making them ask somebody else to say so is how bad news arrives late.
 */
function setGoalStatus_(ctx, id, status, note) {
  blockIfStopped_(ctx);
  var g = goalById_(ctx, id);
  if (!g) throw new Error('That goal no longer exists.');
  if (ctx.actor.role === ROLE.DOER && g.owner !== ctx.actor.username) {
    throw new Error('Only the goal\'s owner or a manager can change its status.');
  }
  if (GOAL_STATUSES.indexOf(status) < 0) throw new Error('Status must be one of: ' + GOAL_STATUSES.join(', ') + '.');
  if (status === 'At risk' && !String(note || '').trim()) {
    throw new Error('Say what is putting it at risk — one line is enough. "At risk" with no reason starts the wrong conversation.');
  }
  return withLock_(function () {
    var sh = tab_(ctx, TAB.GOALS, GOAL_COLS);
    sh.getRange(g.row, 8, 1, 4).setValues([[status, String(note || g.note || ''), g.created ? new Date(g.created) : new Date(), new Date()]]);
    dropCache_(ctx);
    return { status: 'success', message: g.title + ': ' + status + '.' };
  });
}

function deleteGoal_(ctx, id) {
  requireManager_(ctx); blockIfStopped_(ctx);
  var g = goalById_(ctx, id);
  if (!g) throw new Error('That goal no longer exists.');
  /* A goal with work pointing at it is dropped, not deleted: deleting it would
     leave tasks tagged to nothing and quietly rewrite what they were for. */
  var linked = readTasks_(ctx).some(function (t) { return t.goal === g.id; }) ||
               readGoals_(ctx).some(function (x) { return x.parent === g.id; });
  if (linked) throw new Error('Work is linked to this goal. Mark it Dropped instead, so that history still makes sense.');
  return withLock_(function () {
    tab_(ctx, TAB.GOALS, GOAL_COLS).deleteRow(g.row);
    dropCache_(ctx);
    return { status: 'success', message: 'Goal removed.' };
  });
}

/* ---------- key numbers -------------------------------------------------- */

/** The Monday a date's week starts on — the key a weekly figure is filed under. */
function weekOf_(d) {
  var x = d ? new Date(d) : new Date();
  x.setHours(0, 0, 0, 0);
  var dow = (x.getDay() + 6) % 7;                // Monday = 0
  x.setDate(x.getDate() - dow);
  return ymd(x);
}

function readNumbers_(ctx) {
  return cached_(ctx, 'numbers', function () {
    var sh = ctx.ss.getSheetByName(TAB.NUMBERS);
    if (!sh) return [];
    return sh.getDataRange().getValues().slice(1).map(function (r, i) { r.row_ = i + 2; return r; })
      .filter(function (r) { return r[0]; }).map(function (r) {
      return { id: String(r[0]), name: String(r[1] || ''), owner: String(r[2] || '').trim(),
               unit: String(r[3] || ''), target: r[4] === '' ? null : Number(r[4]),
               direction: String(r[5]) === 'at most' ? 'at most' : 'at least',
               goal: String(r[6] || '').trim(), active: String(r[7]) !== 'false', row: r.row_ };
    });
  });
}

/** Whether a figure met its target. Null when there is no figure or no target. */
function numberHit_(n, value) {
  if (value === null || value === '' || value === undefined || n.target === null || isNaN(n.target)) return null;
  var v = Number(value);
  if (isNaN(v)) return null;
  return n.direction === 'at most' ? v <= n.target : v >= n.target;
}

function readNumbersWithLog_(ctx, names) {
  var nums = readNumbers_(ctx).filter(function (n) { return n.active; });
  var log = {};
  var sh = ctx.ss.getSheetByName(TAB.NUMBER_LOG);
  if (sh) sh.getDataRange().getValues().slice(1).forEach(function (r) {
    var k = String(r[0]); (log[k] = log[k] || {})[toYmd_(r[1])] = r[2] === '' ? null : Number(r[2]);
  });
  var weeks = [];
  for (var i = 5; i >= 0; i--) { var d = new Date(); d.setDate(d.getDate() - i * 7); weeks.push(weekOf_(d)); }
  return { weeks: weeks, thisWeek: weekOf_(new Date()), list: nums.map(function (n) {
    var vals = weeks.map(function (w) {
      var v = (log[n.id] || {})[w];
      return { week: w, value: v === undefined ? null : v, hit: numberHit_(n, v) };
    });
    return { id: n.id, name: n.name, owner: n.owner, ownerName: (names || {})[n.owner] || n.owner,
             unit: n.unit, target: n.target, direction: n.direction, goal: n.goal, weeks: vals };
  }) };
}

function saveNumber_(ctx, form) {
  requireManager_(ctx); blockIfStopped_(ctx);
  form = form || {};
  var name = String(form.name || '').trim();
  if (!name) throw new Error('Name the number.');
  var target = form.target === '' || form.target == null ? '' : Number(form.target);
  if (target !== '' && isNaN(target)) throw new Error('The target has to be a number.');
  var owner = String(form.owner || ctx.actor.username).trim();
  if (!findUser_(ctx.ss, owner)) throw new Error('The owner is not in this workspace.');
  if (form.goal && !goalById_(ctx, form.goal)) throw new Error('That goal no longer exists.');
  var dir = form.direction === 'at most' ? 'at most' : 'at least';

  return withLock_(function () {
    var sh = tab_(ctx, TAB.NUMBERS, NUMBER_COLS);
    if (form.id) {
      var n = readNumbers_(ctx).filter(function (x) { return x.id === form.id; })[0];
      if (!n) throw new Error('That number no longer exists.');
      sh.getRange(n.row, 2, 1, 7).setValues([[name, owner, String(form.unit || ''), target, dir,
        String(form.goal || ''), form.active === false ? 'false' : 'true']]);
      dropCache_(ctx);
      return { status: 'success', id: n.id, message: 'Number updated.' };
    }
    var id = 'N-' + Utilities.getUuid().slice(0, 8);
    sh.appendRow([id, name, owner, String(form.unit || ''), target, dir, String(form.goal || ''), 'true', new Date()]);
    dropCache_(ctx);
    return { status: 'success', id: id, message: 'Number added.' };
  });
}

/** This week's figure for a number. Owner, or any manager. Overwrites the week. */
function recordNumber_(ctx, id, value, week) {
  blockIfStopped_(ctx);
  var n = readNumbers_(ctx).filter(function (x) { return x.id === id; })[0];
  if (!n) throw new Error('That number no longer exists.');
  if (ctx.actor.role === ROLE.DOER && n.owner !== ctx.actor.username) {
    throw new Error('Only the number\'s owner or a manager can enter it.');
  }
  var v = value === '' || value == null ? '' : Number(value);
  if (v !== '' && isNaN(v)) throw new Error('Enter a number.');
  var wk = weekOf_(week ? parseYmd(week) : new Date());
  return withLock_(function () {
    var sh = tab_(ctx, TAB.NUMBER_LOG, NUMBER_LOG_COLS);
    var d = sh.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][0]) === id && toYmd_(d[i][1]) === wk) {
        sh.getRange(i + 1, 3, 1, 3).setValues([[v, ctx.actor.username, new Date()]]);
        dropCache_(ctx);
        return { status: 'success', hit: numberHit_(n, v) };
      }
    }
    sh.appendRow([id, wk, v, ctx.actor.username, new Date()]);
    dropCache_(ctx);
    return { status: 'success', hit: numberHit_(n, v) };
  });
}
