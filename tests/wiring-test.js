/**
 * The joins between files. Each file can be correct on its own and the product
 * still broken where two of them meet: a button calling an API route that was
 * renamed, a help link pointing at a section that was retitled, an onclick
 * naming a function that moved. None of those throw at build time. All of them
 * are found by a customer clicking something.
 */
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 200) + ']')); v ? pass++ : fail++; };

const UI = fs.readFileSync('/home/user/stockpilot/dist/index.html', 'utf8');
const C = fs.readFileSync('/home/user/stockpilot/dist/code.gs', 'utf8');

console.log('\n=== the front end only calls routes that exist ===');
const routes = new Set([...C.matchAll(/case '(\w+)':/g)].map((m) => m[1]));
const calls = [...new Set([...UI.matchAll(/api\('(\w+)'/g)].map((m) => m[1]))];
ok('the UI makes API calls at all', calls.length > 30, calls.length);
const orphan = calls.filter((c) => !routes.has(c));
ok('every one of them has a route in code.gs', orphan.length === 0, orphan.join(', '));

console.log('\n=== every help link lands somewhere ===');
const help = JSON.parse(UI.match(/var HELP = (\{[\s\S]*?\});\n/)[1]);
const ids = new Set(help.sections.map((s) => s.id));
const refs = [...new Set([...UI.matchAll(/openHelp\(\\?'([a-z-]+)\\?'\)/g)].map((m) => m[1]))];
ok('the app links into help from somewhere', refs.length > 0, refs.length);
ok('every openHelp() target is a real section', refs.every((r) => ids.has(r)),
   refs.filter((r) => !ids.has(r)).join(', '));
ok('every tab opens on a real section', Object.values(help.forTab).every((v) => ids.has(v)),
   Object.entries(help.forTab).filter(([, v]) => !ids.has(v)).map(([k]) => k).join(', '));
const gos = help.sections.flatMap((s) => [...s.html.matchAll(/data-go="([^"]+)"/g)].map((m) => m[1]));
ok('every link inside the manual resolves', gos.every((g) => ids.has(g)),
   gos.filter((g) => !ids.has(g)).join(', '));

console.log('\n=== every inline handler names a function that exists ===');
const defined = new Set([...UI.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
const handlers = [...new Set([...UI.matchAll(/onclick=\\?"([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1]))];
ok('there are inline handlers to check', handlers.length > 5, handlers.length);
const missing = handlers.filter((f) => !defined.has(f));
ok('none of them is undefined', missing.length === 0, missing.join(', '));

console.log('\n=== no two elements share an id ===');
/* $(id) returns the FIRST element with that id. Two of them, and every
   handler meant for the second lands on the first. This happened twice: the
   task status dialog and the goal editor were both named after a filter on
   the Tasks bar, so pressing Submit in either did a native form submit,
   reloaded the page and saved nothing. */
const idCount = {};
for (const mm of UI.matchAll(/id=\\?"([A-Za-z][\w-]*)\\?"/g)) idCount[mm[1]] = (idCount[mm[1]] || 0) + 1;
const dupIds = Object.keys(idCount).filter((k) => idCount[k] > 1);
ok('every id in the page is declared once', dupIds.length === 0, dupIds.map((k) => k + '×' + idCount[k]).join(', '));
ok('and there are enough of them for that to mean something', Object.keys(idCount).length > 200, Object.keys(idCount).length);

console.log('\n=== the scheduler and setup agree on names ===');
const rem = fs.readFileSync('/home/user/stockpilot/domebox/reminders.gs', 'utf8');
['generateRecurringJobs', 'sendDailyReminders', 'sendRenewalReminders'].forEach((h) => {
  ok(h + ' is defined where the trigger will call it', new RegExp('^function ' + h + '\\(', 'm').test(rem));
  ok('and is the name setupDomeBox looks for', C.indexOf("'" + h + "'") > -1);
});

console.log('\n=== every function a guide says to run can be run from the editor ===');
/* The Apps Script Run button calls a function with NO arguments. A guide that
   says "run deleteDemoAccount(true)" describes something nobody can do without
   writing code — and the guides are for the person who should not have to. */
const gs = [C].concat(['reminders', 'backup', 'remediate-sharing'].map((f) =>
  fs.readFileSync('/home/user/stockpilot/domebox/' + f + '.gs', 'utf8'))).join('\n');
const sigs = {};
[...gs.matchAll(/^function ([A-Za-z]\w*)\(([^)]*)\)/gm)].forEach((m) => { sigs[m[1]] = m[2].trim(); });
['DEPLOY-EASY.md', 'SETUP.md', 'MIGRATING-CUSTOMERS.md'].forEach((doc) => {
  const md = fs.readFileSync('/home/user/stockpilot/' + doc, 'utf8');
  const told = [...new Set([...md.matchAll(/[Rr]un\s+\**`([A-Za-z]\w*)(\([^)`]*\))?`/g)].map((m) => m[1] + (m[2] || '')))];
  const bad = told.filter((t) => {
    const name = t.replace(/\(.*$/, ''), call = (t.match(/\((.*)\)/) || [, ''])[1];
    if (!(name in sigs)) return true;                 // not a real function
    return call.trim() !== '';                        // asks the reader to pass something
  });
  ok(doc + ' only tells people to run things the Run button can run', bad.length === 0, bad.join(', '));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
