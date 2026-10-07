#!/usr/bin/env node
/**
 * The Netlify build. Runs on every deploy, from the `netlify` base directory.
 *
 * It needs nothing installed. Everything here is Node's standard library
 * reading files that are already in the repository — no npm install, no
 * framework, no Tailwind pass. The stylesheet was compiled into
 * `dist/index.html` when that file was built and committed, so the deploy
 * cannot fail on a toolchain it does not have.
 *
 * WHAT IT PRODUCES, IN ORDER
 *
 *   1. index.html   the application and landing page, from ../dist/index.html,
 *                   with the Apps Script /exec URL substituted in
 *   2. the SEO and marketing pages
 *   3. the legal pages, but only once site-config.json is filled in
 *   4. sitemap.xml, listing only the pages that actually exist
 *   5. 404.html, if the legal build did not already write a nicer one
 *
 * STEP 1 IS THE ONE THAT USED TO BE MISSING. `index.html` is git-ignored — for
 * a good reason, it used to be generated from a copy carrying placeholder
 * company details — but nothing put one back on a git-connected deploy, so the
 * build published a folder with no homepage. The root URL of a live product
 * returned 404 while every content page underneath it worked.
 */
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const here = __dirname;
const root = path.join(here, '..');
const run = (f) => execFileSync('node', [path.join(here, f)], { cwd: here, stdio: 'inherit' });
const fail = (msg) => { console.error('\nBUILD FAILED: ' + msg + '\n'); process.exit(1); };

/* ---------------------------------------------------- 1. the app itself --- */
console.log('\n--- the application page ---');

const distPath = path.join(root, 'dist', 'index.html');
if (!fs.existsSync(distPath)) {
  fail('dist/index.html is missing. Run `node web/_build/build-index.js` and commit it.');
}
let app = fs.readFileSync(distPath, 'utf8');

/* The compiled stylesheet lives inside that file. If it is not there the page
   renders unstyled, and an unstyled page is the first thing a prospect sees —
   worse than no deploy at all, because it looks like the product is broken
   rather than absent. */
if (app.indexOf('cdn.tailwindcss.com') > -1) {
  fail('dist/index.html still loads Tailwind from the CDN. Rebuild it with web/_build/build-index.js.');
}
if (!/<style>[\s\S]{5000,}?<\/style>/.test(app)) {
  fail('dist/index.html has no compiled stylesheet in it. Rebuild it with web/_build/build-index.js.');
}

/* The /exec URL is deployment config, not source, so it is not in the file.
   Set API_URL in Netlify > Site configuration > Environment variables.

   This refuses rather than warns. An index.html with the placeholder still in
   it looks completely fine — it renders, it is styled, the pricing is right —
   and then every login, signup and payment fails with a network error. A build
   that shipped that would be worse than one that did not run. */
const PLACEHOLDER = "var API_URL = 'PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE';";
const apiUrl = (process.env.API_URL || '').trim();
if (app.indexOf(PLACEHOLDER) > -1) {
  if (!apiUrl) {
    fail('API_URL is not set, and dist/index.html still has the placeholder.\n' +
         '  Netlify > Site configuration > Environment variables > add API_URL,\n' +
         '  set to your Apps Script /exec URL. Without it nobody can sign in.');
  }
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(apiUrl)) {
    fail('API_URL does not look like an Apps Script /exec URL:\n  ' + apiUrl + '\n' +
         '  Expected https://script.google.com/macros/s/AKfy.../exec');
  }
  app = app.replace(PLACEHOLDER, "var API_URL = '" + apiUrl + "';");
  console.log('  API_URL substituted from the environment.');
} else {
  console.log('  dist/index.html already carries a real API_URL.');
}

fs.writeFileSync(path.join(here, 'index.html'), app);
console.log('  index.html written (' + (app.length / 1024).toFixed(1) + 'KB)');

/* ------------------------------------------------- 2. the content pages --- */
console.log('\n--- SEO and marketing pages ---');
run('gen-seo.js');

/* --------------------------------------------------- 3. the legal pages --- */
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'site-config.json'), 'utf8'));
const REQUIRED = ['registeredAddress', 'phone', 'gstin', 'entityType', 'registrationNumber',
                  'grievanceOfficerName', 'jurisdictionCity', 'jurisdictionState'];
const missing = REQUIRED.filter((k) => !String(cfg[k] || '').trim());

console.log('\n--- legal pages ---');
if (!missing.length) {
  run('gen-pages.js');
} else if (process.env.ALLOW_MISSING_LEGAL === '1') {
  console.log('NOT BUILT — site-config.json is missing: ' + missing.join(', '));
  console.log('  Continuing because ALLOW_MISSING_LEGAL=1. The four footer links will 404.');
} else {
  /* This used to be a warning, and a warning was the wrong call. The ONLY four
     internal links on the homepage are /privacy, /terms, /refund and /contact —
     checked, that is the complete list — so a deploy without these pages puts a
     live product on a live domain where every link in the footer is broken.
     Razorpay's reviewer opens exactly those URLs, and so does Google.
     A preview deploy can still go out with ALLOW_MISSING_LEGAL=1. A production
     one should not, and now cannot by accident. */
  console.error('');
  console.error('BUILD FAILED: site-config.json is missing ' + missing.length + ' required field(s):');
  console.error('  ' + missing.join(', '));
  console.error('');
  console.error('  Without them the privacy, terms, refund and contact pages are not');
  console.error('  built — and those four URLs are the only internal links on the');
  console.error('  homepage, so every link in the footer of the live site would 404.');
  console.error('');
  console.error('  Razorpay checks that the registered address on your site matches the');
  console.error('  account, and a named grievance officer is required by the Consumer');
  console.error('  Protection (E-Commerce) Rules 2020. Until these are filled in you');
  console.error('  cannot complete payment onboarding either.');
  console.error('');
  console.error('  Fill them in: netlify/site-config.json — see REQUIRED-BEFORE-DEPLOY.md.');
  console.error('  To ship a preview without them anyway: ALLOW_MISSING_LEGAL=1');
  console.error('');
  process.exit(1);
}

/* --------------------------------------------------------- 4. sitemap ----- */
/* Rewritten AFTER the legal step, from the files that are actually on disk.
   Listing a URL that 404s is not a cosmetic error: Google reports it as a
   crawl failure against the whole property, and the four legal URLs were in
   the sitemap whether or not anything had built them. */
console.log('\n--- sitemap ---');
const { BASE, urls } = require('./gen-seo.js');
const live = urls.filter((u) => {
  const slug = u.loc.slice(BASE.length).replace(/^\//, '');
  return !slug || fs.existsSync(path.join(here, slug + '.html'));
});
const dropped = urls.length - live.length;
const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(here, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  live.map((u) => '  <url>\n    <loc>' + u.loc + '</loc>\n    <lastmod>' + today +
    '</lastmod>\n    <changefreq>' + u.changefreq + '</changefreq>\n    <priority>' +
    u.priority + '</priority>\n  </url>').join('\n') +
  '\n</urlset>\n');
console.log('  ' + live.length + ' URLs listed' +
  (dropped ? ', ' + dropped + ' left out because the page does not exist yet' : ''));

/* ------------------------------------------------------------ 5. 404 ------ */
const notFound = path.join(here, '404.html');
if (!fs.existsSync(notFound)) {
  /* Netlify's own 404 is unbranded and offers no way back. A visitor who
     mistypes a URL should land somewhere that still looks like the product. */
  fs.writeFileSync(notFound, '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>Page not found — Dome Box</title>' +
    '<link rel="icon" href="/favicon.svg"><style>' +
    'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#faf8f5;' +
    'color:#2b2630;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;' +
    'text-align:center;padding:24px}h1{font-size:clamp(28px,6vw,44px);margin:0 0 8px}' +
    'p{color:#7d7570;font-weight:600;margin:0 0 24px}' +
    'a{background:#5b4bdb;color:#fff;text-decoration:none;padding:13px 28px;' +
    'border-radius:10px;font-weight:800;display:inline-block}</style></head><body><div>' +
    '<h1>That page is not here</h1><p>The link may be out of date.</p>' +
    '<a href="/">Go to Dome Box</a></div></body></html>');
  console.log('\n--- 404 ---\n  404.html written (the plain one; gen-pages.js writes a fuller one)');
}

console.log('');
