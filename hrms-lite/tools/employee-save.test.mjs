/* Adding an employee from the form, the way HR fills it in.
 *
 *   node employee-save.test.mjs [base-url]
 *
 * Writes employees ES-01..ES-03. TEST workspace only.
 */
import { createRequire } from 'node:module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:8105';

/* THE RULES
   - A number box left empty (other allowance, TDS, daily rates...) saves as
     that field's default - 0 for money - instead of failing with
     "invalid input syntax for type numeric".
   - "18,000" with a comma is 18000.
   - Text in a number field is refused with a message naming the field, and
     nothing is written.
   - The same holds for saves straight through the API (imports, bulk edits). */

const call = async (action, payload, token) => {
  const r = await fetch(BASE + '/exec', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, token }) });
  return r.json();
};
let bad = 0;
const ok = (pass, label, why) => { if (!pass) bad++;
  console.log('   ' + (pass ? 'ok  ' : '**  ') + String(label).padEnd(46) + (why || '')); };

const token = (await call('login', { email: 'admin@company.com', password: 'admin123' })).data.token;
for (const c of ['ES-01', 'ES-02', 'ES-03']) await call('remove', { sheet: 'Employees', id: c }, token);

console.log('\nthrough the API');
const a = await call('save', { sheet: 'Employees', row: { emp_code: 'ES-01', name: 'Blank Numbers', status: 'Active',
  doj: '2026-11-01', basic: '18,000', hra: '', special_allowance: '', other_allowance: '', tds_monthly: '',
  daily_rate: '', da_rate: '', hra_rate: '' } }, token);
ok(a.ok, 'blank number fields save', a.error || '');
ok(a.ok && Number(a.data.basic) === 18000, '"18,000" is 18000', a.ok ? String(a.data.basic) : '');
ok(a.ok && Number(a.data.tds_monthly) === 0 && Number(a.data.other_allowance) === 0, 'blanks are 0');
const b = await call('save', { sheet: 'Employees', row: { emp_code: 'ES-02', name: 'Bad Basic', basic: 'twenty' } }, token);
ok(!b.ok && /basic must be a number/i.test(b.error || ''), 'text in a number field is refused', b.error || 'saved!');
const list = (await call('list', { sheet: 'Employees' }, token)).data || [];
ok(!list.some(e => e.emp_code === 'ES-02'), 'and nothing was written');

console.log('\nthrough the Add employee form');
const br = await chromium.launch(); const p = await br.newPage({ viewport: { width: 1400, height: 950 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(BASE + '/index.html');
await p.evaluate(u => localStorage.setItem('hrms_lite_api', u), BASE + '/exec');
await p.reload(); await p.waitForTimeout(700);
await p.fill('#in-email', 'admin@company.com'); await p.fill('#in-pass', 'admin123');
await p.click('#btn-login'); await p.waitForTimeout(4500);
await p.evaluate(() => { go('employees'); openEmployee(); });
await p.waitForTimeout(600);
const fill = async (f, v) => p.evaluate(([f, v]) => { const n = document.querySelector('#modal [data-f="' + f + '"]'); if (n) n.value = v; return !!n; }, [f, v]);
await fill('emp_code', 'ES-03'); await fill('name', 'Form Blanks'); await fill('doj', '2026-10-01');
await fill('basic', '15000'); await fill('department', 'QA'); await fill('designation', 'Tester');
await p.evaluate(() => { const b = [...document.querySelectorAll('#modal button')].find(x => /save employee/i.test(x.textContent)); b && b.click(); });
await p.waitForTimeout(2500);
console.log('   form says:', (await p.evaluate(() => (document.getElementById('emp-errors') || {}).innerText || '')).replace(/\s+/g, ' ').slice(0, 300));
const toasts = await p.$$eval('.toast', t => t.map(x => x.textContent).join(' / '));
ok(!/invalid input syntax/i.test(toasts), 'no "invalid input syntax"', toasts);
const after = (await call('list', { sheet: 'Employees' }, token)).data || [];
const es3 = after.find(e => e.emp_code === 'ES-03');
ok(!!es3, 'ES-03 saved from the form', es3 ? 'basic ' + es3.basic + ', tds ' + es3.tds_monthly : toasts);
ok(!errs.length, 'no page errors', errs.join(' | '));
await br.close();

console.log(bad ? '\n' + bad + ' check(s) FAILED' : '\nall employee-save checks passed');
process.exit(bad ? 1 : 0);
