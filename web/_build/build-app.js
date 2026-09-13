/**
 * Assembles dist/domebox-app.html — the complete paste-in block for the live
 * single-file app: task assignment, team management and the reports view, all
 * over one shared store and one copy of the engine.
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const R = p => fs.readFileSync(path.join(root, p), 'utf8');

/* the analytics view, minus its own copy of the engine and its own demo data —
   here it is fed by the shared store instead */
function analyticsBody(){
  const full = R('dist/view-analytics.html');
  const open = full.indexOf('<script>\n(function(){');
  if (open < 0) throw new Error('could not find the analytics IIFE');
  const body = full.slice(open);
  // strip the install-note header and the standalone <div> comment block
  const markup = full.slice(0, full.indexOf('<script>\n/* ====='));
  return { markup: markup.replace(/^<!--[\s\S]*?-->\n/, ''), body };
}

const a = analyticsBody();
const parts = ['01-markup.html','02-store.js','03-tasks.js','04-render.js','05-boot.js']
  .map(f => R('web/_build/app/' + f));

const out = `${parts[0]}

${a.markup}
<script>
/* ===========================================================================
   Dome Box engine — generated from domebox/domain.gs. The same rules the
   backend runs; do not hand-edit.
   =========================================================================== */
${R('web/domain.js')}
</script>

${a.body}

<script>
(function(){
${parts.slice(1).join('\n\n')}
})();
</script>
`;

fs.writeFileSync(path.join(root, 'dist/domebox-app.html'), out);
console.log(`dist/domebox-app.html written (${(out.length/1024).toFixed(1)}KB)`);
