#!/usr/bin/env node
/**
 * SUPABASE SETUP WIZARD
 *
 *   npm run supabase
 *
 * Paste the connection string from the Supabase dashboard and this handles
 * everything else: fixes the password placeholder, percent-encodes special
 * characters, checks the connection actually works, warns if you grabbed the
 * direct string instead of the pooled one, writes .env, applies the schema, and
 * offers to add demo data.
 *
 * The three things that trip people up here are all handled rather than
 * documented: the [YOUR-PASSWORD] placeholder, a password containing @ or : or /
 * that silently breaks URL parsing, and the 5432-vs-6543 distinction that only
 * bites later under load.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import pg from 'pg';

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

/**
 * Prompting that also works when input is piped.
 *
 * readline/promises drops any line that arrives while no question() is pending,
 * so a piped `printf 'a\nb\n' | …` loses everything after the first answer. That
 * makes the script untestable and stops anyone scripting it. Buffering the lines
 * as they arrive and serving them from a queue fixes both.
 */
const lineQueue = [];
const waiting = [];
let inputClosed = false;

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (waiting.length) waiting.shift()(line);
  else lineQueue.push(line);
});
rl.on('close', () => {
  inputClosed = true;
  while (waiting.length) waiting.shift()('');
});

function ask(question) {
  process.stdout.write(question);
  if (lineQueue.length) return Promise.resolve(lineQueue.shift());
  if (inputClosed) return Promise.resolve('');
  return new Promise((resolve) => waiting.push(resolve));
}

function bail(message, hint) {
  console.error(`\n${c.red('✗ ' + message)}`);
  if (hint) console.error(`\n${hint}`);
  rl.close();
  process.exit(1);
}

// ------------------------------------------------------------------ intro
console.log(c.bold('\nSupabase setup for VibeStar'));
console.log(c.dim('─'.repeat(52)));
console.log(`
${c.bold('First, in your browser:')}

  1. Go to ${c.cyan('https://supabase.com')} and create a project (free tier is fine).
     ${c.dim('Save the database password it asks you to set — you will need it')}
     ${c.dim('in a moment, and Supabase will not show it to you again.')}

  2. Once the project finishes provisioning, open
     ${c.bold('Project Settings → Database → Connection string')}

  3. Choose the ${c.bold('"Connection pooling"')} tab and copy that URI.
     ${c.dim('It ends in :6543/postgres — that is the one serverless needs.')}
`);

const pasted = (await ask(`${c.bold('Paste the connection string here:')}\n> `)).trim();
if (!pasted) bail('Nothing pasted.');

if (!/^postgres(ql)?:\/\//.test(pasted)) {
  bail('That does not look like a Postgres connection string.',
    'It should begin with postgresql:// — copy it from\n'
    + 'Supabase → Project Settings → Database → Connection string.');
}

// ------------------------------------------------------- the password
/**
 * Supabase shows the string with a literal [YOUR-PASSWORD] placeholder, so most
 * people paste it unchanged. Detect that rather than letting it fail later as an
 * authentication error.
 */
let url = pasted;
const PLACEHOLDER = /\[?YOUR-PASSWORD\]?|\[?YOUR_PASSWORD\]?|\[password\]/i;

if (PLACEHOLDER.test(url)) {
  console.log(`\n${c.dim('That string still has the password placeholder in it.')}`);
  const password = (await ask(`${c.bold('Your database password:')} `)).trim();
  if (!password) bail('No password given.');

  // Percent-encoding is not optional: a password containing @ : / ? or #
  // silently reshapes the URL and the failure looks like a wrong password.
  url = url.replace(PLACEHOLDER, encodeURIComponent(password));
  if (/[@:/?#[\]]/.test(password)) {
    console.log(c.dim('  (special characters encoded for the URL)'));
  }
} else {
  // A password was pasted inline; check it does not contain raw characters that
  // will have already broken the parse.
  try {
    const parsed = new URL(url);
    if (!parsed.password) {
      console.log(`\n${c.yellow('That string has no password in it.')}`);
      const password = (await ask(`${c.bold('Your database password:')} `)).trim();
      if (!password) bail('No password given.');
      parsed.password = encodeURIComponent(password);
      url = parsed.toString();
    }
  } catch {
    bail('That string could not be parsed as a URL.',
      'If your password contains @ : / ? or #, it has to be percent-encoded.\n'
      + 'The simplest fix is to reset the database password in Supabase to\n'
      + 'something alphanumeric, then run this again.');
  }
}

// ------------------------------------------------------- pooled or direct
if (/:5432\//.test(url)) {
  console.log(`\n${c.yellow('That is the DIRECT connection string (port 5432).')}`);
  console.log(c.dim('Serverless functions open many short-lived connections, and the'));
  console.log(c.dim('direct string runs out of them. The pooled one (port 6543) is under'));
  console.log(c.dim('the "Connection pooling" tab on the same page.'));

  const proceed = (await ask(`\nUse it anyway? [y/N] `)).trim().toLowerCase();
  if (!proceed.startsWith('y')) {
    bail('Stopped. Copy the pooled string and run this again.');
  }
}

// ------------------------------------------------------------- connect
console.log(`\n${c.bold('Testing the connection…')}`);

const client = new pg.Client({
  connectionString: url,
  ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000
});

try {
  await client.connect();
  const { rows } = await client.query('SELECT current_database() AS db, version() AS version');
  console.log(`    ${c.green('✓')} connected to ${c.cyan(rows[0].db)}`);
  console.log(`    ${c.dim(rows[0].version.split(',')[0])}`);
  await client.end();
} catch (err) {
  const message = String(err.message || err);
  let hint = '';

  if (/password authentication failed/i.test(message)) {
    hint = 'The password is wrong. Reset it at\n'
         + 'Supabase → Project Settings → Database → Database password,\n'
         + 'then run this again with the new one.';
  } else if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) {
    hint = 'That host does not resolve. Check the string was copied whole —\n'
         + 'it is easy to miss the end of a long line.';
  } else if (/ETIMEDOUT|timeout/i.test(message)) {
    hint = 'The connection timed out. If the project was created moments ago it\n'
         + 'may still be provisioning — wait a minute and try again. A paused\n'
         + 'free project also does this; open the dashboard to resume it.';
  } else if (/does not exist/i.test(message)) {
    hint = 'The database name in the string looks wrong. It should end in\n'
         + '/postgres for a standard Supabase project.';
  }

  bail(`Could not connect: ${message}`, hint);
}

// --------------------------------------------------------------- .env
console.log(`\n${c.bold('Writing .env…')}`);

let envText = '';
if (existsSync(ENV_FILE)) {
  envText = readFileSync(ENV_FILE, 'utf8');
} else if (existsSync(path.join(ROOT, '.env.example'))) {
  envText = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
}

/** Replaces a key in place if present, appends it otherwise. */
function setEnv(text, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(text)) return text.replace(pattern, line);
  return `${text.replace(/\n*$/, '')}\n${line}\n`;
}

envText = setEnv(envText, 'DATABASE_URL', url);

// A media signing secret is needed either way, and leaving it to fall back to
// the Razorpay key means rotating that key breaks every private media link.
if (!/^MEDIA_URL_SECRET=.+$/m.test(envText)) {
  const secret = (await import('node:crypto')).randomBytes(32).toString('hex');
  envText = setEnv(envText, 'MEDIA_URL_SECRET', secret);
  console.log(`    ${c.green('✓')} generated a MEDIA_URL_SECRET`);
}

writeFileSync(ENV_FILE, envText);
console.log(`    ${c.green('✓')} DATABASE_URL saved`);
console.log(`    ${c.dim('.env is gitignored — it holds your database password')}`);

// -------------------------------------------------------------- schema
console.log(`\n${c.bold('Applying the schema…')}`);

const migrate = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'migrate.js')], {
  cwd: ROOT, stdio: 'inherit', env: { ...process.env, DATABASE_URL: url }
});
if (migrate.status !== 0) bail('The schema could not be applied.');

// ---------------------------------------------------------------- seed
const wantSeed = (await ask(`\n${c.bold('Add demo accounts so the app is not empty?')} [Y/n] `))
  .trim().toLowerCase();

if (!wantSeed.startsWith('n')) {
  const seed = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'seed.js')], {
    cwd: ROOT, stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, VIBESTAR_LOCAL_KV: '1' }
  });
  if (seed.status !== 0) {
    console.log(c.yellow('\n  Seeding failed, but the schema is in place — the app will work,'));
    console.log(c.yellow('  it will just start empty. Create an account through the signup screen.'));
  }
}

// -------------------------------------------------------------- finish
rl.close();

console.log(`\n${c.dim('─'.repeat(52))}`);
console.log(c.green(c.bold('\nSupabase is ready.')));
console.log(`
${c.bold('Next:')} ${c.cyan('npm run deploy')}

That uploads DATABASE_URL to Netlify and publishes. Your site will not reach the
database until it does — Netlify only reads environment variables at deploy time.

${c.bold('To check afterwards:')} open the site, create an account, then look in
Supabase → Table Editor → ${c.bold('users')}. Your account is a row there.
`);
