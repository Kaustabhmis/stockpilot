/**
 * Referrals and partners on screen: a visitor who arrives on ?ref= and signs
 * up later is recorded against the inviter; the inviter sees their link and
 * who signed up under Plans → Invite a business; a partner opens their
 * private dashboard from the emailed link, without signing in.
 */
const { chromium } = require('playwright');
const http = require('http');
const PORT = Number(process.env.PORT || 8095);
const post = (body) => new Promise((res, rej) => { const d = JSON.stringify(body);
  const r = http.request({ host: 'localhost', port: PORT, path: '/exec', method: 'POST', headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(d) } },
    (s) => { let b = ''; s.on('data', (c) => b += c); s.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); });
  r.on('error', rej); r.write(d); r.end(); });
const get = (p) => new Promise((res) => http.get('http://localhost:' + PORT + p, (r) => { let b = ''; r.on('data', (c) => b += c); r.on('end', () => res(b)); }));
const SHOTS = process.env.SHOTS || '';

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 200) + ']')); v ? pass++ : fail++; };
  const R = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const email = 'rf+' + R + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering', name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  const code = (await post({ action: 'getReferrals', token: A })).code;

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });

  console.log('\n=== a visitor arrives on an invite link, and signs up later ===');
  const v = await ctx.newPage(); v.on('pageerror', (e) => errs.push(e.message));
  await v.goto('http://localhost:' + PORT + '/?ref=' + code, { waitUntil: 'networkidle' });
  ok('the code is remembered in the browser', await v.evaluate(() => savedRef()) === code);
  await v.goto('http://localhost:' + PORT + '/?signup=1', { waitUntil: 'networkidle' });
  await v.fill('#suCompany', 'Bharat Tools ' + R); await v.fill('#suName', 'Vikas Rao');
  await v.fill('#suEmail', 'bt+' + R + '@bharat.in'); await v.fill('#suPass', 'strongpass123');
  if (await v.$('#suPhone')) await v.fill('#suPhone', '9800000000');
  await v.click('#btnSignup'); await v.waitForTimeout(2500);
  const mine = await post({ action: 'getReferrals', token: A });
  ok('the new company is recorded against the inviter', (mine.referrals || []).some((x) => x.company === 'Bharat Tools ' + R && x.status === 'signed up'), JSON.stringify(mine.referrals));
  await v.close();

  console.log('\n=== the inviter’s page ===');
  const a = await ctx.newPage(); a.on('pageerror', (e) => errs.push(e.message));
  await a.evaluate(() => { try { localStorage.clear(); } catch (e) {} }).catch(() => {});
  await a.goto('http://localhost:' + PORT + '/?login=1', { waitUntil: 'networkidle' });
  await a.fill('#liUser', email); await a.fill('#liPass', 'strongpass123'); await a.click('#btnLogin'); await a.waitForTimeout(1800);
  await a.evaluate(() => openBilling()); await a.waitForTimeout(400);
  ok('Plans has "Invite a business"', await a.isVisible('#btnInvite'));
  await a.click('#btnInvite'); await a.waitForTimeout(1000);
  ok('it shows their own link', (await a.inputValue('#invLink')) === mine.link && mine.link.endsWith('/?ref=' + code), mine.link);
  ok('ways to share it', await a.isVisible('a:has-text("Share on WhatsApp")'));
  ok('and who has signed up with it', /Bharat Tools/.test(await a.textContent('#invBody')) && /not paying yet/.test(await a.textContent('#invBody')));
  if (SHOTS) await a.screenshot({ path: SHOTS + '/7-invite.png' });
  await a.close();

  console.log('\n=== a partner’s dashboard ===');
  const p = JSON.parse(await get('/__partner?name=' + encodeURIComponent('Rakesh Gupta') + '&email=rk' + R + '@cafirm.in&firm=' + encodeURIComponent('Gupta & Co')));
  ok('the partner gets a code and a dashboard key by email', /^P[A-Z0-9]{5}$/.test(p.code) && p.key.length === 40, JSON.stringify(p));
  await post({ action: 'register', form: { companyName: 'Client ' + R, name: 'Client Owner', email: 'cl+' + R + '@client.in', password: 'strongpass123', ref: p.code } });
  const d = await ctx.newPage(); d.on('pageerror', (e) => errs.push(e.message));
  await d.goto('http://localhost:' + PORT + '/?partner=' + p.key, { waitUntil: 'networkidle' }); await d.waitForTimeout(1200);
  ok('the dashboard opens without signing in', /Rakesh Gupta/.test(await d.textContent('#pvName')));
  ok('with their link and their companies', (await d.inputValue('#pvLink')).endsWith('?ref=' + p.code) && /Client /.test(await d.textContent('#pvBody')));
  ok('the key is taken out of the address bar once read', !/partner=/.test(d.url()));
  ok('nothing of the app or the sign-in shows behind it', !(await d.isVisible('#view-app')) && !(await d.isVisible('#view-auth')) && !(await d.isVisible('#view-home')));
  if (SHOTS) await d.screenshot({ path: SHOTS + '/8-partner-dashboard.png' });
  await d.goto('http://localhost:' + PORT + '/?partner=' + 'f'.repeat(40), { waitUntil: 'networkidle' }); await d.waitForTimeout(1000);
  ok('a wrong link says so', /not valid/.test(await d.textContent('#pvBody')));
  await d.close();
  const m = await b.newPage({ viewport: { width: 390, height: 844 } }); m.on('pageerror', (e) => errs.push(e.message));
  const p2 = JSON.parse(await get('/__partner?name=Mona&email=mo' + R + '@cafirm.in'));
  await m.goto('http://localhost:' + PORT + '/?partner=' + p2.key, { waitUntil: 'networkidle' }); await m.waitForTimeout(1200);
  ok('the dashboard fits a phone', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await m.close();

  ok('no script errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
