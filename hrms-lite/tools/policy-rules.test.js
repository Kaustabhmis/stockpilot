/* The settings that change what somebody is paid, each switched on and then
 * checked against the rule as written here in words.
 *
 * These are the rules HR ticks in Settings and then trusts. A rule that is
 * shown but not applied, or applied differently from its own label, is a
 * wrong payslip that nobody can see.
 *
 *   node policy-rules.test.js http://127.0.0.1:8101
 */

const BASE = process.argv[2] || 'http://127.0.0.1:8101';
const YM = '2026-08', DIM = 31;

/* --- the rules, in words -------------------------------------------------
 *
 * Late marks       "Late marks that cost half a day (N)". Every WHOLE group
 *                  of N late arrivals costs half a day. N-1 lates cost
 *                  nothing. 0 turns the rule off entirely. A day is late
 *                  when the punch-in is after the shift start plus its
 *                  grace minutes.
 *
 * Punch out
 * mandatory        When on, a day in the past that was punched in but never
 *                  punched out is not a paid day until it is fixed: it
 *                  costs a full day. When off, it costs nothing.
 *
 * Salary divisor   What a month's pay is divided by before being multiplied
 *                  by the days paid.
 *                    calendar - the number of days in the month
 *                    fixed26  - always 26
 *                    working  - the days the shift was scheduled to work
 *
 * Overtime         Paid only when "pay overtime" is on. The hourly rate is
 *                  the full monthly gross divided by (divisor x full-day
 *                  hours). Overtime pay is hours x rate x multiplier, and
 *                  the hours counted in a month stop at the monthly cap.
 *
 * Rounding         Every money figure is rounded to the nearest N rupees.
 * ------------------------------------------------------------------------ */

const call = async (action, payload, token) => {
  const r = await fetch(BASE + '/exec', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, token }) });
  const j = await r.json();
  if (!j.ok) throw new Error(action + ': ' + j.error);
  return j.data;
};

let bad = 0;
const check = (label, got, want, why) => {
  const ok = Math.abs(got - want) <= 1;
  if (!ok) bad++;
  console.log('   ' + label.padEnd(16) + String(got).padStart(8) + String(want).padStart(9) +
    (ok ? '    ' : ' ** ') + why);
};

(async () => {
  const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
  const token = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;

  /* The shift these people work: 09:30-18:30, 15 minutes grace, 8-hour day,
     and no weekly off so the test controls all 31 days. */
  const shifts = await call('list', { sheet: 'Shifts' }, token);
  const general = shifts.find(s => String(s.name).trim().toLowerCase() === 'general') || shifts[0];
  const SHIFT = Object.assign({}, general, { start_time: '09:30', end_time: '18:30',
    grace_minutes: 15, full_day_hours: 8, half_day_hours: 4,
    weekly_off: 'None', saturday_policy: 'working', ot_after_minutes: 30 });
  await call('save', { sheet: 'Shifts', row: SHIFT }, token);

  /* PL-01  two late days, PL-02 three, PL-03 six. Nothing else wrong.
     PL-04  one day punched in and never out.
     PL-05  a clean month, used for the divisor and overtime checks. */

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

  const PEOPLE = ['PL-01', 'PL-02', 'PL-03', 'PL-04', 'PL-05'];
  for (const code of PEOPLE) {
    await call('save', { sheet: 'Employees', row: { emp_code: code, name: 'Policy ' + code,
      status: 'Active', basic: 20000, hra: 8000, special_allowance: 0, other_allowance: 0,
      pf_applicable: 'no', esi_applicable: 'no', doj: '2019-01-01',
      shift: SHIFT.name, department: 'POLICY' } }, token);
  }

  const LATE = { 'PL-01': 2, 'PL-02': 3, 'PL-03': 6, 'PL-04': 0, 'PL-05': 0 };
  const rows = [];
  for (const code of PEOPLE) {
    let lateLeft = LATE[code];
    for (let d = 1; d <= DIM; d++) {
      const iso = YM + '-' + ('0' + d).slice(-2);
      const late = lateLeft > 0 && (lateLeft--, true);
      /* 10:30 is an hour past the start, well beyond the 15 minutes grace */
      const inT = late ? '10:30' : '09:30';
      /* PL-04's first day is punched in and never out */
      const open = code === 'PL-04' && d === 1;
      /* Overtime is counted from the punch-out against the shift END, not
         from hours worked against the full-day hours. Punching out at 19:30
         against a shift ending 18:30 is an hour of overtime a day. */
      rows.push({ id: code + '_' + iso, date: iso, emp_code: code, status: 'P',
        in_time: inT, out_time: open ? '' : '19:30', hours: open ? 0 : 10 });
    }
  }
  for (let i = 0; i < rows.length; i += 400) {
    await call('saveMany', { sheet: 'Attendance', rows: rows.slice(i, i + 400) }, token);
  }

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(BASE + '/index.html');
  await p.evaluate(u => localStorage.setItem('hrms_lite_api', u), BASE + '/exec');
  await p.reload(); await p.waitForTimeout(700);
  await p.fill('#in-email', 'admin@company.com'); await p.fill('#in-pass', 'admin123');
  await p.click('#btn-login');
  await p.waitForSelector('#view-dashboard', { state: 'visible', timeout: 25000 });
  /* The register is fetched a month at a time, and only the last couple of
     months come down at sign-in. This suite pins itself to a fixed month, so
     it has to ask for that month the way the screens do - otherwise it reads
     an empty register and every figure looks like zero. */
  const loadMonth = async () => {
    await p.evaluate(ym => ensureMonths([ym]), YM);
    await p.waitForFunction(ym => haveMonth(ym), YM, { timeout: 20000 });
  };
  await p.waitForTimeout(1500);

  /* Apply a set of settings and read back what payroll then makes of it.
     Settings are pushed through the API and the screen reloaded, so what is
     measured is the saved rule, not a value typed into a box. */
  const withSettings = async (settings, codes) => {
    await call('saveSettings', { settings }, token);
    await p.evaluate(() => reload());
    await loadMonth();
    await p.waitForTimeout(1200);
    return p.evaluate(([cs, ym]) => {
      const want = new Set(cs);
      return S.employees.filter(e => want.has(e.emp_code)).map(e => {
        const s = attStats(ym, e.emp_code);
        const r = computePay(e, ym, null);
        return { code: e.emp_code, late: s.late, lateDed: s.lateDeduction,
                 incomplete: s.incomplete, lop: s.lop, paid: r.paid_days,
                 total: r.total_days, basic: r.basic, gross: r.gross,
                 otH: r.ot_hours, otAmt: r.ot_amount, net: r.net, ded: r.total_deduction };
      });
    }, [codes, YM]);
  };

  const BASE_SET = { payroll_basis: 'calendar', payroll_rounding: '1',
    late_marks_per_halfday: '0', punch_out_mandatory: 'no',
    ot_pay_enabled: 'no', ot_rate_multiplier: '1', ot_max_hours_month: '0' };

  console.log('policy settings, against the rules as written\n');

  /* ---- late marks ---- */
  console.log('late marks: every 3 late arrivals cost half a day');
  let r = await withSettings(Object.assign({}, BASE_SET, { late_marks_per_halfday: '3' }),
    ['PL-01', 'PL-02', 'PL-03']);
  [['PL-01', 2, 0], ['PL-02', 3, 0.5], ['PL-03', 6, 1]].forEach(([code, lates, cost]) => {
    const x = r.find(y => y.code === code);
    console.log('  ' + code + ' with ' + lates + ' late day(s)');
    check('late days seen', x.late, lates, 'punched in after 09:45');
    check('days lost', x.lateDed, cost, Math.floor(lates / 3) + ' whole group(s) of 3 x half a day');
    check('paid days', x.paid, DIM - cost, DIM + ' less ' + cost);
  });

  console.log('\nlate marks off (0): the same lateness costs nothing');
  r = await withSettings(Object.assign({}, BASE_SET, { late_marks_per_halfday: '0' }), ['PL-03']);
  check('days lost', r[0].lateDed, 0, 'rule switched off');
  check('paid days', r[0].paid, DIM, 'nothing lost');

  /* ---- punch out mandatory ---- */
  console.log('\npunch out mandatory ON: a day never punched out costs a full day');
  r = await withSettings(Object.assign({}, BASE_SET, { punch_out_mandatory: 'yes' }), ['PL-04']);
  check('open days', r[0].incomplete, 1, 'one day in with no out');
  check('paid days', r[0].paid, DIM - 1, DIM + ' less the open day');

  console.log('punch out mandatory OFF: the same day costs nothing');
  r = await withSettings(Object.assign({}, BASE_SET, { punch_out_mandatory: 'no' }), ['PL-04']);
  check('paid days', r[0].paid, DIM, 'rule switched off');

  /* ---- salary divisor ---- */
  console.log('\nsalary divisor: a full month present, paid in full each way');
  for (const [basis, divisor, why] of [
    ['calendar', DIM, 'the days in the month'],
    ['fixed26', 26, 'always 26'],
    ['working', 31, 'the days the shift was scheduled - no weekly off here, so 31']]) {
    r = await withSettings(Object.assign({}, BASE_SET, { payroll_basis: basis }), ['PL-05']);
    const x = r[0];
    console.log('  basis "' + basis + '"');
    check('divisor', x.total, divisor, why);
    check('paid days', x.paid, divisor, 'present every scheduled day');
    check('basic', x.basic, 20000, 'a full month, so the full basic whatever the divisor');
    check('gross', x.gross, 28000, 'basic 20,000 + hra 8,000');
  }

  /* ---- overtime ----
     PL-05 worked 09:30-18:30 every day: a 9-hour day against an 8-hour
     shift, so an hour a day beyond the shift end, 31 hours in the month. */
  console.log('\novertime: punched out at 19:30 against a shift ending 18:30 - an hour a day, 31 days');
  const HOURLY = 28000 / (DIM * 8);
  r = await withSettings(Object.assign({}, BASE_SET,
    { ot_pay_enabled: 'no', ot_max_hours_month: '0' }), ['PL-05']);
  check('OT paid', r[0].otAmt, 0, 'pay overtime is off');

  r = await withSettings(Object.assign({}, BASE_SET,
    { ot_pay_enabled: 'yes', ot_rate_multiplier: '1', ot_max_hours_month: '0' }), ['PL-05']);
  check('OT hours', r[0].otH, 31, 'an hour a day for 31 days');
  check('OT paid', r[0].otAmt, Math.round(31 * HOURLY), '31 x gross/(31x8) x 1');

  r = await withSettings(Object.assign({}, BASE_SET,
    { ot_pay_enabled: 'yes', ot_rate_multiplier: '2', ot_max_hours_month: '0' }), ['PL-05']);
  check('OT at 2x', r[0].otAmt, Math.round(31 * HOURLY * 2), 'double rate');

  r = await withSettings(Object.assign({}, BASE_SET,
    { ot_pay_enabled: 'yes', ot_rate_multiplier: '1', ot_max_hours_month: '10' }), ['PL-05']);
  check('OT capped', r[0].otAmt, Math.round(10 * HOURLY), '31 hours worked, 10 the monthly cap');

  /* ---- rounding ----
     Two things must hold at every step: the figures land on the grid, AND
     the payslip still adds up as printed. Rounding gross, the deductions and
     the net separately used to let them drift, so a payslip could show
     28,000 less 1,950 as 26,100. */
  console.log('\nrounding: on the grid, and the payslip still adds up');
  for (const step of [1, 5, 10, 100]) {
    r = await withSettings(Object.assign({}, BASE_SET, { payroll_rounding: String(step) }), ['PL-05']);
    const x = r[0];
    /* The grid is for what the company decides to pay - basic, HRA, gross.
       PF, ESI and P.Tax are statutory and stay exact to the rupee: a PF
       figure rounded to the nearest hundred is not a PF figure anybody can
       file. The net is then gross less those exact deductions, so it lands
       where it lands rather than on the grid. */
    const offGrid = [x.basic, x.gross].filter(v => v % step !== 0);
    const ties = x.net === x.gross - x.ded;
    if (offGrid.length || !ties) bad++;
    console.log('   nearest ' + String(step).padEnd(4) +
      ' gross ' + String(x.gross).padStart(6) + ' - deductions ' + String(x.ded).padStart(5) +
      ' = net ' + String(x.net).padStart(6) +
      (offGrid.length ? '  ** earnings off the ' + step + ' grid: ' + offGrid.join(', ')
                      : '   earnings on the grid') +
      (ties ? ', adds up' : '  ** does NOT add up: ' + (x.gross - x.ded) + ' printed as ' + x.net));
  }

  /* leave the workspace on the ordinary settings, so the next test to run is
     not measuring this one's leftovers */
  await call('saveSettings', { settings: BASE_SET }, token);

  console.log('\n' + (bad ? '** figures that did not match their rule: ' + bad
                          : 'every figure matched the rule as written'));
  console.log('page errors:', errs.length ? errs : 'none');
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('** ' + e.message); process.exit(1); });
