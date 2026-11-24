/**
 * Department goals: a head of department sets goals for their own department,
 * each serving a company goal; only the Admin, the owner and that department
 * see them. A goal can carry a target figure; its owner or head enters the
 * figure, and the system says whether it is on track. Both editions.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 260) + ']')); v ? pass++ : fail++; };

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
  const X = new Function(...names, fs.readFileSync(__dirname + file, 'utf8') + '\n;return { doPost, ensureRegistry, goalOutlook_, goalPeriodBounds_ };')(...names.map((n) => env.G[n]));
  X.ensureRegistry();
  const call = (b) => JSON.parse(X.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
  const A = call({ action: 'register', form: { companyName: 'Acme', name: 'Owner One', email: 'o@a.in', password: 'ownerpass123' } }).token;
  if (label === 'Domebox') { const d = env.FILES.MASTER.getSheetByName('Directory'), i = d.getDataRange().getValues().findIndex((r) => r[1] === 'o@a.in'); d.getRange(i + 1, 4).setValue('Growth Yearly'); }
  const add = (name, u, role, dept, manager) => call({ action: 'addUser', token: A, form: { name, username: u, email: u + '@a.in', role, dept, manager, jobProfile: 'X', password: 'staffpass123' } });
  add('Imran Quality', 'imran', 'HOD', 'Quality');
  add('Nita Quality', 'nita', 'Doer', 'Quality', 'imran');
  add('Raj Quality', 'raj', 'Doer', 'Quality', 'imran');
  add('Sruti Production', 'sruti', 'HOD', 'Production');
  add('Payel Production', 'payel', 'Doer', 'Production', 'sruti');
  add('Nodept Head', 'nod', 'HOD', '');
  const tok = (u) => call({ action: 'login', username: u + '@a.in', password: 'staffpass123' }).token;
  const RJ = tok('raj'), I = tok('imran'), N = tok('nita'), S = tok('sruti'), P = tok('payel'), ND = tok('nod');
  const dir = (t) => call({ action: 'getDirection', token: t });
  const goal = (t, title) => (dir(t).goals || []).find((g) => g.title === title);

  console.log('\n=== who sets which goals ===');
  const G1 = call({ action: 'saveGoal', token: A, form: { level: 'year', title: 'Zero repeat NCs in the surveillance audit' } });
  ok('the Admin sets a company goal', G1.status === 'success' && goal(A, 'Zero repeat NCs in the surveillance audit').scope === 'company', JSON.stringify(G1));
  const sm = dir(A).quarters[0];
  const Q = call({ action: 'saveGoal', token: I, form: { level: 'quarter', period: dir(A).now.quarter, title: 'Cut rejection rate', parent: G1.id, target: 1.5, start: 4, unit: '%' } });
  ok('a head of department sets a goal for their department, under the company goal', Q.status === 'success' && /^Quality: /.test(Q.message), JSON.stringify(Q));
  const qg = goal(A, 'Cut rejection rate');
  ok('it belongs to their department, serves the company goal, and has its target', qg.scope === 'dept' && qg.dept === 'Quality' && qg.parent === G1.id &&
     qg.metric.start === 4 && qg.metric.target === 1.5 && qg.metric.lower === true && qg.metric.unit === '%', JSON.stringify(qg));
  ok('a head of department cannot set a company goal', /Company goals are set by an Admin/.test(call({ action: 'saveGoal', token: I, form: { scope: 'company', level: 'year', title: 'Mine' } }).message || '') &&
     !goal(A, 'Mine'));
  ok('a head with no department is told to have it set first', /department is not set/.test(call({ action: 'saveGoal', token: ND, form: { level: 'year', title: 'Orphan' } }).message));
  ok('the Admin can set one for any department', call({ action: 'saveGoal', token: A, form: { scope: 'dept', dept: 'Production', level: 'year', title: 'Output 10% up' } }).status === 'success' &&
     goal(A, 'Output 10% up').dept === 'Production');
  ok('a department goal goes to someone in that department', /someone in Quality/.test(call({ action: 'saveGoal', token: I, form: { level: 'year', title: 'X', owner: 'payel' } }).message));

  console.log('\n=== who sees them ===');
  ok('people in the department see it', !!goal(N, 'Cut rejection rate'));
  ok('another department does not, nor its head', !goal(P, 'Cut rejection rate') && !goal(S, 'Cut rejection rate'));
  ok('everyone sees the company goal', !!goal(P, 'Zero repeat NCs in the surveillance audit') && !!goal(N, 'Zero repeat NCs in the surveillance audit'));
  ok('Production’s own goal shows to Production, not to Quality', !!goal(P, 'Output 10% up') && !goal(N, 'Output 10% up'));

  console.log('\n=== who changes them ===');
  ok('another department’s head cannot edit it', /Only an Admin, or the head of its department/.test(call({ action: 'saveGoal', token: S, form: { id: qg.id, level: 'quarter', title: 'Hijack', period: qg.period } }).message));
  ok('nor remove it', /Only an Admin, or the head of its department/.test(call({ action: 'deleteGoal', token: S, id: qg.id }).message));
  ok('a head cannot edit the company goal', /Only an Admin/.test(call({ action: 'saveGoal', token: I, form: { id: G1.id, level: 'year', title: 'Changed' } }).message));
  ok('nor change its status', /owner, the head of its department or an Admin/.test(call({ action: 'setGoalStatus', token: S, id: qg.id, goalStatus: 'Dropped' }).message));
  ok('its own head can edit it', call({ action: 'saveGoal', token: I, form: { id: qg.id, level: 'quarter', period: qg.period, title: 'Cut rejection rate', parent: G1.id, target: 1.5, start: 4, unit: '%', owner: 'nita' } }).status === 'success' &&
     goal(A, 'Cut rejection rate').owner === 'nita');

  console.log('\n=== entering the figure ===');
  const c1 = call({ action: 'goalCheckin', token: N, id: qg.id, value: 3.2, note: 'Week 3' });
  ok('the goal’s owner enters this week’s figure', c1.status === 'success' && goal(A, 'Cut rejection rate').checkins.slice(-1)[0].v === 3.2, JSON.stringify(c1));
  ok('and is told straight away how it stands', /^Figure saved\. (On track|At risk|Off track|Achieved|Needs data)\./.test(c1.message), c1.message);
  call({ action: 'goalCheckin', token: I, id: qg.id, value: 3.0 });
  ok('a second figure the same day replaces the first', goal(A, 'Cut rejection rate').checkins.length === 1 && goal(A, 'Cut rejection rate').checkins[0].v === 3);
  ok('someone else in the department who does not own it cannot', /Only the goal/.test(call({ action: 'goalCheckin', token: RJ, id: qg.id, value: 1 }).message));
  ok('and someone outside it cannot even find it', /no longer exists/.test(call({ action: 'goalCheckin', token: P, id: qg.id, value: 1 }).message));
  ok('a number is required', /as a number/.test(call({ action: 'goalCheckin', token: N, id: qg.id, value: 'abc' }).message));
  ok('a goal with no target asks for one first', /no target figure/.test(call({ action: 'goalCheckin', token: A, id: G1.id, value: 3 }).message));
  ok('every goal carries the analysis', ['verdict', 'tone', 'reason'].every((k) => k in goal(A, 'Cut rejection rate').outlook));

  const co = goal(A, 'Zero repeat NCs in the surveillance audit').outlook;
  ok('the company goal takes its verdict from the department goals that serve it', co.rolledUp === true && co.verdict !== 'Needs data' &&
     /Judged on the 1 goal that serves it/.test(co.reason), JSON.stringify(co));
  ok('a goal with nothing under it and no figure still asks for data', goal(A, 'Output 10% up').outlook.verdict !== 'On track');
  console.log('\n=== the analysis, worked through ===');
  const b = X.goalPeriodBounds_('FY26-27 Q3', 4);
  ok('a quarter label gives its dates (FY26-27 Q3 = Oct to Dec 2026)', b.from.getMonth() === 9 && b.from.getFullYear() === 2026 && b.to.getMonth() === 11, b.from + ' ' + b.to);
  const base = { status: 'On course', period: 'FY26-27 Q3', metric: { unit: '%', start: 4, target: 1.5, lower: true } };
  const mid = new Date(2026, 10, 15);   // half way through the quarter
  const o1 = X.goalOutlook_(Object.assign({}, base, { checkins: [{ d: '2026-11-14', v: 2.6 }] }), null, 4, mid);
  ok('ahead of where it should be: On track', o1.verdict === 'On track' && /At 2\.6% against a target of 1\.5%/.test(o1.reason), JSON.stringify(o1));
  const o2 = X.goalOutlook_(Object.assign({}, base, { checkins: [{ d: '2026-11-14', v: 3.0 }] }), null, 4, mid);
  ok('a little behind: At risk, with where it ends at this pace', o2.verdict === 'At risk' && /ends near/.test(o2.reason), JSON.stringify(o2));
  const o3 = X.goalOutlook_(Object.assign({}, base, { checkins: [{ d: '2026-11-14', v: 3.8 }] }), null, 4, mid);
  ok('far behind: Off track', o3.verdict === 'Off track', JSON.stringify(o3));
  ok('reaching the target: Achieved', X.goalOutlook_(Object.assign({}, base, { checkins: [{ d: '2026-11-14', v: 1.4 }] }), null, 4, mid).verdict === 'Achieved');
  ok('the period over without it: Missed', X.goalOutlook_(Object.assign({}, base, { checkins: [{ d: '2026-12-20', v: 2.0 }] }), null, 4, new Date(2027, 0, 5)).verdict === 'Missed');
  ok('no figure half way through: Needs data', X.goalOutlook_(Object.assign({}, base, { checkins: [] }), null, 4, mid).verdict === 'Needs data');
  ok('no figure in the first days: Not started, not a warning', X.goalOutlook_(Object.assign({}, base, { checkins: [] }), null, 4, new Date(2026, 9, 5)).verdict === 'Not started');
  const stale = X.goalOutlook_(Object.assign({}, base, { checkins: [{ d: '2026-10-10', v: 3.7 }] }), null, 4, mid);
  ok('an old figure is called out', stale.stale && /days old/.test(stale.reason), stale.reason);
  const up = X.goalOutlook_({ status: 'On course', period: 'FY26-27 Q3', metric: { unit: 'units', start: 0, target: 1000, lower: false }, checkins: [{ d: '2026-11-14', v: 520 }] }, null, 4, mid);
  ok('higher-is-better targets work the same way', up.verdict === 'On track', JSON.stringify(up));
  const tasks = X.goalOutlook_({ status: 'On course', period: 'FY26-27 Q3', metric: null }, { total: 10, done: 2, overdue: 3 }, 4, mid);
  ok('a goal with no figure is judged on its linked work', tasks.verdict === 'Off track' && /2 of 10 linked jobs done/.test(tasks.reason) && /3 overdue/.test(tasks.reason), JSON.stringify(tasks));
  ok('Done and Dropped speak for themselves', X.goalOutlook_({ status: 'Done' }, null, 4, mid).verdict === 'Achieved' && X.goalOutlook_({ status: 'Dropped' }, null, 4, mid).verdict === 'Dropped');
  const late = X.goalOutlook_(Object.assign({}, base, { checkins: [{ d: '2026-11-01', v: 3.0 }] }), null, 4, new Date(2026, 11, 31, 22));
  ok('a figure nobody updated cannot stay on track to the end of the period', late.verdict === 'Off track', JSON.stringify(late));
  const quick = X.goalOutlook_(Object.assign({}, base, { checkins: [{ d: '2026-10-02', v: 3.8 }] }), null, 4, new Date(2026, 9, 3));
  ok('one figure in the first days is not projected to a silly end', !/ends near -/.test(quick.reason) && quick.projected === null, JSON.stringify(quick));
  const before = X.goalOutlook_({ status: 'On course', period: 'FY26-27 Q4', metric: { unit: 'pcs', start: 0, target: 100 }, checkins: [{ d: '2026-11-20', v: 10 }] }, null, 4, new Date(2026, 10, 24));
  ok('a figure entered before the period starts is not counted as progress', before.verdict === 'Not started' || before.verdict === 'Needs data', JSON.stringify(before));
  const worse = X.goalOutlook_(Object.assign({}, base, { checkins: [{ d: '2026-11-14', v: 5 }] }), null, 4, mid);
  ok('a figure moving the wrong way says so', worse.verdict === 'Off track' && /wrong way/.test(worse.reason), worse.reason);
  const flat = X.goalOutlook_({ status: 'On course', period: 'FY26-27 Q3', metric: { unit: '', start: 5, target: 5 }, checkins: [{ d: '2026-11-14', v: 5 }] }, null, 4, mid);
  ok('a target equal to its start is reported, not divided by', flat.verdict === 'Needs data' && !/NaN|Infinity/.test(flat.reason), flat.reason);

  console.log('\n=== nothing shows through from a hidden department ===');
  const pv = goal(P, 'Zero repeat NCs in the surveillance audit');
  ok('another department sees the company goal without the Quality goal\'s verdict inside it', pv && !pv.outlook.rolledUp && !/goal that serves/.test(pv.outlook.reason), JSON.stringify(pv && pv.outlook));
  const qid = goal(A, 'Cut rejection rate').id;
  const linkTry = call({ action: 'createTask', token: S, form: { title: 'Link to hidden', assignTo: 'payel', dueDate: '2030-01-01', goal: qid } });
  ok('work cannot be linked to a goal you cannot see', linkTry.status === 'error' && /goal/i.test(linkTry.message), JSON.stringify(linkTry));

  console.log('\n=== an existing workspace ===');
  const tenant = Object.values(env.FILES).find((f) => f !== tpl && f.getSheetByName && f.getSheetByName('Goals') && f.getSheetByName('Users'));
  const head = tenant.getSheetByName('Goals').getDataRange().getValues()[0];
  ok('the Goals tab gains its new columns after every existing one, nothing moved', head.slice(0, 11).join('|') === 'ID|Level|Period|Title|Detail|Owner|Parent|Status|Note|Created|Updated' && head[17] === 'Checkins JSON', head.join('|'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
