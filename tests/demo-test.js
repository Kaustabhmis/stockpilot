/**
 * The demo account is the first thing a prospect sees, so "it ran without
 * throwing" is not the bar. The bar is that every screen a sales call opens
 * has something real on it — and the screens that make the argument (the
 * score, the leaderboard, the priority list) need history, late deliveries and
 * rework loops to say anything at all.
 *
 * An empty workspace with a top plan is a worse demo than no demo.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 200) + ']')); v ? pass++ : fail++; };

const SRC = fs.readFileSync('/home/user/stockpilot/dist/code.gs', 'utf8');
const env = build();
env.props.MASTER_DB_ID = 'MASTER';
env.props.TEMPLATE_ID = 'TEMPLATE';
env.props.AUTH_PEPPER = 'demo-pepper';
env.props.TOKEN_SECRET = 'demo-token-secret';
env.newFile('MASTER', 'Registry');
const tpl = env.newFile('TEMPLATE', 'Template');
['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
tpl.getSheetByName('Settings').appendRow(['General']);

const names = Object.keys(env.G);
const APP = new Function(...names, SRC + '\n;return { doPost, ensureRegistry, ' +
  'createDemoAccount, deleteDemoAccount };')(...names.map((n) => env.G[n]));
APP.ensureRegistry();

const call = (body) => JSON.parse(APP.doPost({ postData: { contents: JSON.stringify(body) },
  parameter: {} }).getContent());

console.log('\n=== it builds ===');
const report = APP.createDemoAccount();
ok('createDemoAccount returns its report', typeof report === 'string', typeof report);
ok('it prints a login', /=== SIGN IN ===/.test(report));
ok('with the email and the password', /demo@biscsindia\.com/.test(report) && /DomeBoxDemo2026/.test(report));
ok('and the staff login pattern', /@demo\.domebox\.in/.test(report));
ok('it suggests an order to open things in', /Worth opening in this order/.test(report));
ok('and says how to remove it', /deleteDemoAccount\(true\)/.test(report));
/* Every optional step reports its own failure as an indented "label: message"
   line and carries on, which is right — one broken step should not cost the
   whole demo. But it also means a silently half-built workspace looks like a
   success, so the report is checked for any of them. This caught the project
   step failing on a renamed field while everything else passed. */
const hiccups = (report.match(/^ {2}(could not|project|cookies|leave|KRAs): .+$/gm) || []);
ok('no step failed quietly', hiccups.length === 0, hiccups.join(' | '));

console.log('\n=== the account signs in ===');
const A = call({ action: 'login', username: 'demo@biscsindia.com', password: 'DomeBoxDemo2026' });
ok('the admin can log in', A.status === 'success', A.message);
ok('on the top plan', A.plan === 'Enterprise', A.plan);
const P = call({ action: 'login', username: 'payel@demo.domebox.in', password: 'DemoStaff2026' });
ok('and so can a Doer, for the second half of a demo', P.status === 'success', P.message);
ok('who is a Doer', P.user && P.user.role === 'Doer', P.user && P.user.role);

console.log('\n=== the plan is actually unlocked ===');
const dash = call({ action: 'getDashboard', token: A.token });
ok('the dashboard loads', dash.status === 'success', dash.message);
ok('no user cap is in the way', !dash.usage || dash.usage.maxUsers === null, dash.usage && dash.usage.maxUsers);
ok('no task cap either', !dash.usage || dash.usage.maxTasks === null, dash.usage && dash.usage.maxTasks);
ok('reports are not gated', call({ action: 'getAnalytics', token: A.token }).status === 'success');

console.log('\n=== every screen a sales call opens has something on it ===');
const tasks = dash.tasks || [];
ok('the board is not empty', tasks.length > 25, tasks.length);
ok('there is work in every state a board shows',
   ['Pending', 'In Progress', 'Verified'].every((s) => tasks.some((t) => t.status === s)),
   [...new Set(tasks.map((t) => t.status))].join(', '));
const users = call({ action: 'getUsers', token: A.token }).users || [];
ok('there is a real team', users.length === 8, users.length);
ok('in a reporting line, not a flat list', users.some((u) => u.manager), users.map((u) => u.manager).join(','));
ok('across more than one department',
   new Set(users.map((u) => u.dept).filter(Boolean)).size >= 3,
   [...new Set(users.map((u) => u.dept))].join(', '));

/* The admin assigns rather than does, so the list worth checking is a Doer's —
   which is also the one shown on a call. */
const prio = call({ action: 'getPriorityList', token: P.token, horizon: 'week' });
ok('the priority list has rows', prio.status === 'success' &&
   (prio.doNow.length + prio.next.length + prio.later.length) > 0,
   JSON.stringify(prio.counts || prio.message));
ok('and every row says why it is where it is',
   [].concat(prio.doNow, prio.next).every((r) => (r.reasons || []).length > 0),
   JSON.stringify([].concat(prio.doNow, prio.next).map((r) => r.reasons)));
const allPrio = call({ action: 'getPriorityList', token: A.token, username: 'rafiq', horizon: 'all' });
ok('somebody is overdue, because every real workshop has some',
   allPrio.overdue > 0, allPrio.overdue);
/* The account you sign in with first is the Admin, and Priority is the second
   tab anybody clicks. An empty one there reads as an empty product. */
const ownerPrio = call({ action: 'getPriorityList', token: A.token, horizon: 'week' });
ok('the owner has his own work, so his Priority tab is not empty',
   (ownerPrio.doNow.length + ownerPrio.next.length + ownerPrio.later.length) > 0,
   JSON.stringify(ownerPrio.counts));
ok('including something overdue of his own', ownerPrio.overdue > 0, ownerPrio.overdue);

const board = call({ action: 'getLeaderboard', token: A.token });
ok('the leaderboard ranks people', board.status === 'success' && board.rows.length >= 4, board.rows && board.rows.length);
ok('somebody is named for the month', !!board.champion, JSON.stringify(board.champion));
ok('and the scores are not all identical — that is the whole argument',
   new Set(board.rows.map((r) => r.score)).size > 1, board.rows.map((r) => r.score).join(' '));

const proj = call({ action: 'getProjects', token: A.token });
ok('there is a project mid-flight', proj.status === 'success' && proj.projects.length === 1,
   proj.projects && proj.projects.length);
const pr = (proj.projects || [])[0] || {};
ok('with three stages', (pr.stageList || []).length === 3, JSON.stringify(Object.keys(pr)));
ok('one of them already released, the rest waiting on it',
   (pr.stageList || []).filter((s) => s.status === 'Pending' || s.status === 'In Progress').length >= 1,
   (pr.stageList || []).map((s) => s.status).join(', '));

ok('cookie points are on the record',
   (call({ action: 'getCookies', token: A.token }).cookies || []).length === 2);
ok('the org chart draws', call({ action: 'getOrgChart', token: A.token }).status === 'success');
const kra = call({ action: 'getKraFor', token: A.token, username: 'payel' });
ok('KRAs are set, so an appraisal has numbers in it',
   kra.status === 'success' && (kra.kras || []).length === 3, JSON.stringify(kra).slice(0, 200));
ok('and they are measurable rather than aspirational',
   (kra.kras || []).every((k) => k.measured && k.target !== ''),
   JSON.stringify((kra.kras || []).map((k) => [k.item, k.measured, k.target])));
ok('the appraisal form builds on them',
   call({ action: 'getAppraisalForm', token: A.token, username: 'payel' }).status === 'success');

console.log('\n=== the score says something, which needs imperfect history ===');
const scores = (dash.stats && dash.stats.scores) || {};
const payelDash = call({ action: 'getDashboard', token: P.token });
const ps = payelDash.stats.scores;
ok('a doer has a real score, not "no data"', ps.delegation > 0, JSON.stringify(ps.delegation));
ok('and it is not a perfect 100 — nothing is learned from a flawless demo',
   ps.delegation < 100, ps.delegation);
ok('the breakdown opens', (ps.breakdown || []).length > 0, (ps.breakdown || []).length);
ok('some work was delivered late', tasks.some((t) => t.status === 'Verified' && t.due < '2026-10-07') ||
   /delivered late/.test(report), (report.match(/Work: [^\n]*/) || [])[0]);
ok('and something was sent back for rework',
   tasks.some((t) => (t.reworkCount || 0) > 0), tasks.filter((t) => t.reworkCount).length);
ok('a recurring job with a stop rule is there to show',
   tasks.some((t) => t.frequency === 'Monthly' && t.repeatCount === 12),
   JSON.stringify(tasks.filter((t) => t.frequency && t.frequency !== 'One Time')
     .map((t) => [t.title, t.frequency, t.repeatCount])));
ok('leave is recorded, so deadlines visibly respect it',
   (call({ action: 'getLeave', token: A.token }).leave || []).length === 1);

console.log('\n=== it does not do damage ===');
/* A demo that issues an invoice puts a ₹0 document into a numbered series that
   an accountant has to explain. */
ok('no invoice was issued for a payment that never happened',
   (call({ action: 'getInvoices', token: A.token }).invoices || []).length === 0);
ok('no email can reach a real person — the staff domain does not exist',
   !env.mails.some((m) => /@demo\.domebox\.in/.test(m.to) && !/demo\.domebox\.in/.test(m.to)) &&
   users.filter((u) => u.email).every((u) => /@demo\.domebox\.in$/.test(u.email) || u.email === 'demo@biscsindia.com'),
   users.map((u) => u.email).join(' '));

console.log('\n=== running it twice ===');
const second = APP.createDemoAccount();
ok('it refuses rather than building a second one', /already exists/.test(second), second.slice(0, 160));
ok('and says what to do instead', /deleteDemoAccount\(true\)/.test(second));
ok('the first one still works',
   call({ action: 'login', username: 'demo@biscsindia.com', password: 'DomeBoxDemo2026' }).status === 'success');

console.log('\n=== removing it ===');
APP.deleteDemoAccount();   // no argument: a dry run
ok('a dry run leaves the account alone',
   call({ action: 'login', username: 'demo@biscsindia.com', password: 'DomeBoxDemo2026' }).status === 'success');
APP.deleteDemoAccount(true);
ok('and then it is gone',
   call({ action: 'login', username: 'demo@biscsindia.com', password: 'DomeBoxDemo2026' }).status === 'error');
ok('so the address can be used again',
   typeof APP.createDemoAccount() === 'string' &&
   call({ action: 'login', username: 'demo@biscsindia.com', password: 'DomeBoxDemo2026' }).status === 'success');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
