/**
 * The monthly owner report: last month in one email to every Admin, on the
 * 1st (with a catch-up on the 2nd and 3rd), once per company per month, with
 * the same numbers the Leaderboard shows. Admins can also email it to
 * themselves at any time. Both editions.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 300) + ']')); v ? pass++ : fail++; };

const now = new Date();
const firstOfNext = new Date(now.getFullYear(), now.getMonth() + 1, 1, 9, 5);
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

for (const [label, file] of [['Domebox', '/../dist/code.gs'], ['Domebox Lite', '/../dist/lite/Code.gs']]) {
  console.log('\n######## ' + label + ' ########');
  const env = build();
  Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b',
    DEMO_PASSWORD: 'demo-pass-for-tests', DEMO_STAFF_PASSWORD: 'staff-pass-for-tests' });
  env.G.GmailApp.__setAliases(['info@biscsindia.com', 'mis@dynamicengineers.in']);
  env.newFile('MASTER', 'Master');
  const tpl = env.newFile('TEMPLATE', 'Template');
  ['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
  tpl.getSheetByName('Settings').appendRow(['General']);
  const names = Object.keys(env.G);
  const X = new Function(...names, fs.readFileSync(__dirname + file, 'utf8') +
    '\n;return { doPost, ensureRegistry, createDemoAccount, sendMonthlyOwnerReports, previewOwnerReports, switchOnSchedules };')(...names.map((n) => env.G[n]));
  X.ensureRegistry();
  const call = (b) => JSON.parse(X.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
  const reports = () => env.mails.filter((m) => /on time|jobs closed/.test(m.subject) && / in Domebox/.test(m.subject));

  let A, owner;
  if (label === 'Domebox') {
    /* A full factory's month, built the way the demo is, but on an ordinary
       address — the real demo is skipped by the report on purpose. */
    X.createDemoAccount('owner@factory.in', 'ownerpass123');
    A = call({ action: 'login', username: 'owner@factory.in', password: 'ownerpass123' }).token;
    owner = 'owner@factory.in';
    call({ action: 'addUser', token: A, form: { name: 'Second Admin', username: 'admin2', email: 'admin2@factory.in', role: 'Admin', jobProfile: 'Director', password: 'staffpass123' } });
  } else {
    A = call({ action: 'register', form: { companyName: 'Dynamic Engineers', name: 'Lite Owner', email: 'o@de.in', password: 'ownerpass123' } }).token;
    owner = 'o@de.in';
    call({ action: 'addUser', token: A, form: { name: 'Payel Sen', username: 'payel', email: 'payel@de.in', role: 'Doer', jobProfile: 'Ops', password: 'staffpass123' } });
    const P = call({ action: 'login', username: 'payel@de.in', password: 'staffpass123' }).token;
    for (const title of ['Despatch 40 shafts', 'Count bin A', 'Calibrate gauge']) {
      call({ action: 'createTask', token: A, form: { title, assignTo: 'payel', dueDate: '2030-01-01' } });
      const t = call({ action: 'getDashboard', token: A }).tasks.find((x) => x.title === title);
      call({ action: 'updateTask', token: P, taskId: t.id, status: 'In Progress' });
      call({ action: 'updateTask', token: P, taskId: t.id, status: 'For Review' });
      call({ action: 'updateTask', token: A, taskId: t.id, status: 'Verified' });
    }
  }
  env.mails.length = 0;

  console.log('\n=== on the 1st ===');
  const log = X.sendMonthlyOwnerReports(firstOfNext);
  const sent = reports();
  const admins = label === 'Domebox' ? [owner, 'admin2@factory.in'] : [owner];
  ok('every Admin gets last month’s report, and nobody else', sent.length === admins.length && admins.every((a) => sent.some((m) => m.to === a)), sent.map((m) => m.to).join(', ') + ' ' + log);
  const m = sent[0] || { subject: '', html: '' };
  ok('the subject names the company, the month and the on-time rate', new RegExp(MONTHS[now.getMonth()].slice(0, 3) + ' ' + now.getFullYear()).test(m.subject) && /% on time/.test(m.subject), m.subject);
  const dash = call({ action: 'getLeaderboard', token: A, period: 'month', offset: 0 });
  const top = (dash.rows || []).slice(0, 3).map((r) => r.name);
  ok('"who carried the month" is the Leaderboard’s top three', top.length && top.every((n) => m.html.indexOf(n) > -1), top.join(', '));
  ok('with the numbers that matter', /On time/.test(m.html) && /Jobs closed/.test(m.html) && /Delivered late/.test(m.html) && /Overdue/.test(m.html));
  ok('and a link to the full report', /Open the full report/.test(m.html));
  if (label === 'Domebox') ok('the people in the lowest band are named as worth a conversation', /Worth a conversation/.test(m.html) === (dash.rows || []).some((r) => r.band === 'C'));

  console.log('\n=== once a month ===');
  env.mails.length = 0;
  X.sendMonthlyOwnerReports(new Date(firstOfNext.getTime() + 86400000));
  ok('the next day’s run sends nothing more', reports().length === 0, reports().map((x) => x.to).join(','));
  const marker = (() => { const t = Object.values(env.FILES).find((f) => f.getSheetByName && f.getSheetByName('Settings') &&
      f.getSheetByName('Settings').getDataRange().getValues().some((r) => r[3] === 'ownerReportSent'));
    return t ? t.getSheetByName('Settings').getDataRange().getValues().find((r) => r[3] === 'ownerReportSent')[4] : ''; })();
  ok('the "sent" mark is text Sheets cannot turn into a date', /^sent \d{4}-\d{2}$/.test(String(marker)), marker);
  X.sendMonthlyOwnerReports(new Date(firstOfNext.getTime() + 4 * 86400000));
  ok('nor does a run after the 3rd', reports().length === 0);
  ok('the preview sends nothing either', typeof X.previewOwnerReports() === 'string' && reports().length === 0);

  console.log('\n=== on demand ===');
  const me = call({ action: 'emailOwnerReport', token: A });
  ok('an Admin can email it to themselves now', me.status === 'success' && reports().length === 1 && reports()[0].to === owner, JSON.stringify(me));
  const D = label === 'Domebox' ? call({ action: 'login', username: 'payel@demo.domebox.in', password: 'staff-pass-for-tests' }).token
                                : call({ action: 'login', username: 'payel@de.in', password: 'staffpass123' }).token;
  ok('staff cannot', /Admin account/.test(call({ action: 'emailOwnerReport', token: D }).message || ''));

  console.log('\n=== scheduled ===');
  X.switchOnSchedules();
  ok('switchOnSchedules sends it from the 1st, around 9 am', env.triggerHours.some((t) => t[0] === 'sendMonthlyOwnerReports' && t[1] === 9), JSON.stringify(env.triggerHours));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
