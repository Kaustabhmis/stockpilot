# Changelog

## 1.0.0 – 2026-09-30

First release.

- Home page with live-project carousel (10 s auto-advance), commercial listings, completed & sold-out gallery, map, about, blog and contact form
- Buyer landing page (`enquiry.html`) with site-visit form, UTM tracking, FAQ and optional testimonials
- Blog with one pre-rendered SEO page per article
- Admin panel: projects with **Mark Sold Out**, blog posts, commercial listings, image uploads, leads (status, WhatsApp, CSV export) and **Website Content** (all business info and page texts)
- Private Google Sheet backend via Apps Script: hashed admin password, write-only public leads, rate limiting, lead email alerts, automatic website rebuilds
- SEO: pre-rendered HTML, structured data (RealEstateAgent, projects, BlogPosting, FAQ, breadcrumbs), sitemap with images, share image, WCAG AA colours

### Release audit
- HTML validation: 0 errors on all pages; Lighthouse Accessibility 100 and SEO 100 on all pages
- Dependencies: 0 known vulnerabilities (`npm audit`)
- Fixed: leads CSV export now neutralises spreadsheet formulas (`=`, `+`, `-`, `@`)
- Fixed: empty FAQ no longer outputs an empty structured-data block
