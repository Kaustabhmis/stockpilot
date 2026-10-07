/**
 * A ranking points at real people, so the rules it ranks by are worth pinning
 * down. Three in particular:
 *
 *   · it ranks the score the rest of the product already computes, so nobody
 *     can be first here and middling on their own dashboard;
 *   · somebody with nothing closed is UNRANKED, not last — ranking an absence
 *     is how a leaderboard ends up punishing a person who was on leave;
 *   · one easy task cannot win it, because the score it ranks by is already
 *     rate × load credit.
 */
const { call, env } = require('./server.js');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 190) + ']')); v ? pass++ : fail++; };

const R = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
const U = (u) => u + R;
const email = 'lb' + R + '@acme.in';
const A = call({ action: 'register', form: { companyName: 'Acme Engineering',
  name: 'Rohan Mehta', email, password: 'strongpass123' } }).token;
const ymd = (plus) => { const d = new Date(); d.setDate(d.getDate() + plus); return d.toISOString().slice(0, 10); };

/* Six people is past the Free cap, and the point of this suite is the shape of
   the ranking, not the plan gate — pay for the workspace the way a customer
   would before measuring it. */
(() => {
  const dir = env.FILES.MASTER.getSheetByName('Directory');
  const d = dir.getDataRange().getValues();
  for (let i = 1; i < d.length; i++) {
    if (String(d[i][1]).toLowerCase() === email) {
      dir.getRange(i + 1, 4).setValue('Scale');
      const u = new Date(); u.setDate(u.getDate() + 300);
      dir.getRange(i + 1, 5).setValue(u.toISOString().slice(0, 10));
    }
  }
})();

const PEOPLE = [['Sruti Charulata', 'sruti', 'HOD'], ['Payel Sanyamath', 'payel', 'Doer'],
                ['Vikram Rathore', 'vikram', 'Doer'], ['Imran Qureshi', 'imran', 'Doer'],
                ['Nita Bose', 'nita', 'Doer']];
const tok = {};
PEOPLE.forEach(([n, u, role]) => {
  call({ action: 'addUser', token: A, form: { name: n, username: U(u), email: U(u) + '@acme.in',
    role, manager: u === 'sruti' ? '' : U('sruti'), jobProfile: 'Executive', password: 'staffpass123' } });
  tok[u] = call({ action: 'login', username: U(u) + '@acme.in', password: 'staffpass123' }).token;
});

const run = (who, title, due, priority) => {
  call({ action: 'createTask', token: A, form: { title, assignTo: U(who), dueDate: due, priority } });
  const t = call({ action: 'getDashboard', token: A }).tasks.find((x) => x.title === title);
  call({ action: 'updateTask', token: tok[who], taskId: t.id, status: 'In Progress' });
  call({ action: 'updateTask', token: tok[who], taskId: t.id, status: 'For Review' });
  call({ action: 'updateTask', token: A, taskId: t.id, status: 'Verified' });
};

/* Payel carries ten and delivers seven on time. Vikram gets one easy job.
   Imran carries a middling load. Nita closes nothing at all. */
for (let i = 0; i < 7; i++) run('payel', 'P on time ' + i, ymd(5), 'High');
for (let i = 0; i < 3; i++) run('payel', 'P late ' + i, ymd(-6), 'High');
run('vikram', 'One easy job', ymd(5), 'Low');
for (let i = 0; i < 4; i++) run('imran', 'I job ' + i, ymd(4), 'Medium');
call({ action: 'createTask', token: A, form: { title: 'Nita open', assignTo: U('nita'), dueDate: ymd(9) } });

const board = call({ action: 'getLeaderboard', token: A, period: 'month' });
const rankOf = (u) => (board.rows.find((r) => r.username === U(u)) || {}).rank;

console.log('\n=== the order ===');
ok('the board comes back', board.status === 'success', board.message);
ok('it is ranked from 1', board.rows[0] && board.rows[0].rank === 1,
   JSON.stringify(board.rows.map((r) => [r.name, r.rank, r.score])));
ok('scores descend down the list',
   board.rows.every((r, i) => i === 0 || board.rows[i - 1].score >= r.score),
   board.rows.map((r) => r.score).join(' '));
ok('ranks never decrease going down',
   board.rows.every((r, i) => i === 0 || board.rows[i - 1].rank <= r.rank));
ok('ten jobs with seven on time out-ranks one easy job',
   rankOf('payel') < rankOf('vikram'),
   'payel ' + rankOf('payel') + ' vs vikram ' + rankOf('vikram'));

console.log('\n=== nobody is ranked on nothing ===');
ok('a person who closed nothing is not in the ranking',
   !board.rows.some((r) => r.username === U('nita')));
ok('they are listed separately instead',
   board.unranked.some((u) => u.username === U('nita')),
   JSON.stringify(board.unranked));
ok('with the reason given',
   (board.unranked.find((u) => u.username === U('nita')) || {}).reason);
ok('and they are not counted as the bottom score',
   board.stats.bottom === board.rows[board.rows.length - 1].score);

console.log('\n=== employee of the month ===');
ok('a champion is named', !!board.champion, JSON.stringify(board.champion));
ok('they delivered work of their own', board.champion.delivered > 0, board.champion.delivered);
ok('and never somebody on a thin month', !board.champion.provisional);
ok('a one-task month is flagged as thin',
   (board.rows.find((r) => r.username === U('vikram')) || {}).provisional === true);

/* The Admin verifies everything in this workspace and delivers nothing of his
   own, which the score rightly rewards — clearing other people's work fast IS
   the job. It is still not what "employee of the month" means, and a board
   that answered the question with "the person who clicks Verify" would be
   discredited the first time it was published. */
const boss = board.rows.find((r) => r.name === 'Rohan Mehta');
ok('the approver is still ranked, on the same scale as everyone', !!boss, JSON.stringify(board.rows.map((r) => r.name)));
ok('and is marked as scoring on approvals rather than his own work',
   boss && boss.decisionsOnly === true, boss && boss.delivered);
ok('but he is not crowned employee of the month',
   board.champion.username !== boss.username, board.champion.name);
ok('somebody who actually delivered is', board.champion.username === U('payel'),
   board.champion.name);

console.log('\n=== the columns people read the ranking by ===');
const pay = board.rows.find((r) => r.username === U('payel'));
ok('on-time is a number, not a column of dashes', typeof pay.onTime === 'number', pay.onTime);
/* It is the graded timeliness component, not the share delivered on time — a
   day late on a Low task costs less than a week late on a Critical one — so
   seven of ten on time sits well above 70. */
ok('three late out of ten still costs real points', pay.onTime < 100 && pay.onTime > 50, pay.onTime);
ok('delivered counts the work, not the people', pay.delivered === 10, pay.delivered);
ok('an approver has no on-time of their own to show',
   boss.onTime === null, boss.onTime);

console.log('\n=== the score is the one on the dashboard, not a second system ===');
const dash = call({ action: 'getDashboard', token: tok.payel }).stats.scores;
const onBoard = board.rows.find((r) => r.username === U('payel'));
ok('the leaderboard score matches the delegation score shown to the person',
   onBoard.score === dash.delegation, onBoard.score + ' vs ' + dash.delegation);

console.log('\n=== periods ===');
['week', 'month', 'quarter', 'year'].forEach((p) => {
  ok(p + ' is a period you can rank', call({ action: 'getLeaderboard', token: A, period: p }).status === 'success');
});
const last = call({ action: 'getLeaderboard', token: A, period: 'month', offset: 1 });
ok('last month is empty, not an error', last.status === 'success' && last.rows.length === 0, last.rows.length);
ok('a nonsense period falls back to the month',
   call({ action: 'getLeaderboard', token: A, period: 'fortnight' }).period === 'month');
ok('a negative offset cannot look into the future',
   call({ action: 'getLeaderboard', token: A, period: 'month', offset: -5 }).offset === 0);

console.log('\n=== movement ===');
ok('everybody is new in the first period they appear',
   board.rows.every((r) => r.movement === 'new'), board.rows.map((r) => r.movement).join(','));
ok('and their previous rank is empty rather than invented',
   board.rows.every((r) => r.previousRank === null));

console.log('\n=== who can see it ===');
const asDoer = call({ action: 'getLeaderboard', token: tok.vikram, period: 'month' });
ok('a Doer sees the whole board by default', asDoer.rows.length === board.rows.length);
ok('and is told where they stand', asDoer.myRank === rankOf('vikram'), asDoer.myRank);
ok('a Doer is not shown everybody else\'s blank month',
   asDoer.unranked.length === 0, JSON.stringify(asDoer.unranked));
ok('a Doer cannot change who sees it',
   call({ action: 'setLeaderboardVisibility', token: tok.vikram, visibility: 'managers' }).status === 'error');
ok('nor can an HOD', call({ action: 'setLeaderboardVisibility', token: tok.sruti,
     visibility: 'managers' }).status === 'error');

ok('an Admin can narrow it to the top three',
   call({ action: 'setLeaderboardVisibility', token: A, visibility: 'top' }).status === 'success');
const trimmed = call({ action: 'getLeaderboard', token: tok.vikram, period: 'month' });
ok('a Doer then sees only the top 3 and their own row',
   trimmed.rows.every((r) => r.rank <= 3 || r.username === U('vikram')),
   JSON.stringify(trimmed.rows.map((r) => [r.name, r.rank])));
ok('their own row survives the trim',
   trimmed.rows.some((r) => r.username === U('vikram')));
ok('and they are still told their real position out of the real total',
   trimmed.myRank === rankOf('vikram') && trimmed.counts.ranked === board.counts.ranked,
   trimmed.myRank + ' of ' + trimmed.counts.ranked);
ok('a manager still sees everything', call({ action: 'getLeaderboard', token: tok.sruti,
     period: 'month' }).rows.length === board.rows.length);

ok('an Admin can hide it from staff entirely',
   call({ action: 'setLeaderboardVisibility', token: A, visibility: 'managers' }).status === 'success');
ok('a Doer is then refused, in words that explain',
   /only shown to managers/.test(call({ action: 'getLeaderboard', token: tok.vikram }).message));
ok('a manager is not', call({ action: 'getLeaderboard', token: tok.sruti }).status === 'success');
ok('an invented visibility is refused',
   call({ action: 'setLeaderboardVisibility', token: A, visibility: 'nobody' }).status === 'error');
call({ action: 'setLeaderboardVisibility', token: A, visibility: 'everyone' });
ok('the setting survives being read back',
   call({ action: 'getLeaderboard', token: A }).visibility === 'everyone');
ok('and it did not eat the job categories',
   call({ action: 'getCategories', token: A }).categories.length > 0);
ok('nor the priority levels',
   call({ action: 'getCategories', token: A }).priorities.length === 4);

console.log('\n=== one company never ranks another ===');
const e2 = 'lb2' + R + '@beta.in';
const B = call({ action: 'register', form: { companyName: 'Beta Works', name: 'Sara K',
  email: e2, password: 'strongpass123' } }).token;
const other = call({ action: 'getLeaderboard', token: B });
ok('a new workspace ranks nobody from anywhere else',
   !other.rows.some((r) => /sruti|payel|vikram/.test(r.username)), JSON.stringify(other.rows));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
