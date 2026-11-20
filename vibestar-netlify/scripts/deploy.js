#!/usr/bin/env node
/**
 * ONE-COMMAND DEPLOY
 *
 *   npm run deploy
 *
 * Fill in .env once, run this, and it does the rest: installs dependencies,
 * links or creates the Netlify site, uploads the environment variables, sets up
 * the database, and publishes.
 *
 * Safe to run repeatedly — that is the normal way to ship an update.
 *
 *   npm run deploy -- --check   validate .env and stop, changing nothing
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, copyFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');

const c = {
  bold: (s) => `[1m${s}[0m`,
  dim: (s) => `[2m${s}[0m`,
  green: (s) => `[32m${s}[0m`,
  red: (s) => `[31m${s}[0m`,
  yellow: (s) => `[33m${s}[0m`,
  cyan: (s) => `[36m${s}[0m`
};

let step = 0;
const heading = (text) => console.log(`\n${c.bold(`[${++step}] ${text}`)}`);
const done = (text) => console.log(`    ${c.green('✓')} ${text}`);
const note = (text) => console.log(`    ${c.dim(text)}`);

function die(message, hint) {
  console.error(`\n${c.red('✗ ' + message)}`);
  if (hint) console.error(`\n${hint}\n`);
  process.exit(1);
}

/** Runs a command, streaming its output. Returns true on success. */
function run(command, args, { allowFailure = false, env = {} } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32',
    env: { ...process.env, ...env }
  });
  if (result.status !== 0 && !allowFailure) {
    die(`\`${command} ${args.join(' ')}\` failed.`);
  }
  return result.status === 0;
}

/** Runs a command quietly and returns its stdout. */
function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32'
  });
  return { ok: result.status === 0, out: `${result.stdout || ''}${result.stderr || ''}` };
}

// ------------------------------------------------------------ 0. checks
console.log(c.bold('\nVibeStar → Netlify\n') + c.dim('─'.repeat(50)));

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  die(`Node ${process.versions.node} is too old.`,
      'Install the LTS version from https://nodejs.org and run this again.');
}

// ------------------------------------------------------- 1. environment
heading('Reading .env');

if (!existsSync(ENV_FILE)) {
  copyFileSync(path.join(ROOT, '.env.example'), ENV_FILE);
  die('No .env file existed, so one has been created for you.',
    `${c.bold('Open .env, fill in these three values, then run `npm run deploy` again:')}\n\n` +
    `  GOOGLE_SHEET_ID       the long id in your spreadsheet's URL\n` +
    `  GOOGLE_CLIENT_EMAIL   from your service-account JSON key\n` +
    `  GOOGLE_PRIVATE_KEY    from the same file, quoted, \\n sequences intact\n\n` +
    `${c.yellow('And share the spreadsheet with GOOGLE_CLIENT_EMAIL as an Editor')} —\n` +
    `creating the key grants access to nothing on its own.\n\n` +
    `${c.dim('Full walkthrough: DEPLOY.md')}`);
}

/** Minimal dotenv parse: enough for quoted multi-line values. */
function parseEnv(text) {
  const values = {};
  const pattern = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(?:"([\s\S]*?)"|'([\s\S]*?)'|([^\n#]*))\s*$/gmi;
  for (const match of text.matchAll(pattern)) {
    values[match[1]] = (match[2] ?? match[3] ?? match[4] ?? '').trim();
  }
  return values;
}

const envValues = parseEnv(readFileSync(ENV_FILE, 'utf8'));

/**
 * A value counts as real only if it is set AND differs from what .env.example
 * ships for that key.
 *
 * Comparing against the example file rather than pattern-matching for
 * "PASSWORD" or "paste-here" is what makes this reliable: the example changes
 * over time, and a regex that has fallen out of step silently lets an untouched
 * placeholder through — which then fails much later, mid-deploy, as a confusing
 * database error.
 */
const exampleValues = parseEnv(readFileSync(path.join(ROOT, '.env.example'), 'utf8'));

function real(key) {
  const value = envValues[key];
  if (!value) return false;
  if (exampleValues[key] && value === exampleValues[key]) return false;
  return true;
}

/**
 * Either database is fine, and which one is configured decides the rest of this
 * script. Postgres wins if both are filled in, matching what the app itself does.
 */
const usePostgres = real('DATABASE_URL');
const useSheets = real('GOOGLE_SHEET_ID') && real('GOOGLE_CLIENT_EMAIL') && real('GOOGLE_PRIVATE_KEY');

if (!usePostgres && !useSheets) {
  die('No database is configured in .env.',
    `${c.bold('Fill in ONE of these two:')}\n\n` +
    `  ${c.cyan('Supabase (recommended)')}\n` +
    `    DATABASE_URL          the POOLED connection string, port 6543\n` +
    `                          Supabase → Project Settings → Database\n\n` +
    `  ${c.cyan('Google Sheets')}\n` +
    `    GOOGLE_SHEET_ID       the long id in your spreadsheet's URL\n` +
    `    GOOGLE_CLIENT_EMAIL   from your service-account JSON key\n` +
    `    GOOGLE_PRIVATE_KEY    from the same file, quoted, \\n sequences intact\n` +
    `    ${c.yellow('and share the spreadsheet with that address as an Editor')}\n\n` +
    `${c.dim('Full walkthrough: DEPLOY.md')}`);
}

const BACKEND = usePostgres ? 'Supabase / Postgres' : 'Google Sheets';
done(`database: ${c.cyan(BACKEND)}`);

if (usePostgres) {
  if (!/^postgres(ql)?:\/\//.test(envValues.DATABASE_URL)) {
    die('DATABASE_URL does not look like a Postgres connection string.',
      'It should start with postgresql:// — copy it from\n' +
      'Supabase → Project Settings → Database → Connection string.');
  }
  // The direct connection exhausts its limit fast under serverless, because each
  // function invocation can open its own connection.
  if (/:5432\//.test(envValues.DATABASE_URL)) {
    note('That looks like the DIRECT connection string (port 5432).');
    note('Prefer the POOLED one (port 6543) — serverless opens many short-lived');
    note('connections and the direct string will run out.');
  }
} else if (!/BEGIN PRIVATE KEY/.test(envValues.GOOGLE_PRIVATE_KEY)) {
  die('GOOGLE_PRIVATE_KEY does not look like a key.',
    'Copy the whole private_key value from the JSON file, including the\n' +
    '-----BEGIN PRIVATE KEY----- and -----END PRIVATE KEY----- lines.');
}

if (usePostgres && real('GOOGLE_SHEET_ID')) {
  note('Both databases are configured; Postgres will be used. Remove');
  note('DATABASE_URL from .env to go back to Google Sheets.');
}

// --check exists so you can validate a .env without installing anything or
// touching a live site — which is also how this script's own tests run.
const CHECK_ONLY = process.argv.includes('--check');

if (!envValues.MEDIA_URL_SECRET) {
  note('MEDIA_URL_SECRET is empty — private media links will be signed with the');
  note('Razorpay secret instead. Set it before launch (see DEPLOY.md).');
}
if (!envValues.RAZORPAY_KEY_ID) {
  note('No Razorpay keys — the site will run in DEMO mode and give subscriptions');
  note('away free. Fine for a preview, never for real users.');
}

if (CHECK_ONLY) {
  console.log(`\n${c.green('✓ .env looks usable.')} Backend: ${c.cyan(BACKEND)}.`);
  console.log(c.dim('  Run without --check to deploy.\n'));
  process.exit(0);
}

// --------------------------------------------------- 2. dependencies
heading('Installing dependencies');
if (existsSync(path.join(ROOT, 'node_modules', '@netlify', 'blobs'))) {
  done('already installed');
} else {
  run('npm', ['install', '--no-audit', '--no-fund']);
  done('installed');
}

// ------------------------------------------------------ 3. netlify CLI
heading('Checking the Netlify CLI');
if (!capture('netlify', ['--version']).ok) {
  note('not found — installing it globally, which may take a minute');
  run('npm', ['install', '-g', 'netlify-cli']);
}
done('Netlify CLI available');

if (!capture('netlify', ['status']).out.match(/Email|Account|logged in/i)) {
  note('Not logged in. A browser window will open for you to authorise.');
  run('netlify', ['login']);
}

// --------------------------------------------------------- 4. the site
heading('Linking the Netlify site');
const status = capture('netlify', ['status']);

if (/Site Id|site-name|Current project/i.test(status.out)) {
  const name = /(?:Project name|Site name):\s*(\S+)/i.exec(status.out);
  done(`already linked${name ? ` to ${c.cyan(name[1])}` : ''}`);
} else {
  note('This folder is not linked to a Netlify site yet.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(
    `\n    Create a ${c.bold('new')} site, or link an ${c.bold('existing')} one? [new/existing] `
  )).trim().toLowerCase();
  rl.close();

  if (answer.startsWith('e')) run('netlify', ['link']);
  else run('netlify', ['sites:create', '--manual']);
  done('linked');
}

// ------------------------------------------- 5. environment variables
heading('Uploading environment variables to Netlify');
// Netlify only reads these at build and run time on its own servers, so the
// local .env has to be pushed up or the deployed functions have no database.
run('netlify', ['env:import', '.env']);
done('uploaded');

// -------------------------------------------------- 6. the database
heading(usePostgres ? 'Applying the database schema' : 'Creating the spreadsheet tabs');

const setupScript = usePostgres ? 'migrate.js' : 'init-sheet.js';
const setup = spawnSync(process.execPath, [path.join(ROOT, 'scripts', setupScript)], {
  cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...envValues }
});

if (setup.status !== 0) {
  if (usePostgres) {
    die('Could not apply the schema.',
      `${c.bold('The usual causes:')}\n\n` +
      `  1. Wrong password in DATABASE_URL. Reset it in Supabase →\n` +
      `     Project Settings → Database → Database password.\n\n` +
      `  2. A password containing @ : / or ? must be percent-encoded in the URL.\n\n` +
      `  3. The project is paused. Free Supabase projects pause after a week\n` +
      `     of inactivity — open the dashboard and resume it.\n\n` +
      `${c.dim('More in DEPLOY.md → Troubleshooting')}`);
  }
  die('Could not set up the spreadsheet.',
    `${c.bold('The two usual causes:')}\n\n` +
    `  1. The spreadsheet is not shared with ${c.cyan(envValues.GOOGLE_CLIENT_EMAIL)}.\n` +
    `     Open it, click Share, add that address as an ${c.bold('Editor')}.\n\n` +
    `  2. GOOGLE_SHEET_ID is wrong. It is only the part of the URL between\n` +
    `     /d/ and /edit — not the whole address.\n\n` +
    `${c.dim('More in DEPLOY.md → Troubleshooting')}`);
}
done(usePostgres ? 'schema applied' : 'tabs ready');

// ------------------------------------------------------------ 7. deploy
heading('Publishing');
run('netlify', ['deploy', '--prod']);

// ------------------------------------------------------------- finish
const final = capture('netlify', ['status']);
const url = /(https:\/\/[a-z0-9-]+\.netlify\.app)/i.exec(final.out);

console.log(`\n${c.dim('─'.repeat(50))}`);
console.log(c.green(c.bold('\nLive.')) + (url ? ` ${c.cyan(url[1])}` : ''));
console.log(`
${c.bold('Check it worked:')} open the site and create an account. Then look in your
${usePostgres
    ? `database — Supabase → Table Editor → ${c.bold('users')}. Your new account is a row there.`
    : `spreadsheet — your new account is a row in the ${c.bold('Users')} tab.`}
If you can see that row, everything is wired up correctly.

${c.bold('Optional:')} ${c.cyan('npm run seed')} adds demo accounts (password demo1234).
${c.bold('Next update:')} just run ${c.cyan('npm run deploy')} again.
`);

if (envValues.RAZORPAY_KEY_ID && !envValues.RAZORPAY_WEBHOOK_SECRET) {
  console.log(c.yellow('One thing left: RAZORPAY_WEBHOOK_SECRET is not set, so payments will'));
  console.log(c.yellow('never settle for anyone who closes the browser mid-checkout.'));
  console.log(c.dim('DEPLOY.md → step 6 sets up the webhook.\n'));
}
