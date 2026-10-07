/**
 * One rule: every customer-facing email leaves from info@biscsindia.com, or it
 * does not leave at all.
 *
 * Notifications, reminders and payment reminders are all in scope. The one that
 * matters most is the negative case — that when the address cannot be used,
 * nothing goes out from a different one instead. A password reset arriving from
 * somebody's personal Gmail looks like phishing, cannot be replied to, and
 * teaches a customer's whole team to distrust mail from us.
 */
const { call, env } = require('./server.js');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 170) + ']')); v ? pass++ : fail++; };
const FROM = 'info@biscsindia.com';

const R = Date.now().toString(36);
const U = (u) => u + R;
const email = 'owner' + R + '@acme.in';
const since = () => env.mails.length;

console.log('\n=== every kind of mail the product sends ===');
const A = call({ action: 'register', form: { companyName: 'Acme Engineering',
  name: 'Rohan Mehta', email, password: 'strongpass123' } }).token;
call({ action: 'addUser', token: A, form: { name: 'Payel S', username: U('payel'),
  email: U('payel') + '@acme.in', role: 'Doer', jobProfile: 'Executive', password: 'staffpass123' } });
const P = call({ action: 'login', username: U('payel') + '@acme.in', password: 'staffpass123' }).token;

call({ action: 'createTask', token: A, form: { title: 'Vendor audit',
  assignTo: U('payel'), dueDate: '2026-12-01' } });
const t = call({ action: 'getDashboard', token: A }).tasks.find((x) => x.title === 'Vendor audit');
call({ action: 'updateTask', token: P, taskId: t.id, status: 'In Progress' });
call({ action: 'updateTask', token: P, taskId: t.id, status: 'For Review' });
call({ action: 'updateTask', token: A, taskId: t.id, status: 'In Progress', note: 'Needs the 5-why' });
call({ action: 'updateTask', token: P, taskId: t.id, status: 'For Review' });
call({ action: 'updateTask', token: A, taskId: t.id, status: 'Verified' });
call({ action: 'awardCookie', token: A, data: { employee: U('payel'), points: 3,
  reason: 'Stayed back to clear the audit list' } });
call({ action: 'forgotPassword', email: U('payel') + '@acme.in' });
call({ action: 'contactSales', form: { name: 'A Buyer', email: 'buyer' + R + '@x.in',
  company: 'Buyer Ltd', message: 'Tell me about Enterprise' } });

ok('the product actually sent a spread of mail', env.mails.length >= 6, env.mails.length);
const wrong = env.mails.filter((m) => m.from !== FROM);
ok('every single one is from ' + FROM, wrong.length === 0,
   JSON.stringify(wrong.slice(0, 3).map((m) => ({ subject: m.subject, from: m.from }))));
ok('none went through MailApp, which cannot set a from address at all',
   env.mails.every((m) => m.via === 'gmail'),
   JSON.stringify(env.mails.filter((m) => m.via !== 'gmail').map((m) => m.subject)));
ok('a reply goes back to the same address', env.mails.every((m) => m.replyTo === FROM));
ok('and it is signed Dome Box, not a person', env.mails.every((m) => m.name === 'Dome Box'));

console.log('\n=== when the alias is missing, nothing goes out at all ===');
/* The old behaviour: log a warning, then quietly send as the script owner.
   That is the failure this whole rule exists to prevent. */
const { APP } = require('./server.js');
env.G.GmailApp.__setAliases([]);
APP.__newExecution();      // Apps Script caches the lookup per request; this is a new one.
env.mails.length = 0;
call({ action: 'createTask', token: A, form: { title: 'Second audit',
  assignTo: U('payel'), dueDate: '2026-12-09' } });
call({ action: 'forgotPassword', email: 'someone.else' + R + '@acme.in' });
ok('no mail is sent from a substitute address', env.mails.length === 0,
   JSON.stringify(env.mails.map((m) => ({ s: m.subject, from: m.from, via: m.via }))));
ok('the work itself still goes through — mail failing must not fail the task',
   call({ action: 'getDashboard', token: A }).tasks.some((x) => x.title === 'Second audit'));
env.G.GmailApp.__setAliases([FROM]);
APP.__newExecution();
call({ action: 'createTask', token: A, form: { title: 'Third audit',
  assignTo: U('payel'), dueDate: '2026-12-10' } });
ok('and it resumes once the alias is back', env.mails.some((m) => m.from === FROM));

console.log('\n=== the senders outside code.gs ===');
const rem = fs.readFileSync('/home/user/stockpilot/domebox/reminders.gs', 'utf8');
ok('the daily digest refuses to send without the alias',
   /if \(!rmAliasVerified_\(\)\) return false;/.test(rem));
ok('and never falls back to another address',
   !/MailApp\.sendEmail/.test(rem), 'reminders.gs still calls MailApp');
ok('it sets from and replyTo on every message',
   /from: rmMailFrom_\(\), replyTo: rmMailFrom_\(\)/.test(rem));

console.log('\n=== payment reminders ===');
ok('renewal reminders exist at all', /function sendRenewalReminders\(\)/.test(rem));
ok('they are previewable before anything is sent', /function previewRenewalReminders\(\)/.test(rem));
ok('they warn before expiry and again after it',
   /var RENEWAL_MILESTONES = \[14, 7, 3, 1, 0, -3\]/.test(rem));
ok('they are not sent to Free workspaces, who have not asked to be sold to',
   /plan === 'free'/.test(rem));
ok('one per milestone, deduped like the digest', /rmAlreadySent_\(t\.sheetId, t\.ownerEmail, key\)/.test(rem));
ok('and they are installed on the schedule, not left for somebody to remember',
   /newTrigger\('sendRenewalReminders'\)/.test(rem));
ok('the status report names a missing schedule instead of just counting',
   /MISSING ' \+ fn/.test(rem));

console.log('\n=== the operator alerts are the one deliberate exception ===');
const code = fs.readFileSync('/home/user/stockpilot/dist/code.gs', 'utf8');
ok('they still send when the alias is broken, because they report that breakage',
   /function sendOpsMail_/.test(code) && /alias not set/.test(code));
ok('and they say why they came from the wrong address',
   /Customer mail is NOT being sent at all/.test(code));
ok('setup checks the alias before a customer is ever involved',
   /is not a verified send-as alias on this account/.test(code));
ok('and spells out what is affected', /not reminders, not payment reminders/.test(code));

console.log('\n' + (fail ? 'FAILED ' : '') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
