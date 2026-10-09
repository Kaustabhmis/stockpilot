# Dome Box — setup, start to finish

www.domebox.in · BISCS India

One guide, in order. Roughly 90 minutes end to end, most of it waiting for DNS.

> **Just want the steps?** [`DEPLOY-EASY.md`](DEPLOY-EASY.md) is the same thing
> as twelve short numbered steps. This file has the reasons behind each one.

Your current site is **live with paying customers**. Nothing here touches it
until Part 5, and that step is a one-click rollback.

| Part | What it is | Time |
|---|---|---|
| [1](#part-1--the-backend) | The backend on Apps Script | 25 min |
| [2](#part-2--the-scheduler) | The scheduler — nothing is chased without it | 10 min |
| [3](#part-3--payments-and-invoices) | Razorpay, the webhook, and GST invoices | 20 min |
| [4](#part-4--the-site-on-netlify) | The site on Netlify | 20 min |
| [5](#part-5--going-live) | Pointing the domain, and migrating | 15 min |
| [6](#part-6--before-the-first-sales-call) | The demo account | 2 min |
| [7](#part-7--the-things-only-you-can-do) | What is still outstanding | — |

Throughout: **run `setupDomeBox()` whenever you are unsure.** It checks
everything it can reach and ends with a numbered list of what is left. It is
safe to run as often as you like.

---

## Part 1 — the backend

### 1.1 Three Google files

1. A copy of your current tenant template → this is the new **TEMPLATE**.
2. A new blank spreadsheet → this is the new **REGISTRY**.
3. A new Apps Script project: **script.google.com → New project**.

Keep the registry and the template ids. They are the long strings in the
spreadsheet URL between `/d/` and `/edit`.

> **Do not point the new project at your live registry yet.** Part 5 migrates.
> Everything before it runs against the new, empty one, so a mistake costs
> nothing.

### 1.2 Paste the code

Open the Apps Script project, delete the sample `myFunction`, and paste the
whole of **`dist/code.gs`**.

### 1.3 Script Properties

**Project Settings → Script Properties → Add script property.**

| Property | Value |
|---|---|
| `MASTER_DB_ID` | the new registry's id |
| `TEMPLATE_ID` | the new template's id |
| `SITE_URL` | `https://www.domebox.in` |
| `MAIL_FROM` | `info@biscsindia.com` |
| `SELLER_LEGAL_NAME` | `BISCS India` |
| `SELLER_ADDRESS` | your registered address, one line |
| `SELLER_STATE` | e.g. `West Bengal` |
| `SELLER_PAN` | optional, printed on invoices |

Leave the Razorpay and `SELLER_GSTIN` ones for Part 3.

`AUTH_PEPPER` and `TOKEN_SECRET` are **generated for you** — do not invent them.

### 1.4 Run setupDomeBox()

Pick `setupDomeBox` from the function dropdown and press **Run**. Google will
ask for permissions the first time; accept them.

**View → Logs** shows the report. It will say the web app is not deployed yet
and that there are no scheduled jobs. Both are expected at this point.

What should already be green:

```
  ok      tabs present: Directory, Global_Users, Reset_Tokens, Billing, Invoices
  ok      template has the tabs a new company needs
```

**Copy `AUTH_PEPPER` out of Script Properties and put it somewhere safe.**
Losing it means every customer has to reset their password.

### 1.5 The sending address

This is the one that stops everything if it is wrong.

```
--- SENDING ADDRESS ---
  MISSING "info@biscsindia.com" is not a verified send-as alias on this account.
```

If you see that: **Gmail → Settings → See all settings → Accounts and Import →
Send mail as → Add another email address.** Add `info@biscsindia.com` and
verify it with the code Google emails.

Until it is verified, **no customer email is sent at all** — not a password
reset, not an invoice, not a reminder. That is deliberate: nothing is ever sent
from a different address instead, because a password reset arriving from
somebody's personal Gmail looks like phishing and teaches a customer's whole
team to distrust mail from you.

Run `setupDomeBox()` again. It should now say:

```
  ok      every email will leave from info@biscsindia.com
```

### 1.6 Deploy

**Deploy → New deployment → Web app.**

| Field | Value |
|---|---|
| Execute as | **Me** |
| Who has access | **Anyone** |

"Anyone" sounds alarming and is correct: it means anyone may *call* the URL,
not that anyone may read data. Every protected call proves identity from a
signed token.

Run `setupDomeBox()` once more. It now prints your `/exec` URL:

```
--- WEB APP ---
  ok      https://script.google.com/macros/s/AKfy.../exec
```

**Keep that URL.** Part 4 needs it.

> Every time you change the code you must **Deploy → Manage deployments →
> edit → New version**. Saving the file is not deploying it, and this catches
> everybody at least once.

---

## Part 2 — the scheduler

Without this, Dome Box is a board. Nothing is chased, no recurring task is ever
created, and no renewal notice goes out. It is a second file because the
handlers run on timers rather than on requests.

### 2.1 Add the file

In the same Apps Script project: **Files → + → Script**, name it `reminders`,
and paste the whole of **`domebox/reminders.gs`**.

### 2.2 Two lines to edit, at the top of that file

```js
var REG = {
  SHEET_ID: '',        //  <-- put your registry id here
  TAB: '',             //      leave blank
};

var SCHED = {
  DRY_RUN: true,       //  <-- see 2.4
  SEND_HOUR: 8,        //      local hour for the daily digest
  ...
```

`REG.SHEET_ID` is the same registry id as `MASTER_DB_ID`. It is not read from
Script Properties because this file is designed to be usable on its own.

### 2.3 Preview before anything is sent

With `DRY_RUN` still `true`, run each of these and read the log:

```
previewDailyReminders()     what the daily digest would send, to whom
previewRecurringJobs()      what occurrences would be created
previewRenewalReminders()   who would get a renewal notice
```

Nothing is sent and nothing is created. Read the output properly — this is the
only moment you see the mail before your customers do.

### 2.4 Turn it on

Change `DRY_RUN: true` to `DRY_RUN: false`, save, then run:

```
installDomeBoxSchedules()
```

Three daily triggers are installed:

| Job | When | What it does |
|---|---|---|
| `generateRecurringJobs` | ~06:00 | creates occurrences that are due |
| `sendDailyReminders` | ~08:00 | the digest, escalations, overdue chasing |
| `sendRenewalReminders` | ~09:00 | 14, 7, 3, 1, 0 and 3 days past expiry |

Run `domeBoxScheduleStatus()` to confirm all three, and `setupDomeBox()` to see
them reported there too.

### 2.5 The mail quota, which is shared

A consumer Google account sends **100 emails a day**. A Workspace account sends
1,500. That is the limit across *every* customer, not per customer. The
scheduler caps itself at 80 per run for this reason.

If you have more than about a dozen active companies, you need Workspace. When
the quota runs out, mail silently stops — including password resets.

---

## Part 3 — payments and invoices

### 3.1 Rotate your keys first

Your old live source had Razorpay and Gemini keys in it. **Generate new ones
and disable the old.** Anyone who has ever had that file can charge against
your account.

Razorpay Dashboard → **Settings → API Keys → Regenerate**.

### 3.2 Script Properties

| Property | Value |
|---|---|
| `RAZORPAY_KEY_ID` | your **new** key id |
| `RAZORPAY_KEY_SECRET` | your **new** secret |
| `GEMINI_KEY` | your **new** Gemini key (for AI insights) |
| `PROMO_CODES` | optional, e.g. `{"LAUNCH20":20}` |

### 3.3 The webhook — the one people skip

The browser confirms its own payment, and that path is sound: the signature is
verified, then Razorpay's API is asked again whether the payment really
captured, and only then is the plan granted.

But it only runs **if the customer's tab survives**. Someone who pays and
closes the tab, or loses signal on the bank page, is charged and stays on Free.

Razorpay's webhook is the net under that — and it **ignores every event until
`RAZORPAY_WEBHOOK_SECRET` is set**, silently, by design, so nobody can post
fake payment events at an unconfigured deployment.

1. Razorpay Dashboard → **Settings → Webhooks → Add New Webhook**
2. **URL**: your `/exec` URL from 1.6
3. **Active Events**: `payment.captured`
4. **Secret**: type in any long random string, and keep it
5. Script Properties → `RAZORPAY_WEBHOOK_SECRET` → that same string
6. Run `setupDomeBox()` — it warns while keys are set and this is not

**Test it.** Pay once in Razorpay test mode and close the tab the moment the
bank page submits. The company should land on the paid plan anyway, and the
`PaymentLog` tab in your registry should show `WEBHOOK_GRANTED`.

### 3.4 Invoices

Every captured payment emails an invoice from `info@biscsindia.com`, inside the
same locked write that grants the plan. There is nothing to switch on.

Run `previewInvoice()` to see the seller block, the tax rate and the next
number without sending anything.

**Until `SELLER_GSTIN` is set:** no tax is charged, no tax lines appear, the
document is titled "Invoice" and says plainly that BISCS India is not
registered under GST. The checkout charges exactly the listed price. This is
correct for an unregistered supplier and it is what happens today.

**The day you set `SELLER_GSTIN`, three things change at once:**

1. The document becomes a "Tax Invoice"
2. **18% is added on top of the listed price at checkout** — because every price
   on www.domebox.in is published as exclusive of GST. Charging the listed
   figure and showing tax inside it would mean absorbing 18% of revenue.
3. The tax splits by place of supply: CGST+SGST within West Bengal, IGST
   outside it

Set `SELLER_STATE` **before** the GSTIN, or every invoice is taxed as
intra-state.

The number series is `BISCS/26-27/0001`, restarting each April, derived under a
lock from the rows already written so it cannot collide or leave a gap. Nothing
is ever edited: a flagged invoice is superseded and renumbered by running
`reissueFlaggedInvoices`.

---

## Part 4 — the site on Netlify

### 4.1 Fill in the eight legal fields

Open **`netlify/site-config.json`**. Eight fields are blank:

```
registeredAddress   phone              gstin             entityType
registrationNumber  grievanceOfficer   jurisdictionCity  jurisdictionState
```

`/privacy`, `/terms`, `/refund` and `/contact` are built from them, and **those
four URLs are the only internal links on your homepage**. Without them the
footer of your live site is four broken links and Razorpay's reviewer has
nothing to open.

The build fails rather than let that happen. `netlify/REQUIRED-BEFORE-DEPLOY.md`
explains each field and where to find it.

> `grievanceOfficerName` must be a **named person**, not "Support team". That is
> the Consumer Protection (E-Commerce) Rules 2020 and the IT Rules 2021.

### 4.2 Connect the repository

Netlify → **Add new site → Import an existing project** → your repo.

| Setting | Value |
|---|---|
| Base directory | `netlify` |
| Build command | `node build.js` |
| Publish directory | `netlify` |

Then **Site configuration → Environment variables → Add a variable**:

| Key | Value |
|---|---|
| `API_URL` | your `/exec` URL from 1.6 |

Nothing is installed — the build is Node's standard library over committed
files, so it cannot fail on a toolchain it does not have.

> **Drag-and-drop does not work.** The build reads `../dist/index.html`, which
> is outside the folder you would drop.

Without `API_URL` the build fails. That is deliberate: the page would render
perfectly, be styled, show the right prices — and then every login and payment
would fail with a network error.

### 4.3 Check the preview before the domain

Netlify gives you a `*.netlify.app` URL. Open it and walk through:

- [ ] The homepage renders **styled**
- [ ] Sign up a test company and sign in — if this fails, `API_URL` is wrong
- [ ] `/privacy`, `/terms`, `/refund`, `/contact` all load
- [ ] The footer links go to those URLs
- [ ] Your real company details are on the policy pages, not placeholders
- [ ] Nothing in the browser console
- [ ] A made-up URL shows your 404, not Netlify's

---

## Part 5 — going live

Only once everything above behaves on the preview.

### 5.1 Back up

Add **`domebox/backup.gs`** to the Apps Script project and run
`backupAllTenants()`, then `verifyLatestBackup()`. Confirm the output before
going further. This is the step you will be glad of exactly once.

### 5.2 Point at the live registry

Change `MASTER_DB_ID` (and `REG.SHEET_ID` in `reminders.gs`) to your **live**
registry id. Run `ensureRegistry()`.

It only adds missing tabs to the registry and never rewrites a row.

Then run **`previewMigration`**. It reads every customer's sheet and changes
nothing: it reports what will be added to each, anyone who would not be able
to sign in, and — under **NEEDS A LOOK** — any sheet whose columns are not
where Dome Box expects them. That is almost always a column somebody added by
hand; the report names it and says where to move it. A sheet that does not
match is never adjusted, because the schema is positional and a customer's own
column would be written over.

When NEEDS A LOOK is empty, run **`migrateAllTenants`**. The first 15 task
columns and 9 user columns are untouched; new headings are written into empty
columns after them, and missing tabs are added beside the existing ones.

If a customer is somehow missed — added to the registry after the run — their
first sign-in performs the same upgrade, with the same check.

Full detail, and an email to send customers: [`MIGRATING-CUSTOMERS.md`](MIGRATING-CUSTOMERS.md).

### 5.3 Sign in as yourself

Your existing password still works and is silently upgraded to a hash on that
first sign-in.

### 5.4 The domain

Netlify → **Domain management** → add `domebox.in` and `www.domebox.in`, set one
as **primary**. Netlify issues the 301 from the other.

> Do **not** add your own apex-to-www rule to `_redirects`. On top of Netlify's
> own redirect it is a loop, and a loop takes the whole site down.

DNS: move nameservers to Netlify DNS, or CNAME to your Netlify subdomain. HTTPS
is provisioned automatically once DNS resolves. **Wait for the certificate
before sending real traffic** — HSTS tells browsers to refuse plain HTTP to
your domain for a year.

### 5.5 Lock down the old tenant sheets

```
lockDownAllTenants()
```

In `domebox/remediate-sharing.gs`. Every customer spreadsheet your current code
created is shared **ANYONE_WITH_LINK / EDIT**. Run `auditSharing()` first — it
changes nothing — then set `SHARE.DRY_RUN = false` and run the lockdown.

Check `SHARE.MASTER_DB_ID` at the top of that file points at your live registry
before you run either.

### 5.6 Keep the old script deployed for a week

Unused but alive, so a rollback is just re-pointing `API_URL` in Netlify.

### 5.7 Verify in production

```bash
curl -sI https://www.domebox.in | grep -i "strict-transport\|x-frame\|content-security"

for u in "" pricing features guides privacy terms refund contact; do
  printf "%-10s " "/$u"; curl -s -o /dev/null -w "%{http_code}\n" "https://www.domebox.in/$u"
done
```

Then: submit `sitemap.xml` in Google Search Console, paste the URL into
WhatsApp to check the preview image, and give Razorpay the four policy URLs.

---

## Part 6 — before the first sales call

```
createDemoAccount()
```

Builds a real workspace on the Enterprise plan with a month of plausible work
already in it, and prints the login. An empty workspace demonstrates nothing —
the score, the leaderboard and the priority list all need history to say
anything at all. It also writes a purpose and four values, goals for the year
and the quarter with work linked to them, three key numbers with six weeks of
figures, and one finished weekly review with its actions.

If the demo account was made before Goals and Meetings existed, run
`removeDemoAccount`, then `createDemoAccount` again to get the new pages
filled in.

```
Email     demo@biscsindia.com      Password  DomeBoxDemo2026
Team      <username>@demo.domebox.in / DemoStaff2026
```

It prints an order to open things in. `removeDemoAccount` removes it; the
spreadsheet is trashed rather than deleted, so a mistake is recoverable from
Drive's bin for thirty days.

---

## Part 7 — the things only you can do

- [ ] Rotate the Razorpay and Gemini keys from the old live source *(3.1)*
- [ ] Set `RAZORPAY_WEBHOOK_SECRET` *(3.3)*
- [ ] Verify `info@biscsindia.com` as a send-as alias *(1.5)*
- [ ] Add `reminders.gs`, set `DRY_RUN = false`, run `installDomeBoxSchedules()` *(2.4)*
- [ ] Fill the eight fields in `netlify/site-config.json` *(4.1)*
- [ ] Set `SELLER_ADDRESS` and `SELLER_STATE` *(1.3)*, and `SELLER_GSTIN` when registered *(3.4)*
- [ ] Back up, then run `lockDownAllTenants()` on the live registry *(5.1, 5.5)*
- [ ] **Email existing customers about the price change** — `Monthly` and
      `Yearly` are grandfathered with the caps and prices they were sold at, but
      they are no longer offered to new buyers
- [ ] Get a lawyer's hour on the data-processing agreement, the retention
      period and cross-border transfer. You hold employee performance data for
      other companies, which makes you a Data Processor for their employee
      records. `netlify/REQUIRED-BEFORE-DEPLOY.md` sets out what to ask.

---

## When something is wrong

| Symptom | Almost always |
|---|---|
| Nobody can sign in on the live site | `API_URL` is wrong, or you saved the code without **Deploy → New version** |
| No email is arriving at all | The send-as alias is not verified *(1.5)*, or the daily quota is spent *(2.5)* |
| Nothing is being chased | `reminders.gs` not added, `DRY_RUN` still `true`, or `installDomeBoxSchedules()` never run *(Part 2)* |
| A customer paid but is still on Free | `RAZORPAY_WEBHOOK_SECRET` is not set *(3.3)* |
| The footer links 404 | The eight legal fields are blank *(4.1)* |
| An invoice has no GST on it | `SELLER_GSTIN` is not set — correct until you are registered *(3.4)* |
| The Netlify build fails | Read the log; it names the one thing that is missing |
| A page is unstyled | `dist/index.html` was rebuilt wrong — run `node web/_build/build-index.js` |

**One thing about Apps Script that will bite you:** every `.gs` file in a
project shares **one global scope**, and the last definition of a name wins —
silently, at parse time, with nothing in any log. `reminders.gs`, `backup.gs`
and `remediate-sharing.gs` are checked safe to add beside `code.gs`.
**`domebox/payments-secure.gs` must not be added** — it is superseded, and it
says so at the top of the file.

---

*`setupDomeBox()` is the answer to "what have I missed". Run it.*
