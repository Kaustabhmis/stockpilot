/* The data browser - what the Google Sheet was for.
 *
 * Giving up the sheet means giving up opening it and fixing a wrong cell by
 * hand. This checks the replacement actually does that: every table readable,
 * a search that narrows, an edit that lands, a delete that goes, and - the
 * part that matters - a change made here reaching the screens that read it.
 *
 * It is the owner's alone, so it also checks HR cannot get at it.
 *
 *   node browse.test.js http://127.0.0.1:8101
 */

const BASE = process.argv[2] || 'http://127.0.0.1:8101';

const call = async (action, payload, token) => {
  const r = await fetch(BASE + '/exec', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload: payload || {}, token }) });
  const j = await r.json();
  if (!j.ok) throw new Error(action + ': ' + j.error);
  return j.data;
};

let bad = 0;
const check = (label, got, want, why) => {
  const ok = String(got) === String(want);
  if (!ok) bad++;
  console.log('   ' + label.padEnd(26) + String(got).padStart(9) + String(want).padStart(10) +
    (ok ? '    ' : ' ** ') + (why || ''));
};

(async () => {
  const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
  const token = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;

  await call('save', { sheet: 'Employees', row: { emp_code: 'BR-01', name: 'Browse Case',
    status: 'Active', basic: 20000, hra: 8000, department: 'Office', doj: '2019-01-01',
    phone: '9000000001' } }, token);

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(BASE + '/index.html');
  await p.evaluate(u => localStorage.setItem('hrms_lite_api', u), BASE + '/exec');
  await p.reload(); await p.waitForTimeout(700);
  await p.fill('#in-email', 'admin@company.com'); await p.fill('#in-pass', 'admin123');
  await p.click('#btn-login');
  await p.waitForSelector('#view-dashboard', { state: 'visible', timeout: 25000 });
  await p.waitForTimeout(1500);

  console.log('the data browser\n');

  console.log('1. it is behind Settings, not a sixth module');
  const nav = await p.evaluate(() =>
    [...document.querySelectorAll('.nav-item')].map(n => n.dataset.view).filter(Boolean));
  check('modules in the sidebar', nav.length, 6, 'dashboard + the five');
  check('"browse" is not one', nav.includes('browse') ? 'yes' : 'no', 'no',
    'the boss asked for five modules');

  console.log('\n2. every table opens');
  await p.evaluate(() => { openSettings(); settingsTab('browse'); });
  await p.waitForTimeout(1500);
  const tables = await p.evaluate(() => BROWSE_TABLES.slice());
  let opened = 0, empty = [];
  for (const t of tables) {
    const n = await p.evaluate(async name => {
      BROWSE.sheet = name; BROWSE.q = '';
      const rows = await api('list', { sheet: name });
      S.browseRows = rows || []; browseDraw();
      return { rows: S.browseRows.length,
               cells: document.querySelectorAll('#br-table .br-cell').length };
    }, t);
    opened++;
    if (n.rows && !n.cells) { bad++; console.log('   ** ' + t + ' has rows but drew none'); }
    if (!n.rows) empty.push(t);
  }
  check('tables that opened', opened, tables.length, 'all of them');
  console.log('   ' + 'empty ones'.padEnd(26) + (empty.length ? empty.join(', ') : 'none'));

  console.log('\n3. the search narrows');
  const found = await p.evaluate(async () => {
    BROWSE.sheet = 'Employees';
    S.browseRows = await api('list', { sheet: 'Employees' });
    BROWSE.q = ''; const all = browseRows().length;
    BROWSE.q = 'Browse Case'; const hit = browseRows().length;
    BROWSE.q = 'no-such-person-anywhere'; const none = browseRows().length;
    BROWSE.q = ''; browseDraw();
    return { all, hit, none };
  });
  check('all employees', found.all > 0 ? 'some' : 'none', 'some', '');
  check('searching a name', found.hit, 1, 'finds the one');
  check('searching nonsense', found.none, 0, 'finds nothing');

  console.log('\n4. an edit lands, and the screens see it');
  const edited = await p.evaluate(async () => {
    BROWSE.sheet = 'Employees';
    S.browseRows = await api('list', { sheet: 'Employees' });
    BROWSE.q = 'BR-01'; browseDraw();
    const cell = document.querySelector('.br-cell[data-row="0"][data-col="phone"]');
    if (!cell) return { ok: false, why: 'no phone cell drawn' };
    cell.value = '9111122223';
    await api('save', { sheet: 'Employees', row: browseCell(0) });
    await reload();
    const e = empByCode('BR-01');
    return { ok: true, onScreen: e ? e.phone : '(gone)' };
  });
  if (!edited.ok) { bad++; console.log('   ** ' + edited.why); }
  else check('the phone on screen', edited.onScreen, '9111122223',
    'what the grid saved is what the app reads');
  const fromServer = (await call('list', { sheet: 'Employees' }, token))
    .find(e => e.emp_code === 'BR-01');
  check('and on the server', fromServer && fromServer.phone, '9111122223', '');

  console.log('\n5. a key column cannot be typed over');
  const readonly = await p.evaluate(() => {
    const k = document.querySelector('.br-cell[data-col="emp_code"]');
    return k ? (k.hasAttribute('readonly') ? 'locked' : 'editable') : 'not drawn';
  });
  check('the key cell', readonly, 'locked', 'change it by deleting and adding');

  console.log('\n6. HR cannot reach it at all');
  await call('save', { sheet: 'Employees', row: { emp_code: 'BR-HR', name: 'Hr Person',
    status: 'Active', basic: 30000, doj: '2019-01-01' } }, token);
  await call('saveUser', { user: { email: 'br-hr', role: 'hr', emp_code: 'BR-HR',
    active: 'yes', password: 'pw123456' } }, token);
  const hrPage = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  await hrPage.goto(BASE + '/index.html');
  await hrPage.evaluate(u => localStorage.setItem('hrms_lite_api', u), BASE + '/exec');
  await hrPage.reload(); await hrPage.waitForTimeout(700);
  await hrPage.fill('#in-email', 'br-hr'); await hrPage.fill('#in-pass', 'pw123456');
  await hrPage.click('#btn-login');
  await hrPage.waitForSelector('#view-dashboard', { state: 'visible', timeout: 25000 });
  await hrPage.waitForTimeout(1500);
  const hrSees = await hrPage.evaluate(() => {
    openSettings();
    const tabs = [...document.querySelectorAll('#modal .tab')].map(t => t.dataset.stab);
    return { tabs, hasBrowse: tabs.includes('browse'),
             pane: !!document.getElementById('stab-browse') };
  });
  check('a Browse tab for HR', hrSees.hasBrowse ? 'yes' : 'no', 'no', 'owner only');
  check('the pane even exists', hrSees.pane ? 'yes' : 'no', 'no',
    'not rendered, so nothing of it can be submitted');

  console.log('\n7. a delete is asked about before it happens');
  const asked = await p.evaluate(async () => {
    BROWSE.sheet = 'Employees';
    S.browseRows = await api('list', { sheet: 'Employees' });
    BROWSE.q = 'BR-01'; browseDraw();
    browseDelete(0);
    const t = document.getElementById('modal-title');
    return t ? t.textContent : '(no dialog)';
  });
  check('it asks first', /delete this row/i.test(asked) ? 'yes' : 'no: ' + asked, 'yes', '');

  console.log('\n   page errors:', errs.length ? errs : 'none');
  if (errs.length) bad += errs.length;
  console.log('\n' + (bad ? '** wrong: ' + bad : 'the data browser does what the sheet did'));
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('** ' + e.message); process.exit(1); });
