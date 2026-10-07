/**
 * A repeat that nobody can stop is not a schedule, it is a standing
 * instruction with no owner. These checks cover the whole life of one: every
 * cadence, the two ways it ends by itself, the manual stop, and — the part
 * that actually bites — that the scheduler running at 6am applies exactly the
 * same limits as the app does when somebody verifies a task.
 */
const { call, env } = require('./server.js');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 170) + ']')); v ? pass++ : fail++; };

const R = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
const email = 'rep' + R + '@acme.in';
const A = call({ action: 'register', form: { companyName: 'Acme Engineering',
  name: 'Rohan Mehta', email, password: 'strongpass123' } }).token;
call({ action: 'addUser', token: A, form: { name: 'Payel S', username: 'payel' + R,
  email: 'payel' + R + '@acme.in', role: 'Doer', jobProfile: 'Executive', password: 'staffpass123' } });
const P = call({ action: 'login', username: 'payel' + R + '@acme.in', password: 'staffpass123' }).token;
const ymd = (plus) => { const d = new Date(); d.setDate(d.getDate() + plus); return d.toISOString().slice(0, 10); };
const find = (title) => call({ action: 'getDashboard', token: A }).tasks
  .filter((x) => x.title === title).sort((a, b) => (a.due < b.due ? -1 : 1));
/* Verification is what spawns the next occurrence in-app, so a full cycle is
   the only honest way to test the series. */
const cycle = (id) => {
  call({ action: 'updateTask', token: P, taskId: id, status: 'In Progress' });
  call({ action: 'updateTask', token: P, taskId: id, status: 'For Review' });
  return call({ action: 'updateTask', token: A, taskId: id, status: 'Verified' });
};
const make = (title, freq, extra) => {
  const r = call({ action: 'createTask', token: A, form: Object.assign({ title,
    assignTo: 'payel' + R, dueDate: ymd(1), frequency: freq }, extra || {}) });
  return r;
};

console.log('\n=== every cadence the product offers ===');
const CADENCES = ['Daily', 'Weekdays', 'Weekly', 'Fortnightly', 'Monthly',
                  'Quarterly', 'Half-Yearly', 'Yearly'];
const gaps = {};
CADENCES.forEach((c) => {
  make('Cadence ' + c, c);
  const first = find('Cadence ' + c)[0];
  cycle(first.id);
  const all = find('Cadence ' + c);
  ok(c + ' spawns the next one', all.length === 2, all.length);
  if (all.length === 2) gaps[c] = (new Date(all[1].due) - new Date(all[0].due)) / 86400000;
});
ok('Daily is one day on', gaps.Daily === 1, gaps.Daily);
ok('Weekly is seven', gaps.Weekly === 7, gaps.Weekly);
ok('Fortnightly is fourteen', gaps.Fortnightly === 14, gaps.Fortnightly);
ok('Weekdays never lands on a weekend',
   [1, 3].indexOf(gaps.Weekdays) > -1 &&
   [0, 6].indexOf(new Date(find('Cadence Weekdays')[1].due).getDay()) < 0, gaps.Weekdays);
ok('Monthly is a month, not thirty days', gaps.Monthly >= 28 && gaps.Monthly <= 31, gaps.Monthly);
ok('Quarterly is three months', gaps.Quarterly >= 89 && gaps.Quarterly <= 92, gaps.Quarterly);
ok('Half-Yearly is six months', gaps['Half-Yearly'] >= 181 && gaps['Half-Yearly'] <= 184, gaps['Half-Yearly']);
ok('Yearly is twelve months', gaps.Yearly >= 365 && gaps.Yearly <= 366, gaps.Yearly);

console.log('\n=== a one-time task stays one ===');
make('Single job', 'One Time');
cycle(find('Single job')[0].id);
ok('nothing is spawned after it', find('Single job').length === 1);

console.log('\n=== it stops after a number of times ===');
make('Three only', 'Daily', { repeatCount: 3 });
for (let i = 0; i < 4; i++) {
  const open = find('Three only').filter((t) => t.status !== 'Verified')[0];
  if (open) cycle(open.id);
}
const three = find('Three only');
ok('exactly three occurrences exist, not four', three.length === 3, three.length);
ok('the last one no longer repeats', three[2].frequency === 'One Time', three[2].frequency);
ok('the history says why it ended',
   (three[2].history || []).some((h) => /all 3 occurrences done/.test(h.note || '')),
   JSON.stringify((three[2].history || []).map((h) => h.note)));
ok('the count is carried, not restarted', three[1].repeatMade === 2, three[1].repeatMade);

console.log('\n=== it stops on a date ===');
make('Until Friday', 'Daily', { repeatUntil: ymd(3) });
for (let i = 0; i < 8; i++) {
  const open = find('Until Friday').filter((t) => t.status !== 'Verified')[0];
  if (open) cycle(open.id);
}
const dated = find('Until Friday');
ok('nothing is due after the end date',
   dated.every((t) => t.due <= ymd(3)), dated.map((t) => t.due).join(','));
ok('and the series is closed off', dated[dated.length - 1].frequency === 'One Time');
ok('the history names the end date',
   (dated[dated.length - 1].history || []).some((h) => /ran to /.test(h.note || '')));

console.log('\n=== a rule that cannot mean anything is refused ===');
ok('a stop rule on a one-time task is refused',
   call({ action: 'createTask', token: A, form: { title: 'Nope', assignTo: 'payel' + R,
     dueDate: ymd(1), frequency: 'One Time', repeatCount: 5 } }).status === 'error');
ok('repeating once is refused as a one-time task',
   /One Time/.test(call({ action: 'createTask', token: A, form: { title: 'Nope2',
     assignTo: 'payel' + R, dueDate: ymd(1), frequency: 'Daily', repeatCount: 1 } }).message));
ok('an end date before the first due date is refused',
   call({ action: 'createTask', token: A, form: { title: 'Nope3', assignTo: 'payel' + R,
     dueDate: ymd(10), frequency: 'Daily', repeatUntil: ymd(2) } }).status === 'error');
ok('a thousand occurrences is refused',
   call({ action: 'createTask', token: A, form: { title: 'Nope4', assignTo: 'payel' + R,
     dueDate: ymd(1), frequency: 'Daily', repeatCount: 1000 } }).status === 'error');
ok('and none of those were actually created',
   find('Nope').length + find('Nope2').length + find('Nope3').length + find('Nope4').length === 0);

console.log('\n=== both limits together: whichever comes first ===');
make('Belt and braces', 'Daily', { repeatCount: 20, repeatUntil: ymd(2) });
for (let i = 0; i < 6; i++) {
  const open = find('Belt and braces').filter((t) => t.status !== 'Verified')[0];
  if (open) cycle(open.id);
}
ok('the date wins when it comes first',
   find('Belt and braces').every((t) => t.due <= ymd(2)),
   find('Belt and braces').map((t) => t.due).join(','));

console.log('\n=== stopping it by hand ===');
make('Stop me', 'Weekly', { repeatCount: 10 });
const sm = find('Stop me')[0];
ok('a manager can stop it',
   call({ action: 'stopRecurringTask', token: A, taskId: sm.id }).status === 'success');
cycle(sm.id);
ok('and then it does not spawn', find('Stop me').length === 1);
const stopped = find('Stop me')[0];
ok('the limit is cleared with it, not left half-spent',
   !stopped.repeatCount && !stopped.repeatUntil,
   stopped.repeatCount + '/' + stopped.repeatUntil);
make('Doer stop', 'Weekly');
ok('a Doer cannot stop someone else\'s series',
   call({ action: 'stopRecurringTask', token: P,
          taskId: find('Doer stop')[0].id }).status === 'error');

console.log('\n=== editing the rule ===');
make('Rethink', 'Monthly', { repeatCount: 12 });
const rt = find('Rethink')[0];
ok('the rule can be changed after the fact',
   call({ action: 'editTask', token: A, form: { taskId: rt.id, repeatUntil: ymd(90),
     repeatCount: 0 } }).status === 'success');
const rt2 = find('Rethink')[0];
ok('and the new rule is what is stored',
   rt2.repeatUntil === ymd(90) && !rt2.repeatCount, rt2.repeatUntil + '/' + rt2.repeatCount);
ok('an impossible edit is refused',
   call({ action: 'editTask', token: A, form: { taskId: rt2.id, frequency: 'One Time',
     repeatCount: 4 } }).status === 'error');

console.log('\n=== the scheduler obeys the same rule as the app ===');
const sched = fs.readFileSync('/home/user/stockpilot/domebox/reminders.gs', 'utf8');
ok('it reads the end date off the row', /col\.repeatuntil/.test(sched));
ok('it reads the occurrence limit off the row', /col\.repeatcount/.test(sched));
ok('it passes both into the same rules engine the app uses',
   /endDate: until, maxOccurrences: limit/.test(sched));
ok('it no longer hardcodes "forever"', !/endDate: '', maxOccurrences: 0/.test(sched));
ok('it says in the log when a series has ended', /series ended/.test(sched));
ok('it advances the count it writes onto each new occurrence', /col\.repeatmade/.test(sched));

console.log('\n=== the columns were appended, never inserted ===');
const cfg = fs.readFileSync('/home/user/stockpilot/src/01-config.gs', 'utf8');
const cols = cfg.match(/var TASK_COLS = \[([\s\S]*?)\];/)[1]
  .replace(/\/\*[\s\S]*?\*\//g, '').match(/'[^']+'/g).map((x) => x.slice(1, -1));
ok('the first 19 columns are untouched', cols[18] === 'Delegate To', cols[18]);
ok('the project columns stayed where they were', cols[23] === 'Stage Gate', cols[23]);
ok('the repeat columns are last',
   cols.slice(-3).join(',') === 'Repeat Until,Repeat Count,Repeat Made', cols.slice(-3).join(','));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
