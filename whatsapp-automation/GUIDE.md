# WhatsApp Campaign Automation: Implementation Guide

A generic, **multi-tenant** WhatsApp marketing platform built on Google Sheets (the database), Apps Script (V8),
Google Drive and the Maytapi WhatsApp API. No external server, no npm, no Node.js at runtime.

Clients can work in two ways:
- **Client dashboard** (recommended): a mobile-responsive web app served by the same Apps Script deployment. Each client signs in
  with their email and an access code. They upload an image and text, the system builds the ad, they see a protected
  WhatsApp-style preview, upload customers from Excel/CSV, pick lists and a time, and launch. See **Part 15**.
- **Google Form**: the original submission form, still supported.

You sell the service to many businesses (tenants) from one deployment. Each tenant has its own login, customers, campaigns,
plan limits and, optionally, its own WhatsApp number. See **Part 16**.

> **No business is hard-coded.** Brand, message, image, website, store phone, CTA, schedule and audience are all read
> from the Google Form, the Google Sheet or Script Properties. The reference creative shown during design
> (image → personalised text → "Explore Collection" button) is only the *shape* of the message the system produces.

---

## Maytapi verification status (read first)

The official documentation (https://maytapi.com/documentation) **could not be opened from the build environment**:
its network policy blocks maytapi.com. The integration follows Maytapi's published API contract (endpoints, `x-maytapi-key`
header, `sendMessage` text and media payloads, `listPhones`, `status`, `setWebhook`, and the `message` and `ack` webhook events). It was
**not checked live**. The table below shows exactly what is assumed and where it lives in the code.

| Item | Implementation | Confidence | Code location |
|---|---|---|---|
| Base URL | `https://api.maytapi.com/api/{product_id}` | Long-standing | `MAYTAPI_BASE_URL` |
| Auth | `x-maytapi-key: <token>` header, `Content-Type: application/json` | Long-standing | `maytapiRequest()` |
| Send endpoint | `POST /{phone_id}/sendMessage` | Long-standing | `phonePath_()` |
| Text | `{"to_number":"919876543210","type":"text","message":"…"}` | Long-standing | `sendMaytapiText()` |
| Media | `{"to_number":"…","type":"media","message":"<https URL or data:<mime>;base64,…>","text":"<caption>","filename":"…"}` | Long-standing | `sendMaytapiMedia()` |
| Buttons | `{"type":"buttons","message":"…","buttons":[{"id","text"} / {"text","url"} / {"text","phoneNumber"}]}` | **Verify**: Maytapi marks buttons as BETA | `buildButtonsPayload_()` (single place) |
| Send response | `{"success":true,"data":{"chatId":"…","msgId":"…"}}`; error `{"success":false,"message":"…"}` | Long-standing | `maytapiRequest()` |
| Connection | `GET /listPhones`, `GET /{phone_id}/status` | Long-standing | `testMaytapiConnection()` |
| Webhook registration | `POST /setWebhook {"webhook":"<url>"}` | Long-standing | `maytapiSetWebhook()` |
| Webhook events | `type:"message"` (`message`, `user`, `conversation`); `type:"ack"` (`data[].msgId`, `ackType` sent/delivered/read, `ackCode`); `status`; `error` | Verify field names | `Webhook.gs` (defensive parsing; raw payload always stored) |
| List messages | **Not implemented**: schema not verified | n/a | `sendMaytapiList()` returns an error |
| Carousel | **Not implemented**: support not verified | n/a | `sendMaytapiCarousel()` returns an error |
| Webhook security | Maytapi does not sign webhooks. Apps Script can't read headers, so a secret `?key=` is added to the URL | n/a | `doPost()` |

Safety nets in case the button schema differs: a rejected button payload is resent automatically as a text CTA
(`CTA_FALLBACK_TO_TEXT=YES`, logged as `BUTTON_FALLBACK`). The raw webhook JSON is always stored in `RESPONSES`, so
the field mapping can be checked against real traffic. **Before go-live, compare this table with the live docs and run
Send Test Message (Part 10).**

---

## PART 1: Architecture

```
CLIENT ─► Google Form ─► FORM_RESPONSES ─► onFormSubmit(e)  [installable trigger]
                                              │ validateCampaignInput_()  (fields, URL, phones, CTA, date/time, audience)
                                              │ processCampaignImage()    (Drive file ID, type, size)
                                              │ findOrCreateClient_()     CLI-YYYY-0001
                                              │ CAMPAIGNS row             CMP-YYYY-0001
                                              ├─ Send Now ─► startCampaign() ─► buildCampaignQueue()  QUE-YYYY-000001
                                              └─ Schedule ─► SCHEDULED ─► activateScheduledCampaigns()
runScheduler()  [every N min, LockService] ─► processMessageQueue() ─► sendCampaignMessage_() ─► Maytapi ─► WhatsApp ─► CUSTOMER
CUSTOMER reply / button / receipt ─► Maytapi webhook ─► doPost(e) ─► RESPONSES + ack status + auto-reply + opt-out + lead
```

**Client dashboard path:** `doGet()` → `ClientApp.html` → `google.script.run` → `api*` functions (`ClientApi.gs`, session-checked)
→ the same `createCampaignFromInput_()` → queue → Maytapi pipeline as the form.

**Design principles**
- **Generic**: every business value comes from the form. Code holds only structure and rules.
- **Multi-client**: every client, campaign, contact and queue row carries a `Client ID`. A campaign only ever queues
  contacts whose `Client ID` equals the campaign's (`isContactEligible_`).
- **Two phone concepts**: `MAYTAPI_PHONE_ID` (Script Property) is the platform-owned sending number.
  The *Store / Business Phone* (form) is the client's public number, used only in `{{StorePhone}}`, PHONE CTAs and replies.
- **Layered**: Maytapi payloads (`Maytapi.gs`) → message composition (`Messaging.gs`) → queue (`Queue.gs`) → campaigns (`Campaigns.gs`).
  Media hosting is isolated in `Media.gs`. Audience rules are isolated in `AUDIENCE_RESOLVERS`.
- **Safe sending**: batches, randomised delays, a daily cap, LockService, retries with backoff, opt-out re-checked before every send.

**Extensibility hooks** (not implemented, by design): multiple sending numbers (pass a `cfg` with a different `phoneId`, since
every API function already accepts `cfg`), new media hosts (`resolveMedia_`), new audience rules (`AUDIENCE_RESOLVERS`),
AI replies or CRM sync (add a step in `handleIncomingMessage_`), follow-ups and reminders (new queue producers reusing `sendCampaignMessage_`).

---

## PART 2: Google Form fields

Create it automatically with menu **WhatsApp Automation → Create Campaign Form** (`createCampaignForm()`), then add the
image question by hand (Apps Script's FormApp **cannot create File Upload questions**).

| # | Question title (exact text the parser expects) | Type | Required | Notes |
|---|---|---|---|---|
| 1 | Client / Business Name | Short answer | Yes | |
| 2 | Campaign Name | Short answer | Yes | Used for duplicate detection |
| 3 | Campaign Message | Paragraph | Yes | Variables: `{{Name}} {{Phone}} {{Email}} {{Company}} {{ClientName}} {{CampaignName}} {{StorePhone}} {{Website}}` |
| 4 | Campaign Image | **File upload** (add manually): images only, 1 file, 10 MB | Recommended | JPG or PNG ≤ 5 MB accepted. Blank means a text-only campaign |
| 5 | Website / Landing Page URL | Short answer + URL validation | No | |
| 6 | Store / Business Phone Number | Short answer | Yes | Client's public number. Never the sender |
| 7 | CTA Button Text | Short answer | No | ≤ 20 characters (WhatsApp button limit) |
| 8 | CTA Button Type | Multiple choice: URL, PHONE, QUICK_REPLY, NONE | Yes | |
| 9 | CTA Button Value | Short answer | No | URL: blank uses the Website. PHONE: blank uses the Store Phone. QUICK_REPLY: keyword |
| 10 | Target Audience | Checkboxes (from `AUDIENCE_OPTIONS`) + Other | Yes | e.g. `ALL_OPTED_IN`, `VIP`, `TAG:KOLKATA` |
| 11 | Campaign Date | Date | When Schedule | |
| 12 | Campaign Time | Time | When Schedule | Interpreted in `TIMEZONE` |
| 13 | Client Email | Short answer + email validation | Yes | Receives the confirmation |
| 14 | Additional Notes | Paragraph | No | |
| 15 | Send Mode | Multiple choice: Send Now, Schedule | Yes | |

Google Forms requires respondents to **sign in with a Google account** to upload files. Uploaded files go to the
form owner's Drive (folder "WhatsApp Campaign Request (File responses)") and stay private.

The client never sees or enters Maytapi IDs, tokens, webhook secrets or any Apps Script setting.

---

## PART 3: Google Sheet structure

`setupSystem()` creates missing sheets and columns. It **never clears or overwrites data**. Phone, ID and schedule columns are set to
plain text so Sheets doesn't convert them to numbers or dates.

| Sheet | Columns |
|---|---|
| **SETTINGS** | Key, Value, Description |
| **FORM_RESPONSES** | Created by the form link (columns = question titles) |
| **CLIENTS** (tenants) | Client ID, Business Name, Client Email, Business Phone, Website, Status (Active / Suspended / Inactive), Created At, Updated At, Access Code Hash, Last Login, Plan, Maytapi Phone ID, Monthly Quota, Valid Until |
| **CONTACTS** | Contact ID, Client ID, Name, Phone, Email, Company, Tags, Audience, Opt In, Status, Last Sent, Last Message ID, Last Response, Created At, Updated At, Source |
| **CAMPAIGNS** | Campaign ID, Client ID, Client Name, Campaign Name, Status, Message, Image File ID, Image URL, Website URL, Store Phone, CTA Text, CTA Type, CTA Value, Target Audience, Send Mode, Schedule Date, Schedule Time, Timezone, Created At, Updated At, Submitted By, Notes |
| **MESSAGE_QUEUE** | Queue ID, Campaign ID, Client ID, Contact ID, Phone, Name, Rendered Message, Image File ID, Image URL, CTA Type, CTA Text, CTA Value, Status, Attempts, Scheduled At, Started At, Sent At, Message ID, Error, Last Attempt, Created At, Sender Phone ID |
| **LOGS** | Timestamp, Level, Action, Client ID, Campaign ID, Contact ID, Phone (masked), Message ID, HTTP Status, Result, Error, Details |
| **RESPONSES** | Timestamp, Client ID, Campaign ID, Phone, Name, Message ID, Message Type, Message Text, Event Type, Status, Raw Payload, Processed |
| **TEMPLATES** | Template ID, Template Name, Trigger, Reply Type, Reply Text, Image URL, Button Text, Button Type, Button Value, Active, Client ID (blank = shared by all tenants) |
| **DASHBOARD** | Generated: KPIs + per-campaign table |

**Statuses**
- Campaign: `DRAFT, VALIDATING, READY, SCHEDULED, ACTIVE, PAUSED, COMPLETED, CANCELLED, ERROR`
- Queue: `PENDING, PROCESSING, QUEUED (waiting for a retry), SENT, DELIVERED, READ, FAILED, SKIPPED, CANCELLED`

**SETTINGS keys** (seeded with defaults): `DEFAULT_COUNTRY_CODE=91`, `TIMEZONE=Asia/Kolkata`, `BATCH_SIZE=10`,
`DELAY_MIN_MS=3000`, `DELAY_MAX_MS=7000`, `DAILY_SEND_LIMIT=100`, `MAX_RETRIES=3`, `RETRY_BASE_MINUTES=5`,
`QUEUE_INTERVAL_MINUTES=5`, `WEBHOOK_URL`, `MEDIA_MODE=BASE64`, `IMAGE_CTA_STYLE=IMAGE_THEN_BUTTONS`,
`CTA_FALLBACK_TO_TEXT=YES`, `MAX_IMAGE_MB=5`, `CTA_TEXT_MAX_LENGTH=20`, `DEFAULT_CONTACT_NAME=Customer`,
`REQUIRE_ADMIN_APPROVAL=NO`, `NOTIFY_ADMIN=YES`, `AUTO_REPLY_ENABLED=YES`, `OPT_OUT_KEYWORDS=STOP,UNSUBSCRIBE,REMOVE,NO`,
`OPT_OUT_REPLY`, `CREATE_INBOUND_CONTACTS=YES`, `AUDIENCE_OPTIONS`, `SYSTEM_NAME`. **No credentials are stored here.**

**CONTACTS rules**: a contact is messaged only if its `Client ID` matches the campaign, `Opt In = YES` and `Status = Active`.
`Tags` and `Audience` accept comma-separated values. Phones can be in any of these formats: `9876543210`, `+919876543210`, `919876543210`.

**Audience syntax**: `ALL_OPTED_IN` / `ALL`. A plain token such as `VIP`, `LEADS`, `CUSTOMERS` or `KOLKATA` matches the Audience column **or** Tags.
`TAG:<tag>` and `AUDIENCE:<value>` are also accepted. Several tokens separated by commas mean "any of these".

---

## PART 4: Complete Apps Script code

Two equivalent layouts are provided:

**A. Multi-file (recommended)**: `whatsapp-automation/src/`

| File | Contents |
|---|---|
| `appsscript.json` | Manifest: V8, OAuth scopes, web app (execute as owner, anyone access) |
| `Code.gs` | `onOpen()` menu, `setupSystem()`, menu action wrappers |
| `Security.gs` | `requireAdmin_()` guard, access codes (salted SHA-256), client logins, sessions, `createClientLogin()`, `resetClientAccessCode()` |
| `Public.gs` | Admin-only public wrappers with the spec names (`getConfig()`, `startCampaign()`, `sendMaytapiText()`…) |
| `Tenants.gs` | Per-tenant sending number, plan, monthly quota, expiry and entitlement checks |
| `ClientApi.gs` | Dashboard server API: login, bootstrap, Excel/CSV contact import, campaign create/cancel, preview image |
| `ClientApp.html` | The client dashboard (single page, mobile-first, no build step) |
| `Constants.gs` | Sheet names, headers, statuses, form question titles, variables |
| `Config.gs` | `getConfig()`, `validateConfig()`, `setMaytapiCredentials()`, `redactSecrets_()` |
| `Utils.gs` | Sheet I/O, locked appends, ID generator, `normalizePhoneNumber()`, `renderTemplate()`, date parsing, `logEvent_()` |
| `Maytapi.gs` | `maytapiRequest()`, `sendMaytapiText()`, `sendMaytapiMedia()`, `sendMaytapiButtons()`, `sendMaytapiList()`*, `sendMaytapiCarousel()`*, `testMaytapiConnection()`, `maytapiSetWebhook()` |
| `Media.gs` | `processCampaignImage()`, `resolveMedia_()` (BASE64 or URL hosting) |
| `Messaging.gs` | `sendCampaignMessage_()`: image/text/CTA composition, button fallback, CTA validation |
| `Forms.gs` | `onFormSubmit(e)`, `createCampaignFromInput_()`, `readFormInput_()`, `createCampaignForm()`, `reprocessFormResponse()` |
| `Campaigns.gs` | Validation, audience engine, clients, start/pause/resume/cancel, `activateScheduledCampaigns()`, `sendTestMessage()` |
| `Queue.gs` | `buildCampaignQueue()`, `processMessageQueue()`, `retryFailedMessages()`, `runScheduler()` |
| `Webhook.gs` | `doGet()`, `doPost()`, ack handling, auto-reply engine, opt-out, leads, `getWebhookUrl()`, `configureWebhook()` |
| `Triggers.gs` | `installTriggers()`, `removeTriggers()`, `listTriggers()` |
| `Email.gs` | Client confirmation and attention emails, admin notifications |
| `Dashboard.gs` | `refreshDashboard()`, `viewDashboard()` |

\* return a "not verified" error by design (see the verification table).

**B. Single file**: `whatsapp-automation/dist/Code.gs`, generated from `src/` by `node tools/build-single-file.js`.
Paste it into one Apps Script file and use `src/appsscript.json` as the manifest. The dashboard HTML is embedded in it
(`CLIENT_APP_HTML_`), so no separate HTML file is needed. The test suite fails if the bundle is out of date.

**Installing the code**
1. Create a Google Sheet → *Extensions → Apps Script*.
2. *Project Settings* → tick **Show "appsscript.json" manifest file in editor** → replace its contents with `src/appsscript.json`.
3. Create one script file per `.gs` file in `src/` with the same name and paste the contents, then *+ → HTML* named `ClientApp`
   with the contents of `src/ClientApp.html`. Or paste `dist/Code.gs` alone into `Code.gs`.
   With clasp: `clasp create --type sheets --rootDir src` then `clasp push`.
4. Save, reload the spreadsheet, and the **WhatsApp Automation** menu appears.

---

## PART 5: Script Properties

*Apps Script → Project Settings → Script Properties*, or menu **Set Maytapi Credentials** (prompts that write directly to
Script Properties and never to the sheet).

| Property | Required | Purpose |
|---|---|---|
| `MAYTAPI_PRODUCT_ID` | Yes | Maytapi product ID (console → API settings) |
| `MAYTAPI_PHONE_ID` | Yes | ID of the **platform sending number** inside the product |
| `MAYTAPI_API_TOKEN` | Yes | API token, sent only as the `x-maytapi-key` header |
| `WEBHOOK_SECRET` | Recommended | Random string appended to the webhook URL as `?key=`. Auto-generated by **Configure Webhook** if missing |
| `ADMIN_EMAIL` | Optional | Receives submission notices, auth-failure alerts and Maytapi error events |
| `DEFAULT_COUNTRY_CODE` | Optional | Overrides the SETTINGS value (digits, no `+`) |
| `TIMEZONE` | Optional | Overrides the SETTINGS value (IANA, e.g. `Asia/Kolkata`) |
| `MEDIA_BASE_URL` | Optional | Public HTTPS base for `MEDIA_MODE=URL` (e.g. a CDN folder) |

`validateConfig()` reports missing or invalid values without printing secrets. It also warns if a TOKEN or SECRET-like key is ever put in SETTINGS.

---

## PART 6: Maytapi setup

1. Create a Maytapi account and a **product** in the Maytapi console.
2. Add a **phone** to the product and link the platform's WhatsApp number by scanning the QR code from WhatsApp on that phone
   (*Linked devices*). Keep that phone online and charged.
3. From the console's API or settings page, copy the **Product ID**, **Phone ID** and **API Token**, and enter them via **Set Maytapi Credentials**.
4. Run **Test Maytapi Connection**. It calls `GET /listPhones` (credentials valid, phone ID belongs to the product) and
   `GET /{phone_id}/status` (phone connected).
5. Send yourself a test (Part 10) before any campaign.

The sending number is chosen **only** by `MAYTAPI_PHONE_ID`. A client's Store Phone never changes it.

### Images and Maytapi (`MEDIA_MODE`)
- **`BASE64` (default)**: `resolveMedia_()` reads the Drive file and sends `data:image/jpeg;base64,…` as the media `message`.
  The client's file **stays private** and no hosting is required.
- **`URL`**: Maytapi downloads the image from a **public HTTPS URL** taken from the campaign's `Image URL` column (CDN, S3,
  Cloudinary or website) or built as `MEDIA_BASE_URL/<file name>`. Use this if base64 media is ever rejected.
- Google Drive "share" or `uc?export` links are **not** used. They aren't a documented media host, can return HTML pages
  instead of image bytes, and would require making client files public. To add a host, add one branch in `resolveMedia_()`.

### Message shape (`IMAGE_CTA_STYLE`)
- `IMAGE_THEN_BUTTONS` (default): the client's image, then the personalised message with a real interactive button. This matches the reference creative.
- `CAPTION_LINK`: a single image whose caption ends with `👉 Explore Collection: https://…`.
- Image + Text (no CTA) and Text only are always supported.

---

## PART 7: Google Form trigger setup

1. Menu **Setup System** → approve the OAuth scopes.
2. Menu **Create Campaign Form**: creates the form, links it to this spreadsheet and renames the response tab to `FORM_RESPONSES`.
   *If you already have a form*: Form → Responses → Link to Sheets → this spreadsheet, rename the new tab to `FORM_RESPONSES`,
   and make sure the question titles match Part 2.
3. Open the form's edit link and add **File upload** → title **`Campaign Image`** → allow only *Image* → max 1 file.
4. Menu **Install Triggers** creates (only if missing):
   - `onFormSubmit`: installable *From spreadsheet → On form submit*
   - `runScheduler`: time-driven, every `QUEUE_INTERVAL_MINUTES` (activates schedules, then sends a batch)
   - `refreshDashboard`: time-driven, every 30 minutes
5. Check with **List Triggers**. **Remove Triggers** stops all automation.

Triggers run as the installing account. Install them from the account that owns the sheet, the form uploads and the Maytapi setup.

---

## PART 8: Apps Script Web App deployment

1. Apps Script editor → **Deploy → New deployment** → gear icon → **Web app**.
2. **Description**: `WhatsApp webhook v1`.
3. **Execute as: Me** (the script needs your Sheets, Drive and Mail access).
4. **Who has access: Anyone**. Maytapi's servers call the URL without a Google login, and your clients open the dashboard
   without one, so "Anyone with Google account" or "Only myself" would block both. The webhook is protected by its secret `?key=`,
   the dashboard by client access codes, and every admin function by `requireAdmin_()`.
5. **Deploy** → authorise → copy the **Web app URL** ending in `/exec`.
6. Paste that URL (without `?key=`) into `SETTINGS → WEBHOOK_URL`. If it's left blank, `getWebhookUrl()` falls back to
   `ScriptApp.getService().getUrl()`, which may return the `/dev` URL when run from the editor. Maytapi can't use `/dev`.
7. Check: open `<exec URL>?health=1`. It returns `{"status":"ok","service":"whatsapp-campaign-automation","configured":true,…}`.
   Open `<exec URL>` itself to see the client dashboard sign-in page. That plain URL is the one you give clients.

**Updating code later**: *Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy*. This keeps the same
`/exec` URL, so the Maytapi webhook doesn't need changing. "New deployment" would create a new URL.

---

## PART 9: Maytapi webhook configuration

**Option A (recommended): menu Configure Webhook** (`configureWebhook()`):
1. Generates `WEBHOOK_SECRET` if missing.
2. Builds `https://script.google.com/macros/s/<id>/exec?key=<WEBHOOK_SECRET>`.
3. Refuses `/dev` URLs.
4. Calls Maytapi `POST /api/{product_id}/setWebhook` with `{"webhook":"<url>"}`.
5. Shows the result, with the key masked.

**Option B: Maytapi console**: paste the same full URL, including `?key=…`, into the webhook URL field of your product
settings. To get the URL, run `getWebhookUrl()` in the editor and read it in the execution log. Don't share it.

**What arrives** (handled by `doPost`):
- `type: "message"` (incoming text or button replies) → `RESPONSES`, contact `Last Response`, opt-out check, keyword auto-reply, lead creation.
  Messages with `fromMe` and group chats (`@g.us`) are ignored. Redelivered message IDs are processed once (6-hour cache).
- `type: "ack"` → `data[].msgId` is matched against `MESSAGE_QUEUE → Message ID` and moves the status up to SENT, DELIVERED or READ
  (never down). A failed ack sets FAILED.
- `type: "status"` and `"error"` → logged. Error events email the admin.
- Events for other phone IDs on the same product are ignored.

Apps Script always answers HTTP 200. Rejections (bad key, bad JSON) are reported in the JSON body and in LOGS.

---

## PART 10: Testing procedure

**Browser (optional)**: `NODE_PATH=<dir with playwright-core + xlsx>/node_modules node whatsapp-automation/tests/ui-smoke.js` drives the real dashboard
in headless Chromium at phone, tablet and desktop sizes: sign-in, CSV and XLSX upload, ad builder, protected preview, scheduling, launch,
preview and cancel. It fails on any console error or horizontal scrolling.

**Offline (no network)**: `node whatsapp-automation/tests/run-tests.js` runs 45 end-to-end checks, including the admin guard, client logins,
the dashboard API, cross-tenant isolation, per-tenant numbers, quotas, expiry and tenant-scoped webhooks, with mocked Apps Script services
(phone normalisation, setup idempotency, validation emails, client isolation, dedupe, payloads, fallback, retries and auth stop,
acks, auto-reply, redelivery, opt-out, leads, scheduling, lifecycle, dashboard, the Part 11 example, and that the bundle is current).

**Live, step by step**
1. **Test Maytapi Connection** shows "Product reachable", the phone was found, and the phone status is connected.
2. In CONTACTS, add yourself: your `Client ID` (create the client by submitting the form once), your number, `Opt In = YES`, `Status = Active`.
3. Submit the form as a client with **Schedule** set 15 minutes ahead. You should receive the confirmation email, and CAMPAIGNS shows `SCHEDULED`.
4. Select that campaign row → **Send Test Message** → your number. Exactly one message (image + button) arrives, personalised as "TEST CUSTOMER".
   The queue and audience are untouched. If LOGS shows `BUTTON_FALLBACK`, the button schema needs adjusting in `buildButtonsPayload_()`.
5. Wait for the schedule, or select the row → **Start Campaign** → **Process Queue Now**. The queue row goes to `SENT`, then `DELIVERED` and `READ`
   (once **Configure Webhook** is done).
6. Reply `offer`. The template reply arrives and RESPONSES shows `YES: replied with TPL-…`.
7. Reply `STOP`. You get the confirmation, your contact shows `Opt In = NO`, and a new campaign to that audience no longer queues you.
8. Submit an invalid form (e.g. a PDF as the image, or a past date). You should receive the "Requires Attention" email listing each problem.
9. Check **View Dashboard**.

---

## PART 11: Example campaign

**Client submits:**

| Field | Value |
|---|---|
| Business Name | ABC Jewellery |
| Campaign Name | Festival Gold Offer |
| Campaign Message | `Hi {{Name}},`⏎⏎`Discover our latest jewellery collection ✨`⏎⏎`Enjoy special offers for a limited time.`⏎⏎`Store:`⏎`{{StorePhone}}` |
| Campaign Image | (uploaded JPG) |
| Website | https://example.com |
| Store Phone | 98300XXXXXX |
| CTA Text / Type / Value | Explore Collection / URL / https://example.com/collection |
| Audience | ALL_OPTED_IN |
| Send Mode / Date / Time | Schedule / 2026-10-10 / 19:00 |

**System does:**
1. Validates everything and checks the image (Drive ID saved, JPG ≤ 5 MB).
2. Finds or creates the client `CLI-2026-000N` and creates `CMP-2026-000N` with status `SCHEDULED` (Timezone `Asia/Kolkata`).
3. Emails "Campaign Submitted – Festival Gold Offer" to the client and a summary to the admin.
4. At 2026-10-10 19:00 IST, `runScheduler` → `activateScheduledCampaigns()` → `buildCampaignQueue()` creates one `QUE-2026-…` row per opted-in,
   active contact **of ABC Jewellery only**, each with a personalised `Rendered Message`. Status becomes `ACTIVE`.
5. Each run sends up to `BATCH_SIZE` with 3–7 s gaps. Rahul receives:
   - the client's image
   - then:
     ```
     Hi Rahul,

     Discover our latest jewellery collection ✨

     Enjoy special offers for a limited time.

     Store:
     +9198300XXXXXX
                     [ Explore Collection ]  → https://example.com/collection
     ```
6. Acks update rows to DELIVERED and READ. When nothing is left to send, the campaign becomes `COMPLETED`.

The same form works unchanged for XYZ Realty (property image, "Book Site Visit" URL CTA), DEF Electronics ("Call Store" PHONE CTA),
or a restaurant ("View Menu" QUICK_REPLY with value `menu` plus a TEMPLATES row triggered by `menu`).

---

## PART 12: Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Menu missing | Reload the sheet, and check the `onOpen` code saved without errors. |
| Form submits but nothing happens | `onFormSubmit` trigger missing → **Install Triggers**. Check *Apps Script → Executions* and LOGS `FORM_SUBMIT_FAILED`. Question titles must match Part 2. |
| "Campaign image could not be opened" | The upload went to another account's Drive, or was deleted. Triggers must run as the form owner. |
| Campaign `ERROR`: "No eligible contacts" | Contacts need the campaign's `Client ID`, `Opt In = YES`, `Status = Active` and a matching audience. Fix them, then **Start Campaign**. |
| Queue rows stay `PENDING` | Campaign isn't `ACTIVE` (paused or scheduled), the `runScheduler` trigger is missing, or the daily limit was reached (see `DAILY_SEND_LIMIT`). |
| `QUEUE_BATCH_STOPPED` + auth error | Wrong token, product or phone ID → **Set Maytapi Credentials** → **Test Maytapi Connection**. |
| Errors mentioning "not connected" or QR | The sending phone is offline or logged out. Reconnect it in the Maytapi console. Items retry automatically. |
| `BUTTON_FALLBACK` in LOGS | Maytapi rejected the button JSON. Customers got a text link instead. Check the live docs and edit `buildButtonsPayload_()`. |
| Image rejected by Maytapi | Switch `MEDIA_MODE` to `URL` and put a public HTTPS link in the campaign's `Image URL` column (or set `MEDIA_BASE_URL`). |
| No DELIVERED or READ updates | Webhook not registered, a `/dev` URL was used, access isn't "Anyone", or the code changed without "New version". Check RESPONSES for incoming rows and LOGS for `WEBHOOK_REJECTED`. |
| Duplicate auto-replies | Fixed by message-ID dedupe. If it persists, the provider is sending different IDs, so inspect Raw Payload. |
| Rows `FAILED` with "INTERRUPTED" | An execution died mid-send, so delivery is unknown. Check with the customer if needed, then **Retry Failed Messages**. |
| "Exceeded maximum execution time" | Lower `BATCH_SIZE` or the delays. Runs already stop at 4.5 min. |
| Schedule fires at the wrong hour | Check `TIMEZONE` (SETTINGS or Script Property) and the spreadsheet's *File → Settings → Time zone*. |
| Phone numbers look like `9.19E+11` | Run **Setup System** again (it sets the columns to plain text). Normalisation already handles this. |

---

## PART 13: Security considerations

- **Admin guard**: a page served by HtmlService can call any public server function through `google.script.run`, and the Web App
  runs as you. So every implementation is private (ends in `_`), and every public admin function starts with `requireAdmin_()`.
  That check passes only when the person running the code is the account it runs as (sheet menu or editor). Anonymous dashboard
  visitors are refused. `getConfig()` masks the token even for admins. `onFormSubmit` only accepts genuine trigger events.
- **Client logins**: access codes are random (~50 bits), stored only as salted SHA-256 hashes, and compared in constant time.
  Five failed attempts lock that email for 15 minutes. Sessions are random 256-bit tokens in CacheService with a 6-hour sliding
  expiry, and they end immediately when the code is reset or the tenant is suspended. Business name and email always come from
  the CLIENTS row, never from the browser.
- **Preview protection**: the preview is drawn on a canvas, with no image URL or element to save, and a tiled
  `PREVIEW · <business>` watermark is baked into its pixels. Selection, right-click, drag, long-press, Ctrl/Cmd+S and printing are blocked,
  and the preview blurs when the window loses focus or PrintScreen/Cmd+Shift is pressed. **No website can block operating-system screenshots or
  a phone camera.** The watermark is what makes a captured preview identifiable and unusable as the final creative.
- **Credentials** live only in Script Properties. They're never written to sheets, LOGS, RESPONSES, emails or `doGet` output, and
  `redactSecrets_()` scrubs logged text and raw payloads. The token is only sent as the `x-maytapi-key` header over HTTPS.
- **Webhook**: Maytapi doesn't sign webhooks, and Apps Script can't read request headers, so authentication is the
  secret `?key=` (≥ 64 random characters) compared on every call. Invalid calls are logged and ignored. Rotate it by deleting
  `WEBHOOK_SECRET` and running **Configure Webhook** again.
- **Drive privacy**: uploaded creatives stay private (BASE64 mode). Nothing is shared publicly by the script.
- **Data minimisation**: LOGS mask phones (`91******3210`). Client-facing emails contain only that client's campaign.
- **Client isolation**: queues are built strictly by `Client ID`, so one client's campaign can't reach another client's contacts (covered by a test).
- **Consent**: only `Opt In = YES`. Opt-out keywords override everything, apply to every record with that number, and cancel unsent items. Opt-in is re-read before each send.
- **Concurrency**: LockService script lock (scheduler and queue) and a document lock (ID counters, row appends) prevent duplicate sends and row collisions.
- **Access**: share the spreadsheet only with administrators. Clients get the form link only. The web app exposes only health JSON (GET) and the keyed webhook (POST).
- **Unofficial API risk**: Maytapi drives a regular WhatsApp account. Spam-like volume can get the number banned. Keep the delays,
  daily limit and opt-in rules conservative, and follow WhatsApp's policies and local marketing laws.

---

## PART 14: Production checklist

- [ ] The live Maytapi docs have been checked against the verification table (buttons and webhook fields in particular)
- [ ] `MAYTAPI_PRODUCT_ID`, `MAYTAPI_PHONE_ID` and `MAYTAPI_API_TOKEN` are set, and **Test Maytapi Connection** passes
- [ ] `ADMIN_EMAIL` is set, and `WEBHOOK_SECRET` exists (auto-created by Configure Webhook)
- [ ] `TIMEZONE`, `DEFAULT_COUNTRY_CODE`, `DAILY_SEND_LIMIT`, `BATCH_SIZE` and the delays have been reviewed
- [ ] Form created, **Campaign Image** file-upload question added, question titles match Part 2
- [ ] Web app deployed (*Execute as Me*, *Anyone*), the `/exec` URL is in `WEBHOOK_URL`, and `doGet` returns `status: ok`
- [ ] **Configure Webhook** succeeded, and a reply from a test phone appears in RESPONSES
- [ ] **Install Triggers** done, and **List Triggers** shows exactly onFormSubmit, runScheduler and refreshDashboard
- [ ] TEMPLATES reviewed (generic starters edited for tone, `OPT_OUT_REPLY` wording)
- [ ] Contacts imported with the correct `Client ID`, only consented contacts have `Opt In = YES`
- [ ] **Send Test Message** shows the image, personalised text and working button, and there's no `BUTTON_FALLBACK`
- [ ] The test campaign to your own contact shows SENT → DELIVERED → READ in MESSAGE_QUEUE
- [ ] STOP tested: Opt In = NO and the contact is excluded from new queues
- [ ] An invalid submission produces a clear "Requires Attention" email
- [ ] Spreadsheet shared only with administrators, and clients receive only the dashboard URL (and/or the form link)
- [ ] For each tenant: **Create Client Login** done, Plan / Monthly Quota / Valid Until set, and Maytapi Phone ID set if they have their own number
- [ ] **Test Maytapi Connection** lists every tenant's dedicated phone as found
- [ ] As a test tenant, sign in to the dashboard on a phone: upload a CSV, build an ad, preview it, schedule it to your own number
- [ ] Code changes are deployed as **New version** of the same deployment
- [ ] Plan for growth: archive old MESSAGE_QUEUE, RESPONSES and LOGS rows periodically (Sheets suits a few thousand messages per day)

---

## PART 15: Client dashboard

**URL**: the Web App `/exec` URL (menu **Show Client Dashboard URL**). It works on phones, tablets and desktops.

**Onboarding a client**: menu **Create Client Login** → business name, login email, store phone, website. You get an
**access code** (`XXXXX-XXXXX`) shown once. Send it to the client privately. **Reset Client Access Code** issues a new one and signs out
their open sessions.

**What the client can do**
1. **Home**: opted-in customers, active and scheduled campaigns, delivery and read rates, replies, and their plan and usage.
2. **Create** (3 steps):
   - *Ad*: campaign name, upload an image (JPG, PNG or WEBP). The browser optimises it into a WhatsApp-ready JPG (≤ 1600 px, under
     `MAX_IMAGE_MB`). They can optionally add a **headline / sub-text band** drawn onto the image, in a chosen colour and position. Then
     they write the message, with variable chips (`{{Name}}`…) and WhatsApp formatting (`*bold*`), and choose a button: Website, Call,
     Quick reply or none.
   - *Audience & time*: all opted-in customers or chosen lists, with a live recipient count. Send now or a date and time
     (interpreted in `TIMEZONE`).
   - *Review*: a summary plus the **protected preview**, then **Launch**. Validation errors appear inline. Nothing is emailed for errors,
     and a confirmation email is sent on success.
   - The live preview shows exactly what the customer will get. With `IMAGE_THEN_BUTTONS` that's the image, then the text with the button.
     With `CAPTION_LINK` it's one bubble.
3. **Customers**: upload **.xlsx, .xls or .csv** (up to 5,000 rows per file). Columns are auto-detected (phone, name, email, company,
   tags, opt-in) and can be re-mapped, with a preview of the first rows. They give the file a **list name** (it becomes a tag to target later) and
   must tick a **consent confirmation**. New numbers are added with Opt In = YES (or NO if the file says so). Existing numbers are
   updated, and anyone who replied STOP **stays unsubscribed**. Each row records its source and the consent confirmation. A sample CSV is downloadable.
4. **Campaigns**: status, progress (sent, delivered, read, failed, replies), protected preview, and cancel (unsent messages are cancelled).

**Where things are stored**: creatives go to Drive under `WhatsApp Campaign Creatives/<Client ID>/` (private). Contacts, campaigns and
the queue go into the same sheets as before, always tagged with the tenant's Client ID.

**Branding note**: Google may show a small notice above Apps Script web apps (for example "This application was created by a
Google Apps Script user"). It's added by Google and can't be removed from the script, so tell clients to expect it.

---

## PART 16: Multi-tenant: selling the service to many businesses

One spreadsheet and one Apps Script deployment serve every tenant. Each row in **CLIENTS** is a tenant.

| Column | Effect |
|---|---|
| `Status` | `Active` = normal. `Suspended` = can't sign in, can't create campaigns, and their queued messages pause. |
| `Plan` | Free text shown in the client's dashboard (e.g. Starter, Pro). |
| `Maytapi Phone ID` | The tenant's **own WhatsApp number**: add the number as another phone in your Maytapi product (scan its QR), then paste its phone ID here. Blank = your shared platform number. |
| `Monthly Quota` | Maximum campaign messages per calendar month. Blank = unlimited. When reached, the tenant's active campaigns are **paused** (nothing fails). Resume them after an upgrade or when the next month starts. |
| `Valid Until` | Subscription end date (`yyyy-MM-dd`). After it, the client can still sign in and view results, but can't launch, and sending pauses. |

**Isolation**
- Data: every contact, campaign and queue row has a Client ID. Queues only include contacts of the campaign's tenant. Dashboard
  sessions only read or change their own tenant's rows (covered by tests).
- Sending: each tenant's messages go out through their `Maytapi Phone ID` (or the shared number). `DAILY_SEND_LIMIT` protects
  **each** WhatsApp number separately. A disconnected or rate-limited number pauses only that number's sends, while others continue.
- Replies: events arriving on a tenant's dedicated number belong to that tenant only. Their STOP opts the customer out of **that tenant**,
  and auto-replies use that tenant's TEMPLATES rows first (blank Client ID rows are shared defaults). They're sent from the number
  the customer wrote to. On the shared number, STOP opts the customer out of every tenant, because they can't tell the businesses apart.
- Admin view: the **DASHBOARD** sheet has a **Tenants** table (plan, sending number, sent this month, quota, remaining, valid until,
  opted-in contacts, last login, can-send status).

**Typical commercial setup**
1. One Maytapi account (product) owned by you. Its API token stays in Script Properties.
2. Low tiers share your platform number. Higher tiers get a dedicated number (their own SIM/WhatsApp, linked to your product).
3. Per tenant: **Create Client Login** → set Plan, Monthly Quota and Valid Until (and Maytapi Phone ID if dedicated) → send them
   the dashboard URL and access code.
4. Renewals: update `Valid Until` or `Monthly Quota`, then **Resume Campaign** for anything that was paused.

**Limits of this architecture**: Google Sheets comfortably handles a few thousand messages per day in total across all tenants.
Apps Script quotas (UrlFetch calls/day, trigger runtime) are per Google account, not per tenant. When you outgrow this, the
`api*` and `*_` layers are the seams for moving storage to a database without changing the dashboard.
