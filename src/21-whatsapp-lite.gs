// ===========================================================================
// WHATSAPP (LITE) — two messages per task, sent through Maytapi
// ===========================================================================
//
// Domebox Lite only. The full edition never sends from here: waLiteCfg_()
// returns null there, and every entry point checks it first.
//
// What is sent, to the person doing the task, on the number in their Team
// profile:
//   1. when the task is assigned (or, if it needed approval, when approved)
//   2. once, two days before it is due, if it is still To do or under way
//
// The Maytapi account is read from Script Properties, never from this file:
//   MAYTAPI_PRODUCT_ID, MAYTAPI_TOKEN, MAYTAPI_PHONE_ID
// No properties, no messages — the rest of Lite works exactly as before.
//
// Every attempt is written to a WhatsApp_Log tab in the company's own
// spreadsheet. The log is also what stops a message going twice: a retry, a
// manual run of the daily job or a second approval sends nothing new. Only the
// last four digits of a number are kept in it.
//
// Operator: run waLiteTest('98XXXXXXXX') once to check the account, then
// switchOnSchedules (or switchOnWhatsApp) to start the daily 9 am reminder.

var WA_LITE_LOG = 'WhatsApp_Log';
var WA_LITE_DAYS_BEFORE = 2;
var WA_LITE_HOUR = 9;
var WA_LITE_TIME_BUDGET_MS = 4.5 * 60 * 1000;

function waLiteCfg_() {
  if (!isLite_()) return null;
  var p = PropertiesService.getScriptProperties();
  var pid = String(p.getProperty('MAYTAPI_PRODUCT_ID') || '').trim();
  var token = String(p.getProperty('MAYTAPI_TOKEN') || '').trim();
  var phoneId = String(p.getProperty('MAYTAPI_PHONE_ID') || '').trim();
  if (!pid || !token || !phoneId) return null;
  return { pid: pid, token: token, phoneId: phoneId };
}

/** An Indian mobile as typed in Team ("098300 12345", "+91 98300-12345") to 919830012345. */
function waLiteNumber_(raw) {
  var d = String(raw || '').replace(/\D/g, '');
  if (d.indexOf('00') === 0) d = d.slice(2);
  if (d.length === 11 && d.charAt(0) === '0') d = d.slice(1);
  if (d.length === 10) d = '91' + d;
  return d.length >= 11 && d.length <= 15 ? d : '';
}

/** One text message. Returns { ok, detail }; never throws. */
function waLiteSend_(cfg, number, text) {
  try {
    var res = UrlFetchApp.fetch('https://api.maytapi.com/api/' + encodeURIComponent(cfg.pid) + '/' +
      encodeURIComponent(cfg.phoneId) + '/sendMessage', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-maytapi-key': cfg.token },
      payload: JSON.stringify({ to_number: number, type: 'text', message: text }),
    });
    var code = res.getResponseCode(), body = {};
    try { body = JSON.parse(res.getContentText() || '{}'); } catch (e) {}
    if (code >= 200 && code < 300 && body.success !== false) return { ok: true, detail: '' };
    return { ok: false, detail: 'HTTP ' + code + (body.message ? ': ' + String(body.message).slice(0, 200) : '') };
  } catch (e) {
    return { ok: false, detail: String(e.message || e).slice(0, 200) };
  }
}

function waLiteLogSheet_(ss) {
  return mkTab_(ss, WA_LITE_LOG, ['When', 'Task ID', 'Kind', 'To', 'Status', 'Detail']);
}

/** "taskId|kind" for every message already sent from this spreadsheet. */
function waLiteSentSet_(ss) {
  var sh = ss.getSheetByName(WA_LITE_LOG), seen = {};
  if (!sh) return seen;
  sh.getDataRange().getValues().slice(1).forEach(function (r) {
    if (String(r[4]) === 'sent') seen[String(r[1]) + '|' + String(r[2])] = true;
  });
  return seen;
}

/** Sends unless already sent, and logs the attempt either way. */
function waLiteDeliver_(cfg, ss, seen, taskId, kind, phone, text) {
  if (seen[taskId + '|' + kind]) return 'already';
  var number = waLiteNumber_(phone);
  var log = waLiteLogSheet_(ss);
  if (!number) {
    log.appendRow([new Date(), taskId, kind, '', 'skipped', 'no valid mobile number in Team']);
    return 'nophone';
  }
  var r = waLiteSend_(cfg, number, text);
  log.appendRow([new Date(), taskId, kind, '…' + number.slice(-4), r.ok ? 'sent' : 'failed', r.detail]);
  if (r.ok) seen[taskId + '|' + kind] = true;
  return r.ok ? 'sent' : 'failed';
}

function waLiteDate_(s) {
  var d = s ? parseYmd(String(s)) : null;
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'd MMM yyyy') : 'no due date';
}

/**
 * The first message: the task is now on this person's list. Called after a
 * task is created straight to To do, and after an approval puts it there.
 * Never throws — a WhatsApp hiccup must not undo an assignment.
 */
function waLiteAssigned_(ctx, assignee, task) {
  try {
    var cfg = waLiteCfg_();
    if (!cfg || !assignee || assignee.active === false) return;
    var text = '*New task for you*' + (ctx.company ? ' — ' + ctx.company : '') + '\n\n' +
      task.title + '\n' +
      'Due: ' + waLiteDate_(task.due) + '\n' +
      'Assigned by: ' + (task.byName || '') + '\n' +
      'Ref: ' + task.id + '\n\n' +
      'Open Domebox Lite: ' + CFG().siteUrl;
    waLiteDeliver_(cfg, ctx.ss, waLiteSentSet_(ctx.ss), task.id, 'assigned', assignee.phone, text);
  } catch (e) {
    logError_('whatsapp:assigned', e.message);
  }
}

/** The day this task's reminder is due: WA_LITE_DAYS_BEFORE before the due date. */
function waLiteDueSoon_(task, today) {
  if (['Pending', 'In Progress'].indexOf(task.status) < 0 || task.isArchived || !task.due) return false;
  var due = parseYmd(task.due);
  if (!due) return false;
  var target = new Date(today.getFullYear(), today.getMonth(), today.getDate() + WA_LITE_DAYS_BEFORE);
  return ymd(due) === ymd(target);
}

/** The daily job: everyone whose task is due in two days gets one message for it. */
function waLiteDueReminders() {
  var cfg = waLiteCfg_();
  var out = ['', '=== WHATSAPP REMINDERS — due in ' + WA_LITE_DAYS_BEFORE + ' days ==='];
  if (!cfg) {
    out.push(isLite_() ? '  OFF     Maytapi is not set up — add MAYTAPI_PRODUCT_ID, MAYTAPI_TOKEN and MAYTAPI_PHONE_ID.'
                       : '  OFF     WhatsApp through Maytapi is part of Domebox Lite only.');
    return say_(out);
  }
  var today = new Date(), started = Date.now(), counts = { sent: 0, failed: 0, nophone: 0, already: 0 };
  var tenants = allTenants_();
  for (var i = 0; i < tenants.length; i++) {
    if (Date.now() - started > WA_LITE_TIME_BUDGET_MS) {
      out.push('  Time limit near — stopped before ' + tenants[i].company + '. Run waLiteDueReminders again; nothing sends twice.');
      break;
    }
    var ctx;
    try { ctx = { ss: SpreadsheetApp.openById(tenants[i].sheetId), sheetId: tenants[i].sheetId, company: tenants[i].company }; }
    catch (e) { out.push('  ' + tenants[i].company + ': cannot be opened (' + e.message + ') — skipped'); continue; }
    try {
      var people = {};
      readUsers_(ctx).forEach(function (u) { people[u.username] = u; });
      var seen = waLiteSentSet_(ctx.ss);
      readTasks_(ctx).forEach(function (t) {
        var who = people[t.assignee];
        if (!who || who.active === false || !waLiteDueSoon_(t, today)) return;
        var kind = 'due-' + t.due;   // a new due date earns a new reminder
        var text = '*Reminder: due in ' + WA_LITE_DAYS_BEFORE + ' days*\n\n' +
          t.title + '\n' +
          'Due: ' + waLiteDate_(t.due) + '\n' +
          'Assigned by: ' + (t.byName || '') + '\n' +
          'Ref: ' + t.id + '\n\n' +
          'Open Domebox Lite: ' + CFG().siteUrl;
        counts[waLiteDeliver_(cfg, ctx.ss, seen, t.id, kind, who.phone, text)]++;
      });
    } catch (e) {
      out.push('  ' + tenants[i].company + ': STOPPED — ' + e.message);
    }
  }
  out.push('  sent ' + counts.sent + '   failed ' + counts.failed + '   no number ' + counts.nophone +
           '   already sent ' + counts.already);
  return say_(out);
}

/** Starts the daily reminder at about 9 am. Safe to run again. */
function switchOnWhatsApp() {
  var out = ['', '=== WHATSAPP ==='];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'waLiteDueReminders') ScriptApp.deleteTrigger(t);
  });
  if (!isLite_()) { out.push('  OFF     WhatsApp through Maytapi is part of Domebox Lite only.'); return say_(out); }
  ScriptApp.newTrigger('waLiteDueReminders').timeBased().atHour(WA_LITE_HOUR).everyDays(1).create();
  out.push('  ok      WhatsApp reminder ' + WA_LITE_DAYS_BEFORE + ' days before a task is due, daily around ' + WA_LITE_HOUR + ' am' +
           (waLiteCfg_() ? '' : ' — but Maytapi is not set up yet, so nothing is sent'));
  return say_(out);
}

/** Run from the editor with your own number to check the Maytapi account. */
function waLiteTest(phone) {
  var cfg = waLiteCfg_(), out = ['', '=== WHATSAPP TEST ==='];
  if (!cfg) { out.push('  OFF     ' + (isLite_() ? 'Add MAYTAPI_PRODUCT_ID, MAYTAPI_TOKEN and MAYTAPI_PHONE_ID to Script Properties.'
                                                  : 'WhatsApp through Maytapi is part of Domebox Lite only.')); return say_(out); }
  var number = waLiteNumber_(phone);
  if (!number) { out.push('  Give a mobile number, e.g. waLiteTest(\'9830012345\').'); return say_(out); }
  var r = waLiteSend_(cfg, number, 'Domebox Lite: WhatsApp messages are working.');
  out.push(r.ok ? '  ok      test message sent to …' + number.slice(-4) : '  FAILED  ' + r.detail);
  return say_(out);
}

/** setupDomeBox, Lite: whether WhatsApp is ready. */
function waLiteSetupLines_(out) {
  out.push('');
  out.push('--- WHATSAPP (MAYTAPI) ---');
  var on = false;
  try { on = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'waLiteDueReminders'; }); } catch (e) {}
  if (!waLiteCfg_()) {
    out.push('  off     optional: add MAYTAPI_PRODUCT_ID, MAYTAPI_TOKEN and MAYTAPI_PHONE_ID to send');
    out.push('          a WhatsApp when a task is assigned and ' + WA_LITE_DAYS_BEFORE + ' days before it is due.');
  } else {
    out.push('  ok      a WhatsApp goes out when a task is assigned');
    out.push(on ? '  ok      and ' + WA_LITE_DAYS_BEFORE + ' days before it is due, daily around ' + WA_LITE_HOUR + ' am'
                : '  MISSING the due-date reminder is not switched on — run switchOnSchedules once.');
    out.push('          Each person needs a mobile number in Team.');
  }
}
