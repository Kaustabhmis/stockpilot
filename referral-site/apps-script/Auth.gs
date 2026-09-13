/**
 * Auth.gs — referrer signup / login / session handling, and the admin check.
 */

var SESSION_DAYS = 30;

function actionSignup_(p) {
  var name  = String(p.name || '').trim();
  var phone = normPhone_(p.phone);
  var email = String(p.email || '').trim().toLowerCase();
  var city  = String(p.city || '').trim();
  var pass  = String(p.password || '');

  if (name.length < 3)        return err_('Please enter your full name', 'bad_name');
  if (!isValidPhone_(phone))  return err_('Enter a valid 10-digit mobile number', 'bad_phone');
  if (!isValidEmail_(email))  return err_('Enter a valid email address', 'bad_email');
  if (pass.length < 8)        return err_('Password must be at least 8 characters', 'bad_password');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (findBy_(SHEETS.REFERRERS, 'Phone', phone)) {
      return err_('This mobile number is already registered. Please log in.', 'phone_taken');
    }
    if (email && findBy_(SHEETS.REFERRERS, 'Email', email)) {
      return err_('This email is already registered. Please log in.', 'email_taken');
    }

    var salt = uuid_();
    var referrer = {
      ID: uuid_(), Name: name, Phone: phone, Email: email, City: city,
      PassHash: hashPassword_(pass, salt), Salt: salt,
      ReferralCode: makeReferralCode_(),
      Status: 'active', KYCStatus: 'pending',
      PAN: '', BankName: '', AccountNumber: '', IFSC: '', UPI: '',
      CreatedAt: nowIso_(), LastLogin: nowIso_()
    };
    append_(SHEETS.REFERRERS, referrer);
    audit_(referrer.ID, 'signup', 'Referrer', referrer.ID, { phone: phone });

    var token = issueSession_(referrer.ID);
    return ok_({ token: token, referrer: publicReferrer_(referrer) });
  } finally {
    lock.releaseLock();
  }
}

function actionLogin_(p) {
  var phone = normPhone_(p.phone);
  var pass  = String(p.password || '');
  if (!phone || !pass) return err_('Mobile number and password are required', 'missing');

  var r = findBy_(SHEETS.REFERRERS, 'Phone', phone);
  // Same message either way, so the form can't be used to discover who is registered.
  if (!r || !safeEqual_(hashPassword_(pass, r.Salt), r.PassHash)) {
    audit_('anon', 'login_failed', 'Referrer', phone, {});
    return err_('Mobile number or password is incorrect', 'bad_credentials');
  }
  if (String(r.Status).toLowerCase() === 'blocked') {
    return err_('This account is on hold. Please contact us.', 'blocked');
  }

  update_(SHEETS.REFERRERS, r._row, { LastLogin: nowIso_() });
  var token = issueSession_(r.ID);
  audit_(r.ID, 'login', 'Referrer', r.ID, {});
  return ok_({ token: token, referrer: publicReferrer_(r) });
}

function actionLogout_(p, session) {
  var rows = readAll_(SHEETS.SESSIONS);
  var h = hashToken_(String(p.token || ''));
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].TokenHash === h) {
      sheet_(SHEETS.SESSIONS).deleteRow(rows[i]._row);
      break;
    }
  }
  return ok_({});
}

function issueSession_(referrerId) {
  var token = uuid_() + '.' + uuid_();
  append_(SHEETS.SESSIONS, {
    TokenHash: hashToken_(token),
    ReferrerID: referrerId,
    CreatedAt: nowIso_(),
    Expires: daysFromNow_(SESSION_DAYS)
  });
  return token;
}

/** Returns the referrer row for a token, or null. Expired rows are cleaned up. */
function resolveSession_(token) {
  if (!token) return null;
  var h = hashToken_(String(token));
  var s = findBy_(SHEETS.SESSIONS, 'TokenHash', h);
  if (!s) return null;
  if (new Date(s.Expires) < new Date()) {
    sheet_(SHEETS.SESSIONS).deleteRow(s._row);
    return null;
  }
  var r = findBy_(SHEETS.REFERRERS, 'ID', s.ReferrerID);
  if (!r || String(r.Status).toLowerCase() === 'blocked') return null;
  return r;
}

/**
 * Admin = the Google account running the script, or an email listed in
 * Config.admin_emails. Admin calls must come from a logged-in Google session,
 * so the public web app can never self-promote by passing a flag.
 */
function isAdmin_() {
  var email = '';
  try { email = (Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) { return false; }
  if (!email) return false;
  if (email === (Session.getEffectiveUser().getEmail() || '').toLowerCase()) return true;
  var list = String(getConfig().admin_emails || '').toLowerCase().split(/[,\s]+/);
  return list.indexOf(email) >= 0;
}

function publicReferrer_(r) {
  return {
    id: r.ID, name: r.Name, phone: r.Phone, email: r.Email, city: r.City,
    referralCode: r.ReferralCode, status: r.Status, kycStatus: r.KYCStatus,
    hasBankDetails: !!(r.AccountNumber || r.UPI), createdAt: r.CreatedAt
  };
}

/** Referrer updates their own payout details. */
function actionUpdateProfile_(p, me) {
  var patch = {};
  if (p.name  !== undefined) patch.Name  = String(p.name).trim();
  if (p.city  !== undefined) patch.City  = String(p.city).trim();
  if (p.email !== undefined) {
    if (!isValidEmail_(p.email)) return err_('Enter a valid email address', 'bad_email');
    patch.Email = String(p.email).trim().toLowerCase();
  }
  if (p.pan   !== undefined) patch.PAN   = String(p.pan).trim().toUpperCase();
  if (p.bankName !== undefined) patch.BankName = String(p.bankName).trim();
  if (p.accountNumber !== undefined) patch.AccountNumber = String(p.accountNumber).trim();
  if (p.ifsc !== undefined) patch.IFSC = String(p.ifsc).trim().toUpperCase();
  if (p.upi  !== undefined) patch.UPI  = String(p.upi).trim();

  // Any change to payout details sends KYC back for re-verification.
  var touchesPayout = ['PAN','BankName','AccountNumber','IFSC','UPI'].some(function (k) {
    return patch[k] !== undefined && String(patch[k]) !== String(me[k]);
  });
  if (touchesPayout) patch.KYCStatus = 'pending';

  update_(SHEETS.REFERRERS, me._row, patch);
  audit_(me.ID, 'update_profile', 'Referrer', me.ID, Object.keys(patch));
  var fresh = findBy_(SHEETS.REFERRERS, 'ID', me.ID);
  return ok_({ referrer: publicReferrer_(fresh) });
}

function actionChangePassword_(p, me) {
  var oldPass = String(p.oldPassword || '');
  var newPass = String(p.newPassword || '');
  if (newPass.length < 8) return err_('New password must be at least 8 characters', 'bad_password');
  if (!safeEqual_(hashPassword_(oldPass, me.Salt), me.PassHash)) {
    return err_('Current password is incorrect', 'bad_credentials');
  }
  var salt = uuid_();
  update_(SHEETS.REFERRERS, me._row, { Salt: salt, PassHash: hashPassword_(newPass, salt) });
  // Drop every other session so a stolen token dies with the old password.
  readAll_(SHEETS.SESSIONS)
    .filter(function (s) { return s.ReferrerID === me.ID; })
    .sort(function (a, b) { return b._row - a._row; })
    .forEach(function (s) { sheet_(SHEETS.SESSIONS).deleteRow(s._row); });
  audit_(me.ID, 'change_password', 'Referrer', me.ID, {});
  return ok_({ reLogin: true });
}
