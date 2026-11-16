/* CO+ : a weekly off that was worked earns a compensatory off.
 *
 *   node coplus.test.mjs [base-url]
 *
 * Runs the page in demo mode; it writes nothing to the workspace.
 */
import { createRequire } from 'node:module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:8105';

/* THE RULES
   - On a weekly off (Sunday here): out duty, or 5 hours or more of work,
     shows CO+ - one comp-off earned. 5 is "co_min_hours" in Settings.
   - Fewer hours than that is still the weekly off (WO): no credit, and never
     an absence or LOP, whatever the shift rules made of the hours.
   - A CO+ day is paid as the weekly off it is. Working days are untouched.
   - Each CO+ is then used once: PAID (one day's pay in the month it is
     decided, inside incentive) or SET AGAINST AN ABSENT DAY (that day becomes
     a paid comp-off, CO).
   - Re-working a payroll row must not pay the comp-off a second time. */

let bad = 0;
const ok = (pass, label, why) => { if (!pass) bad++;
  console.log('   ' + (pass ? 'ok  ' : '**  ') + String(label).padEnd(52) + (why || '')); };

const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(BASE + '/index.html'); await p.waitForTimeout(700);
await p.evaluate(() => { localStorage.clear(); el('btn-demo').onclick(); }); await p.waitForTimeout(1500);

const r = await p.evaluate(async () => {
  const iso = dt => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  const sun = new Date(); do { sun.setDate(sun.getDate() - 1); } while (sun.getDay() !== 0);
  const fri = new Date(sun); fri.setDate(fri.getDate() - 2);
  const S0 = iso(sun), F0 = iso(fri), ym = S0.slice(0, 7), d = +S0.slice(8);
  const mk = (code, name) => ({ emp_code: code, name, status: 'Active', doj: '2020-01-01', basic: 30000, hra: 0,
    special_allowance: 0, other_allowance: 0, shift: '', department: 'CP', designation: 'Tester',
    pf_applicable: 'no', esi_applicable: 'no' });
  S.employees = ['Full Sunday', 'Four Hours', 'Out Duty', 'Five Hours', 'Stayed Home'].map((n, i) => mk('CP-0' + (i + 1), n));
  S.shifts = [{ id: 'g', name: 'General', start_time: '09:00', end_time: '18:00', grace_minutes: 15, full_day_hours: 8,
    half_day_hours: 4, weekly_off: 'Sun', saturday_policy: 'working', ot_after_minutes: 30, active: 'yes' }];
  S.settings.default_shift = 'General'; S.settings.weekly_off = 'Sun'; S.settings.co_min_hours = '';
  S.settings.co_payout_enabled = 'yes'; S.settings.payroll_basis = 'calendar';
  S.holidays = []; S.leave = []; S.requests = []; S.payroll = [];
  const day = (code, date, status, i, o, h) => ({ id: code + '_' + date, emp_code: code, date, status, in_time: i, out_time: o, hours: h });
  S.attendance = [
    day('CP-01', S0, 'P', '09:00', '18:00', 9), day('CP-02', S0, 'A', '09:00', '13:00', 4),
    day('CP-03', S0, 'OD', '', '', 0), day('CP-04', S0, 'HD', '09:00', '14:00', 5),
    day('CP-01', F0, 'P', '09:00', '18:00', 9), day('CP-03', F0, 'A', '', '', 0)];
  S.attVersion++;
  const st = c => statusOf(ym, c, d);
  const out = { S0, F0, st: ['CP-01', 'CP-02', 'CP-03', 'CP-04', 'CP-05'].map(st).join(','),
    fri: statusOf(F0.slice(0, 7), 'CP-01', +F0.slice(8)) };
  const s1 = attStats(ym, 'CP-01'), s2 = attStats(ym, 'CP-02'), s5 = attStats(ym, 'CP-05');
  out.cop1 = s1.COP; out.lop2 = s2.lop; out.lop5 = s5.lop; out.wo1 = s1.WO; out.wo5 = s5.WO;
  go('attendance'); el('att-month').value = ym; onAttMonth(); setAttView('status');
  const c = document.getElementById('c_CP-01_' + S0);
  out.cell = c ? c.textContent + '/' + c.className : '-';
  const states = () => coPlusList().map(x => x.e.emp_code + ':' + x.state).sort().join(',');
  out.list0 = states();

  /* pay CP-01, set CP-03's against the Friday it was absent */
  await coPlusSave('CP-01', S0, 'payout');
  out.absent3 = coAbsentDays('CP-03').includes(F0);
  await coPlusSave('CP-03', S0, 'adjust', F0);
  out.list1 = states();
  out.friNow = statusOf(F0.slice(0, 7), 'CP-03', +F0.slice(8));
  const tm = thisMonth(), e1 = empByCode('CP-01');
  const pay = computePay(e1, tm, null), again = computePay(e1, tm, pay), plain = computePay(empByCode('CP-05'), tm, null);
  out.pay = { days: pay.co_payout_days, inc: pay.incentive, incAgain: again.incentive,
              perDay: Math.round(30000 / daysInMonth(tm)), plainInc: plain.incentive };
  go('leave'); renderRequests();
  out.table = [...document.querySelectorAll('#coplus-table tbody tr')].map(t => t.innerText.replace(/\s+/g, ' '));

  S.settings.co_min_hours = '6'; S.attVersion++;
  out.six = st('CP-04') + ',' + st('CP-01');
  S.settings.co_min_hours = '';
  return out;
});

console.log('\nthe weekly off, ' + r.S0);
ok(r.st === 'CO+,WO,CO+,CO+,WO', '9 h, 4 h, OD, 5 h, nothing', r.st);
ok(r.fri === 'P', 'a working day is untouched', r.fri);
ok(r.cop1 === 1 && r.wo1 === r.wo5, 'CO+ counted, and still a paid weekly off', 'CO+ ' + r.cop1 + ', WO ' + r.wo1 + '/' + r.wo5);
ok(r.lop2 === r.lop5, '4 hours on the weekly off is not LOP', 'lop ' + r.lop2 + ' vs ' + r.lop5);
ok(/^CO\+\//.test(r.cell) && /s-COP/.test(r.cell), 'register shows CO+', r.cell);
ok(r.list0 === 'CP-01:open,CP-03:open,CP-04:open', 'three comp-offs waiting', r.list0);

console.log('\nusing it');
ok(r.list1 === 'CP-01:paid,CP-03:adjusted,CP-04:open', 'one paid, one set against an absence', r.list1);
ok(r.absent3 && r.friNow === 'CO', 'the absent day became a paid comp-off', r.F0 + ' -> ' + r.friNow);
ok(r.pay.days === 1 && Math.abs(r.pay.inc - r.pay.perDay) <= 1, 'payout is one day\'s pay', JSON.stringify(r.pay));
ok(r.pay.incAgain === r.pay.inc, 're-working the row does not pay it twice', r.pay.inc + ' -> ' + r.pay.incAgain);
ok(r.pay.plainInc === 0, 'nobody else is paid anything');
ok(r.table.length === 3 && r.table.some(t => /Full Sunday.*paid/i.test(t)) && r.table.some(t => /Five Hours.*not used yet.*Pay/i.test(t)),
   'the CO+ list shows all three', r.table.map(t => t.slice(0, 60)).join(' | '));

console.log('\nthe hours are a setting');
ok(r.six === 'WO,CO+', 'at 6 hours, 5 h is no longer enough', r.six);
ok(!errs.length, 'no page errors', errs.join(' | '));
await b.close();
console.log(bad ? '\n' + bad + ' check(s) FAILED' : '\nall CO+ checks passed');
process.exit(bad ? 1 : 0);
