/* Leave, checked against the rules as written here in words.
 *
 * Leave reaches money twice: an unpaid day is a day of LOP, and an approved
 * leave writes onto the register that payroll then reads. Both are checked
 * through the real approval path, not by writing rows directly.
 *
 *   node leave-rules.test.js http://127.0.0.1:8101
 */

const BASE = process.argv[2] || 'http://127.0.0.1:8101';
const YM = '2026-08', DIM = 31;

/* --- the rules, in words -------------------------------------------------
 *
 * Approving leave      writes "L" across every day of the application onto
 *                      the attendance register, so payroll sees it without
 *                      anybody marking it by hand.
 *
 * Weekly offs inside
 * a leave              are NOT charged as leave by default: a Sunday in the
 *                      middle of a week off stays a weekly off. When the
 *                      "sandwich rule" is on they ARE charged.
 *
 * A paid leave type    costs nothing. Its days are paid days.
 *
 * An unpaid leave type costs a full day each, exactly like absence.
 *
 * Leave beyond the
 * quota                is unpaid when "leave beyond the quota is unpaid" is
 *                      on, and free when it is off. The quota is per leave
 *                      type, per year.
 *
 * Cancelling an
 * approved leave       clears those days back to unmarked. It must not
 *                      clear a day somebody has since marked as something
 *                      else.
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
  const ok = String(got) === String(want) || (typeof want === 'number' && Math.abs(got - want) <= 0.01);
  if (!ok) bad++;
  console.log('   ' + label.padEnd(18) + String(got).padStart(9) + String(want).padStart(10) +
    (ok ? '    ' : ' ** ') + why);
};

(async () => {
  const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
  const token = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;

  /* a shift that rests on Sunday, so the sandwich rule has something to bite */
  const shifts = await call('list', { sheet: 'Shifts' }, token);
  const general = shifts.find(s => String(s.name).trim().toLowerCase() === 'general') || shifts[0];
  const SHIFT = Object.assign({}, general, { weekly_off: 'Sun', saturday_policy: 'working',
    start_time: '09:30', end_time: '18:30', grace_minutes: 15, full_day_hours: 8 });
  await call('save', { sheet: 'Shifts', row: SHIFT }, token);

  /* a paid type and an unpaid one, both with a small quota so the quota
     rule can be crossed without applying for half a year */
  await call('save', { sheet: 'LeaveTypes', row: { name: 'AuditPaid', paid: 'yes', quota: '4',
    carry_forward: 'no', max_consecutive: '30', notice_days: '0', allow_half_day: 'yes',
    active: 'yes' } }, token);
  await call('save', { sheet: 'LeaveTypes', row: { name: 'AuditUnpaid', paid: 'no', quota: '30',
    carry_forward: 'no', max_consecutive: '30', notice_days: '0', allow_half_day: 'yes',
    active: 'yes' } }, token);
  /* nobody in the way: approvals go straight through */
  await call('saveSettings', { settings: { leave_after_days: '0', sandwich_rule: 'no',
    excess_leave_unpaid: 'no', payroll_basis: 'calendar', payroll_rounding: '1',
    late_marks_per_halfday: '0', punch_out_mandatory: 'no', ot_pay_enabled: 'no' } }, token);

  const PEOPLE = ['LV-01', 'LV-02', 'LV-03', 'LV-04', 'LV-05'];

  /* Clear anything a previous run of this file left behind. Leave applications
     accumulate, and a second run against the same people would count last
     run's days against this run's quota and report a fault that is not there.
     A test that only passes the first time is worse than no test. */
  const mine = new Set(PEOPLE);
  for (const sheet of ['Leave', 'Attendance']) {
    const old = (await call('list', { sheet }, token)).filter(r => mine.has(String(r.emp_code)));
    for (let i = 0; i < old.length; i += 200) {
      await call('removeMany', { sheet, ids: old.slice(i, i + 200).map(r => r.id) }, token);
    }
  }

  for (const code of PEOPLE) {
    await call('save', { sheet: 'Employees', row: { emp_code: code, name: 'Leave ' + code,
      status: 'Active', basic: 31000, hra: 0, special_allowance: 0, other_allowance: 0,
      pf_applicable: 'no', esi_applicable: 'no', doj: '2019-01-01', shift: SHIFT.name,
      department: 'LEAVETEST' } }, token);
  }
  /* present every day to start with, so any LOP that appears came from leave */
  const rows = [];
  for (const code of PEOPLE) {
    for (let d = 1; d <= DIM; d++) {
      const iso = YM + '-' + ('0' + d).slice(-2);
      rows.push({ id: code + '_' + iso, date: iso, emp_code: code, status: 'P',
        in_time: '09:30', out_time: '18:30', hours: 9 });
    }
  }
  for (let i = 0; i < rows.length; i += 400) {
    await call('saveMany', { sheet: 'Attendance', rows: rows.slice(i, i + 400) }, token);
  }

  /* 2026-08-02 is a Sunday. A leave from Sat the 1st to Mon the 3rd
     straddles it, which is what the sandwich rule is about. */
  const dow = new Date(YM + '-02T00:00:00').getDay();
  console.log('leave, against the rules as written');
  console.log('(' + YM + '-02 is a ' + ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dow] + ')\n');

  /* Approvals run through a chain - this workspace has more than one step -
     so a single decide() leaves the application pending with the next level.
     Clear every step, the way the people in the chain would, and only then
     is it approved and the register written. */
  const apply = async (code, type, from, to, days) => {
    const lv = await call('save', { sheet: 'Leave', row: { emp_code: code, type: type,
      from_date: from, to_date: to, days: days, reason: 'audit', status: 'Pending',
      applied_at: YM + '-01' } }, token);
    let res, guard = 0;
    do {
      res = await call('decide', { sheet: 'Leave', id: lv.id, status: 'Approved' }, token);
    } while (!res.done && ++guard < 10);
    if (!res.done) throw new Error('leave ' + lv.id + ' never cleared its chain');
    return res;
  };

  /* Read the register back through the ordinary API, the way the app does.
     Anything that reaches around it can hand back a cached snapshot and
     show a write as not having happened when it has. */
  const readBack = async codes => {
    const att = await call('list', { sheet: 'Attendance' }, token);
    return codes.reduce((m, c) => {
      m[c] = {};
      att.filter(a => a.emp_code === c && String(a.date).startsWith(YM))
         .forEach(a => m[c][String(a.date)] = a.status);
      return m;
    }, {});
  };

  /* ---- 1. approving writes L onto the register ---- */
  console.log('1. approving a leave marks the register');
  await apply('LV-01', 'AuditPaid', YM + '-05', YM + '-06', 2);
  let reg = await readBack(['LV-01']);
  check('the 5th', reg['LV-01'][YM + '-05'], 'L', 'approved leave is written as L');
  check('the 6th', reg['LV-01'][YM + '-06'], 'L', 'approved leave is written as L');
  check('the 7th', reg['LV-01'][YM + '-07'], 'P', 'a day outside the leave is untouched');

  /* ---- 2. sandwich rule OFF: the Sunday inside is not charged ---- */
  console.log('\n2. sandwich rule OFF: a Sunday inside the leave stays a weekly off');
  await apply('LV-02', 'AuditPaid', YM + '-01', YM + '-03', 3);
  reg = await readBack(['LV-02']);
  check('Sat the 1st', reg['LV-02'][YM + '-01'], 'L', 'a working day inside the leave');
  /* every day was seeded as present, so "not charged" means it is still P -
     the approval must not have overwritten it with L */
  check('Sun the 2nd', reg['LV-02'][YM + '-02'], 'P',
    'the weekly off is left as it was, not charged as leave');
  check('Mon the 3rd', reg['LV-02'][YM + '-03'], 'L', 'a working day inside the leave');

  /* ---- 3. sandwich rule ON: the Sunday is charged ---- */
  console.log('\n3. sandwich rule ON: the same Sunday is charged as leave');
  await call('saveSettings', { settings: { sandwich_rule: 'yes' } }, token);
  await apply('LV-03', 'AuditPaid', YM + '-01', YM + '-03', 3);
  reg = await readBack(['LV-03']);
  check('Sat the 1st', reg['LV-03'][YM + '-01'], 'L', 'a working day inside the leave');
  check('Sun the 2nd', reg['LV-03'][YM + '-02'], 'L', 'the weekly off IS charged now');
  check('Mon the 3rd', reg['LV-03'][YM + '-03'], 'L', 'a working day inside the leave');
  await call('saveSettings', { settings: { sandwich_rule: 'no' } }, token);

  /* ---- 3b. the rest day is the EMPLOYEE'S, not one setting for everyone ----
     Somebody on a shift that rests on Friday must have their Friday left
     alone and their Sunday charged - the opposite of the company default.
     Marking used to read a single company-wide weekly off, so the register
     and the approval disagreed about the same month. */
  console.log('\n3b. a shift that rests on FRIDAY, not Sunday');
  await call('save', { sheet: 'Shifts', row: { name: 'AuditFriday', start_time: '09:30',
    end_time: '18:30', grace_minutes: 15, full_day_hours: 8, half_day_hours: 4,
    weekly_off: 'Fri', saturday_policy: 'working', ot_after_minutes: 30, active: 'yes' } }, token);
  await call('save', { sheet: 'Employees', row: { emp_code: 'LV-05', name: 'Friday Rest',
    status: 'Active', basic: 31000, hra: 0, special_allowance: 0, other_allowance: 0,
    pf_applicable: 'no', esi_applicable: 'no', doj: '2019-01-01', shift: 'AuditFriday',
    department: 'LEAVETEST' } }, token);
  {
    const old = (await call('list', { sheet: 'Attendance' }, token)).filter(r => r.emp_code === 'LV-05');
    if (old.length) await call('removeMany', { sheet: 'Attendance', ids: old.map(r => r.id) }, token);
    const seed = [];
    for (let d = 1; d <= DIM; d++) {
      const iso = YM + '-' + ('0' + d).slice(-2);
      seed.push({ id: 'LV-05_' + iso, date: iso, emp_code: 'LV-05', status: 'P',
        in_time: '09:30', out_time: '18:30', hours: 9 });
    }
    await call('saveMany', { sheet: 'Attendance', rows: seed }, token);
  }
  /* Thu 6th to Mon 10th August 2026 covers Friday the 7th and Sunday the 9th */
  const names = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dowOf = d => names[new Date(YM + '-' + ('0' + d).slice(-2) + 'T00:00:00').getDay()];
  console.log('   (the 7th is a ' + dowOf(7) + ', the 9th is a ' + dowOf(9) + ')');
  await apply('LV-05', 'AuditPaid', YM + '-06', YM + '-10', 5);
  reg = await readBack(['LV-05']);
  check('Thu the 6th', reg['LV-05'][YM + '-06'], 'L', 'a working day for this shift');
  check('Fri the 7th', reg['LV-05'][YM + '-07'], 'P', 'THEIR rest day - must be left alone');
  check('Sun the 9th', reg['LV-05'][YM + '-09'], 'L', 'a working day for this shift');
  check('Mon the 10th', reg['LV-05'][YM + '-10'], 'L', 'a working day for this shift');

  /* ---- 4. what each kind of leave costs ---- */
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

  const costs = async codes => {
    await p.evaluate(() => reload()); await p.waitForTimeout(1200);
    return p.evaluate(([cs, ym]) => {
      const want = new Set(cs);
      return S.employees.filter(e => want.has(e.emp_code)).map(e => {
        const s = attStats(ym, e.emp_code);
        const r = computePay(e, ym, null);
        return { code: e.emp_code, L: s.L, unpaidLeave: s.unpaidLeave,
                 lop: s.lop, paid: r.paid_days, basic: r.basic };
      });
    }, [codes, YM]);
  };

  console.log('\n4. a PAID leave type costs nothing');
  let c = (await costs(['LV-01']))[0];
  check('leave days', c.L, 2, 'the two days approved above');
  check('days lost', c.lop, 0, 'a paid type is a paid day');
  check('basic', c.basic, 31000, 'the full month');

  console.log('\n5. an UNPAID leave type costs a full day each');
  await apply('LV-04', 'AuditUnpaid', YM + '-10', YM + '-12', 3);
  c = (await costs(['LV-04']))[0];
  check('leave days', c.L, 3, 'the three days approved');
  check('unpaid of those', c.unpaidLeave, 3, 'the type is marked not paid');
  check('days lost', c.lop, 3, 'three unpaid days');
  check('basic', c.basic, Math.round(31000 * (DIM - 3) / DIM), 'basic x ' + (DIM - 3) + '/' + DIM);

  console.log('\n6. leave beyond the quota, with "beyond quota is unpaid" ON');
  console.log('   (AuditPaid has a quota of 4; LV-01 has taken 2, now takes 4 more)');
  await apply('LV-01', 'AuditPaid', YM + '-18', YM + '-21', 4);
  await call('saveSettings', { settings: { excess_leave_unpaid: 'yes' } }, token);
  c = (await costs(['LV-01']))[0];
  check('leave days', c.L, 6, '2 + 4 days taken');
  check('unpaid of those', c.unpaidLeave, 2, '6 taken, 4 in quota, so 2 beyond it');
  check('days lost', c.lop, 2, 'the 2 beyond the quota');

  console.log('\n7. the same, with the rule OFF: nothing is charged');
  await call('saveSettings', { settings: { excess_leave_unpaid: 'no' } }, token);
  c = (await costs(['LV-01']))[0];
  check('unpaid of those', c.unpaidLeave, 0, 'rule switched off');
  check('days lost', c.lop, 0, 'nothing charged');

  console.log('\n' + (bad ? '** figures that did not match their rule: ' + bad
                          : 'every figure matched the rule as written'));
  console.log('page errors:', errs.length ? errs : 'none');
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('** ' + e.message); process.exit(1); });
