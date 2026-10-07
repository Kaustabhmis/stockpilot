# Launch audit

Audited the whole system against the question: *what breaks, leaks or embarrasses
us in the first month?* Three things were found open in the finished product and
are now closed. Four things remain, and three of them are yours, not the code's.

Every finding below is pinned by a test in `tests/audit-test.js`, so none of them
can quietly come back during a refactor.

---

## Fixed — these were real

### 1. Any signed-in user could read the whole company's work

`getDashboard` filtered tasks by what you are allowed to see. The `getTasks`
route returned the raw sheet with no filter at all. Any Doer with a valid token
could ask for it and read every task in their workspace — salary reviews,
disciplinary follow-ups, acquisitions, anything a manager had logged.

The front end never calls that route, which is exactly why it went unnoticed: it
was reachable by anyone who opened the network tab once. The visibility rule now
lives in one function, `visibleTasks_`, and both routes use it.

**Severity: high.** Within-tenant confidentiality, on a product sold on the
promise that performance data is handled carefully.

### 2. The password-reset route was an email cannon

`forgotPassword` deliberately answers identically whether an account exists or
not — correct, it stops account enumeration. But it was unthrottled, and it
sends mail.

Apps Script gives the whole project **one shared daily mail quota** across every
tenant. A bot hitting that route does not just fill one person's inbox: it burns
the quota, and then every assignment, approval, review and reminder email in the
product stops going out, for every customer, silently, until midnight.

Now throttled twice — five per address an hour, sixty across the project an hour.
`register` and `contactSales` are throttled too.

**Severity: high.** A trivially-triggered outage of all customer email.

### 3. Check-then-act with no lock

Five handlers read a count or a uniqueness rule and then wrote: `registerCompany_`,
`createTask_`, `addUser_`, `createProject_`, `grantPlan_`. `appendRow` is atomic
on its own, but two people clicking at the same moment both pass the check and
both write. In practice: two companies on one login email with no way to tell
them apart at sign-in, a workspace one user over its plan cap, a duplicate
username quietly taking over somebody else's work, or one payment overwriting
another's expiry date.

All five now run inside `withLock_`. If the lock cannot be had in thirty seconds
the write does **not** go ahead — racing through is the failure being prevented.

**Severity: medium.** Needs concurrent use to bite, which is what growth is.

### 4. A second script file would have disabled email escaping

`domebox/reminders.gs` is the scheduler — the daily digest and recurring-job
generation. It is a second file in the same Apps Script project, and Apps Script
puts every `.gs` file in **one global scope where the last definition wins**.

That file defined its own `esc_`, which `code.gs` also defines, and the two were
not the same: the scheduler's version did not escape the apostrophe. Adding the
file — step one of making reminders work — would have silently turned off
apostrophe escaping in every email the product sends, with nothing to show for
it until somebody wrote a task called *O'Brien audit*.

Every private helper in that file is now prefixed `rm`, and its escaper handles
the apostrophe.

**Severity: medium, and it would have been invisible.**

---

### 4b. The Reports page scaled with headcount

Measured, not guessed: one Reports load for a twenty-person workspace cost
**824 full-sheet reads**. `getAnalytics_` builds a twelve-period trend and
called `scoreOpts_` once per person *per period*, each call re-reading the whole
Users sheet twice and the Cookies sheet once. At 150 people that is ~5,900
reads for one page.

The page therefore got slower exactly as a customer became worth more, and Apps
Script kills any execution at six minutes — so the largest account is the first
one that cannot open its own reports. None of it varied by period anyway: a WIP
limit is a constant and the cookie window is always the current month.

Reads are now memoised for the life of a request and every write drops the
cache, with a lint rule that fails the build if a tenant-scoped function writes
without invalidating. **824 → 5, and flat:** adding 25 more people costs no
extra reads at all.

**Severity: medium now, high at scale.**

## Open — and three of them are not the code

### 5. The scheduler is not installed (yours, 15 minutes)

It now installs **three** jobs, not two: the daily digest, recurring-job
generation, and the renewal reminders. `domeBoxScheduleStatus()` names any that
are missing rather than just counting the ones that are there.

`code.gs` serves the app. It does not send reminders or spawn recurring
occurrences on a schedule — `reminders.gs` does, and it has to be added as a
second file and have `installDomeBoxSchedules()` run once.

Until then, nobody is reminded of anything, and a recurring job only produces its
next occurrence when somebody closes the last one, so one forgotten task ends the
series — exactly when the reminder mattered. The landing page sells reminders.
Steps are in `DEPLOY-NEW.md` §1b.

### 6. Eight legal fields are still blank (yours, needs your documents)

`netlify/site-config.json` has registered address, phone, GSTIN, entity type,
registration number, grievance officer, and jurisdiction city/state all empty.
`gen-pages.js` refuses to build until they are filled, so this cannot ship by
accident — but it also means **the policy pages do not exist yet**, and Razorpay
checks that the address on your site matches the account.

A named grievance officer is mandatory under the Consumer Protection
(E-Commerce) Rules 2020. "Support team" does not satisfy it.

### 7. Existing customers have not been told about the price change (yours, today)

The code honours every current customer: `Monthly` and `Yearly` keep the caps and
prices they were sold, and gain the full feature set. But a price change a
customer discovers from a renewal invoice costs more goodwill than the change
earns. Email them and confirm the grandfathered rate **in writing** before the
new pricing goes live.

### 8. Mail volume has a ceiling you will reach (plan for it)

100 recipients a day on a consumer Google account, 1,500 on Workspace, shared by
every tenant. One digest per person per day is cheap, but per-event mail comes
out of the same budget. Past a few hundred active users, move transactional mail
to a real provider before it starts failing silently. Noted in `DEPLOY-NEW.md` §1c.

---

## Checked and sound

| | |
|---|---|
| Secrets | None in `dist/code.gs`. All read from Script Properties. |
| Identity | Always from the signed token; `params.user` appears nowhere but a comment about the old build. |
| Passwords | Salted, iterated, peppered; never returned in any response. |
| Tenant files | Never shared publicly. The old `ANYONE_WITH_LINK/EDIT` call is gone. |
| Payments | Razorpay signature verified server-side, re-confirmed by API, and the webhook signature is verified with a constant-time compare. |
| Plan limits | Enforced on the server, where the browser cannot argue. |
| Login | Throttled, 8 attempts per 15 minutes. |
| Email HTML | Every interpolated value escaped. |
| Role gates | A Doer cannot reach a manager route; the last Admin cannot be removed or demoted. |
| Scoring | 0–100 at both ends, enforced in one clamp. |
| Schema changes | Additive only — columns appended, never inserted or moved. |

**718 checks across twenty suites** at the time of this audit, run against the
real `dist/code.gs` on an in-memory Sheets shim and the real `dist/index.html`
in a real browser. The suite has grown since; `tests/README.md` is the current
list. This document is the record of what that audit found, not a running
total.

---

## The order I would do it in

1. Fill the eight fields in `site-config.json`, run `gen-pages.js`, deploy the
   policy pages. *Blocks Razorpay.*
2. Email existing customers about pricing. *Blocks the new prices going live.*
3. Stand the new script up in a **sandbox project** with its own registry and
   template. Do not paste over the live one.
4. Add `reminders.gs`, run `previewDailyReminders()`, read the log, then install
   the schedules.
5. Rotate the Razorpay and Gemini keys that were in the old source, and run
   `lockDownAllTenants()` on the live sheets. **Both still outstanding from the
   first audit.**
6. Back up every live spreadsheet, then migrate.
