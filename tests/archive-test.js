/**
 * Cold storage: tasks closed more than a year ago move from Tasks to a
 * Tasks_Archive tab in the same spreadsheet.
 *
 * This touches live customer data, so the bar is: nothing is lost, nothing is
 * duplicated, no number anybody has seen changes, and the rows that must stay
 * (open work, the template of a repeating job, a blocker, part of a project)
 * stay — however old they are.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 220) + ']')); v ? pass++ : fail++; };

const SRC = fs.readFileSync('/home/user/stockpilot/dist/code.gs', 'utf8');
const env = build();
Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b' });
env.newFile('MASTER', 'Registry');
const tpl = env.newFile('TEMPLATE', 'Template');
['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
tpl.getSheetByName('Settings').appendRow(['General']);
const names = Object.keys(env.G);
const APP = new Function(...names, SRC + '\n;return { doPost, ensureRegistry, previewTaskArchive, archiveOldTasks, ' +
  'installTaskArchiveSchedule, TASK_COLS, findTaskRow_, writeTaskField_ };')(...names.map((n) => env.G[n]));
APP.ensureRegistry();
const call = (b) => JSON.parse(APP.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());

const A = call({ action: 'register', form: { companyName: 'Acme Forgings', name: 'Rohan Mehta',
  email: 'rohan@acme.in', password: 'strongpass123' } }).token;
const dir = env.FILES.MASTER.getSheetByName('Directory');
dir.getDataRange().getValues().forEach((r, i) => {
  if (String(r[1]).toLowerCase() === 'rohan@acme.in') { dir.getRange(i + 1, 4).setValue('Growth');
    const u = new Date(); u.setDate(u.getDate() + 300); dir.getRange(i + 1, 5).setValue(u.toISOString().slice(0, 10)); }
});
call({ action: 'addUser', token: A, form: { name: 'Payel S', username: 'payel', email: 'payel@acme.in', role: 'Doer',
  manager: '', jobProfile: 'Executive', password: 'staffpass123' } });

const book = Object.values(env.FILES).find((f) => f.getSheetByName && f.getSheetByName('Users') &&
  f.getSheetByName('Users').getDataRange().getValues().some((r) => r.indexOf('payel') > -1));
const tasks = book.getSheetByName('Tasks');
const C = {}; APP.TASK_COLS.forEach((c, i) => { C[c] = i; });

const ago = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return d; };
const row = (o) => {
  const r = APP.TASK_COLS.map(() => '');
  const created = ago(o.createdAgo || o.closedAgo + 10);
  r[C['ID']] = o.id; r[C['Date Created']] = created; r[C['Title']] = o.title || o.id;
  r[C['Due Date']] = (o.due || ago((o.closedAgo || 0) + 2)).toISOString().slice(0, 10);
  r[C['Assigned By']] = 'rohan'; r[C['Assigned To']] = 'payel'; r[C['Status']] = o.status || 'Verified';
  r[C['Priority']] = 'High'; r[C['Frequency']] = o.freq || 'One Time'; r[C['Reworks']] = 0;
  r[C['Job Category']] = 'General'; r[C['Approver Manager']] = 'rohan';
  r[C['Spawned By']] = o.parent || ''; r[C['Blocked By']] = JSON.stringify(o.blockedBy || []);
  r[C['Project ID']] = o.project || ''; r[C['Project']] = o.project ? 'Project ' + o.project : '';
  r[C['Stage No']] = o.stage || ''; r[C['Stage Count']] = o.project ? 2 : '';
  const hist = [{ date: created.toISOString(), status: 'Pending', user: 'Rohan Mehta', note: 'Task assigned' }];
  if ((o.status || 'Verified') === 'Verified') {
    hist.push({ date: ago(o.closedAgo + 1).toISOString(), status: 'For Review', user: 'Payel S', note: '' });
    hist.push({ date: ago(o.closedAgo).toISOString(), status: 'Verified', user: 'Rohan Mehta', note: '' });
  }
  r[C['History JSON']] = JSON.stringify(hist);
  return r;
};
[
  { id: 'OLD1', title: 'Old one-off job', closedAgo: 400 },
  { id: 'OLD2', title: 'Another old job', closedAgo: 380 },
  { id: 'RECENT', title: 'Closed this summer', closedAgo: 100 },
  { id: 'OPENOLD', title: 'Open since last year', status: 'Pending', createdAgo: 500 },
  { id: 'YEARLY', title: 'Annual fire audit', closedAgo: 370, freq: 'Yearly' },          // newest of its series
  { id: 'MPARENT', title: 'Monthly count (Jan)', closedAgo: 420, freq: 'Monthly' },
  { id: 'MCHILD', title: 'Monthly count (Feb)', status: 'Pending', createdAgo: 30, freq: 'Monthly', parent: 'MPARENT' },
  { id: 'BLOCKER', title: 'Old drawing approval', closedAgo: 450 },
  { id: 'BLOCKED', title: 'Waits on the drawing', status: 'Pending', createdAgo: 20, blockedBy: ['BLOCKER'] },
  { id: 'P1S1', title: 'Project P stage 1', closedAgo: 500, project: 'P1', stage: 1 },
  { id: 'P1S2', title: 'Project P stage 2', closedAgo: 400, project: 'P1', stage: 2 },
  { id: 'P2S1', title: 'Project Q stage 1', closedAgo: 500, project: 'P2', stage: 1 },
  { id: 'P2S2', title: 'Project Q stage 2', status: 'Pending', createdAgo: 10, project: 'P2', stage: 2 },
].forEach((o) => tasks.appendRow(row(o)));

const ids = (sh) => sh ? sh.getDataRange().getValues().slice(1).map((r) => String(r[0])).filter(Boolean) : [];
const MOVE = ['OLD1', 'OLD2', 'MPARENT', 'P1S1', 'P1S2'];
const before = {
  rows: tasks.getDataRange().getValues().map((r) => JSON.stringify(r)),
  appraisal: call({ action: 'getAppraisalForm', token: A, username: 'payel' }),
  archive: call({ action: 'getArchive', token: A, pageSize: 100 }),
  yearAgo: call({ action: 'getAnalytics', token: A, period: 'year', offset: 1 }),
  board: call({ action: 'getLeaderboard', token: A, period: 'year', offset: 1 }),
  projects: call({ action: 'getProjects', token: A }),
};

console.log('\n=== preview changes nothing ===');
const pv = APP.previewTaskArchive();
ok('the preview counts what would move', /would move 5 of 13 tasks/.test(pv), pv);
ok('and moves none of it', ids(tasks).length === 13 && !book.getSheetByName('Tasks_Archive'));

console.log('\n=== the move ===');
const run = APP.archiveOldTasks();
ok('it reports what it moved', /moved 5 of 13 tasks/.test(run), run);
const cold = book.getSheetByName('Tasks_Archive');
ok('a Tasks_Archive tab now exists, in the customer’s own file', !!cold);
ok('with the same columns as Tasks', cold && JSON.stringify(cold.getDataRange().getValues()[0]) === JSON.stringify(APP.TASK_COLS));
ok('the five old closed tasks moved', MOVE.every((id) => ids(cold).indexOf(id) > -1 && ids(tasks).indexOf(id) < 0),
   'live: ' + ids(tasks).join(',') + ' | cold: ' + ids(cold).join(','));
const moved = cold.getDataRange().getValues().slice(1).map((r) => JSON.stringify(r));
ok('row for row — every value intact', MOVE.every((id) => {
  const was = before.rows.find((r) => JSON.parse(r)[0] === id);
  return moved.indexOf(was) > -1;
}));
ok('nothing is in both places', ids(cold).every((id) => ids(tasks).indexOf(id) < 0));
ok('and nothing else was touched: the eight that stay are unchanged',
   tasks.getDataRange().getValues().slice(1).every((r) => before.rows.indexOf(JSON.stringify(r)) > -1) && ids(tasks).length === 8);

console.log('\n=== what never moves, however old ===');
ok('work closed this summer stays', ids(tasks).indexOf('RECENT') > -1);
ok('open work stays, even from last year', ids(tasks).indexOf('OPENOLD') > -1);
ok('the newest occurrence of a repeating job stays — the next is copied from it', ids(tasks).indexOf('YEARLY') > -1);
ok('but an older occurrence with a newer one after it moves', ids(cold).indexOf('MPARENT') > -1);
ok('a task an open task is blocked by stays', ids(tasks).indexOf('BLOCKER') > -1);
ok('a project with an open stage keeps all its stages', ids(tasks).indexOf('P2S1') > -1 && ids(tasks).indexOf('P2S2') > -1);
ok('a project closed long ago moves whole', ids(cold).indexOf('P1S1') > -1 && ids(cold).indexOf('P1S2') > -1);

console.log('\n=== no number anybody has seen changes ===');
ok('(and there were numbers to compare: last year had deliveries, the appraisal had history)',
   before.yearAgo.summary.delivered >= 4 && before.appraisal.delegationBreakdown.length >= 6 && before.archive.total >= 8,
   JSON.stringify([before.yearAgo.summary, before.appraisal.delegationBreakdown.length, before.archive.total]));
const after = {
  appraisal: call({ action: 'getAppraisalForm', token: A, username: 'payel' }),
  archive: call({ action: 'getArchive', token: A, pageSize: 100 }),
  yearAgo: call({ action: 'getAnalytics', token: A, period: 'year', offset: 1 }),
  board: call({ action: 'getLeaderboard', token: A, period: 'year', offset: 1 }),
  projects: call({ action: 'getProjects', token: A }),
};
ok('the appraisal delegation score is the same', after.appraisal.delegationScore === before.appraisal.delegationScore &&
   after.appraisal.delegationBreakdown.length === before.appraisal.delegationBreakdown.length,
   before.appraisal.delegationScore + ' -> ' + after.appraisal.delegationScore);
ok('last year’s report is the same', JSON.stringify(after.yearAgo.summary) === JSON.stringify(before.yearAgo.summary),
   JSON.stringify(before.yearAgo.summary) + ' -> ' + JSON.stringify(after.yearAgo.summary));
ok('last year’s leaderboard is the same', JSON.stringify(after.board.rows) === JSON.stringify(before.board.rows));
ok('the old project still shows, with both stages', JSON.stringify(after.projects.projects.map((p) => [p.id, (p.stageList || []).length])) ===
   JSON.stringify(before.projects.projects.map((p) => [p.id, (p.stageList || []).length])));
ok('Archive search still finds the moved work, and the count is the same',
   after.archive.total === before.archive.total && after.archive.tasks.some((t) => t.id === 'OLD1'),
   before.archive.total + ' -> ' + after.archive.total);

console.log('\n=== a moved task can be read, not changed ===');
const upd = call({ action: 'updateTask', token: A, taskId: 'OLD1', status: 'Pending', note: 'reopen' });
ok('trying to change it says where it is, not that it is lost', upd.status === 'error' && /kept in the archive/.test(upd.message), upd.message);

console.log('\n=== safe to run again, and safe if a run stopped half way ===');
ok('a second run moves nothing', /nothing old enough to move/.test(APP.archiveOldTasks()));
/* A run that copied a row and stopped before removing it: the row is in both. */
const half = row({ id: 'HALF', title: 'Copied but not yet removed', closedAgo: 600 });
tasks.appendRow(half); cold.appendRow(half);
ok('while it is in both, it is counted once', call({ action: 'getArchive', token: A, pageSize: 100 }).total === before.archive.total + 1);
APP.archiveOldTasks();
ok('the next run finishes the job without copying it twice',
   ids(tasks).indexOf('HALF') < 0 && ids(cold).filter((id) => id === 'HALF').length === 1);

console.log('\n=== a sheet on an old layout is left alone ===');
const B = call({ action: 'register', form: { companyName: 'Beta Tools', name: 'Asha', email: 'asha@beta.in', password: 'strongpass123' } });
const bBook = Object.values(env.FILES).find((f) => f !== book && f.getSheetByName && f.getSheetByName('Users') &&
  f.getSheetByName('Users').getDataRange().getValues().some((r) => r.indexOf('asha@beta.in') > -1));
const bTasks = bBook.getSheetByName('Tasks');
bTasks.getRange(1, 1, 1, APP.TASK_COLS.length).setValues([APP.TASK_COLS.slice(0, 20).concat(APP.TASK_COLS.slice(20).map(() => ''))]);
bTasks.appendRow(row({ id: 'BOLD', closedAgo: 500 }));
const runB = APP.archiveOldTasks();
ok('it is skipped with a reason, and nothing is removed', /Beta Tools: STOPPED — the Tasks tab is not on the current layout/.test(runB) &&
   ids(bTasks).indexOf('BOLD') > -1, runB);

console.log('\n=== an edit in flight while rows move lands on the right task ===');
{
  /* A user's request found P2S2's row; then the archive removed a row above
     it before the write. Writing by the old row number would hit a neighbour. */
  const hit = APP.findTaskRow_({ ss: book }, 'P2S2');
  const rowsBefore = tasks.getDataRange().getValues().map((r) => JSON.stringify(r));
  const at = tasks.getDataRange().getValues().findIndex((r) => r[0] === 'P2S2') + 1;
  ok('(the task is not on the first data row, so a row above it can move)', at > 3, at);
  tasks.deleteRow(2);                                  // a row above it goes; everything shifts up
  APP.writeTaskField_(hit, 'Title', 'Project Q stage 2 (renamed)');
  const now = tasks.getDataRange().getValues();
  const target = now.find((r) => r[0] === 'P2S2');
  ok('the write lands on the task it was meant for', target && target[C['Title']] === 'Project Q stage 2 (renamed)');
  ok('and no other task was overwritten', now.filter((r) => r[0] !== 'P2S2').every((r) => rowsBefore.indexOf(JSON.stringify(r)) > -1));
  const gone = APP.findTaskRow_({ ss: book }, 'BLOCKER');
  tasks.getDataRange().getValues().forEach((r, i) => { if (r[0] === 'BLOCKER') tasks.deleteRow(i + 1); });
  let msg = '';
  try { APP.writeTaskField_(gone, 'Title', 'x'); } catch (e) { msg = e.message; }
  ok('a task moved away mid-edit is refused with a reason, not written somewhere else', /moved to the archive/.test(msg), msg);
}

console.log('\n=== the monthly schedule ===');
APP.installTaskArchiveSchedule();
const t = env.triggerHours.filter((x) => x[0] === 'archiveOldTasks');
ok('installs one trigger, 1st of the month, around 2 am', t.length === 1 && t[0][1] === 2 && t[0][2] === 1, JSON.stringify(t));
APP.installTaskArchiveSchedule();
ok('installing again does not add a second', env.triggers.filter((x) => x === 'archiveOldTasks').length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
