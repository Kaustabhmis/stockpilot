/**
 * Changing plans mid-term. Days left on a different paid plan are credited by
 * their rupee value, not one-for-one; trial days and an early renewal of the
 * same plan simply add on; nothing carries over from Free. Domebox only.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 260) + ']')); v ? pass++ : fail++; };

const env = build();
Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b' });
env.G.GmailApp.__setAliases(['info@biscsindia.com']);
env.newFile('MASTER', 'Domebox Master');
const tpl = env.newFile('TEMPLATE', 'Template');
['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
tpl.getSheetByName('Settings').appendRow(['General']);
const names = Object.keys(env.G);
const X = new Function(...names, fs.readFileSync(__dirname + '/../dist/code.gs', 'utf8') +
  '\n;return { doPost, ensureRegistry, grantPlan_, planSwitchCredit_ };')(...names.map((n) => env.G[n]));
X.ensureRegistry();
const call = (b) => JSON.parse(X.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
call({ action: 'register', form: { companyName: 'Acme', name: 'Owner', email: 'o@acme.in', password: 'ownerpass123' } });
const dir = () => env.FILES.MASTER.getSheetByName('Directory');
const rowI = () => dir().getDataRange().getValues().findIndex((r) => r[1] === 'o@acme.in');
const set = (plan, status, daysLeft) => { const i = rowI() + 1, d = new Date(); d.setDate(d.getDate() + daysLeft);
  dir().getRange(i, 4).setValue(plan); dir().getRange(i, 7).setValue(status); dir().getRange(i, 5).setValue(d.toISOString().slice(0, 10)); };
const sheetId = () => dir().getDataRange().getValues()[rowI()][5];
const daysTo = (ymd) => Math.round((new Date(ymd + 'T12:00:00') - new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00')) / 86400000);
let n = 0;
const buy = (plan, rupees) => X.grantPlan_(sheetId(), plan, { id: 'pay_sw_' + (++n), amount: rupees * 100, order_id: 'o' + n }, 'Acme');

console.log('\n=== moving up: the days left are worth what they cost ===');
set('Team Yearly', 'Active', 300);
let until = buy('Growth', 5999);
/* 300 days of Team Yearly = 300 x 9990/365 = Rs 8,211; a Growth day costs 5999/30 = Rs 199.97 -> 41 days, plus the 30 bought. */
ok('300 days of Team Yearly become about 41 days of Growth, on top of the month bought (not 330)', Math.abs(daysTo(until) - (30 + 41)) <= 1, daysTo(until));
const rec = env.mails.filter((m) => /receipt/i.test(m.subject)).pop() || { html: '' };
ok('the receipt says what was credited', /days left on your Team \(yearly\) plan were worth about ₹8,[12]\d\d/.test(rec.html) && /4[01] days of Growth/.test(rec.html), rec.html.replace(/<[^>]+>/g, ' ').slice(0, 400));

console.log('\n=== moving down: the customer does not lose what they paid for ===');
set('Scale Yearly', 'Active', 100);
until = buy('Team', 999);
/* 100 days of Scale Yearly = 100 x 129990/365 = Rs 35,614; a Team day is 999/30 = Rs 33.3 -> 1,069 days. */
ok('100 days of Scale Yearly become about 1,060 days of Team (by value, give or take the part-day left)', Math.abs(daysTo(until) - (30 + 1069)) <= 15, daysTo(until));

console.log('\n=== what is not converted ===');
set('Growth', 'Active', 10);
until = buy('Growth', 5999);
ok('renewing the same plan early just adds the month', Math.abs(daysTo(until) - 40) <= 1, daysTo(until));
set('Growth', 'Trial', 9);
until = buy('Team', 999);
ok('days left on the free trial are added on as they are, as the site promises', Math.abs(daysTo(until) - 39) <= 1, daysTo(until));
set('Free', 'Active', 200);
until = buy('Team', 999);
ok('nothing is carried over from the Free plan', Math.abs(daysTo(until) - 30) <= 1, daysTo(until));
set('Starter', 'Active', -5);
until = buy('Growth', 5999);
ok('an expired plan starts from today', Math.abs(daysTo(until) - 30) <= 1, daysTo(until));
ok('Enterprise (no list price) is never converted', X.planSwitchCredit_('Enterprise', 'Active', 'Growth', new Date(Date.now() + 50 * 864e5), new Date()) === null);
ok('monthly and yearly of the same plan are the same plan: days carry over as they are',
   X.planSwitchCredit_('Team', 'Active', 'Team Yearly', new Date(Date.now() + 20 * 864e5), new Date()) === null &&
   X.planSwitchCredit_('Growth Yearly', 'Active', 'Growth', new Date(Date.now() + 200 * 864e5), new Date()) === null);
set('Growth Yearly', 'Active', 200);
until = buy('Growth', 5999);
ok('so a yearly Growth customer paying a Growth month keeps all 200 days and adds 30', Math.abs(daysTo(until) - 230) <= 1, daysTo(until));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
