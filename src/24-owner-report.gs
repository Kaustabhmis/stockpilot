// ===========================================================================
// MONTHLY OWNER REPORT — last month in one email, to every Admin, on the 1st
// ===========================================================================
//
// The reminder that the product is earning its fee: how much got done last
// month, how much of it on time, who carried the month, who needs a word,
// and what is stuck right now. Built from the same numbers the Reports and
// Leaderboard screens show, so the email never disagrees with the app.
//
// When: a daily trigger at about 9 am sends it on the 1st; on the 2nd and 3rd
// it catches any company the 1st missed (a run cut short, Google hiccup).
// Each company gets it once a month: the month sent is kept in its Settings.
// The demo workspace and stopped (unpaid for over a week) workspaces are
// skipped. An Admin can also email it to themselves at any time.

var OWNER_REPORT_HOUR = 9;
var OWNER_REPORT_LAST_DAY = 3;   // catch-up window: the 1st to the 3rd

/** The trigger, daily. Sends last month's report to every company not yet sent it. */
function sendMonthlyOwnerReports(when) {
  var now = when instanceof Date ? when : new Date();
  var log = ['', '=== MONTHLY OWNER REPORTS ' + ymd(now) + ' ==='];
  if (now.getDate() > OWNER_REPORT_LAST_DAY) { log.push('Not the start of a month — nothing to send.'); return say_(log); }
  var month = ownerReportMonthKey_(now);
  var sent = 0;
  ownerReportCompanies_().forEach(function (co) {
    try {
      /* Checked before the company is opened in full, so the runs on the 2nd
         and 3rd skip quickly past everyone already sent and reach the rest. */
      if (ownerReportAlreadySent_(co.sheetId, month)) return;
      var ctx = ownerReportCtx_(co.sheetId);
      if (!ctx) { log.push('  ' + co.company + ': no active Admin — skipped'); return; }
      if (ctx.serviceStopped) { log.push('  ' + co.company + ': stopped — skipped'); return; }
      var r = ownerReport_(ctx, now);
      var admins = readUsers_(ctx).filter(function (u) { return u.role === ROLE.ADMIN && u.active !== false && u.email; });
      var n = 0;
      admins.forEach(function (a) { if (sendEmail_(a.email, r.subject, r.html)) n++; });
      if (n) { writeSetting_(ctx, 'ownerReportSent', 'sent ' + month); sent += n; }
      log.push('  ' + co.company + ': ' + n + ' sent  [' + r.subject + ']');
    } catch (e) {
      log.push('  ' + co.company + ': FAILED ' + e.message);
      logError_('ownerReport', co.company + ' — ' + e.message);
    }
  });
  log.push('', 'Sent: ' + sent);
  return say_(log);
}

/** For the editor: what every company's report would say now. Sends nothing. */
function previewOwnerReports() {
  var log = ['', '=== OWNER REPORTS — PREVIEW, NOTHING SENT ==='];
  ownerReportCompanies_().forEach(function (co) {
    try {
      var ctx = ownerReportCtx_(co.sheetId);
      if (!ctx) { log.push('  ' + co.company + ': no active Admin'); return; }
      var r = ownerReport_(ctx, new Date());
      log.push('  ' + co.company + ': ' + r.subject);
    } catch (e) { log.push('  ' + co.company + ': ' + e.message); }
  });
  return say_(log);
}

/** An Admin asks for last month's report now: it goes to them only. */
function emailOwnerReport_(ctx) {
  requireAdmin_(ctx);
  /* The mail quota is shared by every company: a few a day is plenty. */
  throttle_('ownerrep', ctx.sheetId, { max: 5, windowMin: 24 * 60 });
  var r = ownerReport_(ctx, new Date());
  if (!sendEmail_(ctx.me.email, r.subject, r.html)) throw new Error('The email could not be sent just now. Please try again later.');
  return { status: 'success', message: 'Sent to ' + ctx.me.email + '.' };
}

/** Installed by switchOnSchedules(). */
function installOwnerReportSchedule() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendMonthlyOwnerReports') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendMonthlyOwnerReports').timeBased().atHour(OWNER_REPORT_HOUR).everyDays(1).create();
}

/* ---- the report ------------------------------------------------------------ */

function ownerReport_(ctx, now) {
  var tasks = readAllTasks_(ctx);
  var users = readUsers_(ctx).filter(function (u) { return u.active !== false; });
  var cal = leaveCalendar_(ctx), opts = scoreOptsMap_(ctx);
  var optsFor = function (u) { return opts[u.username]; };
  var last = periodAnalytics(tasks, users, periodRange('month', 1, now), now, cal, optsFor);
  var before = periodAnalytics(tasks, users, periodRange('month', 2, now), now, cal, optsFor);
  var board = leaderboard(last.people);
  var top = board.rows.slice(0, 3);
  var watch = board.rows.filter(function (r) { return r.band === 'C'; }).slice(-3).reverse();

  var late = 0;
  tasks.forEach(function (t) {
    if (t.status !== STATUS.VERIFIED) return;
    var c = closedAt(t);
    if (!c || !inWindow(c, periodRange('month', 1, now))) return;
    var sub = submittedAt(t), due = parseYmd(t.due);
    if (sub && due && chargeableLateDays(due, sub, t.assignee, cal) > 0) late++;
  });
  var stuck = tasks.filter(function (t) {
    if (t.status !== STATUS.AWAITING_APPROVAL && t.status !== STATUS.FOR_REVIEW) return false;
    var h = t.history || [], at = h.length ? new Date(h[h.length - 1].date) : null;
    return at && (now - at) > 2 * 86400000;
  }).length;

  var label = last.range.label;
  var rate = last.onTimeRate;
  var trend = rate !== null && before.onTimeRate !== null
    ? (rate > before.onTimeRate ? 'up ' + (rate - before.onTimeRate) + ' points' :
       rate < before.onTimeRate ? 'down ' + (before.onTimeRate - rate) + ' points' : 'the same') + ' on ' + before.range.label
    : '';
  var company = ctx.company || 'Your company';
  var subject = company + ' — ' + label + ' in ' + MAIL_FROM_NAME + ': ' +
    (rate !== null ? rate + '% on time' : last.delivered + ' jobs closed');

  var big = function (v, k, colour) {
    return '<td style="padding:12px;text-align:center;background:#f9fafb;border-radius:10px">' +
      '<div style="font-size:26px;font-weight:900;color:' + (colour || '#111827') + '">' + esc_(v) + '</div>' +
      '<div style="font-size:11px;color:#6b7280;font-weight:bold;text-transform:uppercase;letter-spacing:.04em">' + esc_(k) + '</div></td>';
  };
  var person = function (r, right) {
    return '<tr><td style="padding:8px 0;border-bottom:1px solid #eee"><b>' + esc_(r.name) + '</b>' +
      (r.dept ? ' <span style="color:#9ca3af">· ' + esc_(r.dept) + '</span>' : '') + '</td>' +
      '<td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;font-weight:bold">' + esc_(right) + '</td></tr>';
  };

  /* Goals: how many are on track, and which need attention, by department. */
  var goalsHtml = '', goalNums = null;
  try {
    /* The quarter the report is about: last month's, not the one just begun. */
    var asOf = new Date(now.getTime() - 86400000);
    var allGoals = readGoals_(ctx), sm = fyStartMonth_(ctx), fq = fyPeriod_(asOf, sm);
    var liveGoals = allGoals.filter(function (g) { return g.status !== 'Dropped' &&
      (g.level === 'year' ? g.period === fq.year : g.period === fq.quarter); });
    if (liveGoals.length) {
      var rows = liveGoals.map(function (g) { return { id: g.id, title: g.title, dept: g.scope === 'dept' ? g.dept : '' }; });
      rollUpOutlooks_(rows, allGoals, tasks, sm, now);
      goalNums = { onTrack: 0, atRisk: 0, offTrack: 0, noData: 0, achieved: 0 };
      rows.forEach(function (r) { var v = r.outlook.verdict;
        if (v === 'On track') goalNums.onTrack++; else if (v === 'At risk') goalNums.atRisk++;
        else if (v === 'Off track' || v === 'Missed') goalNums.offTrack++; else if (v === 'Achieved') goalNums.achieved++; else goalNums.noData++; });
      var attention = rows.filter(function (r) { return r.outlook.tone === 'bad' || r.outlook.tone === 'warn'; }).slice(0, 6);
      goalsHtml = '<h3 style="font-size:15px;margin:22px 0 6px">Goals — are we on track?</h3>' +
        '<table style="width:100%;border-collapse:separate;border-spacing:6px;margin:0 0 4px"><tr>' +
          big(goalNums.onTrack + goalNums.achieved, 'On track', '#047857') + big(goalNums.atRisk, 'At risk', goalNums.atRisk ? '#b45309' : '#111827') +
          big(goalNums.offTrack, 'Off track', goalNums.offTrack ? '#b91c1c' : '#111827') + big(goalNums.noData, 'No figures yet') +
        '</tr></table>' +
        (attention.length ? '<table style="width:100%;border-collapse:collapse">' + attention.map(function (r) {
          return '<tr><td style="padding:8px 0;border-bottom:1px solid #eee"><b>' + esc_(r.title) + '</b>' +
            (r.dept ? ' <span style="color:#9ca3af">· ' + esc_(r.dept) + '</span>' : '') +
            '<div style="color:#6b7280;font-size:12px">' + esc_(r.outlook.reason || '') + '</div></td>' +
            '<td style="padding:8px 0 8px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;white-space:nowrap;color:' +
            (r.outlook.tone === 'bad' ? '#b91c1c' : '#b45309') + '">' + esc_(r.outlook.verdict) + '</td></tr>'; }).join('') + '</table>' : '');
    }
  } catch (e) { goalsHtml = ''; }

  var inner =
    '<p>Here is how ' + esc_(company) + ' did in <b>' + esc_(label) + '</b>.</p>' +
    '<table style="width:100%;border-collapse:separate;border-spacing:6px;margin:8px 0 4px"><tr>' +
      big(rate !== null ? rate + '%' : '—', 'On time', rate !== null && rate < 70 ? '#b91c1c' : '#047857') +
      big(last.delivered, 'Jobs closed') +
      big(late, 'Delivered late', late ? '#b45309' : '#111827') +
      big(last.reworkLoops, 'Sent back') +
    '</tr></table>' +
    (trend ? '<p style="color:#6b7280;font-size:13px;margin-top:0">On-time delivery is ' + esc_(trend) + '.</p>' : '') +
    (top.length ? '<h3 style="font-size:15px;margin:22px 0 6px">Who carried the month</h3>' +
      '<table style="width:100%;border-collapse:collapse">' +
      top.map(function (r) { return person(r, r.score + ' · ' + r.delivered + ' closed'); }).join('') + '</table>' : '') +
    (watch.length ? '<h3 style="font-size:15px;margin:22px 0 6px">Worth a conversation</h3>' +
      '<table style="width:100%;border-collapse:collapse">' +
      watch.map(function (r) { return person(r, 'score ' + r.score); }).join('') + '</table>' +
      '<p style="color:#6b7280;font-size:12px">"See why" on the Reports tab shows exactly what pulled each score down.</p>' : '') +
    goalsHtml +
    '<h3 style="font-size:15px;margin:22px 0 6px">Right now</h3>' +
    infoTable_([['Overdue', String(last.overdueNow)], ['Waiting over 2 days for approval or review', String(stuck)],
                ['People scored last month', String(board.rows.length) + ' of ' + users.length]]) +
    btn_('Open the full report', CFG().siteUrl + '/?login=1') +
    '<p style="font-size:12px;color:#9ca3af">Sent on the 1st of each month to the Admins of ' + esc_(company) + '.</p>';

  return { subject: subject, html: mailShell_(label + ' at ' + company, inner),
           numbers: { onTime: rate, delivered: last.delivered, late: late, reworks: last.reworkLoops,
                      overdue: last.overdueNow, stuck: stuck, top: top.map(function (r) { return r.name; }),
                      watch: watch.map(function (r) { return r.name; }), label: label, goals: goalNums } };
}

/* ---- which companies, and a context to read each one ----------------------- */

function ownerReportCompanies_() {
  var d = SpreadsheetApp.openById(CFG().masterId).getSheetByName(TAB.DIRECTORY).getDataRange().getValues();
  var out = [];
  for (var i = 1; i < d.length; i++) {
    var email = String(d[i][1] || '').trim().toLowerCase(), sheetId = String(d[i][5] || '').trim();
    if (!sheetId || email === DEMO_EMAIL) continue;
    out.push({ company: String(d[i][0] || sheetId), email: email, sheetId: sheetId });
  }
  return out;
}

/** The company read as its first active Admin, view-only: nothing is signed in. */
function ownerReportCtx_(sheetId) {
  var ss = SpreadsheetApp.openById(sheetId);
  var users = ss.getSheetByName(TAB.USERS).getDataRange().getValues();
  var admin = null;
  for (var i = 1; i < users.length; i++) {
    if (users[i][U['Role']] === ROLE.ADMIN && users[i][U['Active']] !== false && String(users[i][U['Active']]).toUpperCase() !== 'FALSE') {
      admin = String(users[i][U['Username']]); break;
    }
  }
  if (!admin) return null;
  return tenantContext_({ sheetId: sheetId, username: admin, viewOnly: true });
}

/* "sent 2026-11", not "2026-11": Sheets reads a bare "2026-11" as a date and
   it would never match again, so every Admin would get it three times. */
function ownerReportAlreadySent_(sheetId, month) {
  try {
    var sh = SpreadsheetApp.openById(sheetId).getSheetByName(TAB.SETTINGS);
    if (!sh || !sh.getLastRow()) return false;
    var d = sh.getRange(1, 4, sh.getLastRow(), 2).getValues();
    for (var i = 0; i < d.length; i++) {
      if (String(d[i][0]).trim() === 'ownerReportSent') return String(d[i][1]).trim() === 'sent ' + month;
    }
  } catch (e) {}
  return false;
}

function ownerReportMonthKey_(now) {
  var r = periodRange('month', 1, now);
  return r.from.getFullYear() + '-' + ('0' + (r.from.getMonth() + 1)).slice(-2);
}
