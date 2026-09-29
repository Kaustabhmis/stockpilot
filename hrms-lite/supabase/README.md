# The workspace on Postgres

A second backend for the same two front ends. It answers the identical
contract the Apps Script version answers - one endpoint, a body of
`{action, payload, token}` - so the office screen and the staff app change
only their address, and the whole rules audit in `../tools` runs against it
unchanged. That is the point: correctness is re-proven on the new ground
rather than re-guessed.

## What is here

    schema.sql          21 tables, typed and indexed
    seed-settings.sql   the 68 settings a fresh workspace gets
    seed.sql            shift, leave types, request types, approval chain,
                        the salary structure, and the first owner login
    functions/api/      the API itself, portable between Deno and Node
      hrms.js             tables, types, auth, generic reads and writes
      actions.js          the actions: sign in, punch, approve, bootstrap
      router.js           one endpoint, same contract as before

## Try it locally

    createdb hrms
    psql -d hrms -f schema.sql -f seed-settings.sql -f seed.sql
    node ../tools/serve-pg.mjs 8105 "postgresql://localhost/hrms"
    ../tools/run-audit.sh http://127.0.0.1:8105

## What is different from the sheet version, on purpose

**Passwords are bcrypt with a per-user salt**, worked out inside Postgres by
pgcrypto. The sheet kept one fast SHA-256 with a shared prefix, which anybody
holding the Users tab could run through a word list in seconds - and the
first password is the staff code, which everyone knows.

**No global lock.** Apps Script allowed one script-lock holder at a time for
the whole workspace, so every screen in the company stood in one queue.
Postgres handles concurrent readers itself and there is nothing to queue
behind.

**Reading a month is a where clause.** The sheet version guessed how many
rows to read to reach a month, then checked the guess, then read the date
column on its own to find a band of rows when the guess was wrong. All of
that apparatus is gone: `where date between $1 and $2` on an indexed column.

## Measured, 62 staff and 14,508 attendance rows

    HR signs in                     158 ms
    a worker signs in                93 ms
    a worker punches                 10 ms
    "has anything changed?"           3 ms
    HR opens a 5-month-old month     14 ms
    a worker opens an old month       3 ms
    the punch log for one day       219 ms

Server time only - add the trip to the server, roughly 40-120 ms from an
office in India. Apps Script spends 1,000-3,000 ms before it reads a row.

## Not done yet

- the migration that moves the live sheet into Postgres
- the Supabase Edge Function wrapper and deployment
- payslip email, the eSSL pull/push, and the stored integration secrets
- Row Level Security, so the database enforces the rules even if somebody
  reaches past the API
