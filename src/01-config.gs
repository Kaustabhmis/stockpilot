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
            GLOBAL:'Global_Users', TOKENS:'Reset_Tokens', COOKIES:'Cookie_Points' };

/* Column layout. The first 15 task columns and first 9 user columns match the
   old schema exactly, so an existing tenant sheet keeps working; new fields are
   appended, which is the only shape of change that cannot corrupt old rows. */
var TASK_COLS = ['ID','Date Created','Due Date','Title','Description','Assigned By',
  'Assigned To','Status','KRA Tag','Priority','Frequency','Reworks','History JSON',
  'Job Category','Approver Manager','Spawned By','Blocked By','Subtasks JSON','Delegate To',
  /* Projects. Appended, never inserted: an existing tenant sheet keeps every
     column it had, and a task with no project is simply a task. */
  'Project ID','Project','Stage No','Stage Count','Stage Gate'];

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
