/**
 * The task panel: an Admin sees Archive, Restore and Delete, and can add and
 * delete steps; a head of department and the owner see none of it.
 */
const { chromium } = require('playwright');
const http = require('http');
const post = (body) => new Promise((res, rej) => { const d = JSON.stringify(body);
  const r = http.request({ host: 'localhost', port: 8095, path: '/exec', method: 'POST', headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(d) } },
    (s) => { let b = ''; s.on('data', (c) => b += c); s.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); });
  r.on('error', rej); r.write(d); r.end(); });
const hit = (p) => new Promise((res) => http.get('http://localhost:8095' + p, (r) => { r.resume(); r.on('end', res); }));

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 200) + ']')); v ? pass++ : fail++; };
  const R = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const email = 'adm+' + R + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme', name: 'Rohan Mehta', email, password: 'strongpass123' } })).token;
  await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Yearly');
  await post({ action: 'addUser', token: A, form: { name: 'Sruti C', username: 'sruti' + R, email: 'sruti' + R + '@acme.in', role: 'HOD', jobProfile: 'Head', password: 'staffpass123' } });
  await post({ action: 'addUser', token: A, form: { name: 'Payel S', username: 'payel' + R, email: 'payel' + R + '@acme.in', role: 'Doer', manager: 'sruti' + R, jobProfile: 'Exec', password: 'staffpass123' } });
  const S = (await post({ action: 'login', username: 'sruti' + R + '@acme.in', password: 'staffpass123' })).token;
  await post({ action: 'createTask', token: S, form: { title: 'Vendor audit', assignTo: 'payel' + R, dueDate: '2026-12-20', checklist: 'Collect\nVisit' } });
  await post({ action: 'createTask', token: S, form: { title: 'Throwaway', assignTo: 'payel' + R, dueDate: '2026-12-21' } });
  const ids = Object.fromEntries((await post({ action: 'getDashboard', token: A })).tasks.map((t) => [t.title, t.id]));

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const signIn = async (user, pass) => { const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://localhost:8095/?login=1', { waitUntil: 'networkidle' });
    await p.fill('#liUser', user); await p.fill('#liPass', pass); await p.click('#btnLogin'); await p.waitForTimeout(1800); return p; };
  const open = async (p, id) => { await p.evaluate((i) => openTask(i), id); await p.waitForTimeout(500); };
  const yes = async (p) => { await p.waitForSelector('#dlg [data-a="yes"]', { state: 'visible' }); await p.click('#dlg [data-a="yes"]'); await p.waitForTimeout(1200); };
  const steps = (p) => p.$$eval('#drawer .sub', (cs) => cs.map((c) => c.parentElement.textContent.trim()));

  console.log('\n=== a head of department and the owner see no admin controls ===');
  for (const [who, user] of [['head of department', 'sruti'], ['owner of the task', 'payel']]) {
    const p = await signIn(user + R + '@acme.in', 'staffpass123');
    await open(p, ids['Vendor audit']);
    ok('the ' + who + ' sees no Archive or Delete', !(await p.$('#drawer [data-act="archive"]')) && !(await p.$('#drawer [data-act="delete"]')));
    ok('and cannot add or delete steps', !(await p.$('#stepNew')) && !(await p.$('#drawer .stepDel')));
    await p.close();
  }

  console.log('\n=== an Admin ===');
  const p = await signIn(email, 'strongpass123');
  await open(p, ids['Vendor audit']);
  ok('sees an Admin row with Archive and Delete', await p.isVisible('#drawer [data-act="archive"]') && await p.isVisible('#drawer [data-act="delete"]'));
  ok('and a way to add a step, and a delete beside each step', await p.isVisible('#stepNew') && (await p.$$('#drawer .stepDel')).length === 2);
  await p.fill('#stepNew', 'Sign report'); await p.press('#stepNew', 'Enter'); await p.waitForTimeout(1200);
  ok('adds a step (Enter works)', JSON.stringify(await steps(p)) === JSON.stringify(['Collect', 'Visit', 'Sign report']), await steps(p));
  await p.fill('#stepNew', 'Photos'); await p.click('#stepAdd'); await p.waitForTimeout(1200);
  ok('adds another with the button', (await steps(p)).includes('Photos'));
  await p.click('#drawer .stepDel[data-i="1"]');
  ok('deleting a step asks first', await p.isVisible('#dlg [data-a="yes"]') && (await p.textContent('#dlg')).includes('Visit'));
  await yes(p);
  ok('and the step is gone', JSON.stringify(await steps(p)) === JSON.stringify(['Collect', 'Sign report', 'Photos']), await steps(p));

  await p.click('#drawer [data-act="archive"]');
  ok('archiving asks first, and says an open task will be cancelled', (await p.textContent('#dlg')).includes('cancelled'));
  await yes(p);
  ok('the task leaves the board', await p.evaluate((i) => !visibleTasks().some((t) => t.id === i), ids['Vendor audit']));
  await p.click('#btnHistory'); await p.waitForTimeout(1200);
  ok('and is in the archive', await p.evaluate((i) => visibleTasks().some((t) => t.id === i), ids['Vendor audit']));
  await open(p, ids['Vendor audit']);
  ok('where it shows Restore instead of Archive', await p.isVisible('#drawer [data-act="restore"]') && !(await p.$('#drawer [data-act="archive"]')));
  await p.click('#drawer [data-act="restore"]'); await yes(p);
  await p.click('#btnHistory'); await p.waitForTimeout(1200);
  const back = await p.evaluate((i) => (STATE.data.tasks || []).find((t) => t.id === i), ids['Vendor audit']);
  ok('restore puts it back on the board as it was', back && !back.isArchived && back.status === 'Pending', back && back.status);

  await open(p, ids['Throwaway']);
  await p.click('#drawer [data-act="delete"]');
  ok('delete asks first, and says it cannot be undone', (await p.textContent('#dlg')).includes('cannot be undone'));
  await p.click('#dlg [data-a="no"]'); await p.waitForTimeout(400);
  ok('Cancel keeps it', await p.evaluate((i) => (STATE.data.tasks || []).some((t) => t.id === i), ids['Throwaway']));
  await p.click('#drawer [data-act="delete"]'); await yes(p);
  ok('confirming deletes it', await p.evaluate((i) => !(STATE.data.tasks || []).some((t) => t.id === i), ids['Throwaway']));

  ok('no script errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
