/**
 * The scheduler against a REAL registry — the one the app itself creates.
 *
 * reminders.gs used to look for a registry tab called "Accounts" and read each
 * company's plan from a Billing tab inside the company's own file. The app's
 * registry tab is "Directory", and the plan lives there. So on a real
 * deployment the scheduler found no companies — or, given the tab, treated
 * every one as Free: no reminders, no digest, no renewal notices, no repeating
 * tasks. Every other scheduler test built its own "Accounts" tab and passed.
 *
 * This one loads dist/code.gs and domebox/reminders.gs into ONE scope, as they
 * sit in the Apps Script project, signs a company up through the real API, and
 * runs the scheduler against the registry that produced.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 260) + ']')); v ? pass++ : fail++; };

const env = build();
Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b' });
env.newFile('MASTER', 'Dome Box Master');
const tpl = env.newFile('TEMPLATE', 'Template');
['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
tpl.getSheetByName('Settings').appendRow(['General']);

const SRC = fs.readFileSync('/home/user/stockpilot/dist/code.gs', 'utf8') + '\n' +
            fs.readFileSync('/home/user/stockpilot/domebox/reminders.gs', 'utf8') + '\n' +
            fs.readFileSync('/home/user/stockpilot/domebox/backup.gs', 'utf8');
const names = Object.keys(env.G);
const P = new Function(...names, SRC + '\n;return { doPost, ensureRegistry, REG, SCHED, sendTaskReminders, sendDailyReminders, ' +
  'generateRecurringJobs, sendRenewalReminders, backupAllTenants, verifyLatestBackup };')(...names.map((n) => env.G[n]));
P.ensureRegistry();
const call = (b) => JSON.parse(P.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
const setPlan = (email, plan, days) => {
  const dir = env.FILES.MASTER.getSheetByName('Directory');
  dir.getDataRange().getValues().forEach((r, i) => {
    if (String(r[1]).toLowerCase() !== email) return;
    dir.getRange(i + 1, 4).setValue(plan);
    const u = new Date(); u.setDate(u.getDate() + days); dir.getRange(i + 1, 5).setValue(u.toISOString().slice(0, 10));
  });
};
const signUp = (company, email, doer) => {
  const A = call({ action: 'register', form: { companyName: company, name: 'Owner ' + company, email, password: 'strongpass123' } }).token;
  setPlan(email, 'Growth', 200);
  call({ action: 'addUser', token: A, form: { name: doer.name, username: doer.u, email: doer.u + '@' + email.split('@')[1],
    role: 'Doer', manager: '', jobProfile: 'Executive', password: 'staffpass123' } });
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const r = call({ action: 'createTask', token: A, form: { title: 'Count bin G stock — ' + company, assignTo: doer.u,
    dueDate: day(9), priority: 'High', jobCategory: 'General' } });
  return { A, r };
};

const acme = signUp('Acme Forgings', 'rohan@acme.in', { name: 'Payel S', u: 'payel' });
ok('a company signs up through the real API and gets a task', acme.r.status === 'success', JSON.stringify(acme.r));
const free = call({ action: 'register', form: { companyName: 'Free Co', name: 'Free Owner', email: 'f@free.in', password: 'strongpass123' } }).token;
call({ action: 'addUser', token: free, form: { name: 'Free Doer', username: 'fd', email: 'fd@free.in', role: 'Doer', manager: '', jobProfile: 'X', password: 'staffpass123' } });
call({ action: 'createTask', token: free, form: { title: 'Free task', assignTo: 'fd', dueDate: '2030-01-01', priority: 'High', jobCategory: 'General' } });
const lapsed = signUp('Lapsed Ltd', 'l@lapsed.in', { name: 'Lapsed Doer', u: 'ld' });
setPlan('l@lapsed.in', 'Growth', -5);

const tabs = env.FILES.MASTER.getSheets().map((s) => s._name || (s.getName && s.getName()));
ok('(the app’s registry has a Directory tab and no Accounts tab — the case that broke)',
   tabs.indexOf('Directory') > -1 && tabs.indexOf('Accounts') < 0, tabs.join(','));

P.REG.SHEET_ID = 'MASTER';
P.SCHED.DRY_RUN = false;

console.log('\n=== task reminders find real customers ===');
const before = env.mails.length;
const log = P.sendTaskReminders();
const sent = env.mails.slice(before);
ok('the scheduler finds the companies in Directory', /Companies: 3/.test(log), log.slice(0, 400));
ok('a doer at a paying company is reminded about their new task',
   sent.some((m) => m.to === 'payel@acme.in' && /Count bin G stock/.test(m.html)), sent.map((m) => m.to).join(', ') || log);
ok('a Free company is not emailed (reminders are a paid feature)', !sent.some((m) => /free\.in$/.test(m.to)));
ok('a company whose plan has lapsed is not emailed', !sent.some((m) => /lapsed\.in$/.test(m.to)));

console.log('\n=== the other scheduled jobs find them too ===');
const rec = P.generateRecurringJobs() || env.logs.slice(-1)[0] || '';
ok('recurring-job generation opens the registry', !/No registry tab found|REG\.SHEET_ID is empty|Cannot open the registry/.test(String(rec)),
   String(rec).slice(0, 300));
setPlan('rohan@acme.in', 'Growth', 3);
const r0 = env.mails.length;
P.sendRenewalReminders();
ok('renewal notices reach a paying owner 3 days before expiry', env.mails.slice(r0).some((m) => m.to === 'rohan@acme.in'),
   env.mails.slice(r0).map((m) => m.to + ': ' + m.subject).join(' | '));

console.log('\n=== backups copy every real customer ===');
/* backup.gs called loadTenants_, which no longer existed: every run failed
   before copying anything, and said so only in an alert email. */
const files0 = Object.keys(env.FILES).length;
const b0 = env.mails.length;
P.backupAllTenants();
const blog = env.logs.slice(-1)[0] || '';
const copies = Object.keys(env.FILES).length - files0;
ok('backupAllTenants copies all three companies', copies === 3 && !/FATAL/.test(blog), copies + ' copies · ' + blog.slice(0, 300));
ok('and sends no failure alert', !env.mails.slice(b0).some((m) => /backup/i.test(m.subject)),
   env.mails.slice(b0).map((m) => m.subject).join(' | '));
P.verifyLatestBackup();
const vlog = env.logs.slice(-1)[0] || '';
ok('verifyLatestBackup finds a good copy for every company', !/NO BACKUP AT ALL|✗/.test(vlog) && /Companies: 3/.test(vlog), vlog.slice(0, 400));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
