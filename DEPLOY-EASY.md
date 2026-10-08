# Deploy Dome Box — the easy guide

Twelve steps. Do them in order. Each one ends with **✅ how you know it worked**.

You need: your Google account (the one that owns `info@biscsindia.com`), your
Razorpay login, your Netlify login, and the files from `dome-box-complete.zip`.

Your current live site keeps running untouched until step 11.

> Want the reasons behind each step, or something went wrong? See
> [`SETUP.md`](SETUP.md) — same steps, with explanations and a fix-it table.

---

## Part A — the backend (Google Apps Script)

### 1. Make two spreadsheets

In Google Drive:
- Make a **copy** of your current template spreadsheet. Name it `Dome Box Template`.
- Make a **new blank** spreadsheet. Name it `Dome Box Registry`.

Open each one and copy the long ID from the address bar — the part between
`/d/` and `/edit`. Paste both IDs into a note; you need them next.

✅ You have two IDs written down.

### 2. Make the Apps Script project

Go to **script.google.com → New project**. Delete everything in the editor.
Open `dist/code.gs` from the zip, copy **all** of it, paste it in, and press
**Save** (the disk icon).

✅ The editor shows a long file with no red error marks.

### 3. Add the settings

Click **Project Settings** (gear icon, left) → scroll to **Script Properties** →
**Add script property**. Add these, one per row:

| Property | Value |
|---|---|
| `MASTER_DB_ID` | the **Registry** ID from step 1 |
| `TEMPLATE_ID` | the **Template** ID from step 1 |
| `SITE_URL` | `https://www.domebox.in` |
| `MAIL_FROM` | `info@biscsindia.com` |
| `SELLER_LEGAL_NAME` | `BISCS India` |
| `SELLER_ADDRESS` | your registered address, on one line |
| `SELLER_STATE` | `West Bengal` (or your state) |

Press **Save script properties**.

✅ Seven rows are saved.

### 4. Run the setup check

Back in the editor, pick **`setupDomeBox`** in the function dropdown at the top
and press **Run**. Google asks for permission — click through and **Allow**.

Then open **Execution log** at the bottom.

✅ You see `ok      tabs present: Directory, Global_Users…`

It will also say *web app not deployed* and *no scheduled jobs* — that's
expected, steps 6 and 7 fix those.

**Now go back to Script Properties and copy `AUTH_PEPPER` somewhere safe.** If
it's ever lost, every customer has to reset their password.

### 5. Let it send email as info@biscsindia.com

If the log said `MISSING "info@biscsindia.com" is not a verified send-as alias`:

Open **Gmail → ⚙ Settings → See all settings → Accounts and Import → Send mail
as → Add another email address** → enter `info@biscsindia.com` → follow the
steps → click the link in the verification email.

Run `setupDomeBox` again.

✅ The log says `ok      every email will leave from info@biscsindia.com`

> Skip this and **no email is sent at all** — not even password resets.

### 6. Put it online

**Deploy → New deployment** → click the gear next to *Select type* → **Web app**.
- Execute as: **Me**
- Who has access: **Anyone**

Press **Deploy**. Run `setupDomeBox` once more.

✅ The log shows a line starting `https://script.google.com/macros/s/` ending
in `/exec`. **Copy that URL** — it's your **API URL**.

> Every time you change the code later: **Deploy → Manage deployments → ✏️ →
> Version: New version → Deploy.** Just saving is not enough.

### 7. Turn on the daily reminders

In the editor: **+ (Add a file) → Script** → name it `reminders`. Paste in all
of `domebox/reminders.gs`. At the very top of that file change two things:

```js
SHEET_ID: 'paste your Registry ID here',
...
DRY_RUN: false,
```

Save. Pick **`installDomeBoxSchedules`** in the dropdown and press **Run**.

✅ Run `setupDomeBox` — it says `ok      all three daily jobs are installed`

> Without this, nobody gets reminders and repeating tasks never appear.

---

## Part B — payments

### 8. Connect Razorpay

**First, make new keys** (the old ones were in the old code):
Razorpay Dashboard → **Settings → API Keys → Regenerate Key**.

Add to Script Properties:

| Property | Value |
|---|---|
| `RAZORPAY_KEY_ID` | your new Key ID |
| `RAZORPAY_KEY_SECRET` | your new Key Secret |
| `RAZORPAY_WEBHOOK_SECRET` | make up a long password, e.g. `dbx-7Hq2…` — keep it |

Then Razorpay Dashboard → **Settings → Webhooks → Add New Webhook**:
- Webhook URL: **your API URL from step 6**
- Secret: **the same password** you just made up
- Active events: tick **`payment.captured`**

Save.

✅ Run `setupDomeBox` — no Razorpay line says `MISSING`, and there's no
`WARNING online payment is live`.

> If you're GST-registered, also add `SELLER_GSTIN`. Without it, invoices go out
> with no GST, which is correct while you're unregistered.

---

## Part C — the website (Netlify)

### 9. Fill in your company details

In the zip, open **`netlify/site-config.json`** and fill the eight empty `""`
fields: address, phone, GSTIN, entity type (e.g. `Proprietorship`), registration
number, grievance officer's **name**, city and state for jurisdiction.

Save, and commit the file to your GitHub repo.

✅ No `""` empty values left in the file.

> These build your Privacy, Terms, Refund and Contact pages. Razorpay needs
> them, and they're the links in your website footer.

### 10. Connect Netlify

**netlify.com → Add new site → Import an existing project → GitHub** → pick
your repo. Fill in:

| | |
|---|---|
| Base directory | `netlify` |
| Build command | `node build.js` |
| Publish directory | `netlify` |

Before deploying: **Add environment variables → `API_URL`** = your API URL from
step 6. Then **Deploy**.

✅ Netlify shows **Published** and gives you a `something.netlify.app` link.
Open it — the homepage looks normal, and you can sign up a test company and
log in.

> If the build fails, open the deploy log — it says exactly which of the two
> things (API URL or site-config) is missing.

---

## Part D — go live

### 11. Switch over

Only when step 10 works properly:

1. **Back up first.** Add `domebox/backup.gs` as another file in Apps Script,
   run `backupAllTenants`, then `verifyLatestBackup`.
2. In Script Properties, change `MASTER_DB_ID` to your **current live
   registry** ID. Change `SHEET_ID` in `reminders` to the same. Run
   `ensureRegistry`.
3. In Netlify: **Domain management → Add domain** → `domebox.in` and
   `www.domebox.in` → follow Netlify's DNS instructions. Wait until it shows a
   🔒 certificate.

✅ www.domebox.in opens your new site, and you can sign in with your existing
account and password.

Keep your **old** Apps Script deployed (but unused) for a week — if anything
goes wrong, just put its URL back into Netlify's `API_URL`.

### 12. Lock down old customer files

Your old code shared every customer spreadsheet as "anyone with the link can
edit". Fix it:

Add `domebox/remediate-sharing.gs` as a file. Check the ID at the top matches
your live registry. Run **`auditSharing`** (just looks), then set
`DRY_RUN: false` and run **`lockDownAllTenants`**.

✅ `auditSharing` run again shows nothing shared publicly.

---

## Done. Optional extras

| | |
|---|---|
| **Demo account** for sales calls | Run `createDemoAccount` — it prints the login |
| **Remove the demo** | Run `removeDemoAccount` |
| **Check anything** | Run `setupDomeBox` — it lists whatever is still missing |
| **Tell existing customers** about the new prices | Old plans keep their price; new buyers see the new ones |

**Never add `domebox/payments-secure.gs` to the project** — it's old and would
break payments.

*Stuck? Run `setupDomeBox` first — its last section, **WHAT IS LEFT**, tells
you what to do next.*
