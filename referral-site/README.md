# Grihobazar Partners — referral site

A referral programme for the property business: a partner sends us a buyer, we
close the deal, and the partner earns a share of our brokerage.

- **Frontend** — plain HTML, CSS and JavaScript. No build step, no framework.
- **Backend** — a **new, private** Google Sheet driven by Google Apps Script.
- **Money** — we charge the seller `brokerage_pct` (default 2%) of the deal
  value. The partner gets 15% of that brokerage below ₹1 Cr and 20% at ₹1 Cr and
  above. From the partner's share we keep a `platform_fee_pct` (default 5%), and
  TDS is deducted on what is left.

```
deal value → brokerage (2%) → partner share (15% / 20%)
                                  → less platform fee (5%)   ← we keep this
                                  → less TDS (2%)            ← goes to the taxman
                                  → net paid to the partner
```

On an ₹85 L deal: brokerage ₹1,70,000 → partner share 15% = ₹25,500 → less ₹1,275
platform fee → ₹24,225 → less ₹484.50 TDS = **₹23,740.50** to the partner, of
which **₹1,275** is ours on top of the ₹1,44,500 brokerage we keep.

On a ₹2.5 Cr deal: brokerage ₹5,00,000 → partner share 20% = ₹1,00,000 → less
₹5,000 platform fee → ₹95,000 → less ₹1,900 TDS = **₹93,100** to the partner.

The platform fee comes off **before** TDS, so tax is deducted on what the partner
is actually paid rather than on money that never reaches them. The fee is shown
as its own line in the calculator and on every deal — a partner told "15% of
brokerage" who then receives less will work the gap out at their first payout,
and that is a worse conversation than showing the number up front.

Every rate lives in the `Config` tab. Change a number there and the site, the
calculator and the admin console all follow — no code change.

---

## Setup

### 1. Create the sheet and the script

1. Create a **new blank Google Sheet** (do not reuse the classifieds sheet).
   Name it something like `GB REFERRAL`.
2. **Extensions → Apps Script**.
3. Create one script file per `.gs` file in `apps-script/` and paste the
   contents in. Add `Admin.html` as an **HTML** file (File → New → HTML) named
   exactly `Admin`.
4. Project Settings → tick *Show `appsscript.json`*, then paste in the manifest
   from `apps-script/appsscript.json`.
5. Run `setup()` once from the editor and authorise it when asked. It creates
   every tab, seeds `Config`, and generates the password pepper.

### 2. Deploy twice

Both deployments come from the same script project.

| | Execute as | Who has access | Used by |
|---|---|---|---|
| **Public API** | Me | Anyone | the website |
| **Admin console** | Me | Only myself | you |

- Copy the **public** `/exec` URL into `web/assets/config.js` as `API_URL`.
- Open the **admin** `/exec` URL in your browser — it serves the admin page
  itself. Because Google gates that URL, only your account can reach it, and no
  admin password has to exist anywhere.

Re-deploy (**Manage deployments → edit → New version**) after any script change,
or the live URL keeps serving the old code.

### 3. Publish the site

Upload `web/` to any static host — GitHub Pages, Netlify, Cloudflare Pages, or a
folder on your existing hosting. Set `SITE_URL` in `config.js` to the public URL
so the share links point at the right place (leave it blank and it is derived
from the current page).

### 4. Fill in Config

In the sheet's `Config` tab:

| Key | Default | What it does |
|---|---|---|
| `brand_name` | Grihobazar Partners | Name shown across the site |
| `brokerage_pct` | 2 | Your brokerage, as % of deal value |
| `tier_threshold` | 10000000 | Deal value at/above which the higher share applies |
| `tier_low_pct` | 15 | Partner's % of brokerage below the threshold |
| `tier_high_pct` | 20 | Partner's % of brokerage at/above it |
| `platform_fee_pct` | 5 | Your cut, taken from the partner's share |
| `tds_pct` | 2 | TDS on the balance after the fee — **confirm the rate with your CA** |
| `attribution_lock_days` | 90 | How long the first referrer owns a buyer's number |
| `payout_days_after_registration` | 15 | The payout promise made on the site |
| `notify_email` | *(blank)* | Gets an email on every new lead; blank disables it |
| `support_phone` / `support_email` | *(blank)* | Shown to partners in the footer |

### 5. Optional — housekeeping triggers

In the Apps Script editor, **Triggers → Add trigger**, daily:

- `purgeExpiredSessions` — deletes lapsed login sessions
- `expireStaleReferrals` — ages out leads nobody worked on

---

## How a referral flows

```
partner submits lead  →  new  →  contacted  →  visit_scheduled  →  visited
                                                                      ↓
                            paid  ←  payable  ←  registered  ←  booked/negotiation
```

- A **Deal** row is created when you mark a lead **Booked**. Every number —
  brokerage, share %, platform fee, TDS, net — is frozen at that moment, so a
  later rate change in `Config` cannot alter a deal you already promised.
- Commission becomes **payable** at **registration**, not at booking — a booking
  can fall through, a registration cannot.
- **Attribution**: the first partner to submit a buyer's mobile number owns that
  buyer for `attribution_lock_days`. A later referral for the same number is
  still recorded, marked `duplicate` with `DuplicateOf` pointing at the original,
  so a dispute can be settled from the sheet instead of from memory.

## Pages

| File | Who sees it |
|---|---|
| `web/index.html` | Public — pitch, live earnings calculator, rate card, FAQ |
| `web/signup.html` / `web/login.html` | Public — partner accounts |
| `web/dashboard.html` | Partner — code, share link, referrals, earnings, payout details |
| `web/refer.html` | Partner, or anyone opening `refer.html?ref=CODE` |
| `apps-script/Admin.html` | You — pipeline, bookings, registrations, payouts, KYC |

## Sheet tabs

`Referrers` · `Sessions` · `Referrals` · `Deals` · `Payouts` · `Config` · `AuditLog`

Every state change is written to `AuditLog` with who did it and when. When money
is involved, "who changed this and when" is the first question asked.

## Tests

```
node test/commission.test.js
```

Stubs the Apps Script globals and runs the real source: commission at, above and
below the threshold, the platform fee and TDS split, that fee + TDS + net always
add back to the gross, junk input, phone normalisation, and the amount parser
that accepts `85 lakh`, `1.2 Cr`, `₹85,00,000`. No deployment needed.

## Notes on the data

- **Keep this sheet private.** It holds partner phone numbers, PAN, bank
  accounts and password hashes. Sharing is never needed — the Apps Script runs
  as you and is the only thing that touches it.
- Passwords are stored as iterated SHA-256 (12,000 rounds) with a per-user salt
  and a pepper held in Script Properties, outside the sheet. Apps Script has no
  bcrypt or argon2; this is the strongest option available in that runtime.
- `Budget`, `BHK`, `Phone`, `PAN`, `IFSC` and account numbers are formatted as
  **plain text** by `setup()`. The classifieds sheet lost 48 cells to Sheets
  turning entries like `3,4` into dates — that cannot happen here.
- Buyer phone numbers are masked in the partner dashboard (`993xxxx116`). The
  partner already has the number; the site does not need to hand back a
  contact list.

## Known limits

- **No password reset by email.** A partner who forgets their password has to
  ask you; you clear their row's `PassHash`/`Salt` and they sign up again, or you
  set a temporary one. Adding email reset means adding a mail flow and a token
  tab — worth doing once there are enough partners for it to matter.
- **No OTP verification** on the partner's own mobile number at signup, so a
  number can be registered by someone who does not hold it. The buyer's number
  is not verified either. If fake leads become a problem, OTP is the fix.
- **Apps Script quotas** apply: roughly 20,000 URL-fetch-free web app calls and
  100 emails a day on a free Gmail account. Fine for hundreds of partners, not
  for tens of thousands.
- **Sheets is not a database.** Reads scan the whole tab, so past a few thousand
  referrals the dashboard gets slow. That is the point to move to Postgres or
  Firebase — the API shape here is deliberately plain so the frontend would not
  have to change.
