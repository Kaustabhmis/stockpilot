# Launch checklist — Domebox and Domebox Lite

Last full audit: 29 October 2026.
- **Server tests:** 44 suites pass (1,627 checks).
- **Browser tests:** 21 suites pass.
- **Click-through:** every tab and dialog opened as Admin, head of department and
  staff, on desktop and phone, in both editions, with no errors.
- **Fresh install:** a brand-new install of each edition, simulated from
  scratch, reaches "Deploy as a web app" with nothing else missing.

Do the steps in order. Each one is quick.

---

## Domebox (www.domebox.in)

### 1. Apps Script — the existing Domebox project
1. Open **Code.gs**, select everything, and paste in `1-apps-script/Code.gs` from the zip.
2. Do the same for **reminders.gs** and **backup.gs**. **Save**.
3. **Deploy → Manage deployments → ✏ (pencil) → Version: New version → Deploy.**
   The `/exec` address stays the same.
4. Run **setupDomeBox** and open the **Execution log**. Under **WHAT IS LEFT**, it should
   list nothing, or only things you have chosen to skip.

Script Properties that must be set: `MASTER_DB_ID`, `TEMPLATE_ID`, `AUTH_PEPPER`,
`TOKEN_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `MAIL_FROM`, `SITE_URL`,
`SELLER_ADDRESS`, `SELLER_STATE`. Without the first four, the app refuses every
request; that is on purpose.

### 2. Website — Netlify
1. Open `2-netlify-website/netlify-upload`.
2. **Copy your own filled-in `domebox-config.js` over the blank one in that folder.**
   It holds your `/exec` address and the company details shown on the legal pages.
   Uploading the blank one would wipe them from the live site.
3. Netlify → your domebox.in site → **Deploys** → drag the `netlify-upload` folder in.

### 3. Check on the live site (10 minutes)
- [ ] Sign in as Admin. Tasks, Projects, Team and Reports all open.
- [ ] Assign a task. The person list starts A–Z, and the A–Z / Z–A switch works.
- [ ] Tasks → **Any date** → pick a range → **OK**. The list filters.
- [ ] Make **one real payment** (smallest plan), then check the plan changed and the
      invoice email arrived.
- [ ] Sign in on your phone, then change your password on the computer. The phone shows
      "You have been signed out".
- [ ] **Forgot password** with your own email. The email arrives, and the link works
      within 15 minutes.

---

## Domebox Lite (Dynamic Engineers)

### 1. Apps Script — the Domebox Lite project
1. Paste in `Code.gs`, `reminders.gs` and `backup.gs` from the **Lite** zip. **Save**.
2. **Deploy → Manage deployments → ✏ → New version → Deploy.**
3. Script Properties: `SITE_URL` = the Lite website address. `MAIL_FROM` is optional;
   Lite sends from **mis@dynamicengineers.in** unless you set another address.
4. Run **setupDomeBox**. It should say *every email will leave from
   mis@dynamicengineers.in*.
   - If it says **MISSING** instead, the Google account running Lite cannot send as that
     address. See LITE-SETUP.md, section 5.

### 2. Website
1. Copy your filled-in `domebox-config.js` (with the Lite `/exec` address) into
   `lite-upload`.
2. Drag `lite-upload` into the Lite Netlify site.

### 3. Check
- [ ] Sign in, assign a task, and check the welcome or assignment email comes from
      mis@dynamicengineers.in.
- [ ] Forgot password works.

---

## Day one, both editions
- **Back up** `AUTH_PEPPER` and `TOKEN_SECRET`: copy them from Script Properties to
  somewhere safe offline. Losing `AUTH_PEPPER` means every password must be reset.
- **Tell heads of department** they now manage only their own reporting line. An Admin
  manages everyone.
- **Errors:** if anyone reports one, ask for the **Reference** code on the message. The
  full detail is in the Master sheet → **ErrorLog** under that code.
- **Erasure requests:** see the top of `src/20-privacy.gs`; run `erasePerson` or
  `eraseCompanyData` from the editor.

Full security details: `SECURITY-AUDIT.md`.
