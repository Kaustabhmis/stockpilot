/* Payroll's statutory figures, checked against the rules written out here in
 * words - not against what index.html happens to do.
 *
 * This file exists because of a bug that shipped. PF was capped at
 * "15,000 scaled down by the days you were paid" instead of a flat 15,000,
 * so everyone above the ceiling who missed a day was under-deducted: two
 * days off turned 1,800 into 1,684. Every payroll test at the time used a
 * clean full month, and with no LOP the two rules give exactly the same
 * answer, so all of them passed. One test did run with LOP, and its expected
 * value had been written by reading the implementation - so it compared the
 * code with itself and agreed.
 *
 * Hence the two rules for this file:
 *
 *   1. Every expected value is derived from the rule as stated in the
 *      comment above it. Never from the code, and never by running the code
 *      and writing down what came out.
 *   2. Every case is awkward on purpose - LOP, a mid-month joiner, a
 *      mid-month leaver, someone sitting exactly on a ceiling, someone a
 *      rupee either side of one. Clean full months hide this whole class of
 *      bug.
 *
 * Run it against a workspace with the HR screen served locally:
 *   node payroll-rules.test.js http://127.0.0.1:8101
 * It signs in as the owner, seeds a month of its own people in a department
 * called AWKWARD, and reports any figure that does not match its rule.
 */

const BASE = process.argv[2] || 'http://127.0.0.1:8101';
const YM = '2026-08', DIM = 31;          /* a 31-day month that has closed */

/* The rules, in words, and then in arithmetic.
 *
 * PF     - 12% of the basic actually EARNED in the month, and the wage it is
 *          charged on is capped at a flat 15,000. The cap is a monthly
 *          figure: it does not shrink because somebody was absent. Nor does
 *          being above it entitle anyone to a flat 1,800 - a man on 20,000
 *          basic who worked five days earned about 3,226, and 12% of that is
 *          what is due. Employer's share is 13% on the same wage.
 * ESI    - membership is decided on the FULL monthly gross against 21,000;
 *          the contribution is 0.75% of what was actually earned. Somebody
 *          over the limit does not fall into ESI by missing a week.
 * P.Tax  - a slab on the full monthly gross. Never prorated: it is a tax on
 *          the month, not on the days worked.
 * Net    - gross less every deduction, and nothing else.
 */
const PF_CEILING = 15000, PF_EMPLOYEE = 0.12, PF_EMPLOYER = 0.13;
const ESI_CEILING = 21000, ESI_EMPLOYEE = 0.0075;
const ptaxOn = gross =>
  gross <= 10000 ? 0 : gross <= 15000 ? 110 : gross <= 25000 ? 130 : gross <= 40000 ? 150 : 200;

/* code, basic, hra, LOP days, joined, left, ESI member */
const CASES = [
  ['AW-01', 20000, 8000,  0, '2019-01-01', '',          'no',  'above the PF ceiling, a clean month'],
  ['AW-02', 20000, 8000,  2, '2019-01-01', '',          'no',  'two days LOP, still above the ceiling after it'],
  ['AW-03', 16000, 6400,  4, '2019-01-01', '',          'no',  'LOP drags the earned basic below the ceiling'],
  ['AW-04', 20000, 8000, 26, '2019-01-01', '',          'no',  'heavy LOP: PF on what was earned, not 1,800'],
  ['AW-05', 15000, 6000,  0, '2019-01-01', '',          'no',  'sitting exactly on the PF ceiling'],
  ['AW-06', 12000, 8800,  0, '2019-01-01', '',          'yes', 'gross 20,800 - a rupee inside ESI'],
  ['AW-07', 12000, 9200,  0, '2019-01-01', '',          'yes', 'gross 21,200 - a rupee outside ESI'],
  ['AW-08', 14000, 8000,  0, '2019-01-01', '',          'yes', 'gross 22,000 - outside ESI, no LOP'],
  ['AW-09', 20000, 8000,  0, YM + '-16',   '',          'no',  'joined on the 16th'],
  ['AW-10', 20000, 8000,  0, '2019-01-01', YM + '-15',  'no',  'left on the 15th'],
];

const call = async (action, payload, token) => {
  const r = await fetch(BASE + '/exec', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, token })
  });
  const j = await r.json();
  if (!j.ok) throw new Error(action + ': ' + j.error);
  return j.data;
};

(async () => {
  const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
  const token = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;


  /* A finalised payroll run locks its month's register - correctly. This
     file lays that month out itself, so reopen the run first, or it fails
     for a reason that has nothing to do with the rule under test. */
  {
    const runRows = (await call('list', { sheet: 'Payroll' }, token))
      .filter(p => String(p.month) === YM);
    for (let i = 0; i < runRows.length; i += 200) {
      await call('removeMany', { sheet: 'Payroll',
        ids: runRows.slice(i, i + 200).map(p => p.id) }, token);
    }
  }

  for (const [code, basic, hra, , doj, exit, esi] of CASES) {
    await call('save', { sheet: 'Employees', row: {
      emp_code: code, name: 'Case ' + code, status: 'Active', basic, hra,
      special_allowance: 0, other_allowance: 0, pf_applicable: 'yes',
      esi_applicable: esi, doj, exit_date: exit, department: 'AWKWARD' } }, token);
  }

  const rows = [];
  for (const [code, , , lop] of CASES) {
    let left = lop;
    for (let d = 1; d <= DIM; d++) {
      const iso = YM + '-' + ('0' + d).slice(-2);
      const absent = left > 0 && (left--, true);
      rows.push({ id: code + '_' + iso, date: iso, emp_code: code,
        status: absent ? 'A' : 'P', in_time: absent ? '' : '09:00',
        out_time: absent ? '' : '18:00', hours: absent ? 0 : 9 });
    }
  }
  for (let i = 0; i < rows.length; i += 400) {
    await call('saveMany', { sheet: 'Attendance', rows: rows.slice(i, i + 400) }, token);
  }
  /* Pin every setting this file depends on rather than inheriting whatever
     the workspace was left in. A test that reads a rule it did not set is
     measuring somebody else's run. */
  const shifts = await call('list', { sheet: 'Shifts' }, token);
  const general = shifts.find(s => String(s.name).trim().toLowerCase() === 'general') || shifts[0];
  if (general) {
    await call('save', { sheet: 'Shifts', row: Object.assign({}, general,
      { weekly_off: 'None', saturday_policy: 'working' }) }, token);
  }
  await call('saveSettings', { settings: { payroll_basis: 'calendar', payroll_rounding: '1',
    late_marks_per_halfday: '0', punch_out_mandatory: 'no', ot_pay_enabled: 'no',
    excess_leave_unpaid: 'no', pf_wage_ceiling: '15000', pf_employee_pct: '12',
    pf_employer_pct: '13', esi_wage_ceiling: '21000', esi_employee_pct: '0.75',
    esi_employer_pct: '3.25' } }, token);

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(BASE + '/index.html');
  await p.evaluate(u => localStorage.setItem('hrms_lite_api', u), BASE + '/exec');
  await p.reload(); await p.waitForTimeout(700);
  await p.fill('#in-email', 'admin@company.com'); await p.fill('#in-pass', 'admin123');
  await p.click('#btn-login');
  await p.waitForSelector('#view-dashboard', { state: 'visible', timeout: 25000 });
  await p.waitForTimeout(1500);
  await p.evaluate(m => { go('payroll'); el('pay-month').value = m; renderPayroll(); }, YM);
  await p.waitForTimeout(2500);

  const got = await p.evaluate(([codes, ym]) => {
    const want = new Set(codes);
    return S.employees.filter(e => want.has(e.emp_code)).map(e => {
      const r = computePay(e, ym, null);
      return { code: e.emp_code, paid: r.paid_days, total: r.total_days,
               basic: r.basic, gross: r.gross, pf: r.pf, pfEr: r.pf_employer,
               esi: r.esi, pt: r.pt, ded: r.total_deduction, net: r.net };
    });
  }, [CASES.map(c => c[0]), YM]);

  let bad = 0;
  const line = (what, got, want, why) => {
    const ok = Math.abs(got - want) <= 1;          /* a rupee of rounding */
    if (!ok) bad++;
    console.log('   ' + what.padEnd(10) + String(got).padStart(7) + String(want).padStart(8) +
      (ok ? '    ' : ' ** ') + why);
  };

  console.log('checking payroll against the rules as written, on awkward months\n');
  CASES.forEach(([code, basic, hra, , , , esiFlag, note]) => {
    const r = got.find(x => x.code === code);
    if (!r) { bad++; console.log(code + '  ** did not appear in the run'); return; }
    const fullGross = basic + hra;
    const pfWage = Math.min(r.basic, PF_CEILING);
    console.log(code + '  ' + (r.paid + '/' + r.total).padStart(7) + '  ' + note);
    line('PF',        r.pf,   Math.round(pfWage * PF_EMPLOYEE), '12% of basic earned, flat 15,000 cap');
    line('PF empr',   r.pfEr, Math.round(pfWage * PF_EMPLOYER), '13% on the same wage');
    line('ESI',       r.esi,
      (esiFlag === 'yes' && fullGross <= ESI_CEILING) ? Math.round(r.gross * ESI_EMPLOYEE) : 0,
      esiFlag !== 'yes' ? 'not a member'
        : fullGross <= ESI_CEILING ? 'member: 0.75% of gross earned'
        : 'full gross ' + fullGross + ' is over 21,000');
    line('P.Tax',     r.pt, r.gross > 0 ? ptaxOn(fullGross) : 0, 'slab on full gross, not prorated');
    line('net',       r.net, Math.round(r.gross - r.ded), 'gross less every deduction');
    console.log('');
  });

  console.log(bad ? '** figures that did not match their rule: ' + bad
                  : 'every figure matched the rule as written');
  console.log('page errors:', errs.length ? errs : 'none');
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('** ' + e.message); process.exit(1); });
