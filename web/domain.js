/* AUTO-GENERATED from domebox/domain.gs — do not edit directly.
 * Regenerate with:  node web/_build/build-domain.js
 */
(function (global) {
  var module = { exports: {} };
  var exports = module.exports;

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
var PRIORITY_WEIGHT = { High: 3, Medium: 2, Low: 1 };

function priorityWeight(priority) {
  return PRIORITY_WEIGHT[priority] || PRIORITY_WEIGHT.Medium;
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
function initialStatusFor(assignee, raiser) {
  var needsApproval = !!assignee.manager &&
    assignee.manager !== raiser.username &&
    assignee.username !== raiser.username &&
    raiser.role !== ROLE.ADMIN;
  return {
    status: needsApproval ? STATUS.AWAITING_APPROVAL : STATUS.PENDING,
    approver: needsApproval ? assignee.manager : (raiser.username || ''),
    note: needsApproval ? 'Awaiting manager approval' : 'Task assigned',
  };
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
// PERFORMANCE — the Delegation Score
// ---------------------------------------------------------------------------
var SCORE_WEIGHTS = { onTime: 0.45, quality: 0.30, queue: 0.25 };
var LATENESS_POINTS_PER_DAY = 10;   // a day late costs 10 on that task
var REWORK_POINTS_EACH = 25;        // each rework loop costs 25
var MAX_MANAGER_DEDUCTION = 15;     // total cap
var MAX_MANAGER_DEDUCTION_PER_TASK = 10;

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
function delegationScore(tasks, username, today) {
  today = today || new Date();
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
    var late = dayDiff(sub, parseYmd(t.due) || sub);
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
    var late = due ? dayDiff(today, due) : 0;
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

  var parts = [
    { key: 'onTime',  label: 'On-Time Delivery',   score: otW ? otSum / otW : null,   weight: SCORE_WEIGHTS.onTime,  basis: otCount + ' closed' },
    { key: 'quality', label: 'First-Pass Quality', score: qW ? qSum / qW : null,      weight: SCORE_WEIGHTS.quality, basis: closed.length + ' closed' },
    { key: 'queue',   label: 'Queue Health',       score: qhW ? qhSum / qhW : null,   weight: SCORE_WEIGHTS.queue,   basis: open.length + ' open' },
  ];
  var active = parts.filter(function (p) { return p.score !== null; });
  var totalWeight = active.reduce(function (s, p) { return s + p.weight; }, 0);
  var hasData = active.length > 0;
  var composite = hasData ? active.reduce(function (s, p) { return s + p.score * (p.weight / totalWeight); }, 0) : 0;

  // --- responsiveness deduction: separate and capped, never averaged in ---
  var waitingOnMe = tasks.filter(function (t) {
    return (t.approver === username && (t.status === STATUS.AWAITING_APPROVAL || t.status === STATUS.DELEGATION_PROPOSED)) ||
           (t.raisedBy === username && t.status === STATUS.FOR_REVIEW);
  });
  var deduction = 0;
  waitingOnMe.forEach(function (t) {
    var due = parseYmd(t.due);
    var late = due ? dayDiff(today, due) : 0;
    if (late <= 0) return;
    var penalty = Math.min(late, MAX_MANAGER_DEDUCTION_PER_TASK);
    deduction += penalty;
    breakdown.push({
      group: 'Review Responsiveness', item: t.title,
      reason: late + ' day(s) waiting on you to ' + (t.status === STATUS.FOR_REVIEW ? 'review' : 'approve'),
      impact: '-' + penalty,
    });
  });
  deduction = Math.min(deduction, MAX_MANAGER_DEDUCTION);

  /**
   * A manager may own no tasks at all and still be the reason four people are
   * stuck. Scoring them "no data" in that situation is the one hole that would
   * let the least accountable person on the board look unmeasurable, so when
   * there is no delivery record but there IS a review queue, the score becomes
   * responsiveness: how promptly they clear what is waiting on them.
   */
  if (!hasData && waitingOnMe.length > 0) {
    var rW = 0, rSum = 0;
    waitingOnMe.forEach(function (t) {
      var due = parseYmd(t.due);
      var waited = due ? dayDiff(today, due) : 0;
      var w = priorityWeight(t.priority);
      rSum += timelinessPoints(waited) * w;
      rW += w;
    });
    var responsiveness = rW ? Math.round(rSum / rW) : 100;
    return {
      score: Math.max(0, Math.min(100, responsiveness)),
      hasData: true,
      deduction: 0,
      components: [{
        key: 'responsiveness', label: 'Review Responsiveness', score: responsiveness,
        weight: 100, basis: waitingOnMe.length + ' waiting on you',
      }],
      summary: { closed: 0, open: 0, overdue: 0, reworkLoops: 0, awaitingMe: waitingOnMe.length },
      breakdown: breakdown,
      note: 'No delivery record of their own — scored purely on how quickly they clear approvals and reviews.',
    };
  }

  return {
    score: hasData ? Math.max(0, Math.min(100, Math.round(composite - deduction))) : 0,
    hasData: hasData,
    deduction: deduction,
    components: parts.map(function (p) {
      return {
        key: p.key, label: p.label,
        score: p.score === null ? null : Math.round(p.score),
        weight: Math.round((p.score === null ? 0 : p.weight / totalWeight) * 100),
        basis: p.basis,
      };
    }),
    summary: { closed: closed.length, open: open.length, overdue: overdue, reworkLoops: reworkTotal },
    breakdown: breakdown,
  };
}

// ---------------------------------------------------------------------------
// APPRAISAL — KRA / KPI
// ---------------------------------------------------------------------------
var APPRAISAL_WEIGHTS = { delegation: 0.40, kra: 0.40, behaviour: 0.20 };
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
function finalAppraisalScore(input) {
  var kra = weightedRating(input.kras);
  var behaviour = weightedRating(input.behaviours);
  var delegation = input.hasDelegationData === false ? null : Number(input.delegationScore || 0);

  var parts = [
    { v: delegation, w: APPRAISAL_WEIGHTS.delegation, key: 'delegation' },
    { v: kra,        w: APPRAISAL_WEIGHTS.kra,        key: 'kra' },
    { v: behaviour,  w: APPRAISAL_WEIGHTS.behaviour,  key: 'behaviour' },
  ].filter(function (p) { return p.v !== null && !isNaN(p.v); });

  if (!parts.length) return { score: 0, hasData: false, components: {}, brownie: 0 };

  var tw = parts.reduce(function (s, p) { return s + p.w; }, 0);
  var blended = parts.reduce(function (s, p) { return s + p.v * (p.w / tw); }, 0);
  var brownie = Math.max(0, Math.min(MAX_BROWNIE, Number(input.brownie || 0)));

  return {
    score: Math.max(0, Math.min(100, Math.round(blended + brownie))),
    hasData: true,
    brownie: brownie,
    components: {
      delegation: delegation === null ? null : Math.round(delegation),
      kra: kra === null ? null : Math.round(kra),
      behaviour: behaviour === null ? null : Math.round(behaviour),
    },
    weightsUsed: parts.map(function (p) { return p.key + ':' + Math.round(p.w / tw * 100) + '%'; }).join(' '),
  };
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
function scoreForPeriod(tasks, username, range) {
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
    var due = parseYmd(t.due);
    if (due && due > range.to) return false;
    return (t.approver === username && (t.status === STATUS.AWAITING_APPROVAL || t.status === STATUS.DELEGATION_PROPOSED)) ||
           (t.raisedBy === username && t.status === STATUS.FOR_REVIEW);
  });

  var asOf = range.to > startOfDay(new Date()) ? new Date() : range.to;
  var result = delegationScore(closedInWindow.concat(openThen).concat(waitingOnThem), username, asOf);
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
function scoreTrend(tasks, username, kind, count, today, endOffset) {
  var end = Number(endOffset) || 0;
  var out = [];
  for (var i = count - 1 + end; i >= end; i--) {
    var range = periodRange(kind, i, today);
    var s = scoreForPeriod(tasks, username, range);
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
function periodAnalytics(tasks, users, range, today) {
  var delivered = [], overdueNow = [], reworkLoops = 0, onTime = 0, onTimeBase = 0;

  tasks.forEach(function (t) {
    var closed = closedAt(t);
    if (t.status === STATUS.VERIFIED && inWindow(closed, range)) {
      delivered.push(t);
      reworkLoops += Number(t.reworkCount || 0);
      var sub = submittedAt(t), due = parseYmd(t.due);
      if (sub && due) { onTimeBase++; if (dayDiff(sub, due) <= 0) onTime++; }
    }
    var d = parseYmd(t.due);
    if (isOpen(t.status) && d && dayDiff(today || new Date(), d) > 0) overdueNow.push(t);
  });

  var people = users.map(function (u) {
    var s = scoreForPeriod(tasks, u.username, range);
    return {
      username: u.username, name: u.name, role: u.role, dept: u.dept,
      score: s.hasData ? s.score : null, hasData: s.hasData,
      delivered: s.delivered, components: s.components,
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

// Export for the Node test harness; harmless inside Apps Script.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STATUS: STATUS, ROLE: ROLE, CADENCE: CADENCE, OPEN_STATUSES: OPEN_STATUSES,
    isOpen: isOpen, isClosed: isClosed, priorityWeight: priorityWeight,
    startOfDay: startOfDay, dayDiff: dayDiff, addDays: addDays, addMonths: addMonths,
    ymd: ymd, parseYmd: parseYmd,
    allowedTransitions: allowedTransitions, canTransition: canTransition,
    initialStatusFor: initialStatusFor, proposeDelegation: proposeDelegation,
    nextOccurrence: nextOccurrence, dueOccurrences: dueOccurrences,
    timelinessPoints: timelinessPoints, submittedAt: submittedAt, delegationScore: delegationScore,
    weightedRating: weightedRating, validateKraBlueprint: validateKraBlueprint,
    finalAppraisalScore: finalAppraisalScore, performanceBand: performanceBand,
    SCORE_WEIGHTS: SCORE_WEIGHTS, APPRAISAL_WEIGHTS: APPRAISAL_WEIGHTS,
    BOARD_COLUMNS: BOARD_COLUMNS, columnForStatus: columnForStatus, statusForColumn: statusForColumn,
    canDropInColumn: canDropInColumn, groupIntoBoard: groupIntoBoard,
    openBlockers: openBlockers, wouldCycle: wouldCycle, addDependency: addDependency,
    subtaskProgress: subtaskProgress, wipStatus: wipStatus, DEFAULT_WIP_LIMIT: DEFAULT_WIP_LIMIT,
    TRIGGERS: TRIGGERS, ACTIONS: ACTIONS, evaluateAutomations: evaluateAutomations,
    matchCondition: matchCondition, defaultAutomations: defaultAutomations,
    buildDigest: buildDigest,
    PERIOD: PERIOD, startOfWeek: startOfWeek, isoWeekNumber: isoWeekNumber,
    periodRange: periodRange, closedAt: closedAt, inWindow: inWindow,
    scoreForPeriod: scoreForPeriod, scoreTrend: scoreTrend, periodAnalytics: periodAnalytics,
  };
}


  global.DomeBox = module.exports;
})(typeof window !== 'undefined' ? window : this);
