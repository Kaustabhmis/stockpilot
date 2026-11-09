/**
 * Only an Admin archives, restores or deletes a task, or adds and deletes its
 * steps. Run on both editions.
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
  const mk = (title, extra) => { call({ action: 'createTask', token: S, form: Object.assign({ title, assignTo: 'payel', dueDate: '2026-12-01', checklist: 'One\nTwo' }, extra || {}) });
    return call({ action: 'getDashboard', token: A }).tasks.find((t) => t.title === title); };
  const find = (id, tok) => (call({ action: 'getDashboard', token: tok || A }).tasks || []).find((t) => t.id === id) ||
    (call({ action: 'getArchive', token: tok || A, q: id }).tasks || []).find((t) => t.id === id);
  const onBoard = (id) => (call({ action: 'getDashboard', token: A }).tasks || []).some((t) => t.id === id && !t.isArchived);
  const sheet = () => Object.values(env.FILES).find((f) => f.getSheetByName('Tasks') && f.getSheetByName('Users') && f !== tpl);

  console.log('\n=== nobody but an Admin ===');
  const t1 = mk('Open job');
  for (const [who, tok] of [['a head of department', S], ['the owner of the task', P]]) {
    ok(who + ' cannot archive it', /Admin account/.test(msg({ action: 'archiveTask', token: tok, taskId: t1.id })));
    ok(who + ' cannot delete it', /Admin account/.test(msg({ action: 'deleteTask', token: tok, taskId: t1.id })));
    ok(who + ' cannot add a step', /Admin account/.test(msg({ action: 'addTaskStep', token: tok, taskId: t1.id, text: 'x' })));
    ok(who + ' cannot delete a step', /Admin account/.test(msg({ action: 'removeTaskStep', token: tok, taskId: t1.id, index: 0, text: 'One' })));
  }
  ok('and the task is untouched', find(t1.id).subtasks.length === 2 && find(t1.id).status === 'Pending');

  console.log('\n=== steps ===');
  let r = call({ action: 'addTaskStep', token: A, taskId: t1.id, text: '  Three  ' });
  ok('an Admin adds a step', r.status === 'success' && find(t1.id).subtasks.map((s) => s.text).join('|') === 'One|Two|Three', JSON.stringify(r));
  ok('the history says so', find(t1.id).history.some((h) => /Step added: Three/.test(h.note)));
  ok('an empty step is refused', /Type the step/.test(msg({ action: 'addTaskStep', token: A, taskId: t1.id, text: '   ' })));
  ok('a very long step is refused', /200 characters/.test(msg({ action: 'addTaskStep', token: A, taskId: t1.id, text: 'x'.repeat(201) })));
  ok('deleting the wrong step by mistake is refused', /changed since/.test(msg({ action: 'removeTaskStep', token: A, taskId: t1.id, index: 0, text: 'Two' })));
  r = call({ action: 'removeTaskStep', token: A, taskId: t1.id, index: 1, text: 'Two' });
  ok('an Admin deletes a step', r.status === 'success' && find(t1.id).subtasks.map((s) => s.text).join('|') === 'One|Three');
  ok('the history says so', find(t1.id).history.some((h) => /Step removed: Two/.test(h.note)));
  call({ action: 'toggleSubtask', token: P, taskId: t1.id, index: 0, done: true });
  call({ action: 'addTaskStep', token: A, taskId: t1.id, text: 'Four' });
  ok('ticks already made are kept', find(t1.id).subtasks[0].done === true && find(t1.id).subtasks[2].done === false);
  const bare = mk('No checklist', { checklist: '' });
  ok('a task with no steps can be given its first', call({ action: 'addTaskStep', token: A, taskId: bare.id, text: 'First' }).status === 'success' && find(bare.id).subtasks.length === 1);

  console.log('\n=== archive and restore ===');
  r = call({ action: 'archiveTask', token: A, taskId: t1.id });
  ok('an Admin archives an open task', r.status === 'success' && /Cancelled/.test(r.message), r.message);
  let a = find(t1.id);
  ok('it leaves the board and is cancelled', !onBoard(t1.id) && a.isArchived && a.status === 'Cancelled' && !!a.archivedOn);
  ok('it is in the archive', (call({ action: 'getArchive', token: A }).tasks || []).some((t) => t.id === t1.id));
  ok('archiving it again is refused', /already in the archive/.test(msg({ action: 'archiveTask', token: A, taskId: t1.id })));
  ok('steps cannot be changed while it is archived', /Steps can be changed only while it is open/.test(msg({ action: 'addTaskStep', token: A, taskId: t1.id, text: 'x' })));
  r = call({ action: 'restoreTask', token: A, taskId: t1.id });
  a = find(t1.id);
  ok('restore puts it back as it was', r.status === 'success' && onBoard(t1.id) && !a.isArchived && a.status === 'Pending' && !a.archivedOn, JSON.stringify({ s: a.status, ar: a.isArchived }));
  ok('with its steps and ticks', a.subtasks.length === 3 && a.subtasks[0].done === true);
  ok('only an archived task can be restored', /nothing to restore/.test(msg({ action: 'restoreTask', token: A, taskId: t1.id })));
  const done = mk('Closed job', { checklist: '' });
  call({ action: 'updateTask', token: P, taskId: done.id, status: 'In Progress' });
  call({ action: 'updateTask', token: P, taskId: done.id, status: 'For Review' });
  call({ action: 'updateTask', token: S, taskId: done.id, status: 'Verified' });
  r = call({ action: 'archiveTask', token: A, taskId: done.id });
  a = find(done.id);
  ok('a verified task is archived as it is, still Verified', r.status === 'success' && a.isArchived && a.status === 'Verified', JSON.stringify({ s: a.status, m: r.message }));
  const rep = mk('Weekly check', { frequency: 'Weekly', checklist: '' });
  call({ action: 'archiveTask', token: A, taskId: rep.id });
  ok('archiving an open repeating task stops it repeating', find(rep.id).frequency === 'One Time');

  console.log('\n=== delete ===');
  const victim = mk('Delete me', { checklist: '' });
  const waiting = mk('Waits on it', { checklist: '' });
  call({ action: 'addBlocker', token: S, taskId: waiting.id, blockerId: victim.id });
  ok('(set-up: one task is blocked by the other)', (find(waiting.id).blockedBy || []).includes(victim.id));
  r = call({ action: 'deleteTask', token: A, taskId: victim.id });
  ok('an Admin deletes a task', r.status === 'success' && !find(victim.id), r.message);
  ok('it is gone for the people on it too', !find(victim.id, P) && !find(victim.id, S));
  ok('nothing is left blocked by it', !(find(waiting.id).blockedBy || []).includes(victim.id));
  const log = sheet().getSheetByName('Deleted_Tasks');
  ok('a line records who deleted what, and when', log && log._data.some((row) => row[1] === 'o' && row[2] === victim.id && row[3] === 'Delete me'),
    log && JSON.stringify(log._data.slice(-1)));
  ok('deleting it twice says it is gone', /no longer exists/.test(msg({ action: 'deleteTask', token: A, taskId: victim.id })));

  console.log('\n=== project stages are protected ===');
  call({ action: 'createProject', token: A, form: { name: 'Line upgrade', gate: 'sequential', jobCategory: 'General',
    stages: [{ title: 'Design', assignTo: 'payel', dueDate: '2026-12-01' }, { title: 'Build', assignTo: 'payel', dueDate: '2026-12-10' }] } });
  const st = call({ action: 'getDashboard', token: A }).tasks.find((t) => t.title === 'Design');
  ok('an open project stage cannot be archived', /project/.test(msg({ action: 'archiveTask', token: A, taskId: st.id })));
  ok('a project stage cannot be deleted', /Project stages cannot be deleted/.test(msg({ action: 'deleteTask', token: A, taskId: st.id })));
  ok('but its steps can be changed', call({ action: 'addTaskStep', token: A, taskId: st.id, text: 'Drawings' }).status === 'success');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
