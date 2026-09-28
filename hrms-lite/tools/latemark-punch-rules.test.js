/* Late marks, the times the register shows, and what counts as a punch.
 *
 *   node latemark-punch-rules.test.js http://127.0.0.1:8101
 */

const BASE = process.argv[2] || 'http://127.0.0.1:8101';
const YM = '2026-08', DIM = 31;

/* --- the rules, in words -------------------------------------------------
 *
 * Late marks      A day is late when the punch-in is after the shift start
 *                 plus its grace minutes.
 *
 *                 What they cost is a SLAB, not a rate, because that is how
 *                 the policy is written: 6 late marks is one half day, 12 is
 *                 two, 24 is three. Those steps are not evenly spaced - 24
 *                 gives three half days, not four - so "every N lates" can
 *                 never express it. Find the highest step the count has
 *                 reached and charge that many half days.
 *
 *                 So: 5 lates cost nothing. 6 to 11 cost half a day. 12 to
 *                 23 cost one day. 24 and above cost a day and a half.
 *
 * The times the
 * register shows  The first clock of the day as the in-time and the last as
 *                 the out-time, whatever recorded them - the app, the eSSL
 *                 export, or a push from another system. Not the shift's
 *                 own start and end.
 *
 * Filling blank
 * days by hand    Marks the day present with NO times. HR saying somebody
 *                 was here is not a record of when they arrived, and a
 *                 made-up 09:30 would be exactly on time by construction -
 *                 it would erase the lateness of a real 09:47 punch that
 *                 arrived afterwards.
 *
 * The punch log   Holds every punch from every source. A punch report that
 *                 shows app taps but not the biometric readers is not a
 *                 punch report.
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
  const ok = String(got) === String(want);
  if (!ok) bad++;
  console.log('   ' + label.padEnd(20) + String(got).padStart(10) + String(want).padStart(11) +
    (ok ? '    ' : ' ** ') + why);
};

(async () => {
  const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
  const token = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;

  {
    const runRows = (await call('list', { sheet: 'Payroll' }, token))
      .filter(p => String(p.month) === YM);
    for (let i = 0; i < runRows.length; i += 200) {
      await call('removeMany', { sheet: 'Payroll',
        ids: runRows.slice(i, i + 200).map(p => p.id) }, token);
    }
  }

  const shifts = await call('list', { sheet: 'Shifts' }, token);
  const general = shifts.find(s => String(s.name).trim().toLowerCase() === 'general') || shifts[0];
  const SHIFT = Object.assign({}, general, { start_time: '09:30', end_time: '18:30',
    grace_minutes: 15, full_day_hours: 8, half_day_hours: 4,
    weekly_off: 'None', saturday_policy: 'working', ot_after_minutes: 30 });
  await call('save', { sheet: 'Shifts', row: SHIFT }, token);
  await call('saveSettings', { settings: { late_mark_slab: '6:1, 12:2, 24:3',
    payroll_basis: 'calendar', payroll_rounding: '1', punch_out_mandatory: 'no',
    ot_pay_enabled: 'no', excess_leave_unpaid: 'no', geofence_enabled: 'no',
    web_punch_enabled: 'yes' } }, token);

  /* one person per late-count we care about, at the edges of every step */
  const LATES = [0, 5, 6, 11, 12, 23, 24, 30];
  const PEOPLE = LATES.map(n => 'LM-' + String(n).padStart(2, '0'));
  const mine = new Set(PEOPLE.concat(['LM-TIME']));
  for (const sheet of ['Attendance', 'Punches']) {
    const old = (await call('list', { sheet }, token))
      .filter(r => mine.has(String(r.emp_code)));
    for (let i = 0; i < old.length; i += 200) {
      await call('removeMany', { sheet, ids: old.slice(i, i + 200).map(r => r.id) }, token);
    }
  }
  for (const code of PEOPLE.concat(['LM-TIME'])) {
    await call('save', { sheet: 'Employees', row: { emp_code: code, name: 'Late ' + code,
      status: 'Active', basic: 31000, hra: 0, special_allowance: 0, other_allowance: 0,
      pf_applicable: 'no', esi_applicable: 'no', doj: '2019-01-01',
      shift: SHIFT.name, device_id: code, department: 'LATETEST' } }, token);
  }

  const rows = [];
  LATES.forEach((n, i) => {
    const code = PEOPLE[i];
    let left = n;
    for (let d = 1; d <= DIM; d++) {
      const iso = YM + '-' + ('0' + d).slice(-2);
      const late = left > 0 && (left--, true);
      rows.push({ id: code + '_' + iso, date: iso, emp_code: code, status: 'P',
        in_time: late ? '10:30' : '09:30', out_time: '18:30', hours: 9 });
    }
  });
  for (let i = 0; i < rows.length; i += 400) {
    await call('saveMany', { sheet: 'Attendance', rows: rows.slice(i, i + 400) }, token);
  }

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
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

  console.log('late marks and punches, against the rules as written\n');

  console.log('1. the slab: 6 lates = 1 half day, 12 = 2, 24 = 3');
  const stats = await p.evaluate(([codes, ym]) => {
    const want = new Set(codes);
    return S.employees.filter(e => want.has(e.emp_code)).map(e => {
      const s = attStats(ym, e.emp_code);
      const r = computePay(e, ym, null);
      return { code: e.emp_code, late: s.late, ded: s.lateDeduction,
               paid: r.paid_days, basic: r.basic };
    });
  }, [PEOPLE, YM]);
  /* the rule, worked out here from the words above and nothing else */
  const costOf = n => (n >= 24 ? 3 : n >= 12 ? 2 : n >= 6 ? 1 : 0) * 0.5;
  LATES.forEach((n, i) => {
    const x = stats.find(s => s.code === PEOPLE[i]);
    if (!x) { bad++; console.log('   ** ' + PEOPLE[i] + ' missing'); return; }
    check(n + ' late day(s)', x.late, n, 'punched in at 10:30, past 09:45');
    check('  costs', x.ded, costOf(n),
      costOf(n) === 0 ? 'below the first step' : (costOf(n) / 0.5) + ' half day(s)');
    check('  paid days', x.paid, DIM - costOf(n), DIM + ' less ' + costOf(n));
  });

  console.log('\n2. the register shows the lateness');
  const shown = await p.evaluate(([code, ym]) => {
    const cells = [];
    for (let d = 1; d <= 8; d++) {
      const node = document.getElementById('c_' + code + '_' + ym + '-' + ('0' + d).slice(-2));
      if (node) cells.push({ d, late: node.classList.contains('late'), tip: node.title });
    }
    const s = attStats(ym, code);
    return { cells, late: s.late, ded: s.lateDeduction };
  }, ['LM-06', YM]);
  const marked = shown.cells.filter(c => c.late).length;
  check('cells flagged late', marked, 6, 'the first six days were late');
  const tip = (shown.cells.find(c => c.late) || {}).tip || '';
  check('the cell says so', /late \d+m/.test(tip) ? 'yes' : 'no: "' + tip + '"', 'yes',
    'hovering a late day names the minutes');

  console.log('\n3. filling blank days by hand invents no times');
  await call('removeMany', { sheet: 'Attendance',
    ids: (await call('list', { sheet: 'Attendance' }, token))
      .filter(r => r.emp_code === 'LM-TIME').map(r => r.id) }, token);
  const filled = await p.evaluate(async ym => {
    await reload();
    go('attendance'); el('att-month').value = ym; renderAttendance();
    markAllPresent();
    const key = 'LM-TIME_' + ym + '-02';
    const d = S.attDirty[key];
    return d ? { status: d.status, inT: d.in_time, outT: d.out_time } : null;
  }, YM);
  if (!filled) { bad++; console.log('   ** nothing was filled for LM-TIME'); }
  else {
    check('status', filled.status, 'P', 'present, because HR says so');
    check('in time', filled.inT === '' ? '(none)' : filled.inT, '(none)',
      'no punch happened, so no time is invented');
    check('out time', filled.outT === '' ? '(none)' : filled.outT, '(none)',
      'no punch happened, so no time is invented');
  }
  await p.evaluate(() => { S.attDirty = {}; el('att-save').disabled = true; });

  console.log('\n4. first in and last out, from the device export');
  /* four taps on one day, deliberately out of order in the file */
  const day = YM + '-20';
  await call('ingestPunches', { punches: [
    { EmpCode: 'LM-TIME', LogDate: day, LogTime: '13:05' },
    { EmpCode: 'LM-TIME', LogDate: day, LogTime: '09:47' },
    { EmpCode: 'LM-TIME', LogDate: day, LogTime: '19:12' },
    { EmpCode: 'LM-TIME', LogDate: day, LogTime: '13:48' }
  ], source: 'essl re-export' }, token);
  const att = (await call('list', { sheet: 'Attendance' }, token))
    .find(a => a.emp_code === 'LM-TIME' && String(a.date) === day) || {};
  check('in time', att.in_time, '09:47', 'the earliest tap of the day');
  check('out time', att.out_time, '19:12', 'the latest tap of the day');
  check('not the shift', att.in_time === '09:30' ? 'shift time' : 'the real tap', 'the real tap',
    'never the shift start');

  console.log('\n5. every source counts as a punch in the log');
  const log = await call('punchLog', { from: day, to: day }, token);
  const forCode = (log.rows || []).filter(r => r.emp_code === 'LM-TIME');
  check('device taps logged', forCode.length, 4, 'all four taps of the export');
  const sources = [...new Set(forCode.map(r => String(r.source || r.device || '')))];
  console.log('   ' + 'sources seen'.padEnd(20) + JSON.stringify(sources));

  /* and an app tap lands in the same log */
  await call('saveUser', { user: { email: 'lm-time', role: 'employee', emp_code: 'LM-TIME',
    active: 'yes', password: 'pw123456' } }, token);
  const empTok = (await call('login', { email: 'lm-time', password: 'pw123456' })).token;
  await call('webPunch', { kind: 'in' }, empTok);
  const today = new Date().toISOString().slice(0, 10);
  const log2 = await call('punchLog', { from: today, to: today }, token);
  const appTaps = (log2.rows || []).filter(r => r.emp_code === 'LM-TIME');
  check('app taps logged', appTaps.length >= 1 ? 'yes' : 'no', 'yes',
    'the app writes to the same log the readers do');

  console.log('\n' + (bad ? '** figures that did not match their rule: ' + bad
                          : 'every figure matched the rule as written'));
  console.log('page errors:', errs.length ? errs : 'none');
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('** ' + e.message); process.exit(1); });
