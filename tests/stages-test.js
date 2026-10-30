/**
 * Task stages, designed by the Admin for the whole company: rename the fixed
 * ones, add, remove and reorder the working stages between To do and review.
 * A task passes through every working stage in order. Both editions.
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
  add('Sruti', 'sruti', 'HOD'); add('Payel', 'payel', 'Doer', 'sruti'); add('Vikram', 'vikram', 'Doer', 'sruti');
  const T = (u) => call({ action: 'login', username: u + '@a.in', password: 'staffpass123' }).token;
  const S = T('sruti'), P = T('payel'), V = T('vikram');
  let n = 0;
  const mk = (extra) => { const title = 'Job ' + (++n);
    call({ action: 'createTask', token: S, form: Object.assign({ title, assignTo: 'payel', dueDate: '2026-12-01' }, extra || {}) });
    return call({ action: 'getDashboard', token: A }).tasks.find((t) => t.title === title); };
  const get = (id) => call({ action: 'getDashboard', token: A }).tasks.find((t) => t.id === id) || {};
  const move = (tok, id, s, extra) => call(Object.assign({ action: 'updateTask', token: tok, taskId: id, status: s }, extra || {}));
  const stages = () => call({ action: 'getDashboard', token: P }).stages;

  console.log('\n=== out of the box, nothing changes ===');
  ok('the stages are To do → In progress → For review → Verified', JSON.stringify(stages()) ===
    JSON.stringify({ names: { approval: 'Needs approval', todo: 'To do', review: 'For review', done: 'Verified' }, work: ['In progress'] }), JSON.stringify(stages()));
  const a = mk();
  ok('Start work, Submit, Verify work as before', move(P, a.id, 'In Progress').status === 'success' && get(a.id).stage === 'In progress' &&
    move(P, a.id, 'For Review').status === 'success' && get(a.id).stage === '' && move(S, a.id, 'Verified').status === 'success');

  console.log('\n=== only an Admin designs them ===');
  const design = { names: { approval: 'Awaiting OK', todo: 'Assigned', review: 'QC review', done: 'Closed' }, work: ['Material ordered', 'Fabrication', 'Quality check'] };
  ok('a head of department cannot', /Admin account/.test(msg({ action: 'saveStages', token: S, stages: design })));
  ok('nor can staff', /Admin account/.test(msg({ action: 'saveStages', token: P, stages: design })));
  const half = mk(); move(P, half.id, 'In Progress');            // under way before the change
  const r = call({ action: 'saveStages', token: A, stages: design });
  ok('the Admin saves new stages', r.status === 'success' && JSON.stringify(r.stages) === JSON.stringify(design), JSON.stringify(r));
  ok('and everyone gets them', JSON.stringify(stages()) === JSON.stringify(design) && JSON.stringify(call({ action: 'getDashboard', token: S }).stages) === JSON.stringify(design));

  console.log('\n=== a task goes through every working stage, in order ===');
  const b = mk({ checklist: 'Drawings' });
  ok('Start work lands at the first stage', move(P, b.id, 'In Progress').status === 'success' && get(b.id).stage === 'Material ordered', get(b.id).stage);
  ok('it cannot skip to review', /Move it through Fabrication, Quality check first/.test(msg({ action: 'updateTask', token: P, taskId: b.id, status: 'For Review' })));
  ok('the owner moves it on', call({ action: 'moveStage', token: P, taskId: b.id, stage: 'Fabrication' }).status === 'success' && get(b.id).stage === 'Fabrication');
  ok('someone else on the team cannot', /Only the person doing it/.test(msg({ action: 'moveStage', token: V, taskId: b.id, stage: 'Quality check' })));
  ok('nor to a stage that does not exist', /not one of the company/.test(msg({ action: 'moveStage', token: P, taskId: b.id, stage: 'Painting' })));
  ok('an Admin can move it', call({ action: 'moveStage', token: A, taskId: b.id, stage: 'Quality check' }).status === 'success');
  ok('every move is in the history', get(b.id).history.filter((h) => /^Moved to /.test(h.note)).length === 2);
  ok('the checklist still guards the review', /Finish the checklist/.test(msg({ action: 'updateTask', token: P, taskId: b.id, status: 'For Review' })));
  call({ action: 'toggleSubtask', token: P, taskId: b.id, index: 0, done: true });
  ok('from the last stage it is submitted', move(P, b.id, 'For Review').status === 'success' && get(b.id).status === 'For Review' && get(b.id).stage === '');
  const back = move(S, b.id, 'In Progress', { note: 'Weld seam', newDueDate: '2026-12-08' });
  ok('a send-back returns it to the first stage, as rework', back.status === 'success' && get(b.id).stage === 'Material ordered' && get(b.id).reworkCount === 1);
  ok('work already under way when the stages changed can still be submitted', move(P, half.id, 'For Review').status === 'success');

  console.log('\n=== no working stages at all ===');
  ok('the Admin removes them all', call({ action: 'saveStages', token: A, stages: { names: design.names, work: [] } }).status === 'success');
  const c = mk();
  ok('there is no Start work', /does not allow/.test(msg({ action: 'updateTask', token: P, taskId: c.id, status: 'In Progress' })));
  ok('To do goes straight to review', move(P, c.id, 'For Review').status === 'success');
  ok('and a send-back returns it to To do, as rework', move(S, c.id, 'Pending', { note: 'Redo', newDueDate: '2026-12-09' }).status === 'success' &&
    get(c.id).status === 'Pending' && get(c.id).reworkCount === 1);
  ok('a task left at a removed stage can still be submitted', move(P, b.id, 'For Review').status === 'success');

  console.log('\n=== what is refused ===');
  ok('two stages with the same name', /both called/.test(msg({ action: 'saveStages', token: A, stages: { names: design.names, work: ['QC review'] } })));
  ok('an empty name', /Give the/.test(msg({ action: 'saveStages', token: A, stages: { names: Object.assign({}, design.names, { todo: ' ' }), work: [] } })));
  ok('more than six working stages', /Up to 6/.test(msg({ action: 'saveStages', token: A, stages: { names: design.names, work: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } })));
  ok('a very long name', /under 30/.test(msg({ action: 'saveStages', token: A, stages: { names: design.names, work: ['x'.repeat(31)] } })));
  ok('the default can be put back', call({ action: 'saveStages', token: A, stages: { names: { approval: 'Needs approval', todo: 'To do', review: 'For review', done: 'Verified' }, work: ['In progress'] } }).status === 'success' &&
    stages().work.join() === 'In progress');
  ok('verified work still scores', call({ action: 'getAnalytics', token: A, period: 'month', person: 'payel' }).status === 'success');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
