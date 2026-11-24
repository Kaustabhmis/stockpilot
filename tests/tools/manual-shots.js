/**
 * Retakes every picture in the printable user manual (docs/user-manual/pics)
 * from the current app, using the demo factory, and copies the ones the home
 * page shares into netlify/img. Run with the test server on PORT:
 *   DBX_PORT=8098 node server.js &   then   PORT=8098 node tools/manual-shots.js
 */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const PORT = Number(process.env.PORT || 8098), URL = 'http://localhost:' + PORT;
const ROOT = path.join(__dirname, '..', '..');
const PICS = path.join(ROOT, 'docs', 'user-manual', 'pics'), SITE = path.join(ROOT, 'netlify', 'img');
const get = (p) => new Promise((res) => http.get(URL + p, (r) => { let b = ''; r.on('data', (c) => b += c); r.on('end', () => res(b)); }));
const post = (body) => new Promise((res, rej) => { const d = JSON.stringify(body);
  const r = http.request({ host: 'localhost', port: PORT, path: '/exec', method: 'POST', headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(d) } },
    (s) => { let b = ''; s.on('data', (c) => b += c); s.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); });
  r.on('error', rej); r.write(d); r.end(); });
const W = (p, ms) => p.waitForTimeout(ms);
const done = [];

(async () => {
  await get('/__demo');
  const OWNER = ['demo@biscsindia.com', 'demo-pass-for-tests'], SRUTI = ['sruti@demo.domebox.in', 'staff-pass-for-tests'], PAYEL = ['payel@demo.domebox.in', 'staff-pass-for-tests'];
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errs = [];
  const page = async (who, phone) => {
    const p = await b.newPage(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
                                    : { viewport: { width: 1440, height: 933 }, deviceScaleFactor: 1.25 });
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(URL + '/?login=1', { waitUntil: 'networkidle' });
    if (who) { await p.fill('#liUser', who[0]); await p.fill('#liPass', who[1]); await p.click('#btnLogin'); await W(p, 2500); }
    return p;
  };
  const shot = async (p, name, opts) => {
    const file = path.join(PICS, name);
    await p.screenshot(Object.assign({ path: file, type: 'jpeg', quality: 86 }, opts || {}));
    if (fs.existsSync(path.join(SITE, name))) fs.copyFileSync(file, path.join(SITE, name));
    done.push(name);
  };
  const tab = async (p, t) => { await p.evaluate((x) => { const btn = [...document.querySelectorAll('[data-tab="' + x + '"]')].find((e) => e.offsetParent); btn && btn.click(); }, t); await W(p, 1800); };
  const closeAll = (p) => p.evaluate(() => { try { closeDialog(true); } catch (e) {} try { closeModal(); } catch (e) {} try { closeDrawer(); } catch (e) {} });

  /* ---- signing in ------------------------------------------------------- */
  const s = await page(null);
  await shot(s, '01-sign-in.jpg'); await s.close();

  /* ---- a doer: Payel ---------------------------------------------------- */
  const p = await page(PAYEL);
  await shot(p, '02-board.jpg');
  await p.fill('#fSearch', 'Tata'); await W(p, 900);
  await shot(p, '06-search-filter.jpg');
  await p.fill('#fSearch', ''); await W(p, 700);
  await p.click('#btnHistory'); await W(p, 2200);
  await shot(p, '07-archive.jpg');
  await p.click('#btnHistory'); await W(p, 1200);
  const inProg = await p.evaluate(() => (STATE.data.tasks.find((t) => t.status === 'In Progress' && t.assignee === STATE.user.username) || {}).id);
  await p.evaluate((id) => openTask(id), inProg); await W(p, 900);
  await shot(p, '03-task-drawer.jpg');
  await closeAll(p); await W(p, 700);
  /* photo proof with the hand-in */
  await p.evaluate((id) => openStatus(id, 'For Review'), inProg); await W(p, 500);
  await p.fill('#stNote', 'Packed and labelled, photo of the pallet attached');
  await p.setInputFiles('#stPhoto', path.join(__dirname, '..', 'fixtures-photo.jpg')); await W(p, 1500);
  await shot(p, '26-photo-proof.jpg');
  await closeAll(p); await W(p, 300);
  /* a custom blocker */
  const todo = await p.evaluate((skip) => { const mine = STATE.data.tasks.filter((t) => t.assignee === STATE.user.username && !(t.blockedBy || []).length);
    return (mine.find((t) => t.status === 'Pending') || mine.find((t) => t.status === 'In Progress' && t.id !== skip) || mine.find((t) => t.status === 'In Progress') || {}).id; }, inProg);
  await p.evaluate((id) => openTask(id), todo); await W(p, 900);
  await p.evaluate((id) => openBlocker(taskById(id)), todo); await W(p, 500);
  await p.fill('#blkText', 'Waiting for material from the vendor'); await W(p, 300);
  await shot(p, '27-blocker-add.jpg');
  await p.click('#fBlk button[type=submit]'); await W(p, 2800);
  await closeAll(p); await W(p, 200);
  await p.evaluate((id) => openTask(id), todo); await W(p, 900);
  await shot(p, '28-blocker-panel.jpg');
  await closeAll(p); await W(p, 300);
  /* the avatar picker */
  await p.evaluate(() => openAvatarPicker()); await W(p, 700);
  await shot(p, '29-avatar.jpg');
  await closeAll(p); await W(p, 300);
  await tab(p, 'priority');
  await shot(p, '08-priority.jpg');
  await tab(p, 'tasks');
  await p.evaluate(() => openScoreBreakdown()); await W(p, 1800);
  await shot(p, '09-score-why.jpg');
  await closeAll(p); await W(p, 300);
  await tab(p, 'board');
  await shot(p, '10-leaderboard.jpg');
  await tab(p, 'goals');
  await shot(p, '12-goals.jpg');
  await tab(p, 'tasks');
  await p.click('#btnBell'); await W(p, 700);
  await shot(p, '13-bell.jpg');
  await p.click('#btnBell'); await W(p, 300);
  await p.keyboard.press('?'); await W(p, 1200);
  await shot(p, '14-help.jpg');
  await closeAll(p);

  /* ---- the same board on a phone ---------------------------------------- */
  const m = await page(PAYEL, true);
  await shot(m, '15-phone.jpg'); await m.close();

  /* ---- a team lead: Sruti ----------------------------------------------- */
  const t = await page(SRUTI);
  /* Something in For review for the pictures: Payel hands one of hers in. */
  const P = (await post({ action: 'login', username: PAYEL[0], password: PAYEL[1] })).token;
  const pd = (await post({ action: 'getDashboard', token: P })).tasks || [];
  const handIn = pd.find((x) => x.status === 'In Progress' && x.id !== inProg) || pd.find((x) => x.status === 'In Progress');
  if (handIn) await post({ action: 'updateTask', token: P, taskId: handIn.id, status: 'For Review', note: 'Packed 240 bearings, labels checked' });
  await t.evaluate(() => refresh(true)); await W(t, 2200);
  await shot(t, '16-lead-board.jpg');
  await t.close();

  /* ---- the owner -------------------------------------------------------- */
  const o = await page(OWNER);
  const review = await o.evaluate(() => (STATE.data.tasks.find((x) => x.status === 'For Review') || {}).id);
  if (review) {
    await o.evaluate((id) => openTask(id), review); await W(o, 900);
    await shot(o, '17-verify.jpg');
    await closeAll(o); await W(o, 300);
    await o.evaluate((id) => openStatus(id, 'In Progress'), review); await W(o, 500);
    await o.fill('#stNote', 'Two labels face the wrong way. Please re-label and send a photo.');
    await shot(o, '18-send-back.jpg');
    await closeAll(o); await W(o, 300);
  }
  await o.evaluate(() => openAssign()); await W(o, 700);
  await o.fill('#asTitle', 'Despatch 120 bearings to Mahindra');
  await shot(o, '04-assign-form.jpg');
  await o.selectOption('#asFreq', 'Monthly').catch(() => {}); await W(o, 300);
  await o.click('#asStopMode [data-mode="count"]').catch(() => {}); await W(o, 300);
  await o.fill('#asTimes', '6').catch(() => {}); await o.press('#asTimes', 'Tab').catch(() => {}); await W(o, 400);
  const box = await o.evaluate(() => {
    const a = document.getElementById('asFreq').getBoundingClientRect(), w = document.getElementById('asStopWrap').getBoundingClientRect();
    const x = Math.min(a.left, w.left) - 16, y = Math.min(a.top, w.top) - 34;
    return { x, y, width: Math.max(a.right, w.right) - x + 16, height: Math.max(a.bottom, w.bottom) - y + 16 };
  });
  await o.evaluate(() => document.getElementById('asFreq').scrollIntoView({ block: 'center' })); await W(o, 300);
  const box2 = await o.evaluate(() => {
    const a = document.getElementById('asFreq').getBoundingClientRect(), w = document.getElementById('asStopWrap').getBoundingClientRect();
    const x = Math.min(a.left, w.left) - 16, y = Math.min(a.top, w.top) - 34;
    return { x, y, width: Math.max(a.right, w.right) - x + 16, height: Math.max(a.bottom, w.bottom) - y + 16 };
  });
  await shot(o, '05-repeats.jpg', { clip: box2 || box });
  await closeAll(o); await W(o, 300);
  await tab(o, 'projects');
  await shot(o, '11-projects.jpg');
  await tab(o, 'team');
  await o.click('#btnCookie'); await W(o, 1500);
  await shot(o, '19-cookies.jpg');
  await closeAll(o); await W(o, 300);
  /* Excel import (team leads chapter) */
  const csv = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'man-')), 'team.csv');
  fs.writeFileSync(csv, '﻿Name,Email,Phone,Role,Department,Job profile,Reports to\r\n' +
    'Arjun Nair,arjun@sharmaprecision.in,9830011223,Doer,Despatch,Executive,Sruti Charulata\r\n' +
    'Kavita Joshi,kavita@sharmaprecision.in,9830044556,Doer,Quality,Inspector,Imran Qureshi\r\n' +
    'Rohit Das,rohit@sharmaprecision.in,,Doer,Stores,Storekeeper,Sruti Charulata\r\n' +
    'Rohit Das,rohit@sharmaprecision.in,,Doer,Stores,,\r\n');
  await o.click('#btnImport'); await W(o, 400);
  await o.setInputFiles('#impFile', csv); await W(o, 1200);
  await shot(o, '30-import.jpg');
  await closeAll(o); await W(o, 300);
  await tab(o, 'reports');
  await shot(o, '20-reports.jpg');
  await o.click('#btnAppraise'); await W(o, 1200);
  await o.evaluate(() => { const s = document.getElementById('apWho'); const opt = [...s.options].find((x) => /Payel/.test(x.textContent)) || s.options[1];
    s.value = opt.value; s.dispatchEvent(new Event('change', { bubbles: true })); }); await W(o, 2500);
  await shot(o, '21-appraisal.jpg');
  await closeAll(o); await W(o, 300);

  /* ---- the weekly meeting ------------------------------------------------ */
  const q = await page(PAYEL);
  await tab(o, 'meetings');
  await o.click('button:has-text("Start a weekly review")'); await W(o, 500);
  /* Everybody in, not only the managers ticked by default. */
  await o.evaluate(() => document.querySelectorAll('#fStart .mtWho:not(:disabled)').forEach((c) => { c.checked = true; }));
  await o.click('#fStart button[type=submit]'); await W(o, 2500);
  await tab(q, 'meetings');
  await shot(q, '22-meetings-list.jpg');
  await q.click('button:has-text("Join")'); await W(q, 1800);
  for (const u of ['payel', 'sruti', 'meera', 'rafiq']) { await o.click('.att[data-u="' + u + '"]').catch(() => {}); await W(o, 700); }
  await q.fill('#fWin textarea', 'Despatched the Tata order two days early'); await q.click('#fWin button[type=submit]'); await W(q, 1500);
  await o.fill('#fWin textarea', 'Calibration audit closed with zero NCs').catch(() => {}); await o.click('#fWin button[type=submit]').catch(() => {}); await W(o, 1500);
  await W(q, 2500);
  await shot(q, '23-meeting-wins.jpg');
  for (let i = 0; i < 8 && !(await o.$('#fRoad')); i++) { await o.click('button:has-text("Next →")'); await W(o, 1600); }
  if (await o.$('#fRoad')) {
    await o.fill('#fRoad textarea', 'Steel bar from Krishna Castings two weeks late'); await o.click('#fRoad button[type=submit]'); await W(o, 1800);
    await o.evaluate(() => { try { closeDialog(true); } catch (e) {} }); await W(o, 600);
    await shot(o, '24-meeting-roadblocks.jpg');
  }
  for (let i = 0; i < 6 && !(await q.$('.rate')); i++) { await o.click('button:has-text("Next →")').catch(() => {}); await W(o, 1600); await W(q, 1200); }
  await W(q, 2500);
  if (await q.$('.rate')) { await q.click('.rate[data-n="8"]').catch(() => {}); await W(q, 1200);
    await q.evaluate(() => { try { closeDialog(true); } catch (e) {} }); await W(q, 600); await shot(q, '25-meeting-rate.jpg'); }

  await b.close();
  console.log('taken: ' + done.length + '\n  ' + done.join('\n  '));
  console.log('script errors: ' + errs.length + (errs.length ? '\n  ' + errs.slice(0, 5).join('\n  ') : ''));
})().catch((e) => { console.error(e); process.exit(1); });
