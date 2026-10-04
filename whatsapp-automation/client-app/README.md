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

No build step, no server, no framework. The only external script is the SheetJS Excel reader, loaded from cdnjs when a
client uploads a file. See `../GUIDE.md` Part 15 for details.
