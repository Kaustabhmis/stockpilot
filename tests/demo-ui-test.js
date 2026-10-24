/**
 * The demo workspace as a prospect sees it. The point of this suite is not
 * that the pages render — other suites cover that — but that the demo DATA
 * fills them. A board with four cards, a leaderboard with one name and a score
 * of "no data" is a worse first impression than no demo at all.
 */
const { chromium } = require('playwright');
const http = require('http');
const hit = (p) => new Promise((res, rej) => http.get('http://localhost:8095' + p,
  (r) => { let b = ''; r.on('data', (c) => b += c); r.on('end', () => res(b)); }).on('error', rej));

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 200) + ']')); v ? pass++ : fail++; };

  const built = await hit('/__demo');
  ok('the demo builds on the harness too', /SIGN IN/.test(built), built.slice(0, 200));

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  await p.goto('http://localhost:8095/?login=1', { waitUntil: 'networkidle' });
  await p.fill('#liUser', 'demo@biscsindia.com');
  await p.fill('#liPass', 'DomeBoxDemo2026');
  await p.click('#btnLogin');
  await p.waitForTimeout(2000);

  console.log('\n--- 1. the board ---');
  const cards = await p.locator('.card').count();
  ok('the board is full, not a sample', cards > 8, cards);
  ok('the company name is the demo one',
     /Sharma Precision/.test(await p.locator('body').textContent()));
  await p.screenshot({ path: 'shot-32-demo-board.png' });

  console.log('\n--- 2. a card tells a story ---');
  await p.click('.card:has-text("Rework 12 rejected housings")');
  await p.waitForTimeout(700);
  const drawer = await p.locator('#drawer').textContent();
  ok('the drawer opens with history', /History/.test(drawer));
  ok('and shows who it is on', /Vikram|Rathore/.test(drawer), drawer.slice(0, 120));
  await p.evaluate(() => closeDrawer());

  console.log('\n--- 3. the priority list ---');
  await p.click('#navTabs button[data-tab="priority"]');
  await p.waitForTimeout(1400);
  const prio = await p.locator('#tab-priority').textContent();
  ok('it has rows', prio.length > 400, prio.length);
  ok('and the rows carry their reason',
     /overdue|due|waiting|blocked|priority/i.test(prio));
  await p.screenshot({ path: 'shot-33-demo-priority.png' });

  console.log('\n--- 4. the leaderboard ---');
  await p.click('#navTabs button[data-tab="board"]');
  await p.waitForTimeout(1600);
  const lb = await p.locator('#lbBody').textContent();
  ok('somebody is named for the month', /delivery in/i.test(lb), lb.slice(0, 140));
  const rows = await p.locator('#lbBody tbody tr').count();
  ok('several people are ranked', rows >= 4, rows);
  const scores = (await p.locator('#lbBody tbody tr td:nth-child(4)').allTextContents())
    .map((s) => Number(s.replace(/\D/g, '')));
  ok('with scores that differ — the whole argument of the product',
     new Set(scores).size > 1, scores.join(' '));
  ok('and nobody is ranked on an empty month', !/undefined|NaN/.test(lb));
  await p.screenshot({ path: 'shot-34-demo-leaderboard.png', fullPage: true });

  console.log('\n--- 5. projects ---');
  await p.click('#navTabs button[data-tab="projects"]');
  await p.waitForTimeout(1400);
  const proj = await p.locator('#tab-projects').textContent();
  ok('the audit project is there', /ISO 9001/.test(proj), proj.slice(0, 160));
  ok('with its stages', /Internal audit round/.test(proj));
  await p.screenshot({ path: 'shot-35-demo-projects.png' });

  console.log('\n--- 6. reports, and the working behind a score ---');
  await p.click('#navTabs button[data-tab="reports"]');
  await p.waitForTimeout(1800);
  const rep = await p.locator('#tab-reports').textContent();
  ok('the report has people in it', /Payel|Vikram|Nita/.test(rep));
  ok('and numbers, not placeholders', !/no data/i.test(rep.slice(0, 600)), rep.slice(0, 200));
  await p.screenshot({ path: 'shot-36-demo-reports.png', fullPage: true });

  console.log('\n--- 7. the Doer view, which is the second half of a demo ---');
  await p.evaluate(() => signOut());
  await p.waitForTimeout(800);
  await p.fill('#liUser', 'payel@demo.domebox.in');
  await p.fill('#liPass', 'DemoStaff2026');
  await p.click('#btnLogin');
  await p.waitForTimeout(2000);
  const doer = await p.locator('body').textContent();
  ok('they sign in', /Payel/.test(doer));
  ok('with a real score rather than "no data"',
     !/Final score[\s\S]{0,40}no data/i.test(doer), (doer.match(/Final score[^]{0,60}/) || [])[0]);
  await p.screenshot({ path: 'shot-37-demo-doer.png' });

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
