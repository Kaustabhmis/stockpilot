# Deploying to Netlify

> Part of the full walkthrough in [`../SETUP.md`](../SETUP.md). This file is
> the site in detail; that one puts it in order with everything else.

Your site is live with paying customers. This deploys **www.domebox.in** — the
landing page, the application itself, the marketing pages and the policy pages.
It does not touch your Apps Script backend or any customer's data, and Netlify
keeps every previous deploy, so a bad one is one click to undo.

---

## Step 1 — the two things the build will refuse without

**`API_URL`** — your Apps Script `/exec` URL. It is not in the repository,
because it is deployment config rather than source. Set it in
**Site configuration → Environment variables**.

Without it the build fails. That is deliberate: an `index.html` with the
placeholder still in it renders perfectly, is styled, shows the right prices —
and then every login, signup and payment fails with a network error. A build
that shipped that would be worse than one that did not run.

**`site-config.json`** — eight company fields, all currently blank:

```
registeredAddress   phone              gstin             entityType
registrationNumber  grievanceOfficer   jurisdictionCity  jurisdictionState
```

Without them the privacy, terms, refund and contact pages are not built — and
those four URLs are the **only** internal links on the homepage, so the footer
of your live site would be four broken links. The build fails rather than let
that happen. `REQUIRED-BEFORE-DEPLOY.md` says what each field is and where to
find it.

To put up a preview without them anyway, set `ALLOW_MISSING_LEGAL=1`. Do not
set it on the production site.

## Step 2 — connect the repository

| Setting | Value |
|---|---|
| Base directory | `netlify` |
| Build command | `node build.js` |
| Publish directory | `netlify` |
| Environment | `API_URL` = your `/exec` URL |

There is nothing to install. The build is Node's standard library reading files
that are already committed: the stylesheet was compiled into `dist/index.html`
when that file was built, so the deploy cannot fail on a toolchain it does not
have.

**Drag and drop does not work any more** and should not be used. The build now
reads `../dist/index.html`, which is outside the folder you would drop.

## Step 3 — what a deploy produces

```
index.html        the app and landing page, API_URL substituted in
pricing.html      ┐
features.html     │ 8 marketing/SEO pages, regenerated every deploy
guides.html       ┘ from seo-content.js
privacy.html      ┐
terms.html        │ 4 policy pages, from site-config.json
refund.html       │
contact.html      ┘
404.html          branded, noindex
sitemap.xml       only the pages that actually exist
robots.txt        nothing disallowed
```

The sitemap is rebuilt **after** the pages, from what is on disk. A URL that
404s is not a cosmetic error — Google reports it as a crawl failure against the
whole property — and the four legal URLs used to be listed whether or not
anything had built them.

## Step 4 — check it before pointing the domain at it

Deploy to the Netlify subdomain first and walk through:

- [ ] The homepage renders **styled** (if it is unstyled, `dist/index.html` was
      built wrong — the build checks for this, but look anyway)
- [ ] Sign in with a real account. If it fails, `API_URL` is wrong.
- [ ] `/privacy`, `/terms`, `/refund`, `/contact` all load
- [ ] The footer links go to those URLs
- [ ] Your real company details are on the policy pages — **not placeholders**
- [ ] Nothing in the browser console
- [ ] A made-up URL shows your 404, not Netlify's

## Step 5 — domain

**Site configuration → Domain management**: add `domebox.in` and
`www.domebox.in`, set one as **primary**. Netlify issues the 301 from the other.

Do **not** add your own apex-to-www rule to `_redirects`. On top of Netlify's
own redirect it produces a loop, and a loop takes the whole site down rather
than one page. `_redirects` is deliberately left without one, and
`tests/netlify-test.js` fails if somebody adds one.

DNS: either move nameservers to Netlify DNS, or CNAME to your Netlify
subdomain. HTTPS is provisioned automatically once DNS resolves. **Wait for the
certificate before sending real traffic** — HSTS is in the headers and tells
browsers to refuse plain HTTP to your domain for a year.

## Step 6 — verify in production

```bash
# the headers are actually served
curl -sI https://www.domebox.in | grep -i "strict-transport\|x-frame\|content-security"

# every clean URL resolves
for u in "" pricing features guides privacy terms refund contact; do
  printf "%-10s " "/$u"; curl -s -o /dev/null -w "%{http_code}\n" "https://www.domebox.in/$u"
done

# a missing page is a real 404, not a 200
curl -s -o /dev/null -w "%{http_code}\n" https://www.domebox.in/no-such-page
```

Then:

- <https://search.google.com/test/rich-results> — the offers should be
  recognised, with no rating warnings (there is no Review schema, deliberately:
  none of it would be verifiable).
- Paste the URL into WhatsApp to yourself; the cover image should appear.
- Submit `https://www.domebox.in/sitemap.xml` in Google Search Console.
- Give Razorpay the four policy URLs.

---

## Rollback

**Deploys → pick the previous one → Publish deploy.** Instant, and it is why
deploying this site is far lower-risk than deploying the Apps Script backend.

## What this does not cover

The backend. `index.html` talks to your Apps Script web app over `API_URL`, and
nothing in this folder changes that deployment, your spreadsheets, or any
customer's data. See `DEPLOY-NEW.md` at the repository root for the backend.
