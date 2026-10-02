# Changelog

## 2.0.0 – 2026-10-03

Multipage redesign and Google Sheet go-live.

- **New pages:** Home (banner, full-width 3D project carousel at 10 s per project, site-visit enquiry form, project map), Gallery (all projects with filters), one page per project (photo slider, details, highlights, amenities, video, map, enquiry form), About, Contact
- **Admin:** new project fields (possession, overview, highlights, amenities, video, brochure), **View** link, centred confirmation dialogs instead of browser pop-ups, login tolerant of stray spaces with show-password toggle, no backend details on the public login screen
- **Maps:** free OpenStreetMap lite maps (no API key), with a keyless Google Maps embed as backup
- **Google Sheet** connected (Apps Script URL in `config.js`); site address `https://ashirbadenterprise.in`
- **Removed:** all RERA / WBRERA fields, badges, texts, FAQ and structured data
- Fixed: carousel froze after one slide when the computer has animations turned off
- Fixed: Load Sample Data no longer duplicates items when clicked twice
- Fixed: saved links can never run script (`javascript:` URLs are ignored)
- Fixed: `config.js` is no longer cached for a year, so URL changes take effect

### Release audit
- HTML validation: 0 errors on all 23 pages
- Lighthouse: SEO 100 and Accessibility 100 on every page (404 is intentionally not indexed)
- Browser tests: carousel, gallery filters, project pages, all three enquiry forms, admin edits, sold out, dialogs, maps (normal and blocked), login (demo and Google Sheet, using the real `Code.gs`), mobile layout – all passing with no page errors
- Dependencies: 0 known vulnerabilities (`npm audit`)

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
