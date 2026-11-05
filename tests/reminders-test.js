/**
 * Open-task reminders: 9 am, 3 pm and 5 pm unless the company's Admin chose
 * other times (up to four), on the company's own working days.
 *
 * The rule, as asked for: remind the person doing the work about tasks that
 * are still open (To do or In progress), most urgent first — on the day the
 * task is assigned, and two days before it is due. Plus every working day it
 * is overdue, because a reminder schedule that goes quiet the moment a task
 * becomes late has the order backwards.
 *
 * Runs the real domebox/reminders.gs on the shim, with domain.gs beside it,
 * exactly as they sit together in the Apps Script project.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 240) + ']')); v ? pass++ : fail++; };

const env = build();
const SRC = fs.readFileSync('/home/user/stockpilot/domebox/domain.gs', 'utf8') + '\n' +
            fs.readFileSync('/home/user/stockpilot/domebox/reminders.gs', 'utf8');
const names = Object.keys(env.G);
const R = new Function(...names, SRC + '\n;return { REG, SCHED, REMIND, rmReminderReason_, rmTaskReminders_, rmDueSoonDay_, ' +
  'rmSlot_, sendTaskReminders, previewTaskReminders, sendDailyReminders, installDomeBoxSchedules, domeBoxScheduleStatus, ymd, ' +
  'cleanCalendar, cleanReminders, scoringCalendar, nextOccurrence, generateRecurringJobs };')(
  ...names.map((n) => env.G[n]));

/* Fixed dates for the rules: Wednesday 14 Oct 2026, 9:20 am. */
const WED = new Date(2026, 9, 14, 9, 20);
const day = (base, n) => { const d = new Date(base); d.setDate(d.getDate() + n); return R.ymd(d); };
const task = (o) => Object.assign({ id: o.title, assignee: 'payel', status: 'Pending', priority: 'Medium', created: day(WED, -5), due: day(WED, 10) }, o);

console.log('\n=== the rule ===');
const why = (o, when) => (R.rmReminderReason_(task(o), when || WED) || {}).kind || null;
ok('assigned today → reminded', why({ title: 'a', created: R.ymd(WED) }) === 'assigned');
ok('two days before it is due → reminded', why({ title: 'b', due: day(WED, 2) }) === 'dueSoon');
ok('three days before → not yet', why({ title: 'c', due: day(WED, 3) }) === null);
ok('due tomorrow but assigned last week → not today (it had its two-day reminder)', why({ title: 'd', due: day(WED, 1) }) === null);
ok('overdue → reminded every working day', why({ title: 'e', due: day(WED, -1) }) === 'overdue');
ok('a quiet task in the middle → nothing', why({ title: 'f' }) === null);
ok('In progress counts as open', why({ title: 'g', status: 'In Progress', created: R.ymd(WED) }) === 'assigned');
['For Review', 'Awaiting Approval', 'Verified', 'Rejected', 'Cancelled'].forEach((s) =>
  ok('"' + s + '" is not chased — the ball is not with the doer', why({ title: s, status: s, created: R.ymd(WED), due: day(WED, -3) }) === null));

console.log('\n=== weekends ===');
ok('due Monday → the two-day reminder moves to Friday, not Saturday', R.rmDueSoonDay_(new Date(2026, 9, 19)) === '2026-10-16');
ok('due Tuesday → Sunday becomes Friday too', R.rmDueSoonDay_(new Date(2026, 9, 20)) === '2026-10-16');
const SAT = new Date(2026, 9, 17, 9, 15);
ok('nothing overdue is chased on a Saturday', why({ title: 'h', due: day(SAT, -2) }, SAT) === null);
ok('but work assigned on a Saturday is still announced', why({ title: 'i', created: R.ymd(SAT) }, SAT) === 'assigned');

console.log('\n=== urgent first ===');
const list = R.rmTaskReminders_([
  task({ title: 'New, low', priority: 'Low', created: R.ymd(WED) }),
  task({ title: 'Due soon, high', priority: 'High', due: day(WED, 2) }),
  task({ title: 'Late 1 day', priority: 'Low', due: day(WED, -1) }),
  task({ title: 'Late 5 days', priority: 'Medium', due: day(WED, -5) }),
  task({ title: 'New, critical', priority: 'Critical', created: R.ymd(WED) }),
  task({ title: 'Someone else’s', assignee: 'vikram', created: R.ymd(WED) }),
], 'payel', WED).map((x) => x.task.title);
ok('overdue first, the longest late at the top', list[0] === 'Late 5 days' && list[1] === 'Late 1 day', list.join(' > '));
ok('then by priority, Critical before High before Low', list.indexOf('New, critical') < list.indexOf('Due soon, high') &&
   list.indexOf('Due soon, high') < list.indexOf('New, low'), list.join(' > '));
ok('only that person’s own work', list.indexOf('Someone else’s') < 0 && list.length === 5);
const custom = R.rmTaskReminders_([
  task({ title: 'Routine thing', priority: 'Routine', created: R.ymd(WED) }),
  task({ title: 'Line is down', priority: 'Line Down', created: R.ymd(WED) }),
  task({ title: 'Customer waiting', priority: 'Customer Hold', created: R.ymd(WED) }),
], 'payel', WED, { 'Line Down': 5, 'Customer Hold': 4, 'Routine': 1 }).map((x) => x.task.title);
ok('a workspace’s own priority names rank by their own weights', custom.join('|') === 'Line is down|Customer waiting|Routine thing', custom.join(' > '));

console.log('\n=== the three slots ===');
const slotAt = (h, m) => R.rmSlot_(new Date(2026, 9, 14, h, m || 0));
ok('a run in the 9 o’clock hour is the 9 am slot', slotAt(9, 40) === 9);
ok('the 3 pm and 5 pm runs are their own slots', slotAt(15, 5) === 15 && slotAt(17, 50) === 17);
R.installDomeBoxSchedules();
const hours = env.triggerHours.filter((x) => x[0] === 'sendTaskReminders' || x[0] === 'sendDailyReminders').map((x) => x[0] + ':' + x[1]);
ok('installing the schedule runs reminders and the digest every hour, so each company\u2019s own times can be met',
   JSON.stringify(hours.sort()) === '["sendDailyReminders:hourly","sendTaskReminders:hourly"]', JSON.stringify(hours));

console.log('\n=== end to end on a workspace ===');
const reg = env.newFile('REGX', 'Registry');
const acc = reg.insertSheet('Accounts');
acc.appendRow(['Email', 'Sheet ID', 'Company Name', 'Plan']);
acc.appendRow(['rohan@acme.in', 'TEN1', 'Acme Forgings', 'Growth']);
const ten = env.newFile('TEN1', 'Acme');
const users = ten.insertSheet('Users');
users.appendRow(['Username', 'Name', 'Email', 'Manager', 'Role']);
users.appendRow(['rohan', 'Rohan Mehta', 'rohan@acme.in', '', 'Admin']);
users.appendRow(['payel', 'Payel Sanyamath', 'payel@acme.in', 'rohan', 'Doer']);
users.appendRow(['meera', 'Meera Iyer', 'meera@acme.in', 'rohan', 'Doer']);
users.appendRow(['nita', 'Nita Bose', 'nita@acme.in', 'rohan', 'Doer']);
const tk = ten.insertSheet('Tasks');
tk.appendRow(['ID', 'Date Created', 'Due Date', 'Title', 'Description', 'Assigned By', 'Assigned To', 'Status', 'KRA Tag', 'Priority']);
/* The most recent weekday, at 9:20 — a reminder hour by default. */
const now = new Date(); while (now.getDay() === 0 || now.getDay() === 6) now.setDate(now.getDate() - 1); now.setHours(9, 20, 0, 0);
const at = (h) => { const d = new Date(now); d.setHours(h, 20, 0, 0); return d; };
tk.appendRow(['T1', now, day(now, 9), 'Count bin G stock', '', 'rohan', 'payel', 'Pending', '', 'High']);
tk.appendRow(['T2', day(now, -8), day(now, 9), 'Quiet job', '', 'rohan', 'payel', 'Pending', '', 'Low']);
tk.appendRow(['T3', now, day(now, 9), 'Already handed in', '', 'rohan', 'nita', 'For Review', '', 'High']);
tk.appendRow(['T4', now, day(now, 5), 'Meera’s new job', '', 'rohan', 'meera', 'Pending', '', 'High']);
const lv = ten.insertSheet('Leave');
lv.appendRow(['Username', 'From', 'To', 'Reason', 'Approved']);
lv.appendRow(['meera', day(now, -1), day(now, 1), 'Family function', 'TRUE']);
const bill = ten.insertSheet('Billing');
bill.appendRow(['Plan Name']); bill.appendRow(['Growth']);
R.REG.SHEET_ID = 'REGX';

const preview = R.previewTaskReminders === undefined ? '' : (R.previewTaskReminders(now), env.logs.slice(-1)[0] || '');
ok('the preview names who would get what, and sends nothing', /payel@acme\.in/.test(preview) && env.mails.length === 0, preview);
R.SCHED.DRY_RUN = false;
R.sendTaskReminders(at(11));
ok('an hour that is not a reminder time sends nothing', env.mails.length === 0);
const before = env.mails.length;
R.sendTaskReminders(now);
const sent = env.mails.slice(before);
const toPayel = sent.filter((m) => m.to === 'payel@acme.in');
ok('the person with a newly assigned task gets one email', toPayel.length === 1, sent.map((m) => m.to + ': ' + m.subject).join(' | '));
ok('naming the task', toPayel[0] && /Count bin G stock/.test(toPayel[0].html));
ok('and not the quiet one', toPayel[0] && !/Quiet job/.test(toPayel[0].html));
ok('from info@biscsindia.com', toPayel[0] && toPayel[0].from === 'info@biscsindia.com');
ok('saying when reminders come and that handing it in stops them',
   toPayel[0] && /9 am, 3 pm and 5 pm/.test(toPayel[0].html) && /Hand it in and the reminders stop/.test(toPayel[0].html));
ok('nobody is reminded about work they have handed in', !sent.some((m) => m.to === 'nita@acme.in'));
ok('nobody on approved leave is reminded', !sent.some((m) => m.to === 'meera@acme.in'));
ok('the owner, with no open tasks of his own, gets nothing', !sent.some((m) => m.to === 'rohan@acme.in'));
R.sendTaskReminders(now);
ok('a second run in the same slot sends nothing again', env.mails.length === before + sent.length);

console.log('\n=== the morning digest no longer repeats a person’s own tasks ===');
tk.appendRow(['T5', day(now, -10), day(now, -4), 'Late job', '', 'rohan', 'payel', 'Pending', '', 'High']);
const d0 = env.mails.length;
R.sendDailyReminders(at(9));
ok('the digest waits for its hour — 8 am unless the company chose another', env.mails.length === d0);
R.sendDailyReminders(at(8));
ok('a doer with only their own work gets no digest — the reminders cover it',
   !env.mails.slice(d0).some((m) => m.to === 'payel@acme.in'), env.mails.slice(d0).map((m) => m.to + ': ' + m.subject).join(' | '));
const toRohan = env.mails.slice(d0).filter((m) => m.to === 'rohan@acme.in');
ok('the manager still gets the digest, with the team\u2019s late work in it',
   toRohan.length === 1 && /Late job/.test(toRohan[0].html) && /Your team/.test(toRohan[0].html),
   env.mails.slice(d0).map((m) => m.to + ': ' + m.subject).join(' | '));

console.log('\n=== each company chooses its own week and times ===');
/* Settings columns D and E, as the app writes them. */
const st = ten.insertSheet('Settings');
const setNamed = (k, v) => { const d = st.getDataRange().getValues(); let r = d.findIndex((x) => x[3] === k);
  if (r < 0) { st.appendRow(['', '', '', k, JSON.stringify(v)]); } else st.getRange(r + 1, 5).setValue(JSON.stringify(v)); };
setNamed('reminders', { hours: [10, 16], daysBeforeDue: 3, overdue: true, digestHour: 7 });
tk.appendRow(['T6', now, day(now, 3), 'New today, due in 3', '', 'rohan', 'payel', 'Pending', '', 'Medium']);
const n0 = env.mails.length;
R.sendTaskReminders(at(9));
ok('9 am is no longer a reminder time for this company', env.mails.length === n0);
R.sendTaskReminders(at(10));
const at10 = env.mails.slice(n0).filter((m) => m.to === 'payel@acme.in');
ok('10 am is, and the email says the company\u2019s own times', at10.length === 1 && /10 am and 4 pm/.test(at10[0].html) && /3 days before it is due/.test(at10[0].html),
   at10[0] && at10[0].html.slice(-400));
const next = (h) => { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(h, 20, 0, 0); return d; };
const n1 = env.mails.length;
R.sendDailyReminders(next(8));
ok('the next morning 8 am is no longer the digest hour', !env.mails.slice(n1).some((m) => m.to === 'rohan@acme.in'));
R.sendDailyReminders(next(7));
ok('and the digest goes at the company\u2019s own hour, 7 am', env.mails.slice(n1).some((m) => m.to === 'rohan@acme.in'));

const cal = (off, hol) => R.scoringCalendar(R.cleanCalendar({ weekly: [{ from: '2000-01-01', off }], holidays: hol || [] }, true));
const sunWork = { cal: cal([1]), rem: R.cleanReminders({}, false) };          // works Sunday, rests Monday
const SUN = new Date(2026, 9, 18, 9, 20), MON = new Date(2026, 9, 19, 9, 20);
ok('a works open on Sunday chases overdue work on Sunday', (R.rmReminderReason_(task({ title: 'x', due: day(SUN, -2) }), SUN, sunWork) || {}).kind === 'overdue');
ok('and not on Monday, its day off', R.rmReminderReason_(task({ title: 'y', due: day(MON, -2) }), MON, sunWork) === null);
ok('the before-due reminder steps back off its day off: due Wednesday, 2 days before is Monday, so Sunday',
   R.rmDueSoonDay_(new Date(2026, 9, 21), sunWork) === '2026-10-18', R.rmDueSoonDay_(new Date(2026, 9, 21), sunWork));
const diwali = { cal: cal([0, 6], [{ date: '2026-11-09', name: 'Diwali' }]), rem: R.cleanReminders({}, false) };
ok('a company holiday is a day off: nothing overdue is chased', R.rmReminderReason_(task({ title: 'z', due: '2026-11-04' }), new Date(2026, 10, 9, 9), diwali) === null);
ok('and a reminder that would fall on it moves to the working day before', R.rmDueSoonDay_(new Date(2026, 10, 11), diwali) === '2026-11-06');
const quiet = { cal: null, rem: R.cleanReminders({ hours: [9], daysBeforeDue: 0, overdue: false }, true) };
ok('overdue reminders and before-due reminders can each be switched off',
   R.rmReminderReason_(task({ title: 'q', due: day(WED, -3) }), WED, quiet) === null && R.rmReminderReason_(task({ title: 'r', due: day(WED, 2) }), WED, quiet) === null);
ok('but a newly assigned task is still announced', (R.rmReminderReason_(task({ title: 's', created: R.ymd(WED) }), WED, quiet) || {}).kind === 'assigned');

console.log('\n=== the limits ===');
const err = (f) => { try { f(); return ''; } catch (e) { return e.message; } };
ok('no more than four reminder times a day', /Up to 4/.test(err(() => R.cleanReminders({ hours: [8, 10, 12, 14, 16] }, true))));
ok('none before 6 am or after 9 pm', /6 am to 9 pm/.test(err(() => R.cleanReminders({ hours: [22] }, true))) && /6 am to 9 pm/.test(err(() => R.cleanReminders({ hours: [5] }, true))));
ok('the same time cannot be chosen twice', /chosen twice/.test(err(() => R.cleanReminders({ hours: [9, 9] }, true))));
ok('fewer than three is fine, and so is none at all', R.cleanReminders({ hours: [11] }, true).hours.join() === '11' && R.cleanReminders({ hours: [] }, true).hours.length === 0);
ok('a week needs at least one working day', /at least one working day/.test(err(() => R.cleanCalendar({ weekly: [{ from: '2026-01-01', off: [0, 1, 2, 3, 4, 5, 6] }] }, true))));
ok('a company with no choice saved gets 9 am, 3 pm and 5 pm, Monday to Friday, as before',
   R.cleanReminders({}, false).hours.join() === '9,15,17' && R.cleanCalendar({}, false).weekly[0].off.join() === '0,6');

console.log('\n=== repeating "Weekdays" work follows the company\u2019s week ===');
ok('a works resting on Monday gets its weekday job on Sunday', R.ymd(R.nextOccurrence('Weekdays', '2026-10-17', { cal: sunWork.cal })) === '2026-10-18');
ok('and skips a holiday', R.ymd(R.nextOccurrence('Weekdays', '2026-11-06', { cal: diwali.cal })) === '2026-11-10');
ok('with no calendar, Monday to Friday as before', R.ymd(R.nextOccurrence('Weekdays', '2026-10-16', {})) === '2026-10-19');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
