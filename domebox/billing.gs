/**
 * DOME BOX — RAZORPAY WEBHOOK
 * =============================================================================
 * The browser handler is not a source of truth. If the customer closes the tab
 * or loses signal between paying and the callback firing, you are paid and they
 * stay on Free — and they will be furious, correctly. The webhook fires from
 * Razorpay's servers regardless of what the browser did.
 *
 * Every event is verified with HMAC-SHA256 against the webhook secret before it
 * is trusted. Without that, anyone who finds the URL can grant themselves
 * Enterprise by POSTing a JSON body.
 * =============================================================================
 */

var BILLING = {
  GRACE_DAYS: 7,            // after a failed renewal, before access is cut
  ALERT_TO: 'info@biscsindia.com',
  PLAN_BY_AMOUNT: {         // paise, as Razorpay sends them
    249900: 'Standard',
    1999900: 'Pro Yearly',
  },
};

// ===========================================================================
// PURE — unit-tested
// ===========================================================================

/** Which plan an amount buys. Unknown amounts never silently grant a tier. */
function planForAmount(paise, map) {
  var m = map || BILLING.PLAN_BY_AMOUNT;
  return m[Number(paise)] || null;
}

/**
 * The subset of Razorpay events worth acting on, and what each one means for
 * access. Anything not listed is acknowledged and ignored rather than guessed
 * at — acting on an event you do not understand is how access gets revoked by
 * accident.
 */
function billingIntent(event, payload) {
  var p = payload || {};
  switch (event) {
    case 'payment.captured':
      return { action: 'activate', amount: p.amount, paymentId: p.id,
               email: (p.notes && p.notes.email) || p.email || '' };
    case 'subscription.charged':
      return { action: 'activate', amount: p.amount, paymentId: p.id,
               email: (p.notes && p.notes.email) || '' };
    case 'payment.failed':
      return { action: 'grace', reason: (p.error_description || 'payment failed'),
               email: (p.notes && p.notes.email) || p.email || '' };
    case 'subscription.halted':
    case 'subscription.cancelled':
      return { action: 'suspend', reason: event,
               email: (p.notes && p.notes.email) || '' };
    case 'refund.created':
    case 'refund.processed':
      return { action: 'suspend', reason: 'refunded', email: (p.notes && p.notes.email) || '' };
    default:
      return { action: 'ignore', reason: 'unhandled event: ' + event };
  }
}

/** Constant-time-ish comparison; length is checked first so a short forgery fails fast. */
function safeEquals(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** When access should actually stop after a failed renewal. */
function graceUntil(failedOn, days) {
  return ymd(addDays(startOfDay(failedOn), days == null ? BILLING.GRACE_DAYS : days));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BILLING: BILLING, planForAmount: planForAmount, billingIntent: billingIntent,
    safeEquals: safeEquals, graceUntil: graceUntil,
  };
}

// ===========================================================================
// APPS SCRIPT I/O
// ===========================================================================

/**
 * Deploy this project as a Web App and give Razorpay the /exec URL
 * (Dashboard > Settings > Webhooks). Set RAZORPAY_WEBHOOK_SECRET in Script
 * Properties to the same secret you typed into Razorpay.
 *
 * Subscribe to: payment.captured, payment.failed, subscription.charged,
 * subscription.halted, subscription.cancelled, refund.processed
 *
 * NOTE: doPost is also used by the WhatsApp webhook. If both live in one
 * project, route on the payload — the router below does that.
 */
function handleRazorpayWebhook(e) {
  var out = ContentService.createTextOutput('ok');
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    var sig = (e && e.parameter && e.parameter['x-razorpay-signature']) ||
              (e && e.headers && (e.headers['x-razorpay-signature'] || e.headers['X-Razorpay-Signature'])) || '';
    var secret = PropertiesService.getScriptProperties().getProperty('RAZORPAY_WEBHOOK_SECRET') || '';

    if (!secret) { billingLog_('CONFIG', 'RAZORPAY_WEBHOOK_SECRET is not set — event rejected', raw); return out; }

    var expected = Utilities.computeHmacSha256Signature(raw, secret)
      .map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');

    if (!safeEquals(expected, sig)) {
      // Unsigned or wrongly signed: log and drop. Never act on it.
      billingLog_('REJECTED', 'signature mismatch', raw.slice(0, 500));
      return out;
    }

    var body = JSON.parse(raw);
    var event = body.event;
    var payload = ((body.payload || {}).payment || (body.payload || {}).subscription ||
                   (body.payload || {}).refund || {}).entity || {};
    var intent = billingIntent(event, payload);

    if (intent.action === 'ignore') { billingLog_('IGNORED', event, ''); return out; }
    if (!intent.email) {
      billingLog_('UNMATCHED', event + ' — no email in notes; cannot identify the customer', raw.slice(0, 800));
      billingAlert_('Dome Box: a paid event could not be matched to a customer',
        'Razorpay sent ' + event + ' with no identifying email in notes.\n\n' +
        'Add notes.email when you create the order, or match this one by hand.\n\n' + raw.slice(0, 2000));
      return out;
    }

    applyBillingIntent_(event, intent);
  } catch (err) {
    billingLog_('ERROR', err.message, '');
  }
  return out;   // always 200; Razorpay retries non-2xx and eventually disables the hook
}

function applyBillingIntent_(event, intent) {
  var reg = registrySheet_();
  if (!reg) { billingLog_('ERROR', 'registry unavailable', ''); return; }

  var rows = reg.getDataRange().getValues();
  var head = rows[0].map(function (h) { return normKey_(h); });
  var emailCol = firstIndexOf_(head, ['email', 'emailid', 'loginemail', 'adminemail', 'username']);
  var planCol  = firstIndexOf_(head, ['plan', 'subscription', 'tier']);
  var statusCol = firstIndexOf_(head, ['status', 'accountstatus']);
  var untilCol = firstIndexOf_(head, ['validuntil', 'graceuntil', 'expiry', 'expires']);

  if (emailCol < 0 || planCol < 0) {
    billingAlert_('Dome Box: registry is missing an email or plan column',
      'Could not apply ' + event + ' for ' + intent.email + '.');
    return;
  }

  for (var r = 1; r < rows.length; r++) {
    if (String(rows[r][emailCol]).trim().toLowerCase() !== String(intent.email).trim().toLowerCase()) continue;

    if (intent.action === 'activate') {
      var plan = planForAmount(intent.amount);
      if (!plan) {
        billingAlert_('Dome Box: payment of an unrecognised amount',
          intent.email + ' paid ' + (intent.amount / 100) + ' INR, which matches no plan.\n' +
          'Add it to BILLING.PLAN_BY_AMOUNT, then set their plan by hand.');
        billingLog_('UNKNOWN_AMOUNT', intent.email + ' ' + intent.amount, '');
        return;
      }
      reg.getRange(r + 1, planCol + 1).setValue(plan);
      if (statusCol > -1) reg.getRange(r + 1, statusCol + 1).setValue('Active');
      if (untilCol > -1)  reg.getRange(r + 1, untilCol + 1).setValue('');
      billingLog_('ACTIVATED', intent.email + ' → ' + plan, intent.paymentId || '');

    } else if (intent.action === 'grace') {
      if (statusCol > -1) reg.getRange(r + 1, statusCol + 1).setValue('Past Due');
      if (untilCol > -1)  reg.getRange(r + 1, untilCol + 1).setValue(graceUntil(new Date(), BILLING.GRACE_DAYS));
      billingLog_('GRACE', intent.email + ' — ' + intent.reason, '');
      billingAlert_('Dome Box: payment failed for ' + intent.email,
        intent.reason + '\n\nThey keep access until ' + graceUntil(new Date(), BILLING.GRACE_DAYS) + '.');

    } else if (intent.action === 'suspend') {
      // Downgrade, never delete. Their data stays; only access to paid features stops.
      reg.getRange(r + 1, planCol + 1).setValue('Free Tier');
      if (statusCol > -1) reg.getRange(r + 1, statusCol + 1).setValue('Suspended');
      billingLog_('SUSPENDED', intent.email + ' — ' + intent.reason, '');
      billingAlert_('Dome Box: ' + intent.email + ' suspended', intent.reason);
    }
    return;
  }

  billingLog_('NO_SUCH_CUSTOMER', intent.email + ' (' + event + ')', '');
  billingAlert_('Dome Box: paid event for an unknown email',
    intent.email + ' is not in the registry. Event: ' + event);
}

function registrySheet_() {
  try {
    if (!REG.SHEET_ID) return null;
    var ss = SpreadsheetApp.openById(REG.SHEET_ID);
    return REG.TAB ? ss.getSheetByName(REG.TAB) : ss.getSheets()[0];
  } catch (e) { return null; }
}

function firstIndexOf_(head, names) {
  for (var i = 0; i < names.length; i++) {
    var at = head.indexOf(names[i]);
    if (at > -1) return at;
  }
  return -1;
}

function billingLog_(kind, message, extra) {
  try {
    if (!REG.SHEET_ID) { Logger.log(kind + ': ' + message); return; }
    var ss = SpreadsheetApp.openById(REG.SHEET_ID);
    var sh = ss.getSheetByName('BillingLog');
    if (!sh) { sh = ss.insertSheet('BillingLog'); sh.appendRow(['when','kind','message','extra']); sh.setFrozenRows(1); }
    sh.appendRow([new Date(), kind, message, extra || '']);
  } catch (e) { Logger.log(kind + ': ' + message); }
}

function billingAlert_(subject, body) {
  try { MailApp.sendEmail({ to: BILLING.ALERT_TO, subject: subject, body: body, name: 'Dome Box' }); }
  catch (e) { Logger.log('billing alert failed: ' + e.message); }
}

/**
 * Single doPost for the project. WhatsApp and Razorpay both post here, so route
 * on the shape of the body rather than giving out two URLs.
 */
function domeboxWebhookRouter(e) {
  var raw = (e && e.postData && e.postData.contents) || '';
  if (raw.indexOf('"razorpay') > -1 || raw.indexOf('"payment"') > -1 ||
      (e && e.parameter && e.parameter['x-razorpay-signature'])) {
    return handleRazorpayWebhook(e);
  }
  return doPost(e);   // whatsapp.gs
}
