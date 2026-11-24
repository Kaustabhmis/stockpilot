/**
 * Department goals and department meetings, through the screens. A head of
 * department sets a goal for their team under a company goal, with a target
 * figure, enters this week's figure and is told whether it is on track. The
 * Admin sees every department's progress in one review. The head runs their
 * own meeting while the Admin runs another, and a head of another department
 * sees neither.
 */
const { chromium } = require('playwright');
const http = require('http');
const PORT = Number(process.env.PORT || 8095);
const post = (body) => new Promise((res, rej) => {
  const d = JSON.stringify(body);
  const r = http.request({ host: 'localhost', port: PORT, path: '/exec', method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(d) } }, (s) => {
    let b = ''; s.on('data', (c) => b += c); s.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  });
  r.on('error', rej); r.write(d); r.end();
});
const hit = (p) => new Promise((res, rej) => http.get('http://localhost:' + PORT + p, (r) => { r.resume(); r.on('end', res); }).on('error', rej));

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 240) + ']')); v ? pass++ : fail++; };
  const RUN = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const U = (u) => u + RUN;
  const email = 'dgu+' + RUN + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering', name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Growth');
  for (const [n, u, role, dept, mgr] of [
    ['Imran Qureshi', 'imran', 'HOD', 'Quality', ''], ['Nita Das', 'nita', 'Doer', 'Quality', 'imran'],
    ['Sruti Charulata', 'sruti', 'HOD', 'Production', ''], ['Payel Sanyamath', 'payel', 'Doer', 'Production', 'sruti']]) {
    const r = await post({ action: 'addUser', token: A, form: { name: n, username: U(u), email: U(u) + '@acme.in', role, dept,
      manager: mgr ? U(mgr) : '', jobProfile: 'Executive', password: 'staffpass123' } });
    if (r.status !== 'success') console.log('addUser', u, JSON.stringify(r));
  }
  const G1 = await post({ action: 'saveGoal', token: A, form: { level: 'year', title: 'Zero repeat NCs in the audit' } });

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errs = [];
  const login = async (user, pass, vp) => {
    const pg = await b.newPage({ viewport: vp || { width: 1400, height: 1000 } });
    pg.on('pageerror', (e) => errs.push(e.message)); pg.on('dialog', (d) => d.accept());
    await pg.goto('http://localhost:' + PORT + '/?login=1', { waitUntil: 'networkidle' });
    await pg.fill('#liUser', user); await pg.fill('#liPass', pass);
    await pg.click('#btnLogin'); await pg.waitForTimeout(1800);
    return pg;
  };
  const tab = async (pg, t) => { await pg.click('#navTabs button[data-tab="' + t + '"]'); await pg.waitForTimeout(1300); };

  console.log('\n--- a head of department sets a goal for their team ---');
  const h = await login(U('imran') + '@acme.in', 'staffpass123');
  await tab(h, 'goals');
  await h.click('button:has-text("+ Goal")'); await h.waitForTimeout(400);
  const whereOpts = await h.locator('#glWhere option').allTextContents();
  ok('it can only be for their own department', whereOpts.length === 1 && /Quality department/.test(whereOpts[0]), whereOpts.join('|'));
  const owners = await h.locator('#glOwner option').allTextContents();
  ok('and owned by someone in it', owners.some((o) => /Nita/.test(o)) && !owners.some((o) => /Payel|Sruti/.test(o)), owners.join('|'));
  const parents = await h.locator('#glParent option').allTextContents();
  ok('it can serve the company goal', parents.some((o) => /Company: Zero repeat NCs/.test(o)), parents.join('|'));
  await h.fill('#glTitle', 'Cut rejection rate');
  await h.fill('#glStart', '4'); await h.fill('#glTarget', '1.5'); await h.fill('#glUnit', '%');
  await h.selectOption('#glParent', G1.id);
  await h.click('#fGoalEdit button[type=submit]'); await h.waitForTimeout(1500);
  const row = h.locator('.goalRow:has-text("Cut rejection rate")');
  ok('the goal is listed with its department', await row.count() === 1 && /Quality/.test(await row.textContent()));
  ok('and says which company goal it serves', /serves Zero repeat NCs/.test(await row.textContent()));
  ok('and that no figure has been entered yet', /No figure entered yet/.test(await row.textContent()), await row.textContent());

  console.log('\n--- entering the figure, and the verdict ---');
  await row.locator('button:has-text("Enter figure")').click(); await h.waitForTimeout(400);
  await h.fill('#gcValue', '3'); await h.fill('#gcNote', 'New gauge on line 2');
  await h.click('#fGoalCheck button[type=submit]'); await h.waitForTimeout(1600);
  const row2 = h.locator('.goalRow:has-text("Cut rejection rate")');
  const verdict = (await row2.locator('.goalVerdict').textContent()).trim();
  ok('the system says whether it is on track', ['On track', 'At risk', 'Off track', 'Achieved'].includes(verdict), verdict);
  ok('and why, in plain words', /At 3% against a target of 1.5%/.test(await row2.locator('.goalReason').textContent()), await row2.locator('.goalReason').textContent());
  ok('the figure shows on the bar', /3 → 1.5%/.test(await row2.textContent()), await row2.textContent());
  ok('the head sees a review of their own goals', await h.locator('#goalReview').count() === 1);
  await h.screenshot({ path: 'shot-47-dept-goals.png', fullPage: true });

  console.log('\n--- the Admin sees every department\'s progress ---');
  const a = await login(email, 'strongpass123');
  await tab(a, 'goals');
  ok('the Admin sees the department goal', await a.locator('.goalRow:has-text("Cut rejection rate")').count() === 1);
  ok('and a review: are we on track?', /Are we on track\?/.test(await a.locator('#goalReview').textContent()));
  const tbl = await a.locator('#goalReviewTable').textContent();
  ok('broken down by department', /Company/.test(tbl) && /Quality/.test(tbl), tbl);
  await a.selectOption('#gScope', 'Quality'); await a.waitForTimeout(300);
  ok('and can look at one department alone', await a.locator('.goalRow:has-text("Cut rejection rate")').count() === 1 &&
     await a.locator('#goalsBody .chip.t-plum').count() === 0);
  await a.selectOption('#gScope', ''); await a.waitForTimeout(300);
  await a.click('button:has-text("+ Goal")'); await a.waitForTimeout(400);
  const aw = await a.locator('#glWhere option').allTextContents();
  ok('the Admin can set a company goal or one for any department', aw[0] === 'Company goal' && aw.some((o) => /Production/.test(o)), aw.join('|'));
  await a.click('#fGoalEdit button:has-text("Cancel")'); await a.waitForTimeout(300);

  console.log('\n--- another department does not see it ---');
  const s = await login(U('sruti') + '@acme.in', 'staffpass123');
  await tab(s, 'goals');
  ok('the head of Production does not see Quality\'s goal', await s.locator('.goalRow:has-text("Cut rejection rate")').count() === 0);
  ok('but sees the company goal', /Zero repeat NCs/.test(await s.locator('#goalsBody').textContent()));

  console.log('\n--- department meetings, side by side ---');
  await tab(h, 'meetings');
  await h.click('button:has-text("Start a meeting")'); await h.waitForTimeout(400);
  ok('the head\'s meeting is named for their department', await h.inputValue('#mtTitle') === 'Quality weekly review', await h.inputValue('#mtTitle'));
  ok('their team is invited by default', await h.locator('.mtWho[value="' + U('nita') + '"]').isChecked());
  ok('other departments are not', !(await h.locator('.mtWho[value="' + U('payel') + '"]').isChecked()) &&
     !(await h.locator('.mtWho[value="' + U('sruti') + '"]').isChecked()));
  ok('it says who can see it', /Only the people you invite, and Admins/.test(await h.locator('#fStart').textContent()));
  await h.click('#fStart button[type=submit]'); await h.waitForTimeout(1800);
  ok('the head runs their meeting', await h.locator('#mRunner').count() === 1);
  const goalsSeg = await post({ action: 'getMeetings', token: (await post({ action: 'login', username: U('imran') + '@acme.in', password: 'staffpass123' })).token });
  ok('it is running', (goalsSeg.lives || []).length === 1, JSON.stringify(goalsSeg).slice(0, 200));

  await tab(a, 'meetings');
  ok('the Admin sees the Quality meeting is running', /Quality weekly review is running/.test(await a.locator('#meetBody').textContent()));
  ok('and can still start their own', await a.locator('button:has-text("Start a meeting")').count() === 1);
  await a.click('button:has-text("Start a meeting")'); await a.waitForTimeout(400);
  ok('the Admin\'s review invites the managers', await a.locator('.mtWho[value="' + U('sruti') + '"]').isChecked() &&
     await a.locator('.mtWho[value="' + U('imran') + '"]').isChecked());
  await a.click('#fStart button[type=submit]'); await a.waitForTimeout(1800);
  ok('both run at once', await a.locator('#mRunner').count() === 1);
  await tab(a, 'goals'); await tab(a, 'meetings');
  ok('the Admin\'s list shows both running', (await a.locator('#meetBody >> text=is running').count()) === 2);
  ok('and no second Start while chairing', await a.locator('button:has-text("Start a meeting")').count() === 0);

  await tab(s, 'meetings');
  const sb = await s.locator('#meetBody').textContent();
  ok('the head of Production does not see the Quality meeting', !/Quality weekly review/.test(sb), sb.slice(0, 200));
  ok('only the Admin\'s review, which she was invited to', (await s.locator('#meetBody >> text=is running').count()) === 1 && /Chaired by Rohan Mehta/.test(sb));
  const n = await login(U('nita') + '@acme.in', 'staffpass123');
  await tab(n, 'meetings');
  const nb = await n.locator('#meetBody').textContent();
  ok('a member of the team sees their own meeting', /Quality weekly review is running/.test(nb));
  ok('and only that one', (await n.locator('#meetBody >> text=is running').count()) === 1, nb.slice(0, 200));

  console.log('\n--- on a phone ---');
  const ph = await login(U('imran') + '@acme.in', 'staffpass123', { width: 390, height: 844 });
  await ph.evaluate(() => { STATE.tab = 'goals'; renderTab(); }); await ph.waitForTimeout(1500);
  const over = await ph.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('the goals screen fits a phone', over <= 1, over);
  await ph.screenshot({ path: 'shot-48-dept-goals-mobile.png', fullPage: true });

  ok('no script errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
