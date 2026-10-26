/**
 * In a browser, on either edition: finding people in Assign by search, typing
 * a new job category in place, and the Admin arranging the tab bar for the
 * whole company.
 *   node customise-ui-test.js [shots-dir] [base-url]    (default http://localhost:8095/)
 * Start the matching test server first; for Lite, a fresh one on 8096.
 */
const { chromium } = require('/home/user/stockpilot/node_modules/playwright');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 260) + ']')); v ? pass++ : fail++; };
const SHOTS = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : '';
const URL = process.argv[3] || 'http://localhost:8095/';
const TAG = /8096/.test(URL) ? 'lite' : 'full';

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1360, height: 860 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const W = (ms) => p.waitForTimeout(ms);
  const RUN = Date.now();
  const signIn = async (u, pw) => {
    await p.evaluate(() => { if (STATE.token) signOut(false); goAuth('login'); }); await W(300);
    await p.fill('#liUser', u); await p.fill('#liPass', pw); await p.click('#btnLogin');
    await p.waitForSelector('#view-app:not(.hidden)', { timeout: 15000 }); await W(2000);
    await p.evaluate(() => closeDialog(true));
  };
  await p.goto(URL + '?signup=1', { waitUntil: 'networkidle' }); await W(500);
  await p.evaluate(() => goAuth('signup'));
  await p.fill('#suCompany', 'Dynamic Engineers'); await p.fill('#suName', 'Kaustabh');
  await p.fill('#suEmail', 'owner' + RUN + '@dyn.in'); await p.fill('#suPass', 'strongpass123');
  await p.click('#btnSignup'); await p.waitForSelector('#view-app:not(.hidden)', { timeout: 15000 }); await W(2500);
  await p.evaluate(() => closeDialog(true));
  await p.evaluate(async (RUN) => {
    const me = STATE.user.username;
    const people = [['Payel Das', 'Doer', 'Operations'], ['Rafiq Ahmed', 'Doer', 'Quality'], ['Nita Bose', 'Doer', 'Quality'],
      ['Vikram Rathore', 'Doer', 'Operations'], ['Meera Iyer', 'Doer', 'Stores'], ['Imran Qureshi', 'HOD', 'Quality'],
      ['Sruti Sen', 'HOD', 'Operations'], ['Arjun Rao', 'Doer', 'Dispatch'], ['Kavya Nair', 'Doer', 'Dispatch'],
      ['Rohit Shah', 'Doer', 'Stores'], ['Anil Kumar', 'Doer', 'Maintenance'], ['Deepa Paul', 'Doer', 'Accounts']];
    for (const [n, role, dept] of people) {
      const u = n.split(' ')[0].toLowerCase();
      await api('addUser', { form: { name: n, username: u, email: u + RUN + '@dyn.in', role, dept, manager: me, jobProfile: 'Staff', password: 'staffpass123' } });
    }
    await refresh();
  }, RUN);
  await W(800);

  console.log('\n=== [' + TAG + '] finding people in Assign ===');
  await p.click('#tab-tasks button:has-text("Assign"):visible'); await W(600);
  ok('Assign has a search box above the people', await p.locator('#asWhoQ').isVisible());
  await p.fill('#asWhoQ', 'rafiq'); await W(150);
  const shown = async () => (await p.locator('.asWhoRow:visible').allTextContents()).map((t) => t.trim());
  ok('typing a name narrows the list to that person', (await shown()).length === 1 && /Rafiq Ahmed/.test((await shown())[0]), (await shown()).join(' | '));
  await p.press('#asWhoQ', 'Enter'); await W(150);
  ok('Enter ticks them, clears the search, and the form is not submitted', await p.locator('.asWho[value="rafiq"]').isChecked() &&
     await p.inputValue('#asWhoQ') === '' && await p.locator('#fAssign').isVisible());
  ok('a count says how many are picked', /1 selected/.test(await p.locator('#asWhoCount').textContent()));
  await p.fill('#asWhoQ', 'quality'); await W(150);
  ok('searching a department finds everyone in it', (await shown()).length === 3, (await shown()).join(' | '));
  await p.fill('#asWhoQ', 'nita'); await W(150);
  await p.locator('.asWhoRow:visible .asWho').check(); await p.fill('#asWhoQ', 'zzz'); await W(150);
  ok('no match says so', await p.locator('#asWhoNone').isVisible());
  ok('and people ticked earlier stay ticked while hidden', await p.locator('.asWho[value="rafiq"]').isChecked() &&
     await p.locator('.asWho[value="nita"]').isChecked() && /2 selected/.test(await p.locator('#asWhoCount').textContent()));
  await p.fill('#asWhoQ', 'ra');
  if (SHOTS) await p.screenshot({ path: SHOTS + '/' + TAG + '-assign-search.png' });
  await p.fill('#asWhoQ', '');

  console.log('\n=== [' + TAG + '] a new job category, typed in place ===');
  ok('the category list offers “＋ New category…”', await p.locator('#asCat option[value="__new__"]').count() === 1);
  await p.selectOption('#asCat', '__new__'); await W(150);
  ok('choosing it opens a box for the name', await p.locator('#asCatNew').isVisible());
  await p.fill('#asTitle', 'Calibrate the bore gauges');
  await p.click('#fAssign button[type=submit]'); await W(300);
  ok('left empty, it asks for the name instead of saving', /Type the new category name/.test(await p.locator('#dlg').textContent()));
  await p.evaluate(() => closeDialog(true));
  await p.fill('#asCatNew', 'Calibration');
  await p.click('#fAssign button[type=submit]'); await W(2500);
  await p.evaluate(() => closeDialog(true));
  const st = await p.evaluate(() => ({ cats: STATE.data.categories, t: STATE.data.tasks.filter((t) => t.title === 'Calibrate the bore gauges').map((t) => t.jobCategory) }));
  ok('the task is filed under it, for both people', st.t.length === 2 && st.t.every((c) => c === 'Calibration'), JSON.stringify(st.t));
  ok('and it is now on the company’s list for next time', st.cats.indexOf('Calibration') > -1, st.cats.join(','));

  console.log('\n=== [' + TAG + '] the Admin arranges the tabs ===');
  await p.evaluate(() => openAccount()); await W(300);
  ok('the Admin’s account panel has Arrange tabs and Job categories', await p.locator('#modal button:has-text("Arrange tabs")').count() === 1 &&
     await p.locator('#modal button:has-text("Job categories")').count() === 1);
  await p.click('#modal button:has-text("Arrange tabs")'); await W(400);
  const row = (k) => p.locator('.tlRow[data-k="' + k + '"]');
  ok('Tasks and Team are marked always on', /Always on/.test(await row('tasks').textContent()) && /Always on/.test(await row('team').textContent()));
  await row('meetings').locator('.tlUp').click(); await row('meetings').locator('.tlUp').click(); await W(100);   // meetings → 2nd
  await row('goals').locator('.tlToggle').click(); await row('board').locator('.tlToggle').click(); await W(100);
  if (SHOTS) await p.screenshot({ path: SHOTS + '/' + TAG + '-arrange-tabs.png' });
  await p.click('#tlSave'); await W(1800);
  await p.evaluate(() => closeDialog(true));
  const bar = async (sel) => (await p.locator(sel + ' button:visible').allTextContents()).map((t) => t.trim()).join('|');
  const WANT = 'Tasks|Meetings|Priority|Projects|Reports|Team';
  ok('the bar now reads ' + WANT.replace(/\|/g, ' · '), await bar('#navTabs') === WANT, await bar('#navTabs'));
  if (SHOTS) await p.screenshot({ path: SHOTS + '/' + TAG + '-tabs-after.png', clip: { x: 0, y: 0, width: 1360, height: 70 } });
  await p.reload({ waitUntil: 'networkidle' }); await W(2500);
  ok('and stays that way after a reload', await bar('#navTabs') === WANT, await bar('#navTabs'));

  console.log('\n=== [' + TAG + '] what everyone else sees ===');
  await signIn('payel' + RUN + '@dyn.in', 'staffpass123');
  ok('a team member gets the same bar', await bar('#navTabs') === WANT, await bar('#navTabs'));
  await p.evaluate(() => openAccount()); await W(300);
  ok('but no Arrange tabs or Job categories in their account panel', await p.locator('#modal button:has-text("Arrange tabs")').count() === 0 &&
     await p.locator('#modal button:has-text("Job categories")').count() === 0);
  await p.evaluate(() => closeModal());
  await p.evaluate(() => { STATE.tab = 'team'; renderTab(); }); await W(1200);
  ok('and no Arrange tabs on the Team page', await p.locator('#btnTabs').isHidden());
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(URL, { waitUntil: 'networkidle' }); await m.waitForTimeout(400);
  await m.evaluate(() => goAuth('login'));
  await m.fill('#liUser', 'payel' + RUN + '@dyn.in'); await m.fill('#liPass', 'staffpass123'); await m.click('#btnLogin');
  await m.waitForSelector('#view-app:not(.hidden)', { timeout: 15000 }); await m.waitForTimeout(2000);
  ok('the phone tab bar follows the same order', (await m.locator('#navTabsMobile button:visible').allTextContents()).map((t) => t.trim()).join('|') === WANT);

  ok('nothing threw', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
