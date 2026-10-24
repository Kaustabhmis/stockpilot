/**
 * "Online payment is not configured yet" on the live site: the keys are read
 * forgivingly, the customer is told what to do (not what we forgot), the
 * owner is alerted once, and checkPayments says exactly what is wrong.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 300) + ']')); v ? pass++ : fail++; };

const env = build();
Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b' });
env.newFile('MASTER', 'Domebox Master');
const tpl = env.newFile('TEMPLATE', 'Template');
['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
tpl.getSheetByName('Settings').appendRow(['General']);
let rzpAuth = null, fetched = 0;
env.G.UrlFetchApp = { fetch(url, o) {
  fetched++; const a = (o.headers || {}).Authorization || '';
  const good = a === 'Basic ' + Buffer.from('rzp_live_ABC123:sekret').toString('base64');
  const res = (c, b) => ({ getResponseCode: () => c, getContentText: () => JSON.stringify(b) });
  if (!good) return res(401, { error: { description: 'Authentication failed' } });
  if (/\/v1\/orders/.test(url)) return res(200, { id: 'order_1', amount: 99900, currency: 'INR' });
  return res(200, { items: [] });
} };
const SRC = fs.readFileSync(__dirname + '/../dist/code.gs', 'utf8');
const names = Object.keys(env.G);
const P = new Function(...names, SRC + '\n;return { doPost, ensureRegistry, checkPayments };')(...names.map((n) => env.G[n]));
P.ensureRegistry();
const call = (b) => JSON.parse(P.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
const reg = call({ action: 'register', form: { companyName: 'Mehta Castings', name: 'Rohan', email: 'rohan@mehta.in', password: 'ownerpass123' } });
const buy = () => call({ action: 'initiateRazorpay', token: reg.token, planName: 'Team' });

console.log('\n=== no keys in this project ===');
let r = buy();
ok('the customer is told what to do, not that something is "not configured"',
   r.status === 'error' && /try again shortly/.test(r.message) && /payment link/.test(r.message) && !/configured/.test(r.message), r.message);
const alerts = () => env.mails.filter((m) => /could not pay/.test(m.subject)).length;
ok('the owner gets an ACTION NEEDED email naming the missing key', alerts() === 1 &&
   /RAZORPAY_KEY_ID/.test(env.mails.find((m) => /could not pay/.test(m.subject)).html));
buy(); buy();
ok('only once, however many customers try', alerts() === 1, alerts());
let chk = P.checkPayments();
ok('checkPayments names both missing keys and says where to add them', /MISSING\s+RAZORPAY_KEY_ID/.test(chk) && /MISSING\s+RAZORPAY_KEY_SECRET/.test(chk) && /THIS project/.test(chk), chk);
ok('and prints this project’s address to compare with apiUrl', /answers at/.test(chk) && /apiUrl in domebox-config\.js/.test(chk));

console.log('\n=== keys typed with a stray space and in lower case ===');
env.props['RAZORPAY_KEY_ID '] = ' rzp_live_ABC123\n';
env.props['razorpay_key_secret'] = 'sekret ';
r = buy();
ok('they are found anyway, and the payment window opens', r.status === 'success' && r.orderData && r.orderData.key === 'rzp_live_ABC123',
   JSON.stringify(r).slice(0, 200));
chk = P.checkPayments();
ok('checkPayments says they were found, and asks for the names to be tidied', /FIXED\s+RAZORPAY_KEY_ID was typed as "RAZORPAY_KEY_ID "/.test(chk) &&
   /FIXED\s+RAZORPAY_KEY_SECRET/.test(chk), chk);
ok('and that Razorpay accepted them, in LIVE mode', /Razorpay accepted the keys \(LIVE/.test(chk), chk);

console.log('\n=== keys that are wrong ===');
delete env.props['RAZORPAY_KEY_ID ']; delete env.props['razorpay_key_secret'];
env.props.RAZORPAY_KEY_ID = 'sekret'; env.props.RAZORPAY_KEY_SECRET = 'rzp_live_ABC123';
chk = P.checkPayments();
ok('swapped id and secret are spotted', /should start rzp_live_/.test(chk) && /Razorpay refused the keys/.test(chk), chk);
env.props.RAZORPAY_KEY_ID = 'rzp_live_ABC123'; env.props.RAZORPAY_KEY_SECRET = 'sekret';
chk = P.checkPayments();
ok('correct keys: all ok', /ok\s+RAZORPAY_KEY_ID/.test(chk) && /ok\s+RAZORPAY_KEY_SECRET/.test(chk) && /accepted/.test(chk), chk);
ok('and a buy works', buy().status === 'success');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
