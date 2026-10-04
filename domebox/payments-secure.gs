/**
 * DOME BOX — PAYMENT VERIFICATION
 * =============================================================================
 * Replaces handlePaymentSuccess(sheetId, planName), which grants a plan because
 * the browser asked it to. Today this is a free upgrade for anyone:
 *
 *   POST {"action":"paymentSuccess","sheetId":"<their id>","planName":"Yearly"}
 *
 * Razorpay signs every successful payment. That signature is the only thing
 * worth trusting, because only Razorpay and you can produce it.
 *
 * FRONT-END CHANGE REQUIRED. The checkout handler must forward all three values
 * Razorpay returns — the current code discards them:
 *
 *   handler: function (response) {
 *     api('paymentSuccess', {
 *       razorpay_payment_id: response.razorpay_payment_id,
 *       razorpay_order_id:   response.razorpay_order_id,
 *       razorpay_signature:  response.razorpay_signature,
 *       planName: planName
 *     });
 *   }
 *
 * Note `function (response)` — not `function ()`. An empty parameter list throws
 * the signature away and no verification is possible.
 * =============================================================================
 */

function razorpayKeyId_() {
  var v = PropertiesService.getScriptProperties().getProperty('RAZORPAY_KEY_ID');
  if (!v) throw new Error('RAZORPAY_KEY_ID is not set in Script Properties.');
  return v;
}
function razorpaySecret_() {
  var v = PropertiesService.getScriptProperties().getProperty('RAZORPAY_KEY_SECRET');
  if (!v) throw new Error('RAZORPAY_KEY_SECRET is not set in Script Properties.');
  return v;
}

function hex_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += ('0' + (bytes[i] & 0xFF).toString(16)).slice(-2);
  return s;
}
function eq_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Razorpay signs `order_id|payment_id` with your key secret. */
function verifyRazorpaySignature(orderId, paymentId, signature) {
  if (!orderId || !paymentId || !signature) return false;
  var expected = hex_(Utilities.computeHmacSha256Signature(
    String(orderId) + '|' + String(paymentId), razorpaySecret_()));
  return eq_(expected, signature);
}

/**
 * Creates a real Razorpay order. The current initiateRazorpay invents an amount
 * client-side and never creates an order, which is why there is no order_id to
 * verify against afterwards.
 */
function createRazorpayOrder(planName) {
  var plan = PLANS[planName];
  if (!plan) throw new Error('Unknown plan: ' + planName);
  if (!plan.price) throw new Error(plan.name + ' is not sold online. Contact sales.');

  var res = UrlFetchApp.fetch('https://api.razorpay.com/v1/orders', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(razorpayKeyId_() + ':' + razorpaySecret_()) },
    payload: JSON.stringify({
      amount: plan.price * 100,          // paise, decided HERE, never by the client
      currency: 'INR',
      receipt: 'dbx_' + Date.now(),
      notes: { plan: planName }
    }),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() >= 300) {
    throw new Error('Razorpay refused the order: ' + res.getContentText().slice(0, 300));
  }
  var order = JSON.parse(res.getContentText());
  return { status: 'success', orderData: {
    key: razorpayKeyId_(), order_id: order.id, amount: order.amount,
    currency: 'INR', name: 'Dome Box', description: plan.name } };
}

/**
 * Grants the plan only against a verified signature. Note what is NOT trusted:
 * the amount and the plan both come from the order Razorpay confirms, not from
 * the request — otherwise a caller pays 1 rupee and claims the yearly plan.
 */
function handleVerifiedPayment(sheetId, params) {
  if (!verifyRazorpaySignature(params.razorpay_order_id, params.razorpay_payment_id,
                               params.razorpay_signature)) {
    paymentLog_('REJECTED', sheetId, 'bad or missing signature — nothing granted');
    throw new Error('Payment could not be verified. If money has left your account, ' +
                    'contact info@biscsindia.com and we will sort it out.');
  }

  var paid = fetchPayment_(params.razorpay_payment_id);
  if (!paid || paid.status !== 'captured') {
    paymentLog_('NOT_CAPTURED', sheetId, 'payment ' + params.razorpay_payment_id +
      ' is "' + (paid && paid.status) + '"');
    throw new Error('That payment has not completed yet.');
  }

  var planName = (paid.notes && paid.notes.plan) || planForAmountPaise_(paid.amount);
  if (!planName) {
    paymentLog_('UNKNOWN_AMOUNT', sheetId, paid.amount + ' paise matches no plan');
    throw new Error('We could not match that amount to a plan. Contact support.');
  }

  var granted = grantPlan_(sheetId, planName, paid);
  paymentLog_('GRANTED', sheetId, planName + ' via ' + params.razorpay_payment_id);
  return { status: 'success', plan: planName, validUntil: granted };
}

/** Confirms with Razorpay directly, so a replayed signature cannot be reused. */
function fetchPayment_(paymentId) {
  try {
    var res = UrlFetchApp.fetch('https://api.razorpay.com/v1/payments/' + encodeURIComponent(paymentId), {
      headers: { Authorization: 'Basic ' + Utilities.base64Encode(razorpayKeyId_() + ':' + razorpaySecret_()) },
      muteHttpExceptions: true });
    return res.getResponseCode() === 200 ? JSON.parse(res.getContentText()) : null;
  } catch (e) { return null; }
}

function planForAmountPaise_(paise) {
  for (var k in PLANS) {
    if (PLANS[k].price && PLANS[k].price * 100 === Number(paise)) return k;
  }
  return null;
}

/**
 * Extends from the CURRENT expiry when it is still in the future, so renewing
 * early adds time instead of throwing away what is left — the existing code
 * dates from today and silently shortens an early renewal.
 */
function grantPlan_(sheetId, planName, paid) {
  var dir = SpreadsheetApp.openById(MASTER_DB_ID).getSheetByName('Directory');
  var data = dir.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][5]) !== String(sheetId)) continue;

    var current = new Date(data[i][4]);
    var base = (!isNaN(current) && current > new Date()) ? current : new Date();
    var days = planName === 'Yearly' ? 365 : 30;
    base.setDate(base.getDate() + days);
    var until = base.toISOString().split('T')[0];

    dir.getRange(i + 1, 4).setValue(planName);
    dir.getRange(i + 1, 5).setValue(until);

    try {
      sendEmailSafe(data[i][1], 'Dome Box — Payment Receipt',
        receiptHtml_(data[i][0], planName, paid, until));
    } catch (e) { /* a failed receipt must never undo a paid upgrade */ }
    return until;
  }
  throw new Error('That workspace is not in the registry.');
}

function receiptHtml_(company, planName, paid, until) {
  var esc = function (s) { return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
  var amount = '₹' + (Number(paid.amount) / 100).toLocaleString('en-IN');
  return '<div style="font-family:sans-serif;max-width:600px;border:1px solid #ddd;border-radius:8px">' +
    '<div style="background:#1e3a8a;color:#fff;padding:20px;border-radius:8px 8px 0 0"><h2 style="margin:0">Payment Receipt</h2></div>' +
    '<div style="padding:20px">' +
    '<p>Hi <strong>' + esc(company) + '</strong>,</p>' +
    '<p>Your Dome Box workspace has been upgraded.</p>' +
    '<table style="width:100%;border-collapse:collapse;margin-top:15px">' +
    '<tr style="border-bottom:1px solid #ddd"><td style="padding:10px 0"><strong>Plan</strong></td><td style="text-align:right">' + esc(PLANS[planName] ? PLANS[planName].name : planName) + '</td></tr>' +
    '<tr style="border-bottom:1px solid #ddd"><td style="padding:10px 0"><strong>Amount paid</strong></td><td style="text-align:right;font-weight:bold;color:#047857">' + esc(amount) + '</td></tr>' +
    '<tr style="border-bottom:1px solid #ddd"><td style="padding:10px 0"><strong>Payment ID</strong></td><td style="text-align:right;font-family:monospace;font-size:12px">' + esc(paid.id) + '</td></tr>' +
    '<tr><td style="padding:10px 0"><strong>Valid until</strong></td><td style="text-align:right">' + esc(until) + '</td></tr>' +
    '</table>' +
    '<p style="margin-top:24px;font-size:12px;color:#666">BISCS India · info@biscsindia.com</p>' +
    '</div></div>';
}

function paymentLog_(kind, sheetId, message) {
  try {
    var ss = SpreadsheetApp.openById(MASTER_DB_ID);
    var sh = ss.getSheetByName('PaymentLog');
    if (!sh) { sh = ss.insertSheet('PaymentLog'); sh.appendRow(['when','kind','sheetId','message']); sh.setFrozenRows(1); }
    sh.appendRow([new Date(), kind, sheetId, message]);
  } catch (e) { Logger.log(kind + ' ' + sheetId + ': ' + message); }
}
