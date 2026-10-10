/**
 * Manager accountability — the responsiveness half of the score.
 *
 * These run the real rules engine (domebox/domain.gs) in a sandbox, so what is
 * asserted here is what the deployed code.gs does. The point of every case is
 * the same promise: if a manager sits on an approval or a review, the score
 * says so, and says exactly which item and for how many working days.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const D = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'domebox', 'domain.gs'), 'utf8'), D);

let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 160) + ']')); v ? pass++ : fail++; };

const S = D.STATUS;
const at = (ymd, st) => ({ date: new Date(ymd + 'T10:00:00'), status: st });
// Mon 2026-10-05 .. Fri 2026-10-09; Sat/Sun 10-11; Mon 2026-10-12.
const today = new Date('2026-10-19T10:00:00');            // a Monday
const CAL = { weekend: [0, 6], holidays: [], leave: {} };

const task = (o) => Object.assign({
  id: 'T1', title: 'Item', due: '2026-10-30', priority: 'Medium',
  assignee: 'doer', raisedBy: 'boss', approver: 'boss',
  status: S.FOR_REVIEW, reworkCount: 0, history: [],
}, o);

const stats = (tasks, user, cal) => D.responsivenessStats(tasks, user, today, cal === undefined ? CAL : cal);

console.log('\n=== held time is measured from when it landed on the desk ===');
{
  // Handed in Mon 5th, reviewed Mon 12th: 5 working days held (Sat/Sun skipped).
  const t = task({ status: S.VERIFIED, history: [at('2026-10-05', S.FOR_REVIEW), at('2026-10-12', S.VERIFIED)] });
  const r = stats([t], 'boss');
  ok('the spell is found at all', r.hasData);
  ok('held = 5 working days, not 7 calendar days', r.items === 1 && r.breakdown.length === 1 && /5 working day/.test(r.breakdown[0].reason), JSON.stringify(r.breakdown));
  ok('3 days over a 2-day SLA costs 6 points', r.penalty === 6, r.penalty);
}
{
  // The task is not due until the 30th. Keyed off the deadline this would cost
  // nothing at all — that was the bug.
  const t = task({ due: '2026-12-31', status: S.VERIFIED, history: [at('2026-10-05', S.FOR_REVIEW), at('2026-10-12', S.VERIFIED)] });
  ok('work handed in early that then sits still costs the reviewer', stats([t], 'boss').penalty === 6);
}
{
  const t = task({ status: S.VERIFIED, history: [at('2026-10-05', S.FOR_REVIEW), at('2026-10-07', S.VERIFIED)] });
  const r = stats([t], 'boss');
  ok('cleared inside the 2-day SLA costs nothing', r.penalty === 0, r.penalty);
  ok('and still counts as a measured item', r.items === 1 && r.withinSla === 1);
}

console.log('\n=== neglect: something still sitting there is charged now ===');
{
  const t = task({ status: S.FOR_REVIEW, history: [at('2026-10-05', S.FOR_REVIEW)] });
  const r = stats([t], 'boss');
  ok('an open spell is counted', r.pending === 1 && r.overdueNow === 1);
  ok('charged to today, not to the close date it never got', r.penalty > 0);
  ok('the reason says it is still waiting', /Still waiting on you/.test(r.breakdown[0].reason), r.breakdown[0].reason);
}
{
  // Status says Awaiting Approval but nobody wrote a history row.
  const t = task({ status: S.AWAITING_APPROVAL, due: '2026-10-05', history: [] });
  const r = stats([t], 'boss');
  ok('an undocumented wait still runs the clock', r.items === 1 && r.penalty > 0, JSON.stringify(r));
}

console.log('\n=== the right person is charged ===');
{
  const t = task({ status: S.AWAITING_APPROVAL, approver: 'mgr', raisedBy: 'boss',
                   history: [at('2026-10-05', S.AWAITING_APPROVAL)] });
  ok('an approval is charged to the approver', stats([t], 'mgr').penalty > 0);
  ok('and not to the person who raised it', stats([t], 'boss').hasData === false);
  ok('nor to the doer waiting on it', stats([t], 'doer').hasData === false);
}
{
  const t = task({ status: S.FOR_REVIEW, approver: '', raisedBy: 'boss',
                   history: [at('2026-10-05', S.FOR_REVIEW)] });
  ok('with no approver set, the review falls to whoever raised it', stats([t], 'boss').penalty > 0);
}

console.log('\n=== weekends, holidays and the holder\'s own leave are not charged ===');
{
  const t = task({ status: S.VERIFIED, history: [at('2026-10-09', S.FOR_REVIEW), at('2026-10-13', S.VERIFIED)] });
  // Fri 9th -> Tue 13th: Sat/Sun free, so Mon+Tue = 2 working days = inside SLA.
  ok('a weekend does not count against the reviewer', stats([t], 'boss').penalty === 0, JSON.stringify(stats([t], 'boss')));
}
{
  const t = task({ status: S.VERIFIED, history: [at('2026-10-05', S.FOR_REVIEW), at('2026-10-12', S.VERIFIED)] });
  const onLeave = { weekend: [0, 6], holidays: [], leave: { boss: [{ from: '2026-10-06', to: '2026-10-09' }] } };
  ok('approved leave is not charged to the person on it', D.responsivenessStats([t], 'boss', today, onLeave).penalty === 0,
     JSON.stringify(D.responsivenessStats([t], 'boss', today, onLeave).breakdown));
  ok('but somebody else\'s leave does not excuse them', stats([t], 'boss').penalty === 6);
}
{
  const t = task({ status: S.VERIFIED, history: [at('2026-10-05', S.FOR_REVIEW), at('2026-10-12', S.VERIFIED)] });
  const hol = { weekend: [0, 6], holidays: ['2026-10-07', '2026-10-08', '2026-10-09'], leave: {} };
  ok('company holidays are not charged either', D.responsivenessStats([t], 'boss', today, hol).penalty === 0);
}
{
  const t = task({ status: S.VERIFIED, history: [at('2026-10-05', S.FOR_REVIEW), at('2026-10-12', S.VERIFIED)] });
  ok('with no calendar the figure is plain calendar days', D.responsivenessStats([t], 'boss', today, null).penalty === 10,
     D.responsivenessStats([t], 'boss', today, null).penalty);
}

console.log('\n=== the damage is capped — one oversight cannot destroy a career ===');
{
  const t = task({ status: S.FOR_REVIEW, history: [at('2026-01-05', S.FOR_REVIEW)] });
  const r = stats([t], 'boss');
  ok('a single item is capped at 10', r.penalty === 10, r.penalty);
  ok('the cap is the published constant', D.MAX_RESPONSIVENESS_PENALTY_PER_ITEM === 10);
}
{
  const many = [1, 2, 3, 4, 5].map((i) => task({ id: 'T' + i, title: 'Item ' + i,
    status: S.FOR_REVIEW, history: [at('2026-01-05', S.FOR_REVIEW)] }));
  const r = stats(many, 'boss');
  ok('five neglected items would be 50, but the total is capped at 20', r.penalty === 20, r.penalty);
  ok('and all five are still itemised, so nothing is hidden', r.breakdown.length === 5);
}

console.log('\n=== every deduction is traceable ===');
{
  const t = task({ title: 'Vendor quote sign-off', status: S.FOR_REVIEW,
                   history: [at('2026-10-05', S.FOR_REVIEW)] });
  const b = stats([t], 'boss').breakdown[0];
  ok('the breakdown names the item', b.item === 'Vendor quote sign-off', b.item);
  ok('states the days held and the SLA expected', /working day\(s\)/.test(b.reason) && /2 expected/.test(b.reason), b.reason);
  ok('and carries the points lost', /^-\d+$/.test(b.impact), b.impact);
  ok('and is grouped so the appraisal can show it apart', b.group === 'Review Responsiveness', b.group);
}

console.log('\n=== the responsiveness percentage ===');
{
  const quick = task({ id: 'A', status: S.VERIFIED, history: [at('2026-10-05', S.FOR_REVIEW), at('2026-10-06', S.VERIFIED)] });
  const slow  = task({ id: 'B', status: S.VERIFIED, history: [at('2026-10-05', S.FOR_REVIEW), at('2026-10-12', S.VERIFIED)] });
  const r = stats([quick, slow], 'boss');
  ok('one of two cleared in time reads 50%', r.responsiveness === 50, r.responsiveness);
  ok('the average held time is reported', r.avgHeldDays === 3, r.avgHeldDays);
  ok('nobody with no queue at all is given a figure', stats([], 'boss').responsiveness === null);
}

console.log('\n=== it reaches the score the company actually reads ===');
{
  const t = task({ status: S.FOR_REVIEW, history: [at('2026-10-05', S.FOR_REVIEW)] });
  const own = task({ id: 'own', title: 'Own work', assignee: 'boss', approver: 'ceo', status: S.VERIFIED, due: '2026-10-05',
                     history: [at('2026-10-05', S.FOR_REVIEW), at('2026-10-05', S.VERIFIED)] });
  const clean = D.delegationScore([own], 'boss', today, CAL);
  const held  = D.delegationScore([own, t], 'boss', today, CAL);
  ok('a manager who delivers but sits on a review scores lower than one who does not',
     held.score < clean.score, clean.score + ' -> ' + held.score);
  ok('the amount lost is stated as a deduction', held.deduction > 0, held.deduction);
  ok('and the item appears in the score breakdown', held.breakdown.some((b) => b.group === 'Review Responsiveness'));
  ok('the responsiveness detail rides along for the UI', !!held.responsiveness && held.responsiveness.items === 1);
}
{
  // A head of department who owns no tasks of their own, with four people stuck.
  const stuck = [1, 2, 3, 4].map((i) => task({ id: 'S' + i, title: 'Stuck ' + i, assignee: 'd' + i,
    approver: 'hod', status: S.AWAITING_APPROVAL, history: [at('2026-10-05', S.AWAITING_APPROVAL)] }));
  const r = D.delegationScore(stuck, 'hod', today, CAL);
  ok('a manager with no tasks of their own is still scored', r.hasData === true);
  ok('and scored on how promptly they clear the queue', r.score === 0, r.score);
  ok('the note explains the basis', /clear/.test(r.note || ''), r.note);
  const promptly = (n) => Array.from({ length: n }, (_, i) => task({ id: 'G' + i, title: 'Cleared ' + i,
    assignee: 'd' + i, approver: 'hod', status: S.VERIFIED,
    history: [at('2026-10-05', S.AWAITING_APPROVAL), at('2026-10-06', S.VERIFIED)] }));
  /* Clearing everything promptly is a perfect RATE. The score it earns still
     depends on how much came through — four decisions in a month is a light
     desk, and the engine says so rather than awarding full marks for it. */
  ok('clearing everything promptly is a perfect rate',
     D.delegationScore(promptly(4), 'hod', today, CAL).responsiveness.responsiveness === 100);
  ok('but four decisions is a light month, and scores like one',
     D.delegationScore(promptly(4), 'hod', today, CAL).score < 100);
  ok('a manager who clears a full desk promptly scores 100',
     D.delegationScore(promptly(10), 'hod', today, CAL).score === 100,
     D.delegationScore(promptly(10), 'hod', today, CAL).score);
}
{
  const t = task({ status: S.FOR_REVIEW, history: [at('2026-01-05', S.FOR_REVIEW)] });
  const own = task({ id: 'own', title: 'Own work', assignee: 'boss', approver: 'ceo', status: S.VERIFIED, due: '2026-10-05',
                     history: [at('2026-10-05', S.FOR_REVIEW), at('2026-10-05', S.VERIFIED)] });
  ok('the deduction never takes a score below zero',
     D.delegationScore([own, t], 'boss', today, CAL).score >= 0);
}

console.log('\n=== the doer is not punished for the manager\'s delay ===');
{
  // Handed in on the due date, verified a fortnight later.
  const t = task({ assignee: 'doer', due: '2026-10-05', status: S.VERIFIED,
                   history: [at('2026-10-05', S.FOR_REVIEW), at('2026-10-19', S.VERIFIED)] });
  const r = D.delegationScore([t], 'doer', today, CAL);
  /* Measured on the rate, not the score: the score also reflects how much they
     carried, and one task is one task. What matters here is that their
     delivery was judged clean. */
  ok('the doer is still judged to have delivered on time', r.rate === 100, r.rate);
  ok('and carries no responsiveness deduction', r.deduction === 0);
  // The reviewer owns no work of their own here, so they are scored purely on
  // the queue: a fortnight's delay reads as zero responsiveness.
  ok('while the reviewer carries it instead', D.delegationScore([t], 'boss', today, CAL).score === 0,
     D.delegationScore([t], 'boss', today, CAL).score);
}

console.log('\n' + (fail ? 'FAILED ' : 'ALL PASS ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
