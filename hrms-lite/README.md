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
| 3 | **Leave** | Applications with live validation (quota balance, overlapping requests, working-day count that skips weekly offs and holidays). Approve / reject / cancel. **Requests** — out-of-office duty, swipe (missed punch) and compensatory off. Month calendar of who is off when. Per-type balances and a comp-off ledger. Approving writes onto the attendance register; cancelling clears those days |
| 4 | **Payroll** | Generates from attendance, prorates by paid days, computes PF / ESI / PT / TDS plus employer PF & ESI and CTC. Editable arrears, bonus and other deductions per employee. Month-on-month variance per employee. Draft → finalise → (reopen if needed). **Payslips printed** one at a time or for the whole month, **and emailed** to staff as a PDF; bank transfer CSV |
| 5 | **Reports** | Seven reports, each exportable **and printable**: **salary register unit by unit** (the company's own register layout), wages register, **leave report** (per-employee year balance plus the month's applications), PF/ESI statutory contributions (challan-style, with employer share), year-to-date per employee (the Form 16 base), attendance exceptions (unmarked days, absences, late marks, high OT), joiners & leavers |

### Reports — printing and the leave report

Every report has an **Export CSV** and a **Print** button, and both work on all seven.

Print opens a clean print view: the company name and address as a letterhead, the report title
and the period, a *"Printed &lt;date&gt; by &lt;user&gt;"* line, the table itself, and a footer. Filters,
buttons and the app chrome are dropped; table headers repeat on every page and rows are not
split across a page break. Wide reports (more than nine columns — the salary register, the leave
report, statutory, YTD) switch to **landscape** automatically; narrow ones stay portrait. It is
the browser's own print dialog, so "Save as PDF" gives you a PDF with no extra tool.

The **leave report** shows, for the selected month's year, one row per employee with a column for
each leave type, the total taken, the balance left, unpaid (LOP) days and the days taken in that
month — with a totals row at the bottom. Underneath it lists that month's leave applications:
who, type, dates, days, paid or unpaid, and status.


## Settings

Everything configurable lives in one modal, not a sixth module. Eight tabs:

| Tab | Holds |
|---|---|
| **Company** | name, address, currency |
| **Shifts & attendance** | the shift table, plus the late-mark and overtime rules |
| **Holidays** | the holiday calendar, per year |
| **Leave policy** | the leave-type table, plus the sandwich / excess-leave / probation rules |
| **Requests** | the request-type table (OD, swipe, comp-off) and the comp-off rules |
| **CTC structure** | salary-structure variables, components and formulas; upload and apply a CTC list |
| **Payroll rules** | salary divisor, rounding, PF and ESI percentages and ceilings, professional tax |
| **Integrations** | the workspace API URL, eSSL/biometric pull and push, SQL agent settings, stored credentials, test/pull/push actions |
| **Import data** | manual import of punch logs, attendance, holidays and employees from CSV or Excel |
| **Account** | change your password |

### Payslips: printing and emailing

**Print** — the **Payslip** button on any row opens the slip with a **Print** button; **Print all
payslips** in the toolbar prints the whole month, one slip per page. A4 portrait, the company name
and address as a letterhead, no rows split across a page break.

**Email** — **Email payslips** in the toolbar sends the month to everyone; the **✉ Email** button
on a single payslip sends just that one. The payslip goes as a **PDF attachment** and is repeated in
the body of the mail, so it reads on a phone without opening anything.

Mail leaves from the **Google account that owns the spreadsheet**, so it arrives from your own
address — no third-party mail service, no extra account, nothing to pay for. Google allows about
**100 emails a day** on a free Gmail account and **1,500 a day** on Google Workspace.

Before it sends, the dialog tells you exactly what will happen: how many will go, who is being
**skipped because there is no email address on their record** (named, so you can go and add them),
and how many were **already sent this month's payslip** — with a checkbox, ticked by default, to
skip those. So pressing Send twice does not quietly deliver everyone a second copy, and a month with
more staff than the daily quota can simply be sent again the next day: the ones that already went
are skipped.

Only a **finalised** run can be emailed. A draft is refused, for one payslip and for the month,
because a draft number is not the one that reaches the bank.

Every attempt — sent or failed — is written to a **PayslipMail** tab, and the payroll table grows an
**Emailed** column showing `sent` (hover for the address and the time) or `failed` with the reason.
Anything that failed is listed after the run, with the address and why.

The subject, the message, the sender name, reply-to, cc and bcc, and whether to attach the PDF, are
all in **Settings → Payroll rules**. The subject and message take `{name}` `{code}` `{month}`
`{company}` `{net}` `{gross}` `{paid_days}` `{lop_days}`, filled in per employee.

In the **demo** nothing is emailed anywhere: the send is recorded so you can see the screen work,
and no mail leaves the browser.

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

### The employee side: punch in and punch out

Anyone whose login is linked to an employee — by `emp_code` on the **Users** tab, or by a matching
email on their employee record — gets a punch card at the top of the dashboard: their name, the
shift they are on, in time, out time, hours so far, and how late they were if they were.

**The time comes from the backend, not the browser**, so moving a device clock does not move an
in-time. Punching in twice, or out without having punched in, is refused with the reason.

**Punch out is mandatory** (Settings → Shifts & attendance). A day punched in but never punched out
is *not* a paid day: it is flagged on the register with a red corner, listed in Reports → Attendance
exceptions, and counted as LOP until somebody closes it. In testing, one open day moved that
employee's LOP from 0.5 to 1.5 — a full day of pay — which is exactly the gap the rule is there to
close. Turn the setting off and an open day is simply paid as present.

The employee sees the open day on their own punch card and can fix it in one click: **Raise a swipe
request** opens a request already filled in with the date, the in-time that was recorded and the
reason, for HR to approve.

Employees only ever see themselves — their own attendance, leave, requests and payslips — and the
admin-only buttons are not rendered for them.

### Geofencing the punch

Turn on **Geofence the punch** in Settings → Shifts & attendance and add your gates to the **Punch
sites** table: name, latitude, longitude and a radius in metres. Stand at the gate and press **Use my
location** to fill a row in, then check the pin on a map before saving.

When someone punches, the browser asks for a location and sends it with the punch. **The distance is
worked out in the backend, not the browser**, so the check cannot be skipped by editing the page.

| Case | What happens |
|---|---|
| Inside an allowed site | Punch accepted, and the site and distance are recorded on it |
| Outside every site | `block`: refused, naming the site, the distance and the allowance ("about 6,148 m from Head office, which allows 150 m"). `warn`: allowed, and how far away it was is recorded |
| Location too rough | Refused above *Reject a location less accurate than* (120 m by default) rather than trusted |
| No location sent | Refused under `block` |
| Approved **OD** that day | Allowed from anywhere and tagged *out duty*, so field staff are not stuck |
| Employee tied to a site | Set **Punch site** on their record and only that gate works; blank means any active site |

Every web punch stores latitude, longitude, accuracy, the matched site and the distance on the
`Punches` tab, so an argument later can be settled from the record.

**Two honest limits.** Browser geolocation only works over **https** (or localhost) — a file opened
from disk or served over plain http will not return a position, and under `block` nobody will be
able to punch. And a determined phone can still lie about where it is: a geofence raises the bar,
it is not proof. Use `warn` mode first if you want to see the data before enforcing on it.

### Requests — OD, swipe and comp-off

Configured under **Settings → Requests**, raised and approved on the **Leave → Requests** tab. A
request type says what approval *does to the register*, which is the only thing that matters:

| Type | Effect | What approval does |
|---|---|---|
| **OD** — out of office duty | `present` | Marks the day **OD**: duty away from the office. Paid, counted as present, and visible as its own status rather than hidden inside "P". Takes a date range for a multi-day visit |
| **SWIPE** — swipe request | `times` | Writes the in and out times onto that day and re-reads the status from the hours worked. Covers a **missed punch**, **out duty** and **emergency duty** — the reason is recorded on the request. Capped at 3 a month by default |
| **CO** — compensatory off | `comp_off` | Earned *only* for a weekly off or holiday that was actually worked. Then either **set against an absent day** — that day becomes **CO** and stops being LOP — or **paid out**, which payroll picks up as an incentive that month |
| *(any)* | `none` | Recorded and approved, but the register is left alone |

Comp-off is checked before it is granted: the earning day must be a weekly off or a holiday (a
working day is refused outright), the day being covered must be an unpaid absence, and neither may
sit in a month whose payroll is finalised. A payout is valued at one day of the employee's gross on
the current salary divisor and appears on the payslip as *Incentive (incl. N comp-off days)*.

The **comp-off ledger** on the same tab shows, per employee, what is pending, approved, set against
an absence, paid out and lapsed. Credits lapse after *Comp-off lapses after* days (90 by default);
payouts can be switched off entirely.

Two new day statuses come with this: **OD** (out duty — paid, counts as present) and **CO**
(comp-off taken — paid, not a working day). Both appear on the register, in the month summary, in
the attendance share of the reports, and neither counts as LOP.

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
3. **Click Set up.** Reload the spreadsheet tab. A new **HRMS** menu appears next to *Help*:
   choose **HRMS → Set up / update the database**. Approve the permission prompt once, then
   choose it again. That single click builds the whole backend and tells you what it made.

   It creates eighteen tabs — `Settings`, `Users`, `Employees`, `Attendance`, `Leave`, `Payroll`,
   `Holidays`, `Events`, `Sites`, `Punches`, `Shifts`, `LeaveTypes`, `RequestTypes`, `Requests`,
   `CtcVariables`, `CtcComponents`, `CtcValues`, `PayslipMail` — seeds a General shift, the four
   standard leave types and the company's salary structure, generates the key that signs logins,
   and creates the first admin account.

   **It is safe to press again, any time.** New tabs and new columns are added, existing data is
   left exactly where it is, and nothing is re-seeded. That is also how an older install picks up
   a new tab. (The same thing still runs from the Apps Script editor as the `setup` function, if
   you prefer.)

   The other two menu items: **Show the web app link** prints the `/exec` URL, and **Reset the
   admin password** is the way back in if the admin password is lost — it can only be used by
   someone who can already open the spreadsheet.

   The first time you email a payslip, Apps Script asks once more for permission to send mail as
   you.
4. **Deploy the web app.** *Deploy → New deployment → type: Web app*.
   - Execute as: **Me**
   - Who has access: **Anyone**

   Copy the `/exec` URL it gives you.
5. **Connect the file to that URL — once, before you hand it out.** Open `index.html` in a text
   editor and put the `/exec` URL into the line near the top of the first `<script>` block:

   ```js
   var DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfy.../exec';
   ```

   Now everyone who opens the file just sees a sign-in box. Nothing about Apps Script, script
   URLs or connection settings is shown to staff anywhere on the login screen.

   If you would rather not edit the file, the same panel is still reachable on the machine
   you are setting up: **tap or click the logo five times**, or add `#setup` to the URL
   (`…/index.html#setup`). Paste the URL there and it is remembered on that device. It can
   always be changed later from *Settings → Integrations*.
6. **Sign in** with **admin@company.com / admin123** and change the password immediately from
   *Settings → Account*.

### Renaming it

The login screen and the sidebar read their name and wording from one block at the top of the
first `<script>` in `index.html`:

```js
var BRAND = { name: 'BISCS', suffix: 'OS',
  headline: 'People and payroll, in one place.',
  lede: '…the paragraph under the headline…',
  footer: 'BISCS OS · Dynamic Engineers' };
```

Change those five strings and the whole app follows; no other edit is needed.

### Putting it on Netlify

`netlify.toml` in this folder is ready to use. In Netlify, *Add new site → Import an existing
project*, pick the repository, and set one thing:

- **Base directory:** `hrms-lite`

Leave the build command and publish directory alone — Netlify reads them from `netlify.toml`,
which copies **only `index.html`** into the published folder. The Apps Script backend, the LAN
agent and this README stay in the repository and never reach the internet.

If you would rather not connect the repository at all: make a folder containing just
`index.html` and drag it onto the Netlify dashboard. Same result, no configuration — you only
lose the automatic redeploy when the file changes.

Set `DEFAULT_API_URL` before you deploy, so staff only ever see a sign-in box.

Two things HTTPS gives you that opening the file directly cannot:

- **Geofenced punching starts working.** Browsers refuse to give a page the device's location
  over `file://` or plain `http://`. On Netlify it is served over HTTPS, so *Settings → Shifts &
  attendance → Geofence the punch* becomes usable.
- **Everyone is on the same copy.** Push a fix and the next person to open the page has it;
  `netlify.toml` sets `Cache-Control: must-revalidate` on `index.html` so nobody is served a
  stale app.

The headers in `netlify.toml` also stop the sign-in page being framed by another site, keep the
workspace URL out of referrer headers, switch off camera/microphone/payment access, and add a
content security policy that allows the page to talk to **your Apps Script workspace and nowhere
else**.

Note what this does *not* do: a Netlify site is public, so anyone with the link reaches the
sign-in page, and the workspace URL is inside a file anyone can download. That is fine, and it is
fine precisely because of the section above — the URL on its own gets you nothing, since every
action needs a signed session and the session decides what is allowed. (Netlify's own password
protection, on a paid plan, adds a second door if you want one.)

Host `index.html` anywhere static (Google Drive, an internal share, GitHub Pages, any web
server) or just email the file — it needs no server of its own.

## Who can see what: owner, HR and employee

There are three roles, and the line between them is drawn **in Apps Script, on the server** — not
in the browser. That distinction is the whole point: a browser can be opened, edited and its
requests replayed by anyone sitting at it, so any rule that lives only in the browser is a
suggestion. These rules are not.

**Owner** runs the system. **HR** runs the company. **Employee** sees their own record.

| | Owner | HR | Employee |
|---|---|---|---|
| HR dashboard (headcount, present/absent, payroll cost, attention list) | yes | yes | **no** — they get *My dashboard*: punch card, their month, leave balance, last payslip |
| Employees module (everyone's profile and salary) | yes | yes | **no** |
| Attendance | mark, edit, bulk fill, import | same | **their own month, read only** — no clickable cells, no column fill |
| Payroll | run, finalise, bank file, email payslips | same | **their own payslips only**, print them |
| Leave and requests | approve, reject, cancel anyone's | same | **apply for and withdraw their own** |
| Reports | yes | yes | **no** |
| Settings: shifts, holidays, leave policy, requests, CTC, payroll rules, import | yes | yes | **no** |
| **Accounts** (who can sign in, and as what) | **yes** | no | no |
| **Integrations** (eSSL and SQL credentials, pull/push, test) | **yes** | no | no |
| Punch in / out | — | — | their own, always |

`admin` is the old name for `owner` and keeps working, so an install made before this existed
needs no migration.

### Adding an HR account

*Settings → Accounts → + Add account.* Fill in the email, pick **HR**, set a password, Create.
Hand them the site link and that password; they change it themselves from *Settings → Account*.

The password is sent once over HTTPS and **hashed on the server** — it is never stored as typed,
and no password or hash is ever sent back to any browser, including yours.

Choosing **Employee** requires a **linked employee**, picked from a dropdown of your actual
staff. That link is what the server uses to decide which rows they may see, so it cannot be
mistyped and it cannot be left empty.

Two guards you cannot talk your way past: **the last owner account** cannot be demoted, disabled
or deleted, and **you cannot remove your own owner access** — otherwise nobody could get back in.
If someone is only away for a while, set *Active: No* rather than deleting them; their employee
record, attendance, leave and payslips are untouched either way.

If you are ever locked out completely, the way back is from the spreadsheet itself:
*HRMS → Reset the admin password*.

### What actually stops them

Every request carries a **signed session token**, issued at sign-in. It is an HMAC-SHA256 over
the email, role, employee code and an expiry, signed with a key generated at setup that never
leaves the script. A token that has been edited in any way fails the signature check; one older
than **12 hours** is refused as expired.

The token says who they *were*. Before each request the server re-reads the `Users` tab for who
they *are*, so a disabled account or a role taken away stops working on the very next request —
no waiting for a session to lapse.

Then the request is authorised:

- An employee may call only `bootstrap`, `changePassword`, `punchState`, `webPunch`, and `save` /
  `remove` **on the `Leave` and `Requests` tabs alone**. Everything else — `saveSettings`,
  `saveMany`, `removeMany`, `list`, `setSecret`, `esslPull`, `sendPayslips`, any write to
  `Attendance`, `Employees`, `Payroll` or `Users` — is refused outright.
- **HR** may do the whole job but not the owner's: `listUsers`, `saveUser`, `removeUser`,
  `setSecret`, `secretStatus`, `testIntegration`, `esslPull` and `esslPush` are refused, as is any
  write to the `Users` tab through the generic `save` / `saveMany` / `remove` routes. When HR
  saves Settings, the `essl_`, `sql_` and `sync_` keys are dropped from the save rather than the
  whole thing being rejected — the settings screen submits every field it shows at once, and those
  panes are not rendered for HR in the first place. Their `bootstrap` carries no account list and
  no integration credentials.
- On the writes they *are* allowed, the server **overwrites the fields that matter** rather than
  trusting them: `emp_code` becomes their own, so a leave application filed under someone else's
  name is filed under theirs; `status` is forced back to `Pending`, so approving their own leave
  does nothing; `decided_by` and `decided_at` are stripped. A row that is already decided cannot
  be touched at all.
- `changePassword` ignores the email in the request and uses the session's, so it can only ever
  change their own.
- `webPunch` and `punchState` ignore the employee code in the request and use the session's, so
  nobody can punch in for a colleague.

And the data never leaves the server in the first place: **`bootstrap` is scoped by role.** An
employee's browser is sent their own employee record, their own attendance, leave, requests,
punches and payslips, plus the holidays, shifts and leave types needed to read them — and nothing
else. No other person's salary is ever in their browser to be found. Settings to do with the
biometric link, the SQL agent, payslip mail and imports are stripped out too.

`setup` is public **only while the sheet has no accounts yet**, so the first run needs no login.
After that it is an admin action like any other.

You can see all of this for yourself: open the demo and use the switch in the bottom-left corner,
which cycles **owner → HR → employee**. The demo scopes its data the same way the server does.

## Adding users by hand

Normally you would use *Settings → Accounts*, above. If you would rather edit the sheet directly,
add a row to the **Users** tab — `role` is `owner`, `hr` or `employee`:

| email | password | role | emp_code | active |
|-------|----------|------|----------|--------|
| priya@company.com | *(see below)* | employee | EMP0004 | yes |

**`emp_code` is what connects a login to a person** — it must match their code in the `Employees` tab exactly, or they sign in to an empty
screen that says so. It is also what the server uses to decide which rows they may see, so a
typo here means they see nothing, never someone else's. Passwords are stored as SHA-256 hashes: the
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
- **Email quota**: payslip mail uses Google's own quota — about 100 a day on free Gmail, 1,500 on
  Workspace. Over that, the send stops and says so; the rest go the next day and the already-sent
  ones are skipped.
- **Security**: the deployment is public-by-URL, but the URL alone gets you nothing — every action
  other than sign-in needs a valid signed session, and the session decides what is allowed. For
  anything stricter, set the deployment to "Anyone within <your organisation>" instead.
- **Sessions last 12 hours** and are held in memory only, so closing the tab means signing in
  again. That is deliberate on shared factory machines.
- **Passwords** are SHA-256 hashes without a per-user salt. That is adequate for an internal tool
  where the sheet is only visible to HR, but it is not what a public service should use. Anyone
  who can open the spreadsheet can read the hashes — so keep the spreadsheet shared with HR only.
- **The JSONP fallback** (used only if the browser cannot POST) puts the session token in the URL,
  where it may appear in Google's request logs. The normal path is a POST and does not.
