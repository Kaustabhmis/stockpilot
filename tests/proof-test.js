/**
 * Photo proof: a doer may attach one photo when handing work in for review.
 * It is kept in a Drive folder for that company, the checker sees it, and
 * nobody outside the task or the company can fetch it. Optional: handing in
 * without one works exactly as before. Both editions.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 220) + ']')); v ? pass++ : fail++; };

/* A real 2x2 JPEG, as the browser sends after shrinking a photo. */
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAIBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

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
  const X = new Function(...names, fs.readFileSync(__dirname + file, 'utf8') + '\n;return { doPost, ensureRegistry, eraseCompanyData };')(...names.map((n) => env.G[n]));
  X.ensureRegistry();
  const call = (b) => JSON.parse(X.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
  const msg = (b) => { const r = call(b); return r.status === 'error' ? r.message : ''; };

  const A = call({ action: 'register', form: { companyName: 'Acme', name: 'Owner One', email: 'o@a.in', password: 'ownerpass123' } }).token;
  call({ action: 'addUser', token: A, form: { name: 'Payel Sen', username: 'payel', email: 'payel@a.in', role: 'Doer', jobProfile: 'Ops', password: 'staffpass123' } });
  call({ action: 'addUser', token: A, form: { name: 'Vikram Rao', username: 'vikram', email: 'vikram@a.in', role: 'Doer', jobProfile: 'Ops', password: 'staffpass123' } });
  const P = call({ action: 'login', username: 'payel@a.in', password: 'staffpass123' }).token;
  const V = call({ action: 'login', username: 'vikram@a.in', password: 'staffpass123' }).token;
  const mk = (title) => { call({ action: 'createTask', token: A, form: { title, assignTo: 'payel', dueDate: '2030-01-10' } });
    return (call({ action: 'getDashboard', token: A }).tasks || []).find((t) => t.title === title); };
  const task = (id, tok) => (call({ action: 'getDashboard', token: tok || A }).tasks || []).find((t) => String(t.id) === String(id));

  console.log('\n=== handing in with a photo ===');
  const t1 = mk('Clean the CNC-3 coolant tank');
  call({ action: 'updateTask', token: P, taskId: t1.id, status: 'In Progress' });
  const r = call({ action: 'updateTask', token: P, taskId: t1.id, status: 'For Review', note: 'Done, see photo', photo: JPEG });
  const h = (task(t1.id).history || []).slice(-1)[0] || {};
  ok('the doer hands in with a photo', r.status === 'success' && task(t1.id).status === 'For Review', JSON.stringify(r));
  ok('the history entry carries the photo, not the picture itself', h.proof && String(h.proof).length < 40 && h.note === 'Done, see photo', JSON.stringify(h));
  const blob = env.G.DriveApp._blobs[h.proof];
  ok('saved in a Drive folder for this company', blob && /Domebox photos — Acme/.test(env.G.DriveApp._folders[blob.folder].getName()) && blob.mime === 'image/jpeg');
  ok('the board itself stays small', JSON.stringify(call({ action: 'getDashboard', token: A })).indexOf('base64') < 0);

  console.log('\n=== who can see it ===');
  const got = call({ action: 'getProofPhoto', token: A, taskId: t1.id, fileId: h.proof });
  ok('the checker (owner) opens it', got.status === 'success' && got.photo === JPEG, JSON.stringify(got).slice(0, 120));
  ok('and so does the doer', call({ action: 'getProofPhoto', token: P, taskId: t1.id, fileId: h.proof }).status === 'success');
  ok('a colleague with nothing to do with the task cannot', /not available/.test(msg({ action: 'getProofPhoto', token: V, taskId: t1.id, fileId: h.proof })));
  const t2 = mk('Count the bin A stock');
  ok('a file id cannot be borrowed through another task', /not available/.test(msg({ action: 'getProofPhoto', token: A, taskId: t2.id, fileId: h.proof })));
  const B = call({ action: 'register', form: { companyName: 'Other Co', name: 'Other Owner', email: 'x@b.in', password: 'ownerpass123' } }).token;
  ok('another company cannot fetch it at all', call({ action: 'getProofPhoto', token: B, taskId: t1.id, fileId: h.proof }).status === 'error');
  ok('nor can anyone signed out', call({ action: 'getProofPhoto', taskId: t1.id, fileId: h.proof }).status === 'error');

  console.log('\n=== optional, and checked ===');
  call({ action: 'updateTask', token: P, taskId: t2.id, status: 'In Progress' });
  ok('handing in without a photo works as before', call({ action: 'updateTask', token: P, taskId: t2.id, status: 'For Review' }).status === 'success' &&
     !(task(t2.id).history || []).slice(-1)[0].proof);
  const t3 = mk('Fix the guard on press 2');
  call({ action: 'updateTask', token: P, taskId: t3.id, status: 'In Progress' });
  ok('a picture that is not a JPEG is refused', /could not be read/.test(msg({ action: 'updateTask', token: P, taskId: t3.id, status: 'For Review', photo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })));
  ok('so is a script', /could not be read/.test(msg({ action: 'updateTask', token: P, taskId: t3.id, status: 'For Review', photo: 'javascript:alert(1)' })));
  ok('and anything too large', /too large/.test(msg({ action: 'updateTask', token: P, taskId: t3.id, status: 'For Review', photo: 'data:image/jpeg;base64,' + 'A'.repeat(800000) })));
  ok('a refused photo leaves the task where it was', task(t3.id).status === 'In Progress');
  ok('a photo sent with anything but a hand-in is ignored', call({ action: 'updateTask', token: A, taskId: t1.id, status: 'Verified', photo: JPEG }).status === 'success' &&
     !(task(t1.id).history || []).slice(-1)[0].proof);

  console.log('\n=== erasing the company ===');
  const fid = blob.folder;
  X.eraseCompanyData('o@a.in', 'ERASE o@a.in');
  ok('its photos go to the Drive bin with the rest', env.G.DriveApp._folders[fid]._trashed === true && env.G.DriveApp._blobs[h.proof].trashed === true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
