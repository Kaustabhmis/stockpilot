/**
 * The drag-and-drop website folder, served as plain files the way Netlify
 * serves a manual deploy, talking to the backend through the address in
 * domebox-config.js. Start the test server first: node server.js
 */
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
const { execFileSync } = require('child_process');
const { chromium } = require('/home/user/stockpilot/node_modules/playwright');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 240) + ']')); v ? pass++ : fail++; };
const hit = (p) => new Promise((r) => http.get('http://localhost:8095' + p, (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => r(b)); }));

execFileSync('node', [path.join(__dirname, '..', 'netlify', 'package-static.js')], { stdio: 'ignore' });
const PKG = path.join(__dirname, '..', 'dist', 'netlify-upload');
const EXEC = 'https://script.google.com/macros/s/TESTDEPLOYMENT/exec';

/* What the site is built on is not something a visitor can read in it. The
   address check and the CSP must name the backend host; nothing else may. */
{
  const STACK = /apps ?script|google ?sheets?|spreadsheet-backed|netlify|tailwind|google workspace/i;
  const hits = [];
  fs.readdirSync(PKG).filter((f) => /\.(html|js)$/.test(f)).forEach((f) => {
    const t = fs.readFileSync(path.join(PKG, f), 'utf8');
    const m = t.match(new RegExp('.{0,40}(' + STACK.source + ').{0,40}', 'gi'));
    if (m) hits.push(f + ': ' + m.join(' | '));
  });
  ok('no page or script in the folder names what the site is built on', hits.length === 0, hits.join(' || '));
  const idx = fs.readFileSync(path.join(PKG, 'index.html'), 'utf8');
  ok('and no build comments ship: the code is minified', !/<!--/.test(idx) && !/\/\*[^!]/.test(idx.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')),
     (idx.match(/.{0,40}(<!--|\/\*).{0,40}/) || [''])[0]);
}

/* Two copies of the site: one as the owner fills it in, one left untouched. */
const mk = (fill) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbx-site-'));
  fs.cpSync(PKG, dir, { recursive: true });
  if (fill) {
    let c = fs.readFileSync(path.join(dir, 'domebox-config.js'), 'utf8');
    c = c.replace("apiUrl: 'PASTE_YOUR_EXEC_URL_HERE'", "apiUrl: '" + EXEC + "'")
         .replace("registeredAddress: ''", "registeredAddress: '12 Park Street, Kolkata 700016'")
         .replace("jurisdictionCity: ''", "jurisdictionCity: 'Kolkata'");     // gstin and the rest left blank
    fs.writeFileSync(path.join(dir, 'domebox-config.js'), c);
  }
  return dir;
};
const serve = (dir, port) => new Promise((r) => {
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png',
                  '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.xml': 'application/xml', '.txt': 'text/plain' };
  const s = http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    if (!path.extname(u)) u += '.html';                       // /privacy → privacy.html, as _redirects does
    const f = path.join(dir, u);
    if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  }).listen(port, () => r(s));
});

(async () => {
  await hit('/__demo');
  const filled = mk(true), blank = mk(false);
  const s1 = await serve(filled, 8101), s2 = await serve(blank, 8102);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = async (base) => {
    const p = await b.newPage({ viewport: { width: 1360, height: 860 } });
    /* Stand in for Google: the /exec address in the config reaches the test backend. */
    await p.route(EXEC, async (route) => {
      const r = await fetch('http://localhost:8095/exec', { method: 'POST', body: route.request().postData() });
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: await r.text() });
    });
    p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
    return p;
  };

  console.log('\n=== the folder ===');
  const files = fs.readdirSync(PKG);
  ok('it has the site, the pictures, the manual and the Netlify rules',
     ['index.html', 'privacy.html', 'terms.html', 'refund.html', 'contact.html', '404.html', 'img', 'user-manual.pdf',
      'og-cover.png', 'favicon.svg', '_headers', '_redirects', 'sitemap.xml', 'robots.txt', 'domebox-config.js'].every((f) => files.indexOf(f) > -1),
     files.join(', '));
  ok('and nothing that needs a build: no build scripts, no site-config, no netlify.toml',
     !files.some((f) => /^(build|gen-|prepare|package-static|seo-content).*\.js$|site-config\.json|netlify\.toml|\.md$/.test(f)), files.join(', '));
  ok('the sitemap lists the legal pages too', /\/privacy</.test(fs.readFileSync(path.join(PKG, 'sitemap.xml'), 'utf8')));

  console.log('\n=== uploaded with the config filled in ===');
  const p = await page('http://localhost:8101');
  await p.goto('http://localhost:8101/', { waitUntil: 'networkidle' }); await p.waitForTimeout(600);
  ok('the home page opens', await p.locator('#view-home').isVisible());
  ok('and is connected (no "not connected" message)', !(await p.locator('#dlg').textContent()).includes('not connected'));
  ok('it took the address from domebox-config.js', await p.evaluate(() => API_URL) === EXEC);
  await p.locator('#demo button:has-text("as the owner")').click(); await p.waitForTimeout(3500);
  ok('the live demo opens through the backend', await p.locator('#view-app').isVisible() && /Live demo/.test(await p.locator('#banner').textContent()));
  await p.evaluate(() => leaveDemoForTrial()); await p.waitForTimeout(600);
  await p.fill('#suCompany', 'Mehta Castings'); await p.fill('#suName', 'Rohan');
  await p.fill('#suEmail', 'pkg' + Date.now() + '@mehta.in'); await p.fill('#suPass', 'strongpass123');
  await p.click('#btnSignup'); await p.waitForTimeout(3500);
  ok('a new company can sign up and gets the trial', /Free trial of the full Growth plan/.test(await p.locator('#banner').textContent()));
  ok('the pictures load', await p.evaluate(async () => (await fetch('/img/16-lead-board.jpg')).ok));
  ok('the user manual downloads', await p.evaluate(async () => (await fetch('/user-manual.pdf')).ok));

  await p.goto('http://localhost:8101/privacy', { waitUntil: 'networkidle' }); await p.waitForTimeout(300);
  const priv = await p.locator('body').textContent();
  ok('the privacy page prints the address from the config', /12 Park Street, Kolkata 700016/.test(priv));
  ok('and flags what is still blank, instead of leaving a gap', /\[not set — add gstin in domebox-config\.js\]/.test(priv), priv.slice(0, 200));
  await p.goto('http://localhost:8101/terms', { waitUntil: 'networkidle' });
  ok('the terms page fills the court city in', /Kolkata/.test(await p.locator('body').textContent()));
  ok('nothing threw', p.errs.length === 0, p.errs.join(' | '));

  console.log('\n=== uploaded without editing the config ===');
  const q = await page('http://localhost:8102');
  await q.goto('http://localhost:8102/', { waitUntil: 'networkidle' }); await q.waitForTimeout(600);
  ok('the home page still shows', await q.locator('#view-home').isVisible());
  ok('and says plainly what is missing', /not connected yet.*domebox-config\.js/.test(await q.locator('#dlg').textContent()) && await q.locator('#dlg.dlg-error').isVisible(),
     await q.locator('#dlg').textContent());

  console.log('\n=== a quote missed while editing the config (as happened on the live site) ===');
  const bad = mk(true);
  {
    const f = path.join(bad, 'domebox-config.js');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace("registeredAddress: '12 Park Street, Kolkata 700016'",
      "registeredAddress:289 A Kalighat Road Kolkata 700026 ''"));
  }
  const s3 = await serve(bad, 8103);
  const r = await page('http://localhost:8103');
  await r.goto('http://localhost:8103/', { waitUntil: 'networkidle' }); await r.waitForTimeout(600);
  const said = await r.locator('#dlg').textContent();
  ok('the site says the settings file has a typing mistake — not “not connected”',
     /typing mistake/.test(said) && /near line \d+/.test(said) && !/not connected/.test(said), said);
  if (process.argv[2]) await r.screenshot({ path: process.argv[2] + '/config-typo.png' });
  await r.goto('http://localhost:8103/privacy', { waitUntil: 'networkidle' });
  ok('and the legal pages say the same, instead of “not set” everywhere', /typing mistake near line/.test(await r.locator('body').textContent()));

  await b.close(); s1.close(); s2.close(); s3.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
