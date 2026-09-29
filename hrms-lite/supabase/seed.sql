-- The rest of a fresh workspace: the shift, the leave and request types, the
-- approval chain, the salary structure, and the first owner login.
--
-- Run after schema.sql and seed-settings.sql.

set search_path to hrms, public;
create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ shift
insert into shifts (id, name, start_time, end_time, grace_minutes, full_day_hours,
                    half_day_hours, weekly_off, saturday_policy, ot_after_minutes, active)
values ('shift-general', 'General', '09:30', '18:30', 15, 8, 4, 'Sun', 'working', 30, true)
on conflict (id) do nothing;

-- ------------------------------------------------------------ leave types
insert into leave_types (id, name, paid, quota, carry_forward, max_consecutive,
                         notice_days, allow_half_day, active) values
  ('lt-casual', 'Casual', true, 12, false, 3,  1, true,  true),
  ('lt-sick',   'Sick',   true,  6, false, 3,  0, true,  true),
  ('lt-earned', 'Earned', true, 15, true, 15,  7, false, true),
  ('lt-unpaid', 'Unpaid', false, 0, false, 30, 0, true,  true)
on conflict (id) do nothing;

-- --------------------------------------------------------- request types
insert into request_types (id, code, name, effect, paid, needs_approval,
                           max_per_month, validity_days, allow_half, active) values
  ('rt-od',    'OD',    'Out of office duty',          'present',  true, true, 0, 0, false, true),
  ('rt-swipe', 'SWIPE', 'Swipe request (missed punch)','times',    true, true, 0, 0, false, true),
  ('rt-co',    'CO',    'Compensatory off',            'comp_off', true, true, 0, 90, true, true)
on conflict (id) do nothing;

-- ------------------------------------------------------- approval chain
insert into approval_levels (id, applies_to, level, approver, label, active) values
  ('al-leave-1', 'Leave',    1, 'manager', 'Reporting manager', true),
  ('al-leave-2', 'Leave',    2, 'hr',      'HR department',     true),
  ('al-req-1',   'Requests', 1, 'manager', 'Reporting manager', true),
  ('al-req-2',   'Requests', 2, 'hr',      'HR department',     true)
on conflict (id) do nothing;

-- ------------------------------------------------- the salary structure
insert into ctc_variables (id, code, value, note) values
  ('cv-basic',   'basic_pct',         '0.60',   'Basic as a share of gross'),
  ('cv-hra',     'hra_pct',           '0.40',   'HRA as a share of gross'),
  ('cv-pfe',     'pf_employee_pct',   '0.12',   'PF employee share, on basic'),
  ('cv-pfr',     'pf_employer_pct',   '0.13',   'PF employer share, on basic'),
  ('cv-esie',    'esi_employee_pct',  '0.0075', 'ESI employee share, on gross'),
  ('cv-esir',    'esi_employer_pct',  '0.0325', 'ESI employer share, on gross'),
  ('cv-esic',    'esi_ceiling',       '21000',  'No ESI above this monthly gross'),
  ('cv-pfc',     'pf_ceiling',        '15000',  'PF is charged on at most this much basic'),
  ('cv-leave',   'leave_pct',         '0.32',   'Paid-leave component, share of gross'),
  ('cv-bonus',   'bonus_months_basic','1',      'Annual bonus as months of basic')
on conflict (id) do nothing;

insert into ctc_components (id, seq, code, name, section, kind, expr,
                            taxable, in_gross, in_pf_wage, in_esi_wage, show_payslip, active) values
  ('cc-gross',  10,  'gross',        'Gross Salary',            'input',     'input',
     '0', true, true, false, false, false, true),
  ('cc-basic',  20,  'basic',        'Basic Salary',            'earning',   'formula',
     'gross * basic_pct', true, false, true, false, true, true),
  ('cc-hra',    30,  'hra',          'HRA',                     'earning',   'formula',
     'gross * hra_pct', true, false, false, false, true, true),
  ('cc-conv',   40,  'conveyance',   'Conveyance allowance',    'earning',   'formula',
     'gross - basic - hra', true, false, false, false, true, true),
  ('cc-esie',   50,  'esi_employee', 'ESIC @0.75% of gross',    'deduction', 'formula',
     'if(gross <= esi_ceiling, gross * esi_employee_pct, 0)', false, false, false, false, true, true),
  -- the ceiling exactly as payroll applies it: PF is charged on at most
  -- pf_ceiling of basic, so above it the deduction stops at 1,800
  ('cc-pfe',    60,  'pf_employee',  'PF @12% of basic (capped)','deduction','formula',
     'min(basic, pf_ceiling) * pf_employee_pct', false, false, false, false, true, true),
  ('cc-ptax',   70,  'ptax',         'P.Tax',                   'deduction', 'formula',
     'slab(gross, 10000:0, 15000:110, 25000:130, 40000:150, 99999999:200)',
     false, false, false, false, true, true),
  ('cc-ded',    80,  'deductions',   'Total deductions',        'summary',   'formula',
     'esi_employee + pf_employee + ptax', false, false, false, false, true, true),
  ('cc-esir',   90,  'esi_employer', 'ESIC @3.25% of gross',    'employer',  'formula',
     'if(gross <= esi_ceiling, gross * esi_employer_pct, 0)', false, false, false, false, false, true),
  ('cc-pfr',   100,  'pf_employer',  'PF @13% of basic',        'employer',  'formula',
     'basic * pf_employer_pct', false, false, false, false, false, true),
  ('cc-empt',  110,  'employer_total','Company contribution',   'summary',   'formula',
     'esi_employer + pf_employer', false, false, false, false, false, true),
  ('cc-net',   120,  'net_pay',      'Net: in hand per month',  'summary',   'formula',
     'gross - deductions', false, false, false, false, true, true),
  ('cc-pft',   130,  'pf_total_month','PF deposit per month',   'summary',   'formula',
     'pf_employee + pf_employer', false, false, false, false, false, true)
on conflict (id) do nothing;

-- ------------------------------------------------------- the first login
-- bcrypt with a per-user salt, worked out by Postgres. The sheet version kept
-- one fast SHA-256 with a shared prefix, which anybody holding the Users tab
-- could run through a word list in seconds.
insert into users (email, password, role, emp_code, active)
values ('admin@company.com', crypt('admin123', gen_salt('bf', 10)), 'owner', null, true)
on conflict (email) do nothing;
