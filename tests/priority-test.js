/**
 * The priority list, and priority levels a workspace defines for itself.
 * The claim under test: the order answers "what do I do first?", and every
 * row says why it is where it is.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const D = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'domebox', 'domain.gs'), 'utf8'), D);

let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 170) + ']')); v ? pass++ : fail++; };

const S = D.STATUS;
const today = new Date('2026-11-16T10:00:00');     // a Monday
const ymd = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const t = (o) => Object.assign({ id: 'T', title: 'Task', assignee: 'payel', priority: 'Medium',
  status: S.PENDING, reworkCount: 0, raisedBy: 'boss', approver: 'boss', history: [], blockedBy: [] }, o);
const q = (tasks, user, horizon) =>
  D.priorityQueue(tasks, user || 'payel', today, null, { horizon: horizon || 'all' });
const why = (row, kind) => (row.reasons || []).find((r) => r.kind === kind);

console.log('\n=== a deadline beats a label ===');
{
  const list = q([
    t({ id: 'A', title: 'High, due next month', priority: 'High', due: ymd(30) }),
    t({ id: 'B', title: 'Low, due this afternoon', priority: 'Low', due: ymd(0) }),
  ]);
  ok('a Low task due today outranks a High one due next month',
     list.doNow[0].id === 'B', list.doNow.map((r) => r.id).join(','));
  ok('and the row says it is due today', !!why(list.doNow[0], 'today'));
}
{
  const list = q([
    t({ id: 'A', title: 'Same date, Medium', priority: 'Medium', due: ymd(2) }),
    t({ id: 'B', title: 'Same date, Critical', priority: 'Critical', due: ymd(2) }),
  ]);
  ok('on the same date, the more serious one goes first', list.doNow[0].id === 'B');
}
{
  const list = q([
    t({ id: 'A', title: 'Overdue a week', priority: 'Low', due: ymd(-7) }),
    t({ id: 'B', title: 'Critical, due in a fortnight', priority: 'Critical', due: ymd(14) }),
  ]);
  ok('overdue work comes first, whatever its label', list.doNow[0].id === 'A', list.doNow[0].title);
  ok('and the row says how overdue', /day\(s\) overdue/.test(why(list.doNow[0], 'overdue').text));
}

console.log('\n=== work other people are waiting on is lifted ===');
{
  const base = t({ id: 'A', title: 'Nobody waiting', priority: 'Medium', due: ymd(5) });
  const hub  = t({ id: 'B', title: 'Three waiting on it', priority: 'Medium', due: ymd(5) });
  const deps = [1, 2, 3].map((i) => t({ id: 'D' + i, assignee: 'other', blockedBy: ['B'] }));
  const list = q([base, hub].concat(deps));
  ok('a task three people are waiting on outranks an identical one nobody needs',
     list.doNow[0].id === 'B', list.doNow.map((r) => r.id).join(','));
  ok('and the row says how many are waiting',
     /3 task\(s\) waiting on this/.test(why(list.doNow[0], 'blocking').text));
}
{
  const list = q([
    t({ id: 'A', title: 'Started', status: S.IN_PROGRESS, due: ymd(5) }),
    t({ id: 'B', title: 'Not started', status: S.PENDING, due: ymd(5) }),
  ]);
  ok('finishing beats starting, all else equal', list.doNow[0].id === 'A');
  ok('and it says so', !!why(list.doNow[0], 'started'));
}

console.log('\n=== work nobody can act on is set aside, not ranked ===');
{
  const blocker = t({ id: 'X', title: 'Vendor audit', assignee: 'other', status: S.IN_PROGRESS });
  const list = q([
    blocker,
    t({ id: 'A', title: 'Blocked and screamingly overdue', priority: 'Critical', due: ymd(-20), blockedBy: ['X'] }),
    t({ id: 'B', title: 'Actually doable', priority: 'Low', due: ymd(9) }),
  ]);
  ok('the blocked task is not at the top of the to-do list',
     list.doNow.every((r) => r.id !== 'A'), list.doNow.map((r) => r.id).join(','));
  ok('it is listed separately as waiting', list.waiting.length === 1 && list.waiting[0].id === 'A');
  ok('naming what it is waiting on', list.waiting[0].blockedBy[0].title === 'Vendor audit');
  ok('and the doable one is what you are told to do', list.doNow[0].id === 'B');
}
{
  const blocker = t({ id: 'X', title: 'Done already', assignee: 'other', status: S.VERIFIED });
  const list = q([blocker, t({ id: 'A', due: ymd(1), blockedBy: ['X'] })]);
  ok('a blocker that is finished no longer holds anything back',
     list.waiting.length === 0 && list.doNow.length === 1);
}

console.log('\n=== the list is an instruction, not a pile ===');
{
  const many = [];
  for (let i = 0; i < 12; i++) many.push(t({ id: 'T' + i, title: 'Job ' + i, due: ymd(i) }));
  const list = q(many);
  ok('three things to do now', list.doNow.length === 3);
  ok('five queued behind them', list.next.length === 5);
  ok('the rest are there but out of the way', list.later.length === 4);
  ok('and nothing is lost', list.doNow.length + list.next.length + list.later.length === 12);
  ok('the count of overdue work is reported', q([t({ due: ymd(-3) })]).overdue === 1);
}
{
  const list = q([
    t({ id: 'M', assignee: 'payel', due: ymd(1) }),
    t({ id: 'O', assignee: 'vikram', due: ymd(0) }),
  ]);
  ok('it is one person list, not the whole company', list.total === 1 && list.doNow[0].id === 'M');
}
{
  const list = q([
    t({ id: 'A', due: ymd(1) }),
    t({ id: 'B', due: ymd(1), status: S.AWAITING_APPROVAL }),
    t({ id: 'C', due: ymd(1), status: S.VERIFIED }),
    t({ id: 'D', due: ymd(1), isArchived: true }),
  ]);
  ok('work not yet accepted, already closed, or archived is left out',
     list.total === 1 && list.doNow[0].id === 'A', list.total);
}

console.log('\n=== every row shows its working ===');
{
  const list = q([t({ id: 'A', title: 'Rejection analysis', priority: 'Critical', due: ymd(-2) })]);
  const r = list.doNow[0];
  ok('the label counts', why(r, 'priority').text === 'Critical');
  ok('the date counts', !!why(r, 'overdue'));
  ok('each reason carries the points it added', r.reasons.every((x) => typeof x.points === 'number'));
  ok('and they add up to the score shown',
     r.reasons.reduce((s, x) => s + x.points, 0) === r.score, r.score);
}

console.log('\n=== the list is about what this person can actually do ===');
{
  const list = q([
    t({ id: 'MINE', title: 'Still on my desk', due: ymd(4) }),
    t({ id: 'SENT', title: 'Handed in last week', due: ymd(-5), status: S.FOR_REVIEW,
        history: [{ date: new Date('2026-11-09T10:00:00'), status: S.FOR_REVIEW }] }),
  ]);
  ok('work already handed in is not in the to-do order',
     list.doNow.every((r) => r.id !== 'SENT'), list.doNow.map((r) => r.id).join(','));
  ok('it is listed as handed in, so it is not simply lost',
     list.handedIn.length === 1 && list.handedIn[0].id === 'SENT');
  ok('and what remains is what they can act on', list.doNow[0].id === 'MINE');
}
{
  /* Sruti owns nothing herself but owes two decisions. A list that showed her
     nothing would be telling her she is free while the score charges her for
     the queue. */
  const waitingOnHer = [
    t({ id: 'R1', title: 'Rejection report', assignee: 'payel', approver: 'sruti',
        status: S.FOR_REVIEW, due: ymd(-1),
        history: [{ date: new Date('2026-11-10T10:00:00'), status: S.FOR_REVIEW }] }),
    t({ id: 'A1', title: 'New vendor task', assignee: 'payel', approver: 'sruti',
        status: S.AWAITING_APPROVAL, due: ymd(6),
        history: [{ date: new Date('2026-11-13T10:00:00'), status: S.AWAITING_APPROVAL }] }),
  ];
  const list = D.priorityQueue(waitingOnHer, 'sruti', today, null, { horizon: 'all' });
  ok('decisions she owes other people are on her list', list.decisions.length === 2,
     JSON.stringify(list.decisions.map((d) => d.id)));
  ok('a review is named as a review', list.decisions.some((d) => d.kind === 'review'));
  ok('an approval as an approval', list.decisions.some((d) => d.kind === 'approval'));
  ok('the one held longest comes first', list.decisions[0].id === 'R1', list.decisions[0].id);
  ok('and the row says how long it has sat there',
     /Waiting on a decision for \d+ working day/.test(
       (list.decisions[0].reasons.find((x) => x.kind === 'held') || {}).text || ''),
     JSON.stringify(list.decisions[0].reasons));
  ok('they are kept apart from her own work', list.total === 0 && list.doNow.length === 0);
}

console.log('\n=== daily, weekly, monthly, quarterly, yearly ===');
{
  /* Monday 16 Nov 2026. This week ends Sunday the 22nd, the month on the 30th,
     the quarter and the year both on 31 December. */
  const spread = [
    t({ id: 'TODAY',   title: 'Due today',        due: ymd(0) }),
    t({ id: 'THUR',    title: 'Due Thursday',     due: ymd(3) }),
    t({ id: 'NEXTWK',  title: 'Due in ten days',  due: ymd(10) }),
    t({ id: 'DEC',     title: 'Due in December',  due: '2026-12-20' }),
    t({ id: 'NEXTYR',  title: 'Due next March',   due: '2027-03-10' }),
    t({ id: 'LATE',    title: 'Overdue a month',  due: ymd(-30) }),
  ];
  const n = (h) => q(spread, 'payel', h).total;
  ok('today shows what is due today, and what is already late', n('day') === 2, n('day'));
  ok('this week adds the rest of the week', n('week') === 3, n('week'));
  ok('this month adds the rest of the month', n('month') === 4, n('month'));
  ok('this quarter reaches the end of December', n('quarter') === 5, n('quarter'));
  ok('this year is the same here, the quarter being the last of the year', n('year') === 5);
  ok('everything includes next March too', n('all') === 6, n('all'));

  const week = q(spread, 'payel', 'week');
  ok('overdue work appears in every horizon, including today',
     q(spread, 'payel', 'day').doNow.some((r) => r.id === 'LATE'));
  ok('the window carries its end date so the screen can say it',
     week.horizonEnd === '2026-11-22', week.horizonEnd);
  ok('and each horizon reports its own count, for the buttons',
     week.counts.day === 2 && week.counts.month === 4 && week.counts.all === 6,
     JSON.stringify(week.counts));
}
{
  const list = q([t({ id: 'A', title: 'No date on it', due: '' }),
                  t({ id: 'B', due: ymd(1) })], 'payel', 'week');
  ok('work with no date is not silently dropped into this week', list.total === 1);
  ok('but it is counted, so it cannot be forgotten about', list.undated === 1);
  ok('and it does appear under Everything', q([t({ id: 'A', due: '' })], 'payel', 'all').total === 1);
}

console.log('\n=== a workspace can name its own levels ===');
{
  D.setPriorityScale([{ name: 'Line Down', weight: 5 }, { name: 'Customer Hold', weight: 3 },
                      { name: 'Routine', weight: 1 }]);
  ok('the new levels carry their weights', D.priorityWeight('Line Down') === 5);
  ok('and are ranked in the order they were given',
     D.priorityRank('Line Down') < D.priorityRank('Routine'));
  const list = q([
    t({ id: 'A', priority: 'Routine', due: ymd(4) }),
    t({ id: 'B', priority: 'Line Down', due: ymd(4) }),
  ]);
  ok('the list orders by them', list.doNow[0].id === 'B');
  ok('a level nobody recognises is scored as the middle, not thrown away',
     D.priorityWeight('Whatever This Is') === 2);
  // Put the defaults back for anything that runs after this.
  D.setPriorityScale(D.DEFAULT_PRIORITIES);
  ok('the defaults restore cleanly', D.priorityWeight('High') === 3 && D.priorityWeight('Critical') === 4);
}

console.log('\n' + (fail ? 'FAILED ' : 'ALL PASS ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
