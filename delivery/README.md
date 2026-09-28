# What to deploy

Both files are built from the sources in `hrms-lite/`. They are copies for
downloading, not somewhere to edit - change `hrms-lite/` and rebuild.

- **`Code.gs`** - the Apps Script. Paste it over the script bound to the
  Google Sheet, then deploy the EXISTING deployment. Do not create a new one,
  or the address the apps talk to changes.
- **`biscs-os-netlify.zip`** - the site. Drag it onto Netlify. It holds the
  office screen at `/` and the staff app at `/app/`.

Do the sheet first, then the site. Either order works - a screen running from
an older cached copy tells the workspace nothing and is handed the wider
reach it expects - but this way nobody sees the in-between.

**Open the site twice after uploading.** The installed office app serves its
cached copy first and fetches the new one behind it, so the first open still
shows the previous version.

## Then, in this order

1. **Settings -> Attendance rules.** Check the late-mark slab reads
   `6:1, 12:2, 24:3` - that is "6 late marks cost one half day, 12 cost two,
   24 cost three". Change the numbers here if the policy changes; no code
   needs touching.

2. **Settings -> Payroll.** Check the PF wage ceiling, the PF and ESI
   percentages and the salary divisor are what you file on.

3. **Regenerate every payroll run you have already saved.** A finalised run
   keeps the figures it was saved with, on purpose, so a corrected rule does
   not reach it by itself. Payroll -> pick the month -> Generate from
   attendance. Reopen the run first if it is finalised.

4. **Stop using "Fill blank days" as a way to record attendance.** It marks
   the day present with no times, which is honest - HR saying somebody was
   here is not a record of when they arrived. Days filled this way carry no
   late mark and no overtime, because nothing was measured.

## Months already filled with shift times

Older months may hold days written as 09:30-18:30 by the previous behaviour.
Those are not real arrival times and they carry no late marks. Re-importing
the device export for those months now corrects them - the made-up times are
no longer written, so they can no longer drag a genuine 09:47 back to 09:30.

## Checking it yourself

    cd hrms-lite/tools
    ./run-audit.sh https://your-test-workspace

Seven files. Each states its rules in words at the top and derives every
expected figure from those words, so it checks the system against the rules
rather than against itself. Every case is awkward on purpose - lost days,
somebody exactly on a ceiling, a rupee either side of a limit, mid-month
joiners and leavers - because clean data hides the faults that cost money.

Point it at a TEST workspace, never the live sheet: it writes employees,
attendance, leave and payroll rows.
