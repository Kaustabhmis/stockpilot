/**
 * The 14-day trial, end to end on the real code: what a new company gets, what
 * happens when the trial ends, the emails on the way, and paying for a plan.
 * Plus the public demo route, which must only ever read.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 260) + ']')); v ? pass++ : fail++; };

const env = build();
Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b' });
env.newFile('MASTER', 'Domebox Master');
const tpl = env.newFile('TEMPLATE', 'Template');
['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
tpl.getSheetByName('Settings').appendRow(['General']);

const SRC = fs.readFileSync(__dirname + '/../dist/code.gs', 'utf8') + '\n' +
            fs.readFileSync(__dirname + '/../domebox/reminders.gs', 'utf8');
const names = Object.keys(env.G);
const P = new Function(...names, SRC + '\n;return { doPost, ensureRegistry, REG, SCHED, sendRenewalReminders, createDemoAccount, grantPlan_ };')(...names.map((n) => env.G[n]));
P.ensureRegistry();
const call = (b) => JSON.parse(P.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const dirRow = (email) => {
  const d = env.FILES.MASTER.getSheetByName('Directory').getDataRange().getValues();
  for (let i = 1; i < d.length; i++) if (String(d[i][1]) === email) return { i, r: d[i] };
  return null;
};
const setUntil = (email, ymd) => env.FILES.MASTER.getSheetByName('Directory').getRange(dirRow(email).i + 1, 5).setValue(ymd);

console.log('\n=== a new company gets the full Growth plan for 14 days ===');
const reg = call({ action: 'register', form: { companyName: 'Mehta Castings', name: 'Rohan', email: 'rohan@mehta.in', password: 'strongpass123' } });
ok('signing up succeeds', reg.status === 'success', JSON.stringify(reg));
const row = dirRow('rohan@mehta.in').r;
ok('the registry says Growth, Trial, ending in 14 days', row[3] === 'Growth' && row[6] === 'Trial' && row[4] === day(14), JSON.stringify(row));
const welcome = env.mails.find((m) => m.to === 'rohan@mehta.in' && /Welcome/.test(m.subject));
ok('the welcome email says it is a 14-day Growth trial, no card', welcome && /Growth plan free for 14 days/.test(welcome.html) && /No card/.test(welcome.html),
   welcome && welcome.html.slice(0, 300));
let d = call({ action: 'getDashboard', token: reg.token });
ok('the app knows it is a trial with 14 days left', d.usage.trial === true && d.usage.daysLeft === 14 && d.usage.planName === 'Growth', JSON.stringify(d.usage));
for (let i = 0; i < 6; i++) call({ action: 'addUser', token: reg.token, form: { name: 'P' + i, username: 'p' + i, email: 'p' + i + '@mehta.in', role: 'Doer', manager: '', jobProfile: 'X', password: 'staffpass123' } });
ok('during the trial it can grow past the Free limit of 5', call({ action: 'getUsers', token: reg.token }).users.length === 7);
ok('and use the paid reports', call({ action: 'getAnalytics', token: reg.token, period: 'month' }).status === 'success');

console.log('\n=== the emails on the way ===');
P.REG.SHEET_ID = 'MASTER'; P.SCHED.DRY_RUN = false;
for (const [n, re] of [[3, /trial ends in 3 days/], [1, /trial ends tomorrow/], [0, /trial ends today/]]) {
  setUntil('rohan@mehta.in', day(n));
  const before = env.mails.length;
  P.sendRenewalReminders();
  const m = env.mails.slice(before).find((x) => x.to === 'rohan@mehta.in');
  ok(n + ' day(s) out: “' + (m ? m.subject : '—') + '”', m && re.test(m.subject) && /Nothing is deleted/.test(m.html) && !/renews/.test(m.subject),
     m && m.subject);
}
setUntil('rohan@mehta.in', day(7));
const b7 = env.mails.length; P.sendRenewalReminders();
ok('and no renewal-style nagging on the other days', !env.mails.slice(b7).some((x) => x.to === 'rohan@mehta.in'));

console.log('\n=== when the trial ends ===');
setUntil('rohan@mehta.in', day(-1));
d = call({ action: 'getDashboard', token: reg.token });
ok('the workspace moves to Free', d.usage.planName === 'Free Tier' || d.usage.plan === 'Free', JSON.stringify(d.usage));
ok('it is not locked: a trial is not a lapsed payment', !d.serviceStopped && d.usage.trialEnded === true, JSON.stringify(d.usage));
ok('everybody can still sign in', call({ action: 'login', username: 'p3@mehta.in', password: 'staffpass123' }).status === 'success');
const more = call({ action: 'addUser', token: reg.token, form: { name: 'Q', username: 'q', email: 'q@mehta.in', role: 'Doer', manager: '', jobProfile: 'X', password: 'staffpass123' } });
ok('but nobody new beyond the Free limit', more.status === 'error', JSON.stringify(more));
setUntil('rohan@mehta.in', day(-30));
d = call({ action: 'getDashboard', token: reg.token });
ok('even a month later it is still Free, not read-only', !d.serviceStopped, JSON.stringify(d.usage));

console.log('\n=== paying turns the trial into a plan ===');
setUntil('rohan@mehta.in', day(5));
P.grantPlan_(reg.token ? dirRow('rohan@mehta.in').r[5] : '', 'Growth Yearly', { id: 'pay_1', amount: 5999000 }, 'Mehta Castings');
const after = dirRow('rohan@mehta.in').r;
ok('status becomes Active', after[6] === 'Active', JSON.stringify(after));
ok('and the 5 trial days left are added to the year', after[4] === day(5 + 365), after[4] + ' vs ' + day(370));
d = call({ action: 'getDashboard', token: reg.token });
ok('the trial banner is gone', d.usage.trial === false, JSON.stringify(d.usage));

console.log('\n=== the public demo only ever reads ===');
const noDemo = call({ action: 'openDemo', as: 'owner' });
ok('before a demo exists it says so politely', noDemo.status === 'error' && /being refreshed/.test(noDemo.message), JSON.stringify(noDemo));
P.createDemoAccount();
const demo = call({ action: 'openDemo', as: 'staff' });
ok('anyone can open it, without a password', demo.status === 'success' && demo.demo === true && demo.user.username === 'payel', JSON.stringify(demo).slice(0, 200));
ok('reading works', call({ action: 'getDashboard', token: demo.token }).status === 'success');
const mails0 = env.mails.length;
const w = call({ action: 'createTask', token: demo.token, form: { title: 'spam', assignTo: 'sruti', dueDate: day(3), priority: 'Low' } });
ok('writing is refused', w.status === 'error' && /changes are switched off/.test(w.message), JSON.stringify(w));
ok('and no email went anywhere', env.mails.length === mails0);
ok('an unknown view falls back to the owner', call({ action: 'openDemo', as: 'root' }).user.role === 'Admin');
{
  /* Every route a demo token may call, as every demo role: the demo company's
     spreadsheet must be exactly the same afterwards, cell for cell. */
  const demoId = (() => { const d = env.FILES.MASTER.getSheetByName('Directory').getDataRange().getValues();
    for (let i = 1; i < d.length; i++) if (String(d[i][1]) === 'demo@biscsindia.com') return String(d[i][5]); })();
  const snap = () => JSON.stringify(env.FILES[demoId].getSheets().map((sh) => [sh.getName(), sh.getDataRange().getValues()]));
  const before = snap();
  const mails1 = env.mails.length;
  const ROUTES = ['getDashboard','getArchive','getTasks','getUsers','getProjects','getOrgChart','getCookies','getAnalytics',
    'getAccountability','getPerformanceReport','getAppraisalForm','getKraOverview','getKraFor','getCategories',
    'getPriorityList','getLeaderboard','getDirection','getMeetings','getMeeting','getLeave'];
  const errors = [];
  for (const as of ['owner', 'manager', 'staff']) {
    const t = call({ action: 'openDemo', as }).token;
    for (const r of ROUTES) {
      const res = call({ action: r, token: t, username: 'payel', period: 'month', id: 'x' });
      if (res.status === 'error' && /switched off/.test(res.message)) errors.push(as + ':' + r);
    }
  }
  ok('every read route is open to the demo', errors.length === 0, errors.join(', '));
  const after = snap();
  let firstDiff = '';
  if (before !== after) { const a = JSON.parse(before), b = JSON.parse(after);
    a.forEach((sh, i) => { if (!firstDiff && JSON.stringify(sh) !== JSON.stringify(b[i])) firstDiff = sh[0]; });
    if (!firstDiff && a.length !== b.length) firstDiff = 'sheet count ' + a.length + ' -> ' + b.length; }
  ok('and calling all of them, as all three roles, changes nothing in the demo company', before === after, firstDiff);
  ok('or sends any email', env.mails.length === mails1);
}

console.log('\n=== the call-back form ===');
const cb0 = env.mails.length;
const cb = call({ action: 'contactSales', form: { kind: 'callback', name: 'Asha', companyName: 'Asha Traders', phone: '98300 11111', size: '30', when: 'Morning' } });
const cbm = env.mails.slice(cb0);
ok('a call-back request reaches us', cb.status === 'success' && cbm.length === 1 && /Call-back request — Asha Traders/.test(cbm[0].subject), JSON.stringify(cb));
ok('and only us — never the address in the form', cbm.every((m) => !/asha/i.test(m.to)));
ok('without a phone or email it is refused', call({ action: 'contactSales', form: { name: 'x', companyName: 'y' } }).status === 'error');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
