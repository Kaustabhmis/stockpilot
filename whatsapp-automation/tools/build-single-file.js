/**
 * Developer tool (not part of the Apps Script project): concatenates src/*.gs into
 * dist/Code.gs so the whole system can be pasted into a single Apps Script file.
 *
 *   node whatsapp-automation/tools/build-single-file.js
 *
 * File order does not matter in Apps Script (all files share one global scope), but
 * Constants/Config/Utils go first for readability. The client app (client-app/) is a
 * separate static website and is not part of this bundle.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const first = ['Constants.gs', 'Config.gs', 'Utils.gs'];
const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.gs'))
  .sort((a, b) => (first.indexOf(a) + 1 || 99) - (first.indexOf(b) + 1 || 99) || a.localeCompare(b));

function build() {
  const header = [
    '/**',
    ' * WhatsApp Campaign Automation — single-file build (GENERATED, do not edit).',
    ' * Source of truth: whatsapp-automation/src/*.gs. Rebuild with tools/build-single-file.js.',
    ' * Paste into one Apps Script file named Code.gs and use src/appsscript.json as the manifest.',
    ' */',
    '',
  ].join('\n');
  return header + files.map(f => '/* ' + '='.repeat(30) + ' ' + f + ' ' + '='.repeat(30) + ' */\n\n' +
    fs.readFileSync(path.join(srcDir, f), 'utf8').trimEnd() + '\n').join('\n');
}

module.exports = { build };

if (require.main === module) {
  const out = path.join(root, 'dist', 'Code.gs');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, build());
  console.log('Wrote ' + path.relative(process.cwd(), out) + ' from ' + files.length + ' files: ' + files.join(', '));
}
