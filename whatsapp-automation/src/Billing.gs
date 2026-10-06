/**
 * Billing.gs
 * Self-serve subscriptions: plans, sign-up, Razorpay payments, activation and renewals.
 *
 * FLOW (client app → Apps Script JSON API)
 *   1. apiGetPlans          → active rows of the PLANS sheet (prices in INR)
 *   2. apiSignup            → CLIENTS row (Status "Pending Payment") + PAYMENTS row + Razorpay order
 *   3. Razorpay Checkout    → customer pays (UPI / card / netbanking) in the browser
 *   4. apiConfirmPayment    → server verifies the signature HMAC_SHA256(order_id|payment_id, key secret),
 *                             re-reads the payment from Razorpay (amount, order, captured),
 *                             activates the plan, issues + emails the access code, signs the client in
 *   5. reconcilePendingPayments_ (scheduler) activates paid orders whose browser closed before step 4.
 * Renewals/upgrades use the same order + confirm steps from inside the dashboard and extend Valid Until.
 *
 * Razorpay contract used (Standard Checkout): POST https://api.razorpay.com/v1/orders {amount (paise),
 * currency, receipt, notes}; Checkout returns razorpay_payment_id / razorpay_order_id / razorpay_signature;
 * GET /v1/payments/{id}; POST /v1/payments/{id}/capture; GET /v1/orders/{id}/payments. Basic auth key_id:key_secret.
 *
 * Without Razorpay keys (Script Properties RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) sign-ups are recorded as
 * "Pending Payment" and shown PAYMENT_INSTRUCTIONS; the admin activates them with "Activate Subscription".
 *
 * A plan with Dedicated Number = YES waits for the admin to add a phone in Maytapi and paste its
 * Phone ID into CLIENTS → Maytapi Phone ID; campaigns stay queued (not failed) until then.
 */

const RAZORPAY_API = 'https://api.razorpay.com/v1';
const PENDING_ORDER_DAYS = 3;

/* ============================== PLANS ============================== */

function plansById_() {
  const out = {};
  try {
    readTable_(SHEETS.PLANS).rows.forEach(p => { if (String(p['Plan ID']).trim()) out[String(p['Plan ID']).trim()] = p; });
  } catch (err) { /* PLANS sheet not created yet */ }
  return out;
}

/** Active plans for the pricing page (plain JSON). */
function publicPlans_() {
  const plans = plansById_();
  return Object.keys(plans).map(k => plans[k])
    .filter(p => isYes_(p['Active']))
    .sort((a, b) => (Number(a['Sort Order']) || 0) - (Number(b['Sort Order']) || 0))
    .map(p => ({
      id: String(p['Plan ID']),
      name: String(p['Plan Name'] || p['Plan ID']),
      price: Number(p['Price INR']) || 0,
      durationDays: Number(p['Duration Days']) || 30,
      quota: String(p['Monthly Quota']).trim() === '' ? null : Number(p['Monthly Quota']) || 0,
      dedicatedNumber: isYes_(p['Dedicated Number']),
      features: String(p['Features'] || '').split(/[;\n]/).map(s => s.trim()).filter(Boolean),
    }));
}

function activePlan_(planId) {
  const p = plansById_()[String(planId || '').trim()];
  if (!p || !isYes_(p['Active'])) throw new Error('Please choose a valid plan.');
  return p;
}

/* ============================== RAZORPAY ============================== */

function razorpayEnabled_(cfg) {
  cfg = cfg || getConfig_();
  return !!(cfg.razorpayKeyId && cfg.razorpayKeySecret);
}

function razorpayRequest_(method, path, payload, cfg) {
  cfg = cfg || getConfig_();
  const options = {
    method: method, muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(cfg.razorpayKeyId + ':' + cfg.razorpayKeySecret) },
  };
  if (payload) options.payload = JSON.stringify(payload);
  let res;
  try {
    res = UrlFetchApp.fetch(RAZORPAY_API + path, options);
  } catch (err) {
    return { ok: false, status: 0, json: null, error: 'Payment gateway not reachable: ' + redactSecrets_(err.message) };
  }
  const status = res.getResponseCode();
  let json = null;
  try { json = JSON.parse(res.getContentText() || '{}'); } catch (err) { json = null; }
  const ok = status >= 200 && status < 300;
  const error = ok ? '' : redactSecrets_((json && json.error && (json.error.description || json.error.code)) || ('HTTP ' + status));
  return { ok: ok, status: status, json: json, error: error };
}

function hexOf_(bytes) {
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

/** Razorpay Checkout signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret), hex. Constant-time compare. */
function verifyRazorpaySignature_(orderId, paymentId, signature, secret) {
  if (!orderId || !paymentId || !signature || !secret) return false;
  const expected = hexOf_(Utilities.computeHmacSha256Signature(orderId + '|' + paymentId, secret));
  const given = String(signature);
  let diff = expected.length ^ given.length;
  for (let i = 0; i < Math.min(expected.length, given.length); i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/* ============================== SIGN-UP ============================== */

/**
 * Public sign-up. payload = { planId, businessName, contactName, email, phone, website, gstin, acceptTerms }
 * Returns checkout details (razorpay), payment instructions (manual) or an immediately activated free plan.
 */
function signup_(payload) {
  const cfg = getConfig_(true);
  if (!cfg.signupEnabled) throw new Error('Online sign-up is closed. Please contact us.');
  payload = payload || {};
  const plan = activePlan_(payload.planId);
  const email = String(payload.email || '').trim().toLowerCase();
  const businessName = String(payload.businessName || '').trim().slice(0, 120);
  const contactName = String(payload.contactName || '').trim().slice(0, 80);
  const phone = normalizePhoneNumber(payload.phone);
  const website = String(payload.website || '').trim() ? normalizeUrl_(payload.website) : '';
  const gstin = String(payload.gstin || '').trim().toUpperCase();

  const errors = [];
  if (!businessName) errors.push('Enter your business name.');
  if (!contactName) errors.push('Enter your name.');
  if (!isValidEmail_(email)) errors.push('Enter a valid email address.');
  if (!phone) errors.push('Enter a valid mobile number.');
  if (String(payload.website || '').trim() && !website) errors.push('Website is not a valid web address.');
  if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) errors.push('GSTIN should be 15 characters (or leave it blank).');
  if (payload.acceptTerms !== true) errors.push('Please accept the terms to continue.');
  if (errors.length) return { ok: false, errors: errors };

  // Abuse protection: per-email and global sign-up rate limits.
  const cache = CacheService.getScriptCache();
  const ek = 'signup_' + Utilities.base64EncodeWebSafe(email).slice(0, 200);
  const perEmail = Number(cache.get(ek) || 0);
  const global = Number(cache.get('signup_global') || 0);
  if (perEmail >= 5 || global >= 60) return { ok: false, errors: ['Too many attempts. Please try again later.'] };
  cache.put(ek, String(perEmail + 1), 3600);
  cache.put('signup_global', String(global + 1), 3600);

  const table = readTable_(SHEETS.CLIENTS);
  let client = table.rows.find(r => String(r['Client Email']).trim().toLowerCase() === email);
  if (client && !/^pending payment$/i.test(String(client['Status']))) {
    return { ok: false, errors: ['An account with this email already exists. Please sign in — you can renew or upgrade from your dashboard.'] };
  }
  const now = new Date();
  const fields = {
    'Business Name': businessName, 'Client Email': email, 'Business Phone': phone, 'Website': website,
    'Contact Name': contactName, 'GSTIN': gstin, 'Updated At': now,
  };
  let clientId;
  if (client) {
    clientId = String(client['Client ID']);
    updateFields_(table, client._row, fields);
  } else {
    clientId = newClientId_();
    appendObject_(SHEETS.CLIENTS, Object.assign({
      'Client ID': clientId, 'Status': 'Pending Payment', 'Created At': now, 'Signup Source': 'SELF_SIGNUP',
    }, fields));
    logEvent_(LOG_LEVEL.INFO, 'SIGNUP', { clientId: clientId, result: plan['Plan ID'] });
  }
  return Object.assign({ ok: true, clientId: clientId }, startOrder_(clientId, plan, cfg, { name: contactName, email: email, contact: '+' + phone }));
}

/**
 * Creates a PAYMENTS row (+ Razorpay order). Free plans (price 0) activate immediately, once per client.
 */
function startOrder_(clientId, plan, cfg, prefill) {
  cfg = cfg || getConfig_();
  const price = Number(plan['Price INR']) || 0;
  const ref = nextIds_('PAY', 4, 1, SHEETS.PAYMENTS, 'Payment Ref')[0];
  const base = {
    'Payment Ref': ref, 'Client ID': clientId, 'Plan ID': plan['Plan ID'], 'Plan Name': plan['Plan Name'],
    'Amount': price, 'Currency': 'INR', 'Created At': new Date(),
  };

  if (price <= 0) {
    const used = readTable_(SHEETS.PAYMENTS).rows.some(p => String(p['Client ID']) === clientId && Number(p['Amount']) === 0 && String(p['Status']) === 'PAID');
    if (used) throw new Error('The free plan can only be used once. Please choose a paid plan.');
    appendObject_(SHEETS.PAYMENTS, Object.assign(base, { 'Gateway': 'FREE', 'Status': 'CREATED' }));
    const act = completePayment_(ref, { gatewayPaymentId: 'FREE', notes: 'Free plan' });
    return { mode: 'free', paymentRef: ref, activation: act };
  }

  if (!razorpayEnabled_(cfg)) {
    appendObject_(SHEETS.PAYMENTS, Object.assign(base, { 'Gateway': 'MANUAL', 'Status': 'CREATED' }));
    notifyAdmin_('New sign-up awaiting payment', 'Client: ' + clientId + '\nPlan: ' + plan['Plan Name'] + ' (₹' + price + ')\nPayment ref: ' + ref +
      '\n\nWhen payment is received, use WhatsApp Automation → Activate Subscription.');
    return { mode: 'manual', paymentRef: ref, amount: price, currency: 'INR', instructions: cfg.paymentInstructions };
  }

  const order = razorpayRequest_('post', '/orders', {
    amount: Math.round(price * 100), currency: 'INR', receipt: ref,
    notes: { client_id: clientId, plan_id: String(plan['Plan ID']), payment_ref: ref },
  }, cfg);
  if (!order.ok || !order.json || !order.json.id) {
    logEvent_(LOG_LEVEL.ERROR, 'RAZORPAY_ORDER', { clientId: clientId, httpStatus: order.status, error: order.error });
    throw new Error('Could not start the payment. Please try again in a minute.');
  }
  appendObject_(SHEETS.PAYMENTS, Object.assign(base, { 'Gateway': 'RAZORPAY', 'Order ID': order.json.id, 'Status': 'CREATED' }));
  return {
    mode: 'razorpay', paymentRef: ref, keyId: cfg.razorpayKeyId, orderId: order.json.id,
    amount: Math.round(price * 100), currency: 'INR', name: cfg.systemName,
    description: String(plan['Plan Name']) + ' plan', prefill: prefill || {},
  };
}

/* ============================== CONFIRM / ACTIVATE ============================== */

/**
 * Browser → server after Razorpay Checkout success.
 * p = { orderId, paymentId, signature }  (razorpay_order_id / razorpay_payment_id / razorpay_signature)
 */
function confirmRazorpayPayment_(p) {
  const cfg = getConfig_(true);
  if (!razorpayEnabled_(cfg)) throw new Error('Online payments are not enabled.');
  p = p || {};
  const orderId = String(p.orderId || ''), paymentId = String(p.paymentId || '');
  if (!verifyRazorpaySignature_(orderId, paymentId, p.signature, cfg.razorpayKeySecret)) {
    logEvent_(LOG_LEVEL.WARNING, 'PAYMENT_SIGNATURE_INVALID', { details: orderId });
    throw new Error('Payment could not be verified. If money was deducted, contact us with your payment ID.');
  }
  const row = findRow_(readTable_(SHEETS.PAYMENTS), 'Order ID', orderId);
  if (!row) throw new Error('Order not found.');
  if (String(row['Status']) === 'PAID') return { already: true, clientId: String(row['Client ID']), accessCode: '' };
  const check = fetchAndCapture_(paymentId, row, cfg);
  if (!check.ok) throw new Error(check.error);
  return completePayment_(String(row['Payment Ref']), { gatewayPaymentId: paymentId });
}

/** Re-reads the payment from Razorpay; captures it if only authorized; checks order + amount. */
function fetchAndCapture_(paymentId, row, cfg) {
  const r = razorpayRequest_('get', '/payments/' + encodeURIComponent(paymentId), null, cfg);
  if (!r.ok || !r.json) return { ok: false, error: 'Could not confirm the payment with Razorpay. Please contact us with payment ID ' + paymentId + '.' };
  const pay = r.json;
  const expected = Math.round(Number(row['Amount']) * 100);
  if (String(pay.order_id) !== String(row['Order ID']) || Number(pay.amount) !== expected || String(pay.currency || 'INR') !== 'INR') {
    logEvent_(LOG_LEVEL.ERROR, 'PAYMENT_MISMATCH', { clientId: row['Client ID'], details: { paymentId: paymentId, order: pay.order_id, amount: pay.amount } });
    return { ok: false, error: 'Payment details do not match the order. Please contact us.' };
  }
  if (pay.status === 'authorized') {
    const c = razorpayRequest_('post', '/payments/' + encodeURIComponent(paymentId) + '/capture', { amount: expected, currency: 'INR' }, cfg);
    if (!c.ok) return { ok: false, error: 'Payment authorised but could not be captured yet. It will be retried automatically.' };
    pay.status = (c.json && c.json.status) || 'captured';
  }
  if (pay.status !== 'captured') return { ok: false, error: 'Payment is ' + pay.status + '. Please try again.' };
  return { ok: true };
}

/**
 * Marks a PAYMENTS row PAID (idempotent) and activates/extends the subscription.
 * @return { clientId, accessCode ('' for existing logins), validUntil, planName }
 */
function completePayment_(paymentRef, info) {
  const lock = LockService.getDocumentLock() || LockService.getUserLock();
  lock.waitLock(30000);
  let row, payments, plan;
  try {
    payments = readTable_(SHEETS.PAYMENTS);
    row = findRow_(payments, 'Payment Ref', paymentRef);
    if (!row) throw new Error('Payment ' + paymentRef + ' not found.');
    if (String(row['Status']) === 'PAID') return { already: true, clientId: String(row['Client ID']), accessCode: '', validUntil: cellDateStr_(row['Valid Until']) };
    plan = plansById_()[String(row['Plan ID'])];
    if (!plan) throw new Error('Plan ' + row['Plan ID'] + ' no longer exists.');
    updateFields_(payments, row._row, { 'Status': 'PAID', 'Paid At': new Date(), 'Gateway Payment ID': info.gatewayPaymentId || '', 'Notes': info.notes || '' });
  } finally {
    lock.releaseLock();
  }
  const act = activateSubscription_(String(row['Client ID']), plan, row);
  updateFields_(readTable_(SHEETS.PAYMENTS), row._row, { 'Valid Until': act.validUntil });
  return act;
}

/** Sets plan, quota and validity; issues a login if needed; resumes paused campaigns; emails client + admin. */
function activateSubscription_(clientId, plan, paymentRow) {
  const table = readTable_(SHEETS.CLIENTS);
  const client = findRow_(table, 'Client ID', clientId);
  if (!client) throw new Error('Client ' + clientId + ' not found.');
  const days = Math.max(1, Number(plan['Duration Days']) || 30);
  const today = todayKey_();
  const current = cellDateStr_(client['Valid Until']);
  const start = current && current >= today && /^active$/i.test(String(client['Status'])) ? addDaysKey_(current, 1) : today;
  const validUntil = addDaysKey_(start, days - 1);

  updateFields_(table, client._row, {
    'Status': 'Active', 'Plan': plan['Plan Name'], 'Plan ID': plan['Plan ID'],
    'Monthly Quota': String(plan['Monthly Quota']).trim() === '' ? '' : Number(plan['Monthly Quota']),
    'Valid Until': validUntil, 'Updated At': new Date(),
  });
  const isNewLogin = !String(client['Access Code Hash'] || '').trim();
  const accessCode = isNewLogin ? issueAccessCode_(clientId) : '';

  // Resume campaigns that were paused for expiry / quota.
  readTable_(SHEETS.CAMPAIGNS).rows
    .filter(c => String(c['Client ID']) === clientId && String(c['Status']) === CAMPAIGN_STATUS.PAUSED && /Sending paused:/.test(String(c['Notes'])))
    .forEach(c => setCampaignStatus_(String(c['Campaign ID']), CAMPAIGN_STATUS.ACTIVE, 'Resumed after subscription payment.'));

  const cfg = getConfig_();
  const needsNumber = isYes_(plan['Dedicated Number']) && !String(client['Maytapi Phone ID'] || '').trim();
  const loginUrl = cfg.clientAppUrl || '';
  const lines = [
    'Hello ' + (client['Contact Name'] || client['Business Name']) + ',', '',
    'Thank you! Your ' + plan['Plan Name'] + ' subscription is active until ' + validUntil + '.', '',
    'Business: ' + client['Business Name'],
    'Amount: ₹' + (paymentRow ? paymentRow['Amount'] : plan['Price INR']),
    'Payment reference: ' + (paymentRow ? paymentRow['Payment Ref'] : '—'),
  ];
  if (accessCode) lines.push('', 'Sign in: ' + (loginUrl || '(your dashboard link)'), 'Email: ' + client['Client Email'], 'Access code: ' + accessCode, 'Keep this code private.');
  if (needsNumber) lines.push('', 'Next step: we are setting up your WhatsApp number. You will be able to connect it from your dashboard shortly.');
  lines.push('', 'Regards,', cfg.systemName);
  safeSendEmail_(String(client['Client Email']), 'Subscription active – ' + plan['Plan Name'], lines.join('\n'));
  notifyAdmin_((isNewLogin ? 'New subscriber: ' : 'Renewal: ') + client['Business Name'],
    'Client: ' + clientId + ' – ' + client['Business Name'] + ' <' + client['Client Email'] + '>, ' + (client['Business Phone'] ? '+' + client['Business Phone'] : '') +
    '\nPlan: ' + plan['Plan Name'] + ' until ' + validUntil + (client['GSTIN'] ? '\nGSTIN: ' + client['GSTIN'] : '') +
    (needsNumber ? '\n\nACTION NEEDED: add a phone for this client in your Maytapi product and paste its Phone ID into CLIENTS → Maytapi Phone ID. ' +
      'The client then scans the QR code from their dashboard (Home → WhatsApp connection).' : ''));
  logEvent_(LOG_LEVEL.SUCCESS, 'SUBSCRIPTION_ACTIVE', { clientId: clientId, result: plan['Plan ID'] + ' until ' + validUntil });
  return { clientId: clientId, accessCode: accessCode, validUntil: validUntil, planName: String(plan['Plan Name']), needsNumber: needsNumber };
}

function addDaysKey_(ymd, days) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Scheduler: activates Razorpay orders that were paid but never confirmed by the browser (tab closed),
 * and expires stale orders. Runs at most every 10 minutes.
 */
function reconcilePendingPayments_() {
  const cfg = getConfig_();
  if (!razorpayEnabled_(cfg)) return 0;
  const cache = CacheService.getScriptCache();
  if (cache.get('recon_payments')) return 0;
  cache.put('recon_payments', '1', 600);
  let n = 0;
  readTable_(SHEETS.PAYMENTS).rows.forEach(row => {
    if (String(row['Gateway']) !== 'RAZORPAY' || String(row['Status']) !== 'CREATED' || !row['Order ID']) return;
    const created = toDate_(row['Created At']);
    if (created && Date.now() - created.getTime() > PENDING_ORDER_DAYS * 86400000) {
      updateFields_(readTable_(SHEETS.PAYMENTS), row._row, { 'Status': 'EXPIRED' });
      return;
    }
    const r = razorpayRequest_('get', '/orders/' + encodeURIComponent(row['Order ID']) + '/payments', null, cfg);
    const items = (r.ok && r.json && r.json.items) || [];
    const paid = items.find(p => p.status === 'captured') || items.find(p => p.status === 'authorized');
    if (!paid) return;
    if (fetchAndCapture_(paid.id, row, cfg).ok) {
      completePayment_(String(row['Payment Ref']), { gatewayPaymentId: paid.id, notes: 'Reconciled' });
      n++;
    }
  });
  if (n) logEvent_(LOG_LEVEL.INFO, 'PAYMENTS_RECONCILED', { result: n + ' activated' });
  return n;
}

/* ============================== ADMIN ============================== */

/** Menu: activate (or renew) a subscription after a manual UPI / bank payment. */
function activateSubscription() {
  requireAdmin_();
  const ui = SpreadsheetApp.getUi();
  const ask = label => {
    const r = ui.prompt('Activate Subscription', label, ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) throw new Error('CANCELLED');
    return r.getResponseText().trim();
  };
  try {
    const who = ask('Client ID or email:');
    const client = readTable_(SHEETS.CLIENTS).rows.find(c => String(c['Client ID']) === who || String(c['Client Email']).toLowerCase() === who.toLowerCase());
    if (!client) throw new Error('Client not found.');
    const plan = activePlan_(ask('Plan ID (' + publicPlans_().map(p => p.id).join(', ') + '):'));
    const note = ask('Payment reference (UPI / bank ref, optional):');
    const ref = nextIds_('PAY', 4, 1, SHEETS.PAYMENTS, 'Payment Ref')[0];
    appendObject_(SHEETS.PAYMENTS, {
      'Payment Ref': ref, 'Client ID': client['Client ID'], 'Plan ID': plan['Plan ID'], 'Plan Name': plan['Plan Name'],
      'Amount': Number(plan['Price INR']) || 0, 'Currency': 'INR', 'Gateway': 'MANUAL', 'Status': 'CREATED', 'Created At': new Date(),
    });
    const act = completePayment_(ref, { gatewayPaymentId: note || 'MANUAL', notes: 'Activated by admin' });
    ui.alert('Subscription active', client['Business Name'] + ': ' + act.planName + ' until ' + act.validUntil +
      (act.accessCode ? '\n\nNew access code (also emailed): ' + act.accessCode : '') +
      (act.needsNumber ? '\n\nNext: add their phone in Maytapi and set CLIENTS → Maytapi Phone ID.' : ''), ui.ButtonSet.OK);
  } catch (err) {
    if (err.message !== 'CANCELLED') ui.alert('Activate Subscription', 'Error: ' + err.message, ui.ButtonSet.OK);
  }
}

/** Menu: store Razorpay keys in Script Properties (never in the sheet). */
function setPaymentKeys() {
  requireAdmin_();
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const ask = (key, label) => {
    const r = ui.prompt('Razorpay keys', label + (props.getProperty(key) ? ' (set — leave blank to keep)' : ''), ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return false;
    if (r.getResponseText().trim()) props.setProperty(key, r.getResponseText().trim());
    return true;
  };
  if (!ask('RAZORPAY_KEY_ID', 'Razorpay Key ID (rzp_live_… or rzp_test_…)')) return;
  if (!ask('RAZORPAY_KEY_SECRET', 'Razorpay Key Secret')) return;
  CONFIG_CACHE_ = null;
  ui.alert(razorpayEnabled_(getConfig_(true)) ? 'Razorpay keys saved. Online payments are enabled.' : 'Keys incomplete — online payments stay disabled.');
}

/* ============================== WHATSAPP CONNECTION (QR) ============================== */

/**
 * The tenant's WhatsApp connection state for the dashboard:
 *   shared    — uses the platform number (nothing to connect)
 *   pending   — dedicated plan, admin has not set Maytapi Phone ID yet
 *   connected — phone logged in
 *   qr        — not logged in: scan the QR (data URL) in WhatsApp → Linked devices
 *   unknown   — Maytapi did not return a usable status/QR (contact support)
 * Maytapi endpoints used: GET /{phone_id}/status and GET /{phone_id}/qrCode (verify in the Maytapi docs).
 */
function whatsappConnection_(client) {
  const phoneId = String(client['Maytapi Phone ID'] || '').trim();
  if (!phoneId) {
    const plan = plansById_()[String(client['Plan ID'] || '')];
    return { state: plan && isYes_(plan['Dedicated Number']) ? 'pending' : 'shared' };
  }
  const cfg = cfgForClient_(client, getConfig_());
  const st = maytapiPhoneStatus_(cfg);
  if (st.success && maytapiLooksConnected_(st.response)) return { state: 'connected' };
  const qr = maytapiQrCode_(cfg);
  if (qr) return { state: 'qr', qr: qr };
  return { state: 'unknown' };
}
