/* Every screen, office and phone, opened once: no page may throw.
 *
 *   node sweep.test.mjs [base-url]
 *
 * Reads only, apart from the logins HM-01 (written by hod-mobile). */
import { createRequire } from 'node:module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:8105';
const call = async (action, payload, token) => {
  const r = await fetch(BASE + '/exec', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, token }) });
  const j = await r.json(); if (!j.ok) throw new Error(action + ': ' + j.error); return j.data;
};
const admin = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;
await call('save', { sheet: 'Employees', row: { emp_code: 'SW-01', name: 'Sweep Head', status: 'Active', doj: '2025-01-01',
  basic: 30000, department: 'SW', designation: 'Tester', manager: '', shift: 'General' } }, admin);
await call('save', { sheet: 'Employees', row: { emp_code: 'SW-02', name: 'Sweep Team', status: 'Active', doj: '2025-01-01',
  basic: 30000, department: 'SW', designation: 'Tester', manager: 'SW-01', shift: '' } }, admin);
await call('saveUser', { user: { email: 'sw-01', emp_code: 'SW-01', role: 'employee', password: 'sweep-test-1', active: 'yes' } }, admin);
const tok = (await call('login', { email: 'sw-01', password: 'sweep-test-1' })).token;

const b = await chromium.launch();
const errs = [];
const watch = (pg, where) => {
  pg.on('pageerror', e => errs.push(where + ': ' + e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(where + ' console: ' + m.text()); });
};
const p = await b.newPage({ viewport: { width: 1400, height: 900 } }); watch(p, 'office');
await p.goto(BASE + '/index.html');
await p.evaluate(u => localStorage.setItem('hrms_lite_api', u), BASE + '/exec');
await p.reload(); await p.waitForTimeout(700);
await p.fill('#in-email', 'admin@company.com'); await p.fill('#in-pass', 'admin123');
await p.click('#btn-login'); await p.waitForTimeout(4500);
const seen = await p.evaluate(async () => {
  const wait = ms => new Promise(z => setTimeout(z, ms)); const done = [];
  for (const v of ['dashboard', 'employees', 'attendance', 'leave', 'payroll', 'reports']) { go(v); await wait(400); done.push(v); }
  go('leave');
  for (const t of ['list', 'requests', 'calendar', 'balance']) { leaveTab(t); await wait(300); done.push('leave/' + t); }
  startBalanceEdit(); await wait(200); cancelBalanceEdit(); done.push('leave/balance-edit');
  go('payroll');
  for (const t of ['salary', 'wages', 'arrears', 'bonus', 'increment', 'gratuity']) { payTab(t); await wait(500); done.push('payroll/' + t); }
  openSettings(); await wait(500);
  const tabs = [...document.querySelectorAll('#modal .tab')].map(n => n.dataset.stab).filter(Boolean);
  for (const t of tabs) { settingsTab(t); await wait(300); done.push('settings/' + t); }
  closeModal();
  if (S.employees[0]) { openEmployee(S.employees[0].emp_code); await wait(300); closeModal(); done.push('employee card'); }
  return done;
});
console.log('office screens opened: ' + seen.length);

const q = await b.newPage({ viewport: { width: 390, height: 800 } }); watch(q, 'phone');
await q.goto(BASE + '/app/index.html');
await q.evaluate(u => localStorage.setItem('hrms_lite_api', u), BASE + '/exec');
await q.reload(); await q.waitForTimeout(600);
const ph = await q.evaluate(async ({ token, base }) => {
  const wait = ms => new Promise(z => setTimeout(z, ms)); const done = [];
  API = base; S.user = { email: 'sw-01', role: 'employee', emp_code: 'SW-01', token };
  document.getElementById('login').style.display = 'none'; document.getElementById('app').style.display = '';
  await reload();
  for (const v of ['punch', 'cal', 'req', 'me', 'team']) { go(v); await wait(400); done.push(v); }
  if (typeof teamTab === 'function') for (const t of ['ok', 'att', 'lv']) { teamTab(t); await wait(800); done.push('team/' + t); }
  return done;
}, { token: tok, base: BASE + '/exec' });
console.log('phone screens opened: ' + ph.length);
await b.close();
for (const c of ['SW-02', 'SW-01']) await call('remove', { sheet: 'Employees', id: c }, admin).catch(() => {});
if (errs.length) { console.log('\nERRORS:\n  ' + [...new Set(errs)].join('\n  ')); process.exit(1); }
console.log('\nno errors on any screen'); process.exit(0);
