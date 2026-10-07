# Deploying the new build

Two files: `dist/code.gs` and `dist/index.html`.

**Do not paste `code.gs` over your live script.** Set this up as a *separate*
Apps Script project with a *separate* registry, prove it works, then migrate.
Your current customers keep running on the old one until you decide otherwise.

---

## 1. A sandbox first

1. Make a copy of your template spreadsheet → this is the new **TEMPLATE**.
2. Make a new blank spreadsheet → this is the new **REGISTRY**.
3. New Apps Script project → paste `dist/code.gs`.
4. **Project Settings → Script Properties**:

| Property | Value |
|---|---|
| `MASTER_DB_ID` | the new registry's id |
| `TEMPLATE_ID` | the new template's id |
| `SITE_URL` | `https://www.domebox.in` |
| `MAIL_FROM` | `info@biscsindia.com` |
| `RAZORPAY_KEY_ID` | your **new** key id (after rotating) |
| `RAZORPAY_KEY_SECRET` | your **new** secret |
| `RAZORPAY_WEBHOOK_SECRET` | the secret you type into Razorpay (see §1a) |
| `SELLER_LEGAL_NAME` | the registered name, e.g. `BISCS India` |
| `SELLER_ADDRESS` | the registered address, one line |
| `SELLER_STATE` | e.g. `West Bengal` |
| `SELLER_GSTIN` | **leave blank until registered** — see §1d |
| `SELLER_PAN` | optional, printed on the invoice |
| `INVOICE_PREFIX` | optional, defaults to `BISCS` |
| `GEMINI_KEY` | your **new** Gemini key |
| `PROMO_CODES` | optional, e.g. `{"LAUNCH20":20}` |

5. Run `setupDomeBox()`. This is the only setup function and it does the work
   as well as the checking: it generates the two crypto secrets, prepares the
   registry tabs, verifies the tenant template, checks the send-as alias, the
   invoicing identity, the scheduled jobs and the web-app deployment, and ends
   with a numbered list of what is still left. Safe to run as often as you
   like — it never regenerates a secret it already made, and it never rewrites
   a row. Run it again after every change until it says *Nothing. This project
   is ready.*

   **Back up `AUTH_PEPPER`.** Losing it means every password must be reset.
6. **Deploy → New deployment → Web app**, Execute as **Me**, Access **Anyone**.
7. Run `setupDomeBox()` once more — it now prints the `/exec` URL. Put that into
   Netlify under **Site configuration → Environment variables** as `API_URL`.
   It is not pasted into a file any more: the site build substitutes it, and
   refuses to build without it. See `netlify/DEPLOY.md`.
8. Open the deployed site, sign up a test company, and walk through it.
9. Optional, but do it before the first sales call: run `createDemoAccount()`.
   It builds a real workspace on the Enterprise plan with a month of plausible
   work already in it — eight people in a reporting line, forty-odd jobs
   delivered at different times against different deadlines, some late, some
   reworked, a project mid-flight, cookie points, leave and measurable KRAs.
   It prints the login. An empty workspace demonstrates nothing: the score,
   the leaderboard and the priority list all need history to say anything.
   `deleteDemoAccount(true)` removes it.

### 1a. The Razorpay webhook — without it, some paid customers stay on Free

The browser confirms its own payment: the page calls `paymentSuccess`, the
signature is checked, Razorpay's API is asked again whether the payment really
captured, and only then is the plan granted. That path is sound, but it only
runs **if the customer's tab is still open**. Someone who pays and closes the
tab, or loses signal on the bank page, is charged and stays on Free.

Razorpay's webhook is the net under that. `handleRazorpayWebhook_` grants the
plan from the `payment.captured` event instead — but it **ignores every event
until `RAZORPAY_WEBHOOK_SECRET` is set**, silently, by design, so that nobody
can post fake payment events at an unconfigured deployment.

So after step 8, when you have the `/exec` URL:

1. Razorpay Dashboard → **Settings → Webhooks → Add New Webhook**.
2. **Webhook URL**: your `/exec` URL.
3. **Active Events**: `payment.captured`.
4. **Secret**: type one in (any long random string) and keep it.
5. Put that same string into Script Properties as `RAZORPAY_WEBHOOK_SECRET`.
6. Run `setupDomeBox()` again — it warns while keys are set and this is not.

Test it: pay once in Razorpay test mode, close the tab the moment the bank page
submits, and check the company lands on the paid plan anyway. The `Payments`
log will show `WEBHOOK_GRANTED` rather than the browser path.

### 1d. Invoices — what gets sent, and what decides the tax

Every captured payment produces a document that is emailed from
`info@biscsindia.com` within the same locked write that grants the plan. It is
idempotent on the payment id, so the browser path and the webhook both land on
one invoice, never two.

**Until `SELLER_GSTIN` is set, no tax is charged and no tax is shown.** The
document is titled "Invoice", carries the whole amount as the value, and says
in plain words that BISCS India is not registered under GST so nothing may be
claimed. The checkout charges exactly the listed price. This is the correct
behaviour for an unregistered supplier and it is what happens today.

**The day a GSTIN is set, three things change at once.** The document becomes a
"Tax Invoice"; 18% is added *on top* of the listed price at checkout, because
every price on www.domebox.in is published as exclusive of GST; and the tax is
split by place of supply — CGST+SGST within your own state, IGST outside it.
Set `SELLER_STATE` before the GSTIN or every sale is taxed as intra-state.

Run `previewInvoice()` to see the seller block, the rate and the next number
without sending anything. Run it again after any change.

**The number series** is `BISCS/26-27/0001`, restarting at 0001 each financial
year (April to March). It is derived under the registry lock from the rows
already in the `Invoices` tab, so it cannot collide and cannot leave a gap.
Nothing is ever edited in place: `reissueInvoice("BISCS/26-27/0007")` marks the
original **Superseded** and issues a fresh number from the corrected details.

**What customers do:** Plans → *Invoice details* captures the registered name,
GSTIN, address and state. A customer who has given neither a GSTIN nor a state
is asked for them before the card appears, because an invoice cannot be
rewritten afterwards. Past invoices are listed under Plans → *Invoices*.

If a payment arrives with no state on file, the invoice is still issued — the
customer has paid and is owed it — marked `Review — place of supply unknown`
in the ledger, and `info@biscsindia.com` gets an email naming the invoice and
the `reissueInvoice()` call to run once the customer answers.

### 1b. The scheduler — add it, or nothing gets chased

`code.gs` serves the app. It does **not** send the daily digest or create
recurring occurrences on a schedule: those live in `domebox/reminders.gs`, which
is a *second file in the same Apps Script project*, not part of `code.gs`.

Without it the product still works, but nobody is reminded of anything and a
recurring job only produces its next occurrence when somebody closes the last
one — so one forgotten task quietly ends the series, which is exactly when the
reminder mattered most. The landing page sells reminders. Add the file.

1. In the same Apps Script project: **+ → Script** → name it `reminders` →
   paste `domebox/reminders.gs`.
2. Set `REG.SHEET_ID` at the top to your registry's id.
3. Run `previewDailyReminders()` — sends nothing, logs exactly what would go
   out. Read the log.
4. When it looks right, set `SCHED.DRY_RUN = false`.
5. Run `installDomeBoxSchedules()` **once**. Check with
   `domeBoxScheduleStatus()`.

Every private helper in that file is prefixed `rm` on purpose. Apps Script puts
all `.gs` files in one global scope and the last definition of a name wins — the
file used to define its own `esc_`, which `code.gs` also defines, and the two
were not the same. Dropping it in would have silently turned off apostrophe
escaping in every email the product sends. If you add more files, prefix their
helpers too.

### 1c. Mail quota — know the ceiling before you sell past it

Apps Script allows **100 recipients a day on a consumer account, 1,500 on
Workspace**, shared by the whole project — every tenant, every email. One digest
per person per day is far cheaper than per-event mail, and
`MAX_EMAILS_PER_RUN` hard-stops a run so one large customer cannot silence
everybody else. Two rough numbers to plan with: on Workspace, ~1,500 digest
recipients a day is the hard ceiling; the per-event mail (assignment, approval,
review, verify, cookie points) comes out of the same budget. If you pass a few
hundred active users, move transactional mail to a real provider before it
starts failing silently.

## 2. Then migrate

Only once the sandbox behaves:

1. Back up every live spreadsheet (`backup.gs`, sent earlier — run
   `verifyLatestBackup()` and confirm).
2. Point the new project's `MASTER_DB_ID` at your **live** registry.
3. Run `ensureRegistry()` — it only adds missing tabs and columns, it never
   rewrites a row.
4. Sign in as yourself. Your plaintext password still works and is silently
   upgraded to a hash on that first login.
5. Deploy the new `index.html` to Netlify.
6. Keep the old script deployed but unused for a week, so rollback is just
   re-pointing `API_URL`.

Existing tenant sheets widen in place: the first 15 task columns and 9 user
columns are unchanged, and the new ones are appended. That is the only shape of
schema change that cannot corrupt old rows.

## 3. The one thing to do regardless

Run `lockDownAllTenants()` from `remediate-sharing.gs` against your **live**
registry today. Every customer spreadsheet your current code created is set to
ANYONE_WITH_LINK / EDIT. That is independent of this rewrite and does not wait
for it.

---

## Notes

**Tailwind.** `index.html` loads the play CDN so it is a single file. It works,
but it compiles in the browser on every load. For production, compile it once
(`tailwind.min.css`, sent earlier, is ~17 KB for this file's classes) and swap
the script tag for a stylesheet link.

**Apps Script quotas.** The dashboard polls every 30 seconds and pauses when the
tab is hidden. Your old front end polled every 5 seconds, which is roughly 5,700
executions per user per day against a 90-minute daily runtime allowance.

**Email.** `MAIL_FROM` must be a verified alias on the sending Google account or
`GmailApp` throws and the code falls back to `MailApp`, which ignores the from
address and sends as the script owner. The fallback is logged so you can see it
happening rather than wondering why mail looks wrong.
