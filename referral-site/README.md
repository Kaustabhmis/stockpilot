# Grihobazar Partners — referral site

A referral programme for the property business: a partner sends us a buyer, we
close the deal, and the partner earns a share of our brokerage.

- **Frontend** — plain HTML, CSS and JavaScript. No build step, no framework.
- **Backend** — a **new, private** Google Sheet driven by Google Apps Script.
- **Listings** — read (never written) from your existing classifieds spreadsheet,
  so a partner types a budget and sees real properties with real photos and what
  each one would pay them.
- **Money** — we charge the seller `brokerage_pct` (default 2%) of the deal
  value. The partner gets 15% of that brokerage below ₹1 Cr and 20% at ₹1 Cr and
  above. From the partner's share we keep a `platform_fee_pct` (default 10%), and
  TDS is deducted on what is left.

```
deal value → brokerage (2%) → partner share (15% / 20%)
                                  → less platform fee (10%)  ← we keep this
                                  → less TDS (2%)            ← goes to the taxman
                                  → net paid to the partner
```

On an ₹85 L deal: brokerage ₹1,70,000 → partner share 15% = ₹25,500 → less ₹2,550
platform fee → ₹22,950 → less ₹459 TDS = **₹22,491** to the partner, of which
**₹2,550** is ours on top of the ₹1,44,500 brokerage we keep.

On a ₹2.5 Cr deal: brokerage ₹5,00,000 → partner share 20% = ₹1,00,000 → less
₹10,000 platform fee → ₹90,000 → less ₹1,800 TDS = **₹88,200** to the partner.

After the fee the partner's effective take is 13.5% of brokerage below the
threshold and 18% above it. Worth keeping in view when comparing against what
other referral programmes advertise.

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
| `platform_fee_pct` | 10 | Your cut, taken from the partner's share |
| `tds_pct` | 2 | TDS on the balance after the fee — **confirm the rate with your CA** |
| `attribution_lock_days` | 90 | How long the first referrer owns a buyer's number |
| `payout_days_after_registration` | 15 | The payout promise made on the site |
| `listings_sheet_id` | *(blank)* | ID of the spreadsheet holding your listings — **required for the property grid** |
| `listings_tab` | Properties | Tab name inside that spreadsheet |
| `listing_band_low` / `listing_band_high` | 0.5 / 1.25 | Price band around the buyer's budget |
| `notify_email` | *(blank)* | Gets an email on every new lead; blank disables it |
| `support_phone` / `support_email` | *(blank)* | Shown to partners in the footer |

### 5. Connect your listings

Copy the ID out of your listings spreadsheet URL —
`docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit` — and paste it into
`listings_sheet_id` in the Config tab.

The script only ever **reads** that sheet. It runs as you, so the listings sheet
can (and should) stay private — you do not need to share it with anyone for this
to work.

What it reads per row: `Title`, `Location`, `Type`, `Bedrooms`, `Area`, `Price`,
`ImageURL`, `Status`, `Possession`. A row is shown only when it has a readable
price, at least one image, and a `Status` that is blank or `Available`. All 147
rows in the current sheet qualify.

Listings are cached for 10 minutes. After editing the listings sheet, run
`refreshListings()` from the Apps Script editor to see the change immediately.

**Two things the code works around, so you don't have to fix the sheet first:**

- **Price is free text.** Not one of the 147 values is a number — they read
  `81 Lakhs Onwards`, `Price: ₹2.20 Cr Onwards*`, `₹2.44  - ₹4.25 Cr`,
  `₹1.75 Cr 3 BHK, 2.60 Cr 4BHK`, even `34 laksh ownerds`. `parsePriceText_`
  reads all 147 correctly, including inheriting the unit across a range and
  ignoring room counts that look like prices. Every one of those shapes is in
  the test suite.
- **The date-corrupted `Bedrooms` cells are recovered.** Sheets turned entries
  like `3,4` into 4 March, and the date still carries both numbers as month and
  day. Against the 7 rows whose titles also state the BHK range, the
  reconstruction agrees 7 times and disagrees none, so those cells display as
  `3–4 BHK` rather than a date. Worth still fixing the sheet eventually — but
  nothing is blocked on it.

### 6. Optional — housekeeping triggers

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
| `web/index.html` | Public — pitch, live earnings calculator, matching properties, rate card, FAQ |
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
- **Listing photos are Drive links.** `ImageURL` points at
  `lh3.googleusercontent.com/d/<id>`. Those files must stay shared as "anyone
  with the link" or the cards show a "Photo unavailable" placeholder instead.
  This is the one thing in the listings sheet that has to remain public — the
  rows themselves do not.
- **Sheets is not a database.** Reads scan the whole tab, so past a few thousand
  referrals the dashboard gets slow. That is the point to move to Postgres or
  Firebase — the API shape here is deliberately plain so the frontend would not
  have to change.
