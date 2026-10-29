# Domebox Lite — setup

Domebox Lite is your own company's copy of Domebox: the full **Growth** plan (up to 50
people, scoring, reports, appraisals, projects, meetings), permanently, with **no plans,
prices, trial, billing, payments, sales page or demo**. The first company that signs up
is the only one: anybody else who finds the address is turned away.

It runs **separately** from www.domebox.in: its own Apps Script project, its own sheets
and its own Netlify site. Nothing you do in Lite touches your paying customers.

You need: **Code.gs**, **reminders.gs** and **backup.gs** from the `1-apps-script` folder
of the Lite zip, and the **lite-upload** website folder.

---

## 1. A new Apps Script project, just for Lite

1. **script.google.com** → **New project**. Name it **Domebox Lite**.
   Do **not** use your existing Domebox project.
2. **Project Settings** → **Time zone** → **(GMT+05:30) India Standard Time**.
3. Replace `Code.gs` with the Lite **Code.gs**. Add two script files, `reminders` and
   `backup`, and paste **reminders.gs** and **backup.gs** into them. **Save**.

## 2. Build its sheets

1. Choose **freshStart** → **▶ Run** (allow the permissions).
2. It makes a **Domebox Lite** folder in Drive with **Domebox Lite Master** and
   **Domebox Lite Template**. These are separate from your Domebox sheets.

## 3. Switch it on

1. Choose **switchOnSchedules** → **▶ Run** (reminders, digest, backups).
2. **Deploy** → **New deployment** → **Web app**: Execute as **Me**, access **Anyone** →
   **Deploy**. Copy the address ending in **/exec**.

## 4. The website

1. Open `lite-upload\domebox-config.js` in Notepad. Paste the **/exec** address between
   the quotes. Save.
2. **app.netlify.com** → **Add new site** → **Deploy manually** → drag the
   **lite-upload** folder. This is a **new** site, not your domebox.in site.
3. Netlify gives it an address such as `https://something.netlify.app`. You can rename it
   under **Site configuration → Change site name**, or add a domain of your own.

## 5. Emails: where they come from, and where they link

Lite emails (welcome, reminders, the morning digest, backup alerts) come from
**mis@dynamicengineers.in**, branded **Domebox Lite**. None of them come from
info@biscsindia.com.

1. Back in the Lite Apps Script project: **Project Settings → Script Properties** → add:

   | Property | Value |
   |---|---|
   | `SITE_URL` | the Lite website address from step 4 |
   | `MAIL_FROM` | optional — leave it out and Lite sends from `mis@dynamicengineers.in` |

   Save.
2. The Google account that runs the Lite project must be able to send as that address.
   Either:
   - **Easiest:** create the Lite project while signed in to Google **as
     mis@dynamicengineers.in**. Then nothing else is needed.
   - **Or:** if it runs under another Google account, add mis@dynamicengineers.in in
     that account's **Gmail → Settings → Accounts → Send mail as**, and confirm the code
     Gmail sends to it.
3. Run **setupDomeBox**. Under **SENDING ADDRESS** it should say
   *every email will leave from mis@dynamicengineers.in*, and nothing should be listed
   under **WHAT IS LEFT**.

If Lite cannot send as that address, it sends nothing at all rather than sending from
the wrong address, and setupDomeBox says what to fix.

## 6. Create your company

Open the Lite website → **Create a company workspace** → your company name, your name,
email and password. That workspace is on the Growth plan permanently. Then add your team
from the **Team** tab.

---

| Problem | Fix |
|---|---|
| "This Domebox Lite is already set up for …" | Lite holds one company. Sign in with that company's Admin account and add people from Team. |
| Someone uses an email that already signs in to www.domebox.in | Each email opens one workspace **per installation**, and Lite is a separate installation, so it is allowed. |
| Changed Code.gs later | **Deploy** → **Manage deployments** → ✏ → **New version** → **Deploy**. The address stays the same. |

Do not run `createDemoAccount` in Lite. It does nothing there, on purpose.
