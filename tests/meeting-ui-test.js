/**
 * Goals and a weekly review, driven through the screens: an Admin sets
 * purpose and values, adds goals and numbers, starts a meeting, and walks it
 * segment by segment while an attendee follows along in a second browser.
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
const hit = (p) => new Promise((res, rej) => http.get('http://localhost:8095' + p, (r) => { r.resume(); r.on('end', res); }).on('error', rej));

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 200) + ']')); v ? pass++ : fail++; };
  const RUN = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const U = (u) => u + RUN;
  const email = 'mui+' + RUN + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering', name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Growth');
  for (const [n, u, role, mgr] of [['Sruti Charulata', 'sruti', 'HOD', ''], ['Payel Sanyamath', 'payel', 'Doer', 'sruti']]) {
    await post({ action: 'addUser', token: A, form: { name: n, username: U(u), email: U(u) + '@acme.in', role,
      manager: mgr ? U(mgr) : '', jobProfile: 'Executive', password: 'staffpass123' } });
  }

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:8095/?login=1', { waitUntil: 'networkidle' });
  await p.fill('#liUser', email); await p.fill('#liPass', 'strongpass123');
  await p.click('#btnLogin'); await p.waitForTimeout(1800);

  console.log('\n--- Goals: purpose and values ---');
  ok('there is a Goals tab', await p.locator('#navTabs button[data-tab="goals"]').count() === 1);
  ok('and a Meetings tab', await p.locator('#navTabs button[data-tab="meetings"]').count() === 1);
  await p.click('#navTabs button[data-tab="goals"]'); await p.waitForTimeout(1200);
  ok('an empty company is invited to set its purpose', /Not set yet/.test(await p.locator('#goalsBody').textContent()));
  await p.click('button:has-text("Edit purpose")'); await p.waitForTimeout(400);
  await p.fill('#dvPurpose', 'Keep every customer\u2019s line running.');
  const codes = await p.locator('.dvCode').all(), titles = await p.locator('.dvTitle').all();
  await codes[0].fill('C'); await titles[0].fill('Customer first');
  await codes[1].fill('O'); await titles[1].fill('Own it');
  await p.click('#fDir button[type=submit]'); await p.waitForTimeout(1300);
  const gb = await p.locator('#goalsBody').textContent();
  ok('the purpose is shown', /line running/.test(gb));
  ok('and the values with their codes', /Customer first/.test(gb) && /Own it/.test(gb));

  console.log('\n--- Goals: a year goal, a quarter goal under it, a key number ---');
  await p.click('button:has-text("+ Goal")'); await p.waitForTimeout(300);
  await p.click('#glLevel button[data-l="year"]');
  await p.fill('#glTitle', 'Cross 50 crore revenue');
  await p.click('#fGoalEdit button[type=submit]'); await p.waitForTimeout(1200);
  await p.click('button:has-text("+ Goal")'); await p.waitForTimeout(300);
  await p.fill('#glTitle', 'Launch the 16-inch fan');
  await p.selectOption('#glOwner', U('sruti'));
  await p.selectOption('#glParent', { index: 1 });
  await p.click('#fGoalEdit button[type=submit]'); await p.waitForTimeout(1200);
  const gb2 = await p.locator('#goalsBody').textContent();
  ok('the quarter goal sits under its year goal', /Cross 50 crore revenue[\s\S]*Launch the 16-inch fan/.test(gb2));
  ok('with no false progress', /No work linked yet/.test(gb2));
  await p.click('button:has-text("+ Number")'); await p.waitForTimeout(300);
  await p.fill('#nmName', 'Fans despatched'); await p.fill('#nmTarget', '1000'); await p.fill('#nmUnit', 'units');
  await p.click('#fNum button[type=submit]'); await p.waitForTimeout(1200);
  ok('the key number is listed with its target', /Fans despatched[\s\S]*≥ 1000 units/.test(await p.locator('#goalsBody').textContent()));
  await p.screenshot({ path: 'shot-41-goals.png', fullPage: true });

  console.log('\n--- tagging work to the goal ---');
  await p.click('#navTabs button[data-tab="tasks"]'); await p.waitForTimeout(700);
  await p.evaluate(() => openAssign()); await p.waitForTimeout(500);
  await p.fill('#asTitle', 'Prototype motor test');
  await p.check('.asWho[value="' + U('payel') + '"]');
  const gopts = await p.locator('#asGoal option').allTextContents();
  ok('the Assign form offers the goals', gopts.some((o) => /16-inch fan/.test(o)), gopts.join('|'));
  await p.selectOption('#asGoal', { label: gopts.find((o) => /16-inch fan/.test(o)) });
  await p.click('#fAssign button[type=submit]'); await p.waitForTimeout(1500);
  ok('the card shows the goal it serves', /◎ Launch the 16-inch fan/.test(await p.locator('.card:has-text("Prototype motor test")').textContent()));
  ok('and the board can be filtered by goal', await p.locator('#fGoal:not(.hidden)').count() === 1);

  console.log('\n--- starting a weekly review ---');
  await p.click('#navTabs button[data-tab="meetings"]'); await p.waitForTimeout(1200);
  ok('an empty history explains what the meeting is for', /becomes a task/.test(await p.locator('#meetBody').textContent()));
  await p.click('button:has-text("Start a weekly review")'); await p.waitForTimeout(400);
  ok('managers are invited by default', await p.locator('.mtWho[value="' + U('sruti') + '"]').isChecked());
  await p.check('.mtWho[value="' + U('payel') + '"]');
  await p.click('#fStart button[type=submit]'); await p.waitForTimeout(1800);
  ok('the runner opens on Wins', /Wins/.test(await p.locator('#mRunner h2').textContent()));
  ok('with a clock', /\d\d:\d\d \/ 5:00/.test(await p.locator('#mSegClock').textContent()), await p.locator('#mSegClock').textContent());

  // the attendee joins in a second browser
  const q = await b.newPage({ viewport: { width: 1200, height: 900 } });
  q.on('dialog', (d) => d.accept());
  await q.goto('http://localhost:8095/?login=1', { waitUntil: 'networkidle' });
  await q.fill('#liUser', U('payel') + '@acme.in'); await q.fill('#liPass', 'staffpass123');
  await q.click('#btnLogin'); await q.waitForTimeout(1600);
  await q.click('#navTabs button[data-tab="meetings"]'); await q.waitForTimeout(1200);
  ok('an attendee sees it is running', /is running/.test(await q.locator('#meetBody').textContent()));
  await q.click('button:has-text("Join")'); await q.waitForTimeout(1500);
  ok('and joins it', await q.locator('#mRunner').count() === 1);
  ok('without chair controls', await q.locator('button:has-text("Next →")').count() === 0);

  console.log('\n--- Wins ---');
  await p.click('.att[data-u="' + U('sruti') + '"]'); await p.waitForTimeout(900);
  await p.click('.att[data-u="' + U('payel') + '"]'); await p.waitForTimeout(900);
  ok('the chair takes attendance', (await p.locator('.att:has-text("✓")').count()) === 3);
  await q.fill('#fWin textarea', 'Daughter passed her boards');
  await q.click('#fWin button[type=submit]'); await q.waitForTimeout(1200);
  await p.waitForTimeout(5800);    // one poll
  ok('a win from the attendee reaches the chair\u2019s screen on the next poll', /passed her boards/.test(await p.locator('#segLive').textContent()));
  await p.screenshot({ path: 'shot-42-meeting-wins.png' });

  console.log('\n--- Values in action ---');
  await p.click('button:has-text("Next →")'); await p.waitForTimeout(1500);
  await p.fill('#fStory textarea', 'Payel stayed until the motor test passed');
  await p.selectOption('#fStory [name=person]', U('payel'));
  await p.selectOption('#fStory [name=value]', 'O');
  await p.click('#fStory button[type=submit]'); await p.waitForTimeout(1500);
  ok('the story is recorded with its value', /motor test passed[\s\S]*O/.test(await p.locator('#segLive').textContent()));
  await q.waitForTimeout(5800);
  ok('and the attendee followed the chair to the next segment', /Values in action/.test(await q.locator('#mRunner h2').textContent()));

  console.log('\n--- Goal check, Key numbers ---');
  await p.click('button:has-text("Next →")'); await p.waitForTimeout(1500);
  ok('the quarter goal is on the table, with its linked work', /16-inch fan[\s\S]*0\/1/.test(await p.locator('#segLive').textContent()));
  await p.selectOption('.mGoal', 'At risk'); await p.waitForTimeout(400);
  await p.fill('#riskNote', 'Motor supplier slipped'); await p.click('#fRisk button[type=submit]'); await p.waitForTimeout(1800);
  ok('marking it at risk asks why, and shows it', /Motor supplier slipped/.test(await p.locator('#segLive').textContent()));
  await p.click('button:has-text("Next →")'); await p.waitForTimeout(1500);
  await p.fill('.mNum', '870'); await p.press('.mNum', 'Tab'); await p.waitForTimeout(1800);
  ok('a figure under target is flagged', await p.locator('.mNum.text-red-700').count() === 1 ||
     /Below target/.test(await p.locator('#toasts').textContent()));

  console.log('\n--- Updates, Roadblocks, Actions ---');
  await p.click('button:has-text("Next →")'); await p.waitForTimeout(1300);
  await p.click('button:has-text("Next →")'); await p.waitForTimeout(1500);
  await p.fill('#fRoad textarea', 'Motor supplier late by two weeks');
  const ropts = await p.locator('#fRoad [name=goal] option').allTextContents();
  await p.selectOption('#fRoad [name=goal]', { label: ropts.find((o) => /16-inch fan/.test(o)) });
  await p.click('#fRoad button[type=submit]'); await p.waitForTimeout(1500);
  ok('the roadblock shows the goal it threatens', /late by two weeks[\s\S]*◎ Launch the 16-inch fan/.test(await p.locator('#segLive').textContent()));
  ok('a roadblock is raised', /late by two weeks/.test(await p.locator('#segLive').textContent()));
  await p.click('.rbAct'); await p.waitForTimeout(400);
  ok('the action form inherits the roadblock\u2019s goal', /16-inch fan/.test(await p.locator('#raGoal option:checked').textContent()));
  await p.selectOption('#raWho', U('sruti'));
  await p.click('#fRbAct button[type=submit]'); await p.waitForTimeout(1800);
  ok('turning it into an action clears it', /Now 0/.test(await p.locator('#segLive').textContent()));
  await p.screenshot({ path: 'shot-43-meeting-roadblocks.png' });
  await p.click('button:has-text("Next →")'); await p.waitForTimeout(1500);
  ok('the action is listed, marked new', /late by two weeks[\s\S]*new/.test(await p.locator('#segLive').textContent()));

  console.log('\n--- Close ---');
  await p.click('button:has-text("Next →")'); await p.waitForTimeout(1500);
  await q.waitForTimeout(5800);
  await q.click('.rate[data-n="9"]'); await q.waitForTimeout(1200);
  await p.click('.rate[data-n="8"]'); await p.waitForTimeout(1200);
  ok('ratings are counted', /2 \/ 3/.test(await p.locator('#segLive').textContent()), await p.locator('#segLive').textContent());
  ok('the attendee sees only that theirs is in, no names', !/Sruti|Rohan/.test(await q.locator('#segLive').textContent()));
  await p.screenshot({ path: 'shot-44-meeting-close.png' });
  await p.click('button:has-text("End meeting")'); await p.waitForTimeout(2200);
  const sum = await p.locator('#meetBody').textContent();
  ok('ending shows the summary', /Ended/.test(sum) && /New actions/.test(sum));
  ok('with the action agreed', /late by two weeks/.test(sum));
  await p.screenshot({ path: 'shot-45-meeting-summary.png', fullPage: true });
  await q.waitForTimeout(5800);
  ok('the attendee\u2019s screen ends too', /Ended/.test(await q.locator('#meetBody').textContent()));

  console.log('\n--- the action is real work ---');
  await p.click('#navTabs button[data-tab="tasks"]'); await p.waitForTimeout(1500);
  ok('it is a task on the board, still tied to the goal the roadblock threatened',
     /◎ Launch the 16-inch fan/.test(await p.locator('.card:has-text("late by two weeks")').textContent()));

  console.log('\n--- on a phone ---');
  await q.setViewportSize({ width: 390, height: 844 });
  await q.click('#navTabsMobile button[data-tab="goals"]'); await q.waitForTimeout(1300);
  ok('Goals reads on a phone without pushing the page sideways',
     !(await q.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await q.screenshot({ path: 'shot-46-goals-mobile.png' });

  ok('nothing threw', errs.length === 0, errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
