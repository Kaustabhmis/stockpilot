/**
 * Team import: rows from an Excel/CSV sheet are added through the same checks
 * as "Add member". One bad row never stops the others. Both editions.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 260) + ']')); v ? pass++ : fail++; };

for (const [label, file] of [['Domebox', '/../dist/code.gs'], ['Domebox Lite', '/../dist/lite/Code.gs']]) {
  console.log('\n######## ' + label + ' ########');
  const env = build();
  Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b' });
  env.G.GmailApp.__setAliases(['info@biscsindia.com', 'mis@dynamicengineers.in']);
  env.newFile('MASTER', 'Master');
  const tpl = env.newFile('TEMPLATE', 'Template');
  ['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
  tpl.getSheetByName('Settings').appendRow(['General']);
  const names = Object.keys(env.G);
  const X = new Function(...names, fs.readFileSync(__dirname + file, 'utf8') + '\n;return { doPost, ensureRegistry };')(...names.map((n) => env.G[n]));
  X.ensureRegistry();
  const call = (b) => JSON.parse(X.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());

  const A = call({ action: 'register', form: { companyName: 'Acme', name: 'Owner One', email: 'o@a.in', password: 'ownerpass123' } }).token;
  call({ action: 'addUser', token: A, form: { name: 'Sruti Das', username: 'sruti', email: 'sruti@a.in', role: 'HOD', jobProfile: 'Ops Head', password: 'staffpass123' } });
  const users = () => call({ action: 'getUsers', token: A }).users || [];

  console.log('\n=== a sheet of people ===');
  const r = call({ action: 'importUsers', token: A, password: 'welcome@123', rows: [
    { row: 2, name: 'Payel Sen', email: 'Payel@A.in', phone: '9876543210', role: 'Doer', dept: 'Despatch', jobProfile: 'Executive', manager: 'Sruti Das' },
    { row: 3, name: 'Imran Q', email: 'imran@a.in', role: 'Manager', dept: 'Quality', manager: 'o@a.in' },
    { row: 4, name: 'Nita Bose', email: 'nita@a.in', role: '', dept: 'Quality', manager: 'Imran Q' },
    { row: 5, name: 'Bad Email', email: 'not-an-email' },
    { row: 6, name: 'Twice', email: 'payel@a.in' },
    { row: 7, name: '', email: 'noname@a.in' },
    { row: 8, name: 'Ghost Report', email: 'ghost@a.in', manager: 'Somebody Unknown' },
    { row: 9, name: 'Second Sruti', email: 'sruti2@a.in', username: 'sruti' },
  ] });
  const res = (n) => (r.results || []).find((x) => x.row === n) || {};
  ok('the good rows are added and the bad ones reported, one by one', r.status === 'success' && r.added === 4, JSON.stringify(r).slice(0, 400));
  ok('emails are kept in lower case', users().some((u) => u.email === 'payel@a.in'));
  const payel = users().find((u) => u.email === 'payel@a.in') || {};
  ok('"Reports to" by full name finds the person', payel.manager === 'sruti', payel.manager);
  ok('and by email', (users().find((u) => u.email === 'imran@a.in') || {}).manager === (users().find((u) => u.email === 'o@a.in') || {}).username);
  ok('and someone added earlier in the same sheet', (users().find((u) => u.email === 'nita@a.in') || {}).manager === (users().find((u) => u.email === 'imran@a.in') || {}).username);
  ok('"Manager" in the role column means HOD; blank means Doer', (users().find((u) => u.email === 'imran@a.in') || {}).role === 'HOD' && (users().find((u) => u.email === 'nita@a.in') || {}).role === 'Doer');
  ok('phone, department and job profile come across', payel.phone === '9876543210' && payel.dept === 'Despatch' && payel.jobProfile === 'Executive', JSON.stringify(payel));
  ok('a bad email is reported', res(5).status === 'error' && /valid email/.test(res(5).message));
  ok('a duplicate in the team is reported', res(6).status === 'error' && /already/.test(res(6).message), res(6).message);
  ok('a row with no name is reported', res(7).status === 'error' && /No name/.test(res(7).message));
  ok('an unknown "Reports to" is reported, not guessed', res(8).status === 'error' && /not in the team/.test(res(8).message), res(8).message);
  ok('a username already taken gets a number, not an error', res(9).status === 'added' && res(9).username === 'sruti2', JSON.stringify(res(9)));
  ok('everyone added can sign in with the starting password', call({ action: 'login', username: 'nita@a.in', password: 'welcome@123' }).status === 'success');
  ok('and gets the welcome email', env.mails.some((m) => m.to === 'nita@a.in'));

  console.log('\n=== who may import, and the limits ===');
  const D = call({ action: 'login', username: 'payel@a.in', password: 'welcome@123' }).token;
  ok('a Doer cannot', /manager account/.test(call({ action: 'importUsers', token: D, password: 'welcome@123', rows: [{ name: 'X', email: 'x@a.in' }] }).message));
  const H = call({ action: 'login', username: 'sruti@a.in', password: 'staffpass123' }).token;
  const h = call({ action: 'importUsers', token: H, password: 'welcome@123', rows: [{ name: 'Boss', email: 'boss@a.in', role: 'Admin' }] });
  ok('a head of department cannot make an Admin through a sheet either', h.results && h.results[0].status === 'error' && /Only an Admin/.test(h.results[0].message), JSON.stringify(h));
  ok('a short starting password is refused', /at least 8/.test(call({ action: 'importUsers', token: A, password: 'short', rows: [{ name: 'X', email: 'x@a.in' }] }).message));
  ok('an empty sheet is refused', /nobody/.test(call({ action: 'importUsers', token: A, password: 'welcome@123', rows: [] }).message));
  const many = Array.from({ length: 51 }, (_, i) => ({ name: 'P' + i, email: 'p' + i + '@a.in' }));
  ok('more than 50 in one call is refused (the page sends batches)', /at most 50/.test(call({ action: 'importUsers', token: A, password: 'welcome@123', rows: many }).message));
  if (label === 'Domebox Lite') continue;   // Lite is one company: there is no other to sign in to
  const B = call({ action: 'register', form: { companyName: 'Other', name: 'Other Owner', email: 'x@b.in', password: 'ownerpass123' } }).token;
  const cross = call({ action: 'importUsers', token: B, password: 'welcome@123', rows: [{ name: 'Payel Again', email: 'payel@a.in' }] });
  ok('an email that signs in to another company is refused', cross.results && cross.results[0].status === 'error' && /another Domebox workspace/.test(cross.results[0].message), JSON.stringify(cross));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
