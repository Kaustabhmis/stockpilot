# WhatsApp Campaign Automation (HTML client app + Google Sheets + Apps Script + Maytapi)

A reusable, **multi-tenant** WhatsApp marketing platform you can sell to many businesses. Each client signs in to a
**white-label, mobile-responsive web app hosted on your own domain** (`client-app/`), uploads an image and text, gets a protected WhatsApp-style preview, imports customers from Excel/CSV,
and launches or schedules campaigns. A Google Form is also supported. Validation, the campaign record,
image handling, audience selection, a throttled send queue, Maytapi delivery, webhook tracking, keyword auto-replies, opt-outs,
emails and the dashboard are all automatic. Nothing is tied to one business: every brand-specific value comes from the form,
the sheet or Script Properties.

```
Client → client-app (your domain) → POST ?route=api (session) ─┐
Client → Google Form → onFormSubmit() ─────────────────────────┴→ validate → CMP ID → image → CAMPAIGNS → queue → runScheduler() → Maytapi → WhatsApp
Customer reply / receipt → Maytapi webhook → doPost() → RESPONSES · status · auto-reply · opt-out · lead
```

- **Selling subscriptions** (pricing page, sign-up, Razorpay, automatic activation, WhatsApp QR connect): `GUIDE.md` Part 17.
- **Full guide (Parts 1–17: architecture, form, sheets, code, properties, Maytapi, triggers, deployment, webhook,
  testing, example, troubleshooting, security, checklist, client dashboard, multi-tenant):** [`GUIDE.md`](GUIDE.md)
- **Client app (static HTML for your domain):** [`client-app/`](client-app). Edit `config.js`, then upload it to any HTTPS host.
- **Backend code (multi-file):** [`src/`](src). Entry points are in `Code.gs`.
- **Code (single file):** [`dist/Code.gs`](dist/Code.gs). It's generated, so rebuild it with `node tools/build-single-file.js` after editing `src/`.
- **Tests:** `node tests/run-tests.js` runs offline end-to-end checks with mocked Apps Script services. `tests/ui-smoke.js` drives the
  dashboard in headless Chromium (optional; needs `playwright-core` and `xlsx`).

> Maytapi's documentation could not be reached from the build environment. See "Maytapi verification status" at the top
> of `GUIDE.md` for exactly what to confirm before go-live.

## Quick start
1. Google Sheet → Extensions → Apps Script → paste `src/` (or `dist/Code.gs`) and `src/appsscript.json`.
2. Reload → **WhatsApp Automation → Setup System**.
3. **Set Maytapi Credentials** → **Test Maytapi Connection**.
4. **Create Campaign Form** → add a File upload question titled **Campaign Image**.
5. Deploy → New deployment → Web app (Execute as **Me**, access **Anyone**) → put the `/exec` URL in `SETTINGS → WEBHOOK_URL`.
6. **Configure Webhook** → **Install Triggers**.
7. Host the client app: put the `/exec` URL in `client-app/config.js` (**Show Client App URLs** shows it), add your brand, then upload
   `client-app/` to your domain and set `SETTINGS → CLIENT_APP_URL`.
8. Per client: **Create Client Login**, set Plan / Monthly Quota / Valid Until (and Maytapi Phone ID for a dedicated number) in CLIENTS,
   then send them the client app URL and their access code.
