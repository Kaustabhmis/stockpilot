-- BISCS OS - the workspace, as Postgres.
--
-- One table per sheet tab, same column names, so every figure the register
-- and payroll read means exactly what it meant before. Types are real here:
-- a date is a date, money is numeric, a flag is boolean. The sheet kept
-- everything as text and guessed on the way out, which is where a punch time
-- of "13:05" could arrive as a Date object and a blank could arrive as 0.
--
-- Run once against a NEW Supabase project:
--   supabase db push          (or paste into the SQL editor)

create schema if not exists hrms;
-- extensions is on the path because Supabase installs pgcrypto there, not
-- in public. Leaving it off is how crypt() and gen_salt() vanish.
set search_path to hrms, public, extensions;

-- ---------------------------------------------------------------- settings
create table if not exists settings (
  key    text primary key,
  value  text not null default ''
);

-- ------------------------------------------------------------------- staff
create table if not exists employees (
  emp_code          text primary key,
  name              text not null default '',
  email             text,
  phone             text,
  department        text,
  designation       text,
  doj               date,
  status            text not null default 'Active',
  basic             numeric(12,2) not null default 0,
  hra               numeric(12,2) not null default 0,
  special_allowance numeric(12,2) not null default 0,
  other_allowance   numeric(12,2) not null default 0,
  pf_applicable     boolean not null default true,
  esi_applicable    boolean not null default false,
  tds_monthly       numeric(12,2) not null default 0,
  pan               text,
  uan               text,
  esic_no           text,
  bank_account      text,
  ifsc              text,
  manager           text,
  dob               date,
  gender            text,
  address           text,
  notes             text,
  exit_date         date,
  device_id         text,
  company           text,
  shift             text,
  unit              text,
  wage_type         text,
  daily_rate        numeric(12,2) not null default 0,
  da_rate           numeric(12,2) not null default 0,
  hra_rate          numeric(12,2) not null default 0,
  site              text,
  updated_at        date
);
create index if not exists employees_status_idx on employees (status);
create index if not exists employees_manager_idx on employees (manager);
create index if not exists employees_device_idx  on employees (device_id);

-- ------------------------------------------------------------------ logins
create table if not exists users (
  email     text primary key,          -- a staff code or an address, lower case
  password  text not null default '',  -- see the note in auth.sql: this is a
                                       -- migration shim, not the final story
  role      text not null default 'employee',
  emp_code  text references employees(emp_code) on delete set null,
  active    boolean not null default true
);
create index if not exists users_emp_idx on users (emp_code);

-- -------------------------------------------------------------- attendance
create table if not exists attendance (
  id         text primary key,                 -- emp_code || '_' || date
  date       date not null,
  emp_code   text not null references employees(emp_code) on delete cascade,
  status     text not null default '',         -- P A HD L OD CO WO H
  in_time    time,
  out_time   time,
  hours      numeric(6,2) not null default 0,
  remarks    text,
  updated_at date,
  unique (emp_code, date)
);
-- the register reads one month of everybody: this is the index that makes it
-- a range scan rather than a table scan
create index if not exists attendance_date_idx     on attendance (date);
create index if not exists attendance_emp_date_idx on attendance (emp_code, date);

-- ------------------------------------------------------------ the punch log
create table if not exists punches (
  id          text primary key,
  punch_time  timestamptz not null,
  emp_code    text,                    -- not a foreign key on purpose: a card
                                       -- enrolled on the reader but never added
                                       -- here must still be logged and shown
  device_id   text,
  device      text,
  direction   text,
  source      text,
  imported_at timestamptz,
  lat         double precision,
  lng         double precision,
  accuracy    integer,
  site        text,
  distance_m  numeric(10,2)
);
create index if not exists punches_time_idx on punches (punch_time);
create index if not exists punches_emp_idx  on punches (emp_code, punch_time);

-- ------------------------------------------------------------------- leave
create table if not exists leave (
  id            text primary key,
  emp_code      text not null references employees(emp_code) on delete cascade,
  type          text not null default '',
  from_date     date,
  to_date       date,
  days          numeric(6,2) not null default 0,
  reason        text,
  status        text not null default 'Pending',
  applied_at    date,
  decided_by    text,
  decided_at    date,
  decision_note text,
  level         integer not null default 0,
  approvals     text
);
create index if not exists leave_emp_idx    on leave (emp_code);
create index if not exists leave_status_idx on leave (status);
create index if not exists leave_from_idx   on leave (from_date);

create table if not exists leave_types (
  id              text primary key,
  name            text not null,
  paid            boolean not null default true,
  quota           numeric(6,2) not null default 0,
  carry_forward   boolean not null default false,
  max_consecutive numeric(6,2) not null default 0,
  notice_days     integer not null default 0,
  allow_half_day  boolean not null default true,
  active          boolean not null default true
);

-- ---------------------------------------------------------------- requests
create table if not exists requests (
  id          text primary key,
  emp_code    text not null references employees(emp_code) on delete cascade,
  type        text not null default '',
  date        date,
  to_date     date,
  in_time     time,
  out_time    time,
  reason      text,
  mode        text,
  adjust_date date,
  days        numeric(6,2) not null default 0,
  status      text not null default 'Pending',
  applied_at  date,
  decided_by  text,
  decided_at  date,
  note        text,
  level       integer not null default 0,
  approvals   text
);
create index if not exists requests_emp_idx    on requests (emp_code);
create index if not exists requests_status_idx on requests (status);

create table if not exists request_types (
  id             text primary key,
  code           text not null,
  name           text not null default '',
  effect         text not null default 'none',
  paid           boolean not null default true,
  needs_approval boolean not null default true,
  max_per_month  numeric(6,2) not null default 0,
  validity_days  integer not null default 0,
  allow_half     boolean not null default false,
  active         boolean not null default true
);

create table if not exists approval_levels (
  id         text primary key,
  applies_to text not null default '',
  level      integer not null default 1,
  approver   text not null default '',
  label      text,
  active     boolean not null default true
);

-- ---------------------------------------------------------------- payroll
create table if not exists payroll (
  id                  text primary key,     -- month || '_' || emp_code
  month               text not null,        -- 'YYYY-MM'
  emp_code            text not null references employees(emp_code) on delete cascade,
  total_days          numeric(6,2) not null default 0,
  lop_days            numeric(6,2) not null default 0,
  paid_days           numeric(6,2) not null default 0,
  basic               numeric(12,2) not null default 0,
  hra                 numeric(12,2) not null default 0,
  special_allowance   numeric(12,2) not null default 0,
  other_allowance     numeric(12,2) not null default 0,
  arrears             numeric(12,2) not null default 0,
  bonus               numeric(12,2) not null default 0,
  incentive           numeric(12,2) not null default 0,
  ot_hours            numeric(8,2)  not null default 0,
  ot_amount           numeric(12,2) not null default 0,
  gross               numeric(12,2) not null default 0,
  pf                  numeric(12,2) not null default 0,
  esi                 numeric(12,2) not null default 0,
  pt                  numeric(12,2) not null default 0,
  tds                 numeric(12,2) not null default 0,
  other_deduction     numeric(12,2) not null default 0,
  advance_deduction   numeric(12,2) not null default 0,
  total_deduction     numeric(12,2) not null default 0,
  net                 numeric(12,2) not null default 0,
  pf_employer         numeric(12,2) not null default 0,
  esi_employer        numeric(12,2) not null default 0,
  ctc                 numeric(12,2) not null default 0,
  late_deduction_days numeric(6,2) not null default 0,
  unpaid_leave_days   numeric(6,2) not null default 0,
  status              text not null default 'Draft',
  generated_at        date,
  generated_by        text,
  unique (month, emp_code)
);
create index if not exists payroll_month_idx on payroll (month);
create index if not exists payroll_emp_idx   on payroll (emp_code);

create table if not exists payslip_mail (
  id       text primary key,
  month    text not null,
  emp_code text,
  name     text,
  email    text,
  sent_at  timestamptz,
  status   text,
  error    text,
  sent_by  text
);
create index if not exists payslip_mail_month_idx on payslip_mail (month);

-- ------------------------------------------------- the salary structure
create table if not exists ctc_variables (
  id    text primary key,
  code  text not null unique,
  value text not null default '',
  note  text
);

create table if not exists ctc_components (
  id            text primary key,
  seq           integer not null default 0,
  code          text not null unique,
  name          text not null default '',
  section       text not null default '',
  kind          text not null default 'formula',
  expr          text not null default '',
  taxable       boolean not null default false,
  in_gross      boolean not null default false,
  in_pf_wage    boolean not null default false,
  in_esi_wage   boolean not null default false,
  show_payslip  boolean not null default true,
  active        boolean not null default true
);
create index if not exists ctc_components_seq_idx on ctc_components (seq);

create table if not exists ctc_values (
  id       text primary key,
  emp_code text not null references employees(emp_code) on delete cascade,
  code     text not null,
  value    text not null default '',
  unique (emp_code, code)
);

-- ------------------------------------------------------------- the rest
create table if not exists holidays (
  id       text primary key,
  date     date not null,
  name     text not null default '',
  optional boolean not null default false
);
create index if not exists holidays_date_idx on holidays (date);

create table if not exists events (
  id   text primary key,
  date date not null,
  name text not null default '',
  type text,
  note text
);

create table if not exists sites (
  id       text primary key,
  name     text not null default '',
  lat      double precision,
  lng      double precision,
  radius_m integer not null default 150,
  active   boolean not null default true,
  note     text
);

create table if not exists shifts (
  id                text primary key,
  name              text not null default '',
  start_time        time,
  end_time          time,
  grace_minutes     integer not null default 15,
  full_day_hours    numeric(5,2) not null default 8,
  half_day_hours    numeric(5,2) not null default 4,
  weekly_off        text not null default 'Sun',
  saturday_policy   text not null default 'working',
  ot_after_minutes  integer not null default 30,
  active            boolean not null default true
);

create table if not exists notices (
  id         text primary key,
  title      text not null default '',
  body       text,
  level      text,
  start_date date,
  end_date   date,
  pinned     boolean not null default false,
  active     boolean not null default true,
  created_by text,
  created_at timestamptz default now()
);

-- The revision counter the screens poll. One row, bumped by a write, so
-- "has anything changed?" is a single-row read rather than a tab scan.
create table if not exists revision (
  id    integer primary key default 1,
  rev   bigint not null default 0,
  staff bigint not null default 0,
  tabs  text not null default '',
  check (id = 1)
);
insert into revision (id) values (1) on conflict (id) do nothing;
