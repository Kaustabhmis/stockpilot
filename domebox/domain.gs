/**
 * DOME BOX — DOMAIN ENGINE
 * =============================================================================
 * Pure logic only: no SpreadsheetApp, no GmailApp, no I/O of any kind. Every
 * function here is deterministic, which is what makes the workflow, delegation,
 * recurrence and scoring rules testable instead of hopeful.
 *
 * Apps Script has no modules, so these become globals in the project. The API
 * layer (code.gs) and the scheduler (reminders.gs) call into this file.
 * =============================================================================
 */

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------
var STATUS = {
  AWAITING_APPROVAL:   'Awaiting Approval',   // delegation gate: assignee's manager must agree
  DELEGATION_PROPOSED: 'Delegation Proposed', // holder wants to pass it on; their manager decides
  PENDING:             'Pending',             // accepted, not started
  IN_PROGRESS:         'In Progress',
  FOR_REVIEW:          'For Review',          // handed in, waiting on the verifier
  VERIFIED:            'Verified',            // signed off — the only clean close
  REJECTED:            'Rejected',            // never accepted
  CANCELLED:           'Cancelled',           // withdrawn after acceptance
};

var OPEN_STATUSES = [
  STATUS.AWAITING_APPROVAL, STATUS.DELEGATION_PROPOSED,
  STATUS.PENDING, STATUS.IN_PROGRESS, STATUS.FOR_REVIEW,
];
var CLOSED_STATUSES = [STATUS.VERIFIED, STATUS.REJECTED, STATUS.CANCELLED];

var ROLE = { ADMIN: 'Admin', MANAGER: 'HOD', DOER: 'Doer' };

// High-priority work counts three times a low-priority one, so one missed
// critical task cannot be averaged away under a pile of trivial wins.
//
// The levels are the DEFAULT, not the law: a workspace can name its own —
// "Line Down", "Customer Hold", "Routine" — and give each one a weight. Those
// are merged in once per request by setPriorityScale, so every scoring call
// site below keeps working unchanged whether a tenant has customised them or
// not.
var DEFAULT_PRIORITIES = [
  { name: 'Critical', weight: 4 },
  { name: 'High',     weight: 3 },
  { name: 'Medium',   weight: 2 },
  { name: 'Low',      weight: 1 },
];
var PRIORITY_WEIGHT = { Critical: 4, High: 3, Medium: 2, Low: 1 };
var PRIORITY_ORDER = ['Critical', 'High', 'Medium', 'Low'];

/**
 * Point the engine at this workspace's own priority levels.
 *
 * Merged rather than replaced: a task created under a level that has since been
 * renamed or deleted still has to score, and silently weighting it as Medium is
 * better than throwing on a row somebody wrote two years ago.
 */
function setPriorityScale(levels) {
  if (!levels || !levels.length) return;
  PRIORITY_ORDER = [];
  levels.forEach(function (l) {
    var name = String((l && l.name) || '').trim();
    if (!name) return;
    var w = Number(l.weight);
    PRIORITY_WEIGHT[name] = (isNaN(w) || w <= 0) ? 2 : w;
    PRIORITY_ORDER.push(name);
  });
}

function priorityWeight(priority) {
  return PRIORITY_WEIGHT[priority] || PRIORITY_WEIGHT.Medium || 2;
}

/** Highest weight first — the order a list should be read in. */
function priorityRank(priority) {
  var i = PRIORITY_ORDER.indexOf(priority);
  return i > -1 ? i : PRIORITY_ORDER.length;
}

function isOpen(status) { return OPEN_STATUSES.indexOf(status) > -1; }
function isClosed(status) { return CLOSED_STATUSES.indexOf(status) > -1; }

// ---------------------------------------------------------------------------
// Date helpers — all comparisons are on whole days, so a task due today and
// submitted today is never counted late by a few hours.
// ---------------------------------------------------------------------------
function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function dayDiff(a, b) { return Math.round((startOfDay(a) - startOfDay(b)) / 86400000); }
function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d, n) {
  var x = new Date(d);
  var targetDay = x.getDate();
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  // Clamp: 31 Jan + 1 month must be 28/29 Feb, not 2/3 March.
  var lastDay = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(targetDay, lastDay));
  return x;
}
function ymd(d) {
  var x = startOfDay(d);
  var m = String(x.getMonth() + 1);
  var day = String(x.getDate());
  return x.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
}
function parseYmd(s) {
  if (s instanceof Date) return startOfDay(s);
  var parts = String(s).slice(0, 10).split('-');
  if (parts.length !== 3) return null;
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// WORKFLOW + DELEGATION
// ---------------------------------------------------------------------------
/**
 * Who may move this task, and where to.
 *
 * The rules that make the data trustworthy:
 *  - a person can never verify their own work; only the raiser, the approver or
 *    an Admin closes a task
 *  - work only becomes assigned once the holder's own manager has agreed to it,
 *    so nobody's team gets loaded behind their back
 *  - handing work onward is itself an approval step, so a delegation chain is
 *    visible rather than a silent hand-off
 *
 * `actor` = { username, role }, `task` = { status, assignee, raisedBy, approver, delegateTo }
 */
function allowedTransitions(task, actor) {
  var isAdmin = actor.role === ROLE.ADMIN;
  var isAssignee = task.assignee === actor.username;
  var isRaiser = task.raisedBy === actor.username;
  var isApprover = task.approver === actor.username;
  var canVerify = isAdmin || isRaiser || isApprover;

  switch (task.status) {
    case STATUS.AWAITING_APPROVAL:
      // The assignee's manager (recorded as approver) accepts or refuses the load.
      return (isApprover || isAdmin) ? [STATUS.PENDING, STATUS.REJECTED] : [];

    case STATUS.DELEGATION_PROPOSED:
      // The proposing person's manager decides whether the hand-off is allowed.
      return (isApprover || isAdmin) ? [STATUS.PENDING, STATUS.IN_PROGRESS] : [];

    case STATUS.PENDING:
      var fromPending = [];
      if (isAssignee || isAdmin) fromPending.push(STATUS.IN_PROGRESS);
      if (isRaiser || isAdmin) fromPending.push(STATUS.CANCELLED);
      return fromPending;

    case STATUS.IN_PROGRESS:
      var fromProgress = [];
      if (isAssignee || isAdmin) fromProgress.push(STATUS.FOR_REVIEW);
      if (isRaiser || isAdmin) fromProgress.push(STATUS.CANCELLED);
      return fromProgress;

    case STATUS.FOR_REVIEW:
      // Deliberately excludes the assignee: you cannot sign off your own work.
      return canVerify && !(isAssignee && !isAdmin && !isRaiser)
        ? [STATUS.VERIFIED, STATUS.IN_PROGRESS]   // In Progress here means "rework"
        : (canVerify ? [STATUS.VERIFIED, STATUS.IN_PROGRESS] : []);

    default:
      return []; // Verified / Rejected / Cancelled are terminal
  }
}

function canTransition(task, actor, next) {
  return allowedTransitions(task, actor).indexOf(next) > -1;
}

/**
 * Where a newly raised task should start.
 * If the assignee reports to somebody other than the person raising it, that
 * manager approves first. Assigning to your own report, or to yourself, needs
 * no gate.
 */
/**
 * MULTI-LEVEL ASSIGNMENT — who may assign work to whom.
 *
 *   Admin        anyone
 *   HOD          anyone, in any department
 *   Doer         upward only: their own manager, or any HOD/Admin
 *
 * A Doer assigning sideways to a peer is deliberately refused. It is the one
 * direction with no accountability attached — nobody has agreed to the work and
 * nobody is answerable for it landing, so it becomes a way to move your own
 * tasks onto someone else's list.
 */
function canAssignTo(raiser, assignee) {
  if (!raiser || !assignee) return { ok: false, reason: 'Unknown person.' };
  if (assignee.active === false) return { ok: false, reason: assignee.name + ' is no longer active.' };
  if (raiser.username === assignee.username) return { ok: true, self: true };

  if (raiser.role === ROLE.ADMIN || raiser.role === ROLE.MANAGER) return { ok: true };

  // Doer: upward only.
  var isOwnManager = assignee.username === raiser.manager;
  var isSenior = assignee.role === ROLE.MANAGER || assignee.role === ROLE.ADMIN;
  if (isOwnManager || isSenior) return { ok: true, upward: true };

  return { ok: false, upward: false,
    reason: 'You can raise work for your manager or a department head, not for a colleague. ' +
            'Ask your manager to assign it.' };
}

/**
 * Where a new task lands, and who decides.
 *
 *   raised by an Admin                  → straight to the assignee
 *   raised by the assignee's manager    → straight to the assignee
 *   assigned to yourself                → straight to your own list
 *   raised UPWARD by a Doer             → the recipient accepts or declines it
 *                                         themselves; it is their time being
 *                                         asked for, so nobody else arbitrates
 *   anyone else                         → the assignee's own manager approves
 *
 * That last line is the important one: an HOD in another department can give
 * work to anyone, but it reaches that person only once their own manager has
 * agreed. A manager always knows what their team has been committed to.
 */
function initialStatusFor(assignee, raiser) {
  if (!assignee || !raiser) {
    return { status: STATUS.PENDING, approver: '', note: 'Task assigned' };
  }
  if (assignee.username === raiser.username) {
    return { status: STATUS.PENDING, approver: raiser.username || '', note: 'Self-assigned' };
  }
  if (raiser.role === ROLE.ADMIN) {
    return { status: STATUS.PENDING, approver: raiser.username || '', note: 'Task assigned' };
  }

  var upward = raiser.role === ROLE.DOER &&
    (assignee.username === raiser.manager ||
     assignee.role === ROLE.MANAGER || assignee.role === ROLE.ADMIN);
  if (upward) {
    return { status: STATUS.AWAITING_APPROVAL, approver: assignee.username,
             note: 'Raised by ' + (raiser.name || raiser.username) + ' — awaiting your acceptance',
             upward: true };
  }

  var needsApproval = !!assignee.manager && assignee.manager !== raiser.username;
  return needsApproval
    ? { status: STATUS.AWAITING_APPROVAL, approver: assignee.manager,
        note: 'Awaiting approval from ' + (assignee.name || assignee.username) + "'s manager" }
    : { status: STATUS.PENDING, approver: raiser.username || '', note: 'Task assigned' };
}


/**
 * A holder proposing to pass work onward. Their own manager arbitrates, which
 * keeps a delegation chain auditable instead of letting work quietly circulate.
 */
function proposeDelegation(task, actor, targetUser, actorUser) {
  if (task.assignee !== actor.username && actor.role !== ROLE.ADMIN) {
    return { ok: false, error: 'Only the current owner can hand this task on.' };
  }
  if (!targetUser) return { ok: false, error: 'Pick who should take it over.' };
  if (targetUser.username === task.assignee) {
    return { ok: false, error: 'That is already the current owner.' };
  }
  if (isClosed(task.status)) return { ok: false, error: 'This task is already closed.' };

  // An Admin, or someone with no manager above them, can hand off directly.
  var arbiter = actorUser && actorUser.manager ? actorUser.manager : '';
  if (actor.role === ROLE.ADMIN || !arbiter) {
    return {
      ok: true, status: STATUS.PENDING, assignee: targetUser.username,
      approver: task.approver || actor.username, delegateTo: '',
      note: 'Handed over to ' + targetUser.name + ' by ' + actor.username,
    };
  }
  return {
    ok: true, status: STATUS.DELEGATION_PROPOSED, assignee: task.assignee,
    approver: arbiter, delegateTo: targetUser.username,
    note: actor.username + ' proposes handing this to ' + targetUser.name,
  };
}

// ---------------------------------------------------------------------------
// RECURRING JOBS
// ---------------------------------------------------------------------------
var CADENCE = {
  ONE_TIME: 'One Time',
  DAILY: 'Daily',
  WEEKDAYS: 'Weekdays',
  WEEKLY: 'Weekly',
  FORTNIGHTLY: 'Fortnightly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  HALF_YEARLY: 'Half-Yearly',
  YEARLY: 'Yearly',
  CUSTOM_DAYS: 'Every N Days',
};

/**
 * The next date a recurring job is due after `from`.
 *
 * Returns null for one-off jobs. Weekday cadence skips Saturday and Sunday.
 * Monthly and longer cadences clamp to the end of short months, so a job set
 * for the 31st lands on the 28th/29th in February rather than skidding into
 * March — the bug in naive date arithmetic.
 */
function nextOccurrence(cadence, from, opts) {
  opts = opts || {};
  var base = parseYmd(from);
  if (!base) return null;

  switch (cadence) {
    case CADENCE.DAILY:       return addDays(base, 1);
    case CADENCE.WEEKDAYS:
      var d = addDays(base, 1);
      while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1);
      return d;
    case CADENCE.WEEKLY:      return addDays(base, 7);
    case CADENCE.FORTNIGHTLY: return addDays(base, 14);
    case CADENCE.MONTHLY:     return addMonths(base, 1);
    case CADENCE.QUARTERLY:   return addMonths(base, 3);
    case CADENCE.HALF_YEARLY:  return addMonths(base, 6);
    case CADENCE.YEARLY:      return addMonths(base, 12);
    case CADENCE.CUSTOM_DAYS:
      var n = Number(opts.intervalDays || 0);
      return n > 0 ? addDays(base, n) : null;
    default: return null;
  }
}

/**
 * Decides what a recurring job template owes us as of `today`.
 *
 * This is the fix for the original design, where the next occurrence was only
 * created when somebody verified the last one — so a single unverified task
 * silently ended the series, which is precisely when a reminder matters most.
 * Generation is now driven by the schedule, independent of anyone's behaviour.
 *
 * `job` = { cadence, intervalDays, nextDue, endDate, maxOccurrences,
 *           occurrencesCreated, active, skipIfPreviousOpen }
 * `state` = { previousOpen: bool }
 */
function dueOccurrences(job, today, state) {
  state = state || {};
  var out = { create: [], nextDue: job.nextDue, stop: false, reason: '' };
  if (!job.active) { out.reason = 'paused'; return out; }
  if (job.cadence === CADENCE.ONE_TIME) { out.stop = true; out.reason = 'one-off'; return out; }

  var cursor = parseYmd(job.nextDue);
  if (!cursor) { out.reason = 'no next due date'; return out; }

  var end = job.endDate ? parseYmd(job.endDate) : null;
  var created = Number(job.occurrencesCreated || 0);
  var max = Number(job.maxOccurrences || 0);
  var now = startOfDay(today);

  // Cap the catch-up so a job dormant for a year cannot dump 365 tasks at once.
  var MAX_CATCHUP = 12;
  var guard = 0;

  while (cursor <= now && guard < MAX_CATCHUP) {
    guard++;
    if (end && cursor > end) { out.stop = true; out.reason = 'past end date'; break; }
    if (max && created >= max) { out.stop = true; out.reason = 'reached occurrence limit'; break; }

    // Don't pile a second copy on someone who hasn't finished the first.
    if (job.skipIfPreviousOpen && state.previousOpen && out.create.length === 0) {
      out.reason = 'previous occurrence still open';
      var skipTo = nextOccurrence(job.cadence, cursor, job);
      if (!skipTo) break;
      cursor = skipTo;
      continue;
    }

    out.create.push(ymd(cursor));
    created++;
    var advanced = nextOccurrence(job.cadence, cursor, job);
    if (!advanced) break;
    cursor = advanced;
  }

  out.nextDue = ymd(cursor);
  if (end && parseYmd(out.nextDue) > end) { out.stop = true; out.reason = out.reason || 'past end date'; }
  if (max && created >= max) { out.stop = true; out.reason = out.reason || 'reached occurrence limit'; }
  return out;
}

// ---------------------------------------------------------------------------
// THE PRIORITY LIST — what to do next, and why
// ---------------------------------------------------------------------------
/* A board shows everything at once, which is exactly the wrong shape for the
   question people actually ask on a Monday morning: what do I do first?
   Priority alone does not answer it either — a Low task due this afternoon
   beats a High one due next month, and a task three other people are waiting
   on beats both.
   So the order is computed from three things, and every row says which of them
   put it where it is. A ranking nobody can see the reasoning for is one people
   quietly ignore and go back to their own notebook. */
var URGENCY = {
  overdueBase: 40,      // past its date — nothing outranks this but a bigger overrun
  overduePerDay: 2,
  overdueCap: 20,
  dueToday: 36, dueTomorrow: 28, dueThisWeek: 16, dueSoon: 8,
  perDependent: 8, dependentCap: 24,
  inProgress: 6,        // finishing beats starting
};

/** One task's place in the queue, with the working shown. */
function taskUrgency(task, allTasks, today, cal) {
  var now = today || new Date();
  var reasons = [], score = 0;

  var w = priorityWeight(task.priority);
  score += w * 10;
  reasons.push({ kind: 'priority', text: task.priority || 'Medium', points: w * 10 });

  var due = parseYmd(task.due);
  if (due) {
    var days = dayDiff(due, now);            // positive = still to come
    var late = chargeableLateDays(due, now, task.assignee, cal);
    if (late > 0) {
      var pts = URGENCY.overdueBase + Math.min(late * URGENCY.overduePerDay, URGENCY.overdueCap);
      score += pts;
      reasons.push({ kind: 'overdue', text: late + ' day(s) overdue', points: pts });
    } else if (days <= 0) {
      score += URGENCY.dueToday;
      reasons.push({ kind: 'today', text: 'Due today', points: URGENCY.dueToday });
    } else if (days === 1) {
      score += URGENCY.dueTomorrow;
      reasons.push({ kind: 'soon', text: 'Due tomorrow', points: URGENCY.dueTomorrow });
    } else if (days <= 7) {
      score += URGENCY.dueThisWeek;
      reasons.push({ kind: 'soon', text: 'Due in ' + days + ' days', points: URGENCY.dueThisWeek });
    } else if (days <= 14) {
      score += URGENCY.dueSoon;
      reasons.push({ kind: 'later', text: 'Due in ' + days + ' days', points: URGENCY.dueSoon });
    }
  }

  /* Work that other work is waiting on. Finishing it releases somebody else,
     which is worth more than its own deadline suggests. */
  var dependents = (allTasks || []).filter(function (t) {
    return isOpen(t.status) && (t.blockedBy || []).indexOf(task.id) > -1;
  });
  if (dependents.length) {
    var dp = Math.min(dependents.length * URGENCY.perDependent, URGENCY.dependentCap);
    score += dp;
    reasons.push({ kind: 'blocking', points: dp,
      text: dependents.length + ' task(s) waiting on this' });
  }

  if (task.status === STATUS.IN_PROGRESS) {
    score += URGENCY.inProgress;
    reasons.push({ kind: 'started', text: 'Already started', points: URGENCY.inProgress });
  }

  /* An item sitting on somebody's desk is urgent because of how long it has sat
     there, which is the same clock the responsiveness score runs on. */
  if (task.status === STATUS.FOR_REVIEW || task.status === STATUS.AWAITING_APPROVAL ||
      task.status === STATUS.DELEGATION_PROPOSED) {
    var spells = queueSpells(task).filter(function (sp) { return sp.open; });
    if (spells.length) {
      var held = chargeableLateDays(spells[0].from, now, task.approver || task.raisedBy, cal);
      if (held > 0) {
        var hp = Math.min(held * 6, 36);
        score += hp;
        reasons.push({ kind: 'held', points: hp,
          text: 'Waiting on a decision for ' + held + ' working day(s)' });
      }
    }
  }

  var blockers = openBlockers(task, allTasks || []);
  return {
    id: task.id, score: Math.round(score), reasons: reasons,
    blocked: blockers.length > 0,
    blockedBy: blockers.map(function (b) { return { id: b.id, title: b.title }; }),
    dependents: dependents.length,
  };
}

/* HORIZONS — the same list, asked over a different stretch of time.
   "What do I do today" and "what has to land this quarter" are different
   questions with different answers, and a single flat list answers neither
   well. The windows are cumulative: this week contains today, this month
   contains this week. Anything overdue appears in every one of them, because
   work that is already late does not become less late when you widen the
   lens. */
var HORIZONS = [
  { key: 'day',     label: 'Today' },
  { key: 'week',    label: 'This week' },
  { key: 'month',   label: 'This month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'year',    label: 'This year' },
  { key: 'all',     label: 'Everything' },
];

/** The last date a task may be due on and still count as inside this horizon. */
function horizonEnd(kind, today) {
  var d = startOfDay(today || new Date());
  switch (kind) {
    case 'day':   return d;
    case 'week': {
      /* Monday to Sunday — a factory week, not a calendar library's week. On a
         Saturday or Sunday the week left is the weekend itself, so "this week"
         means the working week ahead; otherwise Monday's work vanishes from
         the list exactly when someone sits down to plan it. */
      var dow = d.getDay(), toSunday = dow === 0 ? 0 : 7 - dow;
      if (dow === 0 || dow === 6) toSunday += 7;
      return addDays(d, toSunday);
    }
    case 'month':   return new Date(d.getFullYear(), d.getMonth() + 1, 0);
    case 'quarter': return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 0);
    case 'year':    return new Date(d.getFullYear(), 11, 31);
    default:        return null;              // 'all' — no end
  }
}

function inHorizon(task, kind, today) {
  if (kind === 'all' || !kind) return true;
  var due = parseYmd(task.due);
  if (!due) return false;                     // no date, no horizon to be in
  var now = startOfDay(today || new Date());
  if (due < now) return true;                 // overdue surfaces everywhere
  var end = horizonEnd(kind, today);
  return !end || due <= end;
}

/**
 * The whole queue, ranked and banded, over one horizon.
 *
 * Blocked work is pulled out rather than ranked among the rest: however urgent
 * it is, nobody can act on it, and leaving it at the top of a to-do list is how
 * the list stops being read.
 */
function priorityQueue(tasks, username, today, cal, opts) {
  opts = opts || {};
  var horizon = opts.horizon || 'all';
  var all = tasks || [];
  var mine = all.filter(function (t) {
    if (!isOpen(t.status) || t.isArchived) return false;
    if (t.status === STATUS.AWAITING_APPROVAL || t.status === STATUS.DELEGATION_PROPOSED) return false;
    return !username || t.assignee === username;
  });

  /* Decisions this person owes other people. Their own board does not show
     these as theirs, but the scoring charges them for sitting on them — so a
     list that left them out would be telling somebody to do one thing while
     marking them down for another. */
  var decisions = username ? all.filter(function (t) {
    if (!isOpen(t.status) || t.isArchived) return false;
    if (t.assignee === username) return false;
    if (t.status === STATUS.FOR_REVIEW) return (t.approver || t.raisedBy) === username;
    if (t.status === STATUS.AWAITING_APPROVAL || t.status === STATUS.DELEGATION_PROPOSED) {
      return t.approver === username;
    }
    return false;
  }) : [];

  var rank = function (list) {
    return list.map(function (t) {
      var u = taskUrgency(t, all, today, cal);
      return {
        id: t.id, title: t.title, due: t.due, priority: t.priority, status: t.status,
        assignee: t.assignee, projectName: t.projectName || '', stageNo: Number(t.stageNo) || 0,
        score: u.score, reasons: u.reasons, blocked: u.blocked, blockedBy: u.blockedBy,
        dependents: u.dependents, kind: u.kind || 'task',
      };
    }).sort(function (a, b) {
      return b.score - a.score ||
             priorityRank(a.priority) - priorityRank(b.priority) ||
             String(a.due || '9999').localeCompare(String(b.due || '9999'));
    });
  };

  var rows = rank(mine.filter(function (t) { return inHorizon(t, horizon, today); }));

  /* Work already handed in is not this person's to do. It is with whoever has
     to sign it off, and ranking it among their own jobs would have them chasing
     something they finished last week. */
  var handedIn = rows.filter(function (r) { return r.status === STATUS.FOR_REVIEW; });
  rows = rows.filter(function (r) { return r.status !== STATUS.FOR_REVIEW; });

  var actionable = rows.filter(function (r) { return !r.blocked; });
  var waiting = rows.filter(function (r) { return r.blocked; });

  /* How much sits in each window, so the horizon buttons can carry a number
     and nobody has to click through five of them to find the busy one. */
  var counts = {};
  HORIZONS.forEach(function (h) {
    counts[h.key] = mine.filter(function (t) { return inHorizon(t, h.key, today); }).length;
  });

  /* Bands rather than a bare ranked list: "do these three today" is an
     instruction, where "here are 40 tasks in order" is still a decision. */
  var now = Math.max(1, Number(opts.doNow) || 3);
  return {
    horizon: horizon,
    decisions: rank(decisions).map(function (r) {
      r.kind = r.status === STATUS.FOR_REVIEW ? 'review' : 'approval';
      return r;
    }),
    handedIn: handedIn,
    horizonEnd: horizonEnd(horizon, today) ? ymd(horizonEnd(horizon, today)) : '',
    doNow: actionable.slice(0, now),
    next: actionable.slice(now, now + 5),
    later: actionable.slice(now + 5),
    waiting: waiting,
    counts: counts,
    total: rows.length,
    overdue: actionable.filter(function (r) {
      return r.reasons.some(function (x) { return x.kind === 'overdue'; }); }).length,
    undated: mine.filter(function (t) { return !parseYmd(t.due); }).length,
  };
}

// ---------------------------------------------------------------------------
// PROJECTS — multi-stage work with a deadline on every stage
// ---------------------------------------------------------------------------
/* A project is a run of stages that share a Project ID. Each stage is an
   ordinary task — same board, same approvals, same review — carrying its own
   deadline and its own owner. Stage 2 is blocked by stage 1 through the
   blocker mechanism that already exists, so nothing new had to be invented to
   stop somebody starting out of order.

   A stage deadline is a promise to the people downstream, not only to the
   manager, which is why meeting one is scored in its own right. */
var MILESTONE_WEIGHTS = { onTime: 0.35, quality: 0.25, queue: 0.20, milestones: 0.20 };

/** Every stage of one project, in order. */
function projectStages(tasks, projectId) {
  return (tasks || [])
    .filter(function (t) { return t.projectId && t.projectId === projectId; })
    .sort(function (a, b) { return (Number(a.stageNo) || 0) - (Number(b.stageNo) || 0); });
}

/** The stage immediately before this one, or null for the first. */
function previousStage(stages, stage) {
  var n = Number(stage.stageNo) || 0;
  var best = null;
  stages.forEach(function (s) {
    var m = Number(s.stageNo) || 0;
    if (m < n && (!best || m > (Number(best.stageNo) || 0))) best = s;
  });
  return best;
}

/**
 * When this stage actually became startable.
 *
 * On a sequential project that is when the stage before it was signed off; on
 * a parallel one, or the first stage, it is the moment the project was raised.
 */
function stageReleasedAt(stages, stage) {
  if (String(stage.stageGate || 'sequential') === 'parallel') return null;
  var prev = previousStage(stages, stage);
  if (!prev) return null;
  return closedAt(prev);
}

/**
 * The deadline this stage's owner is actually answerable for.
 *
 * If the stage before it ran over, the work could not start on time however
 * willing the owner was. Charging them the original date would push one
 * person's slip onto everyone downstream — the surest way to make a team stop
 * reporting slippage at all.
 *
 * So a stage released after its own deadline gets back the window the plan gave
 * it: the gap between its date and the date of the stage before it, counted
 * from the day it was actually released. They promised that many days of work,
 * they get that many days — no more, so a late start is not a blank cheque.
 */
function stageEffectiveDue(stages, stage) {
  var due = parseYmd(stage.due);
  var released = stageReleasedAt(stages, stage);
  if (!due) return released ? startOfDay(released) : null;
  if (!released || startOfDay(released) <= due) return due;

  var prev = previousStage(stages, stage);
  var prevDue = prev ? parseYmd(prev.due) : null;
  var planned = prevDue ? Math.max(0, dayDiff(due, prevDue)) : 0;
  return addDays(startOfDay(released), planned);
}

/**
 * How well this person keeps the stage deadlines they were given.
 *
 * Deliberately scored in its own right, and NOT folded into on-time delivery:
 * a stage date is a commitment other people have planned around, so hitting it
 * is worth more than hitting a date only the manager was watching. Both the
 * hits and the misses are itemised, because a score that shows a person only
 * their failures is one they will read as a punishment ledger.
 */
function milestoneStats(tasks, username, today, cal) {
  var now = today || new Date();
  var mine = (tasks || []).filter(function (t) {
    return t.assignee === username && t.projectId && Number(t.stageNo) > 0;
  });

  var byProject = {};
  (tasks || []).forEach(function (t) {
    if (!t.projectId) return;
    (byProject[t.projectId] = byProject[t.projectId] || []).push(t);
  });
  Object.keys(byProject).forEach(function (k) {
    byProject[k].sort(function (a, b) { return (Number(a.stageNo) || 0) - (Number(b.stageNo) || 0); });
  });

  var met = 0, missed = 0, pending = 0, atRisk = 0, wSum = 0, wTotal = 0;
  var breakdown = [], items = [];

  mine.forEach(function (t) {
    var stages = byProject[t.projectId] || [t];
    var due = stageEffectiveDue(stages, t);
    var extended = due && parseYmd(t.due) && startOfDay(due) > parseYmd(t.due);
    var w = priorityWeight(t.priority);
    var label = t.projectName ? t.projectName + ' · stage ' + t.stageNo : 'Stage ' + t.stageNo;

    if (t.status === STATUS.VERIFIED) {
      var sub = submittedAt(t);
      if (!sub || !due) return;
      var late = chargeableLateDays(due, sub, username, cal);
      var hit = late <= 0;
      wTotal += w; wSum += (hit ? 100 : Math.max(0, 100 - late * LATENESS_POINTS_PER_DAY)) * w;
      if (hit) met++; else missed++;
      items.push({ id: t.id, title: t.title, project: t.projectName, stage: Number(t.stageNo),
                   met: hit, daysLate: Math.max(0, late), extended: !!extended });
      breakdown.push({
        group: 'Project Milestones', item: label + ' — ' + t.title,
        reason: hit ? 'Stage deadline met' + (extended ? ' (deadline moved out: the stage before it ran over)' : '')
                    : 'Stage deadline missed by ' + late + ' day(s)' +
                      (extended ? ', counted from the day it was actually released' : ''),
        impact: hit ? '+' + w * 10 : '-' + Math.min(100, late * LATENESS_POINTS_PER_DAY),
      });
      return;
    }

    if (isOpen(t.status) && due) {
      pending++;
      if (chargeableLateDays(due, now, username, cal) > 0) atRisk++;
    }
  });

  var closedCount = met + missed;
  return {
    hasData: closedCount > 0,
    stages: mine.length,
    met: met, missed: missed, pending: pending, atRisk: atRisk,
    hitRate: closedCount ? Math.round(met / closedCount * 100) : null,
    score: wTotal ? Math.round(wSum / wTotal) : null,
    items: items,
    breakdown: breakdown,
  };
}

/** A whole project's state, for the board and the project list. */
function projectSummary(tasks, projectId) {
  var stages = projectStages(tasks, projectId);
  if (!stages.length) return null;
  var done = stages.filter(function (s) { return s.status === STATUS.VERIFIED; });
  var dead = stages.filter(function (s) { return s.status === STATUS.REJECTED || s.status === STATUS.CANCELLED; });
  var current = null;
  for (var i = 0; i < stages.length; i++) {
    if (isOpen(stages[i].status)) { current = stages[i]; break; }
  }
  var metOnTime = 0;
  done.forEach(function (s) {
    var sub = submittedAt(s), due = stageEffectiveDue(stages, s);
    if (sub && due && dayDiff(sub, due) <= 0) metOnTime++;
  });
  var last = stages[stages.length - 1];
  return {
    projectId: projectId,
    name: stages[0].projectName || 'Project',
    gate: String(stages[0].stageGate || 'sequential'),
    stages: stages.length,
    done: done.length,
    metOnTime: metOnTime,
    percent: Math.round(done.length / stages.length * 100),
    currentStage: current ? Number(current.stageNo) : null,
    currentTitle: current ? current.title : null,
    currentOwner: current ? current.assignee : null,
    currentDue: current ? current.due : null,
    finalDue: last ? last.due : '',
    complete: done.length === stages.length,
    stalled: dead.length > 0,
  };
}

// ---------------------------------------------------------------------------
// PERFORMANCE — the Delegation Score
// ---------------------------------------------------------------------------
var SCORE_WEIGHTS = { onTime: 0.45, quality: 0.30, queue: 0.25 };
var LATENESS_POINTS_PER_DAY = 10;   // a day late costs 10 on that task
var REWORK_POINTS_EACH = 25;        // each rework loop costs 25

/* ---------------------------------------------------------------------------
   WORKLOAD CREDIT — what stops one easy task outscoring ten hard ones.

   Every component above is a RATE: a percentage of the work you took on. On
   its own a rate is blind to how much work that was, so somebody who closed a
   single trivial task on time scored 100, while somebody who carried ten and
   delivered seven of them on time scored 70. The system was quietly telling
   the hardest workers in the company that they were the worst performers.

   So the rate is credited against the load actually carried. Nobody is handed
   a score for turning up: you start at zero and earn it by delivering, and
   because the credit can never exceed 1 the score can never exceed 100.

       score = how well you delivered  ×  how much you delivered

   Load is counted in the same priority weights the rest of the engine uses —
   a High task is worth three Lows — plus the approvals and reviews you cleared
   for other people, because that is work too and a manager who spends the
   month unblocking their team is not idle.

   The expectation is per person, taken from their WIP limit, so a part-time or
   deliberately low-volume role is measured against its own bar and not against
   the busiest desk in the building.
--------------------------------------------------------------------------- */
var EXPECTED_MONTHLY_TASKS = 5;     // the default WIP limit, in tasks
var DECISION_EFFORT = 1;            // an approval or review cleared, in load units

/**
 * How much of the expected load this person actually carried, 0..1.
 * Capped at 1: carrying double does not make a score of 200, it makes a
 * complete one.
 */
function workloadCredit(deliveredWeight, expectedTasks) {
  var expected = Math.max(1, Number(expectedTasks) || EXPECTED_MONTHLY_TASKS) *
                 priorityWeight('Medium');
  var credit = deliveredWeight / expected;
  return { delivered: Math.round(deliveredWeight * 10) / 10, expected: expected,
           credit: Math.max(0, Math.min(1, credit)),
           percent: Math.round(Math.max(0, Math.min(1, credit)) * 100),
           full: credit >= 1 };
}

/* COOKIE POINTS — recognition a manager can give on the day, not six months
   later at the appraisal. Each one is signed and carries a reason, because an
   anonymous bonus with no stated cause is indistinguishable from favouritism.
   The score effect is capped: cookies are a thank-you, not a back door to a
   score nobody earned on the work. */
var COOKIE_MAX_PER_AWARD = 5;
var MAX_COOKIE_BONUS = 10;          // the most cookies can move a score

function cookieBonus(cookies) {
  var total = (cookies || []).reduce(function (s, c) {
    return s + Math.max(0, Math.min(COOKIE_MAX_PER_AWARD, Number(c.points) || 0)); }, 0);
  return { awarded: total, bonus: Math.min(total, MAX_COOKIE_BONUS),
           capped: total > MAX_COOKIE_BONUS, count: (cookies || []).length };
}
/* RESPONSIVENESS — the manager's half of accountability.
   A doer is measured on delivering. The person who has to approve or sign off
   is measured on not sitting on it. Without this the score is one-sided: a team
   can be marked down for lateness that their manager caused, which is the
   fastest way for a workforce to stop believing the numbers.
   Measured in WORKING days from when the item landed on their desk — not from
   the task's deadline, so work submitted early that then waits a fortnight is
   counted properly. */
var REVIEW_SLA_DAYS = 2;                  // working days to review or approve
var RESPONSIVENESS_PENALTY_PER_DAY = 2;   // points lost per working day beyond the SLA
var MAX_RESPONSIVENESS_PENALTY_PER_ITEM = 10;
var MAX_RESPONSIVENESS_PENALTY = 20;      // no single oversight can destroy a score
var MAX_MANAGER_DEDUCTION = MAX_RESPONSIVENESS_PENALTY;   // old names, still referenced
var MAX_MANAGER_DEDUCTION_PER_TASK = MAX_RESPONSIVENESS_PENALTY_PER_ITEM;

// ---------------------------------------------------------------------------
// WORKING CALENDAR — holidays and approved leave
// A person on sanctioned leave still accrued overdue days, so a fortnight off
// wrecked their score and the first appraisal that used it became an argument
// nobody could win. When a calendar is supplied, lateness is counted in
// chargeable days only: weekends, company holidays and that person's approved
// leave are skipped. With no calendar every function below is a no-op and
// scoring is exactly what it was.
// ---------------------------------------------------------------------------
var DEFAULT_WEEKEND = [0, 6];   // Sunday, Saturday

/**
 * cal = {
 *   weekend:  [0,6],
 *   holidays: ['2026-01-26', '2026-08-15'],
 *   leave:    { 'asha@x.in': [{ from:'2026-09-01', to:'2026-09-07' }] }
 * }
 */
function isNonWorkingDay(date, username, cal) {
  if (!cal) return false;
  var d = startOfDay(date);
  var weekend = cal.weekend || DEFAULT_WEEKEND;
  if (weekend.indexOf(d.getDay()) > -1) return true;
  if ((cal.holidays || []).indexOf(ymd(d)) > -1) return true;
  var spans = (cal.leave || {})[username] || [];
  for (var i = 0; i < spans.length; i++) {
    var from = parseYmd(spans[i].from), to = parseYmd(spans[i].to || spans[i].from);
    if (from && to && d >= from && d <= to) return true;
  }
  return false;
}

/**
 * Days late that the person is answerable for. Negative or zero means on time,
 * and is returned unchanged so "delivered three days early" still reads as three
 * days early. Only lateness is discounted.
 */
function chargeableLateDays(due, actual, username, cal) {
  var raw = dayDiff(actual, due);
  if (!cal || raw <= 0) return raw;
  var n = 0, cursor = addDays(parseYmd(ymd(due)), 1), end = startOfDay(actual);
  var guard = 0;
  while (cursor <= end && guard++ < 3660) {
    if (!isNonWorkingDay(cursor, username, cal)) n++;
    cursor = addDays(cursor, 1);
  }
  return n;
}

function timelinessPoints(daysLate) {
  if (daysLate <= 0) return 100;
  return Math.max(0, 100 - daysLate * LATENESS_POINTS_PER_DAY);
}

/**
 * When did the holder actually hand the work in? The last time it entered
 * "For Review" — NOT when it was verified. Scoring the verification date would
 * punish an employee for their manager's slow review, which is the single most
 * common way an automated performance metric loses the room's trust.
 */
function submittedAt(task) {
  var history = task.history || [];
  for (var i = history.length - 1; i >= 0; i--) {
    if (history[i].status === STATUS.FOR_REVIEW) return new Date(history[i].date);
  }
  for (var j = history.length - 1; j >= 0; j--) {
    if (history[j].status === STATUS.VERIFIED) return new Date(history[j].date);
  }
  return null;
}

/**
 * A weighted composite out of 100, with the arithmetic exposed so it can be
 * defended in a review meeting:
 *
 *   On-Time Delivery  45%  of what you closed, how much landed by its deadline
 *   First-Pass Quality 30%  did it come back for rework
 *   Queue Health      25%  of what is still open, how much is overdue
 *
 * then a capped deduction for reviews and approvals left sitting.
 *
 * Components with no data are dropped and the remaining weights renormalised,
 * so a new joiner is measured on what exists rather than handed a fake 100 or
 * an unearned 0. With nothing at all, hasData is false and the caller should
 * say "not enough data" rather than print a number.
 */
/**
 * Every spell an item spent waiting on somebody's decision.
 *
 * Reading it out of the history rather than the current status is what lets a
 * manager be measured on work they have ALREADY actioned — otherwise the only
 * thing visible is what is stuck right now, and someone who clears their queue
 * the day before review looks identical to someone who never let it pile up.
 */
function queueSpells(task) {
  var h = (task.history || []).slice().filter(function (e) { return e && e.date; });
  var out = [];
  var WAITING = {};
  WAITING[STATUS.FOR_REVIEW] = 'review';
  WAITING[STATUS.AWAITING_APPROVAL] = 'approval';
  WAITING[STATUS.DELEGATION_PROPOSED] = 'approval';

  for (var i = 0; i < h.length; i++) {
    var kind = WAITING[h[i].status];
    if (!kind) continue;
    var from = new Date(h[i].date);
    if (isNaN(from)) continue;
    var to = null;
    for (var j = i + 1; j < h.length; j++) {
      var d = new Date(h[j].date);
      if (!isNaN(d)) { to = d; break; }
    }
    out.push({ kind: kind, from: from, to: to,
      holder: kind === 'review' ? (task.approver || task.raisedBy) : task.approver,
      open: to === null });
  }

  /* A task sitting in a waiting state with no history entry for it still counts:
     the clock is running even if nobody wrote it down. */
  var nowKind = WAITING[task.status];
  if (nowKind && !out.some(function (s) { return s.open; })) {
    var started = h.length ? new Date(h[h.length - 1].date) : parseYmd(task.due);
    if (started && !isNaN(started)) {
      out.push({ kind: nowKind, from: started, to: null, open: true,
        holder: nowKind === 'review' ? (task.approver || task.raisedBy) : task.approver });
    }
  }
  return out;
}

/**
 * How promptly this person clears what lands on their desk.
 *
 * Returns a 0-100 responsiveness figure and the penalty it costs them, with the
 * working it out attached — every item, how long it was held, and what that
 * cost. A number a manager cannot see the derivation of is a number they will
 * dispute, and they will be right to.
 */
function responsivenessStats(tasks, username, today, cal, opts) {
  opts = opts || {};
  var sla = opts.slaDays == null ? REVIEW_SLA_DAYS : Number(opts.slaDays);
  var now = today || new Date();
  var items = [], breakdown = [], penalty = 0;

  (tasks || []).forEach(function (t) {
    queueSpells(t).forEach(function (sp) {
      if (sp.holder !== username) return;
      var end = sp.to || now;
      if (startOfDay(end) < startOfDay(sp.from)) return;   // clock skew, ignore

      // Working days only, and never charged for their own approved leave.
      var held = chargeableLateDays(sp.from, end, username, cal);
      if (held < 0) held = 0;
      var over = Math.max(0, held - sla);
      var cost = Math.min(over * RESPONSIVENESS_PENALTY_PER_DAY,
                          MAX_RESPONSIVENESS_PENALTY_PER_ITEM);

      items.push({ id: t.id, title: t.title, kind: sp.kind, heldDays: held,
                   overSla: over, open: sp.open, cost: cost });
      if (cost > 0) {
        penalty += cost;
        breakdown.push({
          group: 'Review Responsiveness', item: t.title,
          reason: (sp.open ? 'Still waiting on you to ' : 'Took ') +
                  (sp.open ? (sp.kind === 'review' ? 'review' : 'approve') +
                             ' after ' + held + ' working day(s)'
                           : held + ' working day(s) to ' + (sp.kind === 'review' ? 'review' : 'approve')) +
                  ' (' + sla + ' expected)',
          impact: '-' + cost,
        });
      }
    });
  });

  penalty = Math.min(penalty, MAX_RESPONSIVENESS_PENALTY);
  var withinSla = items.filter(function (i) { return i.overSla === 0; }).length;
  var pending = items.filter(function (i) { return i.open; });

  return {
    hasData: items.length > 0,
    items: items.length,
    withinSla: withinSla,
    pending: pending.length,
    overdueNow: pending.filter(function (i) { return i.overSla > 0; }).length,
    avgHeldDays: items.length
      ? Math.round(items.reduce(function (s, i) { return s + i.heldDays; }, 0) / items.length * 10) / 10 : null,
    responsiveness: items.length ? Math.round(withinSla / items.length * 100) : null,
    penalty: penalty,
    slaDays: sla,
    breakdown: breakdown,
  };
}

function delegationScore(tasks, username, today, cal, opts) {
  today = today || new Date();
  opts = opts || {};
  var mine = tasks.filter(function (t) { return t.assignee === username; });
  var breakdown = [];

  var closed = mine.filter(function (t) { return t.status === STATUS.VERIFIED; });
  // Queue health counts only work the holder can actually act on. Something
  // sitting in For Review has already been handed in, and something Awaiting
  // Approval has not been accepted yet — counting either against them would
  // penalise a person for their manager's delay, which is the same unfairness
  // the on-time component is careful to avoid.
  var open = mine.filter(function (t) {
    return t.status === STATUS.PENDING || t.status === STATUS.IN_PROGRESS;
  });

  // --- on-time delivery ---
  var otW = 0, otSum = 0, otCount = 0;
  closed.forEach(function (t) {
    var sub = submittedAt(t);
    if (!sub) return;
    var late = chargeableLateDays(parseYmd(t.due) || sub, sub, t.assignee, cal);
    var pts = timelinessPoints(late);
    var w = priorityWeight(t.priority);
    otSum += pts * w; otW += w; otCount++;
    breakdown.push({
      group: 'On-Time Delivery', item: t.title,
      reason: late <= 0 ? 'Delivered on time (' + t.priority + ')'
                        : 'Delivered ' + late + ' day(s) late (' + t.priority + ')',
      impact: pts + '/100',
    });
  });

  // --- first-pass quality ---
  var qW = 0, qSum = 0, reworkTotal = 0;
  closed.forEach(function (t) {
    var rw = Number(t.reworkCount || 0);
    reworkTotal += rw;
    var pts = Math.max(0, 100 - rw * REWORK_POINTS_EACH);
    var w = priorityWeight(t.priority);
    qSum += pts * w; qW += w;
    if (rw > 0) {
      breakdown.push({
        group: 'First-Pass Quality', item: t.title,
        reason: 'Returned for rework ' + rw + ' time(s)', impact: pts + '/100',
      });
    }
  });

  // --- queue health ---
  var qhW = 0, qhSum = 0, overdue = 0;
  open.forEach(function (t) {
    var due = parseYmd(t.due);
    var late = due ? chargeableLateDays(due, today, t.assignee, cal) : 0;
    var pts = timelinessPoints(late);
    var w = priorityWeight(t.priority);
    qhSum += pts * w; qhW += w;
    if (late > 0) {
      overdue++;
      breakdown.push({
        group: 'Queue Health', item: t.title,
        reason: 'Open and ' + late + ' day(s) overdue (' + t.priority + ')', impact: pts + '/100',
      });
    }
  });

  /* --- project milestones ---
     A stage deadline is a commitment other people have planned their own work
     around, so meeting one earns its own score rather than disappearing into
     the on-time average. It is weighted, not added on top, so nobody can lift
     their score simply by having their work cut into more pieces. */
  var ms = milestoneStats(tasks, username, today, cal);
  ms.breakdown.forEach(function (b) { breakdown.push(b); });
  var W = ms.hasData ? MILESTONE_WEIGHTS : SCORE_WEIGHTS;

  var parts = [
    { key: 'onTime',  label: 'On-Time Delivery',   score: otW ? otSum / otW : null,   weight: W.onTime,  basis: otCount + ' closed' },
    { key: 'quality', label: 'First-Pass Quality', score: qW ? qSum / qW : null,      weight: W.quality, basis: closed.length + ' closed' },
    { key: 'queue',   label: 'Queue Health',       score: qhW ? qhSum / qhW : null,   weight: W.queue,   basis: open.length + ' open' },
  ];
  if (ms.hasData) {
    parts.push({ key: 'milestones', label: 'Project Milestones', score: ms.score,
      weight: W.milestones,
      basis: ms.met + ' of ' + (ms.met + ms.missed) + ' stage deadlines met' });
  }
  var active = parts.filter(function (p) { return p.score !== null; });
  var totalWeight = active.reduce(function (s, p) { return s + p.weight; }, 0);
  var hasData = active.length > 0;
  var rate = hasData ? active.reduce(function (s, p) { return s + p.score * (p.weight / totalWeight); }, 0) : 0;

  /* --- responsiveness: separate, capped, never averaged into the delivery half ---
     Held time is measured from when the item landed on this person's desk, in
     working days, excluding their own approved leave. The old version keyed off
     the task's deadline, so work handed in early that then sat for a fortnight
     cost the reviewer nothing. */
  var resp = responsivenessStats(tasks, username, today, cal);
  var deduction = resp.penalty;
  resp.breakdown.forEach(function (b) { breakdown.push(b); });

  /* --- the load that rate was earned on ---
     Closed work in priority weights, plus the decisions cleared for other
     people, because unblocking your team is work and a score that ignores it
     tells managers not to bother. */
  var deliveredWeight = closed.reduce(function (n, t) { return n + priorityWeight(t.priority); }, 0) +
                        (resp.items - resp.pending) * DECISION_EFFORT +
                        /* Work in hand counts half. Somebody three weeks into a
                           large job has not delivered yet, but they are plainly
                           not idle, and a load figure that said otherwise would
                           be read as an accusation. */
                        open.reduce(function (n, t) { return n + priorityWeight(t.priority) / 2; }, 0);
  var load = workloadCredit(deliveredWeight, opts.expectedTasks);
  var composite = rate * load.credit;
  if (hasData) {
    breakdown.push({
      group: 'Workload Credit',
      item: closed.length + ' closed, ' + open.length + ' in hand, ' +
            (resp.items - resp.pending) + ' decision(s) cleared',
      reason: load.full
        ? 'A full load carried — the rates above count in full'
        : 'Carried ' + load.percent + '% of an expected load, so the rates above count ' +
          'for ' + load.percent + '% of their value',
      impact: load.percent + '%',
    });
  }

  /* --- cookie points: recognition, signed and capped --- */
  var cookies = cookieBonus(opts.cookies);
  cookies.list = (opts.cookies || []).slice();
  if (cookies.bonus > 0) {
    (opts.cookies || []).forEach(function (c) {
      breakdown.push({ group: 'Cookie Points', item: c.reason || 'Recognised',
        reason: 'Awarded by ' + (c.byName || c.by || 'a manager') +
                (c.date ? ' on ' + String(c.date).slice(0, 10) : ''),
        impact: '+' + Math.max(0, Math.min(COOKIE_MAX_PER_AWARD, Number(c.points) || 0)) });
    });
    if (cookies.capped) {
      breakdown.push({ group: 'Cookie Points', item: 'Capped',
        reason: cookies.awarded + ' points awarded; cookies can move a score by at most ' +
                MAX_COOKIE_BONUS,
        impact: '+' + cookies.bonus });
    }
  }

  /**
   * A manager may own no tasks at all and still be the reason four people are
   * stuck. Scoring them "no data" there is the one hole that would let the least
   * accountable person on the board look unmeasurable, so with no delivery
   * record but a queue of their own, the score becomes how promptly they clear
   * it.
   */
  if (!hasData && resp.hasData) {
    return {
      score: clampScore_(resp.responsiveness * load.credit + cookies.bonus),
      hasData: true,
      deduction: 0,
      workload: load,
      cookies: cookies,
      responsiveness: resp,
      milestones: ms,
      components: [{
        key: 'responsiveness', label: 'Review Responsiveness', score: resp.responsiveness,
        weight: 100,
        basis: resp.withinSla + ' of ' + resp.items + ' cleared within ' + resp.slaDays + ' days',
      }],
      summary: { closed: 0, open: 0, overdue: 0, reworkLoops: 0,
                 awaitingMe: resp.pending, heldOverSla: resp.overdueNow },
      breakdown: breakdown,
      note: 'No delivery record of their own — scored purely on how quickly they clear ' +
            'approvals and reviews.',
    };
  }

  return {
    /* Clamped at both ends, always: nobody starts above zero and nothing —
       cookie points included — takes anybody past 100. */
    score: hasData ? clampScore_(composite - deduction + cookies.bonus) : 0,
    rate: hasData ? Math.round(rate) : null,
    hasData: hasData,
    deduction: deduction,
    workload: load,
    cookies: cookies,
    /* A score earned on a sliver of work is a fact, not a verdict. Flagging it
       stops a light month being read as a bad one. */
    provisional: load.credit < 0.4,
    components: parts.map(function (p) {
      return {
        key: p.key, label: p.label,
        score: p.score === null ? null : Math.round(p.score),
        weight: Math.round((p.score === null ? 0 : p.weight / totalWeight) * 100),
        basis: p.basis,
      };
    }),
    responsiveness: resp,
    milestones: ms,
    summary: { closed: closed.length, open: open.length, overdue: overdue,
               reworkLoops: reworkTotal, awaitingMe: resp.pending, heldOverSla: resp.overdueNow,
               stagesMet: ms.met, stagesMissed: ms.missed, stagesPending: ms.pending,
               loadPercent: load.percent, cookiePoints: cookies.awarded },
    breakdown: breakdown,
    formula: 'Score = how well you delivered (' + Math.round(rate) + ') × the load you carried (' +
             load.percent + '%)' +
             (deduction ? ' − ' + deduction + ' for approvals held' : '') +
             (cookies.bonus ? ' + ' + cookies.bonus + ' cookie points' : ''),
  };
}

/** Nobody below zero, nobody above a hundred. Enforced in one place. */
function clampScore_(n) {
  var v = Math.round(Number(n) || 0);
  return Math.max(0, Math.min(100, v));
}

// ---------------------------------------------------------------------------
// APPRAISAL — KRA / KPI
// ---------------------------------------------------------------------------
/* How the 100 performance points are divided. Delegation is not in here: it is
   the other half of the final score, not a slice of this one. */
var APPRAISAL_SPLIT = { kra: 75, behaviour: 20 };     // the remaining 5 are brownie
var APPRAISAL_WEIGHTS = APPRAISAL_SPLIT;              // old name, still referenced
var MAX_BROWNIE = 5;

/** Ratings are 0-5 against a weight; 0 means "not rated" and is excluded. */
function weightedRating(items) {
  var totalWeight = 0, sum = 0;
  (items || []).forEach(function (i) {
    var rating = Number(i.rating || 0);
    var weight = Number(i.weight || 0);
    if (rating > 0 && weight > 0) { totalWeight += weight; sum += (rating / 5) * 100 * weight; }
  });
  return totalWeight ? sum / totalWeight : null;
}

function validateKraBlueprint(kras) {
  var rows = (kras || []).filter(function (k) { return k && String(k.item || k.name || '').trim(); });
  if (!rows.length) return { ok: false, error: 'Add at least one KRA.' };
  var total = rows.reduce(function (s, k) { return s + Number(k.weight || 0); }, 0);
  if (total > 100) return { ok: false, error: 'KRA weights total ' + total + '%. They cannot exceed 100%.' };
  return { ok: true, total: total, rows: rows, warning: total < 100 ? 'Weights total ' + total + '% — ' + (100 - total) + '% unallocated.' : '' };
}

/**
 * Blends measured execution with judgement:
 *   40% delegation score (from verified task history — cannot be talked up)
 *   40% KRA execution     (weighted, rated 0-5)
 *   20% behaviour         (weighted, rated 0-5)
 *   + up to 5 discretionary points
 * Any unrated half is dropped and the rest renormalised, so a half-finished
 * appraisal never silently reads as a low score.
 */
/**
 * THE ONE DEFINITION OF A FINAL SCORE.
 *
 *   Performance = KRA 75% + Behaviour 20% + Brownie (max 5)   → out of 100
 *   Delegation  = measured from the task record               → out of 100
 *   Final       = (Performance + Delegation) / 2
 *
 * Two halves, weighted equally: what you were judged on, and what the record
 * shows. There used to be two different formulas — a 40/40/20 blend here and a
 * flat average on the dashboard — so the number an employee saw was not the
 * number stored against them. An appraisal figure that cannot be reproduced on
 * demand is worse than no figure, because it will be challenged and you will
 * not be able to defend it.
 *
 * Someone with no closed work has no delegation half. Their final score is
 * their performance score rather than half of it — a new joiner is not a poor
 * performer.
 */
function finalAppraisalScore(input) {
  input = input || {};
  var kraPct = ratingPercent_(input.kras);                  // 0..100 or null
  var behPct = ratingPercent_(input.behaviours);
  var brownie = Math.max(0, Math.min(MAX_BROWNIE, Number(input.brownie || 0)));

  var kraPoints = kraPct === null ? null : (kraPct / 100) * APPRAISAL_SPLIT.kra;
  var behPoints = behPct === null ? null : (behPct / 100) * APPRAISAL_SPLIT.behaviour;

  var rated = (kraPoints !== null) || (behPoints !== null);
  var performance = rated
    ? Math.max(0, Math.min(100, (kraPoints || 0) + (behPoints || 0) + brownie))
    : null;

  var hasDelegation = input.hasDelegationData !== false &&
                      input.delegationScore !== null && input.delegationScore !== undefined;
  var delegation = hasDelegation
    ? Math.max(0, Math.min(100, Number(input.delegationScore) || 0)) : null;

  var halves = [];
  if (performance !== null) halves.push(performance);
  if (delegation !== null) halves.push(delegation);

  var score = halves.length
    ? Math.round(halves.reduce(function (a, b) { return a + b; }, 0) / halves.length) : 0;

  return {
    score: score,
    performance: performance === null ? null : Math.round(performance * 10) / 10,
    delegation: delegation === null ? null : Math.round(delegation),
    hasData: halves.length > 0,
    brownie: brownie,
    parts: {
      kra:       { percent: kraPct === null ? null : Math.round(kraPct),
                   points: kraPoints === null ? null : Math.round(kraPoints * 10) / 10,
                   outOf: APPRAISAL_SPLIT.kra },
      behaviour: { percent: behPct === null ? null : Math.round(behPct),
                   points: behPoints === null ? null : Math.round(behPoints * 10) / 10,
                   outOf: APPRAISAL_SPLIT.behaviour },
      brownie:   { points: brownie, outOf: MAX_BROWNIE },
    },
    formula: delegation === null
      ? 'No closed work to measure, so the final score is the performance score alone.'
      : 'Final = (Performance ' + Math.round(performance) + ' + Delegation ' + delegation + ') / 2',
  };
}

/** A weighted set of 0-5 ratings as a percentage, or null if nothing was rated. */
function ratingPercent_(rows) {
  var items = (rows || []).filter(function (r) {
    return r && Number(r.rating) > 0; });
  if (!items.length) return null;
  var got = 0, max = 0;
  items.forEach(function (r) {
    var w = Number(r.weight) || 1;
    got += (Number(r.rating) || 0) * w;
    max += 5 * w;
  });
  return max ? (got / max) * 100 : null;
}


/** A/B/C banding with the action each implies. */
function performanceBand(score) {
  if (score >= 85) return { band: 'A', label: 'Top performer', action: 'Recognise and retain — these are your flight risks.' };
  if (score >= 60) return { band: 'B', label: 'Solid, needs sharpening', action: 'Coach the specific pattern shown in the breakdown.' };
  return { band: 'C', label: 'Needs intervention', action: 'Documented basis for a performance conversation or role change.' };
}

// ---------------------------------------------------------------------------
// BOARD VIEW  (the Trello-style column layout, with accountability kept intact)
// ---------------------------------------------------------------------------
/**
 * Board columns. Deliberately NOT one column per status: "Awaiting Approval"
 * and "Delegation Proposed" both mean "blocked on a manager", so they share a
 * lane. That keeps the board readable while the underlying statuses stay
 * precise.
 */
var BOARD_COLUMNS = [
  { key: 'inbox',    title: 'Needs Approval', statuses: [STATUS.AWAITING_APPROVAL, STATUS.DELEGATION_PROPOSED], accent: 'amber' },
  { key: 'todo',     title: 'To Do',          statuses: [STATUS.PENDING],      accent: 'slate' },
  { key: 'doing',    title: 'In Progress',    statuses: [STATUS.IN_PROGRESS],  accent: 'blue' },
  { key: 'review',   title: 'For Review',     statuses: [STATUS.FOR_REVIEW],   accent: 'purple' },
  { key: 'done',     title: 'Verified',       statuses: [STATUS.VERIFIED],     accent: 'green' },
];

function columnForStatus(status) {
  for (var i = 0; i < BOARD_COLUMNS.length; i++) {
    if (BOARD_COLUMNS[i].statuses.indexOf(status) > -1) return BOARD_COLUMNS[i].key;
  }
  return null;
}

/** The status a card takes when dropped into a column. */
function statusForColumn(columnKey) {
  for (var i = 0; i < BOARD_COLUMNS.length; i++) {
    if (BOARD_COLUMNS[i].key === columnKey) return BOARD_COLUMNS[i].statuses[0];
  }
  return null;
}

/**
 * Can this person drag this card into that column?
 *
 * This is where Dome Box departs from Trello on purpose. On a Trello board
 * anyone can drag anything into Done, which is exactly why a Trello board can
 * never be the basis for a performance score. Here the drop is checked against
 * the same workflow rules as the API, plus dependency and subtask gates.
 */
function canDropInColumn(task, actor, columnKey, context) {
  context = context || {};
  var target = statusForColumn(columnKey);
  if (!target) return { ok: false, reason: 'Unknown column.' };
  if (columnForStatus(task.status) === columnKey) return { ok: true, noop: true };

  if (!canTransition(task, actor, target)) {
    if (target === STATUS.VERIFIED && task.assignee === actor.username) {
      return { ok: false, reason: 'You cannot sign off your own work — it needs the person who raised it.' };
    }
    return { ok: false, reason: 'Your role does not allow that move on this task.' };
  }

  if (target === STATUS.IN_PROGRESS) {
    var blockers = openBlockers(task, context.allTasks || []);
    if (blockers.length) {
      return { ok: false, reason: 'Blocked by: ' + blockers.map(function (b) { return b.title; }).join(', ') };
    }
    var wip = wipStatus(context.allTasks || [], task.assignee, context.wipLimit);
    if (wip.exceeded) {
      return { ok: false, reason: task.assignee + ' already has ' + wip.count + ' items in progress (limit ' + wip.limit + ').' };
    }
  }

  if (target === STATUS.FOR_REVIEW) {
    var sub = subtaskProgress(task);
    if (sub.total > 0 && sub.done < sub.total) {
      return { ok: false, reason: 'Finish the checklist first (' + sub.done + '/' + sub.total + ').' };
    }
  }

  return { ok: true };
}

function groupIntoBoard(tasks) {
  var board = {};
  BOARD_COLUMNS.forEach(function (c) { board[c.key] = []; });
  (tasks || []).forEach(function (t) {
    var col = columnForStatus(t.status);
    if (col) board[col].push(t);
  });
  return board;
}

// ---------------------------------------------------------------------------
// DEPENDENCIES
// ---------------------------------------------------------------------------
/** Blocking tasks that are not yet closed. */
function openBlockers(task, allTasks) {
  var ids = task.blockedBy || [];
  if (!ids.length) return [];
  var byId = {};
  (allTasks || []).forEach(function (t) { byId[t.id] = t; });
  var out = [];
  ids.forEach(function (id) {
    var b = byId[id];
    if (b && !isClosed(b.status)) out.push(b);
  });
  return out;
}

/**
 * Would adding `blockerId` -> `taskId` create a loop? Without this check a user
 * can build A blocks B blocks A, and every "can this start?" query afterwards
 * recurses forever.
 */
function wouldCycle(taskId, blockerId, allTasks) {
  if (taskId === blockerId) return true;
  var byId = {};
  (allTasks || []).forEach(function (t) { byId[t.id] = t; });

  // Walk up from the proposed blocker: if we reach taskId, the edge closes a loop.
  var stack = [blockerId];
  var seen = {};
  while (stack.length) {
    var cur = stack.pop();
    if (cur === taskId) return true;
    if (seen[cur]) continue;
    seen[cur] = true;
    var node = byId[cur];
    if (!node) continue;
    (node.blockedBy || []).forEach(function (up) { stack.push(up); });
  }
  return false;
}

function addDependency(taskId, blockerId, allTasks) {
  if (taskId === blockerId) return { ok: false, error: 'A task cannot block itself.' };
  var byId = {};
  (allTasks || []).forEach(function (t) { byId[t.id] = t; });
  if (!byId[taskId] || !byId[blockerId]) return { ok: false, error: 'Task not found.' };
  if ((byId[taskId].blockedBy || []).indexOf(blockerId) > -1) return { ok: false, error: 'Already blocked by that task.' };
  if (wouldCycle(taskId, blockerId, allTasks)) {
    return { ok: false, error: 'That would create a circular dependency.' };
  }
  return { ok: true, blockedBy: (byId[taskId].blockedBy || []).concat([blockerId]) };
}

// ---------------------------------------------------------------------------
// SUBTASKS / CHECKLIST
// ---------------------------------------------------------------------------
function subtaskProgress(task) {
  var items = task.subtasks || [];
  var done = items.filter(function (i) { return !!i.done; }).length;
  return { total: items.length, done: done, pct: items.length ? Math.round(done / items.length * 100) : 0 };
}

// ---------------------------------------------------------------------------
// WIP LIMIT — the one Kanban rule that actually changes behaviour: cap how much
// a person may have in progress at once, so "everything is started, nothing is
// finished" becomes visible instead of normal.
// ---------------------------------------------------------------------------
var DEFAULT_WIP_LIMIT = 5;

function wipStatus(allTasks, username, limit) {
  // 0 is a meaningful value here ("no limit"), so it must not fall through to
  // the default the way `limit || DEFAULT` would.
  var cap = (limit === undefined || limit === null || limit === '') ? DEFAULT_WIP_LIMIT : Number(limit);
  if (isNaN(cap) || cap < 0) cap = DEFAULT_WIP_LIMIT;
  var count = (allTasks || []).filter(function (t) {
    return t.assignee === username && t.status === STATUS.IN_PROGRESS;
  }).length;
  return { count: count, limit: cap, exceeded: cap > 0 && count >= cap, nearing: cap > 0 && count === cap - 1 };
}

// ---------------------------------------------------------------------------
// AUTOMATIONS — the Monday.com-style "when X then Y", evaluated server-side so
// a rule cannot be bypassed by a crafted request from the browser.
// ---------------------------------------------------------------------------
var TRIGGERS = {
  STATUS_CHANGED: 'status_changed',
  OVERDUE:        'became_overdue',
  CREATED:        'created',
  REWORKED:       'sent_for_rework',
  VERIFIED:       'verified',
};
var ACTIONS = {
  NOTIFY:        'notify',
  ESCALATE:      'escalate_to_manager',
  SET_PRIORITY:  'set_priority',
  ADD_LABEL:     'add_label',
  REASSIGN:      'reassign',
};

/**
 * Returns the actions a rule set produces for one event. Pure: it decides what
 * should happen, the caller performs it. That split is what makes automations
 * testable rather than a pile of side effects.
 *
 * rule = { on, if: {field, op, value}, then: {action, ...}, active }
 */
function evaluateAutomations(rules, event, task) {
  var out = [];
  (rules || []).forEach(function (rule) {
    if (rule.active === false) return;
    if (rule.on !== event.type) return;
    if (rule.if && !matchCondition(rule.if, task, event)) return;
    out.push(Object.assign({ ruleName: rule.name || rule.on }, rule.then));
  });
  return out;
}

function matchCondition(cond, task, event) {
  var actual = cond.field === 'toStatus' ? event.toStatus
             : cond.field === 'fromStatus' ? event.fromStatus
             : task[cond.field];
  var expected = cond.value;
  switch (cond.op || 'eq') {
    case 'eq':  return String(actual) === String(expected);
    case 'ne':  return String(actual) !== String(expected);
    case 'gte': return Number(actual) >= Number(expected);
    case 'lte': return Number(actual) <= Number(expected);
    case 'in':  return (expected || []).map(String).indexOf(String(actual)) > -1;
    case 'contains': return String(actual || '').toLowerCase().indexOf(String(expected).toLowerCase()) > -1;
    default: return false;
  }
}

/** Sensible defaults so a new workspace has useful automation on day one. */
function defaultAutomations() {
  return [
    { name: 'High-priority rework escalates', on: TRIGGERS.REWORKED,
      if: { field: 'priority', op: 'eq', value: 'High' },
      then: { action: ACTIONS.ESCALATE, to: 'assigneeManager' }, active: true },
    { name: 'Overdue 3 days escalates to manager', on: TRIGGERS.OVERDUE,
      if: { field: 'daysOverdue', op: 'gte', value: 3 },
      then: { action: ACTIONS.ESCALATE, to: 'assigneeManager' }, active: true },
    { name: 'Notify the raiser on hand-in', on: TRIGGERS.STATUS_CHANGED,
      if: { field: 'toStatus', op: 'eq', value: STATUS.FOR_REVIEW },
      then: { action: ACTIONS.NOTIFY, to: 'raisedBy' }, active: true },
    { name: 'Notify the owner when verified', on: TRIGGERS.VERIFIED,
      then: { action: ACTIONS.NOTIFY, to: 'assignee' }, active: true },
  ];
}

// ---------------------------------------------------------------------------
// REMINDER DIGEST — what one person needs to be told today. Pure, so the
// scheduler can be tested without sending a single email.
// ---------------------------------------------------------------------------
function buildDigest(tasks, user, today, opts) {
  opts = opts || {};
  today = today || new Date();
  var escalateAfter = Number(opts.escalateAfterDays || 3);

  // Only chase somebody about work the ball is actually with. Once it is in
  // For Review it is the reviewer's move (it shows up in THEIR digest under
  // "ready for your review"), and Awaiting Approval is the approver's move.
  // Reminding the person who already delivered is how a nagging system trains
  // people to ignore it.
  var mine = tasks.filter(function (t) {
    return t.assignee === user.username &&
      (t.status === STATUS.PENDING || t.status === STATUS.IN_PROGRESS);
  });
  var bucket = { overdue: [], dueToday: [], dueTomorrow: [], rework: [], awaitingMyReview: [], awaitingMyApproval: [], teamOverdue: [] };

  mine.forEach(function (t) {
    var due = parseYmd(t.due);
    var late = due ? dayDiff(today, due) : null;
    if (Number(t.reworkCount || 0) > 0 && t.status === STATUS.IN_PROGRESS) bucket.rework.push(t);
    if (late === null) return;
    if (late > 0) bucket.overdue.push(Object.assign({ daysOverdue: late }, t));
    else if (late === 0) bucket.dueToday.push(t);
    else if (late === -1) bucket.dueTomorrow.push(t);
  });

  tasks.forEach(function (t) {
    if (t.status === STATUS.FOR_REVIEW && t.raisedBy === user.username) bucket.awaitingMyReview.push(t);
    if ((t.status === STATUS.AWAITING_APPROVAL || t.status === STATUS.DELEGATION_PROPOSED) && t.approver === user.username) bucket.awaitingMyApproval.push(t);
  });

  // A manager also needs their team's badly overdue work, which is the point at
  // which chasing should stop being the manager's job and start being the system's.
  (opts.reports || []).forEach(function (reportUsername) {
    tasks.forEach(function (t) {
      if (t.assignee !== reportUsername || !isOpen(t.status)) return;
      var due = parseYmd(t.due);
      var late = due ? dayDiff(today, due) : 0;
      if (late >= escalateAfter) bucket.teamOverdue.push(Object.assign({ daysOverdue: late }, t));
    });
  });

  bucket.overdue.sort(function (a, b) { return b.daysOverdue - a.daysOverdue; });
  bucket.teamOverdue.sort(function (a, b) { return b.daysOverdue - a.daysOverdue; });

  var total = bucket.overdue.length + bucket.dueToday.length + bucket.dueTomorrow.length +
              bucket.awaitingMyReview.length + bucket.awaitingMyApproval.length + bucket.teamOverdue.length;
  return { user: user, buckets: bucket, total: total, isEmpty: total === 0 };
}

// ---------------------------------------------------------------------------
// PERIOD SCORING — weekly / monthly / quarterly / yearly
// ---------------------------------------------------------------------------
var PERIOD = { WEEK: 'week', MONTH: 'month', QUARTER: 'quarter', YEAR: 'year' };

function startOfWeek(d) {           // ISO week: Monday
  var x = startOfDay(d);
  var dow = (x.getDay() + 6) % 7;   // Mon=0 … Sun=6
  return addDays(x, -dow);
}
function isoWeekNumber(d) {
  var x = startOfDay(d);
  x.setDate(x.getDate() + 4 - ((x.getDay() + 6) % 7 + 1));  // nearest Thursday
  var yearStart = new Date(x.getFullYear(), 0, 1);
  return Math.ceil((((x - yearStart) / 86400000) + 1) / 7);
}

/**
 * The window for a period, `offset` back from today (0 = current).
 * Returns inclusive `from`/`to` day boundaries plus a short and long label.
 */
function periodRange(kind, offset, today) {
  offset = Number(offset || 0);
  var now = startOfDay(today || new Date());
  var from, to, label, short;
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  if (kind === PERIOD.WEEK) {
    from = addDays(startOfWeek(now), -7 * offset);
    to = addDays(from, 6);
    short = 'W' + isoWeekNumber(from);
    label = 'Week ' + isoWeekNumber(from) + ' · ' + MONTHS[from.getMonth()] + ' ' + from.getDate();
  } else if (kind === PERIOD.MONTH) {
    var m = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    from = m;
    to = new Date(m.getFullYear(), m.getMonth() + 1, 0);
    short = MONTHS[from.getMonth()];
    label = MONTHS[from.getMonth()] + ' ' + from.getFullYear();
  } else if (kind === PERIOD.QUARTER) {
    var qBase = new Date(now.getFullYear(), now.getMonth(), 1);
    var qIndex = Math.floor(qBase.getMonth() / 3) - offset;
    var qYear = qBase.getFullYear() + Math.floor(qIndex / 4);
    var qMonth = ((qIndex % 4) + 4) % 4 * 3;
    from = new Date(qYear, qMonth, 1);
    to = new Date(qYear, qMonth + 3, 0);
    short = 'Q' + (Math.floor(qMonth / 3) + 1);
    label = 'Q' + (Math.floor(qMonth / 3) + 1) + ' ' + qYear;
  } else {
    var y = now.getFullYear() - offset;
    from = new Date(y, 0, 1);
    to = new Date(y, 11, 31);
    short = String(y);
    label = String(y);
  }
  return { kind: kind, from: startOfDay(from), to: startOfDay(to), label: label, short: short, offset: offset };
}

/** When a task counts as delivered — the verification date. */
function closedAt(task) {
  var history = task.history || [];
  for (var i = history.length - 1; i >= 0; i--) {
    if (history[i].status === STATUS.VERIFIED) return new Date(history[i].date);
  }
  return null;
}

function inWindow(date, range) {
  if (!date) return false;
  var d = startOfDay(date);
  return d >= range.from && d <= range.to;
}

/**
 * Score for one person over one period.
 *
 * A task belongs to the period it was CLOSED in, so "your March score" means
 * the work you finished in March — not everything that happens to be open now.
 * Queue health is judged as at the end of the window, so a historic period is
 * measured on how the queue looked then rather than how it looks today.
 */
function scoreForPeriod(tasks, username, range, cal, opts) {
  var closedInWindow = tasks.filter(function (t) {
    return t.assignee === username && t.status === STATUS.VERIFIED && inWindow(closedAt(t), range);
  });

  // Work that was open at the end of the window: raised on or before it, and
  // either still open now or closed after the window ended.
  var openThen = tasks.filter(function (t) {
    if (t.assignee !== username) return false;
    var due = parseYmd(t.due);
    if (!due || due > range.to) return false;
    var closed = closedAt(t);
    if (closed && startOfDay(closed) <= range.to) return false;
    return t.status === STATUS.PENDING || t.status === STATUS.IN_PROGRESS || isClosed(t.status) === false;
  }).map(function (t) {
    return { assignee: t.assignee, status: STATUS.PENDING, title: t.title, due: t.due, priority: t.priority, reworkCount: t.reworkCount, history: [] };
  });

  /**
   * Work that is waiting on this person as approver or reviewer. delegationScore
   * reads it off the task list it is handed, so it has to survive the filtering
   * above — without it a manager who owns no tasks is handed an empty list and
   * scores "no data" every period, which is exactly the person the responsiveness
   * path exists to keep measurable.
   */
  var waitingOnThem = tasks.filter(function (t) {
    if (t.assignee === username) return false;
    /* Gated on when the item LANDED on their desk, not on the task's deadline.
       Keying it to the deadline hid every held review of work that was not due
       until next month — which is precisely the work it is easiest to sit on. */
    return queueSpells(t).some(function (sp) {
      return sp.holder === username && startOfDay(sp.from) <= range.to;
    });
  });

  var asOf = range.to > startOfDay(new Date()) ? new Date() : range.to;
  var result = delegationScore(closedInWindow.concat(openThen).concat(waitingOnThem),
                               username, asOf, cal, opts);
  result.range = { label: range.label, short: range.short, from: ymd(range.from), to: ymd(range.to) };
  result.delivered = closedInWindow.length;
  result.openThen = openThen.length;
  result.awaitingThem = waitingOnThem.length;

  /**
   * A period score has to be earned inside the period. Without this gate, someone
   * who closed nothing in the window still scores — purely on the queue health of
   * work carried in from earlier — so on day 1 of a month a person with two old
   * overdue tasks lands a 26 and gets banded "C · Needs action" for a month that
   * has barely started. That is a snapshot of their open queue, not a measure of
   * a period's performance, and it is the kind of number that loses an appraisal
   * conversation. Delivery in the window, or a review queue they were sitting on,
   * is the evidence; without either, the honest answer is "no data yet".
   */
  var responsivenessOnly = result.components.length === 1 && result.components[0].key === 'responsiveness';
  if (result.hasData && !responsivenessOnly && closedInWindow.length === 0) {
    result.hasData = false;
    result.score = 0;
    result.reason = openThen.length
      ? 'Nothing closed in this period — ' + openThen.length + ' item(s) still open. Carried-over work is not scored here.'
      : 'Nothing closed in this period.';
  }
  return result;
}

/** A trend of the last `count` periods, oldest first — ready to plot. */
function scoreTrend(tasks, username, kind, count, today, endOffset, cal, opts) {
  var end = Number(endOffset) || 0;
  var out = [];
  for (var i = count - 1 + end; i >= end; i--) {
    var range = periodRange(kind, i, today);
    var s = scoreForPeriod(tasks, username, range, cal, opts);
    out.push({
      label: range.label, short: range.short,
      score: s.hasData ? s.score : null,
      delivered: s.delivered,
      hasData: s.hasData,
      components: s.components,
    });
  }
  return out;
}

/**
 * Everything the analytics dashboard needs for one period, in one pass:
 * headline counts, per-person scores, KRA split and the A/B/C spread.
 */
function periodAnalytics(tasks, users, range, today, cal, optsFor) {
  var delivered = [], overdueNow = [], reworkLoops = 0, onTime = 0, onTimeBase = 0;

  tasks.forEach(function (t) {
    var closed = closedAt(t);
    if (t.status === STATUS.VERIFIED && inWindow(closed, range)) {
      delivered.push(t);
      reworkLoops += Number(t.reworkCount || 0);
      var sub = submittedAt(t), due = parseYmd(t.due);
      if (sub && due) { onTimeBase++; if (chargeableLateDays(due, sub, t.assignee, cal) <= 0) onTime++; }
    }
    var d = parseYmd(t.due);
    if (isOpen(t.status) && d && dayDiff(today || new Date(), d) > 0) overdueNow.push(t);
  });

  var people = users.map(function (u) {
    var s = scoreForPeriod(tasks, u.username, range, cal,
      optsFor ? optsFor(u) : null);
    return {
      username: u.username, name: u.name, role: u.role, dept: u.dept,
      score: s.hasData ? s.score : null, hasData: s.hasData,
      delivered: s.delivered, components: s.components,
      loadPercent: s.workload ? s.workload.percent : null,
      provisional: !!s.provisional,
      cookiePoints: s.cookies ? s.cookies.awarded : 0,
      band: s.hasData ? performanceBand(s.score).band : null,
      reason: s.hasData ? null : (s.reason || 'Nothing closed in this period.'),
    };
  });

  var kra = {};
  delivered.forEach(function (t) { var k = t.kra || 'Unassigned'; kra[k] = (kra[k] || 0) + 1; });
  var kraRows = Object.keys(kra).map(function (k) { return { kra: k, count: kra[k] }; })
    .sort(function (a, b) { return b.count - a.count; });

  var bands = { A: 0, B: 0, C: 0, none: 0 };
  people.forEach(function (p) { bands[p.band || 'none']++; });

  var scored = people.filter(function (p) { return p.hasData; });
  return {
    range: { label: range.label, short: range.short, from: ymd(range.from), to: ymd(range.to) },
    delivered: delivered.length,
    overdueNow: overdueNow.length,
    reworkLoops: reworkLoops,
    onTimeRate: onTimeBase ? Math.round(onTime / onTimeBase * 100) : null,
    teamScore: scored.length ? Math.round(scored.reduce(function (s, p) { return s + p.score; }, 0) / scored.length) : null,
    people: people,
    kra: kraRows,
    bands: bands,
  };
}

// ---------------------------------------------------------------------------
// THE LEADERBOARD
// ---------------------------------------------------------------------------
/* A ranking is a strong instrument. Used carelessly it measures who was handed
   the easiest work, and then publishes that as a judgement of character — so
   three rules are built into the ordering rather than left to whoever reads it.

   1. NOBODY IS RANKED ON NOTHING. A person with no closed work in the period
      is not "last", they are unranked, and they are listed separately with the
      reason. Ranking an absence is how a leaderboard ends up punishing someone
      who was on leave, or who had just joined.

   2. THE ORDER IS THE SCORE, AND THE SCORE ALREADY CARRIES LOAD. One easy task
      done perfectly cannot out-rank ten jobs with seven on time, because the
      score it ranks by is rate × load credit. A thin month is marked
      `provisional` so the number is read with the caution it deserves.

   3. TIES ARE TIES. Equal scores share a rank and the next rank is skipped,
      the way every sport does it — inventing a separation on a decimal nobody
      can see is how you get two people who did identical work told that one of
      them is better.

   Movement against last period is computed here too, because "up four places"
   is the part people act on; a static list is just a wall of names. */

/** `components` is a list of {key, score}, not a map — reading it as a map
 *  silently yields undefined for every row, which renders as a column of
 *  dashes that looks like missing data rather than a bug. */
function componentScore_(components, key) {
  var list = components || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].key === key) return list[i].score == null ? null : list[i].score;
  }
  return null;
}

function leaderboard(people, previousPeople) {
  var prevRank = {};
  (previousPeople || []).forEach(function (p) { if (p.rank) prevRank[p.username] = p.rank; });

  var ranked = (people || []).filter(function (p) { return p.hasData && p.score !== null; });
  var unranked = (people || []).filter(function (p) { return !p.hasData || p.score === null; })
    .map(function (p) {
      return { username: p.username, name: p.name, role: p.role, dept: p.dept,
               reason: p.reason || 'Nothing closed in this period.' };
    }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });

  ranked.sort(function (a, b) {
    /* Score first. Then volume delivered, because between two people on the
       same score the one who carried more work did more. Then the name, so the
       order is stable run to run rather than dependent on sheet order. */
    return (b.score - a.score) ||
           ((b.delivered || 0) - (a.delivered || 0)) ||
           ((b.cookiePoints || 0) - (a.cookiePoints || 0)) ||
           String(a.name).localeCompare(String(b.name));
  });

  /* Built with a loop rather than map(). The tie branch has to look at the row
     before it, and inside a map() callback the array being assigned does not
     exist yet — so `rows[i - 1]` threw, but only ever on a tie, which no test
     had produced until a demo workspace with two people on the same score did.
     A local carries the previous rank instead, and reads the same. */
  var rows = [], prevRank_ = 0;
  for (var i = 0; i < ranked.length; i++) {
    var p = ranked[i];
    var tie = i > 0 && ranked[i - 1].score === p.score &&
              (ranked[i - 1].delivered || 0) === (p.delivered || 0);
    rows.push({
      // Dense-at-the-top ranking: equal scores share a place, the next is skipped.
      rank: tie ? prevRank_ : i + 1,
      username: p.username, name: p.name, role: p.role, dept: p.dept,
      score: p.score, band: p.band, delivered: p.delivered || 0,
      loadPercent: p.loadPercent, provisional: !!p.provisional,
      cookiePoints: p.cookiePoints || 0,
      onTime: componentScore_(p.components, 'onTime'),
      /* Scored, but on other people's work rather than their own. Flagged
         rather than hidden: it is the honest reading of the row. */
      decisionsOnly: !(p.delivered || 0),
    });
    prevRank_ = rows[rows.length - 1].rank;
  }

  rows.forEach(function (r) {
    var was = prevRank[r.username];
    r.previousRank = was || null;
    r.movement = !was ? 'new' : (was > r.rank ? 'up' : was < r.rank ? 'down' : 'same');
    r.moved = was ? Math.abs(was - r.rank) : 0;
  });

  /* Employee of the month is not simply row one.
     A month thin enough to be provisional is not a month anybody should be
     crowned for — naming someone on a single easy task devalues the award for
     everyone who earned it properly.
     Neither is a month made entirely of decisions. The score counts cleared
     approvals as real load, and it should: a manager who turns work around the
     same day is doing the job. But an Admin who verifies everybody else's work
     and delivers nothing of their own would top this board every single month,
     and a leaderboard whose answer to "employee of the month" is "the person
     who clicks Verify" is discredited the first time it is published.
     So the crown needs delivered work behind it. The ranking itself is left
     alone — managers are measured on the same scale as everyone else, which is
     the whole point of counting decisions in the first place.
     If nobody qualifies, nobody is crowned. That is a more honest answer than
     a reluctant winner. */
  var champion = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].provisional || rows[i].decisionsOnly) continue;
    champion = rows[i];
    break;
  }

  var scores = rows.map(function (r) { return r.score; });
  return {
    rows: rows,
    unranked: unranked,
    champion: champion,
    /* True when the crown did not come from row one — somebody above them
       scored higher on approvals or on a month too thin to count. Said out
       loud by the UI, because a card that claims first place while the table
       underneath shows otherwise is the kind of small lie that costs a feature
       all of its credibility. */
    championBelowFirst: !!(champion && champion.rank !== rows[0].rank),
    shared: champion ? rows.filter(function (r) { return r.rank === champion.rank; }).length > 1 : false,
    counts: { ranked: rows.length, unranked: unranked.length },
    median: scores.length ? scores.slice().sort(function (a, b) { return a - b; })[Math.floor(scores.length / 2)] : null,
    top: scores.length ? scores[0] : null,
    bottom: scores.length ? scores[scores.length - 1] : null,
  };
}

// Export for the Node test harness; harmless inside Apps Script.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STATUS: STATUS, ROLE: ROLE, CADENCE: CADENCE, OPEN_STATUSES: OPEN_STATUSES,
    leaderboard: leaderboard,
    isOpen: isOpen, isClosed: isClosed, priorityWeight: priorityWeight,
    startOfDay: startOfDay, dayDiff: dayDiff, addDays: addDays, addMonths: addMonths,
    ymd: ymd, parseYmd: parseYmd,
    allowedTransitions: allowedTransitions, canTransition: canTransition,
    canAssignTo: canAssignTo,
    initialStatusFor: initialStatusFor, proposeDelegation: proposeDelegation,
    nextOccurrence: nextOccurrence, dueOccurrences: dueOccurrences,
    timelinessPoints: timelinessPoints, submittedAt: submittedAt, delegationScore: delegationScore,
    weightedRating: weightedRating, validateKraBlueprint: validateKraBlueprint,
    finalAppraisalScore: finalAppraisalScore, performanceBand: performanceBand,
    ratingPercent_: ratingPercent_, APPRAISAL_SPLIT: APPRAISAL_SPLIT,
    SCORE_WEIGHTS: SCORE_WEIGHTS, APPRAISAL_WEIGHTS: APPRAISAL_WEIGHTS,
    BOARD_COLUMNS: BOARD_COLUMNS, columnForStatus: columnForStatus, statusForColumn: statusForColumn,
    canDropInColumn: canDropInColumn, groupIntoBoard: groupIntoBoard,
    openBlockers: openBlockers, wouldCycle: wouldCycle, addDependency: addDependency,
    subtaskProgress: subtaskProgress, wipStatus: wipStatus, DEFAULT_WIP_LIMIT: DEFAULT_WIP_LIMIT,
    TRIGGERS: TRIGGERS, ACTIONS: ACTIONS, evaluateAutomations: evaluateAutomations,
    matchCondition: matchCondition, defaultAutomations: defaultAutomations,
    buildDigest: buildDigest,
    DEFAULT_WEEKEND: DEFAULT_WEEKEND, isNonWorkingDay: isNonWorkingDay,
    chargeableLateDays: chargeableLateDays,
    PERIOD: PERIOD, startOfWeek: startOfWeek, isoWeekNumber: isoWeekNumber,
    periodRange: periodRange, closedAt: closedAt, inWindow: inWindow,
    scoreForPeriod: scoreForPeriod, scoreTrend: scoreTrend, periodAnalytics: periodAnalytics,
  };
}
