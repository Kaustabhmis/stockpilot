/**
 * Domebox Lite on the server: the same code with EDITION = 'lite'. One
 * company, the Growth plan for good, and nothing to buy, bill or demo. And
 * the full edition is untouched.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 260) + ']')); v ? pass++ : fail++; };

const boot = (file) => {
  const env = build();
  Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b',
    RAZORPAY_KEY_ID: 'rzp' + '_live_X', RAZORPAY_KEY_SECRET: 's' });
  env.newFile('MASTER', 'Master');
  const tpl = env.newFile('TEMPLATE', 'Template');
  ['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
  tpl.getSheetByName('Settings').appendRow(['General']);
  const names = Object.keys(env.G);
  const P = new Function(...names, fs.readFileSync(file, 'utf8') + '\n;return { doPost, ensureRegistry, createDemoAccount, setupDomeBox, switchOnSchedules, EDITION, MAIL_FROM_NAME };')(...names.map((n) => env.G[n]));
  P.ensureRegistry();
  P.call = (b) => JSON.parse(P.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
  P.env = env;
  return P;
};

const L = boot(__dirname + '/../dist/lite/Code.gs');
/* A correctly set-up Lite account can send as mis@dynamicengineers.in. MAIL_FROM
   is deliberately left unset here: Lite must fall back to that address. */
L.env.G.GmailApp.__setAliases(['mis@dynamicengineers.in']);
console.log('\n=== the Lite build ===');
ok('is the same code with EDITION = lite', L.EDITION === 'lite' && L.MAIL_FROM_NAME === 'Domebox Lite');
const reg = L.call({ action: 'register', form: { companyName: 'Dynamic Engineers', name: 'Kaustabh', email: 'mis@dynamic.in', password: 'ownerpass123' } });
ok('the first sign-up creates the company', reg.status === 'success', JSON.stringify(reg));
ok('and is told no plan or trial', !reg.plan && !reg.trialEnds);
const row = L.env.FILES.MASTER.getSheetByName('Directory').getDataRange().getValues()[1];
ok('the registry says Growth, Active, no end in sight — not a trial', row[3] === 'Growth' && row[4] === '2099-12-31' && row[6] === 'Active', JSON.stringify(row));
const welcome = L.env.mails.find((m) => /Welcome/.test(m.subject));
ok('with MAIL_FROM left blank, Lite still sends from mis@dynamicengineers.in', welcome && welcome.from === 'mis@dynamicengineers.in',
   welcome && welcome.from);
ok('the welcome email says Domebox Lite, with no trial or plans', welcome && /Domebox Lite/.test(welcome.subject) && !/trial|Free plan|choose one/i.test(welcome.html), welcome && welcome.subject);
const second = L.call({ action: 'register', form: { companyName: 'Stranger Ltd', name: 'X', email: 'x@stranger.in', password: 'strangerpass1' } });
ok('a second company is turned away', second.status === 'error' && /already set up for Dynamic Engineers/.test(second.message), JSON.stringify(second));

console.log('\n=== the whole Growth plan, for good ===');
for (let i = 0; i < 12; i++) L.call({ action: 'addUser', token: reg.token, form: { name: 'P' + i, username: 'p' + i, email: 'p' + i + '@dynamic.in', role: 'Doer', manager: '', jobProfile: 'X', password: 'staffpass123' } });
ok('more than the Free limit of people', L.call({ action: 'getUsers', token: reg.token }).users.length === 13);
ok('reports are on', L.call({ action: 'getAnalytics', token: reg.token, period: 'month' }).status === 'success');
{
  /* Even if someone edits the registry to a lapsed date or to Free. */
  const dir = L.env.FILES.MASTER.getSheetByName('Directory');
  dir.getRange(2, 4).setValue('Free'); dir.getRange(2, 5).setValue('2020-01-01'); dir.getRange(2, 7).setValue('Trial');
  const d = L.call({ action: 'getDashboard', token: reg.token });
  ok('editing the registry cannot take it away: still Growth, never stopped', !d.serviceStopped && d.usage.allowReports === true &&
     d.usage.trial === false && d.usage.trialEnded === false, JSON.stringify(d.usage));
}

console.log('\n=== nothing to buy, bill or demo ===');
const refused = ['initiateRazorpay', 'paymentSuccess', 'getBilling', 'saveBilling', 'getInvoices']
  .map((a) => [a, L.call({ action: a, token: reg.token, planName: 'Scale', form: {} })]);
ok('payment, billing and invoices are refused, even for the Admin',
   refused.every(([, r]) => r.status === 'error' && /not part of Domebox Lite/.test(r.message)), JSON.stringify(refused.map(([a, r]) => a + ':' + r.message)));
ok('the public demo and sales enquiries are refused',
   /not part of Domebox Lite/.test(L.call({ action: 'openDemo', as: 'owner' }).message) &&
   /not part of Domebox Lite/.test(L.call({ action: 'contactSales', form: { name: 'x', phone: '9830012345' } }).message));
ok('createDemoAccount does nothing in Lite (it would take the one company slot)', /no demo/.test(L.createDemoAccount()) &&
   L.env.FILES.MASTER.getSheetByName('Directory').getLastRow() === 2);
L.switchOnSchedules();
ok('no 15-minute payment check is scheduled', !L.env.triggerHours.some((t) => t[0] === 'reconcilePayments'), JSON.stringify(L.env.triggerHours));
const setup = L.setupDomeBox();
ok('setup does not ask for Razorpay, and asks for SITE_URL so emails link to Lite', !/RAZORPAY/.test(setup) && /SITE_URL/.test(setup), setup.slice(0, 400));

console.log('\n=== Lite sends from the company’s own address ===');
{
  /* Lite run from mis@dynamicengineers.in's own Google account, with MAIL_FROM
     set to it. That address is the account itself, not an alias. */
  const env = build();
  Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b',
    MAIL_FROM: 'mis@dynamicengineers.in', SITE_URL: 'https://dynamic-lite.netlify.app' });
  env.G.Session.__setUser('mis@dynamicengineers.in');
  env.G.GmailApp.__setAliases([]);
  env.newFile('MASTER', 'Master');
  const tpl = env.newFile('TEMPLATE', 'Template');
  ['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
  tpl.getSheetByName('Settings').appendRow(['General']);
  const names = Object.keys(env.G);
  const src = fs.readFileSync(__dirname + '/../dist/lite/Code.gs', 'utf8') + '\n' + fs.readFileSync(__dirname + '/../domebox/reminders.gs', 'utf8');
  const X = new Function(...names, src + '\n;return { doPost, ensureRegistry, setupDomeBox, rmSendMail_ };')(...names.map((n) => env.G[n]));
  X.ensureRegistry();
  const call = (b) => JSON.parse(X.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
  call({ action: 'register', form: { companyName: 'Dynamic Engineers', name: 'Kaustabh', email: 'kaustabh@dynamicengineers.in', password: 'ownerpass123' } });
  const w = env.mails.find((m) => /Welcome/.test(m.subject));
  ok('the welcome email goes out from mis@dynamicengineers.in, as “Domebox Lite”', w && w.from === 'mis@dynamicengineers.in' &&
     w.name === 'Domebox Lite' && w.via === 'gmail', JSON.stringify(w && { from: w.from, name: w.name, via: w.via }));
  ok('it says Domebox Lite and links to the Lite site, with no BISCS India in it', /Domebox Lite/.test(w.html) &&
     /dynamic-lite\.netlify\.app/.test(w.html) && !/BISCS|biscsindia/.test(w.html));
  X.rmSendMail_('payel@dynamicengineers.in', 'Your tasks today', '<p>Two due today.</p>');
  const r = env.mails[env.mails.length - 1];
  ok('reminders go from the same address, branded Domebox Lite', r.from === 'mis@dynamicengineers.in' && r.name === 'Domebox Lite' &&
     /Domebox Lite/.test(r.html) && /mis@dynamicengineers\.in/.test(r.html) && !/biscsindia/.test(r.html), JSON.stringify({ from: r.from, name: r.name }));
  const st = X.setupDomeBox();
  ok('setup says every email will leave from mis@dynamicengineers.in', /ok\s+every email will leave from mis@dynamicengineers\.in/.test(st), st.slice(st.indexOf('SENDING'), st.indexOf('SENDING') + 200));
  ok('the backup alert goes to the address this installation sends from',
     /sendOpsMail_\(\(typeof CFG === 'function' && CFG\(\)\.mailFrom\) \|\| BACKUP\.ALERT_TO/.test(fs.readFileSync(__dirname + '/../domebox/backup.gs', 'utf8')));
}
{
  /* The same Lite, but run from an account that cannot send as that address:
     nothing goes out from anywhere else, and setup says so. */
  const env = build();
  Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b', MAIL_FROM: 'mis@dynamicengineers.in' });
  env.newFile('MASTER', 'Master');
  const tpl = env.newFile('TEMPLATE', 'Template');
  ['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
  const names = Object.keys(env.G);
  const X = new Function(...names, fs.readFileSync(__dirname + '/../dist/lite/Code.gs', 'utf8') + '\n;return { doPost, ensureRegistry, setupDomeBox };')(...names.map((n) => env.G[n]));
  X.ensureRegistry();
  X.doPost({ postData: { contents: JSON.stringify({ action: 'register', form: { companyName: 'D', name: 'K', email: 'k@d.in', password: 'ownerpass123' } }) }, parameter: {} });
  ok('from an account that cannot send as it, nothing is sent from another address', !env.mails.some((m) => m.to === 'k@d.in'));
  ok('and setup names what to fix', /MISSING "mis@dynamicengineers\.in" is not a verified send-as alias/.test(X.setupDomeBox()));
}

console.log('\n=== and the full edition is untouched ===');
const F = boot(__dirname + '/../dist/code.gs');
ok('the full build says EDITION = full', F.EDITION === 'full' && F.MAIL_FROM_NAME === 'Domebox');
const fr = F.call({ action: 'register', form: { companyName: 'Acme', name: 'A', email: 'a@acme.in', password: 'ownerpass123' } });
ok('sign-up starts a 14-day Growth trial', fr.plan === 'Growth' && !!fr.trialEnds);
ok('and a second company can sign up', F.call({ action: 'register', form: { companyName: 'Beta', name: 'B', email: 'b@beta.in', password: 'ownerpass123' } }).status === 'success');
ok('and the Admin can reach billing', F.call({ action: 'getBilling', token: fr.token }).status === 'success');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
