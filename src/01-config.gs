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
    razorHook:  p.getProperty('RAZORPAY_WEBHOOK_SECRET') || '',
  };
}

/* The only address customer mail ever leaves from, and the name beside it.
   MAIL_FROM itself is a Script Property so it can be pointed somewhere else in
   a sandbox, but it defaults here and setupDomeBox() checks the alias exists. */
var MAIL_FROM_NAME = 'Dome Box';

var TAB = { USERS:'Users', TASKS:'Tasks', KRA:'KRA_Master', REVIEWS:'Reviews',
            SETTINGS:'Settings', LEAVE:'Leave', DIRECTORY:'Directory',
            GLOBAL:'Global_Users', TOKENS:'Reset_Tokens', COOKIES:'Cookie_Points',
            DIRECTION:'Direction', GOALS:'Goals', NUMBERS:'Key_Numbers', NUMBER_LOG:'Number_Log',
            MEETINGS:'Meetings', MEETING_ITEMS:'Meeting_Items' };

/* The cookie ledger, with the value an award was given for appended last. */
var COOKIE_COLS = ['Date','To','By','Points','Reason','Value'];

var DIRECTION_COLS = ['Kind','Code','Title','Detail','Order'];
var GOAL_COLS = ['ID','Level','Period','Title','Detail','Owner','Parent','Status','Note','Created','Updated'];
var NUMBER_COLS = ['ID','Name','Owner','Unit','Target','Direction','Goal','Active','Created'];
var NUMBER_LOG_COLS = ['Number','Week','Value','By','At'];
var MEETING_COLS = ['ID','Title','Date','Status','Chair','Started','Ended','Attendees JSON',
                    'Agenda JSON','Segment','Minutes','Ratings JSON','Summary JSON'];
var MEETING_ITEM_COLS = ['ID','Meeting','Kind','Text','Person','Value','Goal','Status','Horizon',
                         'By','At','Cleared In'];

/* Column layout. The first 15 task columns and first 9 user columns match the
   old schema exactly, so an existing tenant sheet keeps working; new fields are
   appended, which is the only shape of change that cannot corrupt old rows. */
var TASK_COLS = ['ID','Date Created','Due Date','Title','Description','Assigned By',
  'Assigned To','Status','KRA Tag','Priority','Frequency','Reworks','History JSON',
  'Job Category','Approver Manager','Spawned By','Blocked By','Subtasks JSON','Delegate To',
  /* Projects. Appended, never inserted: an existing tenant sheet keeps every
     column it had, and a task with no project is simply a task. */
  'Project ID','Project','Stage No','Stage Count','Stage Gate',
  /* When a repeat stops on its own. Until these existed a recurring job ran
     until a manager remembered to go and stop it by hand, which is not a
     schedule — it is a standing instruction nobody owns. */
  'Repeat Until','Repeat Count','Repeat Made',
  /* Which goal this work serves, and which meeting raised it. Appended, as
     always — an existing customer's sheet gains them without a cell moving. */
  'Goal','Raised In'];

var USER_COLS = ['Name','Username','Password','Email','Role','Job Profile','Dept',
  'Phone','Manager','Active','WIP Limit','KRAs JSON','WhatsApp OptIn'];

/**
 * Serialise a check-then-act sequence.
 *
 * appendRow is atomic on its own, so a plain write needs nothing. What needs
 * this is the pattern that reads a count or a uniqueness rule and THEN writes:
 * two people clicking at the same moment both pass the check and both write.
 * In practice that is a workspace one user over its plan cap, two accounts on
 * one email with no way to say which is which at login, or a duplicate
 * username that quietly takes over somebody else's work.
 *
 * Thirty seconds is longer than any of these sequences takes and short enough
 * that a stuck lock surfaces as a clear error rather than a hung tab. If the
 * lock cannot be had, the write does NOT go ahead — the whole point is that
 * racing through is the failure being prevented.
 */
/* The context of the request being served. Apps Script gives each request its
   own execution, so there is exactly one at a time — which is what lets a
   low-level writer invalidate the cache without being handed a ctx it has no
   other use for. */
var CURRENT_CTX = null;

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); }
  catch (e) {
    throw new Error('The workspace is busy saving something else. Try that again in a moment.');
  }
  try { return fn(); }
  finally { try { lock.releaseLock(); } catch (e) {} }
}

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
   ['RAZORPAY_KEY_SECRET', c.razorSecret, 'only needed to sell online'],
   ['RAZORPAY_WEBHOOK_SECRET', c.razorHook, 'the safety net under online payment']
  ].forEach(function (r) {
    out.push((r[1] ? '  set     ' : '  MISSING ') + r[0] + (r[1] ? '' : '   — ' + r[2]));
    if (!r[1] && r[0].indexOf('RAZORPAY') < 0) missing.push(r[0]);
  });

  /* Selling online without the webhook secret is the quiet failure that costs
     money: the browser handler only runs if the customer's tab survives the
     payment. Razorpay's webhook is what catches the one who closes it, and
     handleRazorpayWebhook_ ignores every event until this is set. */
  if (c.razorKey && c.razorSecret && !c.razorHook) {
    out.push('');
    out.push('  WARNING online payment is live but RAZORPAY_WEBHOOK_SECRET is not set.');
    out.push('          A customer who closes the tab while paying is charged and stays');
    out.push('          on Free. Razorpay Dashboard > Settings > Webhooks > Add: URL is');
    out.push('          your /exec URL, event payment.captured, then paste the secret');
    out.push('          you chose there into Script Properties under that name.');
  }

  /* The one check that cannot be done from a config value: whether this Google
     account is actually allowed to send as the brand address. Nothing
     customer-facing leaves without it, so finding out here is the difference
     between a five-minute Gmail setting and a week of silently undelivered
     password resets. */
  out.push('');
  out.push('--- SENDING ADDRESS ---');
  var aliasOk = false, aliasList = [];
  try { aliasList = GmailApp.getAliases(); aliasOk = aliasList.indexOf(c.mailFrom) > -1; }
  catch (e) { out.push('  Could not read the send-as aliases: ' + e.message); }

  if (aliasOk) {
    out.push('  ok      every email will leave from ' + c.mailFrom);
  } else {
    missing.push('a verified send-as alias for ' + c.mailFrom);
    out.push('  MISSING "' + c.mailFrom + '" is not a verified send-as alias on this account.');
    out.push('          NO customer email will be sent until it is — not notifications,');
    out.push('          not reminders, not payment reminders. Nothing is ever sent from');
    out.push('          another address instead.');
    out.push('          Fix: Gmail > Settings > Accounts and Import > Send mail as >');
    out.push('          Add another email address, then verify it. Then run this again.');
    if (aliasList.length) out.push('          Aliases this account has: ' + aliasList.join(', '));
    else out.push('          This account has no send-as aliases at all.');
  }

  /* An invoice without the supplier's legal name, address and state is not a
     document anyone can file, and the first customer to ask for one will ask
     after they have already paid. Checked here, not discovered then. */
  out.push('');
  out.push('--- INVOICING ---');
  var s = sellerIdentity_();
  out.push('  seller  ' + s.legalName + (s.address ? ', ' + s.address : ''));
  if (!s.address) { missing.push('SELLER_ADDRESS'); out.push('  MISSING SELLER_ADDRESS — an invoice must carry the supplier address.'); }
  if (!s.state)   { missing.push('SELLER_STATE');   out.push('  MISSING SELLER_STATE — without it every invoice is taxed as intra-state.'); }
  if (s.registered) {
    out.push('  ok      GSTIN ' + s.gstin + ' — tax invoices at ' + s.rate + '%, charged on top of the listed price.');
  } else {
    out.push('  note    SELLER_GSTIN is not set. Invoices will be issued with NO tax and');
    out.push('          the checkout will charge exactly the listed price. Correct while');
    out.push('          BISCS India is unregistered; set the GSTIN the day that changes,');
    out.push('          because the site tells customers prices exclude 18% GST.');
  }
  out.push('  series  next number ' + s.prefix + '/' + financialYear_(new Date()) + '/0001 onward');

  /* --- the registry ------------------------------------------------------
     Prepared here rather than named as a next step. ensureRegistry() only adds
     missing tabs and never rewrites a row, so there is nothing to be gained by
     making somebody run it separately — and plenty to lose: a registry missing
     the Invoices tab does not fail, it silently stops recording invoices. */
  out.push('');
  out.push('--- REGISTRY ---');
  if (!c.masterId) {
    out.push('  SKIPPED MASTER_DB_ID is not set yet, so there is nothing to prepare.');
  } else {
    try {
      ensureRegistry();
      out.push('  ok      tabs present: Directory, Global_Users, Reset_Tokens, Billing, Invoices');
    } catch (e) {
      missing.push('access to MASTER_DB_ID');
      out.push('  FAILED  ' + e.message);
      out.push('          Check the id is right and that this account can open that file.');
    }
  }

  /* --- the tenant template ----------------------------------------------- */
  if (c.templateId) {
    try {
      var tpl = SpreadsheetApp.openById(c.templateId);
      var names = tpl.getSheets().map(function (sh) { return sh.getName(); });
      var needed = [TAB.USERS, TAB.TASKS, TAB.SETTINGS].filter(function (n) { return names.indexOf(n) < 0; });
      if (needed.length) {
        out.push('  WARNING the template is missing ' + needed.join(', ') + '. Every new');
        out.push('          signup copies this file, so a missing tab is a broken signup.');
      } else {
        out.push('  ok      template has the tabs a new company needs');
      }
    } catch (e) {
      out.push('  FAILED  cannot open TEMPLATE_ID: ' + e.message);
    }
  }

  /* --- the scheduler ------------------------------------------------------
     The handlers live in reminders.gs, which is a SECOND file to paste into
     this project. The triggers are a property of the project either way, so
     this check works whether or not that file has been added — and the state
     it catches is the common one: code pasted, triggers never installed, and
     nothing chased for a month before anyone notices. */
  out.push('');
  out.push('--- SCHEDULER ---');
  var WANT = ['generateRecurringJobs', 'sendDailyReminders', 'sendRenewalReminders'];
  var schedulerTodo = '';
  try {
    var have = {};
    ScriptApp.getProjectTriggers().forEach(function (t) { have[t.getHandlerFunction()] = true; });
    var lacking = WANT.filter(function (fn) { return !have[fn]; });
    if (lacking.length) {
      schedulerTodo = 'Add domebox/reminders.gs to this project and run installDomeBoxSchedules()' +
        (lacking.length === WANT.length ? '' : ' — only ' + (WANT.length - lacking.length) + ' of 3 are installed') +
        '. Until then nothing is chased and no recurring task is created.';
    }
    if (!lacking.length) {
      out.push('  ok      all three daily jobs are installed');
    } else if (lacking.length === WANT.length) {
      out.push('  MISSING no scheduled jobs at all. Nothing will be chased, no recurring');
      out.push('          task will be created, and no renewal notice will go out.');
      out.push('          Fix: add domebox/reminders.gs to this project, then run');
      out.push('          installDomeBoxSchedules() once.');
    } else {
      out.push('  PARTIAL missing ' + lacking.join(', ') + '. A half-installed schedule');
      out.push('          looks fine and quietly does half the job. Run');
      out.push('          installDomeBoxSchedules() to reinstall all three.');
    }
  } catch (e) {
    out.push('  Could not read the project triggers: ' + e.message);
  }

  /* --- the deployment ----------------------------------------------------- */
  out.push('');
  out.push('--- WEB APP ---');
  var execUrl = '';
  try { execUrl = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  if (execUrl) {
    out.push('  ok      ' + execUrl);
    out.push('          This is the API_URL for the site. Set it in Netlify >');
    out.push('          Site configuration > Environment variables.');
  } else {
    out.push('  MISSING not deployed as a web app yet.');
    out.push('          Deploy > New deployment > Web app, Execute as Me, Access Anyone.');
    out.push('          Then run this again and it will print the /exec URL for you.');
  }

  /* --- what is left ------------------------------------------------------- */
  out.push('');
  out.push('=== WHAT IS LEFT ===');
  var todo = [];
  if (missing.length) todo.push('Set ' + missing.join(' and ') + ' in Project Settings > Script Properties, then run this again.');
  if (!execUrl) todo.push('Deploy as a web app, then run this again to get the /exec URL.');
  /* Repeated down here on purpose. It is the step people skip: everything
     works the day they set it up, and nothing is chased from the day after. */
  if (schedulerTodo) todo.push(schedulerTodo);
  if (c.razorKey && c.razorSecret && !c.razorHook) todo.push('Add RAZORPAY_WEBHOOK_SECRET, or a customer who closes the tab mid-payment is charged and stays on Free.');
  if (!todo.length) {
    out.push('  Nothing. This project is ready.');
  } else {
    todo.forEach(function (t, i) { out.push('  ' + (i + 1) + '. ' + t); });
  }

  out.push('');
  out.push('Back up AUTH_PEPPER somewhere safe. Losing it means every password must be reset.');
  Logger.log(out.join('\n'));
  return out.join('\n');
}

function ensureRegistry() {
  var c = CFG();
  if (!c.masterId) throw new Error('MASTER_DB_ID is not set. Run setupDomeBox().');
  var ss = SpreadsheetApp.openById(c.masterId);
  mkTab_(ss, TAB.DIRECTORY, ['Company','Email','Password','Plan','Valid Until','SheetID','Status','Created']);
  mkTab_(ss, TAB.GLOBAL,    ['Email','Password','SheetID','Username']);
  mkTab_(ss, TAB.TOKENS,    ['Token','Email','Created','Used']);
  mkTab_(ss, 'Billing',     BILLING_HEADERS);
  mkTab_(ss, 'Invoices',    INVOICE_HEADERS);
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
