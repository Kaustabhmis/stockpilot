# What to deploy

Built from `hrms-lite/`. These are copies for downloading, not somewhere to
edit.

## Staying on Google Sheets (what you run today)

1. **`Code.gs`** -> paste over the Apps Script bound to the sheet, then deploy
   the EXISTING deployment. Not a new one, or the address both apps talk to
   changes.
2. **`biscs-os-netlify.zip`** -> drag onto your existing Netlify site, in its
   Deploys tab. Not "Add new site", or the domain stops working.
3. **Open the site twice.** The installed app serves its cached copy first.

Then: check the late-mark slab reads `6:1, 12:2, 24:3` in Settings ->
Attendance rules, and regenerate any payroll run you had already saved.

## Moving to Postgres (Supabase)

**`supabase-backend.zip`** holds the schema, the seed and the API.

1. Make a NEW Supabase project. Do not use the one your other system runs on.
2. SQL editor: run `schema.sql`, then `seed-settings.sql`, then `seed.sql`.
3. Deploy `functions/api` as an Edge Function.
4. Open `migrate.html` (it is in the site zip, at `/migrate.html`), give it
   both addresses and the owner sign-in, press **Check both sides**, then
   **Copy everything across**. It counts both sides and tells you whether
   they agree. **If any table does not agree, do not switch over.**
5. Point the apps at the new address and redeploy the site.

**The sheet is never written to.** It stays exactly as it is, so until you
change the address the office carries on as normal, and if anything looks
wrong you simply keep using it.

### Passwords after a migration

Everyone signs in with the password they already have. The sheet's hashes
come across as they are, and each one is quietly replaced with a proper
salted hash the first time its owner signs in. Nobody is locked out and
nobody has to do anything.

## Browsing the data (instead of opening the sheet)

Settings -> **Browse the data**, owner only. Every table, a search across
every column, edit a cell, delete a row, export CSV.

It is the raw data: a change there is written exactly as typed, nothing is
recalculated and no approval is asked for. Use the ordinary screens unless
you are fixing something they cannot reach.

## Checking it yourself

    cd hrms-lite/tools
    ./run-audit.sh https://your-test-workspace     # nine checks
    node migration.test.js <sheet-url>/exec <postgres-url>/exec

Every audit file states its rules in words at the top and derives the
expected figures from those words, so it checks the system against the rules
rather than against itself. The migration test compares row counts AND
recomputes the whole payroll from the migrated data - counts prove nothing
arrived short, recomputing the money proves it arrived meaning the same
thing.

Point them at a TEST workspace, never the live sheet: they write employees,
attendance, leave and payroll rows.
