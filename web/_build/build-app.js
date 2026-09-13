/**
 * Assembles dist/domebox-app.html — the complete paste-in block for the live
 * single-file app: task assignment, team management and the reports view, all
 * over one shared store and one copy of the engine.
 */
const fs = require('fs'), path = require('path');

/* In Apps Script every .gs file shares one global scope, so plans.gs and
   whatsapp.gs can call domain.gs helpers directly. In the browser each file is
   wrapped in its own IIFE, so those helpers have to be handed in or the call
   throws at runtime — which is exactly what happened. */
const DOMAIN_ALIASES = [
  'var startOfDay = g.DomeBox.startOfDay, dayDiff = g.DomeBox.dayDiff,',
  '    addDays = g.DomeBox.addDays, ymd = g.DomeBox.ymd, parseYmd = g.DomeBox.parseYmd;',
].join('\n');
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

/* Only the rules half of whatsapp.gs goes to the browser: the I/O half holds
   credentials handling and Apps Script globals that have no meaning here. */
function planRules(){
  const full = R('domebox/plans.gs').replace(/if \(typeof module[\s\S]*$/, '');
  return `(function(g){\n${DOMAIN_ALIASES}\n${full}\n` +
    `g.DomeBoxPlans = { normalizePlan, planLimits, canAddUser, canCreateTask,\n` +
    `  planAllows, planUsage, tasksCreatedInMonth, nextPlanUp };\n})(window);`;
}

function whatsappRules(){
  const full = R('domebox/whatsapp.gs');
  const cut = full.indexOf('// ===========================================================================\n// APPS SCRIPT I/O');
  if (cut < 0) throw new Error('could not find the I/O boundary in whatsapp.gs');
  const pure = full.slice(0, cut).replace(/if \(typeof module[\s\S]*$/, '');
  return `(function(g){\n${DOMAIN_ALIASES}\n${pure}\n` +
    `g.DomeBoxWA = { waNormalizePhone: waNormalizePhone, WA: WA };\n})(window);`;
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
${whatsappRules()}
${planRules()}
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
