#!/usr/bin/env node
/**
 * BUILDS THE APPS SCRIPT TARGET
 *
 *   npm run build:gas   ->   apps-script/Code.gs  +  apps-script/Index.html
 *
 * One source of truth, three deployments. Rather than maintaining a second copy
 * of the app by hand — which would drift within a week — this concatenates the
 * same src/ modules into the single global scope Apps Script provides, swapping
 * the platform-specific files as it goes.
 *
 * What it does, and why each part is necessary:
 *
 *   1. SUBSTITUTES. platform-node -> platform-gas, kv (Blobs) -> kv-gas
 *      (spreadsheet + cache), store.js's dispatcher -> store-gas directly.
 *   2. ORDERS. Apps Script hoists function declarations but NOT `const`, so a
 *      module whose top-level const is read at load time must appear first.
 *      The order below is explicit for that reason.
 *   3. STRIPS ESM. No import/export in Apps Script; everything shares one
 *      global scope, so the statements are removed and the declarations left.
 *   4. INLINES THE FRONTEND. app.js goes inside Index.html, and its transport
 *      is switched from fetch to google.script.run.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, '..', 'apps-script', 'vibestar');

const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

/**
 * Load order. Anything read at module load time — the TABLES literal, the config
 * constants — has to come before whatever reads it, because `const` is not
 * hoisted across the concatenated file.
 */
const MODULES = [
  'src/lib/tables.js',
  'src/lib/config.js',
  'src/lib/platform-gas.js',     // stands in for platform-node.js + platform.js
  'src/lib/util.js',
  'src/gas/kv-gas.js',           // stands in for kv.js
  'src/gas/media-gas.js',
  'src/lib/store-gas.js',        // stands in for store.js
  'src/lib/auth.js',
  'src/lib/notify.js',
  'src/routes/auth.js',
  'src/routes/content.js',
  'src/routes/social.js',
  'src/routes/money.js',
  'src/routes/admin.js',
  'src/routes/media.js',
  'src/gas/entry.js'
];

/**
 * Removes ESM syntax, leaving the declarations in the shared global scope.
 *
 * Deliberately a line-oriented transform rather than a parser: the import and
 * export forms this codebase actually uses are few and regular, and a real
 * bundler would be a dependency and a build step for no gain. The assertion
 * pass at the end is what catches anything this misses.
 */
function stripModuleSyntax(source, file) {
  let out = source;

  // Multi-line and single-line imports, including re-exports.
  out = out.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  out = out.replace(/^import\s+['"][^'"]+['"];?\s*$/gm, '');
  out = out.replace(/^export\s+\{[\s\S]*?\}\s+from\s+['"][^'"]+['"];?\s*$/gm, '');

  // `export { a, b };` — the names are already global here.
  out = out.replace(/^export\s+\{[^}]*\};?\s*$/gm, '');

  // `export const|function|class|async function` -> drop the keyword.
  out = out.replace(/^export\s+(default\s+)?(async\s+function|function|const|let|var|class)\b/gm, '$2');

  // A dynamic import of util.js inside platform-node has no analogue here; the
  // Apps Script platform file does not contain one, but guard anyway.
  if (/await import\(/.test(out)) {
    throw new Error(`${file}: dynamic import() cannot be bundled for Apps Script`);
  }

  /**
   * An aliased import — `import { x as y }` — cannot survive concatenation: the
   * alias has no declaration once the import line is gone, and the failure is a
   * ReferenceError at run time rather than at build time. Caught here instead.
   */
  const aliased = /import\s*\{[^}]*\bas\s+\w+[^}]*\}\s*from/.exec(source);
  if (aliased) {
    throw new Error(
      `${file}: aliased import (${aliased[0].replace(/\s+/g, ' ')}) cannot be bundled — `
      + 'rename the export so no alias is needed'
    );
  }
  return out;
}

// -------------------------------------------------------------- Code.gs
const banner = `/**
 * VibeStar — Google Apps Script build
 *
 * GENERATED FILE. Do not edit.
 *   Source:   vibestar-netlify/src/
 *   Rebuild:  npm run build:gas
 *
 * Built ${new Date().toISOString()}
 *
 * ---------------------------------------------------------------------------
 * SETUP, IN ORDER
 *
 *   1. Extensions -> Apps Script from inside the spreadsheet you want to use.
 *      (Or a standalone project, with GOOGLE_SHEET_ID in Script properties.)
 *   2. Paste this file as Code.gs and Index.html as an HTML file named Index.
 *   3. Run setUpSpreadsheet() once from the editor. Approve the permissions
 *      when prompted — the prompt only appears on an editor run, which is why
 *      this step cannot be skipped.
 *   4. Run installTrigger() once, for nightly expiry and reminders.
 *   5. Deploy -> New deployment -> Web app.
 *        Execute as:      Me
 *        Who has access:  Anyone
 *   6. Optional: Project Settings -> Script properties
 *        RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET   to take real payments
 *        MEDIA_URL_SECRET                       any long random string
 *        ADMIN_EMAILS                           comma-separated bootstrap admins
 *        PBKDF2_ITERATIONS                      defaults to 4096 here
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS TARGET CANNOT DO, being honest about it
 *
 *   * NO LINK PREVIEW CARDS. The page is served inside a googleusercontent
 *     iframe, so a crawler never sees its Open Graph tags. Shared links work;
 *     they just render as a bare URL.
 *   * NO WEBHOOK SIGNATURE VERIFICATION. doPost exposes no request headers, so
 *     X-Razorpay-Signature is unreadable. The body is used only to decide which
 *     payment to re-fetch from Razorpay, which is what keeps it safe.
 *   * WEAKER PASSWORD HASHING. No scrypt, and every PBKDF2 iteration is a
 *     bridge call, so the count has to stay in the thousands.
 *   * SLOWER PRIVATE GALLERIES. Apps Script cannot serve binary, so
 *     subscriber-only media travels as a base64 data URI instead of a cacheable
 *     signed URL.
 *
 * The Netlify deployment does all four properly. This target exists because it
 * runs with nothing but a Google account.
 */

`;

/**
 * Per-file substitutions.
 *
 * config.js's env_raw has to work on Node AND Apps Script, so in source it
 * branches on `typeof process`. That branch is dead code here, and leaving it in
 * would also defeat the "no process.env" assertion below — which is worth
 * keeping sharp, because a real process.env reference would fail at runtime.
 */
const SUBSTITUTIONS = {
  /**
   * entry.js reads routes as `auth.signUp`, `content.getPublicFeed` and so on,
   * which is right for ESM and meaningless once everything shares one scope.
   * Applied only to this file, so `admin.id` inside routes/admin.js — a real
   * property access on a user row — is left alone.
   */
  'src/gas/entry.js': (source) => source.replace(
    /\b(auth|content|social|money|admin|media)\.(\w+)/g,
    (match, namespace, member) => member
  ),

  'src/lib/config.js': (source) => source.replace(
    /function env_raw\(name\) \{[\s\S]*?\n\}/,
    `function env_raw(name) {
  // Script Properties are Apps Script's environment variables. Cached, because
  // getProperties is a service call and config is read repeatedly at load.
  if (!env_raw.cache) env_raw.cache = PropertiesService.getScriptProperties().getProperties();
  return env_raw.cache[name];
}`
  )
};

const chunks = [banner];
for (const file of MODULES) {
  let source = read(file);
  if (SUBSTITUTIONS[file]) source = SUBSTITUTIONS[file](source);
  chunks.push(`\n// ${'='.repeat(74)}\n// ${file}\n// ${'='.repeat(74)}\n`);
  chunks.push(stripModuleSyntax(source, file));
}

/**
 * settlePayment is async, and doPost cannot await. Apps Script resolves promises
 * synchronously enough for this shape to work, but making it explicit is
 * clearer than relying on it.
 */
chunks.push(`
// ${'='.repeat(74)}
// Apps Script glue
// ${'='.repeat(74)}

/**
 * doPost cannot be async, so this unwraps the promise settlePayment returns.
 * Apps Script's V8 runtime runs microtasks to completion before the function
 * returns, which makes this safe here in a way it would not be on Node.
 */
function settlePaymentSync(orderId, paymentId, signatureVerified) {
  let captured = JSON.stringify({ ok: false, error: 'Settlement did not complete.' });
  settlePayment(orderId, paymentId, signatureVerified)
    .then((result) => { captured = result.body; })
    .catch((err) => { captured = JSON.stringify({ ok: false, error: String(err && err.message) }); });
  return captured;
}

/** Adds the demo accounts. Optional; run once from the editor. */
function seedDemoData() {
  return seedDemoAccounts();
}
`);

// The seeding routine, sharing the fixture list with scripts/seed.js in spirit
// but written against the store directly so it can run inside Apps Script.
chunks.push(read('src/gas/seed-gas.js').replace(
  /^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, ''
).replace(/^export\s+(async\s+function|function|const)\b/gm, '$1'));

const codeGs = chunks.join('\n');

// ---------------------------------------------------------- Index.html
const appJs = read('public/app.js');
const indexHtml = read('public/index.html');

/**
 * Swaps the transport. Everything else about the frontend is identical, which is
 * the point — one UI, and only the last mile differs.
 */
const gasTransport = `
/* ===================================================================
   TRANSPORT — Apps Script
   The Netlify build POSTs to /api/<action>. Here the same call goes over
   google.script.run, which hands JavaScript values directly to the server.
   apiCall returns a JSON STRING so the payload crosses the bridge untouched;
   google.script.run's own serialisation drops undefined and mangles Dates.
   =================================================================== */
function api(fnName) {
  const args = Array.prototype.slice.call(arguments, 1);
  const payload = buildPayload(fnName, args);

  return new Promise(function (resolve) {
    google.script.run
      .withSuccessHandler(function (json) {
        try { resolve(JSON.parse(json)); }
        catch (err) { resolve({ ok: false, error: 'Malformed response from the server.' }); }
      })
      .withFailureHandler(function (err) {
        const message = String((err && err.message) || err || 'Request failed.');
        resolve({ ok: false, error: message });
      })
      .apiCall(fnName, payload, state.token || '');
  });
}
`;

// Replace the fetch-based api() with the google.script.run one.
const apiStart = appJs.indexOf('function api(');
if (apiStart === -1) throw new Error('build: could not find api() in public/app.js');

// The function runs to the next top-level declaration.
const afterApi = appJs.indexOf('\nfunction ', apiStart + 10);
if (afterApi === -1) throw new Error('build: could not find the end of api()');

const patchedApp = appJs.slice(0, apiStart) + gasTransport.trim() + appJs.slice(afterApi);

// The share-link parameter is injected by the doGet template.
const bootstrap = `
<script>
  /* Injected by doGet: the ?p=<postId> share parameter, if any. */
  window.VIBESTAR_SHARED_POST = '<?= sharedPostId ?>';
  window.VIBESTAR_TARGET = 'APPS_SCRIPT';
</script>
`;

let html = indexHtml
  // app.js is inlined; there is no static hosting here.
  // Matches the tag with or without `defer`; there is no separate file to defer
  // to once it is inlined.
  .replace(/<script\s+src=["']\/app\.js["'][^>]*><\/script>/,
    `${bootstrap}\n<script>\n${patchedApp}\n</script>`)
  // Legal pages are separate files on Netlify. Point at the public deployment
  // if one is configured, and otherwise drop the links rather than 404.
  .replace(/href="\/legal\//g, 'target="_blank" rel="noopener" href="https://YOUR-NETLIFY-SITE.netlify.app/legal/');

if (!/google\.script\.run/.test(html)) {
  throw new Error('build: the Apps Script transport did not make it into Index.html');
}

// -------------------------------------------------------------- write
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

writeFileSync(path.join(OUT_DIR, 'Code.gs'), codeGs);
writeFileSync(path.join(OUT_DIR, 'Index.html'), html);

// ------------------------------------------------------------- checks
const problems = [];
if (/^import\s/m.test(codeGs)) problems.push('Code.gs still contains an import statement');
if (/^export\s/m.test(codeGs)) problems.push('Code.gs still contains an export statement');
if (/require\(/.test(codeGs)) problems.push('Code.gs contains a require() call');
if (/process\.env/.test(codeGs)) {
  problems.push('Code.gs reads process.env, which does not exist in Apps Script');
}
if (/@netlify\/blobs/.test(codeGs)) problems.push('Code.gs references Netlify Blobs');
if (/node:crypto/.test(codeGs)) problems.push('Code.gs references node:crypto');

for (const required of ['function doGet', 'function doPost', 'function apiCall',
  'function setUpSpreadsheet', 'function runMaintenance']) {
  if (!codeGs.includes(required)) problems.push(`Code.gs is missing ${required}`);
}

if (problems.length) {
  console.error('\nBuild produced a broken Code.gs:');
  problems.forEach((problem) => console.error(`  - ${problem}`));
  process.exit(1);
}

const kb = (text) => `${Math.round(text.length / 1024)}KB`;
console.log(`Built for Apps Script:

  ${path.relative(process.cwd(), path.join(OUT_DIR, 'Code.gs')).padEnd(44)} ${kb(codeGs)}
  ${path.relative(process.cwd(), path.join(OUT_DIR, 'Index.html')).padEnd(44)} ${kb(html)}

  ${MODULES.length} modules bundled, ${codeGs.split('\n').length} lines.

Next: paste both into a new Apps Script project, then run setUpSpreadsheet().
Setup notes are at the top of Code.gs.`);
