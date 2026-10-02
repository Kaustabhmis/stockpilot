/* A bonus run finalised BEFORE the Bonus tab existed is still sitting in
   Payroll under 'FY2026-27'. Nothing may move it silently - a row that
   relocates itself is a row nobody can account for - so the tab offers it
   and the person presses the button. This checks that path end to end, and
   that the old rows are actually gone afterwards rather than duplicated. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js'; const { chromium } = pkg;
const BASE = process.argv[2] || 'http://127.0.0.1:8101';
const call = async (action, payload, token) => {
  const r = await fetch(BASE + '/exec', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, token }) });
  const j = await r.json();
  if (!j.ok) throw new Error(action + ': ' + j.error);
  return j.data;
};
let bad = 0;
const ok = (pass, label, why) => { if (!pass) bad++;
  console.log('   ' + (pass ? 'ok  ' : '**  ') + label.padEnd(44) + (why || '')); };

const token = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;
const FY = '2026-27', KEY = 'FY' + FY;

/* clear both sides, then plant a legacy row the old way */
for (const sheet of ['Bonus']) {
  const rows = await call('list', { sheet }, token);
  if (rows.length) await call('removeMany', { sheet, ids: rows.map(r => r.id) }, token);
}
const emp = (await call('list', { sheet: 'Employees' }, token))
  .filter(e => String(e.status || 'Active') === 'Active')[0];
if (!emp) { console.log('no employees to test with'); process.exit(1); }

await call('save', { sheet: 'Payroll', row: {
  id: KEY + '_' + emp.emp_code, month: KEY, emp_code: emp.emp_code,
  total_days: 12, paid_days: 250, bonus: 6997, gross: 6997, net: 6997,
  status: 'Finalised', generated_at: '2026-09-30', generated_by: 'admin@company.com' } }, token);

const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await p.evaluate(u => localStorage.setItem('hrms_lite_api', u + '/exec'), BASE);
await p.reload({ waitUntil: 'networkidle' });
await p.fill('#in-email', 'admin@company.com');
await p.fill('#in-pass', 'admin123');
await p.click('#btn-login');
await p.waitForTimeout(6000);
await p.evaluate(() => go('payroll'));
await p.evaluate(() => payTab('bonus'));
await p.evaluate(f => { el('bonus-fy').value = f; renderBonus(); }, FY);
await p.waitForTimeout(900);

const banner = await p.evaluate(() => el('bonus-state').innerText.replace(/\s+/g, ' '));
ok(/still filed in the Payroll tab/.test(banner), 'the stray rows are noticed and named', banner.slice(0, 70));
ok(/Move them to the Bonus tab/.test(banner), 'and offered, not moved behind your back');

await p.evaluate(f => moveLegacyBonus(f), FY);
await p.waitForTimeout(4000);

const bonusNow = await call('list', { sheet: 'Bonus' }, token);
const strayNow = (await call('list', { sheet: 'Payroll' }, token))
  .filter(r => String(r.month).indexOf('FY') === 0);
ok(bonusNow.length === 1, 'one row now in the Bonus tab', bonusNow.length + ' rows');
ok(bonusNow[0] && Number(bonusNow[0].amount) === 6997, 'carrying the same amount',
   bonusNow[0] ? String(bonusNow[0].amount) : '-');
ok(bonusNow[0] && String(bonusNow[0].fy) === FY, 'under the right year',
   bonusNow[0] ? String(bonusNow[0].fy) : '-');
ok(bonusNow[0] && /moved from the Payroll tab/.test(String(bonusNow[0].note || '')),
   'and saying where it came from', bonusNow[0] ? String(bonusNow[0].note) : '-');
ok(strayNow.length === 0, 'and gone from Payroll - moved, not copied', strayNow.length + ' left');
if (errs.length) { bad += errs.length; console.log('   script errors:', errs.slice(0, 3)); }
console.log(bad ? '\n** ' + bad + ' did not hold' : '\nthe carry-over held');
await b.close();
process.exit(bad ? 1 : 0);
