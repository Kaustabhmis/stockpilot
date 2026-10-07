/** Assembles dist/index.html — the single front-end file. */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const R = p => fs.readFileSync(path.join(root, p), 'utf8');

const html = ['src/ui/01-head.html','src/ui/02-auth-views.html','src/ui/03-app-shell.html']
  .map(R).join('');
const js = ['src/ui/04-core.js','src/ui/05-tasks.js','src/ui/06-team.js',
            'src/ui/07-reports.js','src/ui/08-appraisal.js','src/ui/10-kra.js','src/ui/11-projects.js','src/ui/09-boot.js']
  .map(R).join('\n\n');

const out = html + '\n<script>\n' + js + '\n</script>\n</body>\n</html>\n';
fs.writeFileSync(path.join(root, 'dist/index.html'), out);
console.log(`dist/index.html written — ${(out.length/1024).toFixed(1)}KB`);
