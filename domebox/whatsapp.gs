/**
 * DOME BOX — WHATSAPP CHANNEL
 * =============================================================================
 * A second delivery channel for the reminder engine. The rules live in the pure
 * functions at the top (no I/O, unit-tested in Node); Apps Script I/O is below.
 *
 * SAFETY POSTURE — this runs against live customers, so it is deliberately hard
 * to fire by accident:
 *   WA.DRY_RUN  = true   nothing leaves the building
 *   WA.ALLOWLIST = [...] even when live, ONLY these numbers can be messaged
 * Both must be changed by hand. Clear the allowlist last, after you have seen
 * real messages arrive on your own handset.
 *
 * WHY OPT-IN IS ENFORCED AND NOT OPTIONAL
 * WhatsApp rates the quality of your sending number. Messaging people who did
 * not ask for it gets the number flagged, then throttled, then banned — and the
 * number is your company's, shared across every customer. One careless blast
 * takes the channel away from all of them, so a user with no recorded opt-in is
 * never messaged, and STOP takes effect immediately.
 * =============================================================================
 */

var WA = {
  ENABLED: false,              // master switch
  DRY_RUN: true,               // log only; never calls the API
  ALLOWLIST: [],               // E.164 numbers; when non-empty, nothing else is reachable
  PROVIDER: 'meta',            // 'meta' | 'generic'
  DEFAULT_CC: '91',            // India
  PAID_PLANS: ['Pro Yearly', 'Enterprise'],   // per the published pricing table
  QUIET_START: 21,             // no messages 21:00–08:00 local
  QUIET_END: 8,
  MAX_PER_TENANT_PER_DAY: 200,
  MAX_PER_RUN: 300,
  TIMEZONE: 'Asia/Kolkata',
};

/* Template names must match what Meta approved, exactly. */
var WA_TEMPLATES = {
  DIGEST:   'domebox_daily_digest',
  ASSIGNED: 'domebox_task_assigned',
  APPROVAL: 'domebox_approval_pending',
  OVERDUE:  'domebox_task_overdue',
};

// ===========================================================================
// PURE RULES — no I/O, unit-tested
// ===========================================================================

/**
 * India-first E.164 normalisation. Returns null for anything it cannot vouch
 * for: a wrong number is worse than no number, because it messages a stranger.
 */
function waNormalizePhone(raw, defaultCc) {
  var cc = String(defaultCc || '91');
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  var plus = s.charAt(0) === '+';
  var d = s.replace(/\D/g, '');
  if (!d) return null;

  if (plus) return d.length >= 8 && d.length <= 15 ? '+' + d : null;

  // 0-prefixed trunk form, e.g. 09876543210
  if (d.length === 11 && d.charAt(0) === '0') d = d.slice(1);

  if (d.length === 10) {
    // Indian mobiles start 6-9. A 10-digit number starting 0-5 is a landline or a typo.
    if (cc === '91' && '6789'.indexOf(d.charAt(0)) < 0) return null;
    return '+' + cc + d;
  }
  if (d.length === 12 && d.slice(0, 2) === '91' && cc === '91') {
    if ('6789'.indexOf(d.charAt(2)) < 0) return null;
    return '+' + d;
  }
  if (d.length >= 11 && d.length <= 15) return '+' + d;
  return null;
}

/** Quiet hours, so a reminder never lands at 3am. */
function waWithinQuietHours(hour, cfg) {
  var start = cfg && cfg.QUIET_START != null ? cfg.QUIET_START : 21;
  var end   = cfg && cfg.QUIET_END   != null ? cfg.QUIET_END   : 8;
  if (start === end) return false;
  return start > end ? (hour >= start || hour < end) : (hour >= start && hour < end);
}

/**
 * Every reason a message must not be sent, in one place, so the scheduler and
 * any manual send agree. Returns { ok, reason, to }.
 */
function waEligible(user, tenant, cfg) {
  cfg = cfg || WA;
  if (!cfg.ENABLED) return { ok: false, reason: 'channel disabled' };

  var paid = cfg.PAID_PLANS || [];
  if (paid.length && paid.indexOf(tenant && tenant.plan) < 0) {
    return { ok: false, reason: 'plan "' + (tenant && tenant.plan) + '" does not include WhatsApp' };
  }
  if (user.waOptOut) return { ok: false, reason: 'opted out' };
  if (!user.waOptIn)  return { ok: false, reason: 'no recorded opt-in' };

  var to = waNormalizePhone(user.phone || user.waPhone, cfg.DEFAULT_CC);
  if (!to) return { ok: false, reason: 'no usable phone number' };

  if ((cfg.ALLOWLIST || []).length && cfg.ALLOWLIST.indexOf(to) < 0) {
    return { ok: false, reason: 'not on the test allowlist' };
  }
  return { ok: true, to: to };
}

/**
 * Turns a digest into the one message worth sending, or null. WhatsApp is an
 * interruption on someone's personal phone, so it carries the single most
 * urgent thing rather than a list — the email digest is where detail belongs.
 */
function waPickTemplate(digest, user, opts) {
  opts = opts || {};
  if (!digest || digest.isEmpty) return null;
  var b = digest.buckets || {};
  var first = function (a) { return a && a.length ? a[0] : null; };

  var approve = first(b.awaitingMyApproval);
  if (approve) {
    return { template: WA_TEMPLATES.APPROVAL, key: 'wa-approval-' + approve.id,
      params: [ waFirstName(user.name), waWho(approve.assignee, opts.names),
                waTrim(approve.title), String(waDaysWaiting(approve, opts.today)) ] };
  }
  var overdue = first(b.overdue);
  if (overdue) {
    return { template: WA_TEMPLATES.OVERDUE, key: 'wa-overdue-' + overdue.id + '-' + opts.dateKey,
      params: [ waFirstName(user.name), waTrim(overdue.title),
                String(overdue.daysLate || waDaysWaiting(overdue, opts.today)), String(overdue.due || '') ] };
  }
  var counts = {
    overdue: (b.overdue || []).length,
    today: (b.dueToday || []).length,
    approvals: (b.awaitingMyApproval || []).length + (b.awaitingMyReview || []).length,
  };
  if (!counts.overdue && !counts.today && !counts.approvals) return null;
  return { template: WA_TEMPLATES.DIGEST, key: 'wa-digest-' + opts.dateKey,
    params: [ waFirstName(user.name), String(opts.dateLabel || ''),
              String(counts.overdue), String(counts.today), String(counts.approvals) ] };
}

/** Meta rejects a template parameter containing a newline or a tab. */
function waTrim(s, max) {
  var t = String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  max = max || 60;
  return t.length > max ? t.slice(0, max - 1) + '…' : (t || '—');
}
function waFirstName(n) { return waTrim(String(n || '').trim().split(/\s+/)[0] || 'there', 24); }
function waWho(username, names) { return waTrim((names && names[username]) || username || 'Someone', 40); }
function waDaysWaiting(task, today) {
  var due = parseYmd(task.due);
  if (!due) return 0;
  var n = dayDiff(today || new Date(), due);
  return n > 0 ? n : 0;
}

/** Meta Cloud API request body for a template message. */
function waBuildMetaPayload(to, template, params, lang) {
  return {
    messaging_product: 'whatsapp',
    to: String(to).replace(/^\+/, ''),      // Cloud API wants digits, no plus
    type: 'template',
    template: {
      name: template,
      language: { code: lang || 'en' },
      components: params && params.length
        ? [{ type: 'body', parameters: params.map(function (p) {
            return { type: 'text', text: String(p) }; }) }]
        : [],
    },
  };
}

/** STOP handling. Anything that reads as a refusal opts the number out. */
function waIsOptOut(text) {
  var t = String(text == null ? '' : text).trim().toLowerCase().replace(/[^a-z ]/g, '');
  return ['stop','unsubscribe','opt out','optout','cancel','band karo','bandh karo','mat bhejo']
    .indexOf(t) > -1;
}
function waIsOptIn(text) {
  var t = String(text == null ? '' : text).trim().toLowerCase().replace(/[^a-z ]/g, '');
  return ['start','subscribe','yes','opt in','optin'].indexOf(t) > -1;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WA: WA, WA_TEMPLATES: WA_TEMPLATES,
    waNormalizePhone: waNormalizePhone, waWithinQuietHours: waWithinQuietHours,
    waEligible: waEligible, waPickTemplate: waPickTemplate,
    waBuildMetaPayload: waBuildMetaPayload,
    waIsOptOut: waIsOptOut, waIsOptIn: waIsOptIn,
    waTrim: waTrim, waFirstName: waFirstName,
  };
}

// ===========================================================================
// APPS SCRIPT I/O
// ===========================================================================

/**
 * Credentials live in Script Properties, never in this file. Anyone who can
 * read the source can otherwise send as your company on WhatsApp, and the file
 * ends up in a repo, a backup and a support email.
 *
 * Set them once:  File > Project properties > Script properties
 *   WA_TOKEN            permanent access token
 *   WA_PHONE_ID         Cloud API phone number id
 *   WA_VERIFY_TOKEN     any random string; must match what you type into Meta
 *   WA_ENDPOINT         only for PROVIDER 'generic' (your BSP's URL)
 *   WA_HEADERS          only for 'generic'; JSON object of extra headers
 */
function waConfig_() {
  var p = PropertiesService.getScriptProperties();
  return {
    token:   p.getProperty('WA_TOKEN') || '',
    phoneId: p.getProperty('WA_PHONE_ID') || '',
    verify:  p.getProperty('WA_VERIFY_TOKEN') || '',
    endpoint: p.getProperty('WA_ENDPOINT') || '',
    headers: p.getProperty('WA_HEADERS') || '',
  };
}

function waCheckSetup() {
  var c = waConfig_(), out = ['=== WHATSAPP SETUP ==='];
  out.push('ENABLED        : ' + WA.ENABLED);
  out.push('DRY_RUN        : ' + WA.DRY_RUN + (WA.DRY_RUN ? '   (nothing will be sent)' : '   *** LIVE ***'));
  out.push('PROVIDER       : ' + WA.PROVIDER);
  out.push('ALLOWLIST      : ' + (WA.ALLOWLIST.length ? WA.ALLOWLIST.join(', ') : '(empty — every opted-in user is reachable)'));
  out.push('WA_TOKEN       : ' + (c.token ? 'set (' + c.token.length + ' chars)' : 'MISSING'));
  out.push('WA_PHONE_ID    : ' + (c.phoneId || 'MISSING'));
  out.push('WA_VERIFY_TOKEN: ' + (c.verify ? 'set' : 'MISSING — inbound webhook will fail'));
  out.push('Webhook URL    : deploy as a Web App, then paste that /exec URL into Meta');
  if (!WA.DRY_RUN && !WA.ALLOWLIST.length) {
    out.push('');
    out.push('!! LIVE with an empty allowlist: every opted-in user on a paid plan can be messaged.');
  }
  Logger.log(out.join('\n'));
}

/** One send. Returns { ok, id, error }. Never throws. */
function waSend_(to, template, params, lang) {
  if (WA.DRY_RUN) return { ok: true, id: 'dry-run', dryRun: true };
  var c = waConfig_();

  try {
    var url, options;
    if (WA.PROVIDER === 'meta') {
      if (!c.token || !c.phoneId) return { ok: false, error: 'WA_TOKEN / WA_PHONE_ID not set' };
      url = 'https://graph.facebook.com/v21.0/' + encodeURIComponent(c.phoneId) + '/messages';
      options = {
        method: 'post', contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + c.token },
        payload: JSON.stringify(waBuildMetaPayload(to, template, params, lang)),
        muteHttpExceptions: true,
      };
    } else {
      if (!c.endpoint) return { ok: false, error: 'WA_ENDPOINT not set for the generic provider' };
      var extra = {};
      try { extra = c.headers ? JSON.parse(c.headers) : {}; } catch (e) { return { ok: false, error: 'WA_HEADERS is not valid JSON' }; }
      url = c.endpoint;
      options = {
        method: 'post', contentType: 'application/json', headers: extra,
        payload: JSON.stringify({ to: to, template: template, params: params, language: lang || 'en' }),
        muteHttpExceptions: true,
      };
    }

    var res = UrlFetchApp.fetch(url, options);
    var code = res.getResponseCode();
    var body = res.getContentText();
    if (code >= 200 && code < 300) {
      var id = '';
      try { var j = JSON.parse(body); id = (j.messages && j.messages[0] && j.messages[0].id) || ''; } catch (e) {}
      return { ok: true, id: id };
    }
    return { ok: false, error: 'HTTP ' + code + ' ' + String(body).slice(0, 300) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ---- opt-in ledger: one tab in the tenant's own spreadsheet -------------- */
function waLedger_(sheetId) {
  var ss = SpreadsheetApp.openById(sheetId);
  var sh = ss.getSheetByName('WhatsAppOptIn');
  if (!sh) {
    sh = ss.insertSheet('WhatsAppOptIn');
    sh.appendRow(['username', 'phone', 'optIn', 'optInAt', 'optOutAt', 'source']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function waReadOptIns_(sheetId) {
  var rows = waLedger_(sheetId).getDataRange().getValues();
  var map = {};
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    map[String(r[0]).toLowerCase()] = {
      phone: r[1], optIn: r[2] === true || String(r[2]).toLowerCase() === 'true' || String(r[2]) === 'yes',
      optOutAt: r[4] || '',
    };
  }
  return map;
}

function waRecordOptIn(sheetId, username, phone, source) {
  var sh = waLedger_(sheetId);
  var norm = waNormalizePhone(phone, WA.DEFAULT_CC);
  if (!norm) throw new Error('That phone number is not usable: ' + phone);
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase() === String(username).toLowerCase()) {
      sh.getRange(i + 1, 2, 1, 5).setValues([[norm, true, new Date(), '', source || 'app']]);
      return norm;
    }
  }
  sh.appendRow([username, norm, true, new Date(), '', source || 'app']);
  return norm;
}

function waRecordOptOut(sheetId, username) {
  var sh = waLedger_(sheetId), rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase() === String(username).toLowerCase()) {
      sh.getRange(i + 1, 3).setValue(false);
      sh.getRange(i + 1, 5).setValue(new Date());
      return true;
    }
  }
  return false;
}

/* ---- the scheduled run --------------------------------------------------- */
function previewWhatsAppReminders() {
  var was = WA.DRY_RUN, wasEnabled = WA.ENABLED;
  WA.DRY_RUN = true; WA.ENABLED = true;
  try { sendWhatsAppReminders(); } finally { WA.DRY_RUN = was; WA.ENABLED = wasEnabled; }
}

function sendWhatsAppReminders() {
  var log = ['', '=== WHATSAPP ' + new Date().toDateString() + ' ===',
    WA.DRY_RUN ? '*** DRY RUN — nothing will be sent ***' : '*** LIVE ***',
    WA.ALLOWLIST.length ? 'Allowlist active: ' + WA.ALLOWLIST.join(', ') : 'No allowlist — all opted-in users reachable', ''];

  if (!WA.ENABLED) { log.push('Channel disabled (WA.ENABLED = false). Nothing done.'); Logger.log(log.join('\n')); return; }

  var today = new Date();
  var hour = Number(Utilities.formatDate(today, WA.TIMEZONE, 'H'));
  if (waWithinQuietHours(hour, WA)) {
    log.push('Quiet hours (' + hour + ':00 ' + WA.TIMEZONE + '). Nothing sent.');
    Logger.log(log.join('\n')); return;
  }

  var tenants = loadTenants_(log);
  if (!tenants) { Logger.log(log.join('\n')); return; }

  var dateKey = ymd(today);
  var dateLabel = Utilities.formatDate(today, WA.TIMEZONE, 'd MMM');
  var sent = 0, blocked = 0, quiet = 0;

  for (var i = 0; i < tenants.length && sent < WA.MAX_PER_RUN; i++) {
    var tenant = tenants[i], data;
    try { data = readTenant_(tenant.sheetId); }
    catch (e) { log.push('  ' + tenant.company + ': CANNOT OPEN (' + e.message + ')'); continue; }

    if (WA.PAID_PLANS.indexOf(data.plan) < 0) {
      log.push('  ' + tenant.company + ': skipped (' + data.plan + ' — WhatsApp is Pro/Enterprise only)');
      continue;
    }

    var optIns = waReadOptIns_(tenant.sheetId);
    var names = {};
    data.users.forEach(function (u) { names[u.username] = u.name; });
    log.push('  ' + (tenant.company || tenant.sheetId) + ' — ' + data.users.length + ' users');

    var tenantSent = 0;
    for (var u = 0; u < data.users.length; u++) {
      if (sent >= WA.MAX_PER_RUN) break;
      if (tenantSent >= WA.MAX_PER_TENANT_PER_DAY) { log.push('    ! tenant daily cap reached'); break; }

      var user = data.users[u];
      var led = optIns[String(user.username).toLowerCase()] || {};
      var merged = { name: user.name, username: user.username,
        phone: led.phone || user.phone, waOptIn: !!led.optIn, waOptOut: !!led.optOutAt };

      var elig = waEligible(merged, { plan: data.plan }, WA);
      if (!elig.ok) { blocked++; log.push('    – ' + user.username + ': ' + elig.reason); continue; }

      var reports = data.users.filter(function (x) { return x.manager === user.username; })
                             .map(function (x) { return x.username; });
      var digest = buildDigest(data.tasks, user, today, { reports: reports, escalateAfterDays: SCHED.ESCALATE_AFTER_DAYS });
      var msg = waPickTemplate(digest, user, { today: today, dateKey: dateKey, dateLabel: dateLabel, names: names });
      if (!msg) { quiet++; continue; }

      if (alreadySent_(tenant.sheetId, user.username, msg.key)) { continue; }

      log.push('    → ' + elig.to + '  [' + msg.template + ']  ' + JSON.stringify(msg.params));
      if (WA.DRY_RUN) { sent++; tenantSent++; continue; }

      var r = waSend_(elig.to, msg.template, msg.params);
      if (r.ok) { markSent_(tenant.sheetId, user.username, msg.key); sent++; tenantSent++; }
      else { log.push('      FAILED: ' + r.error); }
    }
  }

  log.push('');
  log.push('Sent: ' + sent + '   Blocked: ' + blocked + '   Nothing to say: ' + quiet);
  Logger.log(log.join('\n'));
}

/* ---- inbound webhook: delivery status and STOP --------------------------- */
function doGet(e) {
  // Meta's one-time webhook verification handshake.
  var p = (e && e.parameter) || {}, c = waConfig_();
  if (p['hub.mode'] === 'subscribe' && p['hub.verify_token'] === c.verify && c.verify) {
    return ContentService.createTextOutput(p['hub.challenge']);
  }
  return ContentService.createTextOutput('ok');
}

function doPost(e) {
  var ack = ContentService.createTextOutput('EVENT_RECEIVED');
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var entries = body.entry || [];
    for (var i = 0; i < entries.length; i++) {
      var changes = entries[i].changes || [];
      for (var j = 0; j < changes.length; j++) {
        var v = changes[j].value || {};
        (v.messages || []).forEach(function (m) {
          var text = m.text && m.text.body;
          if (waIsOptOut(text))      waHandleInbound_(m.from, false);
          else if (waIsOptIn(text))  waHandleInbound_(m.from, true);
        });
        (v.statuses || []).forEach(function (s) {
          if (s.status === 'failed') {
            Logger.log('WhatsApp delivery failed to ' + s.recipient_id + ': ' +
              JSON.stringify(s.errors || []));
          }
        });
      }
    }
  } catch (err) {
    Logger.log('WhatsApp webhook error: ' + err.message);
  }
  return ack;   // always 200, or Meta retries and eventually disables the webhook
}

/** A STOP arrives as a phone number, so every tenant ledger has to be checked. */
function waHandleInbound_(fromDigits, optIn) {
  var norm = waNormalizePhone('+' + String(fromDigits).replace(/\D/g, ''), WA.DEFAULT_CC);
  if (!norm) return;
  var tenants = loadTenants_([]) || [];
  for (var i = 0; i < tenants.length; i++) {
    try {
      var sh = waLedger_(tenants[i].sheetId), rows = sh.getDataRange().getValues();
      for (var r = 1; r < rows.length; r++) {
        if (String(rows[r][1]) === norm) {
          sh.getRange(r + 1, 3).setValue(!!optIn);
          sh.getRange(r + 1, optIn ? 4 : 5).setValue(new Date());
          Logger.log('WhatsApp ' + (optIn ? 'opt-in' : 'OPT-OUT') + ' recorded for ' + norm +
            ' in ' + tenants[i].company);
        }
      }
    } catch (e) { /* a tenant sheet we cannot open must not stop the others */ }
  }
}

/**
 * Event-driven: fire when a task is assigned, from wherever your assignment
 * code runs. Everything the scheduled job checks is checked here too — plan,
 * opt-in, allowlist, quiet hours — so there is no back door that bypasses them.
 * Returns { sent, reason }. Never throws: a notification must not fail a save.
 */
function waNotifyAssignment(sheetId, task, assigneeUser, tenantPlan, raisedByName) {
  try {
    if (!WA.ENABLED) return { sent: false, reason: 'channel disabled' };

    var hour = Number(Utilities.formatDate(new Date(), WA.TIMEZONE, 'H'));
    if (waWithinQuietHours(hour, WA)) return { sent: false, reason: 'quiet hours' };

    var led = (waReadOptIns_(sheetId) || {})[String(assigneeUser.username).toLowerCase()] || {};
    var merged = { name: assigneeUser.name, username: assigneeUser.username,
      phone: led.phone || assigneeUser.phone, waOptIn: !!led.optIn, waOptOut: !!led.optOutAt };

    var elig = waEligible(merged, { plan: tenantPlan }, WA);
    if (!elig.ok) return { sent: false, reason: elig.reason };

    var key = 'wa-assigned-' + task.id;
    if (alreadySent_(sheetId, assigneeUser.username, key)) return { sent: false, reason: 'already notified' };

    var params = [ waFirstName(assigneeUser.name), waTrim(raisedByName || 'Your manager', 40),
                   waTrim(task.title), waTrim(task.due || 'no date', 20) ];

    if (WA.DRY_RUN) {
      Logger.log('DRY RUN WhatsApp → ' + elig.to + ' [' + WA_TEMPLATES.ASSIGNED + '] ' + JSON.stringify(params));
      return { sent: false, reason: 'dry run' };
    }
    var r = waSend_(elig.to, WA_TEMPLATES.ASSIGNED, params);
    if (r.ok) { markSent_(sheetId, assigneeUser.username, key); return { sent: true }; }
    return { sent: false, reason: r.error };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

/** Install the daily WhatsApp run. Email schedules are installed separately. */
function installWhatsAppSchedule() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendWhatsAppReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendWhatsAppReminders').timeBased().atHour(9).everyDays(1).create();
  Logger.log('WhatsApp daily run installed for 09:00. WA.ENABLED is ' + WA.ENABLED +
    ', WA.DRY_RUN is ' + WA.DRY_RUN + '.');
}
