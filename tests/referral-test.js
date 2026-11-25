/**
 * Referrals and partners. A company's invite link earns it free days when the
 * company it invited first pays (banked while it is on Free). A partner's link
 * earns them a share of every payment, recorded once per payment, shown on a
 * private dashboard. Nothing here can grant a plan by itself. Domebox only.
 */
const fs = require('fs'), crypto = require('crypto');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 300) + ']')); v ? pass++ : fail++; };

const env = build();
Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b',
  RAZORPAY_KEY_ID: 'rzp_test_KEY', RAZORPAY_KEY_SECRET: 'sekret' });
env.G.GmailApp.__setAliases(['info@biscsindia.com']);
env.newFile('MASTER', 'Domebox Master');
const tpl = env.newFile('TEMPLATE', 'Template');
['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
tpl.getSheetByName('Settings').appendRow(['General']);

const RZP = {}, ORDERS = {};
env.G.UrlFetchApp = { fetch(url, opts) {
  const auth = (opts && opts.headers && opts.headers.Authorization) || '';
  const res = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
  if (auth !== 'Basic ' + Buffer.from('rzp_test_KEY:sekret').toString('base64')) return res(401, {});
  let m = url.match(/\/v1\/orders\/([^?]+)$/);
  if (m) return ORDERS[decodeURIComponent(m[1])] ? res(200, ORDERS[decodeURIComponent(m[1])]) : res(404, {});
  m = url.match(/\/v1\/payments\/([^?]+)$/);
  if (m) return RZP[decodeURIComponent(m[1])] ? res(200, RZP[decodeURIComponent(m[1])]) : res(404, {});
  if (/\/v1\/payments\?/.test(url)) return res(200, { items: Object.values(RZP) });
  return res(404, {});
} };

const names = Object.keys(env.G);
const X = new Function(...names, fs.readFileSync(__dirname + '/../dist/code.gs', 'utf8') +
  '\n;return { doPost, ensureRegistry, reconcilePayments, activatePartners, partnerPayoutReport };')(...names.map((n) => env.G[n]));
X.ensureRegistry();
const call = (b) => JSON.parse(X.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
const master = () => env.FILES.MASTER;
const dir = (email) => master().getSheetByName('Directory').getDataRange().getValues().find((r) => r[1] === email);
const tab = (name) => (master().getSheetByName(name) ? master().getSheetByName(name).getDataRange().getValues().slice(1) : []);
let n = 0;
/* A verified payment, as the page reports it: an order the server made, and the payment against it. */
const pay = (token, email, plan, paise) => {
  const id = 'pay_' + (++n), order = 'order_' + n, sheetId = dir(email)[5];
  ORDERS[order] = { id: order, amount: paise, currency: 'INR', notes: { sheetId, plan, company: dir(email)[0] } };
  RZP[id] = { id, order_id: order, status: 'captured', amount: paise, currency: 'INR', notes: ORDERS[order].notes };
  const sig = crypto.createHmac('sha256', 'sekret').update(order + '|' + id).digest('hex');
  return call({ action: 'paymentSuccess', token, razorpay_order_id: order, razorpay_payment_id: id, razorpay_signature: sig });
};
const today0 = () => new Date().toISOString().slice(0, 10);
const plusDays = (ymd, d) => { const x = new Date(ymd); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
const reg = (company, email, ref) => call({ action: 'register', form: { companyName: company, name: company + ' Owner', email, password: 'ownerpass123', ref } });

console.log('\n=== a company invites another ===');
const A = reg('Acme Forgings', 'a@acme.in').token;
const mine = call({ action: 'getReferrals', token: A });
ok('every company has its own invite link', mine.status === 'success' && /^C[A-Z0-9]{5}$/.test(mine.code) && mine.link === 'https://www.domebox.in/?ref=' + mine.code, JSON.stringify(mine));
ok('the same code every time', call({ action: 'getReferrals', token: A }).code === mine.code);
const B = reg('Bharat Tools', 'b@bharat.in', mine.code.toLowerCase()).token;
ok('a company signing up with it is recorded against the inviter', tab('Referrals').some((r) => r[1] === mine.code && r[3] === dir('a@acme.in')[5] && r[5] === 'Bharat Tools' && r[6] === 'signed up'));
ok('and shows in the inviter’s list', (call({ action: 'getReferrals', token: A }).referrals || []).some((r) => r.company === 'Bharat Tools'));
const aUntil = dir('a@acme.in')[4];
env.mails.length = 0;
ok('the invited company pays', pay(B, 'b@bharat.in', 'Starter', 249900).status === 'success');
/* Acme is on the Growth trial (Rs 5,999 a month); Bharat paid Rs 2,499: worth 12 days of Growth, not 30. */
ok('and the inviter gets days worth what was paid, in its own plan (Rs 2,499 of Growth = 12 days)', dir('a@acme.in')[4] === plusDays(aUntil, 12), aUntil + ' -> ' + dir('a@acme.in')[4]);
ok('with an email to say so', env.mails.some((m) => m.to === 'a@acme.in' && /12 free days/.test(m.subject)));
ok('the referral is marked rewarded', tab('Referrals').find((r) => r[1] === mine.code)[6] === 'rewarded');
const aAfter = dir('a@acme.in')[4];
pay(B, 'b@bharat.in', 'Starter', 249900);
X.reconcilePayments();
ok('the second payment, and the same payment reported again, add nothing more', dir('a@acme.in')[4] === aAfter, dir('a@acme.in')[4]);

console.log('\n=== on the Free plan, the days are kept for later ===');
const F = reg('Free Co', 'f@free.in').token;
const fr = master().getSheetByName('Directory'), fi = fr.getDataRange().getValues().findIndex((r) => r[1] === 'f@free.in');
fr.getRange(fi + 1, 4).setValue('Free'); fr.getRange(fi + 1, 5).setValue('');
const fcode = call({ action: 'getReferrals', token: F }).code;
const G = reg('Gamma Gears', 'g@gamma.in', fcode).token;
pay(G, 'g@gamma.in', 'Team', 99900);
ok('a Free company’s reward is banked, not lost', tab('Referrals').find((r) => r[1] === fcode)[6] === 'banked' && call({ action: 'getReferrals', token: F }).bankedDays === 30);
const today = new Date().toISOString().slice(0, 10);
pay(F, 'f@free.in', 'Team', 99900);
ok('and added when it next pays: a month plus the 30 days', dir('f@free.in')[4] === plusDays(today, 30 + 30), dir('f@free.in')[4]);
ok('only once', tab('Referrals').find((r) => r[1] === fcode)[6] === 'rewarded' && call({ action: 'getReferrals', token: F }).bankedDays === 0);

console.log('\n=== a cheap sign-up cannot buy a month of an expensive plan ===');
const S = reg('Scale Corp', 's@scale.in').token;
const sr = master().getSheetByName('Directory'), si = sr.getDataRange().getValues().findIndex((r) => r[1] === 's@scale.in');
sr.getRange(si + 1, 4).setValue('Scale'); sr.getRange(si + 1, 5).setValue(plusDays(today0(), 100));
const sUntil = dir('s@scale.in')[4];
const sock = reg('Sock Puppet', 'x@sock.in', call({ action: 'getReferrals', token: S }).code).token;
pay(sock, 'x@sock.in', 'Team', 99900);
ok('a Rs 999 Team payment earns a Scale company 2 days, not 30', dir('s@scale.in')[4] === plusDays(sUntil, 2), sUntil + ' -> ' + dir('s@scale.in')[4]);

console.log('\n=== what is not counted ===');
const before = tab('Referrals').length;
const H = reg('Hub Ltd', 'h@hub.in', 'CNOPE1');
ok('an unknown code is ignored, and sign-up still works', H.status === 'success' && tab('Referrals').length === before);
ok('staff cannot see the invite page', (() => {
  call({ action: 'addUser', token: A, form: { name: 'Staff', username: 'st', email: 'st@acme.in', role: 'Doer', jobProfile: 'Ops', password: 'staffpass123' } });
  return /Admin account/.test(call({ action: 'getReferrals', token: call({ action: 'login', username: 'st@acme.in', password: 'staffpass123' }).token }).message);
})());

console.log('\n=== partners ===');
const P = master().getSheetByName('Partners') || master().insertSheet('Partners');
if (!P.getDataRange().getValues()[0] || !P.getDataRange().getValues()[0][0]) X.activatePartners();
master().getSheetByName('Partners').appendRow(['Rakesh Gupta', 'Rakesh@CAfirm.in', '9800000000', 'Gupta & Co CAs', '', '', '', '', '', 'UPI rakesh@okhdfc']);
env.mails.length = 0;
const act = X.activatePartners();
const prow = tab('Partners').find((r) => r[0] === 'Rakesh Gupta');
ok('activatePartners gives a code, sets 20%, and marks them Active', /^P[A-Z0-9]{5}$/.test(prow[6]) && prow[4] === 20 && prow[5] === 'Active', JSON.stringify(prow) + act);
const mail = env.mails.find((m) => m.to === 'rakesh@cafirm.in') || { html: '' };
const key = (mail.html.match(/\?partner=([a-f0-9]{40})/) || [])[1];
ok('and emails them their share link and a private dashboard link', !!key && mail.html.indexOf('/?ref=' + prow[6]) > -1, mail.html.slice(0, 200));
ok('the dashboard key itself is not stored, only a hash of it', prow[7] && prow[7] !== key && JSON.stringify(tab('Partners')).indexOf(key) < 0);
const C = reg('Client One', 'c@client.in', prow[6]).token;
pay(C, 'c@client.in', 'Growth', 599900);
pay(C, 'c@client.in', 'Growth', 599900);
X.reconcilePayments();
const earn = tab('PartnerEarnings').filter((r) => r[1] === prow[6]);
ok('every payment from their client earns 20% of it, once per payment', earn.length === 2 && earn.every((r) => r[8] === 1199.8 && r[7] === 20), JSON.stringify(earn));
ok('a company that came through a partner does not also earn a company reward', !tab('Referrals').some((r) => r[1] === prow[6] && r[6] === 'rewarded'));
let dash = call({ action: 'getPartnerDashboard', key });
ok('the partner’s dashboard opens without a password, from the link', dash.status === 'success' && dash.partner.name === 'Rakesh Gupta' && dash.companies.length === 1 && dash.companies[0].paying, JSON.stringify(dash).slice(0, 300));
ok('showing earned and due', dash.earned === 2399.6 && dash.due === 2399.6 && dash.paidOut === 0, dash.earned + ' ' + dash.due);
const E = master().getSheetByName('PartnerEarnings'), ei = E.getDataRange().getValues().findIndex((r) => r[1] === prow[6]);
E.getRange(ei + 1, 10).setValue('2026-12-05 UPI 12345');
dash = call({ action: 'getPartnerDashboard', key });
ok('writing "Paid out" in the sheet moves it from due to paid', dash.paidOut === 1199.8 && dash.due === 1199.8, dash.paidOut + ' ' + dash.due);
ok('below the Rs 2,500 minimum, the payout report says to carry it over, not pay', /unpaid Rs 1199\.80 \(below the Rs 2500 minimum/.test(X.partnerPayoutReport()), X.partnerPayoutReport());
ok('and the dashboard says how much more is needed', dash.payoutMinimum === 2500);
ok('a wrong key is refused', /not valid/.test(call({ action: 'getPartnerDashboard', key: 'f'.repeat(40) }).message) &&
   /not valid/.test(call({ action: 'getPartnerDashboard', key: '<script>' }).message));
const pr = tab('Partners').findIndex((r) => r[0] === 'Rakesh Gupta');
master().getSheetByName('Partners').getRange(pr + 2, 6).setValue('Resend');
X.activatePartners();
ok('"Resend" sends a fresh link and the old one stops working', /not valid/.test(call({ action: 'getPartnerDashboard', key }).message) &&
   tab('Partners').find((r) => r[0] === 'Rakesh Gupta')[6] === prow[6]);
master().getSheetByName('Partners').getRange(pr + 2, 6).setValue('Paused');
const nRef = tab('Referrals').length;
reg('Late Client', 'l@late.in', prow[6]);
ok('a paused partner’s link records nobody new', tab('Referrals').length === nRef);
const nEarn = tab('PartnerEarnings').length;
pay(C, 'c@client.in', 'Growth', 599900);
ok('and a paused partner earns nothing on renewals meanwhile', tab('PartnerEarnings').length === nEarn);
master().getSheetByName('Partners').getRange(pr + 2, 6).setValue('Active');
pay(C, 'c@client.in', 'Growth', 599900);
ok('set back to Active, they earn again', tab('PartnerEarnings').length === nEarn + 1);

console.log('\n=== anyone can refer: a staff member, in the app ===');
call({ action: 'addUser', token: A, form: { name: 'Payel Sen', username: 'payel', email: 'payel@acme.in', role: 'Doer', jobProfile: 'Ops', password: 'staffpass123' } });
const PT = call({ action: 'login', username: 'payel@acme.in', password: 'staffpass123' }).token;
const my = call({ action: 'getMyReferral', token: PT });
ok('any user, not only the Admin, gets their own link', my.status === 'success' && /^R[A-Z0-9]{5}$/.test(my.partner.code) && my.link === 'https://www.domebox.in/?ref=' + my.partner.code, JSON.stringify(my).slice(0, 300));
ok('the same link every time', call({ action: 'getMyReferral', token: PT }).partner.code === my.partner.code &&
   tab('Partners').filter((r) => r[1] === 'payel@acme.in').length === 1);
ok('10%, for as long as the company pays', my.partner.pct === 10 && !my.partner.months && my.partner.kind === 'referrer', JSON.stringify(my.partner));
const sv = call({ action: 'saveReferralPayout', token: PT, payout: 'payel@okicici' });
ok('they add a UPI ID for payouts, shown back masked', sv.status === 'success' && tab('Partners').find((r) => r[1] === 'payel@acme.in')[9] === 'payel@okicici' && sv.payout !== 'payel@okicici');
const R1 = reg('Referred Works', 'rw@referred.in', my.partner.code).token;
ok('a company signing up with it is recorded as hers', tab('Referrals').some((r) => r[1] === my.partner.code && r[2] === 'referrer'));
pay(R1, 'rw@referred.in', 'Growth', 599900);
pay(R1, 'rw@referred.in', 'Growth', 599900);
let re = tab('PartnerEarnings').filter((r) => r[1] === my.partner.code);
ok('each payment earns 10% of the package it paid for, once per payment', re.length === 2 && re.every((r) => r[8] === 599.9 && r[7] === 10), JSON.stringify(re));
ok('her company gets no free days for it', !tab('Referrals').some((r) => r[1] === my.partner.code && r[6] === 'rewarded'));
const EE = master().getSheetByName('PartnerEarnings'), back = new Date(); back.setMonth(back.getMonth() - 30);
EE.getDataRange().getValues().forEach((r, i) => { if (r[1] === my.partner.code) EE.getRange(i + 1, 1).setValue(back); });
pay(R1, 'rw@referred.in', 'Growth', 599900);
ok('two and a half years on, it still pays her while the company stays a customer', tab('PartnerEarnings').filter((r) => r[1] === my.partner.code).length === 3);
env.props.REFERRER_MONTHS = '12';
pay(R1, 'rw@referred.in', 'Growth', 599900);
ok('with REFERRER_MONTHS set, commission stops after that many months', tab('PartnerEarnings').filter((r) => r[1] === my.partner.code).length === 3);
delete env.props.REFERRER_MONTHS;
const mine2 = call({ action: 'getMyReferral', token: PT });
ok('her window shows the company, what she earned and what is due', mine2.companies.length === 1 && mine2.companies[0].paying && mine2.earned === 1799.7 && mine2.due === 1799.7, JSON.stringify(mine2).slice(0, 300));
const nr = tab('Referrals').length;
reg('Payel Own Co', 'payel@acme.in', my.partner.code);
ok('nobody earns on their own company', tab('Referrals').length === nr);

console.log('\n=== anyone can refer: a stranger, from the website ===');
env.mails.length = 0;
const j1 = call({ action: 'joinReferral', form: { name: 'Sourav Das', email: 'Sourav@Gmail.com', phone: '98300 00000', payout: 'sourav@okaxis' } });
const srow = tab('Partners').find((r) => r[1] === 'sourav@gmail.com');
ok('a person who is not a customer gets a link at once', j1.status === 'success' && srow && /^R/.test(srow[6]) && srow[5] === 'Active' && srow[10] === 'referrer' && srow[9] === 'sourav@okaxis', JSON.stringify(srow) + j1.message);
const sm = env.mails.find((m) => m.to === 'sourav@gmail.com') || { html: '' };
const skey = (sm.html.match(/\?partner=([a-f0-9]{40})/) || [])[1];
ok('the link and a private dashboard go only to that email', !!skey && sm.html.indexOf('/?ref=' + srow[6]) > -1 && /for as long as it stays a paying customer/.test(sm.html) &&
   JSON.stringify(j1).indexOf(srow[6]) < 0, JSON.stringify(j1));
const sd = call({ action: 'getPartnerDashboard', key: skey });
ok('the dashboard opens and says 10%', sd.status === 'success' && sd.partner.pct === 10 && sd.partner.kind === 'referrer');
env.mails.length = 0;
const j2 = call({ action: 'joinReferral', form: { name: 'Someone Else', email: 'sourav@gmail.com' } });
ok('asking again with the same email makes no second link, and says the same as for a new one',
   tab('Partners').filter((r) => r[1] === 'sourav@gmail.com').length === 1 && j2.message.replace(/to .*$/, '') === j1.message.replace(/to .*$/, ''));
const skey2 = ((env.mails.find((m) => m.to === 'sourav@gmail.com') || { html: '' }).html.match(/\?partner=([a-f0-9]{40})/) || [])[1];
ok('it emails a fresh dashboard link, and the old one stops working', !!skey2 && /not valid/.test(call({ action: 'getPartnerDashboard', key: skey }).message));
ok('the UPI ID can be changed from the dashboard link', call({ action: 'saveReferralPayoutByKey', key: skey2, payout: 'sourav@ybl' }).status === 'success' &&
   tab('Partners').find((r) => r[1] === 'sourav@gmail.com')[9] === 'sourav@ybl');
ok('but not with a wrong key', call({ action: 'saveReferralPayoutByKey', key: 'e'.repeat(40), payout: 'x@ybl' }).status === 'error');
const nP = tab('Partners').length;
ok('a bot filling the hidden field gets nothing', call({ action: 'joinReferral', form: { name: 'Bot', email: 'bot@spam.io', website: 'http://x' } }).status === 'success' && tab('Partners').length === nP);
ok('a bad email is refused', /valid email/.test(call({ action: 'joinReferral', form: { name: 'X Y', email: 'not-an-email' } }).message));
ok('one email cannot ask again and again', (() => { for (let i = 0; i < 4; i++) call({ action: 'joinReferral', form: { name: 'Flood', email: 'flood@spam.io' } });
   return /Too many attempts/.test(call({ action: 'joinReferral', form: { name: 'Flood', email: 'flood@spam.io' } }).message); })());
ok('under Rs 2,500 a referrer is not paid yet', /\(referrer\)[^\n]*unpaid Rs 1799\.70 \(below the Rs 2500 minimum/.test(X.partnerPayoutReport()), X.partnerPayoutReport());
pay(R1, 'rw@referred.in', 'Growth', 599900); pay(R1, 'rw@referred.in', 'Growth', 599900);
ok('once the balance reaches it, the report says pay now, and where', /\(referrer\)[^\n]*due now Rs 2999\.50[^\n]*pay to: payel@okicici/.test(X.partnerPayoutReport()), X.partnerPayoutReport());
env.props.PAYOUT_MINIMUM_RS = '0';
ok('the minimum is one setting (PAYOUT_MINIMUM_RS)', /\(referrer\)[^\n]*due now Rs 2999\.50/.test(X.partnerPayoutReport()) && /Rakesh Gupta  earned[^\n]*due now/.test(X.partnerPayoutReport()));
delete env.props.PAYOUT_MINIMUM_RS;
ok('the email to a new referrer states the minimum', /Rs 2,500/.test(sm.html));
ok('a CA partner keeps their own 20%', tab('Partners').find((r) => r[0] === 'Rakesh Gupta')[4] === 20);

console.log('\n=== erasing a company takes its name out of the referral records ===');
const X2 = new Function(...names, fs.readFileSync(__dirname + '/../dist/code.gs', 'utf8') + '\n;return { eraseCompanyData };')(...names.map((n) => env.G[n]));
X2.eraseCompanyData('c@client.in', 'ERASE c@client.in');
ok('the partner records keep the amounts but not the name', tab('Referrals').some((r) => r[1] === prow[6] && r[5] === '(erased)') &&
   tab('PartnerEarnings').filter((r) => r[1] === prow[6]).every((r) => r[2] === '(erased)' && r[8] > 0));

console.log('\n=== Domebox Lite has none of it ===');
const envL = build();
Object.assign(envL.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b' });
envL.G.GmailApp.__setAliases(['mis@dynamicengineers.in']);
envL.newFile('MASTER', 'Master');
const tl = envL.newFile('TEMPLATE', 'Template');
['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((x) => tl.insertSheet(x));
tl.getSheetByName('Settings').appendRow(['General']);
const nl = Object.keys(envL.G);
const L = new Function(...nl, fs.readFileSync(__dirname + '/../dist/lite/Code.gs', 'utf8') + '\n;return { doPost, ensureRegistry };')(...nl.map((x) => envL.G[x]));
L.ensureRegistry();
const lcall = (b) => JSON.parse(L.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
const LT = lcall({ action: 'register', form: { companyName: 'Dynamic Engineers', name: 'Owner', email: 'o@de.in', password: 'ownerpass123', ref: 'CABCDE' } }).token;
ok('no invite page in Lite', /not part of Domebox Lite/.test(lcall({ action: 'getReferrals', token: LT }).message));
ok('no partner dashboard in Lite', /not part of Domebox Lite/.test(lcall({ action: 'getPartnerDashboard', key: 'a'.repeat(40) }).message));
ok('and no referral links in Lite', /not part of Domebox Lite/.test(lcall({ action: 'joinReferral', form: { name: 'A B', email: 'a@b.in' } }).message));
ok('and a ref code at sign-up is ignored', !envL.FILES.MASTER.getSheetByName('Referrals'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
