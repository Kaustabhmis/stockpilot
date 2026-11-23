/**
 * The monthly report on screen: an Admin sees "Email me last month" on
 * Reports and it sends; staff do not see it.
 */
const { chromium } = require('playwright');
const http = require('http');
const PORT = Number(process.env.PORT || 8095);
const post = (body) => new Promise((res, rej) => { const d = JSON.stringify(body);
  const r = http.request({ host: 'localhost', port: PORT, path: '/exec', method: 'POST', headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(d) } },
    (s) => { let b = ''; s.on('data', (c) => b += c); s.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); });
  r.on('error', rej); r.write(d); r.end(); });
const hit = (p) => new Promise((res) => http.get('http://localhost:' + PORT + p, (r) => { r.resume(); r.on('end', res); }));

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 200) + ']')); v ? pass++ : fail++; };
  const R = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const email = 'or+' + R + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering', name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Yearly');
  await post({ action: 'addUser', token: A, form: { name: 'Payel Sanyamath', username: 'payel' + R, email: 'payel' + R + '@acme.in', role: 'Doer', dept: 'Ops', jobProfile: 'Exec', password: 'staffpass123' } });

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errs = [];
  const signIn = async (user, pw) => { const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://localhost:' + PORT + '/?login=1', { waitUntil: 'networkidle' });
    await p.fill('#liUser', user); await p.fill('#liPass', pw); await p.click('#btnLogin'); await p.waitForTimeout(1800); return p; };

  const a = await signIn(email, 'strongpass123');
  await a.click('button[data-tab="reports"]:visible'); await a.waitForTimeout(1000);
  ok('an Admin sees "Email me last month" on Reports', await a.isVisible('#btnOwnerReport'));
  const sent = a.waitForResponse((r) => /\/exec/.test(r.url()) && /emailOwnerReport/.test(r.request().postData() || ''));
  await a.click('#btnOwnerReport');
  const res = await (await sent).json();
  ok('and it sends', res.status === 'success' && res.message.indexOf(email) > -1, JSON.stringify(res));
  await a.close();

  const s = await signIn('payel' + R + '@acme.in', 'staffpass123');
  await s.evaluate(() => { try { loadReports(); } catch (e) {} });
  ok('staff do not see it', await s.evaluate(() => document.querySelector('#btnOwnerReport').classList.contains('hidden')));
  await s.close();

  ok('no script errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
