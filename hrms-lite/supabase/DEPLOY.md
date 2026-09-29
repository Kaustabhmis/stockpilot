# Putting this on Supabase

## 1. A project

A NEW one. Not the project called "hrms" that already exists in the account -
that is the other system, and nothing here should go near it.

Free tier allows two active projects per account. If both slots are taken,
one has to be paused or the account upgraded before a third can be made.

Region: **ap-south-1 (Mumbai)** is the closest to Kolkata. The existing
projects sit in Tokyo and Sydney, which cost 60-100 ms more on every call.

## 2. The database

SQL editor, in this order:

    schema.sql          21 tables, typed and indexed
    seed-settings.sql   the 68 settings a fresh workspace gets
    seed.sql            shift, leave and request types, approval chain,
                        salary structure, and the first owner login

`seed.sql` creates `admin@company.com` with the password `admin123`.
**Change it the moment you have signed in once.**

## 3. The signing key

    supabase secrets set TOKEN_SECRET="$(openssl rand -hex 32)" --project-ref <ref>

This signs the session tokens. A guessable one means anybody can mint a
session as the owner, so the function refuses to start without a long one.

## 4. The API

    supabase functions deploy api --project-ref <ref> --no-verify-jwt

`--no-verify-jwt` is deliberate: the function authenticates callers itself,
with our own session tokens rather than Supabase JWTs, and the sign-in call
has to be reachable before anybody has one.

Its address is then:

    https://<ref>.supabase.co/functions/v1/api

Check it:

    curl -s -X POST https://<ref>.supabase.co/functions/v1/api \
      -H 'content-type: application/json' -d '{"action":"ping"}'

    {"ok":true,"data":{"service":"BISCS OS","store":"postgres"}}

## 5. Prove it before trusting it

    cd ../tools
    ./run-audit.sh https://<ref>.supabase.co/functions/v1

Nine checks. Every one states its rules in words and derives the expected
figures from those words, so it tests the system against the rules rather
than against itself.

## 6. Move the data

Open `/migrate.html` on the site, give it both addresses and the owner
sign-in, press **Check both sides**, then **Copy everything across**.

It counts every table on both sides afterwards. **If any table does not
agree, do not switch over.**

The sheet is never written to. It stays exactly as it is, so the office
carries on as normal until you change the address - and if anything looks
wrong, you simply keep using it.

### Passwords

Everybody signs in with the password they already have. The sheet's hashes
come across as they are, and each is quietly replaced with a proper salted
one the first time its owner signs in. Nobody is locked out.

## 7. Point the apps at it

In `index.html` and `app/index.html`, the API address. Then redeploy the
site and open it twice.

Keep the Apps Script deployment alive for a week or two. Going back is then
one redeploy, not a recovery.

## Still to do

- Row Level Security. Today the Edge Function is the only gate, which is
  the same arrangement the sheet had - but Postgres can enforce the rules
  itself, and it should.
- Payslip email and the eSSL pull/push are still on the Apps Script side.
