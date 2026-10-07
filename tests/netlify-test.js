/**
 * The deploy itself, checked the way the rest of the product is.
 *
 * Everything here is a mistake that is invisible in review and obvious in
 * production: a sitemap listing pages nobody built, a redirect pointing at a
 * file that does not exist, a security header that lives in one config file
 * and not the other, an index.html shipped with the placeholder API URL still
 * in it. None of them throw. All of them are found by a customer.
 *
 * The build is run into a throwaway copy of the folder, so nothing here can
 * leave a generated page — or a test company's GSTIN — in the repository.
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 200) + ']')); v ? pass++ : fail++; };

const REPO = path.join(__dirname, '..');
const NL = path.join(REPO, 'netlify');
const R = (f, d) => fs.readFileSync(path.join(d || NL, f), 'utf8');
const FAKE_API = 'https://script.google.com/macros/s/AKfycbxHARNESSHARNESSHARNESS/exec';

/* A throwaway repo: netlify/ and the one file it reads from dist/. */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dbx-netlify-'));
fs.cpSync(NL, path.join(tmp, 'netlify'), { recursive: true });
/* Generated files are git-ignored, so a developer who ran the build by hand
   has them sitting in the working tree. Copying those in would hide exactly
   the failure this suite exists to catch: a build that publishes nothing. */
['index.html', '404.html', 'privacy.html', 'terms.html', 'refund.html', 'contact.html']
  .forEach((f) => fs.rmSync(path.join(tmp, 'netlify', f), { force: true }));
fs.mkdirSync(path.join(tmp, 'dist'));
fs.copyFileSync(path.join(REPO, 'dist', 'index.html'), path.join(tmp, 'dist', 'index.html'));
const OUT = path.join(tmp, 'netlify');
const build = (env) => {
  try {
    return { ok: true, log: execFileSync('node', ['build.js'],
      { cwd: OUT, env: Object.assign({}, process.env, env || {}), encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e) {
    return { ok: false, log: String(e.stdout || '') + String(e.stderr || '') };
  }
};

console.log('\n=== the build refuses to ship something broken ===');
/* An index.html with the placeholder renders perfectly and then fails every
   login with a network error — worse than no deploy, because it looks fine. */
const noUrl = build({ API_URL: '' });
ok('no API_URL is a failed build, not a warning', !noUrl.ok, noUrl.log.slice(-160));
ok('and it says exactly where to set it', /Environment variables/.test(noUrl.log));
ok('a URL that is not an /exec URL is refused',
   !build({ API_URL: 'https://example.com/hook' }).ok);
ok('nothing was published by the failed build',
   !fs.existsSync(path.join(OUT, 'index.html')));

console.log('\n=== the legal pages are not optional on a live domain ===');
/* /privacy, /terms, /refund and /contact are the ONLY internal links on the
   homepage, so shipping without them means every link in the footer 404s. */
const noLegal = build({ API_URL: FAKE_API });
ok('a blank site-config fails the build', !noLegal.ok, noLegal.log.slice(-200));
ok('and says the footer links would 404', /footer of the live site would 404/.test(noLegal.log));
ok('and names the fields that are missing', /registeredAddress/.test(noLegal.log));
ok('a preview can still be forced through',
   build({ API_URL: FAKE_API, ALLOW_MISSING_LEGAL: '1' }).ok);
ok('the homepage links really are only those four, so the rule stays true',
   (() => {
     const hrefs = [...R('index.html', OUT).matchAll(/href="(\/[^"#]*)"/g)].map((m) => m[1]);
     return [...new Set(hrefs)].every((h) => ['/privacy', '/terms', '/refund', '/contact'].indexOf(h) > -1);
   })(), [...new Set([...R('index.html', OUT).matchAll(/href="(\/[^"#]*)"/g)].map((m) => m[1]))].join(' '));

console.log('\n=== a good build produces a site ===');
const good = build({ API_URL: FAKE_API, ALLOW_MISSING_LEGAL: '1' });
ok('the build succeeds', good.ok, good.log.slice(-300));
ok('there is a homepage at all', fs.existsSync(path.join(OUT, 'index.html')));
const idx = R('index.html', OUT);
ok('the real API URL is in it', idx.indexOf(FAKE_API) > -1);
ok('and the placeholder is gone', idx.indexOf('PASTE_YOUR_APPS_SCRIPT') < 0);
ok('the stylesheet is compiled in, not fetched', idx.indexOf('cdn.tailwindcss.com') < 0);
ok('and it is actually there', /<style>[\s\S]{5000,}?<\/style>/.test(idx));
ok('there is a 404 page', fs.existsSync(path.join(OUT, '404.html')));
ok('which tells search engines not to index it', /noindex/.test(R('404.html', OUT)));

console.log('\n=== the sitemap only lists pages that exist ===');
const sm = R('sitemap.xml', OUT);
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
ok('the sitemap is not empty', locs.length > 5, locs.length);
const missingPages = locs.filter((u) => {
  const slug = u.replace(/^https:\/\/www\.domebox\.in\/?/, '');
  return slug && !fs.existsSync(path.join(OUT, slug + '.html'));
});
ok('every URL in it has a page behind it', missingPages.length === 0, missingPages.join(', '));
ok('the legal pages are left out while they are unbuilt',
   !locs.some((u) => /\/privacy$/.test(u)) || fs.existsSync(path.join(OUT, 'privacy.html')));
ok('the homepage is listed', locs.some((u) => /domebox\.in\/$/.test(u)));
ok('every URL is absolute and https', locs.every((u) => /^https:\/\//.test(u)));
ok('and on the canonical host', locs.every((u) => u.indexOf('https://www.domebox.in') === 0));

console.log('\n=== redirects point somewhere ===');
const red = R('_redirects').split('\n').map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));
const GENERATED = ['privacy.html', 'terms.html', 'refund.html', 'contact.html'];
const broken = red.map((l) => l.split(/\s+/)).filter((p) => {
  const to = p[1] || '';
  if (!to.endsWith('.html')) return false;           // /?login=1 and friends
  const f = to.replace(/^\//, '');
  return !fs.existsSync(path.join(OUT, f)) && GENERATED.indexOf(f) < 0;
}).map((p) => p.join(' '));
ok('no redirect points at a file that is never built', broken.length === 0, broken.join(' | '));
ok('every rule has a status code',
   red.every((l) => /\s(200|301|302|404)\s*$/.test(l)), red.filter((l) => !/\s(200|301|302|404)\s*$/.test(l)).join(' | '));
/* Netlify issues the apex redirect itself once a primary domain is set. A
   hand-written one on top of that is a loop, and a loop takes the whole site
   down rather than one page. */
ok('there is no hand-written apex-to-www rule',
   !red.some((l) => /^https?:\/\//.test(l.split(/\s+/)[0])), red.filter((l) => /^http/.test(l)).join(' | '));

console.log('\n=== the security headers are in both config files ===');
/* Netlify reads netlify.toml AND _headers. A policy in only one of them
   vanishes silently the day the other is replaced. */
const toml = R('netlify.toml'), headers = R('_headers');
const cspToml = (toml.match(/Content-Security-Policy = "([^"]+)"/) || [])[1];
const cspHdr = (headers.match(/Content-Security-Policy: (.+)/) || [])[1];
ok('netlify.toml carries a CSP', !!cspToml);
ok('_headers carries one too', !!cspHdr);
ok('and they are the same policy', cspToml === (cspHdr || '').trim(),
   'toml:' + String(cspToml).slice(0, 60) + ' hdr:' + String(cspHdr).slice(0, 60));
['X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy',
 'Strict-Transport-Security'].forEach((h) => {
  ok(h + ' is set in both', toml.indexOf(h) > -1 && headers.indexOf(h) > -1);
});
ok('the page cannot be framed, so a login overlay is impossible',
   /X-Frame-Options[ =:]+"?DENY/.test(toml) && /frame-ancestors 'none'/.test(cspHdr));

console.log('\n=== the CSP permits what the site loads, and nothing else ===');
const built = fs.readdirSync(OUT).filter((f) => f.endsWith('.html'));
const origins = new Set();
built.forEach((f) => {
  (R(f, OUT).match(/https:\/\/[a-z0-9.-]+/g) || []).forEach((u) => {
    if (!/schema\.org|www\.domebox\.in|tailwindcss\.com|w3\.org/.test(u)) origins.add(u);
  });
});
const allowed = [...origins].filter((o) => cspHdr.indexOf(o.replace('https://', '')) > -1);
ok('every external origin the pages load is permitted',
   allowed.length === origins.size, [...origins].filter((o) => allowed.indexOf(o) < 0).join(', '));
['cdn.jsdelivr.net', 'images.unsplash.com', 'cdn.tailwindcss.com'].forEach((o) => {
  ok(o + ' is not permitted, because nothing loads it', cspHdr.indexOf(o) < 0);
});
ok('Razorpay can still open its checkout frame',
   /frame-src[^;]*checkout\.razorpay\.com/.test(cspHdr));
ok('and the app can still reach Apps Script',
   /connect-src[^;]*script\.google\.com/.test(cspHdr));

console.log('\n=== robots and indexing ===');
const robots = R('robots.txt', OUT);
ok('robots.txt points at the sitemap', /Sitemap: https:\/\/www\.domebox\.in\/sitemap\.xml/.test(robots));
ok('nothing is disallowed', !/^Disallow:\s*\S/m.test(robots.replace(/^#.*$/gm, '')));
ok('the homepage is indexable',
   !/<meta[^>]+name="robots"[^>]+noindex/i.test(idx.slice(0, idx.indexOf('</head>'))));
ok('it has a canonical URL', /<link rel="canonical" href="https:\/\/www\.domebox\.in\/">/.test(idx));
ok('and a social preview image that is absolute',
   /og:image" content="https:\/\/www\.domebox\.in\/og-cover\.png"/.test(idx));
ok('which is actually in the folder', fs.existsSync(path.join(OUT, 'og-cover.png')));

console.log('\n=== nothing fabricated is committed ===');
/* A fabricated GSTIN on a live site is a legal problem, and the way it gets
   there is a generated page committed during testing. */
const cfg = JSON.parse(R('site-config.json'));
['gstin', 'registeredAddress', 'registrationNumber', 'phone'].forEach((k) => {
  const v = String(cfg[k] || '');
  ok(k + ' is blank or real, never a plausible-looking fake',
     !v || !/test|sample|example|xxxx|1234567890|00000/i.test(v), v);
});
const ignored = R('.gitignore');
['index.html', 'privacy.html', 'terms.html', 'refund.html', 'contact.html', '404.html']
  .forEach((f) => ok(f + ' is git-ignored, so a generated copy cannot be committed',
                     ignored.split('\n').map((l) => l.trim()).indexOf(f) > -1));
const tracked = execFileSync('git', ['ls-files', 'netlify'], { cwd: REPO, encoding: 'utf8' })
  .split('\n').map((f) => path.basename(f.trim())).filter(Boolean);
['index.html', 'privacy.html', 'terms.html', 'refund.html', 'contact.html']
  .forEach((f) => ok('no ' + f + ' is actually in git', tracked.indexOf(f) < 0));

console.log('\n=== the legal pages, once the details are filled in ===');
const cfgPath = path.join(OUT, 'site-config.json');
const real = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
Object.assign(real, { registeredAddress: '7 Camac Street, Kolkata 700017',
  phone: '+91 98300 00000', gstin: '19AABCB1234C1ZQ', entityType: 'Proprietorship',
  registrationNumber: 'WB-0001', grievanceOfficerName: 'Kaustabh Mitra',
  jurisdictionCity: 'Kolkata', jurisdictionState: 'West Bengal' });
fs.writeFileSync(cfgPath, JSON.stringify(real, null, 2));
const full = build({ API_URL: FAKE_API });
ok('the build completes with the details filled in', full.ok, full.log.slice(-250));
['privacy', 'terms', 'refund', 'contact'].forEach((p) => {
  ok('/' + p + ' now has a page', fs.existsSync(path.join(OUT, p + '.html')));
});
const sm2 = [...R('sitemap.xml', OUT).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
ok('and they join the sitemap', sm2.some((u) => /\/privacy$/.test(u)));
ok('every sitemap URL still resolves to a file',
   sm2.every((u) => {
     const slug = u.replace(/^https:\/\/www\.domebox\.in\/?/, '');
     return !slug || fs.existsSync(path.join(OUT, slug + '.html'));
   }));
const privacy = R('privacy.html', OUT);
ok('the grievance officer is named on the policy, as the rules require',
   /Kaustabh Mitra/.test(privacy));
ok('the registered address is on it', /Camac Street/.test(privacy));
ok('nothing is left as a placeholder',
   !/\{\{|TODO|FILL ?IN|XXXX/i.test(privacy), (privacy.match(/\{\{[^}]*\}\}/) || [])[0]);

console.log('\n=== the superseded tool cannot overwrite the build ===');
/* prepare.js writes to index.html — the same file build.js owns — from
   patterns that match a page structure that no longer exists. */
const prep = (() => {
  try { execFileSync('node', ['prepare.js', path.join(REPO, 'dist', 'index.html')],
    { cwd: OUT, encoding: 'utf8', stdio: 'pipe' }); return { ok: true, log: '' }; }
  catch (e) { return { ok: false, log: String(e.stdout || '') + String(e.stderr || '') }; }
})();
ok('prepare.js refuses to run', !prep.ok);
ok('and says what replaced it', /build-index\.js/.test(prep.log), prep.log.slice(0, 120));
ok('the built index.html is untouched by it', R('index.html', OUT).indexOf(FAKE_API) > -1);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
