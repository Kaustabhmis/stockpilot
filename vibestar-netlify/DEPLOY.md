# Deploying VibeStar to Netlify

Start to finish, assuming nothing is set up yet. Budget about 40 minutes the
first time.

> **Drag-and-drop will not work.** Netlify's "drag your folder here" upload only
> handles static files. This app has serverless functions with npm dependencies
> that have to be bundled, so use one of the methods below instead.

---

## Pick a database first

| | | |
|---|---|---|
| **Supabase** | Postgres. No rate limit, real transactions. | **Use this for anything real.** |
| **Google Sheets** | You can open the spreadsheet and read every row. | Fine for a demo; ~300 reads/min for the whole site. |

Setting one environment variable chooses it. Switching later needs no code
changes — see *Moving from Sheets to Supabase* in README.md.

---

## The short way

```bash
cd vibestar-netlify
npm install
npm run deploy
```

The first run creates a `.env` file and stops, telling you what to fill in. Fill
in **either** `DATABASE_URL` (Supabase) **or** the three `GOOGLE_*` values
(Sheets), run `npm run deploy` again, and it does everything else: installs
dependencies, installs and logs into the Netlify CLI, creates or links the site,
uploads your environment variables, sets up the database, and publishes.

To check your `.env` without deploying anything:

```bash
npm run deploy -- --check
```

If something is wrong it says which value and how to fix it, rather than failing
somewhere in the middle.

To ship an update later, run `npm run deploy` again. That is the whole workflow.

**The rest of this document is the same thing done by hand**, which is worth
reading once so you know what the script is doing on your behalf — and is what
you need if a step fails.

---

## Before you start

You need three things. Get them in this order — each one depends on the last.

### 1. Node.js on your computer

Download the LTS version from [nodejs.org](https://nodejs.org). Then check it:

```bash
node --version
```

It must say **v20** or higher. If the command is not found, restart your
terminal after installing.

### 2a. Supabase — the recommended database

There is a wizard for this:

```bash
npm run supabase
```

It walks you through creating the project, then takes the connection string and
handles the three things that usually go wrong: the `[YOUR-PASSWORD]` placeholder
people paste unchanged, a password containing `@ : / ?` that needs
percent-encoding, and the direct-vs-pooled distinction that only bites later
under load. It also tests the connection before writing anything, so a mistake
surfaces immediately rather than mid-deploy.

By hand:

1. Create a project at [supabase.com](https://supabase.com). Free to start.
   Save the database password it shows you; you cannot see it again.
2. **Project Settings → Database → Connection string.**
3. Copy the **pooled** string — the one on port **6543**. Not the direct 5432
   one: serverless functions open many short-lived connections and the direct
   string will run out of them under any real traffic.
4. If your password contains `@ : / ?` it must be percent-encoded in the URL.
   Easiest to just reset it to something alphanumeric.

Then `npm run migrate`. Skip 2b entirely if you are using Supabase.

### 2b. Google Sheets — the alternative database

1. Create a new blank spreadsheet at [sheets.new](https://sheets.new).
   Name it something like "VibeStar Data".
2. Copy its **id** from the address bar — the long string between `/d/` and
   `/edit`:
   ```
   https://docs.google.com/spreadsheets/d/1AbCdEf...XyZ/edit
                                          ^^^^^^^^^^^^^^ this part
   ```
3. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create a project (any name).
4. **APIs & Services → Library** → search "Google Sheets API" → **Enable**.
5. **APIs & Services → Credentials → Create credentials → Service account.**
   Any name. Skip the optional role and access steps — click through them.
6. Click the service account you just made → **Keys** tab → **Add key → Create
   new key → JSON**. A `.json` file downloads. Keep it safe; it is a password.
7. Open that file in a text editor. You need two values from it:
   - `"client_email"` — looks like `something@your-project.iam.gserviceaccount.com`
   - `"private_key"` — a long block starting `-----BEGIN PRIVATE KEY-----`
8. **Go back to your spreadsheet, click Share, paste the `client_email`
   address, set it to Editor, and send.**

   Step 8 is the one everybody skips. Creating the key gives access to nothing —
   the spreadsheet has to be shared with that address exactly as if it were a
   colleague. If you get a "permission" error later, this is why.

### 3. Razorpay keys (optional at first)

You can deploy without these. The app runs in DEMO mode and hands out
subscriptions free — fine for showing people, never for real users.

When you are ready: Razorpay Dashboard → **Settings → API Keys** → generate.
Use **test** keys until you are actually launching.

---

## Method A — Netlify CLI, step by step

This is what `npm run deploy` automates. No GitHub needed; everything runs from
your own computer.

### Step 1 — Get the code onto your computer

Unpack `vibestar-netlify.tar.gz`, then open a terminal in that folder:

```bash
cd vibestar-netlify
npm install
```

### Step 2 — Set up the database

**If you chose Supabase:** `npm run supabase` did this already. By hand:

```bash
export DATABASE_URL='postgresql://…@…pooler.supabase.com:6543/postgres'
npm run migrate
```

It prints all 13 tables and their index counts. Optionally add demo data:

```bash
npm run seed
```

Then skip to Step 3.

**If you chose Google Sheets:** put the downloaded JSON key file in the project
folder as `key.json`, then read
the values straight out of it — safer than pasting a multi-line key by hand.

On **macOS or Linux** (needs [jq](https://jqlang.github.io/jq/), or use the
manual version below):

```bash
export GOOGLE_SHEET_ID='paste-the-id-here'
export GOOGLE_CLIENT_EMAIL="$(jq -r .client_email key.json)"
export GOOGLE_PRIVATE_KEY="$(jq -r .private_key key.json)"

npm run setup
```

Without jq, paste the key manually — the quotes must be single, and the line
breaks are fine as real line breaks here:

```bash
export GOOGLE_SHEET_ID='paste-the-id-here'
export GOOGLE_CLIENT_EMAIL='paste-the-client-email-here'
export GOOGLE_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----
...the whole key...
-----END PRIVATE KEY-----'

npm run setup
```

On **Windows PowerShell** (note `-Raw` — without it the JSON will not parse):

```powershell
$key = Get-Content key.json -Raw | ConvertFrom-Json
$env:GOOGLE_SHEET_ID='paste-the-id-here'
$env:GOOGLE_CLIENT_EMAIL=$key.client_email
$env:GOOGLE_PRIVATE_KEY=$key.private_key

npm run setup
```

**Add `key.json` to `.gitignore` before committing anything**, or delete it once
you are done. It is a credential.

You should see it list every table. Open the spreadsheet — the tabs are there.

Then optionally add demo data so the app is not empty:

```bash
npm run seed
```

### Step 3 — Deploy

```bash
npm install -g netlify-cli
netlify login          # opens your browser
netlify init           # choose "Create & configure a new site"
```

Accept the defaults when it asks about the build command and publish directory —
`netlify.toml` already specifies them.

```bash
netlify deploy --prod
```

It prints your live URL. **The app will not work yet** — it has no idea where its
database is. That is the next step.

### Step 4 — Set the environment variables

In the Netlify web dashboard: **Site configuration → Environment variables →
Add a variable**, and add these one at a time.

Set the database group for whichever backend you chose — **not both**, unless you
want Postgres to win.

| Key | Value |
|---|---|
| **Supabase** | |
| `DATABASE_URL` | The pooled connection string, port 6543 |
| **or Google Sheets** | |
| `GOOGLE_SHEET_ID` | The spreadsheet id |
| `GOOGLE_CLIENT_EMAIL` | The service account address |
| `GOOGLE_PRIVATE_KEY` | The whole private key — see the warning below |
| **Both backends** | |
| `MEDIA_URL_SECRET` | Any long random string. Run `openssl rand -hex 32` |
| `ADMIN_EMAILS` | Your own email, so you get the admin panel |
| `PLATFORM_COMMISSION_PERCENT` | `15`, or whatever cut you take |
| `RAZORPAY_KEY_ID` | Only when taking payments |
| `RAZORPAY_KEY_SECRET` | Only when taking payments |
| `RAZORPAY_WEBHOOK_SECRET` | Only when taking payments — see Step 6 |

> **Sheets only: the private key is where this usually goes wrong.** In the JSON file the key
> is one long line containing `\n` as two literal characters. Paste it into
> Netlify **exactly like that**, `\n` sequences and all, including the
> `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` parts. Do not
> reformat it into real line breaks and do not remove anything. The app handles
> both forms, but the `\n` version is what survives copy-paste intact.

Then redeploy so the functions pick them up:

```bash
netlify deploy --prod
```

### Step 5 — Check it works

Open your site. You should get the sign-in screen. Create an account, or log in
with `admin@vibestar.app` / `demo1234` if you seeded.

Now look in your database:

- **Supabase** → Table Editor → `users`
- **Sheets** → the `Users` tab

**Your new account is a row there.** If you can see it, everything is wired up
correctly.

If you see an error instead, jump to Troubleshooting below.

### Step 6 — Razorpay webhook (only if taking payments)

Razorpay Dashboard → **Settings → Webhooks → Add new webhook**:

- **URL:** `https://YOUR-SITE.netlify.app/webhooks/razorpay`
- **Secret:** make one up, then put the same value in `RAZORPAY_WEBHOOK_SECRET`
- **Events:** tick `payment.captured` and `payment.failed`

This is what completes a payment when someone closes their browser mid-checkout.
Without the secret set, the endpoint refuses to run rather than trusting an
unsigned payload — so a missing secret means payments silently never settle.

---

## Method B — GitHub (better once you are live)

Same result, but Netlify rebuilds automatically every time you change the code.

### Step 1 — Create the repository

Go to **[github.com/new](https://github.com/new)**:

- **Name:** `vibestar`
- **Private** (recommended)
- Leave every *"Initialize this repository with"* box **unticked** — a
  pre-created README puts a commit in the repo and makes the first push conflict

Click **Create repository** and copy the URL it shows you.

### Step 2 — Push

```bash
cd vibestar-netlify
bash scripts/publish-to-github.sh https://github.com/YOU/vibestar.git
```

That sets up git, commits, and pushes. It refuses to push if a credential file
is staged — a pushed secret has to be treated as burnt even if you delete it
afterwards, so it is checked before rather than after.

If GitHub asks for a password, it wants a **personal access token**, not your
account password: github.com → Settings → Developer settings → Personal access
tokens → Fine-grained → give it access to this repository. Or install the
[GitHub CLI](https://cli.github.com) and run `gh auth login` once.

### Step 3 — Connect Netlify

**Add new site → Import an existing project → GitHub** → pick the repository.
Accept the detected settings; `netlify.toml` already specifies them.

### Step 4 — The remaining setup

Do **Step 2** (create the spreadsheet tabs) and **Step 4** (environment
variables) from Method A above. Both are still required — importing the repo
gets the code onto Netlify, not the database credentials.

After that, every `git push` deploys automatically.

---

## Updating the site later

**Method A:** `npm run deploy` (or just `netlify deploy --prod` if nothing but
code changed).
**Method B:** `git push` — Netlify rebuilds on its own.

Either way, after an update that changes the schema, re-run `npm run migrate`
(Supabase) or `npm run setup` (Sheets). Both are safe to run at any time and
neither deletes data.

---

## Troubleshooting

### Supabase

**"password authentication failed"**
Wrong password in `DATABASE_URL`, or a special character that needs
percent-encoding. Reset it in Supabase → Project Settings → Database.

**"Connection terminated" / "too many connections"**
You are using the direct connection string. Switch to the pooled one on port
6543.

**Everything worked, then stopped after a week**
Free Supabase projects pause after a week of inactivity. Open the dashboard and
resume it; no data is lost.

**"relation \"users\" does not exist"**
The schema was never applied. Run `npm run migrate`.

### Google Sheets

**"The caller does not have permission" / 403 from Google**
The spreadsheet is not shared with the service account. Open it, click Share,
add the `GOOGLE_CLIENT_EMAIL` address as an **Editor**. This is the single most
common failure.

**"Requested entity was not found" / 404 from Google**
`GOOGLE_SHEET_ID` is wrong. It is only the part between `/d/` and `/edit` — not
the whole URL.

**"error:0909006C" or "DECODER routines" or "unsupported"**
`GOOGLE_PRIVATE_KEY` is mangled. Re-copy it from the JSON file, keeping the
`\n` characters and both BEGIN/END lines. Do not let your editor "tidy" it.

**"GOOGLE_SHEET_ID is not set"**
The variables were added but the site was not redeployed, or they were added to
the wrong site. Netlify only picks up environment variables on a new deploy.

**"briefly at its Google Sheets rate limit"**
You have hit Google's ceiling — about 300 reads and 60 writes per minute for the
whole site, everyone combined. It clears in under a minute. If it happens
regularly you have outgrown a spreadsheet: create a Supabase project, set
`DATABASE_URL`, run `npm run migrate`, redeploy. No code changes.

**The site loads but every action fails**
Check **Netlify → Logs → Functions** for the real error. The app deliberately
returns a generic message to the browser so it cannot leak the spreadsheet id.

**Payments never complete**
`RAZORPAY_WEBHOOK_SECRET` is missing, or the webhook URL is wrong. Razorpay's
dashboard shows delivery attempts and their responses under the webhook.

---

## Before real users arrive

Deploying is the easy half. `README.md` has the full list, but the ones that
will actually bite you:

- **Delete the demo accounts.** On Sheets, sort the Users tab by email and delete
  the `@vibestar.app` and `@throwaway.xyz` rows. On Supabase:
  `DELETE FROM users WHERE email LIKE '%@vibestar.app' OR email LIKE '%@throwaway.xyz';`
- **Restrict who can reach the database.** On either backend, anyone with access
  can read every user's email address and every private message.
- **Back it up on a schedule.** Supabase does daily backups on paid plans — check
  yours actually covers you, and test a restore. On Sheets, File → Make a copy;
  version history is not a backup.
- **Fill in the `[SQUARE BRACKETS]`** in `public/legal/` — an unfilled
  placeholder is not a legal term.
- **Confirm your content category with Razorpay in writing** before going live.
  Adult-adjacent content is restricted by most Indian payment aggregators, and
  finding out after launch means a frozen account.
