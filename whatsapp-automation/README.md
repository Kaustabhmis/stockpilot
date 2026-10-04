# WhatsApp Campaign Automation (Google Forms + Sheets + Apps Script + Maytapi)

A reusable, multi-client WhatsApp marketing system. A client only fills in a **Google Form**.
The rest is automatic: validation, campaign record, image handling, audience selection, a
throttled send queue, Maytapi delivery, webhook tracking, keyword auto-replies and opt-outs.

Nothing is tied to one business. The name, message, image, website, store phone, CTA,
schedule and audience all come from the form, so the same deployment works for jewellery,
real estate, restaurants, salons, education and so on.

```
Client → Google Form → FORM_RESPONSES → onFormSubmit() → validate → CLI/CMP IDs → processCampaignImage()
      → CAMPAIGNS → buildCampaignQueue() → MESSAGE_QUEUE → runScheduler() (every N min, LockService)
      → Maytapi sendMessage → WhatsApp → customer
customer reply / ack → Maytapi webhook → doPost() → RESPONSES / auto-reply / opt-out / lead
```

The result looks like the reference creative (it's a reference only, nothing from it is hard-coded):
the client's **image**, then their **personalised message** with an interactive
**CTA button** (URL, Call, or Quick reply).

---

## 1. Files

| File | Purpose |
|---|---|
| `src/appsscript.json` | Manifest (V8, scopes, web app settings) |
| `src/Constants.gs` | Sheet schemas, statuses, form question titles |
| `src/Config.gs` | `getConfig()`, `validateConfig()`, credential prompts, secret redaction |
| `src/Utils.gs` | Sheet I/O, ID generator, `normalizePhoneNumber()`, `renderTemplate()`, dates, logging |
| `src/Maytapi.gs` | `maytapiRequest()`, `sendMaytapiText/Media/Buttons()`, `testMaytapiConnection()` |
| `src/Media.gs` | `processCampaignImage()` and the swappable media resolver |
| `src/Messaging.gs` | Converts a message into Maytapi calls (image → button, fallbacks) |
| `src/Forms.gs` | `onFormSubmit()`, `createCampaignForm()`, reprocessing |
| `src/Campaigns.gs` | Validation, clients, audience engine, lifecycle, scheduling, `sendTestMessage()` |
| `src/Queue.gs` | `buildCampaignQueue()`, `processMessageQueue()`, retries, `runScheduler()` |
| `src/Webhook.gs` | `doGet()`, `doPost()`, acks, auto-replies, opt-out, `getWebhookUrl()`, `configureWebhook()` |
| `src/Triggers.gs` | `installTriggers()`, `removeTriggers()`, `listTriggers()` |
| `src/Email.gs` | Client confirmation / attention emails, admin notifications |
| `src/Dashboard.gs` | `refreshDashboard()` |
| `src/Setup.gs` | `setupSystem()`, `onOpen()` menu |
| `tests/run-tests.js` | Offline end-to-end tests with mocked Apps Script services (`node tests/run-tests.js`) |

---

## 2. Installation (per client deployment or one shared deployment)

1. **Create a Google Sheet** → *Extensions → Apps Script*.
2. Copy every file from `src/` into the project, keeping the file names. In *Project Settings*, turn on
   "Show appsscript.json" and paste the manifest. Or use clasp: `clasp create --type sheets`, set
   `"rootDir": "src"` in `.clasp.json`, then `clasp push`.
3. Reload the sheet. The **WhatsApp Automation** menu appears. Run **Setup System** and approve the permissions.
4. **Set Maytapi Credentials** (menu). This stores the following in *Script Properties* only:
   - `MAYTAPI_PRODUCT_ID`, `MAYTAPI_PHONE_ID`, `MAYTAPI_API_TOKEN` (required)
   - `WEBHOOK_SECRET`, `ADMIN_EMAIL` (optional; a webhook secret is generated automatically if missing)
   - You can also set `DEFAULT_COUNTRY_CODE`, `TIMEZONE` and `MEDIA_BASE_URL` in *Project Settings → Script Properties*.
5. **Test Maytapi Connection**. This checks the credentials, that the phone ID belongs to the product, and the phone's status.
6. **Create Campaign Form**. This builds the form and links it to the `FORM_RESPONSES` tab.
   ⚠️ Apps Script **cannot create File Upload questions**. Open the form's edit link and add a
   **File upload** question titled exactly **`Campaign Image`** (images only, 1 file, max 10 MB). File upload
   requires respondents to sign in with a Google account. That is a Google Forms rule.
7. **Deploy the web app**: *Deploy → New deployment → Web app*, Execute as **Me**, Who has access
   **Anyone**. Copy the `/exec` URL into `SETTINGS → WEBHOOK_URL` (or leave it blank and let the script
   use `ScriptApp.getService().getUrl()`).
8. **Configure Webhook** (menu). This registers `…/exec?key=<WEBHOOK_SECRET>` with Maytapi (`setWebhook`).
9. **Install Triggers** (menu). Duplicates are never created.
10. Add contacts to **CONTACTS** (see §5), then **Send Test Message** to your own number.

Every time you change the code, deploy a **new version** of the existing web app deployment
(*Manage deployments → Edit → New version*) so the `/exec` URL stays the same.

---

## 3. The Google Form (client interface)

| # | Question title (exact) | Type | Required |
|---|---|---|---|
| 1 | Client / Business Name | Short answer | ✔ |
| 2 | Campaign Name | Short answer | ✔ |
| 3 | Campaign Message | Paragraph (supports variables) | ✔ |
| 4 | Campaign Image | **File upload** (add manually; images) | optional (text-only allowed) |
| 5 | Website / Landing Page URL | Short answer, URL validation | optional |
| 6 | Store / Business Phone Number | Short answer | ✔ |
| 7 | CTA Button Text | Short answer (≤ 20 chars) | optional |
| 8 | CTA Button Type | Multiple choice: URL / PHONE / QUICK_REPLY / NONE | ✔ |
| 9 | CTA Button Value | Short answer | optional (defaults below) |
| 10 | Target Audience | Checkboxes + "Other" (e.g. `TAG:KOLKATA`) | ✔ |
| 11 | Campaign Date | Date | required when Schedule |
| 12 | Campaign Time | Time | required when Schedule |
| 13 | Client Email | Short answer, email validation | ✔ |
| 14 | Additional Notes | Paragraph | optional |
| 15 | Send Mode | Multiple choice: Send Now / Schedule | ✔ |

Clients never enter Maytapi IDs, tokens or secrets.

**CTA defaults**: URL with a blank value uses the Website. PHONE with a blank value uses the Store Phone.
QUICK_REPLY with a blank value uses a slug of the button text.

**Message variables**: `{{Name}} {{Phone}} {{Email}} {{Company}} {{ClientName}} {{CampaignName}} {{StorePhone}} {{Website}}`.
Matching ignores case and spaces. Unknown variables are removed, so they never reach customers, and the client is warned in the confirmation email.

### Store phone vs sending phone
- **MAYTAPI_PHONE_ID** (Script Property) is the platform-controlled WhatsApp number that sends every message.
- **Store / Business Phone** (form) is the client's public number. It's used only for `{{StorePhone}}`, PHONE CTAs and auto-replies.
  It never changes the sending number.

---

## 4. Maytapi integration and what to verify

maytapi.com could not be reached from the environment this was built in, so the payloads follow Maytapi's
published API contract. **Before go-live, open https://maytapi.com/documentation and confirm the items below,
then run *Send Test Message*.** Every payload is built in one place, so any change is a one-line edit.

| Item | Used here | Where |
|---|---|---|
| Base URL | `https://api.maytapi.com/api/{product_id}` | `MAYTAPI_BASE_URL` |
| Auth | header `x-maytapi-key` | `maytapiRequest()` |
| Send | `POST /{phone_id}/sendMessage` | `phonePath_()` |
| Text | `{to_number, type:"text", message}` | `sendMaytapiText()` |
| Media | `{to_number, type:"media", message:<URL or data URI>, text:<caption>, filename}` | `sendMaytapiMedia()` |
| Buttons | `{to_number, type:"buttons", message, buttons:[{id,text} \| {text,url} \| {text,phoneNumber}]}` | **`buildButtonsPayload_()`** |
| Response | `{success, data:{chatId, msgId}}` | `maytapiRequest()` |
| Connection | `GET /listPhones`, `GET /{phone_id}/status` | `testMaytapiConnection()` |
| Webhook | `POST /setWebhook {webhook}`; events `message`, `ack` (`data[].msgId, ackType`), `status`, `error` | `Webhook.gs` |

- Maytapi labels **buttons** as a newer (BETA) feature. If Maytapi rejects a button payload, the system sends the
  CTA as a text link automatically (`CTA_FALLBACK_TO_TEXT=YES`) and logs `BUTTON_FALLBACK`. The customer still gets the CTA.
- **List and carousel** messages are intentionally not implemented (`sendMaytapiList/Carousel` return an error).
  Their schema couldn't be verified, and guessing payloads is unsafe.
- Maytapi does not sign webhooks, and Apps Script can't read request headers. So the webhook URL carries a
  secret `?key=` parameter that `doPost` checks. No other security mechanism is invented.

### CTA delivery styles (`SETTINGS → IMAGE_CTA_STYLE`)
- `IMAGE_THEN_BUTTONS` (default): the image message, then the personalised text with a real interactive button. This is the closest to the reference creative.
- `CAPTION_LINK`: one image message whose caption ends with `👉 Explore Collection: https://…`. Always supported.

---

## 5. Campaign images

`processCampaignImage()` reads the form's Drive reference, extracts the file ID, checks that the file exists, isn't trashed,
is a JPG or PNG, and is under `MAX_IMAGE_MB` (5 MB, the WhatsApp limit). It then stores the **Drive file ID** in the campaign.

How the image reaches Maytapi (`SETTINGS → MEDIA_MODE`):
- **`BASE64` (default)**: Apps Script reads the bytes and sends `data:image/jpeg;base64,…` in the media `message` field.
  The client's Drive file **stays private**, and no hosting is needed.
- **`URL`**: Maytapi downloads a public **HTTPS** URL taken from the campaign's `Image URL` column (paste a
  CDN, S3, Cloudinary or website link) or from `MEDIA_BASE_URL/<file name>`.

Google Drive share links are deliberately **not** used as media URLs. They aren't a documented image host and would
require making client files public. To add a new host, add a branch in `resolveMedia_()`. Nothing else changes.

---

## 6. Sheets

`setupSystem()` creates missing sheets and columns only. Existing data is never cleared.

- **SETTINGS**: operational values (batch size, delays, daily limit, retries, timezone, media mode…). No credentials.
- **CLIENTS**: `CLI-YYYY-0001`. Clients are matched by email, then by business name.
- **CONTACTS**: import your audience here. Only `Client ID` matching the campaign, `Opt In = YES` and
  `Status = Active` contacts are ever messaged. `Tags` and `Audience` accept comma-separated values.
- **CAMPAIGNS**: `CMP-YYYY-0001`. Statuses: DRAFT, VALIDATING, READY, SCHEDULED, ACTIVE, PAUSED, COMPLETED, CANCELLED, ERROR.
- **MESSAGE_QUEUE**: `QUE-YYYY-000001`. Statuses: PENDING, PROCESSING, QUEUED (waiting for a retry), SENT, DELIVERED, READ, FAILED, SKIPPED, CANCELLED.
- **LOGS**: phones masked (`91******3210`), secrets redacted.
- **RESPONSES**: every webhook event with its raw payload and processing result.
- **TEMPLATES**: keyword auto-replies (Trigger = comma-separated keywords; Reply Type TEXT, IMAGE or BUTTONS).
- **DASHBOARD**: KPIs and a per-campaign table. Refreshed every 30 min and after each menu action.

### Audience syntax
`ALL_OPTED_IN`, `VIP`, `LEADS`, `CUSTOMERS`, `KOLKATA` (matched against the Audience column **or** Tags),
`TAG:VIP`, `AUDIENCE:CUSTOMERS`. Combine several with commas (any match). To add a new rule
(e.g. `CITY:`), add a resolver to `AUDIENCE_RESOLVERS` in `Campaigns.gs`.

---

## 7. Sending, throttling and retries

- `runScheduler` runs every `QUEUE_INTERVAL_MINUTES`. It activates due scheduled campaigns, then sends at most
  `BATCH_SIZE` messages with a random `DELAY_MIN_MS`–`DELAY_MAX_MS` pause between sends. A `LockService` script lock prevents overlapping runs.
- `DAILY_SEND_LIMIT` caps sends per day (in the configured timezone) to protect the sending number.
- A run stops early before Apps Script's 6-minute limit. Rows interrupted mid-send are marked FAILED
  ("delivery unknown") rather than resent, to avoid duplicates. Use **Retry Failed Messages** to resend them.
- Transient errors (network, 5xx, phone temporarily unavailable) retry up to `MAX_RETRIES` with exponential
  backoff (`RETRY_BASE_MINUTES × 2^(attempt-1)`). Rate limits (429) reschedule without spending an attempt and stop the batch.
  Authentication errors stop the batch and email the admin. Invalid numbers and other 4xx errors fail immediately.
- One failed customer never stops the campaign. Opt-in is re-checked right before each send.

## 8. Replies, opt-out and leads

- Incoming text and button replies are matched case-insensitively against `TEMPLATES` triggers. For QUICK_REPLY campaigns, tapping
  the button (which sends its label) is also mapped to the campaign's CTA value.
- `STOP`, `UNSUBSCRIBE`, `REMOVE` and `NO` (`OPT_OUT_KEYWORDS`) set **Opt In = NO on every record for that phone** (the sending number
  is shared by all clients), skip that phone's unsent queue items, and send `OPT_OUT_REPLY`. Opt-out overrides audience selection.
- Messages from unknown numbers create a CONTACTS lead (`Audience = LEADS`, `Tags = INBOUND`, **Opt In = NO**).

## 9. Menu

Setup System · Set Maytapi Credentials · Create Campaign Form · Test Maytapi Connection · Send Test Message ·
Build Campaign Queue · Start / Pause / Resume / Cancel Campaign · Process Queue Now · Retry Failed Messages ·
Reprocess Form Response · Install / Remove / List Triggers · Configure Webhook · View Dashboard

## 10. Security

- Credentials live only in Script Properties. They're never written to sheets, logs, emails or `doGet` output, and `redactSecrets_()` scrubs logged text.
- Client Drive images stay private (BASE64 mode).
- Requests without the correct webhook `key` are rejected and logged.
- Apps Script web apps always answer HTTP 200. Rejection is signalled in the JSON body.

## 11. Limits and scaling notes

- Sheets-based storage suits roughly a few thousand messages per day. Each webhook call reads the queue sheet, so beyond that,
  archive old queue and response rows or move storage to a database.
- Quotas: UrlFetch about 20k calls/day (consumer) or 100k (Workspace). Trigger runtime 90 min/day (consumer) or 6 h (Workspace). MailApp 100 or 1,500 emails/day.
- WhatsApp policy: message only opted-in contacts, honour opt-outs, and keep volumes modest. Unofficial-API numbers can be banned
  for spam-like behaviour, so keep delays and the daily limit conservative.

## 12. Tests

```
node whatsapp-automation/tests/run-tests.js
```
These run the full flow (setup, form validation, queue rules, Maytapi payloads, fallback and retries, webhook acks,
auto-replies, opt-out, scheduling, lifecycle, dashboard) against in-memory mocks. No network calls are made.
