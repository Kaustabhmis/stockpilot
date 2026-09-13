# WhatsApp alerts — setup

The code is done. What remains is account work only you can do, because it
requires your company's identity documents and a phone number you control.

Budget **2–5 working days**, most of it waiting on Meta's business verification.

---

## The one thing to understand first

WhatsApp rates the *quality* of your sending number. Message people who did not
ask, and the number gets flagged, then throttled, then banned. That number is
**your company's, shared across every customer** — so one careless blast takes
the channel away from all of them at once.

That is why the code refuses to message anyone without a recorded opt-in, and
why it ships with two independent brakes on:

```js
WA.ENABLED   = false   // master switch
WA.DRY_RUN   = true    // logs what it would send, calls nothing
WA.ALLOWLIST = []      // when non-empty, ONLY these numbers are reachable
```

Turn them off in that order, and clear the allowlist **last** — after you have
seen real messages arrive on your own handset.

---

## 1. Meta business account and verification

1. <https://business.facebook.com> → create a Business Portfolio for **BISCS India**.
2. Settings → Business Info → **Start Verification**. You will need your
   incorporation certificate or GST registration, and a utility bill or bank
   statement showing the business name and address, all matching exactly.
3. Wait for approval. This is the slow step.

Until verified you are on a limited tier — typically **250 unique recipients per
24 hours**. That is fine for your first Pro customers. The limit rises
automatically as volume and quality rating grow. Check the current tier in
WhatsApp Manager → Phone numbers.

## 2. WhatsApp Business Platform (Cloud API)

1. <https://developers.facebook.com> → Create App → **Business** → add the
   **WhatsApp** product.
2. Add a phone number. It **must not already be registered on WhatsApp** — not
   on the normal app, not on WhatsApp Business. Use a fresh SIM, or fully delete
   the existing WhatsApp account on that number first. Do not use your personal
   number: you cannot get it back out easily.
3. Note the **Phone number ID** (a long number, not the phone number itself).

## 3. A permanent token

The token shown on the dashboard **expires in 24 hours**. Do not use it for
anything but a first smoke test.

1. Business Settings → **System Users** → Add → name it `domebox-sender`,
   role **Admin**.
2. **Add Assets** → your WhatsApp Account → enable *Manage*.
3. **Generate New Token** → select your app → tick `whatsapp_business_messaging`
   and `whatsapp_business_management` → set expiry **Never**.
4. Copy it once. It is never shown again.

## 4. Put the credentials in Script Properties

In the Apps Script editor: **Project Settings → Script Properties**.

| Property | Value |
|---|---|
| `WA_TOKEN` | the permanent token from step 3 |
| `WA_PHONE_ID` | Phone number ID from step 2 |
| `WA_VERIFY_TOKEN` | any random string you invent — you will paste the same one into Meta |

Never put these in the `.gs` file. Anyone who can read the source could
otherwise send as your company, and source ends up in repos, backups and
support emails.

Run `waCheckSetup()` and read the log. It tells you exactly what is missing.

## 5. Webhook (delivery status and STOP)

1. Apps Script → **Deploy → New deployment → Web app**.
   Execute as **Me**; Who has access **Anyone**.
2. Copy the `/exec` URL.
3. Meta app dashboard → WhatsApp → Configuration → Webhook → **Edit**.
   Callback URL = the `/exec` URL. Verify token = your `WA_VERIFY_TOKEN`.
4. Subscribe to the **messages** field.

Without this, STOP replies are never recorded — which is exactly how a number
gets its quality rating destroyed.

## 6. Templates — submit these four

WhatsApp Manager → **Message templates** → Create. Category **Utility** for all
four (not Marketing: utility is cheaper and far more likely to be approved for
transactional content). Language: **English**.

Names must match the code exactly.

---

**`domebox_daily_digest`**

> Body:
> `Hi {{1}}, your Dome Box summary for {{2}}: {{3}} overdue, {{4}} due today, {{5}} waiting on you.`
> Footer: `Reply STOP to turn off these alerts.`
> Button: *Visit website* → `https://www.domebox.in`
> Samples: `Asha` · `10 Sep` · `2` · `3` · `1`

**`domebox_task_assigned`**

> Body:
> `Hi {{1}}, {{2}} has assigned you a task: {{3}}. Due {{4}}.`
> Footer: `Reply STOP to turn off these alerts.`
> Button: *Visit website* → `https://www.domebox.in`
> Samples: `Asha` · `Sruti Charulata` · `Vendor audit` · `2026-09-18`

**`domebox_approval_pending`**

> Body:
> `Hi {{1}}, {{2}} is waiting for your approval on: {{3}}. Pending {{4}} day(s).`
> Footer: `Reply STOP to turn off these alerts.`
> Button: *Visit website* → `https://www.domebox.in`
> Samples: `Rohan` · `Bela Nair` · `Operator training` · `3`

**`domebox_task_overdue`**

> Body:
> `Hi {{1}}, your task {{2}} is overdue by {{3}} day(s). Due date was {{4}}.`
> Footer: `Reply STOP to turn off these alerts.`
> Button: *Visit website* → `https://www.domebox.in`
> Samples: `Asha` · `Stock reconciliation` · `2` · `2026-09-08`

---

Approval usually takes minutes, occasionally 24 hours. The footer is not
decoration: a visible opt-out makes approval more likely and protects the
number.

## 7. Collect opt-in before you send anything

Nobody may be messaged without it. Record it when a user adds their number:

```js
waRecordOptIn(sheetId, 'asha@acme.in', '9876543210', 'profile-page');
```

The wording next to the checkbox matters — it has to be explicit:

> ☐ Send me Dome Box task reminders on WhatsApp at this number.
> You can reply STOP at any time.

A pre-ticked box is not consent, under Meta's rules or under the DPDP Act.

## 8. Go live, carefully

```js
// 1. still safe — see what WOULD go out, for real tenants
previewWhatsAppReminders();

// 2. your own handset only
WA.ENABLED   = true;
WA.DRY_RUN   = false;
WA.ALLOWLIST = ['+919xxxxxxxxx'];   // your number
sendWhatsAppReminders();

// 3. after messages actually arrive and STOP works, open it up
WA.ALLOWLIST = [];
installWhatsAppSchedule();          // daily 09:00
```

Test STOP yourself before step 3. Reply STOP from your handset, check the
`WhatsAppOptIn` tab flipped to `false`, and confirm the next run skips you.

---

## Cost

Meta bills per message for utility templates (this changed during 2025 — it used
to be per 24-hour conversation). India utility rates are among the cheapest, but
they are not zero and they are per recipient per message.

Check current rates at Meta's WhatsApp pricing page for India before you promise
volumes. Then do the arithmetic that matters:

> one Pro customer, 300 users, one alert each per working day
> = ~6,600 messages/month **for that one customer**

`WA.MAX_PER_TENANT_PER_DAY` (default 200) is your circuit breaker. Keep it low
until you know what a month actually costs, and price Pro accordingly — at 300
users, WhatsApp could plausibly cost more than the ₹19,999/yr you charge.

## What the code does to keep the bill and the number safe

- One message per person per day maximum; the digest replaces a list rather than
  sending several.
- Only the single most urgent item: approvals outrank overdue, overdue outranks
  the summary.
- A person with a quiet day gets nothing at all.
- Per-tenant and per-run caps.
- Quiet hours 21:00–08:00 IST.
- Every send deduplicated through the same `ReminderLog` the email digest uses,
  so a re-run cannot double-message.
- Pro Yearly and Enterprise only, matching your pricing table.
