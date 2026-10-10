/**
 * DOME BOX — SCHEDULER: REMINDERS + RECURRING JOB GENERATION
 * =============================================================================
 * Add as another file in the Apps Script project. Requires domain.gs.
 *
 * This is the piece that turns Dome Box from a place where work is recorded
 * into a system that does the chasing for you. Two time-driven jobs:
 *
 *   sendTaskReminders()     at 9 am, 3 pm and 5 pm: each person's OPEN tasks
 *                           (To do or In progress), most urgent first — on the
 *                           day a task is assigned, two days before it is due,
 *                           and every working day while it is overdue.
 *
 *   sendDailyReminders()    one morning digest for the people who owe others a
 *                           decision: what is waiting on them to approve or
 *                           review, and (for managers) their team's badly
 *                           overdue work. A person's own tasks are not in it any
 *                           more — they come from sendTaskReminders.
 *
 *   generateRecurringJobs() creates recurring occurrences from the schedule.
 *                           Critically, this runs whether or not anyone closed
 *                           the previous one. The original design only created
 *                           the next occurrence when someone verified the last,
 *                           so one forgotten task silently ended the series —
 *                           exactly when the reminder mattered most.
 *
 * SETUP
 *   1. Set REG.SHEET_ID below (your registry spreadsheet).
 *   2. Run previewDailyReminders() — sends nothing, logs exactly what would go out.
 *   3. Run installDomeBoxSchedules() once to create the daily triggers.
 *   4. Set DRY_RUN false when the preview looks right.
 *
 * EMAIL QUOTA — Apps Script allows 100 recipients/day on a consumer account and
 * 1,500 on Workspace. One digest per person per day is far cheaper than
 * per-event mail, but MAX_EMAILS_PER_RUN still hard-stops the run so a large
 * tenant cannot burn the whole quota and silence every other customer.
 * =============================================================================
 */

/* NAME SAFETY — every private helper below is prefixed `rm`.
 *
 * Apps Script puts every .gs file in ONE global scope, and the last definition
 * of a name wins. This file used to define its own esc_, which code.gs also
 * defines — and the two were not the same: this one did not escape the single
 * quote. Adding this file to the project would therefore have silently turned
 * off apostrophe escaping in every email the product sends, with nothing to
 * show for it until somebody put a quote in a task title. Prefixing is ugly
 * and it is the only thing that makes a second file safe to drop in.
 */
var REG = {
  SHEET_ID: '',        // registry spreadsheet id
  TAB: '',             // blank = auto-detect
};

var SCHED = {
  DRY_RUN: true,
  SEND_HOUR: 8,                 // local hour for the daily digest
  ESCALATE_AFTER_DAYS: 3,       // a report's task this overdue reaches their manager
  MAX_EMAILS_PER_RUN: 80,
  PAID_PLANS_ONLY: true,        // email alerts are a paid feature per the pricing table
  APPRAISAL_REMINDER_DAY: 25,   // month-end nudge to managers
  RECURRING_CATCHUP_LIMIT: 12,  // matches domain.gs
  DIGEST_OWN_TASKS: false,      // own tasks now come from sendTaskReminders, three times a day
};

/* When open tasks are chased. Hours are the script's time zone — set it to
   (GMT+05:30) India Standard Time in Project Settings. Apps Script runs an
   hourly trigger some time inside that hour, so "9 am" lands between 9 and 10. */
var REMIND = {
  HOURS: [9, 15, 17],
  DAYS_BEFORE_DUE: 2,
  INCLUDE_OVERDUE: true,        // every working day while late, at the same three times
};

/* Prefixed, like every other name in this file: Apps Script shares one global
   scope across .gs files and the last definition wins. code.gs owns MAIL_FROM
   through Script Properties; this is the fallback for a project where that is
   not reachable, and rmMailFrom_() prefers the configured one. */
var RM_MAIL_FROM = 'info@biscsindia.com';
var RM_MAIL_NAME = 'Dome Box';

/** The configured address if code.gs is in this project, else the constant. */
function rmMailFrom_() {
  try { if (typeof CFG === 'function' && CFG().mailFrom) return CFG().mailFrom; }
  catch (e) {}
  return RM_MAIL_FROM;
}
var SITE_URL = 'https://www.domebox.in';

// ============================================================
// TRIGGER MANAGEMENT
// ============================================================

function installDomeBoxSchedules() {
  removeDomeBoxSchedules();
  ScriptApp.newTrigger('sendDailyReminders').timeBased().atHour(SCHED.SEND_HOUR).everyDays(1).create();
  REMIND.HOURS.forEach(function (h) {
    ScriptApp.newTrigger('sendTaskReminders').timeBased().atHour(h).everyDays(1).create();
  });
  // Runs earlier so today's generated work appears in today's digest.
  ScriptApp.newTrigger('generateRecurringJobs').timeBased().atHour(Math.max(0, SCHED.SEND_HOUR - 2)).everyDays(1).create();
  /* An hour after the digest, so the two never compete for the mail quota and a
     renewal notice is never the thing that gets cut off by MAX_EMAILS_PER_RUN. */
  ScriptApp.newTrigger('sendRenewalReminders').timeBased().atHour(SCHED.SEND_HOUR + 1).everyDays(1).create();
  Logger.log('Installed:\n  generateRecurringJobs ~' + (SCHED.SEND_HOUR - 2) + ':00' +
             '\n  sendDailyReminders    ~' + SCHED.SEND_HOUR + ':00' +
             '\n  sendTaskReminders     ~' + REMIND.HOURS.map(function (h) { return h + ':00'; }).join(', ') +
             '\n  sendRenewalReminders  ~' + (SCHED.SEND_HOUR + 1) + ':00');
}

function removeDomeBoxSchedules() {
  var known = ['sendDailyReminders', 'generateRecurringJobs', 'sendRenewalReminders', 'sendTaskReminders'];
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (known.indexOf(fn) > -1) { ScriptApp.deleteTrigger(t); removed++; }
  });
  Logger.log('Removed ' + removed + ' existing Dome Box trigger(s).');
}

function domeBoxScheduleStatus() {
  var lines = ['', '=== Dome Box schedules ==='];
  var want = ['generateRecurringJobs', 'sendDailyReminders', 'sendRenewalReminders', 'sendTaskReminders'];
  var need = { sendTaskReminders: REMIND.HOURS.length };
  var have = {};
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (want.indexOf(fn) > -1) { have[fn] = (have[fn] || 0) + 1; lines.push('  ok      ' + fn + '  (' + t.getEventType() + ')'); }
  });
  /* Naming what is missing, not just counting what is there: a half-installed
     schedule is the state that looks fine and quietly does half the job. */
  want.forEach(function (fn) {
    if (!have[fn]) lines.push('  MISSING ' + fn);
    else if (need[fn] && have[fn] < need[fn]) lines.push('  ONLY ' + have[fn] + ' of ' + need[fn] + ' ' + fn + ' — run installDomeBoxSchedules()');
  });
  if (!Object.keys(have).length) lines.push('  none installed — run installDomeBoxSchedules()');
  lines.push('  DRY_RUN is currently ' + SCHED.DRY_RUN);
  Logger.log(lines.join('\n'));
}

// ============================================================
// DAILY REMINDERS
// ============================================================

function previewDailyReminders() {
  var was = SCHED.DRY_RUN;
  SCHED.DRY_RUN = true;
  try { sendDailyReminders(); } finally { SCHED.DRY_RUN = was; }
}

function sendDailyReminders() {
  var log = ['', '=== DAILY REMINDERS ' + new Date().toDateString() + ' ===',
    SCHED.DRY_RUN ? '*** DRY RUN — nothing will be sent ***' : '*** LIVE ***', ''];

  var tenants = rmLoadTenants_(log);
  if (!tenants) { Logger.log(log.join('\n')); return; }

  var sent = 0, skipped = 0, quietDays = 0;
  var today = new Date();
  var isAppraisalWindow = today.getDate() >= SCHED.APPRAISAL_REMINDER_DAY;

  for (var i = 0; i < tenants.length; i++) {
    var tenant = tenants[i];
    if (sent >= SCHED.MAX_EMAILS_PER_RUN) { log.push('  ! email cap reached — remaining tenants deferred to tomorrow'); break; }

    var data;
    try { data = rmReadTenant_(tenant.sheetId); }
    catch (e) { log.push('  ' + tenant.company + ': CANNOT OPEN (' + e.message + ')'); continue; }

    if (SCHED.PAID_PLANS_ONLY && data.plan === 'Free Tier') {
      log.push('  ' + tenant.company + ': skipped (Free Tier — email alerts are a paid feature)');
      continue;
    }

    log.push('  ' + (tenant.company || tenant.sheetId) + ' — ' + data.users.length + ' users, ' + data.tasks.length + ' tasks');

    for (var u = 0; u < data.users.length; u++) {
      var user = data.users[u];
      if (!user.email) continue;
      if (sent >= SCHED.MAX_EMAILS_PER_RUN) break;

      var reports = data.users.filter(function (x) { return x.manager === user.username; })
                              .map(function (x) { return x.username; });

      var digest = buildDigest(data.tasks, user, today, {
        reports: reports, escalateAfterDays: SCHED.ESCALATE_AFTER_DAYS,
      });
      if (!SCHED.DIGEST_OWN_TASKS) rmWithoutOwnTasks_(digest);

      var wantsAppraisalNudge = isAppraisalWindow && reports.length > 0 &&
        !rmAlreadySent_(tenant.sheetId, user.username, 'appraisal-' + rmMonthKey_(today));

      if (digest.isEmpty && !wantsAppraisalNudge) { quietDays++; continue; }
      if (rmAlreadySent_(tenant.sheetId, user.username, 'digest-' + ymd(today))) { skipped++; continue; }

      var subject = rmDigestSubject_(digest);
      var html = rmDigestHtml_(digest, tenant.company, wantsAppraisalNudge, reports.length);

      log.push('    → ' + user.email + '  [' + subject + ']' +
        '  overdue:' + digest.buckets.overdue.length +
        ' today:' + digest.buckets.dueToday.length +
        ' review:' + digest.buckets.awaitingMyReview.length +
        ' approve:' + digest.buckets.awaitingMyApproval.length +
        ' team:' + digest.buckets.teamOverdue.length);

      if (!SCHED.DRY_RUN) {
        if (rmSendMail_(user.email, subject, html)) {
          rmMarkSent_(tenant.sheetId, user.username, 'digest-' + ymd(today));
          if (wantsAppraisalNudge) rmMarkSent_(tenant.sheetId, user.username, 'appraisal-' + rmMonthKey_(today));
          sent++;
        }
      } else {
        sent++;
      }
    }
  }

  log.push('');
  log.push('Sent: ' + sent + '   Already-sent today: ' + skipped + '   Nothing to say: ' + quietDays);
  log.push('A quiet day sends nothing on purpose — a digest that always arrives gets filtered.');
  Logger.log(log.join('\n'));
}

// ============================================================
// TASK REMINDERS — 9 am, 3 pm, 5 pm
// ============================================================
//
// Only work the ball is with: To do or In progress. Handed in (For Review),
// waiting for approval, verified, rejected or cancelled — nothing is sent,
// because a reminder about work you have already delivered teaches people to
// ignore the next one.
//
// A task is in a person's reminder when, today, it was ASSIGNED, or it is
// DAYS_BEFORE_DUE days from its due date (moved to the Friday before when
// that is a weekend), or it is OVERDUE (working days only). One email per
// person per slot, most urgent first. Nothing on a clear day, nothing to
// someone on approved leave, and only newly assigned work at weekends.

function previewTaskReminders() {
  var was = SCHED.DRY_RUN;
  SCHED.DRY_RUN = true;
  try { sendTaskReminders(); } finally { SCHED.DRY_RUN = was; }
}

/** Which of the three slots this run is, from the hour it fired in. */
function rmSlot_(now) {
  var h = now.getHours(), slot = REMIND.HOURS[0];
  REMIND.HOURS.forEach(function (x) { if (h >= x) slot = x; });
  return slot;
}

function rmIsWeekend_(d) { return d.getDay() === 0 || d.getDay() === 6; }

/** The day the "due soon" reminder goes: N days before, never on a weekend. */
function rmDueSoonDay_(due) {
  var d = new Date(due.getFullYear(), due.getMonth(), due.getDate() - REMIND.DAYS_BEFORE_DUE);
  while (rmIsWeekend_(d)) d.setDate(d.getDate() - 1);
  return ymd(d);
}

/** Why a task belongs in today's reminder, or null if it does not. */
function rmReminderReason_(t, today) {
  if (t.status !== STATUS.PENDING && t.status !== STATUS.IN_PROGRESS) return null;
  var td = ymd(today), weekend = rmIsWeekend_(today);
  var due = parseYmd(rmYmd_(t.due));
  if (due && REMIND.INCLUDE_OVERDUE && !weekend && dayDiff(today, due) > 0) return { kind: 'overdue', since: ymd(due) };
  if (t.created && rmYmd_(t.created) === td) return { kind: 'assigned' };
  if (due && !weekend && rmDueSoonDay_(due) === td) return { kind: 'dueSoon' };
  return null;
}

/** One person's reminder list, most urgent first: late, then priority, then date. */
function rmTaskReminders_(tasks, username, today) {
  var rank = { overdue: 0, dueSoon: 1, assigned: 2 };
  return tasks.filter(function (t) { return t.assignee === username; }).map(function (t) {
    return { task: t, why: rmReminderReason_(t, today) };
  }).filter(function (x) { return x.why; }).sort(function (a, b) {
    var ra = rank[a.why.kind], rb = rank[b.why.kind];
    if (a.why.kind === 'overdue' || b.why.kind === 'overdue') {
      if (ra !== rb) return ra - rb;
      if (a.why.since !== b.why.since) return a.why.since < b.why.since ? -1 : 1;
    }
    var pw = priorityWeight(b.task.priority) - priorityWeight(a.task.priority);
    if (pw) return pw;
    var da = rmYmd_(a.task.due) || '9999', db = rmYmd_(b.task.due) || '9999';
    if (da !== db) return da < db ? -1 : 1;
    return ra - rb;
  });
}

function rmOnLeave_(leave, username, today) {
  var td = ymd(today);
  return (leave || []).some(function (l) { return l.username === username && l.from && l.from <= td && td <= l.to; });
}

function sendTaskReminders() {
  var now = new Date(), slot = rmSlot_(now);
  var log = ['', '=== TASK REMINDERS ' + now.toDateString() + ' · ' + slot + ':00 slot ===',
    SCHED.DRY_RUN ? '*** DRY RUN — nothing will be sent ***' : '*** LIVE ***', ''];
  var tenants = rmLoadTenants_(log);
  if (!tenants) { Logger.log(log.join('\n')); return log.join('\n'); }

  var sent = 0, skipped = 0, away = 0;
  for (var i = 0; i < tenants.length; i++) {
    var tenant = tenants[i];
    if (sent >= SCHED.MAX_EMAILS_PER_RUN) { log.push('  ! email cap reached — the rest wait for the next slot'); break; }
    var data;
    try { data = rmReadTenant_(tenant.sheetId); }
    catch (e) { log.push('  ' + tenant.company + ': CANNOT OPEN (' + e.message + ')'); continue; }
    if (SCHED.PAID_PLANS_ONLY && data.plan === 'Free Tier') continue;

    for (var u = 0; u < data.users.length; u++) {
      var user = data.users[u];
      if (!user.email || sent >= SCHED.MAX_EMAILS_PER_RUN) continue;
      var list = rmTaskReminders_(data.tasks, user.username, now);
      if (!list.length) continue;
      if (rmOnLeave_(data.leave, user.username, now)) { away++; continue; }
      var key = 'remind-' + ymd(now) + '-' + slot;
      if (rmAlreadySent_(tenant.sheetId, user.username, key)) { skipped++; continue; }

      var subject = rmReminderSubject_(list);
      log.push('    → ' + user.email + '  [' + subject + ']  ' +
        list.map(function (x) { return x.why.kind + ':' + x.task.title; }).join(' | '));
      if (!SCHED.DRY_RUN) {
        if (rmSendMail_(user.email, subject, rmReminderHtml_(list, user, tenant.company, slot))) {
          rmMarkSent_(tenant.sheetId, user.username, key);
          sent++;
        }
      } else {
        sent++;
      }
    }
  }
  log.push('');
  log.push((SCHED.DRY_RUN ? 'Would send ' : 'Sent ') + sent + '   Already sent this slot: ' + skipped + '   On leave: ' + away);
  Logger.log(log.join('\n'));
  return log.join('\n');
}

function rmReminderSubject_(list) {
  var late = list.filter(function (x) { return x.why.kind === 'overdue'; }).length;
  if (list.length === 1) {
    var w = list[0].why.kind;
    return (w === 'overdue' ? 'Overdue: ' : w === 'dueSoon' ? 'Due soon: ' : 'New task: ') + list[0].task.title;
  }
  return list.length + ' open tasks' + (late ? ' — ' + late + ' overdue' : '');
}

function rmNiceDate_(s) {
  var d = parseYmd(rmYmd_(s));
  if (!d) return '';
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + d.getDate() + ' ' +
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
}

function rmReminderHtml_(list, user, company, slot) {
  var hello = slot >= 17 ? 'Good evening' : slot >= 12 ? 'Good afternoon' : 'Good morning';
  var rows = list.map(function (x) {
    var t = x.task, right;
    if (x.why.kind === 'overdue') right = '<strong style="color:#b91c1c">Overdue since ' + rmEsc_(rmNiceDate_(t.due)) + '</strong>';
    else if (x.why.kind === 'dueSoon') right = '<strong style="color:#b45309">Due ' + rmEsc_(rmNiceDate_(t.due)) + '</strong>';
    else right = 'Assigned today' + (t.due ? ' · due ' + rmEsc_(rmNiceDate_(t.due)) : '');
    return rmRow_(t, right + '<br><span style="color:#9ca3af">' + rmEsc_(t.priority) +
      (t.status === STATUS.IN_PROGRESS ? ' · in progress' : ' · to do') + '</span>');
  });
  return '<p>' + hello + ' ' + rmEsc_(rmFirstName_(user.name)) + ',</p>' +
    '<p>' + (list.length === 1 ? 'This task is' : 'These ' + list.length + ' tasks are') +
    ' still open, most urgent first.</p>' +
    rmSection_('Your open work', rows, '#1d4ed8') +
    '<p style="margin:22px 0"><a href="' + SITE_URL + '" style="background:#2563eb;color:#fff;text-decoration:none;' +
    'padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">Open Dome Box</a></p>' +
    '<p style="font-size:12px;color:#6b7280">Dome Box reminds you at 9 am, 3 pm and 5 pm on the day a task is assigned, ' +
    REMIND.DAYS_BEFORE_DUE + ' days before it is due' + (REMIND.INCLUDE_OVERDUE ? ', and every working day while it is overdue' : '') +
    '. Hand it in and the reminders stop.' + (company ? '<br>' + rmEsc_(company) : '') + '</p>';
}

/** The morning digest without the person's own tasks, which have their own reminders now. */
function rmWithoutOwnTasks_(digest) {
  var b = digest.buckets;
  b.overdue = []; b.dueToday = []; b.dueTomorrow = []; b.rework = [];
  digest.isEmpty = !b.awaitingMyReview.length && !b.awaitingMyApproval.length && !b.teamOverdue.length;
  return digest;
}

/* ---------------------------------------------------------------------------
   RENEWAL REMINDERS

   A plan used to lapse with nothing but a banner inside the app — which the
   person who pays the bill may never see, because they are usually not the
   person using it every day. By the time anybody notices, the workspace is
   read-only and the customer's first thought is that the product broke.

   One mail per milestone per company, deduped through the same log the daily
   digest uses, so a re-run or a second trigger cannot send it twice.
   ------------------------------------------------------------------------- */
var RENEWAL_MILESTONES = [14, 7, 3, 1, 0, -3];

function previewRenewalReminders() {
  var keep = SCHED.DRY_RUN; SCHED.DRY_RUN = true;
  try { sendRenewalReminders(); } finally { SCHED.DRY_RUN = keep; }
}

function sendRenewalReminders() {
  var log = ['', '=== Renewal reminders ' + (SCHED.DRY_RUN ? '(DRY RUN)' : '') + ' ==='];
  var tenants = rmLoadTenants_(log);
  if (!tenants) { Logger.log(log.join('\n')); return; }

  var today = new Date(); today.setHours(0, 0, 0, 0);
  var sent = 0;

  tenants.forEach(function (t) {
    if (!t.ownerEmail || !t.validUntil) return;
    /* Free never expires in a way worth chasing, and chasing it would be
       selling to somebody who has not agreed to be sold to. */
    var plan = String(t.plan || '').toLowerCase();
    if (!plan || plan === 'free' || plan === 'free tier') return;

    var until = new Date(t.validUntil);
    if (isNaN(until)) return;
    until.setHours(0, 0, 0, 0);
    var days = Math.round((until - today) / 86400000);
    if (RENEWAL_MILESTONES.indexOf(days) < 0) return;

    var key = 'renew-' + days;
    if (rmAlreadySent_(t.sheetId, t.ownerEmail, key)) return;

    var subject = days > 0
        ? (t.company || 'Your Dome Box plan') + ' renews in ' + days + ' day' + (days === 1 ? '' : 's')
      : days === 0
        ? (t.company || 'Your Dome Box plan') + ' expires today'
        : (t.company || 'Your Dome Box plan') + ' has expired';

    if (SCHED.DRY_RUN) { log.push('  would send: ' + subject + ' -> ' + t.ownerEmail); sent++; return; }
    if (rmSendMail_(t.ownerEmail, subject, rmRenewalHtml_(t, days, until))) {
      rmMarkSent_(t.sheetId, t.ownerEmail, key);
      sent++;
    }
  });

  log.push((SCHED.DRY_RUN ? 'Would send ' : 'Sent ') + sent + ' renewal reminder(s).');
  Logger.log(log.join('\n'));
}

function rmRenewalHtml_(t, days, until) {
  var when = Utilities.formatDate(until, Session.getScriptTimeZone(), 'd MMMM yyyy');
  var head = days > 0
      ? 'Your ' + rmEsc_(t.plan) + ' plan renews on ' + when + '.'
    : days === 0
      ? 'Your ' + rmEsc_(t.plan) + ' plan expires today.'
      : 'Your ' + rmEsc_(t.plan) + ' plan expired on ' + when + '.';

  /* The grace period is stated plainly rather than left as a surprise: nobody
     loses their history, and saying so is the difference between a renewal and
     a panicked support email. */
  var body = days >= 0
    ? '<p>Nothing changes before then. You can renew from <strong>Plans</strong> inside Dome Box ' +
      'at any time, and renewing early adds to the date you already have rather than replacing it.</p>'
    : '<p>Your workspace is still fully usable for a week after expiry. After that it becomes ' +
      'read-only — <strong>nothing is deleted</strong>, and everything comes straight back when ' +
      'you renew.</p>';

  return '<p>Hello' + (t.company ? ' ' + rmEsc_(t.company) : '') + ',</p>' +
    '<p>' + head + '</p>' + body +
    '<p style="margin-top:22px">If the invoice should go to somebody else, or you need a GST ' +
    'invoice, reply to this email and we will sort it out.</p>';
}

function rmDigestSubject_(d) {
  var b = d.buckets;
  if (b.overdue.length) return b.overdue.length + ' task' + (b.overdue.length > 1 ? 's' : '') + ' overdue';
  if (b.awaitingMyApproval.length) return b.awaitingMyApproval.length + ' waiting on your approval';
  if (b.awaitingMyReview.length) return b.awaitingMyReview.length + ' ready for your review';
  if (b.dueToday.length) return b.dueToday.length + ' due today';
  if (b.teamOverdue.length) return 'Your team has overdue work';
  return 'Your Dome Box for today';
}

function rmDigestHtml_(d, company, appraisalNudge, reportCount) {
  var b = d.buckets;
  var out = '<p>Good morning ' + rmEsc_(rmFirstName_(d.user.name)) + ',</p>';

  if (b.overdue.length) {
    out += rmSection_('Overdue — needs attention now', b.overdue.map(function (t) {
      return rmRow_(t, '<strong style="color:#b91c1c">' + t.daysOverdue + ' day' + (t.daysOverdue > 1 ? 's' : '') + ' late</strong>');
    }), '#b91c1c');
  }
  if (b.rework.length) {
    out += rmSection_('Sent back for rework', b.rework.map(function (t) { return rmRow_(t, 'rework ' + t.reworkCount + '×'); }), '#b45309');
  }
  if (b.dueToday.length) out += rmSection_('Due today', b.dueToday.map(function (t) { return rmRow_(t, 'today'); }), '#1d4ed8');
  if (b.dueTomorrow.length) out += rmSection_('Due tomorrow', b.dueTomorrow.map(function (t) { return rmRow_(t, 'tomorrow'); }), '#4b5563');

  if (b.awaitingMyApproval.length) {
    out += rmSection_('Waiting on you to approve', b.awaitingMyApproval.map(function (t) {
      return rmRow_(t, 'for ' + rmEsc_(t.assigneeName || t.assignee));
    }), '#7048c4') +
      '<p style="font-size:12px;color:#6b7280;margin:-6px 0 14px">Nobody can start these until you decide, and the delay counts against your own responsiveness score.</p>';
  }
  if (b.awaitingMyReview.length) {
    out += rmSection_('Ready for your review', b.awaitingMyReview.map(function (t) {
      return rmRow_(t, 'from ' + rmEsc_(t.assigneeName || t.assignee));
    }), '#7048c4');
  }
  if (b.teamOverdue.length) {
    out += rmSection_('Your team — overdue ' + SCHED.ESCALATE_AFTER_DAYS + '+ days', b.teamOverdue.map(function (t) {
      return rmRow_(t, rmEsc_(t.assigneeName || t.assignee) + ' · ' + t.daysOverdue + 'd late');
    }), '#b91c1c');
  }

  if (appraisalNudge) {
    out += '<div style="margin:18px 0;padding:14px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px">' +
      '<strong style="color:#5b21b6">Month end: score your team</strong>' +
      '<p style="margin:6px 0 0;font-size:13px;color:#4c1d95">Delegation scores for your ' + reportCount +
      ' report' + (reportCount > 1 ? 's' : '') + ' are already calculated from verified work. Add your KRA and behaviour ratings to close the cycle.</p></div>';
  }

  out += '<p style="margin:22px 0"><a href="' + SITE_URL + '" style="background:#2563eb;color:#fff;text-decoration:none;' +
    'padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">Open Dome Box</a></p>';
  out += '<p style="font-size:12px;color:#6b7280">You are getting this because you have open work in ' +
    rmEsc_(company || 'your workspace') + '. One email a day, and none at all on a clear day.</p>';
  return out;
}

function rmSection_(title, rows, colour) {
  return '<div style="margin:16px 0 14px">' +
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:' + colour + ';margin-bottom:7px">' +
    rmEsc_(title) + '</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13px">' + rows.join('') + '</table></div>';
}

function rmRow_(t, right) {
  var pri = { Critical: '#991b1b', High: '#dc2626', Medium: '#b45309', Low: '#2563eb' }[t.priority] || '#6b7280';
  return '<tr>' +
    '<td style="padding:7px 0;border-bottom:1px solid #f3f4f6;border-left:3px solid ' + pri + ';padding-left:9px">' +
    '<strong>' + rmEsc_(t.title) + '</strong>' +
    (t.kra ? '<span style="color:#6b7280;font-size:11px"> · ' + rmEsc_(t.kra) + '</span>' : '') +
    '</td>' +
    '<td style="padding:7px 0;border-bottom:1px solid #f3f4f6;text-align:right;color:#6b7280;font-size:12px;white-space:nowrap">' +
    right + '</td></tr>';
}

// ============================================================
// RECURRING JOB GENERATION
// ============================================================

function previewRecurringJobs() {
  var was = SCHED.DRY_RUN;
  SCHED.DRY_RUN = true;
  try { generateRecurringJobs(); } finally { SCHED.DRY_RUN = was; }
}

/**
 * Schedule-driven generation. Reads each tenant's recurring tasks and creates
 * any occurrence whose due date has arrived, independent of whether the last
 * one was closed. `skipIfPreviousOpen` is available per task for jobs where
 * piling up a second copy would be pointless rather than useful.
 */
function generateRecurringJobs() {
  var log = ['', '=== RECURRING JOBS ' + new Date().toDateString() + ' ===',
    SCHED.DRY_RUN ? '*** DRY RUN ***' : '*** LIVE ***', ''];

  var tenants = rmLoadTenants_(log);
  if (!tenants) { Logger.log(log.join('\n')); return; }

  var today = new Date();
  var createdTotal = 0;

  tenants.forEach(function (tenant) {
    var ss, sheet, headers, rows;
    try {
      ss = SpreadsheetApp.openById(tenant.sheetId);
      sheet = rmFindTab_(ss, ['tasks', 'task', 'assignments', 'work']);
      if (!sheet) { log.push('  ' + tenant.company + ': no Tasks tab'); return; }
      headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      rows = sheet.getDataRange().getValues();
    } catch (e) {
      log.push('  ' + tenant.company + ': CANNOT OPEN (' + e.message + ')'); return;
    }

    var col = {};
    headers.forEach(function (h, i) { col[rmNormKey_(h)] = i; });
    var need = ['cadence', 'frequency', 'due', 'duedate', 'status'];
    var cadenceIdx = col.cadence !== undefined ? col.cadence : col.frequency;
    var dueIdx = col.due !== undefined ? col.due : col.duedate;
    if (cadenceIdx === undefined || dueIdx === undefined) {
      log.push('  ' + tenant.company + ': no cadence/due columns — skipped');
      return;
    }

    var created = 0;
    // Only the newest occurrence of each recurring series is considered, so a
    // long history of past copies cannot each spawn their own successor.
    var newestBySeries = {};
    for (var r = 1; r < rows.length; r++) {
      var cadence = String(rows[r][cadenceIdx] || 'One Time');
      if (!cadence || cadence === 'One Time' || cadence === 'ONE_TIME') continue;
      var title = String(rows[r][col.title] || '');
      var assignee = String(rows[r][col.to !== undefined ? col.to : col.assignee] || '');
      var key = title + '||' + assignee + '||' + cadence;
      var dueVal = rows[r][dueIdx];
      if (!newestBySeries[key] || String(dueVal) > String(newestBySeries[key].due)) {
        newestBySeries[key] = { rowIndex: r, due: dueVal, cadence: cadence, row: rows[r] };
      }
    }

    Object.keys(newestBySeries).forEach(function (key) {
      var series = newestBySeries[key];
      var stopped = col.recurringstopped !== undefined && !!series.row[col.recurringstopped];
      if (stopped) return;

      var status = String(series.row[col.status] || '');
      var previousOpen = isOpen(status);

      /* The stop rule travels on the row, so the scheduler honours exactly the
         same limits as the in-app spawn. Reading it here rather than assuming
         "forever" is the difference between a schedule and a task that outlives
         the reason it was created. */
      var until = col.repeatuntil !== undefined ? rmYmd_(series.row[col.repeatuntil]) : '';
      var limit = col.repeatcount !== undefined ? Number(series.row[col.repeatcount] || 0) : 0;
      var made  = col.repeatmade  !== undefined ? Number(series.row[col.repeatmade] || 0) : 0;

      var plan = dueOccurrences({
        cadence: series.cadence, nextDue: ymd(series.due), active: true,
        endDate: until, maxOccurrences: limit, occurrencesCreated: made || (limit ? 1 : 0),
        skipIfPreviousOpen: false,
      }, today, { previousOpen: previousOpen });

      // The occurrence already on the sheet is the first entry; skip it.
      var toCreate = plan.create.filter(function (d) { return d !== ymd(series.due); });
      if (!toCreate.length) {
        if (plan.stop) log.push('    · ' + String(series.row[col.title]) + ' — series ended (' + plan.reason + ')');
        return;
      }

      toCreate.forEach(function (dueDate) {
        log.push('    + ' + String(series.row[col.title]) + ' → ' + dueDate + ' (' + series.cadence + ')' +
          (previousOpen ? '  [previous still open]' : ''));
        if (!SCHED.DRY_RUN) {
          var newRow = series.row.slice();
          newRow[dueIdx] = dueDate;
          newRow[col.status] = 'Pending';
          if (col.id !== undefined) newRow[col.id] = Utilities.getUuid();
          if (col.reworkcount !== undefined) newRow[col.reworkcount] = 0;
          if (col.isarchived !== undefined) newRow[col.isarchived] = false;
          // Marks it system-generated so it does not spend the tenant's monthly
          // task quota — nobody chose to create it, and a customer on Free with
          // five daily recurring jobs would otherwise burn all 50 in ten days.
          if (col.spawnedby !== undefined) newRow[col.spawnedby] = series.row[col.id] || 'recurring';
          if (col.repeatmade !== undefined) newRow[col.repeatmade] = (made || 1) + 1 + toCreate.indexOf(dueDate);
          if (col.history !== undefined) {
            newRow[col.history] = JSON.stringify([{
              status: 'Pending', note: 'Auto-generated (' + series.cadence + ')',
              user: 'system', date: new Date().toISOString(),
            }]);
          }
          sheet.appendRow(newRow);
        }
        created++; createdTotal++;
      });
    });

    if (created) log.push('  ' + (tenant.company || tenant.sheetId) + ': ' + created + ' occurrence(s)');
  });

  log.push('');
  log.push('Total created: ' + createdTotal);
  log.push('Generation is schedule-driven: a series continues even if nobody closed the last one.');
  Logger.log(log.join('\n'));
}

/** A sheet cell holding a date can come back as a Date or as a string, and a
 *  stop rule compared the wrong way round silently never stops. */
function rmYmd_(v) {
  if (!v) return '';
  if (v instanceof Date) return ymd(v);
  var str = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : (parseYmd(str) ? ymd(parseYmd(str)) : '');
}

// ============================================================
// TENANT ACCESS
// ============================================================

function rmLoadTenants_(log) {
  if (!REG.SHEET_ID) { log.push('REG.SHEET_ID is empty — set it at the top of reminders.gs.'); return null; }
  var reg, tab;
  try {
    reg = SpreadsheetApp.openById(REG.SHEET_ID);
    tab = REG.TAB ? reg.getSheetByName(REG.TAB)
                  : (reg.getSheetByName('Accounts') || rmFindTab_(reg, ['accounts', 'registry', 'master', 'companies', 'tenants']));
  } catch (e) {
    log.push('Cannot open the registry: ' + e.message); return null;
  }
  if (!tab) { log.push('No registry tab found — set REG.TAB.'); return null; }

  var rows = tab.getDataRange().getValues();
  var col = {};
  (rows[0] || []).forEach(function (h, i) { col[rmNormKey_(h)] = i; });
  var emailIdx = rmFirstDefined_(col, ['email', 'emailid', 'username', 'loginid']);
  var sheetIdx = rmFirstDefined_(col, ['sheetid', 'spreadsheetid', 'sheet', 'spreadsheet']);
  var compIdx = rmFirstDefined_(col, ['companyname', 'company', 'organisation', 'organization']);
  /* Needed for the renewal reminders. Optional: a registry without them still
     produces digests, it just cannot warn anybody their plan is running out. */
  var planIdx = rmFirstDefined_(col, ['plan', 'plantype', 'subscription']);
  var tillIdx = rmFirstDefined_(col, ['validuntil', 'validtill', 'expiry', 'expireson', 'renewson']);
  if (emailIdx === undefined || sheetIdx === undefined) {
    log.push('Registry is missing an email or sheetId column.'); return null;
  }

  var seen = {}, out = [];
  for (var r = 1; r < rows.length; r++) {
    var sid = String(rows[r][sheetIdx] || '').trim();
    var m = sid.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (m) sid = m[1];
    if (!sid || seen[sid]) continue;   // one entry per company, not per login
    seen[sid] = true;
    out.push({
      sheetId: sid,
      company: compIdx !== undefined ? String(rows[r][compIdx] || '') : '',
      ownerEmail: emailIdx !== undefined ? String(rows[r][emailIdx] || '').trim() : '',
      plan: planIdx !== undefined ? String(rows[r][planIdx] || '').trim() : '',
      validUntil: tillIdx !== undefined ? rows[r][tillIdx] : null,
    });
  }
  log.push('Companies: ' + out.length);
  return out;
}

function rmReadTenant_(sheetId) {
  var ss = SpreadsheetApp.openById(sheetId);

  var usersSheet = rmFindTab_(ss, ['users', 'user', 'staff', 'employees', 'members']);
  var users = [];
  if (usersSheet) {
    var urows = usersSheet.getDataRange().getValues();
    var uc = {};
    (urows[0] || []).forEach(function (h, i) { uc[rmNormKey_(h)] = i; });
    var uUser = rmFirstDefined_(uc, ['username', 'loginid', 'email']);
    var uName = rmFirstDefined_(uc, ['name', 'fullname']);
    var uMail = rmFirstDefined_(uc, ['email', 'emailid', 'mail']);
    var uMgr = rmFirstDefined_(uc, ['manager', 'reportsto', 'reportingmanager']);
    var uRole = rmFirstDefined_(uc, ['role', 'usertype']);
    for (var i = 1; i < urows.length; i++) {
      var un = uUser !== undefined ? String(urows[i][uUser] || '') : '';
      if (!un) continue;
      users.push({
        username: un,
        name: uName !== undefined ? String(urows[i][uName] || un) : un,
        email: uMail !== undefined ? String(urows[i][uMail] || un) : un,
        manager: uMgr !== undefined ? String(urows[i][uMgr] || '') : '',
        role: uRole !== undefined ? String(urows[i][uRole] || 'Doer') : 'Doer',
      });
    }
  }

  var tasksSheet = rmFindTab_(ss, ['tasks', 'task', 'assignments', 'work']);
  var tasks = [];
  if (tasksSheet) {
    var trows = tasksSheet.getDataRange().getValues();
    var tc = {};
    (trows[0] || []).forEach(function (h, i) { tc[rmNormKey_(h)] = i; });
    var g = function (row, names, dflt) {
      var idx = rmFirstDefined_(tc, names);
      return idx === undefined ? dflt : row[idx];
    };
    var byUser = {};
    users.forEach(function (u) { byUser[u.username] = u.name; });
    for (var j = 1; j < trows.length; j++) {
      var row = trows[j];
      var title = String(g(row, ['title', 'task', 'taskname'], ''));
      if (!title) continue;
      var assignee = String(g(row, ['to', 'assignee', 'assignedto'], ''));
      tasks.push({
        id: String(g(row, ['id', 'taskid'], '')),
        title: title,
        assignee: assignee,
        assigneeName: byUser[assignee] || assignee,
        raisedBy: String(g(row, ['by', 'raisedby', 'assignedby', 'createdby'], '')),
        approver: String(g(row, ['approvermanager', 'approver'], '')),
        status: String(g(row, ['status'], '')),
        due: g(row, ['due', 'duedate'], ''),
        priority: String(g(row, ['priority'], 'Medium')),
        kra: String(g(row, ['kra', 'kratag'], '')),
        reworkCount: Number(g(row, ['reworkcount', 'rework'], 0)) || 0,
        created: g(row, ['datecreated', 'created', 'createdon'], ''),
      });
    }
  }

  var plan = 'Free Tier';
  var billing = ss.getSheetByName('Billing');
  if (billing && billing.getLastRow() > 1) {
    var brows = billing.getDataRange().getValues();
    var bc = {};
    (brows[0] || []).forEach(function (h, i) { bc[rmNormKey_(h)] = i; });
    var pIdx = rmFirstDefined_(bc, ['planname', 'plan']);
    if (pIdx !== undefined) plan = String(brows[1][pIdx] || 'Free Tier');
  }

  var leave = [];
  var leaveSheet = ss.getSheetByName('Leave');
  if (leaveSheet && leaveSheet.getLastRow() > 1) {
    leaveSheet.getDataRange().getValues().slice(1).forEach(function (r) {
      if (!r[0]) return;
      var approved = String(r[4] === undefined ? '' : r[4]).toLowerCase();
      if (approved === 'false' || approved === 'no' || approved === 'rejected') return;
      leave.push({ username: String(r[0]), from: rmYmd_(r[1]), to: rmYmd_(r[2]) || rmYmd_(r[1]) });
    });
  }

  return { users: users, tasks: tasks, plan: plan, leave: leave };
}

// ============================================================
// SEND-ONCE LOG — so a retry or a manual run never double-mails anyone
// ============================================================

function rmReminderLog_(sheetId) {
  var ss = SpreadsheetApp.openById(REG.SHEET_ID);
  var sheet = ss.getSheetByName('ReminderLog');
  if (!sheet) {
    if (SCHED.DRY_RUN) return null;
    sheet = ss.insertSheet('ReminderLog');
    sheet.appendRow(['sheetId', 'username', 'key', 'sentAt']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function rmAlreadySent_(sheetId, username, key) {
  var sheet = rmReminderLog_(sheetId);
  if (!sheet) return false;
  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i > 0; i--) {
    if (String(rows[i][0]) === sheetId && String(rows[i][1]) === username && String(rows[i][2]) === key) return true;
  }
  return false;
}

function rmMarkSent_(sheetId, username, key) {
  var sheet = rmReminderLog_(sheetId);
  if (sheet) sheet.appendRow([sheetId, username, key, new Date().toISOString()]);
}

// ============================================================
// HELPERS
// ============================================================

/* Checked once per run, not per email: a digest run sends dozens and
   getAliases() is a network call. */
var RM_ALIAS_OK = null;

function rmAliasVerified_() {
  if (RM_ALIAS_OK !== null) return RM_ALIAS_OK;
  try { RM_ALIAS_OK = GmailApp.getAliases().indexOf(rmMailFrom_()) > -1; }
  catch (e) { RM_ALIAS_OK = false; }
  if (!RM_ALIAS_OK) {
    Logger.log('STOPPED: "' + rmMailFrom_() + '" is not a verified send-as alias on this ' +
      'account, so nothing has been sent. Gmail > Settings > Accounts > Send mail as. ' +
      'Reminders are never sent from any other address.');
  }
  return RM_ALIAS_OK;
}

/**
 * Every reminder leaves from RM_MAIL_FROM or it does not leave.
 *
 * This used to log a warning and send anyway, as whichever Google account owns
 * the script. A digest arriving from someone's personal address looks like
 * phishing, cannot be replied to, and teaches a customer's whole team to
 * distrust mail from us — worse than the reminder not arriving.
 */
function rmSendMail_(to, subject, bodyHtml) {
  if (!to) return false;
  if (!rmAliasVerified_()) return false;
  try {
    GmailApp.sendEmail(to, subject, rmPlain_(bodyHtml), {
      htmlBody: rmShell_(subject, bodyHtml),
      name: RM_MAIL_NAME, from: rmMailFrom_(), replyTo: rmMailFrom_(),
    });
    return true;
  } catch (e) {
    Logger.log('Mail failed to ' + to + ': ' + e.message);
    return false;
  }
}

function rmShell_(title, inner) {
  return '<div style="margin:0;padding:24px;background:#f3f4f6;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif">' +
    '<div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">' +
      '<div style="background:#1e3a8a;padding:18px 26px;color:#fff">' +
        '<div style="font-size:19px;font-weight:800">Dome Box</div>' +
        '<div style="font-size:12px;opacity:.8">' + rmEsc_(title) + '</div>' +
      '</div>' +
      '<div style="padding:26px;color:#1f2937;font-size:14px;line-height:1.6">' + inner + '</div>' +
      '<div style="padding:16px 26px;background:#f9fafb;border-top:1px solid #e5e7eb;color:#6b7280;font-size:11px">' +
        'Dome Box · <a href="mailto:' + RM_MAIL_FROM + '" style="color:#2563eb">' + RM_MAIL_FROM + '</a>' +
      '</div>' +
    '</div></div>';
}

function rmPlain_(html) {
  return String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function rmEsc_(s) {
  /* The apostrophe matters: these strings land inside HTML attributes in the
     digest, and a task called O'Brien audit would otherwise close one. */
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function rmFirstName_(n) { return String(n || '').trim().split(/\s+/)[0] || 'there'; }
function rmMonthKey_(d) { return d.getFullYear() + '-' + (d.getMonth() + 1); }
function rmNormKey_(h) { return String(h == null ? '' : h).toLowerCase().replace(/[\s_\-]/g, ''); }
function rmFirstDefined_(map, names) {
  for (var i = 0; i < names.length; i++) if (map[names[i]] !== undefined) return map[names[i]];
  return undefined;
}
function rmFindTab_(ss, names) {
  var sheets = ss.getSheets();
  for (var n = 0; n < names.length; n++) {
    for (var s = 0; s < sheets.length; s++) {
      if (rmNormKey_(sheets[s].getName()) === rmNormKey_(names[n])) return sheets[s];
    }
  }
  for (var n2 = 0; n2 < names.length; n2++) {
    for (var s2 = 0; s2 < sheets.length; s2++) {
      if (rmNormKey_(sheets[s2].getName()).indexOf(rmNormKey_(names[n2])) > -1) return sheets[s2];
    }
  }
  return null;
}
