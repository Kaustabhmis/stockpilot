/**
 * Cookie points, the org chart, and — the point of all of it — a score screen
 * that explains why ten jobs with seven on time beats one easy job done.
 */
const { chromium } = require('playwright');
const http = require('http');
const post = (body) => new Promise((res, rej) => {
  const d = JSON.stringify(body);
  const r = http.request({ host: 'localhost', port: 8095, path: '/exec', method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(d) } }, (s) => {
    let b = ''; s.on('data', (c) => b += c); s.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  });
  r.on('error', rej); r.write(d); r.end();
});
const hit = (path) => new Promise((res, rej) =>
  http.get('http://localhost:8095' + path, (r) => { r.resume(); r.on('end', res); }).on('error', rej));
const ymd = (plus) => { const d = new Date(); d.setDate(d.getDate() + plus); return d.toISOString().slice(0, 10); };

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 170) + ']')); v ? pass++ : fail++; };

  const RUN = Date.now().toString(36);
  const email = 'rec+' + RUN + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering',
    name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Yearly');
  const U = (u) => u + RUN;
  for (const [n, u, role, mgr] of [['Sruti Charulata', 'sruti', 'HOD', ''],
                                   ['Payel Sanyamath', 'payel', 'Doer', 'sruti'],
                                   ['Vikram Rathore', 'vikram', 'Doer', 'sruti']]) {
    await post({ action: 'addUser', token: A, form: { name: n, username: U(u), email: U(u) + '@acme.in',
      role, manager: mgr ? U(mgr) : '', jobProfile: 'Executive', password: 'staffpass123' } });
  }

  /* Payel carries ten and delivers seven on time. Vikram gets one easy job and
     does it. Under the old maths Vikram scored higher. */
  const P = (await post({ action: 'login', username: U('payel') + '@acme.in', password: 'staffpass123' })).token;
  const V = (await post({ action: 'login', username: U('vikram') + '@acme.in', password: 'staffpass123' })).token;
  const run = async (token, title, who, due, priority) => {
    await post({ action: 'createTask', token: A, form: { title, assignTo: who, dueDate: due, priority } });
    const t = (await post({ action: 'getDashboard', token: A })).tasks.find((x) => x.title === title);
    await post({ action: 'updateTask', token, taskId: t.id, status: 'In Progress' });
    await post({ action: 'updateTask', token, taskId: t.id, status: 'For Review' });
    await post({ action: 'updateTask', token: A, taskId: t.id, status: 'Verified' });
  };
  for (let i = 0; i < 7; i++) await run(P, 'Line job ' + i, U('payel'), ymd(5), 'High');
  for (let i = 7; i < 10; i++) await run(P, 'Line job ' + i, U('payel'), ymd(-6), 'High');  // late
  await run(V, 'One easy job', U('vikram'), ymd(5), 'Low');

  const payel = (await post({ action: 'getDashboard', token: P })).stats.scores;
  const vikram = (await post({ action: 'getDashboard', token: V })).stats.scores;
  console.log('\n--- the inversion the whole change is about ---');
  ok('ten jobs with seven on time beats one easy job done',
     payel.delegation > vikram.delegation, 'Payel ' + payel.delegation + ' vs Vikram ' + vikram.delegation);
  ok('and the hard worker is scored well, not merely higher', payel.delegation >= 80, payel.delegation);
  ok('the light record is flagged provisional rather than failed', vikram.provisional === true);

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8095/?login=1', { waitUntil: 'networkidle' });
  await p.fill('#liUser', U('payel') + '@acme.in'); await p.fill('#liPass', 'staffpass123');
  await p.click('#btnLogin'); await p.waitForTimeout(1800);

  console.log('\n--- and the screen that explains it ---');
  await p.click('text=See why'); await p.waitForTimeout(800);
  let modal = await p.locator('#modal').textContent();
  ok('the score leads with how well, times how much', /How well, times how much/.test(modal), modal.slice(0, 200));
  ok('it states the load carried', /of an expected load/.test(modal));
  ok('it spells out the formula', /how well you delivered \(\d+\) × the load you carried/.test(modal), modal.slice(0, 400));
  ok('and answers the question in plain words',
     /ten jobs with seven delivered on time outscores one easy job delivered/.test(modal));
  ok('saying that work in hand and decisions cleared count too',
     /approvals and reviews you clear for other people/.test(modal));
  await p.screenshot({ path: 'shot-26-load-score.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);

  console.log('\n--- cookie points ---');
  const S = (await post({ action: 'login', username: U('sruti') + '@acme.in', password: 'staffpass123' })).token;
  await p.evaluate(() => signOut()); await p.waitForTimeout(900);
  await p.fill('#liUser', U('sruti') + '@acme.in'); await p.fill('#liPass', 'staffpass123');
  await p.click('#btnLogin'); await p.waitForTimeout(1800);
  await p.click('[data-tab="team"]'); await p.waitForTimeout(900);
  await p.click('#btnCookie'); await p.waitForTimeout(700);
  modal = await p.locator('#modal').textContent();
  ok('the award form opens for a manager', /Cookie points/.test(modal));
  ok('it says the award is on the record at review', /on the record at their review/.test(modal));
  ok('only their own people are offered',
     (await p.locator('#ckWho option').allTextContents()).join('|') === 'Payel Sanyamath|Vikram Rathore',
     (await p.locator('#ckWho option').allTextContents()).join('|'));

  await p.click('#ckPts button[data-n="4"]');
  await p.fill('#ckWhy', 'Stayed back to clear the audit list before the visit');
  await p.screenshot({ path: 'shot-27-cookie.png' });
  await p.click('#fCookie button[type=submit]'); await p.waitForTimeout(1600);
  const feed = await post({ action: 'getCookies', token: S });
  ok('it is awarded and recorded', feed.cookies.some((c) => c.points === 4 && /audit list/.test(c.reason)),
     JSON.stringify(feed.cookies));

  console.log('\n--- the org chart ---');
  await p.click('#btnOrg'); await p.waitForTimeout(1200);
  modal = await p.locator('#modal').textContent();
  ok('it draws itself from who reports to whom', /Rohan Mehta/.test(modal) && /Sruti Charulata/.test(modal));
  ok('it counts the people and the levels', /People/.test(modal) && /Levels/.test(modal));
  ok('a head of department shows their headcount', /2 under them/.test(modal), modal.slice(0, 300));
  ok('and anybody with no manager set is marked', /manager not set/.test(modal));
  ok('the reporting line is drawn as an indent, so the tree is readable',
     await p.locator('#orgBody div[style*="border-left"]').count() >= 3,
     String(await p.locator('#orgBody div[style*="border-left"]').count()));
  await p.screenshot({ path: 'shot-28-org-chart.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);

  console.log('\n--- the doer sees the recognition ---');
  await p.evaluate(() => signOut()); await p.waitForTimeout(900);
  await p.fill('#liUser', U('payel') + '@acme.in'); await p.fill('#liPass', 'staffpass123');
  await p.click('#btnLogin'); await p.waitForTimeout(1800);
  await p.click('[data-tab="tasks"]'); await p.waitForTimeout(700);
  await p.click('text=See why'); await p.waitForTimeout(800);
  modal = await p.locator('#modal').textContent();
  ok('the cookie points are on their score screen', /4 cookie points this month/.test(modal), modal.slice(0, 300));
  ok('with the reason they were given for', /Stayed back to clear the audit list/.test(modal));
  ok('and who gave them', /Sruti Charulata/.test(modal));
  ok('saying what it adds to the score', /Adding 4 to your score/.test(modal));

  ok('no console errors', errs.length === 0, errs.join(' | '));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
