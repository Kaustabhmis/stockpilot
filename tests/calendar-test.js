/**
 * The company's own working week, holidays and reminder times, set by its
 * Admin. Reminders and scores both follow them; a change to the week counts
 * from the day it is saved, so last month is never re-scored. Both editions.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 220) + ']')); v ? pass++ : fail++; };
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

for (const [label, file] of [['Domebox', '/../dist/code.gs'], ['Domebox Lite', '/../dist/lite/Code.gs']]) {
  console.log('\n######## ' + label + ' ########');
  const env = build();
  Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b' });
  env.G.GmailApp.__setAliases(['info@biscsindia.com', 'mis@dynamicengineers.in']);
  env.newFile('MASTER', 'Master');
  const tpl = env.newFile('TEMPLATE', 'Template');
  ['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
  tpl.getSheetByName('Settings').appendRow(['General']);
  const names = Object.keys(env.G);
  const X = new Function(...names, fs.readFileSync(__dirname + file, 'utf8') +
    '\n;return { doPost, ensureRegistry, leaveCalendar_, tenantContext_, requireSession, chargeableLateDays, readCalendar_ };')(...names.map((n) => env.G[n]));
  X.ensureRegistry();
  const call = (b) => JSON.parse(X.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
  const msg = (b) => { const r = call(b); return r.status === 'error' ? r.message : ''; };
  const A = call({ action: 'register', form: { companyName: 'Acme', name: 'Owner', email: 'o@a.in', password: 'ownerpass123' } }).token;
  call({ action: 'addUser', token: A, form: { name: 'Sruti', username: 'sruti', email: 'sruti@a.in', role: 'HOD', jobProfile: 'Ops', password: 'staffpass123' } });
  const S = call({ action: 'login', username: 'sruti@a.in', password: 'staffpass123' }).token;
  const dash = (t) => call({ action: 'getDashboard', token: t || A });
  const cal = () => X.leaveCalendar_(X.tenantContext_(X.requireSession(A)));

  console.log('\n=== out of the box, nothing changes ===');
  ok('Saturday and Sunday off, no holidays', JSON.stringify(dash().calendar) === '{"off":[0,6],"holidays":[]}', JSON.stringify(dash().calendar));
  ok('reminders at 9 am, 3 pm and 5 pm, two days before due, daily while overdue, summary at 8',
     JSON.stringify(dash().reminders) === '{"hours":[9,15,17],"daysBeforeDue":2,"overdue":true,"digestHour":8}', JSON.stringify(dash().reminders));
  ok('everybody sees them, not only the Admin', JSON.stringify(dash(S).calendar) === JSON.stringify(dash().calendar));

  console.log('\n=== only the Admin changes them ===');
  ok('a head of department cannot change the week', /Admin account/.test(msg({ action: 'saveCalendar', token: S, calendar: { off: [1] } })));
  ok('nor the reminder times', /Admin account/.test(msg({ action: 'saveReminders', token: S, reminders: { hours: [10] } })));

  console.log('\n=== a works open on Sunday, closed on Monday ===');
  const r = call({ action: 'saveCalendar', token: A, calendar: { off: [1], holidays: [{ date: '2026-11-09', name: 'Diwali' }, { date: '2026-08-15', name: 'Independence Day' }] } });
  ok('the Admin saves the week and two holidays', r.status === 'success' && JSON.stringify(r.calendar.off) === '[1]' && r.calendar.holidays.length === 2, JSON.stringify(r));
  ok('holidays are kept in date order', r.calendar.holidays.map((h) => h.date).join() === '2026-08-15,2026-11-09');
  const c = cal();
  const today = new Date(), back = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
  ok('scoring reads the new week from today', c.weekly[c.weekly.length - 1].from === ymd(today) && c.weekly[c.weekly.length - 1].off.join() === '1');
  ok('and keeps the old week for the days before it, so last month is not re-scored',
     c.weekly[0].off.join() === '0,6' && c.weekly.length === 2, JSON.stringify(c.weekly));
  ok('a holiday is not counted as a late day',
     X.chargeableLateDays(new Date(2026, 10, 8), new Date(2026, 10, 10), 'sruti', c) === 1, X.chargeableLateDays(new Date(2026, 10, 8), new Date(2026, 10, 10), 'sruti', c));
  /* A date a week ahead under the new week: find the next Sunday and Monday. */
  const ahead = (dow) => { const d = new Date(today); d.setDate(d.getDate() + 7); while (d.getDay() !== dow) d.setDate(d.getDate() + 1); return d; };
  const sun = ahead(0), mon = new Date(sun); mon.setDate(sun.getDate() + 1);
  const sat = new Date(sun); sat.setDate(sun.getDate() - 1);
  ok('from now on, a Sunday is a working day: handed in Sunday for a Saturday deadline is 1 day late',
     X.chargeableLateDays(sat, sun, 'sruti', c) === 1, X.chargeableLateDays(sat, sun, 'sruti', c));
  ok('and Monday is the day off: handed in Monday for a Sunday deadline is not late',
     X.chargeableLateDays(sun, mon, 'sruti', c) === 0, X.chargeableLateDays(sun, mon, 'sruti', c));
  const twoWeeksAgo = back(14); while (twoWeeksAgo.getDay() !== 6) twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 1);
  const thenSun = new Date(twoWeeksAgo); thenSun.setDate(twoWeeksAgo.getDate() + 1);
  ok('but a Sunday before the change was still a day off', X.chargeableLateDays(twoWeeksAgo, thenSun, 'sruti', c) === 0);
  call({ action: 'saveCalendar', token: A, calendar: { off: [2], holidays: [] } });
  ok('changed twice on the same day, only the last one stands', cal().weekly.length === 2 && cal().weekly[1].off.join() === '2', JSON.stringify(cal().weekly));

  console.log('\n=== what is refused ===');
  ok('a week with no working day', /at least one working day/.test(msg({ action: 'saveCalendar', token: A, calendar: { off: [0, 1, 2, 3, 4, 5, 6] } })));
  ok('the same holiday twice', /twice/.test(msg({ action: 'saveCalendar', token: A, calendar: { off: [0], holidays: [{ date: '2026-12-25', name: 'X' }, { date: '2026-12-25', name: 'Y' }] } })));
  ok('a holiday without a date', /Give every holiday a date/.test(msg({ action: 'saveCalendar', token: A, calendar: { off: [0], holidays: [{ date: '', name: 'X' }] } })));
  ok('more than four reminder times', /Up to 4/.test(msg({ action: 'saveReminders', token: A, reminders: { hours: [8, 10, 12, 14, 16] } })));
  ok('a time at night', /6 am to 9 pm/.test(msg({ action: 'saveReminders', token: A, reminders: { hours: [23] } })));

  console.log('\n=== reminder times ===');
  const rr = call({ action: 'saveReminders', token: A, reminders: { hours: [16, 10, 19], daysBeforeDue: 1, overdue: false, digestHour: 7 } });
  ok('the Admin moves them, and the reply says when they will go', rr.status === 'success' && /10 am, 4 pm and 7 pm/.test(rr.message), rr.message);
  ok('and everybody’s app has them', JSON.stringify(dash(S).reminders) === '{"hours":[10,16,19],"daysBeforeDue":1,"overdue":false,"digestHour":7}', JSON.stringify(dash(S).reminders));
  ok('fewer is fine — even none', call({ action: 'saveReminders', token: A, reminders: { hours: [] } }).message === 'Saved. No timed reminders will go out.');
  ok('the Admin can put the defaults back', call({ action: 'saveReminders', token: A, reminders: { hours: [9, 15, 17], daysBeforeDue: 2, overdue: true, digestHour: 8 } }).status === 'success');
  ok('the score report still loads with a custom week', call({ action: 'getAnalytics', token: A, period: 'month' }).status === 'success');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
