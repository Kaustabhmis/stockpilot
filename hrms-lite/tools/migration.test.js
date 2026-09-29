/* The migration, end to end and for real.
 *
 * Fills a sheet-backed workspace with a company's worth of data, copies it
 * into Postgres exactly as migrate.html does, then checks two things that
 * matter more than "it finished":
 *
 *   1. every table has as many rows on the new side as the old
 *   2. the PAYROLL comes out the same, worked out from the migrated data
 *
 * The second is the real test. Row counts prove nothing arrived short; only
 * recomputing the money proves it arrived meaning the same thing.
 *
 *   node migration.test.js <sheet-url> <postgres-url>
 */

const OLD = process.argv[2] || 'http://127.0.0.1:8101/exec';
const NEW = process.argv[3] || 'http://127.0.0.1:8105/exec';

const call = async (url, action, payload, token) => {
  const r = await fetch(url, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload: payload || {}, token: token || '' }) });
  const j = await r.json();
  if (!j.ok) throw new Error(action + ' @' + url + ': ' + j.error);
  return j.data;
};

let bad = 0;
const check = (label, got, want, why) => {
  const ok = String(got) === String(want);
  if (!ok) bad++;
  console.log('   ' + label.padEnd(22) + String(got).padStart(10) + String(want).padStart(11) +
    (ok ? '    ' : ' ** ') + (why || ''));
};

(async () => {
  /* A migration is only checkable against an EMPTY destination. Run against a
     database somebody has already been testing in, the counts compare this
     run's rows with everybody else's and say nothing. */
  if (process.env.RESET_SQL) {
    const { execSync } = await import('node:child_process');
    console.log('resetting the destination database...');
    execSync(process.env.RESET_SQL, { stdio: 'ignore' });
  }

  const oldTok = (await call(OLD, 'login', { email: 'admin@company.com', password: 'admin123' })).token;

  /* ---- put a company into the sheet ---- */
  const N = 25, DAYS = 70, YM = '2026-08';
  const codes = Array.from({ length: N }, (_, i) => 'MG-' + String(i).padStart(3, '0'));
  console.log('filling the sheet workspace: ' + N + ' staff, ' + DAYS + ' days\n');

  for (const code of codes) {
    await call(OLD, 'save', { sheet: 'Employees', row: { emp_code: code,
      name: 'Migrate ' + code, status: 'Active', basic: 18000, hra: 7200,
      special_allowance: 800, other_allowance: 0, pf_applicable: 'yes',
      esi_applicable: 'no', doj: '2019-01-01', department: 'Office',
      pan: 'ABCDE1234F', uan: '1001' + code.slice(-3), bank_account: '9988' + code.slice(-3),
      ifsc: 'SBIN0001234' } }, oldTok);
  }
  const base = Date.now() - DAYS * 864e5;
  let rows = [];
  for (let d = 0; d < DAYS; d++) {
    const iso = new Date(base + d * 864e5).toISOString().slice(0, 10);
    for (const code of codes) {
      rows.push({ id: code + '_' + iso, date: iso, emp_code: code, status: 'P',
        in_time: '09:28', out_time: '18:35', hours: 9, remarks: 'seeded' });
    }
    if (rows.length >= 400) { await call(OLD, 'saveMany', { sheet: 'Attendance', rows }, oldTok); rows = []; }
  }
  if (rows.length) await call(OLD, 'saveMany', { sheet: 'Attendance', rows }, oldTok);

  /* a leave, a request and some punches, so every shape travels */
  await call(OLD, 'save', { sheet: 'Leave', row: { emp_code: codes[0], type: 'Casual',
    from_date: YM + '-10', to_date: YM + '-11', days: 2, reason: 'migration case',
    status: 'Approved', applied_at: YM + '-09' } }, oldTok);
  await call(OLD, 'save', { sheet: 'Requests', row: { emp_code: codes[1], type: 'OD',
    date: YM + '-12', reason: 'site', status: 'Approved', applied_at: YM + '-11' } }, oldTok);
  await call(OLD, 'ingestPunches', { punches: codes.slice(0, 5).flatMap(c =>
    ['09:15', '13:20', '18:40'].map(t => ({ EmpCode: c, LogDate: YM + '-20', LogTime: t }))),
    source: 'migration seed' }, oldTok);

  /* ---- the payroll, worked out on the OLD side, before anything moves ---- */
  const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
  const b = await chromium.launch();
  const payOn = async (base2, label) => {
    const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
    const errs = []; p.on('pageerror', e => errs.push(label + ': ' + e));
    await p.goto(base2.replace(/\/exec$/, '') + '/index.html');
    /* the API is the /exec address, not the site root - pointing the screen
       at the root makes it post to a page and try to parse HTML as JSON */
    await p.evaluate(u => localStorage.setItem('hrms_lite_api', u),
      base2.replace(/\/?$/, '').replace(/\/exec$/, '') + '/exec');
    await p.reload(); await p.waitForTimeout(700);
    await p.fill('#in-email', 'admin@company.com'); await p.fill('#in-pass', 'admin123');
    await p.click('#btn-login');
    await p.waitForSelector('#view-dashboard', { state: 'visible', timeout: 25000 });
    await p.waitForTimeout(1500);
    const out = await p.evaluate(([cs, ym]) => {
      const want = new Set(cs);
      return S.employees.filter(e => want.has(e.emp_code)).map(e => {
        const r = computePay(e, ym, null);
        return { code: e.emp_code, paid: r.paid_days, gross: r.gross, pf: r.pf,
                 pt: r.pt, ded: r.total_deduction, net: r.net };
      }).sort((x, y) => x.code.localeCompare(y.code));
    }, [codes, YM]);
    await p.close();
    if (errs.length) console.log('   page errors: ' + errs.join(' | '));
    return out;
  };

  const before = await payOn(OLD, 'sheet');
  console.log('payroll on the sheet: ' + before.length + ' people, net total ' +
    before.reduce((s, r) => s + r.net, 0).toLocaleString());

  /* ---- copy it across, exactly as the migration page does ---- */
  const newTok = (await call(NEW, 'login', { email: 'admin@company.com', password: 'admin123' })).token;
  const plan = await call(OLD, 'exportPlan', {}, oldTok);
  /* the sheet is the truth for these, so its rows replace the seeded ones */
    const REPLACE = new Set(['Shifts', 'LeaveTypes', 'RequestTypes', 'ApprovalLevels']);
    const order = ['Settings', 'Employees', 'Users', 'Shifts', 'LeaveTypes', 'RequestTypes',
    'ApprovalLevels', 'Sites', 'Holidays', 'Events', 'CtcVariables', 'CtcComponents',
    'CtcValues', 'Notices', 'Attendance', 'Leave', 'Requests', 'Payroll', 'Punches',
    'PayslipMail'];
  const tabs = order.filter(n => plan.tabs.some(t => t.sheet === n));

  console.log('\ncopying across...');
  const problems = [];
  for (const name of tabs) {
    const meta = plan.tabs.find(t => t.sheet === name);
    if (!meta || !meta.rows) continue;
    let offset = 0;
    while (true) {
      const page = await call(OLD, 'exportTab', { sheet: name, offset, limit: 500 }, oldTok);
      if (page.rows.length) {
        const res = await call(NEW, 'importTab', { sheet: name, rows: page.rows, replace: REPLACE.has(name) && offset === 0 }, newTok);
        (res.problems || []).forEach(x => problems.push(name + ' row ' + (offset + x.row) + ': ' + x.why));
      }
      offset += page.rows.length;
      if (page.done || !page.rows.length) break;
    }
    console.log('  ' + name.padEnd(16) + String(meta.rows).padStart(7) + ' rows');
  }

  /* ---- 1. does every table have as many rows? ---- */
  console.log('\n1. row counts, sheet against Postgres');
  console.log('   table                    sheet   postgres');
  const after = await call(NEW, 'tally', {}, newTok);
  plan.tabs.forEach(t => {
    if (!t.rows) return;
    const got = after[t.sheet] || 0;
    /* the new workspace seeded its own settings and its own first owner */
    const soft = t.sheet === 'Settings' || t.sheet === 'Users';
    const ok = soft ? got >= t.rows : got === t.rows;
    if (!ok) bad++;
    console.log('   ' + t.sheet.padEnd(22) + String(t.rows).padStart(8) +
      String(got).padStart(11) + (ok ? '    ' : ' ** ') +
      (soft && got > t.rows ? '(plus the seeded rows)' : ''));
  });

  if (problems.length) {
    bad += problems.length;
    console.log('\n   ** rows that would not go in:');
    problems.slice(0, 20).forEach(p => console.log('      ' + p));
  }

  /* ---- 2. does the MONEY come out the same? ---- */
  console.log('\n2. the payroll, recomputed from the migrated data');
  const afterPay = await payOn(NEW, 'postgres');
  await b.close();

  check('people in the run', afterPay.length, before.length, '');
  const sum = a => a.reduce((s, r) => s + Number(r.net), 0);
  check('net total', sum(afterPay), sum(before), 'every rupee, both sides');

  let differed = 0;
  before.forEach(b0 => {
    const a0 = afterPay.find(x => x.code === b0.code);
    if (!a0) { differed++; return; }
    if (a0.paid !== b0.paid || a0.gross !== b0.gross || a0.pf !== b0.pf ||
        a0.pt !== b0.pt || a0.net !== b0.net) {
      differed++;
      if (differed <= 5) {
        console.log('   ** ' + b0.code + ' sheet: paid ' + b0.paid + ' gross ' + b0.gross +
          ' pf ' + b0.pf + ' net ' + b0.net);
        console.log('      ' + ' '.repeat(b0.code.length) + ' pg   : paid ' + a0.paid +
          ' gross ' + a0.gross + ' pf ' + a0.pf + ' net ' + a0.net);
      }
    }
  });
  check('payslips that differ', differed, 0, 'every line of every payslip');

  console.log('\n' + (bad ? '** the migration is NOT clean: ' + bad + ' problem(s)'
                          : 'the migration is clean - same rows, same money'));
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('** ' + e.message); process.exit(1); });
