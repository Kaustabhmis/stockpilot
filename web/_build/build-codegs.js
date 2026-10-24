/**
 * Assembles dist/code.gs — the single backend file to paste into Apps Script.
 * Sources stay modular here; the deliverable is one file, as requested.
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const R = p => fs.readFileSync(path.join(root, p), 'utf8');

/** Strips the Node-only export block; Apps Script has no `module`. */
const lib = p => R(p).replace(/\n?if \(typeof module !== 'undefined'[\s\S]*?\n}\n?/g, '\n');

const parts = [
  ['src/01-config.gs',   null],
  ['src/02-router.gs',   null],
  ['src/03-accounts.gs', null],
  ['src/04-data.gs',     null],
  ['src/05-tasks.gs',    null],
  ['src/06-team.gs',     null],
  ['src/07-reports.gs',  null],
  ['src/08-commerce.gs', null],
  ['src/09-kra.gs',      'KRA / KPI'],
  ['src/10-projects.gs', 'Projects — multi-stage work'],
  ['src/11-recognition.gs', 'Cookie points and the org chart'],
  ['domebox/auth.gs',    'AUTHENTICATION'],
  ['domebox/plans.gs',   'PLAN LIMITS'],
  ['domebox/domain.gs',  'RULES ENGINE'],
];

const banner = (title) => title ? `\n\n// ${'='.repeat(73)}\n// ${title}\n// ${'='.repeat(73)}\n` : '\n\n';

let out = parts.map(([p, title]) => banner(title) + lib(p)).join('');

/* domain.gs and auth.gs each define their own copy of a couple of tiny helpers;
   in one file that is a redeclaration. Keep the first, drop the later ones. */
const dupes = ['function safeEquals_(', 'function toHex_('];
dupes.forEach(sig => {
  let first = out.indexOf(sig);
  if (first < 0) return;
  let next;
  while ((next = out.indexOf(sig, first + 1)) > -1) {
    const end = out.indexOf('\n}', next);
    out = out.slice(0, next) + out.slice(end + 2);
  }
});

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/code.gs'), out);
console.log(`dist/code.gs written — ${(out.length/1024).toFixed(1)}KB, ${out.split('\n').length} lines`);
