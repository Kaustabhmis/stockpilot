# Dome Box — everything, in the order to do it

Built for **www.domebox.in** (BISCS India).

---

## ⛔ Read this first — you have live paying customers

**Do not paste any `.gs` file over your existing `code.gs`.** These are *additional*
files. Your login, signup and data-access code stays exactly as it is. Replacing
it would lock out every customer at once.

In the Apps Script editor: **+ (Add a file) → Script**, name it, paste. One new
file per `.gs` below. Nothing here modifies your existing code.

When you deploy, use **Deploy → New deployment** with a version note, never
"Test deployment" over the head revision. That way you can roll back by
re-pointing to the previous version.

**And before anything else: make a copy of every customer spreadsheet.** File →
Make a copy, by hand, today. That is your only undo until `backup.gs` is running.

---

## What to do, in order

### 1. Backups — today, before anything else

`1-apps-script/backup.gs`

Nothing else on this list matters if you lose a client's data. Sheets version
history is not a backup: it does not survive a customer's own admin deleting
rows, a script writing across a sheet, or access being revoked.

```js
// paste the file, then in the editor:
installBackupSchedule();    // nightly at 02:00
backupAllTenants();         // run once now, by hand
verifyLatestBackup();       // and confirm it actually worked
```

`verifyLatestBackup()` opens each copy and compares tabs and row counts against
the live file. A zero-row copy looks exactly like a success in a file listing,
so this is the step that tells you whether you are really covered.

To restore later: `restoreTenantToNewFile('Acme')`. It copies to a **new** file
and never writes to a live sheet — by the time you are restoring, the live file
holds work created after the backup, and you get to decide what wins.

Set `BACKUP.FOLDER_ID` after the first run so the folder is never ambiguous.

### 2. Razorpay webhook — you may be losing payments now

`1-apps-script/billing.gs`

A browser success handler is not a source of truth. A customer who closes the
tab between paying and the callback firing is charged and stays on Free.

1. Script Properties → add `RAZORPAY_WEBHOOK_SECRET`.
2. **Deploy → New deployment → Web app** (Execute as Me, Access Anyone).
3. Razorpay Dashboard → Settings → Webhooks → paste the `/exec` URL and the
   same secret.
4. Subscribe to: `payment.captured`, `payment.failed`, `subscription.charged`,
   `subscription.halted`, `subscription.cancelled`, `refund.processed`.

Every event is HMAC-verified before it is trusted. Without that, anyone who
found the URL could grant themselves Enterprise by posting JSON.

**Important:** include `notes.email` when you create a Razorpay order, or the
webhook cannot tell which customer paid. It will email you rather than guess.

### 3. Plan limits — you are giving Pro away at Free prices

`1-apps-script/plans.gs`

Your pricing page promises 5 users / 50 tasks on Free and 20 / 500 on Standard.
Nothing enforced any of it. Call `canAddUser()` and `canCreateTask()` in your
server-side create paths — a limit checked only in the browser is a suggestion.

Recurring occurrences deliberately do **not** count against the monthly cap: a
Free customer with five daily recurring jobs would otherwise burn all 50 in ten
days through no action of their own.

### 4. The app itself

`2-paste-into-website/domebox-app.html`

One self-contained block: task assignment, team management and reports. Paste it
into `index.html` beside your other `<div id="view-…">` blocks, then:

```html
<button onclick="toggleView('tasks')">Tasks</button>
<button onclick="toggleView('team')">Team</button>
<button onclick="toggleView('analytics')">Reports</button>
```

```js
// after login — ALWAYS pass the real company and plan
DomeBoxApp.start({
  company: 'acme',
  plan:    'Pro Yearly',
  actor:   { username:'admin@acme.in', role:'Admin' },
  backend: { loadAll, saveTask, saveUser }     // your Apps Script calls
});
```

**`demo:true` only on a sandbox.** It is the only thing that creates sample rows,
those rows are tagged, and any backend write of a tagged row is refused — so
demo data cannot reach a customer's sheet.

`view-analytics.html` is the reports view on its own, if you want only that.
`tailwind.min.css` is your compiled stylesheet — 9.4 KB against the ~3 MB play
CDN you load today. See `3-guides/landing-fixes.md`.

### 5. Reminders and WhatsApp

`1-apps-script/reminders.gs` — daily email digests and recurring job generation.
Starts in `SCHED.DRY_RUN = true`. Run `previewDailyReminders()` and read the log
before going live.

`1-apps-script/whatsapp.gs` — read `3-guides/WHATSAPP-SETUP.md` first. Requires
Meta business verification and template approval, which take days and only you
can do. It ships disabled with a test allowlist, because messaging people who
did not opt in gets your company's number banned for every customer at once.

### 6. Website corrections

`3-guides/landing-fixes.md` — three find-and-replace fixes:

- Your structured data declares the product **free** while you charge ₹2,499 and
  ₹19,999. That contradicts the visible page and risks a manual action.
- The footer says **"Dome Box Inc."**, which is not your legal entity. Razorpay
  checks this, and it is what a customer sees on a GST invoice.
- Missing `canonical` and `og:image`, so every WhatsApp share of your link
  renders as a grey box.

---

## Files

| Where | What it does |
|---|---|
| `1-apps-script/domain.gs` | All the rules: status transitions, delegation, recurrence, scoring, appraisals. Pure logic, no I/O. |
| `1-apps-script/reminders.gs` | Daily email digests, recurring job generation. |
| `1-apps-script/backup.gs` | Nightly tenant backups, verification, restore. |
| `1-apps-script/plans.gs` | Plan limits matching your pricing table. |
| `1-apps-script/billing.gs` | Razorpay webhook, HMAC-verified. |
| `1-apps-script/whatsapp.gs` | WhatsApp channel: sender, opt-in ledger, STOP handling. |
| `2-paste-into-website/domebox-app.html` | Tasks + team + reports, one paste-in block. |
| `2-paste-into-website/view-analytics.html` | Reports only. |
| `2-paste-into-website/tailwind.min.css` | Compiled stylesheet, 9.4 KB. |
| `3-guides/WHATSAPP-SETUP.md` | Meta setup, the 4 templates to submit, cost arithmetic. |
| `3-guides/landing-fixes.md` | Website corrections, ready to paste. |
| `4-screenshots/` | Real screenshots of the running app — usable on the site. |

---

## How the scoring works, in one paragraph

A delegation score blends on-time delivery (45%), first-pass quality (30%) and
queue health (25%). High-priority work counts three times a low-priority one, so
one missed critical task cannot be averaged away under a pile of trivial wins.
Work sitting in review never counts against the person who delivered it — the
ball is with the reviewer. Nobody signs off their own work. A manager who owns no
tasks is still scored, on how fast they clear approvals. A period with nothing
closed in it reports "no data" rather than inventing a score from an old queue.
And when you supply a leave calendar, weekends, holidays and approved leave are
not charged as lateness — so a fortnight off no longer wrecks someone's
appraisal.

---

## Still outstanding — these need you, not code

1. **Meta verification + template approval** before WhatsApp can send. You are
   currently selling "WhatsApp Alerts" on Pro and Enterprise; mark it coming soon
   until it works.
2. **Your pricing is inverted.** Pro Yearly is ₹19,999/yr for 300 users and
   unlimited tasks. Standard is ₹2,499/mo = **₹29,988/yr** for 20 users. Pro is
   cheaper *and* strictly better, so no informed customer should ever buy
   Standard — and existing Standard customers who work this out will feel
   overcharged.
3. **WhatsApp may cost more than Pro earns.** One 300-user Pro tenant at one
   alert per working day is ~6,600 messages a month. Check current Meta rates for
   India before promising it. `WA.MAX_PER_TENANT_PER_DAY` (200) is your circuit
   breaker.
4. **Policy pages.** Privacy and Terms are one sentence each; there is no
   Refund/Cancellation page. Razorpay rejects placeholders, and holding employee
   performance data puts you under the DPDP Act 2023.
5. **GST invoicing** with your GSTIN and SAC code. Your B2B customers need it to
   claim input credit, and some will not buy without it.

---

Tested: 393 unit checks on the rules, 119 browser checks on the interface.
