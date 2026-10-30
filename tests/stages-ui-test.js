/**
 * Task stages on screen: the Admin designs them from the account menu, the
 * board shows one column per stage, and the person doing a task moves it
 * through them from the task panel or by dragging.
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
  const email = 'stg+' + R + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering', name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Yearly');
  await post({ action: 'addUser', token: A, form: { name: 'Sruti Charulata', username: 'sruti' + R, email: 'sruti' + R + '@acme.in', role: 'HOD', dept: 'Operations', jobProfile: 'Head', password: 'staffpass123' } });
  await post({ action: 'addUser', token: A, form: { name: 'Payel Sanyamath', username: 'payel' + R, email: 'payel' + R + '@acme.in', role: 'Doer', dept: 'Operations', manager: 'sruti' + R, jobProfile: 'Exec', password: 'staffpass123' } });
  const S = (await post({ action: 'login', username: 'sruti' + R + '@acme.in', password: 'staffpass123' })).token;
  for (const [title, due, pr] of [['Gate fabrication — Bose Steel', '2026-11-12', 'High'], ['Monthly stock count', '2026-11-15', 'Medium'], ['Vendor audit — Kolkata plant', '2026-11-18', 'Low']]) {
    await post({ action: 'createTask', token: S, form: { title, assignTo: 'payel' + R, dueDate: due, priority: pr } });
  }
  const ids = Object.fromEntries((await post({ action: 'getDashboard', token: A })).tasks.map((t) => [t.title, t.id]));

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const signIn = async (user, pw) => { const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://localhost:8095/?login=1', { waitUntil: 'networkidle' });
    await p.fill('#liUser', user); await p.fill('#liPass', pw); await p.click('#btnLogin'); await p.waitForTimeout(1800); return p; };
  const cols = (p) => p.$$eval('#board .colhead', (h) => h.map((x) => x.textContent.trim()));

  console.log('\n=== the Admin designs the stages ===');
  const a = await signIn(email, 'strongpass123');
  ok('out of the box: Needs approval, To do, In progress, For review, Verified',
    JSON.stringify(await cols(a)) === JSON.stringify(['Needs approval', 'To do', 'In progress', 'For review', 'Verified']), await cols(a));
  await a.click('#btnAccount'); await a.waitForTimeout(400);
  await a.click('button:has-text("Task stages")'); await a.waitForTimeout(400);
  ok('the dialog shows the four fixed stages and the working stages', (await a.$$('#fStages .stName')).length === 4 && (await a.$$('#fStages .stWorkName')).length === 1);
  await a.fill('#fStages .stWorkName[data-i="0"]', 'Material ordered');
  await a.fill('#stNew', 'Fabrication'); await a.press('#stNew', 'Enter');
  await a.fill('#stNew', 'Quality check'); await a.click('#stAdd');
  await a.fill('#fStages .stName[data-k="review"]', 'QC review');
  ok('the preview line follows every change', (await a.textContent('#stFlow')).replace(/\s+/g, ' ').trim() ===
    'To do → Material ordered → Fabrication → Quality check → QC review → Verified', await a.textContent('#stFlow'));
  await a.click('#fStages .stDown[data-i="0"]');
  ok('stages can be reordered', (await a.$$eval('#fStages .stWorkName', (e) => e.map((x) => x.value))).join('|') === 'Fabrication|Material ordered|Quality check');
  await a.click('#fStages .stUp[data-i="1"]');
  if (SHOTS) await a.screenshot({ path: SHOTS + '/1-task-stages-dialog.png' });
  await a.click('#fStages button[type=submit]'); await a.waitForTimeout(1600);
  ok('the board now has a column per stage', JSON.stringify(await cols(a)) ===
    JSON.stringify(['Needs approval', 'To do', 'Material ordered', 'Fabrication', 'Quality check', 'QC review', 'Verified']), await cols(a));

  console.log('\n=== a head of department does not get the setting ===');
  const h = await signIn('sruti' + R + '@acme.in', 'staffpass123');
  await h.click('#btnAccount'); await h.waitForTimeout(400);
  ok('no Task stages button for a head of department', !(await h.isVisible('button:has-text("Task stages")')));
  await h.close();

  console.log('\n=== the person doing it moves it through ===');
  const p = await signIn('payel' + R + '@acme.in', 'staffpass123');
  const gate = ids['Gate fabrication — Bose Steel'];
  await p.evaluate((i) => openTask(i), gate); await p.waitForTimeout(500);
  await p.click('#drawer [data-act="start"]'); await p.waitForTimeout(1500);
  await p.evaluate((i) => openTask(i), gate); await p.waitForTimeout(500);
  ok('after Start work it is at Material ordered', (await p.textContent('#drawer')).includes('Material ordered'));
  ok('the panel offers "Move to Fabrication", not Submit', (await p.textContent('#drawer [data-act="next"]')).includes('Move to Fabrication') && !(await p.$('#drawer [data-act="submit"]')));
  if (SHOTS) await p.screenshot({ path: SHOTS + '/3-move-to-next-stage.png' });
  await p.click('#drawer [data-act="next"]'); await p.waitForTimeout(1500);
  ok('one click moves it on', (await p.evaluate((i) => taskById(i).stage, gate)) === 'Fabrication');
  await p.evaluate(() => closeDrawer()); await p.waitForTimeout(200);
  await p.dragAndDrop('.card[data-id="' + gate + '"]', '#board .col[data-col="w2"]'); await p.waitForTimeout(1500);
  ok('dragging the card to Quality check moves it there', (await p.evaluate((i) => taskById(i).stage, gate)) === 'Quality check');
  await p.evaluate((i) => openTask(i), gate); await p.waitForTimeout(500);
  ok('from the last stage it offers Submit for review', await p.isVisible('#drawer [data-act="submit"]'));
  await p.evaluate(() => closeDrawer());
  await p.click('#viewMode button[data-mode="list"]'); await p.waitForTimeout(300);
  ok('the list shows the stage by name', (await p.textContent('#list')).includes('Quality check'));
  await p.click('#viewMode button[data-mode="board"]'); await p.waitForTimeout(300);
  /* the other two, for the picture */
  await p.evaluate(async (i) => { await api('updateTask', { taskId: i, status: 'In Progress' }); }, ids['Monthly stock count']);
  await p.evaluate(async () => { await refresh(); }); await p.waitForTimeout(800);
  if (SHOTS) await p.screenshot({ path: SHOTS + '/2-board-with-stages.png' });

  ok('no script errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
