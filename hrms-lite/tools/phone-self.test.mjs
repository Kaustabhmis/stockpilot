/* The phone, for the employee: comp-off (CO+) and the payslip.
 *
 *   node phone-self.test.mjs [base-url]
 *
 * Loads the phone app and hands it a made-up person; nothing is written to
 * the workspace (the one save the form makes is caught, not sent).
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium, devices } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:8105';
const OUT = process.argv[3] || '/tmp';

/* THE RULES
   - A weekly off OR a holiday that was worked - out duty, or 5 hours or more
     - shows CO+ and is one comp-off. Fewer hours leaves the day what it was.
   - The phone lists each comp-off with what became of it, and lets the
     employee use an unused one: set against one of their own absent days, or
     paid. What it sends is the same request the office makes: the worked day,
     mode adjust/payout, and the absent day.
   - A comp-off already asked for is not offered again; an absent day already
     claimed is not offered again.
   - Payslip: pick the month and the year (finalised months only), preview
     it, download it as a PDF whose figures are the payslip's. */

let bad = 0;
const ok = (pass, label, why) => { if (!pass) bad++;
  console.log('   ' + (pass ? 'ok  ' : '**  ') + String(label).padEnd(54) + (why || '')); };

const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 5'] });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(BASE + '/app/index.html'); await p.waitForTimeout(600);

const r = await p.evaluate(async () => {
  const sent = [];
  window.api = (action, payload) => { sent.push({ action, payload }); return Promise.resolve({ id: 'x1' }); };
  window.reload = () => Promise.resolve(true);
  document.getElementById('login').style.display = 'none';
  S.user = { email: 'ps-01', role: 'employee', emp_code: 'PS-01', token: 't' };
  S.me = { emp_code: 'PS-01', name: 'Phone Self', doj: '2024-01-01', designation: 'Fitter', department: 'Works', shift: '', pan: 'ABCDE1234F' };
  S.settings = { company_name: 'Test Works Pvt Ltd', weekly_off: 'Sun', currency: 'INR' };
  S.shifts = [{ name: 'General', start_time: '09:00', end_time: '18:00', grace_minutes: 15 }];
  S.reqTypes = [{ code: 'OD', name: 'Out duty', effect: 'present', active: 'yes' }, { code: 'CO', name: 'Compensatory off', effect: 'comp_off', active: 'yes' }];
  S.types = []; S.leave = []; S.reqs = []; S.notices = []; S.sites = [];
  S.inbox = { isManager: false, team: [], teamLeave: [], teamRequests: [] };
  const iso = dt => dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
  const back = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
  const sun = new Date(); do { sun.setDate(sun.getDate() - 1); } while (sun.getDay() !== 0);
  const sun2 = new Date(sun); sun2.setDate(sun2.getDate() - 7);
  /* two working days before that Sunday: one a holiday that was worked, one absent, one a short holiday */
  const wd = []; for (let n = 1; wd.length < 4; n++) { const d = new Date(sun); d.setDate(d.getDate() - n); if (d.getDay() !== 0) wd.push(iso(d)); }
  const [holWorked, absent, holShort, absent2] = wd, S1 = iso(sun), S2 = iso(sun2);
  S.holidays = [{ date: holWorked, name: 'Festival' }, { date: holShort, name: 'Founders day' }];
  const day = (date, status, i, o, h) => ({ id: 'PS-01_' + date, emp_code: 'PS-01', date, status, in_time: i, out_time: o, hours: h });
  S.att = [day(S1, 'P', '09:00', '18:00', 9), day(S2, 'A', '09:00', '12:00', 3), day(holWorked, 'OD', '', '', 0),
           day(absent, 'A', '', '', 0), day(holShort, 'A', '10:00', '12:00', 2), day(absent2, 'A', '', '', 0)];
  S.haveMonth = {};
  const o = { S1, holWorked, absent, absent2 };
  o.st = [S1, S2, holWorked, holShort, absent].map(statusFor).join(',');
  o.list0 = myCoPlus().map(x => x.iso + ':' + x.state).sort().join(',');
  go('req');
  o.card = el('v-req').innerText.replace(/\s+/g, ' ');
  o.useButtons = [...document.querySelectorAll('#v-req .acts .yes')].length;
  openRequest('co', holWorked);
  o.kind = el('rq-kind').value; o.from = el('rq-from').value;
  o.modes = [...el('rq-mode').options].map(x => x.value).join(',');
  o.absentOpts = [...el('rq-adjust').options].map(x => x.value).sort().join(',');
  el('rq-adjust').value = absent; submitRequest(); await new Promise(z => setTimeout(z, 200));
  o.sent = sent[0];
  /* it is now on file, waiting */
  S.reqs = [Object.assign({ id: 'x1' }, sent[0].payload.row, { emp_code: 'PS-01' })];
  o.list1 = myCoPlus().map(x => x.iso + ':' + x.state).sort().join(',');
  openRequest('co', S1);
  o.from2 = [...el('rq-from').options].map(x => x.value).join(',');
  o.absentLeft = [...el('rq-adjust').options].map(x => x.value).join(',');
  el('rq-mode').value = 'payout'; coModeChanged();
  o.boxHidden = el('rq-adjust-box').style.display === 'none';
  submitRequest(); await new Promise(z => setTimeout(z, 200));
  o.sent2 = sent[1]; closeSheet();
  o.offDays = [S1, S2, holWorked, holShort];

  /* payslips */
  const slip = (month, net, status) => ({ month, status, emp_code: 'PS-01', total_days: 30, paid_days: 28, lop_days: 2, basic: 20000, hra: 8000,
    special_allowance: 2000, other_allowance: 0, ot_amount: 1500, arrears: 0, bonus: 0, incentive: 1000, gross: 32500,
    pf: 1800, esi: 0, pt: 200, tds: 0, advance_deduction: 500, other_deduction: 0, total_deduction: 2500, net });
  S.slips = [slip('2025-12', 29000, 'Finalised'), slip('2026-09', 30000, 'Finalised'), slip('2026-10', 30000.4, 'Finalised'), slip('2026-11', 1, 'Draft')];
  go('me');
  o.months = [...el('slip-m').options].filter(x => !x.disabled).map(x => x.value).join(',');
  o.years = [...el('slip-y').options].map(x => x.value).join(',');
  o.picked = S.slipPick;
  el('slip-m').value = '09'; slipPicked(); o.picked2 = S.slipPick;
  el('slip-y').value = '2025'; slipPicked(true); o.picked3 = S.slipPick;
  showSlip('2026-10'); o.preview = document.querySelector('.sheet').innerText.replace(/\s+/g, ' '); closeSheet();
  o.pdf = slipPdf(slipFor('2026-10'));
  return o;
});

console.log('\nCO+ on the phone');
ok(r.st === 'CO+,WO,CO+,H,A', 'Sunday 9 h, Sunday 3 h, holiday OD, holiday 2 h, absent', r.st);
ok(r.list0 === [r.S1 + ':open', r.holWorked + ':open'].sort().join(','), 'two comp-offs earned, both unused', r.list0);
ok(/Comp-off earned/.test(r.card) && r.useButtons === 2, 'the Requests screen lists them with a Use button', 'buttons ' + r.useButtons);
ok(r.kind === 'co' && r.from === r.holWorked && r.modes === 'adjust,payout', 'the form opens on that day: set against absent, or paid', r.modes);
const offered = r.absentOpts.split(',');
ok(offered.includes(r.absent) && offered.includes(r.absent2) && !r.offDays.some(d => offered.includes(d)),
   'absent days are offered - never a Sunday or a holiday', offered.length + ' days');
const s1 = ((r.sent || {}).payload || {}).row || {};
ok(r.sent && r.sent.action === 'save' && r.sent.payload.sheet === 'Requests' && s1.type === 'CO' && s1.date === r.holWorked && s1.mode === 'adjust' &&
   s1.adjust_date === r.absent && Number(s1.days) === 1 && s1.status === 'Pending', 'sends the office\'s own comp-off request', JSON.stringify(s1).slice(0, 120));
ok(r.list1 === [r.S1 + ':open', r.holWorked + ':pending'].sort().join(','), 'then it shows as waiting for approval', r.list1);
ok(r.from2 === r.S1 && !String(r.absentLeft).split(',').includes(r.absent) && String(r.absentLeft).split(',').includes(r.absent2), 'a used comp-off and a claimed absent day are not offered again',
   r.from2 + ' / ' + String(r.absentLeft).slice(0, 40));
const s2 = ((r.sent2 || {}).payload || {}).row || {};
ok(r.boxHidden && s2.mode === 'payout' && s2.date === r.S1 && !s2.adjust_date, '"Get it paid" sends a payout, no absent day', JSON.stringify(s2).slice(0, 100));

console.log('\npayslip');
ok(r.months === '09,10' && r.years === '2026,2025' && r.picked === '2026-10', 'month and year pickers: finalised months only, newest first',
   r.months + ' | ' + r.years + ' | ' + r.picked);
ok(r.picked2 === '2026-09' && r.picked3 === '2025-12', 'choosing a month, then a year', r.picked2 + ' -> ' + r.picked3);
ok(/Oct 2026/.test(r.preview) && /Net paid/.test(r.preview) && /30,000/.test(r.preview) && /Download PDF/.test(r.preview), 'preview shows the payslip, with Download', r.preview.slice(0, 60));
const file = OUT + '/payslip-test.pdf';
fs.writeFileSync(file, Buffer.from(r.pdf, 'latin1'));
let text = '', pages = '';
try {
  text = execFileSync('pdftotext', ['-layout', file, '-']).toString();
  pages = String((execFileSync('pdfinfo', [file]).toString().match(/Pages:\s+(\d+)/) || [])[1]);
} catch (e) { text = 'ERR ' + String(e.stderr || e.message).slice(0, 200); }
ok(pages === '1' && !/^ERR/.test(text), 'the download is a valid one-page PDF', 'pages ' + pages + ' ' + (/^ERR/.test(text) ? text.slice(0, 80) : ''));
ok(/Test Works Pvt Ltd/.test(text) && /Payslip for Oct 2026/.test(text) && /Phone Self/.test(text) && /PS-01/.test(text), 'company, month and employee on it');
ok(/Basic\s+Rs\. 20,000\s+PF\s+Rs\. 1,800/.test(text) && /Gross earnings\s+Rs\. 32,500\s+Total deductions\s+Rs\. 2,500/.test(text) &&
   /Net pay\s+Rs\. 30,000/.test(text), 'the figures are the payslip\'s', text.replace(/\n/g, ' ').slice(120, 330));
ok(!errs.length, 'no page errors', errs.join(' | '));
await b.close();
console.log(bad ? '\n' + bad + ' check(s) FAILED' : '\nall phone checks passed');
process.exit(bad ? 1 : 0);
