

/**
 * DOME BOX — BACKEND API
 * =============================================================================
 * Built for www.domebox.in (BISCS India).
 *
 * Deploy: Extensions > Apps Script > paste as code.gs > Deploy > New deployment
 *         > Web app > Execute as Me > Access: Anyone. Give the /exec URL to the
 *         front end as API_URL.
 *
 * WHAT IS DIFFERENT FROM THE OLD BACKEND, AND WHY
 *
 * 1. The server never asks the browser who you are. Login returns a signed
 *    token; every protected call proves identity from that token. Previously
 *    `params.user.role` was whatever the caller typed, so anyone who knew a
 *    sheetId could act as Admin.
 * 2. Passwords are salted, iterated and peppered. Existing plaintext logins keep
 *    working and are upgraded silently on first sign-in.
 * 3. New tenant files are PRIVATE. The old code set every customer database to
 *    ANYONE_WITH_LINK / EDIT.
 * 4. Plans are enforced server-side, where the client cannot argue.
 * 5. Payments are granted only against a verified Razorpay signature.
 * 6. No secret appears in this file. All of them live in Script Properties.
 *
 * FIRST RUN
 *   setupDomeBox()   creates secrets, checks config, reports what is missing.
 * =============================================================================
 */

/** Everything configurable, read from Script Properties so nothing is hardcoded. */
function CFG() {
  var p = PropertiesService.getScriptProperties();
  return {
    masterId:   p.getProperty('MASTER_DB_ID') || '',
    templateId: p.getProperty('TEMPLATE_ID') || '',
    siteUrl:    p.getProperty('SITE_URL') || 'https://www.domebox.in',
    mailFrom:   p.getProperty('MAIL_FROM') || 'info@biscsindia.com',
    razorKey:   p.getProperty('RAZORPAY_KEY_ID') || '',
    razorSecret:p.getProperty('RAZORPAY_KEY_SECRET') || '',
  };
}

var TAB = { USERS:'Users', TASKS:'Tasks', KRA:'KRA_Master', REVIEWS:'Reviews',
            SETTINGS:'Settings', LEAVE:'Leave', DIRECTORY:'Directory',
            GLOBAL:'Global_Users', TOKENS:'Reset_Tokens' };

/* Column layout. The first 15 task columns and first 9 user columns match the
   old schema exactly, so an existing tenant sheet keeps working; new fields are
   appended, which is the only shape of change that cannot corrupt old rows. */
var TASK_COLS = ['ID','Date Created','Due Date','Title','Description','Assigned By',
  'Assigned To','Status','KRA Tag','Priority','Frequency','Reworks','History JSON',
  'Job Category','Approver Manager','Spawned By','Blocked By','Subtasks JSON','Delegate To'];

var USER_COLS = ['Name','Username','Password','Email','Role','Job Profile','Dept',
  'Phone','Manager','Active','WIP Limit','KRAs JSON','WhatsApp OptIn'];

var T = {}; TASK_COLS.forEach(function (c, i) { T[c] = i; });
var U = {}; USER_COLS.forEach(function (c, i) { U[c] = i; });

var DEFAULT_CATEGORIES = ['NPD','SYSTEM IMPLEMENTATION','MAINTENANCE','PRODUCTION PLAN',
  'PURCHASE','CRM','HR','SUPPLIER','DEVELOPMENT','PQC','PDI','IQC','SCM','INVENTORY PLAN',
  'New Customer Development','Quality','Value Engineering & Value Analysis','Production',
  'Systems','Business Intelligence','Inventory','General'];

/** Run once. Tells you exactly what is still missing instead of failing later. */
function setupDomeBox() {
  var p = PropertiesService.getScriptProperties();
  var out = ['', '=== DOME BOX SETUP ===', ''];

  var made = [];
  if (!p.getProperty('AUTH_PEPPER'))  { p.setProperty('AUTH_PEPPER', Utilities.getUuid()+Utilities.getUuid()); made.push('AUTH_PEPPER'); }
  if (!p.getProperty('TOKEN_SECRET')) { p.setProperty('TOKEN_SECRET', Utilities.getUuid()+Utilities.getUuid()); made.push('TOKEN_SECRET'); }
  if (made.length) out.push('Created secrets: ' + made.join(', '));

  var c = CFG(), missing = [];
  [['MASTER_DB_ID', c.masterId, 'the registry spreadsheet id'],
   ['TEMPLATE_ID', c.templateId, 'the blank tenant template id'],
   ['RAZORPAY_KEY_ID', c.razorKey, 'only needed to sell online'],
   ['RAZORPAY_KEY_SECRET', c.razorSecret, 'only needed to sell online']
  ].forEach(function (r) {
    out.push((r[1] ? '  set     ' : '  MISSING ') + r[0] + (r[1] ? '' : '   — ' + r[2]));
    if (!r[1] && r[0].indexOf('RAZORPAY') < 0) missing.push(r[0]);
  });

  out.push('');
  if (missing.length) {
    out.push('Add ' + missing.join(' and ') + ' under Project Settings > Script Properties,');
    out.push('then run setupDomeBox() again.');
  } else {
    out.push('Config looks complete. Next:');
    out.push('  1. ensureRegistry()      prepares the master registry tabs');
    out.push('  2. Deploy > New deployment > Web app (Execute as Me, Access Anyone)');
    out.push('  3. Put the /exec URL into index.html as API_URL');
  }
  out.push('');
  out.push('Back up AUTH_PEPPER somewhere safe. Losing it means every password must be reset.');
  Logger.log(out.join('\n'));
}

function ensureRegistry() {
  var c = CFG();
  if (!c.masterId) throw new Error('MASTER_DB_ID is not set. Run setupDomeBox().');
  var ss = SpreadsheetApp.openById(c.masterId);
  mkTab_(ss, TAB.DIRECTORY, ['Company','Email','Password','Plan','Valid Until','SheetID','Status','Created']);
  mkTab_(ss, TAB.GLOBAL,    ['Email','Password','SheetID','Username']);
  mkTab_(ss, TAB.TOKENS,    ['Token','Email','Created','Used']);
  Logger.log('Registry ready: ' + ss.getName());
}

/** Every tenant in the registry. Used by the password-migration audit and by
 *  any maintenance job that has to walk all companies. */
function allTenants_() {
  try {
    var c = CFG();
    if (!c.masterId) return [];
    var sh = SpreadsheetApp.openById(c.masterId).getSheetByName(TAB.DIRECTORY);
    if (!sh) return [];
    var d = sh.getDataRange().getValues(), out = [];
    for (var i = 1; i < d.length; i++) {
      if (d[i][5]) out.push({ company: d[i][0], sheetId: String(d[i][5]).trim() });
    }
    return out;
  } catch (e) { return []; }
}

function mkTab_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(headers); sh.setFrozenRows(1); return sh; }
  if (sh.getLastRow() === 0) { sh.appendRow(headers); sh.setFrozenRows(1); }
  return sh;
}


// ===========================================================================
// ROUTER
// ===========================================================================

function doGet(e) {
  var p = (e && e.parameter) || {};
  // Razorpay/Meta webhook verification handshakes also arrive on GET.
  if (p['hub.mode'] === 'subscribe') {
    var vt = PropertiesService.getScriptProperties().getProperty('WA_VERIFY_TOKEN');
    if (vt && p['hub.verify_token'] === vt) return ContentService.createTextOutput(p['hub.challenge']);
  }
  return ContentService.createTextOutput('Dome Box API is running.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ status: 'error', message: 'Malformed request.' }); }

  // Razorpay posts its own shape, not ours.
  if (body.event && body.payload) return handleRazorpayWebhook_(e, body);

  try {
    return json_(route_(body));
  } catch (err) {
    // Never leak a stack trace or an internal id to the browser.
    var msg = String(err && err.message || err);
    if (/openById|Spreadsheet|permission|Exception/i.test(msg) && !/signed in|expired|Admin account/i.test(msg)) {
      logError_('route:' + body.action, msg);
      msg = 'Something went wrong on our side. Please try again.';
    }
    return json_({ status: 'error', message: msg });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

var PUBLIC_ACTIONS = ['register','login','forgotPassword','resetPassword','contactSales','ping'];

function route_(p) {
  var action = String(p.action || '');

  if (PUBLIC_ACTIONS.indexOf(action) > -1) {
    switch (action) {
      case 'ping':           return { status: 'success', time: new Date().toISOString() };
      case 'register':       return registerCompany_(p.form);
      case 'login':          return login_(p.username, p.password);
      case 'forgotPassword': return forgotPassword_(p.email);
      case 'resetPassword':  return resetPassword_(p.token, p.password);
      case 'contactSales':   return contactSales_(p.form);
    }
  }

  /* Identity comes from the signed token, never from the request body. This one
     line is the difference between "knowing a sheetId" and "being authorised". */
  var S = requireSession(p.token);
  var ctx = tenantContext_(S);

  switch (action) {
    /* --- read ------------------------------------------------------------ */
    case 'getDashboard':        return getDashboard_(ctx);
    case 'getTasks':            return { status:'success', tasks: readTasks_(ctx) };
    case 'getUsers':            return getUsers_(ctx);
    case 'getAnalytics':        return getAnalytics_(ctx, p.period, p.offset, p.span, p.person);
    case 'getAccountability':   return getAccountability_(ctx);
    case 'getPerformanceReport':return getPerformanceReport_(ctx);
    case 'getAppraisalForm':    return getAppraisalForm_(ctx, p.username);
    case 'getKraOverview':      return getKraOverview_(ctx);
    case 'getKraFor':           return getKraFor_(ctx, p.username);
    case 'getCategories':       return { status:'success', categories: readCategories_(ctx) };

    /* --- tasks ----------------------------------------------------------- */
    case 'createTask':          return createTask_(ctx, p.form);
    case 'updateTask':          return updateTask_(ctx, p.taskId, p.status, p.note, p.newDueDate);
    case 'editTask':            return editTask_(ctx, p.form);
    case 'processTaskApproval': return processApproval_(ctx, p.taskId, p.isApproved, p.remarks);
    case 'stopRecurringTask':   return stopRecurring_(ctx, p.taskId);
    case 'delegateTask':        return delegateTask_(ctx, p.taskId, p.toUsername);
    case 'addBlocker':          return addBlocker_(ctx, p.taskId, p.blockerId);
    case 'toggleSubtask':       return toggleSubtask_(ctx, p.taskId, p.index, p.done);

    /* --- team ------------------------------------------------------------ */
    case 'addUser':             return addUser_(ctx, p.form);
    case 'updateUser':          return updateUser_(ctx, p.form);
    case 'deleteUser':          return deleteUser_(ctx, p.username, p.reassignTo);
    case 'updateCategories':    return updateCategories_(ctx, p.categories);
    case 'setLeave':            return setLeave_(ctx, p.username, p.from, p.to, p.reason);
    case 'getLeave':            return { status:'success', leave: readLeave_(ctx) };

    /* --- appraisal ------------------------------------------------------- */
    case 'submitAppraisal':     return submitAppraisal_(ctx, p.data);
    case 'addKRA':              return saveKra_(ctx, p.data);     // old name, kept working
    case 'saveKra':             return saveKra_(ctx, p.data);
    case 'copyKra':             return copyKraFrom_(ctx, p.from, p.to);
    case 'applyKraToProfile':   return applyKraToProfile_(ctx, p.profile, p.overwrite);
    case 'clearKra':            return clearKra_(ctx, p.username);

    /* --- commercial & misc ----------------------------------------------- */
    case 'initiateRazorpay':    return createRazorpayOrder_(ctx, p.planName, p.promoCode);
    case 'paymentSuccess':      return handleVerifiedPayment_(ctx, p);
    case 'contactSupport':      return contactSupport_(ctx, p.form);
    case 'aiInsight':           return aiInsight_(ctx, p.question);
    case 'changePassword':      return changePassword_(ctx, p.currentPassword, p.newPassword);

    default: throw new Error('Unknown action: ' + action);
  }
}

/**
 * Loads the tenant once per request and carries the verified identity with it,
 * so no handler has to re-derive who is calling or re-open the spreadsheet.
 */
function tenantContext_(session) {
  var ss;
  try { ss = SpreadsheetApp.openById(session.sheetId); }
  catch (e) { throw new Error('Your workspace could not be opened. Contact support.'); }

  var reg = registryRow_(session.sheetId);
  var plan = planLimits(reg ? reg.plan : 'Free');
  var expiry = reg && reg.validUntil ? new Date(reg.validUntil) : null;
  var daysLeft = expiry && !isNaN(expiry)
    ? Math.ceil((expiry - new Date()) / 86400000) : null;

  var me = findUser_(ss, session.username);
  if (!me) throw new Error('Your account is no longer in this workspace.');
  if (me.active === false) throw new Error('This account has been deactivated.');

  return {
    ss: ss, sheetId: session.sheetId, me: me,
    actor: { username: me.username, role: me.role, name: me.name },
    company: reg ? reg.company : '', planName: normalizePlan(reg ? reg.plan : 'Free'),
    plan: plan, daysLeft: daysLeft,
    // A lapsed paid plan keeps working for a week, then drops to read-only
    // rather than vanishing — nobody loses access to their own history.
    serviceStopped: (daysLeft !== null && daysLeft <= -7 && normalizePlan(reg ? reg.plan : 'Free') !== 'Free'),
  };
}

/** Routes that change the team or the company's settings. */
function requireManager_(ctx) {
  if (ctx.actor.role === 'Doer') throw new Error('That action needs a manager account.');
  return ctx;
}
function requireAdmin_(ctx) {
  if (ctx.actor.role !== 'Admin') throw new Error('That action needs an Admin account.');
  return ctx;
}
function blockIfStopped_(ctx) {
  if (ctx.serviceStopped) {
    throw new Error('Your subscription lapsed more than a week ago, so the workspace is ' +
      'read-only. Your data is safe — renew to start writing again.');
  }
}

function logError_(where, message) {
  try {
    var ss = SpreadsheetApp.openById(CFG().masterId);
    var sh = ss.getSheetByName('ErrorLog');
    if (!sh) { sh = ss.insertSheet('ErrorLog'); sh.appendRow(['when','where','message']); sh.setFrozenRows(1); }
    sh.appendRow([new Date(), where, String(message).slice(0, 500)]);
  } catch (e) { Logger.log(where + ': ' + message); }
}


// ===========================================================================
// ACCOUNTS — signup, login, password reset
// ===========================================================================

function registerCompany_(form) {
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


// ===========================================================================
// TENANT DATA ACCESS
// ===========================================================================

function ensureTenantTabs_(ss) {
  mkTab_(ss, TAB.USERS, USER_COLS);
  mkTab_(ss, TAB.TASKS, TASK_COLS);
  mkTab_(ss, TAB.KRA, ['Job Profile','KRA Title','Description','Weight','Grid/KPI']);
  mkTab_(ss, TAB.REVIEWS, ['Month','Employee','Performance Score','Delegation Score','Final Score','Date']);
  mkTab_(ss, TAB.LEAVE, ['Username','From','To','Reason','Approved']);
  var set = ss.getSheetByName(TAB.SETTINGS);
  if (!set) {
    set = ss.insertSheet(TAB.SETTINGS);
    set.getRange(1, 1, DEFAULT_CATEGORIES.length, 1)
       .setValues(DEFAULT_CATEGORIES.map(function (c) { return [c]; }));
  }
  /* A tenant created before a column existed is widened in place rather than
     rebuilt, so adding a feature never costs anyone their data. */
  widen_(ss.getSheetByName(TAB.TASKS), TASK_COLS);
  widen_(ss.getSheetByName(TAB.USERS), USER_COLS);
  return ss;
}

function widen_(sheet, cols) {
  if (!sheet) return;
  var last = sheet.getLastColumn();
  if (last >= cols.length) return;
  sheet.getRange(1, last + 1, 1, cols.length - last)
       .setValues([cols.slice(last)]);
}

function blankUserRow_() { return USER_COLS.map(function () { return ''; }); }
function blankTaskRow_() { return TASK_COLS.map(function () { return ''; }); }

/* ---------- users -------------------------------------------------------- */

function readUsers_(ctx) {
  var sh = ctx.ss.getSheetByName(TAB.USERS);
  var d = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < d.length; i++) {
    if (!d[i][U['Username']] && !d[i][U['Email']]) continue;
    out.push(rowToUser_(d[i], i + 1));
  }
  return out;
}

function rowToUser_(r, rowIndex) {
  return {
    name: r[U['Name']], username: String(r[U['Username']] || '').trim(),
    email: String(r[U['Email']] || '').trim(), role: r[U['Role']] || 'Doer',
    jobProfile: r[U['Job Profile']] || '', dept: r[U['Dept']] || '',
    phone: r[U['Phone']] || '', manager: String(r[U['Manager']] || '').trim(),
    active: r[U['Active']] === '' || r[U['Active']] === true || String(r[U['Active']]).toLowerCase() === 'true',
    wipLimit: r[U['WIP Limit']] === '' ? null : Number(r[U['WIP Limit']]),
    kras: safeJson_(r[U['KRAs JSON']], []),
    waOptIn: r[U['WhatsApp OptIn']] === true || String(r[U['WhatsApp OptIn']]).toLowerCase() === 'true',
    rowIndex: rowIndex,
  };
}

function findUser_(ss, username) {
  var d = ss.getSheetByName(TAB.USERS).getDataRange().getValues();
  var key = String(username || '').trim().toLowerCase();
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][U['Username']] || '').trim().toLowerCase() === key) return rowToUser_(d[i], i + 1);
  }
  return null;
}

function findUserByEmailOrName_(ss, key) {
  var d = ss.getSheetByName(TAB.USERS).getDataRange().getValues();
  key = String(key || '').trim().toLowerCase();
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][U['Email']] || '').trim().toLowerCase() === key ||
        String(d[i][U['Username']] || '').trim().toLowerCase() === key) return rowToUser_(d[i], i + 1);
  }
  return null;
}

function getUserField_(ss, rowIndex, col) {
  return ss.getSheetByName(TAB.USERS).getRange(rowIndex, U[col] + 1).getValue();
}
function setUserField_(ss, rowIndex, col, value) {
  ss.getSheetByName(TAB.USERS).getRange(rowIndex, U[col] + 1).setValue(value);
}

/* ---------- tasks -------------------------------------------------------- */

function readTasks_(ctx) {
  var d = ctx.ss.getSheetByName(TAB.TASKS).getDataRange().getValues();
  var names = {};
  readUsers_(ctx).forEach(function (u) { names[u.username] = u.name; });
  var out = [];
  for (var i = 1; i < d.length; i++) {
    if (!d[i][T['ID']]) continue;
    out.push(rowToTask_(d[i], i + 1, names));
  }
  return out;
}

function rowToTask_(r, rowIndex, names) {
  names = names || {};
  var history = safeJson_(r[T['History JSON']], []);
  var status = r[T['Status']] || 'Pending';
  return {
    id: String(r[T['ID']]),
    createdDate: toIso_(r[T['Date Created']]),
    due: toYmd_(r[T['Due Date']]),
    title: r[T['Title']] || '', desc: r[T['Description']] || '',
    by: String(r[T['Assigned By']] || '').trim(),
    to: String(r[T['Assigned To']] || '').trim(),
    assignee: String(r[T['Assigned To']] || '').trim(),   // engine field name
    raisedBy: String(r[T['Assigned By']] || '').trim(),
    approver: String(r[T['Approver Manager']] || r[T['Assigned By']] || '').trim(),
    approverManager: String(r[T['Approver Manager']] || '').trim(),
    status: status, kra: r[T['KRA Tag']] || '', priority: r[T['Priority']] || 'Medium',
    frequency: r[T['Frequency']] || 'One Time',
    cadence: r[T['Frequency']] || 'One Time',
    reworkCount: Number(r[T['Reworks']] || 0),
    history: history,
    jobCategory: r[T['Job Category']] || 'General',
    spawnedBy: String(r[T['Spawned By']] || ''),
    blockedBy: safeJson_(r[T['Blocked By']], []),
    subtasks: safeJson_(r[T['Subtasks JSON']], []),
    delegateTo: String(r[T['Delegate To']] || '').trim(),
    isArchived: isArchived_(status, r[T['Date Created']], history),
    toName: names[String(r[T['Assigned To']] || '').trim()] || r[T['Assigned To']] || '',
    byName: names[String(r[T['Assigned By']] || '').trim()] || r[T['Assigned By']] || '',
    rowIndex: rowIndex,
  };
}

/** Closed work drops out of the active board after a week, as it did before. */
function isArchived_(status, created, history) {
  if (['Verified','Completed','Rejected','Cancelled'].indexOf(status) < 0) return false;
  var last = new Date(created);
  if (history && history.length) {
    var d = new Date(history[history.length - 1].date);
    if (!isNaN(d)) last = d;
  }
  if (isNaN(last)) return false;
  return Math.ceil(Math.abs(new Date() - last) / 86400000) > 7;
}

function findTaskRow_(ctx, taskId) {
  var sh = ctx.ss.getSheetByName(TAB.TASKS);
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][T['ID']]) === String(taskId)) {
      var names = {};
      readUsers_(ctx).forEach(function (u) { names[u.username] = u.name; });
      return { sheet: sh, rowIndex: i + 1, raw: d[i], task: rowToTask_(d[i], i + 1, names) };
    }
  }
  return null;
}

function writeTaskField_(hit, col, value) {
  hit.sheet.getRange(hit.rowIndex, T[col] + 1).setValue(value);
}

function appendHistory_(hit, status, actorName, note, extra) {
  var h = safeJson_(hit.raw[T['History JSON']], []);
  var entry = { date: new Date().toISOString(), status: status, user: actorName, note: note || '' };
  if (extra) for (var k in extra) entry[k] = extra[k];
  h.push(entry);
  writeTaskField_(hit, 'History JSON', JSON.stringify(h));
  return h;
}

/* ---------- misc tabs ---------------------------------------------------- */

function readCategories_(ctx) {
  var sh = ctx.ss.getSheetByName(TAB.SETTINGS);
  if (!sh) return DEFAULT_CATEGORIES.slice();
  var d = sh.getDataRange().getValues();
  var out = d.map(function (r) { return String(r[0] || '').trim(); })
             .filter(function (c) { return c; });
  return out.length ? out : DEFAULT_CATEGORIES.slice();
}

function updateCategories_(ctx, categories) {
  requireManager_(ctx); blockIfStopped_(ctx);
  var list = (categories || []).map(function (c) { return String(c).trim(); })
                               .filter(function (c) { return c; });
  var sh = ctx.ss.getSheetByName(TAB.SETTINGS) || ctx.ss.insertSheet(TAB.SETTINGS);
  sh.clear();
  if (list.length) sh.getRange(1, 1, list.length, 1).setValues(list.map(function (c) { return [c]; }));
  return { status: 'success', categories: list };
}

function readLeave_(ctx) {
  var sh = ctx.ss.getSheetByName(TAB.LEAVE);
  if (!sh) return [];
  var d = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < d.length; i++) {
    if (!d[i][0]) continue;
    out.push({ username: String(d[i][0]).trim(), from: toYmd_(d[i][1]), to: toYmd_(d[i][2]),
               reason: d[i][3] || '', approved: d[i][4] !== false });
  }
  return out;
}

function setLeave_(ctx, username, from, to, reason) {
  requireManager_(ctx); blockIfStopped_(ctx);
  if (!username || !from) throw new Error('Pick a person and a start date.');
  var sh = mkTab_(ctx.ss, TAB.LEAVE, ['Username','From','To','Reason','Approved']);
  sh.appendRow([String(username).trim(), from, to || from, reason || '', true]);
  return { status: 'success', message: 'Leave recorded. It will not count against their score.' };
}

/** The calendar the scoring engine uses so leave is not charged as lateness. */
function leaveCalendar_(ctx) {
  var map = {};
  readLeave_(ctx).forEach(function (l) {
    if (!l.approved) return;
    (map[l.username] = map[l.username] || []).push({ from: l.from, to: l.to });
  });
  return { weekend: [0, 6], holidays: [], leave: map };
}

/* ---------- small helpers ------------------------------------------------ */

function safeJson_(v, fallback) {
  if (v == null || v === '') return fallback;
  if (typeof v === 'object') return v;
  try { var p = JSON.parse(v); return p == null ? fallback : p; } catch (e) { return fallback; }
}
function toYmd_(v) {
  if (!v) return '';
  if (v instanceof Date) return ymd(v);
  var s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  var d = new Date(s);
  return isNaN(d) ? '' : ymd(d);
}
function toIso_(v) {
  if (!v) return new Date().toISOString();
  var d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? new Date().toISOString() : d.toISOString();
}
function newTaskId_() {
  return 'T' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1000);
}
function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}


// ===========================================================================
// TASKS
// ===========================================================================

function createTask_(ctx, form) {
  /* Deliberately NOT requireManager_: a Doer may raise work upward, to their own
     manager or to a department head. canAssignTo decides per recipient. */
  blockIfStopped_(ctx);
  form = form || {};

  var title = String(form.title || '').trim();
  if (!title) throw new Error('Give the task a title.');
  var assignees = String(form.assignTo || '').split(',')
    .map(function (s) { return s.trim(); }).filter(function (s) { return s; });
  if (!assignees.length) throw new Error('Pick at least one person.');

  var users = readUsers_(ctx);
  var byName = {};
  users.forEach(function (u) { byName[u.username] = u; });

  /* The published plan promises a monthly cap. Enforced here, on the server,
     because a limit checked in the browser is a suggestion. */
  var tasks = readTasks_(ctx);
  var used = tasksCreatedInMonth(tasks, new Date());
  var gate = canCreateTask(ctx.planName, used + assignees.length - 1);
  if (!gate.ok) throw new Error(gate.reason + (gate.upgradeTo ? ' Upgrade to ' + gate.upgradeTo + '.' : ''));

  var sheet = ctx.ss.getSheetByName(TAB.TASKS);
  var created = [], routed = 0;

  var refused = [];
  assignees.forEach(function (username) {
    var target = byName[username];
    if (!target || target.active === false) return;

    var allowed = canAssignTo(ctx.me, target);
    if (!allowed.ok) { refused.push({ name: target.name, reason: allowed.reason }); return; }

    // The engine decides who, if anyone, has to agree before this lands.
    var route = initialStatusFor(target, ctx.me);
    var id = newTaskId_();
    var row = blankTaskRow_();
    row[T['ID']] = id;
    row[T['Date Created']] = new Date();
    row[T['Due Date']] = form.dueDate || '';
    row[T['Title']] = title;
    row[T['Description']] = String(form.desc || '');
    row[T['Assigned By']] = ctx.actor.username;
    row[T['Assigned To']] = username;
    row[T['Status']] = route.status;
    row[T['KRA Tag']] = String(form.kra || 'General');
    row[T['Priority']] = form.priority || 'Medium';
    row[T['Frequency']] = form.frequency || 'One Time';
    row[T['Reworks']] = 0;
    row[T['History JSON']] = JSON.stringify([{ date: new Date().toISOString(),
      status: route.status, user: ctx.actor.name, note: route.note }]);
    row[T['Job Category']] = String(form.jobCategory || 'General');
    row[T['Approver Manager']] = route.status === 'Awaiting Approval' ? route.approver : '';
    row[T['Status']] = route.status;
    row[T['Spawned By']] = '';
    row[T['Blocked By']] = JSON.stringify([]);
    row[T['Subtasks JSON']] = JSON.stringify(parseChecklist_(form.checklist));
    row[T['Delegate To']] = '';
    sheet.appendRow(row);
    created.push({ id: id, to: username });
    if (route.status === 'Awaiting Approval') routed++;

    try { notifyAssignment_(ctx, target, byName[route.approver], title, form.dueDate, id, route.status); }
    catch (e) { logError_('createTask:notify', e.message); }
  });

  if (!created.length) {
    throw new Error(refused.length ? refused[0].reason
      : 'None of those people are active in this workspace.');
  }
  return { status: 'success', created: created.length, routedForApproval: routed,
    refused: refused,
    message: created.length + ' task(s) created' +
      (routed ? ', ' + routed + ' sent for approval' : '') + '.' +
      (refused.length ? ' Not sent to ' +
        refused.map(function (r) { return r.name; }).join(', ') + '.' : '') };
}

function parseChecklist_(raw) {
  if (Array.isArray(raw)) return raw.map(function (x) {
    return typeof x === 'string' ? { text: x, done: false } : { text: String(x.text||''), done: !!x.done }; });
  return String(raw || '').split('\n').map(function (s) { return s.trim(); })
    .filter(function (s) { return s; }).map(function (s) { return { text: s, done: false }; });
}

/**
 * The single write path for a status change. Board, list and detail all route
 * through here so the rework counter, the recurrence spawn and the audit trail
 * cannot be skipped by taking a different path through the UI.
 */
function updateTask_(ctx, taskId, status, note, newDueDate) {
  blockIfStopped_(ctx);
  var hit = findTaskRow_(ctx, taskId);
  if (!hit) throw new Error('That task no longer exists.');
  var t = hit.task;

  if (!canTransition(t, ctx.actor, status)) {
    if (status === 'Verified' && t.assignee === ctx.actor.username) {
      throw new Error('You cannot sign off your own work — it needs the person who raised it.');
    }
    throw new Error('Your role does not allow that move on this task.');
  }

  var all = readTasks_(ctx);

  if (status === 'In Progress' && t.status === 'Pending') {
    var blockers = openBlockers(t, all);
    if (blockers.length) {
      throw new Error('Blocked by: ' + blockers.map(function (b) { return b.title; }).join(', '));
    }
    var limit = wipLimitFor_(ctx, t.assignee);
    var wip = wipStatus(all, t.assignee, limit);
    if (wip.exceeded) {
      throw new Error(nameOf_(ctx, t.assignee) + ' already has ' + wip.count +
        ' tasks in progress (limit ' + wip.limit + ').');
    }
  }
  if (status === 'For Review') {
    var sub = subtaskProgress(t);
    if (sub.total && sub.done < sub.total) {
      throw new Error('Finish the checklist first (' + sub.done + '/' + sub.total + ').');
    }
  }

  /* Rework is specifically review sending work BACK. The old build incremented
     this on any move to In Progress, so simply starting a task cost five points
     on the score. Only the For Review -> In Progress path counts. */
  var isRework = (t.status === 'For Review' && status === 'In Progress');
  if (isRework) writeTaskField_(hit, 'Reworks', Number(t.reworkCount || 0) + 1);

  // An approved hand-off is where the new owner actually takes the task.
  if (t.status === 'Delegation Proposed' && t.delegateTo && status !== 'Delegation Proposed') {
    writeTaskField_(hit, 'Assigned To', t.delegateTo);
    writeTaskField_(hit, 'Delegate To', '');
  }

  if (isRework && newDueDate) writeTaskField_(hit, 'Due Date', newDueDate);

  writeTaskField_(hit, 'Status', status);
  appendHistory_(hit, status, ctx.actor.name, note || (isRework ? 'Returned for rework' : ''),
    isRework && newDueDate ? { setDate: newDueDate } : null);

  var spawned = null;
  if (status === 'Verified' && t.frequency && t.frequency !== 'One Time') {
    spawned = spawnNextOccurrence_(ctx, hit, t);
  }

  try { notifyStatus_(ctx, t, status, note); } catch (e) { logError_('updateTask:notify', e.message); }

  return { status: 'success',
    message: spawned ? 'Verified. Next occurrence due ' + spawned
           : isRework ? 'Sent back for rework.' : 'Moved to ' + status + '.',
    spawnedDue: spawned };
}

function spawnNextOccurrence_(ctx, hit, t) {
  var next = nextOccurrence(t.frequency, t.due, {});
  if (!next) return null;
  var due = ymd(next);

  // Never create a second copy for a date that already has an open occurrence.
  var existing = readTasks_(ctx);
  for (var i = 0; i < existing.length; i++) {
    var x = existing[i];
    if (x.title === t.title && x.assignee === t.assignee && x.due === due && isOpen(x.status)) return null;
  }

  var row = blankTaskRow_();
  row[T['ID']] = newTaskId_();
  row[T['Date Created']] = new Date();
  row[T['Due Date']] = due;
  row[T['Title']] = t.title;
  row[T['Description']] = t.desc;
  row[T['Assigned By']] = t.by;
  row[T['Assigned To']] = t.assignee;
  row[T['Status']] = 'Pending';
  row[T['KRA Tag']] = t.kra;
  row[T['Priority']] = t.priority;
  row[T['Frequency']] = t.frequency;
  row[T['Reworks']] = 0;
  row[T['History JSON']] = JSON.stringify([{ date: new Date().toISOString(), status: 'Pending',
    user: 'System', note: 'Recurring occurrence of ' + t.id }]);
  row[T['Job Category']] = t.jobCategory;
  /* Marked system-generated so it does not spend the tenant's monthly task
     quota — nobody chose to create it, and a Free customer with five daily
     recurring jobs would otherwise burn all 50 in ten days. */
  row[T['Spawned By']] = t.id;
  row[T['Blocked By']] = JSON.stringify([]);
  row[T['Subtasks JSON']] = JSON.stringify((t.subtasks || []).map(function (s) {
    return { text: s.text, done: false }; }));
  row[T['Delegate To']] = '';
  ctx.ss.getSheetByName(TAB.TASKS).appendRow(row);
  return due;
}

function processApproval_(ctx, taskId, isApproved, remarks) {
  blockIfStopped_(ctx);
  var hit = findTaskRow_(ctx, taskId);
  if (!hit) throw new Error('That task no longer exists.');
  var t = hit.task;

  if (t.status !== 'Awaiting Approval' && t.status !== 'Delegation Proposed') {
    throw new Error('That task is not waiting for approval.');
  }
  if (t.approver !== ctx.actor.username && ctx.actor.role !== 'Admin') {
    throw new Error('Only ' + nameOf_(ctx, t.approver) + ' can decide this one.');
  }

  /* A rejection without a reason is the thing people complain about: the task
     vanishes and whoever raised it has to go and ask why. The remark is the
     answer, recorded against the task. */
  remarks = String(remarks || '').trim();
  if (!isApproved && !remarks) {
    throw new Error('Add a remark saying why you are rejecting it. ' +
      'The person who raised it will see this.');
  }

  var next = isApproved ? 'Pending' : 'Rejected';
  if (t.status === 'Delegation Proposed' && isApproved && t.delegateTo) {
    writeTaskField_(hit, 'Assigned To', t.delegateTo);
    writeTaskField_(hit, 'Delegate To', '');
  }
  writeTaskField_(hit, 'Status', next);
  writeTaskField_(hit, 'Approver Manager', '');
  appendHistory_(hit, next, ctx.actor.name,
    (isApproved ? 'Approved' : 'Rejected') + (remarks ? ': ' + remarks : ''));

  try { notifyDecision_(ctx, t, isApproved, remarks); }
  catch (e) { logError_('processApproval:notify', e.message); }

  return { status: 'success', remarks: remarks,
    message: isApproved ? 'Approved — it is on their list now.'
                        : 'Rejected, and ' + nameOf_(ctx, t.by) + ' has been told why.' };
}

function delegateTask_(ctx, taskId, toUsername) {
  blockIfStopped_(ctx);
  var hit = findTaskRow_(ctx, taskId);
  if (!hit) throw new Error('That task no longer exists.');
  var target = findUser_(ctx.ss, toUsername);
  if (!target) throw new Error('That person is not in this workspace.');

  var r = proposeDelegation(hit.task, ctx.actor, target, ctx.me);
  if (!r.ok) throw new Error(r.error);

  writeTaskField_(hit, 'Status', r.status);
  writeTaskField_(hit, 'Assigned To', r.assignee);
  writeTaskField_(hit, 'Approver Manager', r.status === 'Delegation Proposed' ? r.approver : '');
  writeTaskField_(hit, 'Delegate To', r.delegateTo || '');
  appendHistory_(hit, r.status, ctx.actor.name, r.note);

  return { status: 'success', message: r.note };
}

function addBlocker_(ctx, taskId, blockerId) {
  blockIfStopped_(ctx);
  var all = readTasks_(ctx);
  var r = addDependency(taskId, blockerId, all);
  if (!r.ok) throw new Error(r.error);          // refuses circular chains
  var hit = findTaskRow_(ctx, taskId);
  writeTaskField_(hit, 'Blocked By', JSON.stringify(r.blockedBy));
  return { status: 'success', message: 'Blocker added.' };
}

function toggleSubtask_(ctx, taskId, index, done) {
  blockIfStopped_(ctx);
  var hit = findTaskRow_(ctx, taskId);
  if (!hit) throw new Error('That task no longer exists.');
  var t = hit.task;
  if (t.assignee !== ctx.actor.username && ctx.actor.role === 'Doer') {
    throw new Error('Only the owner can tick off their checklist.');
  }
  var subs = t.subtasks || [];
  if (index < 0 || index >= subs.length) throw new Error('No such checklist item.');
  subs[index].done = !!done;
  writeTaskField_(hit, 'Subtasks JSON', JSON.stringify(subs));
  return { status: 'success', progress: subtaskProgress({ subtasks: subs }) };
}

function stopRecurring_(ctx, taskId) {
  requireManager_(ctx); blockIfStopped_(ctx);
  var hit = findTaskRow_(ctx, taskId);
  if (!hit) throw new Error('That task no longer exists.');
  writeTaskField_(hit, 'Frequency', 'One Time');
  appendHistory_(hit, hit.task.status, ctx.actor.name, 'Recurrence stopped');
  return { status: 'success', message: 'This will not repeat again.' };
}

function editTask_(ctx, form) {
  blockIfStopped_(ctx);
  form = form || {};
  var hit = findTaskRow_(ctx, form.taskId);
  if (!hit) throw new Error('That task no longer exists.');
  var t = hit.task;

  var mayEdit = ctx.actor.role === 'Admin' || t.by === ctx.actor.username;
  if (!mayEdit) throw new Error('Only an Admin or the person who raised it can edit this task.');

  var changes = [];
  [['title','Title'],['desc','Description'],['dueDate','Due Date'],
   ['priority','Priority'],['kra','KRA Tag'],['jobCategory','Job Category']].forEach(function (pair) {
    if (form[pair[0]] !== undefined && String(form[pair[0]]) !== String(hit.raw[T[pair[1]]])) {
      writeTaskField_(hit, pair[1], form[pair[0]]);
      changes.push(pair[1]);
    }
  });
  if (form.status && form.status !== t.status && ctx.actor.role === 'Admin') {
    writeTaskField_(hit, 'Status', form.status);
    changes.push('Status');
  }
  if (changes.length) appendHistory_(hit, form.status || t.status, ctx.actor.name,
    'Edited: ' + changes.join(', '));
  return { status: 'success', message: changes.length ? 'Saved.' : 'Nothing changed.' };
}

function wipLimitFor_(ctx, username) {
  var u = findUser_(ctx.ss, username);
  return (u && u.wipLimit != null && !isNaN(u.wipLimit)) ? u.wipLimit : DEFAULT_WIP_LIMIT;
}
function nameOf_(ctx, username) {
  var u = findUser_(ctx.ss, username);
  return u ? u.name : (username || 'someone');
}


// ===========================================================================
// TEAM
// ===========================================================================

function getUsers_(ctx) {
  var users = readUsers_(ctx);
  var tasks = readTasks_(ctx);
  var range = periodRange(PERIOD.MONTH, 1);               // last full month
  var cal = leaveCalendar_(ctx);

  return { status: 'success', users: users.map(function (u) {
    var wip = wipStatus(tasks, u.username, u.wipLimit == null ? DEFAULT_WIP_LIMIT : u.wipLimit);
    var s = scoreForPeriod(tasks, u.username, range, cal);
    return {
      /* Deliberately no password field. The old getUsersList returned every
         employee's password to the browser in plain text. */
      name: u.name, username: u.username, email: u.email, role: u.role,
      jobProfile: u.jobProfile, dept: u.dept, phone: u.phone, manager: u.manager,
      active: u.active, wipLimit: u.wipLimit, kras: u.kras, waOptIn: u.waOptIn,
      openTasks: tasks.filter(function (t) { return t.assignee === u.username && isOpen(t.status); }).length,
      wip: { count: wip.count, limit: wip.limit, exceeded: wip.exceeded },
      lastMonthScore: s.hasData ? s.score : null,
      lastMonthBand: s.hasData ? performanceBand(s.score).band : null,
    };
  }) };
}

function addUser_(ctx, form) {
  requireManager_(ctx); blockIfStopped_(ctx);
  form = form || {};
  var username = String(form.username || '').trim();
  var email = String(form.email || '').trim().toLowerCase();
  if (!username || !email || !form.name) throw new Error('Name, username and email are required.');
  if (!form.password || String(form.password).length < 8) {
    throw new Error('Give them a password of at least 8 characters.');
  }

  var users = readUsers_(ctx);
  var active = users.filter(function (u) { return u.active !== false; }).length;
  var gate = canAddUser(ctx.planName, active);
  if (!gate.ok) throw new Error(gate.reason + (gate.upgradeTo ? ' Upgrade to ' + gate.upgradeTo + '.' : ''));

  for (var i = 0; i < users.length; i++) {
    if (users[i].username.toLowerCase() === username.toLowerCase()) throw new Error('That username is taken.');
    if (users[i].email.toLowerCase() === email) throw new Error('That email is already in this workspace.');
  }
  // A Doer must not be able to mint an Admin.
  var role = ['Admin','HOD','Doer'].indexOf(form.role) > -1 ? form.role : 'Doer';
  if (role === 'Admin' && ctx.actor.role !== 'Admin') throw new Error('Only an Admin can create another Admin.');

  var hash = makePasswordHash(String(form.password));
  var row = blankUserRow_();
  row[U['Name']] = String(form.name).trim();
  row[U['Username']] = username;
  row[U['Password']] = hash;
  row[U['Email']] = email;
  row[U['Role']] = role;
  row[U['Job Profile']] = String(form.jobProfile || '');
  row[U['Dept']] = String(form.dept || '');
  row[U['Phone']] = String(form.phone || '');
  row[U['Manager']] = String(form.manager || '').trim();
  row[U['Active']] = true;
  row[U['WIP Limit']] = form.wipLimit === '' || form.wipLimit == null ? '' : Number(form.wipLimit);
  row[U['KRAs JSON']] = JSON.stringify(form.kras || []);
  row[U['WhatsApp OptIn']] = !!form.waOptIn;
  ctx.ss.getSheetByName(TAB.USERS).appendRow(row);

  // Global registry entry, so this person can sign in.
  try {
    var g = mkTab_(SpreadsheetApp.openById(CFG().masterId), TAB.GLOBAL,
      ['Email','Password','SheetID','Username']);
    g.appendRow([email, hash, ctx.sheetId, username]);
  } catch (e) { logError_('addUser:global', e.message); }

  try { sendWelcomeStaff_(email, form.name, ctx.company, username); } catch (e) {}
  return { status: 'success', message: form.name + ' added.' };
}

function updateUser_(ctx, form) {
  requireManager_(ctx); blockIfStopped_(ctx);
  form = form || {};
  var target = findUser_(ctx.ss, form.originalUsername || form.username);
  if (!target) throw new Error('That person is not in this workspace.');

  if (target.role === 'Admin' && ctx.actor.role !== 'Admin') {
    throw new Error('Only an Admin can edit another Admin.');
  }
  if (form.role && form.role !== target.role && ctx.actor.role !== 'Admin') {
    throw new Error('Only an Admin can change a role.');
  }

  var sh = ctx.ss.getSheetByName(TAB.USERS);
  var set = function (col, val) { sh.getRange(target.rowIndex, U[col] + 1).setValue(val); };

  if (form.name) set('Name', String(form.name).trim());
  if (form.email) set('Email', String(form.email).trim().toLowerCase());
  if (form.role && ['Admin','HOD','Doer'].indexOf(form.role) > -1) set('Role', form.role);
  if (form.jobProfile !== undefined) set('Job Profile', String(form.jobProfile));
  if (form.dept !== undefined) set('Dept', String(form.dept));
  if (form.phone !== undefined) set('Phone', String(form.phone));
  if (form.manager !== undefined) set('Manager', String(form.manager).trim());
  if (form.wipLimit !== undefined) set('WIP Limit', form.wipLimit === '' || form.wipLimit == null ? '' : Number(form.wipLimit));
  if (form.waOptIn !== undefined) set('WhatsApp OptIn', !!form.waOptIn);

  if (form.kras !== undefined) {
    var v = validateKraBlueprint(form.kras);
    if (!v.ok && (form.kras || []).length) throw new Error(v.error);
    set('KRAs JSON', JSON.stringify(form.kras || []));
  }

  if (form.password) {
    if (String(form.password).length < 8) throw new Error('Password must be at least 8 characters.');
    var hash = makePasswordHash(String(form.password));
    set('Password', hash);
    syncGlobalPassword_(form.email || target.email, ctx.sheetId, hash);
  }

  if (form.active === false) return deactivateUser_(ctx, target, form.reassignTo);
  if (form.active === true) set('Active', true);

  return { status: 'success', message: 'Saved.' };
}

/**
 * Deactivating someone who still holds open work would hide that work from
 * every board — it is still owed, and nobody can see it. So the caller must say
 * where it goes.
 */
function deactivateUser_(ctx, target, reassignTo) {
  var tasks = readTasks_(ctx);
  var stranded = tasks.filter(function (t) { return t.assignee === target.username && isOpen(t.status); });

  if (stranded.length && !reassignTo) {
    return { status: 'needs_reassign', count: stranded.length,
      tasks: stranded.map(function (t) { return { id: t.id, title: t.title, due: t.due }; }),
      message: target.name + ' still has ' + stranded.length + ' open task(s). Choose who takes them.' };
  }
  if (stranded.length) {
    var to = findUser_(ctx.ss, reassignTo);
    if (!to || to.active === false) throw new Error('Pick an active person to take the work.');
    stranded.forEach(function (t) {
      var hit = findTaskRow_(ctx, t.id);
      if (!hit) return;
      writeTaskField_(hit, 'Assigned To', to.username);
      appendHistory_(hit, t.status, ctx.actor.name,
        'Reassigned from ' + target.name + ' on deactivation');
    });
  }
  ctx.ss.getSheetByName(TAB.USERS).getRange(target.rowIndex, U['Active'] + 1).setValue(false);
  return { status: 'success',
    message: target.name + ' deactivated' + (stranded.length ? '; ' + stranded.length + ' task(s) moved.' : '.') };
}

function deleteUser_(ctx, username, reassignTo) {
  requireAdmin_(ctx); blockIfStopped_(ctx);
  var target = findUser_(ctx.ss, username);
  if (!target) throw new Error('That person is not in this workspace.');
  if (target.username === ctx.actor.username) throw new Error('You cannot remove your own account.');

  var admins = readUsers_(ctx).filter(function (u) { return u.role === 'Admin' && u.active !== false; });
  if (target.role === 'Admin' && admins.length <= 1) {
    throw new Error('That is the last Admin. Promote someone else first, or the workspace locks itself out.');
  }

  /* Deactivate rather than delete. Removing the row orphans every task they ever
     touched and silently rewrites history — the audit trail stops making sense. */
  var res = deactivateUser_(ctx, target, reassignTo);
  if (res.status === 'needs_reassign') return res;

  try {
    var g = SpreadsheetApp.openById(CFG().masterId).getSheetByName(TAB.GLOBAL);
    if (g) {
      var d = g.getDataRange().getValues();
      for (var i = d.length - 1; i > 0; i--) {
        if (String(d[i][0]).trim().toLowerCase() === target.email.toLowerCase() &&
            String(d[i][2]).trim() === String(ctx.sheetId)) { g.deleteRow(i + 1); }
      }
    }
  } catch (e) { logError_('deleteUser:global', e.message); }

  return { status: 'success',
    message: target.name + ' can no longer sign in. Their task history is kept.' };
}


// ===========================================================================
// DASHBOARD, SCORING, APPRAISALS, REPORTS
// ===========================================================================

function getDashboard_(ctx) {
  if (ctx.serviceStopped) {
    return { status: 'success', serviceStopped: true,
      usage: { planName: ctx.plan.name || ctx.planName, daysLeft: ctx.daysLeft },
      message: 'Your subscription lapsed more than a week ago. Your data is safe and ' +
               'still here — renew to start writing again.' };
  }

  var tasks = readTasks_(ctx);
  var users = readUsers_(ctx);
  var cal = leaveCalendar_(ctx);
  var me = ctx.actor;

  // What this person is allowed to see.
  var visible = tasks.filter(function (t) {
    if (me.role === 'Admin') return true;
    return t.assignee === me.username || t.by === me.username || t.approver === me.username;
  });
  var active = visible.filter(function (t) { return !t.isArchived; });

  var reports = users.filter(function (u) { return u.manager === me.username; })
                     .map(function (u) { return u.username; });

  var del = delegationScore(tasks.filter(function (t) { return !t.isArchived ||
    inThisMonth_(t); }), me.username, new Date(), cal);

  /* The last appraisal's PERFORMANCE half, paired with today's delegation half.
     An empty cell is not a zero: reading it as one used to halve everybody's
     score the moment they were first appraised. */
  var lastPerf = null;
  var rv = ctx.ss.getSheetByName(TAB.REVIEWS);
  if (rv) {
    var rd = rv.getDataRange().getValues();
    for (var i = rd.length - 1; i > 0; i--) {
      if (String(rd[i][1]) !== me.username) continue;
      var cell = rd[i][2];
      if (cell !== '' && cell !== null && !isNaN(Number(cell))) lastPerf = Number(cell);
      break;
    }
  }
  var halves = [];
  if (lastPerf !== null) halves.push(lastPerf);
  if (del.hasData) halves.push(del.score);
  var finalScore = halves.length
    ? halves.reduce(function (a, b) { return a + b; }, 0) / halves.length : 0;

  var digest = buildDigest(tasks, { username: me.username, name: me.name, role: me.role },
    new Date(), { reports: reports, escalateAfterDays: 3 });

  var usedTasks = tasksCreatedInMonth(tasks, new Date());
  var activeUsers = users.filter(function (u) { return u.active !== false; }).length;

  return {
    status: 'success', serviceStopped: false,
    user: me, company: ctx.company,
    tasks: visible,
    categories: readCategories_(ctx),
    staff: users.map(function (u) {
      return { name: u.name, username: u.username, role: u.role, email: u.email,
               phone: u.phone, manager: u.manager, dept: u.dept, jobProfile: u.jobProfile,
               active: u.active }; }),
    stats: {
      pending:   active.filter(function (t) { return t.status === 'Pending'; }).length,
      progress:  active.filter(function (t) { return t.status === 'In Progress'; }).length,
      review:    active.filter(function (t) { return t.status === 'For Review'; }).length,
      approval:  active.filter(function (t) { return t.status === 'Awaiting Approval' ||
                                                      t.status === 'Delegation Proposed'; }).length,
      completed: active.filter(function (t) { return t.status === 'Verified'; }).length,
      overdue:   active.filter(function (t) { return isOpen(t.status) && t.due &&
                                dayDiff(new Date(), parseYmd(t.due)) > 0; }).length,
      scores: { delegation: del.hasData ? del.score : null,
                performance: lastPerf === null ? null : Math.round(lastPerf),
                final: halves.length ? Math.round(finalScore) : null,
                breakdown: del.breakdown, components: del.components, hasData: del.hasData,
                deduction: del.deduction || 0,
                /* How promptly this person clears what others are waiting on.
                   Null for someone who has never had to approve anything. */
                responsiveness: del.responsiveness && del.responsiveness.hasData ? {
                  score: del.responsiveness.responsiveness,
                  items: del.responsiveness.items,
                  withinSla: del.responsiveness.withinSla,
                  pending: del.responsiveness.pending,
                  overdueNow: del.responsiveness.overdueNow,
                  avgHeldDays: del.responsiveness.avgHeldDays,
                  slaDays: del.responsiveness.slaDays,
                  penalty: del.responsiveness.penalty,
                } : null,
                formula: halves.length === 2
                  ? 'Final = (Performance ' + Math.round(lastPerf) + ' + Delegation ' + del.score + ') / 2'
                  : lastPerf !== null ? 'No closed work yet, so this is the appraisal score alone.'
                  : 'No appraisal yet, so this is the delegation score alone.' },
    },
    notifications: buildNotifications_(digest, me),
    usage: {
      planName: ctx.plan.name || ctx.planName, plan: ctx.planName,
      users: activeUsers, maxUsers: ctx.plan.users,
      tasks: usedTasks, maxTasks: ctx.plan.tasksPerMonth,
      allowReports: ctx.plan.analytics, allowWhatsapp: ctx.plan.whatsapp,
      daysLeft: ctx.daysLeft,
      warnings: planUsage(ctx.planName, activeUsers, usedTasks).warnings,
    },
  };
}

function inThisMonth_(t) {
  var d = closedAt(t) || new Date(t.createdDate);
  if (!d || isNaN(d)) return false;
  var now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

/** The bell. Ordered by urgency, because a list nobody can triage gets ignored. */
function buildNotifications_(digest, me) {
  var out = [];
  var b = digest.buckets || {};
  (b.overdue || []).forEach(function (t) {
    out.push({ type: 'overdue', id: t.id, title: t.title,
      msg: 'Overdue' + (t.daysLate ? ' by ' + t.daysLate + ' day(s)' : ''), due: t.due }); });
  (b.awaitingMyApproval || []).forEach(function (t) {
    out.push({ type: 'approval', id: t.id, title: t.title, msg: 'Waiting for your approval', due: t.due }); });
  (b.awaitingMyReview || []).forEach(function (t) {
    out.push({ type: 'review', id: t.id, title: t.title, msg: 'Ready for your review', due: t.due }); });
  (b.dueToday || []).forEach(function (t) {
    out.push({ type: 'today', id: t.id, title: t.title, msg: 'Due today', due: t.due }); });
  (b.teamOverdue || []).forEach(function (t) {
    out.push({ type: 'team', id: t.id, title: t.title, msg: 'Your report is overdue on this', due: t.due }); });
  return out;
}

/* ---------- analytics ---------------------------------------------------- */

function getAnalytics_(ctx, period, offset, span, person) {
  if (!ctx.plan.analytics) {
    return { status: 'error', upgrade: true,
      message: 'Reports are included from the Pro plan up.' };
  }
  var tasks = readTasks_(ctx);
  var users = readUsers_(ctx).filter(function (u) { return u.active !== false; });
  var cal = leaveCalendar_(ctx);

  var kind = ['week','month','quarter','year'].indexOf(period) > -1 ? period : 'month';
  var off = Number(offset || 0);
  var count = Number(span || 12);

  var range = periodRange(kind, off);
  var a = periodAnalytics(tasks, users, range, new Date(), cal);

  var trend = [];
  for (var i = count - 1 + off; i >= off; i--) {
    var r = periodRange(kind, i);
    var p = periodAnalytics(tasks, users, r, new Date(), cal);
    trend.push({ label: r.short, full: r.label, teamScore: p.teamScore, delivered: p.delivered });
  }

  var personTrend = person
    ? scoreTrend(tasks, person, kind, count, null, off, cal).map(function (x) {
        return { label: x.short, score: x.score, delivered: x.delivered }; })
    : null;

  // 20-week delivery heatmap
  var weeks = [];
  for (var w = 19; w >= 0; w--) weeks.push(periodRange('week', w));
  var heat = users.map(function (u) {
    return { name: u.name, username: u.username, values: weeks.map(function (wk) {
      return tasks.filter(function (t) { return t.assignee === u.username &&
        t.status === 'Verified' && inWindow(closedAt(t), wk); }).length; }) };
  });

  return { status: 'success', range: a.range, summary: {
      delivered: a.delivered, overdueNow: a.overdueNow, reworkLoops: a.reworkLoops,
      onTimeRate: a.onTimeRate, teamScore: a.teamScore },
    people: a.people, kra: a.kra, bands: a.bands,
    trend: trend, personTrend: personTrend,
    heatmap: { weeks: weeks.map(function (w) { return w.short; }), rows: heat } };
}

function getAccountability_(ctx) {
  if (!ctx.plan.analytics) return { status: 'error', upgrade: true,
    message: 'Reports are included from the Pro plan up.' };
  var tasks = readTasks_(ctx);
  var byUser = {};
  tasks.forEach(function (t) {
    if (!t.assignee) return;
    var s = byUser[t.assignee] = byUser[t.assignee] || { total: 0, reworks: 0, late: 0 };
    s.total++; s.reworks += Number(t.reworkCount || 0);
    var sub = submittedAt(t), due = parseYmd(t.due);
    if (sub && due && dayDiff(sub, due) > 0) s.late++;
  });
  var names = {};
  readUsers_(ctx).forEach(function (u) { names[u.username] = u.name; });

  /* The other half of accountability: who is holding the work up. Measured for
     everyone who has ever had something waiting on their decision, so a manager
     cannot be absent from the report simply by owning no tasks. */
  var cal = leaveCalendar_(ctx), now = new Date();
  var holders = {};
  tasks.forEach(function (t) {
    queueSpells(t).forEach(function (sp) { if (sp.holder) holders[sp.holder] = true; });
  });
  var queue = Object.keys(holders).map(function (k) {
    var r = responsivenessStats(tasks, k, now, cal);
    return { username: k, name: names[k] || k, items: r.items, withinSla: r.withinSla,
             pending: r.pending, overdueNow: r.overdueNow, avgHeldDays: r.avgHeldDays,
             slaDays: r.slaDays, penalty: r.penalty, score: r.responsiveness };
  }).filter(function (r) { return r.items > 0; })
    .sort(function (a, b) { return (a.score - b.score) || (b.overdueNow - a.overdueNow); });

  return { status: 'success', queue: queue, report: Object.keys(byUser).map(function (k) {
    var s = byUser[k];
    return { username: k, name: names[k] || k, total: s.total, reworkCount: s.reworks,
             lateCount: s.late,
             pct: s.total ? Math.round(s.reworks / s.total * 100) : 0 };
  }).sort(function (a, b) { return b.pct - a.pct; }) };
}

function getPerformanceReport_(ctx) {
  var sh = ctx.ss.getSheetByName(TAB.REVIEWS);
  if (!sh) return { status: 'success', report: [] };
  var d = sh.getDataRange().getValues();
  var names = {};
  readUsers_(ctx).forEach(function (u) { names[u.username] = u.name; });
  var out = [];
  for (var i = 1; i < d.length; i++) {
    if (!d[i][1]) continue;
    out.push({ month: d[i][0], username: d[i][1], name: names[d[i][1]] || d[i][1],
      performance: Number(d[i][2]) || 0, delegation: Number(d[i][3]) || 0,
      score: Number(d[i][4]) || 0, date: toYmd_(d[i][5]),
      band: performanceBand(Number(d[i][4]) || 0).band });
  }
  return { status: 'success', report: out.reverse() };
}

/* ---------- appraisals --------------------------------------------------- */

function getAppraisalForm_(ctx, username) {
  requireManager_(ctx);
  var u = findUser_(ctx.ss, username);
  if (!u) throw new Error('That person is not in this workspace.');

  var tasks = readTasks_(ctx);
  var cal = leaveCalendar_(ctx);
  var del = delegationScore(tasks, username, new Date(), cal);

  // Their own set first, else whatever their job profile defines.
  var kras = (u.kras || []).map(normKra_).filter(function (k) { return k.item; });
  if (!kras.length) kras = readProfileMaster_(ctx, u.jobProfile);

  return { status: 'success', employee: { username: u.username, name: u.name,
      jobProfile: u.jobProfile, dept: u.dept },
    delegationScore: del.score, delegationBreakdown: del.breakdown, hasData: del.hasData,
    kras: kras,
    behaviors: [
      { section: 'Collaboration', question: 'Actively contributes in team discussions', weight: 1 },
      { section: 'Accountability', question: 'Meets commitments without chasing', weight: 2 },
      { section: 'Initiative',     question: 'Raises problems early rather than late', weight: 2 },
      { section: 'Attendance',     question: 'Attendance and punctuality', weight: 1 },
    ],
    weights: APPRAISAL_WEIGHTS };
}

function submitAppraisal_(ctx, data) {
  requireManager_(ctx); blockIfStopped_(ctx);
  data = data || {};
  if (!data.employee) throw new Error('Pick who this appraisal is for.');

  /* The delegation half is re-measured here rather than taken from the request:
     the browser sent it, and a score an employee can edit in devtools is not a
     score. */
  var tasks = readTasks_(ctx);
  var measured = delegationScore(tasks, data.employee, new Date(), leaveCalendar_(ctx));

  var result = finalAppraisalScore({
    delegationScore: measured.hasData ? measured.score : null,
    hasDelegationData: measured.hasData,
    kras: (data.kras || []).map(function (k) {
      return { rating: Number(k.rating) || 0, weight: Number(k.weight) || 1 }; }),
    behaviours: (data.behaviors || []).map(function (b) {
      return { rating: Number(b.rating) || 0, weight: Number(b.weight) || 1 }; }),
    brownie: Number(data.brownie) || 0,
  });
  if (!result.hasData) throw new Error('Rate at least one KRA or behaviour before saving.');

  var month = new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  mkTab_(ctx.ss, TAB.REVIEWS, ['Month','Employee','Performance Score','Delegation Score','Final Score','Date'])
    .appendRow([month, data.employee,
      result.performance === null ? '' : result.performance,
      result.delegation === null ? '' : result.delegation,
      result.score, new Date()]);

  return { status: 'success', score: result.score, band: performanceBand(result.score),
    performance: result.performance, delegation: result.delegation,
    parts: result.parts, formula: result.formula,
    message: 'Appraisal saved: ' + result.score + ' (' + performanceBand(result.score).band + ').' };
}

/* addKRA_ lived here and wrote a title and a weight. It is replaced by saveKra_
   in the KRA/KPI module, which carries a measurable target as well. The addKRA
   route still resolves, so nothing calling it breaks. */



// ===========================================================================
// PAYMENTS, AI, EMAIL
// ===========================================================================

function createRazorpayOrder_(ctx, planName, promoCode) {
  requireAdmin_(ctx);
  var c = CFG();
  if (!c.razorKey || !c.razorSecret) throw new Error('Online payment is not configured yet.');

  var plan = PLANS[normalizePlan(planName)];
  if (!plan) throw new Error('Unknown plan.');
  if (!plan.price) throw new Error(plan.name + ' is not sold online — contact sales.');

  /* The amount is decided here, from the plan table. The old build let the
     client send an amount, and honoured a promo string from the request, so
     anyone who knew it paid 1 rupee for the yearly plan. */
  var amount = plan.price * 100;
  var promo = promoCodeDiscount_(String(promoCode || '').trim());
  if (promo) {
    amount = Math.max(100, Math.round(amount * (100 - promo.percent) / 100));
    logPayment_('PROMO', ctx.sheetId, promo.code + ' -' + promo.percent + '%');
  }

  var res = UrlFetchApp.fetch('https://api.razorpay.com/v1/orders', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(c.razorKey + ':' + c.razorSecret) },
    payload: JSON.stringify({ amount: amount, currency: 'INR',
      receipt: 'dbx_' + Date.now(),
      notes: { plan: normalizePlan(planName), sheetId: ctx.sheetId, company: ctx.company } }),
    muteHttpExceptions: true });

  if (res.getResponseCode() >= 300) {
    logError_('razorpay:order', res.getContentText().slice(0, 300));
    throw new Error('We could not start the payment. Please try again.');
  }
  var order = JSON.parse(res.getContentText());
  return { status: 'success', orderData: { key: c.razorKey, order_id: order.id,
    amount: order.amount, currency: 'INR', name: 'Dome Box',
    description: plan.name, prefill: { email: ctx.me.email, contact: ctx.me.phone || '' } } };
}

/** Promo codes live in Script Properties as JSON, not in the source. */
function promoCodeDiscount_(code) {
  if (!code) return null;
  var raw = PropertiesService.getScriptProperties().getProperty('PROMO_CODES');
  if (!raw) return null;
  var map = {};
  try { map = JSON.parse(raw); } catch (e) { return null; }
  var pct = Number(map[code.toUpperCase()] || map[code] || 0);
  if (!pct || pct <= 0 || pct > 100) return null;
  return { code: code, percent: pct };
}

function handleVerifiedPayment_(ctx, p) {
  var c = CFG();
  var expected = hex_(Utilities.computeHmacSha256Signature(
    String(p.razorpay_order_id) + '|' + String(p.razorpay_payment_id), c.razorSecret));

  if (!p.razorpay_signature || !eqConst_(expected, p.razorpay_signature)) {
    logPayment_('REJECTED', ctx.sheetId, 'bad signature — nothing granted');
    throw new Error('That payment could not be verified. If money has left your account, ' +
      'email ' + c.mailFrom + ' and we will sort it out.');
  }

  // Confirm with Razorpay directly, so a captured signature cannot be replayed.
  var paid = null;
  try {
    var r = UrlFetchApp.fetch('https://api.razorpay.com/v1/payments/' +
      encodeURIComponent(p.razorpay_payment_id), {
      headers: { Authorization: 'Basic ' + Utilities.base64Encode(c.razorKey + ':' + c.razorSecret) },
      muteHttpExceptions: true });
    if (r.getResponseCode() === 200) paid = JSON.parse(r.getContentText());
  } catch (e) { logError_('razorpay:fetch', e.message); }

  if (!paid || paid.status !== 'captured') {
    logPayment_('NOT_CAPTURED', ctx.sheetId, p.razorpay_payment_id + ' = ' + (paid && paid.status));
    throw new Error('That payment has not completed yet.');
  }

  var planName = (paid.notes && paid.notes.plan) || planForPaise_(paid.amount);
  if (!planName) {
    logPayment_('UNKNOWN_AMOUNT', ctx.sheetId, paid.amount + ' paise');
    throw new Error('We could not match that amount to a plan. Please contact support.');
  }

  var until = grantPlan_(ctx.sheetId, planName, paid, ctx.company);
  logPayment_('GRANTED', ctx.sheetId, planName + ' until ' + until + ' via ' + paid.id);
  return { status: 'success', plan: planName, validUntil: until,
    message: 'Upgraded to ' + (PLANS[planName] ? PLANS[planName].name : planName) + '.' };
}

function planForPaise_(paise) {
  for (var k in PLANS) if (PLANS[k].price && PLANS[k].price * 100 === Number(paise)) return k;
  return null;
}

/** Extends from the current expiry when it is still ahead, so renewing early
 *  adds time instead of discarding what is left. */
function grantPlan_(sheetId, planName, paid, company) {
  var dir = SpreadsheetApp.openById(CFG().masterId).getSheetByName(TAB.DIRECTORY);
  var d = dir.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][5]).trim() !== String(sheetId).trim()) continue;
    var cur = new Date(d[i][4]);
    var base = (!isNaN(cur) && cur > new Date()) ? cur : new Date();
    base.setDate(base.getDate() + (planName === 'Yearly' ? 365 : 30));
    var until = ymd(base);
    dir.getRange(i + 1, 4).setValue(planName);
    dir.getRange(i + 1, 5).setValue(until);
    dir.getRange(i + 1, 7).setValue('Active');
    try { sendEmail_(d[i][1], 'Dome Box — payment receipt',
      receiptHtml_(company || d[i][0], planName, paid, until)); } catch (e) {}
    return until;
  }
  throw new Error('That workspace is not in the registry.');
}

function hex_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += ('0' + (bytes[i] & 0xFF).toString(16)).slice(-2);
  return s;
}
function eqConst_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function logPayment_(kind, sheetId, message) {
  try {
    var ss = SpreadsheetApp.openById(CFG().masterId);
    var sh = ss.getSheetByName('PaymentLog');
    if (!sh) { sh = ss.insertSheet('PaymentLog'); sh.appendRow(['when','kind','sheetId','message']); sh.setFrozenRows(1); }
    sh.appendRow([new Date(), kind, sheetId, message]);
  } catch (e) { Logger.log(kind + ' ' + message); }
}

/* ---------- AI insight --------------------------------------------------- */

/**
 * "Executive AI Intel". The model is given a SUMMARY, never raw staff records:
 * sending a customer's employee data to a third-party API is a disclosure they
 * did not agree to, and it is not needed to answer the question.
 */
function aiInsight_(ctx, question) {
  if (!ctx.plan.analytics) return { status: 'error', upgrade: true,
    message: 'AI insights are included from the Pro plan up.' };

  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_KEY');
  if (!key) throw new Error('AI insights are not configured yet.');

  var tasks = readTasks_(ctx);
  var users = readUsers_(ctx).filter(function (u) { return u.active !== false; });
  var cal = leaveCalendar_(ctx);
  var a = periodAnalytics(tasks, users, periodRange('month', 1), new Date(), cal);

  var facts = [
    'Company: ' + (ctx.company || 'this company'),
    'Period: ' + a.range.label,
    'Tasks delivered: ' + a.delivered,
    'On-time rate: ' + (a.onTimeRate === null ? 'no data' : a.onTimeRate + '%'),
    'Rework loops: ' + a.reworkLoops,
    'Currently overdue: ' + a.overdueNow,
    'Team score: ' + (a.teamScore === null ? 'no data' : a.teamScore),
    'Performance bands: A=' + a.bands.A + ' B=' + a.bands.B + ' C=' + a.bands.C +
      ' no-data=' + a.bands.none,
    'Work by KRA: ' + a.kra.slice(0, 8).map(function (k) { return k.kra + '=' + k.count; }).join(', '),
    'Per person (anonymised): ' + a.people.map(function (p, i) {
      return 'P' + (i + 1) + ' score=' + (p.score === null ? 'n/a' : p.score) +
             ' delivered=' + p.delivered; }).join('; '),
  ].join('\n');

  var prompt = 'You are an operations analyst for an Indian manufacturing SME. ' +
    'Using ONLY the figures below, answer the manager\'s question in at most 150 words. ' +
    'Be concrete and practical. If the figures do not support an answer, say so plainly ' +
    'rather than speculating.\n\nFIGURES:\n' + facts +
    '\n\nQUESTION: ' + String(question || 'What should I focus on this month?');

  try {
    var res = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' +
      encodeURIComponent(key),
      { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
    if (res.getResponseCode() >= 300) throw new Error('HTTP ' + res.getResponseCode());
    var j = JSON.parse(res.getContentText());
    var text = j && j.candidates && j.candidates[0] && j.candidates[0].content &&
               j.candidates[0].content.parts && j.candidates[0].content.parts[0].text;
    if (!text) throw new Error('empty response');
    return { status: 'success', answer: String(text).trim(), basedOn: a.range.label };
  } catch (e) {
    logError_('aiInsight', e.message);
    throw new Error('The AI service did not respond. Please try again shortly.');
  }
}

/* ---------- email -------------------------------------------------------- */

function sendEmail_(to, subject, html) {
  if (!to) return false;
  var from = CFG().mailFrom;
  try {
    GmailApp.sendEmail(String(to).trim(), subject,
      'This email needs an HTML-capable client.',
      { htmlBody: html, name: 'Dome Box', from: from });
    return true;
  } catch (e) {
    /* GmailApp throws if `from` is not a verified alias on the sending account.
       MailApp ignores `from` and sends as the script owner, which is worse than
       nothing silently — so this is logged. */
    logError_('sendEmail:gmail', e.message + ' (is ' + from + ' a verified alias?)');
    try {
      MailApp.sendEmail({ to: String(to).trim(), subject: subject,
        body: 'This email needs an HTML-capable client.', htmlBody: html, name: 'Dome Box' });
      return true;
    } catch (e2) { logError_('sendEmail:mailapp', e2.message); return false; }
  }
}

function mailShell_(title, inner) {
  return '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;' +
    'max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">' +
    '<div style="background:#1e3a8a;color:#fff;padding:20px 24px">' +
    '<h2 style="margin:0;font-size:18px">' + esc_(title) + '</h2></div>' +
    '<div style="padding:24px;color:#374151;font-size:14px;line-height:1.6">' + inner + '</div>' +
    '<div style="padding:16px 24px;background:#f9fafb;color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb">' +
    'Dome Box · BISCS India · <a href="' + CFG().siteUrl + '" style="color:#2563eb">' +
    esc_(CFG().siteUrl.replace(/^https?:\/\//, '')) + '</a></div></div>';
}

function btn_(label, href) {
  return '<p style="text-align:center;margin:28px 0"><a href="' + esc_(href) + '" ' +
    'style="background:#2563eb;color:#fff;padding:12px 26px;text-decoration:none;' +
    'border-radius:8px;font-weight:bold;display:inline-block">' + esc_(label) + '</a></p>';
}

/* Every value interpolated below is escaped. The old build built these strings
   raw, so a task title containing markup was injected into the email. */
function notifyAssignment_(ctx, target, approver, title, due, id, status) {
  if (status === 'Awaiting Approval' && approver && approver.email) {
    sendEmail_(approver.email, 'Approval needed: ' + title,
      mailShell_('Task approval required',
        '<p>Hi <strong>' + esc_(approver.name) + '</strong>,</p>' +
        '<p><strong>' + esc_(ctx.actor.name) + '</strong> wants to assign a task to ' +
        '<strong>' + esc_(target.name) + '</strong>, who reports to you.</p>' +
        infoTable_([['Task', title], ['Due', due || '—'], ['Ref', id]]) +
        btn_('Review it', CFG().siteUrl)));
  } else if (target.email) {
    sendEmail_(target.email, 'New task: ' + title,
      mailShell_('New task assigned',
        '<p>Hi <strong>' + esc_(target.name) + '</strong>,</p>' +
        '<p><strong>' + esc_(ctx.actor.name) + '</strong> has assigned you a task.</p>' +
        infoTable_([['Task', title], ['Due', due || '—'], ['Ref', id]]) +
        btn_('Open Dome Box', CFG().siteUrl)));
  }
}

function notifyStatus_(ctx, t, status, note) {
  var who = null, subject = '', line = '';
  if (status === 'For Review') {
    who = findUser_(ctx.ss, t.by); subject = 'Ready for review: ' + t.title;
    line = '<strong>' + esc_(ctx.actor.name) + '</strong> has handed in this task.';
  } else if (status === 'In Progress' && t.status === 'For Review') {
    who = findUser_(ctx.ss, t.assignee); subject = 'Sent back: ' + t.title;
    line = '<strong>' + esc_(ctx.actor.name) + '</strong> has returned this for rework.';
  } else if (status === 'Verified') {
    who = findUser_(ctx.ss, t.assignee); subject = 'Verified: ' + t.title;
    line = '<strong>' + esc_(ctx.actor.name) + '</strong> has signed this off. Nice work.';
  }
  if (!who || !who.email) return;
  sendEmail_(who.email, subject, mailShell_(subject,
    '<p>Hi <strong>' + esc_(who.name) + '</strong>,</p><p>' + line + '</p>' +
    infoTable_([['Task', t.title], ['Due', t.due || '—']]) +
    (note ? '<p style="background:#fffbeb;border:1px solid #fde68a;padding:12px;border-radius:8px">' +
      '<em>"' + esc_(note) + '"</em></p>' : '') +
    btn_('Open Dome Box', CFG().siteUrl)));
}

/** The raiser hears the outcome, with the reason if it was refused. */
function notifyDecision_(ctx, t, isApproved, remarks) {
  var raiser = findUser_(ctx.ss, t.by);
  if (isApproved) {
    var owner = findUser_(ctx.ss, t.assignee);
    if (owner && owner.email) {
      sendEmail_(owner.email, 'New task: ' + t.title, mailShell_('A task has been approved for you',
        '<p>Hi <strong>' + esc_(owner.name) + '</strong>,</p>' +
        '<p><strong>' + esc_(ctx.actor.name) + '</strong> has approved this, so it is on your list now.</p>' +
        infoTable_([['Task', t.title], ['Due', t.due || '—'], ['Raised by', nameOf_(ctx, t.by)]]) +
        btn_('Open Dome Box', CFG().siteUrl)));
    }
  }
  if (!raiser || !raiser.email) return;
  sendEmail_(raiser.email,
    (isApproved ? 'Approved: ' : 'Rejected: ') + t.title,
    mailShell_(isApproved ? 'Your task was approved' : 'Your task was rejected',
      '<p>Hi <strong>' + esc_(raiser.name) + '</strong>,</p>' +
      '<p><strong>' + esc_(ctx.actor.name) + '</strong> has ' +
      (isApproved ? 'approved the task you raised for ' : 'rejected the task you raised for ') +
      '<strong>' + esc_(nameOf_(ctx, t.assignee)) + '</strong>.</p>' +
      infoTable_([['Task', t.title], ['Due', t.due || '—']]) +
      (remarks ? '<p style="background:#fef2f2;border:1px solid #fecaca;padding:12px;border-radius:8px">' +
        '<strong>Remark:</strong> ' + esc_(remarks) + '</p>' : '') +
      btn_('Open Dome Box', CFG().siteUrl)));
}

function infoTable_(rows) {
  return '<table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f9fafb;border-radius:8px">' +
    rows.map(function (r) {
      return '<tr><td style="padding:10px 14px;color:#6b7280;width:35%">' + esc_(r[0]) +
             '</td><td style="padding:10px 14px;font-weight:bold">' + esc_(r[1]) + '</td></tr>';
    }).join('') + '</table>';
}

function resetEmailHtml_(link) {
  return mailShell_('Reset your password',
    '<p>We received a request to reset your Dome Box password.</p>' +
    btn_('Set a new password', link) +
    '<p style="font-size:12px;color:#6b7280">This link works once and expires in one hour. ' +
    'If you did not ask for it, you can ignore this email — nothing has changed.</p>');
}

function sendWelcome_(email, name, company) {
  sendEmail_(email, 'Welcome to Dome Box', mailShell_('Your workspace is ready',
    '<p>Hi <strong>' + esc_(name) + '</strong>,</p>' +
    '<p><strong>' + esc_(company) + '</strong> is set up on Dome Box. You are on the Free plan ' +
    '— up to 5 people and 50 tasks a month, with 30 days to try everything.</p>' +
    '<p>Add your team first, then assign the first task.</p>' + btn_('Open Dome Box', CFG().siteUrl)));
}

function sendWelcomeStaff_(email, name, company, username) {
  sendEmail_(email, 'You have been added to Dome Box', mailShell_('Welcome to the team',
    '<p>Hi <strong>' + esc_(name) + '</strong>,</p>' +
    '<p>You have been added to <strong>' + esc_(company) + '</strong> on Dome Box.</p>' +
    infoTable_([['Sign in with', email], ['Username', username]]) +
    '<p>Your manager has set your password. Change it after your first sign-in.</p>' +
    btn_('Sign in', CFG().siteUrl)));
}

function receiptHtml_(company, planName, paid, until) {
  var plan = PLANS[planName] || { name: planName };
  return mailShell_('Payment receipt',
    '<p>Hi <strong>' + esc_(company) + '</strong>,</p><p>Your workspace has been upgraded.</p>' +
    infoTable_([['Plan', plan.name],
      ['Amount paid', '₹' + (Number(paid.amount) / 100).toLocaleString('en-IN')],
      ['Payment ID', paid.id], ['Valid until', until]]) +
    '<p style="font-size:12px;color:#6b7280">A GST invoice follows separately.</p>');
}

function contactSales_(form) {
  form = form || {};
  sendEmail_(CFG().mailFrom, 'Enterprise enquiry — ' + String(form.companyName || 'unknown'),
    mailShell_('New enterprise enquiry', infoTable_([
      ['Name', form.name || ''], ['Company', form.companyName || ''],
      ['Email', form.email || ''], ['Phone', form.phone || '']]) +
      '<p>' + esc_(form.message || '') + '</p>'));
  return { status: 'success', message: 'Thanks — we will be in touch within one working day.' };
}

function contactSupport_(ctx, form) {
  form = form || {};
  sendEmail_(CFG().mailFrom, 'Support — ' + String(form.subject || 'request'),
    mailShell_('Support request', infoTable_([
      ['From', ctx.actor.name], ['Email', ctx.me.email], ['Role', ctx.actor.role],
      ['Company', ctx.company], ['Plan', ctx.planName]]) +
      '<p>' + esc_(form.message || '') + '</p>'));
  return { status: 'success', message: 'Sent. We reply within one working day.' };
}

function handleRazorpayWebhook_(e, body) {
  /* The browser handler is not a source of truth: a customer who closes the tab
     mid-payment is charged and stays on Free. This fires from Razorpay. */
  try {
    var secret = PropertiesService.getScriptProperties().getProperty('RAZORPAY_WEBHOOK_SECRET');
    if (!secret) return json_({ status: 'ignored' });
    var raw = e.postData.contents;
    var sig = (e.parameter && e.parameter['x-razorpay-signature']) || '';
    var expected = hex_(Utilities.computeHmacSha256Signature(raw, secret));
    if (!eqConst_(expected, sig)) { logPayment_('WEBHOOK_REJECTED', '', 'bad signature'); return json_({ status: 'ignored' }); }

    var ent = ((body.payload || {}).payment || {}).entity || {};
    if (body.event === 'payment.captured' && ent.notes && ent.notes.sheetId) {
      var plan = ent.notes.plan || planForPaise_(ent.amount);
      if (plan) { grantPlan_(ent.notes.sheetId, plan, ent, ent.notes.company);
                  logPayment_('WEBHOOK_GRANTED', ent.notes.sheetId, plan); }
    }
  } catch (err) { logError_('webhook', err.message); }
  return json_({ status: 'ok' });
}


// =========================================================================
// KRA / KPI
// =========================================================================
// ===========================================================================
// KRA / KPI
// ===========================================================================
//
// A KRA is the area someone is answerable for. A KPI is the number that says
// whether they are meeting it. The old build stored only a title and a weight,
// which makes an appraisal a matter of opinion — "did you do well on Vendor
// Quality?" has no answer without a target. Each row now carries a measurable
// target, its unit, and which direction is good, so two managers rating the
// same person reach the same conclusion.
//
// KRA_MASTER_COLS is the old sheet plus appended columns. Existing rows keep
// working; nothing is rewritten.
// ===========================================================================

var KRA_MASTER_COLS = ['Job Profile','KRA Title','Description','Weight','Grid/KPI',
                       'KPI Target','Unit','Direction','How Measured'];

var KPI_UNITS = ['%','days','hours','count','₹','ratio','score'];
var KPI_DIRECTIONS = ['higher is better','lower is better','on target'];

/** One row, normalised. Accepts the old shape so nothing already saved is lost. */
function normKra_(k) {
  k = k || {};
  var dir = String(k.direction || '').toLowerCase();
  if (KPI_DIRECTIONS.indexOf(dir) < 0) dir = 'higher is better';
  return {
    item:      String(k.item || k.name || '').trim(),
    desc:      String(k.desc || k.description || '').trim(),
    weight:    Math.max(0, Number(k.weight) || 0),
    target:    k.target === '' || k.target == null ? '' : String(k.target).trim(),
    unit:      KPI_UNITS.indexOf(String(k.unit || '')) > -1 ? String(k.unit) : '',
    direction: dir,
    measured:  String(k.measured || k.howMeasured || '').trim(),
    grid:      String(k.grid || '').trim(),     // kept so old rows survive a round trip
  };
}

/**
 * Who has a usable KRA set and who does not. The point is to make the gap
 * visible: a workspace where half the team has no KRAs produces appraisals that
 * look rigorous and are not.
 */
function getKraOverview_(ctx) {
  requireManager_(ctx);
  var users = readUsers_(ctx).filter(function (u) { return u.active !== false; });
  var profiles = {};

  var rows = users.map(function (u) {
    var kras = (u.kras || []).map(normKra_).filter(function (k) { return k.item; });
    var total = kras.reduce(function (s, k) { return s + k.weight; }, 0);
    var withTarget = kras.filter(function (k) { return k.target !== ''; }).length;
    if (u.jobProfile) (profiles[u.jobProfile] = profiles[u.jobProfile] || []).push(u.username);

    /* A missing KPI target is NOT an incomplete set. Plenty of real KRAs — keep
       the plant audit-ready, hold the team together — are judged rather than
       counted, and flagging those as a defect would push managers into inventing
       numbers to clear a warning. The count of targets is reported separately so
       the fact stays visible without being an accusation. */
    var state = !kras.length ? 'missing'
              : total > 100 ? 'over'
              : total < 100 ? 'partial'
              : 'complete';
    return { username:u.username, name:u.name, role:u.role, dept:u.dept,
             jobProfile:u.jobProfile || '', count:kras.length, totalWeight:total,
             withTarget:withTarget, state:state, kras:kras };
  });

  return { status:'success', people: rows,
    profiles: Object.keys(profiles).map(function (p) {
      return { profile:p, people:profiles[p].length }; }),
    units: KPI_UNITS, directions: KPI_DIRECTIONS,
    summary: {
      total: rows.length,
      complete: rows.filter(function (r) { return r.state === 'complete'; }).length,
      missing: rows.filter(function (r) { return r.state === 'missing'; }).length,
      partial: rows.filter(function (r) { return r.state === 'partial' || r.state === 'over'; }).length,
      withoutTargets: rows.filter(function (r) { return r.count && r.withTarget < r.count; }).length,
    } };
}

/** Saves one person's set. Replaces addKRA_ and keeps its route working. */
function saveKra_(ctx, data) {
  requireManager_(ctx); blockIfStopped_(ctx);
  data = data || {};
  var u = findUser_(ctx.ss, data.employee);
  if (!u) throw new Error('That person is not in this workspace.');
  if (u.role === 'Admin' && ctx.actor.role !== 'Admin') {
    throw new Error('Only an Admin can set another Admin\'s KRAs.');
  }

  var rows = (data.kras || []).map(normKra_).filter(function (k) { return k.item; });
  var v = validateKraBlueprint(rows);
  if (!v.ok) throw new Error(v.error);

  var dupes = {};
  for (var i = 0; i < rows.length; i++) {
    var key = rows[i].item.toLowerCase();
    if (dupes[key]) throw new Error('"' + rows[i].item + '" is listed twice.');
    dupes[key] = true;
  }

  setUserField_(ctx.ss, u.rowIndex, 'KRAs JSON', JSON.stringify(rows));

  /* Writing the job-profile standard is OPT-IN. It used to happen on every save,
     so tailoring one person's KRAs quietly redefined the standard for everyone
     holding that job title — and the next person to inherit it got whatever the
     last editor happened to type. */
  if (u.jobProfile && data.alsoProfile === true) writeProfileMaster_(ctx, u.jobProfile, rows);

  return { status:'success', total:v.total, warning:v.warning || '',
    withoutTarget: rows.filter(function (k) { return k.target === ''; }).length,
    savedAsProfileStandard: u.jobProfile && data.alsoProfile === true ? u.jobProfile : null,
    message: 'Saved ' + rows.length + ' KRA(s) for ' + u.name + ', ' + v.total + '% allocated.' +
      (u.jobProfile && data.alsoProfile === true
        ? ' Also saved as the standard for "' + u.jobProfile + '".' : '') };
}

/** The job-profile master, so the next person hired into the role inherits it. */
function writeProfileMaster_(ctx, profile, rows) {
  var sh = mkTab_(ctx.ss, TAB.KRA, KRA_MASTER_COLS);
  widen_(sh, KRA_MASTER_COLS);
  var d = sh.getDataRange().getValues();
  for (var i = d.length - 1; i > 0; i--) {
    if (String(d[i][0]).trim().toLowerCase() === String(profile).trim().toLowerCase()) sh.deleteRow(i + 1);
  }
  if (!rows.length) return;
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, KRA_MASTER_COLS.length)
    .setValues(rows.map(function (k) {
      return [profile, k.item, k.desc, k.weight, k.grid, k.target, k.unit, k.direction, k.measured]; }));
}

function readProfileMaster_(ctx, profile) {
  var sh = ctx.ss.getSheetByName(TAB.KRA);
  if (!sh) return [];
  var d = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][0]).trim().toLowerCase() !== String(profile).trim().toLowerCase()) continue;
    if (!d[i][1]) continue;
    out.push(normKra_({ item:d[i][1], desc:d[i][2], weight:d[i][3], grid:d[i][4],
                        target:d[i][5], unit:d[i][6], direction:d[i][7], measured:d[i][8] }));
  }
  return out;
}

/** What to prefill the editor with: their own set, else their profile's. */
function getKraFor_(ctx, username) {
  requireManager_(ctx);
  var u = findUser_(ctx.ss, username);
  if (!u) throw new Error('That person is not in this workspace.');
  var own = (u.kras || []).map(normKra_).filter(function (k) { return k.item; });
  var fromProfile = own.length ? [] : readProfileMaster_(ctx, u.jobProfile);
  return { status:'success',
    employee: { username:u.username, name:u.name, jobProfile:u.jobProfile || '', dept:u.dept, role:u.role },
    kras: own.length ? own : fromProfile,
    inheritedFromProfile: !own.length && fromProfile.length > 0,
    units: KPI_UNITS, directions: KPI_DIRECTIONS };
}

/** Copies one person's set onto another. */
function copyKraFrom_(ctx, fromUsername, toUsername) {
  requireManager_(ctx); blockIfStopped_(ctx);
  var from = findUser_(ctx.ss, fromUsername), to = findUser_(ctx.ss, toUsername);
  if (!from || !to) throw new Error('One of those people is not in this workspace.');
  var rows = (from.kras || []).map(normKra_).filter(function (k) { return k.item; });
  if (!rows.length) throw new Error(from.name + ' has no KRAs to copy.');
  setUserField_(ctx.ss, to.rowIndex, 'KRAs JSON', JSON.stringify(rows));
  return { status:'success', count: rows.length,
    message: 'Copied ' + rows.length + ' KRA(s) from ' + from.name + ' to ' + to.name + '.' };
}

/**
 * Applies a profile's set to everyone holding that profile. Only fills people
 * who have none unless overwrite is explicitly asked for — quietly replacing a
 * manager's tailored set with a generic one is how trust in the tool is lost.
 */
function applyKraToProfile_(ctx, profile, overwrite) {
  requireManager_(ctx); blockIfStopped_(ctx);
  if (!profile) throw new Error('Pick a job profile.');
  var rows = readProfileMaster_(ctx, profile);
  if (!rows.length) throw new Error('No KRA set is saved for "' + profile + '" yet.');

  var users = readUsers_(ctx).filter(function (u) {
    return u.active !== false &&
           String(u.jobProfile || '').trim().toLowerCase() === String(profile).trim().toLowerCase(); });
  if (!users.length) throw new Error('Nobody holds the profile "' + profile + '".');

  var applied = 0, skipped = [];
  users.forEach(function (u) {
    var own = (u.kras || []).filter(function (k) { return k && (k.item || k.name); });
    if (own.length && !overwrite) { skipped.push(u.name); return; }
    setUserField_(ctx.ss, u.rowIndex, 'KRAs JSON', JSON.stringify(rows));
    applied++;
  });

  return { status:'success', applied:applied, skipped:skipped,
    message: applied + ' of ' + users.length + ' updated' +
      (skipped.length ? '. Left alone, because they already have their own: ' + skipped.join(', ') : '.') };
}

/** Removes a person's set without touching the profile master. */
function clearKra_(ctx, username) {
  requireManager_(ctx); blockIfStopped_(ctx);
  var u = findUser_(ctx.ss, username);
  if (!u) throw new Error('That person is not in this workspace.');
  setUserField_(ctx.ss, u.rowIndex, 'KRAs JSON', JSON.stringify([]));
  return { status:'success', message: 'Cleared the KRAs for ' + u.name + '.' };
}


// =========================================================================
// AUTHENTICATION
// =========================================================================
/**
 * DOME BOX — AUTHENTICATION
 * =============================================================================
 * Replaces two things that are currently broken in a way that cannot be patched
 * around:
 *
 * 1. PASSWORDS ARE STORED IN PLAIN TEXT.
 *    Users!C holds the actual password, Global_Users!B holds it again, and
 *    Directory!C a third time. getUsersList() returns it to the browser. Anyone
 *    who opens a tenant sheet — which until now was anyone with the link — reads
 *    every employee's password. People reuse passwords, so the damage does not
 *    stop at your product.
 *
 * 2. THE SERVER TRUSTS THE BROWSER ABOUT WHO YOU ARE.
 *    doPost does `const user = params.user` and then acts on it. Nothing is
 *    verified. Anyone who knows a sheetId can post
 *    {action:'getUsersList', sheetId:'…', user:{role:'Admin'}} and receive that
 *    company's entire staff list including passwords. They can also delete
 *    users, reassign tasks, or read everything.
 *
 * MIGRATION IS TRANSPARENT. verifyPassword_ accepts a stored plaintext value,
 * and on a successful login immediately rewrites it as a hash. No flag day, no
 * forced reset, no customer locked out. After a few weeks, run
 * countUnmigratedPasswords() and reset the stragglers.
 * =============================================================================
 */

var AUTH = {
  ITERATIONS: 1000,       // see the note on cost below
  SESSION_HOURS: 12,
  PEPPER_PROP: 'AUTH_PEPPER',
  TOKEN_PROP: 'TOKEN_SECRET',
};

/**
 * One-time setup. Generates the two server-side secrets and stores them in
 * Script Properties, where a leaked spreadsheet cannot reach them.
 *
 * The pepper is what makes a stolen Users sheet useless on its own: without it
 * the hashes cannot be checked offline at any speed. Keep it. If you lose it,
 * every password must be reset.
 */
function initAuthSecrets() {
  var p = PropertiesService.getScriptProperties();
  var made = [];
  if (!p.getProperty(AUTH.PEPPER_PROP)) { p.setProperty(AUTH.PEPPER_PROP, Utilities.getUuid() + Utilities.getUuid()); made.push('AUTH_PEPPER'); }
  if (!p.getProperty(AUTH.TOKEN_PROP)) { p.setProperty(AUTH.TOKEN_PROP, Utilities.getUuid() + Utilities.getUuid()); made.push('TOKEN_SECRET'); }
  Logger.log(made.length
    ? 'Created: ' + made.join(', ') + '\nBack these up somewhere safe. Losing AUTH_PEPPER means every password must be reset.'
    : 'Both secrets already exist. Nothing changed.');
}

function authPepper_() {
  var v = PropertiesService.getScriptProperties().getProperty(AUTH.PEPPER_PROP);
  if (!v) throw new Error('AUTH_PEPPER is not set. Run initAuthSecrets() once.');
  return v;
}
function tokenSecret_() {
  var v = PropertiesService.getScriptProperties().getProperty(AUTH.TOKEN_PROP);
  if (!v) throw new Error('TOKEN_SECRET is not set. Run initAuthSecrets() once.');
  return v;
}

function toHex_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += ('0' + (bytes[i] & 0xFF).toString(16)).slice(-2);
  return s;
}

/**
 * Iterated HMAC-SHA256 over salt + pepper.
 *
 * On cost: Apps Script's Utilities.computeHmacSha256Signature is not fast, and
 * login runs inside a 30-second request, so this cannot use the iteration counts
 * you would pick in a normal backend. 1000 is roughly 1–2 seconds here — slow
 * enough to matter, not slow enough to time out. The real defence is the pepper:
 * an attacker holding the Users sheet still cannot test a single guess without
 * it. Measure with benchmarkHash() on your own account and tune.
 */
function hashPassword_(password, salt) {
  var pepper = authPepper_();
  var acc = String(salt) + ':' + String(password) + ':' + pepper;
  var bytes = Utilities.computeHmacSha256Signature(acc, pepper);
  for (var i = 1; i < AUTH.ITERATIONS; i++) {
    bytes = Utilities.computeHmacSha256Signature(bytes, pepper);
  }
  return 'v1$' + AUTH.ITERATIONS + '$' + salt + '$' + toHex_(bytes);
}

function makePasswordHash(password) {
  return hashPassword_(password, Utilities.getUuid().replace(/-/g, '').slice(0, 16));
}

function isHashed_(stored) { return /^v1\$\d+\$/.test(String(stored || '')); }

/** Length-independent comparison, so timing does not leak how much matched. */
function safeEquals_(a, b) {
  a = String(a == null ? '' : a); b = String(b == null ? '' : b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Returns { ok, needsUpgrade }. needsUpgrade true means the stored value was
 * plaintext and the caller should write back makePasswordHash(password).
 */
function verifyPassword_(password, stored) {
  if (stored == null || stored === '') return { ok: false, needsUpgrade: false };
  if (!isHashed_(stored)) {
    // Legacy plaintext. Accept it once, then upgrade.
    return { ok: safeEquals_(String(password), String(stored)), needsUpgrade: true };
  }
  var parts = String(stored).split('$');
  if (parts.length !== 4) return { ok: false, needsUpgrade: false };
  var iters = Number(parts[1]), salt = parts[2];
  var was = AUTH.ITERATIONS;
  try {
    AUTH.ITERATIONS = iters;              // verify at the cost it was written with
    return { ok: safeEquals_(hashPassword_(password, salt), stored), needsUpgrade: false };
  } finally { AUTH.ITERATIONS = was; }
}

/* ---------------------------------------------------------------------------
   SESSION TOKENS
   The server stops asking the browser who it is. The token is signed with a
   secret the browser never sees, carries the identity, and expires.
   ------------------------------------------------------------------------- */

function issueToken(sheetId, username, role) {
  var exp = Date.now() + AUTH.SESSION_HOURS * 3600 * 1000;
  var body = [sheetId, username, role, exp].join('|');
  var sig = toHex_(Utilities.computeHmacSha256Signature(body, tokenSecret_()));
  return Utilities.base64EncodeWebSafe(body) + '.' + sig;
}

/**
 * Returns the identity the token proves, or throws. Every protected route must
 * call this and use what it returns — never params.user.
 */
function requireSession(token) {
  if (!token) throw new Error('Not signed in.');
  var bits = String(token).split('.');
  if (bits.length !== 2) throw new Error('Session is invalid. Please sign in again.');
  var body;
  try { body = Utilities.newBlob(Utilities.base64DecodeWebSafe(bits[0])).getDataAsString(); }
  catch (e) { throw new Error('Session is invalid. Please sign in again.'); }

  var expect = toHex_(Utilities.computeHmacSha256Signature(body, tokenSecret_()));
  if (!safeEquals_(expect, bits[1])) throw new Error('Session is invalid. Please sign in again.');

  var f = body.split('|');
  if (f.length !== 4) throw new Error('Session is invalid. Please sign in again.');
  if (Number(f[3]) < Date.now()) throw new Error('Session has expired. Please sign in again.');

  return { sheetId: f[0], username: f[1], role: f[2], expires: Number(f[3]) };
}

/** Routes that only an Admin may call. */
function requireAdmin(session) {
  if (!session || session.role !== 'Admin') throw new Error('That action needs an Admin account.');
  return session;
}

/* ---------------------------------------------------------------------------
   LOGIN THROTTLE — a password that is one of the top thousand is found in
   minutes without this, and nothing in the current code slows anyone down.
   ------------------------------------------------------------------------- */
var LOGIN_LIMIT = { MAX: 8, WINDOW_MIN: 15 };

function loginAllowed_(key) {
  var cache = CacheService.getScriptCache();
  var k = 'lg_' + Utilities.base64EncodeWebSafe(String(key).toLowerCase()).slice(0, 80);
  var n = Number(cache.get(k) || 0);
  return { ok: n < LOGIN_LIMIT.MAX, attempts: n, key: k };
}
function recordFailedLogin_(state) {
  CacheService.getScriptCache().put(state.key, String(state.attempts + 1), LOGIN_LIMIT.WINDOW_MIN * 60);
}
function clearLoginFailures_(state) { CacheService.getScriptCache().remove(state.key); }

/* ---------------------------------------------------------------------------
   OPERATIONAL HELPERS
   ------------------------------------------------------------------------- */

function benchmarkHash() {
  var t = Date.now();
  makePasswordHash('benchmark-only-not-a-real-password');
  var ms = Date.now() - t;
  Logger.log('One hash at ' + AUTH.ITERATIONS + ' iterations: ' + ms + ' ms.\n' +
    (ms > 4000 ? 'Too slow for a login request — lower AUTH.ITERATIONS.'
     : ms < 200 ? 'Comfortably fast; you can raise AUTH.ITERATIONS.'
     : 'Reasonable. Logins will feel normal.'));
}

/** How much plaintext is still out there. Run weekly after rollout. */
function countUnmigratedPasswords() {
  var out = ['', '=== PLAINTEXT PASSWORDS REMAINING ===', ''];
  var total = 0, plain = 0;
  /* Resolved through the shared config rather than a constant in another file,
     so this works whether auth.gs is bundled into code.gs or run on its own. */
  var masterId = (typeof CFG === 'function' && CFG().masterId) ||
                 (typeof SHARE !== 'undefined' && SHARE.MASTER_DB_ID) || '';
  if (!masterId) { Logger.log('MASTER_DB_ID is not configured.'); return; }
  var master = SpreadsheetApp.openById(masterId);

  var g = master.getSheetByName('Global_Users');
  if (g) {
    var gd = g.getDataRange().getValues();
    var gp = 0;
    for (var i = 1; i < gd.length; i++) { total++; if (gd[i][1] && !isHashed_(gd[i][1])) { gp++; plain++; } }
    out.push('Global_Users: ' + gp + ' of ' + (gd.length - 1) + ' still plaintext');
  }

  var tenants = (typeof allTenants_ === 'function') ? allTenants_()
              : (typeof tenantRows_ === 'function') ? tenantRows_() : [];
  tenants.forEach(function (r) {
    try {
      var sh = SpreadsheetApp.openById(r.sheetId).getSheetByName('Users');
      if (!sh) return;
      var d = sh.getDataRange().getValues(), p = 0;
      for (var i = 1; i < d.length; i++) { total++; if (d[i][2] && !isHashed_(d[i][2])) { p++; plain++; } }
      if (p) out.push('  ' + (r.company || r.sheetId) + ': ' + p + ' of ' + (d.length - 1));
    } catch (e) { out.push('  ' + (r.company || r.sheetId) + ': ' + e.message); }
  });

  out.push('');
  out.push(plain + ' plaintext passwords remain across ' + total + ' records.');
  out.push(plain === 0 ? 'Migration complete.'
    : 'These upgrade automatically as each person next signs in. Force-reset the\n' +
      'remainder once the number stops falling.');
  Logger.log(out.join('\n'));
}


// =========================================================================
// PLAN LIMITS
// =========================================================================
/**
 * DOME BOX — PLAN LIMITS
 * =============================================================================
 * The published pricing promises specific caps. Nothing enforced them, so every
 * plan was effectively Enterprise. These are the rules; they are pure, so the
 * browser and the server can both run them and agree.
 *
 * Enforce on the SERVER. A limit checked only in the browser is a suggestion.
 * =============================================================================
 */

/* Keyed by the values your Directory sheet already stores — Free, Monthly,
   Yearly, Enterprise. The display name is separate, so the sheet keeps its
   existing vocabulary while the UI shows "Standard" and "Pro".

   This matters more than it looks: normalizePlan falls back to the LEAST
   generous tier on an unknown name, so keying these by anything else would
   silently downgrade every paying customer the moment they were read back. */
var PLANS = {
  'Free':       { name:'Free Tier',  price:0,     users:5,    tasksPerMonth:50,   analytics:false, whatsapp:false, email:false, kraForms:false },
  'Monthly':    { name:'Standard',   price:2499,  users:20,   tasksPerMonth:500,  analytics:false, whatsapp:false, email:true,  kraForms:false },
  'Yearly':     { name:'Pro',        price:19999, users:300,  tasksPerMonth:null, analytics:true,  whatsapp:true,  email:true,  kraForms:true },
  'Enterprise': { name:'Enterprise', price:0,     users:null, tasksPerMonth:null, analytics:true,  whatsapp:true,  email:true,  kraForms:true },
};

/* Both vocabularies resolve: what the sheet stores, and what the pricing page
   calls them. An unrecognised name is treated as Free, never as the most
   generous tier. */
var PLAN_ALIASES = {
  '': 'Free', 'free': 'Free', 'free tier': 'Free', 'freetier': 'Free', 'trial': 'Free',
  'monthly': 'Monthly', 'standard': 'Monthly', 'basic': 'Monthly',
  'yearly': 'Yearly', 'pro': 'Yearly', 'pro yearly': 'Yearly', 'proyearly': 'Yearly',
  'premium': 'Yearly', 'annual': 'Yearly',
  'enterprise': 'Enterprise', 'custom': 'Enterprise',
};

function normalizePlan(name) {
  var raw = String(name == null ? '' : name).trim();
  if (PLANS[raw]) return raw;
  var k = raw.toLowerCase().replace(/\s+/g, ' ');
  return PLAN_ALIASES[k] || 'Free';
}

function planLimits(name) { return PLANS[normalizePlan(name)]; }

/**
 * Counts tasks created in the calendar month a date falls in. Recurring
 * occurrences spawned by the system are NOT counted: a customer on Free with
 * five daily recurring jobs would otherwise burn the whole 50 in ten days
 * through no action of their own, and would rightly call that a bug. The cap is
 * on what people create.
 */
function tasksCreatedInMonth(tasks, when) {
  var ref = when || new Date();
  var from = new Date(ref.getFullYear(), ref.getMonth(), 1);
  var to = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  var n = 0;
  (tasks || []).forEach(function (t) {
    if (t.spawnedBy || t.systemGenerated) return;
    var created = firstHistoryDate_(t);
    if (!created) return;
    var d = startOfDay(created);
    if (d >= startOfDay(from) && d <= startOfDay(to)) n++;
  });
  return n;
}

function firstHistoryDate_(task) {
  var h = task.history || [];
  for (var i = 0; i < h.length; i++) {
    var raw = h[i].date || h[i].at;
    if (raw) { var d = new Date(raw); if (!isNaN(d)) return d; }
  }
  return task.createdAt ? new Date(task.createdAt) : null;
}

/** May this tenant add another active user? */
function canAddUser(plan, activeUserCount) {
  var lim = planLimits(plan);
  if (lim.users == null) return { ok: true, unlimited: true };
  if (activeUserCount < lim.users) {
    return { ok: true, remaining: lim.users - activeUserCount, limit: lim.users };
  }
  return { ok: false, limit: lim.users,
    reason: lim.name + ' includes ' + lim.users + ' users. You have ' + activeUserCount + '.',
    upgradeTo: nextPlanUp(plan) };
}

/** May this tenant create another task this month? */
function canCreateTask(plan, tasksThisMonth) {
  var lim = planLimits(plan);
  if (lim.tasksPerMonth == null) return { ok: true, unlimited: true };
  if (tasksThisMonth < lim.tasksPerMonth) {
    return { ok: true, remaining: lim.tasksPerMonth - tasksThisMonth, limit: lim.tasksPerMonth };
  }
  return { ok: false, limit: lim.tasksPerMonth,
    reason: lim.name + ' includes ' + lim.tasksPerMonth + ' tasks a month. ' +
            'You have created ' + tasksThisMonth + '. It resets on the 1st.',
    upgradeTo: nextPlanUp(plan) };
}

function planAllows(plan, feature) { return !!planLimits(plan)[feature]; }

var PLAN_ORDER = ['Free', 'Monthly', 'Yearly', 'Enterprise'];
function nextPlanUp(plan) {
  var i = PLAN_ORDER.indexOf(normalizePlan(plan));
  var next = i > -1 && i < PLAN_ORDER.length - 1 ? PLAN_ORDER[i + 1] : null;
  return next ? PLANS[next].name : null;      // the name the customer recognises
}

/**
 * What a tenant should see before they hit a wall. Warning at 80% is early
 * enough to upgrade without the work stopping mid-week.
 */
function planUsage(plan, activeUsers, tasksThisMonth) {
  var lim = planLimits(plan), warnings = [];
  var pct = function (n, cap) { return cap == null ? 0 : Math.round(n / cap * 100); };

  var uPct = pct(activeUsers, lim.users), tPct = pct(tasksThisMonth, lim.tasksPerMonth);
  if (lim.users != null && uPct >= 80) {
    warnings.push({ kind: 'users', pct: uPct, atLimit: activeUsers >= lim.users,
      text: activeUsers >= lim.users
        ? 'You are at your ' + lim.users + '-user limit.'
        : 'You are using ' + activeUsers + ' of ' + lim.users + ' users.' });
  }
  if (lim.tasksPerMonth != null && tPct >= 80) {
    warnings.push({ kind: 'tasks', pct: tPct, atLimit: tasksThisMonth >= lim.tasksPerMonth,
      text: tasksThisMonth >= lim.tasksPerMonth
        ? 'You have used all ' + lim.tasksPerMonth + ' tasks this month.'
        : 'You have used ' + tasksThisMonth + ' of ' + lim.tasksPerMonth + ' tasks this month.' });
    }
  return { plan: normalizePlan(plan), limits: lim, users: { used: activeUsers, limit: lim.users, pct: uPct },
    tasks: { used: tasksThisMonth, limit: lim.tasksPerMonth, pct: tPct },
    warnings: warnings, upgradeTo: nextPlanUp(plan) };
}



// =========================================================================
// RULES ENGINE
// =========================================================================
/**
 * DOME BOX — DOMAIN ENGINE
 * =============================================================================
 * Pure logic only: no SpreadsheetApp, no GmailApp, no I/O of any kind. Every
 * function here is deterministic, which is what makes the workflow, delegation,
 * recurrence and scoring rules testable instead of hopeful.
 *
 * Apps Script has no modules, so these become globals in the project. The API
 * layer (code.gs) and the scheduler (reminders.gs) call into this file.
 * =============================================================================
 */

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------
var STATUS = {
  AWAITING_APPROVAL:   'Awaiting Approval',   // delegation gate: assignee's manager must agree
  DELEGATION_PROPOSED: 'Delegation Proposed', // holder wants to pass it on; their manager decides
  PENDING:             'Pending',             // accepted, not started
  IN_PROGRESS:         'In Progress',
  FOR_REVIEW:          'For Review',          // handed in, waiting on the verifier
  VERIFIED:            'Verified',            // signed off — the only clean close
  REJECTED:            'Rejected',            // never accepted
  CANCELLED:           'Cancelled',           // withdrawn after acceptance
};

var OPEN_STATUSES = [
  STATUS.AWAITING_APPROVAL, STATUS.DELEGATION_PROPOSED,
  STATUS.PENDING, STATUS.IN_PROGRESS, STATUS.FOR_REVIEW,
];
var CLOSED_STATUSES = [STATUS.VERIFIED, STATUS.REJECTED, STATUS.CANCELLED];

var ROLE = { ADMIN: 'Admin', MANAGER: 'HOD', DOER: 'Doer' };

// High-priority work counts three times a low-priority one, so one missed
// critical task cannot be averaged away under a pile of trivial wins.
var PRIORITY_WEIGHT = { High: 3, Medium: 2, Low: 1 };

function priorityWeight(priority) {
  return PRIORITY_WEIGHT[priority] || PRIORITY_WEIGHT.Medium;
}

function isOpen(status) { return OPEN_STATUSES.indexOf(status) > -1; }
function isClosed(status) { return CLOSED_STATUSES.indexOf(status) > -1; }

// ---------------------------------------------------------------------------
// Date helpers — all comparisons are on whole days, so a task due today and
// submitted today is never counted late by a few hours.
// ---------------------------------------------------------------------------
function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function dayDiff(a, b) { return Math.round((startOfDay(a) - startOfDay(b)) / 86400000); }
function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d, n) {
  var x = new Date(d);
  var targetDay = x.getDate();
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  // Clamp: 31 Jan + 1 month must be 28/29 Feb, not 2/3 March.
  var lastDay = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(targetDay, lastDay));
  return x;
}
function ymd(d) {
  var x = startOfDay(d);
  var m = String(x.getMonth() + 1);
  var day = String(x.getDate());
  return x.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
}
function parseYmd(s) {
  if (s instanceof Date) return startOfDay(s);
  var parts = String(s).slice(0, 10).split('-');
  if (parts.length !== 3) return null;
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// WORKFLOW + DELEGATION
// ---------------------------------------------------------------------------
/**
 * Who may move this task, and where to.
 *
 * The rules that make the data trustworthy:
 *  - a person can never verify their own work; only the raiser, the approver or
 *    an Admin closes a task
 *  - work only becomes assigned once the holder's own manager has agreed to it,
 *    so nobody's team gets loaded behind their back
 *  - handing work onward is itself an approval step, so a delegation chain is
 *    visible rather than a silent hand-off
 *
 * `actor` = { username, role }, `task` = { status, assignee, raisedBy, approver, delegateTo }
 */
function allowedTransitions(task, actor) {
  var isAdmin = actor.role === ROLE.ADMIN;
  var isAssignee = task.assignee === actor.username;
  var isRaiser = task.raisedBy === actor.username;
  var isApprover = task.approver === actor.username;
  var canVerify = isAdmin || isRaiser || isApprover;

  switch (task.status) {
    case STATUS.AWAITING_APPROVAL:
      // The assignee's manager (recorded as approver) accepts or refuses the load.
      return (isApprover || isAdmin) ? [STATUS.PENDING, STATUS.REJECTED] : [];

    case STATUS.DELEGATION_PROPOSED:
      // The proposing person's manager decides whether the hand-off is allowed.
      return (isApprover || isAdmin) ? [STATUS.PENDING, STATUS.IN_PROGRESS] : [];

    case STATUS.PENDING:
      var fromPending = [];
      if (isAssignee || isAdmin) fromPending.push(STATUS.IN_PROGRESS);
      if (isRaiser || isAdmin) fromPending.push(STATUS.CANCELLED);
      return fromPending;

    case STATUS.IN_PROGRESS:
      var fromProgress = [];
      if (isAssignee || isAdmin) fromProgress.push(STATUS.FOR_REVIEW);
      if (isRaiser || isAdmin) fromProgress.push(STATUS.CANCELLED);
      return fromProgress;

    case STATUS.FOR_REVIEW:
      // Deliberately excludes the assignee: you cannot sign off your own work.
      return canVerify && !(isAssignee && !isAdmin && !isRaiser)
        ? [STATUS.VERIFIED, STATUS.IN_PROGRESS]   // In Progress here means "rework"
        : (canVerify ? [STATUS.VERIFIED, STATUS.IN_PROGRESS] : []);

    default:
      return []; // Verified / Rejected / Cancelled are terminal
  }
}

function canTransition(task, actor, next) {
  return allowedTransitions(task, actor).indexOf(next) > -1;
}

/**
 * Where a newly raised task should start.
 * If the assignee reports to somebody other than the person raising it, that
 * manager approves first. Assigning to your own report, or to yourself, needs
 * no gate.
 */
/**
 * MULTI-LEVEL ASSIGNMENT — who may assign work to whom.
 *
 *   Admin        anyone
 *   HOD          anyone, in any department
 *   Doer         upward only: their own manager, or any HOD/Admin
 *
 * A Doer assigning sideways to a peer is deliberately refused. It is the one
 * direction with no accountability attached — nobody has agreed to the work and
 * nobody is answerable for it landing, so it becomes a way to move your own
 * tasks onto someone else's list.
 */
function canAssignTo(raiser, assignee) {
  if (!raiser || !assignee) return { ok: false, reason: 'Unknown person.' };
  if (assignee.active === false) return { ok: false, reason: assignee.name + ' is no longer active.' };
  if (raiser.username === assignee.username) return { ok: true, self: true };

  if (raiser.role === ROLE.ADMIN || raiser.role === ROLE.MANAGER) return { ok: true };

  // Doer: upward only.
  var isOwnManager = assignee.username === raiser.manager;
  var isSenior = assignee.role === ROLE.MANAGER || assignee.role === ROLE.ADMIN;
  if (isOwnManager || isSenior) return { ok: true, upward: true };

  return { ok: false, upward: false,
    reason: 'You can raise work for your manager or a department head, not for a colleague. ' +
            'Ask your manager to assign it.' };
}

/**
 * Where a new task lands, and who decides.
 *
 *   raised by an Admin                  → straight to the assignee
 *   raised by the assignee's manager    → straight to the assignee
 *   assigned to yourself                → straight to your own list
 *   raised UPWARD by a Doer             → the recipient accepts or declines it
 *                                         themselves; it is their time being
 *                                         asked for, so nobody else arbitrates
 *   anyone else                         → the assignee's own manager approves
 *
 * That last line is the important one: an HOD in another department can give
 * work to anyone, but it reaches that person only once their own manager has
 * agreed. A manager always knows what their team has been committed to.
 */
function initialStatusFor(assignee, raiser) {
  if (!assignee || !raiser) {
    return { status: STATUS.PENDING, approver: '', note: 'Task assigned' };
  }
  if (assignee.username === raiser.username) {
    return { status: STATUS.PENDING, approver: raiser.username || '', note: 'Self-assigned' };
  }
  if (raiser.role === ROLE.ADMIN) {
    return { status: STATUS.PENDING, approver: raiser.username || '', note: 'Task assigned' };
  }

  var upward = raiser.role === ROLE.DOER &&
    (assignee.username === raiser.manager ||
     assignee.role === ROLE.MANAGER || assignee.role === ROLE.ADMIN);
  if (upward) {
    return { status: STATUS.AWAITING_APPROVAL, approver: assignee.username,
             note: 'Raised by ' + (raiser.name || raiser.username) + ' — awaiting your acceptance',
             upward: true };
  }

  var needsApproval = !!assignee.manager && assignee.manager !== raiser.username;
  return needsApproval
    ? { status: STATUS.AWAITING_APPROVAL, approver: assignee.manager,
        note: 'Awaiting approval from ' + (assignee.name || assignee.username) + "'s manager" }
    : { status: STATUS.PENDING, approver: raiser.username || '', note: 'Task assigned' };
}


/**
 * A holder proposing to pass work onward. Their own manager arbitrates, which
 * keeps a delegation chain auditable instead of letting work quietly circulate.
 */
function proposeDelegation(task, actor, targetUser, actorUser) {
  if (task.assignee !== actor.username && actor.role !== ROLE.ADMIN) {
    return { ok: false, error: 'Only the current owner can hand this task on.' };
  }
  if (!targetUser) return { ok: false, error: 'Pick who should take it over.' };
  if (targetUser.username === task.assignee) {
    return { ok: false, error: 'That is already the current owner.' };
  }
  if (isClosed(task.status)) return { ok: false, error: 'This task is already closed.' };

  // An Admin, or someone with no manager above them, can hand off directly.
  var arbiter = actorUser && actorUser.manager ? actorUser.manager : '';
  if (actor.role === ROLE.ADMIN || !arbiter) {
    return {
      ok: true, status: STATUS.PENDING, assignee: targetUser.username,
      approver: task.approver || actor.username, delegateTo: '',
      note: 'Handed over to ' + targetUser.name + ' by ' + actor.username,
    };
  }
  return {
    ok: true, status: STATUS.DELEGATION_PROPOSED, assignee: task.assignee,
    approver: arbiter, delegateTo: targetUser.username,
    note: actor.username + ' proposes handing this to ' + targetUser.name,
  };
}

// ---------------------------------------------------------------------------
// RECURRING JOBS
// ---------------------------------------------------------------------------
var CADENCE = {
  ONE_TIME: 'One Time',
  DAILY: 'Daily',
  WEEKDAYS: 'Weekdays',
  WEEKLY: 'Weekly',
  FORTNIGHTLY: 'Fortnightly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  HALF_YEARLY: 'Half-Yearly',
  YEARLY: 'Yearly',
  CUSTOM_DAYS: 'Every N Days',
};

/**
 * The next date a recurring job is due after `from`.
 *
 * Returns null for one-off jobs. Weekday cadence skips Saturday and Sunday.
 * Monthly and longer cadences clamp to the end of short months, so a job set
 * for the 31st lands on the 28th/29th in February rather than skidding into
 * March — the bug in naive date arithmetic.
 */
function nextOccurrence(cadence, from, opts) {
  opts = opts || {};
  var base = parseYmd(from);
  if (!base) return null;

  switch (cadence) {
    case CADENCE.DAILY:       return addDays(base, 1);
    case CADENCE.WEEKDAYS:
      var d = addDays(base, 1);
      while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1);
      return d;
    case CADENCE.WEEKLY:      return addDays(base, 7);
    case CADENCE.FORTNIGHTLY: return addDays(base, 14);
    case CADENCE.MONTHLY:     return addMonths(base, 1);
    case CADENCE.QUARTERLY:   return addMonths(base, 3);
    case CADENCE.HALF_YEARLY:  return addMonths(base, 6);
    case CADENCE.YEARLY:      return addMonths(base, 12);
    case CADENCE.CUSTOM_DAYS:
      var n = Number(opts.intervalDays || 0);
      return n > 0 ? addDays(base, n) : null;
    default: return null;
  }
}

/**
 * Decides what a recurring job template owes us as of `today`.
 *
 * This is the fix for the original design, where the next occurrence was only
 * created when somebody verified the last one — so a single unverified task
 * silently ended the series, which is precisely when a reminder matters most.
 * Generation is now driven by the schedule, independent of anyone's behaviour.
 *
 * `job` = { cadence, intervalDays, nextDue, endDate, maxOccurrences,
 *           occurrencesCreated, active, skipIfPreviousOpen }
 * `state` = { previousOpen: bool }
 */
function dueOccurrences(job, today, state) {
  state = state || {};
  var out = { create: [], nextDue: job.nextDue, stop: false, reason: '' };
  if (!job.active) { out.reason = 'paused'; return out; }
  if (job.cadence === CADENCE.ONE_TIME) { out.stop = true; out.reason = 'one-off'; return out; }

  var cursor = parseYmd(job.nextDue);
  if (!cursor) { out.reason = 'no next due date'; return out; }

  var end = job.endDate ? parseYmd(job.endDate) : null;
  var created = Number(job.occurrencesCreated || 0);
  var max = Number(job.maxOccurrences || 0);
  var now = startOfDay(today);

  // Cap the catch-up so a job dormant for a year cannot dump 365 tasks at once.
  var MAX_CATCHUP = 12;
  var guard = 0;

  while (cursor <= now && guard < MAX_CATCHUP) {
    guard++;
    if (end && cursor > end) { out.stop = true; out.reason = 'past end date'; break; }
    if (max && created >= max) { out.stop = true; out.reason = 'reached occurrence limit'; break; }

    // Don't pile a second copy on someone who hasn't finished the first.
    if (job.skipIfPreviousOpen && state.previousOpen && out.create.length === 0) {
      out.reason = 'previous occurrence still open';
      var skipTo = nextOccurrence(job.cadence, cursor, job);
      if (!skipTo) break;
      cursor = skipTo;
      continue;
    }

    out.create.push(ymd(cursor));
    created++;
    var advanced = nextOccurrence(job.cadence, cursor, job);
    if (!advanced) break;
    cursor = advanced;
  }

  out.nextDue = ymd(cursor);
  if (end && parseYmd(out.nextDue) > end) { out.stop = true; out.reason = out.reason || 'past end date'; }
  if (max && created >= max) { out.stop = true; out.reason = out.reason || 'reached occurrence limit'; }
  return out;
}

// ---------------------------------------------------------------------------
// PERFORMANCE — the Delegation Score
// ---------------------------------------------------------------------------
var SCORE_WEIGHTS = { onTime: 0.45, quality: 0.30, queue: 0.25 };
var LATENESS_POINTS_PER_DAY = 10;   // a day late costs 10 on that task
var REWORK_POINTS_EACH = 25;        // each rework loop costs 25
/* RESPONSIVENESS — the manager's half of accountability.
   A doer is measured on delivering. The person who has to approve or sign off
   is measured on not sitting on it. Without this the score is one-sided: a team
   can be marked down for lateness that their manager caused, which is the
   fastest way for a workforce to stop believing the numbers.
   Measured in WORKING days from when the item landed on their desk — not from
   the task's deadline, so work submitted early that then waits a fortnight is
   counted properly. */
var REVIEW_SLA_DAYS = 2;                  // working days to review or approve
var RESPONSIVENESS_PENALTY_PER_DAY = 2;   // points lost per working day beyond the SLA
var MAX_RESPONSIVENESS_PENALTY_PER_ITEM = 10;
var MAX_RESPONSIVENESS_PENALTY = 20;      // no single oversight can destroy a score
var MAX_MANAGER_DEDUCTION = MAX_RESPONSIVENESS_PENALTY;   // old names, still referenced
var MAX_MANAGER_DEDUCTION_PER_TASK = MAX_RESPONSIVENESS_PENALTY_PER_ITEM;

// ---------------------------------------------------------------------------
// WORKING CALENDAR — holidays and approved leave
// A person on sanctioned leave still accrued overdue days, so a fortnight off
// wrecked their score and the first appraisal that used it became an argument
// nobody could win. When a calendar is supplied, lateness is counted in
// chargeable days only: weekends, company holidays and that person's approved
// leave are skipped. With no calendar every function below is a no-op and
// scoring is exactly what it was.
// ---------------------------------------------------------------------------
var DEFAULT_WEEKEND = [0, 6];   // Sunday, Saturday

/**
 * cal = {
 *   weekend:  [0,6],
 *   holidays: ['2026-01-26', '2026-08-15'],
 *   leave:    { 'asha@x.in': [{ from:'2026-09-01', to:'2026-09-07' }] }
 * }
 */
function isNonWorkingDay(date, username, cal) {
  if (!cal) return false;
  var d = startOfDay(date);
  var weekend = cal.weekend || DEFAULT_WEEKEND;
  if (weekend.indexOf(d.getDay()) > -1) return true;
  if ((cal.holidays || []).indexOf(ymd(d)) > -1) return true;
  var spans = (cal.leave || {})[username] || [];
  for (var i = 0; i < spans.length; i++) {
    var from = parseYmd(spans[i].from), to = parseYmd(spans[i].to || spans[i].from);
    if (from && to && d >= from && d <= to) return true;
  }
  return false;
}

/**
 * Days late that the person is answerable for. Negative or zero means on time,
 * and is returned unchanged so "delivered three days early" still reads as three
 * days early. Only lateness is discounted.
 */
function chargeableLateDays(due, actual, username, cal) {
  var raw = dayDiff(actual, due);
  if (!cal || raw <= 0) return raw;
  var n = 0, cursor = addDays(parseYmd(ymd(due)), 1), end = startOfDay(actual);
  var guard = 0;
  while (cursor <= end && guard++ < 3660) {
    if (!isNonWorkingDay(cursor, username, cal)) n++;
    cursor = addDays(cursor, 1);
  }
  return n;
}

function timelinessPoints(daysLate) {
  if (daysLate <= 0) return 100;
  return Math.max(0, 100 - daysLate * LATENESS_POINTS_PER_DAY);
}

/**
 * When did the holder actually hand the work in? The last time it entered
 * "For Review" — NOT when it was verified. Scoring the verification date would
 * punish an employee for their manager's slow review, which is the single most
 * common way an automated performance metric loses the room's trust.
 */
function submittedAt(task) {
  var history = task.history || [];
  for (var i = history.length - 1; i >= 0; i--) {
    if (history[i].status === STATUS.FOR_REVIEW) return new Date(history[i].date);
  }
  for (var j = history.length - 1; j >= 0; j--) {
    if (history[j].status === STATUS.VERIFIED) return new Date(history[j].date);
  }
  return null;
}

/**
 * A weighted composite out of 100, with the arithmetic exposed so it can be
 * defended in a review meeting:
 *
 *   On-Time Delivery  45%  of what you closed, how much landed by its deadline
 *   First-Pass Quality 30%  did it come back for rework
 *   Queue Health      25%  of what is still open, how much is overdue
 *
 * then a capped deduction for reviews and approvals left sitting.
 *
 * Components with no data are dropped and the remaining weights renormalised,
 * so a new joiner is measured on what exists rather than handed a fake 100 or
 * an unearned 0. With nothing at all, hasData is false and the caller should
 * say "not enough data" rather than print a number.
 */
/**
 * Every spell an item spent waiting on somebody's decision.
 *
 * Reading it out of the history rather than the current status is what lets a
 * manager be measured on work they have ALREADY actioned — otherwise the only
 * thing visible is what is stuck right now, and someone who clears their queue
 * the day before review looks identical to someone who never let it pile up.
 */
function queueSpells(task) {
  var h = (task.history || []).slice().filter(function (e) { return e && e.date; });
  var out = [];
  var WAITING = {};
  WAITING[STATUS.FOR_REVIEW] = 'review';
  WAITING[STATUS.AWAITING_APPROVAL] = 'approval';
  WAITING[STATUS.DELEGATION_PROPOSED] = 'approval';

  for (var i = 0; i < h.length; i++) {
    var kind = WAITING[h[i].status];
    if (!kind) continue;
    var from = new Date(h[i].date);
    if (isNaN(from)) continue;
    var to = null;
    for (var j = i + 1; j < h.length; j++) {
      var d = new Date(h[j].date);
      if (!isNaN(d)) { to = d; break; }
    }
    out.push({ kind: kind, from: from, to: to,
      holder: kind === 'review' ? (task.approver || task.raisedBy) : task.approver,
      open: to === null });
  }

  /* A task sitting in a waiting state with no history entry for it still counts:
     the clock is running even if nobody wrote it down. */
  var nowKind = WAITING[task.status];
  if (nowKind && !out.some(function (s) { return s.open; })) {
    var started = h.length ? new Date(h[h.length - 1].date) : parseYmd(task.due);
    if (started && !isNaN(started)) {
      out.push({ kind: nowKind, from: started, to: null, open: true,
        holder: nowKind === 'review' ? (task.approver || task.raisedBy) : task.approver });
    }
  }
  return out;
}

/**
 * How promptly this person clears what lands on their desk.
 *
 * Returns a 0-100 responsiveness figure and the penalty it costs them, with the
 * working it out attached — every item, how long it was held, and what that
 * cost. A number a manager cannot see the derivation of is a number they will
 * dispute, and they will be right to.
 */
function responsivenessStats(tasks, username, today, cal, opts) {
  opts = opts || {};
  var sla = opts.slaDays == null ? REVIEW_SLA_DAYS : Number(opts.slaDays);
  var now = today || new Date();
  var items = [], breakdown = [], penalty = 0;

  (tasks || []).forEach(function (t) {
    queueSpells(t).forEach(function (sp) {
      if (sp.holder !== username) return;
      var end = sp.to || now;
      if (startOfDay(end) < startOfDay(sp.from)) return;   // clock skew, ignore

      // Working days only, and never charged for their own approved leave.
      var held = chargeableLateDays(sp.from, end, username, cal);
      if (held < 0) held = 0;
      var over = Math.max(0, held - sla);
      var cost = Math.min(over * RESPONSIVENESS_PENALTY_PER_DAY,
                          MAX_RESPONSIVENESS_PENALTY_PER_ITEM);

      items.push({ id: t.id, title: t.title, kind: sp.kind, heldDays: held,
                   overSla: over, open: sp.open, cost: cost });
      if (cost > 0) {
        penalty += cost;
        breakdown.push({
          group: 'Review Responsiveness', item: t.title,
          reason: (sp.open ? 'Still waiting on you to ' : 'Took ') +
                  (sp.open ? (sp.kind === 'review' ? 'review' : 'approve') +
                             ' after ' + held + ' working day(s)'
                           : held + ' working day(s) to ' + (sp.kind === 'review' ? 'review' : 'approve')) +
                  ' (' + sla + ' expected)',
          impact: '-' + cost,
        });
      }
    });
  });

  penalty = Math.min(penalty, MAX_RESPONSIVENESS_PENALTY);
  var withinSla = items.filter(function (i) { return i.overSla === 0; }).length;
  var pending = items.filter(function (i) { return i.open; });

  return {
    hasData: items.length > 0,
    items: items.length,
    withinSla: withinSla,
    pending: pending.length,
    overdueNow: pending.filter(function (i) { return i.overSla > 0; }).length,
    avgHeldDays: items.length
      ? Math.round(items.reduce(function (s, i) { return s + i.heldDays; }, 0) / items.length * 10) / 10 : null,
    responsiveness: items.length ? Math.round(withinSla / items.length * 100) : null,
    penalty: penalty,
    slaDays: sla,
    breakdown: breakdown,
  };
}

function delegationScore(tasks, username, today, cal) {
  today = today || new Date();
  var mine = tasks.filter(function (t) { return t.assignee === username; });
  var breakdown = [];

  var closed = mine.filter(function (t) { return t.status === STATUS.VERIFIED; });
  // Queue health counts only work the holder can actually act on. Something
  // sitting in For Review has already been handed in, and something Awaiting
  // Approval has not been accepted yet — counting either against them would
  // penalise a person for their manager's delay, which is the same unfairness
  // the on-time component is careful to avoid.
  var open = mine.filter(function (t) {
    return t.status === STATUS.PENDING || t.status === STATUS.IN_PROGRESS;
  });

  // --- on-time delivery ---
  var otW = 0, otSum = 0, otCount = 0;
  closed.forEach(function (t) {
    var sub = submittedAt(t);
    if (!sub) return;
    var late = chargeableLateDays(parseYmd(t.due) || sub, sub, t.assignee, cal);
    var pts = timelinessPoints(late);
    var w = priorityWeight(t.priority);
    otSum += pts * w; otW += w; otCount++;
    breakdown.push({
      group: 'On-Time Delivery', item: t.title,
      reason: late <= 0 ? 'Delivered on time (' + t.priority + ')'
                        : 'Delivered ' + late + ' day(s) late (' + t.priority + ')',
      impact: pts + '/100',
    });
  });

  // --- first-pass quality ---
  var qW = 0, qSum = 0, reworkTotal = 0;
  closed.forEach(function (t) {
    var rw = Number(t.reworkCount || 0);
    reworkTotal += rw;
    var pts = Math.max(0, 100 - rw * REWORK_POINTS_EACH);
    var w = priorityWeight(t.priority);
    qSum += pts * w; qW += w;
    if (rw > 0) {
      breakdown.push({
        group: 'First-Pass Quality', item: t.title,
        reason: 'Returned for rework ' + rw + ' time(s)', impact: pts + '/100',
      });
    }
  });

  // --- queue health ---
  var qhW = 0, qhSum = 0, overdue = 0;
  open.forEach(function (t) {
    var due = parseYmd(t.due);
    var late = due ? chargeableLateDays(due, today, t.assignee, cal) : 0;
    var pts = timelinessPoints(late);
    var w = priorityWeight(t.priority);
    qhSum += pts * w; qhW += w;
    if (late > 0) {
      overdue++;
      breakdown.push({
        group: 'Queue Health', item: t.title,
        reason: 'Open and ' + late + ' day(s) overdue (' + t.priority + ')', impact: pts + '/100',
      });
    }
  });

  var parts = [
    { key: 'onTime',  label: 'On-Time Delivery',   score: otW ? otSum / otW : null,   weight: SCORE_WEIGHTS.onTime,  basis: otCount + ' closed' },
    { key: 'quality', label: 'First-Pass Quality', score: qW ? qSum / qW : null,      weight: SCORE_WEIGHTS.quality, basis: closed.length + ' closed' },
    { key: 'queue',   label: 'Queue Health',       score: qhW ? qhSum / qhW : null,   weight: SCORE_WEIGHTS.queue,   basis: open.length + ' open' },
  ];
  var active = parts.filter(function (p) { return p.score !== null; });
  var totalWeight = active.reduce(function (s, p) { return s + p.weight; }, 0);
  var hasData = active.length > 0;
  var composite = hasData ? active.reduce(function (s, p) { return s + p.score * (p.weight / totalWeight); }, 0) : 0;

  /* --- responsiveness: separate, capped, never averaged into the delivery half ---
     Held time is measured from when the item landed on this person's desk, in
     working days, excluding their own approved leave. The old version keyed off
     the task's deadline, so work handed in early that then sat for a fortnight
     cost the reviewer nothing. */
  var resp = responsivenessStats(tasks, username, today, cal);
  var deduction = resp.penalty;
  resp.breakdown.forEach(function (b) { breakdown.push(b); });

  /**
   * A manager may own no tasks at all and still be the reason four people are
   * stuck. Scoring them "no data" there is the one hole that would let the least
   * accountable person on the board look unmeasurable, so with no delivery
   * record but a queue of their own, the score becomes how promptly they clear
   * it.
   */
  if (!hasData && resp.hasData) {
    return {
      score: Math.max(0, Math.min(100, resp.responsiveness)),
      hasData: true,
      deduction: 0,
      responsiveness: resp,
      components: [{
        key: 'responsiveness', label: 'Review Responsiveness', score: resp.responsiveness,
        weight: 100,
        basis: resp.withinSla + ' of ' + resp.items + ' cleared within ' + resp.slaDays + ' days',
      }],
      summary: { closed: 0, open: 0, overdue: 0, reworkLoops: 0,
                 awaitingMe: resp.pending, heldOverSla: resp.overdueNow },
      breakdown: breakdown,
      note: 'No delivery record of their own — scored purely on how quickly they clear ' +
            'approvals and reviews.',
    };
  }

  return {
    score: hasData ? Math.max(0, Math.min(100, Math.round(composite - deduction))) : 0,
    hasData: hasData,
    deduction: deduction,
    components: parts.map(function (p) {
      return {
        key: p.key, label: p.label,
        score: p.score === null ? null : Math.round(p.score),
        weight: Math.round((p.score === null ? 0 : p.weight / totalWeight) * 100),
        basis: p.basis,
      };
    }),
    responsiveness: resp,
    summary: { closed: closed.length, open: open.length, overdue: overdue,
               reworkLoops: reworkTotal, awaitingMe: resp.pending, heldOverSla: resp.overdueNow },
    breakdown: breakdown,
  };
}

// ---------------------------------------------------------------------------
// APPRAISAL — KRA / KPI
// ---------------------------------------------------------------------------
/* How the 100 performance points are divided. Delegation is not in here: it is
   the other half of the final score, not a slice of this one. */
var APPRAISAL_SPLIT = { kra: 75, behaviour: 20 };     // the remaining 5 are brownie
var APPRAISAL_WEIGHTS = APPRAISAL_SPLIT;              // old name, still referenced
var MAX_BROWNIE = 5;

/** Ratings are 0-5 against a weight; 0 means "not rated" and is excluded. */
function weightedRating(items) {
  var totalWeight = 0, sum = 0;
  (items || []).forEach(function (i) {
    var rating = Number(i.rating || 0);
    var weight = Number(i.weight || 0);
    if (rating > 0 && weight > 0) { totalWeight += weight; sum += (rating / 5) * 100 * weight; }
  });
  return totalWeight ? sum / totalWeight : null;
}

function validateKraBlueprint(kras) {
  var rows = (kras || []).filter(function (k) { return k && String(k.item || k.name || '').trim(); });
  if (!rows.length) return { ok: false, error: 'Add at least one KRA.' };
  var total = rows.reduce(function (s, k) { return s + Number(k.weight || 0); }, 0);
  if (total > 100) return { ok: false, error: 'KRA weights total ' + total + '%. They cannot exceed 100%.' };
  return { ok: true, total: total, rows: rows, warning: total < 100 ? 'Weights total ' + total + '% — ' + (100 - total) + '% unallocated.' : '' };
}

/**
 * Blends measured execution with judgement:
 *   40% delegation score (from verified task history — cannot be talked up)
 *   40% KRA execution     (weighted, rated 0-5)
 *   20% behaviour         (weighted, rated 0-5)
 *   + up to 5 discretionary points
 * Any unrated half is dropped and the rest renormalised, so a half-finished
 * appraisal never silently reads as a low score.
 */
/**
 * THE ONE DEFINITION OF A FINAL SCORE.
 *
 *   Performance = KRA 75% + Behaviour 20% + Brownie (max 5)   → out of 100
 *   Delegation  = measured from the task record               → out of 100
 *   Final       = (Performance + Delegation) / 2
 *
 * Two halves, weighted equally: what you were judged on, and what the record
 * shows. There used to be two different formulas — a 40/40/20 blend here and a
 * flat average on the dashboard — so the number an employee saw was not the
 * number stored against them. An appraisal figure that cannot be reproduced on
 * demand is worse than no figure, because it will be challenged and you will
 * not be able to defend it.
 *
 * Someone with no closed work has no delegation half. Their final score is
 * their performance score rather than half of it — a new joiner is not a poor
 * performer.
 */
function finalAppraisalScore(input) {
  input = input || {};
  var kraPct = ratingPercent_(input.kras);                  // 0..100 or null
  var behPct = ratingPercent_(input.behaviours);
  var brownie = Math.max(0, Math.min(MAX_BROWNIE, Number(input.brownie || 0)));

  var kraPoints = kraPct === null ? null : (kraPct / 100) * APPRAISAL_SPLIT.kra;
  var behPoints = behPct === null ? null : (behPct / 100) * APPRAISAL_SPLIT.behaviour;

  var rated = (kraPoints !== null) || (behPoints !== null);
  var performance = rated
    ? Math.max(0, Math.min(100, (kraPoints || 0) + (behPoints || 0) + brownie))
    : null;

  var hasDelegation = input.hasDelegationData !== false &&
                      input.delegationScore !== null && input.delegationScore !== undefined;
  var delegation = hasDelegation
    ? Math.max(0, Math.min(100, Number(input.delegationScore) || 0)) : null;

  var halves = [];
  if (performance !== null) halves.push(performance);
  if (delegation !== null) halves.push(delegation);

  var score = halves.length
    ? Math.round(halves.reduce(function (a, b) { return a + b; }, 0) / halves.length) : 0;

  return {
    score: score,
    performance: performance === null ? null : Math.round(performance * 10) / 10,
    delegation: delegation === null ? null : Math.round(delegation),
    hasData: halves.length > 0,
    brownie: brownie,
    parts: {
      kra:       { percent: kraPct === null ? null : Math.round(kraPct),
                   points: kraPoints === null ? null : Math.round(kraPoints * 10) / 10,
                   outOf: APPRAISAL_SPLIT.kra },
      behaviour: { percent: behPct === null ? null : Math.round(behPct),
                   points: behPoints === null ? null : Math.round(behPoints * 10) / 10,
                   outOf: APPRAISAL_SPLIT.behaviour },
      brownie:   { points: brownie, outOf: MAX_BROWNIE },
    },
    formula: delegation === null
      ? 'No closed work to measure, so the final score is the performance score alone.'
      : 'Final = (Performance ' + Math.round(performance) + ' + Delegation ' + delegation + ') / 2',
  };
}

/** A weighted set of 0-5 ratings as a percentage, or null if nothing was rated. */
function ratingPercent_(rows) {
  var items = (rows || []).filter(function (r) {
    return r && Number(r.rating) > 0; });
  if (!items.length) return null;
  var got = 0, max = 0;
  items.forEach(function (r) {
    var w = Number(r.weight) || 1;
    got += (Number(r.rating) || 0) * w;
    max += 5 * w;
  });
  return max ? (got / max) * 100 : null;
}


/** A/B/C banding with the action each implies. */
function performanceBand(score) {
  if (score >= 85) return { band: 'A', label: 'Top performer', action: 'Recognise and retain — these are your flight risks.' };
  if (score >= 60) return { band: 'B', label: 'Solid, needs sharpening', action: 'Coach the specific pattern shown in the breakdown.' };
  return { band: 'C', label: 'Needs intervention', action: 'Documented basis for a performance conversation or role change.' };
}

// ---------------------------------------------------------------------------
// BOARD VIEW  (the Trello-style column layout, with accountability kept intact)
// ---------------------------------------------------------------------------
/**
 * Board columns. Deliberately NOT one column per status: "Awaiting Approval"
 * and "Delegation Proposed" both mean "blocked on a manager", so they share a
 * lane. That keeps the board readable while the underlying statuses stay
 * precise.
 */
var BOARD_COLUMNS = [
  { key: 'inbox',    title: 'Needs Approval', statuses: [STATUS.AWAITING_APPROVAL, STATUS.DELEGATION_PROPOSED], accent: 'amber' },
  { key: 'todo',     title: 'To Do',          statuses: [STATUS.PENDING],      accent: 'slate' },
  { key: 'doing',    title: 'In Progress',    statuses: [STATUS.IN_PROGRESS],  accent: 'blue' },
  { key: 'review',   title: 'For Review',     statuses: [STATUS.FOR_REVIEW],   accent: 'purple' },
  { key: 'done',     title: 'Verified',       statuses: [STATUS.VERIFIED],     accent: 'green' },
];

function columnForStatus(status) {
  for (var i = 0; i < BOARD_COLUMNS.length; i++) {
    if (BOARD_COLUMNS[i].statuses.indexOf(status) > -1) return BOARD_COLUMNS[i].key;
  }
  return null;
}

/** The status a card takes when dropped into a column. */
function statusForColumn(columnKey) {
  for (var i = 0; i < BOARD_COLUMNS.length; i++) {
    if (BOARD_COLUMNS[i].key === columnKey) return BOARD_COLUMNS[i].statuses[0];
  }
  return null;
}

/**
 * Can this person drag this card into that column?
 *
 * This is where Dome Box departs from Trello on purpose. On a Trello board
 * anyone can drag anything into Done, which is exactly why a Trello board can
 * never be the basis for a performance score. Here the drop is checked against
 * the same workflow rules as the API, plus dependency and subtask gates.
 */
function canDropInColumn(task, actor, columnKey, context) {
  context = context || {};
  var target = statusForColumn(columnKey);
  if (!target) return { ok: false, reason: 'Unknown column.' };
  if (columnForStatus(task.status) === columnKey) return { ok: true, noop: true };

  if (!canTransition(task, actor, target)) {
    if (target === STATUS.VERIFIED && task.assignee === actor.username) {
      return { ok: false, reason: 'You cannot sign off your own work — it needs the person who raised it.' };
    }
    return { ok: false, reason: 'Your role does not allow that move on this task.' };
  }

  if (target === STATUS.IN_PROGRESS) {
    var blockers = openBlockers(task, context.allTasks || []);
    if (blockers.length) {
      return { ok: false, reason: 'Blocked by: ' + blockers.map(function (b) { return b.title; }).join(', ') };
    }
    var wip = wipStatus(context.allTasks || [], task.assignee, context.wipLimit);
    if (wip.exceeded) {
      return { ok: false, reason: task.assignee + ' already has ' + wip.count + ' items in progress (limit ' + wip.limit + ').' };
    }
  }

  if (target === STATUS.FOR_REVIEW) {
    var sub = subtaskProgress(task);
    if (sub.total > 0 && sub.done < sub.total) {
      return { ok: false, reason: 'Finish the checklist first (' + sub.done + '/' + sub.total + ').' };
    }
  }

  return { ok: true };
}

function groupIntoBoard(tasks) {
  var board = {};
  BOARD_COLUMNS.forEach(function (c) { board[c.key] = []; });
  (tasks || []).forEach(function (t) {
    var col = columnForStatus(t.status);
    if (col) board[col].push(t);
  });
  return board;
}

// ---------------------------------------------------------------------------
// DEPENDENCIES
// ---------------------------------------------------------------------------
/** Blocking tasks that are not yet closed. */
function openBlockers(task, allTasks) {
  var ids = task.blockedBy || [];
  if (!ids.length) return [];
  var byId = {};
  (allTasks || []).forEach(function (t) { byId[t.id] = t; });
  var out = [];
  ids.forEach(function (id) {
    var b = byId[id];
    if (b && !isClosed(b.status)) out.push(b);
  });
  return out;
}

/**
 * Would adding `blockerId` -> `taskId` create a loop? Without this check a user
 * can build A blocks B blocks A, and every "can this start?" query afterwards
 * recurses forever.
 */
function wouldCycle(taskId, blockerId, allTasks) {
  if (taskId === blockerId) return true;
  var byId = {};
  (allTasks || []).forEach(function (t) { byId[t.id] = t; });

  // Walk up from the proposed blocker: if we reach taskId, the edge closes a loop.
  var stack = [blockerId];
  var seen = {};
  while (stack.length) {
    var cur = stack.pop();
    if (cur === taskId) return true;
    if (seen[cur]) continue;
    seen[cur] = true;
    var node = byId[cur];
    if (!node) continue;
    (node.blockedBy || []).forEach(function (up) { stack.push(up); });
  }
  return false;
}

function addDependency(taskId, blockerId, allTasks) {
  if (taskId === blockerId) return { ok: false, error: 'A task cannot block itself.' };
  var byId = {};
  (allTasks || []).forEach(function (t) { byId[t.id] = t; });
  if (!byId[taskId] || !byId[blockerId]) return { ok: false, error: 'Task not found.' };
  if ((byId[taskId].blockedBy || []).indexOf(blockerId) > -1) return { ok: false, error: 'Already blocked by that task.' };
  if (wouldCycle(taskId, blockerId, allTasks)) {
    return { ok: false, error: 'That would create a circular dependency.' };
  }
  return { ok: true, blockedBy: (byId[taskId].blockedBy || []).concat([blockerId]) };
}

// ---------------------------------------------------------------------------
// SUBTASKS / CHECKLIST
// ---------------------------------------------------------------------------
function subtaskProgress(task) {
  var items = task.subtasks || [];
  var done = items.filter(function (i) { return !!i.done; }).length;
  return { total: items.length, done: done, pct: items.length ? Math.round(done / items.length * 100) : 0 };
}

// ---------------------------------------------------------------------------
// WIP LIMIT — the one Kanban rule that actually changes behaviour: cap how much
// a person may have in progress at once, so "everything is started, nothing is
// finished" becomes visible instead of normal.
// ---------------------------------------------------------------------------
var DEFAULT_WIP_LIMIT = 5;

function wipStatus(allTasks, username, limit) {
  // 0 is a meaningful value here ("no limit"), so it must not fall through to
  // the default the way `limit || DEFAULT` would.
  var cap = (limit === undefined || limit === null || limit === '') ? DEFAULT_WIP_LIMIT : Number(limit);
  if (isNaN(cap) || cap < 0) cap = DEFAULT_WIP_LIMIT;
  var count = (allTasks || []).filter(function (t) {
    return t.assignee === username && t.status === STATUS.IN_PROGRESS;
  }).length;
  return { count: count, limit: cap, exceeded: cap > 0 && count >= cap, nearing: cap > 0 && count === cap - 1 };
}

// ---------------------------------------------------------------------------
// AUTOMATIONS — the Monday.com-style "when X then Y", evaluated server-side so
// a rule cannot be bypassed by a crafted request from the browser.
// ---------------------------------------------------------------------------
var TRIGGERS = {
  STATUS_CHANGED: 'status_changed',
  OVERDUE:        'became_overdue',
  CREATED:        'created',
  REWORKED:       'sent_for_rework',
  VERIFIED:       'verified',
};
var ACTIONS = {
  NOTIFY:        'notify',
  ESCALATE:      'escalate_to_manager',
  SET_PRIORITY:  'set_priority',
  ADD_LABEL:     'add_label',
  REASSIGN:      'reassign',
};

/**
 * Returns the actions a rule set produces for one event. Pure: it decides what
 * should happen, the caller performs it. That split is what makes automations
 * testable rather than a pile of side effects.
 *
 * rule = { on, if: {field, op, value}, then: {action, ...}, active }
 */
function evaluateAutomations(rules, event, task) {
  var out = [];
  (rules || []).forEach(function (rule) {
    if (rule.active === false) return;
    if (rule.on !== event.type) return;
    if (rule.if && !matchCondition(rule.if, task, event)) return;
    out.push(Object.assign({ ruleName: rule.name || rule.on }, rule.then));
  });
  return out;
}

function matchCondition(cond, task, event) {
  var actual = cond.field === 'toStatus' ? event.toStatus
             : cond.field === 'fromStatus' ? event.fromStatus
             : task[cond.field];
  var expected = cond.value;
  switch (cond.op || 'eq') {
    case 'eq':  return String(actual) === String(expected);
    case 'ne':  return String(actual) !== String(expected);
    case 'gte': return Number(actual) >= Number(expected);
    case 'lte': return Number(actual) <= Number(expected);
    case 'in':  return (expected || []).map(String).indexOf(String(actual)) > -1;
    case 'contains': return String(actual || '').toLowerCase().indexOf(String(expected).toLowerCase()) > -1;
    default: return false;
  }
}

/** Sensible defaults so a new workspace has useful automation on day one. */
function defaultAutomations() {
  return [
    { name: 'High-priority rework escalates', on: TRIGGERS.REWORKED,
      if: { field: 'priority', op: 'eq', value: 'High' },
      then: { action: ACTIONS.ESCALATE, to: 'assigneeManager' }, active: true },
    { name: 'Overdue 3 days escalates to manager', on: TRIGGERS.OVERDUE,
      if: { field: 'daysOverdue', op: 'gte', value: 3 },
      then: { action: ACTIONS.ESCALATE, to: 'assigneeManager' }, active: true },
    { name: 'Notify the raiser on hand-in', on: TRIGGERS.STATUS_CHANGED,
      if: { field: 'toStatus', op: 'eq', value: STATUS.FOR_REVIEW },
      then: { action: ACTIONS.NOTIFY, to: 'raisedBy' }, active: true },
    { name: 'Notify the owner when verified', on: TRIGGERS.VERIFIED,
      then: { action: ACTIONS.NOTIFY, to: 'assignee' }, active: true },
  ];
}

// ---------------------------------------------------------------------------
// REMINDER DIGEST — what one person needs to be told today. Pure, so the
// scheduler can be tested without sending a single email.
// ---------------------------------------------------------------------------
function buildDigest(tasks, user, today, opts) {
  opts = opts || {};
  today = today || new Date();
  var escalateAfter = Number(opts.escalateAfterDays || 3);

  // Only chase somebody about work the ball is actually with. Once it is in
  // For Review it is the reviewer's move (it shows up in THEIR digest under
  // "ready for your review"), and Awaiting Approval is the approver's move.
  // Reminding the person who already delivered is how a nagging system trains
  // people to ignore it.
  var mine = tasks.filter(function (t) {
    return t.assignee === user.username &&
      (t.status === STATUS.PENDING || t.status === STATUS.IN_PROGRESS);
  });
  var bucket = { overdue: [], dueToday: [], dueTomorrow: [], rework: [], awaitingMyReview: [], awaitingMyApproval: [], teamOverdue: [] };

  mine.forEach(function (t) {
    var due = parseYmd(t.due);
    var late = due ? dayDiff(today, due) : null;
    if (Number(t.reworkCount || 0) > 0 && t.status === STATUS.IN_PROGRESS) bucket.rework.push(t);
    if (late === null) return;
    if (late > 0) bucket.overdue.push(Object.assign({ daysOverdue: late }, t));
    else if (late === 0) bucket.dueToday.push(t);
    else if (late === -1) bucket.dueTomorrow.push(t);
  });

  tasks.forEach(function (t) {
    if (t.status === STATUS.FOR_REVIEW && t.raisedBy === user.username) bucket.awaitingMyReview.push(t);
    if ((t.status === STATUS.AWAITING_APPROVAL || t.status === STATUS.DELEGATION_PROPOSED) && t.approver === user.username) bucket.awaitingMyApproval.push(t);
  });

  // A manager also needs their team's badly overdue work, which is the point at
  // which chasing should stop being the manager's job and start being the system's.
  (opts.reports || []).forEach(function (reportUsername) {
    tasks.forEach(function (t) {
      if (t.assignee !== reportUsername || !isOpen(t.status)) return;
      var due = parseYmd(t.due);
      var late = due ? dayDiff(today, due) : 0;
      if (late >= escalateAfter) bucket.teamOverdue.push(Object.assign({ daysOverdue: late }, t));
    });
  });

  bucket.overdue.sort(function (a, b) { return b.daysOverdue - a.daysOverdue; });
  bucket.teamOverdue.sort(function (a, b) { return b.daysOverdue - a.daysOverdue; });

  var total = bucket.overdue.length + bucket.dueToday.length + bucket.dueTomorrow.length +
              bucket.awaitingMyReview.length + bucket.awaitingMyApproval.length + bucket.teamOverdue.length;
  return { user: user, buckets: bucket, total: total, isEmpty: total === 0 };
}

// ---------------------------------------------------------------------------
// PERIOD SCORING — weekly / monthly / quarterly / yearly
// ---------------------------------------------------------------------------
var PERIOD = { WEEK: 'week', MONTH: 'month', QUARTER: 'quarter', YEAR: 'year' };

function startOfWeek(d) {           // ISO week: Monday
  var x = startOfDay(d);
  var dow = (x.getDay() + 6) % 7;   // Mon=0 … Sun=6
  return addDays(x, -dow);
}
function isoWeekNumber(d) {
  var x = startOfDay(d);
  x.setDate(x.getDate() + 4 - ((x.getDay() + 6) % 7 + 1));  // nearest Thursday
  var yearStart = new Date(x.getFullYear(), 0, 1);
  return Math.ceil((((x - yearStart) / 86400000) + 1) / 7);
}

/**
 * The window for a period, `offset` back from today (0 = current).
 * Returns inclusive `from`/`to` day boundaries plus a short and long label.
 */
function periodRange(kind, offset, today) {
  offset = Number(offset || 0);
  var now = startOfDay(today || new Date());
  var from, to, label, short;
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  if (kind === PERIOD.WEEK) {
    from = addDays(startOfWeek(now), -7 * offset);
    to = addDays(from, 6);
    short = 'W' + isoWeekNumber(from);
    label = 'Week ' + isoWeekNumber(from) + ' · ' + MONTHS[from.getMonth()] + ' ' + from.getDate();
  } else if (kind === PERIOD.MONTH) {
    var m = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    from = m;
    to = new Date(m.getFullYear(), m.getMonth() + 1, 0);
    short = MONTHS[from.getMonth()];
    label = MONTHS[from.getMonth()] + ' ' + from.getFullYear();
  } else if (kind === PERIOD.QUARTER) {
    var qBase = new Date(now.getFullYear(), now.getMonth(), 1);
    var qIndex = Math.floor(qBase.getMonth() / 3) - offset;
    var qYear = qBase.getFullYear() + Math.floor(qIndex / 4);
    var qMonth = ((qIndex % 4) + 4) % 4 * 3;
    from = new Date(qYear, qMonth, 1);
    to = new Date(qYear, qMonth + 3, 0);
    short = 'Q' + (Math.floor(qMonth / 3) + 1);
    label = 'Q' + (Math.floor(qMonth / 3) + 1) + ' ' + qYear;
  } else {
    var y = now.getFullYear() - offset;
    from = new Date(y, 0, 1);
    to = new Date(y, 11, 31);
    short = String(y);
    label = String(y);
  }
  return { kind: kind, from: startOfDay(from), to: startOfDay(to), label: label, short: short, offset: offset };
}

/** When a task counts as delivered — the verification date. */
function closedAt(task) {
  var history = task.history || [];
  for (var i = history.length - 1; i >= 0; i--) {
    if (history[i].status === STATUS.VERIFIED) return new Date(history[i].date);
  }
  return null;
}

function inWindow(date, range) {
  if (!date) return false;
  var d = startOfDay(date);
  return d >= range.from && d <= range.to;
}

/**
 * Score for one person over one period.
 *
 * A task belongs to the period it was CLOSED in, so "your March score" means
 * the work you finished in March — not everything that happens to be open now.
 * Queue health is judged as at the end of the window, so a historic period is
 * measured on how the queue looked then rather than how it looks today.
 */
function scoreForPeriod(tasks, username, range, cal) {
  var closedInWindow = tasks.filter(function (t) {
    return t.assignee === username && t.status === STATUS.VERIFIED && inWindow(closedAt(t), range);
  });

  // Work that was open at the end of the window: raised on or before it, and
  // either still open now or closed after the window ended.
  var openThen = tasks.filter(function (t) {
    if (t.assignee !== username) return false;
    var due = parseYmd(t.due);
    if (!due || due > range.to) return false;
    var closed = closedAt(t);
    if (closed && startOfDay(closed) <= range.to) return false;
    return t.status === STATUS.PENDING || t.status === STATUS.IN_PROGRESS || isClosed(t.status) === false;
  }).map(function (t) {
    return { assignee: t.assignee, status: STATUS.PENDING, title: t.title, due: t.due, priority: t.priority, reworkCount: t.reworkCount, history: [] };
  });

  /**
   * Work that is waiting on this person as approver or reviewer. delegationScore
   * reads it off the task list it is handed, so it has to survive the filtering
   * above — without it a manager who owns no tasks is handed an empty list and
   * scores "no data" every period, which is exactly the person the responsiveness
   * path exists to keep measurable.
   */
  var waitingOnThem = tasks.filter(function (t) {
    if (t.assignee === username) return false;
    /* Gated on when the item LANDED on their desk, not on the task's deadline.
       Keying it to the deadline hid every held review of work that was not due
       until next month — which is precisely the work it is easiest to sit on. */
    return queueSpells(t).some(function (sp) {
      return sp.holder === username && startOfDay(sp.from) <= range.to;
    });
  });

  var asOf = range.to > startOfDay(new Date()) ? new Date() : range.to;
  var result = delegationScore(closedInWindow.concat(openThen).concat(waitingOnThem), username, asOf, cal);
  result.range = { label: range.label, short: range.short, from: ymd(range.from), to: ymd(range.to) };
  result.delivered = closedInWindow.length;
  result.openThen = openThen.length;
  result.awaitingThem = waitingOnThem.length;

  /**
   * A period score has to be earned inside the period. Without this gate, someone
   * who closed nothing in the window still scores — purely on the queue health of
   * work carried in from earlier — so on day 1 of a month a person with two old
   * overdue tasks lands a 26 and gets banded "C · Needs action" for a month that
   * has barely started. That is a snapshot of their open queue, not a measure of
   * a period's performance, and it is the kind of number that loses an appraisal
   * conversation. Delivery in the window, or a review queue they were sitting on,
   * is the evidence; without either, the honest answer is "no data yet".
   */
  var responsivenessOnly = result.components.length === 1 && result.components[0].key === 'responsiveness';
  if (result.hasData && !responsivenessOnly && closedInWindow.length === 0) {
    result.hasData = false;
    result.score = 0;
    result.reason = openThen.length
      ? 'Nothing closed in this period — ' + openThen.length + ' item(s) still open. Carried-over work is not scored here.'
      : 'Nothing closed in this period.';
  }
  return result;
}

/** A trend of the last `count` periods, oldest first — ready to plot. */
function scoreTrend(tasks, username, kind, count, today, endOffset, cal) {
  var end = Number(endOffset) || 0;
  var out = [];
  for (var i = count - 1 + end; i >= end; i--) {
    var range = periodRange(kind, i, today);
    var s = scoreForPeriod(tasks, username, range, cal);
    out.push({
      label: range.label, short: range.short,
      score: s.hasData ? s.score : null,
      delivered: s.delivered,
      hasData: s.hasData,
      components: s.components,
    });
  }
  return out;
}

/**
 * Everything the analytics dashboard needs for one period, in one pass:
 * headline counts, per-person scores, KRA split and the A/B/C spread.
 */
function periodAnalytics(tasks, users, range, today, cal) {
  var delivered = [], overdueNow = [], reworkLoops = 0, onTime = 0, onTimeBase = 0;

  tasks.forEach(function (t) {
    var closed = closedAt(t);
    if (t.status === STATUS.VERIFIED && inWindow(closed, range)) {
      delivered.push(t);
      reworkLoops += Number(t.reworkCount || 0);
      var sub = submittedAt(t), due = parseYmd(t.due);
      if (sub && due) { onTimeBase++; if (chargeableLateDays(due, sub, t.assignee, cal) <= 0) onTime++; }
    }
    var d = parseYmd(t.due);
    if (isOpen(t.status) && d && dayDiff(today || new Date(), d) > 0) overdueNow.push(t);
  });

  var people = users.map(function (u) {
    var s = scoreForPeriod(tasks, u.username, range, cal);
    return {
      username: u.username, name: u.name, role: u.role, dept: u.dept,
      score: s.hasData ? s.score : null, hasData: s.hasData,
      delivered: s.delivered, components: s.components,
      band: s.hasData ? performanceBand(s.score).band : null,
      reason: s.hasData ? null : (s.reason || 'Nothing closed in this period.'),
    };
  });

  var kra = {};
  delivered.forEach(function (t) { var k = t.kra || 'Unassigned'; kra[k] = (kra[k] || 0) + 1; });
  var kraRows = Object.keys(kra).map(function (k) { return { kra: k, count: kra[k] }; })
    .sort(function (a, b) { return b.count - a.count; });

  var bands = { A: 0, B: 0, C: 0, none: 0 };
  people.forEach(function (p) { bands[p.band || 'none']++; });

  var scored = people.filter(function (p) { return p.hasData; });
  return {
    range: { label: range.label, short: range.short, from: ymd(range.from), to: ymd(range.to) },
    delivered: delivered.length,
    overdueNow: overdueNow.length,
    reworkLoops: reworkLoops,
    onTimeRate: onTimeBase ? Math.round(onTime / onTimeBase * 100) : null,
    teamScore: scored.length ? Math.round(scored.reduce(function (s, p) { return s + p.score; }, 0) / scored.length) : null,
    people: people,
    kra: kraRows,
    bands: bands,
  };
}

// Export for the Node test harness; harmless inside Apps Script.
