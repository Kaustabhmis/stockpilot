#!/usr/bin/env node
/**
 * Ashirbad Enterprise – static build (SEO pre-rendering)
 * ---------------------------------------------------------------
 * Produces dist/ with:
 *   - every page pre-rendered with real content (header, footer, projects,
 *     commercial listings, gallery, blog cards) so search engines and
 *     WhatsApp/Facebook link previews see it without running JavaScript
 *   - one static page per published blog post: blog/<slug>.html
 *     (own title, description, canonical URL, Open Graph, BlogPosting JSON-LD)
 *   - structured data for the business and its projects
 *   - sitemap.xml (with image entries), robots.txt, 404.html, _headers
 *   - compiled Tailwind CSS and cache-busted asset URLs
 *
 * Data source (first match wins):
 *   --data file.json          a backup exported from Admin → Settings
 *   APPS_SCRIPT_URL           the private Google Sheet (via Apps Script)
 *   sample data               when nothing is connected yet
 *
 * Usage:  npm run build          (or: node tools/build.mjs --data backup.json)
 * Env:    SITE_URL, APPS_SCRIPT_URL override values from assets/js/config.js
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argVal = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const OUT = path.resolve(ROOT, argVal('--out') || 'dist');
const require = createRequire(import.meta.url);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const log = (...m) => console.log('•', ...m);

/* ------------------------------------------------------------
 * 1. Config
 * ---------------------------------------------------------- */
const cfgSandbox = { window: {} };
vm.runInNewContext(read('assets/js/config.js'), cfgSandbox);
const C = cfgSandbox.window.APP_CONFIG;
if (process.env.SITE_URL) C.SITE_URL = process.env.SITE_URL;
if (process.env.APPS_SCRIPT_URL) C.APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const SITE = String(C.SITE_URL || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(SITE)) throw new Error('SITE_URL must be set (assets/js/config.js or env).');
const DEFAULT_SITE = 'https://www.ashirbadenterprise.com';

globalThis.APP_CONFIG = C;
const T = require(path.join(ROOT, 'assets/js/templates.js'));
globalThis.AET = T;
const K = require(path.join(ROOT, 'assets/js/content.js'));
globalThis.AEC = K;
const { headerHTML, footerHTML } = require(path.join(ROOT, 'assets/js/common.js'));

/* ------------------------------------------------------------
 * 2. Data
 * ---------------------------------------------------------- */
async function loadData() {
    const file = argVal('--data');
    if (file) {
        log(`Data: ${file}`);
        return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    }
    if (C.APPS_SCRIPT_URL) {
        log('Data: private Google Sheet (Apps Script)');
        const res = await fetch(C.APPS_SCRIPT_URL, {
            method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'public' }), redirect: 'follow'
        });
        const json = await res.json();
        if (!json.ok) throw new Error(`Apps Script error: ${json.error}`);
        return json.result;
    }
    log('Data: built-in sample content (no Google Sheet connected yet)');
    const sandbox = { window: { APP_CONFIG: C, crypto: crypto.webcrypto }, crypto: crypto.webcrypto, console, setTimeout, URL };
    vm.runInNewContext(read('assets/js/store.js'), sandbox);
    return sandbox.window.Store.sampleData();
}

const raw = await loadData();
const byOrder = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(b.created_at).localeCompare(String(a.created_at));
const projects = (raw.projects || []).slice().sort(byOrder);
const live = projects.filter((p) => p.stage === 'live');
const past = projects.filter((p) => p.stage !== 'live')
    .sort((a, b) => (a.stage === 'sold' ? 0 : 1) - (b.stage === 'sold' ? 0 : 1)
        || String(b.sold_at || b.completed_year || '').localeCompare(String(a.sold_at || a.completed_year || '')));
const commercial = (raw.commercial || []).slice().sort(byOrder);
const posts = (raw.posts || []).filter((p) => p.published !== false && p.slug)
    .sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')));
const settingsRows = raw.settings || [];
const CONTENT = K.build(settingsRows);
T.setBrand(CONTENT.business_name);
const BRAND = CONTENT.business_name;
log(`${live.length} live, ${past.length} completed/sold, ${commercial.length} commercial, ${posts.length} posts, ${settingsRows.length} saved content settings`);

/* ------------------------------------------------------------
 * 3. Helpers
 * ---------------------------------------------------------- */
const esc = T.esc;
const builtPosts = posts.map((p) => p.slug);
const abs = (u) => (!u || /^data:/.test(u) ? `${SITE}/og-image.jpg` : /^https?:\/\//.test(u) ? u : `${SITE}/${u.replace(/^\.?\//, '')}`);

/** Replace <!--@key-->…<!--/@key--> (or a lone <!--@key-->) with content. */
function fill(html, key, content) {
    const re = new RegExp(`<!--@${key}-->[\\s\\S]*?<!--/@${key}-->`);
    if (re.test(html)) return html.replace(re, () => content);
    if (html.includes(`<!--@${key}-->`)) return html.replace(`<!--@${key}-->`, () => content);
    throw new Error(`Marker @${key} not found`);
}
const fillIf = (html, key, content) => (html.includes(`<!--@${key}-->`) ? fill(html, key, content) : html);
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
const setMeta = (html, attr, name, value) => {
    const re = new RegExp(`(<meta ${attr}="${name}"[^>]*content=")[^"]*(")`);
    return html.replace(re, (_m, a, b) => a + esc(value) + b);
};

const jsonForScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function headExtra(rootPrefix, extra = '') {
    const tags = [];
    const g = String(CONTENT.google_verification || '').trim();
    const b = String(CONTENT.bing_verification || '').trim();
    if (g) tags.push(`<meta name="google-site-verification" content="${esc(g)}">`);
    if (b) tags.push(`<meta name="msvalidate.01" content="${esc(b)}">`);
    tags.push(`<script>window.AE_ROOT=${JSON.stringify(rootPrefix)};window.AE_BUILD=${jsonForScript({ posts: builtPosts, builtAt: new Date().toISOString() })};window.AE_SETTINGS=${jsonForScript(settingsRows)};${extra}</script>`);
    return tags.join('\n    ');
}

/** Escape stray "&" / "<" in <title> and text attributes (outside <script>) for strict HTML validity. */
const AMP = /&(?![a-zA-Z][a-zA-Z0-9]*;|#\d+;|#x[0-9a-fA-F]+;)/g;
function tidy(html) {
    return html.split(/(<script\b[\s\S]*?<\/script>)/).map((part, i) => (i % 2 ? part : part
        .replace(/ crossorigin=""/g, ' crossorigin')
        .replace(/(<title[^>]*>)([\s\S]*?)(<\/title>)/, (_m, a, t, z) => a + t.replace(AMP, '&amp;') + z)
        .replace(/(\s(?:content|alt|aria-label|title|placeholder|data-rendered)=")([^"]*)"/g, (_m, a, v) => `${a}${v.replace(AMP, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`)
    )).join('');
}

/** Fill every data-c / data-c-attr / data-c-list element with the saved website content. */
function applyContent(html, { stripHead = false } = {}) {
    const { document } = parseHTML(html);
    if (stripHead) document.querySelectorAll('head [data-c], head [data-c-attr]').forEach((el) => { el.removeAttribute('data-c'); el.removeAttribute('data-c-attr'); });
    K.apply(document, CONTENT, SITE);
    return tidy(document.toString());
}

/** Common transforms for every generated page. */
function finish(html, { active, rootPrefix = '', extraHead = '', stripHead = false }) {
    html = fillIf(html, 'head', headExtra(rootPrefix, extraHead));
    html = fillIf(html, 'header', headerHTML(active, rootPrefix, CONTENT));
    html = fillIf(html, 'footer', footerHTML(rootPrefix, CONTENT));
    if (SITE !== DEFAULT_SITE) html = html.split(DEFAULT_SITE).join(SITE);
    return applyContent(html, { stripHead });
}

/** Rewrite relative URLs for pages that live in a sub-folder (blog/…) or anywhere (404). */
function rebase(html, prefix) {
    return html.replace(/(\s(?:href|src)=")(?!https?:|\/\/|#|data:|mailto:|tel:|javascript:|\/|\.\.\/)([^"]+)"/g, (_m, a, url) => `${a}${prefix}${url}"`);
}

/* Organisation / business structured data (shared) */
const orgRef = { '@id': `${SITE}/#organization` };
const websiteLd = {
    '@context': 'https://schema.org', '@type': 'WebSite', '@id': `${SITE}/#website`, url: `${SITE}/`,
    name: BRAND, inLanguage: 'en-IN', publisher: orgRef
};
const projectLd = (p) => ({
    '@type': 'ApartmentComplex',
    name: p.title,
    description: p.description || `${p.config || 'Residential project'} by ${BRAND} in ${p.location}`,
    image: abs(T.imgUrl(p.img, 1200)),
    url: `${SITE}/#ongoing-projects`,
    address: { '@type': 'PostalAddress', streetAddress: p.location, addressLocality: CONTENT.address_city || undefined, addressRegion: CONTENT.address_state || undefined, addressCountry: 'IN' },
    ...(p.lat != null && p.lng != null ? { geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng } } : {}),
    ...(p.rera_no ? { identifier: { '@type': 'PropertyValue', propertyID: 'WBRERA', value: p.rera_no } } : {})
});

/* ------------------------------------------------------------
 * 4. Copy static files
 * ---------------------------------------------------------- */
const EXCLUDE = new Set(['dist', 'node_modules', 'tools', 'google-apps-script', 'README.md', 'package.json', 'package-lock.json',
    'tailwind.config.js', '.gitignore', 'netlify.toml', 'assets/css/tailwind.src.css']);
fs.rmSync(OUT, { recursive: true, force: true });
function copyDir(rel = '') {
    for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
        const r = path.posix.join(rel, entry.name);
        if (EXCLUDE.has(r) || entry.name.startsWith('.') || (!rel && entry.name.endsWith('.html'))) continue;
        if (entry.isDirectory()) { fs.mkdirSync(path.join(OUT, r), { recursive: true }); copyDir(r); }
        else fs.copyFileSync(path.join(ROOT, r), path.join(OUT, r));
    }
}
fs.mkdirSync(OUT, { recursive: true });
copyDir();

// Tailwind: compile fresh when available, otherwise keep the committed build
const twBin = path.join(ROOT, 'node_modules/.bin/tailwindcss');
if (fs.existsSync(twBin)) {
    execFileSync(twBin, ['-c', 'tailwind.config.js', '-i', 'assets/css/tailwind.src.css', '-o', path.join(OUT, 'assets/css/tailwind.css'), '--minify'], { cwd: ROOT, stdio: 'pipe' });
    log('Tailwind CSS compiled');
} else {
    log('Tailwind CLI not installed – using committed assets/css/tailwind.css (run `npm install` to rebuild it)');
}

// Cache-busting hashes for local assets
const assetHash = {};
for (const f of ['assets/css/tailwind.css', 'assets/js/config.js', 'assets/js/templates.js', 'assets/js/content.js', 'assets/js/common.js', 'assets/js/store.js']) {
    assetHash[f] = crypto.createHash('sha1').update(fs.readFileSync(path.join(OUT, f))).digest('hex').slice(0, 10);
}
const bust = (html) => html.replace(/((?:href|src)="(?:\.\.\/|\/)?)(assets\/(?:css|js)\/[\w.-]+\.(?:css|js))"/g, (m, a, f) => (assetHash[f] ? `${a}${f}?v=${assetHash[f]}"` : m));
const write = (rel, html) => { fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true }); fs.writeFileSync(path.join(OUT, rel), bust(html)); };

/* ------------------------------------------------------------
 * 5. Pages
 * ---------------------------------------------------------- */
const ctxRoot = { root: '', builtPosts, c: CONTENT };

// Home
{
    let html = read('index.html');
    const heroKey = JSON.stringify(live.map((p) => [p.id, p.title, p.img, p.status_label, p.price, p.config, p.location, p.rera_no]));
    html = html.replace('id="hero-carousel-wrapper">', `id="hero-carousel-wrapper" data-rendered="${esc(heroKey)}">`);
    html = fill(html, 'hero', T.heroSlides(live));
    html = fill(html, 'commercial', T.commercialCards(commercial));
    html = fill(html, 'gallery', T.galleryCards(past));
    html = fill(html, 'blog', posts.slice(0, 3).map((p) => T.blogCard(p, ctxRoot, 'h3')).join('') || '<p class="col-span-full text-center text-gray-500">Articles coming soon.</p>');
    const heroImg = live[0] ? T.imgUrl(live[0].img, 1600) : null;
    html = fill(html, 'jsonld', [
        ld(websiteLd),
        live.length ? ld({ '@context': 'https://schema.org', '@type': 'ItemList', name: `Ongoing projects by ${BRAND}`, itemListElement: live.map((p, i) => ({ '@type': 'ListItem', position: i + 1, item: projectLd(p) })) }) : '',
        past.length ? ld({ '@context': 'https://schema.org', '@type': 'ItemList', name: `Completed and sold out projects by ${BRAND}`, itemListElement: past.map((p, i) => ({ '@type': 'ListItem', position: i + 1, item: projectLd(p) })) }) : '',
        heroImg ? `<link rel="preload" as="image" href="${esc(heroImg)}" fetchpriority="high">` : ''
    ].filter(Boolean).join('\n    '));
    write('index.html', finish(html, { active: 'home' }));
}

// Blog list
const blogTemplate = read('blog.html');
{
    let html = blogTemplate;
    html = fill(html, 'filters', T.categoryFilters(posts, 'All'));
    html = fill(html, 'featured', posts[0] ? T.featuredPost(posts[0], ctxRoot) : '');
    html = fill(html, 'posts', posts.slice(1).map((p) => T.blogCard(p, ctxRoot, 'h2')).join(''));
    html = html.replace('<p id="no-posts" class="hidden', posts.length ? '<p id="no-posts" class="hidden' : '<p id="no-posts" class="');
    html = fill(html, 'jsonld', ld({
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` }, { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog.html` }]
    }));
    html = html.replace('<!--@listld-->', '').replace('<!--/@listld-->', '').replace('<!--@listview-->', '').replace('<!--/@listview-->', '');
    html = fill(html, 'post', '<div id="post-view" class="hidden"></div>');
    write('blog.html', finish(html, { active: 'blog' }));
}

// Blog posts – one static page each
for (const p of posts) {
    const url = `${SITE}/blog/${encodeURIComponent(p.slug)}.html`;
    const ctx = { root: '../', builtPosts, c: CONTENT };
    let html = blogTemplate;
    html = fill(html, 'listview', '');
    html = fill(html, 'listld', '');
    html = fill(html, 'post', T.postArticle(p, T.relatedPosts(p, posts), ctx, url));
    html = fill(html, 'jsonld', T.postJsonLd(p, url, SITE).map(ld).join('\n    '));
    const title = p.title.length + BRAND.length > 57 ? p.title : `${p.title} | ${BRAND}`;
    const desc = (p.excerpt || p.title).slice(0, 300);
    const image = abs(T.imgUrl(p.cover, 1200));
    html = html.replace(/<title[^>]*>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
    html = setMeta(html, 'name', 'description', desc);
    html = html.replace(/<meta name="keywords"[^>]*>\n\s*/, '');
    html = html.replace(/(<link rel="canonical" id="canonical" href=")[^"]*(")/, `$1${url}$2`);
    html = setMeta(html, 'property', 'og:type', 'article');
    html = setMeta(html, 'property', 'og:url', url);
    html = setMeta(html, 'property', 'og:title', p.title);
    html = setMeta(html, 'property', 'og:description', desc);
    html = setMeta(html, 'property', 'og:image', image);
    html = setMeta(html, 'name', 'twitter:title', p.title);
    html = setMeta(html, 'name', 'twitter:image', image);
    html = html.replace('<meta property="og:site_name"', `${p.published_at ? `<meta property="article:published_time" content="${esc(p.published_at)}">\n    ` : ''}${p.category ? `<meta property="article:section" content="${esc(p.category)}">\n    ` : ''}<meta property="og:site_name"`);
    html = finish(html, { active: 'blog', rootPrefix: '../', extraHead: `window.AE_POST=${JSON.stringify(p.slug)};`, stripHead: true });
    html = rebase(html, '../');
    write(`blog/${p.slug}.html`, html);
}
log(`${posts.length} blog post pages`);

// Landing page
{
    let html = read('enquiry.html');
    html = fill(html, 'projects', T.landingProjectCards(live));
    write('enquiry.html', finish(html, { active: 'enquiry' }));
}

// Simple pages
write('privacy.html', finish(read('privacy.html'), { active: 'privacy' }));
write('admin.html', read('admin.html'));
write('404.html', rebase(finish(read('404.html'), { active: '404', rootPrefix: '/' }), '/'));

/* ------------------------------------------------------------
 * 6. sitemap.xml, robots.txt, _headers
 * ---------------------------------------------------------- */
const today = new Date().toISOString().slice(0, 10);
const lastPost = posts[0] ? String(posts[0].published_at).slice(0, 10) : today;
const imgTag = (u, title) => `\n    <image:image><image:loc>${esc(abs(T.imgUrl(u, 1200)))}</image:loc><image:title>${esc(title)}</image:title></image:image>`;
const urls = [
    { loc: `${SITE}/`, lastmod: today, freq: 'weekly', pri: '1.0', images: projects.filter((p) => p.img && !/^data:/.test(p.img)).map((p) => imgTag(p.img, p.title)).join('') },
    { loc: `${SITE}/enquiry.html`, lastmod: today, freq: 'monthly', pri: '0.9' },
    { loc: `${SITE}/blog.html`, lastmod: lastPost, freq: 'weekly', pri: '0.8' },
    ...posts.map((p) => ({
        loc: `${SITE}/blog/${encodeURIComponent(p.slug)}.html`,
        lastmod: String(p.updated_at || p.published_at || today).slice(0, 10), freq: 'monthly', pri: '0.7',
        images: p.cover && !/^data:/.test(p.cover) ? imgTag(p.cover, p.title) : ''
    })),
    { loc: `${SITE}/privacy.html`, lastmod: today, freq: 'yearly', pri: '0.3' }
];
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map((u) => `  <url>\n    <loc>${esc(u.loc)}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.pri}</priority>${u.images || ''}\n  </url>`).join('\n')}
</urlset>
`);
fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
fs.writeFileSync(path.join(OUT, '_headers'), `# Netlify / Cloudflare Pages response headers
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  X-Frame-Options: SAMEORIGIN

/admin.html
  X-Robots-Tag: noindex, nofollow
  Cache-Control: no-store

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/*.html
  Cache-Control: public, max-age=0, must-revalidate
`);
log(`sitemap.xml with ${urls.length} URLs`);
log(`Done → ${path.relative(process.cwd(), OUT) || OUT}`);
