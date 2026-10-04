# WhatsApp Campaign Automation (Google Forms + Sheets + Apps Script + Maytapi)

A reusable, multi-client WhatsApp marketing system. A client only fills in a **Google Form**. Validation, the campaign record,
image handling, audience selection, a throttled send queue, Maytapi delivery, webhook tracking, keyword auto-replies, opt-outs,
emails and the dashboard are all automatic. Nothing is tied to one business: every brand-specific value comes from the form,
the sheet or Script Properties.

```
Client → Google Form → onFormSubmit() → validate → CMP ID → image → CAMPAIGNS → queue → runScheduler() → Maytapi → WhatsApp
Customer reply / receipt → Maytapi webhook → doPost() → RESPONSES · status · auto-reply · opt-out · lead
```

- **Full guide (Parts 1–14: architecture, form, sheets, code, properties, Maytapi, triggers, deployment, webhook,
  testing, example, troubleshooting, security, checklist):** [`GUIDE.md`](GUIDE.md)
- **Code (multi-file):** [`src/`](src). Entry points are in `Code.gs`.
- **Code (single file):** [`dist/Code.gs`](dist/Code.gs). It's generated, so rebuild it with `node tools/build-single-file.js` after editing `src/`.
- **Tests:** `node tests/run-tests.js` runs offline end-to-end checks with mocked Apps Script services.

> Maytapi's documentation could not be reached from the build environment. See "Maytapi verification status" at the top
> of `GUIDE.md` for exactly what to confirm before go-live.

## Quick start
1. Google Sheet → Extensions → Apps Script → paste `src/` (or `dist/Code.gs`) and `src/appsscript.json`.
2. Reload → **WhatsApp Automation → Setup System**.
3. **Set Maytapi Credentials** → **Test Maytapi Connection**.
4. **Create Campaign Form** → add a File upload question titled **Campaign Image**.
5. Deploy → New deployment → Web app (Execute as **Me**, access **Anyone**) → put the `/exec` URL in `SETTINGS → WEBHOOK_URL`.
6. **Configure Webhook** → **Install Triggers** → import CONTACTS → **Send Test Message**.
