/* Overtime per employee: a Yes/No switch and an OT rate of their own.
 *
 *   node overtime.test.mjs [base-url]
 *
 * Writes employees OT-01..OT-05 and their May 2026 attendance. TEST only.
 */
import { createRequire } from 'node:module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:8105';
const YM = '2026-05';                 /* 31 days */

/* THE RULES
   Overtime hours are the minutes worked past the shift end beyond the
   shift's OT threshold. Every case below works the General shift
   (09:30-18:30, full day 8 h, OT after 30 min) and leaves at 20:30 on five
   days: 2 h a day, 10 h in the month.
     Overtime = Yes, own rate 100/h            -> 10 x 100            = 1,000
     Overtime = Yes, no rate of their own      -> company rate: gross / (31 days x 8 h)
                                                  x multiplier 1.5; gross 24,800 -> 150/h = 1,500
     Overtime = No                              -> 0 (the 10 h still shown)
     Overtime blank, company "Pay overtime" no  -> 0
     ...and company "Pay overtime" yes          -> company rate      = 1,500
     A wage worker, Overtime = Yes, no own rate -> day pay (800 + DA 100 + HRA 100) / 8 h
                                                  x 1.5 = 187.5/h    = 1,875, and it is in the gross
   Overtime is added to gross pay. */

const call = async (action, payload, token) => {
  const r = await fetch(BASE + '/exec', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, token }) });
  const j = await r.json();
  if (!j.ok) throw new Error(action + ': ' + j.error);
  return j.data;
};
let bad = 0;
const ok = (pass, label, why) => { if (!pass) bad++;
  console.log('   ' + (pass ? 'ok  ' : '**  ') + String(label).padEnd(48) + (why || '')); };
const eq = (got, want, label, why) => ok(Math.abs(Number(got) - Number(want)) < 0.6, label,
  (Math.abs(Number(got) - Number(want)) < 0.6 ? '' : 'got ' + got + ', wanted ' + want + ' - ') + (why || ''));

const token = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;
const shifts = await call('list', { sheet: 'Shifts' }, token);
const general = shifts.find(s => String(s.name).trim().toLowerCase() === 'general');
await call('save', { sheet: 'Shifts', row: Object.assign({}, general, { start_time: '09:30', end_time: '18:30',
  full_day_hours: 8, half_day_hours: 4, ot_after_minutes: 30, weekly_off: 'Sun', saturday_policy: 'working' }) }, token);
await call('saveSettings', { settings: { ot_pay_enabled: 'no', ot_rate_multiplier: '1.5', ot_max_hours_month: '60',
  payroll_basis: 'calendar', payroll_rounding: '1' } }, token);

const CASES = [
  ['OT-01', 'yes', '100', 'Salary'], ['OT-02', 'yes', '', 'Salary'], ['OT-03', 'no', '', 'Salary'],
  ['OT-04', '', '', 'Salary'], ['OT-05', 'yes', '', 'Wages']];
for (const [code, on, rate, kind] of CASES) {
  await call('save', { sheet: 'Employees', row: { emp_code: code, name: 'Overtime ' + code, status: 'Active',
    doj: '2025-01-01', shift: 'General', department: 'QA', designation: 'Tester', wage_type: kind,
    basic: kind === 'Salary' ? 24800 : 0, hra: 0, special_allowance: 0, other_allowance: 0,
    daily_rate: kind === 'Wages' ? 800 : 0, da_rate: kind === 'Wages' ? 100 : 0, hra_rate: kind === 'Wages' ? 100 : 0,
    pf_applicable: 'no', esi_applicable: 'no', ot_enabled: on, ot_rate: rate } }, token);
  const rows = [];
  for (let d = 4; d <= 8; d++) {
    const iso = YM + '-0' + d;
    rows.push({ id: code + '_' + iso, date: iso, emp_code: code, status: 'P', in_time: '09:30', out_time: '20:30',
      hours: 11, remarks: 'overtime test' });
  }
  await call('saveMany', { sheet: 'Attendance', rows }, token);
}

const b = await chromium.launch(); const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(BASE + '/index.html');
await p.evaluate(u => localStorage.setItem('hrms_lite_api', u), BASE + '/exec');
await p.reload(); await p.waitForTimeout(700);
await p.fill('#in-email', 'admin@company.com'); await p.fill('#in-pass', 'admin123');
await p.click('#btn-login'); await p.waitForTimeout(4500);
const pay = () => p.evaluate(async ym => {
  await new Promise(res => { if (!needMonths([ym], res)) res(); });
  const out = {};
  ['OT-01', 'OT-02', 'OT-03', 'OT-04'].forEach(c => { const r = computePay(empByCode(c), ym); out[c] = r; });
  out['OT-05'] = computeWage(empByCode('OT-05'), ym);
  return out;
}, YM);

console.log('\nper-employee overtime');
let r = await pay();
eq(r['OT-01'].ot_hours, 10, 'overtime hours counted', '2 h a day past 18:30 + 30 min, five days');
eq(r['OT-01'].ot_amount, 1000, 'Yes, own rate 100/h');
eq(r['OT-02'].ot_amount, 1500, 'Yes, company rate', '24,800 / (31 x 8) x 1.5 = 150/h');
eq(r['OT-03'].ot_amount, 0, 'No - never paid');
eq(r['OT-03'].ot_hours, 10, '...though the hours are still shown');
eq(r['OT-04'].ot_amount, 0, 'blank, company says no');
eq(r['OT-05'].ot_amount, 1875, 'wage worker, company rate', '(800+100+100)/8 x 1.5 = 187.5/h');
eq(r['OT-05'].gross - (800 + 100 + 100) * r['OT-05'].paid_days, 1875, 'and it is in the wage gross');
eq(r['OT-01'].gross - r['OT-02'].gross, 1000 - 1500, 'overtime is in the salary gross');

console.log('\ncompany switches overtime on');
await call('saveSettings', { settings: { ot_pay_enabled: 'yes' } }, token);
await p.evaluate(() => reload()); await p.waitForTimeout(2500);
r = await pay();
eq(r['OT-04'].ot_amount, 1500, 'blank now follows the company: paid');
eq(r['OT-03'].ot_amount, 0, 'No still means no');
eq(r['OT-01'].ot_amount, 1000, 'own rate still wins');

console.log('\nbulk action');
await p.evaluate(() => { go('employees'); el('emp-search').value = 'OT-0'; renderEmployees && renderEmployees(); });
await p.waitForTimeout(500);
await p.evaluate(() => openBulk()); await p.waitForTimeout(400);
await p.selectOption('#bulk-ot', 'yes'); await p.fill('#bulk-ot-rate', '120');
await p.evaluate(() => bulkOvertime()); await p.waitForTimeout(1500);
const emps = (await call('list', { sheet: 'Employees' }, token)).filter(e => /^OT-0/.test(e.emp_code));
ok(emps.length === 5 && emps.every(e => e.ot_enabled === 'yes' && Number(e.ot_rate) === 120),
   'all five set to Yes, 120/h', emps.map(e => e.emp_code + ':' + e.ot_enabled + '/' + e.ot_rate).join(' '));
ok(!errs.length, 'no page errors', errs.join(' | '));
await call('saveSettings', { settings: { ot_pay_enabled: 'no' } }, token);
await b.close();
console.log(bad ? '\n' + bad + ' check(s) FAILED' : '\nall overtime checks passed');
process.exit(bad ? 1 : 0);
