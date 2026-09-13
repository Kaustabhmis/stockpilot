/**
 * Referrals.gs — lead submission, attribution and the referrer's own views.
 */

/**
 * Submits a buyer lead. Works two ways:
 *  - logged in (token present) — attributed to that referrer
 *  - public form opened as ?ref=CODE — attributed to the code's owner
 *
 * Attribution rule: the FIRST referrer to submit a given buyer phone owns that
 * buyer for `attribution_lock_days`. A later submission is recorded but marked
 * `duplicate`, with DuplicateOf pointing at the original. It is recorded rather
 * than rejected so a dispute can be settled from the sheet.
 */
function actionSubmitLead_(p, me) {
  var code = String(p.referralCode || (me ? me.ReferralCode : '')).trim().toUpperCase();
  if (!code) return err_('Referral code missing', 'no_code');

  var owner = me || findBy_(SHEETS.REFERRERS, 'ReferralCode', code);
  if (!owner) return err_('This referral code is not valid', 'bad_code');
  if (String(owner.Status).toLowerCase() === 'blocked') {
    return err_('This referral code is not active', 'blocked');
  }

  var buyerName  = String(p.buyerName || '').trim();
  var buyerPhone = normPhone_(p.buyerPhone);
  var buyerEmail = String(p.buyerEmail || '').trim().toLowerCase();

  if (buyerName.length < 3)        return err_("Enter the buyer's full name", 'bad_name');
  if (!isValidPhone_(buyerPhone))  return err_('Enter a valid 10-digit buyer mobile number', 'bad_phone');
  if (!isValidEmail_(buyerEmail))  return err_('Enter a valid buyer email address', 'bad_email');
  if (buyerPhone === normPhone_(owner.Phone)) {
    return err_('You cannot refer your own number', 'self_referral');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var dup = findActiveReferralForBuyer_(buyerPhone);
    var isDuplicate = !!dup;

    var referral = {
      ID: shortId_('r'),
      ReferrerID: owner.ID,
      ReferralCode: owner.ReferralCode,
      BuyerName: buyerName,
      BuyerPhone: buyerPhone,
      BuyerEmail: buyerEmail,
      PropertyID: String(p.propertyId || '').trim(),
      PropertyTitle: String(p.propertyTitle || '').trim(),
      Budget: String(p.budget || '').trim(),
      BHK: String(p.bhk || '').trim(),
      Location: String(p.location || '').trim(),
      Notes: String(p.notes || '').trim().slice(0, 1000),
      Stage: isDuplicate ? 'duplicate' : 'new',
      StageUpdatedAt: nowIso_(),
      StageNote: isDuplicate ? 'Buyer already referred (within attribution window)' : '',
      DuplicateOf: isDuplicate ? dup.ID : '',
      Source: me ? 'dashboard' : 'public_link',
      CreatedAt: nowIso_()
    };
    append_(SHEETS.REFERRALS, referral);
    audit_(owner.ID, 'submit_lead', 'Referral', referral.ID,
           { duplicate: isDuplicate, buyer: buyerPhone });

    notifyAdminOfLead_(referral, owner);

    return ok_({
      referralId: referral.ID,
      duplicate: isDuplicate,
      message: isDuplicate
        ? 'This buyer was already referred, so this lead is marked duplicate. Our team will confirm.'
        : 'Lead submitted. Our team will contact the buyer shortly.'
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * An earlier referral for the same buyer still holds attribution if it is
 * inside the lock window and has not been rejected/expired.
 */
function findActiveReferralForBuyer_(buyerPhone) {
  var lockDays = cfgNum_('attribution_lock_days', 90);
  var cutoff = new Date(Date.now() - lockDays * 86400000);
  var dead = ['rejected', 'expired', 'duplicate'];
  var rows = readAll_(SHEETS.REFERRALS);
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (normPhone_(r.BuyerPhone) !== buyerPhone) continue;
    if (dead.indexOf(String(r.Stage).toLowerCase()) >= 0) continue;
    if (new Date(r.CreatedAt) < cutoff) continue;
    return r;
  }
  return null;
}

function notifyAdminOfLead_(referral, owner) {
  var to = String(getConfig().notify_email || '').trim();
  if (!to) return;
  try {
    MailApp.sendEmail({
      to: to,
      subject: 'New referral lead: ' + referral.BuyerName + (referral.Stage === 'duplicate' ? ' (duplicate)' : ''),
      body: [
        'Referrer : ' + owner.Name + ' (' + owner.ReferralCode + ', ' + owner.Phone + ')',
        'Buyer    : ' + referral.BuyerName + ' — ' + referral.BuyerPhone,
        'Property : ' + (referral.PropertyTitle || referral.PropertyID || '-'),
        'Budget   : ' + (referral.Budget || '-') + '   BHK: ' + (referral.BHK || '-'),
        'Location : ' + (referral.Location || '-'),
        'Notes    : ' + (referral.Notes || '-'),
        'Stage    : ' + referral.Stage,
        '',
        'Referral ID: ' + referral.ID
      ].join('\n')
    });
  } catch (e) {
    // Quota exhausted or mail disabled — the lead is already saved, so carry on.
  }
}

/** The referrer's own referral list, newest first, with any linked deal. */
function actionMyReferrals_(p, me) {
  var deals = readAll_(SHEETS.DEALS);
  var byReferral = {};
  deals.forEach(function (d) { byReferral[d.ReferralID] = d; });

  var rows = readAll_(SHEETS.REFERRALS)
    .filter(function (r) { return r.ReferrerID === me.ID; })
    .map(function (r) {
      var d = byReferral[r.ID];
      return {
        id: r.ID,
        buyerName: r.BuyerName,
        buyerPhone: maskPhone_(r.BuyerPhone),
        propertyTitle: r.PropertyTitle || r.PropertyID || '',
        location: r.Location,
        budget: r.Budget,
        stage: String(r.Stage).toLowerCase(),
        stageNote: r.StageNote || '',
        stageUpdatedAt: fmtDate_(r.StageUpdatedAt),
        createdAt: fmtDate_(r.CreatedAt),
        dealValue: d ? Number(d.DealValue) : null,
        commission: d ? Number(d.NetPayable) : null,
        dealStage: d ? String(d.Stage).toLowerCase() : null
      };
    })
    .sort(function (a, b) { return (a.createdAt < b.createdAt) ? 1 : -1; });

  return ok_({ referrals: rows });
}

/** Buyer numbers are masked in the dashboard — the referrer already has them. */
function maskPhone_(phone) {
  var d = normPhone_(phone);
  return d.length === 10 ? d.slice(0, 3) + 'xxxx' + d.slice(-3) : d;
}

function fmtDate_(v) {
  if (!v) return '';
  var d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}
