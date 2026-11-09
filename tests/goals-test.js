/**
 * Purpose, values, year and quarter goals, key numbers — and the tagging that
 * makes them more than a poster: tasks, projects and cookie points pointing at
 * them, and a goal's progress computed from the work actually linked to it.
 */
const { call, env } = require('./server.js');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 220) + ']')); v ? pass++ : fail++; };

const R = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
const U = (u) => u + R;
const email = 'goals' + R + '@acme.in';
const A = call({ action: 'register', form: { companyName: 'Acme Engineering', name: 'Rohan Mehta',
  email, password: 'strongpass123' } }).token;
const dir = env.FILES.MASTER.getSheetByName('Directory');
dir.getDataRange().getValues().forEach((r, i) => {
  if (String(r[1]).toLowerCase() === email) { dir.getRange(i + 1, 4).setValue('Growth');
    const u = new Date(); u.setDate(u.getDate() + 300); dir.getRange(i + 1, 5).setValue(u.toISOString().slice(0, 10)); }
});
[['Sruti Charulata', 'sruti', 'HOD', ''], ['Payel S', 'payel', 'Doer', 'sruti'], ['Vikram R', 'vikram', 'Doer', 'sruti']]
  .forEach(([n, u, role, mgr]) => call({ action: 'addUser', token: A, form: { name: n, username: U(u),
    email: U(u) + '@acme.in', role, manager: mgr ? U(mgr) : '', jobProfile: 'Executive', password: 'staffpass123' } }));
const tok = (u) => call({ action: 'login', username: U(u) + '@acme.in', password: 'staffpass123' }).token;
const H = tok('sruti'), P = tok('payel'), V = tok('vikram');
const ymd = (plus) => { const d = new Date(); d.setDate(d.getDate() + plus); return d.toISOString().slice(0, 10); };

console.log('\n=== the financial calendar ===');
let d = call({ action: 'getDirection', token: A });
ok('the page loads', d.status === 'success', d.message);
const m = new Date().getMonth(), y = new Date().getFullYear();
const fy = m >= 3 ? y : y - 1, two = (n) => String(n).slice(-2);
ok('the year is the Indian financial year, April to March', d.now.year === 'FY' + two(fy) + '-' + two(fy + 1), d.now.year);
ok('the quarter counts from April', d.now.quarter === d.now.year + ' Q' + (Math.floor(((m - 3 + 12) % 12) / 3) + 1), d.now.quarter);
ok('five quarters are offered: this year and next Q1', d.quarters.length === 5 && /Q1$/.test(d.quarters[4]), d.quarters.join(','));
ok('and next Q1 belongs to next year', d.quarters[4].indexOf('FY' + two(fy + 1) + '-' + two(fy + 2)) === 0, d.quarters[4]);

console.log('\n=== purpose and values: the Admin sets them ===');
const VALS = [{ code: 'C', title: 'Customer first', detail: 'We ship what we promised, when we promised.' },
              { code: 'O', title: 'Own it', detail: 'If you saw it, it is yours until it is handed over.' },
              { code: 'L', title: 'Learn every week', detail: '' }];
ok('an HOD cannot change the values', call({ action: 'saveDirection', token: H, form: { purpose: 'x', values: VALS } }).status === 'error');
const sd = call({ action: 'saveDirection', token: A, form: { purpose: 'Build machines that never stop a customer’s line.', values: VALS } });
ok('the Admin can', sd.status === 'success', sd.message);
d = call({ action: 'getDirection', token: P });
ok('everyone can read them, a Doer included', d.status === 'success' && d.values.length === 3);
ok('the purpose is stored', /never stop/.test(d.purpose));
ok('values keep their codes and order', d.values.map((v) => v.code).join('') === 'COL');
ok('a Doer is told they cannot edit', d.canEdit === false && d.canEditValues === false);
ok('two values cannot share a title', call({ action: 'saveDirection', token: A, form: { values:
   [{ code: 'A', title: 'Own it' }, { code: 'B', title: 'own it' }] } }).status === 'error');
ok('nor a code', call({ action: 'saveDirection', token: A, form: { values:
   [{ code: 'A', title: 'One' }, { code: 'A', title: 'Two' }] } }).status === 'error');
ok('saving again replaces rather than duplicates', call({ action: 'saveDirection', token: A,
   form: { purpose: d.purpose, values: VALS } }).status === 'success' &&
   call({ action: 'getDirection', token: A }).values.length === 3);

console.log('\n=== goals ===');
const yg = call({ action: 'saveGoal', token: A, form: { level: 'year', title: 'Cross ₹50 crore revenue', owner: email.split('@')[0] } });
ok('a year goal is created', yg.status === 'success' && /^G-/.test(yg.id), yg.message);
d = call({ action: 'getDirection', token: A });
const qp = d.now.quarter;
const qg = call({ action: 'saveGoal', token: H, form: { level: 'quarter', period: qp, title: 'Launch the 16-inch fan',
  owner: U('sruti'), parent: yg.id } });
ok('an HOD creates a quarter goal under it', qg.status === 'success', qg.message);
ok('a Doer cannot create goals', call({ action: 'saveGoal', token: P, form: { title: 'Mine' } }).status === 'error');
ok('a quarter goal cannot sit under another quarter goal', call({ action: 'saveGoal', token: A,
   form: { level: 'quarter', title: 'x', parent: qg.id } }).status === 'error');
ok('a quarter goal needs a quarter', call({ action: 'saveGoal', token: A,
   form: { level: 'quarter', period: 'FY26-27', title: 'x' } }).status === 'error');
ok('an owner outside the company is refused', call({ action: 'saveGoal', token: A,
   form: { title: 'x', owner: 'nobody-here' } }).status === 'error');
d = call({ action: 'getDirection', token: P });
const q = d.goals.find((g) => g.id === qg.id);
ok('it starts On course', q.status === 'On course');
ok('with no progress yet, rather than 0%', q.progress.total === 0 && q.progress.percent === null);

console.log('\n=== status, and who may change it ===');
ok('"At risk" needs a reason', call({ action: 'setGoalStatus', token: H, id: qg.id, goalStatus: 'At risk' }).status === 'error');
ok('with one, the owner sets it', call({ action: 'setGoalStatus', token: H, id: qg.id, goalStatus: 'At risk',
   note: 'Motor supplier slipped two weeks' }).status === 'success');
ok('a Doer who does not own it cannot', call({ action: 'setGoalStatus', token: P, id: qg.id, goalStatus: 'Done' }).status === 'error');
ok('an invented status is refused', call({ action: 'setGoalStatus', token: A, id: qg.id, goalStatus: 'Off track' }).status === 'error');
const pg = call({ action: 'saveGoal', token: A, form: { level: 'quarter', period: qp, title: 'Halve rework on welds', owner: U('payel') } });
ok('but a Doer who owns a goal can report on it', call({ action: 'setGoalStatus', token: P, id: pg.id, goalStatus: 'Done' }).status === 'success');

console.log('\n=== tagging work to a goal ===');
const t1 = call({ action: 'createTask', token: A, form: { title: 'Prototype motor test', assignTo: U('payel'),
  dueDate: ymd(5), goal: qg.id } });
ok('a task can name the goal it serves', t1.status === 'success', t1.message);
ok('a goal that does not exist is refused, not silently dropped',
   call({ action: 'createTask', token: A, form: { title: 'x', assignTo: U('payel'), dueDate: ymd(5), goal: 'G-nope' } }).status === 'error');
const all = call({ action: 'getDashboard', token: A }).tasks;
const tt = all.find((x) => x.title === 'Prototype motor test');
ok('the task carries the goal', tt && tt.goal === qg.id, tt && tt.goal);
call({ action: 'createTask', token: A, form: { title: 'Blade die drawing', assignTo: U('vikram'), dueDate: ymd(3), goal: qg.id } });
call({ action: 'createTask', token: A, form: { title: 'Untagged chore', assignTo: U('vikram'), dueDate: ymd(3) } });
const pj = call({ action: 'createProject', token: A, form: { name: 'Fan tooling', goal: qg.id, stages: [
  { title: 'Order die steel', assignTo: U('vikram'), dueDate: ymd(4) },
  { title: 'Machine the die', assignTo: U('payel'), dueDate: ymd(12) }] } });
ok('a whole project can serve a goal', pj.status === 'success', pj.message);
const stages = call({ action: 'getDashboard', token: A }).tasks.filter((x) => /Order die steel|Machine the die/.test(x.title));
ok('and every stage carries it', stages.length === 2 && stages.every((x) => x.goal === qg.id), stages.map((x) => x.goal).join(','));

// finish one linked task
const cycle = (id, doer) => { call({ action: 'updateTask', token: doer, taskId: id, status: 'In Progress' });
  call({ action: 'updateTask', token: doer, taskId: id, status: 'For Review' });
  call({ action: 'updateTask', token: A, taskId: id, status: 'Verified' }); };
cycle(tt.id, P);
d = call({ action: 'getDirection', token: A });
const q2 = d.goals.find((g) => g.id === qg.id);
ok('progress counts the linked work, untagged work excluded', q2.progress.total === 4, JSON.stringify(q2.progress));
ok('and is the share actually verified', q2.progress.done === 1 && q2.progress.percent === 25, JSON.stringify(q2.progress));
const yr = d.goals.find((g) => g.id === yg.id);
ok('a year goal counts the work under its quarter goals', yr.progress.total === 4 && yr.progress.done === 1, JSON.stringify(yr.progress));
const blade = call({ action: 'getDashboard', token: A }).tasks.find((x) => x.title === 'Blade die drawing');
call({ action: 'updateTask', token: A, taskId: blade.id, status: 'Cancelled' });
ok('cancelled work drops out rather than counting as undone',
   call({ action: 'getDirection', token: A }).goals.find((g) => g.id === qg.id).progress.total === 3);

const ed = call({ action: 'editTask', token: A, form: { taskId: tt.id, goal: '' } });
ok('a task can be untagged by editing it', ed.status === 'success' &&
   call({ action: 'getDashboard', token: A }).tasks.find((x) => x.id === tt.id).goal === '');

console.log('\n=== a goal with work on it is dropped, never deleted ===');
ok('deleting it is refused', call({ action: 'deleteGoal', token: A, id: qg.id }).status === 'error');
ok('and so is deleting a year goal with quarter goals under it', call({ action: 'deleteGoal', token: A, id: yg.id }).status === 'error');
const spare = call({ action: 'saveGoal', token: A, form: { title: 'Typo goal' } });
ok('an empty one can be deleted', call({ action: 'deleteGoal', token: A, id: spare.id }).status === 'success');

console.log('\n=== recurring work keeps its goal ===');
call({ action: 'createTask', token: A, form: { title: 'Weekly die check', assignTo: U('payel'), dueDate: ymd(1),
  frequency: 'Weekly', goal: qg.id } });
const wk = call({ action: 'getDashboard', token: A }).tasks.find((x) => x.title === 'Weekly die check');
cycle(wk.id, P);
const copies = call({ action: 'getDashboard', token: A }).tasks.filter((x) => x.title === 'Weekly die check');
ok('the next occurrence serves the same goal', copies.length === 2 && copies.every((x) => x.goal === qg.id),
   copies.map((x) => x.goal).join(','));

console.log('\n=== recognising a value ===');
const ck = call({ action: 'awardCookie', token: H, data: { employee: U('payel'), points: 3,
  reason: 'Stayed till the motor test passed', value: 'O' } });
ok('cookie points can name the value they recognise', ck.status === 'success', ck.message);
const cks = call({ action: 'getCookies', token: A }).cookies || [];
ok('and it is stored with the award', cks.some((c) => c.value === 'O'), JSON.stringify(cks.map((c) => c.value)));
ok('a value that is not the company’s is refused', call({ action: 'awardCookie', token: H, data: {
   employee: U('payel'), points: 1, reason: 'Some good reason here', value: 'Z' } }).status === 'error');
ok('by its title as well as its code', call({ action: 'awardCookie', token: H, data: {
   employee: U('vikram'), points: 1, reason: 'Learned the new CMM in a day', value: 'learn every week' } }).status === 'success');

console.log('\n=== key numbers ===');
const n1 = call({ action: 'saveNumber', token: A, form: { name: 'Fans despatched', owner: U('sruti'), unit: 'units',
  target: 1200, direction: 'at least', goal: yg.id } });
ok('a number is added', n1.status === 'success', n1.message);
const n2 = call({ action: 'saveNumber', token: A, form: { name: 'Line rejections', owner: U('payel'), unit: '%',
  target: 2, direction: 'at most' } });
ok('a Doer cannot define one', call({ action: 'saveNumber', token: P, form: { name: 'x' } }).status === 'error');
ok('a non-numeric target is refused', call({ action: 'saveNumber', token: A, form: { name: 'x', target: 'lots' } }).status === 'error');
ok('higher-is-better: 1250 against 1200 is a hit', call({ action: 'recordNumber', token: H, id: n1.id, value: 1250 }).hit === true);
const own = call({ action: 'recordNumber', token: P, id: n2.id, value: 3 });
ok('the owner, a Doer, may enter their own number', own.status === 'success', own.message);
ok('lower-is-better: 3% rejections against 2% is a miss', own.hit === false);
ok('a Doer cannot enter someone else’s', call({ action: 'recordNumber', token: V, id: n2.id, value: 1 }).status === 'error');
call({ action: 'recordNumber', token: P, id: n2.id, value: 1.5 });
const nums = call({ action: 'getDirection', token: A }).numbers;
const rej = nums.list.find((n) => n.id === n2.id);
ok('re-entering this week replaces it, not adds a second', rej.weeks.filter((w) => w.value !== null).length === 1 &&
   rej.weeks[rej.weeks.length - 1].value === 1.5, JSON.stringify(rej.weeks.slice(-2)));
ok('and is now a hit', rej.weeks[rej.weeks.length - 1].hit === true);
ok('six weeks are shown, newest last', nums.weeks.length === 6 && nums.weeks[5] === nums.thisWeek);
ok('weeks are keyed on Monday', new Date(nums.thisWeek + 'T00:00:00').getDay() === 1, nums.thisWeek);
ok('a number can be tied to a goal', nums.list.find((n) => n.id === n1.id).goal === yg.id);

console.log('\n=== one company never sees another’s ===');
const B = call({ action: 'register', form: { companyName: 'Beta', name: 'Sara', email: 'g2' + R + '@beta.in', password: 'strongpass123' } }).token;
const bd = call({ action: 'getDirection', token: B });
ok('another company starts empty', bd.goals.length === 0 && bd.values.length === 0 && bd.numbers.list.length === 0);
ok('and cannot tag work to our goal', call({ action: 'createTask', token: B, form: { title: 'x',
   assignTo: 'g2' + R, dueDate: ymd(2), goal: qg.id } }).status === 'error');

console.log('\n=== a blank row in the sheet does not shift edits ===');
/* Somebody tidies the Goals tab by hand and clears a row instead of deleting
   it. Every reader skips blank rows; if it counted rows AFTER skipping, each
   later goal would point one row too high and an edit would land on its
   neighbour. */
const book = Object.values(env.FILES).find((f) => {
  const g = f.getSheetByName && f.getSheetByName('Goals');
  return g && g.getDataRange().getValues().some((r) => r[0] === qg.id);
});
const gs = book.getSheetByName('Goals');
const rowsBefore = gs.getDataRange().getValues();
const blankG = call({ action: 'saveGoal', token: A, form: { level: 'quarter', period: d.now.quarter, title: 'Spare goal ' + R } });
const lastG = call({ action: 'saveGoal', token: A, form: { level: 'quarter', period: d.now.quarter, title: 'Last goal ' + R } });
const spareRow = gs.getDataRange().getValues().findIndex((r) => r[0] === blankG.id) + 1;
gs.getRange(spareRow, 1, 1, 11).clearContent();
ok('the edit lands on the goal it was meant for',
   call({ action: 'setGoalStatus', token: A, id: lastG.id, goalStatus: 'Done' }).status === 'success' &&
   gs.getDataRange().getValues().find((r) => r[0] === lastG.id)[7] === 'Done',
   JSON.stringify(gs.getDataRange().getValues().slice(-2).map((r) => [r[0], r[3], r[7]])));
ok('and nothing else changed', gs.getDataRange().getValues().slice(0, rowsBefore.length)
   .every((r, i) => r[7] === rowsBefore[i][7]));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
