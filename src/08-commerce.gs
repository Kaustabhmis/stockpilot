// ===========================================================================
// PAYMENTS, AI, EMAIL
// ===========================================================================

function createRazorpayOrder_(ctx, planName, promoCode) {
  requireAdmin_(ctx);
  var c = CFG();
  if (!c.razorKey || !c.razorSecret) throw new Error('Online payment is not configured yet.');

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
  return { status: 'success', orderData: { key: c.razorKey, order_id: order.id,
    amount: order.amount, currency: 'INR', name: 'Dome Box',
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

function planForPaise_(paise) {
  for (var k in PLANS) if (PLANS[k].price && PLANS[k].price * 100 === Number(paise)) return k;
  return null;
}

/** Extends from the current expiry when it is still ahead, so renewing early
 *  adds time instead of discarding what is left. */
function grantPlan_(sheetId, planName, paid, company) {
  var dir = SpreadsheetApp.openById(CFG().masterId).getSheetByName(TAB.DIRECTORY);
  var d = dir.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][5]).trim() !== String(sheetId).trim()) continue;
    var cur = new Date(d[i][4]);
    var base = (!isNaN(cur) && cur > new Date()) ? cur : new Date();
    base.setDate(base.getDate() + (planName === 'Yearly' ? 365 : 30));
    var until = ymd(base);
    dir.getRange(i + 1, 4).setValue(planName);
    dir.getRange(i + 1, 5).setValue(until);
    dir.getRange(i + 1, 7).setValue('Active');
    try { sendEmail_(d[i][1], 'Dome Box — payment receipt',
      receiptHtml_(company || d[i][0], planName, paid, until)); } catch (e) {}
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
  var a = periodAnalytics(tasks, users, periodRange('month', 1), new Date(), cal);

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

function sendEmail_(to, subject, html) {
  if (!to) return false;
  var from = CFG().mailFrom;
  try {
    GmailApp.sendEmail(String(to).trim(), subject,
      'This email needs an HTML-capable client.',
      { htmlBody: html, name: 'Dome Box', from: from });
    return true;
  } catch (e) {
    /* GmailApp throws if `from` is not a verified alias on the sending account.
       MailApp ignores `from` and sends as the script owner, which is worse than
       nothing silently — so this is logged. */
    logError_('sendEmail:gmail', e.message + ' (is ' + from + ' a verified alias?)');
    try {
      MailApp.sendEmail({ to: String(to).trim(), subject: subject,
        body: 'This email needs an HTML-capable client.', htmlBody: html, name: 'Dome Box' });
      return true;
    } catch (e2) { logError_('sendEmail:mailapp', e2.message); return false; }
  }
}

function mailShell_(title, inner) {
  return '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;' +
    'max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">' +
    '<div style="background:#1e3a8a;color:#fff;padding:20px 24px">' +
    '<h2 style="margin:0;font-size:18px">' + esc_(title) + '</h2></div>' +
    '<div style="padding:24px;color:#374151;font-size:14px;line-height:1.6">' + inner + '</div>' +
    '<div style="padding:16px 24px;background:#f9fafb;color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb">' +
    'Dome Box · BISCS India · <a href="' + CFG().siteUrl + '" style="color:#2563eb">' +
    esc_(CFG().siteUrl.replace(/^https?:\/\//, '')) + '</a></div></div>';
}

function btn_(label, href) {
  return '<p style="text-align:center;margin:28px 0"><a href="' + esc_(href) + '" ' +
    'style="background:#2563eb;color:#fff;padding:12px 26px;text-decoration:none;' +
    'border-radius:8px;font-weight:bold;display:inline-block">' + esc_(label) + '</a></p>';
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
        btn_('Open Dome Box', CFG().siteUrl)));
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
    btn_('Open Dome Box', CFG().siteUrl)));
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
    btn_('Open Dome Box', CFG().siteUrl)));
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
        btn_('Open Dome Box', CFG().siteUrl)));
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
      btn_('Open Dome Box', CFG().siteUrl)));
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
    '<p>We received a request to reset your Dome Box password.</p>' +
    btn_('Set a new password', link) +
    '<p style="font-size:12px;color:#6b7280">This link works once and expires in one hour. ' +
    'If you did not ask for it, you can ignore this email — nothing has changed.</p>');
}

function sendWelcome_(email, name, company) {
  sendEmail_(email, 'Welcome to Dome Box', mailShell_('Your workspace is ready',
    '<p>Hi <strong>' + esc_(name) + '</strong>,</p>' +
    '<p><strong>' + esc_(company) + '</strong> is set up on Dome Box. You are on the Free plan ' +
    '— up to 5 people and 50 tasks a month, with 30 days to try everything.</p>' +
    '<p>Add your team first, then assign the first task.</p>' + btn_('Open Dome Box', CFG().siteUrl)));
}

function sendWelcomeStaff_(email, name, company, username) {
  sendEmail_(email, 'You have been added to Dome Box', mailShell_('Welcome to the team',
    '<p>Hi <strong>' + esc_(name) + '</strong>,</p>' +
    '<p>You have been added to <strong>' + esc_(company) + '</strong> on Dome Box.</p>' +
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
    '<p style="font-size:12px;color:#6b7280">A GST invoice follows separately.</p>');
}

function contactSales_(form) {
  form = form || {};
  sendEmail_(CFG().mailFrom, 'Enterprise enquiry — ' + String(form.companyName || 'unknown'),
    mailShell_('New enterprise enquiry', infoTable_([
      ['Name', form.name || ''], ['Company', form.companyName || ''],
      ['Email', form.email || ''], ['Phone', form.phone || '']]) +
      '<p>' + esc_(form.message || '') + '</p>'));
  return { status: 'success', message: 'Thanks — we will be in touch within one working day.' };
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

function handleRazorpayWebhook_(e, body) {
  /* The browser handler is not a source of truth: a customer who closes the tab
     mid-payment is charged and stays on Free. This fires from Razorpay. */
  try {
    var secret = PropertiesService.getScriptProperties().getProperty('RAZORPAY_WEBHOOK_SECRET');
    if (!secret) return json_({ status: 'ignored' });
    var raw = e.postData.contents;
    var sig = (e.parameter && e.parameter['x-razorpay-signature']) || '';
    var expected = hex_(Utilities.computeHmacSha256Signature(raw, secret));
    if (!eqConst_(expected, sig)) { logPayment_('WEBHOOK_REJECTED', '', 'bad signature'); return json_({ status: 'ignored' }); }

    var ent = ((body.payload || {}).payment || {}).entity || {};
    if (body.event === 'payment.captured' && ent.notes && ent.notes.sheetId) {
      var plan = ent.notes.plan || planForPaise_(ent.amount);
      if (plan) { grantPlan_(ent.notes.sheetId, plan, ent, ent.notes.company);
                  logPayment_('WEBHOOK_GRANTED', ent.notes.sheetId, plan); }
    }
  } catch (err) { logError_('webhook', err.message); }
  return json_({ status: 'ok' });
}
