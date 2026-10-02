/* What an ordinary member of staff can and cannot do - checked against the
 * backend, not against what the screen chooses to show.
 *
 * Hiding a button is not a permission. Every case here goes straight to the
 * API with an employee's own token, the way anyone with the browser console
 * open could, and asks whether the rule holds there.
 *
 * Two kinds of "no" count as correct, and the difference matters:
 *
 *   REFUSED  the call is turned away outright. Right for anything that is
 *            none of their business at all - the user list, the punch log,
 *            somebody else's attendance.
 *   STRIPPED the call succeeds but the fields they may not set are dropped.
 *            Right for their own record, because the Me screen sends the
 *            whole row back and refusing it would stop them correcting
 *            their own phone number. The test for this is not the reply -
 *            it is whether the figure actually moved.
 *
 * A test that only looked at ok/not-ok would read the second as a hole.
 *
 *   node permissions.test.js http://127.0.0.1:8101
 */

const BASE = process.argv[2] || 'http://127.0.0.1:8101';
const CODE = 'PM0001', PASS = 'PM0001';

const call = async (action, payload, token) => {
  const r = await fetch(BASE + '/exec', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload: payload || {}, token: token || '' })
  });
  return r.json();
};

let bad = 0;
const ok = (pass, label, why) => {
  if (!pass) bad++;
  console.log('   ' + (pass ? 'ok  ' : '**  ') + label.padEnd(46) + (why || ''));
};

(async () => {
  const admin = (await call('login', { email: 'admin@company.com', password: 'admin123' })).data.token;

  /* somebody ordinary, with a salary worth protecting */
  await call('save', { sheet: 'Employees', row: {
    emp_code: CODE, name: 'Permissions Case', status: 'Active', wage_type: 'Salary',
    basic: 12000, hra: 8000, special_allowance: 0, other_allowance: 0,
    pf_applicable: 'yes', esi_applicable: 'yes', doj: '2022-01-01',
    department: 'PERMS', phone: '', pan: '' } }, admin);
  await call('saveUser', { user: { email: CODE.toLowerCase(), emp_code: CODE,
    role: 'employee', password: PASS } }, admin);
  /* and a second person, so "somebody else" is a real somebody */
  await call('save', { sheet: 'Employees', row: {
    emp_code: 'PM0002', name: 'Someone Else', status: 'Active', wage_type: 'Salary',
    basic: 15000, hra: 10000, doj: '2022-01-01', department: 'PERMS' } }, admin);

  const login = await call('login', { email: CODE.toLowerCase(), password: PASS });
  if (!login.ok) { console.log('could not sign in as the employee: ' + login.error); process.exit(1); }
  const emp = login.data.token;

  const employees = async () => (await call('list', { sheet: 'Employees' }, admin)).data;
  const me = async () => (await employees()).find(e => e.emp_code === CODE);

  console.log('what an ordinary member of staff may do, asked of the backend\n');

  /* ---------------- turned away outright ---------------- */
  console.log('  refused outright - none of their business');
  const refusals = [
    ['their own attendance',      'save', { sheet: 'Attendance', row: {
        id: CODE + '_2026-08-03', date: '2026-08-03', emp_code: CODE,
        status: 'P', in_time: '09:00', out_time: '18:00', hours: 9 } }],
    ['somebody else’s attendance', 'save', { sheet: 'Attendance', row: {
        id: 'PM0002_2026-08-03', date: '2026-08-03', emp_code: 'PM0002', status: 'P' } }],
    ['a company setting',         'saveSettings', { settings: { pf_employee_pct: '0' } }],
    ['the payroll',               'save', { sheet: 'Payroll', row: {
        id: 'x', month: '2026-08', emp_code: CODE, net: 999999 } }],
    ['the list of logins',        'listUsers', {}],
    ['making a login',            'saveUser', { user: { email: 'sneak', role: 'owner', password: 'sneak123' } }],
    ['the punch log',             'punchLog', { from: '2026-08-01', to: '2026-08-31' }],
    ['the whole register',        'monthAtt', { month: '2026-08' }],
    ['deleting their own record', 'remove', { sheet: 'Employees', id: CODE }],
    /* The three tabs that keep their own record. An employee is handed their
       own rows in the workspace - that is what puts bonus and gratuity on
       their phone - but reading the TAB means reading everybody's, and
       writing to it means setting their own bonus. Both are refused. */
    ['the whole bonus run',       'list', { sheet: 'Bonus' }],
    ['the gratuity register',     'list', { sheet: 'Gratuity' }],
    ["everyone's salary history", 'list', { sheet: 'Increment' }],
    ['giving themselves a bonus', 'save', { sheet: 'Bonus', row: {
        id: 'BON2026-27_' + CODE, fy: '2026-27', emp_code: CODE, amount: 500000 } }],
    ['freezing their own gratuity', 'save', { sheet: 'Gratuity', row: {
        id: 'GRA2026-10-01_' + CODE, as_on: '2026-10-01', emp_code: CODE, amount: 900000 } }],
    ['writing their own rise',    'save', { sheet: 'Increment', row: {
        id: 'INC2026-10_' + CODE, emp_code: CODE, effective_from: '2026-10-01',
        old_basic: 12000, new_basic: 99000, rise: 87000 } }],
  ];
  for (const [label, action, payload] of refusals) {
    const r = await call(action, payload, emp);
    ok(r.ok === false, label, r.ok ? 'ALLOWED - ' + JSON.stringify(r.data).slice(0, 60) : r.error.slice(0, 44));
  }

  /* ---------------- accepted, but stripped ---------------- */
  /* Their own row comes back whole from the Me screen, so the save is taken
     and the fields that are not theirs are dropped. What proves the rule is
     the stored figure, not the reply. */
  console.log('\n  accepted, with anything that is not theirs dropped');
  const before = await me();
  const r1 = await call('save', { sheet: 'Employees', row: {
    emp_code: CODE, phone: '9999900000',          /* theirs */
    basic: 999999, hra: 888888,                   /* not theirs */
    pan: 'FAKEP1234X',                            /* theirs */
    department: 'BOARD', status: 'Active' } }, emp);   /* not theirs */
  const after = await me();
  ok(r1.ok === true, 'the save itself is taken', 'so the Me screen still works');
  ok(Number(after.basic) === Number(before.basic), 'basic did not move',
     before.basic + ' -> ' + after.basic);
  ok(Number(after.hra) === Number(before.hra), 'HRA did not move',
     before.hra + ' -> ' + after.hra);
  ok(String(after.department) === String(before.department), 'department did not move',
     (before.department || '(blank)') + ' -> ' + (after.department || '(blank)'));
  ok(String(after.phone) === '9999900000', 'their phone did change',
     'a field that is theirs to correct');

  /* and they cannot write over somebody else by sending another code */
  const other0 = (await employees()).find(e => e.emp_code === 'PM0002');
  await call('save', { sheet: 'Employees', row: {
    emp_code: 'PM0002', phone: '1111111111', basic: 1 } }, emp);
  const other1 = (await employees()).find(e => e.emp_code === 'PM0002');
  ok(String(other1.phone) === String(other0.phone) &&
     Number(other1.basic) === Number(other0.basic),
     'somebody else’s record is untouched', 'sending another code changes nothing');

  /* ---------------- what they are entitled to ---------------- */
  console.log('\n  allowed - it is theirs');
  const mine = [
    ['open their own workspace', 'bootstrap', {}],
    ['their own month',          'myMonth', { month: '2026-08' }],
    ['their own punch state',    'punchState', {}],
    ['apply for leave',          'save', { sheet: 'Leave', row: {
        emp_code: CODE, type: 'Casual', from_date: '2026-08-20', to_date: '2026-08-20',
        days: 1, reason: 'test', status: 'Pending' } }],
  ];
  for (const [label, action, payload] of mine) {
    const r = await call(action, payload, emp);
    ok(r.ok === true, label, r.ok ? '' : 'REFUSED - ' + r.error.slice(0, 50));
  }

  /* their workspace must not carry anyone else's pay */
  const ws = (await call('bootstrap', {}, emp)).data;
  const foreignPay = (ws.payroll || []).filter(r => String(r.emp_code) !== CODE).length;
  const foreignStaff = (ws.employees || []).filter(e => String(e.emp_code) !== CODE).length;
  ok(foreignPay === 0, 'their workspace carries no one else’s pay', foreignPay + ' foreign rows');
  ok(foreignStaff === 0, 'nor anyone else’s record', foreignStaff + ' foreign people');

  /* The three new tabs ride down the same wire. Filtering them in the browser
     would still have sent every bonus in the company to every phone, so the
     check is on what the workspace CONTAINS, not on what a screen shows. */
  for (const key of ['bonus', 'gratuity', 'increment']) {
    const foreign = (ws[key] || []).filter(r => String(r.emp_code) !== CODE).length;
    ok(foreign === 0, 'nor anyone else’s ' + key, foreign + ' foreign rows');
  }

  console.log('\n' + (bad ? '** ' + bad + ' rule(s) did not hold'
                          : 'every rule held - on the backend, not just on screen'));
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(String(e)); process.exit(1); });
