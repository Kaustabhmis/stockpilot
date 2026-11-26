#!/usr/bin/env node
/**
 * Generates web/domain.js from domebox/domain.gs.
 *
 * The rules engine must exist in exactly one place. The board enforces the same
 * workflow, dependency, checklist and WIP rules as the Apps Script backend, so
 * the browser cannot offer a move the server would reject. Rather than keep two
 * copies in sync by hand, the browser build is derived from the backend file.
 *
 * Run after editing domain.gs:  node web/_build/build-domain.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'domebox', 'domain.gs');
const OUT = path.join(ROOT, 'web', 'domain.js');

const body = fs.readFileSync(SRC, 'utf8');

const wrapped = `/* AUTO-GENERATED from domebox/domain.gs — do not edit directly.
 * Regenerate with:  node web/_build/build-domain.js
 */
(function (global) {
  var module = { exports: {} };
  var exports = module.exports;

${body}

  global.DomeBox = module.exports;
})(typeof window !== 'undefined' ? window : this);
`;

fs.writeFileSync(OUT, wrapped);

// Sanity check: the generated file must actually define the API the board uses.
const required = [
  'STATUS','ROLE','BOARD_COLUMNS','groupIntoBoard','canDropInColumn','statusForColumn',
  'columnForStatus','allowedTransitions','initialStatusFor','delegationScore','performanceBand',
  'nextOccurrence','openBlockers','subtaskProgress','wipStatus','isOpen','isClosed','ymd','parseYmd',
  'addDays','dayDiff','buildDigest',
];
const sandbox = { window: {} };
new Function('window', wrapped)(sandbox.window);
const missing = required.filter((k) => sandbox.window.DomeBox[k] === undefined);
if (missing.length) {
  console.error('BUILD FAILED — generated bundle is missing: ' + missing.join(', '));
  process.exit(1);
}
console.log(`web/domain.js written (${(wrapped.length / 1024).toFixed(1)}KB), ${Object.keys(sandbox.window.DomeBox).length} exports verified`);
