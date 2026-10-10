/**
 * The dialog behind Submit for review, Verify & close and Send back.
 *
 * It shared its id with the status filter on the Tasks bar, which comes first
 * in the page — so its submit handler was attached to a <select>, and pressing
 * the button did a native form submit: the page reloaded and nothing was
 * saved. No test clicked through it, which is how it survived. This one does,
 * for all three, and checks the page never reloads.
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

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 200) + ']')); v ? pass++ : fail++; };
  const RUN = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const email = 'dlg+' + RUN + '@acme.in', me = email.split('@')[0];
  const A = (await post({ action: 'register', form: { companyName: 'Acme', name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await post({ action: 'addUser', token: A, form: { name: 'Payel S', username: 'payel' + RUN, email: 'payel' + RUN + '@acme.in',
    role: 'Doer', manager: me, jobProfile: 'Executive', password: 'staffpass123' } });
  await post({ action: 'createTask', token: A, form: { title: 'Dialog task', assignTo: 'payel' + RUN, dueDate: '2026-12-20' } });
  const status = async () => (await post({ action: 'getDashboard', token: A })).tasks.find((x) => x.title === 'Dialog task');

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const login = async (user, pw) => {
    const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
    await p.goto('http://localhost:8095/?login=1', { waitUntil: 'networkidle' });
    await p.fill('#liUser', user); await p.fill('#liPass', pw);
    await p.click('#btnLogin'); await p.waitForTimeout(1600);
    p.navs = 0; p.on('framenavigated', () => p.navs++);
    return p;
  };
  const open = async (p) => { await p.click('.card:has-text("Dialog task")'); await p.waitForTimeout(500); };

  console.log('\n--- the Doer hands it in ---');
  const D = await login('payel' + RUN + '@acme.in', 'staffpass123');
  await open(D); await D.click('#drawer .act[data-act="start"]'); await D.waitForTimeout(1200);
  await open(D); await D.click('#drawer .act[data-act="submit"]'); await D.waitForTimeout(500);
  ok('Submit for review opens the dialog', await D.locator('#fStatusChange').count() === 1);
  const note = D.locator('#fStatusChange textarea').first();
  if (await note.count()) await note.fill('Done — photos in the shared drive');
  await D.click('#fStatusChange button[type=submit]'); await D.waitForTimeout(1500);
  ok('pressing it does not reload the page', D.navs === 0, D.navs + ' navigation(s)');
  ok('and the task is actually handed in', (await status()).status === 'For Review', (await status()).status);

  console.log('\n--- the manager sends it back with a new deadline ---');
  const M = await login(email, 'strongpass123');
  await open(M); await M.click('#drawer .act[data-act="rework"]'); await M.waitForTimeout(500);
  ok('Send back opens the dialog', await M.locator('#fStatusChange').count() === 1);
  const mnote = M.locator('#fStatusChange textarea').first();
  if (await mnote.count()) await mnote.fill('Photos of the weld joints are missing');
  const date = M.locator('#fStatusChange input[type=date]').first();
  if (await date.count()) await date.fill('2026-12-28');
  await M.click('#fStatusChange button[type=submit]'); await M.waitForTimeout(1500);
  ok('without reloading', M.navs === 0, M.navs + ' navigation(s)');
  const back = await status();
  ok('it is back in progress', back.status === 'In Progress', back.status);
  ok('with the rework counted', back.reworkCount === 1, back.reworkCount);

  console.log('\n--- handed in again, then verified ---');
  await D.reload({ waitUntil: 'networkidle' }); await D.waitForTimeout(1500); D.navs = 0;
  await open(D); await D.click('#drawer .act[data-act="submit"]'); await D.waitForTimeout(500);
  await D.click('#fStatusChange button[type=submit]'); await D.waitForTimeout(1500);
  await M.reload({ waitUntil: 'networkidle' }); await M.waitForTimeout(1500); M.navs = 0;
  await open(M); await M.click('#drawer .act[data-act="verify"]'); await M.waitForTimeout(500);
  ok('Verify & close opens the dialog', await M.locator('#fStatusChange').count() === 1);
  await M.click('#fStatusChange button[type=submit]'); await M.waitForTimeout(1500);
  ok('without reloading', M.navs === 0, M.navs + ' navigation(s)');
  ok('and it is verified', (await status()).status === 'Verified', (await status()).status);

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
