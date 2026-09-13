/**
 * DOME BOX — SCHEDULER: REMINDERS + RECURRING JOB GENERATION
 * =============================================================================
 * Add as another file in the Apps Script project. Requires domain.gs.
 *
 * This is the piece that turns Dome Box from a place where work is recorded
 * into a system that does the chasing for you. Two time-driven jobs:
 *
 *   sendDailyReminders()    one digest per person per day — their overdue work,
 *                           what is due today and tomorrow, what is waiting on
 *                           them to review or approve, and (for managers) their
 *                           team's badly overdue items.
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
};

var MAIL_FROM = 'info@biscsindia.com';
var MAIL_FROM_NAME = 'Dome Box';
var SITE_URL = 'https://www.domebox.in';

// ============================================================
// TRIGGER MANAGEMENT
// ============================================================

function installDomeBoxSchedules() {
  removeDomeBoxSchedules();
  ScriptApp.newTrigger('sendDailyReminders').timeBased().atHour(SCHED.SEND_HOUR).everyDays(1).create();
  // Runs earlier so today's generated work appears in today's digest.
  ScriptApp.newTrigger('generateRecurringJobs').timeBased().atHour(Math.max(0, SCHED.SEND_HOUR - 2)).everyDays(1).create();
  Logger.log('Installed:\n  generateRecurringJobs ~' + (SCHED.SEND_HOUR - 2) + ':00\n  sendDailyReminders  ~' + SCHED.SEND_HOUR + ':00');
}

function removeDomeBoxSchedules() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'sendDailyReminders' || fn === 'generateRecurringJobs') {
      ScriptApp.deleteTrigger(t); removed++;
    }
  });
  Logger.log('Removed ' + removed + ' existing Dome Box trigger(s).');
}

function domeBoxScheduleStatus() {
  var lines = ['', '=== Dome Box schedules ==='];
  var found = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['sendDailyReminders', 'generateRecurringJobs'].indexOf(t.getHandlerFunction()) > -1) {
      found++;
      lines.push('  ' + t.getHandlerFunction() + '  (' + t.getEventType() + ')');
    }
  });
  if (!found) lines.push('  none installed — run installDomeBoxSchedules()');
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

  var tenants = loadTenants_(log);
  if (!tenants) { Logger.log(log.join('\n')); return; }

  var sent = 0, skipped = 0, quietDays = 0;
  var today = new Date();
  var isAppraisalWindow = today.getDate() >= SCHED.APPRAISAL_REMINDER_DAY;

  for (var i = 0; i < tenants.length; i++) {
    var tenant = tenants[i];
    if (sent >= SCHED.MAX_EMAILS_PER_RUN) { log.push('  ! email cap reached — remaining tenants deferred to tomorrow'); break; }

    var data;
    try { data = readTenant_(tenant.sheetId); }
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

      var wantsAppraisalNudge = isAppraisalWindow && reports.length > 0 &&
        !alreadySent_(tenant.sheetId, user.username, 'appraisal-' + monthKey_(today));

      if (digest.isEmpty && !wantsAppraisalNudge) { quietDays++; continue; }
      if (alreadySent_(tenant.sheetId, user.username, 'digest-' + ymd(today))) { skipped++; continue; }

      var subject = digestSubject_(digest);
      var html = digestHtml_(digest, tenant.company, wantsAppraisalNudge, reports.length);

      log.push('    → ' + user.email + '  [' + subject + ']' +
        '  overdue:' + digest.buckets.overdue.length +
        ' today:' + digest.buckets.dueToday.length +
        ' review:' + digest.buckets.awaitingMyReview.length +
        ' approve:' + digest.buckets.awaitingMyApproval.length +
        ' team:' + digest.buckets.teamOverdue.length);

      if (!SCHED.DRY_RUN) {
        if (sendMail_(user.email, subject, html)) {
          markSent_(tenant.sheetId, user.username, 'digest-' + ymd(today));
          if (wantsAppraisalNudge) markSent_(tenant.sheetId, user.username, 'appraisal-' + monthKey_(today));
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

function digestSubject_(d) {
  var b = d.buckets;
  if (b.overdue.length) return b.overdue.length + ' task' + (b.overdue.length > 1 ? 's' : '') + ' overdue';
  if (b.awaitingMyApproval.length) return b.awaitingMyApproval.length + ' waiting on your approval';
  if (b.awaitingMyReview.length) return b.awaitingMyReview.length + ' ready for your review';
  if (b.dueToday.length) return b.dueToday.length + ' due today';
  if (b.teamOverdue.length) return 'Your team has overdue work';
  return 'Your Dome Box for today';
}

function digestHtml_(d, company, appraisalNudge, reportCount) {
  var b = d.buckets;
  var out = '<p>Good morning ' + esc_(firstName_(d.user.name)) + ',</p>';

  if (b.overdue.length) {
    out += section_('Overdue — needs attention now', b.overdue.map(function (t) {
      return row_(t, '<strong style="color:#b91c1c">' + t.daysOverdue + ' day' + (t.daysOverdue > 1 ? 's' : '') + ' late</strong>');
    }), '#b91c1c');
  }
  if (b.rework.length) {
    out += section_('Sent back for rework', b.rework.map(function (t) { return row_(t, 'rework ' + t.reworkCount + '×'); }), '#b45309');
  }
  if (b.dueToday.length) out += section_('Due today', b.dueToday.map(function (t) { return row_(t, 'today'); }), '#1d4ed8');
  if (b.dueTomorrow.length) out += section_('Due tomorrow', b.dueTomorrow.map(function (t) { return row_(t, 'tomorrow'); }), '#4b5563');

  if (b.awaitingMyApproval.length) {
    out += section_('Waiting on you to approve', b.awaitingMyApproval.map(function (t) {
      return row_(t, 'for ' + esc_(t.assigneeName || t.assignee));
    }), '#7048c4') +
      '<p style="font-size:12px;color:#6b7280;margin:-6px 0 14px">Nobody can start these until you decide, and the delay counts against your own responsiveness score.</p>';
  }
  if (b.awaitingMyReview.length) {
    out += section_('Ready for your review', b.awaitingMyReview.map(function (t) {
      return row_(t, 'from ' + esc_(t.assigneeName || t.assignee));
    }), '#7048c4');
  }
  if (b.teamOverdue.length) {
    out += section_('Your team — overdue ' + SCHED.ESCALATE_AFTER_DAYS + '+ days', b.teamOverdue.map(function (t) {
      return row_(t, esc_(t.assigneeName || t.assignee) + ' · ' + t.daysOverdue + 'd late');
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
    esc_(company || 'your workspace') + '. One email a day, and none at all on a clear day.</p>';
  return out;
}

function section_(title, rows, colour) {
  return '<div style="margin:16px 0 14px">' +
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:' + colour + ';margin-bottom:7px">' +
    esc_(title) + '</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13px">' + rows.join('') + '</table></div>';
}

function row_(t, right) {
  var pri = { High: '#dc2626', Medium: '#b45309', Low: '#2563eb' }[t.priority] || '#6b7280';
  return '<tr>' +
    '<td style="padding:7px 0;border-bottom:1px solid #f3f4f6;border-left:3px solid ' + pri + ';padding-left:9px">' +
    '<strong>' + esc_(t.title) + '</strong>' +
    (t.kra ? '<span style="color:#6b7280;font-size:11px"> · ' + esc_(t.kra) + '</span>' : '') +
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

  var tenants = loadTenants_(log);
  if (!tenants) { Logger.log(log.join('\n')); return; }

  var today = new Date();
  var createdTotal = 0;

  tenants.forEach(function (tenant) {
    var ss, sheet, headers, rows;
    try {
      ss = SpreadsheetApp.openById(tenant.sheetId);
      sheet = findTab_(ss, ['tasks', 'task', 'assignments', 'work']);
      if (!sheet) { log.push('  ' + tenant.company + ': no Tasks tab'); return; }
      headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      rows = sheet.getDataRange().getValues();
    } catch (e) {
      log.push('  ' + tenant.company + ': CANNOT OPEN (' + e.message + ')'); return;
    }

    var col = {};
    headers.forEach(function (h, i) { col[normKey_(h)] = i; });
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

      var plan = dueOccurrences({
        cadence: series.cadence, nextDue: ymd(series.due), active: true,
        endDate: '', maxOccurrences: 0, occurrencesCreated: 0,
        skipIfPreviousOpen: false,
      }, today, { previousOpen: previousOpen });

      // The occurrence already on the sheet is the first entry; skip it.
      var toCreate = plan.create.filter(function (d) { return d !== ymd(series.due); });
      if (!toCreate.length) return;

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

// ============================================================
// TENANT ACCESS
// ============================================================

function loadTenants_(log) {
  if (!REG.SHEET_ID) { log.push('REG.SHEET_ID is empty — set it at the top of reminders.gs.'); return null; }
  var reg, tab;
  try {
    reg = SpreadsheetApp.openById(REG.SHEET_ID);
    tab = REG.TAB ? reg.getSheetByName(REG.TAB)
                  : (reg.getSheetByName('Accounts') || findTab_(reg, ['accounts', 'registry', 'master', 'companies', 'tenants']));
  } catch (e) {
    log.push('Cannot open the registry: ' + e.message); return null;
  }
  if (!tab) { log.push('No registry tab found — set REG.TAB.'); return null; }

  var rows = tab.getDataRange().getValues();
  var col = {};
  (rows[0] || []).forEach(function (h, i) { col[normKey_(h)] = i; });
  var emailIdx = firstDefined_(col, ['email', 'emailid', 'username', 'loginid']);
  var sheetIdx = firstDefined_(col, ['sheetid', 'spreadsheetid', 'sheet', 'spreadsheet']);
  var compIdx = firstDefined_(col, ['companyname', 'company', 'organisation', 'organization']);
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
    out.push({ sheetId: sid, company: compIdx !== undefined ? String(rows[r][compIdx] || '') : '' });
  }
  log.push('Companies: ' + out.length);
  return out;
}

function readTenant_(sheetId) {
  var ss = SpreadsheetApp.openById(sheetId);

  var usersSheet = findTab_(ss, ['users', 'user', 'staff', 'employees', 'members']);
  var users = [];
  if (usersSheet) {
    var urows = usersSheet.getDataRange().getValues();
    var uc = {};
    (urows[0] || []).forEach(function (h, i) { uc[normKey_(h)] = i; });
    var uUser = firstDefined_(uc, ['username', 'loginid', 'email']);
    var uName = firstDefined_(uc, ['name', 'fullname']);
    var uMail = firstDefined_(uc, ['email', 'emailid', 'mail']);
    var uMgr = firstDefined_(uc, ['manager', 'reportsto', 'reportingmanager']);
    var uRole = firstDefined_(uc, ['role', 'usertype']);
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

  var tasksSheet = findTab_(ss, ['tasks', 'task', 'assignments', 'work']);
  var tasks = [];
  if (tasksSheet) {
    var trows = tasksSheet.getDataRange().getValues();
    var tc = {};
    (trows[0] || []).forEach(function (h, i) { tc[normKey_(h)] = i; });
    var g = function (row, names, dflt) {
      var idx = firstDefined_(tc, names);
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
      });
    }
  }

  var plan = 'Free Tier';
  var billing = ss.getSheetByName('Billing');
  if (billing && billing.getLastRow() > 1) {
    var brows = billing.getDataRange().getValues();
    var bc = {};
    (brows[0] || []).forEach(function (h, i) { bc[normKey_(h)] = i; });
    var pIdx = firstDefined_(bc, ['planname', 'plan']);
    if (pIdx !== undefined) plan = String(brows[1][pIdx] || 'Free Tier');
  }

  return { users: users, tasks: tasks, plan: plan };
}

// ============================================================
// SEND-ONCE LOG — so a retry or a manual run never double-mails anyone
// ============================================================

function reminderLog_(sheetId) {
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

function alreadySent_(sheetId, username, key) {
  var sheet = reminderLog_(sheetId);
  if (!sheet) return false;
  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i > 0; i--) {
    if (String(rows[i][0]) === sheetId && String(rows[i][1]) === username && String(rows[i][2]) === key) return true;
  }
  return false;
}

function markSent_(sheetId, username, key) {
  var sheet = reminderLog_(sheetId);
  if (sheet) sheet.appendRow([sheetId, username, key, new Date().toISOString()]);
}

// ============================================================
// HELPERS
// ============================================================

function sendMail_(to, subject, bodyHtml) {
  if (!to) return false;
  try {
    var options = { htmlBody: shell_(subject, bodyHtml), name: MAIL_FROM_NAME, replyTo: MAIL_FROM };
    try {
      var aliases = GmailApp.getAliases();
      if (aliases.indexOf(MAIL_FROM) > -1) options.from = MAIL_FROM;
      else Logger.log('WARNING: ' + MAIL_FROM + ' is not a verified send-as alias; sending as the script owner.');
    } catch (e) { /* alias lookup unavailable — still send */ }
    GmailApp.sendEmail(to, subject, plain_(bodyHtml), options);
    return true;
  } catch (e) {
    Logger.log('Mail failed to ' + to + ': ' + e.message);
    return false;
  }
}

function shell_(title, inner) {
  return '<div style="margin:0;padding:24px;background:#f3f4f6;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif">' +
    '<div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">' +
      '<div style="background:#1e3a8a;padding:18px 26px;color:#fff">' +
        '<div style="font-size:19px;font-weight:800">Dome Box</div>' +
        '<div style="font-size:12px;opacity:.8">' + esc_(title) + '</div>' +
      '</div>' +
      '<div style="padding:26px;color:#1f2937;font-size:14px;line-height:1.6">' + inner + '</div>' +
      '<div style="padding:16px 26px;background:#f9fafb;border-top:1px solid #e5e7eb;color:#6b7280;font-size:11px">' +
        'Dome Box · <a href="mailto:' + MAIL_FROM + '" style="color:#2563eb">' + MAIL_FROM + '</a>' +
      '</div>' +
    '</div></div>';
}

function plain_(html) {
  return String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function firstName_(n) { return String(n || '').trim().split(/\s+/)[0] || 'there'; }
function monthKey_(d) { return d.getFullYear() + '-' + (d.getMonth() + 1); }
function normKey_(h) { return String(h == null ? '' : h).toLowerCase().replace(/[\s_\-]/g, ''); }
function firstDefined_(map, names) {
  for (var i = 0; i < names.length; i++) if (map[names[i]] !== undefined) return map[names[i]];
  return undefined;
}
function findTab_(ss, names) {
  var sheets = ss.getSheets();
  for (var n = 0; n < names.length; n++) {
    for (var s = 0; s < sheets.length; s++) {
      if (normKey_(sheets[s].getName()) === normKey_(names[n])) return sheets[s];
    }
  }
  for (var n2 = 0; n2 < names.length; n2++) {
    for (var s2 = 0; s2 < sheets.length; s2++) {
      if (normKey_(sheets[s2].getName()).indexOf(normKey_(names[n2])) > -1) return sheets[s2];
    }
  }
  return null;
}
