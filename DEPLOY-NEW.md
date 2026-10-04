# Deploying the new build

Two files: `dist/code.gs` and `dist/index.html`.

**Do not paste `code.gs` over your live script.** Set this up as a *separate*
Apps Script project with a *separate* registry, prove it works, then migrate.
Your current customers keep running on the old one until you decide otherwise.

---

## 1. A sandbox first

1. Make a copy of your template spreadsheet → this is the new **TEMPLATE**.
2. Make a new blank spreadsheet → this is the new **REGISTRY**.
3. New Apps Script project → paste `dist/code.gs`.
4. **Project Settings → Script Properties**:

| Property | Value |
|---|---|
| `MASTER_DB_ID` | the new registry's id |
| `TEMPLATE_ID` | the new template's id |
| `SITE_URL` | `https://www.domebox.in` |
| `MAIL_FROM` | `info@biscsindia.com` |
| `RAZORPAY_KEY_ID` | your **new** key id (after rotating) |
| `RAZORPAY_KEY_SECRET` | your **new** secret |
| `GEMINI_KEY` | your **new** Gemini key |
| `PROMO_CODES` | optional, e.g. `{"LAUNCH20":20}` |

5. Run `setupDomeBox()` — it creates the two crypto secrets and tells you what
   is still missing. **Back up `AUTH_PEPPER`.** Losing it means every password
   must be reset.
6. Run `ensureRegistry()`.
7. **Deploy → New deployment → Web app**, Execute as **Me**, Access **Anyone**.
8. Copy the `/exec` URL into `index.html`:

```js
var API_URL = 'https://script.google.com/macros/s/AKfy.../exec';
```

9. Open `index.html`, sign up a test company, and walk through it.

## 2. Then migrate

Only once the sandbox behaves:

1. Back up every live spreadsheet (`backup.gs`, sent earlier — run
   `verifyLatestBackup()` and confirm).
2. Point the new project's `MASTER_DB_ID` at your **live** registry.
3. Run `ensureRegistry()` — it only adds missing tabs and columns, it never
   rewrites a row.
4. Sign in as yourself. Your plaintext password still works and is silently
   upgraded to a hash on that first login.
5. Deploy the new `index.html` to Netlify.
6. Keep the old script deployed but unused for a week, so rollback is just
   re-pointing `API_URL`.

Existing tenant sheets widen in place: the first 15 task columns and 9 user
columns are unchanged, and the new ones are appended. That is the only shape of
schema change that cannot corrupt old rows.

## 3. The one thing to do regardless

Run `lockDownAllTenants()` from `remediate-sharing.gs` against your **live**
registry today. Every customer spreadsheet your current code created is set to
ANYONE_WITH_LINK / EDIT. That is independent of this rewrite and does not wait
for it.

---

## Notes

**Tailwind.** `index.html` loads the play CDN so it is a single file. It works,
but it compiles in the browser on every load. For production, compile it once
(`tailwind.min.css`, sent earlier, is ~17 KB for this file's classes) and swap
the script tag for a stylesheet link.

**Apps Script quotas.** The dashboard polls every 30 seconds and pauses when the
tab is hidden. Your old front end polled every 5 seconds, which is roughly 5,700
executions per user per day against a 90-minute daily runtime allowance.

**Email.** `MAIL_FROM` must be a verified alias on the sending Google account or
`GmailApp` throws and the code falls back to `MailApp`, which ignores the from
address and sends as the script owner. The fallback is logged so you can see it
happening rather than wondering why mail looks wrong.
