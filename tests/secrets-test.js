/**
 * Secret safety, kept true: no key, password or signing secret in any tracked
 * file (the repository is public), none in what the browser receives, and the
 * demo's passwords made at random into Script Properties and never printed.
 */
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 400) + ']')); v ? pass++ : fail++; };
const ROOT = path.join(__dirname, '..');

console.log('\n=== nothing secret in any tracked file ===');
const files = execFileSync('git', ['ls-files'], { cwd: ROOT }).toString().trim().split('\n')
  .filter((f) => !/\.(png|jpg|jpeg|ico|pdf|woff2?|ttf|zip)$/i.test(f));
/* Key shapes for every provider this code could ever touch. Test fixtures are
   allowed only where they are obviously fake (HARNESS, ABC123). */
const SHAPES = [
  ['Razorpay key', /rzp_(live|test)_(?!HARNESS|ABC123|your_key_id|X\b)[A-Za-z0-9]{6,}/],
  ['Stripe key', /\b[sp]k_(live|test)_[A-Za-z0-9]{8,}/],
  ['Google API key', /AIza[0-9A-Za-z_-]{30,}/],
  ['AWS key', /AKIA[0-9A-Z]{16}/],
  ['OpenAI key', /\bsk-[A-Za-z0-9]{20,}/],
  ['GitHub token', /\bghp_[A-Za-z0-9]{20,}/],
  ['Slack token', /\bxox[bpa]-[A-Za-z0-9-]{10,}/],
  ['SendGrid key', /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['database URL with a password', /(postgres(ql)?|mongodb(\+srv)?|mysql|redis):\/\/[^:\s'"]+:[^@\s'"]+@/],
  ['Supabase service role key', /service_role["']?\s*[:=]\s*["']eyJ/],
  ['old demo password', /DomeBoxDemo2026|DemoStaff2026/],
  ['old Master sheet id', /1qO3Q2WJ7X3xOf9Xi/],
];
const hits = [];
files.forEach((f) => {
  if (f === 'tests/secrets-test.js') return;                 // this file names the patterns
  let t; try { t = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return; }
  SHAPES.forEach(([name, re]) => { const m = t.match(re); if (m) hits.push(f + ': ' + name + ' (' + m[0].slice(0, 12) + '…)'); });
});
ok('no key, password, token or private key in any of ' + files.length + ' tracked files', hits.length === 0, hits.join(' | '));
ok('.env is ignored by git', /^\.env\*?$/m.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')) &&
   execFileSync('git', ['check-ignore', '-q', '.env'], { cwd: ROOT, stdio: 'pipe' }) !== null);
ok('.env.example is committed, with placeholders only', files.includes('.env.example') &&
   !/=\s*(rzp_live_[A-Za-z0-9]{10,}|AIza|eyJ)/.test(fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8')));
ok('the README warns to rotate anything that was ever committed', /rotate/i.test(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')) &&
   /git history/i.test(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')));

console.log('\n=== nothing secret reaches the browser ===');
const shipped = [];
['dist/netlify-upload', 'dist/lite-upload'].forEach((d) => {
  const dir = path.join(ROOT, d);
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).filter((f) => /\.(html|js)$/.test(f)).forEach((f) => shipped.push([d + '/' + f, fs.readFileSync(path.join(dir, f), 'utf8')]));
});
const leaks = [];
shipped.forEach(([f, t]) => {
  [/RAZORPAY_KEY_SECRET/, /AUTH_PEPPER/, /TOKEN_SECRET/, /DEMO_PASSWORD/, /GEMINI_KEY/, /WA_TOKEN/, /getScriptProperties/]
    .forEach((re) => { if (re.test(t)) leaks.push(f + ': ' + re.source); });
  SHAPES.forEach(([name, re]) => { if (re.test(t)) leaks.push(f + ': ' + name); });
});
ok('the website files (' + shipped.length + ') hold no secret and no secret\'s name', shipped.length > 0 && leaks.length === 0, leaks.join(' | '));

console.log('\n=== the demo\'s passwords ===');
{
  const env = build();
  Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b' });
  env.newFile('MASTER', 'Master');
  const tpl = env.newFile('TEMPLATE', 'Template');
  ['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
  tpl.getSheetByName('Settings').appendRow(['General']);
  const names = Object.keys(env.G);
  const logs = [];
  env.G.Logger = { log: (m) => logs.push(String(m)) };
  const X = new Function(...Object.keys(env.G), fs.readFileSync(path.join(ROOT, 'dist/code.gs'), 'utf8') + '\n;return { doPost, ensureRegistry, createDemoAccount };')(...Object.keys(env.G).map((n) => env.G[n]));
  X.ensureRegistry();
  const report = X.createDemoAccount();
  const pw = env.props.DEMO_PASSWORD, spw = env.props.DEMO_STAFF_PASSWORD;
  ok('with none set, random passwords are made and kept in Script Properties', /^[0-9a-f]{16,}$/.test(pw || '') && /^[0-9a-f]{16,}$/.test(spw || '') && pw !== spw);
  ok('and never printed in the report or the log', !report.includes(pw) && !report.includes(spw) && !logs.join('\n').includes(pw), report.slice(0, 120));
  const call = (b) => JSON.parse(X.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
  ok('the old public password no longer opens the demo', call({ action: 'login', username: 'demo@biscsindia.com', password: 'DomeBox' + 'Demo2026' }).status === 'error');
  ok('the stored one does', call({ action: 'login', username: 'demo@biscsindia.com', password: pw }).status === 'success');
  const login = call({ action: 'login', username: 'demo@biscsindia.com', password: pw });
  ok('a sign-in answer carries no password, hash or secret', !/pass|hash|pepper|secret/i.test(JSON.stringify(Object.assign({}, login, { token: '' }))),
     Object.keys(login).join(','));
  const users = call({ action: 'getUsers', token: login.token }).users;
  ok('and a list of people carries no password hashes', users.length > 1 && users.every((u) => !('password' in u) && !/[0-9a-f]{40,}|\$pbkdf2|pbkdf2\$|sha256\$/i.test(JSON.stringify(u))));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
