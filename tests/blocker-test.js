/**
 * Blockers: another task, or — when nothing on the board matches — a custom
 * note of what is in the way. A custom blocker stops the task being started
 * until it is marked resolved, and both steps go on the task's history. Both
 * editions.
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
  const A = call({ action: 'register', form: { companyName: 'Acme', name: 'Owner One', email: 'o@a.in', password: 'ownerpass123' } }).token;
  call({ action: 'addUser', token: A, form: { name: 'Payel Sen', username: 'payel', email: 'payel@a.in', role: 'Doer', jobProfile: 'Ops', password: 'staffpass123' } });
  call({ action: 'addUser', token: A, form: { name: 'Vikram Rao', username: 'vikram', email: 'vikram@a.in', role: 'Doer', jobProfile: 'Ops', password: 'staffpass123' } });
  const P = call({ action: 'login', username: 'payel@a.in', password: 'staffpass123' }).token;
  const V = call({ action: 'login', username: 'vikram@a.in', password: 'staffpass123' }).token;
  call({ action: 'createTask', token: A, form: { title: 'Machine the flanges', assignTo: 'payel', dueDate: '2030-01-10' } });
  call({ action: 'createTask', token: A, form: { title: 'Order the steel', assignTo: 'vikram', dueDate: '2030-01-08' } });
  const task = (title, tok) => (call({ action: 'getDashboard', token: tok || A }).tasks || []).find((t) => t.title === title);
  const t = task('Machine the flanges');

  console.log('\n=== a custom blocker ===');
  const r = call({ action: 'addBlocker', token: P, taskId: t.id, note: '  Waiting for   material from the vendor ' });
  const b1 = task('Machine the flanges').blockedBy || [];
  ok('the person doing the task can add one in their own words', r.status === 'success' && b1.length === 1 && b1[0].note === 'Waiting for material from the vendor' && b1[0].by === 'Payel Sen', JSON.stringify(b1));
  ok('it stops the task being started', /Blocked by: Waiting for material from the vendor/.test(call({ action: 'updateTask', token: P, taskId: t.id, status: 'In Progress' }).message || ''));
  ok('it shows on the priority list as the reason', JSON.stringify(call({ action: 'getPriorityList', token: P, horizon: 'all' })).indexOf('Waiting for material from the vendor') > -1);
  ok('and it is on the task’s history', (task('Machine the flanges').history || []).some((h) => h.note === 'Blocked: Waiting for material from the vendor'));
  ok('the same blocker twice is refused', /already on this task/.test(call({ action: 'addBlocker', token: A, taskId: t.id, note: 'waiting for material from the vendor' }).message));
  ok('too short is refused', /a little more/.test(call({ action: 'addBlocker', token: A, taskId: t.id, note: 'x' }).message));
  ok('too long is refused', /under 140/.test(call({ action: 'addBlocker', token: A, taskId: t.id, note: 'y'.repeat(141) }).message));
  ok('someone who cannot see the task cannot add one', /not one you can see/.test(call({ action: 'addBlocker', token: V, taskId: t.id, note: 'Sneaky note' }).message));

  console.log('\n=== alongside a task blocker ===');
  const steel = task('Order the steel');
  ok('a task can still be the blocker', call({ action: 'addBlocker', token: A, taskId: t.id, blockerId: steel.id }).status === 'success' && task('Machine the flanges').blockedBy.length === 2);
  ok('nor can they remove one', /not one you can see/.test(call({ action: 'removeBlocker', token: V, taskId: t.id, index: 0 }).message));

  console.log('\n=== resolved ===');
  const res = call({ action: 'removeBlocker', token: P, taskId: t.id, index: 0 });
  ok('marking the custom blocker resolved takes it off', res.status === 'success' && res.message === 'Marked resolved.' && task('Machine the flanges').blockedBy.length === 1 && task('Machine the flanges').blockedBy[0] === steel.id);
  ok('and says so on the history', (task('Machine the flanges').history || []).some((h) => h.note === 'Blocker resolved: Waiting for material from the vendor'));
  ok('the task blocker still holds it', /Blocked by: Order the steel/.test(call({ action: 'updateTask', token: P, taskId: t.id, status: 'In Progress' }).message || ''));
  ok('a blocker that is no longer there is reported plainly', /no longer on this task/.test(call({ action: 'removeBlocker', token: P, taskId: t.id, index: 5 }).message));
  ok('removing the task link frees it to start', call({ action: 'removeBlocker', token: A, taskId: t.id, index: 0 }).message === 'Blocker removed.' &&
     call({ action: 'updateTask', token: P, taskId: t.id, status: 'In Progress' }).status === 'success');
  ok('a custom blocker can be added to work already under way', call({ action: 'addBlocker', token: P, taskId: t.id, note: 'Power cut in bay 2' }).status === 'success');
  ok('deleting another task leaves custom blockers alone', (() => { call({ action: 'deleteTask', token: A, taskId: steel.id }); return (task('Machine the flanges').blockedBy || []).some((b) => b.note === 'Power cut in bay 2'); })());
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
