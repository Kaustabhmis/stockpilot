/* PF, ESI and P.Tax worked out on Basic or on Gross, as Settings says.
 *
 *   node statutory-base.test.mjs [base-url]
 *
 * Writes employees SB-01 (salary) and SB-02 (wages) and their March 2027
 * attendance. TEST workspace only.
 */
import { createRequire } from 'node:module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:8105';
const YM = '2027-03';                 /* 31 days, every one present */

/* THE RULES - SB-01: basic 10,000 + HRA 5,000 + special 5,000 = gross 20,000,
   present all month. PF 12% / 13%, PF ceiling 15,000, ESI 0.75% / 3.25%, ESI
   ceiling 21,000.
     defaults (PF on basic, ESI on gross, ceiling on gross, P.Tax on gross)
       PF 12% of 10,000 = 1,200 (employer 1,300); ESI 0.75% of 20,000 = 150;
       P.Tax = the slab read on 20,000
     PF on gross            -> 12% of min(20,000, 15,000) = 1,800
     ...and PF ceiling 0    -> no cap: 12% of 20,000 = 2,400
     ESI on basic           -> 0.75% of 10,000 = 75
     P.Tax on basic         -> the slab read on 10,000
   With special 7,000 the gross is 22,000, over the ESI ceiling:
     ceiling checked on gross -> no ESI
     ceiling checked on basic -> 10,000 is within it: ESI 0.75% of 22,000 = 165
   SB-02 (wages): basic 500 + DA 100 + HRA 100 a day, 31 days -> basic+DA
   18,600, gross 21,700.
     PF on basic (basic + DA) -> 12% of min(18,600, 15,000) = 1,800
     PF ceiling 0             -> 12% of 18,600 = 2,232
     PF on gross, no cap      -> 12% of 21,700 = 2,604                  */

const call = async (action, payload, token) => {
  const r = await fetch(BASE + '/exec', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, token }) });
  const j = await r.json();
  if (!j.ok) throw new Error(action + ': ' + j.error);
  return j.data;
};
let bad = 0;
const eq = (got, want, label, why) => { const pass = Math.abs(Number(got) - Number(want)) < 0.6; if (!pass) bad++;
  console.log('   ' + (pass ? 'ok  ' : '**  ') + String(label).padEnd(46) +
    (pass ? '' : 'got ' + got + ', wanted ' + want + ' - ') + (why || '')); };

const token = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;
await call('save', { sheet: 'Employees', row: { emp_code: 'SB-01', name: 'Statutory Salary', status: 'Active',
  doj: '2025-01-01', wage_type: 'Salary', basic: 10000, hra: 5000, special_allowance: 5000, other_allowance: 0,
  pf_applicable: 'yes', esi_applicable: 'yes', tds_monthly: 0, ot_enabled: 'no', department: 'QA', designation: 'Tester' } }, token);
await call('save', { sheet: 'Employees', row: { emp_code: 'SB-02', name: 'Statutory Wages', status: 'Active',
  doj: '2025-01-01', wage_type: 'Wages', basic: 0, daily_rate: 500, da_rate: 100, hra_rate: 100,
  pf_applicable: 'yes', esi_applicable: 'no', ot_enabled: 'no', department: 'QA', designation: 'Tester' } }, token);
const rows = [];
for (const code of ['SB-01', 'SB-02']) {
  for (let d = 1; d <= 31; d++) {
    const iso = YM + '-' + String(d).padStart(2, '0');
    rows.push({ id: code + '_' + iso, date: iso, emp_code: code, status: 'P', in_time: '', out_time: '', hours: 0 });
  }
}
await call('saveMany', { sheet: 'Attendance', rows }, token);

const b = await chromium.launch(); const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(BASE + '/index.html');
await p.evaluate(u => localStorage.setItem('hrms_lite_api', u), BASE + '/exec');
await p.reload(); await p.waitForTimeout(700);
await p.fill('#in-email', 'admin@company.com'); await p.fill('#in-pass', 'admin123');
await p.click('#btn-login'); await p.waitForTimeout(4500);

/* settings are applied in the page and the payroll worked out there */
const run = (settings, change) => p.evaluate(async ([ym, settings, change]) => {
  await new Promise(res => { if (!needMonths([ym], res)) res(); });
  const keep = Object.assign({}, S.settings);
  Object.assign(S.settings, { payroll_basis: 'calendar', payroll_rounding: '1', pf_employee_pct: '12',
    pf_employer_pct: '13', pf_wage_ceiling: '15000', esi_employee_pct: '0.75', esi_employer_pct: '3.25',
    esi_wage_ceiling: '21000', late_mark_slab: '', late_marks_per_halfday: '0',
    pf_base: '', esi_base: '', esi_ceiling_base: '', pt_base: '' }, settings);
  const e1 = Object.assign({}, empByCode('SB-01'), change || {});
  const r1 = computePay(e1, ym), r2 = computeWage(empByCode('SB-02'), ym);
  const slab = g => num(computeCtc({ gross: g, month: ctcMonth(ym) }, {}).values.ptax);
  S.settings = keep;
  return { r1, r2, slab10: slab(10000), slab20: slab(20000) };
}, [YM, settings, change]);

console.log('\ndefaults - unchanged from before');
let r = await run({});
eq(r.r1.gross, 20000, 'gross', 'present all month, nothing lost');
eq(r.r1.pf, 1200, 'PF on basic', '12% of 10,000');
eq(r.r1.pf_employer, 1300, 'PF employer on basic');
eq(r.r1.esi, 150, 'ESI on gross', '0.75% of 20,000');
eq(r.r1.pt, r.slab20, 'P.Tax read on gross', 'slab on 20,000 = ' + r.slab20);
eq(r.r2.pf, 1800, 'wages: PF on basic + DA, capped', '12% of min(18,600, 15,000)');

console.log('\nswitched');
r = await run({ pf_base: 'gross' });
eq(r.r1.pf, 1800, 'PF on gross, capped at 15,000');
eq(r.r2.pf, 1800, 'wages: PF on gross 21,700, capped');
r = await run({ pf_base: 'gross', pf_wage_ceiling: '0' });
eq(r.r1.pf, 2400, 'PF on gross, ceiling 0 = no cap');
eq(r.r2.pf, 2604, 'wages: PF on gross, no cap');
r = await run({ pf_wage_ceiling: '0' });
eq(r.r2.pf, 2232, 'wages: PF on basic + DA, no cap');
r = await run({ esi_base: 'basic' });
eq(r.r1.esi, 75, 'ESI on basic', '0.75% of 10,000');
eq(r.r1.esi_employer, 325, 'ESI employer on basic', '3.25% of 10,000');
r = await run({ pt_base: 'basic' });
eq(r.r1.pt, r.slab10, 'P.Tax read on basic', 'slab on 10,000 = ' + r.slab10);

console.log('\nthe ESI ceiling');
r = await run({}, { special_allowance: 7000 });
eq(r.r1.esi, 0, 'gross 22,000 over the ceiling: no ESI');
r = await run({ esi_ceiling_base: 'basic' }, { special_allowance: 7000 });
eq(r.r1.esi, 165, 'ceiling on basic: 10,000 within it', '0.75% of 22,000');

eq(errs.length, 0, 'no page errors', errs.join(' | '));
await b.close();
console.log(bad ? '\n' + bad + ' check(s) FAILED' : '\nall statutory-base checks passed');
process.exit(bad ? 1 : 0);
