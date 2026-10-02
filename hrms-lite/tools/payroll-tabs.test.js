/* The five payroll tabs added beside Salary - Wages, Increment, Arrears,
 * Bonus and Gratuity - checked against the rules written out here in words.
 *
 * Same two rules as payroll-rules.test.js, for the same reason:
 *
 *   1. Every expected figure is worked out from the rule as stated in the
 *      comment above it. Never by running the code and writing down what
 *      came out.
 *   2. Every case is awkward on purpose - somebody a month either side of a
 *      threshold, a part month, a ceiling, a leaver. A clean case proves
 *      nothing, because most wrong rules agree with the right one there.
 *
 * It also checks that a run SURVIVES being saved. The figures being right on
 * screen is half the job; the other half is that the same figures come back
 * after they have been through the backend, which is where a column that
 * does not exist, or a month filed under the wrong key, shows up.
 *
 *   node payroll-tabs.test.js http://127.0.0.1:8101
 */

const BASE = process.argv[2] || 'http://127.0.0.1:8101';
const YM = '2026-08', DIM = 31;        /* a 31-day month, five Sundays */
const ASAT = '2026-10-01';             /* the day gratuity is worked out to */

/* ------------------------------------------------------------------ */
/* THE RULES                                                           */
/* ------------------------------------------------------------------ */

/* WAGES. A worker on daily rates is paid a rate times the days the company
   pays for - present, half days at a half, plus holidays, weekly offs and
   approved leave. Basic, DA and HRA each have their own rate.
     PF   12% of (basic + DA), on at most a flat 15,000. The ceiling is a
          monthly figure and does not shrink with the days worked.
     ESI  0.75% of gross, and only if gross is within 21,000.
     PT   a slab on gross, never prorated. */
const PF_CEILING = 15000, PF_PCT = 0.12, ESI_CEILING = 21000, ESI_PCT = 0.0075;
const ptaxOn = g => g <= 10000 ? 0 : g <= 15000 ? 110 : g <= 25000 ? 130 : g <= 40000 ? 150 : 200;

/* code, daily, da, hra, days the register will give them, why it matters */
const WAGE_CASES = [
  ['WG-01', 420,  60,  90, 31, 'a full month - basic+DA 14,880, just inside the PF ceiling'],
  ['WG-02', 500, 100, 100, 31, 'basic+DA 18,600 - over the PF ceiling, so PF stops at 15,000'],
  ['WG-03', 300,  40,  60, 20, 'eleven days lost - PF follows what was earned, the ceiling does not move'],
  ['WG-04', 700, 150, 150, 31, 'gross 31,000 - outside ESI, and a higher P.Tax slab'],
];

/* ARREARS. A revision effective from a past month pays the difference
   between what somebody should have had and what they were actually paid.
   "Should have had" is the rise prorated by the days that month's saved run
   paid them for. A month with no saved run pays nothing: there is nothing
   to compare against, and inventing one would pay twice. */

/* BONUS. Payment of Bonus Act: 8.33% of at most 7,000 a month, for anyone
   drawing up to 21,000 a month, for each month of the year they were on the
   books, provided they worked at least 30 days. */
const BONUS_RATE = 0.0833, BONUS_ELIG = 21000, BONUS_CALC = 7000;

/* GRATUITY. Fifteen days of the last drawn basic + DA for every completed
   year, on a 26-day month, once the qualifying service is served. A part
   year of six months or more counts as a whole one. Capped.
     wage x 15/26 x years
   Qualifying service is read from settings - this file sets it to one year,
   which is what the workspace now ships with. Eligibility is on the years
   ACTUALLY completed, not on the rounded-up figure: four years nine months
   is four completed years, even though it is paid as five. */
const GRAT_DAYS = 15, GRAT_MONTH = 26, GRAT_CEIL = 2000000, GRAT_MIN_YEARS = 1;

/* code, monthly basic, doj, exit, why it matters */
const GRAT_CASES = [
  ['GR-01', 20000, '2025-11-15', '', 'ten months - under a year, nothing due'],
  ['GR-02', 20000, '2025-10-01', '', 'one year exactly - one year counted'],
  ['GR-03', 20000, '2025-04-01', '', 'one year six months - six months rounds up to two'],
  ['GR-04', 20000, '2025-05-01', '', 'one year five months - under six months, stays at one'],
  ['GR-05', 20000, '2016-10-01', '2026-09-30', 'a leaver - worked to the exit date, not to today'],
  ['GR-06', 500000, '1996-01-01', '', 'thirty-one years on a big basic - the cap bites'],
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
const near = (a, b) => Math.abs(Number(a) - Number(b)) <= 1.01;   /* a rupee of rounding */
const check = (label, got, want, why) => {
  checks++;
  const ok = near(got, want);
  if (!ok) bad++;
  console.log('   ' + String(label).padEnd(22) +
    String(Math.round(Number(got))).padStart(9) +
    String(Math.round(Number(want))).padStart(9) +
    (ok ? '    ' : ' ** ') + (why || ''));
};

/* whole months between two dates, which is what the six-month rule needs */
function monthsBetween(from, to) {
  const a = new Date(from + 'T00:00:00Z'), b = new Date(to + 'T00:00:00Z');
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

(async () => {
  const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
  const token = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;

  /* A finalised run locks its month. This file lays the month out itself, so
     clear anything already filed for it first. */
  const wipe = async (sheet, pred) => {
    const rows = (await call('list', { sheet }, token)).filter(pred);
    for (let i = 0; i < rows.length; i += 200) {
      await call('removeMany', { sheet, ids: rows.slice(i, i + 200).map(r => r.id) }, token);
    }
  };
  await wipe('Payroll', p => String(p.month) === YM || String(p.month).indexOf('FY') === 0);
  /* Bonus, gratuity and increments each keep their own tab now, so each
     has to be cleared too - a run left behind by the last pass would be
     read as 'already finalised' and the generate step would be skipped. */
  await wipe('Bonus', () => true);
  await wipe('Gratuity', () => true);
  await wipe('Increment', () => true);

  /* Pin every rule this file depends on, rather than inheriting whatever the
     workspace was left in by another suite. */
  const shifts = await call('list', { sheet: 'Shifts' }, token);
  const general = shifts.find(s => String(s.name).trim().toLowerCase() === 'general') || shifts[0];
  if (general) {
    await call('save', { sheet: 'Shifts', row: Object.assign({}, general,
      { weekly_off: 'Sun', saturday_policy: 'working' }) }, token);
  }
  await call('saveSettings', { settings: {
    payroll_basis: 'calendar', payroll_rounding: '1', late_marks_per_halfday: '0',
    punch_out_mandatory: 'no', ot_pay_enabled: 'no', excess_leave_unpaid: 'no',
    pf_wage_ceiling: String(PF_CEILING), pf_employee_pct: '12', pf_employer_pct: '13',
    esi_wage_ceiling: String(ESI_CEILING), esi_employee_pct: '0.75', esi_employer_pct: '3.25',
    bonus_rate_pct: '8.33', bonus_eligibility_ceiling: String(BONUS_ELIG),
    bonus_calc_ceiling: String(BONUS_CALC), bonus_min_days: '30',
    gratuity_min_years: String(GRAT_MIN_YEARS), gratuity_prorata: 'no',
    gratuity_days_per_year: String(GRAT_DAYS), gratuity_month_days: String(GRAT_MONTH),
    gratuity_ceiling: String(GRAT_CEIL)
  } }, token);

  /* ---- people ---- */
  for (const [code, daily, da, hra] of WAGE_CASES) {
    await call('save', { sheet: 'Employees', row: {
      emp_code: code, name: 'Wage ' + code, status: 'Active', wage_type: 'Wages',
      daily_rate: daily, da_rate: da, hra_rate: hra, basic: 0, hra: 0,
      special_allowance: 0, other_allowance: 0,
      pf_applicable: 'yes', esi_applicable: 'yes', doj: '2020-01-01', department: 'TABS' } }, token);
  }
  for (const [code, basic, doj, exit] of GRAT_CASES) {
    await call('save', { sheet: 'Employees', row: {
      emp_code: code, name: 'Grat ' + code, status: 'Active', wage_type: 'Salary',
      basic, hra: 0, special_allowance: 0, other_allowance: 0,
      pf_applicable: 'no', esi_applicable: 'no', doj, exit_date: exit,
      department: 'TABS' } }, token);
  }
  /* one salaried person for the arrears case, present every day of YM */
  await call('save', { sheet: 'Employees', row: {
    emp_code: 'AR-01', name: 'Arrear AR-01', status: 'Active', wage_type: 'Salary',
    basic: 12000, hra: 8000, special_allowance: 0, other_allowance: 0,
    pf_applicable: 'no', esi_applicable: 'no', doj: '2019-01-01', department: 'TABS' } }, token);

  /* ---- the register: present every day that is not a Sunday ---- */
  const att = [];
  const codes = WAGE_CASES.map(c => c[0]).concat(['AR-01']);
  for (const [code, , , , days] of WAGE_CASES) {
    /* WG-03 is given eleven days of absence so the ceiling can be seen to
       hold while earnings fall. The rest are present throughout. */
    let absencesLeft = 31 - days;
    for (let d = 1; d <= DIM; d++) {
      const iso = YM + '-' + ('0' + d).slice(-2);
      if (new Date(iso + 'T00:00:00Z').getUTCDay() === 0) continue;   /* Sunday: a paid off */
      const absent = absencesLeft > 0 && (absencesLeft--, true);
      att.push({ id: code + '_' + iso, date: iso, emp_code: code,
        status: absent ? 'A' : 'P', in_time: absent ? '' : '09:00',
        out_time: absent ? '' : '18:00', hours: absent ? 0 : 9 });
    }
  }
  /* AR-01 needs more than thirty days in the year or bonus will correctly
     refuse him, and the amount - the part worth checking - never runs. Two
     months of attendance put him past the qualifying days. */
  for (const m of [YM, '2026-09']) {
    const last = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
    for (let d = 1; d <= last; d++) {
      const iso = m + '-' + ('0' + d).slice(-2);
      if (new Date(iso + 'T00:00:00Z').getUTCDay() === 0) continue;
      att.push({ id: 'AR-01_' + iso, date: iso, emp_code: 'AR-01', status: 'P',
        in_time: '09:00', out_time: '18:00', hours: 9 });
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
  await month(YM); await month('2026-09');
  await p.evaluate(() => go('payroll')); await p.waitForTimeout(400);

  console.log('the four payroll tabs, against the rules as written\n');
  console.log('   ' + 'figure'.padEnd(22) + 'seen'.padStart(9) + 'rule'.padStart(9) + '    why');

  /* ================= WAGES ================= */
  console.log('\nwages: a rate times the days the company pays for');
  await p.evaluate(() => payTab('wages')); await p.waitForTimeout(400);
  await p.evaluate(m => { el('wage-month').value = m; renderWages(); }, YM);
  await p.waitForTimeout(500);
  await p.evaluate(() => generateWages()); await p.waitForTimeout(900);
  const wage = await p.evaluate(() => S.wageDraft ? S.wageDraft.rows : []);

  for (const [code, daily, da, hra, days, why] of WAGE_CASES) {
    const r = wage.find(x => x.emp_code === code);
    if (!r) { bad++; console.log('   ' + code + ' MISSING from the wage run ** ' + why); continue; }
    console.log('  ' + code + ' - ' + why);
    const basic = daily * days, dearness = da * days, house = hra * days;
    const gross = basic + dearness + house;
    const pfWage = Math.min(basic + dearness, PF_CEILING);
    const pf = pfWage * PF_PCT;
    const esi = gross <= ESI_CEILING ? gross * ESI_PCT : 0;
    const pt = ptaxOn(gross);
    check('days paid', r.paid_days, days, days + ' days the company pays for');
    check('basic', r.basic, basic, daily + ' x ' + days);
    check('DA', r.special_allowance, dearness, da + ' x ' + days);
    check('HRA', r.hra, house, hra + ' x ' + days);
    check('gross', r.gross, gross, 'basic + DA + HRA');
    check('PF', r.pf, pf, '12% of ' + Math.round(pfWage) + ' (basic+DA, capped at ' + PF_CEILING + ')');
    check('ESI', r.esi, esi, gross <= ESI_CEILING ? '0.75% of gross' : 'over the ESI ceiling');
    check('P.Tax', r.pt, pt, 'slab on the full gross');
    check('net', r.net, gross - (pf + esi + pt), 'gross less every deduction');
  }

  /* the run has to survive being saved */
  await p.evaluate(() => { writePayroll(S.wageDraft.rows.map(r =>
    Object.assign({}, r, { status: 'Finalised' }))); S.wageDraft = null; });
  await p.waitForTimeout(2000);
  console.log('\nwages, after being saved and read back');
  const savedWage = await p.evaluate(m => S.payroll.filter(r => r.month === m), YM);
  for (const [code] of WAGE_CASES) {
    const live = wage.find(x => x.emp_code === code);
    const back = savedWage.find(x => x.emp_code === code);
    if (!back) { bad++; console.log('   ' + code.padEnd(22) + ' ** did not survive the save'); continue; }
    check(code + ' net', back.net, live.net, 'the same figure after a round trip');
  }

  /* ================= ARREARS ================= */
  /* AR-01 is on 20,000 and was paid for the whole of YM, so a 10% rise
     effective that month owes the full 2,000. A month with no saved run
     owes nothing at all. */
  console.log('\narrears: the rise, prorated by the days that month actually paid');
  await p.evaluate(() => payTab('salary')); await p.waitForTimeout(300);
  await p.evaluate(m => { el('pay-month').value = m; renderPayroll(); }, YM);
  await p.waitForTimeout(600);
  await p.evaluate(() => generatePayroll()); await p.waitForTimeout(1200);
  await p.evaluate(() => { writePayroll(S.payDraft.rows.map(r =>
    Object.assign({}, r, { status: 'Finalised' }))); S.payDraft = null; });
  await p.waitForTimeout(2000);

  await p.evaluate(() => payTab('arrears')); await p.waitForTimeout(400);
  const noRun = '2026-07';
  await p.evaluate(([a, bm]) => {
    el('arr-from').value = a; el('arr-to').value = a;
    el('arr-mode').value = 'pct'; el('arr-val').value = '10'; renderArrears();
  }, [YM, noRun]);
  await p.waitForTimeout(800);
  const arr = await p.evaluate(() => arrearRows().rows);
  const a1 = arr.find(r => r.emp_code === 'AR-01');
  if (!a1) { bad++; console.log('   AR-01 MISSING from the arrears table **'); }
  else {
    check('present gross', a1.present, 20000, 'basic 12,000 + hra 8,000');
    check('rise per month', a1.rise, 2000, '10% of 20,000');
    check('arrears due', a1.total, 2000, 'paid the whole month, so the whole rise');
  }
  /* a month nobody ran */
  await p.evaluate(m => { el('arr-from').value = m; el('arr-to').value = m; renderArrears(); }, noRun);
  await p.waitForTimeout(700);
  const arrNone = await p.evaluate(() => arrearRows().rows);
  const a2 = arrNone.find(r => r.emp_code === 'AR-01');
  check('no run that month', a2 ? a2.total : 0, 0, 'nothing to compare against, so nothing owed');

  /* ================= BONUS ================= */
  console.log('\nbonus: 8.33% of at most 7,000 a month, for the months on the books');
  await p.evaluate(() => payTab('bonus')); await p.waitForTimeout(400);
  const fy = await p.evaluate(() => { el('bonus-fy').value = fyOf(today()); return el('bonus-fy').value; });
  await p.evaluate(() => generateBonus()); await p.waitForTimeout(2500);
  const bonus = await p.evaluate(() => S.bonusDraft ? S.bonusDraft.rows : []);

  /* GR-06 draws 500,000 - far over the eligibility ceiling, so nothing. */
  const big = bonus.find(r => r.emp_code === 'GR-06');
  check('over 21,000 a month', big ? big.amount : -1, 0, 'GR-06 draws 500,000 - not eligible');
  /* AR-01's basic is 12,000, inside the ceiling, so the base is 7,000. */
  const ab = bonus.find(r => r.emp_code === 'AR-01');
  if (ab) {
    check('worked out on', ab.base, Math.min(12000, BONUS_CALC), 'basic 12,000, capped at 7,000');
    check('days worked', ab.days >= 30 ? 1 : 0, 1,
          'needs 30 days in the year to qualify - saw ' + ab.days);
    check('bonus', ab.amount, BONUS_CALC * BONUS_RATE * ab.months,
          '7,000 x 8.33% x ' + ab.months + ' months on the books');
  } else { bad++; console.log('   AR-01 MISSING from the bonus run **'); }

  /* ================= GRATUITY ================= */
  console.log('\ngratuity: 15/26 of the last basic + DA for every completed year');
  await p.evaluate(() => payTab('gratuity')); await p.waitForTimeout(400);
  await p.evaluate(d => { el('grat-date').value = d; el('grat-who').value = 'all'; renderGratuity(); }, ASAT);
  await p.waitForTimeout(600);
  let grat = await p.evaluate(() => gratuityRows());
  /* leavers are a view of their own */
  await p.evaluate(() => { el('grat-who').value = 'left'; renderGratuity(); });
  await p.waitForTimeout(500);
  const leavers = await p.evaluate(() => gratuityRows());
  grat = grat.concat(leavers);

  for (const [code, basic, doj, exit, why] of GRAT_CASES) {
    const r = grat.find(x => x.emp_code === code);
    if (!r) { bad++; console.log('   ' + code + ' MISSING from the gratuity register ** ' + why); continue; }
    const upto = exit || ASAT;
    const months = monthsBetween(doj, upto);
    const whole = Math.floor(months / 12), rem = months % 12;
    const counted = whole + (rem >= 6 ? 1 : 0);
    const eligible = whole >= GRAT_MIN_YEARS;
    const want = eligible
      ? Math.min(Math.round(basic * (GRAT_DAYS / GRAT_MONTH) * counted), GRAT_CEIL) : 0;
    console.log('  ' + code + ' - ' + why);
    check('months of service', r.months, months, doj + ' to ' + upto);
    check('years counted', r.counted, counted,
          rem >= 6 ? whole + ' years and ' + rem + ' months rounds up' : 'part year under six months');
    check('gratuity', r.amount, want,
          eligible ? Math.round(basic) + ' x 15/26 x ' + counted : 'under the qualifying service');
  }

  /* ================= EACH TAB KEEPS ITS OWN RECORD ================= */
  /* The point of the three new tabs is that the record survives, apart from
     the salary run, and carries enough of the working to be checked years
     later. Being right on screen is not the claim being tested here - being
     right in the sheet, after a round trip, is. */

  /* --- bonus is finalised into the Bonus tab, not Payroll --- */
  console.log('\nbonus: finalised into its own tab');
  await p.evaluate(() => payTab('bonus')); await p.waitForTimeout(400);
  await p.evaluate(() => generateBonus()); await p.waitForTimeout(2500);
  const bonusDraft = await p.evaluate(() => S.bonusDraft ? S.bonusDraft.rows : []);
  const wantBonus = bonusDraft.filter(r => r.eligible && r.amount > 0);
  await p.evaluate(() => { saveBonus(); });
  await p.waitForTimeout(600);
  await p.evaluate(() => {
    /* the modal's Finalise button, pressed the way a person would */
    const b = [...document.querySelectorAll('.modal button')].find(x => /Finalise/.test(x.textContent));
    if (b) b.click();
  });
  await p.waitForTimeout(3000);

  const bonusSheet = await call('list', { sheet: 'Bonus' }, token);
  const strayFy = (await call('list', { sheet: 'Payroll' }, token))
    .filter(r => String(r.month).indexOf('FY') === 0);
  check('rows in the Bonus tab', bonusSheet.length, wantBonus.length,
        'one per eligible person, written where bonus belongs');
  check('FY rows left in Payroll', strayFy.length, 0,
        'a bonus run must not land in the salary tab any more');

  const bAr = bonusSheet.find(r => r.emp_code === 'AR-01');
  if (!bAr) { bad++; console.log('   AR-01 MISSING from the Bonus tab **'); }
  else {
    const want = wantBonus.find(r => r.emp_code === 'AR-01');
    check('amount survived', bAr.amount, want.amount, 'the same figure came back out');
    check('wage it was based on', bAr.wage, want.wage, 'basic + DA, kept with the row');
    check('ceiling applied', bAr.worked_on, BONUS_CALC, 'the working is in the row, not just the answer');
    check('rate recorded', bAr.rate_pct, 8.33, 'the percentage it was run at');
    check('filed under the year', /^\d{4}-\d{2}$/.test(String(bAr.fy)) ? 1 : 0, 1, 'fy = ' + bAr.fy);
  }

  /* --- gratuity freezes into a dated snapshot --- */
  /* The live figure moves with every increment. The frozen one must not:
     that is the whole reason for a snapshot, and what the accounts carry. */
  console.log('\ngratuity: frozen as at a date, with the working kept');
  await p.evaluate(() => payTab('gratuity')); await p.waitForTimeout(400);
  await p.evaluate(d => { el('grat-date').value = d; el('grat-who').value = 'all'; renderGratuity(); }, ASAT);
  await p.waitForTimeout(700);
  const liveGrat = await p.evaluate(() => gratuityRows().filter(r => r.eligible));
  await p.evaluate(() => freezeGratuity()); await p.waitForTimeout(600);
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('.modal button')].find(x => /Freeze/.test(x.textContent));
    if (b) b.click();
  });
  await p.waitForTimeout(3000);

  const gratSheet = await call('list', { sheet: 'Gratuity' }, token);
  check('rows frozen', gratSheet.length, liveGrat.length, 'one per person who could claim');
  const g3 = gratSheet.find(r => r.emp_code === 'GR-03');
  const l3 = liveGrat.find(r => r.emp_code === 'GR-03');
  if (!g3 || !l3) { bad++; console.log('   GR-03 MISSING from the frozen snapshot **'); }
  else {
    check('amount frozen', g3.amount, l3.amount, 'what was on screen is what was written');
    check('date stamped', String(g3.as_on).slice(0, 10) === ASAT ? 1 : 0, 1, 'as at ' + g3.as_on);
    check('wage kept with it', g3.last_wage, l3.wage, 'so the figure can be checked later');
    check('formula kept with it', g3.days_per_year, GRAT_DAYS, '15/26, recorded in the row');
  }

  /* --- an increment: recorded, applied, and arrears read from it --- */
  /* IN-01 is on 20,000 (basic 12,000 + HRA 8,000). A 10% rise is 2,000 a
     month. Spread in proportion that is 1,200 on basic and 800 on HRA, so
     the new package is 13,200 + 8,800 = 22,000. */
  console.log('\nincrement: the old pay is kept, which is what makes arrears exact');
  await call('save', { sheet: 'Employees', row: {
    emp_code: 'IN-01', name: 'Increment Case', status: 'Active', wage_type: 'Salary',
    basic: 12000, hra: 8000, special_allowance: 0, other_allowance: 0,
    pf_applicable: 'yes', esi_applicable: 'yes', doj: '2022-01-01', department: 'INC' } }, token);
  await p.evaluate(() => reload()); await p.waitForTimeout(3500);

  await p.evaluate(() => payTab('increment')); await p.waitForTimeout(500);
  await p.evaluate(m => {
    el('inc-from').value = m; el('inc-mode').value = 'pct'; el('inc-val').value = '10';
    el('inc-spread').value = 'prorata'; el('inc-reason').value = 'Audit revision';
    el('inc-who').value = 'salary';
    renderIncrement();
  }, YM);
  await p.waitForTimeout(800);
  const incPreview = await p.evaluate(() => incrementRows().find(r => r.emp_code === 'IN-01'));
  if (!incPreview) { bad++; console.log('   IN-01 MISSING from the increment table **'); }
  else {
    check('present gross', incPreview.oldGross, 20000, 'basic 12,000 + hra 8,000');
    check('rise', incPreview.rise, 2000, '10% of 20,000');
    check('new basic', incPreview.next.basic, 13200, '12,000 share of the rise is 1,200');
    check('new hra', incPreview.next.hra, 8800, '8,000 share of the rise is 800');
    check('components still add up', incPreview.next.basic + incPreview.next.hra,
          incPreview.newGross, 'the rounding has to land somewhere, and it lands on basic');
  }

  await p.evaluate(() => applyIncrement()); await p.waitForTimeout(600);
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('.modal button')].find(x => /^Apply$/.test(x.textContent.trim()));
    if (b) b.click();
  });
  await p.waitForTimeout(3500);

  const incSheet = (await call('list', { sheet: 'Increment' }, token))
    .filter(r => r.emp_code === 'IN-01');
  const empAfter = (await call('list', { sheet: 'Employees' }, token))
    .find(r => r.emp_code === 'IN-01');
  if (!incSheet.length) { bad++; console.log('   nothing written to the Increment tab **'); }
  else {
    const i = incSheet[0];
    check('old basic kept', i.old_basic, 12000, 'the figure arrears are worked out against');
    check('old gross kept', i.old_gross, 20000, 'gone from the Employees row, kept here');
    check('new gross recorded', i.new_gross, 22000, 'what they went to');
    check('rise recorded', i.rise, 2000, 'per month');
    check('effective month', String(i.effective_from).slice(0, 7) === YM ? 1 : 0, 1,
          'effective ' + i.effective_from);
    check('reason kept', String(i.reason || '') === 'Audit revision' ? 1 : 0, 1,
          'the answer to "why" in three years');
  }
  check('pay actually updated', empAfter ? empAfter.basic : 0, 13200,
        'the Employees row moved, not just the history');
  check('and the HRA with it', empAfter ? empAfter.hra : 0, 8800, 'both sides of the split');

  /* And now the point of all of it: arrears read the exact per-person rise
     from the revision, rather than a percentage typed in again. */
  await p.evaluate(() => payTab('arrears')); await p.waitForTimeout(500);
  await p.evaluate(m => {
    el('arr-mode').value = 'rev'; renderArrears();
    el('arr-rev').value = m; el('arr-from').value = m; el('arr-to').value = m;
    renderArrears();
  }, YM);
  await p.waitForTimeout(900);
  const fromRev = await p.evaluate(() => arrearRows().rows.find(r => r.emp_code === 'IN-01'));
  check('rise read from the revision', fromRev ? fromRev.rise : 0, 2000,
        'not typed in - taken from the Increment row');

  if (errs.length) { bad += errs.length; console.log('\nscript errors on the page:', errs.slice(0, 5)); }
  console.log('\n' + checks + ' figures checked');
  console.log(bad ? '** ' + bad + ' did not match their rule'
                  : 'every figure matched the rule as written');
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(String(e)); process.exit(1); });
