# Deploying to Netlify

Your site is live with paying customers. This deploys the **public marketing
site and policy pages**. It does not touch your Apps Script backend or any
customer's data.

---

## Step 1 — fill in your company details

```bash
# edit site-config.json: address, phone, GSTIN, entity type,
# registration number, grievance officer, jurisdiction
```

`gen-pages.js` refuses to build while any of those is blank. See
`REQUIRED-BEFORE-DEPLOY.md` for what each one is.

## Step 2 — build

```bash
cd netlify
node gen-pages.js                    # policy pages + 404
node prepare.js /path/to/your/index.html
```

`prepare.js` writes a patched `index.html` **into this folder** and leaves your
original alone. Read its report: anything under *NOT FOUND* is a pattern that
has changed since the audit and needs a look.

## Step 3 — check it locally before it goes anywhere near the internet

```bash
python3 -m http.server 8080
```

Open <http://localhost:8080> and walk through:

- [ ] Landing page renders correctly **without** the Tailwind CDN
- [ ] Login and signup still work
- [ ] `/privacy`, `/terms`, `/refund`, `/contact` all load
- [ ] Footer links point at those URLs, not `toggleView(...)`
- [ ] Nothing in the console
- [ ] Your real company details appear on the policy pages — **not placeholders**

That last one matters: during testing this folder briefly held pages with a
fabricated GSTIN. They are deleted and git-ignored, but check anyway.

## Step 4 — deploy

**Drag and drop:** open <https://app.netlify.com/drop> and drag this `netlify`
folder in. Netlify reads `netlify.toml`, `_headers` and `_redirects` from inside
the folder you drop.

**Or connect the repo:**

| Setting | Value |
|---|---|
| Base directory | `netlify` |
| Build command | *(leave empty)* |
| Publish directory | `netlify` |

There is no build step. It is static files.

## Step 5 — domain

In **Site configuration → Domain management**, add `domebox.in` and
`www.domebox.in`, then set one as **primary**. Netlify issues the 301 from the
other automatically.

Do **not** add your own apex-to-www rule in `_redirects`. Combined with
Netlify's own redirect it produces a loop. `_redirects` is deliberately left
without one.

DNS: either move your nameservers to Netlify DNS, or point a CNAME at your
Netlify subdomain. HTTPS is provisioned automatically once DNS resolves —
**wait for the certificate before enabling HSTS traffic**, which is already in
the headers and instructs browsers to refuse plain HTTP for a year.

## Step 6 — verify in production

```bash
# headers are actually being served
curl -sI https://www.domebox.in | grep -i "strict-transport\|x-frame\|content-security"

# clean policy URLs resolve
for u in privacy terms refund contact; do
  echo -n "$u: "; curl -s -o /dev/null -w "%{http_code}\n" https://www.domebox.in/$u
done

# a missing page returns a real 404, not a 200
curl -s -o /dev/null -w "%{http_code}\n" https://www.domebox.in/no-such-page
```

Then:

- Paste your URL into <https://search.google.com/test/rich-results> — the three
  offers should be recognised and there should be no rating warnings.
- Paste it into WhatsApp to yourself and confirm the cover image appears.
- Submit `https://www.domebox.in/sitemap.xml` in Google Search Console.
- Give Razorpay the four policy URLs.

---

## Rollback

Netlify keeps every deploy. **Deploys → pick the previous one → Publish deploy.**
It is instant, and it is why deploying the site is much lower-risk than
deploying the Apps Script backend.

---

## What this does not cover

The `index.html` this produces still contains your whole application inline. The
app code, the login, and every call to Apps Script are unchanged — I have only
patched the markup around them. Your backend, your spreadsheets and your
customers' data are untouched by anything here.
