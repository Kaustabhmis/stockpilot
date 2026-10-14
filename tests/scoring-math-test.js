/**
 * The score, worked by hand.
 *
 * Every case below was calculated on paper first, from the rules the manual
 * and "See why" promise, and the engine has to land on exactly that number.
 * Dates are fixed and chosen on known weekdays, so the suite gives the same
 * answer whatever day it runs.
 *
 *   On time 45% · First-time right 30% · Nothing left late 25%
 *   (35 / 25 / 20 / 20 when there are project stages)
 *   a working day late = -10 on that task · a rework loop = -25 on that task
 *   each task weighted by priority (Critical 4, High 3, Medium 2, Low 1)
 *   rate × workload credit (capped at 1) − approval penalty + cookies (max 10)
 *   clamped to 0..100
 */
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 300) + ']')); v ? pass++ : fail++; };
const near = (a, b) => Math.abs(a - b) < 1e-9;

const SRC = fs.readFileSync(__dirname + '/../domebox/domain.gs', 'utf8');
const D = new Function(SRC + '\n;return { delegationScore, scoreForPeriod, periodRange, periodAnalytics, leaderboard,' +
  ' workloadCredit, cookieBonus, responsivenessStats, milestoneStats, queueSpells, finalAppraisalScore,' +
  ' performanceBand, chargeableLateDays, timelinessPoints, stageEffectiveDue, projectStages, PERIOD };')();

const CAL = { weekend: [0, 6], holidays: [], leave: {} };
const at = (d, h) => d + 'T' + String(h || 10).padStart(2, '0') + ':00:00';
let n = 0;
/** A task that went To do → In progress → For review (on `sub`) → Verified (on `ver`). */
const done = (o) => {
  const h = [{ status: 'Pending', date: at(o.created || '2026-09-01', 9) },
             { status: 'In Progress', date: at(o.created || '2026-09-01', 11) }];
  for (let i = 0; i < (o.rework || 0); i++) {
    h.push({ status: 'For Review', date: at(o.created || '2026-09-01', 12) });
    h.push({ status: 'In Progress', date: at(o.created || '2026-09-01', 13) });
  }
  h.push({ status: 'For Review', date: at(o.sub, 15) });
  h.push({ status: 'Verified', date: at(o.ver || o.sub, 17) });
  return Object.assign({ id: 'T' + (++n), title: o.title || 'Task ' + n, assignee: o.who || 'asha',
    raisedBy: o.by || 'boss', approver: '', status: 'Verified', priority: o.p || 'Medium',
    due: o.due, reworkCount: o.rework || 0, history: h }, o.extra || {});
};
const comp = (s, k) => (s.components.find((c) => c.key === k) || {}).score;
const TODAY = new Date('2026-09-30T18:00:00');

console.log('\n=== the three parts, by hand ===');
{
  /* Three Medium jobs. Due Wed 9 Sep.
       A: handed in Tue 8 Sep            → on time 100, first-time 100
       B: handed in Fri 11 Sep (2 late)  → on time 80,  first-time 100
       C: on time, sent back once        → on time 100, first-time 75
     On time   = (100+80+100)/3 = 93.333
     First-time= (100+100+75)/3 = 91.667
     No open work, so the 25% drops out and 45/30 become 60/40:
     rate = 93.333×0.6 + 91.667×0.4 = 92.667
     Load: 3 Medium = 6 of an expected 5×2 = 10 → 60% → 92.667×0.6 = 55.6 → 56 */
  const t = [done({ due: '2026-09-09', sub: '2026-09-08' }),
             done({ due: '2026-09-09', sub: '2026-09-11' }),
             done({ due: '2026-09-09', sub: '2026-09-09', rework: 1 })];
  const s = D.delegationScore(t, 'asha', TODAY, CAL, { expectedTasks: 5 });
  ok('on time = 93', comp(s, 'onTime') === 93, comp(s, 'onTime'));
  ok('first-time right = 92', comp(s, 'quality') === 92, comp(s, 'quality'));
  ok('with nothing open, the weights renormalise to 60 / 40', comp(s, 'queue') === null &&
     s.components.find((c) => c.key === 'onTime').weight === 60 && s.components.find((c) => c.key === 'quality').weight === 40);
  ok('the rate is 92.667 → 93', s.rate === 93, s.rate);
  ok('workload: 6 of 10 = 60%', s.workload.percent === 60 && s.workload.expected === 10, JSON.stringify(s.workload));
  ok('score = 92.667 × 0.6 = 55.6 → 56', s.score === 56, s.score);
  ok('60% is not provisional (the line is 40%)', s.provisional === false);
}

console.log('\n=== what lateness costs ===');
ok('on the day = 100', D.timelinessPoints(0) === 100);
ok('1 day late = 90, 5 days = 50, 10 or more = 0',
   D.timelinessPoints(1) === 90 && D.timelinessPoints(5) === 50 && D.timelinessPoints(10) === 0 && D.timelinessPoints(14) === 0);
ok('due Friday, handed in Monday = 1 working day late (the weekend is free)',
   D.chargeableLateDays(new Date('2026-09-11'), new Date('2026-09-14T10:00'), 'asha', CAL) === 1);
ok('approved leave is free too: due Fri, leave Mon–Tue, in on Wed = 1 day',
   D.chargeableLateDays(new Date('2026-09-11'), new Date('2026-09-16T10:00'), 'asha',
     { weekend: [0, 6], holidays: [], leave: { asha: [{ from: '2026-09-14', to: '2026-09-15' }] } }) === 1);
{
  const slowCheck = done({ due: '2026-09-09', sub: '2026-09-09', ver: '2026-09-25' });
  const s = D.delegationScore([slowCheck], 'asha', TODAY, CAL, { expectedTasks: 5 });
  ok('a slow checker costs the doer nothing: handed in on the day, verified 12 days later = 100 on time',
     comp(s, 'onTime') === 100, comp(s, 'onTime'));
}
{
  const s = D.delegationScore([done({ due: '2026-09-09', sub: '2026-09-09', rework: 2 })], 'asha', TODAY, CAL, {});
  ok('two rework loops = 100 − 2×25 = 50 on first-time right', comp(s, 'quality') === 50, comp(s, 'quality'));
}

console.log('\n=== priority weighting ===');
{
  /* Critical (×4) 5 working days late = 50; Low (×1) on time = 100.
     On time = (50×4 + 100×1) / 5 = 60. */
  const s = D.delegationScore([
    done({ p: 'Critical', due: '2026-09-07', sub: '2026-09-14' }),
    done({ p: 'Low', due: '2026-09-07', sub: '2026-09-07' })], 'asha', TODAY, CAL, {});
  ok('Critical 5 days late + Low on time = (50×4 + 100) / 5 = 60', comp(s, 'onTime') === 60, comp(s, 'onTime'));
}

console.log('\n=== nothing left late (queue health) ===');
{
  /* Open on 30 Sep (Wed): X due Fri 25 Sep = 3 working days late → 70.
     Y due 2 Oct → 100.  Z handed in (For Review) and overdue → not counted.
     Queue = (70+100)/2 = 85. */
  const open = (id, due, status) => ({ id, title: id, assignee: 'asha', raisedBy: 'boss', status, priority: 'Medium', due,
    reworkCount: 0, history: [{ status: 'Pending', date: at('2026-09-01') }] });
  const s = D.delegationScore([open('X', '2026-09-25', 'In Progress'), open('Y', '2026-10-02', 'Pending'),
    open('Z', '2026-09-20', 'For Review')], 'asha', TODAY, CAL, {});
  ok('queue = (70 + 100) / 2 = 85 — work already handed in is left out', comp(s, 'queue') === 85, comp(s, 'queue'));
}

console.log('\n=== workload credit ===');
ok('expected load = WIP limit × the Medium weight', D.workloadCredit(10, 5).expected === 10);
ok('carrying double is a full load, not 200%', D.workloadCredit(20, 5).credit === 1);
ok('a week is measured against a week’s share of a month', near(D.workloadCredit(2.3, 5, 7 * 12 / 365.25).credit, Math.min(1, 2.3 / (10 * 7 * 12 / 365.25))));
{
  const ten = [];
  for (let i = 0; i < 7; i++) ten.push(done({ due: '2026-09-09', sub: '2026-09-09' }));
  for (let i = 0; i < 3; i++) ten.push(done({ due: '2026-09-09', sub: '2026-09-16' }));   // 5 days late → 50
  const big = D.delegationScore(ten, 'asha', TODAY, CAL, { expectedTasks: 5 });
  const one = D.delegationScore([done({ p: 'Low', due: '2026-09-09', sub: '2026-09-09', who: 'ben' })], 'ben', TODAY, CAL, { expectedTasks: 5 });
  /* Ten: on time = (7×100 + 3×50)/10 = 85, first-time 100 → rate 0.6×85 + 0.4×100 = 91, full load → 91.
     One Low on time: rate 100, load 1 of 10 → 10. */
  ok('ten jobs, seven on time = 91', big.score === 91, big.score);
  ok('one easy job done perfectly = 10, and provisional', one.score === 10 && one.provisional, one.score);
}

console.log('\n=== cookies and the clamp ===');
ok('cookie points cap at 10 however many are given', D.cookieBonus([{ points: 5 }, { points: 5 }, { points: 5 }]).bonus === 10);
ok('one award cannot be worth more than 5', D.cookieBonus([{ points: 9 }]).bonus === 5);
{
  const tenOnTime = [];
  for (let i = 0; i < 10; i++) tenOnTime.push(done({ due: '2026-09-09', sub: '2026-09-09' }));
  const s = D.delegationScore(tenOnTime, 'asha', TODAY, CAL, { expectedTasks: 5, cookies: [{ points: 5 }, { points: 5 }] });
  ok('100 + 10 cookies is still 100', s.score === 100, s.score);
}

console.log('\n=== approvals: the manager’s side ===');
{
  /* Handed in Mon 7 Sep, checked Mon 14 Sep = 5 working days held; SLA 2 → 3 over → −6. */
  const t = done({ who: 'asha', by: 'boss', due: '2026-09-07', sub: '2026-09-07', ver: '2026-09-14' });
  const r = D.responsivenessStats([t], 'boss', TODAY, CAL, {});
  ok('held 5 working days, 2 allowed → 3 × 2 = 6 points', r.penalty === 6 && r.items === 1, JSON.stringify(r).slice(0, 200));
  const many = [];
  for (let i = 0; i < 5; i++) many.push(done({ by: 'boss', due: '2026-09-01', sub: '2026-09-01', ver: '2026-09-29' }));
  const r2 = D.responsivenessStats(many, 'boss', TODAY, CAL, {});
  ok('one item costs at most 10, the total at most 20', r2.penalty === 20 &&
     r2.breakdown.every((b) => b.impact === '-10'), r2.penalty);
}
{
  const self = done({ who: 'asha', by: 'asha', due: '2026-09-07', sub: '2026-09-07', ver: '2026-09-25' });
  const r = D.responsivenessStats([self], 'asha', TODAY, CAL, {});
  ok('work you raised for yourself never makes you its reviewer', r.items === 0 && r.penalty === 0, JSON.stringify(r).slice(0, 160));
}
{
  /* A manager with no tasks of their own: 4 reviews, 2 cleared inside the SLA.
     Responsiveness 50%; load = 4 decisions of an expected 10 = 40% → 50 × 0.4 = 20. */
  const quick = [1, 2].map(() => done({ by: 'boss', due: '2026-09-08', sub: '2026-09-08', ver: '2026-09-09' }));
  const slow = [1, 2].map(() => done({ by: 'boss', due: '2026-09-08', sub: '2026-09-08', ver: '2026-09-18' }));
  const s = D.delegationScore(quick.concat(slow), 'boss', TODAY, CAL, { expectedTasks: 5 });
  ok('a manager with no tasks of their own: 50% within SLA × 40% load = 20', s.score === 20, s.score + ' ' + s.note);
}

console.log('\n=== project stages: never late for somebody else’s delay ===');
{
  /* Stage 1 (Nita) due Fri 4 Sep, verified Tue 8 Sep — 2 working days late.
     Stage 2 (Asha) due Wed 9 Sep: planned 5 days after stage 1's date, so it is
     answerable 5 days after its release on 8 Sep = Sun 13 Sep.
     Asha hands in Fri 11 Sep: on time, in BOTH the on-time and milestone parts. */
  const s1 = done({ who: 'nita', due: '2026-09-04', sub: '2026-09-08', extra: { projectId: 'P1', stageNo: 1, projectName: 'Audit' } });
  const s2 = done({ who: 'asha', due: '2026-09-09', sub: '2026-09-11', created: '2026-09-08',
    extra: { projectId: 'P1', stageNo: 2, projectName: 'Audit' } });
  const eff = D.stageEffectiveDue(D.projectStages([s1, s2], 'P1'), s2);
  ok('stage 2’s deadline moves to 13 Sep', eff && eff.getDate() === 13, eff);
  const all = D.delegationScore([s1, s2], 'asha', TODAY, CAL, {});
  ok('on-time part: 100 for stage 2', comp(all, 'onTime') === 100, comp(all, 'onTime'));
  ok('milestone part: 100 for stage 2', comp(all, 'milestones') === 100, comp(all, 'milestones'));
  const sep = D.scoreForPeriod([s1, s2], 'asha', D.periodRange('month', 0, new Date('2026-09-15')), CAL, {});
  ok('the same inside a monthly score, where stage 1 is not Asha’s task',
     comp(sep, 'onTime') === 100 && comp(sep, 'milestones') === 100,
     JSON.stringify(sep.components));
  ok('the milestone line in See why shows what it scored, not a made-up bonus',
     all.breakdown.filter((b) => b.group === 'Project Milestones').every((b) => /^\d+\/100$/.test(b.impact)),
     JSON.stringify(all.breakdown.filter((b) => b.group === 'Project Milestones')));
}

console.log('\n=== a period counts what happened in that period ===');
const SEP = D.periodRange('month', 0, new Date('2026-09-15'));
const AUG = D.periodRange('month', 0, new Date('2026-08-15'));
ok('(September is 1–30 Sep)', SEP.from.getDate() === 1 && SEP.to.getDate() === 30 && SEP.to.getMonth() === 8);
{
  const t = [done({ due: '2026-09-09', sub: '2026-09-09' })];
  const cookies = [{ points: 4, date: '2026-09-20' }, { points: 5, date: '2026-10-02' }];
  const s = D.scoreForPeriod(t, 'asha', SEP, CAL, { expectedTasks: 5, cookies });
  ok('cookies count in the month they were given: September gets its 4, not October’s 5',
     s.cookies.awarded === 4, s.cookies.awarded);
}
{
  /* Boss held a review 7 working days in August (cleared 12 Aug). It counts in August, once. */
  const aug = done({ who: 'asha', by: 'boss', due: '2026-08-03', sub: '2026-08-03', ver: '2026-08-12' });
  const sepWork = done({ who: 'boss', by: 'ceo', due: '2026-09-09', sub: '2026-09-09' });
  const a = D.scoreForPeriod([aug, sepWork], 'boss', AUG, CAL, {});
  const s = D.scoreForPeriod([aug, sepWork], 'boss', SEP, CAL, {});
  ok('a slow August review costs August', a.responsiveness.penalty > 0, a.responsiveness.penalty);
  ok('and is not charged again in September', s.responsiveness.penalty === 0 && s.deduction === 0, s.responsiveness.penalty);
}
{
  /* Handed in 25 Sep (overdue since 18 Sep), verified 5 Oct. At the end of
     September it was with the reviewer, not with Asha. */
  const t = done({ due: '2026-09-18', sub: '2026-09-25', ver: '2026-10-05' });
  const other = done({ due: '2026-09-09', sub: '2026-09-09' });
  const s = D.scoreForPeriod([t, other], 'asha', SEP, CAL, {});
  ok('work sitting with the reviewer at month end is not counted as late in that month',
     comp(s, 'queue') === null && s.openThen === 0, JSON.stringify(s.components) + ' openThen=' + s.openThen);
  const stillOpen = Object.assign({}, t, { id: 'T-open', status: 'In Progress',
    history: [{ status: 'Pending', date: at('2026-09-01') }, { status: 'In Progress', date: at('2026-09-02') }] });
  const s2 = D.scoreForPeriod([stillOpen, other], 'asha', SEP, CAL, {});
  /* Due 18 Sep, still in progress on 30 Sep = 8 working days late → 20. */
  ok('work still in hand at month end is: 8 working days late = 20', comp(s2, 'queue') === 20, comp(s2, 'queue'));
}
{
  /* A week with two Medium jobs on time, WIP 5: expected 5 × 2 × (7×12/365.25) = 2.3;
     delivered 4 → a full load → 100. Measured against a whole month it was 40. */
  const wk = D.periodRange('week', 0, new Date('2026-09-09'));
  const t = [done({ due: '2026-09-09', sub: '2026-09-08' }), done({ due: '2026-09-10', sub: '2026-09-10' })];
  const s = D.scoreForPeriod(t, 'asha', wk, CAL, { expectedTasks: 5 });
  ok('a good week scores 100, not 40', s.score === 100 && s.workload.full, s.score + ' ' + JSON.stringify(s.workload));
  const q = D.periodRange('quarter', 0, new Date('2026-09-09'));
  const sq = D.scoreForPeriod(t, 'asha', q, CAL, { expectedTasks: 5 });
  ok('the same two jobs over a quarter are 4 of 30 = 13% of the load', sq.workload.percent === 13, JSON.stringify(sq.workload));
}

console.log('\n=== the appraisal ===');
{
  /* KRAs: 4/5 at weight 60 and 3/5 at weight 40 → (240+120)/500 = 72% → 0.72 × 75 = 54
     Behaviour all 5/5 → 20.  Brownie 3.  Performance = 77.
     Delegation 81.  Final = (77 + 81) / 2 = 79. */
  const f = D.finalAppraisalScore({ delegationScore: 81, kras: [{ rating: 4, weight: 60 }, { rating: 3, weight: 40 }],
    behaviours: [{ rating: 5, weight: 1 }, { rating: 5, weight: 2 }], brownie: 3 });
  ok('KRA 72% → 54 of 75', f.parts.kra.percent === 72 && f.parts.kra.points === 54, JSON.stringify(f.parts.kra));
  ok('performance = 54 + 20 + 3 = 77', f.performance === 77, f.performance);
  ok('final = (77 + 81) / 2 = 79', f.score === 79, f.score);
  const nj = D.finalAppraisalScore({ delegationScore: null, kras: [{ rating: 4, weight: 1 }], behaviours: [], brownie: 0 });
  ok('a new joiner with no closed work: final = performance alone (4/5 → 60)', nj.score === 60 && nj.delegation === null, nj.score);
  const capped = D.finalAppraisalScore({ delegationScore: 50, kras: [{ rating: 5, weight: 1 }], behaviours: [{ rating: 5, weight: 1 }], brownie: 9 });
  ok('brownie points cap at 5 and performance at 100', capped.brownie === 5 && capped.performance === 100, capped.performance);
}

console.log('\n=== bands and ranking ===');
ok('85 = A, 84 = B, 60 = B, 59 = C', D.performanceBand(85).band === 'A' && D.performanceBand(84).band === 'B' &&
   D.performanceBand(60).band === 'B' && D.performanceBand(59).band === 'C');
{
  const lb = D.leaderboard([
    { username: 'a', name: 'A', score: 90, hasData: true, delivered: 5 },
    { username: 'b', name: 'B', score: 90, hasData: true, delivered: 5 },
    { username: 'c', name: 'C', score: 80, hasData: true, delivered: 9 },
    { username: 'd', name: 'D', score: null, hasData: false }]);
  ok('equal scores share a rank and the next is skipped: 1, 1, 3', lb.rows.map((r) => r.rank).join(',') === '1,1,3',
     lb.rows.map((r) => r.rank).join(','));
  ok('nobody is ranked on nothing', lb.unranked.length === 1 && lb.unranked[0].username === 'd');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
