/**
 * Deals.gs — commission maths, the referrer's earnings view, and admin actions.
 *
 * Money model
 * -----------
 *   brokerage       = deal value x brokerage_pct            (what Grihobazar earns, default 2%)
 *   referrer share  = brokerage x share_pct                 (15% or 20%, by deal value)
 *   TDS             = referrer share x tds_pct              (deducted at source)
 *   net payable     = referrer share - TDS
 *
 * The split is decided by deal value against `tier_threshold`, so it is
 * reproducible from the numbers alone — nobody has to take our word for it.
 */

function commissionFor_(dealValue) {
  var value        = Number(dealValue) || 0;
  var brokeragePct = cfgNum_('brokerage_pct', 2);
  var threshold    = cfgNum_('tier_threshold', 10000000);   // ₹1 Cr
  var lowPct       = cfgNum_('tier_low_pct', 15);
  var highPct      = cfgNum_('tier_high_pct', 20);
  var tdsPct       = cfgNum_('tds_pct', 2);

  var brokerage = value * brokeragePct / 100;
  var sharePct  = value >= threshold ? highPct : lowPct;
  var gross     = brokerage * sharePct / 100;
  var tds       = gross * tdsPct / 100;

  return {
    dealValue: value,
    brokeragePct: brokeragePct,
    brokerageAmount: round2_(brokerage),
    sharePct: sharePct,
    grossCommission: round2_(gross),
    tdsPct: tdsPct,
    tdsAmount: round2_(tds),
    netPayable: round2_(gross - tds),
    threshold: threshold
  };
}

function round2_(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Public — powers the landing-page calculator. No auth, no side effects. */
function actionQuote_(p) {
  return ok_({ quote: commissionFor_(p.dealValue) });
}

/** Public — lets the site show the live rate card without hardcoding it. */
function actionRates_() {
  return ok_({
    brokeragePct: cfgNum_('brokerage_pct', 2),
    threshold: cfgNum_('tier_threshold', 10000000),
    lowPct: cfgNum_('tier_low_pct', 15),
    highPct: cfgNum_('tier_high_pct', 20),
    tdsPct: cfgNum_('tds_pct', 2),
    attributionLockDays: cfgNum_('attribution_lock_days', 90),
    payoutDays: cfgNum_('payout_days_after_registration', 15),
    brandName: String(getConfig().brand_name || 'Grihobazar Partners'),
    supportPhone: String(getConfig().support_phone || ''),
    supportEmail: String(getConfig().support_email || '')
  });
}

/** The referrer's earnings summary: pipeline, earned, paid, pending. */
function actionMyEarnings_(p, me) {
  var referralIds = {};
  var stageCount = {};
  readAll_(SHEETS.REFERRALS).forEach(function (r) {
    if (r.ReferrerID !== me.ID) return;
    referralIds[r.ID] = true;
    var s = String(r.Stage).toLowerCase();
    stageCount[s] = (stageCount[s] || 0) + 1;
  });

  var earned = 0, pending = 0, paidFromDeals = 0, closed = 0, inProgress = 0;
  readAll_(SHEETS.DEALS).forEach(function (d) {
    if (d.ReferrerID !== me.ID) return;
    var net = Number(d.NetPayable) || 0;
    var stage = String(d.Stage).toLowerCase();
    if (stage === 'cancelled') return;
    earned += net;
    if (stage === 'paid') paidFromDeals += net; else pending += net;
    if (stage === 'registered' || stage === 'payable' || stage === 'paid') closed++;
    else inProgress++;
  });

  var paid = 0;
  readAll_(SHEETS.PAYOUTS).forEach(function (po) {
    if (po.ReferrerID === me.ID && String(po.Status).toLowerCase() === 'paid') {
      paid += Number(po.Amount) || 0;
    }
  });

  return ok_({
    totals: {
      totalReferrals: Object.keys(referralIds).length,
      dealsClosed: closed,
      dealsInProgress: inProgress,
      earned: round2_(earned),
      paid: round2_(paid || paidFromDeals),
      pending: round2_(earned - (paid || paidFromDeals))
    },
    stageCount: stageCount,
    kycStatus: me.KYCStatus,
    hasPayoutDetails: !!(me.AccountNumber || me.UPI)
  });
}

function actionMyPayouts_(p, me) {
  var rows = readAll_(SHEETS.PAYOUTS)
    .filter(function (po) { return po.ReferrerID === me.ID; })
    .map(function (po) {
      return {
        id: po.ID, dealId: po.DealID, amount: Number(po.Amount) || 0,
        mode: po.Mode, reference: po.Reference, status: String(po.Status).toLowerCase(),
        paidAt: fmtDate_(po.PaidAt), notes: po.Notes
      };
    })
    .sort(function (a, b) { return (a.paidAt < b.paidAt) ? 1 : -1; });
  return ok_({ payouts: rows });
}

// ================================================================= admin

/** Admin — every referral with the referrer attached, for the pipeline board. */
function actionAdminReferrals_(p) {
  var referrers = {};
  readAll_(SHEETS.REFERRERS).forEach(function (r) { referrers[r.ID] = r; });
  var deals = {};
  readAll_(SHEETS.DEALS).forEach(function (d) { deals[d.ReferralID] = d; });

  var wanted = String(p.stage || '').toLowerCase();
  var rows = readAll_(SHEETS.REFERRALS)
    .filter(function (r) { return !wanted || String(r.Stage).toLowerCase() === wanted; })
    .map(function (r) {
      var owner = referrers[r.ReferrerID] || {};
      var d = deals[r.ID];
      return {
        id: r.ID,
        buyerName: r.BuyerName, buyerPhone: normPhone_(r.BuyerPhone), buyerEmail: r.BuyerEmail,
        propertyTitle: r.PropertyTitle || r.PropertyID || '',
        location: r.Location, budget: r.Budget, bhk: r.BHK, notes: r.Notes,
        stage: String(r.Stage).toLowerCase(), stageNote: r.StageNote || '',
        duplicateOf: r.DuplicateOf || '',
        createdAt: fmtDate_(r.CreatedAt),
        referrerName: owner.Name || '(unknown)',
        referrerPhone: owner.Phone || '',
        referralCode: r.ReferralCode,
        deal: d ? { id: d.ID, value: Number(d.DealValue), net: Number(d.NetPayable),
                    stage: String(d.Stage).toLowerCase() } : null
      };
    })
    .sort(function (a, b) { return (a.createdAt < b.createdAt) ? 1 : -1; });

  return ok_({ referrals: rows });
}

/** Admin — move a referral along the pipeline. */
function actionAdminUpdateStage_(p) {
  var stage = String(p.stage || '').toLowerCase();
  if (REFERRAL_STAGES.indexOf(stage) < 0) return err_('Unknown stage: ' + stage, 'bad_stage');

  var r = findBy_(SHEETS.REFERRALS, 'ID', String(p.referralId || ''));
  if (!r) return err_('Referral not found', 'not_found');

  update_(SHEETS.REFERRALS, r._row, {
    Stage: stage,
    StageUpdatedAt: nowIso_(),
    StageNote: String(p.note || '').slice(0, 500)
  });
  audit_(adminEmail_(), 'update_stage', 'Referral', r.ID, { from: r.Stage, to: stage });
  return ok_({ referralId: r.ID, stage: stage });
}

/**
 * Admin — record a booking. Creates the Deal row and freezes the commission
 * numbers at today's config, so a later rate change cannot alter a deal that
 * was already promised.
 */
function actionAdminCreateDeal_(p) {
  var r = findBy_(SHEETS.REFERRALS, 'ID', String(p.referralId || ''));
  if (!r) return err_('Referral not found', 'not_found');
  if (String(r.Stage).toLowerCase() === 'duplicate') {
    return err_('This referral is marked duplicate — resolve attribution first', 'duplicate');
  }
  var value = Number(p.dealValue);
  if (!value || value <= 0) return err_('Enter a valid deal value in rupees', 'bad_value');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var existing = findBy_(SHEETS.DEALS, 'ReferralID', r.ID);
    if (existing) return err_('A deal already exists for this referral', 'deal_exists');

    var q = commissionFor_(value);
    var deal = {
      ID: shortId_('d'),
      ReferralID: r.ID,
      ReferrerID: r.ReferrerID,
      DealValue: q.dealValue,
      BrokeragePct: q.brokeragePct,
      BrokerageAmount: q.brokerageAmount,
      SharePct: q.sharePct,
      GrossCommission: q.grossCommission,
      TdsPct: q.tdsPct,
      TdsAmount: q.tdsAmount,
      NetPayable: q.netPayable,
      Stage: 'booked',
      BookingDate: String(p.bookingDate || '').trim() || nowIso_(),
      RegistrationDate: '',
      CreatedAt: nowIso_(),
      UpdatedAt: nowIso_()
    };
    append_(SHEETS.DEALS, deal);
    update_(SHEETS.REFERRALS, r._row, { Stage: 'booked', StageUpdatedAt: nowIso_() });
    audit_(adminEmail_(), 'create_deal', 'Deal', deal.ID, { referral: r.ID, value: value });
    return ok_({ deal: deal });
  } finally {
    lock.releaseLock();
  }
}

/** Admin — advance a deal. `registered` is what makes the commission payable. */
function actionAdminUpdateDeal_(p) {
  var stage = String(p.stage || '').toLowerCase();
  if (DEAL_STAGES.indexOf(stage) < 0) return err_('Unknown deal stage: ' + stage, 'bad_stage');

  var d = findBy_(SHEETS.DEALS, 'ID', String(p.dealId || ''));
  if (!d) return err_('Deal not found', 'not_found');

  var patch = { Stage: stage, UpdatedAt: nowIso_() };
  if (stage === 'registered') {
    patch.RegistrationDate = String(p.registrationDate || '').trim() || nowIso_();
    patch.Stage = 'payable';   // registered -> immediately payable
  }
  update_(SHEETS.DEALS, d._row, patch);

  var r = findBy_(SHEETS.REFERRALS, 'ID', d.ReferralID);
  if (r && (stage === 'registered')) {
    update_(SHEETS.REFERRALS, r._row, { Stage: 'registered', StageUpdatedAt: nowIso_() });
  }
  audit_(adminEmail_(), 'update_deal', 'Deal', d.ID, { from: d.Stage, to: patch.Stage });
  return ok_({ dealId: d.ID, stage: patch.Stage });
}

/** Admin — record a payout against a deal and close it out. */
function actionAdminRecordPayout_(p) {
  var d = findBy_(SHEETS.DEALS, 'ID', String(p.dealId || ''));
  if (!d) return err_('Deal not found', 'not_found');
  if (String(d.Stage).toLowerCase() === 'paid') return err_('This deal is already paid', 'already_paid');
  if (String(d.Stage).toLowerCase() !== 'payable') {
    return err_('Deal is not payable yet — mark the registration first', 'not_payable');
  }

  var amount = Number(p.amount) || Number(d.NetPayable);
  var payout = {
    ID: shortId_('p'),
    ReferrerID: d.ReferrerID,
    DealID: d.ID,
    Amount: round2_(amount),
    Mode: String(p.mode || 'bank_transfer'),
    Reference: String(p.reference || '').trim(),
    Status: 'paid',
    PaidAt: String(p.paidAt || '').trim() || nowIso_(),
    Notes: String(p.notes || '').slice(0, 500),
    CreatedAt: nowIso_()
  };
  append_(SHEETS.PAYOUTS, payout);
  update_(SHEETS.DEALS, d._row, { Stage: 'paid', UpdatedAt: nowIso_() });
  audit_(adminEmail_(), 'record_payout', 'Payout', payout.ID, { deal: d.ID, amount: payout.Amount });
  return ok_({ payout: payout });
}

/** Admin — approve or reject a referrer's KYC, or block them. */
function actionAdminUpdateReferrer_(p) {
  var r = findBy_(SHEETS.REFERRERS, 'ID', String(p.referrerId || ''));
  if (!r) return err_('Referrer not found', 'not_found');
  var patch = {};
  if (p.kycStatus !== undefined) patch.KYCStatus = String(p.kycStatus).toLowerCase();
  if (p.status !== undefined)    patch.Status    = String(p.status).toLowerCase();
  update_(SHEETS.REFERRERS, r._row, patch);
  audit_(adminEmail_(), 'update_referrer', 'Referrer', r.ID, patch);
  return ok_({ referrerId: r.ID });
}

/** Admin — referrer list with lifetime totals, for the leaderboard/payouts view. */
function actionAdminReferrers_(p) {
  var totals = {};
  readAll_(SHEETS.DEALS).forEach(function (d) {
    var t = totals[d.ReferrerID] || (totals[d.ReferrerID] = { deals: 0, earned: 0, paid: 0 });
    if (String(d.Stage).toLowerCase() === 'cancelled') return;
    t.deals++;
    t.earned += Number(d.NetPayable) || 0;
    if (String(d.Stage).toLowerCase() === 'paid') t.paid += Number(d.NetPayable) || 0;
  });
  var leads = {};
  readAll_(SHEETS.REFERRALS).forEach(function (r) {
    leads[r.ReferrerID] = (leads[r.ReferrerID] || 0) + 1;
  });

  var rows = readAll_(SHEETS.REFERRERS).map(function (r) {
    var t = totals[r.ID] || { deals: 0, earned: 0, paid: 0 };
    return {
      id: r.ID, name: r.Name, phone: r.Phone, email: r.Email, city: r.City,
      referralCode: r.ReferralCode, status: String(r.Status).toLowerCase(),
      kycStatus: String(r.KYCStatus).toLowerCase(),
      pan: r.PAN, bankName: r.BankName, accountNumber: r.AccountNumber,
      ifsc: r.IFSC, upi: r.UPI,
      leads: leads[r.ID] || 0, deals: t.deals,
      earned: round2_(t.earned), paid: round2_(t.paid),
      pending: round2_(t.earned - t.paid),
      createdAt: fmtDate_(r.CreatedAt)
    };
  }).sort(function (a, b) { return b.earned - a.earned; });

  return ok_({ referrers: rows });
}

function adminEmail_() {
  try { return Session.getActiveUser().getEmail() || 'admin'; } catch (e) { return 'admin'; }
}
