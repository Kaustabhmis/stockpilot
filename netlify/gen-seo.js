#!/usr/bin/env node
/**
 * Builds the SEO/marketing pages, and the sitemap FROM THE SAME LIST.
 *
 * A hand-maintained sitemap is wrong within a month — it lists pages that were
 * renamed and misses pages that were added, and both cost you indexing. There
 * is one manifest here; the pages and the XML are two renderings of it, so they
 * cannot disagree.
 *
 *   node gen-seo.js        writes the pages, sitemap.xml and robots.txt
 *   node gen-seo.js --check  verifies without writing (use in CI)
 */
const fs = require('fs'), path = require('path');
const here = __dirname;
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'site-config.json'), 'utf8'));
const CHECK = process.argv.includes('--check');

const C = {
  productName: cfg.productName || 'Dome Box',
  legalEntity: cfg.legalEntity || 'BISCS India',
  domain: (cfg.domain || 'www.domebox.in').replace(/^https?:\/\//, '').replace(/\/$/, ''),
  supportEmail: cfg.supportEmail || 'info@biscsindia.com',
};
const BASE = 'https://' + C.domain;
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const pages = require('./seo-content.js')(C);

/* The legal pages are built by gen-pages.js but still belong in the sitemap —
   listed here so there is exactly one place that knows what this site contains. */
const LEGAL = [
  { slug: 'privacy', changefreq: 'yearly', priority: '0.3' },
  { slug: 'terms',   changefreq: 'yearly', priority: '0.3' },
  { slug: 'refund',  changefreq: 'yearly', priority: '0.3' },
  { slug: 'contact', changefreq: 'monthly', priority: '0.5' },
];

/* ---------------------------------------------------------------- the shell */
const nav = `
<header>
  <a class="brand" href="/"><svg width="26" height="26" viewBox="0 0 100 100" aria-hidden="true">
    <path d="M12 52 A38 38 0 0 1 88 52 L88 76 A12 12 0 0 1 76 88 L24 88 A12 12 0 0 1 12 76 Z" fill="#5b4bdb"/>
    <path d="M35 55 L46 66 L67 42" fill="none" stroke="#fff" stroke-width="10"
          stroke-linecap="round" stroke-linejoin="round"/></svg>
    <span>Dome Box</span></a>
  <nav>
    <a href="/features">Features</a>
    <a href="/pricing">Pricing</a>
    <a href="/guides">Guides</a>
    <a class="nav-cta" href="/?signup=1">Start free</a>
  </nav>
</header>`;

const foot = `
<footer>
  <p><strong>${esc(C.productName)}</strong> — task and team management for Indian MSMEs,
     by ${esc(C.legalEntity)}.</p>
  <p class="links">
    <a href="/features">Features</a><a href="/pricing">Pricing</a><a href="/guides">Guides</a>
    <a href="/delegation-score">How scoring works</a><a href="/alternatives">Comparison</a>
  </p>
  <p class="links">
    <a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/refund">Refunds</a>
    <a href="/contact">Contact</a><a href="mailto:${esc(C.supportEmail)}">${esc(C.supportEmail)}</a>
  </p>
  <p class="copy">&copy; ${new Date().getFullYear()} ${esc(C.legalEntity)}.</p>
</footer>`;

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#faf8f5;color:#1b1726;
  font:16px/1.75 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
header{background:#fff;border-bottom:1px solid #e7e1d8;padding:14px 24px;display:flex;
  align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;position:sticky;top:0;z-index:9}
.brand{display:flex;align-items:center;gap:8px;font-weight:900;font-size:19px;
  letter-spacing:-.02em;color:#1b1726;text-decoration:none}
nav a{color:#5a5258;text-decoration:none;font-weight:700;font-size:14px;margin-left:18px}
nav a:hover{color:#5b4bdb}
.nav-cta{background:#5b4bdb;color:#fff !important;padding:9px 16px;border-radius:10px}
main{max-width:800px;margin:0 auto;padding:44px 24px 72px}
h1{font-size:36px;font-weight:900;letter-spacing:-.025em;margin:0 0 10px;line-height:1.15}
.lede{font-size:18px;color:#453f4c;font-weight:600;margin:0 0 34px}
h2{font-size:23px;font-weight:900;margin:44px 0 12px;letter-spacing:-.015em}
h3{font-size:17px;font-weight:800;margin:28px 0 6px}
p,li{color:#453f4c}
ul,ol{padding-left:22px}
li{margin:7px 0}
a{color:#4a3bc4}
strong{color:#1b1726}
table{width:100%;border-collapse:collapse;margin:18px 0;font-size:15px;background:#fff;
  border:1px solid #e7e1d8;border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:11px 14px;border-bottom:1px solid #f1ede9;vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#7d7570;font-weight:900;
  background:#faf8f5}
tbody tr:last-child td{border-bottom:none}
.formula{background:#fff;border:2px solid #cdc5f8;border-radius:14px;padding:18px 22px;
  font-size:19px;font-weight:900;color:#1b1726;text-align:center;margin:20px 0}
.cta{background:#fff;border:2px solid #cdc5f8;border-radius:18px;padding:26px;margin:40px 0 0;
  text-align:center}
.cta p{margin:0 0 14px;font-size:17px}
.btn{display:inline-block;background:#5b4bdb;color:#fff;text-decoration:none;font-weight:800;
  padding:13px 26px;border-radius:12px}
.fine{color:#7d7570;font-size:13px;font-weight:600;margin:12px 0 0 !important}
.cards{display:grid;gap:12px;margin:24px 0}
.card{display:block;background:#fff;border:1px solid #e7e1d8;border-radius:14px;padding:18px 20px;
  text-decoration:none}
.card:hover{border-color:#b3a7f2}
.card strong{display:block;color:#4a3bc4;font-size:16px;margin-bottom:4px}
.card span{display:block;color:#5a5258;font-size:14px;line-height:1.6}
.crumb{font-size:13px;font-weight:700;color:#7d7570;margin:0 0 18px}
.crumb a{color:#7d7570;text-decoration:none}
.crumb a:hover{text-decoration:underline}
.faq{margin-top:48px}
.faq h2{margin-top:0}
.faq details{background:#fff;border:1px solid #e7e1d8;border-radius:12px;padding:14px 18px;margin:8px 0}
.faq summary{font-weight:800;cursor:pointer;color:#1b1726}
.faq p{margin:10px 0 0}
footer{background:#fff;border-top:1px solid #e7e1d8;padding:30px 24px 40px;margin-top:40px}
footer p{max-width:800px;margin:0 auto 8px;font-size:14px;color:#5a5258}
footer .links a{color:#5a5258;text-decoration:none;font-weight:700;margin-right:16px}
footer .links a:hover{color:#5b4bdb}
footer .copy{color:#a79f95;font-size:13px}
@media(max-width:600px){h1{font-size:28px}main{padding:32px 18px 56px}nav a{margin-left:12px}}`;

function jsonld(p) {
  const graph = [
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: BASE + '/' },
      { '@type': 'ListItem', position: 2, name: p.title, item: BASE + '/' + p.slug },
    ]},
    { '@type': 'Article', headline: p.h1, description: p.description,
      mainEntityOfPage: BASE + '/' + p.slug, inLanguage: 'en-IN',
      author: { '@type': 'Organization', name: C.legalEntity },
      publisher: { '@type': 'Organization', name: C.legalEntity,
                   logo: { '@type': 'ImageObject', url: BASE + '/og-cover.png' } } },
  ];
  /* FAQPage only where there are real questions on the page. Marking up
     questions a reader cannot see is exactly what the structured-data
     guidelines call out, and it is the kind of thing that earns a manual
     action rather than a rich result. */
  if (p.faq && p.faq.length) {
    graph.push({ '@type': 'FAQPage', mainEntity: p.faq.map(([q, a]) => ({
      '@type': 'Question', name: q,
      acceptedAnswer: { '@type': 'Answer', text: a } })) });
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
}

function faqHtml(p) {
  if (!p.faq || !p.faq.length) return '';
  return `<section class="faq"><h2>Common questions</h2>` +
    p.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('') +
    `</section>`;
}

const render = (p) => `<!DOCTYPE html>
<html lang="en-IN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(p.title)} | ${esc(C.productName)}</title>
<meta name="description" content="${esc(p.description)}">
<link rel="canonical" href="${BASE}/${p.slug}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${esc(C.productName)}">
<meta property="og:locale" content="en_IN">
<meta property="og:title" content="${esc(p.title)} | ${esc(C.productName)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${BASE}/${p.slug}">
<meta property="og:image" content="${BASE}/og-cover.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(p.title)}">
<meta name="twitter:description" content="${esc(p.description)}">
<meta name="twitter:image" content="${BASE}/og-cover.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800;900&display=swap" rel="stylesheet">
<script type="application/ld+json">${jsonld(p)}</script>
<style>${CSS}</style>
</head>
<body>
${nav}
<main>
<p class="crumb"><a href="/">Home</a> › ${esc(p.title)}</p>
<h1>${esc(p.h1)}</h1>
${p.body}
${faqHtml(p)}
</main>
${foot}
</body>
</html>
`;

/* ------------------------------------------------------------------ sitemap */
const today = new Date().toISOString().slice(0, 10);
const urls = [
  { loc: BASE + '/', changefreq: 'weekly', priority: '1.0' },
  ...pages.map((p) => ({ loc: BASE + '/' + p.slug,
    changefreq: p.changefreq || 'monthly', priority: p.priority || '0.6' })),
  ...LEGAL.map((p) => ({ loc: BASE + '/' + p.slug,
    changefreq: p.changefreq, priority: p.priority })),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;

const robots = `User-agent: *
Allow: /

# Deliberately NOT blocking /?start= or any query string. Google Ads and
# Facebook both crawl the exact final URL of an ad; a Disallow that matches it
# gets the ad disapproved for an unreachable destination.

Sitemap: ${BASE}/sitemap.xml
`;

/* -------------------------------------------------------------------- write
   Only when this file is RUN, never when it is required. build.js requires it
   afterwards to rebuild the sitemap from the pages that actually exist, and a
   require with side effects would write every page a second time and put the
   stale sitemap straight back. */
if (require.main === module) {
  const written = [];
  pages.forEach((p) => {
    const file = path.join(here, p.slug + '.html');
    if (!CHECK) fs.writeFileSync(file, render(p));
    written.push(p.slug + '.html');
  });
  if (!CHECK) {
    fs.writeFileSync(path.join(here, 'sitemap.xml'), sitemap);
    fs.writeFileSync(path.join(here, 'robots.txt'), robots);
  }

  console.log((CHECK ? 'Would write ' : 'Wrote ') + written.length + ' pages:');
  written.forEach((f) => console.log('  ' + f));
  console.log((CHECK ? 'Would list ' : 'Listed ') + urls.length + ' URLs in sitemap.xml');
}
module.exports = { pages, urls, render, BASE };
