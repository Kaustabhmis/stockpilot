/**
 * Who signs in where, across companies: one email opens one workspace, a
 * username shared by two companies does not lock either out, and changing a
 * person's email moves their sign-in with it.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 260) + ']')); v ? pass++ : fail++; };

const env = build();
Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b' });
env.newFile('MASTER', 'Domebox Master');
const tpl = env.newFile('TEMPLATE', 'Template');
['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
tpl.getSheetByName('Settings').appendRow(['General']);
const SRC = fs.readFileSync(__dirname + '/../dist/code.gs', 'utf8');
const names = Object.keys(env.G);
const P = new Function(...names, SRC + '\n;return { doPost, ensureRegistry, createDemoAccount, removeDemoAccount };')(...names.map((n) => env.G[n]));
P.ensureRegistry();
const call = (b) => JSON.parse(P.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
const login = (u, pw) => call({ action: 'login', username: u, password: pw });

const A = call({ action: 'register', form: { companyName: 'Acme Forgings', name: 'Anil', email: 'anil@acme.in', password: 'ownerpass123' } });
const B = call({ action: 'register', form: { companyName: 'Mehta Castings', name: 'Rohan', email: 'rohan@mehta.in', password: 'ownerpass123' } });
const add = (tok, f) => call({ action: 'addUser', token: tok, form: Object.assign({ role: 'Doer', manager: '', jobProfile: 'X' }, f) });

console.log('\n=== one email opens one workspace ===');
ok('Acme adds Payel', add(A.token, { name: 'Payel A', username: 'payel', email: 'payel@gmail.com', password: 'acmepass123' }).status === 'success');
const dup = add(B.token, { name: 'Payel B', username: 'payel', email: 'payel@gmail.com', password: 'mehtapass123' });
ok('Mehta cannot add the same email — and is told why, in plain words', dup.status === 'error' && /another Domebox workspace/.test(dup.message), JSON.stringify(dup));
ok('the owner’s email of another company is refused too', add(B.token, { name: 'X', username: 'x1', email: 'anil@acme.in', password: 'xxxxxxxx1' }).status === 'error');
const l1 = login('payel@gmail.com', 'acmepass123');
ok('and Payel still signs in to Acme, untouched', l1.status === 'success' && l1.company === 'Acme Forgings', JSON.stringify(l1).slice(0, 200));

console.log('\n=== the same username in two companies ===');
ok('Mehta adds its own Payel with another email', add(B.token, { name: 'Payel B', username: 'payel', email: 'payel@mehta.in', password: 'mehtapass123' }).status === 'success');
const lb = login('payel', 'mehtapass123');
ok('“payel” with Mehta’s password opens Mehta (before the fix, Acme’s row was hit first and she was refused)',
   lb.status === 'success' && lb.company === 'Mehta Castings', JSON.stringify(lb).slice(0, 200));
const la = login('payel', 'acmepass123');
ok('“payel” with Acme’s password still opens Acme', la.status === 'success' && la.company === 'Acme Forgings', JSON.stringify(la).slice(0, 200));
ok('a wrong password opens neither', login('payel', 'wrongpass99').status === 'error');

console.log('\n=== changing someone’s email ===');
const ch = call({ action: 'updateUser', token: B.token, form: { originalUsername: 'payel', email: 'payel.das@mehta.in' } });
ok('the owner changes Payel’s email', ch.status === 'success', JSON.stringify(ch));
ok('she signs in with the new one', login('payel.das@mehta.in', 'mehtapass123').status === 'success');
ok('the old one no longer works', login('payel@mehta.in', 'mehtapass123').status === 'error');
call({ action: 'updateUser', token: B.token, form: { originalUsername: 'payel', password: 'newpass12345' } });
ok('a password set after the change takes effect (before the fix it silently did not)', login('payel.das@mehta.in', 'newpass12345').status === 'success');
const steal = call({ action: 'updateUser', token: B.token, form: { originalUsername: 'payel', email: 'payel@gmail.com' } });
ok('her email cannot be changed to one that signs in elsewhere', steal.status === 'error' && /another Domebox workspace/.test(steal.message), JSON.stringify(steal));
ok('and Acme’s Payel is unaffected', login('payel@gmail.com', 'acmepass123').company === 'Acme Forgings');

console.log('\n=== after someone leaves ===');
const rm = call({ action: 'deleteUser', token: A.token, username: 'payel' });
ok('Acme removes Payel', rm.status === 'success', JSON.stringify(rm));
ok('so Mehta may now take that email', add(B.token, { name: 'Payel G', username: 'payelg', email: 'payel@gmail.com', password: 'mehtapass123' }).status === 'success');
ok('and it signs in to Mehta', login('payel@gmail.com', 'mehtapass123').company === 'Mehta Castings');

console.log('\n=== the demo, rebuilt ===');
P.createDemoAccount();
ok('the demo opens as staff', call({ action: 'openDemo', as: 'staff' }).status === 'success');
P.removeDemoAccount();
const left = env.FILES.MASTER.getSheetByName('Global_Users').getDataRange().getValues().filter((r) => /@demo\.domebox\.in$/.test(String(r[0])));
ok('removing it takes its staff sign-ins with it, not just the owner’s', left.length === 0, JSON.stringify(left));
P.createDemoAccount();
const again = call({ action: 'openDemo', as: 'staff' }), mgr = call({ action: 'openDemo', as: 'manager' });
ok('so building it again works, every view', again.status === 'success' && mgr.status === 'success', JSON.stringify([again, mgr]).slice(0, 240));
{
  /* A row left behind by a company removed the old way must not block anyone. */
  const g = env.FILES.MASTER.getSheetByName('Global_Users');
  g.appendRow(['orphan@old.in', 'x', 'SHEET_THAT_IS_GONE', 'orphan']);
  ok('an email left behind by a removed company can be used again',
     add(B.token, { name: 'Orphan', username: 'orph', email: 'orphan@old.in', password: 'orphanpass1' }).status === 'success');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
