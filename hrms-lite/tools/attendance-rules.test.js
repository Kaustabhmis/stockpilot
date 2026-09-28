/* Attendance, checked against the rules as written here in words.
 *
 * Paid days are what every rupee is multiplied by, so a wrong day here is a
 * wrong payslip. Expected values below are derived from the rule statements,
 * never from what index.html happens to do.
 *
 *   node attendance-rules.test.js http://127.0.0.1:8101
 */

const BASE = process.argv[2] || 'http://127.0.0.1:8101';
const YM = '2026-08', DIM = 31;   /* a 31-day month, already closed */

/* --- the rules, in words -------------------------------------------------
 *
 * What a day costs, out of a full month:
 *   P   present            costs nothing
 *   OD  out duty           costs nothing - duty done away from the plant
 *   CO  comp-off taken     costs nothing - it was earned
 *   WO  weekly off         costs nothing
 *   H   holiday            costs nothing
 *   L   leave              costs nothing while it is inside the quota;
 *                          beyond the quota it costs a day IF the setting
 *                          "leave beyond the quota is unpaid" is on
 *   HD  half day           costs half a day
 *   A   absent             costs a full day
 *   blank, on a day that has already passed
 *                          costs a full day - an unmarked past day is
 *                          treated as absence, and the dashboard warns so
 *   blank, on a day still to come in the running month
 *                          costs nothing - it has not happened yet
 *
 * Before joining and after leaving nothing is owed at all - not the weekly
 * offs and not the holidays. A man who starts on the 16th is not paid for
 * the Sunday on the 5th.
 *
 * Late marks: every N late arrivals cost half a day, where N is the setting
 * "late marks that cost half a day". 0 turns it off. Only whole groups of N
 * count - two lates with N=3 cost nothing.
 * ------------------------------------------------------------------------ */

const call = async (action, payload, token) => {
  const r = await fetch(BASE + '/exec', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, token }) });
  const j = await r.json();
  if (!j.ok) throw new Error(action + ': ' + j.error);
  return j.data;
};

/* Each case: the month written out as a string of day-codes, and what the
 * rule statements above say it should cost. One letter per day; '.' is an
 * unmarked day. Lower-case 'p' is a present day that was late. */
const CASES = [
  { code: 'AT-01', note: 'a full month present',
    days: 'P'.repeat(31), lop: 0 },
  { code: 'AT-02', note: 'two absences',
    days: 'AA' + 'P'.repeat(29), lop: 2 },
  { code: 'AT-03', note: 'a half day costs half',
    days: 'HD'.replace('HD', 'h') + 'P'.repeat(30), lop: 0.5 },
  { code: 'AT-04', note: 'weekly offs and holidays cost nothing',
    days: 'WWHH' + 'P'.repeat(27), lop: 0 },
  { code: 'AT-05', note: 'out duty and comp-off cost nothing',
    days: 'OOCC' + 'P'.repeat(27), lop: 0 },
  { code: 'AT-06', note: 'an unmarked day that has passed is absence',
    days: '..' + 'P'.repeat(29), lop: 2 },
  { code: 'AT-07', note: 'a mix: 1 absent, 2 half days, 1 unmarked',
    days: 'Ahh.' + 'P'.repeat(27), lop: 3 },
  { code: 'AT-08', note: 'leave inside the quota costs nothing',
    days: 'LLL' + 'P'.repeat(28), lop: 0 },
];

/* day-code -> the status the register stores */
const STATUS = { P: 'P', A: 'A', h: 'HD', W: 'WO', H: 'H', O: 'OD', C: 'CO', L: 'L', '.': '' };

(async () => {
  const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
  const token = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;


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

  for (const c of CASES) {
    await call('save', { sheet: 'Employees', row: { emp_code: c.code, name: 'Case ' + c.code,
      status: 'Active', basic: 31000, hra: 0, special_allowance: 0, other_allowance: 0,
      pf_applicable: 'no', esi_applicable: 'no', doj: '2019-01-01', department: 'ATTEST' } }, token);
  }
  /* a joiner and a leaver, both present on every day they were on the roll */
  for (const [code, doj, exit, note] of [
    ['AT-09', YM + '-16', '', 'joined on the 16th'],
    ['AT-10', '2019-01-01', YM + '-15', 'left on the 15th']]) {
    await call('save', { sheet: 'Employees', row: { emp_code: code, name: 'Case ' + code,
      status: 'Active', basic: 31000, hra: 0, special_allowance: 0, other_allowance: 0,
      pf_applicable: 'no', esi_applicable: 'no', doj, exit_date: exit,
      department: 'ATTEST' } }, token);
  }

  const rows = [];
  for (const c of CASES) {
    for (let d = 1; d <= DIM; d++) {
      const st = STATUS[c.days[d - 1]];
      if (st === '') continue;                     /* leave the day unmarked */
      const iso = YM + '-' + ('0' + d).slice(-2);
      rows.push({ id: c.code + '_' + iso, date: iso, emp_code: c.code, status: st,
        in_time: (st === 'P' || st === 'HD') ? '09:00' : '',
        out_time: st === 'P' ? '18:00' : st === 'HD' ? '13:00' : '',
        hours: st === 'P' ? 9 : st === 'HD' ? 4 : 0 });
    }
  }
  /* AT-09 present from the 16th, AT-10 present to the 15th */
  for (let d = 1; d <= DIM; d++) {
    const iso = YM + '-' + ('0' + d).slice(-2);
    if (d >= 16) rows.push({ id: 'AT-09_' + iso, date: iso, emp_code: 'AT-09', status: 'P',
      in_time: '09:00', out_time: '18:00', hours: 9 });
    if (d <= 15) rows.push({ id: 'AT-10_' + iso, date: iso, emp_code: 'AT-10', status: 'P',
      in_time: '09:00', out_time: '18:00', hours: 9 });
  }
  for (let i = 0; i < rows.length; i += 400) {
    await call('saveMany', { sheet: 'Attendance', rows: rows.slice(i, i + 400) }, token);
  }
  /* The weekly off is a property of the SHIFT, not of Settings - two shifts
     can rest on different days. So the shift these cases work is given no
     weekly off at all, and the day strings above then control all 31 days.
     Setting the global weekly_off here would do nothing, which is worth
     knowing: it is the shift row that decides. */
  const shifts = await call('list', { sheet: 'Shifts' }, token);
  const general = shifts.find(s => String(s.name).trim().toLowerCase() === 'general') || shifts[0];
  if (general) {
    await call('save', { sheet: 'Shifts', row: Object.assign({}, general,
      { weekly_off: 'None', saturday_policy: 'working' }) }, token);
  }
  await call('saveSettings', { settings: { payroll_basis: 'calendar',
    late_marks_per_halfday: '0', excess_leave_unpaid: 'no',
    punch_out_mandatory: 'no' } }, token);

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(BASE + '/index.html');
  await p.evaluate(u => localStorage.setItem('hrms_lite_api', u), BASE + '/exec');
  await p.reload(); await p.waitForTimeout(700);
  await p.fill('#in-email', 'admin@company.com'); await p.fill('#in-pass', 'admin123');
  await p.click('#btn-login');
  await p.waitForSelector('#view-dashboard', { state: 'visible', timeout: 25000 });
  await p.waitForTimeout(1500);
  await p.evaluate(m => { go('attendance'); el('att-month').value = m; renderAttendance(); }, YM);
  await p.waitForTimeout(2500);

  const got = await p.evaluate(([codes, ym]) => {
    const want = new Set(codes);
    return S.employees.filter(e => want.has(e.emp_code)).map(e => {
      const s = attStats(ym, e.emp_code);
      const r = computePay(e, ym, null);
      return { code: e.emp_code, lop: s.lop, blank: s.blank, offRoll: s.offRoll,
               working: s.working, late: s.late,
               paid: r.paid_days, total: r.total_days, basic: r.basic };
    });
  }, [CASES.map(c => c.code).concat(['AT-09', 'AT-10']), YM]);

  let bad = 0;
  const check = (label, got, want, why) => {
    const ok = Math.abs(got - want) <= 0.01;
    if (!ok) bad++;
    console.log('   ' + label.padEnd(12) + String(got).padStart(7) + String(want).padStart(8) +
      (ok ? '    ' : ' ** ') + why);
  };

  console.log('attendance, against the rules as written\n');
  console.log('case    note');
  CASES.forEach(c => {
    const r = got.find(x => x.code === c.code);
    if (!r) { bad++; console.log(c.code + '  ** missing'); return; }
    console.log(c.code + '  ' + c.note);
    check('days lost', r.lop, c.lop, 'what the month above should cost');
    /* the divisor is the whole month; paid days are the month less what was lost */
    check('paid days', r.paid, DIM - c.lop, DIM + ' days less ' + c.lop);
    check('basic', r.basic, Math.round(31000 * (DIM - c.lop) / DIM), 'basic x paid/' + DIM);
    console.log('');
  });

  /* joiner and leaver: nothing is owed for the days off the roll */
  [['AT-09', 16, 'joined on the 16th: paid the 16th to the 31st'],
   ['AT-10', 15, 'left on the 15th: paid the 1st to the 15th']].forEach(([code, days, note]) => {
    const r = got.find(x => x.code === code);
    if (!r) { bad++; console.log(code + '  ** missing'); return; }
    console.log(code + '  ' + note);
    check('paid days', r.paid, days, days + ' days on the roll');
    check('off roll', r.offRoll, DIM - days, DIM - days + ' days not employed');
    check('basic', r.basic, Math.round(31000 * days / DIM), 'basic x ' + days + '/' + DIM);
    console.log('');
  });

  console.log(bad ? '** figures that did not match their rule: ' + bad
                  : 'every figure matched the rule as written');
  console.log('page errors:', errs.length ? errs : 'none');
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('** ' + e.message); process.exit(1); });
