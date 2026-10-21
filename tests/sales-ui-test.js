/**
 * The home page as a buyer meets it: the tour, the calculator, the live demo,
 * the free trial and the call-back form — driven in a real browser against
 * the test server (start it first: node server.js).
 */
const { chromium } = require('/home/user/stockpilot/node_modules/playwright');
const http = require('http');
const hit = (p) => new Promise((r) => http.get('http://localhost:8095' + p, (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => r(b)); }));
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 240) + ']')); v ? pass++ : fail++; };
const SHOTS = process.argv[2];
const STATE_TAB = (t) => t === 'team';

(async () => {
  await hit('/__demo');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1360, height: 860 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const W = (ms) => p.waitForTimeout(ms);
  await p.goto('http://localhost:8095/', { waitUntil: 'networkidle' }); await W(600);

  console.log('\n=== the first screen sells ===');
  ok('the headline says what it is', /Stop chasing work on WhatsApp/.test(await p.locator('#view-home h1').textContent()));
  ok('the free trial is the main button', await p.locator('#hero button.btn-gold:has-text("free 14-day trial")').count() === 1);
  ok('the live demo is one click away', await p.locator('#hero button:has-text("See the live demo")').count() === 1);
  ok('a real product screen is in the first view', await p.locator('#hero img[src="/img/16-lead-board.jpg"]').evaluate((i) => i.complete && i.naturalWidth > 0));
  ok('one gold button in the first screen, and it starts the trial',
     (await p.locator('#hero .btn-gold').allTextContents()).map((t) => t.trim()).join('|') === 'Start your free 14-day trial');
  ok('the most popular plan stands out', await p.locator('#homePlans .plan-lead').count() === 1 &&
     /Growth/.test(await p.locator('#homePlans .plan-lead').textContent()));
  if (SHOTS) await p.screenshot({ path: SHOTS + '/sales-01-hero.png' });

  console.log('\n=== the product tour ===');
  ok('nine screens in the tour', await p.locator('#tourTabs button').count() === 9);
  await p.click('#tourTabs button:has-text("Fair scores")'); await W(300);
  ok('a tab swaps the screen and the words', /09-score-why/.test(await p.locator('#tourImg').getAttribute('src')) &&
     /working shown/.test(await p.locator('#tourText').textContent()));
  const broken = await p.evaluate(async () => {
    const out = [];
    for (const k of TOUR) { const r = await fetch('/img/' + k.img + '.jpg'); if (!r.ok) out.push(k.img); }
    return out;
  });
  ok('every tour picture exists', broken.length === 0, broken.join(', '));

  console.log('\n=== the calculator, against a hand calculation ===');
  /* Defaults: 4 managers × 45 min × 25 days = 75 hours. Hourly = 45,000 / 200 = 225.
     75 × 225 = 16,875; half = 8,438. 25 people → Growth, 59,990 / 12 = 4,999 a month.
     8,437.5 / 4,999 = 1.69 → 1.7×. */
  const roi = await p.locator('#roiOut').textContent();
  ok('75 hours of chasing a month', /75 hours/.test(roi), roi.slice(0, 120));
  ok('worth ₹16,875', /₹16,875/.test(roi), roi);
  ok('half back is ₹8,438 against Growth at ₹4,999 — 1.7×', /₹8,438/.test(roi) && /Growth/.test(roi) && /₹4,999/.test(roi) && /1\.7×/.test(roi), roi);
  ok('and it says it is an estimate from their own figures', /estimate from your own figures/.test(roi));
  await p.fill('#roiPeople', '200'); await p.dispatchEvent('#roiPeople', 'input'); await W(100);
  ok('over 150 people it says talk to us, not a made-up price', /Talk to us/.test(await p.locator('#roiOut').textContent()));
  await p.fill('#roiPeople', '25'); await p.dispatchEvent('#roiPeople', 'input');

  console.log('\n=== pricing ===');
  ok('the pricing note says what checkout will actually charge (not registered here: no GST)',
     /No GST is charged/.test(await p.locator('#gstNote').textContent()), await p.locator('#gstNote').textContent());
  const cards = await p.locator('#homePlans button').allTextContents();
  ok('paid plans start a free trial; Enterprise talks to us', cards.filter((c) => /Start free trial/.test(c)).length === 4 &&
     cards.some((c) => /Talk to us/.test(c)), cards.join(' | '));

  console.log('\n=== the call-back form ===');
  await p.fill('#cbName', 'Rohan Mehta'); await p.fill('#cbCompany', 'Mehta Castings');
  await p.fill('#cbPhone', '98300 12345'); await p.fill('#cbSize', '40');
  await p.click('#btnCallback'); await W(1200);
  ok('a call-back request is accepted', /we will call you back/i.test(await p.locator('#formCallback').textContent()),
     await p.locator('#formCallback').textContent());

  console.log('\n=== the live demo, view-only ===');
  await p.locator('#demo button:has-text("as a manager")').click(); await W(3500);
  ok('the demo opens straight into the app', await p.locator('#view-app').isVisible());
  ok('as Sruti, a manager', /Sruti/.test(await p.locator('#navName').textContent()));
  ok('with a bar that says it is the demo', /Live demo/.test(await p.locator('#banner').textContent()) &&
     await p.locator('#banner button:has-text("free 14-day trial")').count() === 1);
  ok('and real work on the board', await p.locator('.card').count() >= 3, await p.locator('.card').count());
  const ORDER = 'Tasks|Priority|Projects|Meetings|Goals|Leaderboard|Reports|Team';
  ok('the tabs run in the order people use them: ' + ORDER.replace(/\|/g, ' · '),
     (await p.locator('#navTabs button').allTextContents()).map((t) => t.trim()).join('|') === ORDER &&
     (await p.locator('#navTabsMobile button').allTextContents()).map((t) => t.trim()).join('|') === ORDER,
     (await p.locator('#navTabs button').allTextContents()).join('|'));
  if (SHOTS) await p.screenshot({ path: SHOTS + '/sales-02-demo.png' });
  const tries = await p.evaluate(async () => {
    const out = {};
    for (const [a, body] of [['createTask', { form: { title: 'x', assignTo: 'payel', dueDate: '2030-01-01', priority: 'Low' } }],
                             ['addUser', { form: { name: 'x', username: 'zz', email: 'zz@x.in', role: 'Doer', password: 'abcdefgh1' } }],
                             ['awardCookie', { data: { employee: 'payel', points: 5, reason: 'x' } }],
                             ['contactSupport', { form: { message: 'x' } }],
                             ['aiInsight', { question: 'x' }],
                             ['initiateRazorpay', { planName: 'Growth' }],
                             ['changePassword', { currentPassword: 'a', newPassword: 'bbbbbbbbb' }]]) {
      try { await api(a, body); out[a] = 'ALLOWED'; } catch (e) { out[a] = e.message; }
    }
    return out;
  });
  ok('every write is refused, with a pointer to the trial', Object.values(tries).every((m) => /demo, so changes are switched off/.test(m)),
     JSON.stringify(tries));
  const reads = await p.evaluate(async () => {
    const out = {};
    for (const a of ['getDashboard', 'getLeaderboard', 'getProjects', 'getDirection', 'getMeetings', 'getUsers']) {
      try { await api(a, {}); out[a] = 'ok'; } catch (e) { out[a] = e.message; }
    }
    return out;
  });
  ok('while everything can be read', Object.values(reads).every((v) => v === 'ok'), JSON.stringify(reads));
  await p.click('#banner .demo-as:has-text("Staff")'); await W(3000);
  ok('switching to the staff view shows Payel’s own work', /Payel/.test(await p.locator('#navName').textContent()));
  const forged = await p.evaluate(async () => {
    /* A demo token edited to drop the read-only mark must not verify. */
    const [b64, sig] = STATE.token.split('.');
    const body = atob(b64.replace(/-/g, '+').replace(/_/g, '/')).split('|').slice(0, 4).join('|');
    const t = btoa(body).replace(/\+/g, '-').replace(/\//g, '_') + '.' + sig;
    const r = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'createTask', token: t,
      form: { title: 'x', assignTo: 'payel', dueDate: '2030-01-01', priority: 'Low' } }) });
    return (await r.json()).message;
  });
  ok('a demo token with the read-only mark removed is rejected', /Session is invalid/.test(forged), forged);
  await p.evaluate(() => signOut(true)); await W(600);
  ok('when the demo session ends the visitor goes home, not to a sign-in form they cannot use',
     await p.locator('#view-home').isVisible() && !(await p.locator('#view-auth').isVisible()));
  await p.locator('#demo button:has-text("as a team member")').click(); await W(3000);
  await p.click('#banner button:has-text("free 14-day trial")'); await W(800);
  ok('the trial button leaves the demo for the sign-up form', await p.locator('#formSignup').isVisible() &&
     await p.evaluate(() => !STATE.token));

  console.log('\n=== the free trial ===');
  const em = 'trial' + Date.now() + '@mehta.in';
  await p.fill('#suCompany', 'Mehta Castings'); await p.fill('#suName', 'Rohan Mehta');
  await p.fill('#suEmail', em); await p.fill('#suPass', 'strongpass123');
  await p.click('#btnSignup'); await W(3500);
  ok('a new workspace opens', await p.locator('#view-app').isVisible());
  const banner = await p.locator('#banner').textContent();
  ok('on the full Growth plan, with 14 days left said plainly', /Free trial of the full Growth plan: 14 days left/.test(banner), banner);
  ok('and what happens after it', /moves to Free — nothing is deleted/.test(banner));
  const first = await p.locator('#tasksEmpty').textContent();
  ok('the empty board is a three-step start, not a dead end', /Three steps/.test(first) &&
     await p.locator('#tasksEmpty button').count() === 3, first.slice(0, 200));
  await p.locator('#tasksEmpty button:has-text("Add a person")').click(); await W(1500);
  ok('“Add a person” opens the form on the Team tab', await p.locator('#modal').isVisible() && STATE_TAB(await p.evaluate(() => STATE.tab)));
  await p.evaluate(() => closeModal());
  if (SHOTS) await p.screenshot({ path: SHOTS + '/sales-03-trial.png' });
  await p.click('#banner button:has-text("Choose a plan")'); await W(1200);
  const buys = await p.locator('#modal .buy').allTextContents();
  ok('during the trial every plan can be bought — Growth included', buys.length === 4 && buys.some((t) => /Growth/.test(t)), buys.join(' | '));
  await p.evaluate(() => closeModal());

  console.log('\n=== on a phone ===');
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto('http://localhost:8095/', { waitUntil: 'networkidle' }); await m.waitForTimeout(500);
  ok('the next step is always one thumb away', await m.locator('.sticky-cta').isVisible());
  ok('without pushing the page sideways', await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  ok('a returning customer sees Sign in at the top of the phone screen', await m.locator('#homeSignIn').isVisible());
  ok('and under the hero buttons', await m.locator('#hero .returning button:has-text("Sign in")').isVisible());
  ok('the menu is closed until asked for', await m.locator('#homeMenuBtn').isVisible() && !(await m.locator('#homeMenu').isVisible()));
  await m.click('#homeMenuBtn'); await m.waitForTimeout(200);
  const links = (await m.locator('#homeMenu a').allTextContents()).map((t) => t.trim()).join('|');
  ok('the menu opens with every section, plus sign in, sign up and the trial',
     links === 'Product tour|Live demo|Pricing|Questions|Request a call-back' &&
     await m.locator('#homeMenu button:has-text("Sign in")').isVisible() &&
     await m.locator('#homeMenu button:has-text("Create an account")').isVisible() &&
     await m.locator('#homeMenu button:has-text("Start free trial")').isVisible(), links);
  if (SHOTS) await m.screenshot({ path: SHOTS + '/sales-05-phone-menu.png' });
  await m.click('#homeMenu a:has-text("Pricing")'); await m.waitForTimeout(400);
  ok('a menu link goes to its section and closes the menu', !(await m.locator('#homeMenu').isVisible()) &&
     await m.evaluate(() => document.getElementById('pricing').getBoundingClientRect().top < innerHeight));
  await m.click('#homeMenuBtn'); await m.click('#homeMenu button:has-text("Sign in")'); await m.waitForTimeout(400);
  ok('Sign in from the menu opens the sign-in form', await m.locator('#formLogin').isVisible());
  const dsk = await b.newPage({ viewport: { width: 1360, height: 800 } });
  await dsk.goto('http://localhost:8095/', { waitUntil: 'networkidle' });
  ok('on a computer: Sign in and the trial in the bar, no menu button',
     await dsk.locator('#homeSignIn').isVisible() && !(await dsk.locator('#homeMenuBtn').isVisible()));
  if (SHOTS) await m.screenshot({ path: SHOTS + '/sales-04-phone.png' });

  ok('nothing threw', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
