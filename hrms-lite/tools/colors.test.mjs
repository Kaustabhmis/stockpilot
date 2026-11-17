/* HR picks the colour each kind of day is shown in.
 *
 *   node colors.test.mjs [base-url]
 *
 * Runs the office page in demo mode and the phone app on made-up data; it
 * writes nothing to the workspace.
 */
import { createRequire } from 'node:module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium, devices } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:8105';

/* THE RULES
   - Nothing chosen: every colour is the one the app was built with.
   - A colour picked for a status in Settings is the colour of that status on
     the register - and only that status; the rest keep theirs.
   - The letter stays readable: dark on a light colour, white on a dark one.
   - "Back to the default colours" clears every choice.
   - The staff app's calendar uses the same choices. */

let bad = 0;
const ok = (pass, label, why) => { if (!pass) bad++;
  console.log('   ' + (pass ? 'ok  ' : '**  ') + String(label).padEnd(52) + (why || '')); };

const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(BASE + '/index.html'); await p.waitForTimeout(700);
await p.evaluate(() => { localStorage.clear(); el('btn-demo').onclick(); }); await p.waitForTimeout(1500);
const r = await p.evaluate(async () => {
  const wait = ms => new Promise(z => setTimeout(z, ms));
  const probe = cls => { const d = document.createElement('div'); d.className = cls; document.body.appendChild(d);
    const c = getComputedStyle(d), o = c.backgroundColor + ' / ' + c.color; d.remove(); return o; };
  const o = {};
  delete S.settings.status_colors; renderAll();
  o.def = { P: probe('s-P'), H: probe('s-H'), L: probe('s-L') };
  openSettings();
  const pane = [...document.querySelectorAll('#modal [id^="stab-"]')].find(x => /Colours on the register/.test(x.textContent));
  settingsTab(pane.id.replace('stab-', ''));
  o.pickers = document.querySelectorAll('#modal [data-color]').length;
  const set = (k, v) => { const n = document.querySelector('#modal [data-color="' + k + '"]'); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); };
  set('H', '#ff8800'); set('L', '#1e3a8a');
  o.hidden = el('status-colors-val').value;
  saveSettingsForm(); await wait(700);
  o.saved = S.settings.status_colors;
  o.now = { P: probe('s-P'), H: probe('s-H'), L: probe('s-L') };
  go('attendance'); await wait(300);
  const cell = document.querySelector('#att-grid .att-cell.s-H');
  o.cellH = cell ? getComputedStyle(cell).backgroundColor : 'no holiday cell';
  openSettings(); settingsTab(pane.id.replace('stab-', ''));
  o.reopened = document.querySelector('#modal [data-color="H"]').value;
  statusColorsReset(); o.hidden2 = el('status-colors-val').value;
  saveSettingsForm(); await wait(700);
  o.back = { P: probe('s-P'), H: probe('s-H'), L: probe('s-L') };
  return o;
});
console.log('\nthe office register');
ok(r.pickers === 10, 'a colour picker for each of the ten kinds of day', 'pickers ' + r.pickers);
const kept = JSON.parse(r.saved || '{}');
ok(Object.keys(kept).sort().join() === 'H,L' && kept.H === '#ff8800' && kept.L === '#1e3a8a' && r.saved === r.hidden, 'only what was changed is saved', r.saved);
ok(/rgb\(255, 136, 0\)/.test(r.now.H) && /rgb\(30, 58, 138\) \/ rgb\(255, 255, 255\)/.test(r.now.L), 'Holiday is orange; Leave is navy with white letters', r.now.H + ' | ' + r.now.L);
ok(r.now.P === r.def.P, 'Present, not touched, keeps its colour', r.now.P);
ok(r.cellH === 'no holiday cell' || /rgb\(255, 136, 0\)/.test(r.cellH), 'a holiday cell on the register is drawn in it', r.cellH);
ok(r.reopened === '#ff8800', 'Settings shows the chosen colour when reopened', r.reopened);
ok(r.hidden2 === '{}' && JSON.stringify(r.back) === JSON.stringify(r.def), '"Back to the default colours" restores every one', r.back.H);
ok(!errs.length, 'no page errors', errs.join(' | '));

console.log('\nthe staff app');
const ctx = await b.newContext({ ...devices['Pixel 5'] }); const q = await ctx.newPage(); const e2 = []; q.on('pageerror', e => e2.push(e.message));
await q.goto(BASE + '/app/index.html'); await q.waitForTimeout(600);
const m = await q.evaluate(() => {
  document.getElementById('login').style.display = 'none'; document.getElementById('app').style.display = 'block';
  S.user = { email: 'x', emp_code: 'CL-01', token: 't' }; S.me = { emp_code: 'CL-01', name: 'Colour Test', doj: '2024-01-01' };
  S.shifts = []; S.reqTypes = []; S.types = []; S.leave = []; S.reqs = []; S.holidays = []; S.notices = [];
  S.inbox = { isManager: false, team: [], teamLeave: [], teamRequests: [] };
  const ym = thisMonth(); S.att = [{ emp_code: 'CL-01', date: ym + '-02', status: 'P', in_time: '09:00', out_time: '18:00', hours: 9 },
    { emp_code: 'CL-01', date: ym + '-03', status: 'L' }];
  const look = () => { paintHeader(); go('cal');
    const g = c => { const n = document.querySelector('#v-cal .cal .d.' + c); return n ? getComputedStyle(n).backgroundColor : '-'; };
    return g('P') + ' | ' + g('L') + ' | ' + [...document.querySelectorAll('#v-cal .legend i')].map(i => i.style.background).join(';'); };
  S.settings = { weekly_off: 'Sun' }; const before = look();
  S.settings = { weekly_off: 'Sun', status_colors: '{"L":"#1e3a8a"}' }; const after = look();
  return { before, after };
});
ok(/rgb\(209, 250, 229\) \| rgb\(219, 234, 254\)/.test(m.before), 'nothing chosen: the calendar keeps its own colours', m.before.slice(0, 50));
ok(/rgb\(209, 250, 229\) \| rgb\(30, 58, 138\)/.test(m.after) && /rgb\(30, 58, 138\)/.test(m.after.split('|')[2]),
   'Leave picked navy: the calendar day and its legend follow', m.after.slice(0, 50));
ok(!e2.length, 'no page errors', e2.join(' | '));
await b.close();
console.log(bad ? '\n' + bad + ' check(s) FAILED' : '\nall colour checks passed');
process.exit(bad ? 1 : 0);
