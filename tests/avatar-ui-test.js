/**
 * Avatars on screen: anyone opens Account > Choose avatar, picks one, and it
 * shows on their cards and in the top bar for everyone; "Initials" puts it
 * back as it was.
 */
const { chromium } = require('playwright');
const http = require('http');
const PORT = Number(process.env.PORT || 8095);
const post = (body) => new Promise((res, rej) => { const d = JSON.stringify(body);
  const r = http.request({ host: 'localhost', port: PORT, path: '/exec', method: 'POST', headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(d) } },
    (s) => { let b = ''; s.on('data', (c) => b += c); s.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); });
  r.on('error', rej); r.write(d); r.end(); });
const hit = (p) => new Promise((res) => http.get('http://localhost:' + PORT + p, (r) => { r.resume(); r.on('end', res); }));
const SHOTS = process.env.SHOTS || '';

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 200) + ']')); v ? pass++ : fail++; };
  const R = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const email = 'av+' + R + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering', name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Yearly');
  await post({ action: 'addUser', token: A, form: { name: 'Payel Sanyamath', username: 'payel' + R, email: 'payel' + R + '@acme.in', role: 'Doer', dept: 'Ops', jobProfile: 'Exec', password: 'staffpass123' } });
  await post({ action: 'createTask', token: A, form: { title: 'Gate fabrication', assignTo: 'payel' + R, dueDate: '2026-12-12' } });

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errs = [];
  const signIn = async (user, pw, w, h) => { const p = await b.newPage({ viewport: { width: w || 1400, height: h || 900 } });
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://localhost:' + PORT + '/?login=1', { waitUntil: 'networkidle' });
    await p.fill('#liUser', user); await p.fill('#liPass', pw); await p.click('#btnLogin'); await p.waitForTimeout(1800); return p; };

  console.log('\n=== a team member picks an avatar ===');
  const p = await signIn('payel' + R + '@acme.in', 'staffpass123');
  ok('before: initials on her card, as now', !!(await p.$('.card span.av')) && !(await p.$('.card img.av')));
  await p.click('#btnAccount'); await p.waitForTimeout(400);
  ok('everyone has "Choose avatar" in the account menu, not only the Admin', await p.isVisible('#btnPickAvatar'));
  await p.click('#btnPickAvatar'); await p.waitForTimeout(400);
  ok('the picker shows initials, upload a photo, and 12 avatars', (await p.$$('#avGrid .avPick')).length === 14);
  ok('initials are selected to begin with', (await p.getAttribute('#avGrid .avPick[data-id=""]', 'aria-pressed')) === 'true');
  await p.click('#avGrid .avPick[data-id="f3"]'); await p.waitForTimeout(200);
  if (SHOTS) await p.screenshot({ path: SHOTS + '/1-avatar-picker.png' });
  await p.click('#fAvatar button[type=submit]'); await p.waitForTimeout(1800);
  ok('her card now shows the avatar', !!(await p.$('.card img.av')));
  ok('and the top bar too', await p.isVisible('#btnAccount img.myav'));
  if (SHOTS) await p.screenshot({ path: SHOTS + '/2-board-with-avatar.png' });

  console.log('\n=== everyone sees it ===');
  const a = await signIn(email, 'strongpass123');
  ok('the owner sees her avatar on her card', !!(await a.$('.card img.av')));
  ok('the owner, who has not picked one, still has initials up top', !(await a.$('#btnAccount img.myav')));
  await a.click('button[data-tab="team"]:visible'); await a.waitForTimeout(800);
  ok('and in the Team list', !!(await a.$('#tab-team img.av')));
  await a.close();

  console.log('\n=== on a phone ===');
  const m = await signIn('payel' + R + '@acme.in', 'staffpass123', 390, 844);
  await m.evaluate(() => openAvatarPicker()); await m.waitForTimeout(400);
  ok('the picker fits a phone', await m.evaluate(() => document.querySelector('#avGrid').scrollWidth <= document.querySelector('#avGrid').clientWidth + 1));
  if (SHOTS) await m.screenshot({ path: SHOTS + '/3-avatar-picker-phone.png' });
  await m.close();

  console.log('\n=== a photo of her own ===');
  const sent = [];
  p.on('request', (q) => { const b = q.postData() || ''; if (/"action":"setAvatar"/.test(b)) sent.push(b); });
  await p.evaluate(() => openAvatarPicker()); await p.waitForTimeout(400);
  await p.setInputFiles('#avFile', __dirname + '/fixtures-photo.jpg'); await p.waitForTimeout(1200);
  ok('a large photo (1600x1200) is squared and shown in the picker at once', await p.isVisible('#avGrid img[alt="Your photo"]'));
  if (SHOTS) await p.screenshot({ path: SHOTS + '/4-photo-picked.png' });
  await p.click('#fAvatar button[type=submit]'); await p.waitForTimeout(2000);
  const body = sent[0] || '';
  const photo = (body.match(/"photo":"([^"]+)"/) || [])[1] || '';
  ok('it is sent compressed: a small JPEG, not the original', /^data:image\/jpeg;base64,/.test(photo) && photo.length < 15000, photo.length);
  ok('and shows on her cards and in the top bar', !!(await p.$('.card img.av[src^="data:image/jpeg"]')) && await p.isVisible('#btnAccount img.myav'));
  const o = await signIn(email, 'strongpass123');
  await o.waitForTimeout(1500);
  ok('the owner\u2019s screen fetches it and shows it on her card', !!(await o.$('.card img.av[src^="data:image/jpeg"]')));
  if (SHOTS) await o.screenshot({ path: SHOTS + '/5-owner-sees-photo.png' });
  await o.close();

  console.log('\n=== back to initials ===');
  await p.evaluate(() => openAvatarPicker()); await p.waitForTimeout(400);
  await p.click('#avGrid .avPick[data-id=""]'); await p.click('#fAvatar button[type=submit]'); await p.waitForTimeout(1800);
  ok('initials again, exactly as before', !!(await p.$('.card span.av')) && !(await p.$('.card img.av')) && !(await p.$('#btnAccount img.myav')));

  ok('no script errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
