# STOP — read this before deploying anything else

Your `code.gs` has four live, exploitable problems. Three of them are being
exploited-capable right now, against real customer data, on a site with paying
users. I have ordered them by how fast they can hurt you.

Everything below is from your own source. No guessing.

---

## 1. Every customer database is public — readable and writable

```js
newFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
```
*(`registerCompany`)*

Every spreadsheet you have ever created for a customer is **open to anyone with
the link, with edit rights, no Google sign-in required.** Those files hold every
employee's name, email, phone, task history, performance score — and, today,
their password in plain text.

The file id is not a secret either. You send it to the browser at login and it
rides in every request, so it is in browser history, devtools, any shared
screenshot, and any proxy in between.

Anyone holding one of those ids can read a company's entire staff record, change
their scores, or delete their work — and you would have no log of it.

**Fix now — 10 minutes:**

1. Add `remediate-sharing.gs` to the project.
2. Run `auditSharing()`. Read the log. It shows exactly which files are exposed.
3. Set `SHARE.DRY_RUN = false`, run `lockDownAllTenants()`.
4. Run `auditSharing()` again to confirm.
5. In `registerCompany`, **delete the `setSharing` line entirely.** It is not
   needed: your app reads and writes through Apps Script, which runs as you.

This does not break anything. Link sharing was never what made the app work.

## 2. Your live Razorpay secret is in the source file

```js
const RAZORPAY_KEY_ID     = "rzp_live_…";
const RAZORPAY_KEY_SECRET = "MX9…";
const DEFAULT_GEMINI_KEY  = "AIzaSy…";
```

A **live** key secret. Anyone with it can create, capture and refund payments on
your account. The Gemini key is billable to you.

These have now also been pasted into a chat transcript, which is one more place
they exist.

**Rotate all three today, in this order:**

1. Razorpay Dashboard → Settings → API Keys → **Regenerate**. Update the key id
   in your front end and put the new secret in **Script Properties**, never in
   the file.
2. Google AI Studio → delete the Gemini key, create a new one, store it in
   Script Properties (`GEMINI_KEY` — your code already prefers that if present).
3. Check Razorpay's payment log for anything you do not recognise.

```js
// replace the constants with:
function razorpaySecret_() {
  var v = PropertiesService.getScriptProperties().getProperty('RAZORPAY_KEY_SECRET');
  if (!v) throw new Error('RAZORPAY_KEY_SECRET is not set');
  return v;
}
```

## 3. Anyone can upgrade themselves to Pro for free

```js
case 'paymentSuccess': result = handlePaymentSuccess(params.sheetId, params.planName);
```

`handlePaymentSuccess` writes the plan straight into the Directory. **Nothing
checks that a payment happened.** A single request does it:

```
POST { "action":"paymentSuccess", "sheetId":"<their own id>", "planName":"Yearly" }
```

That is a free ₹19,999 plan, repeatable, for anyone who opens devtools on your
own signup page.

The promo path has the same shape: `promoCode === "admint100"` charges ₹1 for
any plan, and that string is checked server-side but reachable by any caller.

**Fix:** `payments-secure.gs` verifies the Razorpay signature before granting
anything, and the webhook (`billing.gs`, sent earlier) makes the server the
source of truth rather than the browser.

## 4. The server asks the browser who you are, and believes it

```js
if (!params.sheetId) throw new Error("Session invalid. Re-login.");
const user = params.user;          // ← supplied by the caller
```

There is no authentication on any protected route. Knowing a `sheetId` is the
whole check, and the `user` object — **including `role`** — is whatever the
caller typed.

```
POST { "action":"getUsersList", "sheetId":"<any id>", "user":{"role":"Admin"} }
```

returns that company's entire staff list. `getUsersList` includes
`password: r[2]`, so the response is **every employee's password in plain text**.
The same trick reaches `deleteUser`, `updateUser` and everything else.

**Fix:** `auth.gs` issues a signed session token at login and derives identity
from it server-side. The browser can no longer claim a role.

---

## 5. Passwords are stored in plain text — in three places

`Users!C`, `Global_Users!B` and `Directory!C` all hold the real password.
Combined with #1, every password you hold has been readable by anyone with a
link. People reuse passwords, so the blast radius is not limited to your product.

**This is also a DPDP Act 2023 problem**, not only an engineering one.

`auth.gs` fixes it **without a flag day**: it accepts a stored plaintext value
once, verifies the login, then immediately rewrites it as a salted, iterated,
peppered hash. Nobody is locked out and nobody is forced to reset. Run
`countUnmigratedPasswords()` weekly; when the number stops falling, reset the
stragglers.

The pepper lives in Script Properties, which a leaked spreadsheet cannot reach —
so even a stolen Users sheet cannot be cracked offline.

Also delete `password: r[2]` from `getUsersList`. The front end never uses it.

---

## Do it in this order

| When | What | Why this order |
|---|---|---|
| **Now** | `lockDownAllTenants()` | Stops an active data exposure. No code change, no risk. |
| **Today** | Rotate Razorpay + Gemini keys | Independent of everything else. |
| **Today** | Delete `setSharing` from `registerCompany` | Otherwise the next signup re-opens the hole. |
| **This week** | `auth.gs` — tokens + password migration | Needs a front-end change; test on one account first. |
| **This week** | `payments-secure.gs` + webhook | Stops free upgrades. |
| **Then** | `backup.gs` | Protects you from everything else. |

**Do not paste a whole new `code.gs` over the live one.** Add the new files
alongside, deploy as a **new version** with a note, and test with one account
before it reaches customers.

---

## Also found — real, not urgent

**Starting a task counts as a rework.**
```js
if(status==='In Progress') sheet.getRange(row, 12).setValue(Number(data[i][11]||0)+1);
```
Pending → In Progress is the normal start of work, and it increments the rework
counter. `calculateDelegationScore` then deducts 5 points per rework, so
**everyone loses points for beginning a task.** Your old front end does send
`In Progress` for rework specifically, but it is also the natural first
transition — check which paths reach this line before trusting any score.

**Manager deductions are uncapped.** `managerDeductions -= daysLate` with no
floor, clamped to 0 only at the very end. One forgotten review from six months
ago sets a manager's score to zero regardless of everything else they did.

**Password reset tokens never expire.** `Reset_Tokens` has a timestamp column
that is written but never checked, so a link mailed a year ago still works.
Check the age and reject anything over an hour.

**`forgotPassword` confirms whether an email exists** ("Email not found in our
system"), which lets anyone enumerate your customers. Return the same message
either way.

**Email HTML is built by string interpolation** of `form.title`, `f.message` and
similar, with no escaping — so a task title containing markup is injected into
the mail you send.

**No `LockService`.** Two users writing the same tenant sheet at once can
interleave a read-modify-write of the history column and lose one of them.

**The front end you sent is a different generation** from this backend: it calls
`google.script.run.loginUser(...)`, while `code.gs` exposes a `doPost` JSON API
with `action: 'login'`. If that file is still deployed anywhere, it cannot be
talking to this backend. Worth confirming which front end is actually live
before changing either.
