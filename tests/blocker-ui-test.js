/**
 * Add blocker on screen: one box suggests matching tasks; anything that does
 * not match is added as a custom blocker. The task panel lists blockers with
 * Resolved / Remove, and the card says Blocked only while one is open.
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
  const email = 'bk+' + R + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering', name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Yearly');
  await post({ action: 'addUser', token: A, form: { name: 'Payel Sen', username: 'payel' + R, email: 'payel' + R + '@acme.in', role: 'Doer', jobProfile: 'Exec', password: 'staffpass123' } });
  await post({ action: 'createTask', token: A, form: { title: 'Machine the flanges', assignTo: 'payel' + R, dueDate: '2030-12-12' } });

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errs = [];
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:' + PORT + '/?login=1', { waitUntil: 'networkidle' });
  await p.fill('#liUser', 'payel' + R + '@acme.in'); await p.fill('#liPass', 'staffpass123'); await p.click('#btnLogin'); await p.waitForTimeout(1800);

  console.log('\n=== with no other task to pick ===');
  await p.click('.card:has-text("Machine the flanges")'); await p.waitForTimeout(500);
  ok('the person doing the task sees "Add blocker"', await p.isVisible('#drawer [data-act="block"]'));
  await p.click('#drawer [data-act="block"]'); await p.waitForTimeout(400);
  ok('it opens even when no other task exists (it used to refuse)', await p.isVisible('#blkText') && /no other open task/.test(await p.textContent('#fBlk')));
  await p.fill('#blkText', 'Waiting for material from the vendor'); await p.waitForTimeout(150);
  ok('the hint says it will be a custom blocker', /custom blocker/.test(await p.textContent('#blkHint')));
  if (SHOTS) await p.screenshot({ path: SHOTS + '/blocker-1-custom.png' });
  await p.click('#fBlk button[type=submit]'); await p.waitForTimeout(2200);
  ok('the panel lists it, marked as a custom blocker by whom', /Waiting for material from the vendor/.test(await p.textContent('#drawer')) && /Custom blocker · added by Payel Sen/.test(await p.textContent('#drawer')));
  ok('Start work is held back while it is open', await p.isDisabled('#drawer [data-act="start"]'));
  ok('the card says Blocked', /Blocked/.test(await p.textContent('.card:has-text("Machine the flanges")')));
  if (SHOTS) await p.screenshot({ path: SHOTS + '/blocker-2-panel.png' });

  console.log('\n=== matching an existing task ===');
  await post({ action: 'createTask', token: A, form: { title: 'Order the steel bar', assignTo: 'payel' + R, dueDate: '2030-12-10' } });
  await p.evaluate(() => refresh(true)); await p.waitForTimeout(1500);
  await p.evaluate(() => openTask(STATE.data.tasks.find((t) => t.title === 'Machine the flanges').id)); await p.waitForTimeout(400);
  await p.click('#drawer [data-act="block"]'); await p.waitForTimeout(300);
  ok('open tasks are offered as suggestions', (await p.$$eval('#blkList option', (o) => o.map((x) => x.value))).some((v) => /Order the steel bar/.test(v)));
  await p.fill('#blkText', 'order the steel bar'); await p.waitForTimeout(150);
  ok('typing a task’s name links that task', /Links the task/.test(await p.textContent('#blkHint')));
  await p.click('#fBlk button[type=submit]'); await p.waitForTimeout(2200);
  const items = await p.$$eval('#drawer .blkDel', (x) => x.map((e) => e.textContent.trim()));
  ok('both blockers are listed: Resolved for the note, Remove for the task', items.join('|') === 'Resolved|Remove', items.join('|'));

  console.log('\n=== resolving ===');
  await p.click('#drawer .blkDel:has-text("Resolved")'); await p.waitForTimeout(2200);
  ok('Resolved takes the note off', !/Waiting for material from the vendor/.test(await p.evaluate(() => document.querySelector('#drawer .space-y-2') ? document.querySelector('#drawer .space-y-2').textContent : '')) &&
     /Blocker resolved: Waiting for material/.test(await p.textContent('#drawer')));
  await p.click('#drawer .blkDel:has-text("Remove")'); await p.waitForTimeout(2200);
  ok('with nothing left, Start work is available again', await p.isEnabled('#drawer [data-act="start"]'));
  ok('and the card no longer says Blocked', !/Blocked/.test(await p.textContent('.card:has-text("Machine the flanges")')));
  ok('no script errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
