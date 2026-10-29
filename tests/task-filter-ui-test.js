/**
 * An Admin sees every task and every project, however it was assigned, and
 * the Tasks bar filters by who assigned the work and by a date range (on the
 * due date or the day it was assigned) — on the board and in the archive.
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
const hit = (path) => new Promise((res) => http.get('http://localhost:8095' + path, (r) => { r.resume(); r.on('end', res); }));
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 200) + ']')); v ? pass++ : fail++; };
  const R = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const email = 'flt+' + R + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme', name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Yearly');
  const add = (name, u, role, mgr) => post({ action: 'addUser', token: A, form: { name, username: u + R, email: u + R + '@acme.in',
    role, manager: mgr ? mgr + R : '', jobProfile: 'Ops', password: 'staffpass123' } });
  await add('Sruti Charulata', 'sruti', 'HOD'); await add('Arjun Banerjee', 'arjun', 'HOD');
  await add('Payel Sanyamath', 'payel', 'Doer', 'sruti'); await add('Vikram Rathore', 'vikram', 'Doer', 'arjun');
  const T = async (u) => (await post({ action: 'login', username: u + R + '@acme.in', password: 'staffpass123' })).token;
  const S = await T('sruti'), AR = await T('arjun');

  // Work the Admin had no part in: each HOD assigns to their own report.
  await post({ action: 'createTask', token: S, form: { title: 'Sruti job soon', assignTo: 'payel' + R, dueDate: day(3), priority: 'High' } });
  await post({ action: 'createTask', token: S, form: { title: 'Sruti job later', assignTo: 'payel' + R, dueDate: day(40), priority: 'Low' } });
  await post({ action: 'createTask', token: AR, form: { title: 'Arjun job soon', assignTo: 'vikram' + R, dueDate: day(5), priority: 'Medium' } });
  await post({ action: 'createProject', token: AR, form: { name: 'Arjun project', gate: 'sequential', jobCategory: 'NPD',
    stages: [{ title: 'Stage one', assignTo: 'vikram' + R, dueDate: day(10) }, { title: 'Stage two', assignTo: 'vikram' + R, dueDate: day(20) }] } });

  console.log('\n=== an Admin sees everything ===');
  const dash = await post({ action: 'getDashboard', token: A });
  const titles = dash.tasks.map((t) => t.title);
  ok('every task, including ones raised and done by others', ['Sruti job soon', 'Sruti job later', 'Arjun job soon', 'Stage one']
    .every((x) => titles.includes(x)), titles.join(', '));
  const projects = (await post({ action: 'getProjects', token: A })).projects || [];
  ok('every project, including one an HOD built', projects.some((p) => p.name === 'Arjun project'), projects.map((p) => p.name));

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8095/?login=1', { waitUntil: 'networkidle' });
  await p.fill('#liUser', email); await p.fill('#liPass', 'strongpass123');
  await p.click('#btnLogin'); await p.waitForTimeout(1800);
  await p.click('#viewMode button[data-mode="list"]'); await p.waitForTimeout(400);
  const shown = () => p.evaluate(() => visibleTasks().map((t) => t.title).sort());

  console.log('\n=== filter by who assigned it ===');
  const byOpts = await p.$$eval('#fBy option', (o) => o.map((x) => x.textContent));
  ok('the Assigned-by list names the people', byOpts[0] === 'Assigned by anyone' && byOpts.includes('By Sruti Charulata'), byOpts);
  await p.selectOption('#fBy', 'sruti' + R); await p.waitForTimeout(300);
  ok('By Sruti shows only her two', JSON.stringify(await shown()) === JSON.stringify(['Sruti job later', 'Sruti job soon']), await shown());
  ok('and the list on screen says so', await p.locator('text=Sruti job soon').first().isVisible() &&
    (await p.locator('text=Arjun job soon').count()) === 0 || !(await p.locator('text=Arjun job soon').first().isVisible()));
  await p.selectOption('#fBy', ''); await p.waitForTimeout(300);

  console.log('\n=== filter by a date range ===');
  await p.fill('#fFrom', day(0)); await p.dispatchEvent('#fFrom', 'change');
  await p.fill('#fTo', day(7)); await p.dispatchEvent('#fTo', 'change'); await p.waitForTimeout(300);
  ok('due in the next week: the two soon jobs only', JSON.stringify(await shown()) === JSON.stringify(['Arjun job soon', 'Sruti job soon']), await shown());
  ok('a clear button appears once a date is set', await p.isVisible('#fDatesClear'));
  await p.selectOption('#fDateOn', 'created'); await p.waitForTimeout(300);
  ok('on the assigned date, everything assigned today is in range', (await shown()).length === titles.length, await shown());
  await p.fill('#fFrom', day(-9)); await p.dispatchEvent('#fFrom', 'change');
  await p.fill('#fTo', day(-2)); await p.dispatchEvent('#fTo', 'change'); await p.waitForTimeout(300);
  ok('nothing was assigned last week', (await shown()).length === 0, await shown());
  await p.click('#fDatesClear'); await p.waitForTimeout(200);
  await p.fill('#fTo', day(1)); await p.dispatchEvent('#fTo', 'change');
  await p.fill('#fFrom', day(30)); await p.dispatchEvent('#fFrom', 'change'); await p.waitForTimeout(300);
  ok('a range typed backwards is turned the right way round', (await p.inputValue('#fFrom')) === day(1) && (await p.inputValue('#fTo')) === day(30));
  await p.selectOption('#fDateOn', 'due'); await p.selectOption('#fBy', 'sruti' + R); await p.waitForTimeout(300);
  ok('both filters together: Sruti, due 1–30 days out', JSON.stringify(await shown()) === JSON.stringify(['Sruti job soon']), await shown());
  await p.click('#fDatesClear'); await p.selectOption('#fBy', ''); await p.waitForTimeout(300);
  ok('clearing brings everything back', (await shown()).length === titles.length && (await p.inputValue('#fFrom')) === '');

  console.log('\n=== the archive honours the same filters ===');
  const arch = await post({ action: 'getArchive', token: A, by: 'sruti' + R, dateOn: 'due', from: day(0), to: day(7) });
  ok('the archive call accepts them without complaint', arch.status === 'success', JSON.stringify(arch).slice(0, 120));

  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('the Tasks bar still fits a phone screen', !overflow);
  ok('no script errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
