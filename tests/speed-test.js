/**
 * The speed-ups, checked for harm: the Tasks tab is read from a 30-second
 * cache when the company has not changed, and the 30-second check is told
 * "nothing changed" instead of being sent the board again. A change made in
 * the app is seen at once; one typed into the sheet within 30 seconds; one
 * company never sees another's; and SPEED = off puts everything back.
 * Both editions.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 220) + ']')); v ? pass++ : fail++; };

for (const [label, file] of [['Domebox', '/../dist/code.gs'], ['Domebox Lite', '/../dist/lite/Code.gs']]) {
  console.log('\n######## ' + label + ' ########');
  const lite = /lite/.test(file);
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
  const cache = env.G.CacheService.getScriptCache();
  const clock = { shift: 0 }, realNow = Date.now;
  Date.now = () => realNow() + clock.shift;

  const A = call({ action: 'register', form: { companyName: 'Acme', name: 'Owner', email: 'o@a.in', password: 'ownerpass123' } }).token;
  call({ action: 'addUser', token: A, form: { name: 'Payel', username: 'payel', email: 'payel@a.in', role: 'Doer', jobProfile: 'Ops', password: 'staffpass123' } });
  const P = call({ action: 'login', username: 'payel@a.in', password: 'staffpass123' }).token;
  for (let i = 1; i <= 3; i++) call({ action: 'createTask', token: A, form: { title: 'Job ' + i, assignTo: 'payel', dueDate: '2026-12-0' + i, checklist: 'Step one' } });
  const sheetOf = (title) => Object.values(env.FILES).find((f) => f !== tpl && f.getSheetByName && f.getSheetByName('Tasks') &&
    f.getSheetByName('Tasks')._data.some((r) => r[3] === title));
  const acme = sheetOf('Job 1'), tasks = acme.getSheetByName('Tasks');
  /* Count reads of the Tasks tab as a whole. */
  let reads = 0; const realRange = tasks.getDataRange.bind(tasks);
  tasks.getDataRange = () => { reads++; return realRange(); };
  const dash = (t) => call({ action: 'getDashboard', token: t || A });

  console.log('\n=== the cache saves the read, and changes nothing ===');
  const first = dash();
  reads = 0;
  const second = dash();
  ok('a second look within 30 seconds does not read the Tasks tab again', reads === 0, reads);
  ok('and sees exactly the same tasks, dates and all', JSON.stringify(second.tasks) === JSON.stringify(first.tasks));
  const tk = cache.__keys().filter((k) => /^t:/.test(k));
  ok('the cache is there, and sits under this company\u2019s own id', tk.length > 0 && tk.every((k) => k.indexOf('t:' + acme.getId() + ':') === 0), tk.join(' '));

  console.log('\n=== a change made in the app is seen at once ===');
  const j1 = first.tasks.find((t) => t.title === 'Job 1');
  call({ action: 'updateTask', token: P, taskId: j1.id, status: 'In Progress' });
  ok('Payel starts Job 1, and the owner\u2019s next look shows it', dash().tasks.find((t) => t.id === j1.id).status === 'In Progress');
  call({ action: 'toggleSubtask', token: P, taskId: j1.id, index: 0, done: true });
  ok('ticking a step shows at once too', dash(P).tasks.find((t) => t.id === j1.id).subtasks[0].done === true);
  call({ action: 'createTask', token: A, form: { title: 'Job 4', assignTo: 'payel', dueDate: '2026-12-04' } });
  ok('a new task is on the board straight away', dash(P).tasks.some((t) => t.title === 'Job 4'));
  ok('writes still find their row in the live sheet', call({ action: 'updateTask', token: P, taskId: j1.id, status: 'For Review' }).status === 'success' &&
    tasks._data.find((r) => r[0] === j1.id)[7] === 'For Review');

  console.log('\n=== an edit typed into the sheet shows within 30 seconds ===');
  dash();
  const j2row = tasks._data.find((r) => r[3] === 'Job 2');
  j2row[3] = 'Job 2 (renamed in the sheet)';
  clock.shift += 31000;
  ok('after 30 seconds it shows the new one', dash().tasks.some((t) => t.title === 'Job 2 (renamed in the sheet)'));

  console.log('\n=== the 30-second check ===');
  const d0 = dash(P);
  ok('the board comes with a version', typeof d0.version === 'string' && d0.version.length > 8, d0.version);
  const same = call({ action: 'getDashboard', token: P, since: d0.version });
  ok('asking with that version: "nothing changed", and no board is sent', same.unchanged === true && !same.tasks, JSON.stringify(same).slice(0, 120));
  call({ action: 'createTask', token: A, form: { title: 'Job 5', assignTo: 'payel', dueDate: '2026-12-05' } });
  const after = call({ action: 'getDashboard', token: P, since: d0.version });
  ok('after anybody changes anything, the full board comes back', !after.unchanged && after.tasks.some((t) => t.title === 'Job 5') && after.version !== d0.version);
  const bad = call({ action: 'getDashboard', token: P, since: 'made-up' });
  ok('a version that is not current always gets the full board', !bad.unchanged && Array.isArray(bad.tasks));
  const v1 = dash(P).version;
  ok('a refused change does not pretend anything changed', call({ action: 'updateTask', token: P, taskId: 'NO-SUCH', status: 'For Review' }).status === 'error' &&
    call({ action: 'getDashboard', token: P, since: v1 }).unchanged === true);

  console.log('\n=== companies never see each other ===');
  const B = call({ action: 'register', form: { companyName: lite ? 'Acme' : 'Bose Steel', name: 'Bose', email: 'b@bose.in', password: 'ownerpass123' } });
  if (lite) {
    ok('(Lite holds one company — nothing to cross)', B.status === 'error');
  } else {
    call({ action: 'createTask', token: B.token, form: { title: 'Bose job', assignTo: '', dueDate: '2026-12-09' } });
    const bd = call({ action: 'getDashboard', token: B.token }), bd2 = call({ action: 'getDashboard', token: B.token });
    const ad = dash();
    ok('the second company sees only its own work, cached or not', !bd.tasks.some((t) => /^Job/.test(t.title)) && !bd2.tasks.some((t) => /^Job/.test(t.title)));
    ok('and the first company never sees it', !ad.tasks.some((t) => t.title === 'Bose job'));
    ok('one company\u2019s version is not the other\u2019s', call({ action: 'getDashboard', token: B.token, since: ad.version }).unchanged !== true);
  }

  console.log('\n=== a company too big for the cache reads live, as before ===');
  const pad = 'x'.repeat(4000);
  for (let i = 0; i < 400; i++) tasks._data.push(tasks._data[1].map((v, c) => c === 0 ? 'BIG' + i + Math.random().toString(36).slice(2) : c === 3 ? 'Bulk ' + i + ' ' + Math.random().toString(36) : c === 4 ? pad + Math.random() : v));
  clock.shift += 31000;
  const big1 = dash(); reads = 0; const big2 = dash();
  ok('it still works, with every task', big1.tasks.length === big2.tasks.length && big2.tasks.length > 400, big2.tasks.length);
  ok('and every cached piece is under Apps Script\u2019s 100 KB', cache.__keys().every((k) => String(cache.get(k) || '').length <= 100 * 1024));
  ok('and nothing larger than ten pieces is ever stored', cache.__keys().filter((k) => /:n$/.test(k)).every((k) => Number(cache.get(k)) <= 10));

  console.log('\n=== SPEED = off puts everything back ===');
  env.props.SPEED = 'off';
  const off1 = dash(P);
  reads = 0; dash(P);
  ok('every look reads the sheet again', reads > 0);
  ok('and the check always gets the full board', !call({ action: 'getDashboard', token: P, since: off1.version }).unchanged);
  ok('the app is told, so it saves the slow way', off1.speed === false);
  delete env.props.SPEED;
  Date.now = realNow;
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
