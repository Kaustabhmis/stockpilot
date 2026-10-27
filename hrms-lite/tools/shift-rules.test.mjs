/* What a day of punches becomes, and what happens to it when the shift rules
 * change afterwards.
 *
 *   node shift-rules.test.mjs [base-url]
 *
 * Also: a single punch with no out is Absent, and the out completes it.
 *
 * Writes employees SR-01 and SR-02, shifts SR Day / SR Long / SR Tight and
 * their attendance in March and April 2026. Run it against a TEST workspace.
 */

const BASE = process.argv[2] || 'http://127.0.0.1:8105';

/* ------------------------------------------------------------------ */
/* THE RULES                                                           */
/* ------------------------------------------------------------------ */

/* A DAY. First punch is in, last is out. It is a full day (P) when either
     - the shift's full-day hours were worked, or
     - it was kept within the grace at BOTH ends: in no later than
       start + grace, out no earlier than end - grace.
   Otherwise the half-day hours make it HD, and below them it is A.
     SR Tight 09:00-18:00, full 9 h, half 5 h, grace 15:
       09:14-17:46  8.5 h  in and out inside the grace       -> P
       09:16-17:50  8.6 h  in a minute past the grace        -> HD
       09:05-17:44  8.7 h  out a minute before the grace     -> HD          */

/* THE RULES CHANGE AFTERWARDS. Moving someone to another shift, or editing a
   shift's hours, start, end or grace, judges their open days again - but only
   a day whose mark is exactly what the old rules made of its punches. A day
   set by hand, OD, and any month whose payroll is finalised stay as they are.
     SR-01 starts on SR Long 09:00-19:00, full 9 h:
       Apr 06 09:13-17:56  8.7 h -> HD    (the Chandrama Laha case)
       Apr 07 09:00-11:00  2.0 h -> A
       Apr 08 09:13-17:56  set to OD by hand
       Apr 09 09:13-17:56  set to A by hand
       Mar 02 09:13-17:56  -> HD, and March's payroll is finalised
     Moved to SR Day 09:00-18:00, full 8 h, grace 15:
       Apr 06 -> P (8.7 h is a full day here); the rest unchanged; 1 re-judged.
     SR Day edited to full 9 h, grace 5:
       Apr 06 -> HD (in 09:13 is past 09:05, and 8.7 h is under 9).
     ...and back to grace 15:
       Apr 06 -> P again (09:13 and 17:56 are inside the grace).            */

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
  console.log('   ' + (pass ? 'ok  ' : '**  ') + String(label).padEnd(44) + (why || '')); };
const eq = (got, want, label, why) => ok(String(got) === String(want), label,
  (String(got) === String(want) ? '' : 'got ' + got + ', wanted ' + want + ' - ') + (why || ''));

const token = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;

/* a clean slate for these people */
const mine = r => /^SR-0/.test(String(r.emp_code));
const oldAtt = (await call('list', { sheet: 'Attendance' }, token)).filter(mine).map(r => r.id);
if (oldAtt.length) await call('removeMany', { sheet: 'Attendance', ids: oldAtt }, token);
const oldPunch = (await call('list', { sheet: 'Punches' }, token)).filter(mine).map(r => r.id);
if (oldPunch.length) await call('removeMany', { sheet: 'Punches', ids: oldPunch }, token);
const oldPay = (await call('list', { sheet: 'Payroll' }, token)).filter(mine).map(r => r.id);
if (oldPay.length) await call('removeMany', { sheet: 'Payroll', ids: oldPay }, token);

const SHIFT = (id, name, start, end, full, grace) => ({ id, name, start_time: start, end_time: end,
  grace_minutes: grace, full_day_hours: full, half_day_hours: 5, weekly_off: 'Sun',
  saturday_policy: 'working', ot_after_minutes: 60, active: 'yes' });
await call('save', { sheet: 'Shifts', row: SHIFT('SR-S1', 'SR Day', '09:00', '18:00', 8, 15) }, token);
await call('save', { sheet: 'Shifts', row: SHIFT('SR-S2', 'SR Long', '09:00', '19:00', 9, 15) }, token);
await call('save', { sheet: 'Shifts', row: SHIFT('SR-S3', 'SR Tight', '09:00', '18:00', 9, 15) }, token);

const EMP = (code, shift) => ({ emp_code: code, name: 'Shift rules ' + code, status: 'Active',
  doj: '2025-01-01', basic: 20000, shift, department: 'QA', designation: 'Tester' });
await call('save', { sheet: 'Employees', row: EMP('SR-01', 'SR Long') }, token);
await call('save', { sheet: 'Employees', row: EMP('SR-02', 'SR Tight') }, token);

const punch = (code, day, a, b) => [{ emp_code: code, punch_time: day + ' ' + a },
                                    { emp_code: code, punch_time: day + ' ' + b }];
await call('ingestPunches', { source: 'file', punches: [
  ...punch('SR-02', '2026-04-13', '09:14', '17:46'),
  ...punch('SR-02', '2026-04-14', '09:16', '17:50'),
  ...punch('SR-02', '2026-04-15', '09:05', '17:44'),
  ...punch('SR-01', '2026-04-06', '09:13', '17:56'),
  ...punch('SR-01', '2026-04-07', '09:00', '11:00'),
  ...punch('SR-01', '2026-04-08', '09:13', '17:56'),
  ...punch('SR-01', '2026-04-09', '09:13', '17:56'),
  ...punch('SR-01', '2026-03-02', '09:13', '17:56')] }, token);

const day = async (code, iso) => (await call('list', { sheet: 'Attendance' }, token))
  .find(r => r.emp_code === code && String(r.date).slice(0, 10) === iso) || {};
const st = async (code, iso) => (await day(code, iso)).status;

console.log('\na day of punches');
eq(await st('SR-02', '2026-04-13'), 'P', '09:14-17:46 on 09:00-18:00, grace 15', 'inside the grace at both ends');
eq(await st('SR-02', '2026-04-14'), 'HD', '09:16-17:50', 'in past the grace, 8.6 h under 9');
eq(await st('SR-02', '2026-04-15'), 'HD', '09:05-17:44', 'out before the grace, 8.7 h under 9');
eq(await st('SR-01', '2026-04-06'), 'HD', '09:13-17:56 on 09:00-19:00, full 9 h', 'out long before 18:45');
eq(await st('SR-01', '2026-04-07'), 'A', '09:00-11:00', 'under the half-day hours');

/* the hand-set days, and a finalised March */
const setDay = async (iso, status) => {
  const r = await day('SR-01', iso);
  await call('save', { sheet: 'Attendance', row: Object.assign({}, r, { status, remarks: 'set by hand' }) }, token);
};
await setDay('2026-04-08', 'OD');
await setDay('2026-04-09', 'A');
let locked = true;
try {
  await call('save', { sheet: 'Payroll', row: { id: 'SR-01_2026-03', emp_code: 'SR-01', month: '2026-03',
    status: 'Finalised', gross: 0, net: 0 } }, token);
} catch (e) { locked = false; console.log('   (could not finalise March: ' + e.message + ')'); }

console.log('\nmoved to a shift with an 8 h full day');
const moved = await call('save', { sheet: 'Employees', row: EMP('SR-01', 'SR Day') }, token);
eq(moved.rejudged, 1, 'days re-judged', 'only April 6');
eq(await st('SR-01', '2026-04-06'), 'P', 'Apr 06 8.7 h', 'a full day on the new shift');
eq(await st('SR-01', '2026-04-07'), 'A', 'Apr 07 2 h', 'still under the half day');
eq(await st('SR-01', '2026-04-08'), 'OD', 'Apr 08 set to OD by hand', 'not a punch judgement - left alone');
eq(await st('SR-01', '2026-04-09'), 'A', 'Apr 09 set to A by hand', 'not what the old shift made - left alone');
if (locked) eq(await st('SR-01', '2026-03-02'), 'HD', 'Mar 02 in a finalised month', 'payroll is closed - left alone');
ok(/re-checked/.test((await day('SR-01', '2026-04-06')).remarks || ''), 'remark says why',
   (await day('SR-01', '2026-04-06')).remarks);

console.log('\nthe shift itself edited');
const tight = await call('save', { sheet: 'Shifts', row: SHIFT('SR-S1', 'SR Day', '09:00', '18:00', 9, 5) }, token);
ok(Number(tight.rejudged) >= 1, 'full 9 h, grace 5: days re-judged', 'got ' + tight.rejudged);
eq(await st('SR-01', '2026-04-06'), 'HD', 'Apr 06 under grace 5', 'in 09:13 is past 09:05 and 8.7 h < 9');
const loose = await call('save', { sheet: 'Shifts', row: SHIFT('SR-S1', 'SR Day', '09:00', '18:00', 9, 15) }, token);
ok(Number(loose.rejudged) >= 1, 'back to grace 15: days re-judged', 'got ' + loose.rejudged);
eq(await st('SR-01', '2026-04-06'), 'P', 'Apr 06 under grace 15', '09:13 and 17:56 are inside the grace');
eq(await st('SR-01', '2026-04-09'), 'A', 'Apr 09 still as set by hand');

console.log('\none punch and no second');
/* A SINGLE PUNCH is Absent while "punch out is mandatory" is on (the
   default): one tap is not a day worked. The out punch that follows rebuilds
   the day from both. */
await call('saveSettings', { settings: { punch_out_mandatory: 'yes' } }, token);
await call('ingestPunches', { source: 'file', punches: [{ emp_code: 'SR-02', punch_time: '2026-04-16 09:02' }] }, token);
eq(await st('SR-02', '2026-04-16'), 'A', 'in 09:02, no out', 'a single punch is not a day worked');
ok(/single punch/.test((await day('SR-02', '2026-04-16')).remarks || ''), 'remark says single punch',
   (await day('SR-02', '2026-04-16')).remarks);
await call('ingestPunches', { source: 'file', punches: [{ emp_code: 'SR-02', punch_time: '2026-04-16 18:01' }] }, token);
eq(await st('SR-02', '2026-04-16'), 'P', 'then out 18:01', 'the out punch completes the day');
await call('saveSettings', { settings: { punch_out_mandatory: 'no' } }, token);
await call('ingestPunches', { source: 'file', punches: [{ emp_code: 'SR-02', punch_time: '2026-04-17 09:02' }] }, token);
eq(await st('SR-02', '2026-04-17'), 'P', 'single punch, out not mandatory', 'switched off, an open day is present');

console.log('\na save that changes nothing about the rules');
const same = await call('save', { sheet: 'Employees', row: Object.assign(EMP('SR-01', 'SR Day'), { phone: '9000000000' }) }, token);
ok(!same.rejudged, 'no re-judging', 'got ' + same.rejudged);

console.log(bad ? '\n' + bad + ' check(s) FAILED' : '\nall shift-rule checks passed');
process.exit(bad ? 1 : 0);
