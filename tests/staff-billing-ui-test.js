/**
 * Plans and billing are the owner's. A manager or a team member sees no plan,
 * no trial countdown, no renewal date and no way into billing — on screen or
 * in what the server sends — while the owner keeps all of it.
 * Start the test server first: node server.js
 */
const { chromium } = require('/home/user/stockpilot/node_modules/playwright');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 260) + ']')); v ? pass++ : fail++; };
const SHOTS = process.argv[2];

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1360, height: 860 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const W = (ms) => p.waitForTimeout(ms);
  const RUN = Date.now(), owner = 'owner' + RUN + '@mehta.in';
  const signIn = async (u, pw) => {
    await p.evaluate(() => { if (STATE.token) signOut(false); goAuth('login'); }); await W(300);
    await p.fill('#liUser', u); await p.fill('#liPass', pw);
    const res = p.waitForResponse((r) => r.url().endsWith('/exec') && (r.request().postData() || '').includes('"login"'));
    await p.click('#btnLogin'); const login = await (await res).json();
    await p.waitForSelector('#view-app:not(.hidden)', { timeout: 15000 }); await W(2000);
    await p.evaluate(() => closeDialog(true));
    return login;
  };

  await p.goto('http://localhost:8095/', { waitUntil: 'networkidle' });
  await p.evaluate(() => goAuth('signup'));
  await p.fill('#suCompany', 'Mehta Castings'); await p.fill('#suName', 'Rohan Mehta');
  await p.fill('#suEmail', owner); await p.fill('#suPass', 'strongpass123');
  await p.click('#btnSignup'); await p.waitForSelector('#view-app:not(.hidden)'); await W(2500);
  await p.evaluate(() => closeDialog(true));

  console.log('\n=== the owner ===');
  ok('sees the plan and the trial countdown', /Free trial of the full Growth plan/.test(await p.locator('#banner').textContent()));
  ok('with a Choose a plan button', await p.locator('#banner button:has-text("Choose a plan")').isVisible());
  await p.evaluate(() => openAccount()); await W(400);
  ok('and Plan & billing in the account panel', await p.locator('#modal button:has-text("Plan & billing")').count() === 1);
  await p.evaluate(() => closeModal());
  await p.evaluate(async (RUN) => {
    const me = STATE.user.username;
    await api('addUser', { form: { name: 'Sruti Das', username: 'sruti', email: 'sruti' + RUN + '@mehta.in', role: 'HOD', manager: me, jobProfile: 'Ops', password: 'staffpass123' } });
    await api('addUser', { form: { name: 'Payel Das', username: 'payel', email: 'payel' + RUN + '@mehta.in', role: 'Doer', manager: 'sruti', jobProfile: 'Ops', password: 'staffpass123' } });
  }, RUN);

  for (const [who, email] of [['a manager', 'sruti' + RUN + '@mehta.in'], ['a team member', 'payel' + RUN + '@mehta.in']]) {
    console.log('\n=== ' + who + ' ===');
    const login = await signIn(email, 'staffpass123');
    ok('sign-in does not send the plan', login.status === 'success' && !login.plan, JSON.stringify({ plan: login.plan }));
    ok('no plan banner, no trial countdown, no buy button', await p.locator('#banner').isHidden() &&
       !/trial|Growth|plan/i.test(await p.locator('#banner').textContent()));
    if (SHOTS) await p.screenshot({ path: SHOTS + '/staff-' + (who === 'a manager' ? 'manager' : 'doer') + '.png' });
    await p.evaluate(() => openAccount()); await W(400);
    ok('the account panel has no Plan & billing', await p.locator('#modal button:has-text("Plan & billing")').count() === 0 &&
       await p.locator('#modal button:has-text("Sign out")').count() === 1);
    if (SHOTS && who === 'a team member') await p.screenshot({ path: SHOTS + '/staff-account.png' });
    await p.evaluate(() => closeModal());
    await p.evaluate(() => { openBilling(); }); await W(300);
    ok('even calling the plans window directly only says the Admin manages it',
       await p.locator('#modal #billingPlans').count() === 0 && /managed by your company’s Admin/.test(await p.locator('#dlg').textContent()));
    await p.evaluate(() => closeDialog(true));
    const usage = await p.evaluate(async () => (await api('getDashboard')).usage);
    ok('the dashboard data carries no plan, trial, renewal date or user cap',
       !usage.planName && !usage.plan && usage.daysLeft === null && usage.trial === false && usage.maxUsers === null && !(usage.warnings || []).length,
       JSON.stringify(usage));
    const server = await p.evaluate(async () => {
      const out = {};
      for (const [a, body] of [['getBilling', {}], ['saveBilling', { form: { state: 'West Bengal' } }], ['getInvoices', {}], ['initiateRazorpay', { planName: 'Team' }]]) {
        try { await api(a, body); out[a] = 'ALLOWED'; } catch (e) { out[a] = 'refused'; }
      }
      return out;
    });
    ok('and the server refuses billing details, invoices and payment', Object.values(server).every((v) => v === 'refused'), JSON.stringify(server));
    ok('while their work still works: the board loads', await p.evaluate(() => Array.isArray(STATE.data.tasks)));
  }

  console.log('\n=== back to the owner ===');
  await signIn(owner, 'strongpass123');
  ok('the owner still sees the plan banner', /Free trial/.test(await p.locator('#banner').textContent()));
  ok('nothing threw', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
