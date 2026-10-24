#!/usr/bin/env node
/**
 * Builds a finished website folder for Netlify DRAG AND DROP — no GitHub, no
 * build step on Netlify.
 *
 *   node netlify/package-static.js        →  dist/netlify-upload/  (+ .zip)
 *
 * Everything that a Netlify build would normally fill in is read instead, in
 * the browser, from ONE file the owner edits in Notepad before uploading:
 *
 *   domebox-config.js   the Apps Script /exec address, and the company details
 *                       the Privacy, Terms, Refund and Contact pages print
 *
 * A detail left blank shows on the page as a highlighted "not set" note rather
 * than vanishing, so an unfinished legal page is obvious to the owner first.
 */
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const here = __dirname, root = path.join(here, '..');
const OUT = path.join(root, 'dist', 'netlify-upload');

/* The fields the legal pages need that only the owner can supply. */
const OWNER_FIELDS = ['registeredAddress', 'phone', 'gstin', 'entityType', 'registrationNumber',
  'grievanceOfficerName', 'jurisdictionCity', 'jurisdictionState'];

const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const cp = (from, to) => fs.cpSync(from, to, { recursive: true });
rm(OUT); fs.mkdirSync(OUT, { recursive: true });

/* What a visitor can read with View Source is the product, not our build
   notes: every comment comes out, and the code is minified. Behaviour is
   unchanged — global names the page's onclick handlers call are kept. */
const esbuild = require('esbuild');
function shrink(html) {
  html = html.replace(/(<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>)([\s\S]*?)(<\/script>)/g, (m, a, js, b) =>
    a + esbuild.transformSync(js, { minifyWhitespace: true, minifySyntax: true, legalComments: 'none', target: 'es2017' }).code.trim() + b);
  html = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (m, a, css, b) =>
    a + esbuild.transformSync(css, { loader: 'css', minify: true, legalComments: 'none' }).code.trim() + b);
  return html.replace(/<!--(?!\[if)[\s\S]*?-->/g, '');
}
const noHashComments = (f) => fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split('\n')
  .filter((l) => !/^\s*#/.test(l)).join('\n').replace(/\n{3,}/g, '\n\n'));

/* ---- 1. the application page ------------------------------------------- */
let app = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
if (!/<style>[\s\S]{5000,}?<\/style>/.test(app)) throw new Error('dist/index.html has no compiled stylesheet — rebuild it first');
/* A typing slip in domebox-config.js (a missing quote) stops the whole file
   loading, which used to look exactly like "no address set". This catches it
   and remembers the line, so the page can say what is actually wrong. */
const CONFIG_CATCH = "<script>window.addEventListener('error',function(e){if(/domebox-config\\.js/.test(e.filename||''))window.DOMEBOX_CONFIG_ERROR={line:e.lineno||0};});</script>\n";
app = app.replace('<head>', '<head>\n' + CONFIG_CATCH + '<script src="/domebox-config.js"></script>');
fs.writeFileSync(path.join(OUT, 'index.html'), shrink(app));

/* ---- 2. the static pages and files, exactly as Netlify serves them ------ */
const STATIC = fs.readdirSync(here).filter((f) =>
  /\.(html|svg|png|pdf|txt)$/.test(f) && f !== 'index.html' && !/^(privacy|terms|refund|contact|404)\.html$/.test(f));
STATIC.forEach((f) => /\.html$/.test(f)
  ? fs.writeFileSync(path.join(OUT, f), shrink(fs.readFileSync(path.join(here, f), 'utf8')))
  : cp(path.join(here, f), path.join(OUT, f)));
cp(path.join(here, 'img'), path.join(OUT, 'img'));
cp(path.join(here, '_headers'), path.join(OUT, '_headers'));
cp(path.join(here, '_redirects'), path.join(OUT, '_redirects'));
noHashComments(path.join(OUT, '_headers')); noHashComments(path.join(OUT, '_redirects'));

/* ---- 3. the legal pages, with the owner's details filled in the browser -- */
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dbx-legal-'));
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'site-config.json'), 'utf8'));
OWNER_FIELDS.forEach((k) => { cfg[k] = 'DBXFIELD' + k + 'DBXEND'; });
fs.copyFileSync(path.join(here, 'gen-pages.js'), path.join(tmp, 'gen-pages.js'));
fs.writeFileSync(path.join(tmp, 'site-config.json'), JSON.stringify(cfg, null, 2));
execFileSync('node', [path.join(tmp, 'gen-pages.js')], { cwd: tmp, stdio: 'ignore' });
const legal = fs.readdirSync(tmp).filter((f) => f.endsWith('.html'));
legal.forEach((f) => {
  let html = fs.readFileSync(path.join(tmp, f), 'utf8');
  /* Inside a tag (a title, a meta description) a span cannot go: the field is
     left out there. In the text it becomes a span the config fills. */
  html = html.replace(/<[^>]*DBXFIELD[^>]*>/g, (tag) => tag.replace(/DBXFIELD(\w+)DBXEND/g, ''));
  html = html.replace(/<title>([^<]*)<\/title>/, (m, t) => '<title>' + t.replace(/DBXFIELD\w+DBXEND/g, '') + '</title>');
  html = html.replace(/DBXFIELD(\w+)DBXEND/g, '<span data-cfg="$1"></span>');
  html = html.replace('</head>', CONFIG_CATCH + '<script src="/domebox-config.js"></script>\n<script src="/domebox-fill.js" defer></script>\n</head>');
  fs.writeFileSync(path.join(OUT, f), shrink(html));
});
rm(tmp);

fs.writeFileSync(path.join(OUT, 'domebox-fill.js'), `(function () {
  var c = window.DOMEBOX_CONFIG || {}, broken = window.DOMEBOX_CONFIG_ERROR;
  var nodes = document.querySelectorAll('[data-cfg]');
  for (var i = 0; i < nodes.length; i++) {
    var v = String(c[nodes[i].getAttribute('data-cfg')] || '').trim();
    if (v) { nodes[i].textContent = v; }
    else {
      nodes[i].textContent = broken
        ? '[domebox-config.js has a typing mistake near line ' + broken.line + ' — a value is missing a quote]'
        : '[not set — add ' + nodes[i].getAttribute('data-cfg') + ' in domebox-config.js]';
      nodes[i].style.cssText = 'background:#fff3cd;color:#7a4b00;padding:0 4px;border-radius:4px;font-weight:700';
    }
  }
})();
`);

/* ---- 4. the one file the owner edits ------------------------------------ */
fs.writeFileSync(path.join(OUT, 'domebox-config.js'), `/* Domebox site settings. Fill in between the quotes and save. */
window.DOMEBOX_CONFIG = {
  apiUrl: 'PASTE_YOUR_EXEC_URL_HERE',   // the address ending in /exec

  /* Printed on the Privacy, Terms, Refund and Contact pages. */
  registeredAddress: '',      // full registered address
  phone: '',                  // e.g. +91 98300 00000
  gstin: '',                  // GSTIN, or write: Not registered
  entityType: '',             // e.g. Proprietorship / Partnership / Private Limited
  registrationNumber: '',     // Udyam / CIN / firm registration number
  grievanceOfficerName: '',   // the person who handles complaints
  jurisdictionCity: '',       // e.g. Kolkata
  jurisdictionState: ''       // e.g. West Bengal
};
`);

/* ---- 5. the sitemap, from the pages actually in the folder --------------- */
const domain = 'https://www.domebox.in';
const pages = fs.readdirSync(OUT).filter((f) => f.endsWith('.html') && f !== '404.html')
  .map((f) => f === 'index.html' ? '/' : '/' + f.replace(/\.html$/, ''));
const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(OUT, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  pages.map((u) => '  <url><loc>' + domain + u + '</loc><lastmod>' + today + '</lastmod></url>').join('\n') +
  '\n</urlset>\n');

console.log('Website folder written: ' + path.relative(root, OUT));
console.log('  ' + fs.readdirSync(OUT).length + ' items, legal pages: ' + legal.join(', '));
