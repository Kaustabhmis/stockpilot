# HRMS Lite — a dashboard and 5 modules, Google Sheets as the database

A standalone HR & Payroll system: one **dashboard** home screen and exactly **five modules**,
built to be approved and run without a database server. It is a separate system from the
existing Supabase-based HRMS: nothing here reads, writes, or touches that Supabase project.

The dashboard is a home screen, not a sixth module — it only summarises what the five modules
own and links into them. The sidebar keeps the five numbered under a "Modules" heading.

## Dashboard

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

## The five modules

| # | Module | What it does |
|---|--------|--------------|
| 1 | **Employees** | Employee master: full profile, salary structure, PF/ESI flags, exit date. Sortable, searchable, filterable. Per-employee 360° view (profile + salary + attendance + leave history + payslips). Validation on save (PAN format, duplicate email, ESI ceiling, dates). Record-completeness flags. CSV import with per-row validation, CSV export |
| 2 | **Attendance** | Monthly register grid: click to cycle P/A/HD/L/WO/H, double-click for in/out times and remarks, click a date header to fill a column, fill a whole employee-month, fill blank days. Holiday calendar auto-marks H. Late marks and overtime derived from the shift and grace period. Biometric/device CSV import. Locks automatically once payroll is finalised |
| 3 | **Leave** | Applications with live validation (quota balance, overlapping requests, working-day count that skips weekly offs and holidays). Approve / reject / cancel. Month calendar of who is off when. Per-type balances against annual quota. Approving writes **L** onto the attendance register; cancelling clears those days |
| 4 | **Payroll** | Generates from attendance, prorates by paid days, computes PF / ESI / PT / TDS plus employer PF & ESI and CTC. Editable arrears, bonus and other deductions per employee. Month-on-month variance per employee. Draft → finalise → (reopen if needed). Printable payslips, bulk payslip print, bank transfer CSV |
| 5 | **Reports** | Five reports, each exportable: salary register, PF/ESI statutory contributions (challan-style, with employer share), year-to-date per employee (the Form 16 base), attendance exceptions (unmarked days, absences, late marks, high OT), joiners & leavers |

Settings (company details, shift and grace, statutory rates, leave quotas, **holiday calendar**,
password) live in a modal, not a sixth module.

## Files

```
hrms-lite/
├── index.html            the whole front end — one file, no build step, no npm
├── apps-script/Code.gs   the backend, runs inside your Google Sheet
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
   spreadsheet). This creates seven tabs — `Settings`, `Users`, `Employees`, `Attendance`,
   `Leave`, `Payroll`, `Holidays` — and seeds the first admin login. It is safe to re-run:
   new columns are appended, existing data is left where it is.
4. **Deploy the web app.** *Deploy → New deployment → type: Web app*.
   - Execute as: **Me**
   - Who has access: **Anyone**

   Copy the `/exec` URL it gives you.
5. **Sign in.** Open `index.html`, paste that URL, and log in with
   **admin@company.com / admin123**. Change the password immediately from *Settings*.

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
- **Scale**: comfortable to a few hundred employees. Google Sheets allows 10M cells and
  Apps Script caps a request at 6 minutes — attendance is the biggest tab (one row per
  employee per day, about 3,000 rows a year for 10 people).
- **Light mode only**: the UI ships one theme, matching the rest of the app.
- **Backups**: *File → Version history* in the sheet, plus the Export CSV button in every module.
- **Security**: the deployment is public-by-URL and authentication is the `Users` tab, which
  suits an internal tool. For anything stricter, set the deployment to "Anyone within
  <your organisation>" instead.
