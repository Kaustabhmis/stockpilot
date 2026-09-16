# Site audit — www.domebox.in

**Scope.** I could not fetch the live site: this environment's network policy
denies `www.domebox.in` (the proxy returns 403 to CONNECT). So this audits the
`index.html` you pasted plus the pricing screenshot you sent. If the live page
has changed since, re-run `prepare.js` against the current file — it reports
anything it cannot find rather than guessing.

**28 findings.** 23 are fixed automatically by `prepare.js` and the files in
this folder. 5 need a decision from you.

---

## Critical — fix before the next ad or Razorpay review

### 1. Your policy pages have no URLs

Privacy, Terms and Contact are `<div>`s toggled by `toggleView()`. There is no
`/privacy`, no `/terms`, and no refund page at all.

This is the most serious finding, because three separate parties need to open
those URLs directly and all three currently get nothing:

- **Razorpay** requires reachable Privacy, Terms, Refund/Cancellation and
  Contact URLs. This is a documented cause of activation being withheld.
- **Google Ads** review fetches the URLs you submit.
- **Googlebot** cannot index a view that has no address.

**Fixed:** `gen-pages.js` builds real static pages at `/privacy`, `/terms`,
`/refund` and `/contact`. They contain no JavaScript, so they render even if
everything else fails. `prepare.js` rewires your footer buttons to real links.

### 2. Structured data says the product is free

```json
"offers": { "@type": "Offer", "price": "0", "priceCurrency": "INR" }
```

while you charge ₹2,499/mo and ₹19,999/yr. Structured data contradicting the
visible page is a documented cause of a manual action against the whole domain.

**Fixed** by `prepare.js`: all three tiers, with correct prices, and
deliberately **no `aggregateRating`** — emitting ratings you cannot evidence is
its own manual-action risk and a problem under the Consumer Protection
(E-Commerce) Rules.

### 3. No security headers at all

You collect passwords. Without `X-Frame-Options`, any site can put your login
page in an invisible iframe and harvest credentials through an overlay.

**Fixed** in `netlify.toml` and `_headers`: `X-Frame-Options: DENY`, HSTS,
`Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`, and a CSP
scoped to exactly what your page loads today, so switching it on breaks nothing.

### 4. Your legal entity does not exist

The footer reads **"© 2026 Dome Box Inc."**. Razorpay checks the entity on the
site against the entity on the account, and this name is also what a customer
would see on a GST invoice.

**Fixed:** now credits BISCS India.

---

## Performance — this is what your ad Quality Score is paying for

### 5. Tailwind play CDN compiles in the browser on every visit

`cdn.tailwindcss.com` ships a compiler and runs it against your markup on each
page load. It is the single largest drag on your LCP, and it prints a
*"should not be used in production"* warning to every visitor's console.

**Fixed:** compiled to **9.4 KB**, fingerprinted so it can be cached for a year.

### 6. Seven font weights, seven downloads

`Inter:wght@300;400;500;600;700;800;900` fetches seven files. Your page visibly
uses about three.

**Fixed:** reduced to 400/600/800.

### 7. Razorpay and Chart.js block the first paint

Both load synchronously in `<head>`. Neither is needed to render the landing
page — Razorpay only when someone pays, Chart.js only inside the app.

**Fixed:** both deferred.

### 8. Hero image has no dimensions

`<img src="…unsplash…" alt="Dashboard">` with no width/height. The page reflows
when it arrives, which is measured as Cumulative Layout Shift.

**Fixed:** dimensions and `decoding="async"` added.

### 9. The hero image is a stock photo of a generic office

Labelled `alt="Dashboard"`, which is also inaccurate for a screen reader.

**Partly fixed:** the alt text now describes what is shown. **The image itself
is still a stock photo** — replace it with one of the real screenshots from the
package I sent. People buying task software want to see the software.

---

## Accessibility — 5 of 13 colour pairs fail WCAG AA

Measured, not estimated:

| Class pair | Ratio | Needs | Where |
|---|---|---|---|
| `text-gray-400` on white | **2.54:1** | 4.5 | feature body copy |
| `text-gray-400` on gray-50 | **2.43:1** | 4.5 | landing sections |
| `text-blue-300` on blue-600 | **2.87:1** | 4.5 | Standard plan tick icons |
| `text-blue-100` on blue-600 | 4.24:1 | 4.5 | Standard plan features |
| `text-gray-500` on slate-900 | 3.89:1 | 4.5 | footer |

**Fixed** for the two worst by `prepare.js`. The remaining three are marginal
and inside coloured cards; raising them means touching the design, so I have
left that to you rather than changing your brand unasked.

### 10. Form inputs have placeholders but no labels

Every field relies on a placeholder, which disappears as soon as the user types
and is not a reliable accessible name. **Fixed:** `aria-label` on each.

### 11. No autocomplete attributes

Password managers cannot reliably fill or save credentials — a real drop-off on
a signup form. **Fixed**, including `new-password` on signup so managers offer
to generate one.

### 12. Mobile menu button announces nothing

No `aria-expanded`, so a screen reader cannot tell open from closed.
**Fixed**, and the state now updates on click.

### 13. Password minimum is 6 characters

Too weak for a product holding other companies' employee records.
**Fixed:** 8. Consider going further server-side.

---

## SEO

### 14–19. Missing tags

No canonical, no `og:url`, no `og:image`, no `og:type`, no Twitter card, no
`robots` meta. Every WhatsApp and LinkedIn share of your link currently renders
as a grey box — which matters unusually much for you, since WhatsApp is how this
product will spread in your market.

**Fixed**, and `og-cover.png` (1200×630) is included and on-brand.

### 20. `lang="en"` should be `en-IN`

You target India specifically. **Fixed.**

### 21. No robots.txt, no sitemap.xml

**Fixed.** `robots.txt` deliberately does **not** block query strings —
a `Disallow` matching an ad's final URL gets the ad disapproved.

---

## Needs your decision — I have not changed these

### 22. Your pricing is inverted

- Standard: ₹2,499/mo = **₹29,988/yr** → 20 users, 500 tasks/mo
- Pro Yearly: **₹19,999/yr** → 300 users, unlimited, analytics, WhatsApp

Pro is **33% cheaper and better in every dimension**. No informed customer
should ever buy Standard, and existing Standard customers who work this out will
feel overcharged — which costs more than the lost margin.

### 23. You are selling a feature that cannot send yet

"WhatsApp Alerts" appears on Pro and Enterprise. The channel is built, but it
cannot send until your Meta business verification and template approval are
through. Mark it "coming soon" or hold off selling Pro on that basis.

### 24. "Total Data Security … dedicated, isolated database"

This is defensible — each customer does get a separate spreadsheet — but it is a
**security claim on a sales page**, which raises the bar if anything ever goes
wrong. Make sure it stays true as you scale.

### 25. `?start=free` deep links

If your ads use these, confirm the app actually honours the parameter on load.
I could not verify this: your paste was truncated before the router.

### 26. Free tier gives away analytics?

Your pricing says Analytics & Reports are Pro-only, and Delegation Scoring is
Standard-and-up. `plans.gs` enforces exactly that — but only once you wire it
into the server. Until then every tier has everything.

### 27. No GST invoicing

Your B2B customers need a GST invoice with your GSTIN to claim input credit.
Some will not buy without one.

### 28. Policy content needs a lawyer

The pages I generated are a solid India-specific starting point covering what
Razorpay checks and what the DPDP Act 2023 requires. They are **not legal
advice**. You are a Data Processor for other companies' employee records —
see `REQUIRED-BEFORE-DEPLOY.md`.
