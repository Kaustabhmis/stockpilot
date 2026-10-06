/**
 * The KRA/KPI screens, driven through the real browser UI.
 * The bar: a manager can see who has no KRAs, set one up with an optional
 * target, and roll a job-profile standard out without silently flattening
 * somebody's tailored set.
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
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 150) + ']')); v ? pass++ : fail++; };

  const RUN = Date.now().toString(36);
  const email = 'kra+' + RUN + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering',
    name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Yearly');
  for (const [n, u] of [['Payel Sanyamath', 'payel'], ['Vikram Rathore', 'vikram']]) {
    await post({ action: 'addUser', token: A, form: { name: n, username: u + RUN,
      email: u + RUN + '@acme.in', role: 'Doer', jobProfile: 'Quality Executive',
      password: 'staffpass123' } });
  }

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1500, height: 980 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8095/', { waitUntil: 'networkidle' });
  await p.fill('#liUser', email); await p.fill('#liPass', 'strongpass123');
  await p.click('#btnLogin'); await p.waitForTimeout(1600);

  console.log('\n--- the gap is visible ---');
  await p.click('[data-tab="team"]'); await p.waitForTimeout(900);
  await p.click('#btnKra'); await p.waitForTimeout(1200);
  let m = await p.locator('#modal').textContent();
  ok('the overview opens', /KRA & KPI/.test(m));
  ok('it names everyone with no KRAs', /No KRAs set/.test(m), m.slice(0, 200));
  ok('and warns what that costs the appraisal', /can only be scored on delivery/.test(m));
  ok('the job profile is offered as a standard to roll out', /Job profile standards/.test(m));
  await p.screenshot({ path: 'shot-20-kra-overview.png' });

  console.log('\n--- setting one up ---');
  await p.click('.kEdit >> nth=1'); await p.waitForTimeout(1000);
  m = await p.locator('#modal').textContent();
  ok('the editor names the person', /KRAs for Payel Sanyamath/.test(m), m.slice(0, 120));
  ok('and says a target is optional', /target is optional/.test(m));

  await p.click('#kAdd'); await p.waitForTimeout(250);
  await p.fill('.kI >> nth=0', 'Rejection control');
  await p.fill('.kW >> nth=0', '60');
  await p.fill('.kT >> nth=0', '2');
  await p.selectOption('.kU >> nth=0', '%');
  await p.selectOption('.kDir >> nth=0', 'lower is better');
  await p.fill('.kM >> nth=0', 'Monthly rejection report');
  await p.click('#kAdd'); await p.waitForTimeout(250);
  await p.fill('.kI >> nth=1', 'Audit readiness');
  await p.fill('.kW >> nth=1', '40');
  await p.waitForTimeout(300);
  let msg = await p.locator('#kMsg').textContent();
  ok('the weights are totalled as you type', /Weights total 100%/.test(msg), msg);
  ok('and it says plainly which ones will be judged, not counted',
     /1 of 2 have no KPI target/.test(msg), msg);

  await p.fill('.kW >> nth=1', '70'); await p.waitForTimeout(300);
  msg = await p.locator('#kMsg').textContent();
  ok('going over 100% is refused in words', /cannot go above 100%/.test(msg), msg);
  await p.fill('.kW >> nth=1', '40'); await p.waitForTimeout(300);

  ok('saving as the profile standard is opt-in, not the default',
     (await p.locator('#kAlso').isChecked()) === false);
  await p.screenshot({ path: 'shot-21-kra-editor.png' });
  await p.click('#fKra button[type=submit]'); await p.waitForTimeout(1600);

  m = await p.locator('#modal').textContent();
  ok('it returns to the overview', /KRA & KPI/.test(m));
  ok('and that person now reads complete', /Payel Sanyamath[\s\S]{0,80}Complete/.test(m), (m.match(/Payel Sanyamath[\s\S]{0,80}/) || [''])[0]);
  ok('the other is still flagged', /No KRAs set/.test(m));

  console.log('\n--- it is stored as typed ---');
  const saved = await post({ action: 'getKraFor', token: A, username: 'payel' + RUN });
  const first = saved.kras.find((k) => k.item === 'Rejection control');
  ok('the target is kept', first && first.target === '2', JSON.stringify(first));
  ok('with its unit', first && first.unit === '%');
  ok('and the direction that counts as good', first && first.direction === 'lower is better');
  const judged = saved.kras.find((k) => k.item === 'Audit readiness');
  ok('a KRA with no target is kept, not dropped', !!judged && judged.target === '');

  ok('no console errors', errs.length === 0, errs.join(' | '));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
