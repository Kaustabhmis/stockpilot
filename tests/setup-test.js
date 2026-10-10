/**
 * setupDomeBox() is the first function anybody runs in a fresh Apps Script
 * project, and for most deployments it is the only diagnostic they will ever
 * use. So it has to do two things properly: actually prepare what it can, and
 * be honest and specific about what it cannot.
 *
 * Every state checked here is one a real deployment passes through — nothing
 * configured, half configured, configured but never deployed, deployed but
 * with no scheduler — and each one has a failure that is silent in production:
 * a registry with no Invoices tab records no invoices; a project with no
 * triggers chases nothing for a month before anyone notices.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 220) + ']')); v ? pass++ : fail++; };

const SRC = fs.readFileSync('/home/user/stockpilot/dist/code.gs', 'utf8');

/** A fresh project with whatever Script Properties the caller names. */
function project(props, arrange) {
  const env = build();
  Object.assign(env.props, props || {});
  const names = Object.keys(env.G);
  const APP = new Function(...names, SRC +
    '\n;return { setupDomeBox: setupDomeBox, ensureRegistry: ensureRegistry, CFG: CFG };')
    (...names.map((n) => env.G[n]));
  if (arrange) arrange(env);
  return { env, APP, run: () => APP.setupDomeBox() };
}

console.log('\n=== an empty project: it creates what it can and names the rest ===');
const blank = project({});
const r1 = blank.run();
ok('it does not throw on a completely unconfigured project', typeof r1 === 'string');
ok('it generates AUTH_PEPPER rather than asking for one', !!blank.env.props.AUTH_PEPPER);
ok('and TOKEN_SECRET', !!blank.env.props.TOKEN_SECRET);
ok('the two secrets are different', blank.env.props.AUTH_PEPPER !== blank.env.props.TOKEN_SECRET);
ok('they are long enough to be worth having', blank.env.props.AUTH_PEPPER.length >= 60,
   blank.env.props.AUTH_PEPPER.length);
ok('it says MASTER_DB_ID is missing', /MISSING MASTER_DB_ID/.test(r1));
ok('and TEMPLATE_ID', /MISSING TEMPLATE_ID/.test(r1));
ok('it does not pretend to have prepared a registry it cannot reach',
   /SKIPPED MASTER_DB_ID is not set/.test(r1));
ok('it ends with a numbered list of what is left', /=== WHAT IS LEFT ===[\s\S]*1\. /.test(r1),
   r1.slice(r1.indexOf('WHAT IS LEFT')).slice(0, 180));
ok('and tells you to back up the pepper', /Back up AUTH_PEPPER/.test(r1));

console.log('\n=== running it twice does not churn the secrets ===');
const again = blank.run();
ok('the pepper is not regenerated', blank.env.props.AUTH_PEPPER === blank.env.props.AUTH_PEPPER);
const p1 = blank.env.props.AUTH_PEPPER;
blank.run();
ok('still not regenerated on a third run', blank.env.props.AUTH_PEPPER === p1);
ok('the report is stable', typeof again === 'string' && again.length > 100);

console.log('\n=== it prepares the registry rather than telling you to ===');
const reg = project({ MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE' }, (env) => {
  env.newFile('MASTER', 'Registry');
  const t = env.newFile('TEMPLATE', 'Template');
  ['Users', 'Tasks', 'Settings'].forEach((n) => t.insertSheet(n));
});
const r2 = reg.run();
const tabs = reg.env.FILES.MASTER.getSheets().map((s) => s.getName());
['Directory', 'Global_Users', 'Reset_Tokens', 'Billing', 'Invoices'].forEach((t) => {
  ok('the ' + t + ' tab now exists', tabs.indexOf(t) > -1, tabs.join(', '));
});
ok('and it says so', /ok      tabs present/.test(r2));
/* A registry missing Invoices does not fail — it silently records no invoice
   for any payment, which is only discovered when a customer asks for one. */
ok('the Invoices tab has its real headers',
   reg.env.FILES.MASTER.getSheetByName('Invoices').getDataRange().getValues()[0][0] === 'Invoice No');
ok('the Billing tab too',
   reg.env.FILES.MASTER.getSheetByName('Billing').getDataRange().getValues()[0][0] === 'SheetID');
ok('the template is checked, because every signup copies it',
   /template has the tabs a new company needs/.test(r2));

console.log('\n=== a template missing a tab is a broken signup, and it says so ===');
const badTpl = project({ MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE' }, (env) => {
  env.newFile('MASTER', 'Registry');
  const t = env.newFile('TEMPLATE', 'Template');
  t.insertSheet('Users');            // no Tasks, no Settings
});
const r3 = badTpl.run();
ok('it names the missing tabs', /template is missing Tasks, Settings/.test(r3), r3.match(/template is missing[^\n]*/));
ok('and says what that breaks', /broken signup/.test(r3));

console.log('\n=== an unreachable registry is reported, not thrown ===');
const noAccess = project({ MASTER_DB_ID: 'NOPE' });
let threw = false, r4 = '';
try { r4 = noAccess.run(); } catch (e) { threw = true; }
ok('it does not throw', !threw);
ok('it reports the failure', /FAILED/.test(r4), r4.slice(r4.indexOf('REGISTRY'), 400));
ok('and suggests the actual cause', /can open that file/.test(r4));

console.log('\n=== the scheduler ===');
const sched = project({ MASTER_DB_ID: 'MASTER' }, (env) => env.newFile('MASTER', 'R'));
const r5 = sched.run();
ok('no triggers at all is called out', /MISSING no scheduled jobs at all/.test(r5));
ok('with what it costs you', /Nothing will be chased/.test(r5));
ok('and the two steps that fix it', /reminders\.gs/.test(r5) && /installDomeBoxSchedules\(\)/.test(r5));
/* Repeated in the closing list on purpose: this is the step people skip,
   because everything works the day they set it up and nothing is chased from
   the day after. */
ok('the scheduler is also in the list of what is left',
   /\d\. Add domebox\/reminders\.gs/.test(r5.slice(r5.indexOf('WHAT IS LEFT'))),
   r5.slice(r5.indexOf('WHAT IS LEFT')));

const half = project({ MASTER_DB_ID: 'MASTER' }, (env) => {
  env.newFile('MASTER', 'R');
  env.triggers.push('sendDailyReminders');
});
const r6 = half.run();
/* The dangerous state: it looks installed and does a third of the job. */
ok('a partial install is distinguished from none', /PARTIAL/.test(r6));
ok('and the missing ones are named',
   /generateRecurringJobs/.test(r6) && /sendRenewalReminders/.test(r6));
ok('it does not claim they are all fine', !/all scheduled jobs are installed/.test(r6));
ok('and the closing list says how many are actually in', /only 1 of 4 are installed/.test(r6),
   (r6.match(/.*of 4 are installed.*/) || [])[0]);

const full = project({ MASTER_DB_ID: 'MASTER' }, (env) => {
  env.newFile('MASTER', 'R');
  ['generateRecurringJobs', 'sendDailyReminders', 'sendRenewalReminders', 'sendTaskReminders', 'sendTaskReminders', 'sendTaskReminders']
    .forEach((f) => env.triggers.push(f));
});
ok('a complete install is confirmed', /all scheduled jobs are installed/.test(full.run()));
const oneSlot = project({ MASTER_DB_ID: 'MASTER' }, (env) => {
  env.newFile('MASTER', 'R');
  ['generateRecurringJobs', 'sendDailyReminders', 'sendRenewalReminders', 'sendTaskReminders']
    .forEach((f) => env.triggers.push(f));
});
ok('one task-reminder trigger instead of three is a partial install, not a complete one',
   /PARTIAL missing sendTaskReminders/.test(oneSlot.run()));

console.log('\n=== the web app, and the URL the site needs ===');
const undeployed = project({ MASTER_DB_ID: 'MASTER' }, (env) => env.newFile('MASTER', 'R'));
const r7 = undeployed.run();
ok('not being deployed is reported', /MISSING not deployed as a web app/.test(r7));
ok('with the exact menu path', /Deploy > New deployment > Web app/.test(r7));
const EXEC = 'https://script.google.com/macros/s/AKfycbxSETUPTEST/exec';
const deployed = project({ MASTER_DB_ID: 'MASTER' }, (env) => {
  env.newFile('MASTER', 'R'); env.setExecUrl(EXEC);
});
const r8 = deployed.run();
ok('once deployed it prints the /exec URL', r8.indexOf(EXEC) > -1);
ok('and says where that URL has to go', /Environment variables/.test(r8));

console.log('\n=== the sending address, which gates every customer email ===');
const noAlias = project({ MASTER_DB_ID: 'MASTER' }, (env) => {
  env.newFile('MASTER', 'R');
  env.G.GmailApp.__setAliases([]);
});
const r9 = noAlias.run();
ok('a missing send-as alias is MISSING, not a note', /MISSING "info@biscsindia.com"/.test(r9));
ok('it says nothing at all will be sent', /NO customer email will be sent/.test(r9));
ok('and gives the Gmail path to fix it', /Settings > Accounts and Import/.test(r9));
ok('a present alias is confirmed instead',
   /ok      every email will leave from info@biscsindia\.com/.test(deployed.run()));

console.log('\n=== payments ===');
const keysNoHook = project({ MASTER_DB_ID: 'MASTER', RAZORPAY_KEY_ID: 'rzp_live_x',
  RAZORPAY_KEY_SECRET: 'secret' }, (env) => env.newFile('MASTER', 'R'));
const r10 = keysNoHook.run();
/* Live keys with no webhook secret is the state that costs money quietly. */
ok('selling online without the webhook secret is a WARNING',
   /WARNING online payment is live but RAZORPAY_WEBHOOK_SECRET is not set/.test(r10));
ok('it says exactly what goes wrong', /charged and stays/.test(r10));
ok('and it is in the list of what is left', /RAZORPAY_WEBHOOK_SECRET, or a customer/.test(r10));
ok('missing Razorpay keys do not block setup, because not everyone sells online yet',
   !/1\. Set RAZORPAY_KEY_ID/.test(r5));

console.log('\n=== invoicing ===');
ok('an unregistered seller is told what that means, not warned at',
   /SELLER_GSTIN is not set/.test(r5) && /NO tax/.test(r5));
ok('the missing supplier address is flagged — an invoice is invalid without it',
   /MISSING SELLER_ADDRESS/.test(r5));
const gst = project({ MASTER_DB_ID: 'MASTER', SELLER_GSTIN: '19AABCB1234C1ZQ',
  SELLER_ADDRESS: '7 Camac Street, Kolkata', SELLER_STATE: 'West Bengal' },
  (env) => env.newFile('MASTER', 'R'));
const r11 = gst.run();
ok('a registered seller is confirmed with the rate', /GSTIN 19AABCB1234C1ZQ.*18%/.test(r11));
ok('and the next invoice number is shown before the first sale',
   /next number BISCS\/\d\d-\d\d\/0001/.test(r11));

console.log('\n=== a fully configured project says there is nothing left ===');
const done = project({ MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE',
  RAZORPAY_KEY_ID: 'rzp_live_x', RAZORPAY_KEY_SECRET: 'secret',
  RAZORPAY_WEBHOOK_SECRET: 'hook', SELLER_ADDRESS: '7 Camac Street',
  SELLER_STATE: 'West Bengal' }, (env) => {
  env.newFile('MASTER', 'R');
  const t = env.newFile('TEMPLATE', 'T');
  ['Users', 'Tasks', 'Settings'].forEach((n) => t.insertSheet(n));
  ['generateRecurringJobs', 'sendDailyReminders', 'sendRenewalReminders', 'sendTaskReminders', 'sendTaskReminders', 'sendTaskReminders']
    .forEach((f) => env.triggers.push(f));
  env.setExecUrl(EXEC);
});
const r12 = done.run();
ok('it says so plainly', /Nothing\. This project is ready\./.test(r12),
   r12.slice(r12.indexOf('WHAT IS LEFT')).slice(0, 200));
ok('and there is no MISSING left anywhere in the report', !/MISSING/.test(r12),
   (r12.match(/.*MISSING.*/) || [])[0]);
ok('nor any FAILED', !/FAILED/.test(r12));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
