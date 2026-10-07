/**
 * Scoring a stage deadline. The promise under test: meeting one gains score,
 * missing one costs it, and nobody wears a slip that somebody upstream caused.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const D = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'domebox', 'domain.gs'), 'utf8'), D);

let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 170) + ']')); v ? pass++ : fail++; };

const S = D.STATUS;
const today = new Date('2026-11-30T10:00:00');
const hist = (ymd, st) => ({ date: new Date(ymd + 'T10:00:00'), status: st });

/** One stage. `submitted` is when it was handed in; `verified` when signed off. */
const st = (o) => Object.assign({
  id: 'S' + (o.stageNo || 1), title: 'Stage ' + (o.stageNo || 1),
  projectId: 'P1', projectName: 'Fixture line upgrade', stageGate: 'sequential',
  stageCount: 3, priority: 'Medium', reworkCount: 0, raisedBy: 'boss', approver: 'boss',
  status: S.VERIFIED, history: [],
}, o);

/** Builds a verified stage handed in on `sub` and signed off on `ver`. */
const done = (no, assignee, due, sub, ver) => st({ stageNo: no, assignee, due,
  status: S.VERIFIED, history: [hist(sub, S.FOR_REVIEW), hist(ver || sub, S.VERIFIED)] });

console.log('\n=== meeting a stage deadline gains score ===');
{
  const t = [done(1, 'payel', '2026-11-05', '2026-11-04', '2026-11-05')];
  const m = D.milestoneStats(t, 'payel', today, null);
  ok('the stage is counted', m.hasData && m.stages === 1);
  ok('it is recorded as met', m.met === 1 && m.missed === 0);
  ok('the milestone score is full marks', m.score === 100, m.score);
  ok('and the gain is itemised, not only the failures',
     m.breakdown.length === 1 && String(m.breakdown[0].impact).charAt(0) === '+', JSON.stringify(m.breakdown[0]));
  ok('naming the project and the stage',
     /Fixture line upgrade · stage 1/.test(m.breakdown[0].item), m.breakdown[0].item);
  ok('a high-priority stage is worth more than a low one',
     D.milestoneStats([done(1, 'p', '2026-11-05', '2026-11-04')].map((x) => Object.assign(x, { priority: 'High' })), 'p', today, null)
       .breakdown[0].impact === '+30');
}

console.log('\n=== missing one costs score, and says by how much ===');
{
  const t = [done(1, 'payel', '2026-11-05', '2026-11-08', '2026-11-09')];
  const m = D.milestoneStats(t, 'payel', today, null);
  ok('it is recorded as missed', m.missed === 1 && m.met === 0);
  ok('the score drops by the days late', m.score === 70, m.score);
  ok('and the row says how late', /missed by 3 day/.test(m.breakdown[0].reason), m.breakdown[0].reason);
  ok('the hit rate is reported', m.hitRate === 0);
}
{
  const t = [done(1, 'p', '2026-11-05', '2026-11-04'), done(2, 'p', '2026-11-20', '2026-11-25', '2026-11-25')];
  // Stage 2's clock starts when stage 1 closed (4 Nov), which is before its own
  // deadline, so the original date stands.
  const m = D.milestoneStats(t, 'p', today, null);
  ok('met and missed are counted side by side', m.met === 1 && m.missed === 1);
  ok('the hit rate is the share met', m.hitRate === 50, m.hitRate);
}

console.log('\n=== nobody wears somebody else\'s slip ===');
{
  // Stage 1 was due 5 Nov and only signed off on 25 Nov. Stage 2 was due 20 Nov
  // — a date it could not possibly have met, because the work did not exist.
  const t = [done(1, 'payel', '2026-11-05', '2026-11-24', '2026-11-25'),
             done(2, 'vikram', '2026-11-20', '2026-11-27', '2026-11-27')];
  const m = D.milestoneStats(t, 'vikram', today, null);
  ok('the second owner is not marked down for the first one\'s delay', m.met === 1 && m.missed === 0, JSON.stringify(m.items));
  ok('and the row says the date was moved out',
     /deadline moved out/.test(m.breakdown[0].reason), m.breakdown[0].reason);
  ok('while the person who actually slipped still carries it',
     D.milestoneStats(t, 'payel', today, null).missed === 1);
}
{
  /* Released 25 Nov with a 15-day planned window, so they owe it by 10 Dec.
     Handed in on the 15th: five days of their own, and still charged. */
  const t = [done(1, 'payel', '2026-11-05', '2026-11-24', '2026-11-25'),
             done(2, 'vikram', '2026-11-20', '2026-12-15', '2026-12-15')];
  const m = D.milestoneStats(t, 'vikram', new Date('2026-12-20T10:00:00'), null);
  ok('but delay of their own after the release is still charged', m.missed === 1, JSON.stringify(m.items));
  ok('counted against the window the plan gave them', m.items[0].daysLate === 5, m.items[0].daysLate);
}
{
  // On a parallel project nothing is waiting on anything, so no date moves.
  const t = [st({ stageNo: 1, assignee: 'p', due: '2026-11-05', stageGate: 'parallel',
                  history: [hist('2026-11-10', S.FOR_REVIEW), hist('2026-11-10', S.VERIFIED)] })];
  ok('a parallel stage is measured against its own date', D.milestoneStats(t, 'p', today, null).missed === 1);
}

console.log('\n=== weekends and approved leave are not charged here either ===');
{
  const cal = { weekend: [0, 6], holidays: [], leave: { payel: [{ from: '2026-11-06', to: '2026-11-10' }] } };
  const t = [done(1, 'payel', '2026-11-05', '2026-11-10', '2026-11-10')];
  ok('leave does not turn a met deadline into a missed one',
     D.milestoneStats(t, 'payel', today, cal).met === 1,
     JSON.stringify(D.milestoneStats(t, 'payel', today, cal).items));
  ok('and without a calendar it is plain days', D.milestoneStats(t, 'payel', today, null).missed === 1);
}

console.log('\n=== open stages are watched but not yet scored ===');
{
  const t = [st({ stageNo: 1, assignee: 'p', due: '2026-11-05', status: S.IN_PROGRESS, history: [] })];
  const m = D.milestoneStats(t, 'p', today, null);
  ok('an unfinished stage is not counted as a miss', m.missed === 0 && m.met === 0);
  ok('it is reported as still open', m.pending === 1);
  ok('and flagged as past its date', m.atRisk === 1);
  ok('with no score until something closes', m.hasData === false && m.score === null);
}

console.log('\n=== it moves the score the company reads ===');
{
  const met = [done(1, 'p', '2026-11-05', '2026-11-04'), done(2, 'p', '2026-11-20', '2026-11-19')];
  const slipped = [done(1, 'p', '2026-11-05', '2026-11-12'), done(2, 'p', '2026-11-20', '2026-11-27', '2026-11-27')];
  const a = D.delegationScore(met, 'p', today, null);
  const b = D.delegationScore(slipped, 'p', today, null);
  ok('hitting every stage scores higher than missing them', a.score > b.score, a.score + ' vs ' + b.score);
  ok('Project Milestones appears as its own component',
     a.components.some((c) => c.key === 'milestones'), JSON.stringify(a.components.map((c) => c.key)));
  ok('with the count stated', /2 of 2 stage deadlines met/.test(
     a.components.find((c) => c.key === 'milestones').basis));
  ok('the detail rides along for the UI', a.milestones && a.milestones.met === 2);
  ok('and the summary carries the counts', a.summary.stagesMet === 2 && a.summary.stagesMissed === 0);
  ok('somebody with no project work has no milestone component',
     !D.delegationScore([{ id: 'x', title: 'Plain task', assignee: 'p', due: '2026-11-05',
        status: S.VERIFIED, priority: 'Medium', raisedBy: 'b', approver: 'b',
        history: [hist('2026-11-04', S.FOR_REVIEW), hist('2026-11-04', S.VERIFIED)] }], 'p', today, null)
       .components.some((c) => c.key === 'milestones'));
  /* More stages IS more work, and the load credit counts it — but only up to a
     full load. So cutting a job into more pieces can never carry anybody past
     a complete score, which is the bound that matters. */
  const sliced = [];
  for (let i = 1; i <= 12; i++) sliced.push(done(i, 'p', '2026-11-05', '2026-11-04'));
  ok('slicing work into more stages cannot take anybody past 100',
     D.delegationScore(sliced, 'p', today, null).score === 100);
  ok('and the load credit it earns is capped at a full load',
     D.delegationScore(sliced, 'p', today, null).workload.credit === 1);
}

console.log('\n=== the project rollup ===');
{
  const t = [done(1, 'payel', '2026-11-05', '2026-11-04'),
             st({ stageNo: 2, assignee: 'vikram', due: '2026-11-20', status: S.IN_PROGRESS }),
             st({ stageNo: 3, assignee: 'neha', due: '2026-11-30', status: S.PENDING })];
  const s = D.projectSummary(t, 'P1');
  ok('it knows how far along the project is', s.done === 1 && s.stages === 3 && s.percent === 33);
  ok('and who is on the hook right now', s.currentStage === 2 && s.currentOwner === 'vikram');
  ok('it counts the stage deadlines met so far', s.metOnTime === 1);
  ok('it carries the final date', s.finalDue === '2026-11-30');
  ok('and is not complete yet', s.complete === false);
}

console.log('\n' + (fail ? 'FAILED ' : 'ALL PASS ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
