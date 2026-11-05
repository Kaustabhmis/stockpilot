/* Every page of both websites (served on 8097 and 8098): no script errors, no
   missing files, no broken links or images. */
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..', '..', 'dist');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const probs = []; let n = 0;
  for (const [port, dir] of [[8097, path.join(ROOT, 'netlify-upload')], [8098, path.join(ROOT, 'lite-upload')]]) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html'))) {
      const p = await b.newPage(); n++;
      p.on('pageerror', (e) => probs.push(port + '/' + f + ' script error: ' + e.message));
      p.on('response', (r) => { const u = r.url(); if (u.includes('localhost:' + port) && r.status() >= 400) probs.push(port + '/' + f + ' missing file: ' + u.replace(/.*localhost:\d+/, '') + ' (' + r.status() + ')'); });
      await p.goto('http://localhost:' + port + '/' + f, { waitUntil: 'networkidle' }).catch((e) => probs.push(f + ' ' + e.message));
      const links = await p.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')).filter((h) => /^\/?[a-z0-9-]+\.(html|pdf|txt)(#.*)?$/i.test(h)));
      for (const h of links) { const file = h.replace(/^\//, '').replace(/#.*/, ''); if (!fs.existsSync(path.join(dir, file))) probs.push(port + '/' + f + ' broken link: ' + h); }
      const imgs = await p.$$eval('img', (is) => is.filter((i) => i.complete && i.naturalWidth === 0 && !i.src.startsWith('data:')).map((i) => i.getAttribute('src')));
      imgs.forEach((s) => probs.push(port + '/' + f + ' broken image: ' + s));
      await p.close();
    }
  }
  await b.close();
  console.log(n + ' pages checked.');
  console.log(probs.length ? 'PROBLEMS:\n  ' + probs.join('\n  ') : 'NO PROBLEMS FOUND');
  process.exit(probs.length ? 1 : 0);
})();
