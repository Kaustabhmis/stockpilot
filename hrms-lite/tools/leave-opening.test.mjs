/* Opening leave balances, brought in from the sheet kept before this system.
 *
 *   node leave-opening.test.mjs [base-url]
 *
 * Writes employees LO-01..LO-03, their logins, leave and opening balances.
 * TEST workspace only.
 */
import { createRequire } from 'node:module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:8105';

/* THE RULES
   - An opening balance is what was LEFT of one leave type, for one person, in
     one year, as on a date. Leave applied up to that date is already inside it;
     leave applied after it comes off it.
   - With no opening balance, the balance is the quota less the year's
     approved leave, exactly as before.
   - Leave beyond the opening balance is unpaid (with "excess leave unpaid").
   - HR pastes the sheet: code first, balances last; the last three numbers
     are matched to the leave types chosen. A code the HRMS does not know is
     skipped and said so; a name that differs is pointed out.
   - The employee's phone shows the same balance HR sees. */

const call = async (action, payload, token) => {
  const r = await fetch(BASE + '/exec', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, token }) });
  const j = await r.json(); if (!j.ok) throw new Error(action + ': ' + j.error); return j.data;
};
let bad = 0;
const ok = (pass, label, why) => { if (!pass) bad++;
  console.log('   ' + (pass ? 'ok  ' : '**  ') + String(label).padEnd(56) + (why || '')); };

const admin = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;
for (const sheet of ['Leave', 'LeaveOpening']) {
  const old = (await call('list', { sheet }, admin)).filter(r => /^LO-0/.test(String(r.emp_code))).map(r => r.id);
  if (old.length) await call('removeMany', { sheet, ids: old }, admin);
}
for (const [code, name] of [['LO-01', 'Opening One'], ['LO-02', 'No Opening'], ['LO-03', 'Opening Three']]) {
  await call('save', { sheet: 'Employees', row: { emp_code: code, name, status: 'Active', doj: '2024-01-01', basic: 30000,
    department: 'LO', designation: 'Tester', shift: '' } }, admin);
}
await call('saveUser', { user: { email: 'lo-01', emp_code: 'LO-01', role: 'employee', password: 'lo-test-1', active: 'yes' } }, admin);
const lv = (code, type, from, to, days, applied) => ({ emp_code: code, type, from_date: from, to_date: to, days, status: 'Approved',
  applied_at: applied, reason: 'test', level: 2 });
await call('saveMany', { sheet: 'Leave', rows: [
  lv('LO-01', 'Earned', '2026-10-28', '2026-10-28', 1, '2026-10-31'),      /* inside the opening */
  lv('LO-01', 'Earned', '2026-11-24', '2026-11-25', 2, '2026-11-20'),      /* after it */
  lv('LO-02', 'Earned', '2026-10-28', '2026-10-28', 1, '2026-10-31'),
  lv('LO-03', 'Sick', '2026-11-26', '2026-11-27', 2, '2026-11-20')] }, admin);

const was = (await call('list', { sheet: 'Settings' }, admin).catch(() => [])).find(r => r.key === 'excess_leave_unpaid');
await call('saveSettings', { settings: { excess_leave_unpaid: 'yes' } }, admin);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(BASE + '/index.html');
await p.evaluate(u => localStorage.setItem('hrms_lite_api', u), BASE + '/exec');
await p.reload(); await p.waitForTimeout(700);
await p.fill('#in-email', 'admin@company.com'); await p.fill('#in-pass', 'admin123');
await p.click('#btn-login'); await p.waitForTimeout(4500);
const ui = await p.evaluate(async () => {
  const wait = ms => new Promise(z => setTimeout(z, ms));
  go('leave'); leaveTab('balance'); el('leave-year').value = '2026'; renderLeave();
  const o = { btn: el('op-open') && el('op-open').style.display !== 'none' };
  openOpeningBalances();
  el('op-ason').value = '2026-11-18';
  el('op-t1').value = 'Earned'; el('op-t2').value = 'Casual'; el('op-t3').value = 'Sick';
  el('op-rows').value = ['Employee Code\tEmployee Name\tApplied PL\tApplied CL\tApplied SL\tBalance PL\tBalance CL\tBalance SL',
    'LO-01\tOpening One\t3.00\t3.00\t4.00\t13.00\t2.00\t1.00',
    'LO-03\tSomebody Else\t0\t0\t4\t16\t5\t1',
    'XX-99\tNobody\t0\t0\t0\t16\t5\t5'].join('\n');
  previewOpening();
  o.preview = el('op-preview').innerText.replace(/\s+/g, ' ');
  saveOpening(); await wait(1500);
  o.saved = (S.leaveOpening || []).filter(x => /^LO-0/.test(x.emp_code)).map(x => x.emp_code + ':' + x.type + '=' + Number(x.balance)).sort().join(',');
  const left = (c, t) => quotaFor(t) - takenDays(c, t, '2026');
  o.left = { e1: left('LO-01', 'Earned'), c1: left('LO-01', 'Casual'), s1: left('LO-01', 'Sick'),
             e2: left('LO-02', 'Earned'), s3: left('LO-03', 'Sick') };
  const um = unpaidLeaveMap();
  o.unpaid = Object.keys(um).filter(k => /^LO-0/.test(k)).sort().join(',');
  o.sub = el('leave-balance-sub').innerText;
  o.table = [...document.querySelectorAll('#leave-balance tbody tr')].map(t => t.innerText.replace(/\s+/g, ' ')).filter(t => /Opening One|No Opening/.test(t));
  return o;
});
console.log('\nsetting them from the sheet');
ok(ui.btn, 'the admin sees "Set opening balances"');
ok(/2 people will get balances for 2026 as on 2026-11-18/.test(ui.preview) && /1 skipped/.test(ui.preview), 'preview: 2 people, 1 unknown code skipped', ui.preview.slice(0, 90));
ok(/the HRMS has this code as Opening Three/.test(ui.preview), 'a name that differs is pointed out');
ok(ui.saved === 'LO-01:Casual=2,LO-01:Earned=13,LO-01:Sick=1,LO-03:Casual=5,LO-03:Earned=16,LO-03:Sick=1', 'the balances (last three numbers) are saved', ui.saved);

console.log('\nthe balance');
ok(ui.left.e1 === 11, 'Earned 13 as on 18 Nov, less 2 days applied since = 11', 'got ' + ui.left.e1);
ok(ui.left.c1 === 2 && ui.left.s1 === 1, 'Casual 2 and Sick 1 as brought in', ui.left.c1 + ' / ' + ui.left.s1);
ok(ui.left.e2 === 14, 'no opening: quota 15 less 1 day, as before', 'got ' + ui.left.e2);
ok(ui.left.s3 === -1 && /LO-03_2026-11-27/.test(ui.unpaid) && !/LO-03_2026-11-26/.test(ui.unpaid) && !/LO-01/.test(ui.unpaid),
   'Sick 1 left, 2 taken: the second day is unpaid', ui.unpaid);
ok(/as on 2026-11-18/.test(ui.sub), 'the balance screen says what the balances are as on', ui.sub.slice(0, 70));
ok(ui.table.some(t => /Opening One/.test(t) && /11 left/.test(t)), 'the balance table shows it', ui.table.join(' | ').slice(0, 120));

console.log('\nthe phone');
const tok = (await call('login', { email: 'lo-01', password: 'lo-test-1' })).token;
const boot = await call('bootstrap', {}, tok);
ok((boot.leaveOpening || []).length === 3 && boot.leaveOpening.every(o => o.emp_code === 'LO-01'), 'the employee is sent their own openings only',
   (boot.leaveOpening || []).map(o => o.emp_code).join(','));
const q = await b.newPage();
await q.goto(BASE + '/app/index.html'); await q.waitForTimeout(500);
const phone = await q.evaluate(d => {
  S.leave = d.leave; S.types = d.leaveTypes; S.opening = d.leaveOpening;
  return ['Earned', 'Casual', 'Sick'].map(t => leaveLeft(t)).join(',');
}, boot);
ok(phone === '11,2,1', 'the phone shows 11 / 2 / 1, as HR sees', phone);
ok(!errs.length, 'no page errors', errs.join(' | '));
await b.close();
for (const sheet of ['Leave', 'LeaveOpening']) {
  const old = (await call('list', { sheet }, admin)).filter(r => /^LO-0/.test(String(r.emp_code))).map(r => r.id);
  if (old.length) await call('removeMany', { sheet, ids: old }, admin);
}
await call('saveSettings', { settings: { excess_leave_unpaid: was ? was.value : 'no' } }, admin);
console.log(bad ? '\n' + bad + ' check(s) FAILED' : '\nall opening-balance checks passed');
process.exit(bad ? 1 : 0);
