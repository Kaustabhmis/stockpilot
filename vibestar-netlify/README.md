# VibeStar

A creator subscription platform: public feed with 30-day expiring posts, reels,
search, saved posts, free follows, private subscriber galleries, paid one-to-one
messaging, tips, verification badge tiers, Razorpay payments with platform
commission, and a full admin panel.

**Deploying: `npm run deploy`.** See [DEPLOY.md](DEPLOY.md).

## One codebase, three ways to run it

| Run it as | Database | Setup | Best for |
|---|---|---|---|
| **Netlify + Supabase** | Postgres | `npm run supabase` then `npm run deploy` | Anything real. No rate limit, real transactions, real unique indexes. |
| **Netlify + Google Sheets** | A spreadsheet | `npm run setup` then `npm run deploy` | Reading every row by hand. Hard rate ceiling. |
| **Google Apps Script** | A spreadsheet | `npm run build:gas`, paste 2 files | Nothing but a Google account. No servers, no CLI, no billing. |

`src/` is the single source of truth for all three. **Not one line of any route
knows which it is running on** — `src/lib/store.js` picks a backend from the
environment, and each implements the same interface.

For Apps Script, `npm run build:gas` generates `apps-script/vibestar/Code.gs` and
`Index.html` from that same source. It is a build product, not a second copy —
which matters, because a hand-maintained copy would have drifted within a week.

### How that is kept honest

**One 48-test route spec runs against all three backends** —
`tests/suite-routes.mjs`, with a harness per target. The Postgres half runs
against a real PostgreSQL server; the Apps Script half runs against a mocked
`SpreadsheetApp`/`Utilities`, and a further test **executes the generated
`Code.gs`** to prove the bundle itself loads and its entry points work.

A behavioural difference between the three fails the build. That has already
earned its keep — it caught Postgres rendering timestamps in a different format,
and Apps Script rejecting inserts the other backends accepted.

```bash
npm test    # 191 tests
```

Switching between targets is configuration, not a rewrite.

### What the Apps Script target cannot do

Worth knowing before you choose it. All four are limits of the platform, and the
Netlify deployment does all four properly:

| | Why |
|---|---|
| **No link preview cards** | The page is served inside a googleusercontent iframe, so crawlers never see its Open Graph tags |
| **No webhook signature verification** | `doPost` exposes no request headers, so `X-Razorpay-Signature` is unreadable. The body is used only to decide which payment to re-fetch from Razorpay |
| **Weaker password hashing** | No scrypt, and every PBKDF2 iteration is a bridge call, so the count stays in the thousands |
| **Slower private galleries** | Apps Script cannot serve binary, so subscriber-only media travels as a base64 data URI rather than a cacheable signed URL |

It also does one thing *better*: `LockService` is a real mutex, so it needs none
of the claim-and-read-back dance the Netlify+Sheets build has to emulate.

### Running the same accounts on two targets

Password hashes are tagged with the algorithm that produced them
(`scrypt$…` or `pbkdf2$…`), so either deployment can read what the other wrote —
provided it can compute that algorithm. Apps Script cannot do scrypt.

So if the **same accounts** must work on both, set `PASSWORD_ALGO=pbkdf2` on the
Netlify side before anyone signs up. Otherwise Apps Script will refuse those
logins with a message saying exactly that, rather than looking like a wrong
password.

---

## Read this before you launch on Sheets

Skip this section if you are using Supabase.

Google Sheets is a real database in the sense that it stores your data durably
and you can query it. It is not a real database in the sense that matters at
scale, and two limits are worth knowing before you sell a subscription.

### 1. The rate limit is the ceiling on your traffic

The Sheets API allows roughly **300 reads and 60 writes per minute per project**.
That is the whole site, all users combined — not per user.

The app is built to spend as little of that as possible:

| | Cost |
|---|---|
| Any page load or feed refresh | **1 read** — every table the route needs arrives in one batched call |
| A post, comment, like, or message | **1 read + 1 write** — everything the handler changed goes back in one batch |
| Signup, payment, subscription, verification | **3 reads + 3 writes** — these take the lock (see below) |
| Nightly maintenance | 3 reads + 3 writes for the entire sweep |

The locked operations are the expensive ones because mutual exclusion on a
spreadsheet costs real calls: claim the cell, read it back to see who won, load
the tables fresh, write, release. That is why only four operations pay for it —
the ones where losing a race corrupts something. These numbers are asserted in
`tests/router.test.mjs`, so a change that quietly makes a route more expensive
fails the build.

In practice that supports something on the order of **a few dozen simultaneously
active users**. A hundred people refreshing a feed at once will start seeing
"briefly at its rate limit, try again". No amount of code tuning changes this;
it is the API's number.

If you outgrow it, switching to Supabase is: create the project, set
`DATABASE_URL`, run `npm run migrate`, redeploy. No code changes. See
**Moving from Sheets to Supabase** below.

### 2. Anyone with edit access to the sheet can break things

Reading the spreadsheet is safe and genuinely useful. Editing it needs care:

- **Never delete or reorder columns.** Rows are addressed by column position.
- **Never sort a tab.** The app writes to a row by its number.
- **Delete whole rows** (right-click → Delete row). Clearing a row's contents
  leaves a blank line — harmless, the app skips those, but it accumulates.
- **Do not touch the `_Lock` tab.** It is a mutex, not data.

Editing while the app is running is safe: no request caches row positions across
requests, precisely so a hand edit cannot make a later write land on the wrong
row.

### What is *not* in the spreadsheet, and why

**Sessions and login-attempt counters live in Netlify Blobs**, not Sheets. Both
are touched on effectively every request, and Sheets cannot index — resolving one
bearer token would mean reading the entire session table, every time, against
that 300-reads-a-minute budget. Neither is data you would ever want to look at in
a spreadsheet, and losing all of it just logs everyone out.

**Uploaded photos and videos live in Netlify Blobs** too, served through
`/media/:key`. A spreadsheet cell cannot hold a 10MB image.

---

## Setup — Supabase

```bash
npm install
npm run supabase
```

That wizard is the short path. It asks you to create the project and paste the
connection string, then does the rest: fills in the password placeholder,
percent-encodes special characters, checks the connection actually works, warns
if you grabbed the direct string instead of the pooled one, writes `.env`,
generates a `MEDIA_URL_SECRET`, applies the schema, and offers demo data. Safe to
re-run.

By hand, if you prefer:

1. Create a project at [supabase.com](https://supabase.com). Free to start.
2. **Project Settings → Database → Connection string.** Copy the **pooled**
   string — port **6543**, the pgBouncer one. Serverless functions open many
   short-lived connections and the direct 5432 string will exhaust the limit.
3. Then:

```bash
export DATABASE_URL='postgresql://…6543/postgres'
npm run migrate    # creates all 13 tables and their indexes, safe to re-run
npm run seed       # optional demo data, password demo1234
```

Re-run `npm run migrate` after any release that changes `db/schema.sql`.

---

## Setup — Google Sheets

### 1. Create the spreadsheet

1. Create a new blank Google Spreadsheet. Copy its id from the URL — the long
   string between `/d/` and `/edit`.

### 2. Create a service account

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create a project (or pick an existing one).
2. **APIs & Services → Library →** search "Google Sheets API" → **Enable**.
3. **APIs & Services → Credentials → Create credentials → Service account.**
   Give it any name; no roles are needed.
4. Open the new service account → **Keys → Add key → Create new key → JSON**.
   A file downloads. It contains `client_email` and `private_key`.
5. **Share the spreadsheet with the `client_email` address, as an Editor.**
   This is the step everyone forgets. Creating a key grants access to nothing;
   the sheet has to be shared with it like you would share it with a colleague.

### 3. Create the tabs

```bash
npm install

export GOOGLE_SHEET_ID='...'
export GOOGLE_CLIENT_EMAIL='vibestar@your-project.iam.gserviceaccount.com'
export GOOGLE_PRIVATE_KEY="$(jq -r .private_key key.json)"

npm run setup    # creates every tab with its header row — safe to re-run
npm run seed     # optional demo data, password demo1234
```

Re-run `npm run setup` after any release that adds a column.

---

## Setup — Google Apps Script

No servers, no CLI, no billing. A Google account and about ten minutes.

```bash
npm install
npm run build:gas
```

That writes `apps-script/vibestar/Code.gs` and `Index.html`. Then:

1. Open the Google Spreadsheet you want to use → **Extensions → Apps Script**.
   (A standalone project also works; put the spreadsheet id in
   **Project Settings → Script properties** as `GOOGLE_SHEET_ID`.)
2. Paste `Code.gs` over the default `Code.gs`.
3. **+ → HTML** → name it exactly `Index` → paste `Index.html`.
4. Run **`setUpSpreadsheet`** once from the editor, and approve the permissions.
   The prompt only appears on an editor run, which is why this step cannot be
   skipped — and why the function deliberately touches Drive, so the upload
   scope is granted now rather than failing later for a user who cannot grant it.
5. Run **`installTrigger`** once, for nightly expiry and reminders.
6. Optionally run **`seedDemoData`** for the demo accounts.
7. **Deploy → New deployment → Web app**, with:
   - Execute as: **Me**
   - Who has access: **Anyone**

Optional settings go in **Project Settings → Script properties**:
`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `MEDIA_URL_SECRET`, `ADMIN_EMAILS`,
`PBKDF2_ITERATIONS`.

Rebuild and re-paste `Code.gs` after any change to `src/`. The setup notes are
repeated at the top of the generated file, so they travel with it.

---

## Deploy to Netlify

```bash
npm i -g netlify-cli
netlify init        # or connect the repo in the Netlify UI
```

Set the variables from `.env.example` under **Site configuration → Environment
variables**, then:

```bash
netlify deploy --prod
```

Set `DATABASE_URL` (Supabase) **or** the three `GOOGLE_*` values (Sheets), not
both unless you mean Postgres to win. For `GOOGLE_PRIVATE_KEY`, paste the whole
value including the `BEGIN`/`END` lines and leave the `\n` sequences exactly as
they appear in the JSON.

## Razorpay

1. Dashboard → **Settings → API Keys** → copy key id and secret into Netlify.
2. Dashboard → **Settings → Webhooks** → add
   `https://YOUR-SITE.netlify.app/webhooks/razorpay`
   - Events: `payment.captured`, `payment.failed`
   - Set a secret and put the same value in `RAZORPAY_WEBHOOK_SECRET`

The webhook is what settles a payment when someone closes the browser
mid-checkout. Without `RAZORPAY_WEBHOOK_SECRET` the endpoint refuses to run
rather than trusting an unauthenticated payload.

## Local development

```bash
netlify dev         # http://localhost:8888, functions included
npm test            # runs the route spec against Sheets
```

The Postgres half of the suite needs a database to point at, and skips without
one:

```bash
TEST_DATABASE_URL='postgresql://…/vibestar_test' npm test
```

Any Postgres will do — a local one, or a throwaway Supabase project. Use a
SEPARATE database: the tests TRUNCATE every table.

## Moving from Sheets to Supabase

The switch is deliberately boring:

1. Create the Supabase project and copy the pooled connection string.
2. `DATABASE_URL='…' npm run migrate`
3. Set `DATABASE_URL` in Netlify's environment variables and redeploy.

`GOOGLE_SHEET_ID` can stay set; Postgres takes precedence and the app logs which
one it chose. Going back is removing `DATABASE_URL`.

**Existing data does not move by itself.** There is no importer — the two
backends share a schema but nothing copies rows between them. For a live site
the honest options are to export each Sheets tab as CSV and `\copy` it into the
matching table, or to accept the reset while the user count is still small.
Worth deciding before you have paying subscribers rather than after.

---

## Architecture

```
netlify/functions/
  api.js           one function, internal router, ~50 endpoints
  share.js         server-rendered /p/:id share pages (OG tags)
  media.js         streams uploads from blob storage with real content-types
  webhook.js       Razorpay webhook, signature-verified
  maintenance.js   scheduled daily: expiry, reminders, pruning
build/
  build-gas.mjs    generates Code.gs + Index.html from src/
src/lib/
  tables.js        the schema, independent of where it is stored
  store.js         picks a backend from the environment; routes import only this
  store-pg.js        Supabase/Postgres — transactions, advisory lock
  store-sheets.js    Sheets over REST — batched cells, mutex cell
  store-gas.js       Sheets via SpreadsheetApp — native calls, LockService
  sheets.js        Sheets REST transport: JWT, batched reads and writes
  platform.js      runtime primitives; -node and -gas implement the same names
  kv.js            sessions and login throttling, in Blobs rather than the DB
src/gas/           Apps Script only: entry points, Drive media, sheet sessions
  auth.js          scrypt, sessions
  config.js        every tunable
  util.js          sanitisation, badges, media signing
src/routes/        auth, content, social, money, admin, media
tests/
  suite-routes.mjs   ONE route spec, run against ALL THREE backends
  harness-pg.mjs     runs it on a real PostgreSQL server
  harness-sheets.mjs runs it on a fake Sheets API, mocked at the fetch boundary
  harness-gas.mjs    runs it on a mocked Apps Script runtime
  gas-bundle.test.mjs  executes the GENERATED Code.gs
public/            static SPA (index.html + app.js) and the legal pages
```

**One API function, not forty.** Each Netlify Function pays its own cold start,
so a single router keeps one warm container for the whole surface. Every route
declares `PUBLIC`, `USER` or `ADMIN` in one table, so authorisation is a property
of the routing table rather than something each handler must remember.

**That same table declares each route's tables**, which is what makes the quota
survivable: the request loads all of them in one batched call before the handler
runs, and writes everything back in one more on the way out.

### Where the correctness lives

Five guarantees matter, and the two backends reach them differently. This table is
the most useful thing in this file if you are deciding between them.

| Guarantee | On Postgres | On Sheets |
|---|---|---|
| One account per email and username | Unique index on `lower(email)` / `lower(username)` | Mutex: re-read inside the lock, then check |
| One live subscription per pair | Partial unique index `WHERE status='ACTIVE'` | Mutex |
| A payment settles exactly once | Unique index on `payment_id`, inside a transaction | Mutex, plus a payment-id replay check |
| One open verification request per creator | Partial unique index `WHERE status='PENDING'` | Mutex |
| A double tap cannot double-count a like | Unique index on `(post_id, user_id)` | Counted distinct, so a duplicate row is harmless |

Both backends also count likes and followers as **distinct ids** rather than rows.
On Sheets that is the only defence, and it is what lets the most frequent write in
the app skip the lock entirely. On Postgres it is redundant with the index — kept
anyway, because one code path beats two.

**The Sheets mutex** is a single cell in the `_Lock` tab: claim it, pause, read it
back. Sheets serialises writes, so if two callers claim at once the cell holds
exactly one id and only that caller sees its own token. The claim carries a
15-second expiry, so a function that dies mid-write cannot wedge the app.

**On Postgres** the same call is a real `BEGIN`/`COMMIT` with
`pg_advisory_xact_lock`, so a failure halfway through rolls back instead of
leaving a half-applied change, and the lock releases itself when the transaction
ends even if the function is killed. The lock is deliberately global, matching the
Sheets behaviour exactly so both serialise the same operations — per-row
`SELECT … FOR UPDATE` is the obvious next refinement, but identical behaviour
across backends is worth more than the concurrency today.

---

## Design decisions worth knowing

**Expiry is a property of the clock, not of a stored flag.** The Postgres build
flipped elapsed posts to `EXPIRED` on every feed read. Here that would be a write
on every read, and the feed alone would exhaust the quota — so readers compare
`expires_at` to now, and the nightly job tidies the stored value up afterwards.
If maintenance never runs, nothing becomes visible that should not be.

**Money is never taken from the client's word.** Order amounts are computed
server-side from the creator's price or the verification fee. On the callback the
signature is checked, then the payment is **re-fetched from Razorpay** and its
status, order id and amount compared before anything is granted.

**Commission is recorded, not settled.** Razorpay pays the full amount into your
account, so each creator's net is a liability you still owe them. The admin panel
shows the running total. Razorpay Route splits at source and is the fix before
you have more than a handful of creators.

**Paying for verification buys a tick, not a tier.** Badge colour comes only from
an admin-confirmed external follower count, never from in-app follows — twelve
throwaway accounts would otherwise mint a purple badge.

**The private gallery is gated at the file, not just the page.** A creator can
publish to Everyone or to Subscribers; subscriber-only posts never enter the feed
for anyone without a live subscription, and their share links return a teaser
with no caption or media. The part that matters is `/media/:key`: a browser will
not attach an Authorization header to an `<img>` request, so a bearer token
cannot gate a file. Private media is therefore served only against a short-lived
HMAC signature bound to the requesting viewer — a subscriber cannot pass a
working link to someone who has not paid, and the link expires anyway. Without
that, the paywall would be decoration.

**Two surfaces, two standards.** The Discovery feed is public — visible to
signed-out visitors through shared links — and holds work suitable for a public
timeline. A creator's private gallery is subscriber-only and is where artistic
and partial nudity belongs. Administrators can view everything for moderation,
including private galleries, and `adminListPosts` signs private media for them
because moderation is impossible if the reviewer cannot open the file.

**Notifications never carry message text.** Threads are subscription-gated, so
copying their content into a second table would route private content around
that gate. `meta` holds only small non-private values (a tip amount, days left).

**Discovery ranks; Following does not.** Discover sorts by engagement, weighting
comments above likes and shares above both, damped by post age. Following stays
strictly chronological — a feed of people you chose belongs in the order it
happened.

**Search is a scan, and that is the right answer here.** Postgres would want a
tsvector and a GIN index. The route already holds every row in memory from its
one batched read, so scanning them costs nothing extra — what matters instead is
that the ranking is sensible (an exact handle beats a word buried in a bio) and
that the feed's visibility rules are applied identically. A private caption is
findable only by someone already entitled to read it, or search would be the hole
in the paywall.

**A bookmark is private, and re-checked on every read.** Saving a post notifies
nobody and exposes no count — "who saved this" is a far more revealing signal
than "who liked it". Entitlement is re-evaluated when the Saved list is opened
rather than trusted from when the save happened, so a saved private post locks
again the moment a subscription lapses. Saving must not outlive paying.

**Filters are baked into the pixels.** A stored filter name would not survive
into a WhatsApp preview or an email, so the flattened image is what everyone
sees. The live camera and the file picker share one pipeline.

**A view counter is not worth the lock.** `share_views` increments without one,
so a simultaneous pair of visitors can cost one increment. Three API calls of
write quota per page view would be a far worse trade.

---

## Not market-ready yet — what remains

The **software** is production-grade. Shipping to paying users needs work that
is not code:

**Scale**
- [ ] Decide, honestly, whether the Sheets rate limit fits your launch. Past a
      few dozen concurrent users it will not, and finding that out during a
      launch is the expensive way to learn it
- [ ] Add pagination to the feed (currently unbounded) — the whole Posts tab is
      read per request, so this bites sooner here than it did on Postgres

**Legal and financial**
- [ ] Razorpay live-mode activation (KYC, business documents, category approval)
- [ ] GST registration and invoicing — legally required for B2C digital services in India
- [ ] Creator payout mechanism (Razorpay Route) and a payout schedule in writing
- [ ] TDS/withholding treatment for creator earnings

**Legal documents** — drafted as templates in `public/legal/`, NOT reviewed by a lawyer
- [ ] Have counsel review Terms, Privacy, Content Policy and Refunds
- [ ] Fill in every `[SQUARE BRACKET]` — entity name, address, GSTIN, grievance
      officer, retention periods, jurisdiction. An unfilled placeholder is not a term.
- [ ] Confirm with Razorpay in writing that your content category is permitted
      before going live — adult-adjacent content is restricted by most Indian
      aggregators, and discovering this after launch means a frozen account
- [ ] Appoint the Grievance Officer required by the IT Rules 2021 and publish the
      name, email and address
- [ ] Fill in the `[REGION]` values in the privacy policy's processor table.
      Google is already named there as the database processor, with a plain
      statement that the store is a spreadsheet and who can read it

**Trust and safety** — the part most platforms underestimate
- [ ] A human moderation process, not just the delete buttons
- [ ] Report/block flows for users (currently admin-only removal)
- [ ] Age verification if any content is adult-adjacent
- [ ] CSAM scanning obligations and a reporting path
- [ ] DMCA / takedown process and a named contact

**Engineering**
- [ ] Independent security review, especially payments and access control
- [ ] Restrict who can open the spreadsheet. Everyone with edit access can read
      every user's email address and every private message
- [ ] Take a copy of the spreadsheet on a schedule (File → Make a copy, or the
      Drive API). Sheets version history is not a backup strategy
- [ ] Error tracking (Sentry) and uptime alerting
- [ ] Rate limiting on the API — throttling covers login only
- [ ] Auto-renew via Razorpay Subscriptions; today a subscription simply lapses
      and the reminders try to win it back
- [ ] Remove the demo seed accounts, and tighten the CSP by moving the inherited
      inline handlers to delegated listeners
- [ ] Set MEDIA_URL_SECRET explicitly rather than letting it fall back
- [ ] Rotate the service-account key if it was ever pasted anywhere shared

**Product**
- [ ] Email delivery for password reset — there is no reset flow at all yet
- [ ] Onboarding for the cold start: the platform is worthless to fans with no
      creators and to creators with no fans

---

## Demo accounts

After `npm run seed`, every account uses **`demo1234`**:

| Email | Role |
|---|---|
| `admin@vibestar.app` | Admin — start here |
| `aarohi@vibestar.app` | Creator + admin, red badge (12k), has a private gallery post |
| `meera.kapoor@gmail.com` | Creator, purple badge (22.4k), has a private gallery post |
| `kabir.raina@yahoo.com` | Creator, blue badge (16.5k) |
| `zoya.f@outlook.com` | Creator, yellow badge (6.2k) |
| `rohit@desaistudio.in` | Creator, verified but below the 5k badge floor |
| `tanya.bose@proton.me` | Creator with a verification request pending |
| `rahul@vibestar.app` | Fan with a live subscription and conversation |
| `bot@throwaway.xyz` | Suspended, so the admin panel has a non-active row |

Addresses deliberately span many providers: sign-in is this app's own credential
system, unrelated to Google accounts — the Google connection here is the
database, not the login.

To delete them before launch, sort or filter the Users tab by email and delete
those rows by hand. That is one of the genuine upsides of this backend.
