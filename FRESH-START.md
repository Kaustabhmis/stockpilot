# Domebox — fresh start (no migration)

Use this instead of the migration steps. The script builds every sheet for you.
Your one client signs up again on the new system, and you put them back on their plan
with one line.

You need: your Google account (the one that owns info@biscsindia.com), your Netlify login,
and the files from **domebox-upload.zip → 1-apps-script**.

Leave your **old** Apps Script and old sheets alone. They keep the current site running
until step 6.

---

## Step 1 — A new, empty Apps Script project

1. Go to **script.google.com** → **New project**.
2. Click **Untitled project** at the top and name it **Domebox**.
3. **Project Settings** (gear icon) → **Time zone** → **(GMT+05:30) India Standard Time**.

## Step 2 — Paste the three files

1. Open **Code.gs** in the editor. Delete what is there. Paste all of **Code.gs** from the zip. **Save**.
2. **Files +** → **Script** → name it `reminders`. Paste all of **reminders.gs**. **Save**.
3. **Files +** → **Script** → name it `backup`. Paste all of **backup.gs**. **Save**.

Do not change anything inside them.

## Step 3 — Build the sheets

1. In the function box at the top, choose **freshStart** → **▶ Run**.
2. Google asks for permission the first time: **Review permissions** → your account →
   **Advanced** → **Go to Domebox** → **Allow**. Run it again if it stopped.
3. The log shows two links: **Domebox Master** and **Domebox Template**. They are in a new
   **Domebox** folder in your Google Drive. Never rename, move or delete them.

✅ Done when the log says *Created in your Google Drive*.

## Step 4 — Your details (Script Properties)

**Project Settings** → **Script Properties** → **Add script property** for each:

| Property | Value |
|---|---|
| `SELLER_ADDRESS` | BISCS India's registered address (printed on invoices) |
| `SELLER_STATE` | e.g. `West Bengal` |
| `SELLER_GSTIN` | only if registered for GST |
| `RAZORPAY_KEY_ID` | your Razorpay key id |
| `RAZORPAY_KEY_SECRET` | your Razorpay key secret |
| `RAZORPAY_WEBHOOK_SECRET` | the secret you type when adding the webhook in Razorpay |

The ones freshStart made (`MASTER_DB_ID`, `TEMPLATE_ID`, `AUTH_PEPPER`, `TOKEN_SECRET`,
`REMINDERS_LIVE`) are already there. **Copy `AUTH_PEPPER` somewhere safe.**

Use your **current** Razorpay live key here. Regenerate keys only after the switch in step 6.

## Step 5 — Switch it on

1. Choose **switchOnSchedules** → **▶ Run** (reminders at 9, 3 and 5, backups, renewals, the archive).
2. **Deploy** → **New deployment** → gear → **Web app**.
   Execute as: **Me**. Who has access: **Anyone**. → **Deploy**.
3. Choose **setupDomeBox** → **▶ Run**. It prints your **/exec URL** and anything still
   missing under **WHAT IS LEFT**. Fix those, run it again until it says *Nothing*.
4. Choose **createDemoAccount** → **▶ Run** (the website's live demo).

## Step 6 — Point the website at it

1. Netlify → your site → **Site configuration** → **Environment variables** →
   `API_URL` = the /exec URL from step 5.
2. **Deploys** → **Trigger deploy**.
3. Open www.domebox.in → **Start free trial** with a test email to check it works.

## Step 7 — Your client signs up again

1. Ask them to go to **www.domebox.in → Start free trial** and sign up with the **same email**.
2. If they had paid, put them back on their plan. In Apps Script, add a line at the bottom
   of Code.gs, run it once, then delete the line:

   ```
   function restoreClient() { setCustomerPlan('their@email.com', 'Growth Yearly'); }
   ```

   Plans: `Starter`, `Growth`, `Scale` (monthly), `Starter Yearly`, `Growth Yearly`,
   `Scale Yearly`, `Enterprise`. To end on a date: `setCustomerPlan('their@email.com', 'Growth', '2027-03-31')`.
   No receipt or invoice is sent.
3. They add their team again and carry on.

---

| Problem | Fix |
|---|---|
| freshStart says **STOPPED** | This project already has sheets. It never replaces them. Use a new project. |
| No emails at all | Gmail → Settings → Accounts → **Send mail as** → add and verify info@biscsindia.com, then run setupDomeBox. |
| Website says it cannot reach the server | `API_URL` in Netlify is wrong, or you did not deploy as **Anyone**. |
| Changed Code.gs later | **Deploy** → **Manage deployments** → ✏ → **New version** → **Deploy**. The URL stays the same. |
