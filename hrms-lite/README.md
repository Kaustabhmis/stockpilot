# HRMS Lite — 5 modules, Google Sheets as the database

A standalone HR & Payroll system with exactly **five modules**, built to be approved and run
without a database server. It is a separate system from the existing Supabase-based HRMS:
nothing here reads, writes, or touches that Supabase project.

| # | Module | What it does |
|---|--------|--------------|
| 1 | **Employees** | Employee master (single source of truth): full profile, salary structure, PF/ESI flags, CSV import/export |
| 2 | **Attendance** | Monthly register grid, click-to-mark P/A/HD/L/WO/H, "mark month present", LOP and paid-day calculation, CSV export |
| 3 | **Leave** | Applications, approve/reject, per-type balances against annual quotas; approved leave auto-marks the attendance register |
| 4 | **Payroll** | Generates the run from attendance, prorates by paid days, computes PF / ESI / PT / TDS, printable payslips, bank CSV |
| 5 | **Reports** | Headcount by department, attendance summary, leave summary, payroll cost trend, full salary register |

Settings (company details, statutory rates, leave quotas, password) live in a modal, not a
sixth module.

## Files

```
hrms-lite/
├── index.html            the whole front end — one file, no build step, no npm
├── apps-script/Code.gs   the backend, runs inside your Google Sheet
└── README.md
```

## Try it in 10 seconds

Open `index.html` in a browser and click **"Open demo (sample data, no setup)"**. It loads
8 sample employees with a month of attendance so you can walk your boss through all five
modules. Demo data lives in the browser only — nothing is sent anywhere.

## Real setup (about 5 minutes)

1. **Create the spreadsheet.** In Google Drive: *New → Google Sheets*. Name it e.g. `HRMS Data`.
2. **Add the backend.** In that sheet: *Extensions → Apps Script*. Delete the sample code,
   paste everything from `apps-script/Code.gs`, and save.
3. **Create the tables.** In the Apps Script editor pick the `setup` function from the
   dropdown and press **Run**. Approve the permission prompt (it only asks for access to this
   spreadsheet). This creates six tabs — `Settings`, `Users`, `Employees`, `Attendance`,
   `Leave`, `Payroll` — and seeds the first admin login.
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
paid_days = days_in_month − LOP          LOP = absent days + 0.5 × half days
factor    = paid_days ÷ days_in_month
gross     = (basic + hra + special + other) × factor
PF        = min(basic_earned, ceiling × factor) × pf_employee_pct     (if PF applicable)
ESI       = gross × esi_employee_pct   (if ESI applicable and full gross ≤ ESI ceiling)
PT        = flat amount from Settings
TDS       = the employee's tds_monthly
net       = gross − (PF + ESI + PT + TDS + other deductions)
```

Weekly offs and holidays are paid; only `A` and `HD` reduce pay. All rates, ceilings and the
weekly-off day are editable in *Settings* — the defaults are the Indian statutory ones
(PF 12% on ₹15,000, ESI 0.75% up to ₹21,000, PT ₹200).

Saved runs are never recalculated when rates change later, so historic payslips stay correct.

## Notes and limits

- **Concurrency**: writes take an Apps Script lock, so two people saving at once is safe.
- **Scale**: comfortable to a few hundred employees. Google Sheets allows 10M cells and
  Apps Script caps a request at 6 minutes — attendance is the biggest tab (one row per
  employee per day, about 3,000 rows a year for 10 people).
- **Backups**: *File → Version history* in the sheet, plus the Export CSV button in every module.
- **Security**: the deployment is public-by-URL and authentication is the `Users` tab, which
  suits an internal tool. For anything stricter, set the deployment to "Anyone within
  <your organisation>" instead.
