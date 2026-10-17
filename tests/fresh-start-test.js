/**
 * A brand-new installation from nothing: freshStart() in an empty Apps Script
 * project, then a real signup, a returning customer put back on their plan,
 * and the reminders working with reminders.gs pasted in unedited.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 300) + ']')); v ? pass++ : fail++; };

const env = build();            // an empty project: no Script Properties at all
const SRC = fs.readFileSync(__dirname + '/../dist/code.gs', 'utf8') + '\n' +
            fs.readFileSync(__dirname + '/../domebox/reminders.gs', 'utf8') + '\n' +
            fs.readFileSync(__dirname + '/../domebox/backup.gs', 'utf8');
const names = Object.keys(env.G);
/* Apps Script runs the whole project's top-level code at the start of every
   execution, so each "run" here loads it afresh. */
const run = () => new Function(...names, SRC + '\n;return { freshStart, setupDomeBox, setCustomerPlan, doPost, REG, SCHED, ' +
  'sendTaskReminders, switchOnSchedules };')(...names.map((n) => env.G[n]));
const tabs = (id) => env.FILES[id].getSheets().map((s) => s._name || s.getName());

console.log('\n=== freshStart builds everything ===');
let P = run();
const log1 = P.freshStart();
const M = env.props.MASTER_DB_ID, T = env.props.TEMPLATE_ID;
ok('it saves the Master and Template ids', !!M && !!T && M !== T, JSON.stringify(env.props));
ok('and the two secret keys', !!env.props.AUTH_PEPPER && !!env.props.TOKEN_SECRET);
ok('the Master sheet has the registry tabs, and no empty Sheet1',
   ['Directory', 'Global_Users', 'Reset_Tokens', 'Billing', 'Invoices'].every((t) => tabs(M).indexOf(t) > -1) && tabs(M).indexOf('Sheet1') < 0,
   tabs(M).join(', '));
ok('the Template has every tab a company needs, and no empty Sheet1',
   ['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings', 'Meetings', 'Goals'].every((t) => tabs(T).indexOf(t) > -1) && tabs(T).indexOf('Sheet1') < 0,
   tabs(T).join(', '));
ok('with the column headers in place', env.FILES[T].getSheetByName('Tasks').getDataRange().getValues()[0].length > 20);
const folder = env.G.DriveApp.getFoldersByName('Domebox');
const f = folder.hasNext() ? folder.next() : null;
ok('both sheets are in a "Domebox" folder in Drive', f && f._ids.indexOf(M) > -1 && f._ids.indexOf(T) > -1);
ok('and the log says what to do next, with links', /Domebox Master\s+https:/.test(log1) && /switchOnSchedules/.test(log1) && /createDemoAccount/.test(log1), log1);

console.log('\n=== it can never replace a working installation ===');
const files0 = Object.keys(env.FILES).length;
const log2 = run().freshStart();
ok('a second run stops and creates nothing', /STOPPED/.test(log2) && Object.keys(env.FILES).length === files0 && env.props.MASTER_DB_ID === M, log2);

console.log('\n=== the rest of setup sees it ===');
P = run();
const setup = P.setupDomeBox();
ok('setupDomeBox finds the Master and Template', /set\s+MASTER_DB_ID/.test(setup) && /set\s+TEMPLATE_ID/.test(setup) &&
   /template has the tabs a new company needs/.test(setup), setup.slice(0, 600));

console.log('\n=== a customer signs up again ===');
const call = (b) => JSON.parse(P.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
const reg = call({ action: 'register', form: { companyName: 'Acme Forgings', name: 'Rohan', email: 'rohan@acme.in', password: 'strongpass123' } });
ok('signing up works on the new backend', reg.status === 'success', JSON.stringify(reg));
const A = reg.token;
call({ action: 'addUser', token: A, form: { name: 'Payel S', username: 'payel', email: 'payel@acme.in', role: 'Doer', manager: '', jobProfile: 'X', password: 'staffpass123' } });
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const t = call({ action: 'createTask', token: A, form: { title: 'Count bin G stock', assignTo: 'payel', dueDate: day(5), priority: 'High', jobCategory: 'General' } });
ok('and the team gets to work', t.status === 'success', JSON.stringify(t));

const m0 = env.mails.length;
const out = P.setCustomerPlan('rohan@acme.in', 'Growth Yearly');
const row = env.FILES[M].getSheetByName('Directory').getDataRange().getValues().find((r) => r[1] === 'rohan@acme.in');
ok('setCustomerPlan puts a returning customer back on their plan', row[3] === 'Growth Yearly' && row[6] === 'Active' && row[4] === day(365), JSON.stringify(row) + ' ' + out);
ok('without sending a receipt or an invoice', env.mails.length === m0);
const d = call({ action: 'getDashboard', token: A });
ok('and the app shows the paid plan, not a trial', d.usage.trial === false && d.usage.planName === 'Growth', JSON.stringify(d.usage));
ok('an unknown plan name is refused', /Unknown plan/.test(P.setCustomerPlan('rohan@acme.in', 'Platinum')));
ok('so is an email nobody signed up with', /No company signed up/.test(P.setCustomerPlan('nobody@x.in', 'Growth')));

console.log('\n=== reminders.gs works pasted in as it is ===');
P = run();       // the next execution, after freshStart saved its properties
ok('it reads the Master id from Script Properties', P.REG.SHEET_ID === M, P.REG.SHEET_ID);
ok('and is live, not a dry run', P.SCHED.DRY_RUN === false);
const sw = P.switchOnSchedules();
ok('switchOnSchedules installs reminders, backups and the archive in one run',
   env.triggers.filter((x) => x === 'sendTaskReminders').length === 3 && env.triggers.indexOf('backupAllTenants') > -1 &&
   env.triggers.indexOf('archiveOldTasks') > -1 && !/MISSING/.test(sw), env.triggers.join(',') + ' ' + sw);
const r0 = env.mails.length;
P.sendTaskReminders();
ok('and Payel is reminded about her new task', env.mails.slice(r0).some((x) => x.to === 'payel@acme.in' && /Count bin G stock/.test(x.html)),
   env.mails.slice(r0).map((x) => x.to).join(', '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
