// ===========================================================================
// REFERRALS AND PARTNERS — growth that pays for itself (Domebox only)
// ===========================================================================
//
// One mechanism, two kinds of code in the sign-up link (www.domebox.in/?ref=X):
//
//   C-codes  every company has one (Plans → Invite a business). When a
//            company that signed up with it makes its FIRST payment, the
//            company that invited it gets REFERRAL_REWARD_DAYS added to its
//            plan. On the Free plan the days are banked and added the next
//            time it pays, so a reward is never wasted.
//
//   P-codes  partners: CA firms, ISO/IATF consultants, advisors. Every payment
//            from a company a partner brought in earns them PARTNER_DEFAULT_PCT
//            of the amount before GST, for as long as it keeps paying. You pay
//            partners yourself (bank or UPI) and note it in PartnerEarnings.
//
// Everything lives in the Master spreadsheet, in plain tabs you can read:
//   RefCodes         code → whose it is
//   Referrals        who signed up with which code, and what it earned
//   Partners         you add a partner here (Name, Email, …) and run
//                    activatePartners(); they are emailed their links
//   PartnerEarnings  one row per payment that earned commission; write the
//                    date or UPI reference in "Paid out" when you pay
//
// Both numbers can be changed in Script Properties without touching code:
// REFERRAL_REWARD_DAYS and PARTNER_COMMISSION_PCT.
//
// Nothing here can buy a plan or move money: a reward is granted only from
// inside the payment grant, after the payment has been verified with Razorpay
// against an order this server made.

var REF_TABS = {
  CODES: ['RefCodes', ['Code', 'Kind', 'Target', 'Created']],
  REFERRALS: ['Referrals', ['When', 'Code', 'Kind', 'Referrer', 'New SheetID', 'New company', 'Status', 'Reward days', 'Rewarded', 'Reward value (Rs)']],
  PARTNERS: ['Partners', ['Name', 'Email', 'Phone', 'Firm', 'Commission %', 'Status', 'Code', 'Key hash', 'Created', 'Payout details']],
  EARNINGS: ['PartnerEarnings', ['When', 'Partner code', 'Company', 'SheetID', 'Payment id', 'Paid (Rs, incl. GST)', 'Net (Rs)', 'Commission %', 'Commission (Rs)', 'Paid out']],
};
var REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I/L

function refRewardDays_() {
  var v = Number(PropertiesService.getScriptProperties().getProperty('REFERRAL_REWARD_DAYS'));
  return v > 0 && v <= 365 ? Math.round(v) : 30;
}
function partnerDefaultPct_() {
  var v = Number(PropertiesService.getScriptProperties().getProperty('PARTNER_COMMISSION_PCT'));
  return v > 0 && v <= 50 ? v : 20;
}
function refTab_(def) { return mkTab_(SpreadsheetApp.openById(CFG().masterId), def[0], def[1]); }
function refNewCode_(prefix, taken) {
  for (var tries = 0; tries < 50; tries++) {
    var c = prefix;
    for (var i = 0; i < 5; i++) c += REF_ALPHABET.charAt(Math.floor(Math.random() * REF_ALPHABET.length));
    if (!taken[c]) return c;
  }
  throw new Error('Could not make a new code. Try again.');
}
function refCleanCode_(code) { return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); }

/* ---- a company's own code and what it has earned (Plans → Invite) ------- */

function getReferrals_(ctx) {
  requireAdmin_(ctx);
  var code = companyRefCode_(ctx.sheetId);
  var rows = refTab_(REF_TABS.REFERRALS).getDataRange().getValues().slice(1)
    .filter(function (r) { return String(r[3]) === String(ctx.sheetId); });
  var list = rows.map(function (r) {
    return { when: r[0] instanceof Date ? ymd(r[0]) : String(r[0]).slice(0, 10), company: String(r[5]),
             status: String(r[6]), days: Number(r[7]) || 0 };
  });
  return { status: 'success', code: code, link: CFG().siteUrl + '/?ref=' + code,
    rewardDays: refRewardDays_(), referrals: list,
    earnedDays: list.filter(function (x) { return x.status === 'rewarded'; }).reduce(function (s, x) { return s + x.days; }, 0),
    bankedDays: list.filter(function (x) { return x.status === 'banked'; }).reduce(function (s, x) { return s + x.days; }, 0) };
}

function companyRefCode_(sheetId) {
  var sh = refTab_(REF_TABS.CODES), d = sh.getDataRange().getValues(), taken = {};
  for (var i = 1; i < d.length; i++) {
    taken[d[i][0]] = true;
    if (d[i][1] === 'company' && String(d[i][2]) === String(sheetId)) return String(d[i][0]);
  }
  var code = refNewCode_('C', taken);
  sh.appendRow([code, 'company', String(sheetId), new Date()]);
  return code;
}

/* ---- at sign-up: remember who brought them ------------------------------ */

/** Called from registration, inside its lock. Never throws: a bad code simply records nothing. */
function recordReferral_(rawCode, newSheetId, newCompany) {
  try {
    var code = refCleanCode_(rawCode);
    if (!code) return null;
    var kind = '', referrer = '';
    if (code.charAt(0) === 'P') {
      var p = partnerByCode_(code);
      if (!p || p.status !== 'Active') return null;
      kind = 'partner'; referrer = code;
    } else {
      var d = refTab_(REF_TABS.CODES).getDataRange().getValues();
      for (var i = 1; i < d.length; i++) if (String(d[i][0]) === code && d[i][1] === 'company') { kind = 'company'; referrer = String(d[i][2]); }
      if (!kind || referrer === String(newSheetId)) return null;
    }
    refTab_(REF_TABS.REFERRALS).appendRow([new Date(), code, kind, referrer, String(newSheetId), String(newCompany || ''), 'signed up', '', '', '']);
    return kind;
  } catch (e) { logError_('recordReferral', e.message); return null; }
}

/* ---- at payment: reward the referrer, pay the partner ------------------- */

/* A reward is worth up to REFERRAL_REWARD_DAYS, but never more than what the
   invited company paid, counted in days of the inviter's own plan. Without the
   cap a company on Scale could open Rs 999 workspaces of its own and turn each
   into a month of Scale. */
function refDaysWorth_(valueRs, planName) {
  var lim = planLimits(normalizePlan(planName || 'Team'));
  var daily = lim && lim.price ? lim.price / (lim.termDays || 30) : 0;
  var max = refRewardDays_();
  if (!daily) return max;
  return Math.max(1, Math.min(max, Math.floor(Number(valueRs || 0) / daily)));
}

/** Days a company has banked from referring others while on Free, worked out
 *  against the plan it is now buying; marked used as they are taken. */
function takeBankedReferralDays_(sheetId, planName) {
  try {
    var sh = refTab_(REF_TABS.REFERRALS), d = sh.getDataRange().getValues(), days = 0;
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][3]) === String(sheetId) && d[i][6] === 'banked') {
        var worth = refDaysWorth_(Number(d[i][9]) || 0, planName);
        days += worth;
        sh.getRange(i + 1, 7).setValue('rewarded'); sh.getRange(i + 1, 8).setValue(worth);
        sh.getRange(i + 1, 9).setValue(new Date());
      }
    }
    return days;
  } catch (e) { logError_('referralBank', e.message); return 0; }
}

/** Called from inside the payment grant, after a verified payment was granted. */
function referralOnPayment_(sheetId, paid) {
  try {
    var sh = refTab_(REF_TABS.REFERRALS), d = sh.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][4]) !== String(sheetId)) continue;
      if (d[i][2] === 'company' && d[i][6] === 'signed up') {
        var referrer = String(d[i][3]), value = refNetRs_(paid);
        var reg = registryRow_(referrer) || {};
        var days = refDaysWorth_(value, reg.plan);
        var added = refAddDays_(referrer, days);
        sh.getRange(i + 1, 7).setValue(added ? 'rewarded' : 'banked');
        sh.getRange(i + 1, 8).setValue(days);
        sh.getRange(i + 1, 10).setValue(value);
        if (added) sh.getRange(i + 1, 9).setValue(new Date());
        refTellReferrer_(referrer, String(d[i][5]), days, added);
      }
      if (d[i][2] === 'partner') {
        if (d[i][6] === 'signed up') sh.getRange(i + 1, 7).setValue('paying');
        partnerEarn_(String(d[i][3]), sheetId, String(d[i][5]), paid);
      }
      return;
    }
  } catch (e) { logError_('referralOnPayment', e.message); }
}

/** Adds days to a paying (or trialling) company's plan; false when it is on Free and the days must be banked. */
function refAddDays_(sheetId, days) {
  var dir = SpreadsheetApp.openById(CFG().masterId).getSheetByName(TAB.DIRECTORY);
  var d = dir.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][5]).trim() !== String(sheetId)) continue;
    var cur = new Date(d[i][4]);
    if (normalizePlan(d[i][3]) === 'Free' || isNaN(cur) || cur < new Date()) return false;
    cur.setDate(cur.getDate() + days);
    dir.getRange(i + 1, 5).setValue(ymd(cur));
    return true;
  }
  return false;
}

function refTellReferrer_(sheetId, newCompany, days, added) {
  var row = registryRow_(sheetId);
  if (!row) return;
  var to = '';
  var d = SpreadsheetApp.openById(CFG().masterId).getSheetByName(TAB.DIRECTORY).getDataRange().getValues();
  for (var i = 1; i < d.length; i++) if (String(d[i][5]).trim() === String(sheetId)) to = String(d[i][1]);
  if (!to) return;
  sendEmail_(to, 'You earned ' + days + ' free days on Domebox',
    mailShell_('Thank you for the introduction',
      '<p><b>' + esc_(newCompany || 'A company you invited') + '</b> has just become a paying Domebox customer.</p>' +
      (added ? '<p>We have added <b>' + days + ' days</b> to your plan, free.</p>'
             : '<p>We have saved free days for you. They are added the next time you choose a plan.</p>') +
      '<p>Your invite link is under Plans → Invite a business, whenever you want to share it again.</p>' +
      btn_('Open Domebox', CFG().siteUrl + '/?login=1')));
}

/** What a payment was worth before GST, in rupees. */
function refNetRs_(paid) {
  var gross = Number(paid && paid.amount || 0) / 100, rate = gstRate_() || 0;
  return Math.round(gross / (1 + rate / 100) * 100) / 100;
}

function partnerEarn_(code, sheetId, company, paid) {
  var p = partnerByCode_(code);
  if (!p || p.status !== 'Active' || !paid || !paid.id) return;   // paused: no new commission
  var sh = refTab_(REF_TABS.EARNINGS), d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) if (String(d[i][4]) === String(paid.id)) return;   // one payment, one commission
  var gross = Number(paid.amount) / 100;
  var net = refNetRs_(paid);
  var pct = p.pct || partnerDefaultPct_();
  sh.appendRow([new Date(), code, company, String(sheetId), String(paid.id), gross, net, pct, Math.round(net * pct) / 100, '']);
}

/* ---- partners ----------------------------------------------------------- */

function partnerRows_() {
  var sh = refTab_(REF_TABS.PARTNERS), d = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < d.length; i++) {
    out.push({ row: i + 1, name: String(d[i][0] || '').trim(), email: String(d[i][1] || '').trim().toLowerCase(),
      phone: String(d[i][2] || ''), firm: String(d[i][3] || ''), pct: Number(d[i][4]) || 0,
      status: String(d[i][5] || '').trim(), code: String(d[i][6] || '').trim(), keyHash: String(d[i][7] || '') });
  }
  return out;
}
function partnerByCode_(code) {
  var list = partnerRows_();
  for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i];
  return null;
}
function partnerKeyHash_(key) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(key) + ':' + tokenSecret_()));
}

/**
 * For the editor. Type a partner into the Partners tab of the Master sheet
 * (Name, Email, and optionally Phone, Firm, Commission %), leave Status blank,
 * then run this. Each new partner gets a code and a private dashboard link by
 * email, and Status becomes Active. Set Status to "Resend" to send a fresh
 * link (the old one stops working); "Paused" stops new sign-ups and commission.
 */
function activatePartners() {
  var out = ['', '=== PARTNERS ==='];
  var sh = refTab_(REF_TABS.PARTNERS), list = partnerRows_(), taken = {};
  refTab_(REF_TABS.CODES).getDataRange().getValues().forEach(function (r) { taken[r[0]] = true; });
  list.forEach(function (p) { if (p.code) taken[p.code] = true; });
  list.forEach(function (p) {
    var st = p.status.toLowerCase();
    if (st && st !== 'new' && st !== 'resend') { out.push('  ' + (p.code || '-') + '  ' + p.name + '  ' + p.status); return; }
    if (!p.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) { out.push('  row ' + p.row + ': needs a Name and a valid Email'); return; }
    var code = p.code || refNewCode_('P', taken);
    taken[code] = true;
    var key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    var pct = p.pct || partnerDefaultPct_();
    sh.getRange(p.row, 5).setValue(pct);
    sh.getRange(p.row, 6).setValue('Active');
    sh.getRange(p.row, 7).setValue(code);
    sh.getRange(p.row, 8).setValue(partnerKeyHash_(key));
    if (!p.code) sh.getRange(p.row, 9).setValue(new Date());
    var site = CFG().siteUrl;
    sendEmail_(p.email, 'Your Domebox partner links',
      mailShell_('Welcome to the Domebox partner programme',
        '<p>Hi ' + esc_(p.name.split(' ')[0]) + ',</p>' +
        '<p>Every company that signs up through your link and pays earns you <b>' + pct + '%</b> of what it pays ' +
        '(before GST), every time it pays, for as long as it stays a customer.</p>' +
        infoTable_([['Your link to share', site + '/?ref=' + code], ['Your code', code]]) +
        '<p>Your private dashboard shows every company you have brought in, what you have earned, and what has been paid. ' +
        'Keep this link to yourself — it opens without a password.</p>' +
        btn_('Open my partner dashboard', site + '/?partner=' + key)));
    out.push('  ' + code + '  ' + p.name + '  ' + (st === 'resend' ? 'new link sent' : 'activated, links sent') + ' to ' + maskEmail_(p.email));
  });
  return say_(out);
}

/** For the editor: what each partner has earned and is owed. */
function partnerPayoutReport() {
  var out = ['', '=== PARTNER COMMISSION ==='];
  var earn = refTab_(REF_TABS.EARNINGS).getDataRange().getValues().slice(1);
  partnerRows_().forEach(function (p) {
    if (!p.code) return;
    var mine = earn.filter(function (r) { return String(r[1]) === p.code; });
    var total = mine.reduce(function (s, r) { return s + (Number(r[8]) || 0); }, 0);
    var due = mine.filter(function (r) { return !String(r[9] || '').trim(); }).reduce(function (s, r) { return s + (Number(r[8]) || 0); }, 0);
    out.push('  ' + p.code + '  ' + p.name + '  earned Rs ' + total.toFixed(2) + '   due now Rs ' + due.toFixed(2));
  });
  out.push('', 'When you pay a partner, write the date or UPI reference in "Paid out" on each of their PartnerEarnings rows.');
  return say_(out);
}

/** The partner's private dashboard, by the key in their link. Public action; read-only. */
function getPartnerDashboard_(key) {
  var k = String(key || '').trim();
  if (!/^[a-f0-9]{40}$/.test(k)) throw new Error('That partner link is not valid.');
  var h = partnerKeyHash_(k), p = null;
  partnerRows_().forEach(function (x) { if (x.keyHash && eqConst_(x.keyHash, h)) p = x; });
  if (!p) throw new Error('That partner link is not valid, or a newer one has been sent.');
  var refs = refTab_(REF_TABS.REFERRALS).getDataRange().getValues().slice(1).filter(function (r) { return String(r[3]) === p.code; });
  var earn = refTab_(REF_TABS.EARNINGS).getDataRange().getValues().slice(1).filter(function (r) { return String(r[1]) === p.code; });
  var plans = {};
  SpreadsheetApp.openById(CFG().masterId).getSheetByName(TAB.DIRECTORY).getDataRange().getValues().slice(1)
    .forEach(function (x) { plans[String(x[5]).trim()] = x[3]; });
  var companies = refs.map(function (r) {
    var reg = { plan: plans[String(r[4]).trim()] };
    var paidRs = earn.filter(function (e) { return String(e[3]) === String(r[4]); }).reduce(function (s, e) { return s + (Number(e[8]) || 0); }, 0);
    return { company: String(r[5]), since: r[0] instanceof Date ? ymd(r[0]) : String(r[0]).slice(0, 10),
             plan: normalizePlan(reg.plan || 'Free'), paying: r[6] === 'paying', commission: Math.round(paidRs * 100) / 100 };
  });
  var sum = function (rows) { return Math.round(rows.reduce(function (s, e) { return s + (Number(e[8]) || 0); }, 0) * 100) / 100; };
  return { status: 'success', partner: { name: p.name, firm: p.firm, code: p.code, pct: p.pct || partnerDefaultPct_(), active: p.status === 'Active' },
    link: CFG().siteUrl + '/?ref=' + p.code, companies: companies,
    earned: sum(earn), paidOut: sum(earn.filter(function (e) { return String(e[9] || '').trim(); })),
    due: sum(earn.filter(function (e) { return !String(e[9] || '').trim(); })),
    payments: earn.map(function (e) { return { when: e[0] instanceof Date ? ymd(e[0]) : String(e[0]).slice(0, 10),
      company: String(e[2]), net: Number(e[6]) || 0, commission: Number(e[8]) || 0, paidOut: String(e[9] || '') }; }).reverse().slice(0, 100) };
}
