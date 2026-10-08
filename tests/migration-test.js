/**
 * An existing customer, moved onto the new build. The only question that
 * matters: does anything they already have get lost, changed or locked away?
 *
 * The workspace below is built the way the OLD system wrote it — the old 15
 * task columns and 9 user columns, plaintext passwords in three places, the old
 * plan name "Standard", tasks in every status with their history, appraisals
 * already on file, and the file shared ANYONE_WITH_LINK. Nothing in it was
 * produced by the new code. Then the new code is pointed at it, exactly as
 * step 11 of DEPLOY-EASY.md does, and every cell that existed before is checked
 * to be byte-for-byte what it was.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 220) + ']')); v ? pass++ : fail++; };

const SRC = fs.readFileSync('/home/user/stockpilot/dist/code.gs', 'utf8');
const env = build();
Object.assign(env.props, { MASTER_DB_ID: 'LIVE_REGISTRY', TEMPLATE_ID: 'TEMPLATE',
  AUTH_PEPPER: 'migration-pepper', TOKEN_SECRET: 'migration-token' });

/* ---------------------------------------------------------------- the OLD data
   Column layouts copied from what the old code wrote. Passwords in plaintext,
   because that is what is really in the live sheets today. */
const OLD_TASK_COLS = ['ID','Date Created','Due Date','Title','Description','Assigned By',
  'Assigned To','Status','KRA Tag','Priority','Frequency','Reworks','History JSON',
  'Job Category','Approver Manager'];
const OLD_USER_COLS = ['Name','Username','Password','Email','Role','Job Profile','Dept','Phone','Manager'];

const reg = env.newFile('LIVE_REGISTRY', 'Dome Box Registry (live)');
const dir = reg.insertSheet('Directory');
dir.appendRow(['Company','Email','Password','Plan','Valid Until','SheetID','Status','Created']);
dir.appendRow(['Ghosh Fabricators', 'owner@ghoshfab.in', 'OldPass#2024', 'Standard',
  '2026-12-31', 'GHOSH_SHEET', 'Active', '2025-03-14']);
dir.appendRow(['Another Customer', 'boss@other.in', 'theirpass99', 'Pro',
  '2027-03-31', 'OTHER_SHEET', 'Active', '2025-06-02']);
const glob = reg.insertSheet('Global_Users');
glob.appendRow(['Email','Password','SheetID','Username']);
glob.appendRow(['owner@ghoshfab.in', 'OldPass#2024', 'GHOSH_SHEET', 'owner']);
glob.appendRow(['ravi@ghoshfab.in', 'ravi1234', 'GHOSH_SHEET', 'ravi']);
glob.appendRow(['boss@other.in', 'theirpass99', 'OTHER_SHEET', 'boss']);

const t = env.newFile('GHOSH_SHEET', 'Ghosh Fabricators — Dome Box');
const users = t.insertSheet('Users');
users.appendRow(OLD_USER_COLS);
users.appendRow(['Sanjay Ghosh', 'owner', 'OldPass#2024', 'owner@ghoshfab.in', 'Admin', 'Owner', 'Management', '9830000001', '']);
users.appendRow(['Ravi Kumar', 'ravi', 'ravi1234', 'ravi@ghoshfab.in', 'Doer', 'Welder', 'Shop Floor', '9830000002', 'owner']);
users.appendRow(['Mita Das', 'mita', 'mita5678', 'mita@ghoshfab.in', 'HOD', 'Supervisor', 'Shop Floor', '9830000003', 'owner']);

const tasks = t.insertSheet('Tasks');
tasks.appendRow(OLD_TASK_COLS);
const h = (pairs) => JSON.stringify(pairs.map(([status, date, user, note]) =>
  ({ status, date, user, note: note || '' })));
const OLD_TASKS = [
  ['T-1001', '2026-09-02', '2026-09-10', 'Weld frame for order 4471', 'MS frame, 6mm', 'owner', 'ravi',
   'Verified', 'Production', 'High', 'One Time', 0,
   h([['Pending','2026-09-02T09:00:00Z','Sanjay Ghosh'],['In Progress','2026-09-03T10:00:00Z','Ravi Kumar'],
      ['For Review','2026-09-09T16:00:00Z','Ravi Kumar'],['Verified','2026-09-10T11:00:00Z','Sanjay Ghosh']]),
   'Fabrication', ''],
  ['T-1002', '2026-09-15', '2026-09-20', 'Grind and paint gate panels', '', 'owner', 'ravi',
   'Verified', 'Production', 'Medium', 'One Time', 1,
   h([['Pending','2026-09-15T09:00:00Z','Sanjay Ghosh'],['In Progress','2026-09-16T09:00:00Z','Ravi Kumar'],
      ['For Review','2026-09-19T15:00:00Z','Ravi Kumar'],['In Progress','2026-09-19T17:00:00Z','Sanjay Ghosh','Paint runs on panel 3'],
      ['For Review','2026-09-22T12:00:00Z','Ravi Kumar'],['Verified','2026-09-22T15:00:00Z','Sanjay Ghosh']]),
   'Finishing', ''],
  ['T-1003', '2026-10-01', '2026-10-25', 'Monthly machine oiling', '', 'mita', 'ravi',
   'Pending', 'Maintenance', 'Low', 'Monthly', 0,
   h([['Pending','2026-10-01T08:00:00Z','Mita Das']]), 'Maintenance', ''],
  ['T-1004', '2026-10-03', '2026-10-12', 'Quote for Bose Steel railing job', 'Get rates for SS304', 'owner', 'mita',
   'In Progress', 'Sales', 'High', 'One Time', 0,
   h([['Pending','2026-10-03T09:00:00Z','Sanjay Ghosh'],['In Progress','2026-10-04T10:00:00Z','Mita Das']]),
   'Sales', ''],
  ['T-1005', '2026-10-05', '2026-10-09', 'Raise PO for welding rods', '', 'ravi', 'mita',
   'For Review', 'Stores', 'Medium', 'One Time', 0,
   h([['Pending','2026-10-05T09:00:00Z','Ravi Kumar'],['In Progress','2026-10-05T11:00:00Z','Mita Das'],
      ['For Review','2026-10-07T16:00:00Z','Mita Das']]), 'Purchase', ''],
  ['T-1006', '2026-08-20', '2026-08-28', 'Old cancelled enquiry', '', 'owner', 'mita',
   'Cancelled', 'Sales', 'Low', 'One Time', 0,
   h([['Pending','2026-08-20T09:00:00Z','Sanjay Ghosh'],['Cancelled','2026-08-25T09:00:00Z','Sanjay Ghosh']]),
   'Sales', ''],
];
OLD_TASKS.forEach((r) => tasks.appendRow(r));

t.insertSheet('Settings').getRange(1, 1, 4, 1).setValues([['Fabrication'], ['Finishing'], ['Maintenance'], ['Sales']]);
t.insertSheet('KRA_Master').appendRow(['Job Profile','KRA Title','Description','Weight','Grid/KPI']);
t.getSheetByName('KRA_Master').appendRow(['Welder', 'Weld quality', 'No rework on welds', 60, '']);
const rev = t.insertSheet('Reviews');
rev.appendRow(['Month','Employee','Performance Score','Delegation Score','Final Score','Date']);
rev.appendRow(['Aug 2026', 'ravi', 78, 82, 80, '2026-09-01']);
rev.appendRow(['Jul 2026', 'ravi', 70, 74, 72, '2026-08-01']);
t.insertSheet('Leave').appendRow(['Username','From','To','Reason','Approved']);
env.META.GHOSH_SHEET = { sharing: 'ANYONE_WITH_LINK' };            // as the old code left it
env.newFile('TEMPLATE', 'Template');

/* The other customer, minimal but real: one Admin, one task. */
const oth = env.newFile('OTHER_SHEET', 'Other customer');
oth.insertSheet('Users').appendRow(OLD_USER_COLS);
oth.getSheetByName('Users').appendRow(['Big Boss', 'boss', 'theirpass99', 'boss@other.in', 'Admin', 'Owner', '', '', '']);
oth.insertSheet('Tasks').appendRow(OLD_TASK_COLS);
oth.getSheetByName('Tasks').appendRow(['O-1', '2026-10-01', '2026-10-20', 'Their own work', '', 'boss', 'boss',
  'Pending', '', 'Medium', 'One Time', 0, h([['Pending', '2026-10-01T09:00:00Z', 'Big Boss']]), '', '']);

/* The dangerous one. Somebody at this company added a "Site Notes" column of
   their own straight after the old fifteen, and has been using it. The schema
   is positional: column 16 is where Dome Box now keeps "Spawned By". Widen
   this sheet blindly and the first task update writes over their notes. */
dir.appendRow(['Bose Steel', 'md@bosesteel.in', 'bosepass1', 'Standard', '2026-12-31', 'BOSE_SHEET', 'Active', '2025-01-10']);
glob.appendRow(['md@bosesteel.in', 'bosepass1', 'BOSE_SHEET', 'md']);
const bose = env.newFile('BOSE_SHEET', 'Bose Steel — Dome Box');
bose.insertSheet('Users').appendRow(OLD_USER_COLS);
bose.getSheetByName('Users').appendRow(['A. Bose', 'md', 'bosepass1', 'md@bosesteel.in', 'Admin', 'MD', '', '', '']);
const bt = bose.insertSheet('Tasks');
bt.appendRow(OLD_TASK_COLS.concat(['Site Notes']));
bt.appendRow(['B-1', '2026-10-01', '2026-10-15', 'Install railing at Salt Lake site', '', 'md', 'md', 'In Progress',
  '', 'High', 'One Time', 0, h([['Pending', '2026-10-01T09:00:00Z', 'A. Bose']]), '', '',
  'Client wants matte finish; gate opens inward']);
const boseBefore = JSON.stringify(bt.getDataRange().getValues());

/* A snapshot of every cell, before the new code has touched anything. */
const snap = (sh) => JSON.stringify(sh.getDataRange().getValues());
const before = {
  dir: snap(dir), glob: snap(glob), rev: snap(rev),
  tasks: tasks.getDataRange().getValues().map((r) => r.slice(0, 15)),
  users: users.getDataRange().getValues().map((r) => r.slice(0, 9)),
  settings: snap(t.getSheetByName('Settings')),
  kra: snap(t.getSheetByName('KRA_Master')),
};

/* ---------------------------------------------------------------- the NEW code */
const names = Object.keys(env.G);
const APP = new Function(...names, SRC + '\n;return { doPost, ensureRegistry, previewMigration, migrateAllTenants };')(...names.map((n) => env.G[n]));
const call = (b) => JSON.parse(APP.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());

console.log('\n=== step 11: point the new code at the live registry ===');
APP.ensureRegistry();
ok('the Directory is untouched by ensureRegistry', snap(dir) === before.dir);
ok('and so is Global_Users', snap(glob) === before.glob);
ok('the new tabs were added beside them', !!reg.getSheetByName('Invoices') && !!reg.getSheetByName('Billing'));
ok('no customer rows were added or removed', dir.getDataRange().getValues().length === 4);

console.log('\n=== previewMigration(): read everything, change nothing ===');
const tasksBeforePreview = snap(tasks), usersBeforePreview = snap(users), globBeforePreview = snap(glob);
const pv = APP.previewMigration();
ok('it reports every customer in the registry', /3 customers in the registry/.test(pv), pv.slice(0, 200));
ok('it names Ghosh Fabricators with what will be added', /Ghosh Fabricators — 3 people, 6 tasks; will add/.test(pv),
   (pv.match(/Ghosh[^\n]*/) || [])[0]);
ok('it finds the person who would be locked out', /1 person would be locked out/.test(pv),
   (pv.match(/Ghosh[^\n]*/) || [])[0]);
ok('it flags the customer with their own column, and says which column',
   /NEEDS A LOOK[\s\S]*Bose Steel — Tasks column P is "Site Notes"/.test(pv), (pv.match(/Bose[^\n]*/) || [])[0]);
ok('and tells you where to move it', /Tasks: AB or later/.test(pv));
ok('the preview changed no task cell', snap(tasks) === tasksBeforePreview);
ok('no user cell', snap(users) === usersBeforePreview);
ok('and gave nobody access', snap(glob) === globBeforePreview);

console.log('\n=== migrateAllTenants() ===');
const mg = APP.migrateAllTenants();
ok('it upgrades the customers it safely can', /UPGRADED \(2\)/.test(mg), mg.slice(0, 400));
ok('the person who would have been locked out now has access', /1 person who could not have signed in now can/.test(mg));
ok('Bose Steel is left exactly as it was', JSON.stringify(bt.getDataRange().getValues()) === boseBefore);
ok('their notes are still in their column',
   bt.getDataRange().getValues()[1][15] === 'Client wants matte finish; gate opens inward');

console.log('\n=== the owner signs in with the password they have always used ===');
const O = call({ action: 'login', username: 'owner@ghoshfab.in', password: 'OldPass#2024' });
ok('the old plaintext password still works', O.status === 'success', O.message);
ok('and they are still the Admin', O.user && O.user.role === 'Admin');
ok('of the same company', O.company === 'Ghosh Fabricators', O.company);
const storedNow = users.getDataRange().getValues()[1][2];
ok('their password was quietly upgraded to a hash on the way in', /^\$?[a-z0-9]+\$\d+\$/i.test(String(storedNow)) && storedNow !== 'OldPass#2024',
   String(storedNow).slice(0, 30));
ok('a wrong password is still refused', call({ action: 'login', username: 'owner@ghoshfab.in',
   password: 'wrong' }).status === 'error');
ok('the old password keeps working after the upgrade',
   call({ action: 'login', username: 'owner@ghoshfab.in', password: 'OldPass#2024' }).status === 'success');

console.log('\n=== their staff sign in too, without being told anything ===');
const R = call({ action: 'login', username: 'ravi@ghoshfab.in', password: 'ravi1234' });
ok('a Doer signs in with their old password', R.status === 'success', R.message);
ok('as a Doer', R.user && R.user.role === 'Doer');
const M = call({ action: 'login', username: 'mita@ghoshfab.in', password: 'mita5678' });
ok('so does an HOD added by hand to the sheet, once the migration gave her access', M.status === 'success', M.message);

console.log('\n=== every task is there, as it was ===');
const dash = call({ action: 'getDashboard', token: O.token });
const seen = (dash.tasks || []).concat(call({ action: 'getTasks', token: O.token }).tasks || []);
const byId = {}; seen.forEach((x) => { byId[x.id] = x; });
OLD_TASKS.forEach((r) => {
  const x = byId[r[0]];
  ok(r[0] + ' "' + r[3] + '" is present with its status and due date',
     x && x.title === r[3] && x.status === r[7] && x.due === r[2],
     x ? [x.title, x.status, x.due].join(' | ') : 'missing');
});
ok('the rework count carried over', byId['T-1002'] && byId['T-1002'].reworkCount === 1);
ok('the full history carried over, notes included',
   byId['T-1002'] && byId['T-1002'].history.length === 6 &&
   byId['T-1002'].history.some((e) => e.note === 'Paint runs on panel 3'));
ok('the old repeating job is still a repeating job', byId['T-1003'] && byId['T-1003'].frequency === 'Monthly');
ok('old repeats have no stop rule forced on them', byId['T-1003'] && !byId['T-1003'].repeatCount && !byId['T-1003'].repeatUntil);
ok('the job categories they set up are still theirs',
   JSON.stringify(call({ action: 'getCategories', token: O.token }).categories) ===
   JSON.stringify(['Fabrication', 'Finishing', 'Maintenance', 'Sales']));

console.log('\n=== their plan and what they paid for ===');
ok('"Standard" is honoured, not downgraded', dash.usage && /Standard/.test(dash.usage.planName), dash.usage && dash.usage.planName);
ok('with the 20 seats it was sold with', dash.usage && dash.usage.maxUsers === 20, dash.usage && dash.usage.maxUsers);
ok('and the expiry they paid up to', dash.usage && dash.usage.daysLeft > 0, dash.usage && dash.usage.daysLeft);
ok('grandfathered customers get the full feature set', call({ action: 'getAnalytics', token: O.token }).status === 'success');
ok('the leaderboard and priority list work on day one',
   call({ action: 'getLeaderboard', token: O.token }).status === 'success' &&
   call({ action: 'getPriorityList', token: R.token }).status === 'success');

console.log('\n=== their history means something on day one ===');
ok('past appraisals are still on file',
   (call({ action: 'getPerformanceReport', token: O.token }).report || []).length === 2);
ok('scores are computed from the old task history', R && call({ action: 'getDashboard', token: R.token }).stats.scores.delegation > 0);

console.log('\n=== they keep working, and the old data stays put ===');
const nt = call({ action: 'createTask', token: O.token, form: { title: 'First task on the new system',
  assignTo: 'ravi', dueDate: '2026-10-30', priority: 'Medium' } });
ok('a new task can be created', nt.status === 'success', nt.message);
const ft = call({ action: 'getDashboard', token: O.token }).tasks.find((x) => x.title === 'First task on the new system');
call({ action: 'updateTask', token: R.token, taskId: byId['T-1003'].id, status: 'In Progress' });
ok('an old task can be moved on', call({ action: 'getDashboard', token: O.token }).tasks
   .find((x) => x.id === 'T-1003').status === 'In Progress');

const afterTasks = tasks.getDataRange().getValues();
ok('the header row still begins with the 15 old columns, in order',
   afterTasks[0].slice(0, 15).join('|') === OLD_TASK_COLS.join('|'), afterTasks[0].slice(0, 15).join('|'));
ok('new columns were appended after them, never inserted', afterTasks[0].length > 15 &&
   afterTasks[0].indexOf('Repeat Count') > 14, afterTasks[0].slice(15).join(', '));
const untouched = before.tasks.slice(1).every((row, i) => {
  if (row[0] === 'T-1003') return true;                     // the one we just moved, on purpose
  return JSON.stringify(afterTasks[i + 1].slice(0, 15)) === JSON.stringify(row);
});
ok('every other old task row is byte-for-byte what it was', untouched);
ok('the old user columns are in the same order',
   users.getDataRange().getValues()[0].slice(0, 9).join('|') === OLD_USER_COLS.join('|'));
ok('nothing about a user changed except a password becoming a hash',
   users.getDataRange().getValues().slice(1).every((r, i) =>
     r.slice(0, 9).every((c, j) => j === 2 || c === before.users[i + 1][j])));
ok('the appraisals were not rewritten', snap(rev) === before.rev);
ok('nor the KRAs', snap(t.getSheetByName('KRA_Master')) === before.kra);

console.log('\n=== nobody can see anybody else\'s company ===');
const other = call({ action: 'login', username: 'boss@other.in', password: 'theirpass99' });
ok('the other customer signs in too, on their old "Pro" plan', other.status === 'success' && /Pro|Yearly/.test(
   JSON.stringify(call({ action: 'getDashboard', token: other.token }).usage)), other.message);
ok('and sees none of Ghosh Fabricators\' work',
   !(call({ action: 'getDashboard', token: other.token }).tasks || []).some((x) => /flanges|Weld frame|gate panels/.test(x.title)));

console.log('\n=== the customer with their own column cannot be harmed ===');
const BL = call({ action: 'login', username: 'md@bosesteel.in', password: 'bosepass1' });
ok('they are not let in to a workspace that would overwrite their data', BL.status === 'error');
ok('and are told plainly nothing was changed or lost', /Nothing has been changed or lost/.test(BL.message || ''), BL.message);
ok('the operator was emailed the exact column', env.mails.some((m) => /column check/.test(m.subject) && /column P is "Site Notes"/.test(m.body || '')));
ok('their sheet is still byte-for-byte what it was', JSON.stringify(bt.getDataRange().getValues()) === boseBefore);

/* The fix the report asks for: move their column past the end of ours. */
const width = OLD_TASK_COLS.length + 1;                        // P, with Site Notes in it
const notes = bt.getRange(1, width, 2, 1).getValues();
bt.getRange(1, width, 2, 1).setValues([[''], ['']]);
bt.getRange(1, 28, 2, 1).setValues(notes);                     // AB
const pv2 = APP.previewMigration();
ok('with the column moved to AB, the preview clears it', /Bose Steel — 1 person, 1 task; will add/.test(pv2) && !/NEEDS A LOOK/.test(pv2),
   (pv2.match(/Bose[^\n]*/) || [])[0]);
APP.migrateAllTenants();
const BL2 = call({ action: 'login', username: 'md@bosesteel.in', password: 'bosepass1' });
ok('and then they sign in', BL2.status === 'success', BL2.message);
const bvals = bt.getDataRange().getValues();
ok('Dome Box headings filled P to AA', bvals[0][15] === 'Spawned By' && bvals[0][26] === 'Repeat Made',
   bvals[0].slice(15, 27).join(','));
ok('their own column is untouched at AB, heading and notes',
   bvals[0][27] === 'Site Notes' && bvals[1][27] === 'Client wants matte finish; gate opens inward', bvals[0][27] + ' / ' + bvals[1][27]);
call({ action: 'updateTask', token: BL2.token, taskId: 'B-1', status: 'For Review' });
ok('and working on their task still leaves their notes alone',
   bt.getDataRange().getValues()[1][27] === 'Client wants matte finish; gate opens inward');

console.log('\n=== if the migration step is forgotten, customers still get in ===');
/* A customer the operator never ran migrateAllTenants for — added to the
   registry after the run, say. Their first sign-in upgrades their sheet on
   the way in, with the same header check. */
dir.appendRow(['Late Joiner', 'ceo@late.in', 'latepass1', 'Standard', '2026-12-31', 'LATE_SHEET', 'Active', '2025-02-02']);
glob.appendRow(['ceo@late.in', 'latepass1', 'LATE_SHEET', 'ceo']);
const late = env.newFile('LATE_SHEET', 'Late Joiner');
late.insertSheet('Users').appendRow(OLD_USER_COLS);
late.getSheetByName('Users').appendRow(['C. Late', 'ceo', 'latepass1', 'ceo@late.in', 'Admin', 'CEO', '', '', '']);
late.insertSheet('Tasks').appendRow(OLD_TASK_COLS);
const LJ = call({ action: 'login', username: 'ceo@late.in', password: 'latepass1' });
ok('they sign in without anybody running anything', LJ.status === 'success', LJ.message);
ok('and their sheet was upgraded on the way in',
   late.getSheetByName('Tasks').getDataRange().getValues()[0].length === 27 && !!late.getSheetByName('Cookie_Points'));
ok('which is remembered, so it does not run again', env.props.SCHEMA_LATE_SHEET === '2026-10');

console.log('\n=== the one thing step 12 is for ===');
ok('the old sheet is still shared publicly until step 12 is run',
   env.META.GHOSH_SHEET.sharing === 'ANYONE_WITH_LINK');
ok('and the new code never made it worse', env.META.GHOSH_SHEET.sharing !== 'ANYONE_WITH_LINK_EDIT');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
