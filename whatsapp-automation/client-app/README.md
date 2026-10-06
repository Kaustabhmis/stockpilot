# Client app (white-label, host on your domain)

A static website for your clients: sign in, build WhatsApp ads (image + text + button) with a protected preview,
upload customers from Excel/CSV, and launch or schedule campaigns. It talks to the Apps Script backend as a JSON API,
so clients never see Apps Script or Google.

1. Edit `config.js`:
   - `apiUrl`: your Apps Script Web App `/exec` URL (spreadsheet menu: **WhatsApp Automation → Show Client App URLs**)
   - `brandName`, `logoUrl`, `primaryColor`, `supportText`: your branding
2. Upload `index.html` + `config.js` (+ your logo) to any HTTPS static host: Netlify, Vercel, Cloudflare Pages,
   Firebase Hosting, GitHub Pages, or cPanel `public_html`. Attach your domain, e.g. `app.yourbrand.com`.
3. Set the hosted address in the spreadsheet: `SETTINGS → CLIENT_APP_URL`.
4. Create client logins from the spreadsheet menu (**Create Client Login**) and send each client the URL + access code.

**Try it first:** open `index.html` directly (or add `?demo` to the hosted URL) and click **Preview with demo data**.
Demo mode uses built-in sample data, and nothing is saved or sent.

`_headers` sets security headers on Netlify / Cloudflare Pages, including blocking other sites from framing the app. On other
hosts, set the same headers (`X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`) in their settings.

No build step, no server, no framework. The only external script is the SheetJS Excel reader, loaded from cdnjs when a
client uploads a file. See `../GUIDE.md` Part 15 for details.

## Hosting on a subdomain (example: `wa.biscsindia.com`)

Upload these files to the subdomain's folder: `index.html`, `config.js`, `legal.html`, `.htaccess` (Apache/cPanel/Hostinger), `_headers` (Netlify/Cloudflare).

**Hostinger (hPanel)**
1. hPanel → **Websites** → *biscsindia.com* → **Manage** → **Domains → Subdomains** → create `wa` (folder `public_html/wa`).
2. **Security → SSL** → make sure `wa.biscsindia.com` shows an active SSL (install the free one if not; it can take up to ~30 min).
3. **Files → File Manager** → `public_html/wa` → **Upload** the zip → right-click → **Extract** → delete the zip.
   To see `.htaccess`, turn on hidden files in the File Manager settings.
4. Edit `config.js` (right-click → Edit): set `apiUrl` and your branding → Save.
5. Open `https://wa.biscsindia.com/?demo`, then `https://wa.biscsindia.com`.
If the domain does not use Hostinger nameservers, add an **A record** `wa` → the IP shown in hPanel (Hosting → Details) at your DNS provider.

**cPanel hosting (GoDaddy, BigRock, …)**
1. cPanel → **Domains** (or **Subdomains**) → create `wa.biscsindia.com`. Note its document root, e.g. `public_html/wa`.
2. cPanel → **SSL/TLS Status** (or **Let's Encrypt / AutoSSL**) → issue a certificate for `wa.biscsindia.com`.
3. **File Manager** → open the document root → **Upload** the zip → **Extract**. (`.htaccess` is a hidden file: enable "Show hidden files" to see it.)
4. Edit `config.js` there: set `apiUrl` to your Apps Script `/exec` URL and your branding.
5. Open `https://wa.biscsindia.com/?demo` to check the app, then `https://wa.biscsindia.com` to sign in.

**If your DNS is managed elsewhere** (Cloudflare, GoDaddy DNS, …): add an **A record** `wa` → your hosting server's IP
(shown in cPanel → Server Information). DNS changes can take from a few minutes up to 24 hours.

**Netlify / Cloudflare Pages instead**: deploy the folder, add the custom domain `wa.biscsindia.com`, then at your DNS
provider add a **CNAME** `wa` → the target they show (e.g. `your-site.netlify.app`). HTTPS is automatic.

Finally, in the spreadsheet set **SETTINGS → CLIENT_APP_URL** = `https://wa.biscsindia.com`.
