/**
 * Domebox Lite in a browser: straight to sign-in, branded Lite, the whole
 * product, and no plans, prices, trial or billing anywhere on screen.
 * Start a Lite test server first:
 *   DBX_PORT=8096 DBX_CODE=../dist/lite/Code.gs DBX_HTML=../dist/lite-upload/index.html DBX_SITE=../dist/lite-upload node server.js
 */
const { chromium } = require('/home/user/stockpilot/node_modules/playwright');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 260) + ']')); v ? pass++ : fail++; };
const SHOTS = process.argv[2], URL = 'http://localhost:8096/';

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1360, height: 860 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const W = (ms) => p.waitForTimeout(ms);
  const RUN = Date.now();
  await p.goto(URL, { waitUntil: 'networkidle' }); await W(600);

  console.log('\n=== the front door ===');
  ok('opens on the sign-in form — no sales page', await p.locator('#formLogin').isVisible() && await p.locator('#view-home').isHidden());
  ok('branded Domebox Lite', await p.evaluate(() => getComputedStyle(document.querySelector('#view-auth .brand-word'), '::after').content) === '" Lite"' &&
     (await p.title()) === 'Domebox Lite');
  ok('no link back to a home page, and no legal-page links', !(await p.locator('#view-auth button:has-text("home page")').isVisible()) &&
     !(await p.locator('#view-auth a[href="/privacy"]').isVisible()));
  ok('the page tells search engines not to list it', await p.locator('meta[name="robots"][content*="noindex"]').count() === 1);
  ok('the sales page is not even in the page', await p.locator('#homePlans').count() === 0 && await p.locator('#view-home *').count() === 0);
  if (SHOTS) await p.screenshot({ path: SHOTS + '/lite-01-signin.png' });

  console.log('\n=== setting it up ===');
  await p.evaluate(() => goAuth('signup')); await W(300);
  ok('sign-up says it is the company’s own workspace, no trial', await p.locator('#formSignup .lite-only').isVisible() &&
     !(await p.locator('#formSignup .lite-hide').isVisible()));
  await p.fill('#suCompany', 'Dynamic Engineers'); await p.fill('#suName', 'Kaustabh');
  await p.fill('#suEmail', 'owner' + RUN + '@dynamic.in'); await p.fill('#suPass', 'strongpass123');
  await p.click('#btnSignup'); await p.waitForSelector('#view-app:not(.hidden)', { timeout: 15000 }); await W(2500);
  await p.evaluate(() => closeDialog(true));
  ok('the workspace opens', await p.locator('#view-app').isVisible());
  ok('no plan bar, no trial countdown, no Choose a plan', await p.locator('#banner').isHidden() &&
     !/trial|plan/i.test(await p.locator('#banner').textContent()));
  ok('Lite is white with blue outlines: white app bar with a blue edge, outlined primary buttons',
     await p.evaluate(() => {
       const bar = getComputedStyle(document.querySelector('.appbar'));
       const btn = getComputedStyle(document.querySelector('button.btn-p:not([disabled])') || document.querySelector('.btn-p'));
       return bar.backgroundColor === 'rgb(255, 255, 255)' && bar.borderBottomColor === 'rgb(30, 79, 191)' &&
              btn.backgroundColor === 'rgb(255, 255, 255)' && btn.borderTopColor === 'rgb(30, 79, 191)';
     }));
  ok('the app bar says Domebox Lite', await p.evaluate(() => getComputedStyle(document.querySelector('#view-app .brand-word'), '::after').content) === '" Lite"');
  if (SHOTS) await p.screenshot({ path: SHOTS + '/lite-02-app.png' });
  await p.evaluate(() => openAccount()); await W(400);
  ok('the Admin’s account panel has no Plan & billing', await p.locator('#modal button:has-text("Plan & billing")').count() === 0 &&
     await p.locator('#modal button:has-text("Sign out")').count() === 1);
  await p.evaluate(() => closeModal());
  await p.evaluate(() => { openBilling(); }); await W(300);
  ok('and the plans window cannot be opened at all', await p.locator('#billingPlans').count() === 0 && /not part of Domebox Lite/.test(await p.locator('#dlg').textContent()));
  await p.evaluate(() => closeDialog(true));
  await p.evaluate(() => openHelp()); await W(500);
  const helpText = await p.locator('#modal, #drawer').allTextContents();
  ok('Help has no Billing section', !/Billing/.test(helpText.join(' ')) || await p.evaluate(() => !helpSections().some((s) => s.id === 'billing')));
  await p.evaluate(() => { closeModal(); closeDrawer(); });

  console.log('\n=== the whole product ===');
  await p.click('#navTabs button:has-text("Reports")'); await W(2500);
  ok('Reports are open (Growth)', await p.locator('#reportsLocked').isHidden());
  const added = await p.evaluate(async (RUN) => {
    for (let i = 0; i < 7; i++) await api('addUser', { form: { name: 'Staff ' + i, username: 's' + i, email: 's' + i + '.' + RUN + '@dynamic.in', role: 'Doer', manager: STATE.user.username, jobProfile: 'X', password: 'staffpass123' } });
    return (await api('getUsers')).users.length;
  }, RUN);
  ok('more than 5 people can be added', added === 8, added);

  console.log('\n=== nobody else can move in ===');
  await p.evaluate(() => signOut(false)); await W(400);
  ok('signing out goes back to sign-in, not a sales page', await p.locator('#formLogin').isVisible());
  await p.evaluate(() => goAuth('signup'));
  await p.fill('#suCompany', 'Stranger Ltd'); await p.fill('#suName', 'X');
  await p.fill('#suEmail', 'x' + RUN + '@stranger.in'); await p.fill('#suPass', 'strangerpass1');
  await p.click('#btnSignup'); await W(2000);
  ok('a second company is refused, with a clear reason', /already set up for Dynamic Engineers/.test(await p.locator('#dlg').textContent()), await p.locator('#dlg').textContent());
  await p.evaluate(() => closeDialog(true));

  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(URL, { waitUntil: 'networkidle' });
  ok('on a phone, also straight to sign-in', await m.locator('#formLogin').isVisible());
  if (SHOTS) await m.screenshot({ path: SHOTS + '/lite-03-phone.png' });
  const full = await b.newPage({ viewport: { width: 1360, height: 860 } });
  await full.goto('http://localhost:8095/?login=1', { waitUntil: 'networkidle' }).catch(() => {});
  ok('the full edition keeps its own colours (navy sign-in page)', await full.evaluate(() =>
     !document.documentElement.classList.contains('lite') && getComputedStyle(document.getElementById('view-auth')).backgroundColor !== 'rgb(255, 255, 255)').catch(() => false));
  ok('nothing threw', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
