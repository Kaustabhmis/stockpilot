/**
 * Projects in the real browser: build one, see the stage timeline, watch a
 * stage release when the one before it is signed off, and find the credit for
 * a met deadline in the score.
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
const ymd = (plus) => { const d = new Date(); d.setDate(d.getDate() + plus); return d.toISOString().slice(0, 10); };

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 160) + ']')); v ? pass++ : fail++; };

  const RUN = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const email = 'proj+' + RUN + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering',
    name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Yearly');
  for (const [n, u] of [['Payel Sanyamath', 'payel'], ['Vikram Rathore', 'vikram']]) {
    await post({ action: 'addUser', token: A, form: { name: n, username: u + RUN,
      email: u + RUN + '@acme.in', role: 'Doer', jobProfile: 'Executive', password: 'staffpass123' } });
  }

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8095/?login=1', { waitUntil: 'networkidle' });
  await p.fill('#liUser', email); await p.fill('#liPass', 'strongpass123');
  await p.click('#btnLogin'); await p.waitForTimeout(1600);

  console.log('\n--- building one ---');
  await p.click('[data-tab="projects"]'); await p.waitForTimeout(900);
  let view = await p.locator('#tab-projects').textContent();
  ok('the empty state says what a project is for', /passes through several hands/.test(view), view.slice(0, 200));
  await p.click('#btnNewProject'); await p.waitForTimeout(700);
  ok('it opens with two stages ready, not one',
     await p.locator('#pStages .pT').count() === 2);

  await p.fill('#pName', 'Fixture line upgrade');
  await p.fill('.pT >> nth=0', 'Design the fixture');
  await p.selectOption('.pW >> nth=0', 'payel' + RUN);
  await p.fill('.pDue >> nth=0', ymd(5));
  await p.selectOption('.pP >> nth=0', 'High');
  await p.fill('.pT >> nth=1', 'Fabricate and trial');
  await p.selectOption('.pW >> nth=1', 'vikram' + RUN);
  await p.fill('.pDue >> nth=1', ymd(2));          // deliberately backwards
  await p.waitForTimeout(400);
  let msg = await p.locator('#pMsg').textContent();
  ok('dates that run backwards are caught while you type',
     /due before stage 1/.test(msg), msg);

  await p.fill('.pDue >> nth=1', ymd(20)); await p.waitForTimeout(400);
  msg = await p.locator('#pMsg').textContent();
  ok('and once it is sound it says what will be created', /2 stages, finishing/.test(msg), msg);
  await p.screenshot({ path: 'shot-23-project-builder.png' });
  await p.click('#fProj button[type=submit]'); await p.waitForTimeout(2000);

  console.log('\n--- the timeline ---');
  view = await p.locator('#tab-projects').textContent();
  ok('the project is listed', /Fixture line upgrade/.test(view));
  ok('with who is on the hook now', /Stage 1 with Payel Sanyamath/.test(view), view.slice(0, 260));
  ok('every stage shows its owner and deadline', /Payel Sanyamath/.test(view) && /Vikram Rathore/.test(view));
  ok('and the stage nobody can start yet says so',
     /Waiting on the stage before it/.test(view), view.slice(0, 400));
  await p.screenshot({ path: 'shot-24-project-list.png' });

  console.log('\n--- a stage card knows it is part of something ---');
  await p.click('[data-tab="tasks"]'); await p.waitForTimeout(900);
  const board = await p.locator('#board').textContent();
  ok('the card carries the project and the stage number',
     /Fixture line upgrade · 1\/2/.test(board), board.slice(0, 220));

  console.log('\n--- signing a stage off releases the next ---');
  const stageTasks = (await post({ action: 'getDashboard', token: A })).tasks;
  const s1 = stageTasks.find((t) => t.title === 'Design the fixture');
  const P = (await post({ action: 'login', username: 'payel' + RUN + '@acme.in', password: 'staffpass123' })).token;
  await post({ action: 'updateTask', token: P, taskId: s1.id, status: 'In Progress' });
  await post({ action: 'updateTask', token: P, taskId: s1.id, status: 'For Review' });
  const v = await post({ action: 'updateTask', token: A, taskId: s1.id, status: 'Verified' });
  ok('verifying says who it just went to', /Stage 2 is now open for Vikram Rathore/.test(v.message), v.message);

  await p.click('[data-tab="projects"]'); await p.waitForTimeout(1400);
  view = await p.locator('#tab-projects').textContent();
  ok('the timeline shows the stage met its deadline, and that it scored',
     /Met · scored/.test(view), view.slice(0, 400));
  ok('and the project has moved on to stage 2', /Stage 2 with Vikram Rathore/.test(view));

  console.log('\n--- the doer sees the credit ---');
  await p.evaluate(() => signOut()); await p.waitForTimeout(900);
  await p.fill('#liUser', 'payel' + RUN + '@acme.in'); await p.fill('#liPass', 'staffpass123');
  await p.click('#btnLogin'); await p.waitForTimeout(1800);
  await p.click('[data-tab="tasks"]'); await p.waitForTimeout(700);
  await p.click('text=See why'); await p.waitForTimeout(800);
  const modal = await p.locator('#modal').textContent();
  ok('the score names the stage deadlines', /Project stage deadlines/.test(modal), modal.slice(0, 220));
  ok('counts the one they met', /1 met/.test(modal));
  ok('says plainly that meeting them adds score',
     /Every stage deadline you meet adds to this score/.test(modal));
  ok('explains their date moves if the stage before runs over',
     /your date moves out with it/.test(modal));
  ok('and itemises the gain, not only losses', /Stage deadline met/.test(modal), modal.slice(-320));
  ok('Project Milestones is its own component', /PROJECT MILESTONES|Project Milestones/.test(modal));
  await p.screenshot({ path: 'shot-25-milestone-score.png' });

  ok('no console errors', errs.length === 0, errs.join(' | '));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
