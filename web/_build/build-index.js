/**
 * Assembles dist/index.html — the single front-end file.
 *
 * The stylesheet is COMPILED IN rather than fetched from the Tailwind CDN at
 * runtime. The CDN build generates classes in the browser, which means the
 * first thing a prospect sees depends on a third-party script arriving: a slow
 * or blocked CDN shows them an unstyled page, and that page is the one selling
 * the product. Compiling also drops a ~400KB script to a ~25KB stylesheet.
 *
 * Tailwind scans the assembled file, which holds the markup AND every class
 * string the inline script builds, so dynamically composed classes are picked
 * up too. The build fails loudly rather than shipping a page with no styles.
 */
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const root = path.join(__dirname, '..', '..');
const R = p => fs.readFileSync(path.join(root, p), 'utf8');

const html = ['src/ui/01-head.html','src/ui/00-home.html','src/ui/02-auth-views.html',
              'src/ui/03-app-shell.html']
  .map(R).join('');
const js = ['src/ui/04-core.js','src/ui/05-tasks.js','src/ui/06-team.js',
            'src/ui/07-reports.js','src/ui/08-appraisal.js','src/ui/10-kra.js',
            'src/ui/11-projects.js','src/ui/12-recognition.js','src/ui/13-priority.js','src/ui/09-boot.js']
  .map(R).join('\n\n');

const CDN = '<script src="https://cdn.tailwindcss.com"></script>';
const MARK = '<!--TAILWIND-->';
if (!html.includes(CDN)) throw new Error('build-index: the Tailwind CDN tag moved — check 01-head.html');

const out = html.replace(CDN, MARK) + '\n<script>\n' + js + '\n</script>\n</body>\n</html>\n';
const dest = path.join(root, 'dist/index.html');
fs.writeFileSync(dest, out);

// Pass 1 wrote the file so Tailwind can read every class out of it; pass 2
// puts the resulting stylesheet back in place of the CDN tag.
const cli = path.join(root, 'node_modules/.bin/tailwindcss');
const tmpIn = path.join(__dirname, '.tw-in.css');
const tmpOut = path.join(__dirname, '.tw-out.css');
fs.writeFileSync(tmpIn, '@tailwind base;@tailwind components;@tailwind utilities;');
let css = '';
try {
  execFileSync(cli, ['-c', path.join(__dirname, 'tailwind.domebox.js'),
    '-i', tmpIn, '-o', tmpOut, '--minify'], { stdio: ['ignore', 'ignore', 'inherit'] });
  css = fs.readFileSync(tmpOut, 'utf8');
} finally {
  [tmpIn, tmpOut].forEach(function (f) { if (fs.existsSync(f)) fs.unlinkSync(f); });
}

if (!css || css.length < 5000 || !/\.hidden/.test(css)) {
  throw new Error('build-index: the compiled stylesheet looks wrong (' +
    (css ? css.length : 0) + ' bytes) — refusing to ship an unstyled page');
}
const final = out.replace(MARK, '<style>' + css.trim() + '</style>');
fs.writeFileSync(dest, final);
console.log(`dist/index.html written — ${(final.length/1024).toFixed(1)}KB ` +
            `(stylesheet ${(css.length/1024).toFixed(1)}KB, compiled in)`);
