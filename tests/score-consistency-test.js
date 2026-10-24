/**
 * One person, one score.
 *
 * The manual promises the leaderboard "ranks the same score your dashboard
 * shows". It did not: the dashboard, the leaderboard/Reports and the appraisal
 * each measured a different window, so one person could read three numbers.
 * This drives the real API on dist/code.gs and asks every screen for the same
 * person's score this month.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 300) + ']')); v ? pass++ : fail++; };

const env = build();
Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b' });
env.newFile('MASTER', 'Domebox Master');
const tpl = env.newFile('TEMPLATE', 'Template');
['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
tpl.getSheetByName('Settings').appendRow(['General']);

const SRC = fs.readFileSync(__dirname + '/../dist/code.gs', 'utf8');
const names = Object.keys(env.G);
const P = new Function(...names, SRC + '\n;return { doPost, ensureRegistry };')(...names.map((n) => env.G[n]));
P.ensureRegistry();
const call = (b) => JSON.parse(P.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

const A = call({ action: 'register', form: { companyName: 'Score Co', name: 'Owner', email: 'o@score.in', password: 'strongpass123' } }).token;
const dir = env.FILES.MASTER.getSheetByName('Directory');
dir.getDataRange().getValues().forEach((r, i) => { if (String(r[1]) === 'o@score.in') {
  dir.getRange(i + 1, 4).setValue('Growth'); dir.getRange(i + 1, 5).setValue(day(200)); } });
call({ action: 'addUser', token: A, form: { name: 'Payel S', username: 'payel', email: 'payel@score.in', role: 'Doer',
  manager: '', jobProfile: 'Executive', password: 'staffpass123' } });
const D = call({ action: 'login', username: 'payel@score.in', password: 'staffpass123' }).token;

/* Four jobs for Payel: three verified today, one sent back once first, and one
   still open; plus a cookie award. */
const make = (title, due, p) => call({ action: 'createTask', token: A, form: { title, assignTo: 'payel', dueDate: due, priority: p, jobCategory: 'General' } });
['Count bin G', 'Pack 50 bearings', 'Quote for Endurance'].forEach((t, i) => make(t, day(3 + i), i ? 'High' : 'Medium'));
make('Calibrate gauges', day(6), 'Low');
/* Due well into next month. It belongs to next month's score; the old
   dashboard counted it in this one, so its number differed from the board's. */
make('Annual fire drill', day(45), 'Medium');
const mine = () => call({ action: 'getDashboard', token: D }).tasks.filter((t) => t.assignee === 'payel');
mine().filter((t) => !/Calibrate gauges|Annual fire drill/.test(t.title)).forEach((t, i) => {
  call({ action: 'updateTask', token: D, taskId: t.id, status: 'In Progress' });
  call({ action: 'updateTask', token: D, taskId: t.id, status: 'For Review', note: 'done' });
  if (i === 0) {
    call({ action: 'updateTask', token: A, taskId: t.id, status: 'In Progress', note: 'redo', newDueDate: day(4) });
    call({ action: 'updateTask', token: D, taskId: t.id, status: 'For Review', note: 'redone' });
  }
  const v = call({ action: 'updateTask', token: A, taskId: t.id, status: 'Verified' });
  if (v.status !== 'success') console.log('verify:', v.message);
});
const ck = call({ action: 'awardCookie', token: A, data: { employee: 'payel', points: 3, reason: 'Stayed back for the audit' } });

const dash = call({ action: 'getDashboard', token: D }).stats.scores;
const board = call({ action: 'getLeaderboard', token: A, period: 'month', offset: 0 });
const row = (board.rows || []).find((r) => r.username === 'payel');
const rep = call({ action: 'getAnalytics', token: A, period: 'month', offset: 0 });
const person = ((rep.analytics || rep).people || []).find((p) => p.username === 'payel');
const form = call({ action: 'getAppraisalForm', token: A, username: 'payel' });

ok('(set-up: three jobs verified, one sent back once, a cookie award)', dash.hasData &&
   mine().filter((t) => t.status === 'Verified').length === 3 && (!ck.status || ck.status === 'success'), JSON.stringify(ck));
ok('the dashboard shows a score', typeof dash.delegation === 'number', dash.delegation);
ok('the leaderboard shows the same score', row && row.score === dash.delegation, (row && row.score) + ' vs ' + dash.delegation);
ok('Reports shows the same score', person && person.score === dash.delegation, (person && person.score) + ' vs ' + dash.delegation);
ok('the appraisal measures the same score', form.delegationScore === dash.delegation, form.delegationScore + ' vs ' + dash.delegation);
ok('and the cookie points are in it on every screen', dash.cookies && dash.cookies.awarded === 3 && row && row.cookiePoints === 3,
   JSON.stringify(dash.cookies) + ' ' + (row && row.cookiePoints));

const sub = call({ action: 'submitAppraisal', token: A, data: { employee: 'payel', kras: [{ rating: 4, weight: 1 }],
  behaviors: [{ rating: 5, weight: 1 }], brownie: 0, delegationScore: 0 } });
/* KRA 4/5 → 80% of 75 = 60; behaviour 5/5 → 20; performance 80.
   Final = (80 + delegation) / 2, with delegation re-measured on the server. */
ok('a saved appraisal uses the measured score, not the one the browser sent',
   sub.delegation === dash.delegation && sub.score === Math.round((80 + dash.delegation) / 2),
   JSON.stringify({ d: sub.delegation, s: sub.score, dash: dash.delegation }));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
