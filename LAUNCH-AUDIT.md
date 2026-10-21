# Launch audit

Audited the whole system against the question: *what breaks, leaks or embarrasses
us in the first month?* Three things were found open in the finished product and
are now closed, three more in the Goals and Meetings release (4c–4e), three in the archive and reminders release (4f–4h), and two in the scheduler and backups (4i–4j). Four things remain, and three of them are yours, not the code's.

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

### 4c. Submit, Send back and Verify from the task panel saved nothing (live today)

The status dialog's form and the Tasks status filter shared one element id.
`$('fStatus')` found the filter first, so the dialog's submit was never
intercepted: the browser did a plain form submit, reloaded the page, and the
status change was lost. Anyone who used the task panel for review steps saw
"nothing happened". The form has its own id now, `tests/task-dialog-ui-test.js`
drives it end to end, and `tests/wiring-test.js` fails the build on any
duplicate id in the page — it has since caught another clash while meeting
delegation was being added.

### 4d. A row cleared by hand in a sheet could redirect an edit

The Goals, Key numbers, Meetings and meeting-points readers skipped blank rows
*before* counting rows, so one row cleared by hand in Google Sheets made every
later record point one row too high; the next status change landed on its
neighbour. Rows are now numbered first. Pinned in `tests/goals-test.js`.

### 4e. Meeting points could be edited from outside the meeting

`updateMeetingItem` checked who raised a point but not whether the caller was
in that meeting, or whether the meeting had ended. A manager who knew an item's
id could rewrite another team's record. Now only people in that meeting touch
its points, an ended meeting's record is fixed, and open roadblocks — which
carry over by design — stay editable by the people who were there. Pinned in
`tests/meeting-test.js`.

### 4f. An edit during the monthly archive could land on the wrong task

Task edits find a row and write to it by row number, without the script lock.
The archive removes rows under the lock — so an edit in flight while it ran
would write into whichever task had shifted into that row. Every task write now
checks the row still holds the same task ID and finds it again if not; a task
that moved away mid-edit is refused with a reason. Pinned in
`tests/archive-test.js` (fails on the old code).

### 4g. The scheduler re-read its whole send log before every email

With three reminder slots a day the log grows by thousands of rows a month, and
it was read once per person per run — a run would eventually pass Apps Script's
six-minute limit and silently stop. It is now read once per run. The archive run
also stops cleanly between customers before the limit and says how to carry on.

### 4h. Reminders ranked a workspace's own priority names as "Medium"

"Line Down" and "Customer Hold" are the workspace's own levels with their own
weights; the reminder email only knew Critical/High/Medium/Low. It now reads the
workspace's weights. Pinned in `tests/reminders-test.js`.

### 4i. The scheduler could not find a single customer

`reminders.gs` looked for a registry tab called "Accounts" and read each
company's plan from a Billing tab inside the company's file. The app's
registry tab is **Directory**, and the plan lives there. On a real deployment:
no reminders, no digest, no renewal notices, and **no repeating task was ever
created**. Every scheduler test had built its own "Accounts" tab. It now reads
Directory, and Plan / Valid Until from it. `tests/scheduler-live-test.js` runs
code.gs and reminders.gs together against a registry the app itself created —
it fails on the old file.

### 4j. Backups never ran

`backup.gs` (and `whatsapp.gs`) called `loadTenants_`, a name that no longer
existed after the scheduler's helpers were prefixed. `backupAllTenants` failed
on its first line every night and only said so in an alert email. It now uses
the app's own registry. `tests/scope-test.js` fails if any file calls a helper
that is not defined anywhere in the project.

### 4k. Two tests that would fail on their own, given time

- `migration-test` checked "this month's" score for work done in September, so
  it began failing on 1 October with no code change. It now asks about
  September directly.
- `demo-ui-test` failed when another suite had built the demo first on the same
  test server; `createDemoAccount` rightly refuses to build over an existing
  demo. The harness now removes the old demo before building a fresh one.

### 4l. Corporate colour scheme

The app, website pages, favicon and user manual now share one palette: navy
`#13294b` app bar, blue `#1e4fbf` for actions, teal `#0c7a71` as the accent,
cool grey surfaces, and gold `#d4930f` only as decoration. Red, amber and green
are kept for status. Text colours meet WCAG AA (4.5:1) on their backgrounds,
and the four chart colours pass the colour-blind safety check. Only colours
changed — no layout, wording or behaviour.

### 4m. Scoring: the arithmetic, checked by hand

Every rule was recalculated on paper and checked against the engine
(`tests/scoring-math-test.js`, 48 hand-worked cases). Eleven were wrong:

- **One person had three scores.** The dashboard, the leaderboard/Reports and
  the appraisal each measured a different window (96 on the dashboard and 86 on
  the leaderboard for the same person, in the test). All of them now use this
  month's score; `tests/score-consistency-test.js` asks every screen.
- **Late stages.** A stage that reached its owner late, but before its own date,
  kept the original date — the opposite of the manual's own worked example. And
  the on-time and queue parts of the score never used the moved date at all, so
  the owner was charged for the earlier stage's delay twice.
- **Cookie points** loaded only this month's awards and added them to every
  past month. Each period now counts its own.
- **A slow approval** was charged again in every later month. It now counts
  once: in the month it was cleared, or the current month while it waits.
- **Work already handed in** at the end of a month counted as overdue in that
  month's score. It no longer does — only work that was still with the person.
- **Self-raised work:** a person was made the reviewer of their own task and
  charged for the wait, though only an Admin can sign it off.
- **Weekly scores** were measured against a month's expected load, so a good
  week scored about 40; quarter and year views had no load check at all. The
  expectation now scales with the period.
- **The Team page and the AI summary** ignored each person's WIP limit and
  cookies.
- **"See why"** showed a "+30" for a met project stage that no sum produced; it
  now shows the stage's real points out of 100. The projects table counted
  lateness in calendar days while the score used working days; both use
  working days now.
- **The manual said five days late is zero.** At 10 points a working day it
  is 50; ten days is zero.

### 4n. Selling without a salesperson

- **14-day Growth trial** for every new workspace (registry Status `Trial`). When it ends the
  workspace moves to Free — never read-only — and the owner gets trial notes at 3, 1 and 0
  days instead of renewal notices. Paying during the trial adds the days left.
- **A public live demo, view-only.** `openDemo` issues a two-hour token carrying a read-only
  mark; the router allows only an explicit list of read routes for it, so anything that
  writes, emails, pays or calls the AI is refused. A token with the mark removed fails its
  signature. Visitors can switch between the owner, a manager and a team member.
- **The home page** now shows the product (real screens, a nine-part tour), the demo, how it
  works, an ROI calculator that uses only the visitor's own figures, a comparison with
  WhatsApp and Excel, answers to buyers' questions and a call-back form (sent to us only,
  throttled). No testimonials or customer claims.
- **Found on the way:** during a trial the Plans window showed Growth as "Current plan" with
  no Buy button, so a trialling customer could not buy the plan they were trying; and the app
  kept the plan it saw at sign-in, so a trial ending or a payment landing did not show until
  the next sign-in. Both fixed.
- A new empty workspace shows a three-step start (add your team, assign a job, open the
  manual) instead of "No tasks yet".

Tests: `trial-test.js` (27) and `sales-ui-test.js` (32).

### 4o. Home page colour

Audit: four-fifths of the page was white or pale grey, every button was the same blue, and
nothing drew the eye to the trial. Now, within the corporate palette:

- a deep navy-to-blue hero with the promise picked out in gold;
- **gold is reserved for one action** — Start free trial — in the header, hero, tour, ROI,
  pricing, call-back and final call to action, so the next step is always the brightest thing
  on screen;
- alternating bands (navy, blue tint, teal, white) so each section reads as a section;
- coloured icon tiles for the proof strip, the problems and the fairness rules; red ✕ against
  green ✓ in the WhatsApp-vs-Domebox comparison; a navy "Most popular" plan card;
- every text and background pair checked: all clear WCAG AA (4.5:1) — the one that did not
  (light text on teal, 4.4) uses near-white instead.

Only the home page changed; the app keeps its own colours.

### 4p. Final audit after the rename

- **Backups would have started an empty folder.** The rename changed the backup folder's
  name from "Dome Box Backups" to "Domebox Backups". A live script would have created a new
  folder on its next run, orphaned every existing copy and reported "no backup". It now finds
  the old folder, renames it and carries on (`scheduler-live-test`).
- **An expired demo session sent visitors to the sign-in form**, for an account they do not
  have. They now go back to the home page with a note (`sales-ui-test`).
- Checked and sound: `dist/code.gs` carries every source file verbatim; calling all twenty
  read routes as all three demo roles changes no cell of the demo company and sends no email
  (`trial-test`); the security headers allow the new pictures, the manual and the share
  image; no customer-visible "Dome Box" remains in any text, PDF or picture.

### 4q. A fresh start instead of a migration

With one existing client, who can sign up again, there is nothing worth migrating.
`freshStart()` (in `src/19-fresh-start.gs`) builds the backend from an empty Apps Script
project: a Domebox folder in Drive, the Master sheet with its registry tabs, the Template
with every tab a company needs, and the ids and secret keys in Script Properties. It refuses
to run where a working Master sheet already exists. `reminders.gs` now reads the Master id
and a REMINDERS_LIVE switch from Script Properties, so it is pasted in unedited.
`switchOnSchedules()` installs reminders, backups and the archive in one run, and
`setCustomerPlan()` puts a returning customer back on their plan without a receipt or
invoice. Guide: `FRESH-START.md`. Test: `fresh-start-test.js` (20).

### 4r. Final audit: the tax on the price tag matched the tax at checkout only by luck

The home page, the Plans window, the manual and the pricing page all said "prices exclude
18% GST". The checkout and the invoice add GST only when SELLER_GSTIN is set. Unregistered,
a customer was told one price, charged another, and got an invoice without the GST they had
been promised. The wording now comes from the same switch: a public `getPublicInfo` route
returns whether GST applies and at what rate (nothing else), and the home page and Plans
window say either "Prices exclude 18% GST, added at checkout" or "No GST is charged — the
price you see is the price you pay". Static text (manual, pricing page) uses wording true
either way. Tested both ways (`trial-test`, `billing-ui-test`, `ui-test`, `sales-ui-test`).

Also checked: no keys or secrets anywhere in the source or the upload package; `Code.gs`
carries every source file verbatim; the only "Dome Box" left is the backup code that finds
the old folder; the drag-and-drop site loads its config before anything else.

### 4s. The payment safety net could never have worked

- **The webhook was dead on arrival.** Razorpay signs a webhook in an HTTP header, and Google
  Apps Script cannot read request headers. The handler looked for the signature in the URL
  parameters, never found it, and rejected every webhook — so a customer who paid and closed
  the tab stayed on Free. (The test passed only because it put the signature where no real
  webhook does.) Worse, Apps Script answers every webhook with a redirect, which Razorpay
  counts as a failure and eventually disables. Replaced by `reconcilePayments()`: every 15
  minutes it asks Razorpay for the last three days of payments and grants any Domebox
  payment not yet granted. Installed by `switchOnSchedules()`. No webhook, no webhook secret.
  The webhook handler is kept, but now trusts the body only for a payment id and confirms
  everything else with Razorpay.
- **One payment could buy two terms.** The invoice was issued once per payment, but the plan
  extension and the receipt were not guarded: with the page and any second path both
  reporting a payment, a year paid became two. The grant now checks the invoice ledger first.
- Tests: `payment-reconcile-test.js` (15), and `invoice-test.js` now drives the real, unsigned
  webhook path.

### 4t. Found on the first real run: no password could ever be set

`createDemoAccount` failed in Apps Script with "The parameters (number[],String) don't match
the method signature for Utilities.computeHmacSha256Signature". Password hashing ran 1,000
rounds of HMAC; from the second round it passed the previous result (bytes) with the pepper
(text), and Apps Script accepts only text-with-text or bytes-with-bytes. Every signup,
password change and reset would have failed. The key is now converted to bytes once.

Why no test caught it: the three test stand-ins for Apps Script (`gas-shim.js`, and the
private ones in `auth-test.js` and `pay-test.js`) accepted mixed arguments. All three now
reject them exactly as Apps Script does, with the same message.

Also: signup now hashes the password before copying the template, so a failure can no
longer leave an orphaned spreadsheet in Drive.

### 4u. A ₹999 plan for 10 people, and the site no longer says what it is built on

**Team** (up to 10 users, ₹999 a month, ₹9,990 a year, the whole product) sits between Free
and Starter. Free users who hit the 5-user cap are now pointed at Team. It is on the home
page, in the Plans window, in the structured data, on /pricing and in the manual.

The website folder is minified and every comment is removed, so View Source shows the
product and not our build notes. The words visitors could read that named the stack
(the "not connected" message, the config file's notes, the privacy and terms pages) are
neutral now. The privacy page still lists each kind of sub-processor and what it does.
`netlify-package-test.js` fails if any of those names come back.

What cannot be hidden from a technical visitor without a proxy: the browser's Network tab
shows each call going to the backend's own address, and the security header must allow it.

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
