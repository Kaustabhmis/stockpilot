/**
 * The launch audit, pinned.
 *
 * Each case here is a hole that was found open in the finished product and
 * closed. They are kept as tests rather than as notes because every one of them
 * is the kind of thing that comes back during a refactor without anybody
 * noticing.
 */
const { call, env } = require('./server.js');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 170) + ']')); v ? pass++ : fail++; };
const err = (f) => { try { const r = f(); return r.status === 'error' ? r.message : null; } catch (e) { return e.message; } };

const R = Date.now().toString(36);
const U = (u) => u + R;
const email = 'audit' + R + '@acme.in';
const A = call({ action: 'register', form: { companyName: 'Acme Engineering',
  name: 'Rohan Mehta', email, password: 'strongpass123' } }).token;
['alpha', 'beta'].forEach((u, i) => call({ action: 'addUser', token: A, form: {
  name: 'Person ' + u, username: U(u), email: U(u) + '@acme.in', role: 'Doer',
  jobProfile: 'Executive', password: 'staffpass123' } }));
const ALPHA = call({ action: 'login', username: U('alpha') + '@acme.in', password: 'staffpass123' }).token;

console.log('\n=== a signed-in user cannot read work that is not theirs ===');
call({ action: 'createTask', token: A, form: { title: 'Board restructure — confidential',
  assignTo: U('beta'), dueDate: '2026-12-01' } });
/* getDashboard always filtered by what you are allowed to see. getTasks returned
   the raw sheet, so any Doer could ask for the list and read the whole company's
   work. One rule now, used by both. */
ok('the raw task route is filtered, not just the dashboard',
   call({ action: 'getTasks', token: ALPHA }).tasks.length === 0,
   JSON.stringify(call({ action: 'getTasks', token: ALPHA }).tasks.map((t) => t.title)));
ok('the owner of the work still sees it',
   call({ action: 'getTasks', token: call({ action: 'login', username: U('beta') + '@acme.in',
     password: 'staffpass123' }).token }).tasks.length === 1);
ok('and an Admin sees everything', call({ action: 'getTasks', token: A }).tasks.length === 1);
ok('the two routes agree with each other',
   call({ action: 'getTasks', token: ALPHA }).tasks.length ===
   call({ action: 'getDashboard', token: ALPHA }).tasks.length);

console.log('\n=== the public routes cannot be used as an email cannon ===');
/* Apps Script gives this project ONE daily mail quota shared by every tenant.
   An unthrottled reset route does not just annoy one person — it stops every
   assignment, approval and reminder in the product going out, for everybody,
   for the rest of the day. */
{
  const victim = 'victim' + R + '@acme.in';
  let sent = 0;
  for (let i = 0; i < 10; i++) if (call({ action: 'forgotPassword', email: victim }).status === 'success') sent++;
  ok('one address cannot be hammered', sent <= 5, sent + ' got through');

  let through = 0;
  for (let i = 0; i < 80; i++) {
    if (call({ action: 'forgotPassword', email: 'spray' + i + R + '@acme.in' }).status === 'success') through++;
  }
  ok('nor can the shared mail quota be drained by spraying addresses', through <= 60, through);
  ok('and the refusal tells the person what to do',
     /wait an hour|write to/.test(call({ action: 'forgotPassword', email: 'another' + R + '@x.in' }).message || ''));
}
ok('signups are rate limited too',
   [1, 2, 3, 4, 5].map(() => call({ action: 'register', form: { companyName: 'Spam',
     name: 'Bot', email: 'bot' + R + '@x.in', password: 'strongpass123' } }).status)
     .filter((s) => s === 'success').length <= 1);

console.log('\n=== check-then-act is serialised ===');
/* appendRow is atomic on its own. What needed the lock is the pattern that
   reads a count or a uniqueness rule and THEN writes: two clicks at the same
   moment both pass the check. */
const fs = require('fs');
const src = fs.readFileSync('/home/user/stockpilot/dist/code.gs', 'utf8');
[['registerCompany_', 'two companies on one login email'],
 ['createTask_', 'a workspace past its monthly task cap'],
 ['addUser_', 'a duplicate username or one user over the plan'],
 ['createProject_', 'stages straddling the cap'],
 ['grantPlan_', 'one payment overwriting another\'s expiry']].forEach(([fn, why]) => {
  const body = src.slice(src.indexOf('function ' + fn + '('));
  ok(fn + ' takes the lock — ' + why,
     /^function [^\n]*\n(?:[^\n]*\n)?\s*return withLock_\(/.test(body), body.slice(0, 90));
});
ok('and the lock is released even when the work throws',
   /finally\s*\{\s*try\s*\{\s*lock\.releaseLock/.test(src));
ok('a workspace that cannot get the lock is told, not quietly raced through',
   /busy saving something else/.test(src));

console.log('\n=== the things that were already true, still true ===');
ok('no secret is in the shipped file',
   !/rzp_(live|test)_|AIzaSy[\w-]{20,}/.test(src));
ok('no tenant file is ever shared publicly',
   !/setSharing\s*\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
ok('identity never comes from the request body',
   !/\bp\.user\b|params\.user/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')));
ok('a user record never carries its password out',
   !call({ action: 'getUsers', token: A }).users.some((u) => 'password' in u));
ok('a Doer cannot reach a manager route',
   /manager account/.test(err(() => call({ action: 'getUsers', token: ALPHA })) ||
                          err(() => call({ action: 'addUser', token: ALPHA, form: {} })) || ''));

console.log('\n' + (fail ? 'FAILED ' : '') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
