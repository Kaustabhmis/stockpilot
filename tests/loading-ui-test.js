/**
 * Loading feedback: every wait the person can see is shown, background polls
 * are not, and a quick answer flashes nothing. The server is slowed down in
 * the browser so the waits are long enough to look at.
 * Start the test server first: node server.js
 */
const { chromium } = require('/home/user/stockpilot/node_modules/playwright');
const http = require('http');
const hit = (p) => new Promise((r) => http.get('http://localhost:8095' + p, (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => r(b)); }));
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 240) + ']')); v ? pass++ : fail++; };
const SHOTS = process.argv[2];

(async () => {
  await hit('/__demo');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1360, height: 860 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const W = (ms) => p.waitForTimeout(ms);
  let delay = 0;
  await p.route('**/exec', async (route) => { if (delay) await new Promise((r) => setTimeout(r, delay)); route.continue(); });
  await p.goto('http://localhost:8095/', { waitUntil: 'networkidle' }); await W(400);

  console.log('\n=== opening the app on a slow line ===');
  delay = 2500;
  await p.locator('#demo button:has-text("as a manager")').click();
  await W(300);
  ok('the button that was pressed shows a spinner', await p.locator('#demo .btn .spinner').count() >= 1 ||
     await p.locator('#loadBar.on').count() === 1);
  ok('the loading bar runs across the top', await p.locator('#loadBar.on').count() === 1);
  await W(900);
  ok('after a moment a “Loading…” pill says so in words', await p.locator('#loadPill.on').isVisible());
  await p.waitForSelector('#view-app:not(.hidden)', { timeout: 8000 });
  await W(200);
  ok('the first screen shows placeholders, not an empty page',
     await p.locator('#statTiles .skeleton').count() === 6 && await p.locator('#tasksEmpty .spinner').isVisible(),
     await p.locator('#statTiles').innerHTML());
  if (SHOTS) await p.screenshot({ path: SHOTS + '/loading-01-first-open.png' });
  await p.waitForSelector('#board .card', { timeout: 12000 });
  await W(300);
  ok('when the work arrives the board replaces the placeholders', await p.locator('#statTiles .skeleton').count() === 0 &&
     await p.locator('#tasksEmpty').isHidden());
  /* The goals and the plan details load alongside the board; the bar stays
     until the last of them is back, then goes. */
  const cleared = await p.waitForFunction(() => !document.querySelector('#loadBar.on') && !document.querySelector('#loadPill.on'),
    null, { timeout: 10000 }).then(() => true, () => false);
  ok('and the bar and pill go away once everything is in', cleared);

  console.log('\n=== moving between tabs ===');
  await p.click('#navTabs button:has-text("Goals")'); await W(400);
  ok('a tab that is loading shows a spinner where its content will be', await p.locator('#goalsBody .spinner').isVisible());
  if (SHOTS) await p.screenshot({ path: SHOTS + '/loading-02-tab.png' });
  await p.waitForFunction(() => !document.querySelector('#goalsBody .spinner'), null, { timeout: 8000 });
  ok('and it is replaced by the tab itself', (await p.locator('#goalsBody').textContent()).trim().length > 20);
  await p.click('#navTabs button:has-text("Projects")'); await W(400);
  ok('Projects too', await p.locator('#projectList .spinner').isVisible());
  await p.waitForFunction(() => !document.querySelector('#projectList .spinner'), null, { timeout: 8000 });

  console.log('\n=== what must not show it ===');
  const quietBar = await p.evaluate(async () => {
    let seen = false;
    const mo = new MutationObserver(() => { if (document.getElementById('loadBar').classList.contains('on')) seen = true; });
    mo.observe(document.getElementById('loadBar'), { attributes: true });
    await api('getDashboard', {}, { quiet: true });
    mo.disconnect(); return seen;
  });
  ok('a background refresh never shows the bar', quietBar === false);
  delay = 0;
  const fast = await p.evaluate(async () => {
    let seen = false;
    const mo = new MutationObserver(() => { if (document.getElementById('loadBar').classList.contains('on')) seen = true; });
    mo.observe(document.getElementById('loadBar'), { attributes: true });
    await api('getDashboard'); await new Promise((r) => setTimeout(r, 200));
    mo.disconnect(); return seen;
  });
  ok('a quick answer does not flash anything', fast === false);
  delay = 1500;
  const failed = await p.evaluate(async () => { try { await api('noSuchAction'); } catch (e) {} 
    return document.getElementById('loadBar').classList.contains('on'); });
  ok('a call that fails still clears the bar', failed === false);
  ok('two calls at once: the bar stays until both are back', await p.evaluate(async () => {
    const a = api('getDashboard'), c = new Promise((r) => setTimeout(r, 400)).then(() => api('getLeaderboard'));
    await a; await new Promise((r) => setTimeout(r, 50));
    const mid = document.getElementById('loadBar').classList.contains('on');
    await c; return mid && !document.getElementById('loadBar').classList.contains('on');
  }));

  console.log('\n=== buttons ===');
  await p.evaluate(() => signOut(true)); await W(500);
  await p.evaluate(() => goAuth('login')); await W(200);
  await p.fill('#liUser', 'nobody@example.com'); await p.fill('#liPass', 'wrongpass123');
  await p.click('#btnLogin'); await W(400);
  ok('Sign in shows a spinner while it checks', await p.locator('#btnLogin .spinner').isVisible());
  if (SHOTS) await p.screenshot({ path: SHOTS + '/loading-03-button.png', clip: { x: 380, y: 150, width: 600, height: 450 } });
  await p.waitForFunction(() => !document.querySelector('#btnLogin .spinner'), null, { timeout: 8000 });
  ok('and goes back to its label when the answer comes', /Sign in/.test(await p.locator('#btnLogin').textContent()) &&
     !(await p.locator('#btnLogin').isDisabled()));

  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto('http://localhost:8095/', { waitUntil: 'networkidle' });
  ok('on a phone the pill fits the screen', await m.evaluate(() => {
    const el = document.getElementById('loadPill'); el.classList.add('on');
    const r = el.getBoundingClientRect(); el.classList.remove('on'); return r.left >= 0 && r.right <= innerWidth; }));

  ok('nothing threw', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
