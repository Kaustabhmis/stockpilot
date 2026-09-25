/**
 * HRMS Lite - Google Apps Script backend
 * Database: the Google Spreadsheet this script is bound to.
 *
 * Deploy: Extensions > Apps Script > paste this file > Deploy > New deployment
 *         > Web app > Execute as "Me" > Who has access "Anyone" > Deploy.
 * Copy the /exec URL into the API URL box on the HRMS Lite login screen.
 */

var VERSION = 3;

var SHEETS = {
  Settings:   ['key', 'value'],
  Users:      ['email', 'password', 'role', 'emp_code', 'active'],
  Employees:  ['emp_code', 'name', 'email', 'phone', 'department', 'designation',
               'doj', 'status', 'basic', 'hra', 'special_allowance', 'other_allowance',
               'pf_applicable', 'esi_applicable', 'tds_monthly', 'pan', 'uan', 'esic_no',
               'bank_account', 'ifsc', 'manager', 'dob', 'gender', 'address', 'notes',
               'updated_at', 'exit_date', 'device_id', 'company', 'shift',
               'unit', 'wage_type', 'daily_rate', 'da_rate', 'hra_rate', 'site'],
  Attendance: ['id', 'date', 'emp_code', 'status', 'in_time', 'out_time', 'hours',
               'remarks', 'updated_at'],
  Holidays:   ['id', 'date', 'name', 'optional'],
  Events:     ['id', 'date', 'name', 'type', 'note'],
  Sites:      ['id', 'name', 'lat', 'lng', 'radius_m', 'active', 'note'],
  Shifts:     ['id', 'name', 'start_time', 'end_time', 'grace_minutes', 'full_day_hours',
               'half_day_hours', 'weekly_off', 'saturday_policy', 'ot_after_minutes', 'active'],
  LeaveTypes: ['id', 'name', 'paid', 'quota', 'carry_forward', 'max_consecutive', 'notice_days',
               'allow_half_day', 'active'],
  RequestTypes: ['id', 'code', 'name', 'effect', 'paid', 'needs_approval', 'max_per_month',
                 'validity_days', 'allow_half', 'active'],
  Requests:     ['id', 'emp_code', 'type', 'date', 'to_date', 'in_time', 'out_time', 'reason',
                 'mode', 'adjust_date', 'days', 'status', 'applied_at', 'decided_by',
                 'decided_at', 'note', 'level', 'approvals'],
  CtcVariables: ['id', 'code', 'value', 'note'],
  CtcComponents: ['id', 'seq', 'code', 'name', 'section', 'kind', 'expr', 'taxable',
                  'in_gross', 'in_pf_wage', 'in_esi_wage', 'show_payslip', 'active'],
  CtcValues:    ['id', 'emp_code', 'code', 'value'],
  Notices:    ['id', 'title', 'body', 'level', 'start_date', 'end_date', 'pinned', 'active',
               'created_by', 'created_at'],
  ApprovalLevels: ['id', 'applies_to', 'level', 'approver', 'label', 'active'],
  PayslipMail: ['id', 'month', 'emp_code', 'name', 'email', 'sent_at', 'status', 'error', 'sent_by'],
  Punches:    ['id', 'punch_time', 'emp_code', 'device_id', 'device', 'direction', 'source',
               'imported_at', 'lat', 'lng', 'accuracy', 'site', 'distance_m'],
  Leave:      ['id', 'emp_code', 'type', 'from_date', 'to_date', 'days', 'reason',
               'status', 'applied_at', 'decided_by', 'decided_at', 'decision_note',
               'level', 'approvals'],
  Payroll:    ['id', 'month', 'emp_code', 'total_days', 'lop_days', 'paid_days',
               'basic', 'hra', 'special_allowance', 'other_allowance', 'gross',
               'pf', 'esi', 'pt', 'tds', 'other_deduction', 'total_deduction', 'net',
               'status', 'generated_at', 'generated_by',
               'arrears', 'bonus', 'pf_employer', 'esi_employer', 'ctc',
               'ot_hours', 'ot_amount', 'late_deduction_days', 'unpaid_leave_days',
               'incentive', 'advance_deduction']
};

var DEFAULT_SETTINGS = {
  company_name: 'My Company Pvt Ltd',
  company_address: '',
  currency: 'INR',
  pf_employee_pct: '12',
  pf_employer_pct: '13',
  pf_wage_ceiling: '15000',
  esi_employee_pct: '0.75',
  esi_employer_pct: '3.25',
  esi_wage_ceiling: '21000',
  pt_amount: '200',
  weekly_off: 'Sun',
  shift_start: '09:30',
  shift_end: '18:30',
  grace_minutes: '15',
  ot_after_minutes: '30',
  full_day_hours: '8',
  half_day_hours: '4',
  saturday_policy: 'working',
  default_shift: 'General',
  late_marks_per_halfday: '3',
  ot_pay_enabled: 'no',
  ot_rate_multiplier: '1',
  ot_max_hours_month: '60',
  sandwich_rule: 'no',
  excess_leave_unpaid: 'yes',
  leave_after_days: '0',
  payroll_basis: 'calendar',
  payroll_rounding: '1',
  essl_mode: 'none',
  essl_api_url: '',
  essl_api_user: '',
  essl_auth_style: 'basic',
  essl_device_serial: '',
  essl_push_url: '',
  essl_push_enabled: 'no',
  sql_server: '',
  sql_database: 'etimetracklite1',
  sql_table: 'DeviceLogs',
  sql_user: '',
  sync_last_pull: '',
  sync_last_push: '',
  import_companies: '',
  register_group_by: 'unit',
  bootstrap_attendance_days: '150',
  payslip_email_enabled: 'yes',
  payslip_email_attach_pdf: 'yes',
  payslip_email_subject: 'Payslip for {month} - {company}',
  payslip_email_message: 'Dear {name},\n\nPlease find your payslip for {month} attached.\n' +
    'Net pay credited: {net}.\n\nFor any correction please write back to HR within 7 days.\n\n' +
    'Regards,\n{company}',
  payslip_email_from_name: '',
  payslip_email_reply_to: '',
  payslip_email_cc: '',
  payslip_email_bcc: '',
  web_punch_enabled: 'yes',
  geofence_enabled: 'no',
  geofence_mode: 'block',
  geofence_accuracy_m: '120',
  geofence_allow_od: 'yes',
  punch_out_mandatory: 'yes',
  co_payout_enabled: 'yes',
  co_validity_days: '90',
  register_footer: '',
  keep_punch_log: 'yes',
  punch_log_days: '90',
  leave_types: 'Casual,Sick,Earned,Unpaid',
  quota_casual: '12',
  quota_sick: '6',
  quota_earned: '15'
};

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action) {
    return handle(p.action, p.payload ? JSON.parse(p.payload) : {}, p.callback, p.token);
  }
  return json({ ok: true, service: 'HRMS Lite', version: VERSION });
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { body = {}; }
  return handle(body.action, body.payload || {}, null, body.token);
}

function handle(action, payload, callback, token) {
  var out;
  try {
    /* Who is calling, and may they do this? Both are decided here, on the
       server. The browser hides buttons as a courtesy; this is the fence. */
    clearReadCache();
    var caller = authenticate(action, token);
    authorize(action, payload || {}, caller);

    var lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      REV_DIRTY = {};
      out = { ok: true, data: route(action, payload || {}, caller) };
      /* The new revision rides back with the write that caused it, so the
         screen that did the saving knows it is already up to date and does
         not reload itself over its own change. */
      var moved = bumpRevision();
      if (moved !== null) out.rev = moved;
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    var msg = String(err && err.message ? err.message : err);
    out = { ok: false, error: msg };
    if (msg.indexOf(AUTH_PREFIX) === 0) { out.authFailed = true; out.error = msg.slice(AUTH_PREFIX.length); }
  }
  return callback ? jsonp(out, callback) : json(out);
}

/* ------------------------------------------------------------------ */
/* Authentication - signed sessions                                    */
/* ------------------------------------------------------------------ */

var AUTH_PREFIX = 'AUTH:';
var SESSION_HOURS = 12;

/* Three levels of access.
     owner    - everything, including the accounts themselves and the
                integration credentials. 'admin' is the same thing under its
                old name, so installs made before this existed keep working.
     hr       - the dashboard and all five modules, and the policy settings
                they work with. Not the accounts, not the eSSL/SQL keys.
     employee - their own record and nothing else. */
var ROLES = ['owner', 'hr', 'employee'];

function isOwner(role)    { var r = String(role || ''); return r === 'owner' || r === 'admin'; }
function isHrOrAbove(role){ return isOwner(role) || String(role || '') === 'hr'; }

/* Settings only an owner may change: the biometric link and the SQL agent.
   An HR save that includes them leaves them as they were. */
var OWNER_ONLY_SETTINGS = /^(essl_|sql_|sync_)/;

/* Actions anyone may call without signing in. Everything else needs a
   session, and most of it needs an admin session. */
var PUBLIC_ACTIONS = { ping: 1, login: 1, setup: 1, ingestPunches: 1 };

/* Per-install signing key. Created on first use and never leaves the script. */
function sessionSecret() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('session_secret');
  if (!key) {
    key = Utilities.getUuid() + '-' + Utilities.getUuid();
    props.setProperty('session_secret', key);
  }
  return key;
}

function b64url(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function signToken(user) {
  var body = [
    String(user.email || '').toLowerCase(),
    String(user.role || 'employee').toLowerCase(),
    String(user.emp_code || ''),
    String(Date.now() + SESSION_HOURS * 3600 * 1000)
  ].join('|');
  var sig = b64url(Utilities.computeHmacSha256Signature(body, sessionSecret()));
  return b64url(Utilities.newBlob(body).getBytes()) + '.' + sig;
}

/* Length-independent comparison, so a wrong signature tells an attacker
   nothing by how long it took to reject. */
function sameSignature(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  for (var i = 0; i < a.length && i < b.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authenticate(action, token) {
  if (PUBLIC_ACTIONS[action]) {
    /* setup is public only while the sheet is empty, so the very first run
       needs no login. After that it is an admin action like any other. */
    if (action === 'setup' && hasUsers()) return requireSession(token);
    /* Punches arrive two ways: from HR, signed in and uploading the machine's
       report, or from the LAN agent, which has no login and carries the ingest
       token instead. Read the session when there is one, so ingestPunches can
       tell the two apart; a token that does not check out simply leaves the
       caller anonymous, and the ingest token then has to stand for them. */
    if (action === 'ingestPunches' && String(token || '')) {
      try { return requireSession(token); } catch (err) { /* fall through */ }
    }
    return { email: '', role: 'public', emp_code: '' };
  }
  return requireSession(token);
}

function requireSession(token) {
  var raw = String(token || '');
  var dot = raw.lastIndexOf('.');
  if (dot < 1) throw new Error(AUTH_PREFIX + 'Please sign in again.');

  var body;
  try {
    body = Utilities.newBlob(Utilities.base64DecodeWebSafe(raw.slice(0, dot))).getDataAsString();
  } catch (err) {
    throw new Error(AUTH_PREFIX + 'Please sign in again.');
  }
  var want = b64url(Utilities.computeHmacSha256Signature(body, sessionSecret()));
  if (!sameSignature(want, raw.slice(dot + 1))) {
    throw new Error(AUTH_PREFIX + 'Please sign in again.');
  }

  var parts = body.split('|');
  if (parts.length !== 4) throw new Error(AUTH_PREFIX + 'Please sign in again.');
  if (Number(parts[3]) < Date.now()) {
    throw new Error(AUTH_PREFIX + 'Your session has expired. Please sign in again.');
  }

  /* The token says who they were. The Users tab says who they are now, so
     a disabled account or a role taken away stops working immediately. */
  var user = findUser(parts[0]);
  if (!user) throw new Error(AUTH_PREFIX + 'This account no longer exists.');
  if (String(user.active || 'yes').toLowerCase() === 'no') {
    throw new Error(AUTH_PREFIX + 'This account is disabled.');
  }
  return {
    email: String(user.email || '').toLowerCase(),
    role: String(user.role || 'employee').toLowerCase(),
    emp_code: String(user.emp_code || '')
  };
}

function findUser(email) {
  var want = String(email || '').trim().toLowerCase();
  var users = readSheet('Users');
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email || '').trim().toLowerCase() === want) return users[i];
  }
  return null;
}

/* Looks straight at the tab. It must not go through sheet(), because that
   creates what is missing - which would run setup() from inside the check
   that decides whether setup() may run. */
function hasUsers() {
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
    return !!sh && sh.getLastRow() > 1;
  } catch (err) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Authorisation - what an employee may do                             */
/* ------------------------------------------------------------------ */

/* An employee may read their own things and ask for leave, a request, or a
   punch. Nothing else: no settings, no attendance, no payroll, no other
   person's record, whatever the browser sends. */
var EMPLOYEE_ACTIONS = {
  bootstrap: 1, changePassword: 1, punchState: 1, webPunch: 1, ping: 1,
  /* Just a number and a list of tab names - no one's data is in it. */
  rev: 1,
  save: 1, remove: 1,
  /* Allowed through to decide(), which then refuses anyone who is not the
     manager of the person the application belongs to. */
  decide: 1
};

/* The only tabs an employee may write to, and only their own rows. */
var EMPLOYEE_WRITE_SHEETS = { Leave: 1, Requests: 1, Employees: 1 };

/* What a worker may change on their own record: the details they are the
   best source for, and which cost nothing if wrong. Everything else - pay,
   bank, PF and ESI numbers, department, shift, date of joining, status,
   their manager, their device id - is the company's to set, so it is not
   listed and is dropped from whatever the browser sends. Their own name is
   not here either: it is what payroll and the bank pay against. */
var EMPLOYEE_OWN_FIELDS = {
  phone: 1, email: 1, address: 1, dob: 1, gender: 1
};

function denied() {
  throw new Error('Not allowed. Your account does not have permission for this.');
}

/* Actions reserved for an owner: the accounts and the integration
   credentials. HR runs the company; the owner runs the system. */
var OWNER_ACTIONS = {
  saveUser: 1, removeUser: 1, listUsers: 1,
  setSecret: 1, secretStatus: 1, testIntegration: 1,
  esslPull: 1, esslPush: 1
};

function authorize(action, p, caller) {
  if (caller.role === 'public') return;           // already limited to PUBLIC_ACTIONS

  if (isOwner(caller.role)) return;               // the owner may do anything

  if (isHrOrAbove(caller.role)) {                 // i.e. HR
    if (OWNER_ACTIONS[action]) {
      throw new Error('Not allowed. Only the system owner can do this.');
    }
    if (action === 'save' && p.sheet === 'Users') {
      throw new Error('Not allowed. Only the system owner can change accounts.');
    }
    if ((action === 'remove' || action === 'removeMany') && p.sheet === 'Users') {
      throw new Error('Not allowed. Only the system owner can change accounts.');
    }
    if (action === 'saveMany' && p.sheet === 'Users') {
      throw new Error('Not allowed. Only the system owner can change accounts.');
    }
    if (action === 'saveSettings') {
      /* Drop the keys they may not touch rather than refusing the whole save,
         because the settings screen sends every field it shows at once. */
      var clean = {}, blocked = [];
      Object.keys(p.settings || {}).forEach(function (k) {
        if (OWNER_ONLY_SETTINGS.test(k)) blocked.push(k); else clean[k] = p.settings[k];
      });
      p.settings = clean;
      p.blocked = blocked;
    }
    return;
  }

  if (!EMPLOYEE_ACTIONS[action]) denied();

  var code = String(caller.emp_code || '');

  if (action === 'bootstrap' || action === 'ping' || action === 'rev') return;   // read-only, already scoped
  if (action === 'decide') return;        // decide() checks the reporting line itself
  if (action === 'changePassword') {
    p.email = caller.email;                        // only ever their own
    return;
  }
  if (action === 'webPunch' || action === 'punchState') {
    if (!code) throw new Error('Your login is not linked to an employee code. Ask HR to set it.');
    p.emp_code = code;                             // never punch for someone else
    return;
  }
  if (action === 'save') {
    if (!EMPLOYEE_WRITE_SHEETS[p.sheet]) denied();
    if (!code) throw new Error('Your login is not linked to an employee code. Ask HR to set it.');

    /* Their own record: their own row, and only the fields above. The row is
       rebuilt from scratch here rather than filtered, so a field the browser
       was never meant to send cannot survive by any spelling. upsert() keeps
       whatever is left out, so the rest of the record is untouched. */
    if (p.sheet === 'Employees') {
      var sent = p.row || {};
      if (String(sent.emp_code || code) !== code) denied();
      var mine = { emp_code: code };
      Object.keys(sent).forEach(function (f) {
        if (EMPLOYEE_OWN_FIELDS[f]) mine[f] = sent[f];
      });
      /* An address is also a way in, so two people must not share one: the
         colleague whose address it really is would find their email sign-in
         landing on somebody else's account. Their staff code would still
         work, but they would have no idea why. */
      var wants = String(mine.email || '').trim().toLowerCase();
      if (wants) {
        /* The browser checks the shape too, but the browser is not the fence:
           a malformed address silently breaks their payslip delivery. */
        if (!/^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/.test(wants)) {
          throw new Error('That does not look like an email address.');
        }
        /* An address is a way in, so it must belong to one person. Checked
           against the staff list and against the accounts, so nobody can
           point their record at the HR or owner address and be sent the
           payslips and notices meant for it. */
        var all = readSheet('Employees');
        for (var n = 0; n < all.length; n++) {
          if (String(all[n].emp_code || '') === code) continue;
          if (String(all[n].email || '').trim().toLowerCase() === wants) {
            throw new Error('Somebody else on the staff list already uses that email address.');
          }
        }
        var accts = readSheet('Users');
        for (var q = 0; q < accts.length; q++) {
          if (String(accts[q].emp_code || '') === code) continue;
          if (String(accts[q].email || '').trim().toLowerCase() === wants) {
            throw new Error('That email address is already in use.');
          }
        }
      }
      p.row = mine;
      return;
    }

    var row = p.row || {};
    var existing = row.id ? findById(p.sheet, row.id) : null;
    if (existing && String(existing.emp_code) !== code) denied();
    if (existing && String(existing.status || '') !== 'Pending') {
      throw new Error('This has already been decided and cannot be changed.');
    }
    row.emp_code = code;                           // always their own
    /* They may raise it or withdraw it. They may not approve it. */
    var wanted = String(row.status || 'Pending');
    row.status = wanted === 'Cancelled' ? 'Cancelled' : 'Pending';
    delete row.decided_by; delete row.decided_at;
    delete row.decision_note; delete row.note;
    p.row = row;
    return;
  }
  if (action === 'remove') {
    if (!EMPLOYEE_WRITE_SHEETS[p.sheet]) denied();
    if (p.sheet === 'Employees') denied();   /* they may edit theirs, never delete it */
    var mine = findById(p.sheet, p.id);
    if (!mine || String(mine.emp_code) !== code) denied();
    if (String(mine.status || '') !== 'Pending') {
      throw new Error('This has already been decided and cannot be withdrawn.');
    }
    return;
  }
  denied();
}

function findById(sheetName, id) {
  if (!SHEETS[sheetName]) return null;
  var rows = readSheet(sheetName);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === String(id)) return rows[i];
  }
  return null;
}

function route(action, p, caller) {
  switch (action) {
    case 'ping':        return { service: 'HRMS Lite', version: VERSION };
    case 'rev':         return currentRevision(caller);
    case 'makeLogins':  return backfillAccounts();
    case 'setup':       return setup();
    case 'login':       return login(p.email, p.password);
    case 'bootstrap':   return bootstrap(caller);
    case 'list':        return readSheet(p.sheet);
    case 'save':        return upsert(p.sheet, p.row);
    case 'saveMany':    return upsertMany(p.sheet, p.rows);
    case 'remove':      return removeRow(p.sheet, p.id);
    case 'removeMany':  return removeMany(p.sheet, p.ids);
    case 'saveSettings':return saveSettings(p.settings);
    case 'changePassword': return changePassword(caller.email || p.email, p.oldPassword, p.newPassword);
    case 'setSecret':     return setSecret(p.key, p.value);
    case 'secretStatus':  return secretStatus();
    case 'esslPull':      return esslPull(p.from, p.to);
    case 'esslPush':      return esslPush(p.month, p.rows);
    case 'ingestPunches': return ingestPunches(p.punches, p.token, p.source, caller);
    case 'testIntegration': return testIntegration();
    case 'webPunch':      return webPunch(p.emp_code, p.kind, p.note, p.geo, caller);
    case 'punchState':    return punchState(p.emp_code);
    case 'punchLog':      return punchLog(p.from, p.to);
    case 'sendPayslips':  return sendPayslips(p, caller);
    case 'mailQuota':     return { left: MailApp.getRemainingDailyQuota(), from: senderAddress() };
    case 'payslipMailLog': return payslipMailLog(p.month);
    case 'listUsers':     return listUsers();
    case 'saveUser':      return saveUser(p.user, caller);
    case 'removeUser':    return removeUser(p.email, caller);
    case 'decide':        return decide(p.sheet, p.id, p.status, p.note, caller);
    default: throw new Error('Unknown action: ' + action);
  }
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

function setup() {
  // Creates every tab, seeds Settings and the first admin user. Safe to re-run.
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var created = [];
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); created.push(name); }
    var headers = SHEETS[name];
    var current = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
    if (current.join('|') !== headers.join('|')) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }
  });

  // Seed settings
  var settings = settingsMap();
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
    if (!(k in settings)) appendRow('Settings', { key: k, value: DEFAULT_SETTINGS[k] });
  });

  // Seed one shift and the standard leave types, so the rules are never empty
  if (readSheet('Shifts').length === 0) {
    appendRow('Shifts', {
      id: newId(), name: 'General', start_time: '09:30', end_time: '18:30', grace_minutes: '15',
      full_day_hours: '8', half_day_hours: '4', weekly_off: 'Sun', saturday_policy: 'working',
      ot_after_minutes: '30', active: 'yes'
    });
  }
  if (readSheet('LeaveTypes').length === 0) {
    [['Casual', 'yes', '12', 'no', '3', '1', 'yes'],
     ['Sick', 'yes', '6', 'no', '3', '0', 'yes'],
     ['Earned', 'yes', '15', 'yes', '15', '7', 'no'],
     ['Unpaid', 'no', '0', 'no', '30', '1', 'yes']].forEach(function (t) {
      appendRow('LeaveTypes', {
        id: newId(), name: t[0], paid: t[1], quota: t[2], carry_forward: t[3],
        max_consecutive: t[4], notice_days: t[5], allow_half_day: t[6], active: 'yes'
      });
    });
  }

  // Seed the request types: out-of-office duty, a missed-punch correction and
  // compensatory off for working a weekly off or a holiday.
  if (readSheet('RequestTypes').length === 0) {
    [['OD', 'Out of office duty', 'present', 'yes', 'yes', '0', '0', 'yes'],
     ['SWIPE', 'Swipe request (missed punch)', 'times', 'yes', 'yes', '3', '0', 'no'],
     ['CO', 'Compensatory off', 'comp_off', 'yes', 'yes', '0', '90', 'yes']
    ].forEach(function (t) {
      appendRow('RequestTypes', {
        id: newId(), code: t[0], name: t[1], effect: t[2], paid: t[3], needs_approval: t[4],
        max_per_month: t[5], validity_days: t[6], allow_half: t[7], active: 'yes'
      });
    });
  }

  // Seed the approval chain, so it is visible and editable in Settings rather
  // than an invisible default: the reporting manager first, then HR.
  if (readSheet('ApprovalLevels').length === 0) {
    [['all', 1, 'manager', 'Reporting manager'],
     ['all', 2, 'hr', 'HR']
    ].forEach(function (a) {
      appendRow('ApprovalLevels', {
        id: newId(), applies_to: a[0], level: a[1], approver: a[2], label: a[3], active: 'yes'
      });
    });
  }

  // Seed the salary structure. These are the rules read off the company's own
  // CTC sheet, so a fresh setup already matches what payroll is expected to do.
  if (readSheet('CtcVariables').length === 0) {
    [['basic_pct', '0.60', 'Basic as a share of gross'],
     ['hra_pct', '0.40', 'HRA as a share of gross'],
     ['pf_employee_pct', '0.12', 'PF employee share, on basic'],
     ['pf_employer_pct', '0.13', 'PF employer share, on basic'],
     ['esi_employee_pct', '0.0075', 'ESI employee share, on gross'],
     ['esi_employer_pct', '0.0325', 'ESI employer share, on gross'],
     ['esi_ceiling', '21000', 'No ESI above this monthly gross'],
     ['leave_pct', '0.32', 'Paid-leave component, share of gross'],
     ['bonus_months_basic', '1', 'Annual bonus as months of basic']
    ].forEach(function (v) {
      appendRow('CtcVariables', { id: newId(), code: v[0], value: v[1], note: v[2] });
    });
  }
  if (readSheet('CtcComponents').length === 0) {
    [[10, 'gross', 'Gross Salary', 'input', 'input', '0', 'yes', 'yes', 'no', 'no', 'no'],
     [20, 'basic', 'Basic Salary', 'earning', 'formula', 'gross * basic_pct', 'yes', 'no', 'yes', 'no', 'yes'],
     [30, 'hra', 'HRA', 'earning', 'formula', 'gross * hra_pct', 'yes', 'no', 'no', 'no', 'yes'],
     [40, 'conveyance', 'Conveyance allowance', 'earning', 'formula', 'gross - basic - hra', 'yes', 'no', 'no', 'no', 'yes'],
     [50, 'esi_employee', 'ESIC @0.75% of gross', 'deduction', 'formula',
      'if(gross <= esi_ceiling, gross * esi_employee_pct, 0)', 'no', 'no', 'no', 'no', 'yes'],
     [60, 'pf_employee', 'PF @12% of basic', 'deduction', 'formula', 'basic * pf_employee_pct', 'no', 'no', 'no', 'no', 'yes'],
     [70, 'ptax', 'P.Tax', 'deduction', 'formula',
      'slab(gross, 10000:0, 15000:110, 25000:130, 40000:150, 99999999:200)', 'no', 'no', 'no', 'no', 'yes'],
     [80, 'deductions', 'Total deductions', 'summary', 'formula', 'esi_employee + pf_employee + ptax', 'no', 'no', 'no', 'no', 'yes'],
     [90, 'esi_employer', 'ESIC @3.25% of gross', 'employer', 'formula',
      'if(gross <= esi_ceiling, gross * esi_employer_pct, 0)', 'no', 'no', 'no', 'no', 'no'],
     [100, 'pf_employer', 'PF @13% of basic', 'employer', 'formula', 'basic * pf_employer_pct', 'no', 'no', 'no', 'no', 'no'],
     [110, 'employer_total', 'Company contribution', 'summary', 'formula', 'esi_employer + pf_employer', 'no', 'no', 'no', 'no', 'no'],
     [120, 'net_pay', 'Net: in hand per month', 'summary', 'formula', 'gross - deductions', 'no', 'no', 'no', 'no', 'yes'],
     [130, 'pf_total_month', 'PF deposit per month', 'summary', 'formula', 'pf_employee + pf_employer', 'no', 'no', 'no', 'no', 'no'],
     [140, 'pf_total_year', 'PF deposit per annum', 'summary', 'formula', 'pf_total_month * 12', 'no', 'no', 'no', 'no', 'no'],
     [150, 'annual_bonus', 'Annual bonus (1 month basic)', 'summary', 'formula', 'basic * bonus_months_basic', 'no', 'no', 'no', 'no', 'no'],
     [160, 'cost_month', 'Cost per month', 'summary', 'formula', 'gross + employer_total', 'no', 'no', 'no', 'no', 'no'],
     [170, 'leave_component', 'Paid leave component', 'summary', 'formula', 'gross * leave_pct', 'no', 'no', 'no', 'no', 'no'],
     [180, 'ctc_year', 'CTC per annum', 'summary', 'formula', 'cost_month * 12 + annual_bonus + leave_component', 'no', 'no', 'no', 'no', 'no'],
     [190, 'ctc_month', 'Cost to company per month', 'summary', 'formula', 'ctc_year / 12', 'no', 'no', 'no', 'no', 'no'],
     [200, 'remark', 'Remark', 'info', 'text', '', 'no', 'no', 'no', 'no', 'no']
    ].forEach(function (c) {
      appendRow('CtcComponents', {
        id: newId(), seq: c[0], code: c[1], name: c[2], section: c[3], kind: c[4], expr: c[5],
        taxable: c[6], in_gross: c[7], in_pf_wage: c[8], in_esi_wage: c[9], show_payslip: c[10],
        active: 'yes'
      });
    });
  }

  // Seed the first admin user
  if (readSheet('Users').length === 0) {
    appendRow('Users', {
      email: 'admin@company.com',
      password: hash('admin123'),
      role: 'admin',
      emp_code: '',
      active: 'yes'
    });
  }

  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0) ss.deleteSheet(blank);

  // The key that signs login sessions. Created once, then left alone.
  sessionSecret();

  var summary = {
    version: VERSION,
    created: created,
    sheets: Object.keys(SHEETS),
    employees: readSheet('Employees').length,
    users: readSheet('Users').length,
    admin: firstAdminEmail(),
    timezone: Session.getScriptTimeZone(),
    url: webAppUrl()
  };
  return summary;
}

function firstAdminEmail() {
  var users = readSheet('Users'), out = '';
  users.forEach(function (u) {
    if (!out && String(u.role || '').toLowerCase() === 'admin') out = String(u.email || '');
  });
  return out;
}

function webAppUrl() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (err) { return ''; }
}

/* ------------------------------------------------------------------ */
/* One-click setup from the spreadsheet                                */
/* ------------------------------------------------------------------ */

/* Puts an "HRMS" menu in the spreadsheet, so setup is a menu click rather
   than a trip into the script editor. Runs by itself when the sheet opens. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('HRMS')
    .addItem('Set up / update the database', 'setupFromMenu')
    .addItem('Show the web app link', 'showWebAppUrl')
    .addSeparator()
    .addItem('Reset the admin password', 'resetAdminPassword')
    .addToUi();
}

function setupFromMenu() {
  var ui = SpreadsheetApp.getUi();
  var r;
  try {
    r = setup();
  } catch (err) {
    ui.alert('Setup failed', String(err && err.message ? err.message : err), ui.ButtonSet.OK);
    return;
  }
  ui.alert('HRMS is ready',
    (r.created.length
      ? 'Created ' + r.created.length + ' tab(s): ' + r.created.join(', ')
      : 'All ' + r.sheets.length + ' tabs were already there and have been checked.') +
    '\n\nTabs: ' + r.sheets.length +
    '\nEmployees: ' + r.employees +
    '\nLogins: ' + r.users +
    '\nTime zone: ' + r.timezone +
    '\n\nSign in as ' + (r.admin || 'admin@company.com') + ' with the password admin123, ' +
    'then change it from Settings \u2192 Account.' +
    (r.url ? '\n\nWeb app link:\n' + r.url
           : '\n\nNow deploy it: Deploy \u2192 New deployment \u2192 Web app, ' +
             'execute as Me, access Anyone.'),
    ui.ButtonSet.OK);
}

function showWebAppUrl() {
  var ui = SpreadsheetApp.getUi();
  var url = webAppUrl();
  ui.alert('Web app link',
    url ? url + '\n\nPaste this into the HRMS file once, and everyone else just signs in.'
        : 'Not deployed yet. Deploy \u2192 New deployment \u2192 Web app, ' +
          'execute as Me, access Anyone.',
    ui.ButtonSet.OK);
}

/* For when the admin password is lost - the only way back in, and it can only
   be done by someone who can already open the spreadsheet. */
function resetAdminPassword() {
  var ui = SpreadsheetApp.getUi();
  var email = firstAdminEmail();
  if (!email) { ui.alert('No admin account found. Run setup first.'); return; }
  var answer = ui.prompt('Reset the password for ' + email,
    'Type the new password (at least 6 characters):', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  var pw = String(answer.getResponseText() || '');
  if (pw.length < 6) { ui.alert('That password is too short. Nothing was changed.'); return; }
  var rows = indexed('Users');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].data.email).trim().toLowerCase() === email.toLowerCase()) {
      sheet('Users').getRange(rows[i].row, SHEETS.Users.indexOf('password') + 1)
        .setValue(hash(pw));
      ui.alert('Password changed for ' + email + '.');
      return;
    }
  }
  ui.alert('Could not find that account.');
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

function login(email, password) {
  var users = readSheet('Users');
  var typed = String(email || '').trim().toLowerCase();
  var user = null;
  /* Either identifies them: the email HR holds, or the staff code on their ID
     card. A worker with no company email knows only the code, and asking a
     fitter to remember an address nobody ever gave him is how a system ends
     up unused. The email is tried first, so a code that happens to look like
     somebody's address can never take precedence over a real one. */
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email || '').trim().toLowerCase() === typed) { user = users[i]; break; }
  }
  if (!user) {
    for (var j = 0; j < users.length; j++) {
      if (String(users[j].emp_code || '').trim().toLowerCase() === typed) { user = users[j]; break; }
    }
  }
  /* Their company email, which is on the employee record rather than on the
     account. The account is keyed by staff code, so an office worker who
     types the address they use all day would otherwise be turned away.
     Looked up only when the first two found nothing, so the usual sign-in
     still reads one tab. */
  if (!user && typed.indexOf('@') > 0) {
    var staff = readSheet('Employees');
    for (var k = 0; k < staff.length; k++) {
      if (String(staff[k].email || '').trim().toLowerCase() !== typed) continue;
      var theirs = String(staff[k].emp_code || '').trim().toLowerCase();
      for (var m = 0; m < users.length; m++) {
        if (String(users[m].emp_code || '').trim().toLowerCase() === theirs) { user = users[m]; break; }
      }
      break;
    }
  }
  if (!user) throw new Error('No account found for that staff code or email');
  if (String(user.active || 'yes').toLowerCase() === 'no') throw new Error('This account is disabled');
  if (String(user.password) !== hash(password)) throw new Error('Incorrect password');
  var who = {
    email: user.email,
    role: String(user.role || 'employee').toLowerCase(),
    emp_code: user.emp_code || ''
  };
  who.token = signToken(who);
  who.expires_in_hours = SESSION_HOURS;
  return who;
}

function changePassword(email, oldPassword, newPassword) {
  if (!newPassword || String(newPassword).length < 6) throw new Error('New password must be at least 6 characters');
  login(email, oldPassword); // validates the old one
  var sh = sheet('Users');
  var rows = indexed('Users');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].data.email).trim().toLowerCase() === String(email).trim().toLowerCase()) {
      sh.getRange(rows[i].row, SHEETS.Users.indexOf('password') + 1).setValue(hash(newPassword));
      return { changed: true };
    }
  }
  throw new Error('User not found');
}

function hash(value) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'hrms-lite:' + String(value));
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/* ------------------------------------------------------------------ */
/* Data access                                                         */
/* ------------------------------------------------------------------ */

/* Settings an employee's browser is allowed to hold. Anything to do with the
   biometric link, the SQL agent, payslip mail or imports stays on the server. */
var EMPLOYEE_SETTING_DENY = /^(essl_|sql_|sync_|payslip_email_|import_|register_group_by$)/;

/* HR sees every setting they can act on. Only the biometric and SQL
   credentials are held back, and those are the owner's. */
function hrSettings() {
  var all = settingsMap(), out = {};
  Object.keys(all).forEach(function (k) {
    if (!OWNER_ONLY_SETTINGS.test(k)) out[k] = all[k];
  });
  return out;
}

function employeeSettings() {
  var all = settingsMap(), out = {};
  Object.keys(all).forEach(function (k) {
    if (!EMPLOYEE_SETTING_DENY.test(k)) out[k] = all[k];
  });
  return out;
}

/* Tags a row with where it has got to, so a screen can say "waiting on HR"
   instead of just "Pending". */
function stamped(sheetName) {
  return function (r) {
    var p = progressOf(sheetName, r);
    r._step = p.at; r._steps = p.total; r._waiting_on = p.waitingOn; r._signed = p.signed;
    return r;
  };
}

function onlyMine(sheetName, code, tailRows) {
  return readSheet(sheetName, tailRows).filter(function (r) {
    return String(r.emp_code) === String(code);
  });
}

/**
 * What the browser is given when it starts.
 *
 * An admin gets the organisation. An employee gets their own record, their own
 * attendance, leave, requests, punches and payslips, and the policy they need
 * to read those (holidays, shifts, leave types) - and nothing else. This is the
 * point that decides it: filtering in the browser would still have sent every
 * salary in the company down the wire.
 */
/**
 * How much attendance history a screen actually needs on open.
 *
 * The dashboard shows this month and the last fortnight; the register shows one
 * month; payroll works a month at a time. Older months are still there and are
 * read when a report asks for them - this only bounds what every sign-in drags
 * down. One row per person per working day, so the window is sized from
 * headcount.
 */
function attendanceWindow(people) {
  var days = parseInt(settingsMap().bootstrap_attendance_days || '150', 10);
  if (!(days > 0)) return 0;                       // 0 = no limit, read it all
  return Math.max(2000, Math.ceil((people || 1) * days * 1.15));
}

function bootstrap(caller) {
  if (caller && isHrOrAbove(caller.role)) {
    var owner = isOwner(caller.role);
    return {
      role: owner ? 'owner' : 'hr',
      settings:   owner ? settingsMap() : hrSettings(),
      employees:  readSheet('Employees'),
      attendance: readSheet('Attendance', attendanceWindow(readSheet('Employees').length)),
      leave:      readSheet('Leave').map(stamped('Leave')),
      payroll:    readSheet('Payroll'),
      holidays:   readSheet('Holidays'),
      events:     readSheet('Events'),
      sites:      readSheet('Sites'),
      shifts:     readSheet('Shifts'),
      leaveTypes: readSheet('LeaveTypes'),
      requestTypes: readSheet('RequestTypes'),
      requests:    readSheet('Requests').map(stamped('Requests')),
      ctcVariables:  readSheet('CtcVariables'),
      ctcComponents: readSheet('CtcComponents'),
      ctcValues:     readSheet('CtcValues'),
      notices:       readSheet('Notices'),
      approvalLevels: readSheet('ApprovalLevels'),
      /* The accounts and the integration keys are the owner's alone. */
      secrets: owner ? secretStatus() : {},
      users:   owner ? listUsers() : []
    };
  }

  {
    var code = String((caller && caller.emp_code) || '');
    var me = null;
    if (code) {
      readSheet('Employees').forEach(function (e) {
        if (String(e.emp_code) === code) me = e;
      });
    }
    return {
      role: 'employee',
      settings:    employeeSettings(),
      employees:   me ? [me] : [],
      attendance:  code ? onlyMine('Attendance', code, attendanceWindow(readSheet('Employees').length)) : [],
      leave:       code ? onlyMine('Leave', code).map(stamped('Leave')) : [],
      payroll:     code ? onlyMine('Payroll', code) : [],
      requests:    code ? onlyMine('Requests', code).map(stamped('Requests')) : [],
      ctcValues:   code ? onlyMine('CtcValues', code) : [],
      holidays:    readSheet('Holidays'),
      events:      readSheet('Events'),
      shifts:      readSheet('Shifts'),
      leaveTypes:  readSheet('LeaveTypes'),
      requestTypes: readSheet('RequestTypes'),
      /* Staff see the notices that are live today - not the drafts, not the
         expired ones, and not the ones scheduled for next month. */
      notices:     liveNotices(),
      approvalLevels: readSheet('ApprovalLevels'),
      /* Empty for almost everyone. For someone with people reporting to them,
         their team and whatever of the team's is waiting on a decision. */
      inbox:       code ? managerInbox(code) : { isManager: false, team: [], teamLeave: [], teamRequests: [] },
      sites:       [],
      ctcVariables: [],
      ctcComponents: [],
      users:       [],
      secrets:     {}
    };
  }

}

function sheet(name) {
  if (!SHEETS[name]) throw new Error('Unknown sheet: ' + name);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { setup(); sh = ss.getSheetByName(name); }
  return sh;
}

function readSheet(name, tailRows) {
  return indexed(name, tailRows).map(function (x) { return x.data; });
}

/* A write invalidates what this request has cached for that tab, and marks
   the tab as changed so the revision below moves once this request ends. */
function touched(name) {
  Object.keys(READ_CACHE).forEach(function (k) {
    if (k.indexOf(name + '|') === 0) delete READ_CACHE[k];
  });
  REV_DIRTY[name] = 1;
}

/* ------------------------------------------------------------------ */
/* The revision stamp - how a screen knows the sheet has moved         */
/* ------------------------------------------------------------------ */

/* Every browser showing this workspace asks "has anything changed?" every few
   seconds. Answering that by sending the whole workspace back would be a few
   hundred sheet rows per screen per poll - it would be slower than the manual
   Refresh it replaces, and it would burn the daily Apps Script quota. So a
   write bumps one number in script properties, and the question costs one
   property read plus the Users lookup that checks the caller's session - a
   handful of rows, and the same however big the company gets. Measured on a
   120-person workspace with a month of attendance: asking costs 1 tab read,
   a full refresh costs 21.

   The names of the tabs that moved travel with the number, so a screen can
   tell the user what changed - and stay quiet about the punches the eSSL
   agent pushes all day. */
var REV_KEY = 'data_revision';
var REV_TABS_KEY = 'data_revision_tabs';
var REV_DIRTY = {};

/* The names of the tabs that moved are for the HR screen's "payroll changed"
   line. An employee's app never uses them, and knowing that Payroll or Users
   moved tells them when HR was working - so they are simply not sent. */
function currentRevision(caller) {
  var props = PropertiesService.getScriptProperties();
  var out = { rev: Number(props.getProperty(REV_KEY) || 0), tabs: '' };
  if (caller && isHrOrAbove(caller.role)) {
    out.tabs = String(props.getProperty(REV_TABS_KEY) || '');
  }
  return out;
}

/* Called once at the end of a request, not once per row: a 500-row import is
   one bump, not five hundred. */
function bumpRevision() {
  var tabs = Object.keys(REV_DIRTY);
  REV_DIRTY = {};
  if (!tabs.length) return null;
  try {
    var props = PropertiesService.getScriptProperties();
    var next = Number(props.getProperty(REV_KEY) || 0) + 1;
    var write = {};
    write[REV_KEY] = String(next);
    write[REV_TABS_KEY] = tabs.join(',');
    props.setProperties(write);
    return next;
  } catch (e) {
    /* A failed bump must never fail the write that already succeeded - the
       rows are in the sheet either way. The cost is that other screens do
       not learn of this one change until the next write bumps the number,
       or somebody presses Refresh. */
    return null;
  }
}

/**
 * Every non-blank data row with the sheet row number it lives on.
 * Writers must use this - readSheet() skips blank rows, so its array
 * index would point at the wrong sheet row once a gap exists.
 */
/**
 * Every tab this request has already read.
 *
 * One call used to read Employees fifty times and ApprovalLevels once per
 * leave row - seven hundred round trips to build one screen. A request is a
 * single short-lived execution, so reading a tab twice inside it is pure
 * waste. Cleared at the start of every request in handle().
 */
var READ_CACHE = {};
function clearReadCache() { READ_CACHE = {}; }

/**
 * tailRows, when given, reads only the last N data rows instead of the whole
 * tab. Attendance grows by one row per person per day - a year of 500 people
 * is 125,000 rows, and pulling all of it to show this month is what makes the
 * app feel slow. Rows are appended in date order, so the recent ones are at
 * the end.
 */
function indexed(name, tailRows) {
  var key = name + '|' + (tailRows || 0);
  if (READ_CACHE[key]) return READ_CACHE[key];

  var sh = sheet(name);
  var headers = SHEETS[name];
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return (READ_CACHE[key] = []);

  var first = 2, count = lastRow - 1;
  if (tailRows && count > tailRows) { first = lastRow - tailRows + 1; count = tailRows; }

  var values = sh.getRange(first, 1, count, headers.length).getValues();
  var tz = Session.getScriptTimeZone();
  var out = [];
  values.forEach(function (r, i) {
    if (r.join('') === '') return;
    var obj = {};
    headers.forEach(function (h, c) { obj[h] = normalize(r[c], h, tz); });
    out.push({ row: i + first, data: obj });
  });
  READ_CACHE[key] = out;
  return out;
}

/** One row by its key, without dragging the whole tab back. */
function findRow(name, key, value) {
  var rows = indexed(name);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].data[key]) === String(value)) return rows[i];
  }
  return null;
}

/**
 * Sheets hands back a Date object for anything it thinks is a date or a time,
 * and a bare time like 09:30 comes back anchored to 30 December 1899. Left
 * alone, a shift start reads "1899-12-30T09:30:00", every "HH:MM" parse fails,
 * and late marks, overtime and half-days quietly stop working. So each column
 * is formatted as what the rest of the system expects to read.
 */
function normalize(value, header, tz) {
  if (value instanceof Date) {
    if (/(^date$|_date$|^doj$|^dob$)/.test(header)) {
      return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
    }
    // A real moment in time: keep the date with it.
    if (/^punch_time$|_at$/.test(header)) {
      return Utilities.formatDate(value, tz, "yyyy-MM-dd'T'HH:mm:ss");
    }
    // A clock time: the day it is anchored to is meaningless.
    if (/_time$|^shift_start$|^shift_end$/.test(header)) {
      return Utilities.formatDate(value, tz, 'HH:mm');
    }
    /* The Settings tab is key/value, so the column name says nothing. A value
       sitting on the 1899 epoch is a time someone typed; anything else is a
       date. */
    if (header === 'value') {
      return Utilities.formatDate(value, tz,
        value.getFullYear() < 1901 ? 'HH:mm' : 'yyyy-MM-dd');
    }
    return Utilities.formatDate(value, tz, "yyyy-MM-dd'T'HH:mm:ss");
  }
  return value === null || value === undefined ? '' : value;
}

function keyColumn(name) { return name === 'Employees' ? 'emp_code' : (name === 'Users' ? 'email' : 'id'); }

/**
 * Where a row with this key lives, without reading the tab.
 *
 * Saving one punch used to pull all 125,000 attendance rows back just to find
 * the one row to overwrite. A text search runs inside Sheets and returns the
 * row number; only that row is then read. Restricted to the key column and
 * matching the whole cell, so "E1" never matches "E10" or a remark.
 */
function rowNumberOf(name, key, value) {
  var sh = sheet(name);
  var at = SHEETS[name].indexOf(key);
  var lastRow = sh.getLastRow();
  if (at < 0 || lastRow < 2) return 0;
  var hit = sh.getRange(2, at + 1, lastRow - 1, 1)
              .createTextFinder(String(value))
              .matchEntireCell(true)
              .findNext();
  return hit ? hit.getRow() : 0;
}

/**
 * A finalised month is closed. The browser greys the register out, but a
 * browser is not a lock - a stale tab, the phone app or anything holding the
 * URL could still write, and then the register no longer says what was paid.
 * Refused here, where it counts.
 */
function refuseIfClosed(name, row) {
  if (name !== 'Attendance') return;
  var month = String((row && row.date) || '').slice(0, 7);
  if (month && monthIsLocked(month)) {
    throw new Error('Payroll for ' + month + ' is finalised, so its attendance cannot be changed. ' +
      'Reopen the run first.');
  }
}

/* ------------------------------------------------------------------ */
/* Logins that come with the employee                                  */
/* ------------------------------------------------------------------ */

/* Adding somebody to the staff list used to leave them unable to sign in:
   HR had to remember to make a login too, and when they did not, the worker
   opened the phone app and was told "No account found for this email".

   So a new employee gets an account with the staff code as both the username
   and the first password - the code they already know from their ID card and
   the eSSL device. It is deliberately guessable by design: it is a first
   password, and the employee can change it from the app. Nobody is ever
   given a second account, and an existing one is never touched - in
   particular a password already chosen by the worker is never reset. */
function accountFor(emp) {
  var code = String((emp && emp.emp_code) || '').trim();
  if (!code) return null;
  /* The staff code is the username, always - including for the office staff
     who do have a company address. It is the one identifier every worker
     already knows, it is what is printed on the ID card and held in the eSSL
     device, and it does not change when somebody switches their email. Their
     email still gets them in; see login(). */
  return {
    email: code.toLowerCase(), password: hash(code), role: 'employee',
    emp_code: code, active: 'yes'
  };
}

/* Makes the logins for staff who have none. Used when an employee is added
   and by the "create missing logins" button, which is what an existing
   company needs: everybody already on the list is in exactly the position a
   new joiner used to be in. */
/* Only somebody actually on the strength gets a way in. A whitelist, not a
   list of words to exclude: "Left" and "Inactive" were excluded by name
   before, so "Resigned", "Suspended" or "Terminated" - all of which a company
   does write in that column - were handed a working login. Blank counts as
   active, because that is how the rest of the system reads it. */
function mayHaveLogin(emp) {
  var st = String((emp && emp.status) || 'Active').trim().toLowerCase();
  return st === '' || st === 'active';
}

function makeAccountsFor(emps) {
  var users = readSheet('Users');
  var haveCode = {}, haveMail = {};
  users.forEach(function (u) {
    var c = String(u.emp_code || '').trim();
    if (c) haveCode[c.toLowerCase()] = 1;
    haveMail[String(u.email || '').trim().toLowerCase()] = 1;
  });
  var made = [], skipped = 0;
  (emps || []).forEach(function (e) {
    if (!mayHaveLogin(e)) return;
    var a = accountFor(e);
    if (!a) return;
    if (haveCode[a.emp_code.toLowerCase()] || haveMail[a.email]) { skipped++; return; }
    haveCode[a.emp_code.toLowerCase()] = 1; haveMail[a.email] = 1;
    made.push(a);
  });
  if (made.length) appendMany('Users', made);
  return { created: made.length, alreadyHad: skipped,
           logins: made.map(function (m) { return m.email; }) };
}

/* Every employee; makeAccountsFor() decides who may have one. */
function backfillAccounts() {
  return makeAccountsFor(readSheet('Employees'));
}

function upsert(name, row) {
  refuseIfClosed(name, row);
  touched(name);
  var headers = SHEETS[name];
  var key = keyColumn(name);
  if (name === 'Employees' && !String(row.emp_code || '').trim()) {
    throw new Error('Employee code is required - it is entered by you, not generated.');
  }
  if (!row[key]) row[key] = newId();
  var sh = sheet(name);

  var at = rowNumberOf(name, key, row[key]);
  if (at) {
    /* Read back just that row, so fields the caller left out keep their
       current values instead of being blanked. */
    var prevLine = sh.getRange(at, 1, 1, headers.length).getValues()[0];
    var tz = Session.getScriptTimeZone();
    var prev = {};
    headers.forEach(function (h, c) { prev[h] = normalize(prevLine[c], h, tz); });
    sh.getRange(at, 1, 1, headers.length).setValues([
      headers.map(function (h) { return row[h] === undefined ? prev[h] : row[h]; })
    ]);
    return row;
  }
  sh.appendRow(headers.map(function (h) { return row[h] === undefined ? '' : row[h]; }));
  /* A new member of staff, so give them the login at the same moment. */
  if (name === 'Employees') { touched('Users'); makeAccountsFor([row]); }
  return row;
}

/**
 * Bulk upsert: read the tab once, merge in memory, write it back in one call.
 * Doing this row by row is O(n^2) and times out on a real import (500
 * employees, or a month of biometric punches).
 */
function upsertMany(name, rows) {
  rows = rows || [];
  rows.forEach(function (r) { refuseIfClosed(name, r); });
  touched(name);
  if (!rows.length) return { saved: 0 };
  var headers = SHEETS[name], key = keyColumn(name);
  var sh = sheet(name);
  var existing = indexed(name);
  var values = existing.map(function (x) {
    return headers.map(function (h) { return x.data[h] === undefined ? '' : x.data[h]; });
  });
  var byKey = {};
  existing.forEach(function (x, i) { byKey[String(x.data[key])] = i; });
  var fresh = [];

  rows.forEach(function (row) {
    if (name === 'Employees' && !String(row.emp_code || '').trim()) {
      throw new Error('Employee code is required - it is entered by you, not generated.');
    }
    if (!row[key]) row[key] = newId();
    var k = String(row[key]);
    var at = byKey[k];
    if (at === undefined) {
      byKey[k] = values.length;
      fresh.push(row);
      values.push(headers.map(function (h) { return row[h] === undefined ? '' : row[h]; }));
    } else {
      var prev = values[at];
      values[at] = headers.map(function (h, c) { return row[h] === undefined ? prev[c] : row[h]; });
    }
  });

  var lastRow = sh.getLastRow();
  if (values.length) sh.getRange(2, 1, values.length, headers.length).setValues(values);
  if (lastRow > values.length + 1) {
    sh.getRange(values.length + 2, 1, lastRow - values.length - 1, headers.length).clearContent();
  }
  /* Everybody the import brought in gets a login, in one write. */
  var accounts = null;
  if (name === 'Employees' && fresh.length) { touched('Users'); accounts = makeAccountsFor(fresh); }
  return { saved: rows.length, total: values.length, accounts: accounts };
}

/** Append-only, for the raw punch log - never keyed, never rewritten. */
function appendMany(name, rows) {
  touched(name);
  rows = rows || [];
  if (!rows.length) return { added: 0 };
  var headers = SHEETS[name], sh = sheet(name);
  var lines = rows.map(function (r) {
    return headers.map(function (h) { return r[h] === undefined ? '' : r[h]; });
  });
  sh.getRange(sh.getLastRow() + 1, 1, lines.length, headers.length).setValues(lines);
  return { added: lines.length };
}

/** Keep the audit log from growing without bound. */
function trimPunches() {
  var days = parseInt(settingsMap().punch_log_days || '90', 10);
  if (!days) return 0;
  var sh = sheet('Punches');
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  var cut = Utilities.formatDate(cutoff, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var stamps = sh.getRange(2, 2, last - 1, 1).getValues();   /* punch_time column */
  var drop = 0;
  while (drop < stamps.length && String(stamps[drop][0]).slice(0, 10) < cut) drop++;
  if (drop > 0) sh.deleteRows(2, drop);                       /* rows are appended in time order */
  return drop;
}

function appendRow(name, row) {
  touched(name);
  var headers = SHEETS[name];
  sheet(name).appendRow(headers.map(function (h) { return row[h] === undefined ? '' : row[h]; }));
  return row;
}

function removeRow(name, id) {
  touched(name);
  var key = keyColumn(name);
  var rows = indexed(name);
  var sh = sheet(name);
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i].data[key]) === String(id)) {
      refuseIfClosed(name, rows[i].data);          /* deleting a day closes it too */
      sh.deleteRow(rows[i].row); return { removed: id };
    }
  }
  throw new Error('Record not found: ' + id);
}

function removeMany(name, ids) {
  touched(name);
  var key = keyColumn(name);
  var wanted = {};
  (ids || []).forEach(function (id) { wanted[String(id)] = true; });
  var rows = indexed(name);
  var sh = sheet(name);
  var removed = 0;
  for (var i = rows.length - 1; i >= 0; i--) {
    if (wanted[String(rows[i].data[key])]) {
      refuseIfClosed(name, rows[i].data);
      sh.deleteRow(rows[i].row); removed++;
    }
  }
  return { removed: removed };
}

function newId() {
  return Utilities.getUuid().split('-')[0] + Date.now().toString(36).slice(-4);
}

function settingsMap() {
  var map = {};
  readSheet('Settings').forEach(function (r) { if (r.key) map[r.key] = r.value; });
  return map;
}

function saveSettings(settings) {
  var sh = sheet('Settings');
  var rows = indexed('Settings');
  Object.keys(settings || {}).forEach(function (k) {
    var found = -1;
    for (var i = 0; i < rows.length; i++) { if (String(rows[i].data.key) === k) { found = i; break; } }
    if (found >= 0) {
      sh.getRange(rows[found].row, 2).setValue(settings[k]);
    } else {
      sh.appendRow([k, settings[k]]);
      rows.push({ row: sh.getLastRow(), data: { key: k, value: settings[k] } });
    }
  });
  return settingsMap();
}

/* ------------------------------------------------------------------ */
/* Responses                                                           */
/* ------------------------------------------------------------------ */

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonp(obj, callback) {
  return ContentService.createTextOutput(callback + '(' + JSON.stringify(obj) + ')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/* ==================================================================
   Integrations: eSSL biometric pull/push, and punch ingestion
   ------------------------------------------------------------------
   Two ways in:
   1. "api"       - this script calls your eSSL/eTimeTrackLite web API
                    directly. Only works if that URL is reachable from
                    Google's servers (a public host, not a LAN address).
   2. "sql-agent" - tools/essl-sync.js runs on a machine inside your
                    network, reads the eSSL SQL Server table, and POSTs
                    punches here with the ingest token. Use this when
                    the device or SQL box is on the office LAN.
   ================================================================== */

var SECRET_KEYS = ['essl_api_password', 'sql_password', 'ingest_token', 'push_token'];

function props() { return PropertiesService.getScriptProperties(); }

function setSecret(key, value) {
  if (SECRET_KEYS.indexOf(key) < 0) throw new Error('Unknown secret: ' + key);
  if (value === '' || value === null || value === undefined) props().deleteProperty(key);
  else props().setProperty(key, String(value));
  return secretStatus();
}

/** Never returns the values - only whether each one is set. */
function secretStatus() {
  var all = props().getProperties();
  var out = {};
  SECRET_KEYS.forEach(function (k) { out[k] = !!all[k]; });
  return out;
}

function secret(key) { return props().getProperty(key) || ''; }

/** A private/LAN address can never be reached from Google's servers. */
function looksPrivate(url) {
  var host = String(url || '').replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(host) ||
         /\.local$/i.test(host);
}

function authHeaders(settings) {
  var headers = {};
  var pass = secret('essl_api_password');
  var style = String(settings.essl_auth_style || 'basic').toLowerCase();
  if (style === 'bearer' && pass) headers.Authorization = 'Bearer ' + pass;
  else if (settings.essl_api_user && pass) {
    headers.Authorization = 'Basic ' + Utilities.base64Encode(settings.essl_api_user + ':' + pass);
  }
  return headers;
}

function testIntegration() {
  var st = settingsMap();
  var out = { mode: st.essl_mode || 'none', checks: [] };
  if (st.essl_api_url) {
    if (looksPrivate(st.essl_api_url)) {
      out.checks.push({ name: 'eSSL API URL', ok: false,
        note: 'This is a private/LAN address. Google’s servers cannot reach it - use the SQL agent mode instead.' });
    } else {
      try {
        var r = UrlFetchApp.fetch(st.essl_api_url, {
          method: 'get', headers: authHeaders(st), muteHttpExceptions: true,
          validateHttpsCertificates: true, followRedirects: true
        });
        out.checks.push({ name: 'eSSL API URL', ok: r.getResponseCode() < 400,
          note: 'HTTP ' + r.getResponseCode() });
      } catch (e) {
        out.checks.push({ name: 'eSSL API URL', ok: false, note: String(e.message || e) });
      }
    }
  } else {
    out.checks.push({ name: 'eSSL API URL', ok: false, note: 'Not configured' });
  }
  if (st.essl_push_url) {
    out.checks.push({ name: 'Push URL', ok: !looksPrivate(st.essl_push_url),
      note: looksPrivate(st.essl_push_url) ? 'Private address - unreachable from here' : 'Looks reachable' });
  }
  var sec = secretStatus();
  out.checks.push({ name: 'API password stored', ok: sec.essl_api_password, note: sec.essl_api_password ? 'Set' : 'Not set' });
  out.checks.push({ name: 'Ingest token (for the SQL agent)', ok: sec.ingest_token,
    note: sec.ingest_token ? 'Set' : 'Not set - the agent cannot post without it' });
  return out;
}

/** Pull punches from the configured eSSL web API for a date range. */
function esslPull(from, to) {
  var st = settingsMap();
  if (!st.essl_api_url) throw new Error('No eSSL API URL configured in Settings > Integrations.');
  if (looksPrivate(st.essl_api_url)) {
    throw new Error('The eSSL URL is a LAN address, which Google’s servers cannot reach. ' +
      'Use the SQL agent (tools/essl-sync.js) instead.');
  }
  var url = st.essl_api_url +
    (st.essl_api_url.indexOf('?') >= 0 ? '&' : '?') +
    'from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) +
    (st.essl_device_serial ? '&serial=' + encodeURIComponent(st.essl_device_serial) : '');
  var res = UrlFetchApp.fetch(url, {
    method: 'get', headers: authHeaders(st), muteHttpExceptions: true, followRedirects: true
  });
  if (res.getResponseCode() >= 400) {
    throw new Error('eSSL replied HTTP ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  }
  var body = res.getContentText();
  var data;
  try { data = JSON.parse(body); }
  catch (e) { throw new Error('eSSL did not return JSON. First 200 characters: ' + body.slice(0, 200)); }
  var list = data;
  if (!Array.isArray(list)) list = data.data || data.Data || data.result || data.logs || [];
  if (!Array.isArray(list)) throw new Error('Could not find a punch array in the eSSL response.');

  var result = applyPunches(list.map(normalizePunch), 'essl-api');
  saveSettings({ sync_last_pull: new Date().toISOString() });
  result.fetched = list.length;
  return result;
}

/** Relay rows to an external system (another HRMS, an ERP, a SQL bridge). */
function esslPush(month, rows) {
  var st = settingsMap();
  if (String(st.essl_push_enabled || 'no').toLowerCase() !== 'yes') {
    throw new Error('Push is switched off in Settings > Integrations.');
  }
  if (!st.essl_push_url) throw new Error('No push URL configured.');
  if (looksPrivate(st.essl_push_url)) {
    throw new Error('The push URL is a LAN address, which Google’s servers cannot reach.');
  }
  var headers = { 'Content-Type': 'application/json' };
  if (secret('push_token')) headers.Authorization = 'Bearer ' + secret('push_token');
  var res = UrlFetchApp.fetch(st.essl_push_url, {
    method: 'post', headers: headers, muteHttpExceptions: true,
    payload: JSON.stringify({ company: st.company_name, month: month, rows: rows || [] })
  });
  saveSettings({ sync_last_push: new Date().toISOString() });
  return { code: res.getResponseCode(), body: res.getContentText().slice(0, 500), sent: (rows || []).length };
}

/** Called by the LAN agent. Requires the ingest token once one is set. */
/**
 * Punches arriving from outside: the LAN agent, or HR uploading the machine's
 * own report from the Import screen.
 *
 * The agent has no session, so it carries the ingest token. HR is already
 * signed in, and a signed-in HR or owner needs no token - the router has
 * established who they are before this runs.
 */
function ingestPunches(punches, token, source, caller) {
  if (!(caller && isHrOrAbove(caller.role))) {
    var want = secret('ingest_token');
    /* Without this, a workspace that never set a token accepted punches from
       anybody who had the URL - including one of its own employees, punching
       for somebody else. */
    if (!want) {
      throw new Error('Set an ingest token in Settings > Integrations before sending ' +
        'punches from outside, or upload the file while signed in as HR.');
    }
    if (String(token || '') !== want) throw new Error('Invalid or missing ingest token.');
  }
  return applyPunches((punches || []).map(normalizePunch), source || 'agent');
}

/** Accepts the many field names eSSL exports use. */
function normalizePunch(p) {
  var pick = function (keys) {
    for (var i = 0; i < keys.length; i++) {
      for (var k in p) {
        if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === keys[i]) return p[k];
      }
    }
    return '';
  };
  /* Half the machines in the field export one "2026-09-01 09:53:00" column and
     the other half export a Date column with a Time column beside it. Reading
     only the first kind is what made every imported day read 00:00. */
  var stamp = String(pick(['punchtime', 'logdate', 'attdatetime', 'datetime', 'timestamp',
                           'punchdatetime', 'recordtime', 'logdatetime', 'attendancedate',
                           'punchdate', 'attdate', 'date']) || '').trim();
  var clock = String(pick(['logtime', 'punchtimeonly', 'time', 'attime', 'recordedtime',
                           'intime', 'punchhour']) || '').trim();
  if (!hasDate(stamp)) {
    var onlyDate = String(pick(['attdate', 'punchdate', 'logdate', 'attendancedate',
                                'date']) || '').trim();
    if (hasDate(onlyDate)) { clock = clock || stamp; stamp = onlyDate; }
  }
  return {
    emp_code:  String(pick(['empcode', 'employeecode', 'employeeid', 'empid']) || '').trim(),
    device_id: String(pick(['deviceid', 'userid', 'enrollno', 'enrollnumber', 'indexid', 'usrid']) || '').trim(),
    /* A file can name its columns so that the clock is picked first - AttDate
       beside PunchTime, say. If what was picked has no date in it but does
       have a clock, the two have arrived the wrong way round. */
    punch_time: (!hasDate(stamp) && clockOf(stamp) && hasDate(clock)) ? clock : stamp,
    punch_clock: (!hasDate(stamp) && clockOf(stamp))
      ? (hasDate(clock) ? stamp : stamp)
      : clock,
    device:    String(pick(['device', 'devicename', 'serialnumber', 'deviceserial']) || '').trim(),
    direction: String(pick(['direction', 'inout', 'punchtype', 'c1']) || '').trim()
  };
}

function parsePunchTime(v, clock) {
  var s = String(v || '').trim().replace(/^"|"$/g, '').replace('T', ' ');
  var date = '', m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) {
    date = m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3]);
  } else {
    m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
    if (m) {
      var year = m[3].length === 2 ? '20' + m[3] : m[3];
      date = year + '-' + pad2(m[2]) + '-' + pad2(m[1]);      /* dd/mm/yyyy, the Indian way */
    }
  }
  if (!date) {
    /* "Tue Sep 01 2026 09:53:00", or "01-Sep-2026 09:53" - what a machine's own
       date object becomes once it has been through a spreadsheet or JSON. */
    m = s.match(/([A-Za-z]{3,})\s+(\d{1,2})\s+(\d{4})/) ||
        s.match(/(\d{1,2})[ -]([A-Za-z]{3,})[ -](\d{2,4})/);
    if (m) {
      var namePos = /^[A-Za-z]/.test(m[1]) ? 1 : 2, dayPos = namePos === 1 ? 2 : 1;
      var mon = MONTH_NAMES.indexOf(String(m[namePos]).slice(0, 3).toLowerCase());
      var yr = m[3].length === 2 ? '20' + m[3] : m[3];
      if (mon >= 0) date = yr + '-' + pad2(mon + 1) + '-' + pad2(m[dayPos]);
    }
    if (!date) return null;
    var t2 = clockOf(s.slice(m.index + m[0].length)) || clockOf(clock);
    return t2 ? { date: date, time: t2 } : null;
  }

  /* A stamp with no time of day is NOT midnight. Inventing 00:00 turned a
     month of real punches into "the same time every day", every day scored as
     nought hours. Such a row is refused and named, so the mapping gets fixed. */
  var time = clockOf(s.slice(m[0].length)) || clockOf(clock);
  return time ? { date: date, time: time } : null;
}

function pad2(v) { return ('0' + String(v)).slice(-2); }

var MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                   'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** Does this text carry a date at all? */
function hasDate(v) {
  var s = String(v || '');
  return /\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(s) ||
         /\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(s) ||
         /[A-Za-z]{3,}\s+\d{1,2}\s+\d{4}|\d{1,2}[ -][A-Za-z]{3,}[ -]\d{2,4}/.test(s);
}

/** "09:53:00", "9:53 AM", "17:34" -> "09:53". Null when there is no clock time. */
function clockOf(v) {
  var m = String(v || '').trim().match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])?/);
  if (!m) return null;
  var h = Number(m[1]), min = Number(m[2]);
  if (min > 59) return null;
  var ap = m[3] ? m[3].toLowerCase() : '';
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  return h > 23 ? null : pad2(h) + ':' + pad2(min);
}

function minutesOfClock(t) {
  var c = clockOf(t);
  return c ? Number(c.slice(0, 2)) * 60 + Number(c.slice(3, 5)) : 0;
}

/**
 * The one rule, for every source: a day's IN is the first punch on it and its
 * OUT is the last, however many punches came in between and whatever the
 * machine called them.
 *
 * The device's own in/out flag is deliberately ignored. A worker who touches
 * the reader twice on the way in, or somebody who taps the app by mistake and
 * taps again, must not end up with the day inverted, and eSSL's flag is only
 * as right as the mode the device happened to be left in. Every tap stays in
 * the punch log; the day is bounded by the first and the last.
 */
function rebuildDayFromPunches(empCode, iso, source, extraTimes) {
  var st = settingsMap();
  if (monthIsLocked(iso.slice(0, 7))) return null;

  var existing = null;
  readSheet('Attendance', punchWindow()).forEach(function (a) {
    if (String(a.emp_code) === String(empCode) && String(a.date) === iso) existing = a;
  });
  /* Approved leave is a decision somebody signed. A punch does not overrule it. */
  if (existing && String(existing.status) === 'L') return null;

  var times = [];
  var add = function (t) { var c = clockOf(t); if (c && times.indexOf(c) < 0) times.push(c); };
  readSheet('Punches', punchWindow()).forEach(function (r) {
    if (String(r.emp_code) !== String(empCode)) return;
    var stamp = String(r.punch_time || '');
    if (stamp.slice(0, 10) === iso) add(stamp.slice(10));
  });
  (extraTimes || []).forEach(add);
  /* With the punch log switched off there is nothing to rebuild from, so widen
     what the day already holds rather than narrowing it. */
  if (existing) { add(existing.in_time); add(existing.out_time); }
  if (!times.length) return null;

  times.sort();
  var inT = times[0], outT = times[times.length - 1], taps = times.length;
  var hours = 0;
  if (inT !== outT) {
    var mins = minutesOfClock(outT) - minutesOfClock(inT);
    if (mins < 0) mins += 24 * 60;                     /* a shift across midnight */
    hours = mins / 60;
  }
  var full = parseFloat(st.full_day_hours || 8), half = parseFloat(st.half_day_hours || 4);
  var status, remark;
  if (inT === outT) { status = 'P'; remark = source + ' - single punch, verify'; }
  else if (hours >= full) { status = 'P'; remark = source + (taps > 2 ? ' - ' + taps + ' punches' : ''); }
  else if (hours >= half) { status = 'HD'; remark = source + ' - ' + hours.toFixed(1) + ' h'; }
  else { status = 'A'; remark = source + ' - only ' + hours.toFixed(1) + ' h, verify'; }

  var row = {
    id: empCode + '_' + iso, date: iso, emp_code: empCode, status: status,
    in_time: inT, out_time: inT === outT ? '' : outT,
    hours: inT === outT ? 0 : Math.round(hours * 10) / 10,
    remarks: remark, updated_at: nowParts().date
  };
  upsert('Attendance', row);
  return row;
}

function applyPunches(punches, source) {
  var byDevice = {}, known = {};
  readSheet('Employees').forEach(function (e) {
    known[String(e.emp_code).toUpperCase()] = e.emp_code;
    if (e.device_id) byDevice[String(e.device_id).trim()] = e.emp_code;
  });

  var days = {}, skipped = [], rawRows = [], stamp = new Date().toISOString();
  punches.forEach(function (p, i) {
    var code = p.emp_code && known[p.emp_code.toUpperCase()]
      ? known[p.emp_code.toUpperCase()]
      : (p.device_id ? byDevice[p.device_id] : '');
    var when = parsePunchTime(p.punch_time, p.punch_clock);
    if (!when) {
      skipped.push('Row ' + (i + 1) + ': no punch time could be read from "' +
        String(p.punch_time || '') + (p.punch_clock ? ' / ' + p.punch_clock : '') +
        '" - check which columns hold the date and the time');
      return;
    }
    if (!code) {
      skipped.push('Row ' + (i + 1) + ': no employee matches code "' + p.emp_code +
        '" / device id "' + p.device_id + '"');
      return;
    }
    rawRows.push({ id: newId(), punch_time: when.date + ' ' + when.time, emp_code: code,
                   device_id: p.device_id, device: p.device, direction: p.direction,
                   source: source, imported_at: stamp });
    var key = code + '|' + when.date;
    days[key] = days[key] || { code: code, date: when.date, times: [] };
    days[key].times.push(when.time);
  });

  /* The log is written first, so the rebuild below sees this batch too and a
     re-import of the same period can only widen a day, never shrink it. */
  var logged = String(settingsMap().keep_punch_log || 'yes').toLowerCase() === 'yes';
  if (rawRows.length && logged) {
    appendMany('Punches', rawRows);
    trimPunches();
  }

  var written = 0, conflicts = 0;
  Object.keys(days).forEach(function (key) {
    var d = days[key];
    if (rebuildDayFromPunches(d.code, d.date, source, d.times)) written++; else conflicts++;
  });

  return {
    punches: punches.length, days: written, skipped: skipped.slice(0, 20),
    skippedCount: skipped.length, protectedDays: conflicts, source: source
  };
}

function nowParts() {
  var tz = Session.getScriptTimeZone(), now = new Date();
  return {
    date: Utilities.formatDate(now, tz, 'yyyy-MM-dd'),
    time: Utilities.formatDate(now, tz, 'HH:mm'),
    stamp: Utilities.formatDate(now, tz, "yyyy-MM-dd'T'HH:mm:ss")
  };
}

/* Punching needs today's row and any recent day left open - not the year.
   Sized from headcount so it holds roughly the last six weeks. */
function punchWindow() {
  return Math.max(1000, readSheet('Employees').length * 45);
}

/**
 * The machine's own record for a day, or a span of days: every punch as it
 * came off the device, before attendance settled it into an in and an out.
 * This is what settles an argument about a day - the attendance row is a
 * conclusion, the punch log is the evidence.
 *
 * Not in bootstrap, and deliberately so: the punch tab is the biggest one in
 * the book, and almost every screen needs none of it. It is fetched for the
 * days actually asked for. HR and above only - the router refuses everyone
 * else before this runs.
 */
function punchLog(from, to) {
  var a = String(from || '').slice(0, 10);
  var b = String(to || from || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a)) throw new Error('Pick a date first.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b)) b = a;
  if (b < a) { var swap = a; a = b; b = swap; }

  var rows = readSheet('Punches', punchWindow());
  /* The tail read covers recent days. Asking for an older one has to read the
     whole tab - reporting an empty day would be a lie, not a saving. */
  if (rows.length && String(rows[0].punch_time).slice(0, 10) > a) {
    rows = readSheet('Punches');
  }
  var out = rows.filter(function (r) {
    var d = String(r.punch_time).slice(0, 10);
    return d >= a && d <= b;
  });
  out.sort(function (x, y) {
    return String(x.punch_time).localeCompare(String(y.punch_time)) ||
           String(x.emp_code).localeCompare(String(y.emp_code));
  });
  return { from: a, to: b, rows: out };
}

/** Today's punch record plus any earlier day left open. */
function punchState(empCode) {
  if (!empCode) throw new Error('No employee is linked to this login.');
  var n = nowParts();
  var rows = readSheet('Attendance', punchWindow()).filter(function (a) {
    return String(a.emp_code) === String(empCode);
  });
  var todayRow = null, open = [];
  rows.forEach(function (a) {
    if (String(a.date) === n.date) todayRow = a;
    else if (String(a.date) < n.date && a.in_time && !a.out_time) {
      open.push({ date: a.date, in_time: a.in_time });
    }
  });
  open.sort(function (x, y) { return String(y.date).localeCompare(String(x.date)); });

  /* Every tap made today, so the app can show them rather than only the two
     that bound the day. Somebody who taps twice should be able to see that
     both taps arrived, and that the extra one changed nothing. */
  var taps = [];
  readSheet('Punches', punchWindow()).forEach(function (r) {
    if (String(r.emp_code) !== String(empCode)) return;
    var stamp = String(r.punch_time || '');
    if (stamp.slice(0, 10) !== n.date) return;
    var t = clockOf(stamp.slice(10));
    if (t) taps.push(t);
  });
  taps.sort();

  var gs = settingsMap();
  return {
    geofence: {
      enabled: String(gs.geofence_enabled || 'no').toLowerCase() === 'yes',
      mode: String(gs.geofence_mode || 'block'),
      accuracy: parseFloat(gs.geofence_accuracy_m || 120)
    },
    date: n.date, time: n.time,
    in_time: todayRow ? todayRow.in_time : '',
    out_time: todayRow ? todayRow.out_time : '',
    status: todayRow ? todayRow.status : '',
    hours: todayRow ? todayRow.hours : 0,
    openDays: open.slice(0, 5),
    taps: taps,
    mandatory: String(settingsMap().punch_out_mandatory || 'yes').toLowerCase() === 'yes'
  };
}

/* ---- geofence ---- */

/** Metres between two points on the earth. */
function metresBetween(lat1, lng1, lat2, lng2) {
  var R = 6371000, toRad = Math.PI / 180;
  var dLat = (lat2 - lat1) * toRad, dLng = (lng2 - lng1) * toRad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * Is this punch inside a site the employee may punch from?
 * Runs here, not in the browser, so the check cannot be skipped by the client.
 */
function geoCheck(emp, geo) {
  var st = settingsMap();
  var on = String(st.geofence_enabled || 'no').toLowerCase() === 'yes';
  if (!on) return { ok: true, enabled: false };

  var mode = String(st.geofence_mode || 'block').toLowerCase();
  var soft = mode !== 'block';
  var maxAcc = parseFloat(st.geofence_accuracy_m || 120);

  if (!geo || geo.lat === undefined || geo.lat === null || geo.lat === '') {
    return { ok: soft, enabled: true, soft: soft,
             reason: 'Location is required to punch, and none was sent.' };
  }
  if (maxAcc > 0 && geo.accuracy && parseFloat(geo.accuracy) > maxAcc) {
    return { ok: soft, enabled: true, soft: soft, accuracy: Math.round(parseFloat(geo.accuracy)),
             reason: 'Location is only accurate to about ' + Math.round(parseFloat(geo.accuracy)) +
                     ' m; ' + maxAcc + ' m or better is needed. Step outside or turn on precise location.' };
  }

  var allowed = readSheet('Sites').filter(function (x) {
    return String(x.active || 'yes').toLowerCase() !== 'no' && x.lat !== '' && x.lng !== '';
  });
  var only = String((emp && emp.site) || '').trim();
  if (only) {
    var mine = allowed.filter(function (x) { return String(x.name).trim() === only; });
    if (mine.length) allowed = mine;
  }
  if (!allowed.length) {
    return { ok: soft, enabled: true, soft: soft,
             reason: 'Geofencing is on but no site has been set up yet.' };
  }

  var best = null;
  allowed.forEach(function (x) {
    var d = metresBetween(parseFloat(geo.lat), parseFloat(geo.lng), parseFloat(x.lat), parseFloat(x.lng));
    if (!best || d < best.distance) best = { site: x.name, distance: d, radius: parseFloat(x.radius_m || 150) };
  });
  if (best.distance <= best.radius) {
    return { ok: true, enabled: true, site: best.site, distance: best.distance };
  }

  /* field staff with an approved out-duty for today are allowed to be away */
  if (String(st.geofence_allow_od || 'yes').toLowerCase() === 'yes' && emp) {
    var n = nowParts();
    var od = readSheet('Requests').some(function (r) {
      return String(r.emp_code) === String(emp.emp_code) && r.status === 'Approved' &&
        String(r.date) <= n.date && n.date <= String(r.to_date || r.date) &&
        String(r.type).toUpperCase() === 'OD';
    });
    if (od) {
      return { ok: true, enabled: true, site: 'out duty', distance: best.distance, od: true };
    }
  }
  return {
    ok: soft, enabled: true, soft: soft, site: best.site, distance: best.distance,
    reason: 'You are about ' + best.distance + ' m from ' + best.site +
            ', which allows ' + best.radius + ' m.'
  };
}

function webPunch(empCode, kind, note, geo, caller) {
  var st = settingsMap();
  if (String(st.web_punch_enabled || 'yes').toLowerCase() !== 'yes') {
    throw new Error('Punching from the app is switched off.');
  }
  if (!empCode) throw new Error('No employee is linked to this login.');
  var emp = null;
  readSheet('Employees').forEach(function (e) {
    if (String(e.emp_code) === String(empCode)) emp = e;
  });
  if (!emp) throw new Error('That employee code is not in the master.');

  var fence = geoCheck(emp, geo);
  if (!fence.ok) throw new Error(fence.reason);

  var n = nowParts();
  if (monthIsLocked(n.date.slice(0, 7))) {
    throw new Error('Payroll for this month is finalised, so today cannot be changed.');
  }

  /* Every tap is a punch and every punch is kept. Somebody who touches the
     button by mistake taps again; somebody who steps out at noon and comes
     back taps twice more. The day is bounded by the first tap and the last,
     exactly as it is for the machine on the gate - so there is no second
     punch to refuse and no way to end up in the wrong order. */
  /* HR may punch for somebody who has no phone, and that is a fair thing to
     allow - but the log must not then read as if the person tapped it
     themselves. Whoever actually pressed it is written beside the punch. */
  var byOther = caller && caller.email && String(caller.emp_code || '') !== String(empCode);
  var how = byOther ? 'app (by ' + caller.email + ')' : 'app';

  appendMany('Punches', [{
    id: newId(), punch_time: n.date + ' ' + n.time, emp_code: empCode, device_id: emp.device_id || '',
    device: how, direction: String(kind || ''), source: byOther ? 'app-on-behalf' : 'app',
    imported_at: n.stamp,
    lat: geo && geo.lat !== undefined ? geo.lat : '', lng: geo && geo.lng !== undefined ? geo.lng : '',
    accuracy: geo && geo.accuracy ? Math.round(parseFloat(geo.accuracy)) : '',
    site: fence.site || '', distance_m: fence.distance === undefined ? '' : fence.distance
  }]);

  var row = rebuildDayFromPunches(empCode, n.date, byOther ? 'app, by ' + caller.email : 'app',
                                  [n.time]);
  if (!row) {
    throw new Error('Today cannot be changed - it is on approved leave, or this month is finalised.');
  }
  if (note) {
    row.remarks = String(row.remarks + ' - ' + note).slice(0, 120);
    upsert('Attendance', row);
  }
  return { record: row, state: punchState(empCode), fence: fence, at: n.time };
}

function senderAddress() {
  try { return Session.getEffectiveUser().getEmail() || ''; } catch (e) { return ''; }
}

/**
 * Sends one batch of payslips. The client builds each mail (subject, plain
 * text and HTML) so the wording stays in Settings, next to everything else.
 * Every attempt is written to the PayslipMail tab, so the payroll screen can
 * show who has already been sent their slip and who bounced.
 *
 * items: [{ emp_code, name, to, subject, text, html, filename }]
 */
function sendPayslips(p, caller) {
  var items = (p && p.items) || [];
  if (!items.length) throw new Error('Nothing to send');

  var quota = MailApp.getRemainingDailyQuota();
  if (quota <= 0) {
    throw new Error('This Google account has used its daily email quota. It resets in 24 hours.');
  }

  var st = settingsMap();
  var attach = String((p && p.attachPdf) || st.payslip_email_attach_pdf || 'yes') !== 'no';
  var fromName = String((p && p.senderName) || st.payslip_email_from_name ||
                        st.company_name || 'HRMS').slice(0, 120);
  var replyTo = String((p && p.replyTo) || st.payslip_email_reply_to || '').trim();
  var cc = String((p && p.cc) || st.payslip_email_cc || '').trim();
  var bcc = String((p && p.bcc) || st.payslip_email_bcc || '').trim();
  var by = String((caller && caller.email) || (p && p.by) || '');
  var now = new Date();
  var stamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

  var sent = [], failed = [], log = [];
  var used = 0;

  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var to = String(it.to || '').trim();
    var entry = {
      id: newId(), month: String(it.month || ''), emp_code: String(it.emp_code || ''),
      name: String(it.name || ''), email: to, sent_at: stamp, status: 'sent', error: '', sent_by: by
    };

    if (!/^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/.test(to)) {
      entry.status = 'failed'; entry.error = 'No valid email address on the employee record';
      failed.push({ emp_code: entry.emp_code, name: entry.name, to: to, error: entry.error });
      log.push(entry);
      continue;
    }
    if (used >= quota) {
      entry.status = 'failed'; entry.error = 'Daily email quota reached';
      failed.push({ emp_code: entry.emp_code, name: entry.name, to: to, error: entry.error });
      log.push(entry);
      continue;
    }

    try {
      var opts = { name: fromName, htmlBody: String(it.html || '') };
      if (replyTo) opts.replyTo = replyTo;
      if (cc) opts.cc = cc;
      if (bcc) opts.bcc = bcc;
      if (attach && it.html) {
        try {
          var file = String(it.filename || ('payslip-' + entry.emp_code + '-' + entry.month));
          var pdf = Utilities.newBlob(String(it.html), 'text/html', file + '.html')
                             .getAs('application/pdf');
          pdf.setName(file + '.pdf');
          opts.attachments = [pdf];
        } catch (convErr) {
          // PDF conversion is best effort: the payslip is in the mail body anyway.
          entry.error = 'Sent without PDF: ' + (convErr.message || convErr);
        }
      }
      MailApp.sendEmail(to, String(it.subject || 'Payslip'), String(it.text || ''), opts);
      used++;
      sent.push({ emp_code: entry.emp_code, name: entry.name, to: to });
    } catch (err) {
      entry.status = 'failed';
      entry.error = String((err && err.message) || err);
      failed.push({ emp_code: entry.emp_code, name: entry.name, to: to, error: entry.error });
    }
    log.push(entry);
  }

  if (log.length) appendMany('PayslipMail', log);

  return {
    sent: sent, failed: failed,
    quotaLeft: MailApp.getRemainingDailyQuota(),
    from: senderAddress()
  };
}

/** Who has already been sent their payslip for one month. */
function payslipMailLog(month) {
  var want = String(month || '');
  return readSheet('PayslipMail').filter(function (r) {
    return !want || String(r.month) === want;
  });
}

/* ------------------------------------------------------------------ */
/* Accounts - owner only                                               */
/* ------------------------------------------------------------------ */

/** Never returns the password column. */
function listUsers() {
  return readSheet('Users').map(function (u) {
    return {
      email: String(u.email || ''),
      role: String(u.role || 'employee').toLowerCase(),
      emp_code: String(u.emp_code || ''),
      active: String(u.active || 'yes'),
      has_password: !!String(u.password || '')
    };
  });
}

function countOwners(users) {
  return users.filter(function (u) {
    return isOwner(String(u.role || '').toLowerCase()) &&
           String(u.active || 'yes').toLowerCase() !== 'no';
  }).length;
}

/**
 * Creates or updates one login. The password arrives in the clear over HTTPS
 * and is hashed here - it is never stored, returned or logged as typed.
 *
 * The guards exist so an owner cannot lock the company out of its own system:
 * the last active owner cannot be demoted, disabled or deleted, and nobody can
 * demote or disable themselves.
 */
function saveUser(user, caller) {
  user = user || {};
  var email = String(user.email || '').trim().toLowerCase();
  var role = String(user.role || 'employee').toLowerCase();
  if (role === 'admin') role = 'owner';

  if (!/^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/.test(email)) {
    throw new Error('That does not look like an email address.');
  }
  if (ROLES.indexOf(role) < 0) {
    throw new Error('Role must be one of: ' + ROLES.join(', '));
  }
  var empCode = String(user.emp_code || '').trim();
  var active = String(user.active || 'yes').toLowerCase() === 'no' ? 'no' : 'yes';
  var password = String(user.password || '');

  if (role === 'employee' && !empCode) {
    throw new Error('An employee login needs an employee code, or it signs in to an empty screen.');
  }
  if (empCode) {
    var known = false;
    readSheet('Employees').forEach(function (e) {
      if (String(e.emp_code) === empCode) known = true;
    });
    if (!known) throw new Error('There is no employee with the code ' + empCode + '.');
  }

  var rows = indexed('Users');
  var existing = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].data.email || '').trim().toLowerCase() === email) { existing = rows[i]; break; }
  }

  var me = String((caller && caller.email) || '').toLowerCase();
  var wasOwner = existing && isOwner(String(existing.data.role || '').toLowerCase()) &&
                 String(existing.data.active || 'yes').toLowerCase() !== 'no';
  var stillOwner = isOwner(role) && active === 'yes';

  if (email === me && !stillOwner) {
    throw new Error('You cannot remove your own owner access. Ask another owner to do it.');
  }
  if (wasOwner && !stillOwner && countOwners(readSheet('Users')) <= 1) {
    throw new Error('This is the only owner account. Make someone else an owner first.');
  }

  if (!existing && password.length < 6) {
    throw new Error('Set a password of at least 6 characters for the new account.');
  }
  if (password && password.length < 6) {
    throw new Error('The password must be at least 6 characters.');
  }

  var record = {
    email: email, role: role, emp_code: empCode, active: active,
    password: password ? hash(password)
                       : (existing ? String(existing.data.password || '') : '')
  };

  if (existing) {
    var cols = SHEETS.Users, sh = sheet('Users');
    sh.getRange(existing.row, 1, 1, cols.length).setValues([cols.map(function (c) {
      return record[c] === undefined ? existing.data[c] : record[c];
    })]);
  } else {
    appendRow('Users', record);
  }
  return { saved: email, role: role, created: !existing };
}

function removeUser(email, caller) {
  var want = String(email || '').trim().toLowerCase();
  var me = String((caller && caller.email) || '').toLowerCase();
  if (want === me) throw new Error('You cannot delete the account you are signed in with.');

  var rows = indexed('Users'), target = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].data.email || '').trim().toLowerCase() === want) { target = rows[i]; break; }
  }
  if (!target) throw new Error('No account with that email.');

  if (isOwner(String(target.data.role || '').toLowerCase()) &&
      countOwners(readSheet('Users')) <= 1) {
    throw new Error('This is the only owner account and cannot be deleted.');
  }
  sheet('Users').deleteRow(target.row);
  return { removed: want };
}

/** The notices on the board right now: active, started, not yet finished. */
function liveNotices() {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return readSheet('Notices').filter(function (n) {
    if (String(n.active || 'yes').toLowerCase() === 'no') return false;
    var from = String(n.start_date || ''), to = String(n.end_date || '');
    if (from && from > today) return false;
    if (to && to < today) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Managers: who reports to whom, and deciding their requests          */
/* ------------------------------------------------------------------ */

/**
 * The people who report to one employee.
 *
 * The Employees sheet holds "manager" as free text, so it is matched against
 * the manager's code first and their name second, both trimmed and
 * case-insensitive. That covers a sheet filled in either way.
 */
function reportsTo(empCode) {
  var code = String(empCode || '').trim().toLowerCase();
  if (!code) return [];
  var staff = readSheet('Employees');
  var me = null;
  staff.forEach(function (e) {
    if (String(e.emp_code).trim().toLowerCase() === code) me = e;
  });
  var name = me ? String(me.name || '').trim().toLowerCase() : '';

  return staff.filter(function (e) {
    if (String(e.emp_code).trim().toLowerCase() === code) return false;   // not themselves
    var m = String(e.manager || '').trim().toLowerCase();
    if (!m) return false;
    return m === code || (name && m === name);
  });
}

function isManagerOf(managerCode, staffCode) {
  var want = String(staffCode || '').trim().toLowerCase();
  return reportsTo(managerCode).some(function (e) {
    return String(e.emp_code).trim().toLowerCase() === want;
  });
}

/** What a manager is handed: their team, and everything of the team's that is waiting. */
function managerInbox(empCode) {
  var team = reportsTo(empCode);
  if (!team.length) return { isManager: false, team: [], teamLeave: [], teamRequests: [] };

  var codes = {};
  team.forEach(function (e) { codes[String(e.emp_code)] = true; });
  var mine = function (r) { return codes[String(r.emp_code)]; };

  /* Each item carries where it stands, and whether this particular person is
     the one it is waiting on right now. A manager at step 1 of 3 should not
     see step 2 as theirs to clear. */
  var caller = { role: 'employee', emp_code: empCode, email: '' };
  var withProgress = function (sheetName) {
    return function (r) {
      var p = progressOf(sheetName, r);
      r._step = p.at;
      r._steps = p.total;
      r._waiting_on = p.waitingOn;
      r._signed = p.signed;
      r._mine = String(r.status || 'Pending') === 'Pending' &&
                canClear(p.stage, caller, r.emp_code);
      return r;
    };
  };

  return {
    isManager: true,
    team: team.map(function (e) {
      return { emp_code: e.emp_code, name: e.name, department: e.department,
               designation: e.designation, status: e.status };
    }),
    teamLeave: readSheet('Leave').filter(mine).map(withProgress('Leave')),
    teamRequests: readSheet('Requests').filter(mine).map(withProgress('Requests'))
  };
}

var DECIDABLE = { Leave: 'decision_note', Requests: 'note' };

/* ------------------------------------------------------------------ */
/* Approval chains                                                     */
/* ------------------------------------------------------------------ */

/**
 * The stages an application passes through, in order.
 *
 * An empty ApprovalLevels sheet means one stage that either the reporting
 * manager or HR can clear - exactly how it behaved before chains existed, so
 * nothing breaks by upgrading and doing nothing.
 *
 * applies_to is "leave", the request code (od / swipe / co), or "all".
 * approver is one of:
 *    manager   - whoever the applicant reports to
 *    hr        - any HR or owner account
 *    owner     - an owner account only
 *    emp:CODE  - one named employee, whoever that is
 */
function approvalChain(kind) {
  var want = String(kind || '').toLowerCase();
  var live = readSheet('ApprovalLevels').filter(function (r) {
    return String(r.active || 'yes').toLowerCase() !== 'no';
  });
  /* A chain written for this kind is the chain. The "Everything" steps are the
     fallback for the kinds nobody wrote one for - not extra steps bolted on to
     the front of a company's own. */
  var rows = live.filter(function (r) {
    return String(r.applies_to || 'all').toLowerCase() === want;
  });
  if (!rows.length) {
    rows = live.filter(function (r) {
      return String(r.applies_to || 'all').toLowerCase() === 'all';
    });
  }
  if (!rows.length) {
    /* The default any company actually wants: the reporting manager says yes
       first, then HR grants it. A manager's yes moves the application on; it
       does not decide it. Change or extend this in Settings - Approvals. */
    return [
      { level: 1, approver: 'manager', label: 'Reporting manager' },
      { level: 2, approver: 'hr', label: 'HR' }
    ];
  }
  rows.sort(function (a, b) { return num(a.level) - num(b.level); });
  return rows.map(function (r, i) {
    return { level: i + 1, approver: String(r.approver || 'hr').toLowerCase().trim(),
             label: String(r.label || '') };
  });
}

function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

/** What kind of thing is this row, for chain purposes. */
function kindOf(sheetName, row) {
  return sheetName === 'Leave' ? 'leave' : String(row.type || '').toLowerCase();
}

/** May this caller clear this particular stage, for this applicant? */
function canClear(stage, caller, ownerCode) {
  var who = String(stage.approver || '');
  /* The owner can clear any stage. A manager on two weeks' leave must not be
     able to stop the company, and every signature is recorded against the
     application, so an override is visible rather than silent. */
  if (isOwner(caller.role)) return true;
  if (who === 'hr') return isHrOrAbove(caller.role);
  if (who === 'owner') return isOwner(caller.role);
  if (who === 'manager') {
    if (isManagerOf(caller.emp_code, ownerCode)) return true;
    /* Somebody with no reporting manager on record would otherwise wait for an
       approver who does not exist. HR stands in for that stage only. */
    return !hasManager(ownerCode) && isHrOrAbove(caller.role);
  }
  if (who === 'manager_or_hr') {
    return isHrOrAbove(caller.role) || isManagerOf(caller.emp_code, ownerCode);
  }
  if (who.indexOf('emp:') === 0) {
    return String(caller.emp_code || '').trim().toLowerCase() ===
           who.slice(4).trim().toLowerCase();
  }
  return false;
}

/** Is anybody named as this person's reporting manager? */
function hasManager(empCode) {
  var code = String(empCode || '').trim().toLowerCase();
  if (!code) return false;
  var named = '';
  readSheet('Employees').forEach(function (e) {
    if (String(e.emp_code).trim().toLowerCase() === code) named = String(e.manager || '').trim();
  });
  if (!named) return false;
  /* Named, but the name has to match somebody still on the rolls. */
  var want = named.toLowerCase();
  return readSheet('Employees').some(function (e) {
    return String(e.emp_code).trim().toLowerCase() === want ||
           String(e.name || '').trim().toLowerCase() === want;
  });
}

/** A readable name for a stage, for the screens. */
function stageLabel(stage) {
  if (stage.label) return stage.label;
  var who = String(stage.approver || '');
  if (who === 'hr') return 'HR';
  if (who === 'owner') return 'Management';
  if (who === 'manager') return 'Reporting manager';
  if (who === 'manager_or_hr') return 'Manager or HR';
  if (who.indexOf('emp:') === 0) return nameOfCode(who.slice(4));
  return who;
}

function nameOfCode(code) {
  var want = String(code || '').trim().toLowerCase(), out = String(code || '');
  readSheet('Employees').forEach(function (e) {
    if (String(e.emp_code).trim().toLowerCase() === want) out = e.name || out;
  });
  return out;
}

/**
 * Where an application currently stands: which stage it is on, who has
 * already signed it, and how many stages there are in total.
 */
function progressOf(sheetName, row) {
  var chain = approvalChain(kindOf(sheetName, row));
  var at = Math.max(1, Math.min(num(row.level) || 1, chain.length));
  var stage = chain[at - 1];
  return {
    chain: chain, total: chain.length, at: at, stage: stage,
    waitingOn: stageLabel(stage),
    signed: parseApprovals(row.approvals)
  };
}

function parseApprovals(text) {
  var out = [];
  String(text || '').split('|').forEach(function (part) {
    if (!part.trim()) return;
    var bits = part.split('~');            // level ~ who ~ when ~ note
    out.push({ level: num(bits[0]), by: bits[1] || '', at: bits[2] || '', note: bits[3] || '' });
  });
  return out;
}
function writeApprovals(list) {
  return list.map(function (a) {
    return [a.level, a.by, a.at, String(a.note || '').replace(/[|~]/g, ' ')].join('~');
  }).join('|');
}

/**
 * Approve, reject or cancel one application, one stage at a time.
 *
 * Approving clears the current stage only. If more stages follow, the
 * application stays Pending and moves to the next one; the last stage is what
 * finally makes it Approved and marks the register. A rejection at any stage
 * ends it there - there is no point sending a refused request further up.
 *
 * Only the four decision fields are ever written, so somebody approving a
 * leave cannot quietly change its dates on the way through.
 */
function decide(sheetName, id, status, note, caller) {
  var noteCol = DECIDABLE[sheetName];
  if (!noteCol) throw new Error('Nothing to decide on that sheet.');

  var want = String(status || '');
  if (['Approved', 'Rejected', 'Cancelled'].indexOf(want) < 0) {
    throw new Error('A decision must be Approved, Rejected or Cancelled.');
  }

  var rows = indexed(sheetName), target = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].data.id) === String(id)) { target = rows[i]; break; }
  }
  if (!target) throw new Error('That application no longer exists.');
  var row = target.data;

  var was = String(row.status || 'Pending');
  if (was !== 'Pending') throw new Error('This has already been ' + was.toLowerCase() + '.');

  var month = String(row.from_date || row.date || '').slice(0, 7);
  if (month && monthIsLocked(month)) {
    throw new Error('Payroll for ' + month + ' is finalised, so this cannot be changed now.');
  }

  var p = progressOf(sheetName, row);
  if (!canClear(p.stage, caller, row.emp_code)) {
    throw new Error('Not allowed. Step ' + p.at + ' of ' + p.total +
                    ' is with ' + p.waitingOn + '.');
  }

  var signed = p.signed;
  signed.push({ level: p.at, by: caller.email || '', at: nowStamp(), note: note || '' });

  var last = p.at >= p.total;
  var finalStatus = want === 'Approved' ? (last ? 'Approved' : 'Pending') : want;
  var nextLevel = (want === 'Approved' && !last) ? p.at + 1 : p.at;

  var sh = sheet(sheetName), cols = SHEETS[sheetName];
  var set = function (col, value) {
    var at = cols.indexOf(col);
    if (at >= 0) sh.getRange(target.row, at + 1).setValue(value);
  };
  set('status', finalStatus);
  set('level', nextLevel);
  set('approvals', writeApprovals(signed));
  set('decided_by', caller.email || '');
  set('decided_at', nowStamp());
  if (note) set(noteCol, String(note).slice(0, 500));

  var marked = 0;
  if (finalStatus === 'Approved') {
    marked = sheetName === 'Leave' ? markLeaveOnRegister(row) : applyRequestToRegister(row);
  }

  var after = approvalChain(kindOf(sheetName, row));
  return {
    id: id, status: finalStatus, days_marked: marked,
    cleared: p.at, total: p.total,
    done: finalStatus !== 'Pending',
    next: finalStatus === 'Pending' ? stageLabel(after[nextLevel - 1]) : ''
  };
}

function nowStamp() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function monthIsLocked(month) {
  var locked = false;
  readSheet('Payroll').forEach(function (r) {
    if (String(r.month) === String(month) && String(r.status) === 'Finalised') locked = true;
  });
  return locked;
}

/** Weekly offs and holidays are not charged as leave unless the sandwich rule says so. */
/**
 * What an approved request does to the register.
 *
 * The browser used to do this, which meant it only happened when HR pressed
 * Approve in the web app. A manager approving the same request on their phone
 * cleared the application and changed nothing: the out-duty day stayed blank
 * and the missed punch stayed open, so both were still docked at payroll.
 * It belongs here, where every approval path passes.
 */
function applyRequestToRegister(req) {
  var iso = String(req.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 0;

  var effect = '';
  readSheet('RequestTypes').forEach(function (t) {
    if (String(t.code || '').trim().toUpperCase() === String(req.type || '').trim().toUpperCase()) {
      effect = String(t.effect || 'none');
    }
  });
  if (effect !== 'present' && effect !== 'times') return 0;

  var have = {};
  readSheet('Attendance', attendanceWindow(readSheet('Employees').length)).forEach(function (a) {
    if (String(a.emp_code) === String(req.emp_code)) have[String(a.date)] = a;
  });

  if (effect === 'present') {
    /* Out duty is duty: worked away from the plant, and paid. It can run over
       several days, and a weekly off inside it stays an off. */
    var st = settingsMap();
    var offName = String(st.weekly_off || 'Sun').slice(0, 3).toLowerCase();
    var dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    var holiday = {};
    readSheet('Holidays').forEach(function (h) {
      if (String(h.optional || 'no').toLowerCase() !== 'yes') holiday[String(h.date)] = true;
    });
    var to = String(req.to_date || iso);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || to < iso) to = iso;

    var rows = [], cursor = new Date(iso + 'T00:00:00'), end = new Date(to + 'T00:00:00');
    var guard = 0;
    while (cursor <= end && guard++ < 62) {
      var day = Utilities.formatDate(cursor, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (dayNames[cursor.getDay()] !== offName && !holiday[day]) {
        var was = have[day] || {};
        rows.push({
          id: req.emp_code + '_' + day, date: day, emp_code: req.emp_code, status: 'OD',
          in_time: was.in_time || '', out_time: was.out_time || '', hours: was.hours || 0,
          remarks: 'OD approved: ' + String(req.reason || 'out of office duty').slice(0, 80),
          updated_at: day
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    if (rows.length) upsertMany('Attendance', rows);
    return rows.length;
  }

  /* A missed punch: the approved times are the times, and the day is judged
     against the employee's own shift - a short pair is still a half day. */
  var was2 = have[iso] || {};
  var inT = String(req.in_time || was2.in_time || '');
  var outT = String(req.out_time || was2.out_time || '');
  if (!inT && !outT) return 0;
  var mins = clockMinutes(outT) - clockMinutes(inT);
  if (mins < 0) mins += 24 * 60;                       /* a shift across midnight */
  var worked = (clockMinutes(inT) === null || clockMinutes(outT) === null) ? null : mins / 60;
  var cfg = shiftOf(req.emp_code);
  var status = was2.status || 'P';
  if (worked !== null) status = worked >= cfg.full ? 'P' : (worked >= cfg.half ? 'HD' : 'P');
  upsert('Attendance', {
    id: req.emp_code + '_' + iso, date: iso, emp_code: req.emp_code, status: status,
    in_time: inT, out_time: outT, hours: worked === null ? (was2.hours || 0) : Math.round(worked * 10) / 10,
    remarks: 'punch corrected by approval', updated_at: iso
  });
  return 1;
}

/** "09:30" -> 570. Null for anything that is not a clock time. */
function clockMinutes(value) {
  var m = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The full-day and half-day hours of whichever shift an employee works. */
function shiftOf(empCode) {
  var want = '';
  readSheet('Employees').forEach(function (e) {
    if (String(e.emp_code) === String(empCode)) want = String(e.shift || '').trim().toLowerCase();
  });
  var st = settingsMap();
  if (!want) want = String(st.default_shift || 'General').trim().toLowerCase();
  var hit = null, firstActive = null;
  readSheet('Shifts').forEach(function (sh) {
    if (String(sh.active || 'yes').toLowerCase() === 'no') return;
    if (!firstActive) firstActive = sh;
    if (String(sh.name || '').trim().toLowerCase() === want) hit = sh;
  });
  var use = hit || firstActive || {};
  return { full: Number(use.full_day_hours || 8) || 8, half: Number(use.half_day_hours || 4) || 4 };
}

function markLeaveOnRegister(leave) {
  var st = settingsMap();
  var sandwich = String(st.sandwich_rule || 'no').toLowerCase() === 'yes';
  var weeklyOff = String(st.weekly_off || 'Sun').slice(0, 3).toLowerCase();
  var days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  var holidays = {};
  readSheet('Holidays').forEach(function (h) {
    if (String(h.optional || 'no').toLowerCase() !== 'yes') holidays[String(h.date)] = true;
  });

  var from = String(leave.from_date || ''), to = String(leave.to_date || from);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return 0;

  var rows = [], cursor = new Date(from + 'T00:00:00'), end = new Date(to + 'T00:00:00');
  var guard = 0;
  while (cursor <= end && guard++ < 400) {
    var iso = Utilities.formatDate(cursor, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var off = days[cursor.getDay()] === weeklyOff || holidays[iso];
    if (!off || sandwich) {
      rows.push({
        id: leave.emp_code + '_' + iso, date: iso, emp_code: leave.emp_code,
        status: 'L', in_time: '', out_time: '', hours: 0,
        remarks: 'leave: ' + (leave.type || ''), updated_at: iso
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  if (rows.length) upsertMany('Attendance', rows);
  return rows.length;
}
