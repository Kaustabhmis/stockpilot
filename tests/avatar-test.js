/**
 * Avatars: anyone can pick one of the professional avatars for themselves, or
 * keep their initials (the default). Only their own; only one of the set;
 * everyone in the company sees it. An existing workspace gains the Avatar
 * column on its next visit, with nothing moved. Both editions.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 220) + ']')); v ? pass++ : fail++; };

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
  const msg = (b) => { const r = call(b); return r.status === 'error' ? r.message : ''; };
  const A = call({ action: 'register', form: { companyName: 'Acme', name: 'Owner One', email: 'o@a.in', password: 'ownerpass123' } }).token;
  call({ action: 'addUser', token: A, form: { name: 'Payel Sen', username: 'payel', email: 'payel@a.in', role: 'Doer', jobProfile: 'Ops', password: 'staffpass123' } });
  call({ action: 'addUser', token: A, form: { name: 'Vikram Rao', username: 'vikram', email: 'vikram@a.in', role: 'Doer', jobProfile: 'Ops', password: 'staffpass123' } });
  const P = call({ action: 'login', username: 'payel@a.in', password: 'staffpass123' }).token;
  const V = call({ action: 'login', username: 'vikram@a.in', password: 'staffpass123' }).token;
  const of = (tok, name) => ((call({ action: 'getDashboard', token: tok }).staff || []).find((u) => u.name === name) || {}).avatar;

  console.log('\n=== out of the box, initials as before ===');
  ok('nobody has an avatar until they pick one', of(A, 'Payel Sen') === '' && of(A, 'Owner One') === '', of(A, 'Payel Sen'));

  console.log('\n=== picking one ===');
  const r = call({ action: 'setAvatar', token: P, avatar: 'f3' });
  ok('a team member picks an avatar for themselves', r.status === 'success' && r.avatar === 'f3', JSON.stringify(r));
  ok('the owner sees it', of(A, 'Payel Sen') === 'f3');
  ok('and so does a colleague', of(V, 'Payel Sen') === 'f3');
  ok('it is saved on her own row only', of(A, 'Vikram Rao') === '' && of(A, 'Owner One') === '');
  ok('the owner can pick one too', call({ action: 'setAvatar', token: A, avatar: 'm6' }).status === 'success' && of(V, 'Owner One') === 'm6');

  console.log('\n=== what is refused ===');
  ok('anything not in the set', /Pick one of the avatars/.test(msg({ action: 'setAvatar', token: P, avatar: 'x9' })));
  ok('a picture of your own (only the set is allowed)', /Pick one of the avatars/.test(msg({ action: 'setAvatar', token: P, avatar: 'https://example.com/me.png' })));
  ok('and nobody can set someone else’s: the call has no "for whom"', call({ action: 'setAvatar', token: V, avatar: 'm1', username: 'payel' }).status === 'success' &&
     of(A, 'Payel Sen') === 'f3' && of(A, 'Vikram Rao') === 'm1');

  console.log('\n=== going back ===');
  ok('keeping initials puts it back as it was', call({ action: 'setAvatar', token: P, avatar: '' }).message === 'Back to your initials.' && of(A, 'Payel Sen') === '');

  console.log('\n=== a photo of your own ===');
  /* A real 2x2 JPEG, as the browser would send after squaring and compressing. */
  const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAIBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
  const up = call({ action: 'setAvatar', token: P, avatar: 'photo', photo: jpeg });
  ok('a team member uploads a photo', up.status === 'success' && /^p:/.test(up.avatar) && up.message === 'Photo saved.', JSON.stringify(up));
  const key = of(A, 'Payel Sen');
  ok('the board carries a short key for it, not the picture', key === up.avatar && key.length < 24, key);
  const dash = JSON.stringify(call({ action: 'getDashboard', token: V }));
  ok('so the board stays small however many photos there are', dash.indexOf('base64') < 0);
  const got = call({ action: 'getAvatarPhotos', token: V, keys: [key, 'p:madeup'] });
  ok('a colleague fetches it once by its key', got.status === 'success' && got.photos[key] === jpeg && !got.photos['p:madeup'], JSON.stringify(got).slice(0, 160));
  ok('an SVG is refused (only JPEG, PNG or WebP)', /could not be read/.test(msg({ action: 'setAvatar', token: P, avatar: 'photo', photo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })));
  ok('so is a script link', /could not be read/.test(msg({ action: 'setAvatar', token: P, avatar: 'photo', photo: 'javascript:alert(1)' })));
  ok('and anything that is not a picture', /could not be read/.test(msg({ action: 'setAvatar', token: P, avatar: 'photo', photo: 'data:image/jpeg;base64,<img onerror=x>' })));
  ok('a photo too large to be the compressed one is refused', /too large/.test(msg({ action: 'setAvatar', token: P, avatar: 'photo', photo: 'data:image/jpeg;base64,' + 'A'.repeat(20000) })));
  ok('the photo she had stays after a refused upload', of(A, 'Payel Sen') === key);
  ok('and she can still go back to initials', call({ action: 'setAvatar', token: P, avatar: '' }).status === 'success' && of(A, 'Payel Sen') === '');

  console.log('\n=== an existing workspace ===');
  const tenant = Object.values(env.FILES).find((f) => f !== tpl && f.getSheetByName && f.getSheetByName('Users') && f.getSheetByName('Tasks'));
  const head = tenant.getSheetByName('Users').getDataRange().getValues()[0];
  ok('the Avatar column is added after every existing column, nothing moved', head[head.length - 1] === 'Avatar' && head[head.length - 2] === 'WhatsApp OptIn', head.join('|'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
