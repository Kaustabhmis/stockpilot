/**
 * The Admin sets the working week, holidays and reminder times from the
 * account menu; a head of department does not get the buttons.
 */
const { chromium } = require('playwright');
const http = require('http');
const post = (body) => new Promise((res, rej) => { const d = JSON.stringify(body);
  const r = http.request({ host: 'localhost', port: 8095, path: '/exec', method: 'POST', headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(d) } },
    (s) => { let b = ''; s.on('data', (c) => b += c); s.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); });
  r.on('error', rej); r.write(d); r.end(); });
const hit = (p) => new Promise((res) => http.get('http://localhost:8095' + p, (r) => { r.resume(); r.on('end', res); }));
const SHOTS = process.env.SHOTS || '';

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 200) + ']')); v ? pass++ : fail++; };
  const R = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const email = 'cal+' + R + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering', name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Yearly');
  await post({ action: 'addUser', token: A, form: { name: 'Sruti Charulata', username: 'sruti' + R, email: 'sruti' + R + '@acme.in', role: 'HOD', dept: 'Operations', jobProfile: 'Head', password: 'staffpass123' } });

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const signIn = async (user, pw, w, h) => { const p = await b.newPage({ viewport: { width: w || 1400, height: h || 900 } });
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://localhost:8095/?login=1', { waitUntil: 'networkidle' });
    await p.fill('#liUser', user); await p.fill('#liPass', pw); await p.click('#btnLogin'); await p.waitForTimeout(1800); return p; };
  const menu = async (p, label) => { await p.click('#btnAccount'); await p.waitForTimeout(400); await p.click('button:has-text("' + label + '")'); await p.waitForTimeout(400); };

  console.log('\n=== working days and holidays ===');
  const a = await signIn(email, 'strongpass123');
  await menu(a, 'Working days');
  ok('the week opens Monday first, Saturday and Sunday off', (await a.$$eval('#cdWeek .cdDay', (d) => d.map((x) => x.innerText.replace(/\s+/g, ' ').trim()))).join('|') ===
    'Mon Working|Tue Working|Wed Working|Thu Working|Fri Working|Sat Off|Sun Off', (await a.$$eval('#cdWeek .cdDay', (d) => d.map((x) => x.innerText.replace(/\s+/g, ' ').trim()))).join('|'));
  await a.click('#cdWeek .cdDay[data-d="0"]');   // Sunday on
  await a.click('#cdWeek .cdDay[data-d="1"]');   // Monday off
  await a.click('#cdWeek .cdDay[data-d="6"]');   // Saturday on
  ok('the summary follows each tap', /6 working days a week · off on Monday/.test(await a.textContent('#cdSum')), await a.textContent('#cdSum'));
  await a.fill('#cdDate', '2026-11-09'); await a.fill('#cdName', 'Diwali'); await a.click('#cdAdd');
  await a.fill('#cdDate', '2026-08-15'); await a.fill('#cdName', 'Independence Day'); await a.press('#cdName', 'Enter');
  ok('holidays are listed in date order', (await a.textContent('#cdHols')).indexOf('Independence Day') < (await a.textContent('#cdHols')).indexOf('Diwali'));
  if (SHOTS) await a.screenshot({ path: SHOTS + '/1-working-days.png' });
  await a.click('#fCalendar button[type=submit]'); await a.waitForTimeout(1600);
  const d1 = await a.evaluate(() => STATE.data.calendar);
  ok('saved: off on Monday, two holidays', JSON.stringify(d1.off) === '[1]' && d1.holidays.length === 2, JSON.stringify(d1));

  console.log('\n=== reminder times ===');
  await menu(a, 'Reminders');
  ok('the defaults are shown: 9 am, 3 pm and 5 pm', /at 9 am, 3 pm and 5 pm/.test(await a.textContent('#rmSum')), await a.textContent('#rmSum'));
  await a.selectOption('#rmTimes .rmHour[data-i="0"]', '10');
  await a.selectOption('#rmTimes .rmHour[data-i="1"]', '16');
  await a.click('#rmAdd'); await a.waitForTimeout(150);
  ok('a fourth time can be added', (await a.$$('#rmTimes .rmHour')).length === 4);
  ok('and then there is no room for a fifth', await a.isHidden('#rmAdd'));
  await a.click('#rmTimes .rmDel[data-i="3"]');
  await a.selectOption('#rmBefore', '1'); await a.selectOption('#rmDigest', '7');
  ok('the summary reads the new times', /at most 3 reminder emails: at 10 am, 4 pm and 5 pm/.test(await a.textContent('#rmSum')), await a.textContent('#rmSum'));
  if (SHOTS) await a.screenshot({ path: SHOTS + '/2-reminders.png' });
  await a.click('#fReminders button[type=submit]'); await a.waitForTimeout(1600);
  const r1 = await a.evaluate(() => STATE.data.reminders);
  ok('saved', JSON.stringify(r1) === '{"hours":[10,16,17],"daysBeforeDue":1,"overdue":true,"digestHour":7}', JSON.stringify(r1));
  await a.close();

  console.log('\n=== on a phone ===');
  const m = await signIn(email, 'strongpass123', 390, 844);
  await menu(m, 'Working days');
  ok('the week fits a phone screen, every day readable', await m.evaluate(() => [...document.querySelectorAll('#cdWeek .cdDay')].every((b) => b.scrollWidth <= b.clientWidth + 1)));
  if (SHOTS) await m.screenshot({ path: SHOTS + '/3-working-days-phone.png' });
  await m.close();

  console.log('\n=== a head of department does not get them ===');
  const h = await signIn('sruti' + R + '@acme.in', 'staffpass123');
  await h.click('#btnAccount'); await h.waitForTimeout(400);
  ok('no Working days or Reminders buttons', !(await h.isVisible('button:has-text("Working days")')) && !(await h.isVisible('button:has-text("Reminders")')));
  await h.close();

  console.log('\n=== Domebox Lite does not have them ===');
  const L = await b.newPage({ viewport: { width: 1400, height: 900 } });
  L.on('pageerror', (e) => errs.push(e.message));
  await L.goto('http://localhost:8096/?login=1', { waitUntil: 'networkidle' }).catch(() => {});
  const liteUp = await L.evaluate(() => window.DOMEBOX_EDITION === 'lite').catch(() => false);
  if (liteUp) {
    const html = await L.content();
    ok('the Lite page has the dialogs in its code but no way to open them for the Admin',
       await L.evaluate(() => { STATE.user = { role: 'Admin', name: 'x', email: 'x' }; STATE.company = 'x'; openAccount();
         return !document.body.innerText.includes('Working days') && !document.body.innerText.includes('Reminders') && document.body.innerText.includes('Task stages'); }));
  } else console.log('  (Lite server not running on 8096 — skipped)');
  await L.close();

  ok('no script errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
