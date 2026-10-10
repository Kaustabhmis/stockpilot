/**
 * Every payment leaves a document behind, and the document has to be one an
 * Indian accountant can actually file.
 *
 * The arithmetic is checked to the paisa, because an invoice that does not add
 * up to the card statement is worse than no invoice. The number series is
 * checked for gaps and collisions, because that is the part nobody can
 * reconstruct afterwards. And the whole thing is driven through the real
 * webhook, signed, so what is tested is the path a real payment takes.
 */
const crypto = require('crypto');
const { call, env, APP } = require('./server.js');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 170) + ']')); v ? pass++ : fail++; };

const R = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
const HOOK = 'webhook-secret-for-the-harness';
env.props.RAZORPAY_WEBHOOK_SECRET = HOOK;
env.props.SELLER_LEGAL_NAME = 'BISCS India';
env.props.SELLER_ADDRESS = '12 Park Street, Kolkata 700016';
env.props.SELLER_STATE = 'West Bengal';
env.props.SELLER_GSTIN = '19AABCB1234C1ZQ';          // 19 = West Bengal
env.props.SELLER_PAN = 'AABCB1234C';

/* A signed payment.captured, exactly as Razorpay delivers it. */
function pay(sheetId, plan, company, paise, id) {
  const body = { event: 'payment.captured', payload: { payment: { entity: {
    id: id, order_id: 'order_' + id, amount: paise, currency: 'INR',
    notes: { sheetId, plan, company } } } } };
  const raw = JSON.stringify(body);
  const sig = crypto.createHmac('sha256', HOOK).update(raw).digest('hex');
  const res = APP.doPost({ postData: { contents: raw },
    parameter: { 'x-razorpay-signature': sig } });
  return JSON.parse(res.getContent());
}

const email = 'owner' + R + '@acme.in';
const A = call({ action: 'register', form: { companyName: 'Acme Engineering',
  name: 'Rohan Mehta', email, password: 'strongpass123' } }).token;
const sheetId = env.FILES.MASTER.getSheetByName('Directory').getDataRange()
  .getValues().filter((r) => String(r[1]).toLowerCase() === email)[0][5];

console.log('\n=== the GST arithmetic, to the paisa ===');
/* Driven through the real webhook rather than the helper, so the numbers
   checked here are the numbers that reach a customer. */
let before = env.mails.length;
pay(sheetId, 'Growth', 'Acme Engineering', 707882, 'pay_' + R + '_1');   // 5999 + 18%
let inv = call({ action: 'getInvoices', token: A }).invoices;
ok('a payment produces exactly one invoice', inv.length === 1, JSON.stringify(inv));
const i1 = inv[0] || {};
ok('the total equals the amount charged', i1.total === 7078.82, i1.total);
ok('taxable value is the listed price', i1.taxable === 5999.00, i1.taxable);
ok('tax adds up to the difference',
   Math.round((i1.cgst + i1.sgst + i1.igst) * 100) === Math.round((i1.total - i1.taxable) * 100),
   i1.cgst + '/' + i1.sgst + '/' + i1.igst);
ok('no state on file means it is not split as inter-state', i1.igst === 0, i1.igst);
ok('CGST and SGST are each half', i1.cgst === i1.sgst, i1.cgst + ' vs ' + i1.sgst);
ok('the rate is recorded', i1.rate === 18, i1.rate);

console.log('\n=== the invoice reaches the customer, from the right address ===');
const sent = env.mails.slice(before);
/* The ops alert about the unknown place of supply also has "Invoice" in its
   subject, and it is supposed to — so the customer's copy is picked out by
   who it went to, not by what it is called. */
const doc = sent.filter((m) => /invoice/i.test(m.subject) && m.to === email);
ok('exactly one invoice email reaches the customer', doc.length === 1, sent.map((m) => m.subject).join(' | '));
ok('and an operator is told the place of supply is missing',
   sent.some((m) => m.to === 'info@biscsindia.com' && /needs a place of supply/.test(m.subject)));
ok('it leaves from info@biscsindia.com', doc[0] && doc[0].from === 'info@biscsindia.com');
ok('it goes to the account email', doc[0] && doc[0].to === email, doc[0] && doc[0].to);
ok('it is titled a tax invoice once a GSTIN is set', /Tax invoice/.test(doc[0].subject), doc[0].subject);
ok('the supplier GSTIN is on it', /19AABCB1234C1ZQ/.test(doc[0].html));
ok('the supplier address is on it', /12 Park Street/.test(doc[0].html));
ok('the SAC is on it', /998314/.test(doc[0].html));
ok('the amount in words is on it', /Rupees .*Only/.test(doc[0].html), (doc[0].html.match(/Rupees [^<]*/) || [])[0]);
ok('the payment reference is on it', doc[0].html.indexOf('pay_' + R + '_1') > -1);
ok('a receipt went out as well as the invoice',
   sent.some((m) => /payment receipt/i.test(m.subject)));

console.log('\n=== the same rupee is never invoiced twice ===');
before = env.mails.length;
pay(sheetId, 'Growth', 'Acme Engineering', 707882, 'pay_' + R + '_1');   // replayed delivery
inv = call({ action: 'getInvoices', token: A }).invoices;
ok('a replayed webhook issues no second invoice', inv.length === 1, inv.length);
ok('and sends no second invoice email',
   !env.mails.slice(before).some((m) => /invoice/i.test(m.subject) && m.to === email));

console.log('\n=== a flagged invoice can be fixed from the Run button ===');
/* The first invoice above went out with no state on file, so it is flagged.
   The alert used to say "run reissueInvoice(\"…\")", which the Apps Script
   editor cannot do: its Run button passes no arguments. */
const opsAlert = env.mails.filter((m) => /needs a place of supply/.test(m.subject)).pop();
ok('the alert names a function the editor can run', /run reissueFlaggedInvoices/.test(opsAlert.body || opsAlert.html || ''),
   (opsAlert.body || '').slice(0, 160));
ok('and asks the customer to fill in their details, not the operator', /Invoice details/.test(opsAlert.body || opsAlert.html || ''));
const notYet = APP.reissueFlaggedInvoices();
ok('with nothing on file yet it reissues nothing', /Nothing ready to reissue/.test(notYet), notYet);
ok('and says who it is still waiting on', /Still waiting on the customer/.test(notYet));

console.log('\n=== place of supply decides the split ===');
call({ action: 'saveBilling', token: A, form: { legalName: 'Acme Engineering Pvt Ltd',
  gstin: '27AACCA1111A1Z5', address: '4 MIDC Road', city: 'Pune', pin: '411001' } });
pay(sheetId, 'Starter', 'Acme Engineering', 294882, 'pay_' + R + '_2');  // 2499 + 18%
const i2 = call({ action: 'getInvoices', token: A }).invoices[0];
ok('a Maharashtra buyer of a Bengal seller is charged IGST', i2.igst > 0 && i2.cgst === 0, JSON.stringify(i2));
ok('IGST is the whole tax', Math.round(i2.igst * 100) === Math.round((i2.total - i2.taxable) * 100));
ok('the buyer GSTIN is recorded', i2.gstin === '27AACCA1111A1Z5', i2.gstin);
ok('the state came from the GSTIN, not from a typed name',
   /Maharashtra/.test(env.mails[env.mails.length - 1].html));

const fixed = APP.reissueFlaggedInvoices();
ok('once the customer has a state, the flagged invoice is reissued', /reissued BISCS\/[\d-]+\/0001 as/.test(fixed), fixed);
const after = call({ action: 'getInvoices', token: A }).invoices;
ok('the original is superseded, not edited', !after.some((x) => x.number === i1.number), after.map((x) => x.number).join(','));
ok('and its replacement is taxed for the right place', after.some((x) => x.igst > 0 && x.total === 7078.82),
   JSON.stringify(after.map((x) => [x.number, x.total, x.igst])));
ok('running it again finds nothing more to do', /Nothing ready to reissue/.test(APP.reissueFlaggedInvoices()));

/* A buyer in the seller's own state is the other half of the rule, and the one
   that is easy to get wrong because it is the default. */
call({ action: 'saveBilling', token: A, form: { legalName: 'Acme Engineering Pvt Ltd',
  gstin: '19AACCA1111A1Z5', address: '7 Camac Street', city: 'Kolkata', pin: '700017' } });
pay(sheetId, 'Starter', 'Acme Engineering', 294882, 'pay_' + R + '_3');
const i3 = call({ action: 'getInvoices', token: A }).invoices[0];
ok('a buyer in the seller state is charged CGST+SGST', i3.cgst > 0 && i3.igst === 0, JSON.stringify(i3));

console.log('\n=== the number series ===');
const nums = call({ action: 'getInvoices', token: A }).invoices.map((x) => x.number);
ok('every invoice has a distinct number', new Set(nums).size === nums.length, nums.join(','));
ok('the series is prefixed and year-stamped', /^BISCS\/\d\d-\d\d\/\d{4}$/.test(nums[0]), nums[0]);
const seq = nums.map((n) => Number(n.split('/').pop())).sort((a, b) => a - b);
ok('the series has no gaps', seq.every((n, k) => k === 0 || n === seq[k - 1] + 1), seq.join(','));
ok('invoices are returned newest first',
   Number(nums[0].split('/').pop()) > Number(nums[nums.length - 1].split('/').pop()));

console.log('\n=== billing details ===');
ok('a bad GSTIN is refused',
   call({ action: 'saveBilling', token: A, form: { gstin: 'NOTAGSTIN' } }).status === 'error');
ok('a GSTIN with an unknown state code is refused',
   call({ action: 'saveBilling', token: A, form: { gstin: '99AACCA1111A1Z5' } }).status === 'error');
ok('no GSTIN is allowed — not every customer is registered',
   call({ action: 'saveBilling', token: A, form: { legalName: 'Acme', state: 'Kerala' } }).status === 'success');
ok('a typed state still sets the place of supply',
   call({ action: 'getBilling', token: A }).billing.state === 'Kerala');
ok('getBilling offers the state list', call({ action: 'getBilling', token: A }).states.length > 30);

console.log('\n=== only the Admin sees the company finances ===');
call({ action: 'addUser', token: A, form: { name: 'Payel S', username: 'payel' + R,
  email: 'payel' + R + '@acme.in', role: 'Doer', jobProfile: 'Executive', password: 'staffpass123' } });
const P = call({ action: 'login', username: 'payel' + R + '@acme.in', password: 'staffpass123' }).token;
ok('a Doer cannot list invoices', call({ action: 'getInvoices', token: P }).status === 'error');
ok('a Doer cannot change billing details',
   call({ action: 'saveBilling', token: P, form: { legalName: 'Mine now' } }).status === 'error');
ok('a Doer cannot read billing details', call({ action: 'getBilling', token: P }).status === 'error');

console.log('\n=== one company never sees another company\'s invoices ===');
const e2 = 'owner2' + R + '@beta.in';
const B = call({ action: 'register', form: { companyName: 'Beta Works',
  name: 'Sara K', email: e2, password: 'strongpass123' } }).token;
ok('a new company starts with none', call({ action: 'getInvoices', token: B }).invoices.length === 0);

console.log('\n=== unregistered seller: no tax, and it says so ===');
env.props.SELLER_GSTIN = '';
before = env.mails.length;
pay(sheetId, 'Starter', 'Acme Engineering', 249900, 'pay_' + R + '_4');  // listed price, no tax
const i4 = call({ action: 'getInvoices', token: A }).invoices[0];
ok('nothing is taxed without a GSTIN', i4.rate === 0 && i4.cgst === 0 && i4.igst === 0, JSON.stringify(i4));
ok('the taxable value is the whole amount', i4.taxable === i4.total, i4.taxable + '/' + i4.total);
const d4 = env.mails.slice(before).filter((m) => /invoice/i.test(m.subject) && m.to === email)[0];
ok('it is not called a tax invoice', !/Tax invoice/.test(d4.subject), d4.subject);
ok('and it says plainly why no tax was charged', /not registered under GST/.test(d4.html));
env.props.SELLER_GSTIN = '19AABCB1234C1ZQ';

console.log('\n=== the checkout charges what the invoice will show ===');
const code = require('fs').readFileSync('/home/user/stockpilot/dist/code.gs', 'utf8');
ok('the order amount has the tax added to it',
   /amount = Math\.round\(net \* \(100 \+ rate\) \/ 100\)/.test(code));
ok('the breakdown is returned to the browser before the card is shown',
   /charge: \{ net:/.test(code));
ok('the rate the checkout uses is the rate the invoice uses',
   /function gstRate_\(\) \{ return sellerIdentity_\(\)\.rate; \}/.test(code));
ok('setup refuses to stay quiet about a missing supplier address',
   /an invoice must carry the supplier address/.test(code));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
