/**
 * The Help Centre, driven the way a person uses it: press ?, land on the
 * section for the tab you are on, search, follow a link, give up and reach a
 * human. And the part that matters more than any of that — that what it says
 * is MANUAL.md, word for word, so it cannot drift from the manual or (through
 * manual-test.js) from the code.
 */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs');
const post = (body) => new Promise((res, rej) => {
  const d = JSON.stringify(body);
  const r = http.request({ host: 'localhost', port: 8095, path: '/exec', method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(d) } }, (s) => {
    let b = ''; s.on('data', (c) => b += c); s.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  });
  r.on('error', rej); r.write(d); r.end();
});

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 200) + ']')); v ? pass++ : fail++; };

  const RUN = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const email = 'help+' + RUN + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering',
    name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await post({ action: 'addUser', token: A, form: { name: 'Payel S', username: 'payel' + RUN,
    email: 'payel' + RUN + '@acme.in', role: 'Doer', jobProfile: 'Executive', password: 'staffpass123' } });

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8095/?login=1', { waitUntil: 'networkidle' });
  await p.fill('#liUser', email); await p.fill('#liPass', 'strongpass123');
  await p.click('#btnLogin'); await p.waitForTimeout(1600);

  console.log('\n--- it is the manual ---');
  const help = await p.evaluate(() => HELP);
  const manual = fs.readFileSync('/home/user/stockpilot/MANUAL.md', 'utf8');
  const titles = [...manual.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  ok('every section of MANUAL.md is in the app', help.sections.length === titles.length,
     help.sections.length + ' vs ' + titles.length);
  ok('in the same order, with the same titles',
     help.sections.map((s) => s.title).join('|') === titles.join('|'));
  ok('the scoring weights reached the app as written',
     /45%/.test(help.sections.find((s) => s.id === 'scores').html) &&
     /10 points on that task/.test(help.sections.find((s) => s.id === 'scores').html));
  ok('no raw Markdown leaked into the rendered help',
     help.sections.every((s) => !/\*\*|\]\(#|^#{1,4} /m.test(s.html.replace(/<pre[\s\S]*?<\/pre>/g, ''))),
     help.sections.filter((s) => /\*\*|\]\(#/.test(s.html)).map((s) => s.id).join(','));
  ok('the operator setup link is not offered to customers',
     !help.sections.some((s) => /SETUP\.md/.test(s.html)));

  console.log('\n--- it opens where you are ---');
  await p.click('#btnHelp'); await p.waitForTimeout(500);
  ok('the ? button opens help, not the support form',
     await p.locator('#modal.hc-modal').count() === 1 && await p.locator('#fSup').count() === 0);
  ok('from the Tasks tab it opens on Tasks',
     /^Tasks$/.test((await p.locator('.hc-h1').textContent()).trim()), await p.locator('.hc-h1').textContent());
  await p.screenshot({ path: 'shot-38-help-tasks.png' });
  await p.evaluate(() => closeModal());

  await p.click('#navTabs button[data-tab="priority"]'); await p.waitForTimeout(900);
  await p.keyboard.press('?'); await p.waitForTimeout(500);
  ok('pressing ? on Priority opens on Priority',
     /^Priority$/.test((await p.locator('.hc-h1').textContent()).trim()), await p.locator('.hc-h1').textContent());
  await p.evaluate(() => closeModal());

  await p.click('#navTabs button[data-tab="board"]'); await p.waitForTimeout(1000);
  await p.keyboard.press('?'); await p.waitForTimeout(500);
  ok('and on the Board it opens on the leaderboard',
     /leaderboard/i.test(await p.locator('.hc-h1').textContent()));
  await p.evaluate(() => renderHelpSection('billing'));
  await p.evaluate(() => closeModal());
  await p.keyboard.press('?'); await p.waitForTimeout(400);
  ok('reopened from the same tab, it resumes where you were reading',
     /^Billing$/.test((await p.locator('.hc-h1').textContent()).trim()), await p.locator('.hc-h1').textContent());

  console.log('\n--- search ---');
  await p.fill('#hcQ', 'cookie'); await p.waitForTimeout(250);
  const listed = await p.locator('#hcList [data-sec]').allTextContents();
  ok('search narrows the list', listed.length > 0 && listed.length < help.sections.length, listed.length);
  ok('and says how many sections matched', /(1 section mentions|\d+ sections mention) “cookie”/.test(await p.locator('#hcList').textContent()));
  ok('each result shows how often it matched',
     await p.locator('#hcList .hc-count').count() === listed.length);
  await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  ok('Enter opens the best match', /Recognition|Scores/.test(await p.locator('.hc-h1').textContent()),
     await p.locator('.hc-h1').textContent());
  ok('and the hits are highlighted in it', await p.locator('#hcBody mark').count() > 0);
  await p.screenshot({ path: 'shot-39-help-search.png' });

  await p.fill('#hcQ', 'zxqv nonsense'); await p.waitForTimeout(250);
  ok('no match says so', /Nothing matches/.test(await p.locator('#hcList').textContent()));
  ok('and offers a person instead', await p.locator('#hcList button:has-text("Ask us")').count() === 1);
  await p.fill('#hcQ', ''); await p.waitForTimeout(150);

  console.log('\n--- moving around inside it ---');
  // Tasks is the section that cross-references most: it points at Scores and
  // at Repeating work from inside its own field table.
  await p.evaluate(() => renderHelpSection('tasks'));
  await p.waitForTimeout(200);
  const inLinks = await p.locator('#hcBody [data-go]').count();
  ok('links between sections are live', inLinks > 0, inLinks);
  await p.click('#hcBody [data-go="scores"]');
  await p.waitForTimeout(300);
  ok('following one stays inside help', await p.locator('#modal.hc-modal').count() === 1);
  ok('and arrives where it pointed', /^Scores$/.test((await p.locator('.hc-h1').textContent()).trim()),
     await p.locator('.hc-h1').textContent());
  ok('there is a next / previous pager', await p.locator('.hc-pager .hc-link').count() >= 1);

  console.log('\n--- and it ends at a person ---');
  ok('every section ends with "Still stuck?"', /Still stuck\?/.test(await p.locator('#hcBody').textContent()));
  const title = (await p.locator('.hc-h1').textContent()).trim();
  await p.click('.hc-stuck .btn'); await p.waitForTimeout(400);
  ok('which opens the support form', await p.locator('#fSup').count() === 1);
  ok('with the subject already saying which section they were stuck on',
     (await p.inputValue('#supSub')) === 'Help: ' + title, await p.inputValue('#supSub'));
  await p.evaluate(() => closeModal());

  console.log('\n--- from the score, where the question is asked most ---');
  await p.click('#navTabs button[data-tab="tasks"]'); await p.waitForTimeout(700);
  await p.evaluate(() => openScoreBreakdown());
  await p.waitForTimeout(400);
  ok('the score breakdown links to how scoring works',
     await p.locator('#modal button:has-text("How scoring works")').count() === 1);
  await p.click('#modal button:has-text("How scoring works")'); await p.waitForTimeout(400);
  ok('and lands on Scores', /^Scores$/.test((await p.locator('.hc-h1').textContent()).trim()));
  await p.evaluate(() => closeModal());

  console.log('\n--- it never throws away what you were typing ---');
  await p.evaluate(() => openAssign()); await p.waitForTimeout(500);
  await p.fill('#asTitle', 'Half-written task I care about');
  await p.evaluate(() => openHelp());
  await p.waitForTimeout(300);
  ok('help refuses to replace a form with something typed in it',
     await p.locator('#fAssign').count() === 1 && (await p.inputValue('#asTitle')) === 'Half-written task I care about');
  ok('and says why', /help would replace it/.test(await p.locator('#toasts').textContent()));
  await p.click('#asTitle'); await p.keyboard.press('?');
  ok('typing ? into a field types a ?', (await p.inputValue('#asTitle')).endsWith('?'));
  await p.evaluate(() => closeModal());

  console.log('\n--- what a Doer sees ---');
  await p.evaluate(() => signOut()); await p.waitForTimeout(700);
  await p.fill('#liUser', 'payel' + RUN + '@acme.in'); await p.fill('#liPass', 'staffpass123');
  await p.click('#btnLogin'); await p.waitForTimeout(1500);
  await p.keyboard.press('?'); await p.waitForTimeout(400);
  const order = await p.locator('#hcList [data-sec]').evaluateAll((els) => els.map((e) => e.dataset.sec));
  const firstMgr = order.findIndex((id) => ['team', 'reports', 'kras-and-appraisals', 'for-managers'].includes(id));
  ok('a Doer still sees every section', order.length === help.sections.length, order.length);
  ok('with their own work first and the managing sections after',
     firstMgr > -1 && order.slice(firstMgr).every((id) => ['team', 'reports', 'kras-and-appraisals', 'for-managers'].includes(id)),
     order.join(','));
  ok('under a heading that says what they are', /How your managers work/.test(await p.locator('#hcList').textContent()));
  await p.evaluate(() => closeModal());

  console.log('\n--- on a phone ---');
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(300);
  ok('the ? button is hidden to save room', !(await p.locator('#btnHelp').isVisible()));
  await p.evaluate(() => openAccount()); await p.waitForTimeout(400);
  ok('so help is reachable from the account panel instead',
     await p.locator('#modal button:has-text("Help")').count() === 1);
  await p.click('#modal button:has-text("Help")'); await p.waitForTimeout(500);
  ok('it opens', await p.locator('#modal.hc-modal').count() === 1);
  /* On first open a phone must show the top of help — search, the list and
     the way out — not jump straight past them into an article. */
  ok('opening it does not scroll the close button off the screen',
     await p.locator('.hc-side button[aria-label="Close"]').isVisible());
  ok('and the search box is in view', await p.locator('#hcQ').isVisible());
  await p.locator('#hcList [data-sec="billing"]').click();
  await p.waitForTimeout(400);
  ok('tapping a section brings its article into view',
     await p.locator('.hc-h1').isVisible() && /^Billing$/.test((await p.locator('.hc-h1').textContent()).trim()));
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('without pushing the page sideways', !overflow);
  await p.screenshot({ path: 'shot-40-help-mobile.png', fullPage: false });

  ok('nothing threw along the way', errs.length === 0, errs.join(' | '));

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
