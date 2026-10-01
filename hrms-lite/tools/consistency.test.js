/* The same month, read four ways, must give the same answer.
 *
 * The register, the payroll run, the reports and the employee's own phone
 * are four different pieces of code looking at one month. If they disagree,
 * one of them is lying to somebody - and the employee only ever sees the
 * phone, so that is the one that must not be wrong.
 *
 *   node consistency.test.js http://127.0.0.1:8101
 */

const BASE = process.argv[2] || 'http://127.0.0.1:8101';
const YM = '2026-08', DIM = 31;

const call = async (action, payload, token) => {
  const r = await fetch(BASE + '/exec', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, token }) });
  const j = await r.json();
  if (!j.ok) throw new Error(action + ': ' + j.error);
  return j.data;
};

let bad = 0;
const agree = (what, a, aLabel, b, bLabel) => {
  const ok = Math.abs(Number(a) - Number(b)) <= 1;
  if (!ok) bad++;
  console.log('   ' + what.padEnd(18) + aLabel.padEnd(14) + String(a).padStart(9) + '   ' +
    bLabel.padEnd(14) + String(b).padStart(9) + (ok ? '    agree' : '  ** DISAGREE'));
};

(async () => {
  const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
  const token = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;

  const shifts = await call('list', { sheet: 'Shifts' }, token);
  const general = shifts.find(s => String(s.name).trim().toLowerCase() === 'general') || shifts[0];
  await call('save', { sheet: 'Shifts', row: Object.assign({}, general,
    { start_time: '09:30', end_time: '18:30', grace_minutes: 15, full_day_hours: 8,
      half_day_hours: 4, weekly_off: 'Sun', saturday_policy: 'working',
      ot_after_minutes: 30 }) }, token);
  await call('saveSettings', { settings: { payroll_basis: 'calendar', payroll_rounding: '1',
    late_marks_per_halfday: '0', punch_out_mandatory: 'no', ot_pay_enabled: 'no',
    excess_leave_unpaid: 'no', sandwich_rule: 'no', pf_wage_ceiling: '15000',
    pf_employee_pct: '12', pf_employer_pct: '13', esi_wage_ceiling: '21000',
    esi_employee_pct: '0.75', esi_employer_pct: '3.25' } }, token);

  /* one person, one month, deliberately not a clean one: absences, a half
     day and an unmarked day, so the numbers are not all the same */
  const CODE = 'CS-01', PW = 'pw123456';
  /* A finalised run locks its month's attendance - correctly - so a second
     run of this file must reopen it before it can lay the month out again. */
  const runRows = (await call('list', { sheet: 'Payroll' }, token))
    .filter(p => String(p.month) === YM);
  if (runRows.length) {
    for (let i = 0; i < runRows.length; i += 200) {
      await call('removeMany', { sheet: 'Payroll', ids: runRows.slice(i, i + 200).map(p => p.id) }, token);
    }
  }
  const old = (await call('list', { sheet: 'Attendance' }, token)).filter(a => a.emp_code === CODE);
  if (old.length) await call('removeMany', { sheet: 'Attendance', ids: old.map(a => a.id) }, token);
  await call('save', { sheet: 'Employees', row: { emp_code: CODE, name: 'Consistency Case',
    status: 'Active', basic: 18000, hra: 7200, special_allowance: 1000, other_allowance: 0,
    pf_applicable: 'yes', esi_applicable: 'yes', doj: '2019-01-01',
    shift: general.name, department: 'CONSIST' } }, token);
  await call('saveUser', { user: { email: CODE.toLowerCase(), role: 'employee',
    emp_code: CODE, active: 'yes', password: PW } }, token);

  const rows = [];
  for (let d = 1; d <= DIM; d++) {
    const iso = YM + '-' + ('0' + d).slice(-2);
    const sunday = new Date(iso + 'T00:00:00').getDay() === 0;
    let status = 'P';
    if (sunday) status = 'WO';
    else if (d === 4 || d === 5) status = 'A';
    else if (d === 6) status = 'HD';
    else if (d === 7) status = '';            /* left unmarked on purpose */
    if (!status) continue;
    rows.push({ id: CODE + '_' + iso, date: iso, emp_code: CODE, status: status,
      in_time: (status === 'P' || status === 'HD') ? '09:30' : '',
      out_time: status === 'P' ? '18:30' : status === 'HD' ? '13:30' : '',
      hours: status === 'P' ? 9 : status === 'HD' ? 4 : 0 });
  }
  await call('saveMany', { sheet: 'Attendance', rows }, token);

  const b = await chromium.launch();

  /* ---- the office screen: register, payroll and the reports ---- */
  const w = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = []; w.on('pageerror', e => errs.push('web: ' + e));
  await w.goto(BASE + '/index.html');
  await w.evaluate(u => localStorage.setItem('hrms_lite_api', u), BASE + '/exec');
  await w.reload(); await w.waitForTimeout(700);
  await w.fill('#in-email', 'admin@company.com'); await w.fill('#in-pass', 'admin123');
  await w.click('#btn-login');
  await w.waitForSelector('#view-dashboard', { state: 'visible', timeout: 25000 });
  await w.waitForTimeout(1500);
  /* This suite pins itself to a fixed month, but the register comes down a
     month at a time and only the last couple arrive at sign-in. Ask for the
     month under test the way the screens do, or every figure reads zero. */
  const webMonth = async () => {
    await w.evaluate(ym => ensureMonths([ym]), YM);
    await w.waitForFunction(ym => haveMonth(ym), YM, { timeout: 20000 });
  };
  await webMonth();

  const web = await w.evaluate(([code, ym]) => {
    const e = empByCode(code);
    const s = attStats(ym, code);
    const pay = computePay(e, ym, null);
    /* the monthly muster, the statutory return and the salary register, as
       the reports screen builds them */
    const monthly = reportMonthly(ym);
    const statutory = reportStatutory(ym);
    const register = reportRegister(ym);
    const findRow = spec => (spec.rows || []).find(r => r.some &&
      r.some(c => String(c) === code) || (Array.isArray(r) && r.indexOf(code) >= 0));
    const num = v => Number(String(v == null ? 0 : v).replace(/[^0-9.\-]/g, '')) || 0;
    return {
      register: { paid: s.paid, lop: s.lop, present: s.P, absent: s.A, half: s.HD, blank: s.blank },
      payroll: { paid: pay.paid_days, gross: pay.gross, pf: pay.pf, esi: pay.esi,
                 pt: pay.pt, ded: pay.total_deduction, net: pay.net },
      monthlyRow: findRow(monthly) ? findRow(monthly).map(String) : null,
      statutoryRow: findRow(statutory) ? findRow(statutory).map(String) : null,
      registerRow: findRow(register) ? findRow(register).map(String) : null,
      n: num
    };
  }, [CODE, YM]);

  /* ---- the phone, as the employee ---- */
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const ph = await ctx.newPage();
  ph.on('pageerror', e => errs.push('app: ' + e));
  await ph.route('**/app/index.html', async route => {
    const res = await route.fetch(); let t = await res.text();
    /* Point the phone app at this test server, whatever address it ships
       with. Matching one provider's URL meant the day the app was pointed
       somewhere else, this test quietly started driving a phone that could
       not reach anything. */
    t = t.replace(/^API = '[^']*';/m, "API = '" + BASE + "/exec';");
    await route.fulfill({ response: res, body: t,
      headers: Object.assign({}, res.headers(), { 'content-type': 'text/html' }) });
  });
  await ph.goto(BASE + '/app/index.html'); await ph.waitForTimeout(1000);
  await ph.fill('#em', CODE); await ph.fill('#pw', PW);
  await ph.click('#signin');
  await ph.waitForSelector('#app', { state: 'visible', timeout: 25000 });
  await ph.waitForTimeout(2000);

  /* Page the phone back to the month under test, the way the employee would
     by swiping the calendar. loadMonth fires a fetch and returns nothing, so
     wait for the rows to land rather than for the call. */
  await ph.evaluate(ym => { if (typeof loadMonth === 'function') loadMonth(ym); }, YM);
  await ph.waitForFunction(ym => S.haveMonth && S.haveMonth[ym], YM, { timeout: 20000 })
    .catch(() => {});
  await ph.waitForTimeout(800);

  const phone = await ph.evaluate(ym => {
    /* the phone keeps the register in S.att */
    const mine = (S.att || []).filter(a => String(a.date).slice(0, 7) === ym);
    const count = st => mine.filter(a => String(a.status) === st).length;
    const slip = (S.payroll || []).find(p => String(p.month) === ym) || null;
    return { rows: mine.length, present: count('P'), absent: count('A'), half: count('HD'),
             wo: count('WO'), slip: slip && { paid: Number(slip.paid_days),
               gross: Number(slip.gross), net: Number(slip.net) } };
  }, YM);

  console.log('one month, read four ways\n');
  console.log('the month as marked: ' + (DIM) + ' days, 2 absent, 1 half day, 1 left unmarked,');
  console.log('Sundays off; PF and ESI both apply.\n');

  console.log('1. the register and the payroll run');
  agree('paid days', web.register.paid, 'register', web.payroll.paid, 'payroll');

  console.log('\n2. the register and what the employee sees on the phone');
  agree('present days', web.register.present, 'register', phone.present, 'phone');
  agree('absent days', web.register.absent, 'register', phone.absent, 'phone');
  agree('half days', web.register.half, 'register', phone.half, 'phone');

  console.log('\n3. the payroll run and the reports');
  const n = v => Number(String(v == null ? 0 : v).replace(/[^0-9.\-]/g, '')) || 0;
  if (!web.monthlyRow) { bad++; console.log('   ** this person is not in the monthly muster'); }
  else {
    const paidInMuster = web.monthlyRow.map(n).find(v => Math.abs(v - web.payroll.paid) <= 0.01);
    const ok = paidInMuster !== undefined;
    if (!ok) bad++;
    console.log('   ' + 'paid days'.padEnd(18) + 'payroll'.padEnd(14) +
      String(web.payroll.paid).padStart(9) + '   muster       ' +
      (ok ? String(paidInMuster).padStart(8) + '     agree' : '   ** not found in the row'));
  }
  if (!web.statutoryRow) { bad++; console.log('   ** this person is not in the statutory return'); }
  else {
    /* the return's columns are fixed: code, name, UAN, ESIC, basic, PF,
       PF employer, ESI, ESI employer, P.Tax, TDS. Check those columns, not
       "is this number somewhere in the row" - a loose search once matched a
       dash against a zero and called it agreement. */
    const COL = { basic: 4, pf: 5, pfEr: 6, esi: 7, esiEr: 8, pt: 9 };
    [['basic', web.payroll.basic === undefined ? null : null],
     ['PF', web.payroll.pf, COL.pf], ['ESI', web.payroll.esi, COL.esi],
     ['P.Tax', web.payroll.pt, COL.pt]].forEach(([label, want, col]) => {
      if (col === undefined || want === null) return;
      agree(label, want, 'payroll', n(web.statutoryRow[col]), 'statutory col ' + col);
    });
  }

  /* Finalise the run, then look again: the payslip the employee is handed is
     the whole point, and until a run is saved there is nothing to compare. */
  console.log('\n4. the payslip the employee is shown, after the run is finalised');
  await w.evaluate(ym => {
    go('payroll'); el('pay-month').value = ym; renderPayroll();
  }, YM);
  await w.waitForTimeout(2000);
  await w.evaluate(() => generatePayroll());
  await w.waitForTimeout(2000);
  const saved = await w.evaluate(() => {
    if (!S.payDraft) return { ok: false, why: 'no draft was generated' };
    const rows = S.payDraft.rows.map(r => Object.assign({}, r, { status: 'Finalised' }));
    return api('saveMany', { sheet: 'Payroll', rows: rows })
      .then(() => ({ ok: true, n: rows.length })).catch(e => ({ ok: false, why: e.message }));
  });
  if (!saved.ok) { bad++; console.log('   ** could not finalise: ' + saved.why); }
  else {
    console.log('   finalised ' + saved.n + ' payslip rows');
    /* the employee signs in afresh and reads their own slip */
    await ph.evaluate(() => reload());
    await ph.waitForTimeout(2500);
    const slip = await ph.evaluate(ym => {
      const s = (S.slips || []).find(p => String(p.month) === ym);
      return s ? { paid: Number(s.paid_days), gross: Number(s.gross),
                   pf: Number(s.pf), ded: Number(s.total_deduction), net: Number(s.net) } : null;
    }, YM);
    if (!slip) { bad++; console.log('   ** the employee cannot see their own payslip'); }
    else {
      agree('paid days', web.payroll.paid, 'payroll', slip.paid, 'phone slip');
      agree('gross', web.payroll.gross, 'payroll', slip.gross, 'phone slip');
      agree('PF', web.payroll.pf, 'payroll', slip.pf, 'phone slip');
      agree('net', web.payroll.net, 'payroll', slip.net, 'phone slip');
      agree('slip adds up', slip.net, 'net shown', slip.gross - slip.ded, 'gross - ded');

      /* and it has to be ON THE SCREEN, not merely in memory: the sign-in
         screen promises payslips, so the Me tab must actually show one */
      const onScreen = await ph.evaluate(() => {
        go('me');
        const card = [...document.querySelectorAll('#v-me .card')]
          .find(c => /payslip/i.test(c.querySelector('h3') ? c.querySelector('h3').textContent : ''));
        if (!card) return { card: false };
        const rows = [...card.querySelectorAll('.rows > div')].map(d => d.textContent.trim());
        showSlip(0);
        const sheet = document.getElementById('panel').textContent.replace(/\s+/g, ' ');
        return { card: true, rows, sheet };
      });
      if (!onScreen.card) { bad++; console.log('   ** there is no payslips card on the Me tab'); }
      else {
        const shown = onScreen.rows.join(' | ');
        const hasMonth = /Aug 2026/.test(shown);
        if (!hasMonth) bad++;
        console.log('   ' + 'on the Me tab'.padEnd(18) + (hasMonth ? '    ' : ' ** ') + shown);
        const netText = String(slip.net).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
        const opens = onScreen.sheet.indexOf('Net paid') >= 0;
        if (!opens) bad++;
        console.log('   ' + 'the breakdown'.padEnd(18) + (opens ? '    opens and shows the net'
                                                                : ' ** did not open'));
      }
    }
  }

  console.log('\n5. the payslip adds up');
  agree('net', web.payroll.net, 'as printed', web.payroll.gross - web.payroll.ded,
    'gross - ded');

  console.log('\n' + (bad ? '** disagreements: ' + bad : 'every view agrees'));
  console.log('page errors:', errs.length ? errs : 'none');
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('** ' + e.message); process.exit(1); });
