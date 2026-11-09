/**
 * Cookie points and the org chart, over the real API.
 */
const { call, env } = require('./server.js');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 160) + ']')); v ? pass++ : fail++; };
const err = (f) => { try { const r = f(); return r.status === 'error' ? r.message : null; } catch (e) { return e.message; } };

/* Time alone is 1ms granular, so two runs started together can share an
   id and collide on an email the other already registered. */
const R = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
const email = 'ck' + R + '@acme.in';
const A = call({ action: 'register', form: { companyName: 'Acme Engineering',
  name: 'Rohan Mehta', email, password: 'strongpass123' } }).token;
const dir = env.FILES.MASTER.getSheetByName('Directory');
const dd = dir.getDataRange().getValues();
for (let i = 1; i < dd.length; i++) if (String(dd[i][1]) === email) {
  dir.getRange(i + 1, 4).setValue('Yearly');
  const u = new Date(); u.setDate(u.getDate() + 300);
  dir.getRange(i + 1, 5).setValue(u.toISOString().slice(0, 10));
}
const U = (u) => u + R;
const add = (n, u, role, mgr) => call({ action: 'addUser', token: A, form: { name: n, username: U(u),
  email: U(u) + '@acme.in', role, manager: mgr ? U(mgr) : '', jobProfile: 'Executive',
  password: 'staffpass123' } });
add('Sruti Charulata', 'sruti', 'HOD');
add('Imran Qureshi', 'imran', 'HOD');
add('Payel Sanyamath', 'payel', 'Doer', 'sruti');
add('Vikram Rathore', 'vikram', 'Doer', 'sruti');
add('Neha Bhandari', 'neha', 'Doer', 'imran');
const tok = (u) => call({ action: 'login', username: U(u) + '@acme.in', password: 'staffpass123' }).token;
const T = { sruti: tok('sruti'), imran: tok('imran'), payel: tok('payel') };

console.log('\n=== cookie points ===');
const give = (token, to, points, reason) => call({ action: 'awardCookie', token,
  data: { employee: U(to), points, reason } });

const g = give(T.sruti, 'payel', 3, 'Stayed back to clear the audit list');
ok('a manager can recognise their own person', g.status === 'success', g.message);
ok('the message says who and how many', /3 cookie points to Payel Sanyamath/.test(g.message), g.message);
ok('and they are told by email',
   env.mails.some((m) => /You picked up 3 cookie points/.test(m.subject)),
   env.mails.map((m) => m.subject).slice(-3).join(' | '));

ok('nobody awards themselves',
   /cannot award them to yourself/.test(err(() => give(T.sruti, 'sruti', 3, 'I am wonderful')) || ''));
ok('a manager cannot reach into another department',
   /does not report to you/.test(err(() => give(T.imran, 'payel', 2, 'Good work on the line')) || ''),
   err(() => give(T.imran, 'payel', 2, 'Good work on the line')));
ok('an Admin can recognise anyone, including a manager',
   give(A, 'sruti', 2, 'Held the department together in a bad month').status === 'success');
ok('a Doer cannot award at all',
   /manager account/.test(err(() => give(T.payel, 'vikram', 1, 'Nice one mate')) || ''));
ok('an award with no reason is refused, and says why',
   /reads as favouritism/.test(err(() => give(T.sruti, 'vikram', 2, 'ok')) || ''),
   err(() => give(T.sruti, 'vikram', 2, 'ok')));
ok('more than five at once is refused',
   /between 1 and 5/.test(err(() => give(T.sruti, 'vikram', 9, 'Outstanding month all round')) || ''));
ok('zero is refused', /between 1 and 5/.test(err(() => give(T.sruti, 'vikram', 0, 'Nothing special')) || ''));

console.log('\n=== they show up, and they move the score ===');
const beforeScore = call({ action: 'getDashboard', token: T.payel }).stats.scores;
ok('the recipient sees the award on their dashboard',
   beforeScore.cookies && beforeScore.cookies.awarded === 3, JSON.stringify(beforeScore.cookies));
ok('with the reason attached', (beforeScore.cookies.list || [])
   .some((c) => /audit list/.test(c.reason)), JSON.stringify(beforeScore.cookies.list));
ok('and who gave it', (beforeScore.cookies.list || []).some((c) => c.byName === 'Sruti Charulata'));

const feed = call({ action: 'getCookies', token: A });
ok('the workspace feed lists them', feed.cookies.length >= 2);
ok('with a leaderboard', feed.leaderboard.some((l) => l.name === 'Payel Sanyamath' && l.points === 3));
ok('a Doer only sees their own',
   call({ action: 'getCookies', token: T.payel }).cookies.every((c) => c.to === U('payel')));

for (let i = 0; i < 4; i++) give(T.sruti, 'vikram', 5, 'Covered two shifts through the shutdown');
const capped = call({ action: 'getCookies', token: A }).leaderboard.find((l) => l.name === 'Vikram Rathore');
ok('the recognition is recorded in full', capped.points === 20, capped.points);
ok('but the score bonus is capped at ten', capped.bonus === 10, capped.bonus);

console.log('\n=== the org chart builds itself ===');
const org = call({ action: 'getOrgChart', token: A });
ok('it returns a tree', org.tree.length === 1 && org.tree[0].name === 'Rohan Mehta');
ok('the two HODs sit under the owner', org.tree[0].reports.length === 2);
const sruti = org.tree[0].reports.find((r) => r.name === 'Sruti Charulata');
ok('and their people under them', sruti.reports.length === 2);
ok('each node counts everyone beneath it, not just the direct line',
   org.tree[0].headcount === 5, org.tree[0].headcount);
ok('it reports how deep the company runs', org.levels === 3, org.levels);
ok('and how many people are in it', org.people === 6);
/* The HODs were added without a "reports to", which in practice means the
   owner approves their work. The chart places them there and says so rather
   than leaving them floating beside the company. */
ok('somebody with no manager set still appears under the owner',
   org.tree[0].reports.every((r) => r.impliedManager === true));
ok('and the gap is named, not papered over',
   org.unassigned.length === 2 && /approved by an Admin/.test(org.note), org.note);
call({ action: 'updateUser', token: A, form: { name: 'Imran Qureshi', username: U('imran'),
  originalUsername: U('imran'), email: U('imran') + '@acme.in', role: 'HOD',
  manager: call({ action: 'getUsers', token: A }).users.find((u) => u.role === 'Admin').username,
  jobProfile: 'Executive' } });
ok('once a manager is set, the marker goes',
   call({ action: 'getOrgChart', token: A }).tree[0].reports
     .find((r) => r.name === 'Imran Qureshi').impliedManager === false);

call({ action: 'addUser', token: A, form: { name: 'Arjun Das', username: U('arjun'),
  email: U('arjun') + '@acme.in', role: 'Doer', jobProfile: 'Executive', password: 'staffpass123' } });
const org2 = call({ action: 'getOrgChart', token: A });
ok('somebody with no manager is surfaced, not hidden',
   org2.unassigned.some((u) => u.name === 'Arjun Das'));
ok('and the consequence is spelled out',
   /approved by an Admin until you set a manager/.test(org2.note), org2.note);

// Point two people at each other and make sure the walk does not hang.
call({ action: 'updateUser', token: A, form: { name: 'Sruti Charulata', username: U('sruti'),
  originalUsername: U('sruti'), email: U('sruti') + '@acme.in', role: 'HOD',
  manager: U('payel'), jobProfile: 'Executive' } });
call({ action: 'updateUser', token: A, form: { name: 'Payel Sanyamath', username: U('payel'),
  originalUsername: U('payel'), email: U('payel') + '@acme.in', role: 'Doer',
  manager: U('sruti'), jobProfile: 'Executive' } });
const org3 = call({ action: 'getOrgChart', token: A });
ok('a reporting loop does not hang the chart', Array.isArray(org3.tree));
ok('it is named instead', org3.cycles.length > 0 && /Sruti|Payel/.test(org3.cycles[0].name),
   JSON.stringify(org3.cycles));

console.log('\n' + (fail ? 'FAILED ' : '') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
