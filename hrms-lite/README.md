# HRMS Lite — a dashboard and 5 modules, Google Sheets as the database

A standalone HR & Payroll system: one **dashboard** home screen and exactly **five modules**,
built to be approved and run without a database server. It is a separate system from the
existing Supabase-based HRMS: nothing here reads, writes, or touches that Supabase project.

The dashboard is a home screen, not a sixth module — it only summarises what the five modules
own and links into them. The sidebar keeps the five numbered under a "Modules" heading.

## Dashboard

- A **live clock** with the date and the configured shift
- An **as-on date** picker: every attendance tile below reflects the day you pick, not just today
- Nine KPI tiles. The first six — **headcount, present, absent, late coming, on leave, not marked** —
  are **clickable**: each opens the list of the employees behind that number, with the detail that
  matters for it (in/out times, minutes late, leave type, remarks) and a link into the full
  employee profile or the attendance register. The rest: pending approvals, LOP this month,
  last net payout
- On a weekly off or holiday the attendance tiles read "—" and say which it is, instead of
  reporting everyone absent
- **Needs your attention** — the only list that matters: pending approvals, unmarked attendance
  days, a month whose payroll has not been run, employee records missing PAN/UAN/bank details.
  Each row clicks through to the module that fixes it
- Three charts: attendance over the last 14 working days (stacked), headcount by department,
  payroll cost across the last six saved runs — all with hover detail
- Who is out on the selected day, and birthdays / work anniversaries in the next 30 days
- A **company calendar** — the month grid from the old BISCS HRMS, on live data: holidays (applied
  and optional shown apart), approved leave with the person and type, birthdays, work anniversaries
  and company events, with weekly offs shaded and today outlined. Prev / Next / Today move the
  month; clicking any day opens everything on it, with that day's present / absent / on-leave /
  unmarked counts for past days, each clicking through to the list of people. Admins can add a
  company event, or mark the day a holiday, straight from the calendar.

## The five modules

| # | Module | What it does |
|---|--------|--------------|
| 1 | **Employees** | Employee master: full profile, salary structure, PF/ESI flags, exit date. Sortable, searchable, filterable. Per-employee 360° view (profile + salary + attendance + leave history + payslips). Validation on save (PAN format, duplicate email, ESI ceiling, dates). Record-completeness flags. CSV import with per-row validation, CSV export |
| 2 | **Attendance** | Monthly register grid: click to cycle P/A/HD/L/WO/H, double-click for in/out times and remarks, click a date header to fill a column, fill a whole employee-month, fill blank days. Holiday calendar auto-marks H. Late marks and overtime derived from the shift and grace period. Biometric/device CSV import. Locks automatically once payroll is finalised |
| 3 | **Leave** | Applications with live validation (quota balance, overlapping requests, working-day count that skips weekly offs and holidays). Approve / reject / cancel. Month calendar of who is off when. Per-type balances against annual quota. Approving writes **L** onto the attendance register; cancelling clears those days |
| 4 | **Payroll** | Generates from attendance, prorates by paid days, computes PF / ESI / PT / TDS plus employer PF & ESI and CTC. Editable arrears, bonus and other deductions per employee. Month-on-month variance per employee. Draft → finalise → (reopen if needed). Printable payslips, bulk payslip print, bank transfer CSV |
| 5 | **Reports** | Six reports, each exportable: **salary register unit by unit** (the company's own register layout), wages register, PF/ESI statutory contributions (challan-style, with employer share), year-to-date per employee (the Form 16 base), attendance exceptions (unmarked days, absences, late marks, high OT), joiners & leavers |

## Settings

Everything configurable lives in one modal, not a sixth module. Eight tabs:

| Tab | Holds |
|---|---|
| **Company** | name, address, currency |
| **Shifts & attendance** | the shift table, plus the late-mark and overtime rules |
| **Holidays** | the holiday calendar, per year |
| **Leave policy** | the leave-type table, plus the sandwich / excess-leave / probation rules |
| **CTC structure** | salary-structure variables, components and formulas; upload and apply a CTC list |
| **Payroll rules** | salary divisor, rounding, PF and ESI percentages and ceilings, professional tax |
| **Integrations** | the workspace API URL, eSSL/biometric pull and push, SQL agent settings, stored credentials, test/pull/push actions |
| **Import data** | manual import of punch logs, attendance, holidays and employees from CSV or Excel |
| **Account** | change your password |

### The salary register, unit by unit

**Reports → Salary register (unit-wise)** reproduces the company's own register: one block per unit
with its title bar, the same thirty columns, a total line under each unit and a grand total.

```
SR. NO. | CODE | Employee Name | Division | Days in Month | Actual present day |
Paid Holiday | Absent | Week Off | Leave | Final Attendance | Extra |
BASIC SALARY | HRA | TA/SP ALW/OT | INCENTIVE | Arear | Actual Salary Earn |
Provident Fund (12%) | ESIC 0.75% | Professional Tax | Income Tax |
Advance Deduction | Other Deduction | Total Deduction | Net Amount Payable |
BASIC SALARY | HRA | TA/SP ALW | TOTAL        ← the agreed structure, not the earned amount
```

The attendance columns come from the register, the money columns from the payroll run (or a live
preview when the month is not finalised yet), and the last four repeat the agreed monthly structure
from the employee record, exactly as the spreadsheet does.

Grouping is the **Unit / division** field on the employee record — `HO`, `U1`, `U2`, `U3` — and
falls back to department when a unit is blank. *Salary register grouped by* in Payroll rules can
switch it to department or company instead. A `Division` column in any import maps straight onto it.

Payroll gained **Incentive** and **Advance deduction** to match the register; both are editable in
the draft run and appear on the payslip.

**Wages register** is there and working for daily-rate workers — mark someone *Paid as: Wages* and
fill in their daily basic, DA and HRA rates, and the register pays those rates against the days the
attendance register credits. It is deliberately the simpler of the two: the salary register is the
one that has been matched against the company's sheet, so check the wage rules against a known month
before relying on them.

### CTC / salary structure

**Settings → CTC structure** is where the salary structure itself lives, as three editable tables:

- **Variables** — numbers reused across formulas (`basic_pct`, `esi_ceiling`, `leave_pct` …), so a
  rate changes in one place.
- **Components** — the structure. Each row has a code, a display name, a section (input, earning,
  deduction, employer contribution, totals, notes) and a **kind**:
  - `formula` — calculated, e.g. `gross * basic_pct`
  - `input` — typed per employee
  - `fixed` — the same number for everyone
  - `text` — a free note per employee (a remark, a grade, a status)
  Plus flags: taxable, counts toward PF wage, counts toward ESI wage, show on payslip, active.
- **Per-employee values** — a gross figure, and any override (a bonus that departs from the formula,
  for instance). Overrides win over formulas.

Formulas may use any component code, any variable, numbers, `+ - * / ( )` and:

```
if(gross <= esi_ceiling, gross * 0.0075, 0)      a condition
slab(gross, 10000:0, 15000:110, 25000:130)       bands, first match wins
min(basic, 15000)  max()  round()  roundto(x, 100)  floor()  ceil()  abs()  sum(a, b, c)
```

Formulas are **parsed, not executed** — there is no `eval` anywhere, because the text arrives from a
spreadsheet. Before a structure saves it is checked for unknown names, circular references and
syntax errors, and a bad row shows its error in place rather than blanking the page.

**Try it** takes a gross (or an employee) and resolves the whole structure live, per month and per
annum. **Upload CTC list** reads your own CTC spreadsheet — title rows above the header are fine,
and every sheet in the workbook is read — matching rows to employees on employee code, or on name
when there is no code column, and picking up any bonus that differs from the formula as an override.
**Apply to employees** writes the Basic / HRA / Special split back onto the employee master, which
is what payroll reads. **CTC sheet** exports the whole company in your sheet's shape.

Professional tax comes from the structure's `ptax` component when one exists, so the payslip and the
CTC sheet cannot disagree; the flat amount in Payroll rules is only a fallback.

The shipped default structure is the one in use today: basic 60% of gross, HRA 40%, PF 12%/13% of
basic, ESI 0.75%/3.25% of gross up to a ₹21,000 ceiling, a professional-tax slab, annual bonus of
one month's basic, a paid-leave component at 32% of gross, and CTC per annum =
cost per month × 12 + bonus + leave.

### Policies and rules — and where each one bites

Every rule below is read from Settings and **applied**; none of them is decorative text.

**Shifts** (a table, not a single setting). Each row is a shift: start, end, grace minutes, hours for
a full and a half day, weekly off, Saturday policy, and the overtime threshold. Every employee is
assigned one on their record, so a night shift and a general shift can run side by side. The shift
drives late marks, overtime, which days are weekly offs, and what a pair of biometric punches
becomes.

**Saturday policy** — all working, all off, 2nd and 4th off, 1st and 3rd off, or alternate. Set per
shift, and it changes the register, leave-day counting and paid days. (On the demo month: 4 weekly
offs on "all working", 6 on "2nd and 4th", 8 on "all off".)

**Late marks** — every *N* late arrivals cost half a day of pay; 0 turns the rule off. The month
summary shows the late count and the deduction it produced, so nobody has to take it on trust.

**Overtime** — minutes past the shift end (beyond the shift's threshold) are always counted, and
**paid** only when *Pay overtime* is on: hourly rate from the monthly gross × the multiplier, capped
at the monthly hours you allow. It appears as its own payslip line.

**Leave types** (a table). Per type: paid or unpaid, annual quota, carry forward, longest stretch
allowed, notice days expected, and whether half days are allowed. Applying for leave enforces them —
a Casual request longer than the allowed stretch is refused, not warned about.

**Sandwich rule** — with it on, a weekly off or holiday falling inside a leave block is charged as
leave.

**Leave beyond the quota is unpaid** — days past the annual quota (and every day of an unpaid type)
become LOP in payroll instead of being quietly paid. The register's month summary has an *Unpaid
leave* column.

**No leave in the first N days of service** — a probation gate, checked against the joining date.

**Salary divisor** — what one day of pay is worth: `calendar` (30/31 days), `fixed26` (a flat 26,
the common factory basis), or `working` (scheduled working days only). On ₹28,221 gross with 2 LOP
days this pays ₹26,340 / ₹26,050 / ₹25,963 respectively — worth choosing deliberately.

**Rounding** — round every amount to the nearest 1, 5, 10 or 100.

### Holidays

Per-year list with the weekday shown. You can add the **fixed national holidays** for a year in one
click (Republic Day, May Day, Independence Day, Gandhi Jayanti, Christmas, New Year — only the
date-certain ones; festival dates move, so add those yourself or import them), **import a list**
from CSV/Excel with `date, name, optional`, or **export** what you have.

A holiday marked **optional** (restricted) is listed but *not* applied to the register, so people
who work that day are marked normally. Click the badge to flip a holiday between applied and
optional.

### Employee codes are yours

Codes are **never generated**. You type the code your records already use — `DE-014`, `1024`,
`RK-PROD-3` — and it is checked for duplicates and format on save. Once an employee exists the code
is locked, because attendance, leave and payslips all hang off it. Imports reject any row without
one. Each employee also carries a **biometric device ID** (the enrolment number on the eSSL machine)
used to match punches.

## Biometric / eSSL integration

Two ways in, chosen with **Biometric source** in Settings → Integrations:

**`api`** — the Apps Script backend calls your eSSL / eTimeTrackLite web API directly.
This only works if that URL is reachable from the public internet. Google's servers cannot reach
`192.168.x.x`, `10.x.x.x` or `localhost`, and the app tells you so instead of failing silently.

**`sql-agent`** — the normal choice for an office LAN. `tools/essl-sync.js` runs on the machine that
can see the eSSL SQL Server, reads the punch table, and POSTs the punches to your web app:

```
cd tools
npm install mssql
cp essl-sync.config.example.json essl-sync.config.json   # fill in SQL + the ingest token
node essl-sync.js --days 2
node essl-sync.js --from 2026-09-01 --to 2026-09-30      # backfill
node essl-sync.js --csv exported-punches.csv             # no SQL Server needed
node essl-sync.js --dry-run                              # show, do not send
```

Schedule it with Task Scheduler or cron every 15–30 minutes. Re-sending the same punches is safe: a
day is keyed by employee + date, so a repeat import overwrites that day instead of duplicating it.

**How punches become attendance** (the same rule wherever they enter): punches are grouped per
employee per day — first punch in, last punch out. Hours at or above *full day hours* → **P**, at or
above *half day hours* → **HD**, below that → **A** with a "verify" remark. A single punch is marked
**P** and flagged for checking. Approved leave and months with a finalised payroll run are never
overwritten; those days are reported back as skipped. Every raw punch is also kept on a **Punches**
tab for audit.

**Pushing data out:** set a push endpoint URL, switch *Push data out* to `yes`, and use
**Push data out** to send `{company, month, rows}` as JSON — attendance day-by-day or the payroll
run. **Export attendance as SQL** writes a file of `INSERT` statements you can run against any SQL
database instead.

**Credentials** (eSSL password, SQL password, agent ingest token, push bearer token) are stored in
the Apps Script project's private properties — never in the spreadsheet, and never sent back to the
browser. The UI only ever shows whether each one is set.

## Importing data by hand

Settings → **Import data** takes **.csv, .xlsx and legacy .xls** — including the real files eSSL
prints. Both readers are built in (a zip/XML reader for .xlsx, an OLE/BIFF8 reader for .xls), so
there is no library and the page still works offline. The file type is detected from its contents,
not its extension, so an export mislabelled `.xls` still opens.

Leave the type on **Detect automatically** and it works out which of these it is:

- **eSSL "Log Records (Employee Wise)" report** — the .xls eSSL prints, with `Company` /
  `Department` / `Employee  CODE : Name` headings above each block of punches. Every sheet in the
  workbook is read (the real export runs to 15 sheets).
- **eSSL employee list** — `EmployeeCode`, `EmployeeName`, `DeviceCode`, `Company`, `Department`,
  `Status`, `DOJ`, `DOR` are mapped automatically. eSSL's placeholder dates (`1900-01-02`,
  `3000-01-01`) are dropped, `Working`/`Resigned` become Active/Inactive, and `Default` is treated
  as blank.
- **Biometric punch log** — a flat device export: employee or device id plus a punch time
- **Attendance, one row per day** — `emp_code, date, status, in_time, out_time, remarks`
- **Attendance, month grid** — one row per employee, one column per day, exactly what the Attendance
  module exports
- **Employee master** — adds or updates employees; every row needs its employee code

### Loading only some units

The eSSL master covers every contractor unit. When you import an employee list, the preview shows a
**tick box per company/unit with a count** — untick the ones this system should not carry, and only
the ticked ones are written. The choice is saved (`import_companies` in Settings), so tomorrow's
import preselects the same units.

Punches for people who are not in your master are skipped and summarised in one line rather than
listed row by row, since that is expected once you only keep some units.

To clear out units that were already loaded: filter the employee list (company, department, status,
search) and use **Bulk action**. *Mark inactive* keeps the record and its history but takes them off
payroll and the register; *Delete* removes them for good and needs you to type DELETE. Employees who
already have payslips are excluded from deletion — deleting them would break the payroll audit
trail, so mark those inactive instead.

### The daily routine, until the API or SQL link is live

1. Print the **Log Records (Employee Wise)** report from eSSL for the period you want.
2. HRMS Lite → Settings → **Import data** → pick the file → check the preview → **Import**.
3. Open **Reports → Attendance exceptions** and clear the flagged days.

Re-importing the same period is safe: a day is keyed by employee + date, so it overwrites rather
than duplicating. Days protected by approved leave or a finalised payroll run are listed as skipped
instead of being overwritten.

Each import shows a **preview of the exact rows that will be written**, plus every problem row
(unknown employee, unreadable date, a day protected by leave or a locked payroll). Nothing is
written until you press Import. Excel date and time cells stored as serial numbers are converted
automatically. A template for each shape is one click away.

## Files

```
hrms-lite/
├── index.html                       the whole front end — one file, no build step, no npm
├── apps-script/Code.gs              the backend, runs inside your Google Sheet
├── tools/essl-sync.js               biometric sync agent for your office LAN
├── tools/essl-sync.config.example.json
└── README.md
```

## Try it in 10 seconds

Open `index.html` in a browser and click **"Open demo (sample data, no setup)"**. It loads
10 sample employees, four months of attendance, three finalised payroll runs and a few leave
applications — so the dashboard has real charts and every module has something to show.
Demo data lives in the browser only, and nothing is sent anywhere.

A good 90-second walkthrough: dashboard → approve a leave from the attention list → open the
attendance register and mark someone absent → generate and finalise payroll → print a payslip
→ open the statutory report.

## Real setup (about 5 minutes)

1. **Create the spreadsheet.** In Google Drive: *New → Google Sheets*. Name it e.g. `HRMS Data`.
2. **Add the backend.** In that sheet: *Extensions → Apps Script*. Delete the sample code,
   paste everything from `apps-script/Code.gs`, and save.
3. **Create the tables.** In the Apps Script editor pick the `setup` function from the
   dropdown and press **Run**. Approve the permission prompt (it only asks for access to this
   spreadsheet). This creates fourteen tabs — `Settings`, `Users`, `Employees`, `Attendance`,
   `Leave`, `Payroll`, `Holidays`, `Events`, `Punches`, `Shifts`, `LeaveTypes`, `CtcVariables`,
   `CtcComponents`, `CtcValues` — seeds a General shift, the four standard leave types and the
   company's salary structure, and creates the first admin login. It is safe to re-run: new
   columns are appended, existing data is left where it is.
4. **Deploy the web app.** *Deploy → New deployment → type: Web app*.
   - Execute as: **Me**
   - Who has access: **Anyone**

   Copy the `/exec` URL it gives you.
5. **Sign in.** Open `index.html`, expand **Connection settings** on the login screen, paste that
   URL, and log in with **admin@company.com / admin123**. Change the password immediately from
   *Settings → Account*. The URL is remembered on that device and can be changed later from
   *Settings → Integrations*.

Host `index.html` anywhere static (Google Drive, an internal share, GitHub Pages, any web
server) or just email the file — it needs no server of its own.

## Adding users

Add a row to the **Users** tab:

| email | password | role | emp_code | active |
|-------|----------|------|----------|--------|
| priya@company.com | *(see below)* | employee | EMP0004 | yes |

`role` is `admin` (full access) or `employee` (sees only their own rows, can apply for
leave, cannot edit the master or run payroll). Passwords are stored as SHA-256 hashes: the
simplest way to set one is to add the row with any placeholder, then run `hash("thepassword")`
once in the Apps Script editor and paste the result into the cell.

## How payroll is calculated

For each active employee, for the selected month:

```
LOP       = absent days + 0.5 × half days + unmarked days that have already passed
paid_days = days_in_month − LOP
factor    = paid_days ÷ days_in_month
gross     = (basic + hra + special + other) × factor + arrears + bonus
PF        = min(basic_earned, ceiling × factor) × pf_employee_pct     (if PF applicable)
ESI       = gross × esi_employee_pct   (if ESI applicable and full gross ≤ ESI ceiling)
PT        = flat amount from Settings
TDS       = the employee's tds_monthly
net       = gross − (PF + ESI + PT + TDS + other deductions)
CTC       = gross + employer PF + employer ESI
```

Weekly offs and holidays are paid; only `A`, `HD` and unmarked past days reduce pay. Days later
in the running month are not treated as missing. All rates, ceilings, the weekly-off day, the
shift and the grace period are editable in *Settings* — defaults are the Indian statutory ones
(PF 12%/13% on ₹15,000, ESI 0.75%/3.25% up to ₹21,000, PT ₹200).

Saved runs are never recalculated when rates change later, so historic payslips stay correct.

### Draft → finalise → reopen

Generating a run only builds a **draft** in the browser; nothing is written until you press
**Finalise**. Finalising writes the payslip rows and **locks that month's attendance register**
so the numbers cannot drift after payout — leave inside a locked month cannot be approved or
cancelled either. **Reopen run** unlocks it when a correction is genuinely needed.

## Notes and limits

- **Concurrency**: writes take an Apps Script lock, so two people saving at once is safe.
- **Bulk writes**: imports read the tab once, merge in memory and write back in a single call. Row
  by row would be O(n²) and would time out on a 500-employee master or a month of punches.
- **Punch log hygiene**: raw punches land on the `Punches` tab through the agent path and are
  trimmed to `punch_log_days` (default 90) on each import.
- **Scale**: comfortable to a few hundred employees. Google Sheets allows 10M cells and
  Apps Script caps a request at 6 minutes — attendance is the biggest tab (one row per
  employee per day, about 3,000 rows a year for 10 people).
- **Light mode only**: the UI ships one theme, matching the rest of the app.
- **Backups**: *File → Version history* in the sheet, plus the Export CSV button in every module.
- **Security**: the deployment is public-by-URL and authentication is the `Users` tab, which
  suits an internal tool. For anything stricter, set the deployment to "Anyone within
  <your organisation>" instead.
