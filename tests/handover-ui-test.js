/**
 * "Hand over" from a task, clicked the way people click it: the owner hands
 * work straight on, a team member proposes and their manager approves. And
 * the demo can always be left for the home page.
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
  const dlg = async () => (await p.locator('#dlgScrim').isVisible()) ? (await p.locator('#dlg').textContent()).trim() : '';
  const signIn = async (u, pw) => {
    await p.evaluate(() => { if (STATE.token) signOut(false); goAuth('login'); }); await W(300);
    await p.fill('#liUser', u); await p.fill('#liPass', pw); await p.click('#btnLogin');
    await p.waitForSelector('#view-app:not(.hidden)', { timeout: 15000 }); await W(1800);
    await p.evaluate(() => closeDialog(true));
  };
  const openTask = async (title) => {
    await p.evaluate(() => { STATE.tab = 'tasks'; renderTab(); }); await W(400);
    await p.click('#board .card:has-text("' + title + '")', { timeout: 8000 }).catch(async (e) => {
      await p.screenshot({ path: '/tmp/claude-0/-home-user-stockpilot/e6c998f0-2621-534d-a996-b8665e1c9422/scratchpad/ho-fail.png' });
      console.log('SERVER', await p.evaluate(async () => { const d = await api('getDashboard'); return JSON.stringify({ me: STATE.user, n: d.tasks.length, titles: d.tasks.map((t) => t.title + '@' + t.assignee), local: STATE.data.tasks.length }); }));
      console.log('STATE', await p.evaluate(() => JSON.stringify({ tab: STATE.tab, mode: STATE.mode, board: document.getElementById('board').className,
        scrim: document.getElementById('scrim').className, drawer: document.getElementById('drawer').className })));
      throw e; });
    await W(500);
  };

  await p.goto('http://localhost:8095/', { waitUntil: 'networkidle' });
  const RUN = Date.now();
  const owner = 'rohan' + RUN + '@mehta.in';
  await p.evaluate(() => goAuth('signup'));
  await p.fill('#suCompany', 'Mehta Castings'); await p.fill('#suName', 'Rohan Mehta');
  await p.fill('#suEmail', owner); await p.fill('#suPass', 'strongpass123');
  await p.click('#btnSignup'); await p.waitForSelector('#view-app:not(.hidden)'); await W(2500);
  await p.evaluate(() => closeDialog(true));
  const setup = await p.evaluate(async (RUN) => {
    const me = STATE.user.username;
    await api('addUser', { form: { name: 'Payel Das', username: 'payel', email: 'payel' + RUN + '@mehta.in', role: 'Doer', manager: me, jobProfile: 'Production', password: 'staffpass123' } });
    await api('addUser', { form: { name: 'Asha Roy', username: 'asha', email: 'asha' + RUN + '@mehta.in', role: 'Doer', manager: me, jobProfile: 'Production', password: 'staffpass123' } });
    const due = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
    await api('createTask', { form: { title: 'Pack 50 bearings', assignTo: 'payel', dueDate: due, priority: 'High' } });
    await api('createTask', { form: { title: 'Call the motor supplier', assignTo: 'payel', dueDate: due, priority: 'Medium' } });
    await refresh(); return me;
  }, RUN);

  console.log('\n=== the owner hands a task straight over ===');
  await openTask('Pack 50 bearings');
  ok('the task shows a Hand over button', await p.locator('#drawer .act[data-act="delegate"]').isVisible());
  await p.click('#drawer .act[data-act="delegate"]'); await W(500);
  ok('it opens the hand-over form for THIS task, not the meeting form',
     await p.locator('#fDel').isVisible() && /Hand over "Pack 50 bearings"/.test(await p.locator('#fDel').textContent()) &&
     await p.locator('#fDelegate').count() === 0, await p.locator('#modal').textContent());
  ok('and the form is in front of the task panel, not hidden behind it', await p.evaluate(() => {
    const r = document.getElementById('fDel').getBoundingClientRect();
    const top = document.elementFromPoint(r.right - 20, r.top + 20);
    return !!(top && top.closest('#fDel')); }));
  ok('listing everybody except the current holder', (await p.locator('#delTo option').allTextContents()).join('|').indexOf('Payel') < 0 &&
     /Asha Roy/.test((await p.locator('#delTo option').allTextContents()).join('|')));
  await p.selectOption('#delTo', 'asha');
  if (SHOTS) await p.screenshot({ path: SHOTS + '/handover-01-form.png' });
  await p.click('#fDel button:has-text("Propose")'); await W(1800);
  ok('it says it is done', /Handed over to Asha Roy/.test(await dlg()), await dlg());
  const t1 = await p.evaluate(() => STATE.data.tasks.find((t) => t.title === 'Pack 50 bearings'));
  ok('and Asha now holds it', t1.assignee === 'asha' && t1.status === 'Pending', JSON.stringify([t1.assignee, t1.status]));

  console.log('\n=== a team member proposes, their manager decides ===');
  await signIn('payel' + RUN + '@mehta.in', 'staffpass123');
  await openTask('Call the motor supplier');
  await p.click('#drawer .act[data-act="delegate"]'); await W(500);
  ok('Payel can open Hand over on her own task', await p.locator('#fDel').isVisible());
  await p.selectOption('#delTo', 'asha');
  await p.click('#fDel button:has-text("Propose")'); await W(1800);
  ok('it is proposed, not done behind the manager’s back', /proposes handing this to Asha Roy/.test(await dlg()), await dlg());
  const t2 = await p.evaluate(() => STATE.data.tasks.find((t) => t.title === 'Call the motor supplier'));
  ok('the task waits for approval, still with Payel', t2.status === 'Delegation Proposed' && t2.assignee === 'payel', JSON.stringify([t2.status, t2.assignee]));
  await signIn(owner, 'strongpass123');
  await openTask('Call the motor supplier');
  if (SHOTS) await p.screenshot({ path: SHOTS + '/handover-02-approve.png' });
  await p.click('#drawer .act[data-act="approve"]'); await W(1800);
  const t3 = await p.evaluate(() => STATE.data.tasks.find((t) => t.title === 'Call the motor supplier'));
  ok('the manager approves and it moves to Asha', t3.assignee === 'asha' && t3.status !== 'Delegation Proposed', JSON.stringify([t3.status, t3.assignee]));
  await p.evaluate(() => closeDialog(true));

  console.log('\n=== leaving the demo ===');
  await p.evaluate(() => signOut(false)); await W(400);
  await p.evaluate(() => showHome()); await W(300);
  await p.locator('#demo button:has-text("as a manager")').click(); await p.waitForSelector('#view-app:not(.hidden)'); await W(2500);
  ok('the demo bar has an Exit demo button', await p.locator('#btnExitDemo').isVisible());
  ok('and on a computer the whole demo bar fits on one line', await p.evaluate(() =>
     document.querySelector('.demo-bar').getBoundingClientRect().height < 70));
  if (SHOTS) await p.screenshot({ path: SHOTS + '/handover-03-demo-exit.png', clip: { x: 0, y: 0, width: 1360, height: 140 } });
  await p.click('#btnExitDemo'); await W(600);
  ok('it goes back to the Domebox home page, no new tab needed', await p.locator('#view-home').isVisible() &&
     await p.locator('#view-app').isHidden() && await p.evaluate(() => !STATE.token && !STATE.demo));
  ok('without an alarming “session ended” message', !(await p.locator('#dlgScrim').isVisible()), await dlg());
  await p.locator('#demo button:has-text("as the owner")').click().catch(() => p.locator('#demo button').first().click());
  await p.waitForSelector('#view-app:not(.hidden)'); await W(2500);
  await p.click('#navBrand'); await W(600);
  ok('the Domebox logo also takes a demo visitor home', await p.locator('#view-home').isVisible());
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto('http://localhost:8095/', { waitUntil: 'networkidle' });
  await m.locator('.sticky-cta button:has-text("Live demo")').click(); await m.waitForSelector('#view-app:not(.hidden)'); await m.waitForTimeout(2500);
  ok('on a phone too, Exit demo is on screen', await m.locator('#btnExitDemo').isVisible());
  if (SHOTS) await m.screenshot({ path: SHOTS + '/handover-04-demo-exit-phone.png' });
  await m.click('#btnExitDemo'); await m.waitForTimeout(500);
  ok('and works', await m.locator('#view-home').isVisible());

  ok('nothing threw', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
