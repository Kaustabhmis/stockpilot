/**
 * What an Admin can change for the whole company: the tab bar (order and
 * hidden tabs) and the job categories (rename carries the tasks; a new one can
 * be typed while assigning). Run on both editions.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 260) + ']')); v ? pass++ : fail++; };

for (const [label, file] of [['Domebox', '/../dist/code.gs'], ['Domebox Lite', '/../dist/lite/Code.gs']]) {
  console.log('\n######## ' + label + ' ########');
  const env = build();
  Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b' });
  env.newFile('MASTER', 'Master');
  const tpl = env.newFile('TEMPLATE', 'Template');
  ['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
  tpl.getSheetByName('Settings').appendRow(['General']);
  const names = Object.keys(env.G);
  const P = new Function(...names, fs.readFileSync(__dirname + file, 'utf8') + '\n;return { doPost, ensureRegistry };')(...names.map((n) => env.G[n]));
  P.ensureRegistry();
  const call = (b) => JSON.parse(P.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
  const reg = call({ action: 'register', form: { companyName: 'Dynamic Engineers', name: 'Owner', email: 'o@dyn.in', password: 'ownerpass123' } });
  const T = reg.token;
  call({ action: 'addUser', token: T, form: { name: 'Sruti', username: 'sruti', email: 's@dyn.in', role: 'HOD', manager: '', jobProfile: 'X', password: 'staffpass123' } });
  call({ action: 'addUser', token: T, form: { name: 'Payel', username: 'payel', email: 'p@dyn.in', role: 'Doer', manager: 'sruti', jobProfile: 'X', password: 'staffpass123' } });
  const tok = (u) => call({ action: 'login', username: u, password: 'staffpass123' }).token;
  const HOD = tok('s@dyn.in'), DOER = tok('p@dyn.in');
  const due = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);

  console.log('\n=== the tab bar ===');
  let d = call({ action: 'getDashboard', token: T });
  ok('everybody starts with every tab, in the standard order', d.layout && d.layout.order.join(',') === 'tasks,priority,projects,meetings,goals,board,reports,team' && d.layout.hidden.length === 0, JSON.stringify(d.layout));
  const save = call({ action: 'saveTabLayout', token: T, layout: { order: ['tasks', 'meetings', 'team', 'priority', 'reports'], hidden: ['goals', 'board', 'tasks', 'team', 'nonsense'] } });
  ok('the Admin saves a new order and hides two tabs', save.status === 'success', JSON.stringify(save));
  ok('tabs left out of the order keep their place at the end, nothing is lost',
     save.layout.order.join(',') === 'tasks,meetings,team,priority,reports,projects,goals,board', save.layout.order.join(','));
  ok('Tasks and Team cannot be hidden, and unknown names are dropped', save.layout.hidden.join(',') === 'goals,board', save.layout.hidden.join(','));
  ok('a manager sees the same bar', JSON.stringify(call({ action: 'getDashboard', token: HOD }).layout) === JSON.stringify(save.layout));
  ok('and so does a team member', JSON.stringify(call({ action: 'getDashboard', token: DOER }).layout) === JSON.stringify(save.layout));
  ok('a manager cannot change it', call({ action: 'saveTabLayout', token: HOD, layout: { hidden: ['reports'] } }).status === 'error');
  ok('nor a team member', call({ action: 'saveTabLayout', token: DOER, layout: { hidden: ['reports'] } }).status === 'error');

  console.log('\n=== job categories ===');
  call({ action: 'updateCategories', token: T, categories: ['General', 'Dispatch', 'Quality'] });
  call({ action: 'createTask', token: T, form: { title: 'Pack bearings', assignTo: 'payel', dueDate: due, priority: 'High', jobCategory: 'Dispatch' } });
  call({ action: 'createTask', token: T, form: { title: 'Load truck', assignTo: 'payel', dueDate: due, priority: 'High', jobCategory: 'Dispatch' } });
  const r = call({ action: 'updateCategories', token: T, categories: ['General', 'Logistics', 'Quality'], renames: [{ from: 'Dispatch', to: 'Logistics' }] });
  d = call({ action: 'getDashboard', token: T });
  ok('the Admin renames Dispatch to Logistics', r.status === 'success' && d.categories.join(',') === 'General,Logistics,Quality', JSON.stringify(r));
  ok('and both tasks filed under Dispatch move with it', r.tasksMoved === 2 && d.tasks.filter((t) => t.jobCategory === 'Logistics').length === 2 &&
     !d.tasks.some((t) => t.jobCategory === 'Dispatch'), JSON.stringify(d.tasks.map((t) => t.jobCategory)));
  ok('a team member cannot edit the list', call({ action: 'updateCategories', token: DOER, categories: ['X'] }).status === 'error');
  call({ action: 'createTask', token: HOD, form: { title: 'Calibrate gauge', assignTo: 'payel', dueDate: due, priority: 'Medium', jobCategory: 'Calibration ' } });
  d = call({ action: 'getDashboard', token: T });
  ok('a manager types a new category while assigning, and it joins the list', d.categories.indexOf('Calibration') > -1 &&
     d.tasks.some((t) => t.title === 'Calibrate gauge' && t.jobCategory === 'Calibration'), d.categories.join(','));
  call({ action: 'createTask', token: T, form: { title: 'Again', assignTo: 'payel', dueDate: due, priority: 'Low', jobCategory: 'calibration' } });
  ok('the same name in other letters is not added twice', call({ action: 'getDashboard', token: T }).categories.filter((c) => c.toLowerCase() === 'calibration').length === 1);
  const task = d.tasks.find((t) => t.title === 'Pack bearings');
  call({ action: 'editTask', token: T, form: { taskId: task.id, title: 'Pack 50 bearings', jobCategory: '' } });
  const after = call({ action: 'getDashboard', token: T }).tasks.find((t) => t.id === task.id);
  ok('editing a task with no category chosen keeps the one it had', after.title === 'Pack 50 bearings' && after.jobCategory === 'Logistics', JSON.stringify(after.jobCategory));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
