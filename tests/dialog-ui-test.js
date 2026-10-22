/**
 * The app's own dialog: errors, warnings and successes look like what they
 * are, a question has two answers, a dialog over a form never loses the form,
 * and the browser's grey alert/confirm boxes are not used anywhere.
 * Start the test server first: node server.js
 */
const fs = require('fs');
const { chromium } = require('/home/user/stockpilot/node_modules/playwright');
const http = require('http');
const hit = (p) => new Promise((r) => http.get('http://localhost:8095' + p, (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => r(b)); }));
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 240) + ']')); v ? pass++ : fail++; };
const SHOTS = process.argv[2];

(async () => {
  const ui = fs.readdirSync(__dirname + '/../src/ui').filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(__dirname + '/../src/ui/' + f, 'utf8')).join('\n');
  ok('no browser alert, confirm or prompt box anywhere in the app', !/\b(window\.)?(alert|confirm|prompt)\(/.test(ui.replace(/confirmBox\(/g, '')));

  await hit('/__demo');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1360, height: 860 } });
  const errs = []; let native = 0;
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => { native++; d.dismiss(); });
  const W = (ms) => p.waitForTimeout(ms);
  await p.goto('http://localhost:8095/', { waitUntil: 'networkidle' }); await W(400);

  console.log('\n=== a failure ===');
  await p.evaluate(() => goAuth('login'));
  await p.fill('#liUser', 'nobody@example.com'); await p.fill('#liPass', 'wrongpass123');
  await p.click('#btnLogin'); await p.waitForSelector('#dlg.dlg-error', { timeout: 8000 });
  ok('a wrong password opens a red error dialog', await p.locator('#dlgScrim.on').isVisible() &&
     /Something went wrong/.test(await p.locator('#dlgTitle').textContent()));
  ok('with the server’s own words in it', (await p.locator('#dlgMsg').textContent()).trim().length > 5, await p.locator('#dlgMsg').textContent());
  ok('the OK button has the focus, so Enter closes it', await p.evaluate(() => document.activeElement && document.activeElement.dataset.a === 'yes'));
  ok('it is announced to screen readers as an alert', await p.locator('#dlg[role="alertdialog"]').count() === 1);
  if (SHOTS) await W(400), await p.screenshot({ path: SHOTS + '/dialog-01-error.png' });
  await p.keyboard.press('Enter'); await W(200);
  ok('Enter closes it, and the form is still filled in', !(await p.locator('#dlgScrim').isVisible()) &&
     await p.inputValue('#liUser') === 'nobody@example.com');

  console.log('\n=== a warning ===');
  await p.evaluate(() => { toast('Pick at least one person.', 'warn'); }); await W(250);
  ok('a warning is amber, titled “Please check”', await p.locator('#dlg.dlg-warning').isVisible() &&
     /Please check/.test(await p.locator('#dlgTitle').textContent()));
  if (SHOTS) await W(400), await p.screenshot({ path: SHOTS + '/dialog-02-warning.png' });
  await p.keyboard.press('Escape'); await W(200);
  ok('Esc closes it', !(await p.locator('#dlgScrim').isVisible()));

  console.log('\n=== a success ===');
  await p.evaluate(() => { toast('Task assigned to Payel.', 'ok'); }); await W(300);
  ok('a success is green, titled “Done”', await p.locator('#dlg.dlg-success').isVisible() &&
     /Done/.test(await p.locator('#dlgTitle').textContent()) && /Payel/.test(await p.locator('#dlgMsg').textContent()));
  ok('it does not dim the page or block clicks underneath', await p.evaluate(() =>
     getComputedStyle(document.getElementById('dlgScrim')).pointerEvents === 'none'));
  if (SHOTS) await W(400), await p.screenshot({ path: SHOTS + '/dialog-03-success.png' });
  await W(2700);
  ok('and closes by itself after a moment', !(await p.locator('#dlgScrim').isVisible()));
  await p.evaluate(() => { toast('Saved.', 'ok'); toast('The server is not reachable right now.', 'err'); }); await W(250);
  ok('an error that follows a success replaces it at once', await p.locator('#dlg.dlg-error').isVisible());
  await p.evaluate(() => closeDialog(true));

  console.log('\n=== one at a time ===');
  await p.evaluate(() => { toast('First problem.', 'err'); toast('First problem.', 'err'); toast('Second problem.', 'warn'); }); await W(250);
  ok('the first shows', /First problem/.test(await p.locator('#dlgMsg').textContent()));
  await p.click('#dlg button:has-text("OK")'); await W(350);
  ok('the next waits its turn, and a repeat is shown once', /Second problem/.test(await p.locator('#dlgMsg').textContent()));
  await p.click('#dlg button:has-text("OK")'); await W(300);
  ok('then nothing is left', !(await p.locator('#dlgScrim').isVisible()));

  console.log('\n=== a question ===');
  const ans = p.evaluate(() => confirmBox('Nothing is sent, and it is not kept in the history.',
    { title: 'Cancel this meeting?', ok: 'Cancel meeting', cancel: 'Keep it', danger: true }));
  await W(250);
  ok('a question has two buttons, the risky one in red', await p.locator('#dlg.dlg-confirm').isVisible() &&
     await p.locator('#dlg .btn-danger:has-text("Cancel meeting")').count() === 1 &&
     await p.locator('#dlg button:has-text("Keep it")').count() === 1);
  ok('and the safe answer has the focus', await p.evaluate(() => document.activeElement.textContent === 'Keep it'));
  if (SHOTS) await W(400), await p.screenshot({ path: SHOTS + '/dialog-04-confirm.png' });
  await p.keyboard.press('Escape');
  ok('Esc answers no', (await ans) === false);
  const yes = p.evaluate(() => confirmBox('Sure?'));
  await W(200); await p.click('#dlg button:has-text("Yes")');
  ok('the yes button answers yes', (await yes) === true);

  console.log('\n=== over an open form ===');
  await p.goto('http://localhost:8095/', { waitUntil: 'networkidle' });
  await p.locator('#demo button:has-text("as a manager")').click(); await p.waitForSelector('#board .card', { timeout: 15000 });
  await p.evaluate(() => closeDialog(true));
  await p.evaluate(() => openModal('<div class="p-6"><input id="tmpField" class="in" value="half-typed"></div>'));
  await p.evaluate(() => { toast('That task is not one you can see.', 'warn'); }); await W(250);
  ok('the dialog sits above the form', await p.evaluate(() =>
     Number(getComputedStyle(document.getElementById('dlgScrim')).zIndex) > Number(getComputedStyle(document.getElementById('scrim')).zIndex)));
  await p.keyboard.press('Escape'); await W(200);
  ok('closing it leaves the form open with what was typed', await p.locator('#tmpField').isVisible() &&
     await p.inputValue('#tmpField') === 'half-typed');
  await p.evaluate(() => closeModal());
  const tryWrite = await p.evaluate(() => api('createTask', { form: { title: 'x', assignTo: 'payel', dueDate: '2030-01-01', priority: 'Low' } })
    .catch((e) => { toast(e.message, 'err'); return 'refused'; }));
  await W(250);
  ok('a refused change in the demo is explained in an error dialog', tryWrite === 'refused' &&
     /switched off/.test(await p.locator('#dlgMsg').textContent()));
  await p.evaluate(() => closeDialog(true));

  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto('http://localhost:8095/', { waitUntil: 'networkidle' });
  const qa = m.evaluate(() => confirmBox('Nothing is sent, and it is not kept in the history.',
    { title: 'Cancel this meeting?', ok: 'Cancel meeting', cancel: 'Keep it', danger: true }));
  await m.waitForTimeout(300);
  ok('on a phone the dialog fits, buttons full width', await m.evaluate(() => {
    const r = document.getElementById('dlg').getBoundingClientRect();
    const bs = [...document.querySelectorAll('#dlg .dlg-actions .btn')].map((x) => x.getBoundingClientRect().width);
    return r.left >= 0 && r.right <= innerWidth && bs.every((w) => w > 250); }));
  if (SHOTS) await m.waitForTimeout(400), await m.screenshot({ path: SHOTS + '/dialog-05-phone.png' });
  await m.evaluate(() => closeDialog(false)); await qa;

  ok('the browser’s own dialog boxes never appeared', native === 0, native);
  ok('nothing threw', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
