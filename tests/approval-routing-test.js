/**
 * An approval request reaches the person who has to decide it — even when
 * "Reports to" in the sheet was typed by hand as their name, their email, or
 * with different capitals, instead of their exact username.
 *
 * Before the fix, all three sent the request to nobody: the task sat in
 * Awaiting Approval with no card on any board but an Admin's, and no email.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 200) + ']')); v ? pass++ : fail++; };

const boot = () => {
  const env = build();
  Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b', REMINDERS_LIVE: 'yes' });
  env.newFile('MASTER', 'Master');
  const tpl = env.newFile('TEMPLATE', 'Template');
  ['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
  tpl.getSheetByName('Settings').appendRow(['General']);
  const names = Object.keys(env.G);
  const src = fs.readFileSync(__dirname + '/../dist/code.gs', 'utf8') + '\n' + fs.readFileSync(__dirname + '/../domebox/reminders.gs', 'utf8');
  const X = new Function(...names, src + '\n;return { doPost, ensureRegistry, U, T, rmLoadTenant_: typeof rmLoadTenant_ === "function" ? rmLoadTenant_ : null };')(...names.map((n) => env.G[n]));
  X.ensureRegistry();
  const call = (b) => JSON.parse(X.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
  const A = call({ action: 'register', form: { companyName: 'Acme', name: 'Owner', email: 'o@a.in', password: 'ownerpass123' } }).token;
  const add = (n, u, role, mgr) => call({ action: 'addUser', token: A, form: { name: n, username: u, email: u + '@a.in', role, manager: mgr || '', jobProfile: 'Ops', password: 'staffpass123' } });
  add('Hema HR', 'hema', 'HOD'); add('Arjun B', 'arjun', 'HOD'); add('Payel S', 'payel', 'Doer', 'hema');
  const sid = Object.keys(env.FILES).find((k) => /^SHEET_/.test(k) && env.FILES[k].getSheetByName('Users'));
  const T = (u) => call({ action: 'login', username: u + '@a.in', password: 'staffpass123' }).token;
  return { env, X, call, A, T, ss: env.FILES[sid] };
};

for (const [variant, typed] of [['exact username', 'hema'], ['different capitals', 'HEMA'], ['extra spaces', '  hema '],
  ['her email', 'Hema@A.in'], ['her full name', 'Hema HR']]) {
  console.log('\n=== "Reports to" typed as ' + variant + ' ===');
  const { env, X, call, T, ss } = boot();
  ss.getSheetByName('Users')._data.find((r) => r[1] === 'payel')[X.U['Manager']] = typed;
  const before = env.mails.length;
  const r = call({ action: 'createTask', token: T('arjun'), form: { title: 'Cross-team job', assignTo: 'payel', dueDate: '2026-12-01' } });
  ok('it is sent for approval', r.routedForApproval === 1, JSON.stringify(r));
  const H = T('hema');
  const t = (call({ action: 'getDashboard', token: H }).tasks || []).find((x) => x.title === 'Cross-team job');
  ok('the HR head sees the card', !!t && t.status === 'Awaiting Approval', JSON.stringify(t && { s: t.status, a: t.approver }));
  ok('and is emailed', env.mails.slice(before).some((m) => /hema@a\.in/.test(m.to)));
  ok('and can approve it', t && call({ action: 'processTaskApproval', token: H, taskId: t.id, isApproved: true }).status === 'success');
  ok('the team list shows her as Payel\'s manager', (call({ action: 'getUsers', token: H }).users || []).find((u) => u.username === 'payel').manager === 'hema');
}

console.log('\n=== a request already stuck before the fix comes back ===');
{
  const { X, call, A, T, ss } = boot();
  call({ action: 'createTask', token: A, form: { title: 'Old stuck job', assignTo: 'payel', dueDate: '2026-12-01' } });
  // as the old code would have written it: approver saved as the name, not the username
  const row = ss.getSheetByName('Tasks')._data.find((r) => r[X.T['Title']] === 'Old stuck job');
  row[X.T['Status']] = 'Awaiting Approval'; row[X.T['Assigned By']] = 'arjun'; row[X.T['Approver Manager']] = 'Hema HR';
  const H = T('hema');
  const t = (call({ action: 'getDashboard', token: H }).tasks || []).find((x) => x.title === 'Old stuck job');
  ok('the HR head now sees it', !!t, 'not on her board');
  ok('and can decide it', t && call({ action: 'processTaskApproval', token: H, taskId: t.id, isApproved: true }).status === 'success');
  ok('nobody else is handed it', !(call({ action: 'getDashboard', token: T('payel') }).tasks || []).some((x) => x.title === 'Old stuck job' && x.status === 'Awaiting Approval' && x.approver === 'payel'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
