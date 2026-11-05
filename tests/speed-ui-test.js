/**
 * Instant moves on screen, with a deliberately slow server: the card moves
 * before the server answers, a "Saving…" sign shows until it does, a refusal
 * puts the card back with its reason, and the 30-second check sends the
 * version it has and is told "nothing changed".
 */
const { chromium } = require('playwright');
const http = require('http');
const PORT = Number(process.env.PORT || 8095);
const post = (body) => new Promise((res, rej) => { const d = JSON.stringify(body);
  const r = http.request({ host: 'localhost', port: PORT, path: '/exec', method: 'POST', headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(d) } },
    (s) => { let b = ''; s.on('data', (c) => b += c); s.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); });
  r.on('error', rej); r.write(d); r.end(); });
const hit = (p) => new Promise((res) => http.get('http://localhost:' + PORT + p, (r) => { r.resume(); r.on('end', res); }));

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 200) + ']')); v ? pass++ : fail++; };
  const R = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const email = 'spd+' + R + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering', name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Yearly');
  await post({ action: 'addUser', token: A, form: { name: 'Payel Sanyamath', username: 'payel' + R, email: 'payel' + R + '@acme.in', role: 'Doer', dept: 'Ops', jobProfile: 'Exec', password: 'staffpass123' } });
  await post({ action: 'createTask', token: A, form: { title: 'Gate fabrication', assignTo: 'payel' + R, dueDate: '2026-12-12', checklist: 'Weld\nPaint' } });
  await post({ action: 'createTask', token: A, form: { title: 'Stock count', assignTo: 'payel' + R, dueDate: '2026-12-15' } });

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  /* The slow server: every save waits 1.5 seconds. */
  const bodies = [];
  await p.route('**/exec', async (route) => {
    const body = route.request().postData() || ''; bodies.push(body);
    if (/"action":"(updateTask|moveStage|toggleSubtask)"/.test(body)) await new Promise((r) => setTimeout(r, 1500));
    route.continue();
  });
  await p.goto('http://localhost:' + PORT + '/?login=1', { waitUntil: 'networkidle' });
  await p.fill('#liUser', 'payel' + R + '@acme.in'); await p.fill('#liPass', 'staffpass123'); await p.click('#btnLogin'); await p.waitForTimeout(1800);
  const id = (title) => p.evaluate((t) => STATE.data.tasks.find((x) => x.title === t).id, title);
  const colOf = (tid) => p.evaluate((i) => { const c = document.querySelector('.card[data-id="' + i + '"]'); return c ? c.closest('.col').dataset.col : ''; }, tid);
  const gate = await id('Gate fabrication'), stock = await id('Stock count');

  console.log('\n=== Start work shows at once ===');
  await p.evaluate((i) => openTask(i), gate); await p.waitForTimeout(400);
  const t0 = Date.now();
  await p.click('#drawer [data-act="start"]'); await p.waitForTimeout(250);
  ok('the card is in In progress before the server has answered', (await colOf(gate)) === 'w0' && Date.now() - t0 < 1400, await colOf(gate));
  ok('and "Saving…" shows', await p.isVisible('#savingPill'));
  await p.waitForTimeout(2600);
  ok('when the server has saved it, the sign goes', !(await p.isVisible('#savingPill')));
  ok('and the server has it too', ((await post({ action: 'getDashboard', token: A })).tasks.find((x) => x.id === gate) || {}).status === 'In Progress');

  console.log('\n=== a refusal puts the card back ===');
  await p.dragAndDrop('.card[data-id="' + gate + '"]', '#board .col[data-col="review"]'); await p.waitForTimeout(250);
  ok('dragged to For review, it moves at once', (await colOf(gate)) === 'review', await colOf(gate));
  await p.waitForTimeout(2200);
  ok('the checklist is not finished, so the server says no and the card goes back', (await colOf(gate)) === 'w0', await colOf(gate));
  ok('with the reason on screen', /checklist/i.test(await p.textContent('body')));
  await p.evaluate(() => { if (typeof closeDialog === 'function') closeDialog(true); }); await p.waitForTimeout(300);
  ok('and nothing was changed on the server', ((await post({ action: 'getDashboard', token: A })).tasks.find((x) => x.id === gate) || {}).status === 'In Progress');

  console.log('\n=== ticking a step shows at once ===');
  await p.evaluate((i) => openTask(i), gate); await p.waitForTimeout(400);
  await p.click('#drawer .sub[data-i="0"]'); await p.waitForTimeout(250);
  ok('the step is ticked straight away', await p.evaluate((i) => taskById(i).subtasks[0].done === true, gate));
  await p.waitForTimeout(2200);
  ok('and saved', ((await post({ action: 'getDashboard', token: A })).tasks.find((x) => x.id === gate) || {}).subtasks[0].done === true);
  await p.evaluate(() => closeDrawer());

  console.log('\n=== leaving while something saves ===');
  await p.evaluate((i) => openTask(i), stock); await p.waitForTimeout(400);
  await p.click('#drawer [data-act="start"]'); await p.waitForTimeout(150);
  const asks = await p.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  ok('the browser asks before the page is left while a save is on its way', asks);
  await p.waitForTimeout(2200);

  console.log('\n=== the 30-second check ===');
  bodies.length = 0;
  await p.waitForTimeout(31500);
  const check = bodies.find((x) => /"action":"getDashboard"/.test(x)) || '';
  ok('it sends the version of the board it already has', /"since":"[^"]+"/.test(check), check.slice(0, 160));
  const v = await p.evaluate(() => STATE.data.version);
  const answer = await post({ action: 'getDashboard', token: (await p.evaluate(() => STATE.token)), since: v });
  ok('and with nothing changed the answer is "unchanged", with no board in it', answer.unchanged === true && !answer.tasks);

  console.log('\n=== with SPEED off, the slow way ===');
  await post({ action: 'createTask', token: A, form: { title: 'Vendor audit', assignTo: 'payel' + R, dueDate: '2026-12-20' } });
  await p.evaluate(() => refresh()); await p.waitForTimeout(1500);
  const audit = await id('Vendor audit');
  await p.evaluate(() => { STATE.data.speed = false; });
  await p.evaluate((i) => openTask(i), audit); await p.waitForTimeout(400);
  await p.click('#drawer [data-act="start"]'); await p.waitForTimeout(300);
  ok('Start work waits for the server: the card has not moved yet, and no "Saving…" sign', (await colOf(audit)) === 'todo' && !(await p.isVisible('#savingPill')), await colOf(audit));
  await p.waitForTimeout(3000);
  ok('and moves once the server has saved it', (await colOf(audit)) === 'w0', await colOf(audit));

  ok('no script errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
