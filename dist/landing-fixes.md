# Landing page — three corrections to paste in

Each is a find-and-replace in your `index.html`. None of them touch the app.

---

## 1. Your structured data tells Google the product is free

You currently declare `"price": "0"` while selling ₹2,499/mo and ₹19,999/yr.
Google treats structured data that contradicts the visible page as misleading,
which risks a manual action against the whole domain — and it is the same block
that drives rich results, so it is working against you either way.

**Find** the `<script type="application/ld+json">` block and **replace it whole**:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Dome Box",
  "applicationCategory": "BusinessApplication",
  "applicationSubCategory": "Task Management Software",
  "operatingSystem": "Web browser",
  "url": "https://www.domebox.in",
  "description": "Task and team management software for Indian MSMEs, with delegation scoring, KRA/KPI tracking and automated performance appraisals.",
  "inLanguage": "en-IN",
  "publisher": {
    "@type": "Organization",
    "name": "BISCS India",
    "url": "https://www.domebox.in",
    "email": "info@biscsindia.com"
  },
  "offers": [
    { "@type": "Offer", "name": "Free Tier", "price": "0", "priceCurrency": "INR",
      "description": "Up to 5 users, 50 tasks per month" },
    { "@type": "Offer", "name": "Standard", "price": "2499", "priceCurrency": "INR",
      "description": "Up to 20 users, 500 tasks per month",
      "priceSpecification": {
        "@type": "UnitPriceSpecification", "price": "2499", "priceCurrency": "INR",
        "referenceQuantity": { "@type": "QuantitativeValue", "value": "1", "unitCode": "MON" } } },
    { "@type": "Offer", "name": "Pro Yearly", "price": "19999", "priceCurrency": "INR",
      "description": "Up to 300 users, unlimited tasks",
      "priceSpecification": {
        "@type": "UnitPriceSpecification", "price": "19999", "priceCurrency": "INR",
        "referenceQuantity": { "@type": "QuantitativeValue", "value": "1", "unitCode": "ANN" } } }
  ]
}
</script>
```

There is deliberately **no `aggregateRating`**. Emitting one without verifiable
reviews is a documented cause of manual actions, and under the Consumer
Protection (E-Commerce) Rules it is a compliance problem too. Add it once you
have real, collectable reviews.

## 2. "Dome Box Inc." is not your company

**Find:** `© 2026 Dome Box Inc. All rights reserved.`
**Replace:**

```html
&copy; 2026 <strong>BISCS India</strong>. Dome Box is a product of BISCS India.
```

Razorpay checks that the entity on your site matches the entity on the account.
A company name that does not legally exist is also what a customer sees on a GST
invoice, and it is the first thing a disputing customer's lawyer looks at.

## 3. Add the tags you are missing

Paste inside `<head>`, after the existing `og:` tags:

```html
<link rel="canonical" href="https://www.domebox.in/">
<meta property="og:url" content="https://www.domebox.in/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Dome Box">
<meta property="og:locale" content="en_IN">
<meta property="og:image" content="https://www.domebox.in/og-cover.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Dome Box — Task & Team Management for Indian MSMEs">
<meta name="twitter:description" content="Automate accountability with delegation scoring, KRA/KPI tracking and performance appraisals.">
<meta name="twitter:image" content="https://www.domebox.in/og-cover.png">
<meta name="robots" content="index, follow, max-image-preview:large">
```

You need a real `og-cover.png` at 1200×630. Without it, every WhatsApp and
LinkedIn share of your link renders as a grey box — which matters more than
usual for you, because WhatsApp is how this product will actually spread.

---

## Also worth doing, in order of payoff

**Replace the Tailwind play CDN.** `cdn.tailwindcss.com` compiles in the
browser on every visit. It is the single biggest drag on your load time, it
prints a "should not be used in production" warning in the console, and Google
Ads scores landing-page speed. The compiled stylesheet for the classes you
actually use is **9.4 KB** — I built it earlier and sent it as
`tailwind.min.css`. Swap:

```html
<script src="https://cdn.tailwindcss.com"></script>
```

for:

```html
<link rel="stylesheet" href="/tailwind.min.css">
```

Check the page afterwards: any class added later that was not in the file when I
compiled it will need a rebuild.

**Replace the hero image.** It is an Unsplash stock photo of an office, with
`alt="Dashboard"`. Buyers of task software want to see the software. Now that
the app runs, I can generate real screenshots for it.

**Write the policy pages properly.** Privacy and Terms are one sentence each.
Razorpay rejects placeholders at review, and you are holding employee
performance data, which puts you under the DPDP Act 2023 — you need purpose,
retention and deletion stated. You also have no Refund/Cancellation page at all,
which Razorpay requires.

**Reconcile the WhatsApp claim.** "WhatsApp Alerts" is sold on Pro and
Enterprise. The channel is built now, but it cannot send until your Meta
business verification and template approval are through. Until then, either mark
it "coming soon" on the pricing table or hold off selling Pro on that basis.
