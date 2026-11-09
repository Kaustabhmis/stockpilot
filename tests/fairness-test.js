/**
 * The question this file exists to answer:
 *
 *   "Someone has 10 jobs and completed 7 on time. Someone else has a single
 *    simple job and completed it. Why does the simple-job doer score higher?"
 *
 * They no longer do. A rate is credited against the load it was earned on.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const D = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'domebox', 'domain.gs'), 'utf8'), D);

let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 170) + ']')); v ? pass++ : fail++; };

const S = D.STATUS;
const today = new Date('2026-11-30T10:00:00');
const h = (d, st) => ({ date: new Date(d + 'T10:00:00'), status: st });
const closed = (id, due, sub, pri) => ({ id, title: 'Task ' + id, assignee: 'p', due,
  priority: pri || 'Medium', status: S.VERIFIED, reworkCount: 0, raisedBy: 'b', approver: 'b',
  history: [h(sub, S.FOR_REVIEW), h(sub, S.VERIFIED)] });
const open = (id, pri) => ({ id, title: 'Open ' + id, assignee: 'p', due: '2026-12-20',
  priority: pri || 'Medium', status: S.IN_PROGRESS, reworkCount: 0, raisedBy: 'b', approver: 'b', history: [] });
const score = (tasks, opts) => D.delegationScore(tasks, 'p', today, null, opts).score;

console.log('\n=== the inversion is gone ===');
{
  const simple = [closed('a', '2026-11-05', '2026-11-04', 'Low')];
  const grafter = [];
  for (let i = 0; i < 10; i++) grafter.push(closed('g' + i, '2026-11-05', i < 7 ? '2026-11-04' : '2026-11-09', 'High'));
  ok('ten hard jobs with seven on time beats one easy job done',
     score(grafter) > score(simple), score(grafter) + ' vs ' + score(simple));
  ok('and the grafter is scored well, not merely higher', score(grafter) >= 80, score(grafter));
  ok('the one-task score is openly provisional, not a verdict',
     D.delegationScore(simple, 'p', today, null).provisional === true);
}
{
  // Same rate, different load: more work must score higher.
  const few = [closed('a', '2026-11-05', '2026-11-04'), closed('b', '2026-11-05', '2026-11-04')];
  const many = [];
  for (let i = 0; i < 6; i++) many.push(closed('m' + i, '2026-11-05', '2026-11-04'));
  ok('at an identical 100% on-time rate, the busier person scores higher',
     score(many) > score(few), score(many) + ' vs ' + score(few));
  ok('and a full load takes the rate at face value', score(many) === 100, score(many));
}
{
  const light = [closed('a', '2026-11-05', '2026-11-04')];
  ok('work in hand counts, so a long job in progress is not read as idleness',
     score([light[0], open('x', 'High'), open('y', 'High')]) > score(light));
}
{
  const d = D.delegationScore([closed('a', '2026-11-05', '2026-11-04')], 'p', today, null);
  ok('the formula says plainly what happened',
     /how well you delivered \(100\) × the load you carried \(\d+%\)/.test(d.formula), d.formula);
  ok('and the load appears in the breakdown with the reason',
     d.breakdown.some((b) => b.group === 'Workload Credit' && /count for \d+% of their value/.test(b.reason)),
     JSON.stringify(d.breakdown.find((b) => b.group === 'Workload Credit')));
}

console.log('\n=== priority still counts, so hard work is not just more work ===');
{
  const threeLow = [closed('a', '2026-11-05', '2026-11-04', 'Low'),
                    closed('b', '2026-11-05', '2026-11-04', 'Low'),
                    closed('c', '2026-11-05', '2026-11-04', 'Low')];
  const oneHigh = [closed('x', '2026-11-05', '2026-11-04', 'High')];
  ok('one High job carries the load of three Low ones',
     score(oneHigh) === score(threeLow), score(oneHigh) + ' vs ' + score(threeLow));
}

console.log('\n=== the expectation is per person ===');
{
  const one = [closed('a', '2026-11-05', '2026-11-04')];
  ok('a part-time role measured against its own bar is not punished for volume',
     score(one, { expectedTasks: 1 }) > score(one, { expectedTasks: 10 }));
  ok('and carrying more than expected does not push past 100',
     score([closed('a', '2026-11-05', '2026-11-04'), closed('b', '2026-11-05', '2026-11-04')],
           { expectedTasks: 1 }) === 100);
}

console.log('\n=== nobody starts above zero, nobody ends above a hundred ===');
{
  ok('a person with no record at all scores zero', D.delegationScore([], 'p', today, null).score === 0);
  ok('and is marked as having no data, not as a nought',
     D.delegationScore([], 'p', today, null).hasData === false);
  const perfect = [];
  for (let i = 0; i < 20; i++) perfect.push(closed('p' + i, '2026-11-05', '2026-11-01', 'High'));
  ok('a flawless record tops out at exactly 100', score(perfect) === 100, score(perfect));
  ok('and cookie points cannot take it past 100',
     score(perfect, { cookies: [{ points: 5 }, { points: 5 }, { points: 5 }] }) === 100);
  // Everything a month late and sent back four times each.
  const awful = [];
  for (let i = 0; i < 10; i++) awful.push(Object.assign(
    closed('w' + i, '2026-11-01', '2026-11-30', 'High'), { reworkCount: 4 }));
  ok('the worst possible record floors at zero, never below', score(awful) === 0, score(awful));
  ok('late but right is not a zero — quality is still worth something',
     score([closed('x', '2026-11-01', '2026-11-30'), closed('y', '2026-11-01', '2026-11-30'),
            closed('z', '2026-11-01', '2026-11-30'), closed('w', '2026-11-01', '2026-11-30'),
            closed('v', '2026-11-01', '2026-11-30')]) > 0);
}

console.log('\n=== cookie points ===');
{
  const base = [];
  for (let i = 0; i < 5; i++) base.push(closed('c' + i, '2026-11-05', '2026-11-09'));   // 4 days late
  const plain = score(base);
  ok('a cookie point lifts the score', score(base, { cookies: [{ points: 3 }] }) === plain + 3,
     plain + ' -> ' + score(base, { cookies: [{ points: 3 }] }));
  ok('the lift is capped, so cookies are not a back door',
     score(base, { cookies: [{ points: 5 }, { points: 5 }, { points: 5 }, { points: 5 }] }) === plain + 10);
  const d = D.delegationScore(base, 'p', today, null,
    { cookies: [{ points: 3, reason: 'Stayed back to clear the audit list', byName: 'Rohan Mehta', date: '2026-11-12' }] });
  ok('each award is itemised with its reason', d.breakdown.some((b) =>
     b.group === 'Cookie Points' && b.item === 'Stayed back to clear the audit list'),
     JSON.stringify(d.breakdown.filter((b) => b.group === 'Cookie Points')));
  ok('and names who gave it', /Awarded by Rohan Mehta/.test(
     (d.breakdown.find((b) => b.group === 'Cookie Points') || {}).reason || ''));
  ok('a single award is itself capped at 5',
     D.cookieBonus([{ points: 99 }]).bonus === 5);
  ok('the cap is reported so it can be explained',
     D.cookieBonus([{ points: 5 }, { points: 5 }, { points: 5 }]).capped === true);
}

console.log('\n=== a manager who clears other people\'s work is not counted as idle ===');
{
  const reviews = [];
  for (let i = 0; i < 8; i++) reviews.push({ id: 'r' + i, title: 'Review ' + i, assignee: 'someone',
    due: '2026-11-10', priority: 'Medium', status: S.VERIFIED, reworkCount: 0,
    raisedBy: 'p', approver: 'p',
    history: [h('2026-11-05', S.FOR_REVIEW), h('2026-11-06', S.VERIFIED)] });
  const own = [closed('a', '2026-11-05', '2026-11-04')];
  ok('decisions cleared count towards the load',
     score(own.concat(reviews)) > score(own), score(own.concat(reviews)) + ' vs ' + score(own));
}

console.log('\n' + (fail ? 'FAILED ' : 'ALL PASS ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
