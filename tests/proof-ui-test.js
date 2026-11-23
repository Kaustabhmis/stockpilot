/**
 * Photo proof on screen: the doer opens "Submit for review", adds a photo
 * (a large one, made small in the browser), and the owner opens it from the
 * task's history. Handing in without a photo works as before.
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
  const email = 'pf+' + R + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering', name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Yearly');
  await post({ action: 'addUser', token: A, form: { name: 'Payel Sanyamath', username: 'payel' + R, email: 'payel' + R + '@acme.in', role: 'Doer', dept: 'Ops', jobProfile: 'Exec', password: 'staffpass123' } });
  await post({ action: 'createTask', token: A, form: { title: 'Clean coolant tank CNC-3', assignTo: 'payel' + R, dueDate: '2030-12-12' } });
  await post({ action: 'createTask', token: A, form: { title: 'Count bin A', assignTo: 'payel' + R, dueDate: '2030-12-12' } });
  const P = (await post({ action: 'login', username: 'payel' + R + '@acme.in', password: 'staffpass123' })).token;
  const mine = ((await post({ action: 'getDashboard', token: P })).tasks || []);
  for (const t of mine) await post({ action: 'updateTask', token: P, taskId: t.id, status: 'In Progress' });

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errs = [];
  const signIn = async (user, pw, w, h) => { const p = await b.newPage({ viewport: { width: w || 1400, height: h || 900 } });
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://localhost:' + PORT + '/?login=1', { waitUntil: 'networkidle' });
    await p.fill('#liUser', user); await p.fill('#liPass', pw); await p.click('#btnLogin'); await p.waitForTimeout(1800); return p; };
  const openCard = async (p, title) => { await p.click('.card:has-text("' + title + '")'); await p.waitForTimeout(500); };

  console.log('\n=== the doer hands in with a photo ===');
  const p = await signIn('payel' + R + '@acme.in', 'staffpass123');
  await openCard(p, 'Clean coolant tank CNC-3');
  await p.click('#drawer [data-act="submit"]'); await p.waitForTimeout(400);
  ok('"Submit for review" offers an optional photo', await p.isVisible('#stPhotoBtn') && /optional/i.test(await p.textContent('#stPhotoBox')));
  await p.setInputFiles('#stPhoto', __dirname + '/fixtures-photo.jpg'); await p.waitForTimeout(1200);
  ok('the photo shows in the dialog at once', await p.isVisible('#stPhotoPrev'));
  const size = await p.evaluate(() => document.querySelector('#stPhotoPrev').src.length);
  ok('made small in the browser: a 1600x1200 photo is sent as a JPEG under 600 KB', size > 1000 && size < 600000, size);
  if (SHOTS) await p.screenshot({ path: SHOTS + '/1-handin-photo.png' });
  await p.fill('#stNote', 'Tank cleaned and refilled');
  await p.click('#fStatusChange button[type=submit]'); await p.waitForTimeout(2000);
  const d1 = ((await post({ action: 'getDashboard', token: P })).tasks || []).find((t) => t.title === 'Clean coolant tank CNC-3');
  ok('the task is handed in, with the photo on its history', d1.status === 'For Review' && !!(d1.history || []).slice(-1)[0].proof, d1.status);

  console.log('\n=== and without one, as before ===');
  await openCard(p, 'Count bin A');
  await p.click('#drawer [data-act="submit"]'); await p.waitForTimeout(400);
  await p.click('#fStatusChange button[type=submit]'); await p.waitForTimeout(2000);
  const d2 = ((await post({ action: 'getDashboard', token: P })).tasks || []).find((t) => t.title === 'Count bin A');
  ok('handing in with no photo still works', d2.status === 'For Review' && !(d2.history || []).slice(-1)[0].proof, d2.status);

  console.log('\n=== the owner checks it ===');
  const a = await signIn(email, 'strongpass123');
  await openCard(a, 'Clean coolant tank CNC-3');
  ok('the history says there is a photo', await a.isVisible('#drawer .proofBtn'));
  await a.click('#drawer .proofBtn'); await a.waitForTimeout(1200);
  ok('the owner opens it full size', await a.isVisible('img[alt="Photo proof"]') &&
     await a.evaluate(() => /^data:image\/jpeg;base64,/.test(document.querySelector('img[alt="Photo proof"]').src)));
  if (SHOTS) await a.screenshot({ path: SHOTS + '/2-owner-sees-photo.png' });
  await a.close();

  console.log('\n=== on a phone ===');
  const m = await signIn('payel' + R + '@acme.in', 'staffpass123', 390, 844);
  await m.evaluate(() => openStatus(STATE.data.tasks.find((t) => t.status === 'For Review').id, 'For Review'));
  await m.waitForTimeout(400);
  ok('the photo option fits a phone', await m.evaluate(() => document.querySelector('#stPhotoBox').scrollWidth <= document.querySelector('#stPhotoBox').clientWidth + 1));
  ok('and the phone camera can be used directly', (await m.getAttribute('#stPhoto', 'capture')) === 'environment');
  if (SHOTS) await m.screenshot({ path: SHOTS + '/3-handin-phone.png' });
  await m.close();

  ok('no script errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
