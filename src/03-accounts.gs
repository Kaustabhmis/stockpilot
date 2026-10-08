// ===========================================================================
// ACCOUNTS — signup, login, password reset
// ===========================================================================

/* Serialised: this reads, decides, then writes. Without the lock two
   simultaneous calls both pass the check — two companies registering on one email, which login cannot then tell apart. */
function registerCompany_(form) {
  return withLock_(function () { return registerCompany_locked_(form); });
}
function registerCompany_locked_(form) {
  form = form || {};
  var c = CFG();
  if (!c.masterId || !c.templateId) throw new Error('The service is not configured yet.');

  var email = String(form.email || '').trim().toLowerCase();
  var company = String(form.companyName || '').trim();
  if (!email || !company || !form.password) throw new Error('Company, email and password are required.');
  if (String(form.password).length < 8) throw new Error('Password must be at least 8 characters.');

  var master = SpreadsheetApp.openById(c.masterId);
  var global = mkTab_(master, TAB.GLOBAL, ['Email','Password','SheetID','Username']);

  var gd = global.getDataRange().getValues();
  for (var i = 1; i < gd.length; i++) {
    if (String(gd[i][0]).trim().toLowerCase() === email) {
      throw new Error('That email is already registered. Try signing in, or use Forgot Password.');
    }
  }

  var newId;
  try {
    var file = DriveApp.getFileById(c.templateId).makeCopy(company + ' — Dome Box Data');
    /* Deliberately NOT shared. The old build set every tenant file to
       ANYONE_WITH_LINK/EDIT, which made each customer's staff records readable
       and writable by anyone holding the URL. The app reaches the file through
       Apps Script, which runs as the owner, so sharing is never needed. */
    newId = file.getId();
  } catch (e) {
    logError_('registerCompany:copy', e.message);
    throw new Error('We could not create your workspace. Please contact support.');
  }

  var ss = SpreadsheetApp.openById(newId);
  ensureTenantTabs_(ss);

  var hash = makePasswordHash(String(form.password));
  var username = String(form.username || email.split('@')[0]).trim();
  var row = blankUserRow_();
  row[U['Name']] = String(form.name || company).trim();
  row[U['Username']] = username;
  row[U['Password']] = hash;
  row[U['Email']] = email;
  row[U['Role']] = 'Admin';
  row[U['Job Profile']] = 'Director';
  row[U['Dept']] = 'Management';
  row[U['Phone']] = String(form.phone || '');
  row[U['Manager']] = '';
  row[U['Active']] = true;
  ss.getSheetByName(TAB.USERS).appendRow(row);

  var expiry = new Date(); expiry.setDate(expiry.getDate() + 30);
  mkTab_(master, TAB.DIRECTORY, ['Company','Email','Password','Plan','Valid Until','SheetID','Status','Created'])
    .appendRow([company, email, '', 'Free', ymd(expiry), newId, 'Active', new Date()]);
  global.appendRow([email, hash, newId, username]);

  try { sendWelcome_(email, form.name || company, company); } catch (e) {}

  return {
    status: 'success',
    token: issueToken(newId, username, 'Admin'),
    user: { name: row[U['Name']], username: username, role: 'Admin', email: email },
    company: company, plan: 'Free',
  };
}

function login_(emailOrUsername, password) {
  var key = String(emailOrUsername || '').trim().toLowerCase();
  if (!key || !password) throw new Error('Enter your email and password.');

  var gate = loginAllowed_(key);
  if (!gate.ok) throw new Error('Too many failed attempts. Wait 15 minutes and try again.');

  var c = CFG();
  var master = SpreadsheetApp.openById(c.masterId);
  var global = master.getSheetByName(TAB.GLOBAL);
  var sheetId = null, storedAt = null, storedVal = null;

  if (global) {
    var gd = global.getDataRange().getValues();
    for (var i = 1; i < gd.length; i++) {
      var rowEmail = String(gd[i][0]).trim().toLowerCase();
      var rowUser  = String(gd[i][3] || '').trim().toLowerCase();
      if (rowEmail === key || (rowUser && rowUser === key)) {
        var v = verifyPassword_(password, gd[i][1]);
        if (v.ok) { sheetId = String(gd[i][2]).trim(); storedAt = { sheet: global, row: i + 1, col: 2 };
                    storedVal = gd[i][1]; }
        break;
      }
    }
  }

  // Older accounts exist only in the Directory.
  if (!sheetId) {
    var dir = master.getSheetByName(TAB.DIRECTORY);
    if (dir) {
      var dd = dir.getDataRange().getValues();
      for (var j = 1; j < dd.length; j++) {
        if (String(dd[j][1]).trim().toLowerCase() === key) {
          var dv = verifyPassword_(password, dd[j][2]);
          if (dv.ok) { sheetId = String(dd[j][5]).trim(); storedAt = { sheet: dir, row: j + 1, col: 3 };
                       storedVal = dd[j][2]; }
          break;
        }
      }
    }
  }

  if (!sheetId) { recordFailedLogin_(gate); throw new Error('Invalid email or password.'); }
  clearLoginFailures_(gate);

  var ss;
  try { ss = SpreadsheetApp.openById(sheetId); }
  catch (e) { throw new Error('Your workspace could not be opened. Contact support.'); }
  // Sign-in is the first thing an existing customer does on the new build.
  ensureTenantSchema_(ss, sheetId);

  var me = findUserByEmailOrName_(ss, key);
  if (!me) throw new Error('Your account is not in this workspace. Contact your administrator.');
  if (me.active === false) throw new Error('This account has been deactivated.');

  /* Transparent upgrade: a plaintext password that just verified is rewritten as
     a hash immediately, so nobody is locked out and nobody is asked to reset. */
  if (!isHashed_(storedVal)) {
    try {
      var fresh = makePasswordHash(password);
      storedAt.sheet.getRange(storedAt.row, storedAt.col).setValue(fresh);
      setUserField_(ss, me.rowIndex, 'Password', fresh);
    } catch (e) { logError_('login:upgrade', e.message); }
  }

  var reg = registryRow_(sheetId);
  return {
    status: 'success',
    token: issueToken(sheetId, me.username, me.role),
    user: { name: me.name, username: me.username, role: me.role, email: me.email,
            phone: me.phone, manager: me.manager, jobProfile: me.jobProfile, dept: me.dept },
    company: reg ? reg.company : '', plan: normalizePlan(reg ? reg.plan : 'Free'),
  };
}

function changePassword_(ctx, current, next) {
  if (!next || String(next).length < 8) throw new Error('New password must be at least 8 characters.');
  var stored = getUserField_(ctx.ss, ctx.me.rowIndex, 'Password');
  if (!verifyPassword_(current, stored).ok) throw new Error('Your current password is not correct.');

  var hash = makePasswordHash(next);
  setUserField_(ctx.ss, ctx.me.rowIndex, 'Password', hash);
  syncGlobalPassword_(ctx.me.email, ctx.sheetId, hash);
  return { status: 'success', message: 'Password changed.' };
}

/**
 * Always reports success. Saying "email not found" lets anyone enumerate your
 * customer list one address at a time, and the old build did exactly that.
 */
function forgotPassword_(email) {
  var key = String(email || '').trim().toLowerCase();
  var generic = { status: 'success',
    message: 'If that email has an account, a reset link is on its way.' };
  if (!key) return generic;

  try {
    var master = SpreadsheetApp.openById(CFG().masterId);
    var global = master.getSheetByName(TAB.GLOBAL);
    if (!global) return generic;
    var gd = global.getDataRange().getValues();
    var found = false;
    for (var i = 1; i < gd.length; i++) {
      if (String(gd[i][0]).trim().toLowerCase() === key) { found = true; break; }
    }
    if (!found) return generic;

    var tokens = mkTab_(master, TAB.TOKENS, ['Token','Email','Created','Used']);
    var token = Utilities.getUuid() + Utilities.getUuid();
    tokens.appendRow([token, key, new Date(), '']);

    var link = CFG().siteUrl + '/?reset_token=' + encodeURIComponent(token);
    sendEmail_(key, 'Dome Box — reset your password', resetEmailHtml_(link));
  } catch (e) { logError_('forgotPassword', e.message); }

  return generic;
}

var RESET_TOKEN_HOURS = 1;

function resetPassword_(token, newPassword) {
  if (!token || !newPassword) throw new Error('Reset link and new password are both required.');
  if (String(newPassword).length < 8) throw new Error('Password must be at least 8 characters.');

  var master = SpreadsheetApp.openById(CFG().masterId);
  var tokens = master.getSheetByName(TAB.TOKENS);
  if (!tokens) throw new Error('That reset link is not valid.');

  var td = tokens.getDataRange().getValues();
  var email = null, rowIndex = -1;
  for (var i = 1; i < td.length; i++) {
    if (String(td[i][0]) === String(token)) {
      /* The old build wrote a timestamp and never looked at it, so a link mailed
         a year ago still worked. Both checks matter. */
      if (td[i][3]) throw new Error('That reset link has already been used.');
      var age = (new Date() - new Date(td[i][2])) / 3600000;
      if (!isFinite(age) || age > RESET_TOKEN_HOURS) {
        throw new Error('That reset link has expired. Please request a new one.');
      }
      email = String(td[i][1]).trim().toLowerCase(); rowIndex = i + 1; break;
    }
  }
  if (!email) throw new Error('That reset link is not valid.');

  var hash = makePasswordHash(newPassword);
  var sheetId = null;

  var global = master.getSheetByName(TAB.GLOBAL);
  if (global) {
    var gd = global.getDataRange().getValues();
    for (var j = 1; j < gd.length; j++) {
      if (String(gd[j][0]).trim().toLowerCase() === email) {
        global.getRange(j + 1, 2).setValue(hash);
        sheetId = String(gd[j][2]).trim();
      }
    }
  }
  var dir = master.getSheetByName(TAB.DIRECTORY);
  if (dir) {
    var dd = dir.getDataRange().getValues();
    for (var k = 1; k < dd.length; k++) {
      if (String(dd[k][1]).trim().toLowerCase() === email) dir.getRange(k + 1, 3).setValue('');
    }
  }
  if (sheetId) {
    try {
      var ss = SpreadsheetApp.openById(sheetId);
      var u = findUserByEmailOrName_(ss, email);
      if (u) setUserField_(ss, u.rowIndex, 'Password', hash);
    } catch (e) { logError_('resetPassword:tenant', e.message); }
  }

  tokens.getRange(rowIndex, 4).setValue(new Date());   // single use
  return { status: 'success', message: 'Password updated. You can sign in now.' };
}

function registryRow_(sheetId) {
  try {
    var dir = SpreadsheetApp.openById(CFG().masterId).getSheetByName(TAB.DIRECTORY);
    if (!dir) return null;
    var d = dir.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][5]).trim() === String(sheetId).trim()) {
        return { company: d[i][0], email: d[i][1], plan: d[i][3],
                 validUntil: d[i][4], sheetId: d[i][5], row: i + 1 };
      }
    }
  } catch (e) { logError_('registryRow', e.message); }
  return null;
}

function syncGlobalPassword_(email, sheetId, hash) {
  try {
    var g = SpreadsheetApp.openById(CFG().masterId).getSheetByName(TAB.GLOBAL);
    if (!g) return;
    var d = g.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][0]).trim().toLowerCase() === String(email).trim().toLowerCase() &&
          String(d[i][2]).trim() === String(sheetId).trim()) {
        g.getRange(i + 1, 2).setValue(hash); return;
      }
    }
  } catch (e) { logError_('syncGlobalPassword', e.message); }
}
