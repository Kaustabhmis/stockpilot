# Ashirbad Enterprise – Website & Admin Panel

A static site: no build step and no server of your own. Data lives in a private Google Sheet. Host it on any static host (Netlify, Vercel, Cloudflare Pages, Firebase Hosting, GitHub Pages or cPanel).

| Page | Purpose |
|---|---|
| `index.html` | Home: live-project carousel, commercial listings, completed & sold-out gallery, map, about, latest blog posts, contact form |
| `enquiry.html` | Landing page for buyers: site-visit / price-list form. Captures UTM parameters for ad campaigns |
| `blog.html` | Blog list (search and category filter). Single article at `blog.html?post=<slug>` |
| `admin.html` | Admin panel: projects, **Sold Out** button, blog posts, commercial listings, image uploads, leads |
| `privacy.html` | Privacy policy |

## How "Sold Out" works

Every project has a **stage**:

- `live`: shown in the homepage carousel (blue map pin). The carousel auto-advances every **10 seconds** when there is more than one live project (`CAROUSEL_DELAY_MS` in `assets/js/config.js`).
- `sold`: removed from the carousel, shown in the gallery with a red **Sold Out** badge (orange map pin).
- `completed`: shown in the gallery as a completed project.

In **Admin → Projects**, click **Mark Sold Out**. The project leaves the carousel and joins the gallery with the other past projects. Its main image and gallery images become its lightbox slides. **Make Live** reverses it. If every project is sold out, the homepage shows a "New Projects Launching Soon" banner that links to the landing page.

## Demo mode (default)

With `APPS_SCRIPT_URL` left empty in `assets/js/config.js`, the site runs in **demo mode**:

- Data and uploaded images are saved in *this browser only* (IndexedDB), and start from the sample content.
- Admin password: `LOCAL_ADMIN_PASSWORD` in `config.js` (default `ashirbad@admin`).
- Good for trying the admin panel. **Not for production:** visitors never see your edits, and this demo password is visible in the page source.

## Google Sheets setup (production, private)

The website stores everything in **a Google Sheet that you never share**. A small Google Apps Script attached to the sheet is the only thing the website talks to.

What visitors can and cannot do:

| | Visitors | Admin (password) |
|---|---|---|
| Open or find the Google Sheet | ✗ (not shared; its link and ID are not on the site) | via your Google account |
| Read projects, commercial listings, published posts | ✓ (read-only, through the script) | ✓ |
| Read draft posts or leads | ✗ | ✓ |
| Submit an enquiry | ✓ (validated, rate-limited, always saved as "New") | ✓ |
| Edit, delete or upload | ✗ | ✓ |

The admin password is stored only inside the script, as a salted SHA-256 hash, never in the website files. Admin sessions expire after 6 hours.

### Steps (about 10 minutes)

1. **Create the sheet.** Go to <https://sheets.new> and give it any name (for example *Website Data*). Keep it private: do **not** use "Share", and do **not** use "Publish to the web".
2. **Add the script.** In the sheet, open **Extensions → Apps Script**. Delete the sample code, paste the entire contents of `google-apps-script/Code.gs`, then click **Save**.
3. **Run setup.** Reload the sheet; a **Website Admin** menu appears. Choose **Website Admin → 1. Create / repair tabs** and approve the permission prompt. It asks for access to this sheet, to Drive (for image uploads), and to send email (for lead alerts). This creates the `projects`, `commercial`, `posts` and `leads` tabs and a private Drive folder called **Website Media**.
4. **Set the admin password.** Choose **Website Admin → 2. Set admin password** and enter at least 10 characters.
5. *(Optional)* **Lead email alerts.** Choose **Website Admin → 3. Set lead notification email** to get an email for every new enquiry.
6. **Deploy.** In the Apps Script editor, choose **Deploy → New deployment → ⚙ Select type → Web app**:
   - *Execute as:* **Me**
   - *Who has access:* **Anyone** (this lets the *website* call the script; it does **not** share the sheet)

   Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).
7. **Connect the site.** Paste the URL into `assets/js/config.js`:
   ```js
   APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfy.../exec',
   ```
8. **Add content.** Open `admin.html`, sign in with your password, and go to **Settings → Load Sample Data** (or start adding your own).

**After editing `Code.gs` later:** in Apps Script choose **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy**. The URL stays the same.

### Good to know

- The script's Web App URL is visible in the website code, as every website's backend address is. It only accepts the actions listed above; it cannot be used to open, list or download the sheet.
- Uploaded images go to the private **Website Media** Drive folder. Each image *file* is shared "anyone with the link can view" so the website can display it; the folder, the sheet and your other files stay private. Some Google Workspace organisations block link sharing, in which case paste image URLs from your own hosting instead.
- You can also edit rows directly in the sheet (for example to fix a typo). Changes appear on the website within about 5 minutes (server cache), or immediately after any save in the admin panel.
- **Website Admin → Sign out all admin sessions** revokes every logged-in admin at once. Setting a new password also signs everyone out.
- Limits: Google Apps Script's free quotas comfortably handle a builder's website (thousands of visits and enquiries per day). Visitors' browsers cache the public data, so repeat visits load instantly.

## Other configuration (`assets/js/config.js`)

- `GOOGLE_MAPS_API_KEY`: enables the interactive map. Until it is set, the map section shows a list of Google Maps links. Restrict the key to your domain in Google Cloud Console.
- `WHATSAPP_NUMBER`, `PHONE`, `EMAIL`, `ADDRESS`, `SITE_URL`: contact details used across all pages.
- Also update the hard-coded contact details and domain in the `<head>` meta tags and JSON-LD of each page, and in `sitemap.xml` / `robots.txt`.
- The admin page is at `/admin.html`. It is not linked from the public site and tells search engines not to index it.

## Writing blog posts

In the article content box, leave a blank line between paragraphs. Start a line with `## ` for a heading and `- ` for a bullet point. The **Short Summary** is used on cards and as the page's SEO description.

## Files

```
assets/js/config.js   site settings (edit this)
assets/js/store.js    data layer – private Google Sheet (via Apps Script) or browser storage
assets/js/common.js   Tailwind theme, header/footer, modals, helpers
assets/css/site.css   shared styles
google-apps-script/Code.gs   the private backend – paste into your sheet's Apps Script
1000365300.jpg        logo
```
