/* Nothing lost: every route, server function, app function, screen element
   and sheet column in BASE (a commit, default the previous audited one) is
   still in today's build. node tests/tools/lost.js [commit] */
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..'), BASE = process.argv[2] || 'HEAD~1';
const at = (f) => execFileSync('git', ['show', BASE + ':' + f], { cwd: ROOT, maxBuffer: 64 << 20 }).toString();
const now = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const diff = (label, a, b) => { const lost = [...a].filter((x) => !b.has(x)), added = [...b].filter((x) => !a.has(x));
  console.log((lost.length ? 'LOST ' : 'ok   ') + label + ': ' + a.size + ' before, ' + b.size + ' now' +
    (lost.length ? '  — missing: ' + lost.join(', ') : '') + (added.length ? '  (+ ' + added.join(', ') + ')' : '')); return lost.length; };
const fns = (s) => new Set([...s.matchAll(/^function\s+([A-Za-z0-9_$]+)\s*\(/gm)].map((m) => m[1]));
const routes = (s) => new Set([...s.matchAll(/case\s+'([A-Za-z]+)'\s*:/g)].map((m) => m[1]));
const uiFns = (s) => new Set([...s.matchAll(/(?:^|[\s;}])function\s+([A-Za-z0-9_$]+)\s*\(/g)].map((m) => m[1]));
const ids = (s) => new Set([...s.matchAll(/\sid="([A-Za-z][\w-]*)"/g)].map((m) => m[1]));
const cols = (s, name) => { const m = s.match(new RegExp('var ' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\];')); return new Set(m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : []); };
let lost = 0;
for (const [label, f] of [['full', 'dist/code.gs'], ['Lite', 'dist/lite/Code.gs']]) {
  lost += diff('API routes (' + label + ')', routes(at(f)), routes(now(f)));
  lost += diff('server functions (' + label + ')', fns(at(f)), fns(now(f)));
}
for (const c of ['TASK_COLS', 'USER_COLS']) lost += diff('sheet columns ' + c, cols(at('dist/code.gs'), c), cols(now('dist/code.gs'), c));
for (const [label, f] of [['domebox.in', 'dist/index.html'], ['Lite', 'dist/lite-upload/index.html']]) {
  lost += diff('app functions (' + label + ')', uiFns(at(f)), uiFns(now(f)));
  lost += diff('screen elements (' + label + ')', ids(at(f)), ids(now(f)));
}
console.log(lost ? '\n' + lost + ' THINGS LOST' : '\nNOTHING LOST');
process.exit(lost ? 1 : 0);
