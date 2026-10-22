# Social Autopilot

A private dashboard for one business. It writes social posts, puts them in an approval queue, and publishes them to Facebook, Instagram and LinkedIn. It runs on free tiers: Netlify, a Google Sheet, Netlify Blobs and free AI APIs. No paid services and no Supabase, GitHub Actions or Firebase.

**Status: Phase 1 (foundation and manual posting).** Scheduling, AI generation and video come in later phases.

| Phase | What it adds | Status |
|---|---|---|
| 1 | Login, Facebook/Instagram/LinkedIn connections, composer, publish now | Done |
| 2 | Schedule slots, calendar, scheduled publishing with retries | Next |
| 3 | AI text, images, weekly planning, approval queue | Planned |
| 4 | Video rendering in the browser, LinkedIn/Facebook video, token expiry banner | Planned |

---

## Setup guide (for a non-developer)

Work through the steps in order. Each one produces a value you paste into `.env` or `netlify env:set`. Menus on Meta, LinkedIn and Google change from time to time. If a label is different, search the page for the nearby words.

Keep a note of every value as you go: app IDs, secrets and the URL of your site.

### 1. Switch Instagram to a Business or Creator account and link it to your Facebook Page

1. Open the Instagram app and go to **Profile → Menu (≡) → Settings and privacy → Account type and tools → Switch account type**.
2. Choose **Business** or **Creator**, then finish the questions.
3. Go to your Facebook Page on desktop: **Settings → Linked accounts → Instagram → Connect account**, and sign in to Instagram.

Posting only works if Instagram is a Business or Creator account linked to a Facebook Page.

### 2. Create the Meta app (Facebook and Instagram)

1. Go to <https://developers.facebook.com/apps> → **Create app**.
2. Choose the **Business** type. Give it a name and connect it to your Business Manager if asked.
3. On the app dashboard, **Add product → Facebook Login → Set up**. Choose **Web**.
4. Go to **Facebook Login → Settings**. Under **Valid OAuth Redirect URIs**, add:
   `SITE_URL/api/auth-meta/callback` (replace `SITE_URL` with your site, for example `https://your-site.netlify.app/api/auth-meta/callback`). Save.
5. Go to **App settings → Basic**. Copy the **App ID** → `META_APP_ID`. Click **Show** next to **App secret** and copy it → `META_APP_SECRET`.
6. Go to **App roles → Roles → Add people**. Add yourself as **Administrator**.
7. Leave the app in **Development mode** (top bar). In Development mode, admins of the app can connect their own Page and Instagram account and publish to them, without app review. Do not switch the app to Live unless you plan to let other people use it.

Each permission the dashboard asks for is listed in `netlify/functions/lib/config.js` (`META_SCOPES`). On the Facebook login screen, approve every permission. A missing tick is the most common cause of "missing permission" errors.

### 3. Create the LinkedIn app

1. Go to <https://www.linkedin.com/developers/apps> → **Create app**.
2. Name it, then link it to **your company Page**. LinkedIn needs a Page to be linked, even if you only post to your personal profile. Upload a logo, tick that you have authority, and create the app.
3. Open the **Products** tab. Request **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**. Both are usually approved at once.
4. Open the **Auth** tab. Under **OAuth 2.0 settings → Authorized redirect URLs for your app**, add `SITE_URL/api/auth-linkedin/callback`. Save.
5. On the **Auth** tab, copy the **Client ID** → `LINKEDIN_CLIENT_ID` and the **Client secret** → `LINKEDIN_CLIENT_SECRET`.

**Company Pages (optional, later):** posting to a company Page needs the **Community Management API**. In the **Products** tab, select **Community Management API** and request access. LinkedIn reviews the request, which can take weeks. Until it is approved, leave `LINKEDIN_ORG_ENABLED=false`. Once approved, set it to `true`, reconnect LinkedIn, and the company Pages you administer appear in Accounts.

### 4. Google Cloud: Sheet and service account

1. Go to <https://console.cloud.google.com> → project picker (top bar) → **New project**. Name it and create it.
2. **APIs & Services → Library**. Search for **Google Sheets API** → **Enable**.
3. **IAM & Admin → Service Accounts → Create service account**. Give it any name (for example `social-autopilot`). You can skip the optional role and access steps.
4. Open the new service account → **Keys → Add key → Create new key → JSON → Create**. A `.json` file downloads. Keep it private and do not commit it to Git.
5. From that file, copy:
   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → `GOOGLE_PRIVATE_KEY` (the whole value, including the `\n` sequences)
6. In Google Sheets, create a **blank** spreadsheet. Copy its ID from the URL, the part between `/d/` and `/edit` → `SHEET_ID`.
7. Click **Share** in the Sheet. Add the `client_email` address with **Editor** access. Untick "Notify people".
8. Create the tabs and headers. In the project folder, with `.env` filled in (step 6 covers this), run:
   ```bash
   npm run setup-sheet
   ```
   It creates `Profile`, `Themes`, `Accounts`, `Slots`, `Posts` and `Targets`, with their header rows. It is safe to run again.

### 5. Get the AI keys (needed from Phase 3)

- **Gemini:** go to <https://aistudio.google.com/apikey> → **Create API key** → `GEMINI_API_KEY`.
- **Groq (fallback, optional):** <https://console.groq.com/keys> → `GROQ_API_KEY`.
- **Cloudflare Workers AI:** in the Cloudflare dashboard, copy your **Account ID** → `CF_ACCOUNT_ID`. Go to **My Profile → API Tokens → Create Token**, use the **Workers AI** template, and copy the token → `CF_API_TOKEN`.

You can leave these empty for Phase 1.

### 6. Install, deploy and run

Requirements: Node.js 20 or newer, and a Netlify account.

```bash
cd social-autopilot
npm install
npx netlify login           # opens a browser to sign in
npx netlify init            # creates the site; choose "Create & configure a new site"
```

When `netlify init` asks for the **build command** and **publish directory**, accept the values in `netlify.toml` (`npm run build` and `dist`).

Generate the secrets (step 7), then set the environment variables. Put all of them on Netlify with one command each:

```bash
npx netlify env:set DASHBOARD_PASSWORD "a-strong-password"
npx netlify env:set SESSION_SECRET "value from npm run secrets"
npx netlify env:set TOKEN_ENCRYPTION_KEY "value from npm run secrets"
npx netlify env:set SITE_URL "https://your-site.netlify.app"
npx netlify env:set SHEET_ID "..."
npx netlify env:set GOOGLE_SERVICE_ACCOUNT_EMAIL "..."
npx netlify env:set GOOGLE_PRIVATE_KEY "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
npx netlify env:set META_APP_ID "..."
npx netlify env:set META_APP_SECRET "..."
npx netlify env:set LINKEDIN_CLIENT_ID "..."
npx netlify env:set LINKEDIN_CLIENT_SECRET "..."
npx netlify env:set LINKEDIN_ORG_ENABLED "false"
```

`SITE_URL` must be the exact address you open in the browser, with no trailing slash. The Meta and LinkedIn redirect URIs from steps 2 and 3 must start with it.

For local testing, copy `.env.example` to `.env`, fill it in, and run:

```bash
npx netlify dev
```

Open <http://localhost:8888>. Local OAuth redirects need `SITE_URL=http://localhost:8888` and the same redirect URIs added to the Meta and LinkedIn apps, so most people test on the deployed site instead.

Deploy:

```bash
npm run deploy
```

Checks before you rely on it: `npm test` runs the unit and integration tests, and should show all tests passing.

### 7. Generate `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY`

```bash
npm run secrets
```

It prints two lines. Copy each value after the `=` sign. Do not change `TOKEN_ENCRYPTION_KEY` after accounts are connected, because the stored tokens can no longer be decrypted. If that happens, reconnect each account.

---

## Using the dashboard

1. **Accounts:** connect Facebook & Instagram, then LinkedIn. Accounts shows each connection and its token expiry.
2. **New post:** write the master text. Each platform's caption starts as a copy of it. Edit a caption to make it different. Add a photo (converted to JPEG on your device), tick the accounts, then **Save draft** or **Publish now**.
3. **Dashboard:** shows recent posts with a status badge for each account.

Captions follow these limits: Facebook 63,206 characters, Instagram 2,200, LinkedIn 3,000. Instagram needs an image or video.

---

## Troubleshooting

| What you see | Why | What to do |
|---|---|---|
| "The stored token could not be read" or "token has expired" | A Facebook or LinkedIn token was revoked, or LinkedIn's 60-day token ran out | Accounts → **Reconnect** |
| "Missing permission" | Some Facebook permissions were not approved on the login screen | Accounts → **Reconnect**, then tick every permission |
| "Instagram could not process the media" or "media not ready" | Instagram is still processing the file, or the image URL could not be fetched | Wait a minute and publish again. Check the image opens at `SITE_URL/media/...`. Videos are finished by the scheduler from Phase 2 |
| "Google Sheets denied access" (403) | The Sheet is not shared with the service account | Share the Sheet with `GOOGLE_SERVICE_ACCOUNT_EMAIL` as **Editor** |
| "Google Sheet not found" (404) | `SHEET_ID` is wrong | Copy the ID from the Sheet URL again |
| "Google sign-in failed" | `GOOGLE_PRIVATE_KEY` lost its `\n` sequences or has extra quotes | Paste the `private_key` value again, unchanged |
| "Login state did not match" after connecting | The browser blocked the cookie, or `SITE_URL` differs from the address you use | Open the dashboard at exactly `SITE_URL` and try again |
| "Too many failed attempts" | Five wrong passwords in 15 minutes | Wait 15 minutes |
| "TOKEN_ENCRYPTION_KEY must be 32 bytes" | The key was pasted incorrectly | Run `npm run secrets` and set the new value |
| "Instagram needs an image" | Instagram was ticked on a text-only post | Add an image or untick Instagram |
| LinkedIn "ACCESS_DENIED" or "not permitted" | The product is not added to the LinkedIn app, or the redirect URI is wrong | Check the Products tab and the Auth tab in step 3 |
| LinkedIn "VERSION_MISSING" or "NONEXISTENT_VERSION" | The `LinkedIn-Version` header is out of date | Update `LINKEDIN_VERSION` in `netlify/functions/lib/config.js` |
| "Company Page publishing is turned off" | `LINKEDIN_ORG_ENABLED` is `false` | Only enable it after Community Management API approval |

---

## Project layout

```
login.html, index.html, compose.html, accounts.html   pages
css/style.css                                          styles (light and dark)
js/                                                    browser modules (no build step)
netlify/functions/                                     API functions (Node 20)
netlify/functions/lib/                                 config, Sheets client, crypto, session, publishers
scripts/                                               setup-sheet, generate-secrets, build-site
tests/                                                 unit and integration tests (npm test)
```

API versions and limits live in one file: `netlify/functions/lib/config.js`. Bump them there.

Deployment note: `netlify.toml` builds into `dist/`, which contains only the browser files. `.env`, scripts and function source are not published.
