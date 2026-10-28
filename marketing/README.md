# Domebox marketing automation (Gmail)

Automated onboarding emails for domebox.in trials, sent through the Gmail API.

## What it does
- Sends a 4-step trial sequence (`src/sequences.mjs`) to contacts who opted in.
- Refuses anyone without recorded consent or who has unsubscribed (`src/contacts.mjs`).
- Adds a signed one-click unsubscribe link and `List-Unsubscribe` headers (`src/unsubscribe.mjs`).
- Caps sends per run (`GMAIL_DAILY_CAP`, default 300).
- Runs as a dry run unless both `--send` and `MARKETING_LIVE=1` are set.

## Setup
1. Create an OAuth client in Google Cloud, enable the Gmail API, and get a refresh token for the sending account.
2. Set environment variables:
   - `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_FROM`
   - `UNSUBSCRIBE_SECRET` (any long random string)
   - `APP_URL` (default `https://domebox.in`)
3. Verify SPF, DKIM, and DMARC for the sending domain. Gmail rejects or spam-flags bulk mail without them.
4. Add contacts to `data/contacts.json`. Each needs `email`, `firstName`, `signedUpAt` (ISO date), and `consent: { source, at }` with `source` set to `signup_form`, `existing_customer`, or `manual_opt_in`.

## Run
```
node marketing/src/send.mjs              # dry run, prints what would send
MARKETING_LIVE=1 node marketing/src/send.mjs --send
node --test marketing/test/marketing.test.mjs
```

## Still to build
- The `/unsubscribe` route in the Next.js app: verify the token with `verifyUnsubscribe` and set `unsubscribed: true` on the contact.
- Consent capture on the signup form, storing the source and timestamp.
- Scheduling (cron or a hosted scheduler) for the daily run.

## Limits to know
- Gmail is fine for hundreds of sends a day. For larger lists, move to a dedicated sending service.
- Gmail and Workspace cap daily sends, and the cap in this tool is set below both.
- The sequence copy is a draft and should be reviewed before going live.
- Contacts from purchased lists or scraped profiles are not eligible under this tool.
