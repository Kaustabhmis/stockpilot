/**
 * The board gets the screen: scrolling the tasks folds the summary cards away
 * and keeps the column headings pinned; "Needs approval" appears only when
 * something waits for approval; refusals are a calm notice, not "something
 * went wrong"; phones get a compact layout with filters behind one button;
 * no width scrolls sideways; tabs visited again show at once, and a change
 * clears what was remembered.
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
  const email = 'bf+' + R + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering', name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Yearly');
  await post({ action: 'addUser', token: A, form: { name: 'Sruti Das', username: 'sruti' + R, email: 'sruti' + R + '@acme.in', role: 'HOD', jobProfile: 'Head', password: 'staffpass123' } });
  await post({ action: 'addUser', token: A, form: { name: 'Payel Sen', username: 'payel' + R, email: 'payel' + R + '@acme.in', role: 'Doer', jobProfile: 'Exec', manager: 'sruti' + R, password: 'staffpass123' } });
  for (let i = 1; i <= 30; i++) await post({ action: 'createTask', token: A, form: { title: 'Job number ' + i, assignTo: 'payel' + R, dueDate: '2030-12-12' } });

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errs = [];
  const signIn = async (user, pw, opt) => { const p = await b.newPage(Object.assign({ viewport: { width: 1400, height: 860 } }, opt || {}));
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://localhost:' + PORT + '/?login=1', { waitUntil: 'networkidle' });
    await p.fill('#liUser', user); await p.fill('#liPass', pw); await p.click('#btnLogin'); await p.waitForTimeout(1800); return p; };
  const heads = (p) => p.$$eval('#board .colhead', (h) => h.map((x) => x.textContent.trim()));

  console.log('\n=== the board gets the screen ===');
  const a = await signIn(email, 'strongpass123');
  ok('with nothing waiting for approval, the board starts at To do', (await heads(a))[0] === 'To do' && !(await heads(a)).includes('Needs approval'), (await heads(a)).join(','));
  const fit = await a.evaluate(() => { const b = document.getElementById('board'); return { sh: b.scrollHeight, ch: b.clientHeight, max: getComputedStyle(b).maxHeight }; });
  ok('the board scrolls inside its own area, sized to the screen', fit.sh > fit.ch && /px/.test(fit.max), JSON.stringify(fit));
  await a.evaluate(() => { document.getElementById('board').scrollTop = 500; }); await a.waitForTimeout(800);
  const st = await a.evaluate(() => { const h = document.querySelector('#board .colTop').getBoundingClientRect(), bd = document.getElementById('board').getBoundingClientRect();
    return { head: Math.round(h.top), board: Math.round(bd.top), tiles: document.getElementById('statTiles').getBoundingClientRect().height, focus: document.getElementById('tab-tasks').classList.contains('focus') }; });
  ok('scrolling the tasks folds the summary cards away', st.focus && st.tiles < 2, JSON.stringify(st));
  ok('and the column headings stay pinned at the top of the board', Math.abs(st.head - st.board) <= 1, JSON.stringify(st));
  const fb = await a.evaluate(() => document.getElementById('taskFilters').getBoundingClientRect().bottom);
  ok('right under the filters', st.board - fb >= 0 && st.board - fb < 30, st.board + ' / ' + fb);
  await a.evaluate(() => { document.getElementById('board').scrollTop = 0; }); await a.waitForTimeout(600);
  ok('scrolling back to the top brings the cards back', await a.evaluate(() => !document.getElementById('tab-tasks').classList.contains('focus') && document.getElementById('statTiles').getBoundingClientRect().height > 40));
  await a.click('#viewMode [data-mode="list"]'); await a.waitForTimeout(500);
  await a.evaluate(() => { document.getElementById('list').scrollTop = 400; }); await a.waitForTimeout(600);
  ok('the list view keeps its column titles pinned too', await a.evaluate(() => { const th = document.querySelector('#list thead th').getBoundingClientRect(), l = document.getElementById('list').getBoundingClientRect(); return Math.abs(th.top - l.top) <= 2; }));
  await a.click('#viewMode [data-mode="board"]'); await a.waitForTimeout(400);

  console.log('\n=== "Needs approval" only when needed ===');
  const P = (await post({ action: 'login', username: 'payel' + R + '@acme.in', password: 'staffpass123' })).token;
  const mine = ((await post({ action: 'getDashboard', token: P })).tasks || []).find((t) => t.title === 'Job number 1');
  await post({ action: 'delegateTask', token: P, taskId: mine.id, toUsername: 'sruti' + R });
  const s = await signIn('sruti' + R + '@acme.in', 'staffpass123');
  ok('a hand-over waiting for a decision brings the column back', (await heads(s))[0] === 'Needs approval', (await heads(s)).join(','));
  await s.close();

  console.log('\n=== a refusal is a notice, not an alarm ===');
  await a.evaluate(() => toast('Finish the checklist first (1/3).', 'err')); await a.waitForTimeout(300);
  ok('it is titled "Notice", in blue', await a.isVisible('#dlg.dlg-notice') && (await a.textContent('#dlgTitle')).trim() === 'Notice');
  ok('and nothing on screen says "something went wrong"', !/went wrong/i.test(await a.evaluate(() => document.body.innerText)));
  await a.evaluate(() => closeDialog(true)); await a.waitForTimeout(200);
  await a.evaluate(() => toast('No connection. Check your internet and try again.', 'err')); await a.waitForTimeout(300);
  ok('a lost connection says "Connection problem"', (await a.textContent('#dlgTitle')).trim() === 'Connection problem');
  await a.evaluate(() => closeDialog(true));
  const refused = await a.evaluate(() => api('updateTask', { taskId: 'NOPE', status: 'Verified' }).then(() => '', (e) => e.message));
  ok('the server’s own refusals read as plain sentences', refused.length > 5 && !/went wrong/i.test(refused), refused);

  console.log('\n=== quick: tabs remembered, and forgotten on a change ===');
  const calls = [];
  a.on('request', (r) => { if (/\/exec/.test(r.url())) { try { calls.push(JSON.parse(r.postData()).action); } catch (e) {} } });
  await a.click('#navTabs [data-tab="team"]'); await a.waitForTimeout(1000);
  await a.click('#navTabs [data-tab="tasks"]'); await a.waitForTimeout(500);
  calls.length = 0;
  await a.click('#navTabs [data-tab="team"]'); await a.waitForTimeout(400);
  ok('opening a tab again within a minute and a half asks the server nothing', !calls.includes('getUsers'), calls.join(','));
  await a.evaluate(() => api('addUser', { form: { name: 'New Person', username: 'np' + Date.now(), email: 'np' + Date.now() + '@acme.in', role: 'Doer', password: 'staffpass123' } }));
  calls.length = 0;
  await a.click('#navTabs [data-tab="tasks"]'); await a.waitForTimeout(300);
  await a.click('#navTabs [data-tab="team"]'); await a.waitForTimeout(1200);
  ok('after a change it asks again, so the new person shows', calls.includes('getUsers') && /New Person/.test(await a.textContent('#teamTable')), calls.join(','));
  /* Someone else adds a person, from another screen: this one has the team remembered. */
  await post({ action: 'addUser', token: A, form: { name: 'Elsewhere Added', username: 'ea' + R, email: 'ea' + R + '@acme.in', role: 'Doer', jobProfile: 'Exec', password: 'staffpass123' } });
  await a.waitForTimeout(3200);
  await a.click('#navTabs [data-tab="tasks"]'); await a.waitForTimeout(200);
  await a.click('#navTabs [data-tab="team"]'); await a.waitForTimeout(2500);
  ok('a change made by someone else appears on a remembered tab a moment later', /Elsewhere Added/.test(await a.textContent('#teamTable')));
  ok('the payment script is not loaded until someone goes to pay', await a.evaluate(() => typeof Razorpay === 'undefined' && ![...document.scripts].some((x) => /razorpay/.test(x.src))));
  await a.close();

  console.log('\n=== phones and tablets ===');
  const m = await signIn(email, 'strongpass123', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const ph = await m.evaluate(() => ({ fb: document.getElementById('taskFilters').getBoundingClientRect().height, tiles: document.getElementById('statTiles').getBoundingClientRect().height,
    col: document.querySelector('#board > div').getBoundingClientRect().width, w: innerWidth, page: document.documentElement.scrollWidth,
    fbTop: document.getElementById('taskFilters').getBoundingClientRect().top, bar: document.querySelector('#view-app .appbar').getBoundingClientRect().bottom }));
  ok('on a phone the filters are one row, behind a Filters button', ph.fb < 80 && await m.isVisible('#btnFilters') && !(await m.isVisible('#fAssignee')), JSON.stringify(ph));
  ok('the summary is a compact strip', ph.tiles < 170, ph.tiles);
  ok('one column fills the width; swipe for the next', ph.col > ph.w * 0.8 && ph.col < ph.w, ph.col);
  ok('nothing scrolls sideways', ph.page <= ph.w);
  await m.evaluate(() => window.scrollTo(0, 400)); await m.waitForTimeout(300);
  const stuck = await m.evaluate(() => ({ fbTop: document.getElementById('taskFilters').getBoundingClientRect().top, bar: document.querySelector('#view-app .appbar').getBoundingClientRect().bottom }));
  ok('the filters stick below the phone’s taller top bar, not under it', Math.abs(stuck.fbTop - stuck.bar) <= 2, JSON.stringify(stuck));
  await m.click('#btnFilters'); await m.waitForTimeout(300);
  ok('the Filters button opens them', await m.isVisible('#fAssignee') && await m.isVisible('#viewMode'));
  await m.close();
  for (const w of [768, 1024]) {
    const t = await signIn(email, 'strongpass123', { viewport: { width: w, height: 900 } });
    ok('a ' + w + 'px tablet does not scroll sideways', await t.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await t.close();
  }

  ok('no script errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
