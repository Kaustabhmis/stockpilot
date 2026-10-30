/**
 * The Admin switches the company to the two-step workflow from the account
 * menu; the board loses its In Progress column, the owner gets Submit for
 * review straight from To do, and Send back returns the task to To do.
 */
const { chromium } = require('playwright');
const http = require('http');
const post = (body) => new Promise((res, rej) => { const d = JSON.stringify(body);
  const r = http.request({ host: 'localhost', port: 8095, path: '/exec', method: 'POST', headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(d) } },
    (s) => { let b = ''; s.on('data', (c) => b += c); s.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); });
  r.on('error', rej); r.write(d); r.end(); });
const hit = (p) => new Promise((res) => http.get('http://localhost:8095' + p, (r) => { r.resume(); r.on('end', res); }));
const SHOTS = process.env.SHOTS || '';

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 200) + ']')); v ? pass++ : fail++; };
  const R = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const email = 'wf+' + R + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering', name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Yearly');
  await post({ action: 'addUser', token: A, form: { name: 'Sruti Charulata', username: 'sruti' + R, email: 'sruti' + R + '@acme.in', role: 'HOD', dept: 'Operations', jobProfile: 'Head', password: 'staffpass123' } });
  await post({ action: 'addUser', token: A, form: { name: 'Payel Sanyamath', username: 'payel' + R, email: 'payel' + R + '@acme.in', role: 'Doer', dept: 'Operations', manager: 'sruti' + R, jobProfile: 'Exec', password: 'staffpass123' } });
  const S = (await post({ action: 'login', username: 'sruti' + R + '@acme.in', password: 'staffpass123' })).token;
  await post({ action: 'createTask', token: S, form: { title: 'Vendor audit — Kolkata plant', assignTo: 'payel' + R, dueDate: '2026-11-12', priority: 'High', checklist: 'Collect ISO certificates\nSite visit' } });
  await post({ action: 'createTask', token: S, form: { title: 'Monthly stock count', assignTo: 'payel' + R, dueDate: '2026-11-15', priority: 'Medium' } });
  const ids = Object.fromEntries((await post({ action: 'getDashboard', token: A })).tasks.map((t) => [t.title, t.id]));

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const signIn = async (user, pw) => { const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://localhost:8095/?login=1', { waitUntil: 'networkidle' });
    await p.fill('#liUser', user); await p.fill('#liPass', pw); await p.click('#btnLogin'); await p.waitForTimeout(1800); return p; };
  const cols = (p) => p.$$eval('#board .colhead', (h) => h.map((x) => x.textContent.trim().toUpperCase()));

  console.log('\n=== the Admin sets it ===');
  const a = await signIn(email, 'strongpass123');
  ok('the board starts with an In progress column', (await cols(a)).some((c) => /IN PROGRESS/.test(c)), await cols(a));
  await a.click('#btnAccount'); await a.waitForTimeout(400);
  ok('the account menu has Task workflow', await a.isVisible('button:has-text("Task workflow")'));
  await a.click('button:has-text("Task workflow")'); await a.waitForTimeout(400);
  ok('it offers three steps (chosen) and two steps',
    await a.isChecked('#fWorkflow input[value="standard"]') && await a.isVisible('#fWorkflow input[value="short"]'));
  await a.check('#fWorkflow input[value="short"]');
  if (SHOTS) await a.screenshot({ path: SHOTS + '/1-workflow-setting.png' });
  await a.click('#fWorkflow button[type=submit]'); await a.waitForTimeout(1500);
  ok('after saving, the board has no In progress column', !(await cols(a)).some((c) => /IN PROGRESS/.test(c)) && (await cols(a)).length === 4, await cols(a));
  if (SHOTS) { await a.keyboard.press('Escape'); await a.waitForTimeout(400); await a.screenshot({ path: SHOTS + '/2-board-two-steps.png' }); }

  console.log('\n=== a head of department and staff do not get the setting ===');
  const h = await signIn('sruti' + R + '@acme.in', 'staffpass123');
  await h.click('#btnAccount'); await h.waitForTimeout(400);
  ok('no Task workflow button for a head of department', !(await h.isVisible('button:has-text("Task workflow")')));
  await h.evaluate(() => closeModal());

  console.log('\n=== the owner submits straight from To do ===');
  const p = await signIn('payel' + R + '@acme.in', 'staffpass123');
  await p.evaluate((i) => openTask(i), ids['Monthly stock count']); await p.waitForTimeout(500);
  ok('the task offers Submit for review, not Start work',
    await p.isVisible('#drawer [data-act="submit"]') && !(await p.$('#drawer [data-act="start"]')));
  if (SHOTS) await p.screenshot({ path: SHOTS + '/3-submit-from-todo.png' });
  await p.click('#drawer [data-act="submit"]'); await p.waitForTimeout(400);
  await p.click('#fStatusChange button[type=submit]'); await p.waitForTimeout(1500);
  const st = await p.evaluate((i) => taskById(i).status, ids['Monthly stock count']);
  ok('and it goes to For review', st === 'For Review', st);
  await p.evaluate((i) => openTask(i), ids['Vendor audit — Kolkata plant']); await p.waitForTimeout(500);
  ok('with steps left, Submit is held and says why', await p.isDisabled('#drawer [data-act="submit"]') &&
    (await p.textContent('#drawer')).includes('Checklist is 0/2'));

  console.log('\n=== Send back returns it to To do ===');
  await h.evaluate(() => refresh()); await h.waitForTimeout(1200);
  await h.evaluate((i) => openTask(i), ids['Monthly stock count']); await h.waitForTimeout(500);
  await h.click('#drawer [data-act="rework"]'); await h.waitForTimeout(400);
  ok('Send back asks for a reason and a new date', await h.isVisible('#stDate') && await h.isVisible('#stNote'));
  await h.fill('#stNote', 'Count the second store too');
  await h.click('#fStatusChange button[type=submit]'); await h.waitForTimeout(1500);
  const after = await h.evaluate((i) => taskById(i), ids['Monthly stock count']);
  ok('it is back in To do, counted as rework', after.status === 'Pending' && after.reworkCount === 1, JSON.stringify({ s: after.status, r: after.reworkCount }));

  ok('no script errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
