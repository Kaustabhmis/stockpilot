/**
 * Online payment without a webhook: the 15-minute payment check, and the rule
 * that one payment buys one term however many times it is reported — by the
 * page, by the check, or by a webhook. Against a fake Razorpay that answers
 * the same API calls the real one does.
 */
const fs = require('fs'), crypto = require('crypto');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 260) + ']')); v ? pass++ : fail++; };

const env = build();
Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b',
  RAZORPAY_KEY_ID: 'rzp_test_KEY', RAZORPAY_KEY_SECRET: 'sekret' });
env.newFile('MASTER', 'Domebox Master');
const tpl = env.newFile('TEMPLATE', 'Template');
['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
tpl.getSheetByName('Settings').appendRow(['General']);

/* ---- a fake Razorpay: payments by id, and the list endpoint ------------ */
const RZP = {}, ORDERS = {};
let calls = 0;
env.G.UrlFetchApp = { fetch(url, opts) {
  calls++;
  const auth = (opts && opts.headers && opts.headers.Authorization) || '';
  const good = auth === 'Basic ' + Buffer.from('rzp_test_KEY:sekret').toString('base64');
  const res = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
  if (!good) return res(401, { error: 'bad key' });
  let o = url.match(/\/v1\/orders\/([^?]+)$/);
  if (o) return ORDERS[decodeURIComponent(o[1])] ? res(200, ORDERS[decodeURIComponent(o[1])]) : res(404, { error: 'not found' });
  let m = url.match(/\/v1\/payments\/([^?]+)$/);
  if (m) return RZP[decodeURIComponent(m[1])] ? res(200, RZP[decodeURIComponent(m[1])]) : res(404, { error: 'not found' });
  if (/\/v1\/payments\?/.test(url)) {
    const skip = Number((url.match(/skip=(\d+)/) || [])[1] || 0);
    return res(200, { items: Object.values(RZP).slice(skip, skip + 100) });
  }
  return res(404, {});
} };

const SRC = fs.readFileSync(__dirname + '/../dist/code.gs', 'utf8');
const names = Object.keys(env.G);
const P = new Function(...names, SRC + '\n;return { doPost, ensureRegistry, reconcilePayments, switchOnSchedules, setupDomeBox };')(...names.map((n) => env.G[n]));
P.ensureRegistry();
const call = (b) => JSON.parse(P.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const row = (email) => env.FILES.MASTER.getSheetByName('Directory').getDataRange().getValues().find((r) => r[1] === email);
const invoices = () => (env.FILES.MASTER.getSheetByName('Invoices') ? env.FILES.MASTER.getSheetByName('Invoices').getDataRange().getValues().length - 1 : 0);
const receipts = (email) => env.mails.filter((m) => m.to === email && /payment receipt/.test(m.subject)).length;

const reg = call({ action: 'register', form: { companyName: 'Acme Forgings', name: 'Rohan', email: 'rohan@acme.in', password: 'strongpass123' } });
const SHEET = row('rohan@acme.in')[5];
const trialEnd = row('rohan@acme.in')[4];
/* Every payment is made against an order, and only the server (with the
   secret key) makes orders, so the order is created alongside it here with
   the same amount and notes unless a test says otherwise. */
const pay = (id, extra, order) => {
  const p = Object.assign({ id, order_id: 'order_' + id.replace(/^pay_/, ''), status: 'captured', amount: 5999000, currency: 'INR',
    notes: { sheetId: SHEET, plan: 'Growth Yearly', company: 'Acme Forgings' } }, extra || {});
  if (order !== null) ORDERS[p.order_id] = Object.assign({ id: p.order_id, amount: p.amount, currency: 'INR', notes: p.notes }, order || {});
  return (RZP[id] = p);
};

console.log('\n=== the customer pays and closes the tab ===');
pay('pay_A1');
let log = P.reconcilePayments();
let r = row('rohan@acme.in');
ok('the 15-minute check finds the payment and grants the plan', r[3] === 'Growth Yearly' && r[6] === 'Active', JSON.stringify(r) + ' ' + log);
ok('a year, added after the trial days that were left', r[4] === (() => { const d = new Date(trialEnd); d.setDate(d.getDate() + 365); return d.toISOString().slice(0, 10); })(), r[4]);
ok('one invoice and one receipt', invoices() === 1 && receipts('rohan@acme.in') === 1, invoices() + ' / ' + receipts('rohan@acme.in'));
ok('and the log says so', /granted 1 that had been missed/.test(log), log);

console.log('\n=== one payment is one term, however often it is reported ===');
const until1 = r[4];
P.reconcilePayments(); P.reconcilePayments();
ok('the check running again changes nothing', row('rohan@acme.in')[4] === until1 && invoices() === 1 && receipts('rohan@acme.in') === 1,
   row('rohan@acme.in')[4] + ' ' + invoices() + ' ' + receipts('rohan@acme.in'));
const hook = (event, entity) => P.doPost({ postData: { contents: JSON.stringify({ event, payload: { payment: { entity } } }) }, parameter: {} });
hook('payment.captured', { id: 'pay_A1' });
ok('nor does a webhook for the same payment', row('rohan@acme.in')[4] === until1 && invoices() === 1 && receipts('rohan@acme.in') === 1);

/* The page reports a second payment (with Razorpay's real signature), then
   the check and a webhook see it too: still one term for it. */
pay('pay_B2', { amount: 599900, notes: { sheetId: SHEET, plan: 'Growth', company: 'Acme Forgings' } });
const sig = crypto.createHmac('sha256', 'sekret').update('order_B2|pay_B2').digest('hex');
const viaPage = call({ action: 'paymentSuccess', token: reg.token, razorpay_order_id: 'order_B2', razorpay_payment_id: 'pay_B2', razorpay_signature: sig });
const until2 = row('rohan@acme.in')[4];
P.reconcilePayments(); hook('payment.captured', { id: 'pay_B2' });
ok('the page grants a renewal once (30 more days)', viaPage.status === 'success' &&
   until2 === (() => { const d = new Date(until1); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); })(), JSON.stringify(viaPage) + ' ' + until2);
ok('and the check and the webhook after it add nothing', row('rohan@acme.in')[4] === until2 && invoices() === 2 && receipts('rohan@acme.in') === 2,
   row('rohan@acme.in')[4] + ' ' + invoices() + ' ' + receipts('rohan@acme.in'));

console.log('\n=== nothing can be granted that Razorpay did not capture ===');
const before = JSON.stringify(row('rohan@acme.in'));
hook('payment.captured', { id: 'pay_FORGED', status: 'captured', amount: 5999000, notes: { sheetId: SHEET, plan: 'Scale Yearly' } });
ok('a forged webhook for a payment Razorpay does not have grants nothing', JSON.stringify(row('rohan@acme.in')) === before);
pay('pay_FAILED', { status: 'failed' });
hook('payment.captured', { id: 'pay_FAILED', status: 'captured' });
P.reconcilePayments();
ok('a failed payment, whatever the webhook claims, grants nothing', JSON.stringify(row('rohan@acme.in')) === before);
pay('pay_OTHER', { notes: { order_for: 'another website on the same account' } });
pay('pay_GHOST', { notes: { sheetId: 'NOT_A_COMPANY', plan: 'Growth' } });
log = P.reconcilePayments();
ok('payments for another site, or a company not in this registry, are left alone', JSON.stringify(row('rohan@acme.in')) === before && /granted 0/.test(log), log);
ok('a hand-written webhook body is never trusted for the plan or amount',
   !env.mails.some((m) => /Scale/.test(m.html || '') && /receipt/.test(m.subject)));

console.log('\n=== what was bought comes from the order the server made, not the payment ===');
/* Razorpay Checkout lets the buyer's browser add notes to a payment. So a
   buyer can start a Team checkout and write "Scale" in the payment's notes. */
const reg2 = call({ action: 'register', form: { companyName: 'Sly Tools', name: 'Sam', email: 'sam@sly.in', password: 'strongpass123' } });
const SLY = row('sam@sly.in')[5];
const slyBefore = JSON.stringify(row('sam@sly.in'));
pay('pay_TAMPER', { amount: 99900, notes: { sheetId: SLY, plan: 'Scale Yearly', company: 'Sly Tools' } },
    { amount: 99900, notes: { sheetId: SLY, plan: 'Team', company: 'Sly Tools' } });
const sigT = crypto.createHmac('sha256', 'sekret').update('order_TAMPER|pay_TAMPER').digest('hex');
const tamper = call({ action: 'paymentSuccess', token: reg2.token, razorpay_order_id: 'order_TAMPER', razorpay_payment_id: 'pay_TAMPER', razorpay_signature: sigT });
ok('a Team order paid with notes saying "Scale" buys Team, not Scale', tamper.status === 'success' && row('sam@sly.in')[3] === 'Team', JSON.stringify(tamper) + ' ' + row('sam@sly.in')[3]);
P.reconcilePayments();
ok('and the 15-minute check reads the order too', row('sam@sly.in')[3] === 'Team', row('sam@sly.in')[3]);
const slyAfter = JSON.stringify(row('sam@sly.in'));
pay('pay_SHORT', { amount: 100, notes: { sheetId: SLY, plan: 'Scale', company: 'Sly Tools' } },
    { amount: 1299900, notes: { sheetId: SLY, plan: 'Scale', company: 'Sly Tools' } });
const sigS = crypto.createHmac('sha256', 'sekret').update('order_SHORT|pay_SHORT').digest('hex');
const short = call({ action: 'paymentSuccess', token: reg2.token, razorpay_order_id: 'order_SHORT', razorpay_payment_id: 'pay_SHORT', razorpay_signature: sigS });
P.reconcilePayments(); hook('payment.captured', { id: 'pay_SHORT' });
ok('a payment for less than its order grants nothing, by the page, the check or a webhook', short.status === 'error' && JSON.stringify(row('sam@sly.in')) === slyAfter, JSON.stringify(short));
pay('pay_NOORDER', { amount: 1299900, notes: { sheetId: SLY, plan: 'Scale', company: 'Sly Tools' } }, null);
P.reconcilePayments(); hook('payment.captured', { id: 'pay_NOORDER' });
ok('a payment with no order this server made grants nothing', JSON.stringify(row('sam@sly.in')) === slyAfter);
ok('and each one is in the payment log', env.FILES.MASTER.getSheetByName('PaymentLog')
   .getDataRange().getValues().filter((r) => r[1] === 'ORDER_MISMATCH').length >= 2);

console.log('\n=== a payment whose invoice failed is still never granted twice ===');
const slyNow = JSON.stringify(row('sam@sly.in'));
const inv = env.FILES.MASTER.getSheetByName('Invoices');
const keep = inv._data.slice();
inv._data.splice(1);   // as if every invoice had failed to be written
P.reconcilePayments(); P.reconcilePayments();
ok('the granted-payments ledger stops the 15-minute check re-granting it', JSON.stringify(row('sam@sly.in')) === slyNow &&
   env.FILES.MASTER.getSheetByName('GrantedPayments').getDataRange().getValues().some((r) => r[0] === 'pay_TAMPER'));
inv._data.splice(0, inv._data.length, ...keep);

console.log('\n=== switched on with the other schedules, and checked by setup ===');
P.switchOnSchedules();
ok('switchOnSchedules runs the payment check every 15 minutes',
   env.triggerHours.some((t) => t[0] === 'reconcilePayments' && t[1] === 'every' && t[2] === 15), JSON.stringify(env.triggerHours));
const setup = P.setupDomeBox();
ok('setupDomeBox no longer asks for a webhook secret', !/RAZORPAY_WEBHOOK_SECRET/.test(setup), setup.slice(0, 300));

console.log('\n=== without keys it does nothing, and says so ===');
delete env.props.RAZORPAY_KEY_SECRET;
const c0 = calls;
ok('no keys: no calls to Razorpay', /keys are not set/.test(P.reconcilePayments()) && calls === c0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
