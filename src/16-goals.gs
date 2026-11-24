// ===========================================================================
// GOALS, VALUES AND KEY NUMBERS
// ===========================================================================
/**
 * DOMEBOX — WHERE THE COMPANY IS GOING
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
 * Everything else in Domebox can point at these. A task or a whole project
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
        var target = r[15] === '' || r[15] == null ? null : Number(r[15]);
        return { id: String(r[0]), level: String(r[1] || 'quarter'), period: String(r[2] || ''),
                 title: String(r[3] || ''), detail: String(r[4] || ''),
                 owner: String(r[5] || '').trim(), parent: String(r[6] || '').trim(),
                 status: GOAL_STATUSES.indexOf(String(r[7])) > -1 ? String(r[7]) : 'On course',
                 note: String(r[8] || ''), created: toIso_(r[9]), updated: toIso_(r[10]), row: r.row_,
                 /* Added later; a goal from before them is a company goal with no target. */
                 scope: String(r[11] || '') === 'dept' ? 'dept' : 'company', dept: String(r[12] || '').trim(),
                 metric: target === null || isNaN(target) ? null : { unit: String(r[13] || ''),
                   start: Number(r[14]) || 0, target: target, lower: String(r[16]) === 'lower' },
                 checkins: safeJson_(r[17], []) };
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
  var dir = readDirection_(ctx), goals = readGoals_(ctx), tasks = readAllTasks_(ctx);
  var names = {};
  readUsers_(ctx).forEach(function (u) { names[u.username] = u.name; });
  var sm = fyStartMonth_(ctx), now = fyPeriod_(new Date(), sm);

  var withProgress = goals.filter(function (g) { return goalVisible_(ctx, g); }).map(function (g) {
    var p = goalProgress_(g, goals, tasks);
    return { id: g.id, level: g.level, period: g.period, title: g.title, detail: g.detail,
             owner: g.owner, ownerName: names[g.owner] || g.owner, parent: g.parent,
             status: g.status, note: g.note, updated: g.updated, progress: p,
             scope: g.scope, dept: g.dept, metric: g.metric, checkins: g.checkins.slice(-26),
             outlook: goalOutlook_(g, p, sm, new Date()),
             canManage: canManageGoal_(ctx, g), canCheckIn: canCheckInGoal_(ctx, g) };
  });
  rollUpOutlooks_(withProgress, goals, tasks, sm);

  return { status: 'success', purpose: dir.purpose, values: dir.values.map(function (v) {
      return { code: v.code, title: v.title, detail: v.detail }; }),
    goals: withProgress, statuses: GOAL_STATUSES,
    now: { year: now.year, quarter: now.quarter, from: now.from, to: now.to },
    quarters: quarterChoices_(ctx), fyStartMonth: sm,
    numbers: readNumbersWithLog_(ctx, names),
    canEdit: ctx.actor.role !== ROLE.DOER, canEditValues: ctx.actor.role === ROLE.ADMIN,
    canCompanyGoals: ctx.actor.role === ROLE.ADMIN, myDept: String(ctx.me.dept || ''),
    depts: ctx.actor.role === ROLE.ADMIN ? goalDepts_(ctx) : (ctx.me.dept ? [String(ctx.me.dept)] : []) };
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
  var isAdmin = ctx.actor.role === ROLE.ADMIN;
  var existing = form.id ? goalById_(ctx, form.id) : null;
  if (form.id && !existing) throw new Error('That goal no longer exists.');
  if (existing && !canManageGoal_(ctx, existing)) throw new Error('Only an Admin, or the head of its department, can change this goal.');
  /* Company goals are the Admin's. A head of department sets goals for their
     own department, each one pointing at the company goal it serves. */
  var scope = existing ? existing.scope : (form.scope === 'dept' || (!isAdmin && form.scope !== 'company') ? 'dept' : 'company');
  var dept = '';
  if (scope === 'company' && !isAdmin) throw new Error('Company goals are set by an Admin. Add a goal for your department instead.');
  if (scope === 'dept') {
    dept = existing ? existing.dept : String(isAdmin ? (form.dept || ctx.me.dept || '') : (ctx.me.dept || '')).trim();
    if (!dept) throw new Error(isAdmin ? 'Pick the department this goal is for.' : 'Your department is not set. Ask an Admin to add it to your Team profile, then add the goal.');
  }
  var metric = goalMetricFrom_(form, existing);
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
  var ou = findUser_(ctx.ss, owner);
  if (!ou) throw new Error('The owner is not in this workspace.');
  if (scope === 'dept' && !isAdmin && owner !== ctx.actor.username && String(ou.dept || '') !== dept) {
    throw new Error('Give a department goal to someone in ' + dept + '.');
  }
  var parent = String(form.parent || '').trim();
  if (parent) {
    var pg = goalById_(ctx, parent);
    if (!pg || pg.id === (existing && existing.id)) throw new Error('That goal it serves no longer exists.');
    if (scope === 'company' || pg.scope === 'dept') {
      /* Within one level of the plan: a quarter goal sits under a year goal. */
      if (pg.level !== 'year' || level !== 'quarter') throw new Error('A quarter goal can only sit under a year goal.');
      if (pg.scope === 'dept' && (scope !== 'dept' || pg.dept !== dept)) throw new Error('A department goal can only sit under its own department\u2019s goals, or a company goal.');
    }
    /* A department goal may serve any company goal, year or quarter. */
  }
  var status = GOAL_STATUSES.indexOf(form.status) > -1 ? form.status : 'On course';

  return withLock_(function () {
    var sh = tab_(ctx, TAB.GOALS, GOAL_COLS);
    var now2 = new Date();
    widen_(sh, GOAL_COLS);
    var mcols = metric ? [metric.unit, metric.start, metric.target, metric.lower ? 'lower' : 'higher'] : ['', '', '', ''];
    if (form.id) {
      var g = goalById_(ctx, form.id);
      if (!g) throw new Error('That goal no longer exists.');
      sh.getRange(g.row, 2, 1, 16).setValues([[level, period, title, String(form.detail || ''),
        owner, parent, status, String(form.note || g.note || ''), g.created ? new Date(g.created) : now2, now2,
        scope, dept].concat(mcols)]);
      dropCache_(ctx);
      return { status: 'success', id: g.id, message: 'Goal updated.' };
    }
    var id = 'G-' + Utilities.getUuid().slice(0, 8);
    sh.appendRow([id, level, period, title, String(form.detail || ''), owner, parent, status, '', now2, now2,
      scope, dept].concat(mcols).concat(['[]']));
    dropCache_(ctx);
    return { status: 'success', id: id, message: (scope === 'dept' ? dept + ': ' : '') + (level === 'year' ? 'Year' : 'Quarter') + ' goal added.' };
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
  if (g.owner !== ctx.actor.username && !canManageGoal_(ctx, g)) {
    throw new Error('Only the goal\'s owner, the head of its department or an Admin can change its status.');
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
  if (!canManageGoal_(ctx, g)) throw new Error('Only an Admin, or the head of its department, can remove this goal.');
  /* A goal with work pointing at it is dropped, not deleted: deleting it would
     leave tasks tagged to nothing and quietly rewrite what they were for. */
  var linked = readAllTasks_(ctx).some(function (t) { return t.goal === g.id; }) ||
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

/* ---------- department goals, targets and the on-track analysis ------------
   A company goal is set by an Admin and seen by everyone. A department goal is
   set by that department's head (or an Admin), points at the company goal it
   serves, and is seen by the Admin, its owner and the people in that
   department — another department's plans are not everybody's business.

   A goal can carry a target figure: "rejection rate from 4% down to 1.5%".
   Its owner or department head enters the figure as it moves (a check-in),
   and the system says whether it is on track: how far along it is against how
   far through its period, and where it ends at the pace so far. A goal with no
   figure is judged on the work linked to it instead. */

var GOAL_STALE_DAYS = 21;

function goalVisible_(ctx, g) {
  if (g.scope !== 'dept' || ctx.actor.role === ROLE.ADMIN || g.owner === ctx.actor.username) return true;
  return !!g.dept && String(ctx.me.dept || '').trim() === g.dept;
}
/** Edit, drop or remove: an Admin for anything; a head of department for their own department's goals. */
function canManageGoal_(ctx, g) {
  if (ctx.actor.role === ROLE.ADMIN) return true;
  if (g.scope !== 'dept' || ctx.actor.role === ROLE.DOER) return false;
  return !!g.dept && String(ctx.me.dept || '').trim() === g.dept;
}
/** Enter the figure: the goal's owner too — they are closest to it. */
function canCheckInGoal_(ctx, g) {
  return !!g.metric && (g.owner === ctx.actor.username || canManageGoal_(ctx, g));
}
function goalDepts_(ctx) {
  var seen = {};
  readUsers_(ctx).forEach(function (u) { var d = String(u.dept || '').trim(); if (d && u.active !== false) seen[d] = true; });
  readGoals_(ctx).forEach(function (g) { if (g.dept) seen[g.dept] = true; });
  return Object.keys(seen).sort();
}

/** The target from the form: none, or a start, a target and a unit. Lower-is-better follows from them. */
function goalMetricFrom_(form, existing) {
  var t = form.target;
  if (t === undefined && existing) return existing.metric;
  if (t === '' || t === null || t === undefined) return null;
  var target = Number(t), start = Number(form.start === '' || form.start == null ? 0 : form.start);
  if (!isFinite(target) || !isFinite(start)) throw new Error('The start and target must be numbers.');
  if (target === start) throw new Error('The target must differ from where it starts.');
  var unit = String(form.unit || '').trim().slice(0, 20);
  return { unit: unit, start: start, target: target, lower: target < start };
}

/** The dates a goal's period runs between, from its label ("FY26-27 Q3", "FY2026"). */
function goalPeriodBounds_(label, sm) {
  var m = String(label || '').match(/^FY(\d{2,4})(?:-(\d{2}))?(?: Q([1-4]))?$/);
  if (!m) return null;
  var fy = m[1].length === 4 ? Number(m[1]) : 2000 + Number(m[1]);
  var s = (Number(sm) || 4) - 1;
  if (m[3]) { var q = Number(m[3]); return { from: new Date(fy, s + (q - 1) * 3, 1), to: new Date(fy, s + q * 3, 0, 23, 59) }; }
  return { from: new Date(fy, s, 1), to: new Date(fy + 1, s, 0, 23, 59) };
}

/**
 * Is it on track? Compares how far along the goal is with how far through its
 * period we are, and projects the end at the pace so far.
 * @return {verdict, tone, reason, percent, expected}
 */
function goalOutlook_(g, progress, sm, now) {
  now = now || new Date();
  if (g.status === 'Done') return { verdict: 'Achieved', tone: 'good', reason: 'Marked done.', percent: 100, expected: null };
  if (g.status === 'Dropped') return { verdict: 'Dropped', tone: 'none', reason: 'No longer pursued.', percent: null, expected: null };
  var b = goalPeriodBounds_(g.period, sm);
  var span = b ? Math.max(1, b.to - b.from) : 1;
  var gone = b ? Math.max(0, Math.min(1, (now - b.from) / span)) : null;
  var pct = function (x) { return Math.round(Math.max(0, Math.min(1.5, x)) * 100); };
  var unit = g.metric && g.metric.unit ? (/^%$/.test(g.metric.unit) ? '%' : ' ' + g.metric.unit) : '';
  var fmt = function (v) { return (Math.round(v * 100) / 100) + unit; };
  var judge = function (done, pace, extra) {
    if (gone === null) return { verdict: done >= 1 ? 'Achieved' : 'In progress', tone: done >= 1 ? 'good' : 'none' };
    if (done >= 1) return { verdict: 'Achieved', tone: 'good' };
    if (gone >= 1) return { verdict: 'Missed', tone: 'bad' };
    if (pace >= 1 || done >= gone - 0.05) return extra ? { verdict: 'At risk', tone: 'warn' } : { verdict: 'On track', tone: 'good' };
    if (pace >= 0.8) return { verdict: 'At risk', tone: 'warn' };
    return { verdict: 'Off track', tone: 'bad' };
  };

  if (g.metric) {
    var m = g.metric, need = m.target - m.start, list = (g.checkins || []).slice().sort(function (a, b2) { return String(a.d) < String(b2.d) ? -1 : 1; });
    var last = list[list.length - 1];
    if (!last) {
      if (gone !== null && gone < 0.15) return { verdict: 'Not started', tone: 'none', reason: 'No figure entered yet — the first check-in starts the trend.', percent: 0, expected: pct(gone) };
      return { verdict: 'Needs data', tone: 'warn', reason: 'No figure entered yet' + (gone !== null ? ', with ' + pct(gone) + '% of the period gone.' : '.'), percent: 0, expected: gone === null ? null : pct(gone) };
    }
    var done = (Number(last.v) - m.start) / need;
    var at = b ? Math.max(0.02, Math.min(1, (parseYmd(last.d) - b.from) / span)) : 1;
    var pace = done / at;                        // where it ends, as a share of the target, if it carries on as it has
    var ends = m.start + need * Math.max(0, pace);
    var age = Math.floor((now - parseYmd(last.d)) / 86400000);
    var stale = gone !== null && gone < 1 && age > GOAL_STALE_DAYS;
    var j = judge(done, pace, false);
    var why = 'At ' + fmt(Number(last.v)) + ' against a target of ' + fmt(m.target) + ': ' + pct(done) + '% of the way' +
      (gone !== null && gone < 1 ? ', with ' + pct(gone) + '% of the period gone.' : '.') +
      (j.verdict !== 'Achieved' && gone !== null && gone < 1 ? ' At this pace it ends near ' + fmt(ends) + '.' : '') +
      (stale ? ' The last figure is ' + age + ' days old.' : '');
    return { verdict: j.verdict, tone: j.tone, reason: why, percent: pct(done), expected: gone === null ? null : pct(gone),
             last: Number(last.v), lastOn: last.d, projected: Math.round(ends * 100) / 100, stale: stale };
  }

  /* No figure: judged on the work linked to it. */
  var p = progress || { total: 0, done: 0, overdue: 0 };
  if (!p.total) {
    if (gone !== null && gone < 0.15) return { verdict: 'Not started', tone: 'none', reason: 'No work linked yet.', percent: null, expected: pct(gone) };
    return { verdict: 'Needs data', tone: 'warn', reason: 'No work is linked to it and it has no target figure, so there is nothing to measure.', percent: null, expected: gone === null ? null : pct(gone) };
  }
  var d2 = p.done / p.total, j2 = judge(d2, gone ? d2 / Math.max(0.02, gone) : 1, p.overdue > 0);
  return { verdict: j2.verdict, tone: j2.tone, percent: pct(d2), expected: gone === null ? null : pct(gone),
    reason: p.done + ' of ' + p.total + ' linked jobs done (' + pct(d2) + '%)' + (gone !== null && gone < 1 ? ', with ' + pct(gone) + '% of the period gone' : '') +
      (p.overdue ? '; ' + p.overdue + ' overdue.' : '.') };
}

/** Enter the goal's figure as it stands today. One per day; a second the same day replaces it. */
function recordGoalCheckin_(ctx, id, value, note) {
  blockIfStopped_(ctx);
  var g = goalById_(ctx, id);
  if (!g || !goalVisible_(ctx, g)) throw new Error('That goal no longer exists.');
  if (!g.metric) throw new Error('This goal has no target figure. Edit it and add one first.');
  if (!canCheckInGoal_(ctx, g)) throw new Error('Only the goal\'s owner, the head of its department or an Admin can enter its figure.');
  var v = Number(value);
  if (value === '' || value === null || !isFinite(v)) throw new Error('Enter the figure as a number.');
  var today = ymd(new Date());
  var list = (g.checkins || []).filter(function (c) { return c.d !== today; });
  list.push({ d: today, v: v, by: ctx.actor.name, note: String(note || '').trim().slice(0, 200) });
  list = list.slice(-400);
  return withLock_(function () {
    var sh = tab_(ctx, TAB.GOALS, GOAL_COLS);
    widen_(sh, GOAL_COLS);
    sh.getRange(g.row, 18).setValue(JSON.stringify(list));
    sh.getRange(g.row, 11).setValue(new Date());
    dropCache_(ctx);
    g.checkins = list;
    var o = goalOutlook_(g, goalProgress_(g, readGoals_(ctx), readAllTasks_(ctx)), fyStartMonth_(ctx), new Date());
    return { status: 'success', outlook: o, message: 'Figure saved. ' + o.verdict + '.' };
  });
}

/**
 * A goal with no figure and no work of its own is judged on the goals that
 * serve it: a company goal is on track when its department goals are.
 */
function rollUpOutlooks_(shown, goals, tasks, sm) {
  var now = new Date(), memo = {};
  var outlookOf = function (g, depth) {
    if (memo[g.id]) return memo[g.id];
    var own = goalOutlook_(g, goalProgress_(g, goals, tasks), sm, now);
    var kids = goals.filter(function (k) { return k.parent === g.id && k.status !== 'Dropped'; });
    if (depth > 3 || g.metric || g.status === 'Done' || g.status === 'Dropped' || !kids.length ||
        (own.verdict !== 'Needs data' && own.verdict !== 'Not started')) return (memo[g.id] = own);
    var c = { good: 0, warn: 0, bad: 0, none: 0 }, done = 0;
    kids.forEach(function (k) { var o = outlookOf(k, depth + 1); if (o.verdict === 'Achieved') done++;
      if (o.verdict === 'Needs data' || o.verdict === 'Not started') c.none++; else c[o.tone] = (c[o.tone] || 0) + 1; });
    var n = kids.length, judged = n - c.none, v;
    if (done === n) v = { verdict: 'Achieved', tone: 'good' };
    else if (!judged) return (memo[g.id] = own);
    else if (c.bad * 2 > judged) v = { verdict: 'Off track', tone: 'bad' };
    else if (c.bad || c.warn) v = { verdict: 'At risk', tone: 'warn' };
    else v = { verdict: 'On track', tone: 'good' };
    var parts = [];
    if (c.good) parts.push(c.good + ' on track or achieved');
    if (c.warn) parts.push(c.warn + ' at risk');
    if (c.bad) parts.push(c.bad + ' off track');
    if (c.none) parts.push(c.none + ' with no figures yet');
    v.reason = 'Judged on the ' + n + (n === 1 ? ' goal that serves' : ' goals that serve') + ' it: ' + parts.join(', ') + '.';
    v.percent = null; v.expected = own.expected; v.rolledUp = true;
    return (memo[g.id] = v);
  };
  shown.forEach(function (row) {
    var g = goals.filter(function (x) { return x.id === row.id; })[0];
    if (g) row.outlook = outlookOf(g, 0);
  });
}
