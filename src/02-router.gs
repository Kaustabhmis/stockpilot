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
      case 'register':
        throttle_('reg', (p.form && p.form.email) || '', PUBLIC_LIMITS.register);
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
        throttle_('cs', (p.form && p.form.email) || '', PUBLIC_LIMITS.contactSales);
        return contactSales_(p.form);
    }
  }

  /* Identity comes from the signed token, never from the request body. This one
     line is the difference between "knowing a sheetId" and "being authorised". */
  var S = requireSession(p.token);
  var ctx = tenantContext_(S);

  switch (action) {
    /* --- read ------------------------------------------------------------ */
    case 'getDashboard':        return getDashboard_(ctx);
    case 'getTasks':            return { status:'success',
                                        tasks: visibleTasks_(ctx, readTasks_(ctx)) };
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
    case 'updateCategories':    return updateCategories_(ctx, p.categories);
    case 'updatePriorities':    return updatePriorities_(ctx, p.priorities);
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
    case 'saveBilling':         return saveBilling_(ctx, p.form);
    case 'setLeaderboardVisibility': return setLeaderboardVisibility_(ctx, p.visibility);
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

  var ctx = {
    ss: ss, sheetId: session.sheetId, me: me,
    actor: { username: me.username, role: me.role, name: me.name },
    company: reg ? reg.company : '', planName: normalizePlan(reg ? reg.plan : 'Free'),
    plan: plan, daysLeft: daysLeft,
    // A lapsed paid plan keeps working for a week, then drops to read-only
    // rather than vanishing — nobody loses access to their own history.
    serviceStopped: (daysLeft !== null && daysLeft <= -7 && normalizePlan(reg ? reg.plan : 'Free') !== 'Free'),
  };

  /* One request, one context. The low-level writers invalidate the per-request
     cache through this rather than being handed a ctx they have no other use
     for. */
  CURRENT_CTX = ctx;

  /* Point the scoring engine at this workspace's own priority levels before any
     handler runs. Done once here rather than threaded through every call site:
     a weight that applied in one place and not another would be worse than not
     having custom levels at all. */
  try { setPriorityScale(readPriorities_(ctx)); }
  catch (e) { logError_('tenantContext:priorities', e.message); }

  return ctx;
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
