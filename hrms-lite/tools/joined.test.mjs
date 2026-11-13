/* "Joined": one punch today is not absent, and no punch is.
 *
 *   node joined.test.mjs [base-url]
 *
 * Runs the page in demo mode with a handful of people on today's date; it
 * writes nothing to the workspace.
 */
import { createRequire } from 'node:module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:8105';

/* THE RULES
   - One punch TODAY and no second: "IN" - joined, still at work. Not
     present, not absent, and not LOP while the day is running. The
     dashboard counts them on a card of their own, "Joined".
   - The out punch settles the day: P / HD / A by the shift rules.
   - One punch on a day that is OVER stays A, as before.
   - No punch and no leave on a working day: absent. Today it is on the
     "Absent" card; on a past day the register shows a faint A, and it is
     LOP as it always was.
   - The phone calendar follows the same rules. */

let bad = 0;
const ok = (pass, label, why) => { if (!pass) bad++;
  console.log('   ' + (pass ? 'ok  ' : '**  ') + String(label).padEnd(50) + (why || '')); };

const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(BASE + '/index.html'); await p.waitForTimeout(700);
await p.evaluate(() => { localStorage.clear(); el('btn-demo').onclick(); }); await p.waitForTimeout(1500);

const r = await p.evaluate(() => {
  const t = localDay(), ym = t.slice(0, 7), d = +t.slice(8);
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yIso = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
  const mk = (code, name) => ({ emp_code: code, name, status: 'Active', doj: '2020-01-01', basic: 10000, shift: '',
    department: 'JT', designation: 'Tester' });
  S.employees = [mk('JT-01', 'Joined Only'), mk('JT-02', 'Full Day'), mk('JT-03', 'No Punch'), mk('JT-04', 'Yesterday One Punch')];
  S.shifts = [{ id: 'g', name: 'General', start_time: '09:00', end_time: '18:00', grace_minutes: 15, full_day_hours: 8,
    half_day_hours: 4, weekly_off: 'None', saturday_policy: 'working', ot_after_minutes: 30, active: 'yes' }];
  S.settings.default_shift = 'General';
  S.holidays = []; S.leave = []; S.requests = [];
  S.attendance = [
    { id: 'JT-01_' + t, emp_code: 'JT-01', date: t, status: 'A', in_time: '09:05', out_time: '', hours: 0 },
    { id: 'JT-02_' + t, emp_code: 'JT-02', date: t, status: 'P', in_time: '09:00', out_time: '18:00', hours: 9 },
    { id: 'JT-04_' + yIso, emp_code: 'JT-04', date: yIso, status: 'A', in_time: '09:10', out_time: '', hours: 0 }];
  S.attVersion++;
  const kinds = ['present', 'joined', 'absent'].reduce((o, k) => (o[k] = peopleOn(k, t).map(x => x.e.emp_code).sort().join(','), o), {});
  go('dashboard'); renderAll();
  const cards = [...document.querySelectorAll('#view-dashboard .kpi')].map(k => k.innerText.replace(/\s+/g, ' '));
  go('attendance'); el('att-month').value = ym; onAttMonth(); setAttView('status');
  const cell = (code, iso) => { const c = document.getElementById('c_' + code + '_' + iso); return c ? c.textContent + (c.classList.contains('nomark') ? '(faint)' : '') : '-'; };
  const yd = +yIso.slice(8), yYm = yIso.slice(0, 7);
  return {
    kinds, cards,
    st1: statusOf(ym, 'JT-01', d), st4y: statusOf(yYm, 'JT-04', yd),
    reg1: cell('JT-01', t), reg2: cell('JT-02', t), reg3y: yYm === ym ? cell('JT-03', yIso) : 'A(faint)',
    lop1: attStats(ym, 'JT-01').lop, in1: attStats(ym, 'JT-01').IN,
    lop3: attStats(ym, 'JT-03').lop, d
  };
});

console.log('\ntoday');
ok(r.st1 === 'IN', 'one punch today is IN (joined)', 'got ' + r.st1);
ok(r.kinds.joined === 'JT-01', 'Joined card counts them', r.kinds.joined);
ok(r.kinds.present === 'JT-02', 'Present is the settled day only', r.kinds.present);
ok(r.kinds.absent.split(',').includes('JT-03') && !r.kinds.absent.includes('JT-01'), 'Absent: no punch, not the joined', r.kinds.absent);
ok(r.cards.some(c => /JOINED/i.test(c) && /\b1\b/.test(c)), 'dashboard shows a Joined card', r.cards.find(c => /JOINED/i.test(c)));
ok(!r.cards.some(c => /NOT MARKED/i.test(c)), 'no separate "Not marked" card - it is absent');
ok(r.reg1 === 'IN' && r.reg2 === 'P', 'register: IN and P', r.reg1 + ' / ' + r.reg2);
ok(r.in1 === 1, 'today\'s IN is not LOP while the day runs', 'lop ' + r.lop1);

console.log('\na day that is over');
ok(r.st4y === 'A', 'one punch yesterday stays A', 'got ' + r.st4y);
ok(r.reg3y === 'A(faint)', 'no punch yesterday shows a faint A', r.reg3y);
ok(r.d === 1 || r.lop3 >= 1, 'and it is LOP as before', 'lop ' + r.lop3);
console.log('\nthe Joined card shows the times');
const card = await p.evaluate(() => {
  const t = localDay();
  const more = [['JT-11', 'Amit Roy', '08:52'], ['JT-12', 'Bina Sen', '09:31'], ['JT-13', 'Chandan Das', '10:15']];
  more.forEach(([c, n, at]) => {
    S.employees.push({ emp_code: c, name: n, status: 'Active', doj: '2020-01-01', basic: 10000, shift: '', department: 'JT', designation: 'T' });
    S.attendance.push({ id: c + '_' + t, emp_code: c, date: t, status: 'A', in_time: at, out_time: '', hours: 0 });
  });
  S.attVersion++;
  go('dashboard'); renderAll();
  const k = [...document.querySelectorAll('#view-dashboard .kpi')].map(x => x.innerText.replace(/\s+/g, ' ')).find(x => /JOINED/i.test(x));
  showPeople('joined');
  const rows = [...document.querySelectorAll('#modal tbody tr')].map(r => r.innerText.replace(/\s+/g, ' '));
  closeModal();
  return { k, rows };
});
ok(/4/.test(card.k) && /08:52/.test(card.k) && /10:15/.test(card.k), 'card: 4 joined, from 08:52 to 10:15', card.k);
ok(card.rows.length === 4 && /08:52/.test(card.rows[0]) && /10:15/.test(card.rows[3]), 'list: each join time, earliest first',
   card.rows.map(r => r.slice(0, 40)).join(' | '));
ok(card.rows.some(r => /09:31.*late/.test(r)), 'a late join is marked late', card.rows.find(r => /09:31/.test(r)));
ok(!errs.length, 'no page errors', errs.join(' | '));
await b.close();
console.log(bad ? '\n' + bad + ' check(s) FAILED' : '\nall joined checks passed');
process.exit(bad ? 1 : 0);
