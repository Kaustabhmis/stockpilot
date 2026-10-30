/**
 * The task workflow an Admin chooses for the whole company: the standard three
 * steps, or two (To do -> For review -> Verified, no "In Progress"). Run on
 * both editions.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 220) + ']')); v ? pass++ : fail++; };

for (const [label, file] of [['Domebox', '/../dist/code.gs'], ['Domebox Lite', '/../dist/lite/Code.gs']]) {
  console.log('\n######## ' + label + ' ########');
  const env = build();
  Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b' });
  env.G.GmailApp.__setAliases(['info@biscsindia.com', 'mis@dynamicengineers.in']);
  env.newFile('MASTER', 'Master');
  const tpl = env.newFile('TEMPLATE', 'Template');
  ['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
  tpl.getSheetByName('Settings').appendRow(['General']);
  const names = Object.keys(env.G);
  const X = new Function(...names, fs.readFileSync(__dirname + file, 'utf8') + '\n;return { doPost, ensureRegistry };')(...names.map((n) => env.G[n]));
  X.ensureRegistry();
  const call = (b) => JSON.parse(X.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
  const msg = (b) => { const r = call(b); return r.status === 'error' ? r.message : ''; };
  const A = call({ action: 'register', form: { companyName: 'Acme', name: 'Owner', email: 'o@a.in', password: 'ownerpass123' } }).token;
  const add = (n, u, role, mgr) => call({ action: 'addUser', token: A, form: { name: n, username: u, email: u + '@a.in', role, manager: mgr || '', jobProfile: 'Ops', password: 'staffpass123' } });
  add('Sruti', 'sruti', 'HOD'); add('Payel', 'payel', 'Doer', 'sruti');
  const T = (u) => call({ action: 'login', username: u + '@a.in', password: 'staffpass123' }).token;
  const S = T('sruti'), P = T('payel');
  let n = 0;
  const mk = (extra) => { const title = 'Job ' + (++n);
    call({ action: 'createTask', token: S, form: Object.assign({ title, assignTo: 'payel', dueDate: '2026-12-01' }, extra || {}) });
    return call({ action: 'getDashboard', token: A }).tasks.find((t) => t.title === title); };
  const status = (id) => (call({ action: 'getDashboard', token: A }).tasks.find((t) => t.id === id) || {}).status;
  const move = (tok, id, s, extra) => call(Object.assign({ action: 'updateTask', token: tok, taskId: id, status: s }, extra || {}));

  console.log('\n=== the standard three steps, as before ===');
  ok('a new company starts on three steps', call({ action: 'getDashboard', token: A }).workflow === 'standard');
  const a = mk();
  ok('To do cannot jump straight to review', /does not allow/.test(msg({ action: 'updateTask', token: P, taskId: a.id, status: 'For Review' })));
  ok('Start work, then submit, then verify', move(P, a.id, 'In Progress').status === 'success' && move(P, a.id, 'For Review').status === 'success' &&
    move(S, a.id, 'Verified').status === 'success' && status(a.id) === 'Verified');

  console.log('\n=== only an Admin chooses ===');
  ok('a head of department cannot switch it', /Admin account/.test(msg({ action: 'saveWorkflow', token: S, workflow: 'short' })));
  ok('nor can staff', /Admin account/.test(msg({ action: 'saveWorkflow', token: P, workflow: 'short' })));
  const left = mk(); move(P, left.id, 'In Progress');           // already under way when the switch happens
  const r = call({ action: 'saveWorkflow', token: A, workflow: 'short' });
  ok('the Admin switches to two steps', r.status === 'success' && /Two-step/.test(r.message), r.message);
  ok('and everyone sees it', call({ action: 'getDashboard', token: P }).workflow === 'short' && call({ action: 'getDashboard', token: S }).workflow === 'short');

  console.log('\n=== two steps: To do → Submit for review → Verify & close ===');
  const b = mk({ checklist: 'Collect\nVisit' });
  ok('there is no Start work any more', /does not allow/.test(msg({ action: 'updateTask', token: P, taskId: b.id, status: 'In Progress' })));
  ok('the checklist must still be finished first', /Finish the checklist/.test(msg({ action: 'updateTask', token: P, taskId: b.id, status: 'For Review' })));
  call({ action: 'toggleSubtask', token: P, taskId: b.id, index: 0, done: true });
  call({ action: 'toggleSubtask', token: P, taskId: b.id, index: 1, done: true });
  ok('the owner submits straight from To do', move(P, b.id, 'For Review').status === 'success' && status(b.id) === 'For Review');
  ok('the owner still cannot verify their own work', /cannot sign off your own work|does not allow/.test(msg({ action: 'updateTask', token: P, taskId: b.id, status: 'Verified' })));
  const back = move(S, b.id, 'Pending', { note: 'Photos missing', newDueDate: '2026-12-05' });
  const bt = call({ action: 'getDashboard', token: A }).tasks.find((t) => t.id === b.id);
  ok('Send back returns it to To do', back.status === 'success' && bt.status === 'Pending', JSON.stringify(back));
  ok('counted as rework, with the new date', bt.reworkCount === 1 && bt.due === '2026-12-05');
  ok('then submit again and verify', move(P, b.id, 'For Review').status === 'success' && move(S, b.id, 'Verified').status === 'success');
  ok('a task already In Progress can still be submitted', move(P, left.id, 'For Review').status === 'success');
  const blocker = mk(), waits = mk();
  call({ action: 'addBlocker', token: S, taskId: waits.id, blockerId: blocker.id });
  ok('a blocked task cannot be submitted', /Blocked by/.test(msg({ action: 'updateTask', token: P, taskId: waits.id, status: 'For Review' })));
  const c = mk();
  ok('an Admin can submit for anyone', move(A, c.id, 'For Review').status === 'success');
  ok('verified work still scores', (call({ action: 'getAnalytics', token: A, period: 'month', person: 'payel' }).status) === 'success');

  console.log('\n=== and back to three steps ===');
  ok('the Admin switches back', call({ action: 'saveWorkflow', token: A, workflow: 'standard' }).status === 'success' &&
    call({ action: 'getDashboard', token: A }).workflow === 'standard');
  const d = mk();
  ok('Start work is back', move(P, d.id, 'In Progress').status === 'success');
  ok('anything else typed is read as three steps', call({ action: 'saveWorkflow', token: A, workflow: 'junk' }).workflow === 'standard');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
