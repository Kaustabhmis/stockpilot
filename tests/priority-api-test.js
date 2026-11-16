/** The priority list and configurable levels, over the real API. */
const { call, env } = require('./server.js');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 160) + ']')); v ? pass++ : fail++; };
const err = (f) => { try { const r = f(); return r.status === 'error' ? r.message : null; } catch (e) { return e.message; } };
const ymd = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

/* Time alone is 1ms granular, so two runs started together can share an
   id and collide on an email the other already registered. */
const R = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
const email = 'pr' + R + '@acme.in';
const A = call({ action: 'register', form: { companyName: 'Acme Engineering',
  name: 'Rohan Mehta', email, password: 'strongpass123' } }).token;
const U = (u) => u + R;
call({ action: 'addUser', token: A, form: { name: 'Payel Sanyamath', username: U('payel'),
  email: U('payel') + '@acme.in', role: 'Doer', jobProfile: 'Executive', password: 'staffpass123' } });
const P = call({ action: 'login', username: U('payel') + '@acme.in', password: 'staffpass123' }).token;

console.log('\n=== priority levels ===');
const def = call({ action: 'getCategories', token: A });
ok('a fresh workspace has sensible levels out of the box',
   def.priorities.map((p) => p.name).join(',') === 'Critical,High,Medium,Low',
   JSON.stringify(def.priorities));
ok('each carries a weight', def.priorities[0].weight === 4);

const saved = call({ action: 'updatePriorities', token: A, priorities: [
  { name: 'Line Down', weight: 5 }, { name: 'Customer Hold', weight: 3 },
  { name: 'Routine', weight: 1 }] });
ok('a workspace can name its own', saved.status === 'success', saved.message);
ok('and they come back', call({ action: 'getCategories', token: A })
   .priorities.map((p) => p.name).join(',') === 'Line Down,Customer Hold,Routine');
/* The two live side by side in one sheet, so each has to survive the other
   being written. Saving one used to clear the whole sheet. */
call({ action: 'updateCategories', token: A, categories: ['NPD', 'QUALITY', 'MAINTENANCE'] });
ok('saving categories leaves the levels alone',
   call({ action: 'getCategories', token: A }).priorities.length === 3,
   JSON.stringify(call({ action: 'getCategories', token: A }).priorities));
call({ action: 'updatePriorities', token: A, priorities: [
  { name: 'Line Down', weight: 5 }, { name: 'Customer Hold', weight: 3 },
  { name: 'Routine', weight: 1 }] });
ok('and saving levels leaves the categories alone',
   call({ action: 'getCategories', token: A }).categories.join(',') === 'NPD,QUALITY,MAINTENANCE',
   call({ action: 'getCategories', token: A }).categories.join(','));

ok('a duplicate level is refused',
   /listed twice/.test(err(() => call({ action: 'updatePriorities', token: A,
     priorities: [{ name: 'A', weight: 1 }, { name: 'a', weight: 2 }] })) || ''));
ok('a weight outside 1-10 is refused, and the message says what a weight is',
   /how much more a task at this level counts/.test(err(() => call({ action: 'updatePriorities',
     token: A, priorities: [{ name: 'A', weight: 99 }] })) || ''));
ok('an empty set is refused',
   /at least one/.test(err(() => call({ action: 'updatePriorities', token: A, priorities: [] })) || ''));
ok('a Doer cannot change them',
   /manager account/.test(err(() => call({ action: 'updatePriorities', token: P,
     priorities: [{ name: 'Mine', weight: 9 }] })) || ''));

call({ action: 'createTask', token: A, form: { title: 'Line 2 stopped',
  assignTo: U('payel'), dueDate: ymd(0), priority: 'Line Down' } });
ok('a level still on open work cannot be deleted out from under it',
   /still on 1 open task/.test(err(() => call({ action: 'updatePriorities', token: A,
     priorities: [{ name: 'Routine', weight: 1 }] })) || ''),
   err(() => call({ action: 'updatePriorities', token: A, priorities: [{ name: 'Routine', weight: 1 }] })));

console.log('\n=== the list ===');
call({ action: 'createTask', token: A, form: { title: 'Quarterly calibration',
  assignTo: U('payel'), dueDate: ymd(45), priority: 'Routine' } });
call({ action: 'createTask', token: A, form: { title: 'Vendor paperwork',
  assignTo: U('payel'), dueDate: ymd(4), priority: 'Customer Hold' } });

const day = call({ action: 'getPriorityList', token: P, horizon: 'day' });
ok('a doer gets their own list', day.employee.username === U('payel'));
ok('today shows the stopped line first', day.doNow[0].title === 'Line 2 stopped', JSON.stringify(day.doNow.map(d => d.title)));
ok('and says why it is first', day.doNow[0].reasons.some((r) => r.kind === 'today'));
ok('today does not include work due in six weeks', day.total === 1, day.total);

const quarter = call({ action: 'getPriorityList', token: P, horizon: 'quarter' });
ok('a wider horizon picks up more', quarter.total >= 2, quarter.total);
ok('the horizons are offered with their labels',
   quarter.horizons.map((h) => h.key).join(',') === 'day,week,month,quarter,year,all');
ok('each with a count', typeof quarter.counts.week === 'number');
ok('and the window end is given', /^\d{4}-\d{2}-\d{2}$/.test(quarter.horizonEnd));

ok('a manager may read somebody else\'s list',
   call({ action: 'getPriorityList', token: A, username: U('payel'), horizon: 'all' }).total >= 2);
ok('a doer may not read anybody else\'s',
   /only see your own/.test(err(() => call({ action: 'getPriorityList', token: P,
     username: 'rohan' })) || ''));

console.log('\n' + (fail ? 'FAILED ' : '') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
