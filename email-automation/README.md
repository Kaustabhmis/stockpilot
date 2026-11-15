# Email Marketing Automation for SaaS (Google Apps Script)

A small, self-hosted email automation bot built on Google Sheets + Apps Script.
No server, no monthly ESP fee, and you own the data.

| Feature | How it works |
|---|---|
| Signup API | `doPost` web app receives signups from your site (`public/signup-form.html`) |
| Double opt-in | New contacts get a signed confirmation link before any marketing email |
| Drip onboarding | `Sequences` sheet: welcome, day-2 activation, day-10 trial ending, etc. |
| Broadcast campaigns | `Campaigns` sheet: draft → scheduled → sending → sent, segmented by plan |
| Unsubscribe | HMAC-signed one-click link in every email; status is updated instantly |
| Safety | Daily send cap, Gmail quota check, bounce detection, no double-sends, formula-injection guard |
| Audit trail | `Logs` sheet records every signup, send, bounce, confirm and unsubscribe |
| Dashboard | Sidebar in the sheet: subscriber counts, sends left today, campaign status, run now |
| Templates | Responsive HTML emails in `templates/` with a shared `base.html` layout |

## Folder layout

```
email-automation/
├── Code.gs              # all server logic
├── Dashboard.html       # sidebar UI inside the Google Sheet
├── appsscript.json      # manifest: timezone, scopes, web app settings
├── templates/
│   ├── base.html        # layout: header, footer, unsubscribe link (shared)
│   ├── welcome.html
│   ├── activation.html
│   ├── trial-ending.html
│   ├── double-opt-in.html
│   └── newsletter.html  # used by campaigns
└── public/
    └── signup-form.html # embed on your marketing site / landing page
```

## Setup (about 10 minutes)

1. **Create the sheet.** Go to [sheets.new](https://sheets.new) and name it e.g. *SaaS Email Bot*.
2. **Add the script.** Extensions → Apps Script. Delete the default `Code.gs` content.
   Create files with the same names as in this folder and paste the contents:
   - `Code.gs`, `appsscript.json` (enable *Show manifest file* in Project Settings first), `Dashboard.html`
   - Each file in `templates/` as an HTML file named e.g. `templates/welcome` (Apps Script keeps the folder in the name).
   - Or use [clasp](https://github.com/google/clasp): `cd email-automation && clasp create --type sheets --title "SaaS Email Bot"`, then `clasp push` (you must `clasp create` from a bound script; see clasp docs for Sheets-bound projects).
3. **Reload the sheet.** A menu **Email Automation** appears (it may take a few seconds). Choose **Set up workbook** and authorize the script.
4. **Edit `Settings`.** Set `COMPANY_NAME`, `COMPANY_ADDRESS` (a real postal address is legally required in most marketing emails), `FROM_NAME`, `REPLY_TO`, `PRODUCT_URL`, and `DAILY_SEND_CAP`.
5. **Deploy the web app.** Deploy → New deployment → type *Web app*, Execute as *Me*, Who has access *Anyone*. Copy the URL ending in `/exec`.
6. **Paste the URL into `Settings` → `WEBAPP_URL`.** Without it, links fall back to the deployment URL, which can change between deployments.
7. **Install the schedule.** Email Automation → **Install hourly trigger**. This runs the drip and campaigns every hour.
8. **Test it.** Email Automation → **Send test welcome to me**. Then check the inbox and the `Logs` sheet.
9. **Wire up the signup form.** In `public/signup-form.html`, set `WEBAPP_URL` and the `api_key` hidden field to the `SIGNUP_API_KEY` value from `Settings`. Embed the page, or port the form into your SaaS frontend. Your Next.js app could call the same endpoint.

## Signup API

`POST <WEBAPP_URL>` with JSON (or form-encoded) body:

```json
{
  "email": "jane@acme.io",
  "first_name": "Jane",
  "company": "Acme",
  "plan": "pro",
  "source": "pricing-page",
  "api_key": "SIGNUP_API_KEY from Settings"
}
```

Response: `{"ok": true, "status": "subscribed"}`. The response is the same for new and existing emails, so it does not reveal who is already a subscriber.

From your Next.js backend (recommended, keeps the key off the browser):

```ts
await fetch(process.env.EMAIL_BOT_URL!, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, first_name, company, plan, source: 'signup', api_key: process.env.EMAIL_BOT_KEY }),
});
```

Honeypot: include a hidden `website` field. Bots that fill it in are silently accepted and dropped.

## Sheet reference

**Subscribers** (`status`: `pending` | `active` | `unsubscribed` | `bounced`)
`email, first_name, company, plan, status, source, signup_at, drip_step, last_sent_at`
You can import existing users here. Set `status` to `active` and `signup_at` to their original signup date, and the drip will continue from `drip_step` (0 = start).

**Sequences** (drip flow, `active` must be TRUE)
`step, delay_days, subject, template, active`
`delay_days` is counted from `signup_at`. Subjects and bodies accept `{{first_name}}`, `{{company}}` and `{{plan}}`. To add a sequence step, add a row and create `templates/<template>.html`. Disable a step by setting `active` to FALSE.

**Campaigns** (one-off broadcasts)
`name, subject, template, headline, body_html, segment_plan, status, scheduled_at, sent_at, sent_count`
1. Write `body_html`, which is inserted into `templates/newsletter.html`.
2. Set `segment_plan` to `all`, `free`, `pro`, and so on.
3. Set `status` to `scheduled`. Leave `scheduled_at` blank to send on the next hourly run, or set a date.
4. The bot sends in batches within the daily cap. Anyone already logged for that campaign is skipped, so re-runs are safe. When it finishes, `status` becomes `sent`.

**Settings**: `DAILY_SEND_CAP` is a soft cap. `DOUBLE_OPT_IN` is `yes` or `no`. `UNSUBSCRIBE_SECRET` signs links; rotating it invalidates existing unsubscribe links, so don't change it casually.

## Limits and things to know

- **Quotas.** Gmail allows about 100 recipients per day for consumer accounts and about 1,500 per day on Google Workspace. The bot checks `MailApp.getRemainingDailyQuota()` before sending. Apps Script also has a runtime limit of about 6 minutes per run. Batches resume on the next run.
- **Deliverability.** Send from a Workspace account on a domain with SPF, DKIM and DMARC set up. Warm up slowly. Consider a dedicated sending subdomain.
- **Scale.** This is ideal for early-stage SaaS, roughly up to a few thousand subscribers. Above that, move sending to an ESP (Postmark, Resend, SendGrid, Amazon SES). The sheet logic can stay the same, and you only swap the `MailApp.sendEmail` call in `sendEmail_`.
- **Compliance.** Each email has an unsubscribe link and your postal address. Double opt-in is on by default, which helps with GDPR and CAN-SPAM. Keep a record of consent (the `Logs` sheet has signup and confirm events). Honor unsubscribes right away; they are processed on the link click.
- **Apps Script's `getUrl()`**. The unsubscribe link needs the web app URL. Set `WEBAPP_URL` explicitly, as in step 6.
- **Logs growth.** The `Logs` sheet grows with every send. Archive or delete old rows once it gets large (over about 100k rows). The daily-cap check scans it on each run.
- **Sign-up key.** `api_key` in a public form is visible in page source, so it only deters casual abuse. Rate limiting or a CAPTCHA belongs in front of the endpoint if you see spam.
- **Test first.** Use a test sheet and a few of your own addresses before enabling campaigns.

## Customizing

- New email: copy `templates/welcome.html`, edit the content, and point a row in `Sequences` at it.
- Brand colors and layout: edit `templates/base.html` (inline styles are kept for email client compatibility).
- Run more often: change `everyHours(1)` in `installTriggers()` to `everyMinutes(15)`. Hourly is fine for onboarding and cheaper on quota.
- Plan-based automation: add rows in `Sequences` per plan by extending the `Subscribers.plan` filter in `runDrip_`.
