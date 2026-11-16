/* The HOD on the phone: approving, and seeing the team's attendance and leave.
 *
 *   node hod-mobile.test.mjs [base-url]
 *
 * Writes employees HM-01..HM-04, their logins, leave, requests and a few
 * November 2026 days. TEST workspace only. The chain is the live one:
 * step 1 the reporting manager, step 2 HR.
 */
import { createRequire } from 'node:module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium, devices } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:8105';

/* THE RULES
   - An employee's own application always starts Pending at step 1 - whatever
     the request claims - and nobody approves their own.
   - The reporting manager (HOD) signs step 1 for their own people, from the
     phone. Nobody else's people; and not step 2, which is HR's.
   - The phone is told which applications are waiting on the person holding
     it, and shows Approve / Reject on exactly those.
   - HR signs step 2; only then is the register touched: leave -> L, out
     duty -> OD, a comp-off set against an absent day -> CO on that day.
   - One worked day off earns one comp-off: a second request for it is refused.
   - A manager sees their people's month of attendance and their leave -
     and nothing about their pay. Someone with no team sees nobody's. */

const raw = async (action, payload, token) => {
  const r = await fetch(BASE + '/exec', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, token }) });
  return r.json();
};
const call = async (action, payload, token) => {
  const j = await raw(action, payload, token);
  if (!j.ok) throw new Error(action + ': ' + j.error);
  return j.data;
};
let bad = 0;
const ok = (pass, label, why) => { if (!pass) bad++;
  console.log('   ' + (pass ? 'ok  ' : '**  ') + String(label).padEnd(54) + (why || '')); };

const admin = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;
const PASS = 'hod-test-1';
const people = [['HM-01', 'Head Manager', ''], ['HM-02', 'Team One', 'HM-01'], ['HM-03', 'Team Two', 'Head Manager'], ['HM-04', 'Other Dept', '']];
const tok = {};
/* a clean slate */
for (const sheet of ['Leave', 'Requests', 'Attendance']) {
  const old = (await call('list', { sheet }, admin)).filter(r => /^HM-0/.test(String(r.emp_code))).map(r => r.id);
  if (old.length) await call('removeMany', { sheet, ids: old }, admin);
}
for (const [code, name, mgr] of people) {
  await call('save', { sheet: 'Employees', row: { emp_code: code, name, status: 'Active', doj: '2025-01-01', basic: 30000,
    department: 'HM', designation: 'Tester', manager: mgr, shift: '' } }, admin);
  await call('saveUser', { user: { email: code.toLowerCase(), emp_code: code, role: 'employee', password: PASS, active: 'yes' } }, admin);
  tok[code] = (await call('login', { email: code.toLowerCase(), password: PASS })).token;
}
/* HM-02: worked Sunday 8 Nov (9 h), absent Friday 6 Nov */
await call('saveMany', { sheet: 'Attendance', rows: [
  { id: 'HM-02_2026-11-08', emp_code: 'HM-02', date: '2026-11-08', status: 'P', in_time: '09:00', out_time: '18:00', hours: 9 },
  { id: 'HM-02_2026-11-06', emp_code: 'HM-02', date: '2026-11-06', status: 'A', in_time: '', out_time: '', hours: 0 },
  { id: 'HM-03_2026-11-06', emp_code: 'HM-03', date: '2026-11-06', status: 'P', in_time: '09:00', out_time: '18:00', hours: 9 },
  { id: 'HM-04_2026-11-06', emp_code: 'HM-04', date: '2026-11-06', status: 'P', in_time: '09:00', out_time: '18:00', hours: 9 }] }, admin);

console.log('\napplying');
const lv = await call('save', { sheet: 'Leave', row: { emp_code: 'HM-04', type: 'Casual', from_date: '2026-11-18', to_date: '2026-11-18',
  days: 1, reason: 'test', status: 'Approved', level: 5, applied_at: '2026-11-16' } }, tok['HM-02']);
let boot = await call('bootstrap', {}, tok['HM-02']);
const mine = boot.leave.find(l => l.id === lv.id) || {};
ok(mine.emp_code === 'HM-02' && mine.status === 'Pending' && Number(mine.level) === 0,
   'filed under their own name, Pending, at step 1', mine.emp_code + ' ' + mine.status + ' level ' + mine.level);
ok(mine._steps === 2 && mine._step === 1 && mine._mine === false, 'the applicant sees step 1 of 2, not theirs to sign',
   'step ' + mine._step + '/' + mine._steps);
let r = await raw('decide', { sheet: 'Leave', id: lv.id, status: 'Approved' }, tok['HM-02']);
ok(!r.ok && /own application/.test(r.error), 'cannot approve their own', r.error);
r = await raw('decide', { sheet: 'Leave', id: lv.id, status: 'Approved' }, tok['HM-04']);
ok(!r.ok && /not waiting on you/.test(r.error), 'someone else\'s colleague cannot approve it', r.error);

console.log('\nthe HOD\'s phone');
boot = await call('bootstrap', {}, tok['HM-01']);
const ib = boot.inbox;
ok(ib.isManager && ib.team.map(t => t.emp_code).sort().join(',') === 'HM-02,HM-03', 'team: by code and by name',
   ib.team.map(t => t.emp_code).join(','));
ok(ib.team.every(t => t.basic === undefined && t.bank_account === undefined), 'no pay or bank details of the team');
const wl = ib.teamLeave.find(l => l.id === lv.id) || {};
ok(wl._mine === true && wl._step === 1 && wl._steps === 2, 'the leave is waiting on the HOD', 'mine ' + wl._mine);
const d1 = await call('decide', { sheet: 'Leave', id: lv.id, status: 'Approved' }, tok['HM-01']);
ok(d1.done === false && d1.cleared === 1 && d1.total === 2, 'HOD clears step 1 of 2', JSON.stringify(d1).slice(0, 90));
r = await raw('decide', { sheet: 'Leave', id: lv.id, status: 'Approved' }, tok['HM-01']);
ok(!r.ok && /not waiting on you/.test(r.error), 'step 2 is HR\'s - the HOD cannot sign it too', r.error);
let att = (await call('monthAtt', { month: '2026-11' }, admin)).rows;
ok(!att.find(a => a.emp_code === 'HM-02' && String(a.date).slice(0, 10) === '2026-11-18'), 'register untouched until the last step');
const d2 = await call('decide', { sheet: 'Leave', id: lv.id, status: 'Approved' }, admin);
att = (await call('monthAtt', { month: '2026-11' }, admin)).rows;
ok(d2.done && (att.find(a => a.emp_code === 'HM-02' && String(a.date).slice(0, 10) === '2026-11-18') || {}).status === 'L',
   'HR signs step 2: the day is L');

console.log('\nout duty and comp-off');
const od = await call('save', { sheet: 'Requests', row: { type: 'OD', date: '2026-11-19', to_date: '2026-11-19', days: 1,
  reason: 'site visit', status: 'Pending', applied_at: '2026-11-16' } }, tok['HM-03']);
const co = await call('save', { sheet: 'Requests', row: { type: 'CO', date: '2026-11-08', to_date: '2026-11-08', days: 1,
  mode: 'adjust', adjust_date: '2026-11-06', reason: 'worked Sunday', status: 'Pending', applied_at: '2026-11-16' } }, tok['HM-02']);
r = await raw('save', { sheet: 'Requests', row: { type: 'CO', date: '2026-11-08', to_date: '2026-11-08', days: 1,
  mode: 'payout', reason: 'again', status: 'Pending', applied_at: '2026-11-16' } }, tok['HM-02']);
ok(!r.ok && /already been asked/.test(r.error), 'the same worked day cannot earn two comp-offs', r.error);
boot = await call('bootstrap', {}, tok['HM-01']);
ok(boot.inbox.teamRequests.filter(q => q._mine).map(q => q.type).sort().join(',') === 'CO,OD', 'both are waiting on the HOD',
   boot.inbox.teamRequests.filter(q => q._mine).map(q => q.type).join(','));
for (const id of [od.id, co.id]) { await call('decide', { sheet: 'Requests', id, status: 'Approved' }, tok['HM-01']);
  await call('decide', { sheet: 'Requests', id, status: 'Approved' }, admin); }
att = (await call('monthAtt', { month: '2026-11' }, admin)).rows;
const day = (c, d) => (att.find(a => a.emp_code === c && String(a.date).slice(0, 10) === d) || {}).status;
ok(day('HM-03', '2026-11-19') === 'OD', 'out duty approved: OD on the register', day('HM-03', '2026-11-19'));
ok(day('HM-02', '2026-11-06') === 'CO', 'comp-off approved: the absent day is a paid CO', day('HM-02', '2026-11-06'));

console.log('\nthe team\'s register');
const tm = await call('teamMonth', { month: '2026-11' }, tok['HM-01']);
const codes = [...new Set(tm.rows.map(a => a.emp_code))].sort().join(',');
ok(codes === 'HM-02,HM-03', 'the HOD gets their own people\'s month only', codes);
ok((await call('teamMonth', { month: '2026-11' }, tok['HM-02'])).rows.length === 0, 'someone with no team gets nobody\'s');

console.log('\non the phone itself');
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 5'] });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
const lv2 = await call('save', { sheet: 'Leave', row: { type: 'Casual', from_date: '2026-11-25', to_date: '2026-11-25', days: 1,
  reason: 'phone test', status: 'Pending', applied_at: '2026-11-16' } }, tok['HM-03']);
await p.goto(BASE + '/app/index.html');
await p.evaluate(u => localStorage.setItem('hrms_lite_api', u), BASE + '/exec');
await p.reload(); await p.waitForTimeout(600);
const ui = await p.evaluate(async ({ token, id, base }) => {
  API = base; S.user = { email: 'hm-01', role: 'employee', emp_code: 'HM-01', token };
  document.getElementById('login').style.display = 'none';
  await reload(); go('team');
  const o = { nav: el('nav-team').style.display !== 'none', dot: el('team-dot').textContent };
  o.approve = [...document.querySelectorAll('#v-team .acts .yes')].length;
  o.text = el('v-team').innerText.replace(/\s+/g, ' ').slice(0, 200);
  teamTab('att'); await new Promise(r => setTimeout(r, 1500));
  S.teamYm = '2026-11'; renderTeam();
  o.att = el('v-team').innerText.replace(/\s+/g, ' ');
  teamMember('HM-02'); o.member = document.querySelector('.sheet') ? document.querySelector('.sheet').innerText.replace(/\s+/g, ' ').slice(0, 3000) : '';
  closeSheet(); teamTab('lv'); o.lv = el('v-team').innerText.replace(/\s+/g, ' ');
  teamTab('ok'); decide('Leave', id, 'Approved'); await new Promise(r => setTimeout(r, 2500));
  o.after = [...document.querySelectorAll('#v-team .acts .yes')].length;
  return o;
}, { token: tok['HM-01'], id: lv2.id, base: BASE + '/exec' }).catch(e => ({ err: e.message }));
ok(!ui.err, 'the team screen opens', ui.err || '');
ok(ui.nav && ui.dot === '1' && ui.approve === 1, 'Team tab shows 1 waiting, with an Approve button', 'dot ' + ui.dot + ', buttons ' + ui.approve);
ok(/Team One/.test(ui.att || '') && /Team Two/.test(ui.att || '') && !/Other Dept/.test(ui.att || ''), 'Attendance tab lists the team', (ui.att || '').slice(0, 90));
ok(/(6 Nov|Nov 6) Fri CO/.test(ui.member || '') && /(8 Nov|Nov 8) Sun.*CO\+/.test(ui.member || ''), 'a member\'s day-by-day register opens', (ui.member || '').slice(0, 80));
ok(/Team One/.test(ui.lv || '') && /Casual/.test(ui.lv || ''), 'Leave tab shows the team\'s leave', (ui.lv || '').slice(0, 100));
ok(ui.after === 0, 'approving on the phone clears it from the HOD\'s list', 'left ' + ui.after);
const after = (await call('list', { sheet: 'Leave' }, admin)).find(l => l.id === lv2.id) || {};
ok(after.status === 'Pending' && Number(after.level) === 1, '...and it is now with HR at step 2', after.status + ' level ' + after.level);
ok(!errs.length, 'no page errors', errs.join(' | '));
await b.close();

/* leave nothing waiting behind for the other audits */
for (const sheet of ['Leave', 'Requests', 'Attendance']) {
  const old = (await call('list', { sheet }, admin)).filter(x => /^HM-0/.test(String(x.emp_code))).map(x => x.id);
  if (old.length) await call('removeMany', { sheet, ids: old }, admin);
}
console.log(bad ? '\n' + bad + ' check(s) FAILED' : '\nall HOD checks passed');
process.exit(bad ? 1 : 0);
