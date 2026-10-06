/**
 * The manager-accountability screens, driven through the real browser UI:
 * a held review has to be visible to the person holding it and to the company,
 * in plain words, with the item named.
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
const hit = (path) => new Promise((res, rej) =>
  http.get('http://localhost:8095' + path, (r) => { r.resume(); r.on('end', res); }).on('error', rej));

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 140) + ']')); v ? pass++ : fail++; };

  const RUN = Date.now().toString(36);
  const email = 'hod+' + RUN + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering',
    name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Yearly');
  await post({ action: 'addUser', token: A, form: { name: 'Payel Sanyamath', username: 'payel' + RUN,
    email: 'payel' + RUN + '@acme.in', role: 'Doer', jobProfile: 'Executive', password: 'staffpass123' } });

  const due = new Date(); due.setDate(due.getDate() + 30);
  await post({ action: 'createTask', token: A, form: { title: 'Vendor quote sign-off',
    assignTo: 'payel' + RUN, dueDate: due.toISOString().slice(0, 10), priority: 'High' } });

  // Payel hands it in. Then the clock is pushed back a fortnight: Rohan has sat on it.
  const P = (await post({ action: 'login', username: 'payel' + RUN + '@acme.in', password: 'staffpass123' })).token;
  const id = (await post({ action: 'getDashboard', token: P })).tasks
    .find((t) => t.title === 'Vendor quote sign-off').id;
  await post({ action: 'updateTask', token: P, taskId: id, status: 'In Progress' });
  await post({ action: 'updateTask', token: P, taskId: id, status: 'For Review' });
  await hit('/__backdate?email=' + encodeURIComponent(email) + '&title=Vendor%20quote%20sign-off&days=14');

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));

  await p.goto('http://localhost:8095/', { waitUntil: 'networkidle' });
  await p.fill('#liUser', email); await p.fill('#liPass', 'strongpass123');
  await p.click('#btnLogin'); await p.waitForTimeout(1600);

  console.log('\n--- the manager sees what they are holding ---');
  await p.click('text=See why');
  await p.waitForTimeout(600);
  const modal = await p.locator('#modal').textContent();
  ok('the score modal names the queue', /Work waiting on you/.test(modal));
  ok('it says how many are still on their desk', /still on your desk/.test(modal), modal.slice(0, 200));
  ok('it states the points lost', /points for holding your team up/.test(modal));
  ok('it explains leave and weekends are not counted',
     /approved leave are not counted/.test(modal));
  ok('the held item is named in the breakdown', /Vendor quote sign-off/.test(modal));
  ok('under its own heading', /REVIEW RESPONSIVENESS|Review Responsiveness/i.test(modal));
  ok('with the working days spelled out', /working day\(s\)/.test(modal), modal.slice(-400));
  await p.screenshot({ path: 'shot-18-responsiveness.png' });
  await p.click('#modal button:has-text("close"), #modal .material-icons:has-text("close")').catch(() => {});
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);

  console.log('\n--- and the company sees it in the report ---');
  await p.click('[data-view="reports"]').catch(async () => { await p.click('text=Reports'); });
  await p.waitForTimeout(1200);
  await p.click('#btnAccount2');
  await p.waitForTimeout(1200);
  const acc = await p.locator('#modal').textContent();
  ok('the report covers both sides', /Rework and lateness/.test(acc) && /Approvals and reviews held/.test(acc), acc.slice(0, 160));
  ok('the person holding work up is listed', /Rohan Mehta/.test(acc));
  ok('with how long it has been on their desk', /past 2 days/.test(acc), acc.slice(0, 400));
  await p.screenshot({ path: 'shot-19-accountability.png' });

  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  const board = await p.locator('#chartPeople').textContent();
  ok('the team report scores the manager rather than writing them off as "no data"',
     /Rohan\s*\d/.test(board), (board.match(/Rohan[\s\S]{0,30}/) || [''])[0]);

  ok('no console errors', errs.length === 0, errs.join(' | '));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
