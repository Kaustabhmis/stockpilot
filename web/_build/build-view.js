/**
 * Assembles the paste-in #view-analytics block for the live single-file Dome Box app.
 * The chart toolkit and render() are taken verbatim from web/analytics.html so there is
 * exactly one implementation of them; only the theme tokens, the markup and the data
 * seam differ. Colours are read through CSS custom properties, so the light theme is a
 * token swap rather than a second copy of the charts.
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const R = p => fs.readFileSync(path.join(root, p), 'utf8');

const src = R('web/analytics.html').split('\n');
// toolkit + render + chrome: from the toolkit comment to just before </script>
const start = src.findIndex(l => l.includes('tiny chart toolkit'));
const end   = src.findIndex(l => l.trim() === '</script>');
if (start < 0 || end < 0) throw new Error('could not locate the script body in analytics.html');
let js = src.slice(start, end).join('\n');

// --- adapt the extracted code to living inside a larger app ---------------
// 1. namespace the tooltip node so it cannot collide with the host app
js = js.replace("document.getElementById('tip')", "document.getElementById('dbx-tip')");
// 2. the boot sequence moves into open(), because a hidden host has clientWidth 0
//    and every chart would silently lay out at its fallback width
js = js.replace(/\nsetSpans\(\);\nsetOffsets\(\);\nrender\(\);\s*$/, '\n');
// 3. resize must not fire work while the view is hidden
js = js.replace(
  "let rt; addEventListener('resize', ()=>{ clearTimeout(rt); rt=setTimeout(render,180); });",
  "let rt; addEventListener('resize', ()=>{ clearTimeout(rt); rt=setTimeout(()=>{ if(isVisible()) render(); },180); });");
// 4. the person <select> is populated at boot in the standalone page
js = js.replace(/\ndocument\.getElementById\('person'\)\.innerHTML =\n[\s\S]*?join\(''\);\n/, '\n');

if (js.includes('setSpans();\nsetOffsets();\nrender();')) throw new Error('boot sequence was not removed');

const engine = R('web/domain.js');
const tpl = R('web/_build/view-analytics.tpl.html');
const out = tpl.replace('/*__ENGINE__*/', () => engine).replace('/*__CHARTS__*/', () => js);

fs.writeFileSync(path.join(root, 'dist/view-analytics.html'), out);
console.log(`dist/view-analytics.html written (${(out.length/1024).toFixed(1)}KB)`);
