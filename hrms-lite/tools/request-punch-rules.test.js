/* Requests and punching, checked against the rules as written here in words.
 *
 * Both write onto the attendance register, so both reach payroll.
 *
 *   node request-punch-rules.test.js http://127.0.0.1:8101
 */

const BASE = process.argv[2] || 'http://127.0.0.1:8101';
const YM = '2026-08', DIM = 31;

/* --- the rules, in words -------------------------------------------------
 *
 * Out duty (effect "present")
 *      An approved OD marks every day it covers as OD on the register, and
 *      OD is a paid day. It can run over several days. A rest day inside an
 *      OD stays a rest day - the employee is not on duty on their day off.
 *      Times already on the day are kept, not wiped.
 *
 * Missed punch (effect "times")
 *      An approved correction puts the approved times onto that one day and
 *      judges the day against the employee's own shift: a full day's worth
 *      of hours is P, at least the half-day hours is HD.
 *
 * Punching from the app
 *      The first tap of the day is the in-time, the next is the out-time.
 *      Tapping "in" twice does not move the in-time, and a second "out"
 *      does not move the out-time backwards - an accidental double tap must
 *      never shorten somebody's day.
 *      A punch is always written against the code on the session, whatever
 *      code the request carries: nobody can punch for anybody else.
 * ------------------------------------------------------------------------ */

const call = async (action, payload, token) => {
  const r = await fetch(BASE + '/exec', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, token }) });
  const j = await r.json();
  if (!j.ok) throw new Error(action + ': ' + j.error);
  return j.data;
};
const soft = async (action, payload, token) => {
  const r = await fetch(BASE + '/exec', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, token }) });
  return r.json();
};

let bad = 0;
const check = (label, got, want, why) => {
  const ok = String(got) === String(want);
  if (!ok) bad++;
  console.log('   ' + label.padEnd(20) + String(got).padStart(10) + String(want).padStart(11) +
    (ok ? '    ' : ' ** ') + why);
};

(async () => {
  const token = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;

  const shifts = await call('list', { sheet: 'Shifts' }, token);
  const general = shifts.find(s => String(s.name).trim().toLowerCase() === 'general') || shifts[0];
  await call('save', { sheet: 'Shifts', row: Object.assign({}, general,
    { start_time: '09:30', end_time: '18:30', grace_minutes: 15,
      full_day_hours: 8, half_day_hours: 4, weekly_off: 'Sun',
      saturday_policy: 'working', ot_after_minutes: 30 }) }, token);


  /* A finalised payroll run locks its month's register - correctly. This
     file lays that month out itself, so reopen the run first, or it fails
     for a reason that has nothing to do with the rule under test. */
  {
    const runRows = (await call('list', { sheet: 'Payroll' }, token))
      .filter(p => String(p.month) === YM);
    for (let i = 0; i < runRows.length; i += 200) {
      await call('removeMany', { sheet: 'Payroll',
        ids: runRows.slice(i, i + 200).map(p => p.id) }, token);
    }
  }

  const PEOPLE = ['RQ-01', 'RQ-02', 'RQ-03'];
  const mine = new Set(PEOPLE);
  for (const sheet of ['Requests', 'Attendance', 'Leave']) {
    const old = (await call('list', { sheet }, token)).filter(r => mine.has(String(r.emp_code)));
    for (let i = 0; i < old.length; i += 200) {
      await call('removeMany', { sheet, ids: old.slice(i, i + 200).map(r => r.id) }, token);
    }
  }
  for (const code of PEOPLE) {
    await call('save', { sheet: 'Employees', row: { emp_code: code, name: 'Req ' + code,
      status: 'Active', basic: 31000, hra: 0, special_allowance: 0, other_allowance: 0,
      pf_applicable: 'no', esi_applicable: 'no', doj: '2019-01-01',
      shift: general.name, department: 'REQTEST' } }, token);
    await call('saveUser', { user: { email: code.toLowerCase(), role: 'employee',
      emp_code: code, active: 'yes', password: 'pw123456' } }, token);
  }
  await call('saveSettings', { settings: { sandwich_rule: 'no', geofence_enabled: 'no',
    web_punch_enabled: 'yes', punch_out_mandatory: 'no' } }, token);

  const readBack = async code => {
    const att = await call('list', { sheet: 'Attendance' }, token);
    const m = {};
    att.filter(a => String(a.emp_code) === code && String(a.date).startsWith(YM))
       .forEach(a => m[String(a.date)] = a);
    return m;
  };

  /* clear every step of the chain, as the people in it would */
  const decideAll = async (sheet, id) => {
    let res, guard = 0;
    do { res = await call('decide', { sheet, id, status: 'Approved' }, token); }
    while (!res.done && ++guard < 10);
    if (!res.done) throw new Error(sheet + ' ' + id + ' never cleared its chain');
    return res;
  };

  const names = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dowOf = d => names[new Date(YM + '-' + ('0' + d).slice(-2) + 'T00:00:00').getDay()];

  console.log('requests and punching, against the rules as written\n');

  /* ---- 1. out duty over several days, straddling a rest day ---- */
  console.log('1. an approved out duty, the 6th to the 10th');
  console.log('   (the 9th is a ' + dowOf(9) + ', this shift\'s rest day)');
  const od = await call('save', { sheet: 'Requests', row: { emp_code: 'RQ-01', type: 'OD',
    date: YM + '-06', to_date: YM + '-10', reason: 'site visit', status: 'Pending',
    applied_at: YM + '-05' } }, token);
  await decideAll('Requests', od.id);
  let reg = await readBack('RQ-01');
  check('the 6th', (reg[YM + '-06'] || {}).status, 'OD', 'a working day inside the OD');
  check('the 8th', (reg[YM + '-08'] || {}).status, 'OD', 'a working day inside the OD');
  check('the 9th', (reg[YM + '-09'] || {}).status || '(not marked)', '(not marked)',
    'their rest day stays a rest day');
  check('the 10th', (reg[YM + '-10'] || {}).status, 'OD', 'a working day inside the OD');
  check('the 11th', (reg[YM + '-11'] || {}).status || '(not marked)', '(not marked)',
    'a day outside the OD is untouched');

  /* ---- 2. a missed punch is judged against the shift ---- */
  console.log('\n2. an approved missed-punch correction');
  for (const [day, inT, outT, want, why] of [
    ['12', '09:30', '18:30', 'P',  '9 hours, at or over the full-day 8'],
    ['13', '09:30', '14:00', 'HD', '4.5 hours: past the half-day 4, short of 8'],
  ]) {
    const rq = await call('save', { sheet: 'Requests', row: { emp_code: 'RQ-02', type: 'SWIPE',   /* the seeded code for a missed punch */
      date: YM + '-' + day, in_time: inT, out_time: outT, reason: 'forgot',
      status: 'Pending', applied_at: YM + '-' + day } }, token);
    await decideAll('Requests', rq.id);
    const r2 = await readBack('RQ-02');
    const row = r2[YM + '-' + day] || {};
    console.log('   the ' + day + 'th, ' + inT + ' to ' + outT);
    check('status', row.status, want, why);
    check('in time', row.in_time, inT, 'the approved time is written');
    check('out time', row.out_time, outT, 'the approved time is written');
  }

  /* ---- 3. punching from the app ---- */
  console.log('\n3. punching from the app');
  const emp = (await call('login', { email: 'rq-03', password: 'pw123456' })).token;
  const today = (await call('ping', {}, emp)).date ||
                new Date().toISOString().slice(0, 10);

  const p1 = await soft('webPunch', { kind: 'in' }, emp);
  console.log('   first "in"          :', p1.ok ? 'accepted at ' + p1.data.record.in_time : 'REFUSED: ' + p1.error);
  if (!p1.ok) bad++;
  const firstIn = p1.ok ? p1.data.record.in_time : null;

  const p2 = await soft('webPunch', { kind: 'in' }, emp);
  console.log('   a second "in"       :', p2.ok ? 'accepted' : 'refused: ' + p2.error);
  const afterDouble = await call('punchState', {}, emp);
  check('in time held', afterDouble.in_time, firstIn, 'a double tap must not move the in-time');

  const p3 = await soft('webPunch', { kind: 'out' }, emp);
  console.log('   "out"               :', p3.ok ? 'accepted at ' + p3.data.record.out_time : 'REFUSED: ' + p3.error);
  if (!p3.ok) bad++;
  const firstOut = p3.ok ? p3.data.record.out_time : null;

  const p4 = await soft('webPunch', { kind: 'out' }, emp);
  const afterOut = await call('punchState', {}, emp);
  console.log('   a second "out"      :', p4.ok ? 'accepted' : 'refused: ' + p4.error);
  const moved = afterOut.out_time < firstOut;
  if (moved) bad++;
  console.log('   ' + 'out time'.padEnd(20) + String(afterOut.out_time).padStart(10) +
    (moved ? ' **  moved BACKWARDS from ' + firstOut : '     never earlier than ' + firstOut));

  /* ---- 4. nobody can punch for anybody else ---- */
  console.log('\n4. punching as somebody else');
  const stolen = await soft('webPunch', { emp_code: 'RQ-01', kind: 'in' }, emp);
  const theirs = await call('list', { sheet: 'Attendance' }, token);
  const landedOn = theirs.filter(a => String(a.date) === today &&
    (String(a.emp_code) === 'RQ-01' || String(a.emp_code) === 'RQ-03'))
    .map(a => a.emp_code);
  check('written against', landedOn.filter(c => c === 'RQ-01').length ? 'RQ-01' : 'RQ-03', 'RQ-03',
    'the code on the session, never the one in the request');

  console.log('\n' + (bad ? '** figures that did not match their rule: ' + bad
                          : 'every figure matched the rule as written'));
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('** ' + e.message); process.exit(1); });
