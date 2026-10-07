/* Screenshots of the newer features, against the real app. */
const { chromium } = require('playwright');
const [OWNER, PAYEL, SRUTI] = process.argv.slice(2);

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  const shot = async (name) => { await p.screenshot({ path: 'new-' + name + '.png' }); console.log('  ' + name); };
  const login = async (email, pass) => {
    await p.goto('http://localhost:8095/?login=1', { waitUntil: 'networkidle' });
    // A restored session hides the form; sign out first so the fill lands.
    await p.evaluate(() => { try { signOut(); } catch (e) {} });
    await p.waitForTimeout(800);
    await p.fill('#liUser', email); await p.fill('#liPass', pass);
    await p.click('#btnLogin'); await p.waitForTimeout(2000);
  };
  const esc = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(400); };

  await login(OWNER, 'strongpass123');
  await shot('01-board');

  await p.click('[data-tab="projects"]'); await p.waitForTimeout(1400);
  await shot('02-projects');

  await p.click('[data-tab="team"]'); await p.waitForTimeout(1200);
  await p.click('#btnOrg'); await p.waitForTimeout(1400); await shot('03-org-chart'); await esc();
  await p.click('#btnCookie'); await p.waitForTimeout(900); await shot('04-cookie-award'); await esc();
  await p.click('#btnKra'); await p.waitForTimeout(1400); await shot('05-kra-overview');
  await p.click('.kEdit >> nth=2'); await p.waitForTimeout(1200); await shot('06-kra-editor'); await esc();

  await p.click('[data-tab="reports"]'); await p.waitForTimeout(1800);
  await shot('07-reports');
  await p.click('#btnAccount2'); await p.waitForTimeout(1600); await shot('08-accountability'); await esc();
  await p.click('#btnAppraise'); await p.waitForTimeout(900);
  await p.selectOption('#apWho', { index: (await p.locator('#apWho option').allTextContents())
    .findIndex((t) => /Payel/.test(t)) });
  await p.waitForTimeout(1600); await shot('09-appraisal'); await esc();

  // The doer's own view: the score that answers the volume question.
  await login(PAYEL, 'staffpass123');
  await p.click('[data-tab="tasks"]'); await p.waitForTimeout(800);
  await p.click('text=See why'); await p.waitForTimeout(1000); await shot('10-score-load');
  await p.evaluate(() => { document.querySelector('#modal').scrollTop = 620; });
  await p.waitForTimeout(400); await shot('11-score-detail'); await esc();

  // And a light record beside it, flagged rather than failed.
  await login(SRUTI, 'staffpass123');
  await p.click('[data-tab="tasks"]'); await p.waitForTimeout(800);
  await p.click('text=See why'); await p.waitForTimeout(1000); await shot('12-score-manager'); await esc();

  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  await mp.goto('http://localhost:8095/?login=1', { waitUntil: 'networkidle' });
  await mp.fill('#liUser', OWNER); await mp.fill('#liPass', 'strongpass123');
  await mp.click('#btnLogin'); await mp.waitForTimeout(2000);
  await mp.screenshot({ path: 'new-13-mobile-board.png' }); console.log('  13-mobile-board');
  await mp.click("#navTabsMobile button[data-tab=\"projects\"]"); await mp.waitForTimeout(1400);
  await mp.screenshot({ path: 'new-14-mobile-projects.png' }); console.log('  14-mobile-projects');

  await b.close();
})();
