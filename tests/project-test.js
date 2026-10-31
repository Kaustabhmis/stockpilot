/**
 * Projects: multi-stage work with a deadline on every stage, and score for
 * meeting them. Runs the real dist/code.gs on the Apps Script shim.
 */
const { call, env } = require('./server.js');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 150) + ']')); v ? pass++ : fail++; };
const err = (f) => { try { const r = f(); return r.status === 'error' ? r.message : null; } catch (e) { return e.message; } };

/* Time alone is 1ms granular, so two runs started together can share an
   id and collide on an email the other already registered. */
const R = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
const email = 'pm' + R + '@acme.in';
const A = call({ action: 'register', form: { companyName: 'Acme Engineering',
  name: 'Rohan Mehta', email, password: 'strongpass123' } }).token;

// Pro, so six people and a hundred tasks fit.
const dir = env.FILES.MASTER.getSheetByName('Directory');
const dd = dir.getDataRange().getValues();
for (let i = 1; i < dd.length; i++) if (String(dd[i][1]) === email) {
  dir.getRange(i + 1, 4).setValue('Yearly');
  const u = new Date(); u.setDate(u.getDate() + 300);
  dir.getRange(i + 1, 5).setValue(u.toISOString().slice(0, 10));
}
const U = (u) => u + R;
const add = (n, u, role) => call({ action: 'addUser', token: A, form: { name: n, username: U(u),
  email: U(u) + '@acme.in', role: role || 'Doer', jobProfile: 'Executive', password: 'staffpass123' } });
add('Payel Sanyamath', 'payel');
add('Vikram Rathore', 'vikram');
add('Neha Bhandari', 'neha');
const tok = (u) => call({ action: 'login', username: U(u) + '@acme.in', password: 'staffpass123' }).token;
const T = { payel: tok('payel'), vikram: tok('vikram'), neha: tok('neha') };

const stage = (title, who, due, priority) => ({ title, assignTo: U(who), dueDate: due, priority: priority || 'Medium' });
const mkProject = (name, stages, gate) => call({ action: 'createProject', token: A,
  form: { name, gate: gate || 'sequential', jobCategory: 'NPD', stages } });
const tasksOf = (token) => call({ action: 'getDashboard', token }).tasks;
const find = (token, title) => tasksOf(token).find((t) => t.title === title);

console.log('\n=== a project is a run of stages, each with its own deadline ===');
const P = mkProject('Fixture line upgrade', [
  stage('Design the fixture', 'payel', '2026-11-05', 'High'),
  stage('Fabricate and trial', 'vikram', '2026-11-20'),
  stage('Train the operators', 'neha', '2026-11-30'),
]);
ok('the project is created', P.status === 'success', P.message);
ok('with one task per stage', P.stages === 3, P.stages);
const s1 = find(A, 'Design the fixture'), s2 = find(A, 'Fabricate and trial'), s3 = find(A, 'Train the operators');
ok('every stage carries its own deadline', s1.due === '2026-11-05' && s2.due === '2026-11-20' && s3.due === '2026-11-30');
ok('every stage carries its own owner', s1.assignee === U('payel') && s3.assignee === U('neha'));
ok('they share a project id', s1.projectId && s1.projectId === s2.projectId && s2.projectId === s3.projectId);
ok('and are numbered', s1.stageNo === 1 && s2.stageNo === 2 && s3.stageNo === 3);
ok('each knows how many stages there are', s1.stageCount === 3);

console.log('\n=== nobody can start out of order ===');
ok('stage 1 can be started', call({ action: 'updateTask', token: T.payel, taskId: s1.id, status: 'In Progress' }).status === 'success');
ok('stage 2 cannot be started while stage 1 is open',
   /Blocked by: Design the fixture/.test(err(() => call({ action: 'updateTask', token: T.vikram, taskId: s2.id, status: 'In Progress' })) || ''),
   err(() => call({ action: 'updateTask', token: T.vikram, taskId: s2.id, status: 'In Progress' })));

console.log('\n=== signing off a stage opens the next one, and says so ===');
call({ action: 'updateTask', token: T.payel, taskId: s1.id, status: 'For Review' });
const v = call({ action: 'updateTask', token: A, taskId: s1.id, status: 'Verified' });
ok('verifying names who it just went to', /Stage 2 is now open for Vikram Rathore/.test(v.message), v.message);
ok('and that person is told by email',
   env.mails.some((m) => /Your turn: Fabricate and trial/.test(m.subject)),
   env.mails.map((m) => m.subject).slice(-3).join(' | '));
ok('stage 2 can now be started',
   call({ action: 'updateTask', token: T.vikram, taskId: s2.id, status: 'In Progress' }).status === 'success');
ok('stage 3 still cannot',
   /Blocked by/.test(err(() => call({ action: 'updateTask', token: T.neha, taskId: s3.id, status: 'In Progress' })) || ''));

console.log('\n=== the plan has to be possible ===');
ok('a one-stage project is refused as what it really is',
   /just a task/.test(err(() => mkProject('Tiny', [stage('Only thing', 'payel', '2026-12-01')])) || ''));
ok('a stage with no deadline is refused',
   /has no deadline/.test(err(() => mkProject('No date', [stage('A', 'payel', '2026-12-01'),
     { title: 'B', assignTo: U('vikram'), dueDate: '' }])) || ''));
ok('a stage with nobody on it is refused',
   /has nobody on it/.test(err(() => mkProject('No owner', [stage('A', 'payel', '2026-12-01'),
     { title: 'B', assignTo: '', dueDate: '2026-12-05' }])) || ''));
ok('deadlines that run backwards are refused, in plain words',
   /due before stage 1/.test(err(() => mkProject('Backwards', [stage('A', 'payel', '2026-12-10'),
     stage('B', 'vikram', '2026-12-01')])) || ''),
   err(() => mkProject('Backwards', [stage('A', 'payel', '2026-12-10'), stage('B', 'vikram', '2026-12-01')])));
ok('a Doer cannot raise a project',
   /manager account/.test(err(() => call({ action: 'createProject', token: T.payel,
     form: { name: 'x', stages: [stage('A', 'payel', '2026-12-01'), stage('B', 'payel', '2026-12-05')] } })) || ''));

console.log('\n=== a parallel project opens every stage at once ===');
const PP = mkProject('Audit readiness', [
  stage('Documents', 'payel', '2026-12-01'),
  stage('Shop floor', 'vikram', '2026-12-01'),
], 'parallel');
ok('it is created', PP.status === 'success');
ok('and both stages can start immediately',
   call({ action: 'updateTask', token: T.vikram, taskId: find(A, 'Shop floor').id, status: 'In Progress' }).status === 'success');

console.log('\n=== the project list shows where everything has got to ===');
const list = call({ action: 'getProjects', token: A }).projects;
const fx = list.find((p) => p.name === 'Fixture line upgrade');
ok('the project is listed', !!fx);
ok('with its progress', fx.done === 1 && fx.stages === 3 && fx.percent === 33, JSON.stringify({ d: fx.done, p: fx.percent }));
ok('and who is on the hook right now', fx.currentStage === 2 && fx.currentOwnerName === 'Vikram Rathore');
ok('every stage is listed with its owner and date', fx.stageList.length === 3 && fx.stageList[2].ownerName === 'Neha Bhandari');
ok('a blocked stage is marked blocked', fx.stageList[2].blocked === true);
ok('a stage delivered on time is marked met', fx.stageList[0].metOnTime === true);
ok('a Doer only sees projects they are on',
   call({ action: 'getProjects', token: T.neha }).projects.every((p) =>
     p.stageList.some((s) => s.owner === U('neha'))));

console.log('\n' + (fail ? 'FAILED ' : '') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
