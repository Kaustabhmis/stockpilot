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
  return ContentService.createTextOutput('Domebox API is running.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ status: 'error', message: 'Malformed request.' }); }

  // Razorpay posts its own shape, not ours.
  if (body.event && body.payload) return handleRazorpayWebhook_(e, body);

  /* So does Meta. Routed from here rather than from a second doPost, because
     Apps Script has one global scope and a second doPost would replace this
     one — taking every login, task and payment with it. whatsapp.gs is
     optional, so the handler is called only if that file is in the project;
     without it the event is acknowledged and dropped, which is what Meta wants
     and is better than retrying forever against a 500. */
  if (body.object === 'whatsapp_business_account') {
    if (typeof waDoPost === 'function') return waDoPost(e);
    return ContentService.createTextOutput('EVENT_RECEIVED');
  }

  try {
    requireConfig_();
    return json_(route_(neutralizeFormulas_(body, '')));
  } catch (err) {
    /* Our own messages ("Pick a person…") are written for the user and go back
       as they are. Anything else — a script fault, a Google service error —
       could name a file, a sheet or a line of code: the user gets a generic
       message and a reference, and the detail goes to the ErrorLog sheet. */
    var msg = String(err && err.message || err);
    var internal = (err && err.name && err.name !== 'Error') ||
      /* Phrases only Google's services and the script engine produce. Our own
         messages can quote what a user typed ("Spreadsheet clean-up"), so
         plain words are not matched. */
      /^Exception:|Service invoked|Service (Spreadsheets|Drive|Gmail) |No item with the given ID|You do not have permission|is not a function|Cannot read propert|is not defined|Cannot call method/i.test(msg);
    if (internal && !/signed in|expired|Admin account/i.test(msg)) {
      var ref = Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
      logError_('route:' + String(body.action || '').slice(0, 40), '[' + ref + '] ' + msg +
        (err && err.stack ? ' | ' + String(err.stack).slice(0, 300) : ''));
      msg = 'Something went wrong on our side. Please try again. (Reference ' + ref + ')';
    }
    return json_({ status: 'error', message: msg });
  }
}

/* ---------- spreadsheet formula injection -----------------------------------
   Everything is stored in Google Sheets, where a value starting with "=" is a
   formula. Typed into a task title, "=Users!D2" would show a colleague's email
   on your own board, and "=IMPORTXML(…)" could post data to another website.
   A leading apostrophe makes Sheets store it as plain text (the apostrophe is
   not part of the value read back). Only "=" starts a formula in Sheets — "+",
   "-" and "@" do not — so phone numbers and everything else are untouched.
   Secrets and search terms are never rewritten. */
var NO_NEUTRALIZE = { action: 1, token: 1, password: 1, newPassword: 1, currentPassword: 1, q: 1, query: 1,
                      razorpay_order_id: 1, razorpay_payment_id: 1, razorpay_signature: 1 };
function neutralizeFormulas_(v, key) {
  if (typeof v === 'string') return (!NO_NEUTRALIZE[key] && v.charAt(0) === '=') ? "'" + v : v;
  if (Array.isArray(v)) return v.map(function (x) { return neutralizeFormulas_(x, key); });
  if (v && typeof v === 'object') {
    var o = {};
    Object.keys(v).forEach(function (k) { o[k] = neutralizeFormulas_(v[k], k); });
    return o;
  }
  return v;
}

/** For logs: enough to tell addresses apart, not enough to read one. */
function maskEmail_(e) {
  var s = String(e || ''), at = s.indexOf('@');
  return at > 0 ? s.charAt(0) + '•••' + s.slice(at) : (s ? '•••' : '');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

var PUBLIC_ACTIONS = ['register','login','forgotPassword','resetPassword','contactSales','ping','openDemo','getPublicInfo'];

/* The only routes a view-only (demo) session may call. An allow-list, not a
   block-list: a write route added later is closed to demo visitors by default. */
var VIEW_ONLY_ACTIONS = ['getDashboard','getArchive','getTasks','getUsers','getProjects','getOrgChart',
  'getCookies','getAnalytics','getAccountability','getPerformanceReport','getAppraisalForm',
  'getKraOverview','getKraFor','getCategories','getPriorityList','getLeaderboard','getDirection',
  'getMeetings','getMeeting','getLeave'];

/* In Domebox Lite there is nothing to buy and nothing to demo. */
var LITE_REFUSED = ['contactSales','openDemo','initiateRazorpay','paymentSuccess','getBilling',
                    'saveBilling','getInvoices'];

function route_(p) {
  var action = String(p.action || '');
  if (isLite_() && LITE_REFUSED.indexOf(action) > -1) {
    throw new Error('Plans and billing are not part of Domebox Lite.');
  }

  if (PUBLIC_ACTIONS.indexOf(action) > -1) {
    switch (action) {
      case 'ping':           return { status: 'success', time: new Date().toISOString() };
      /* What the website should say about tax: the same switch the checkout
         and the invoice obey, so the page can never promise one price and
         charge another. Nothing private — a rate and a yes or no. */
      case 'getPublicInfo':  var si = sellerIdentity_();
                             return { status: 'success', gstRegistered: si.registered, gstRate: si.rate };
      case 'register':
        throttle_('reg', (p.form && p.form.email) || '', PUBLIC_LIMITS.register);
        throttle_('regall', 'global', PUBLIC_LIMITS.registerGlobal);
        return registerCompany_(p.form);
      case 'login':          return login_(p.username, p.password);
      case 'forgotPassword':
        /* Two buckets, because they stop two different things. Per address, so
           nobody's inbox can be used as a weapon — the route deliberately
           answers the same way whether the account exists or not, which would
           otherwise make it a free email cannon pointed at any address you can
           guess. And a global one, because the daily mail quota is shared by
           every tenant: without it, one bot cycling through addresses takes
           down assignment and reminder mail for every customer at once. */
        throttle_('fp', p.email, PUBLIC_LIMITS.forgotPassword);
        throttle_('fpall', 'global', PUBLIC_LIMITS.forgotPasswordGlobal);
        return forgotPassword_(p.email);
      case 'resetPassword':  return resetPassword_(p.token, p.password);
      case 'contactSales':
        throttle_('cs', (p.form && (p.form.phone || p.form.email)) || '', PUBLIC_LIMITS.contactSales);
        throttle_('csall', 'global', PUBLIC_LIMITS.contactSalesGlobal);
        return contactSales_(p.form);
      case 'openDemo':
        throttle_('demo', 'global', PUBLIC_LIMITS.demo);
        return openDemo_(p.as);
    }
  }

  /* Identity comes from the signed token, never from the request body. This one
     line is the difference between "knowing a sheetId" and "being authorised". */
  var S = requireSession(p.token);
  if (S.viewOnly && VIEW_ONLY_ACTIONS.indexOf(action) < 0) {
    throw new Error('This is the demo, so changes are switched off. Start your free 14-day trial to ' +
                    'do this with your own team.');
  }
  var ctx = tenantContext_(S);
  ctx.viewOnly = !!S.viewOnly;

  switch (action) {
    /* --- read ------------------------------------------------------------ */
    case 'getDashboard':        return getDashboard_(ctx);
    case 'getArchive':          return getArchive_(ctx, p);
    case 'getTasks':            return { status:'success',
                                        tasks: visibleTasks_(ctx, readAllTasks_(ctx)) };
    case 'getUsers':            return getUsers_(ctx);
    case 'getProjects':         return getProjects_(ctx);
    case 'getOrgChart':         return getOrgChart_(ctx);
    case 'getCookies':          return getCookies_(ctx);
    case 'getAnalytics':        return getAnalytics_(ctx, p.period, p.offset, p.span, p.person);
    case 'getAccountability':   return getAccountability_(ctx);
    case 'getPerformanceReport':return getPerformanceReport_(ctx);
    case 'getAppraisalForm':    return getAppraisalForm_(ctx, p.username);
    case 'getKraOverview':      return getKraOverview_(ctx);
    case 'getKraFor':           return getKraFor_(ctx, p.username);
    case 'getCategories':       return { status:'success', categories: readCategories_(ctx),
                                          priorities: readPriorities_(ctx) };
    case 'getPriorityList':     return getPriorityList_(ctx, p.username, p.horizon);
    case 'getBilling':          return getBilling_(ctx);
    case 'getInvoices':         return getInvoices_(ctx);
    case 'getLeaderboard':      return getLeaderboard_(ctx, p.period, p.offset);
    case 'getDirection':        return getDirection_(ctx);
    case 'getMeetings':         return getMeetings_(ctx);
    case 'getMeeting':          return getMeeting_(ctx, p.id);

    /* --- tasks ----------------------------------------------------------- */
    case 'createTask':          return createTask_(ctx, p.form);
    case 'createProject':       return createProject_(ctx, p.form);
    case 'awardCookie':         return awardCookie_(ctx, p.data);
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
    case 'updateCategories':    return updateCategories_(ctx, p.categories, p.renames);
    case 'saveTabLayout':       return saveTabLayout_(ctx, p.layout);
    case 'updatePriorities':    return updatePriorities_(ctx, p.priorities);
    case 'setLeave':            return setLeave_(ctx, p.username, p.from, p.to, p.reason);
    /* Dates are shared — the team plans around them — but why someone is away
       is for them, their manager up the line, and an Admin. */
    case 'getLeave':            return { status:'success', leave: readLeave_(ctx).map(function (l) {
                                  return canSeePerson_(ctx, l.username) ? l
                                    : { username: l.username, from: l.from, to: l.to, reason: '', approved: l.approved }; }) };

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
    case 'saveBilling':         return saveBilling_(ctx, p.form);
    case 'setLeaderboardVisibility': return setLeaderboardVisibility_(ctx, p.visibility);

    /* --- goals, values, key numbers -------------------------------------- */
    case 'saveDirection':       return saveDirection_(ctx, p.form);
    case 'saveGoal':            return saveGoal_(ctx, p.form);
    case 'setGoalStatus':       return setGoalStatus_(ctx, p.id, p.goalStatus, p.note);
    case 'deleteGoal':          return deleteGoal_(ctx, p.id);
    case 'saveNumber':          return saveNumber_(ctx, p.form);
    case 'recordNumber':        return recordNumber_(ctx, p.id, p.value, p.week);

    /* --- meetings -------------------------------------------------------- */
    case 'startMeeting':        return startMeeting_(ctx, p.form);
    case 'meetingGo':           return meetingGo_(ctx, p.id, p.segment);
    case 'setAttendance':       return setAttendance_(ctx, p.id, p.username, p.present);
    case 'saveMinutes':         return saveMinutes_(ctx, p.id, p.text);
    case 'addMeetingItem':      return addMeetingItem_(ctx, p.id, p.form);
    case 'updateMeetingItem':   return updateMeetingItem_(ctx, p.itemId, p.form);
    case 'addMeetingAction':    return addMeetingAction_(ctx, p.id, p.form);
    case 'rateMeeting':         return rateMeeting_(ctx, p.id, p.score);
    case 'endMeeting':          return endMeeting_(ctx, p.id, false);
    case 'cancelMeeting':       return endMeeting_(ctx, p.id, true);
    case 'contactSupport':      return contactSupport_(ctx, p.form);
    case 'aiInsight':           return aiInsight_(ctx, p.question);
    case 'changePassword':      return changePassword_(ctx, p.currentPassword, p.newPassword);
    case 'signOut':             endSessions_(ctx, ctx.actor.username); return { status: 'success' };

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
  /* A session from before the switch never passed through login on the new
     build, so the upgrade is checked here as well. One property read once it
     has run. */
  ensureTenantSchema_(ss, session.sheetId);

  var reg = registryRow_(session.sheetId);
  var plan = planLimits(reg ? reg.plan : 'Free');
  var expiry = reg && reg.validUntil ? new Date(reg.validUntil) : null;
  var daysLeft = expiry && !isNaN(expiry)
    ? Math.ceil((expiry - new Date()) / 86400000) : null;

  var me = findUser_(ss, session.username);
  if (!me) throw new Error('Your account is no longer in this workspace.');
  if (me.active === false) throw new Error('This account has been deactivated.');

  var ctx = {
    ss: ss, sheetId: session.sheetId, me: me,
    actor: { username: me.username, role: me.role, name: me.name },
    company: reg ? reg.company : '', planName: normalizePlan(reg ? reg.plan : 'Free'),
    plan: plan, daysLeft: daysLeft,
    trial: !!(reg && reg.trial), trialEnded: !!(reg && reg.trialEnded),
    // A lapsed paid plan keeps working for a week, then drops to read-only
    // rather than vanishing — nobody loses access to their own history.
    serviceStopped: (daysLeft !== null && daysLeft <= -7 && normalizePlan(reg ? reg.plan : 'Free') !== 'Free'),
  };

  /* One request, one context. The low-level writers invalidate the per-request
     cache through this rather than being handed a ctx they have no other use
     for. */
  CURRENT_CTX = ctx;

  /* Signing out, a password change or a reset ends every session that existed
     before it, not just the one in this browser. A token's issue time is its
     expiry minus its fixed lifetime. */
  if (!session.viewOnly) {
    var cut = Number(readSetting_(ctx, 'signedOut:' + me.username, 0)) || 0;
    if (cut && session.expires - AUTH.SESSION_HOURS * 3600000 < cut) {
      throw new Error('Session has expired. Please sign in again.');
    }
  }

  /* Point the scoring engine at this workspace's own priority levels before any
     handler runs. Done once here rather than threaded through every call site:
     a weight that applied in one place and not another would be worse than not
     having custom levels at all. */
  try { setPriorityScale(readPriorities_(ctx)); }
  catch (e) { logError_('tenantContext:priorities', e.message); }

  return ctx;
}

/** Routes that change the team or the company's settings. */
/* ---------- whose data may this person see? ------------------------------
   One rule, used by every route that takes a person: an Admin sees everyone;
   a manager sees themselves and everybody below them in the reporting line
   (direct or further down); anyone else sees only themselves. Names, roles and
   departments stay visible to all — they are needed to assign work and to read
   the org chart — but contact details, scores, KRAs, appraisals and leave
   reasons follow this rule. */
function reportingLine_(ctx) {
  if (ctx._line) return ctx._line;
  var users = readUsers_(ctx), kids = {}, line = {};
  users.forEach(function (u) { var m = String(u.manager || '').trim(); (kids[m] = kids[m] || []).push(u.username); });
  var walk = function (who, depth) {
    if (depth > 50) return;                       // a broken loop in the chart must not hang the request
    (kids[who] || []).forEach(function (k) { if (!line[k]) { line[k] = true; walk(k, depth + 1); } });
  };
  walk(ctx.actor.username, 0);
  delete line[ctx.actor.username];
  return (ctx._line = line);
}
function canSeePerson_(ctx, username) {
  if (!username) return false;
  if (ctx.actor.role === 'Admin' || username === ctx.actor.username) return true;
  if (ctx.actor.role === 'Doer') return false;
  return !!reportingLine_(ctx)[username];
}
/** For actions on another person: an Admin, or their manager up the line. */
function requireCanManage_(ctx, username) {
  requireManager_(ctx);
  if (ctx.actor.role === 'Admin') return ctx;
  if (!reportingLine_(ctx)[username]) {
    throw new Error('That person is not in your team. Their own manager, or an Admin, can do this.');
  }
  return ctx;
}
/** A person as a colleague sees them: who they are, not how to reach or rate them. */
function publicPerson_(ctx, u) {
  if (canSeePerson_(ctx, u.username)) return u;
  var out = {};
  ['name', 'username', 'role', 'jobProfile', 'dept', 'manager', 'active'].forEach(function (k) { if (k in u) out[k] = u[k]; });
  return out;
}

/* The settings without which nothing is safe to serve. Checked on every
   request, because Apps Script has no start-up step to refuse at: a missing
   secret must close the service, not fall back to a weaker default. */
var REQUIRED_CONFIG = ['MASTER_DB_ID', 'TEMPLATE_ID', 'AUTH_PEPPER', 'TOKEN_SECRET'];
function requireConfig_() {
  var p = PropertiesService.getScriptProperties();
  var missing = REQUIRED_CONFIG.filter(function (k) { return !p.getProperty(k); });
  if (!missing.length) return;
  try { Logger.log('Refusing requests: Script Properties missing ' + missing.join(', ') + '. Run setupDomeBox().'); } catch (e) {}
  throw new Error('The service is not configured yet. Please try again later.');
}

/** Ends every session this person has open, everywhere. */
function endSessions_(ctx, username) {
  try { writeSetting_(ctx, 'signedOut:' + username, String(Date.now())); }
  catch (e) { logError_('endSessions', e.message); }
}

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
