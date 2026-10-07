/**
 * The stop rule is only worth having if somebody can set it without reading a
 * manual. This clicks it the way a person would: choose a cadence, see the
 * options appear, pick one, and read back what was chosen in words.
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
const ymd = (plus) => { const d = new Date(); d.setDate(d.getDate() + plus); return d.toISOString().slice(0, 10); };

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 170) + ']')); v ? pass++ : fail++; };

  const RUN = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const email = 'rep+' + RUN + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering',
    name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await post({ action: 'addUser', token: A, form: { name: 'Payel S', username: 'payel' + RUN,
    email: 'payel' + RUN + '@acme.in', role: 'Doer', jobProfile: 'Executive', password: 'staffpass123' } });

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  await p.goto('http://localhost:8095/?login=1', { waitUntil: 'networkidle' });
  await p.fill('#liUser', email); await p.fill('#liPass', 'strongpass123');
  await p.click('#btnLogin'); await p.waitForTimeout(1600);

  await p.evaluate(() => openAssign());
  await p.waitForTimeout(700);

  console.log('\n--- the options only appear once it repeats ---');
  ok('a one-time task is not asked when to stop',
     await p.locator('#asStopWrap.hidden').count() === 1);
  ok('every cadence is offered', await p.locator('#asFreq option').count() === 9);
  const opts = await p.locator('#asFreq').allTextContents();
  ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Half-Yearly', 'Yearly'].forEach((c) => {
    ok(c + ' is in the list', opts.join().indexOf(c) > -1);
  });

  await p.selectOption('#asFreq', 'Monthly');
  await p.waitForTimeout(300);
  ok('choosing a cadence reveals the stop rule',
     await p.locator('#asStopWrap.hidden').count() === 0);
  ok('and it defaults to saying it will run forever',
     /until somebody stops it/.test(await p.locator('#asStopNote').textContent()));

  console.log('\n--- stopping on a date ---');
  await p.click('.stopMode[data-mode="date"]');
  await p.fill('#asUntil', ymd(120));
  await p.waitForTimeout(250);
  ok('the date field appears', await p.locator('#asStopDate.hidden').count() === 0);
  ok('the count field does not', await p.locator('#asStopCount.hidden').count() === 1);
  ok('and it reads the choice back in words',
     (await p.locator('#asStopNote').textContent()).indexOf(ymd(120)) > -1,
     await p.locator('#asStopNote').textContent());

  console.log('\n--- stopping after a number of times ---');
  await p.click('.stopMode[data-mode="count"]');
  await p.fill('#asTimes', '6');
  await p.waitForTimeout(250);
  ok('switching modes hides the date', await p.locator('#asStopDate.hidden').count() === 1);
  ok('it says how many times it will run',
     /run 6 times, then stop/.test(await p.locator('#asStopNote').textContent()),
     await p.locator('#asStopNote').textContent());
  await p.screenshot({ path: 'shot-28-repeat-stop.png' });

  console.log('\n--- and it is what actually gets saved ---');
  await p.fill('#asTitle', 'Monthly stock count');
  await p.fill('#asDue', ymd(2));
  await p.check('.asWho[value="payel' + RUN + '"]');
  await p.click('#fAssign button[type=submit]');
  await p.waitForTimeout(1500);
  const t = (await post({ action: 'getDashboard', token: A })).tasks
    .filter((x) => x.title === 'Monthly stock count')[0];
  ok('the task was created', !!t);
  ok('with the cadence', t && t.frequency === 'Monthly', t && t.frequency);
  ok('and with the limit', t && t.repeatCount === 6, t && t.repeatCount);
  ok('counted from one', t && t.repeatMade === 1, t && t.repeatMade);

  console.log('\n--- the board and the drawer show how far through it is ---');
  ok('the card says 1 of 6, not just "Monthly"',
     /Monthly · 1 of 6/.test(await p.locator('.card:has-text("Monthly stock count")').textContent()),
     await p.locator('.card:has-text("Monthly stock count")').textContent());
  await p.click('.card:has-text("Monthly stock count")');
  await p.waitForTimeout(600);
  ok('and so does the drawer', /Monthly · 1 of 6/.test(await p.locator('#drawer').textContent()));
  ok('which still offers a way to stop it by hand',
     await p.locator('#drawer .act[data-act="stop"]').count() === 1);
  await p.screenshot({ path: 'shot-29-repeat-drawer.png' });

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
