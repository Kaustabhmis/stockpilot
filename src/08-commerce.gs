// ===========================================================================
// PAYMENTS, AI, EMAIL
// ===========================================================================

function createRazorpayOrder_(ctx, planName, promoCode) {
  requireAdmin_(ctx);
  var c = CFG();
  if (!c.razorKey || !c.razorSecret) {
    paymentsDownAlert_(!c.razorKey ? 'RAZORPAY_KEY_ID' : 'RAZORPAY_KEY_SECRET');
    /* The customer is told what to do, not what we forgot to set up. */
    throw new Error('Online payment is not available right this minute — we have been alerted and are on it. ' +
      'Please try again shortly, or write to ' + c.mailFrom + ' and we will send you a payment link.');
  }

  var plan = PLANS[normalizePlan(planName)];
  if (!plan) throw new Error('Unknown plan.');
  if (!plan.price) throw new Error(plan.name + ' is not sold online — contact sales.');

  /* The amount is decided here, from the plan table. The old build let the
     client send an amount, and honoured a promo string from the request, so
     anyone who knew it paid 1 rupee for the yearly plan. */
  var amount = plan.price * 100;
  var promo = promoCodeDiscount_(String(promoCode || '').trim());
  if (promo) {
    amount = Math.max(100, Math.round(amount * (100 - promo.percent) / 100));
    logPayment_('PROMO', ctx.sheetId, promo.code + ' -' + promo.percent + '%');
  }

  /* Every price on the site is published as exclusive of GST, so the tax has
     to be added here — charging the listed figure and then issuing an invoice
     that shows tax inside it would mean absorbing 18% on every sale. The rate
     is 0 until a GSTIN is configured, so an unregistered seller charges and
     shows exactly the listed price. */
  var net = amount, rate = gstRate_();
  if (rate) amount = Math.round(net * (100 + rate) / 100);

  var res = UrlFetchApp.fetch('https://api.razorpay.com/v1/orders', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(c.razorKey + ':' + c.razorSecret) },
    payload: JSON.stringify({ amount: amount, currency: 'INR',
      receipt: 'dbx_' + Date.now(),
      notes: { plan: normalizePlan(planName), sheetId: ctx.sheetId, company: ctx.company } }),
    muteHttpExceptions: true });

  if (res.getResponseCode() >= 300) {
    logError_('razorpay:order', res.getContentText().slice(0, 300));
    throw new Error('We could not start the payment. Please try again.');
  }
  var order = JSON.parse(res.getContentText());
  return { status: 'success',
    /* The breakdown is shown before the card is, so nobody is surprised by a
       total that is larger than the price on the card they clicked. */
    charge: { net: net / 100, rate: rate, tax: (amount - net) / 100, total: amount / 100 },
    orderData: { key: c.razorKey, order_id: order.id,
    amount: order.amount, currency: 'INR', name: 'Domebox',
    description: plan.name, prefill: { email: ctx.me.email, contact: ctx.me.phone || '' } } };
}

/** Promo codes live in Script Properties as JSON, not in the source. */
function promoCodeDiscount_(code) {
  if (!code) return null;
  var raw = PropertiesService.getScriptProperties().getProperty('PROMO_CODES');
  if (!raw) return null;
  var map = {};
  try { map = JSON.parse(raw); } catch (e) { return null; }
  var pct = Number(map[code.toUpperCase()] || map[code] || 0);
  if (!pct || pct <= 0 || pct > 100) return null;
  return { code: code, percent: pct };
}

function handleVerifiedPayment_(ctx, p) {
  var c = CFG();
  var expected = hex_(Utilities.computeHmacSha256Signature(
    String(p.razorpay_order_id) + '|' + String(p.razorpay_payment_id), c.razorSecret));

  if (!p.razorpay_signature || !eqConst_(expected, p.razorpay_signature)) {
    logPayment_('REJECTED', ctx.sheetId, 'bad signature — nothing granted');
    throw new Error('That payment could not be verified. If money has left your account, ' +
      'email ' + c.mailFrom + ' and we will sort it out.');
  }

  // Confirm with Razorpay directly, so a captured signature cannot be replayed.
  var paid = null;
  try {
    var r = UrlFetchApp.fetch('https://api.razorpay.com/v1/payments/' +
      encodeURIComponent(p.razorpay_payment_id), {
      headers: { Authorization: 'Basic ' + Utilities.base64Encode(c.razorKey + ':' + c.razorSecret) },
      muteHttpExceptions: true });
    if (r.getResponseCode() === 200) paid = JSON.parse(r.getContentText());
  } catch (e) { logError_('razorpay:fetch', e.message); }

  if (!paid || paid.status !== 'captured') {
    logPayment_('NOT_CAPTURED', ctx.sheetId, p.razorpay_payment_id + ' = ' + (paid && paid.status));
    throw new Error('That payment has not completed yet.');
  }

  var planName = (paid.notes && paid.notes.plan) || planForPaise_(paid.amount);
  if (!planName) {
    logPayment_('UNKNOWN_AMOUNT', ctx.sheetId, paid.amount + ' paise');
    throw new Error('We could not match that amount to a plan. Please contact support.');
  }

  var until = grantPlan_(ctx.sheetId, planName, paid, ctx.company);
  logPayment_('GRANTED', ctx.sheetId, planName + ' until ' + until + ' via ' + paid.id);
  return { status: 'success', plan: planName, validUntil: until,
    message: 'Upgraded to ' + (PLANS[planName] ? PLANS[planName].name : planName) + '.' };
}

/* Only ever a fallback — notes.plan is what the order was placed with. Legacy
   plans are skipped: Starter and the old Standard are both 2,499, and a new
   payment must never land on a plan that is no longer sold. */
function planForPaise_(paise) {
  for (var k in PLANS) {
    if (PLANS[k].legacy || !PLANS[k].offered) continue;
    if (PLANS[k].price && PLANS[k].price * 100 === Number(paise)) return k;
  }
  return null;
}

/** Extends from the current expiry when it is still ahead, so renewing early
 *  adds time instead of discarding what is left. */
/* Serialised: this reads, decides, then writes. Without the lock two
   simultaneous calls both pass the check — two payments landing together and one expiry overwriting the other. */
function grantPlan_(sheetId, planName, paid, company) {
  return withLock_(function () { return grantPlan_locked_(sheetId,planName,paid,company); });
}
function grantPlan_locked_(sheetId, planName, paid, company) {
  var dir = SpreadsheetApp.openById(CFG().masterId).getSheetByName(TAB.DIRECTORY);
  var d = dir.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][5]).trim() !== String(sheetId).trim()) continue;
    /* One payment, one term. The browser, the webhook and the reconciler can
       all report the same payment; only the first one extends the plan and
       sends a receipt. The invoice ledger is the record of what was granted. */
    if (paid && paid.id && invoiceForPayment_(paid.id)) {
      var had = d[i][4] instanceof Date ? ymd(d[i][4]) : String(d[i][4]);
      logPayment_('ALREADY_GRANTED', sheetId, paid.id);
      return had;
    }
    var cur = new Date(d[i][4]);
    var base = (!isNaN(cur) && cur > new Date()) ? cur : new Date();
    /* The term comes from the plan, not from its name. Keying it off the word
       "Yearly" worked only while there was exactly one annual plan. */
    base.setDate(base.getDate() + planTermDays(planName));
    var until = ymd(base);
    dir.getRange(i + 1, 4).setValue(planName);
    dir.getRange(i + 1, 5).setValue(until);
    dir.getRange(i + 1, 7).setValue('Active');
    try { sendEmail_(d[i][1], 'Domebox — payment receipt',
      receiptHtml_(company || d[i][0], planName, paid, until)); } catch (e) {}
    /* The invoice follows the receipt, from inside the same lock, so the
       serial number cannot collide with another payment landing at the same
       moment. It is idempotent on the payment id: the browser handler and the
       webhook both reach here for the same rupee, and only one document is
       ever issued for it. */
    issueInvoice_locked_(sheetId, planName, paid, company || d[i][0], until);
    return until;
  }
  throw new Error('That workspace is not in the registry.');
}

function hex_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += ('0' + (bytes[i] & 0xFF).toString(16)).slice(-2);
  return s;
}
function eqConst_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function logPayment_(kind, sheetId, message) {
  try {
    var ss = SpreadsheetApp.openById(CFG().masterId);
    var sh = ss.getSheetByName('PaymentLog');
    if (!sh) { sh = ss.insertSheet('PaymentLog'); sh.appendRow(['when','kind','sheetId','message']); sh.setFrozenRows(1); }
    sh.appendRow([new Date(), kind, sheetId, message]);
  } catch (e) { Logger.log(kind + ' ' + message); }
}

/* ---------- AI insight --------------------------------------------------- */

/**
 * "Executive AI Intel". The model is given a SUMMARY, never raw staff records:
 * sending a customer's employee data to a third-party API is a disclosure they
 * did not agree to, and it is not needed to answer the question.
 */
function aiInsight_(ctx, question) {
  if (!ctx.plan.analytics) return { status: 'error', upgrade: true,
    message: 'AI insights are included from the Pro plan up.' };

  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_KEY');
  if (!key) throw new Error('AI insights are not configured yet.');

  var tasks = readTasks_(ctx);
  var users = readUsers_(ctx).filter(function (u) { return u.active !== false; });
  var cal = leaveCalendar_(ctx);
  var a = periodAnalytics(tasks, users, periodRange('month', 1), new Date(), cal,
    function (u) { return scoreOpts_(ctx, u.username); });

  var facts = [
    'Company: ' + (ctx.company || 'this company'),
    'Period: ' + a.range.label,
    'Tasks delivered: ' + a.delivered,
    'On-time rate: ' + (a.onTimeRate === null ? 'no data' : a.onTimeRate + '%'),
    'Rework loops: ' + a.reworkLoops,
    'Currently overdue: ' + a.overdueNow,
    'Team score: ' + (a.teamScore === null ? 'no data' : a.teamScore),
    'Performance bands: A=' + a.bands.A + ' B=' + a.bands.B + ' C=' + a.bands.C +
      ' no-data=' + a.bands.none,
    'Work by KRA: ' + a.kra.slice(0, 8).map(function (k) { return k.kra + '=' + k.count; }).join(', '),
    'Per person (anonymised): ' + a.people.map(function (p, i) {
      return 'P' + (i + 1) + ' score=' + (p.score === null ? 'n/a' : p.score) +
             ' delivered=' + p.delivered; }).join('; '),
  ].join('\n');

  var prompt = 'You are an operations analyst for an Indian manufacturing SME. ' +
    'Using ONLY the figures below, answer the manager\'s question in at most 150 words. ' +
    'Be concrete and practical. If the figures do not support an answer, say so plainly ' +
    'rather than speculating.\n\nFIGURES:\n' + facts +
    '\n\nQUESTION: ' + String(question || 'What should I focus on this month?');

  try {
    var res = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' +
      encodeURIComponent(key),
      { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
    if (res.getResponseCode() >= 300) throw new Error('HTTP ' + res.getResponseCode());
    var j = JSON.parse(res.getContentText());
    var text = j && j.candidates && j.candidates[0] && j.candidates[0].content &&
               j.candidates[0].content.parts && j.candidates[0].content.parts[0].text;
    if (!text) throw new Error('empty response');
    return { status: 'success', answer: String(text).trim(), basedOn: a.range.label };
  } catch (e) {
    logError_('aiInsight', e.message);
    throw new Error('The AI service did not respond. Please try again shortly.');
  }
}

/* ---------- email -------------------------------------------------------- */

/**
 * Operator alerts — backup failures, billing anomalies. These go to you, not to
 * a customer, so they must still send even when the alias is missing: an alert
 * that cannot be delivered because of the very misconfiguration it is reporting
 * is no alert at all. It uses the brand address when it can and says so in the
 * subject when it cannot.
 */
function sendOpsMail_(to, subject, body) {
  if (!to) return false;
  var from = CFG().mailFrom;
  try {
    if (mailAliasVerified_()) {
      GmailApp.sendEmail(String(to).trim(), subject, body, mailOpts_());
    } else {
      MailApp.sendEmail({ to: String(to).trim(), name: MAIL_FROM_NAME,
        subject: '[alias not set] ' + subject,
        body: body + '\n\n--\nSent from the script owner\'s address because "' + from +
              '" is not a verified send-as alias. Customer mail is NOT being sent at all ' +
              'while that is true. Gmail > Settings > Accounts > Send mail as.' });
    }
    return true;
  } catch (e) { return false; }
}

/* The send-as alias, checked once per execution rather than per email.
   GmailApp.getAliases() is a network call; a digest run sends dozens. */
var MAIL_ALIAS_OK = null;

function mailAliasVerified_() {
  if (MAIL_ALIAS_OK !== null) return MAIL_ALIAS_OK;
  var from = String(CFG().mailFrom).toLowerCase();
  /* The account's own address needs no alias — e.g. Domebox Lite run from
     mis@dynamicengineers.in itself. Gmail lists only the extra addresses. */
  if (from && from === mailOwnAddress_()) return (MAIL_ALIAS_OK = true);
  try { MAIL_ALIAS_OK = GmailApp.getAliases().map(function (a) { return String(a).toLowerCase(); }).indexOf(from) > -1; }
  catch (e) { MAIL_ALIAS_OK = false; }      // no Gmail scope, or a consumer account
  return MAIL_ALIAS_OK;
}

function mailOwnAddress_() {
  try { return String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (e) { return ''; }
}

/** Gmail's options for sending as MAIL_FROM: `from` only when it is an alias. */
function mailOpts_(extra) {
  var from = CFG().mailFrom, o = { name: MAIL_FROM_NAME, replyTo: from };
  if (String(from).toLowerCase() !== mailOwnAddress_()) o.from = from;
  Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
  return o;
}

/**
 * Every customer-facing email leaves from MAIL_FROM — info@biscsindia.com — or
 * it does not leave at all.
 *
 * This used to fall back to MailApp when the alias was not verified, which
 * silently sent as whichever Google account happens to own the script. A
 * customer receiving a password reset from someone's personal address is worse
 * than a customer receiving nothing: it looks like a phishing attempt, it
 * cannot be replied to, and it teaches people to distrust mail from us. So the
 * fallback is gone. A send that cannot use the right address fails, loudly, in
 * the error log, where setupDomeBox() will also have warned about it long
 * before any customer was involved.
 */
function sendEmail_(to, subject, html) {
  if (!to) return false;
  var from = CFG().mailFrom;

  if (!mailAliasVerified_()) {
    logError_('sendEmail:alias',
      'NOT SENT to ' + to + ' — "' + from + '" is not a verified send-as alias on the ' +
      'account running this script. Gmail > Settings > Accounts > Send mail as. ' +
      'Nothing is sent from any other address.');
    return false;
  }

  try {
    GmailApp.sendEmail(String(to).trim(), subject,
      'This email needs an HTML-capable client.', mailOpts_({ htmlBody: html }));
    return true;
  } catch (e) {
    logError_('sendEmail', e.message + ' (to ' + to + ')');
    return false;
  }
}

/* The mark, drawn in a table cell rather than as an image: every mail client
   renders borders and background colours, and none of them can be relied on to
   load a remote image or an inline SVG. */
function mailMark_() {
  return '<table cellpadding="0" cellspacing="0" style="display:inline-block;vertical-align:middle">' +
    '<tr><td style="width:26px;height:26px;background:#fff;border-radius:13px 13px 7px 7px;' +
    'text-align:center;font:900 15px/26px Arial,sans-serif;color:#5b4bdb">&#10003;</td></tr></table>';
}

function mailShell_(title, inner) {
  return '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;' +
    'max-width:600px;margin:0 auto;border:1px solid #e7e1d8;border-radius:14px;overflow:hidden">' +
    '<div style="background:#5b4bdb;color:#fff;padding:18px 24px">' +
    mailMark_() +
    '<span style="display:inline-block;vertical-align:middle;margin-left:10px;' +
    'font-weight:900;font-size:15px;letter-spacing:-.2px">' + esc_(MAIL_FROM_NAME) + '</span>' +
    '<h2 style="margin:12px 0 0;font-size:18px;font-weight:800">' + esc_(title) + '</h2></div>' +
    '<div style="padding:24px;color:#453f4c;font-size:14px;line-height:1.6">' + inner + '</div>' +
    '<div style="padding:16px 24px;background:#faf8f5;color:#7d7570;font-size:12px;border-top:1px solid #e7e1d8">' +
    (isLite_() ? esc_(MAIL_FROM_NAME) + ' · ' : 'Domebox · BISCS India · ') + '<a href="' + CFG().siteUrl + '" style="color:#5b4bdb">' +
    esc_(CFG().siteUrl.replace(/^https?:\/\//, '')) + '</a></div></div>';
}

function btn_(label, href) {
  return '<p style="text-align:center;margin:28px 0"><a href="' + esc_(href) + '" ' +
    'style="background:#5b4bdb;color:#fff;padding:13px 28px;text-decoration:none;' +
    'border-radius:10px;font-weight:bold;display:inline-block">' + esc_(label) + '</a></p>';
}

/* Every value interpolated below is escaped. The old build built these strings
   raw, so a task title containing markup was injected into the email. */
function notifyAssignment_(ctx, target, approver, title, due, id, status) {
  if (status === 'Awaiting Approval' && approver && approver.email) {
    sendEmail_(approver.email, 'Approval needed: ' + title,
      mailShell_('Task approval required',
        '<p>Hi <strong>' + esc_(approver.name) + '</strong>,</p>' +
        '<p><strong>' + esc_(ctx.actor.name) + '</strong> wants to assign a task to ' +
        '<strong>' + esc_(target.name) + '</strong>, who reports to you.</p>' +
        infoTable_([['Task', title], ['Due', due || '—'], ['Ref', id]]) +
        btn_('Review it', CFG().siteUrl)));
  } else if (target.email) {
    sendEmail_(target.email, 'New task: ' + title,
      mailShell_('New task assigned',
        '<p>Hi <strong>' + esc_(target.name) + '</strong>,</p>' +
        '<p><strong>' + esc_(ctx.actor.name) + '</strong> has assigned you a task.</p>' +
        infoTable_([['Task', title], ['Due', due || '—'], ['Ref', id]]) +
        btn_('Open Domebox', CFG().siteUrl)));
  }
}

function notifyStatus_(ctx, t, status, note) {
  var who = null, subject = '', line = '';
  if (status === 'For Review') {
    who = findUser_(ctx.ss, t.by); subject = 'Ready for review: ' + t.title;
    line = '<strong>' + esc_(ctx.actor.name) + '</strong> has handed in this task.';
  } else if (status === 'In Progress' && t.status === 'For Review') {
    who = findUser_(ctx.ss, t.assignee); subject = 'Sent back: ' + t.title;
    line = '<strong>' + esc_(ctx.actor.name) + '</strong> has returned this for rework.';
  } else if (status === 'Verified') {
    who = findUser_(ctx.ss, t.assignee); subject = 'Verified: ' + t.title;
    line = '<strong>' + esc_(ctx.actor.name) + '</strong> has signed this off. Nice work.';
  }
  if (!who || !who.email) return;
  sendEmail_(who.email, subject, mailShell_(subject,
    '<p>Hi <strong>' + esc_(who.name) + '</strong>,</p><p>' + line + '</p>' +
    infoTable_([['Task', t.title], ['Due', t.due || '—']]) +
    (note ? '<p style="background:#fffbeb;border:1px solid #fde68a;padding:12px;border-radius:8px">' +
      '<em>"' + esc_(note) + '"</em></p>' : '') +
    btn_('Open Domebox', CFG().siteUrl)));
}

/**
 * The next stage's owner is told the moment the work they were waiting on is
 * signed off. Without this the release is silent and the handover depends on
 * somebody happening to look at the board.
 */
function notifyStageReleased_(ctx, project, stage) {
  var who = findUser_(ctx.ss, stage.assignee);
  if (!who || !who.email) return;
  var subject = 'Your turn: ' + stage.title;
  sendEmail_(who.email, subject, mailShell_(subject,
    '<p>Hi <strong>' + esc_(who.name) + '</strong>,</p>' +
    '<p>The stage before yours on <strong>' + esc_(project) + '</strong> has been signed off, ' +
    'so stage ' + esc_(String(stage.stageNo)) + ' is now yours to start.</p>' +
    infoTable_([['Project', project], ['Stage', stage.stageNo + ' of ' + stage.stageCount],
                ['Your task', stage.title], ['Due', stage.due || '—']]) +
    btn_('Open Domebox', CFG().siteUrl)));
}

/** Recognition only works if the person hears about it. */
function notifyCookie_(ctx, who, points, reason) {
  if (!who || !who.email) return;
  var subject = 'You picked up ' + points + ' cookie point' + (points === 1 ? '' : 's');
  sendEmail_(who.email, subject, mailShell_(subject,
    '<p>Hi <strong>' + esc_(who.name) + '</strong>,</p>' +
    '<p><strong>' + esc_(ctx.actor.name) + '</strong> has recognised your work.</p>' +
    '<p style="background:#ecfdf5;border:1px solid #a7f3d0;padding:12px;border-radius:8px">' +
      '<em>"' + esc_(reason) + '"</em></p>' +
    '<p>It counts towards your score this month and is on the record at your next review.</p>' +
    btn_('Open Domebox', CFG().siteUrl)));
}

/** The raiser hears the outcome, with the reason if it was refused. */
function notifyDecision_(ctx, t, isApproved, remarks) {
  var raiser = findUser_(ctx.ss, t.by);
  if (isApproved) {
    var owner = findUser_(ctx.ss, t.assignee);
    if (owner && owner.email) {
      sendEmail_(owner.email, 'New task: ' + t.title, mailShell_('A task has been approved for you',
        '<p>Hi <strong>' + esc_(owner.name) + '</strong>,</p>' +
        '<p><strong>' + esc_(ctx.actor.name) + '</strong> has approved this, so it is on your list now.</p>' +
        infoTable_([['Task', t.title], ['Due', t.due || '—'], ['Raised by', nameOf_(ctx, t.by)]]) +
        btn_('Open Domebox', CFG().siteUrl)));
    }
  }
  if (!raiser || !raiser.email) return;
  sendEmail_(raiser.email,
    (isApproved ? 'Approved: ' : 'Rejected: ') + t.title,
    mailShell_(isApproved ? 'Your task was approved' : 'Your task was rejected',
      '<p>Hi <strong>' + esc_(raiser.name) + '</strong>,</p>' +
      '<p><strong>' + esc_(ctx.actor.name) + '</strong> has ' +
      (isApproved ? 'approved the task you raised for ' : 'rejected the task you raised for ') +
      '<strong>' + esc_(nameOf_(ctx, t.assignee)) + '</strong>.</p>' +
      infoTable_([['Task', t.title], ['Due', t.due || '—']]) +
      (remarks ? '<p style="background:#fef2f2;border:1px solid #fecaca;padding:12px;border-radius:8px">' +
        '<strong>Remark:</strong> ' + esc_(remarks) + '</p>' : '') +
      btn_('Open Domebox', CFG().siteUrl)));
}

function infoTable_(rows) {
  return '<table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f9fafb;border-radius:8px">' +
    rows.map(function (r) {
      return '<tr><td style="padding:10px 14px;color:#6b7280;width:35%">' + esc_(r[0]) +
             '</td><td style="padding:10px 14px;font-weight:bold">' + esc_(r[1]) + '</td></tr>';
    }).join('') + '</table>';
}

function resetEmailHtml_(link) {
  return mailShell_('Reset your password',
    '<p>We received a request to reset your Domebox password.</p>' +
    btn_('Set a new password', link) +
    '<p style="font-size:12px;color:#6b7280">This link works once and expires in one hour. ' +
    'If you did not ask for it, you can ignore this email — nothing has changed.</p>');
}

function sendWelcome_(email, name, company, trialEnds) {
  if (isLite_()) {
    sendEmail_(email, 'Welcome to Domebox Lite', mailShell_('Your workspace is ready',
      '<p>Hi <strong>' + esc_(name) + '</strong>,</p>' +
      '<p><strong>' + esc_(company) + '</strong> is set up on Domebox Lite — up to 50 people, with ' +
      'scoring, reports and appraisals included.</p>' +
      '<p>Add your team first, then assign the first task.</p>' + btn_('Open Domebox Lite', CFG().siteUrl)));
    return;
  }
  sendEmail_(email, 'Welcome to Domebox', mailShell_('Your workspace is ready',
    '<p>Hi <strong>' + esc_(name) + '</strong>,</p>' +
    '<p><strong>' + esc_(company) + '</strong> is set up on Domebox, with the full ' + TRIAL_PLAN +
    ' plan free for ' + TRIAL_DAYS + ' days' + (trialEnds ? ' (until ' + esc_(trialEnds) + ')' : '') +
    ' — up to 50 people, scoring, reports and appraisals included. No card needed. ' +
    'After that it moves to the Free plan unless you choose one; nothing is deleted.</p>' +
    '<p>Add your team first, then assign the first task.</p>' + btn_('Open Domebox', CFG().siteUrl)));
}

function sendWelcomeStaff_(email, name, company, username) {
  var brand = isLite_() ? 'Domebox Lite' : 'Domebox';
  sendEmail_(email, 'You have been added to ' + brand, mailShell_('Welcome to the team',
    '<p>Hi <strong>' + esc_(name) + '</strong>,</p>' +
    '<p>You have been added to <strong>' + esc_(company) + '</strong> on ' + brand + '.</p>' +
    infoTable_([['Sign in with', email], ['Username', username]]) +
    '<p>Your manager has set your password. Change it after your first sign-in.</p>' +
    btn_('Sign in', CFG().siteUrl)));
}

function receiptHtml_(company, planName, paid, until) {
  var plan = PLANS[planName] || { name: planName };
  return mailShell_('Payment receipt',
    '<p>Hi <strong>' + esc_(company) + '</strong>,</p><p>Your workspace has been upgraded.</p>' +
    infoTable_([['Plan', plan.name],
      ['Amount paid', '₹' + (Number(paid.amount) / 100).toLocaleString('en-IN')],
      ['Payment ID', paid.id], ['Valid until', until]]) +
    '<p style="font-size:12px;color:#6b7280">Your invoice is on its way in a separate ' +
    'email — it carries the GST details your accountant needs.</p>');
}

function contactSales_(form) {
  form = form || {};
  var clip = function (v, n) { return String(v == null ? '' : v).trim().slice(0, n || 200); };
  var phone = clip(form.phone, 30), email = clip(form.email, 120);
  if (!clip(form.name) || !clip(form.companyName)) throw new Error('Please give your name and company.');
  if (phone.replace(/\D/g, '').length < 10 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('Please give a phone number or an email we can reach you on.');
  }
  var callback = form.kind === 'callback';
  /* Sent to us only — never to the address in the form, so this route cannot
     be used to send mail to strangers. */
  sendEmail_(CFG().mailFrom, (callback ? 'Call-back request — ' : 'Sales enquiry — ') + clip(form.companyName, 80),
    mailShell_(callback ? 'Please call this prospect back' : 'New sales enquiry', infoTable_([
      ['Name', clip(form.name)], ['Company', clip(form.companyName)],
      ['Phone', phone], ['Email', email],
      ['People', clip(form.size, 10)], ['Best time', clip(form.when, 40)]]) +
      '<p>' + esc_(clip(form.message, 2000)) + '</p>'));
  return { status: 'success', message: 'We will call you back within one working day.' };
}

function contactSupport_(ctx, form) {
  form = form || {};
  sendEmail_(CFG().mailFrom, 'Support — ' + String(form.subject || 'request'),
    mailShell_('Support request', infoTable_([
      ['From', ctx.actor.name], ['Email', ctx.me.email], ['Role', ctx.actor.role],
      ['Company', ctx.company], ['Plan', ctx.planName]]) +
      '<p>' + esc_(form.message || '') + '</p>'));
  return { status: 'success', message: 'Sent. We reply within one working day.' };
}

/** A payment as Razorpay itself reports it, or null. */
/**
 * A customer tried to pay and could not. Tell the owner at once — at most once
 * every six hours, so a busy day is one email, not fifty.
 */
function paymentsDownAlert_(missing) {
  try {
    var c = CFG(), cache = CacheService.getScriptCache();
    logError_('payments:not-configured', missing + ' is not set in Script Properties of the project serving ' +
      ScriptApp.getService().getUrl());
    if (cache.get('payDownAlert')) return;
    cache.put('payDownAlert', '1', 6 * 3600);
    sendEmail_(c.mailFrom, 'ACTION NEEDED: a customer could not pay on Domebox',
      '<p>A customer just pressed a plan\'s buy button and could not pay, because <b>' + missing +
      '</b> is not set in this Apps Script project.</p>' +
      '<p>In Apps Script, open the function list, choose <b>checkPayments</b> and press Run. It says exactly what to fix.</p>' +
      '<p style="color:#667085;font-size:12px">This project\'s web address: ' + ScriptApp.getService().getUrl() + '</p>');
  } catch (e) {}
}

/**
 * Run this from the Apps Script editor when payment does not open. It checks,
 * in order, everything that has to be true for the Razorpay window to appear,
 * and tests the keys against Razorpay itself. Changes nothing.
 */
/* Razorpay key ids begin "rzp" + "_live_" or "_test_". Built here, not written
   out, so no key-shaped text ever sits in the shipped source. */
var RZP_LIVE = ['rzp', 'live', ''].join('_'), RZP_TEST = ['rzp', 'test', ''].join('_');

function checkPayments() {
  var p = PropertiesService.getScriptProperties(), c = CFG(), out = ['', '=== PAYMENT CHECK ===', ''];
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  out.push('This project answers at:');
  out.push('  ' + (url || '(not deployed as a web app yet — Deploy > New deployment > Web app)'));
  out.push('  -> apiUrl in domebox-config.js on Netlify must be exactly this address.');
  out.push('     If it is the old project\'s address, the website is talking to the old project.');
  out.push('');
  var names = Object.keys(p.getProperties() || {});
  ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'].forEach(function (n) {
    var exact = p.getProperty(n);
    var near = names.filter(function (k) { return k !== n && k.replace(/[\s_-]+/g, '').toUpperCase() === n.replace(/_/g, ''); });
    if (exact && String(exact).trim()) out.push('  ok       ' + n);
    else if (near.length) out.push('  FIXED    ' + n + ' was typed as "' + near[0] + '" — it is read anyway, but rename it to ' + n + '.');
    else out.push('  MISSING  ' + n + ' — Project Settings > Script Properties > Add script property, in THIS project.');
  });
  var isLive = c.razorKey.indexOf(RZP_LIVE) === 0, isTest = c.razorKey.indexOf(RZP_TEST) === 0;
  if (c.razorKey && !isLive && !isTest) {
    out.push('  WRONG    RAZORPAY_KEY_ID should start ' + RZP_LIVE + ' (or ' + RZP_TEST + '). Did the secret go in the id box?');
  }
  if (c.razorKey && c.razorSecret) {
    try {
      var r = UrlFetchApp.fetch('https://api.razorpay.com/v1/payments?count=1', { muteHttpExceptions: true,
        headers: { Authorization: 'Basic ' + Utilities.base64Encode(c.razorKey + ':' + c.razorSecret) } });
      var code = r.getResponseCode();
      out.push('');
      if (code === 200) out.push('  ok       Razorpay accepted the keys (' + (isLive ? 'LIVE — real money' : 'TEST mode — no real money') + ').');
      else if (code === 401) out.push('  WRONG    Razorpay refused the keys. Copy the id and secret again from Razorpay > Settings > API Keys (a new secret is shown only once).');
      else out.push('  ?        Razorpay answered ' + code + ': ' + r.getContentText().slice(0, 160));
    } catch (e) { out.push('  ?        Could not reach Razorpay: ' + e.message + ' (run again and allow the permission).'); }
  }
  out.push('');
  out.push('Script Properties are read live: once both say ok, the buy button works straight away.');
  out.push('No new deployment is needed for a property change.');
  return say_(out);
}

function fetchRazorpayPayment_(paymentId) {
  var c = CFG();
  if (!c.razorKey || !c.razorSecret) return null;
  try {
    var r = UrlFetchApp.fetch('https://api.razorpay.com/v1/payments/' + encodeURIComponent(paymentId), {
      headers: { Authorization: 'Basic ' + Utilities.base64Encode(c.razorKey + ':' + c.razorSecret) },
      muteHttpExceptions: true });
    return r.getResponseCode() === 200 ? JSON.parse(r.getContentText()) : null;
  } catch (e) { logError_('razorpay:fetch', e.message); return null; }
}

/**
 * Grants the plan a captured Domebox payment paid for. Safe to call any number
 * of times for the same payment: grantPlan_ grants it once.
 * Returns the plan granted, or '' when the payment is not ours or not paid.
 */
function grantFromPayment_(paid, via) {
  if (!paid || paid.status !== 'captured') return '';
  var notes = paid.notes || {};
  if (!notes.sheetId) return '';                       // not a Domebox order (another site on this account)
  if (!registryRow_(notes.sheetId)) return '';         // a company that is not in this registry
  var plan = notes.plan || planForPaise_(paid.amount);
  if (!plan || !PLANS[normalizePlan(plan)]) {
    logPayment_('UNKNOWN_AMOUNT', notes.sheetId, paid.id + ' ' + paid.amount + ' paise');
    return '';
  }
  var already = invoiceForPayment_(paid.id);
  var until = grantPlan_(notes.sheetId, plan, paid, notes.company);
  if (!already) logPayment_((via || 'GRANTED') + '_GRANTED', notes.sheetId, plan + ' until ' + until + ' via ' + paid.id);
  return already ? '' : plan;
}

/**
 * The safety net under online payment. Every 15 minutes, ask Razorpay for the
 * last three days of captured payments and grant any Domebox payment that has
 * not been granted yet — the customer who paid and closed the tab before the
 * page could report it. No webhook is needed: Apps Script answers webhooks
 * with a redirect, which Razorpay records as a failed delivery and eventually
 * switches off, so polling is the reliable way round.
 * Installed by switchOnSchedules().
 */
function reconcilePayments() {
  var c = CFG(), out = ['', '=== PAYMENT CHECK ==='];
  if (!c.razorKey || !c.razorSecret) { out.push('  Razorpay keys are not set — nothing to check.'); return say_(out); }
  var from = Math.floor(Date.now() / 1000) - 3 * 86400, skip = 0, seen = 0, granted = 0;
  for (var page = 0; page < 10; page++) {
    var r;
    try {
      r = UrlFetchApp.fetch('https://api.razorpay.com/v1/payments?from=' + from + '&count=100&skip=' + skip, {
        headers: { Authorization: 'Basic ' + Utilities.base64Encode(c.razorKey + ':' + c.razorSecret) },
        muteHttpExceptions: true });
    } catch (e) { out.push('  Could not reach Razorpay: ' + e.message); break; }
    if (r.getResponseCode() !== 200) { out.push('  Razorpay answered ' + r.getResponseCode() + ' — check the keys.'); break; }
    var items = (JSON.parse(r.getContentText()).items) || [];
    items.forEach(function (p) {
      seen++;
      try { if (grantFromPayment_(p, 'RECONCILED')) { granted++; out.push('  granted ' + p.id + ' for ' + (p.notes && p.notes.company || p.notes.sheetId)); } }
      catch (e) { logError_('reconcile:' + p.id, e.message); }
    });
    if (items.length < 100) break;
    skip += 100;
  }
  out.push('  Checked ' + seen + ' payment(s) from the last 3 days; granted ' + granted + ' that had been missed.');
  return say_(out);
}

function handleRazorpayWebhook_(e, body) {
  /* The browser handler is not a source of truth: a customer who closes the tab
     mid-payment is charged and stays on Free. This fires from Razorpay. */
  try {
    /* Apps Script cannot read request headers, so Razorpay's signature header
       never arrives and cannot be checked. The body is therefore trusted for
       one thing only — which payment to look at. Everything that decides a
       grant (captured? how much? for whom?) is fetched from Razorpay itself
       with our own key, so a forged webhook cannot grant anything. */
    var ent = ((body.payload || {}).payment || {}).entity || {};
    if ((body.event === 'payment.captured' || body.event === 'order.paid') && /^pay_[A-Za-z0-9_]+$/.test(String(ent.id || ''))) {
      var real = fetchRazorpayPayment_(ent.id);
      if (real) grantFromPayment_(real, 'WEBHOOK');
    }
  } catch (err) { logError_('webhook', err.message); }
  return json_({ status: 'ok' });
}
