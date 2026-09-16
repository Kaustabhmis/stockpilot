#!/usr/bin/env node
/**
 * prepare.js — applies the audit fixes to your index.html.
 *
 *   node prepare.js ../path/to/your/index.html
 *
 * Writes `index.html` into this folder, leaving your original untouched. Every
 * change is reported, and anything it could not find is reported too — so a
 * pattern that has drifted since the audit shows up as a warning rather than
 * being silently skipped.
 *
 * Idempotent: running it twice produces the same file.
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const src = process.argv[2];
if (!src) {
  console.error('\nUsage: node prepare.js /path/to/your/index.html');
  console.error('Writes a patched copy into this folder. Your original is not modified.\n');
  process.exit(1);
}
if (!fs.existsSync(src)) { console.error('No such file: ' + src); process.exit(1); }

const here = __dirname;
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'site-config.json'), 'utf8'));
const ORIGIN = 'https://' + cfg.domain;
let html = fs.readFileSync(src, 'utf8');
const before = html;

const done = [], skipped = [], warned = [];
/** Applies a replacement and records whether it actually matched. */
function fix(label, find, replace, opts) {
  opts = opts || {};
  if (opts.alreadyDone && opts.alreadyDone(html)) { skipped.push(label + ' (already applied)'); return; }
  const re = find instanceof RegExp ? find : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  /* match() on a NON-global regex returns [full, ...captureGroups], so its
     length is the group count, not the hit count — which reported "2x" for
     every single-group replacement. Count properly. */
  const n = re.global
    ? (html.match(re) || []).length
    : (re.test(html) ? 1 : 0);
  if (!n) { warned.push(label); return; }
  html = html.replace(re, replace);
  done.push(label + (n > 1 ? ` (${n}x)` : ''));
}

/* ---- 1. fingerprint the stylesheet -------------------------------------
   A hashed name can be cached for a year safely: changing the CSS changes the
   URL, so no customer is ever served a stale stylesheet. */
const cssSrc = path.join(here, 'tailwind.min.css');
let cssHref = null;
if (fs.existsSync(cssSrc)) {
  const css = fs.readFileSync(cssSrc);
  const hash = crypto.createHash('sha256').update(css).digest('hex').slice(0, 10);
  fs.mkdirSync(path.join(here, 'assets'), { recursive: true });
  const name = `tailwind.${hash}.min.css`;
  fs.writeFileSync(path.join(here, 'assets', name), css);
  cssHref = '/assets/' + name;
  // clear older fingerprints so the folder does not accumulate
  fs.readdirSync(path.join(here, 'assets'))
    .filter(f => /^tailwind\.[0-9a-f]{10}\.min\.css$/.test(f) && f !== name)
    .forEach(f => fs.unlinkSync(path.join(here, 'assets', f)));
  done.push('fingerprinted stylesheet → ' + cssHref);
} else {
  warned.push('tailwind.min.css missing — the Tailwind CDN swap was skipped');
}

/* ---- 2. language ------------------------------------------------------- */
fix('lang="en" → "en-IN" (India targeting)', /<html lang="en"/g, '<html lang="en-IN"',
  { alreadyDone: h => /<html lang="en-IN"/.test(h) });

/* ---- 3. structured data ----------------------------------------------- */
const ldjson = `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "${cfg.productName}",
  "applicationCategory": "BusinessApplication",
  "applicationSubCategory": "Task Management Software",
  "operatingSystem": "Web browser",
  "url": "${ORIGIN}",
  "description": "Task and team management software for Indian MSMEs, with delegation scoring, KRA/KPI tracking and automated performance appraisals.",
  "inLanguage": "en-IN",
  "publisher": {
    "@type": "Organization",
    "name": "${cfg.legalEntity}",
    "url": "${ORIGIN}",
    "email": "${cfg.supportEmail}"
  },
  "offers": [
    { "@type": "Offer", "name": "Free Tier", "price": "0", "priceCurrency": "INR",
      "description": "Up to 5 users, 50 tasks per month" },
    { "@type": "Offer", "name": "Standard", "price": "2499", "priceCurrency": "INR",
      "description": "Up to 20 users, 500 tasks per month" },
    { "@type": "Offer", "name": "Pro Yearly", "price": "19999", "priceCurrency": "INR",
      "description": "Up to 300 users, unlimited tasks" }
  ]
}
</script>`;
fix('structured data: declared free while charging ₹2,499 / ₹19,999',
  /<script type="application\/ld\+json">[\s\S]*?<\/script>/, ldjson,
  { alreadyDone: h => h.includes('"applicationSubCategory"') });

/* ---- 4. head tags ----------------------------------------------------- */
const headTags = `
  <link rel="canonical" href="${ORIGIN}/">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <meta property="og:url" content="${ORIGIN}/">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${cfg.productName}">
  <meta property="og:locale" content="en_IN">
  <meta property="og:image" content="${ORIGIN}/og-cover.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Dome Box — Task &amp; Team Management for Indian MSMEs">
  <meta name="twitter:description" content="Automate accountability with delegation scoring, KRA/KPI tracking and performance appraisals.">
  <meta name="twitter:image" content="${ORIGIN}/og-cover.png">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
`;
if (!html.includes('rel="canonical"')) {
  html = html.replace(/(<meta property="og:description"[^>]*>)/, '$1' + headTags);
  if (html !== before) done.push('added canonical, og:url, og:image, twitter card, favicon link');
  else warned.push('could not find og:description to anchor the new head tags');
} else skipped.push('head tags (canonical already present)');

/* ---- 5. Tailwind play CDN --------------------------------------------- */
if (cssHref) {
  fix('Tailwind play CDN → compiled stylesheet (~3MB of in-browser compilation removed)',
    /<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/g,
    `<link rel="stylesheet" href="${cssHref}">`,
    { alreadyDone: h => h.includes('/assets/tailwind.') });
}

/* ---- 6. defer the scripts that are not needed to paint ---------------- */
fix('defer Razorpay checkout (only needed when someone pays)',
  /<script src="https:\/\/checkout\.razorpay\.com\/v1\/checkout\.js"><\/script>/,
  '<script src="https://checkout.razorpay.com/v1/checkout.js" defer></script>',
  { alreadyDone: h => /checkout\.js" defer/.test(h) });
fix('defer Chart.js (only needed inside the app)',
  /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js"><\/script>/,
  '<script src="https://cdn.jsdelivr.net/npm/chart.js" defer></script>',
  { alreadyDone: h => /chart\.js" defer/.test(h) });

/* ---- 7. fonts: 7 weights is 7 files ----------------------------------- */
fix('Inter: 7 weights → 3 (400/600/800)',
  /family=Inter:wght@300;400;500;600;700;800;900/,
  'family=Inter:wght@400;600;800',
  { alreadyDone: h => h.includes('family=Inter:wght@400;600;800') });
fix('icon font: display=block so ligature names never flash as text',
  /(family=Material\+Icons)(&display=block)?/,
  '$1&display=block',
  { alreadyDone: h => /Material\+Icons&display=block/.test(h) });

/* ---- 8. legal entity -------------------------------------------------- */
fix('footer: "Dome Box Inc." is not your legal entity',
  /&copy; 2026 Dome Box Inc\. All rights reserved\./,
  `&copy; 2026 ${cfg.legalEntity}. ${cfg.productName} is a product of ${cfg.legalEntity}.`,
  { alreadyDone: h => h.includes(`product of ${cfg.legalEntity}`) });

/* ---- 9. policy links must be real URLs --------------------------------
   As JS-toggled views these pages have no URL, so Googlebot cannot index them
   and — more urgently — Razorpay's reviewer cannot open them. */
[['privacy', '/privacy', 'Privacy'], ['terms', '/terms', 'Terms'],
 ['contact-public', '/contact', 'Contact']].forEach(([view, url, label]) => {
  fix(`footer "${label}" → real ${url} URL (was a JS-only view)`,
    new RegExp(`<button onclick="toggleView\\('${view}'\\)" class="([^"]*)">${label}</button>`),
    `<a href="${url}" class="$1">${label}</a>`,
    { alreadyDone: h => h.includes(`href="${url}"`) });
});
if (!/href="\/refund"/.test(html)) {
  fix('added the Refund link Razorpay requires',
    /(<a href="\/terms"[^>]*>Terms<\/a>)/,
    '$1\n                  <a href="/refund" class="hover:text-white transition">Refunds</a>');
}

/* ---- 10. password policy --------------------------------------------- */
fix('signup password minimum 6 → 8 characters',
  /minlength="6"/g, 'minlength="8"',
  { alreadyDone: h => !/minlength="6"/.test(h) });

/* ---- 11. autocomplete: password managers cannot help without it ------- */
fix('login email autocomplete',
  /(<input type="email" name="username" placeholder="Work Email")/,
  '$1 autocomplete="username" aria-label="Work email"',
  { alreadyDone: h => /name="username" placeholder="Work Email" autocomplete/.test(h) });
fix('login password autocomplete',
  /(<input type="password" name="password" placeholder="Password")/,
  '$1 autocomplete="current-password" aria-label="Password"',
  { alreadyDone: h => /placeholder="Password" autocomplete/.test(h) });
fix('signup password autocomplete (new-password, so managers offer to generate)',
  /(<input type="password" name="password" required placeholder="Create Password")/,
  '$1 autocomplete="new-password" aria-label="Create a password"',
  { alreadyDone: h => /placeholder="Create Password" autocomplete/.test(h) });
[['companyName','Company Name','organization'],['name','Admin Full Name','name'],
 ['email','Work Email Address','email'],['phone','Phone Number','tel']].forEach(([n,ph,ac]) => {
  fix(`signup "${ph}" label + autocomplete`,
    new RegExp(`(<input type="(?:text|email|tel)" name="${n}"(?: required)? placeholder="${ph}")`),
    `$1 autocomplete="${ac}" aria-label="${ph}"`,
    { alreadyDone: h => new RegExp(`placeholder="${ph}" autocomplete`).test(h) });
});

/* ---- 12. mobile menu button ------------------------------------------ */
fix('mobile menu: aria-expanded + accessible name',
  /<button onclick="document\.getElementById\('mobile-menu'\)\.classList\.toggle\('hidden'\)" class="([^"]*)">/,
  `<button onclick="var m=document.getElementById('mobile-menu');m.classList.toggle('hidden');this.setAttribute('aria-expanded',!m.classList.contains('hidden'));" class="$1" aria-expanded="false" aria-controls="mobile-menu" aria-label="Open menu">`,
  { alreadyDone: h => h.includes('aria-controls="mobile-menu"') });

/* ---- 13. hero image: dimensions stop the layout jumping -------------- */
fix('hero image: width/height (prevents layout shift) + decoding hint',
  /<img src="(https:\/\/images\.unsplash\.com[^"]*)" alt="Dashboard" class="([^"]*)">/,
  '<img src="$1" alt="The Dome Box task board, showing work in progress across a team" width="1000" height="667" decoding="async" class="$2">',
  { alreadyDone: h => /alt="The Dome Box task board/.test(h) });

/* ---- 14. contrast failures ------------------------------------------- */
fix('text-gray-400 on white/gray-50 → gray-500 (was 2.54:1, WCAG AA needs 4.5)',
  /class="text-gray-400">/g, 'class="text-gray-500">',
  { alreadyDone: h => !/class="text-gray-400">/.test(h) });
fix('tick icons text-blue-300 on blue-600 → blue-100 (was 2.87:1)',
  /class="material-icons text-blue-300"/g, 'class="material-icons text-blue-100"',
  { alreadyDone: h => !/text-blue-300"/.test(h) });

/* ---- report ---------------------------------------------------------- */
fs.writeFileSync(path.join(here, 'index.html'), html);

const line = '─'.repeat(70);
console.log('\n' + line);
console.log(`prepare.js — ${path.basename(src)} → netlify/index.html`);
console.log(line);
console.log(`\nAPPLIED (${done.length})`);
done.forEach(d => console.log('  ✓ ' + d));
if (skipped.length) {
  console.log(`\nALREADY DONE (${skipped.length})`);
  skipped.forEach(s => console.log('  · ' + s));
}
if (warned.length) {
  console.log(`\nNOT FOUND — CHECK THESE BY HAND (${warned.length})`);
  warned.forEach(w => console.log('  ! ' + w));
  console.log('\n  These patterns are not in your file. Either the fix is already');
  console.log('  there under different markup, or that part of the page has changed');
  console.log('  since the audit. Nothing was guessed at.');
}
const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log(`\n${kb(before.length)} in, ${kb(html.length)} out.`);
console.log('Your original file was not modified.\n');
