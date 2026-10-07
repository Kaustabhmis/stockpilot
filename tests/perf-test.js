/**
 * The per-request cache: fast, and — the half that actually matters — never
 * stale.
 *
 * Reads are memoised for the life of one request. That is only safe if every
 * write drops the cache, because the dangerous case is a handler that writes
 * and then reads back in the same call: "I saved it and it didn't save",
 * intermittently, which takes a week to find and five minutes to cause.
 */
const { call, env } = require('./server.js');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 170) + ']')); v ? pass++ : fail++; };

const R = Date.now().toString(36);
const U = (u) => u + R;
const email = 'perf' + R + '@acme.in';
const A = call({ action: 'register', form: { companyName: 'Perf Works',
  name: 'Rohan Mehta', email, password: 'strongpass123' } }).token;
const dir = env.FILES.MASTER.getSheetByName('Directory');
const dd = dir.getDataRange().getValues();
for (let i = 1; i < dd.length; i++) if (String(dd[i][1]) === email) {
  dir.getRange(i + 1, 4).setValue('Yearly');
  const u = new Date(); u.setDate(u.getDate() + 300);
  dir.getRange(i + 1, 5).setValue(u.toISOString().slice(0, 10));
}
const PEOPLE = 20;
for (let i = 0; i < PEOPLE; i++) call({ action: 'addUser', token: A, form: { name: 'Person ' + i,
  username: U('p' + i), email: U('p' + i) + '@acme.in', role: 'Doer',
  jobProfile: 'Executive', password: 'staffpass123' } });

/* Count every full-sheet read this tenant does, the way Apps Script would
   count round trips to Sheets. */
const sid = Object.keys(env.FILES).find((k) => k.startsWith('SHEET_') &&
  env.FILES[k].getSheetByName('Users') &&
  env.FILES[k].getSheetByName('Users')._data.length === PEOPLE + 2);
const ss = env.FILES[sid];
const orig = ss.getSheetByName.bind(ss);
let reads = 0;
ss.getSheetByName = (n) => {
  const sh = orig(n);
  if (sh && !sh.__counted) { const g = sh.getDataRange.bind(sh);
    sh.getDataRange = () => { reads++; return g(); }; sh.__counted = true; }
  return sh;
};
const cost = (fn) => { reads = 0; fn(); return reads; };

console.log('\n=== the Reports page no longer scales with headcount ===');
const analytics = cost(() => call({ action: 'getAnalytics', token: A, period: 'month', span: 12 }));
/* It used to call scoreOpts_ once per person per period, each one re-reading
   the whole Users sheet twice and the Cookies sheet once: 20 people over a
   twelve-period trend was 824 reads, and 150 people would have been ~5,900. */
ok('a twelve-period trend for ' + PEOPLE + ' people costs a handful of reads, not hundreds',
   analytics <= 12, analytics + ' reads');
ok('and the dashboard is cheap too',
   cost(() => call({ action: 'getDashboard', token: A })) <= 12);
ok('as is the priority list',
   cost(() => call({ action: 'getPriorityList', token: A, horizon: 'month' })) <= 12);
ok('and the accountability report',
   cost(() => call({ action: 'getAccountability', token: A })) <= 12);

console.log('\n=== and it is flat, which is the actual fix ===');
/* The old cost grew with the number of people, so the page got slower exactly
   as a customer became worth more — and Apps Script kills any execution at six
   minutes, so the largest account is the first that cannot open its reports. */
for (let i = PEOPLE; i < PEOPLE + 25; i++) call({ action: 'addUser', token: A, form: {
  name: 'Extra ' + i, username: U('x' + i), email: U('x' + i) + '@acme.in',
  role: 'Doer', jobProfile: 'Executive', password: 'staffpass123' } });
const bigger = cost(() => call({ action: 'getAnalytics', token: A, period: 'month', span: 12 }));
ok('adding 25 more people does not cost a single extra read',
   bigger === analytics, analytics + ' -> ' + bigger);

console.log('\n=== nothing is ever read back stale ===');
const task = (title, to, due) => {
  call({ action: 'createTask', token: A, form: { title, assignTo: U(to), dueDate: due } });
  return call({ action: 'getDashboard', token: A }).tasks.find((t) => t.title === title);
};
ok('a task created in one call is visible in the next', !!task('Fresh task', 'p0', '2026-12-01'));

const t = task('Edited task', 'p0', '2026-12-01');
call({ action: 'editTask', token: A, form: { taskId: t.id, title: 'Edited task', priority: 'High' } });
ok('an edit is read back, not served from the cache it invalidated',
   call({ action: 'getDashboard', token: A }).tasks.find((x) => x.id === t.id).priority === 'High');

call({ action: 'updateUser', token: A, form: { name: 'Renamed Person', username: U('p1'),
  originalUsername: U('p1'), email: U('p1') + '@acme.in', role: 'Doer', jobProfile: 'Executive' } });
ok('a renamed user is read back',
   call({ action: 'getUsers', token: A }).users.some((u) => u.name === 'Renamed Person'));

call({ action: 'updateCategories', token: A, categories: ['ONE', 'TWO'] });
ok('categories are read back', call({ action: 'getCategories', token: A }).categories.join() === 'ONE,TWO');
/* Keeping the levels the open work already carries — the guard that stops a
   level being deleted out from under a live task is tested in
   priority-api-test; what is under test here is only that the write is read
   back rather than served from the cache it invalidated. */
call({ action: 'updatePriorities', token: A, priorities: [
  { name: 'Critical', weight: 9 }, { name: 'High', weight: 3 },
  { name: 'Medium', weight: 2 }, { name: 'Low', weight: 1 }] });
ok('priority levels are read back',
   call({ action: 'getCategories', token: A }).priorities[0].weight === 9,
   JSON.stringify(call({ action: 'getCategories', token: A }).priorities[0]));

call({ action: 'awardCookie', token: A, data: { employee: U('p0'), points: 3,
  reason: 'Cleared the backlog before the audit' } });
ok('a cookie point is read back', call({ action: 'getCookies', token: A }).cookies.length === 1);
ok('and it reaches the score in the same breath',
   (call({ action: 'getDashboard', token: call({ action: 'login',
     username: U('p0') + '@acme.in', password: 'staffpass123' }).token })
     .stats.scores.cookies || {}).awarded === 3);

/* The one that would have been worst: submitAppraisal_ writes the Reviews tab
   and getDashboard reads it straight back for the performance half of the
   score. A stale read here means the appraisal you just saved does not count. */
call({ action: 'saveKra', token: A, data: { employee: U('p2'), kras: [
  { item: 'Output', weight: 100, target: '95', unit: '%', direction: 'higher is better' }] } });
const form = call({ action: 'getAppraisalForm', token: A, username: U('p2') });
const saved = call({ action: 'submitAppraisal', token: A, data: { employee: U('p2'),
  kras: form.kras.map((k) => ({ rating: 4, weight: k.weight })),
  behaviors: form.behaviors.map((b) => ({ rating: 4, weight: b.weight })), brownie: 2 } });
ok('an appraisal is saved and scored', saved.status === 'success' && saved.score > 0, saved.message);
ok('and the person sees it immediately, not next request',
   call({ action: 'getPerformanceReport', token: A }).report.some((r) => r.username === U('p2')));

console.log('\n' + (fail ? 'FAILED ' : '') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
