/* Click-through of the whole app: every role signs in on desktop and phone,
   opens every tab, every button in the account menu and the Team bar, a task
   panel, Assign and Help. Any script error, failed request, server fault
   reference or "went wrong" dialog is a problem.
   PORT=8095 (Domebox) or PORT=8099 LITE=1 on a fresh Lite server. */
const { chromium } = require('playwright');
const http = require('http');
const PORT = Number(process.env.PORT || 8095), LITE = !!process.env.LITE;
const post = (body) => new Promise((res, rej) => { const d = JSON.stringify(body);
  const r = http.request({ host: 'localhost', port: PORT, path: '/exec', method: 'POST', headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(d) } },
    (s) => { let b = ''; s.on('data', (c) => b += c); s.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); });
  r.on('error', rej); r.write(d); r.end(); });
const hit = (p) => new Promise((res) => http.get('http://localhost:' + PORT + p, (r) => { r.resume(); r.on('end', res); }));

(async () => {
  const probs = [], R = Date.now().toString(36);
  const email = 'crawl' + R + '@acme.in';
  const reg = await post({ action: 'register', form: { companyName: 'Crawl Works', name: 'Owner Crawl', email, password: 'strongpass123' } });
  if (reg.status !== 'success') { console.log('register failed: ' + reg.message); process.exit(1); }
  const A = reg.token;
  if (!LITE) await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Yearly');
  const add = (n, u, role, mgr) => post({ action: 'addUser', token: A, form: { name: n, username: u + R, email: u + R + '@acme.in', role, manager: mgr ? mgr + R : '', dept: 'Ops', jobProfile: 'Exec', password: 'staffpass123' } });
  await add('Head Crawl', 'head', 'HOD'); await add('Doer Crawl', 'doer', 'Doer', 'head'); await add('Other Crawl', 'other', 'Doer', 'head');
  const H = (await post({ action: 'login', username: 'head' + R + '@acme.in', password: 'staffpass123' })).token;
  await post({ action: 'createTask', token: H, form: { title: 'Crawl job one', assignTo: 'doer' + R, dueDate: '2026-12-01', checklist: 'a\nb' } });
  await post({ action: 'createTask', token: A, form: { title: 'Crawl job two', assignTo: 'other' + R, dueDate: '2026-10-01', priority: 'High' } });
  const D = (await post({ action: 'login', username: 'doer' + R + '@acme.in', password: 'staffpass123' })).token;
  await post({ action: 'createTask', token: D, form: { title: 'Crawl ask', assignTo: 'other' + R, dueDate: '2026-12-03' } });

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let pages = 0;
  const visit = async (who, user, pw, w, h) => {
    const p = await b.newPage({ viewport: { width: w, height: h } }); pages++;
    p.on('pageerror', (e) => probs.push(who + ' script error: ' + e.message));
    p.on('response', async (r) => {
      if (!r.url().includes('localhost:' + PORT)) return;
      if (r.status() >= 400 && !/favicon|apple-touch-icon/.test(r.url())) probs.push(who + ' HTTP ' + r.status() + ' ' + r.url().replace(/.*localhost:\d+/, ''));
      if (/\/exec/.test(r.url())) { try { const t = await r.text(); if (/Reference [0-9A-F]{8}/.test(t)) probs.push(who + ' server fault: ' + t.slice(0, 160)); } catch (e) {} }
    });
    await p.goto('http://localhost:' + PORT + '/?login=1', { waitUntil: 'networkidle' });
    await p.fill('#liUser', user); await p.fill('#liPass', pw); await p.click('#btnLogin'); await p.waitForTimeout(1800);
    const fault = async (where) => { const t = await p.evaluate(() => (document.getElementById('dlgScrim') && document.getElementById('dlgScrim').classList.contains('on')) ? document.body.innerText : '');
      if (/went wrong|Reference [0-9A-F]{8}/.test(t)) probs.push(who + ' ' + where + ': error dialog'); await p.evaluate(() => { try { closeDialog(true); } catch (e) {} }); };
    const tabs = await p.$$eval('button[data-tab]', (bs) => [...new Set(bs.filter((x) => x.offsetParent).map((x) => x.dataset.tab))]);
    for (const t of tabs) { await p.click('button[data-tab="' + t + '"]:visible').catch(() => {}); await p.waitForTimeout(900); await fault('tab ' + t); }
    await p.click('button[data-tab="tasks"]:visible').catch(() => {}); await p.waitForTimeout(600);
    await p.click('#btnAccount'); await p.waitForTimeout(400);
    const menu = await p.$$eval('#modal button', (bs) => bs.map((x) => x.textContent.trim()).filter((t) => !/Sign out|Change password/.test(t)));
    await p.evaluate(() => closeModal());
    for (const label of menu) {
      await p.click('#btnAccount'); await p.waitForTimeout(300);
      await p.click('#modal button:has-text("' + label + '")').catch(() => {}); await p.waitForTimeout(900);
      await fault('menu ' + label);
      await p.evaluate(() => { try { closeModal(); closeDrawer(); } catch (e) {} });
    }
    const first = await p.evaluate(() => (STATE.data.tasks[0] || {}).id);
    if (first) { await p.evaluate((i) => openTask(i), first); await p.waitForTimeout(600); await fault('task panel'); await p.evaluate(() => closeDrawer()); }
    if (await p.isVisible('#btnNewTask')) { await p.click('#btnNewTask'); await p.waitForTimeout(700); await fault('assign'); await p.evaluate(() => closeModal()); }
    if (await p.isVisible('#btnHelp')) { await p.click('#btnHelp'); await p.waitForTimeout(600); await fault('help'); await p.keyboard.press('Escape'); }
    if (tabs.indexOf('team') > -1) {
      await p.click('button[data-tab="team"]:visible').catch(() => {}); await p.waitForTimeout(800);
      for (const id of ['btnLeave', 'btnCookie', 'btnOrg', 'btnKra', 'btnCategories', 'btnNewUser']) {
        if (await p.isVisible('#' + id)) { await p.click('#' + id); await p.waitForTimeout(800); await fault('team ' + id);
          await p.evaluate(() => { try { closeModal(); closeDrawer(); } catch (e) {} }); }
      }
    }
    await p.close();
  };
  for (const [who, user, pw] of [['owner', email, 'strongpass123'], ['head', 'head' + R + '@acme.in', 'staffpass123'], ['doer', 'doer' + R + '@acme.in', 'staffpass123']]) {
    await visit(who, user, pw, 1440, 900);
    await visit(who + '-phone', user, pw, 390, 844);
  }
  await b.close();
  console.log(pages + ' sessions crawled');
  console.log(probs.length ? 'PROBLEMS:\n  ' + [...new Set(probs)].join('\n  ') : 'NO PROBLEMS FOUND');
  process.exit(probs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
