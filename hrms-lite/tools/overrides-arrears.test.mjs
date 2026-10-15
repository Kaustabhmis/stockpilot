/* Per-person increment and bonus, and the arrears that pull everything owed
 * into payroll - checked against the rules written out here in words.
 *
 * Same rules as the other audit files: every expected figure is worked out
 * from the rule as stated, never copied from what the code printed, and the
 * cases are chosen so a wrong rule and the right one disagree.
 *
 *   node overrides-arrears.test.mjs http://127.0.0.1:8105
 */

const BASE = process.argv[2] || 'http://127.0.0.1:8105';
const JUN = '2026-06', JUL = '2026-07';          /* June has 30 days */
const FY = '2026-27';

/* ------------------------------------------------------------------ */
/* THE RULES                                                           */
/* ------------------------------------------------------------------ */

/* INCREMENT. The toolbar sets a default rise for everyone. Any one person
   can be given their own percentage or their own flat amount instead; the
   rest keep following the default. "Reset all" puts everyone back on it.
     default 8%:   OV-01 on 20,000 -> 1,600;   OV-04 on 10,000 -> 800
     OV-02 own 15% on 30,000                     -> 4,500
     OV-03 own flat 2,500                        -> 2,500                  */

/* BONUS. The rate at the top (8.33%) is everyone's default, worked on at
   most 7,000 a month for each of the 12 months on the books. One person can
   have their own rate; one can have a flat amount, which is paid even if the
   Act would not make them eligible - it is the company's own decision.
     OV-01 basic 12,000 -> 7,000 x 8.33% x 12 = 6,997
     OV-02 basic 18,000, own 20% -> 7,000 x 20% x 12 = 16,800
     OV-03 basic 25,000 (over 21,000, so not eligible), flat 5,000 -> 5,000
     OV-04 basic  6,000 -> 6,000 x 8.33% x 12 = 5,998                       */
const BONUS_CALC = 7000;

/* ARREARS, for June, posted into July's payroll. The arrear is the sum of:
     - increment back pay: the rise times the share of June now paid for,
       only for a month that has a finalised run;
     - pending pay: days the register says are owed beyond what June's
       finalised run paid, at the rate that run paid per day; somebody left
       out of the run altogether is owed every day the register shows;
     - comp-off approved but never set against a day or paid out, at one
       day's gross (June: gross / 30).
   Comp-off already set against a day, or approved for payout before the
   month's run was made, is not owed again.
   With a 10% rise:
     OV-01 20,000: rise 2,000 + one unsettled comp-off day 20,000/30 = 2,666.67
     OV-02 30,000: rise 3,000; its comp-off was set against a day -> 3,000
     OV-03 30,000: left out of June's run -> 30 days x 30,000/30 = 30,000;
                   no run row for June, so no increment back pay -> 30,000
     OV-04 10,000: June's run paid 20 of 30 days. Pending 10 days at the
                   run's own rate (6,666.67 / 20 = 333.33) = 3,333.33; the
                   rise is owed on all 30 days now paid = 1,000 -> 4,333.33
   After posting, posting again must find no pending pay and no comp-off:
   both are marked as settled. */
const PEOPLE = [
  ['OV-01', 12000, 8000],
  ['OV-02', 18000, 12000],
  ['OV-03', 25000, 5000],
  ['OV-04', 6000, 4000],
];

const call = async (action, payload, token) => {
  const r = await fetch(BASE + '/exec', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, token })
  });
  const j = await r.json();
  if (!j.ok) throw new Error(action + ': ' + j.error);
  return j.data;
};

let bad = 0, checks = 0;
const near = (a, b) => Math.abs(Number(a) - Number(b)) <= 1.01;
const check = (label, got, want, why) => {
  checks++;
  const ok = near(got, want);
  if (!ok) bad++;
  console.log('   ' + String(label).padEnd(26) +
    String(Math.round(Number(got) * 100) / 100).padStart(11) +
    String(Math.round(Number(want) * 100) / 100).padStart(11) +
    (ok ? '    ' : ' ** ') + (why || ''));
};
const same = (label, got, want, why) => {
  checks++;
  const ok = String(got) === String(want);
  if (!ok) bad++;
  console.log('   ' + String(label).padEnd(26) + String(got).padStart(22) +
    (ok ? '    ' : ' ** (want ' + want + ') ') + (why || ''));
};

(async () => {
  const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
  const token = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;

  const wipe = async (sheet, pred) => {
    const rows = (await call('list', { sheet }, token)).filter(pred);
    for (let i = 0; i < rows.length; i += 200) {
      await call('removeMany', { sheet, ids: rows.slice(i, i + 200).map(r => r.id) }, token);
    }
  };
  const mine = r => /^OV-/.test(String(r.emp_code));
  await wipe('Payroll', p => [JUN, JUL].indexOf(String(p.month)) >= 0);
  await wipe('Bonus', () => true);
  await wipe('Requests', mine);
  /* another suite may have recorded a revision for everyone on salary, which
     would rightly lower what June is taken to have paid - clear ours */
  await wipe('Increment', mine);
  await wipe('Attendance', mine);

  const shifts = await call('list', { sheet: 'Shifts' }, token);
  const general = shifts.find(s => String(s.name).trim().toLowerCase() === 'general') || shifts[0];
  if (general) {
    await call('save', { sheet: 'Shifts', row: Object.assign({}, general,
      { weekly_off: 'Sun', saturday_policy: 'working' }) }, token);
  }
  await call('saveSettings', { settings: {
    payroll_basis: 'calendar', payroll_rounding: '1', late_marks_per_halfday: '0',
    punch_out_mandatory: 'no', ot_pay_enabled: 'no', excess_leave_unpaid: 'no',
    bonus_rate_pct: '8.33', bonus_eligibility_ceiling: '21000',
    bonus_calc_ceiling: String(BONUS_CALC), bonus_min_days: '30',
    co_payout_enabled: 'yes', co_validity_days: '0', arrears_ledger: ''
  } }, token);

  for (const [code, basic, hra] of PEOPLE) {
    await call('save', { sheet: 'Employees', row: {
      emp_code: code, name: 'Override ' + code, status: 'Active', wage_type: 'Salary',
      basic, hra, special_allowance: 0, other_allowance: 0,
      pf_applicable: 'no', esi_applicable: 'no', doj: '2020-01-01', exit_date: '',
      department: 'OVR' } }, token);
  }

  /* present every day of June and July that is not a Sunday */
  const att = [];
  for (const [code] of PEOPLE) {
    for (const m of [JUN, JUL]) {
      const last = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
      for (let d = 1; d <= last; d++) {
        const iso = m + '-' + ('0' + d).slice(-2);
        if (new Date(iso + 'T00:00:00Z').getUTCDay() === 0) continue;
        att.push({ id: code + '_' + iso, date: iso, emp_code: code, status: 'P',
          in_time: '09:00', out_time: '18:00', hours: 9 });
      }
    }
  }
  for (let i = 0; i < att.length; i += 400) {
    await call('saveMany', { sheet: 'Attendance', rows: att.slice(i, i + 400) }, token);
  }

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto(BASE + '/index.html');
  await p.evaluate(u => localStorage.setItem('hrms_lite_api', u), BASE + '/exec');
  await p.reload(); await p.waitForTimeout(700);
  await p.fill('#in-email', 'admin@company.com'); await p.fill('#in-pass', 'admin123');
  await p.click('#btn-login');
  await p.waitForSelector('#view-dashboard', { state: 'visible', timeout: 25000 });
  await p.waitForTimeout(1200);
  const month = async ym => {
    await p.evaluate(m => ensureMonths([m]), ym);
    await p.waitForFunction(m => haveMonth(m), ym, { timeout: 20000 });
  };
  await month(JUN); await month(JUL);
  await p.evaluate(() => go('payroll')); await p.waitForTimeout(400);
  const clickModal = async name => {
    await p.locator('#modal').getByRole('button', { name, exact: true }).click();
    await p.waitForTimeout(1500);
  };

  console.log('   ' + 'figure'.padEnd(26) + 'seen'.padStart(11) + 'rule'.padStart(11) + '    why');

  /* ================= INCREMENT ================= */
  console.log('\nincrement: a default for everyone, overridden person by person');
  await p.evaluate(() => payTab('increment')); await p.waitForTimeout(400);
  await p.evaluate(() => {
    el('inc-from').value = '2026-10'; el('inc-mode').value = 'pct'; el('inc-val').value = '8';
    el('inc-who').value = 'salary'; el('inc-spread').value = 'prorata'; S.incEdit = {};
    renderIncrement();
    incSet('OV-02', 'type', 'pct'); incSet('OV-02', 'value', '15');
    incSet('OV-03', 'type', 'amt'); incSet('OV-03', 'value', '2500');
  });
  await p.waitForTimeout(300);
  let inc = await p.evaluate(() => incrementRows(true).filter(r => /^OV-/.test(r.emp_code))
    .map(r => ({ code: r.emp_code, rise: r.rise, custom: r.basis.custom, label: incBasisLabel(r.basis) })));
  const incOf = c => inc.find(r => r.code === c) || { rise: NaN };
  check('OV-01 default 8%', incOf('OV-01').rise, 1600, '8% of 20,000');
  check('OV-02 own 15%', incOf('OV-02').rise, 4500, '15% of 30,000');
  check('OV-03 own flat', incOf('OV-03').rise, 2500, 'a flat 2,500');
  check('OV-04 default 8%', incOf('OV-04').rise, 800, '8% of 10,000');
  same('OV-02 basis recorded', incOf('OV-02').label, '15%', 'what the revision row will say');
  const tableHasPicker = await p.evaluate(() =>
    el('inc-table').querySelectorAll('select.grid-in').length >= 4);
  same('a picker on every row', tableHasPicker, true, 'Default / Percentage / Flat amount');
  await p.evaluate(() => { el('inc-val').value = '10'; renderIncrement(); });
  inc = await p.evaluate(() => incrementRows(true).filter(r => /^OV-/.test(r.emp_code))
    .map(r => ({ code: r.emp_code, rise: r.rise })));
  check('default moved to 10%', incOf('OV-01').rise, 2000, 'OV-01 follows the default');
  check('override stays put', incOf('OV-02').rise, 4500, 'OV-02 keeps its own 15%');
  await p.evaluate(() => incResetAll());
  inc = await p.evaluate(() => incrementRows(true).filter(r => /^OV-/.test(r.emp_code))
    .map(r => ({ code: r.emp_code, rise: r.rise })));
  check('reset: OV-02 on default', incOf('OV-02').rise, 3000, '10% of 30,000 again');
  check('reset: OV-03 on default', incOf('OV-03').rise, 3000, '10% of 30,000 again');

  /* ================= BONUS ================= */
  console.log('\nbonus: a default rate, one person at their own rate, one on a flat amount');
  await p.evaluate(() => payTab('bonus')); await p.waitForTimeout(400);
  await p.evaluate(fy => { el('bonus-fy').value = fy; el('bonus-rate').value = '8.33'; S.bonusEdit = {}; }, FY);
  await p.evaluate(() => generateBonus());
  await p.waitForFunction(() => S.bonusDraft && S.bonusDraft.rows.length, null, { timeout: 60000 });
  await p.evaluate(() => {
    bonusSet('OV-02', 'type', 'pct'); bonusSet('OV-02', 'value', '20');
    bonusSet('OV-03', 'type', 'amt'); bonusSet('OV-03', 'value', '5000');
  });
  const bon = await p.evaluate(() => S.bonusDraft.rows.filter(r => /^OV-/.test(r.emp_code)));
  const bOf = c => bon.find(r => r.emp_code === c) || { amount: NaN };
  check('OV-01 default 8.33%', bOf('OV-01').amount, BONUS_CALC * 0.0833 * 12, '7,000 x 8.33% x 12');
  check('OV-02 own 20%', bOf('OV-02').amount, BONUS_CALC * 0.20 * 12, '7,000 x 20% x 12');
  check('OV-03 flat, ineligible', bOf('OV-03').amount, 5000, 'paid although the Act would not');
  same('OV-03 included', bOf('OV-03').eligible, true, 'a flat amount is the company\'s call');
  check('OV-04 default 8.33%', bOf('OV-04').amount, 6000 * 0.0833 * 12, '6,000 under the ceiling');

  await p.evaluate(() => saveBonus()); await p.waitForTimeout(500);
  await clickModal('Finalise');
  await p.waitForTimeout(1500);
  const savedB = (await call('list', { sheet: 'Bonus' }, token)).filter(mine);
  const sb = c => savedB.find(r => r.emp_code === c) || {};
  console.log('\nbonus, after being saved and read back');
  check('OV-02 saved rate', sb('OV-02').rate_pct, 20, 'their own rate is on the row');
  check('OV-03 saved amount', sb('OV-03').amount, 5000, 'the flat amount');
  same('OV-03 saved note', sb('OV-03').note, 'flat amount', 'why it differs from the Act');
  same('OV-01 saved note', sb('OV-01').note || '', '', 'on the default, no note');

  /* ================= ARREARS ================= */
  console.log('\narrears for June: increment + pending pay + unsettled comp-off');
  /* a finalised June run for everyone */
  await p.evaluate(() => payTab('salary')); await p.waitForTimeout(300);
  await p.evaluate(m => { el('pay-month').value = m; renderPayroll(); }, JUN);
  await p.waitForTimeout(600);
  await p.evaluate(() => generatePayroll()); await p.waitForTimeout(1500);
  await p.evaluate(() => { writePayroll(S.payDraft.rows.map(r =>
    Object.assign({}, r, { status: 'Finalised' }))); S.payDraft = null; });
  await p.waitForTimeout(2500);

  /* OV-04's June row as though the run had paid only 20 of 30 days;
     OV-03 left out of the run altogether */
  const june = (await call('list', { sheet: 'Payroll' }, token)).filter(r => String(r.month) === JUN);
  const r04 = june.find(r => r.emp_code === 'OV-04'), r03 = june.find(r => r.emp_code === 'OV-03');
  await call('save', { sheet: 'Payroll', row: Object.assign({}, r04, {
    paid_days: 20, lop_days: 10, basic: 4000, hra: 2666.67, gross: 6666.67 }) }, token);
  await call('removeMany', { sheet: 'Payroll', ids: [r03.id] }, token);

  /* comp-off: OV-01 approved with no choice made (unsettled); OV-02 set
     against a day (settled); OV-04 paid out before the run was made (settled) */
  const runDay = String(r04.generated_at || '').slice(0, 10) || '2026-10-01';
  const co = (code, extra) => Object.assign({
    id: 'COT_' + code, emp_code: code, type: 'CO', date: '2026-06-07', days: 1,
    status: 'Approved', applied_at: '2026-06-08', decided_by: 'admin@company.com',
    decided_at: '2026-06-08', mode: '', level: 1 }, extra);
  await call('saveMany', { sheet: 'Requests', rows: [
    co('OV-01', {}),
    co('OV-02', { mode: 'adjust', adjust_date: '2026-06-15' }),
    co('OV-04', { mode: 'payout', decided_at: runDay })
  ] }, token);

  await p.evaluate(() => reload()); await p.waitForTimeout(3000);
  await month(JUN); await month(JUL);
  await p.evaluate(() => go('payroll')); await p.waitForTimeout(300);
  await p.evaluate(() => payTab('arrears')); await p.waitForTimeout(400);
  const arrearsNow = async mode => {
    await p.evaluate(([m, md]) => {
      el('arr-from').value = m; el('arr-to').value = m;
      el('arr-mode').value = md; el('arr-val').value = '10';
      el('arr-pend').checked = true; el('arr-co').checked = true; S.arrOther = {};
      renderArrears();
    }, [JUN, mode]);
    await p.waitForTimeout(900);
    return p.evaluate(() => arrearRows().rows.filter(r => /^OV-/.test(r.emp_code)).map(r => ({
      code: r.emp_code, inc: r.inc, pend: r.pendTotal, co: r.co.amount, coDays: r.co.days, total: r.total })));
  };
  let arr = await arrearsNow('pct');
  const aOf = c => arr.find(r => r.code === c) || { inc: 0, pend: 0, co: 0, total: 0 };
  check('OV-01 increment', aOf('OV-01').inc, 2000, '10% of 20,000, whole month paid');
  check('OV-01 comp-off', aOf('OV-01').co, 20000 / 30, 'one unsettled day, gross / 30');
  check('OV-01 total', aOf('OV-01').total, 2000 + 20000 / 30, 'increment + comp-off');
  check('OV-02 comp-off', aOf('OV-02').co, 0, 'set against a day, so nothing owed');
  check('OV-02 total', aOf('OV-02').total, 3000, '10% of 30,000');
  check('OV-03 pending', aOf('OV-03').pend, 30000, 'left out of the run: 30 days');
  check('OV-03 increment', aOf('OV-03').inc, 0, 'no run row, nothing to raise');
  check('OV-04 pending', aOf('OV-04').pend, 6666.67 / 20 * 10, '10 days at the run\'s own rate');
  check('OV-04 increment', aOf('OV-04').inc, 1000, 'rise on all 30 days now paid');
  check('OV-04 comp-off', aOf('OV-04').co, 0, 'paid out before the run was made');
  check('OV-04 total', aOf('OV-04').total, 1000 + 6666.67 / 2, 'increment + pending');

  /* post into July */
  const before = arr;
  await p.evaluate(() => postArrears()); await p.waitForTimeout(500);
  await p.evaluate(m => { el('arr-into').value = m; }, JUL);
  await clickModal('Post');
  await p.waitForTimeout(2500);
  const draft = await p.evaluate(m => S.payDraft && S.payDraft.month === m
    ? S.payDraft.rows.filter(r => /^OV-/.test(r.emp_code)).map(r => ({ code: r.emp_code, arrears: r.arrears }))
    : [], JUL);
  console.log('\nposted to July\'s payroll');
  for (const c of ['OV-01', 'OV-02', 'OV-03', 'OV-04']) {
    const d = draft.find(x => x.code === c);
    const want = (before.find(x => x.code === c) || { total: 0 }).total;
    check(c + ' arrears in payroll', d ? d.arrears : NaN, want, 'the whole arrear, in the Arrears column');
  }

  /* posting again must not pay pending days or comp-off a second time */
  await p.waitForTimeout(1500);
  const reqs = (await call('list', { sheet: 'Requests' }, token)).filter(mine);
  same('OV-01 comp-off marked', (reqs.find(r => r.emp_code === 'OV-01') || {}).mode, 'arrear', 'paid as arrear');
  await p.evaluate(() => payTab('arrears')); await p.waitForTimeout(400);
  arr = await arrearsNow('none');
  check('again: OV-01 comp-off', aOf('OV-01').co, 0, 'already paid as an arrear');
  check('again: OV-03 pending', aOf('OV-03').pend, 0, 'those days are settled');
  check('again: OV-04 pending', aOf('OV-04').pend, 0, 'those days are settled');

  if (errs.length) { bad++; console.log('\npage errors **\n  ' + errs.join('\n  ')); }
  await b.close();
  console.log('\n' + checks + ' checks, ' + bad + ' wrong');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('** ' + e.message); process.exit(1); });
