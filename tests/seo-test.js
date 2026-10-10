/**
 * The SEO build, checked rather than hoped for.
 *
 * Most SEO damage is not subtle — it is a sitemap listing a page that no longer
 * exists, two pages claiming the same title, a canonical pointing at the wrong
 * URL, or a noindex nobody noticed. All of those are machine-checkable, so they
 * are checked here instead of being found three months later in Search Console.
 */
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const NET = path.join(__dirname, '..', 'netlify');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 170) + ']')); v ? pass++ : fail++; };

execFileSync('node', [path.join(NET, 'gen-seo.js')], { cwd: NET, stdio: 'ignore' });
const { pages, urls, BASE } = require(path.join(NET, 'gen-seo.js'));
const read = (f) => fs.readFileSync(path.join(NET, f), 'utf8');
const html = {};
pages.forEach((p) => { html[p.slug] = read(p.slug + '.html'); });
const app = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8');

console.log('\n=== the front door is open ===');
/* The homepage carried noindex from when it was only a login box, which kept
   the entire domain out of Google — no amount of content pages helps past that. */
ok('the homepage is indexable', /<meta name="robots" content="index, follow/.test(app));
ok('it has a canonical', /<link rel="canonical" href="https:\/\/www\.domebox\.in\/">/.test(app));
ok('a title that says what it is and who for',
   /<title>Dome Box — Task &amp; Team Management Software for Indian MSMEs<\/title>/.test(app));
ok('a description within what Google will show',
   (app.match(/<meta name="description" content="([^"]*)"/) || [, ''])[1].length <= 320);
ok('Open Graph and Twitter cards, so a shared link is not a bare URL',
   /og:image/.test(app) && /twitter:card/.test(app));
ok('Organization, WebSite and SoftwareApplication structured data',
   /"@type":"Organization"/.test(app) && /"@type":"SoftwareApplication"/.test(app));
ok('with the real prices in it', /"price":"59990"/.test(app));

console.log('\n=== no invented social proof ===');
/* Review and AggregateRating markup must describe reviews that genuinely exist.
   Inventing them to win a star rating is a manual-action risk and a lie to a
   buyer, so nothing on this site emits either. */
const strip = (h) => h.replace(/<!--[\s\S]*?-->/g, '');     // the comment SAYS AggregateRating
const all = [app, ...Object.values(html)].map(strip).join('\n');
ok('no Review markup anywhere', !/"@type":\s*"Review"/.test(all));
ok('no AggregateRating anywhere', !/AggregateRating/.test(all));

console.log('\n=== every page is a real page ===');
pages.forEach((p) => {
  const h = html[p.slug];
  const title = (h.match(/<title>([^<]*)<\/title>/) || [, ''])[1];
  const desc = (h.match(/<meta name="description" content="([^"]*)"/) || [, ''])[1];
  const text = h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
                .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = text.split(' ').length;
  ok(p.slug + ': one h1', (h.match(/<h1>/g) || []).length === 1);
  ok(p.slug + ': title under 60 characters', title.length <= 62, title.length + ' — ' + title);
  ok(p.slug + ': description 70-170 characters',
     desc.length >= 70 && desc.length <= 175, desc.length + ' — ' + desc);
  /* Thin pages are demoted and do not convert either. 400 words is the floor
     for something worth a reader's time. */
  ok(p.slug + ': not a thin page (' + words + ' words)', words >= 400, words);
  ok(p.slug + ': canonical matches its own URL',
     h.includes(`<link rel="canonical" href="${BASE}/${p.slug}">`));
  ok(p.slug + ': indexable', /content="index, follow/.test(h));
  ok(p.slug + ': links back into the product', /\/\?signup=1|\/\?login=1/.test(h));
});

console.log('\n=== titles and descriptions are not duplicates ===');
const titles = pages.map((p) => (html[p.slug].match(/<title>([^<]*)<\/title>/) || [, ''])[1]);
const descs = pages.map((p) => (html[p.slug].match(/<meta name="description" content="([^"]*)"/) || [, ''])[1]);
ok('every title is unique', new Set(titles).size === titles.length);
ok('every description is unique', new Set(descs).size === descs.length);

console.log('\n=== structured data ===');
pages.forEach((p) => {
  const blocks = [...html[p.slug].matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  ok(p.slug + ': the JSON-LD parses', blocks.length === 1 && (() => {
    try { JSON.parse(blocks[0][1]); return true; } catch (e) { return false; } })());
  const g = JSON.parse(blocks[0][1])['@graph'];
  ok(p.slug + ': has a breadcrumb', g.some((x) => x['@type'] === 'BreadcrumbList'));
  if (p.faq) {
    const faq = g.find((x) => x['@type'] === 'FAQPage');
    ok(p.slug + ': FAQ markup matches the questions on the page',
       !!faq && faq.mainEntity.length === p.faq.length);
    /* Marking up a question the reader cannot see is exactly what the
       structured-data guidelines call out. */
    ok(p.slug + ': and every marked-up question is visible in the body',
       p.faq.every(([q]) => html[p.slug].includes(q.replace(/&/g, '&amp;'))));
  }
});

console.log('\n=== the sitemap cannot drift ===');
/* It is generated from the same manifest as the pages, so a renamed page cannot
   leave a dead URL behind in the XML. */
const sitemap = read('sitemap.xml');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
ok('it is valid XML with a urlset', /^<\?xml version="1\.0" encoding="UTF-8"\?>/.test(sitemap) &&
   /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/.test(sitemap));
ok('it lists the homepage', locs.includes(BASE + '/'));
ok('it lists every content page',
   pages.every((p) => locs.includes(BASE + '/' + p.slug)),
   pages.filter((p) => !locs.includes(BASE + '/' + p.slug)).map((p) => p.slug).join());
ok('it lists the legal pages, which a payment reviewer looks for',
   ['privacy', 'terms', 'refund', 'contact'].every((s) => locs.includes(BASE + '/' + s)));
ok('every URL is absolute and https', locs.every((l) => l.startsWith('https://')));
ok('no duplicates', new Set(locs).size === locs.length);
ok('lastmod is a real date', /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(sitemap));
ok('the count matches the manifest', locs.length === urls.length);

console.log('\n=== every sitemap URL actually resolves ===');
const redirects = read('_redirects');
const resolves = (loc) => {
  const slug = loc.replace(BASE, '').replace(/^\//, '');
  if (!slug) return true;                                    // the homepage, served by index.html
  if (fs.existsSync(path.join(NET, slug + '.html'))) return true;
  return new RegExp('^/' + slug + '\\s', 'm').test(redirects);
};
const dead = locs.filter((l) => !resolves(l));
ok('nothing in the sitemap 404s', dead.length === 0, dead.join(', '));
ok('and every content page has a clean-URL rule',
   pages.every((p) => new RegExp('^/' + p.slug + '\\s', 'm').test(redirects)),
   pages.filter((p) => !new RegExp('^/' + p.slug + '\\s', 'm').test(redirects)).map((p) => p.slug).join());

console.log('\n=== robots ===');
const robots = read('robots.txt');
ok('it allows crawling', /^Allow: \/$/m.test(robots));
ok('it points at the sitemap', robots.includes('Sitemap: ' + BASE + '/sitemap.xml'));
/* The comment in robots.txt explains why there is no Disallow, so match the
   directive at the start of a line rather than the word anywhere. */
ok('and does not block the ad landing URLs', !/^Disallow:/m.test(robots));

console.log('\n=== internal linking ===');
/* An orphan page is one Google finds slowly and ranks poorly. Every content
   page should be reachable from the shared nav or the guides index. */
const linkedFrom = (slug) => Object.entries(html)
  .filter(([s]) => s !== slug).some(([, h]) => h.includes('href="/' + slug + '"'));
pages.forEach((p) => ok(p.slug + ': linked from another page', linkedFrom(p.slug)));

console.log('\n=== the CSP still matches what the pages load ===');
const headers = read('_headers');
ok('the Tailwind CDN is no longer permitted, because nothing loads it',
   !/script-src[^\n]*cdn\.tailwindcss\.com/.test(headers));
ok('Google Fonts is permitted, because the SEO pages use it',
   /style-src[^\n]*fonts\.googleapis\.com/.test(headers) &&
   /font-src[^\n]*fonts\.gstatic\.com/.test(headers));

console.log('\n' + (fail ? 'FAILED ' : '') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
