/**
 * HRMS Lite - Google Apps Script backend
 * Database: the Google Spreadsheet this script is bound to.
 *
 * Deploy: Extensions > Apps Script > paste this file > Deploy > New deployment
 *         > Web app > Execute as "Me" > Who has access "Anyone" > Deploy.
 * Copy the /exec URL into the API URL box on the HRMS Lite login screen.
 */

var VERSION = 2;

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
                 'decided_at', 'note'],
  CtcVariables: ['id', 'code', 'value', 'note'],
  CtcComponents: ['id', 'seq', 'code', 'name', 'section', 'kind', 'expr', 'taxable',
                  'in_gross', 'in_pf_wage', 'in_esi_wage', 'show_payslip', 'active'],
  CtcValues:    ['id', 'emp_code', 'code', 'value'],
  PayslipMail: ['id', 'month', 'emp_code', 'name', 'email', 'sent_at', 'status', 'error', 'sent_by'],
  Punches:    ['id', 'punch_time', 'emp_code', 'device_id', 'device', 'direction', 'source',
               'imported_at', 'lat', 'lng', 'accuracy', 'site', 'distance_m'],
  Leave:      ['id', 'emp_code', 'type', 'from_date', 'to_date', 'days', 'reason',
               'status', 'applied_at', 'decided_by', 'decided_at', 'decision_note'],
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
    var caller = authenticate(action, token);
    authorize(action, payload || {}, caller);

    var lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      out = { ok: true, data: route(action, payload || {}, caller) };
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
  save: 1, remove: 1
};

/* The only tabs an employee may write to, and only their own rows. */
var EMPLOYEE_WRITE_SHEETS = { Leave: 1, Requests: 1 };

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

  if (action === 'bootstrap' || action === 'ping') return;   // read-only, already scoped
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
    case 'ingestPunches': return ingestPunches(p.punches, p.token, p.source);
    case 'testIntegration': return testIntegration();
    case 'webPunch':      return webPunch(p.emp_code, p.kind, p.note);
    case 'punchState':    return punchState(p.emp_code);
    case 'sendPayslips':  return sendPayslips(p, caller);
    case 'mailQuota':     return { left: MailApp.getRemainingDailyQuota(), from: senderAddress() };
    case 'payslipMailLog': return payslipMailLog(p.month);
    case 'listUsers':     return listUsers();
    case 'saveUser':      return saveUser(p.user, caller);
    case 'removeUser':    return removeUser(p.email, caller);
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
  var mail = String(email || '').trim().toLowerCase();
  var user = null;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email || '').trim().toLowerCase() === mail) { user = users[i]; break; }
  }
  if (!user) throw new Error('No account found for this email');
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

function onlyMine(sheetName, code) {
  return readSheet(sheetName).filter(function (r) {
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
function bootstrap(caller) {
  if (caller && isHrOrAbove(caller.role)) {
    var owner = isOwner(caller.role);
    return {
      role: owner ? 'owner' : 'hr',
      settings:   owner ? settingsMap() : hrSettings(),
      employees:  readSheet('Employees'),
      attendance: readSheet('Attendance'),
      leave:      readSheet('Leave'),
      payroll:    readSheet('Payroll'),
      holidays:   readSheet('Holidays'),
      events:     readSheet('Events'),
      sites:      readSheet('Sites'),
      shifts:     readSheet('Shifts'),
      leaveTypes: readSheet('LeaveTypes'),
      requestTypes: readSheet('RequestTypes'),
      requests:    readSheet('Requests'),
      ctcVariables:  readSheet('CtcVariables'),
      ctcComponents: readSheet('CtcComponents'),
      ctcValues:     readSheet('CtcValues'),
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
      attendance:  code ? onlyMine('Attendance', code) : [],
      leave:       code ? onlyMine('Leave', code) : [],
      payroll:     code ? onlyMine('Payroll', code) : [],
      requests:    code ? onlyMine('Requests', code) : [],
      punches:     code ? onlyMine('Punches', code) : [],
      ctcValues:   code ? onlyMine('CtcValues', code) : [],
      holidays:    readSheet('Holidays'),
      events:      readSheet('Events'),
      shifts:      readSheet('Shifts'),
      leaveTypes:  readSheet('LeaveTypes'),
      requestTypes: readSheet('RequestTypes'),
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

function readSheet(name) {
  return indexed(name).map(function (x) { return x.data; });
}

/**
 * Every non-blank data row with the sheet row number it lives on.
 * Writers must use this - readSheet() skips blank rows, so its array
 * index would point at the wrong sheet row once a gap exists.
 */
function indexed(name) {
  var sh = sheet(name);
  var headers = SHEETS[name];
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var tz = Session.getScriptTimeZone();
  var out = [];
  values.forEach(function (r, i) {
    if (r.join('') === '') return;
    var obj = {};
    headers.forEach(function (h, c) { obj[h] = normalize(r[c], h, tz); });
    out.push({ row: i + 2, data: obj });
  });
  return out;
}

function normalize(value, header, tz) {
  if (value instanceof Date) {
    var dateOnly = /(^date$|_date$|^doj$|^dob$)/.test(header);
    return Utilities.formatDate(value, tz, dateOnly ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ss");
  }
  return value === null || value === undefined ? '' : value;
}

function keyColumn(name) { return name === 'Employees' ? 'emp_code' : (name === 'Users' ? 'email' : 'id'); }

function upsert(name, row) {
  var headers = SHEETS[name];
  var key = keyColumn(name);
  if (name === 'Employees' && !String(row.emp_code || '').trim()) {
    throw new Error('Employee code is required - it is entered by you, not generated.');
  }
  if (!row[key]) row[key] = newId();
  var sh = sheet(name);
  var rows = indexed(name);
  var line = headers.map(function (h) { return row[h] === undefined ? '' : row[h]; });
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].data[key]) === String(row[key])) {
      // keep values the caller did not send
      var prev = rows[i].data;
      line = headers.map(function (h) { return row[h] === undefined ? prev[h] : row[h]; });
      sh.getRange(rows[i].row, 1, 1, headers.length).setValues([line]);
      return row;
    }
  }
  sh.appendRow(line);
  return row;
}

/**
 * Bulk upsert: read the tab once, merge in memory, write it back in one call.
 * Doing this row by row is O(n^2) and times out on a real import (500
 * employees, or a month of biometric punches).
 */
function upsertMany(name, rows) {
  rows = rows || [];
  if (!rows.length) return { saved: 0 };
  var headers = SHEETS[name], key = keyColumn(name);
  var sh = sheet(name);
  var existing = indexed(name);
  var values = existing.map(function (x) {
    return headers.map(function (h) { return x.data[h] === undefined ? '' : x.data[h]; });
  });
  var byKey = {};
  existing.forEach(function (x, i) { byKey[String(x.data[key])] = i; });

  rows.forEach(function (row) {
    if (name === 'Employees' && !String(row.emp_code || '').trim()) {
      throw new Error('Employee code is required - it is entered by you, not generated.');
    }
    if (!row[key]) row[key] = newId();
    var k = String(row[key]);
    var at = byKey[k];
    if (at === undefined) {
      byKey[k] = values.length;
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
  return { saved: rows.length, total: values.length };
}

/** Append-only, for the raw punch log - never keyed, never rewritten. */
function appendMany(name, rows) {
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
  var headers = SHEETS[name];
  sheet(name).appendRow(headers.map(function (h) { return row[h] === undefined ? '' : row[h]; }));
  return row;
}

function removeRow(name, id) {
  var key = keyColumn(name);
  var rows = indexed(name);
  var sh = sheet(name);
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i].data[key]) === String(id)) { sh.deleteRow(rows[i].row); return { removed: id }; }
  }
  throw new Error('Record not found: ' + id);
}

function removeMany(name, ids) {
  var key = keyColumn(name);
  var wanted = {};
  (ids || []).forEach(function (id) { wanted[String(id)] = true; });
  var rows = indexed(name);
  var sh = sheet(name);
  var removed = 0;
  for (var i = rows.length - 1; i >= 0; i--) {
    if (wanted[String(rows[i].data[key])]) { sh.deleteRow(rows[i].row); removed++; }
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
function ingestPunches(punches, token, source) {
  if (secret('ingest_token') && String(token || '') !== secret('ingest_token')) {
    throw new Error('Invalid or missing ingest token.');
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
  return {
    emp_code:  String(pick(['empcode', 'employeecode', 'employeeid', 'empid']) || '').trim(),
    device_id: String(pick(['deviceid', 'userid', 'enrollno', 'enrollnumber', 'indexid', 'usrid']) || '').trim(),
    punch_time: String(pick(['punchtime', 'logdate', 'attdatetime', 'datetime', 'timestamp',
                             'punchdate', 'recordtime']) || '').trim(),
    device:    String(pick(['device', 'devicename', 'serialnumber', 'deviceserial']) || '').trim(),
    direction: String(pick(['direction', 'inout', 'punchtype', 'c1']) || '').trim()
  };
}

function parsePunchTime(v) {
  var s = String(v || '').trim().replace('T', ' ');
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ ]?(\d{2})?:?(\d{2})?/);
  if (m) return { date: m[1] + '-' + m[2] + '-' + m[3], time: (m[4] || '00') + ':' + (m[5] || '00') };
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})[ ]+(\d{1,2}):(\d{2})/);   /* dd/mm/yyyy hh:mm */
  if (m) {
    return { date: m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2),
             time: ('0' + m[4]).slice(-2) + ':' + m[5] };
  }
  return null;
}

/**
 * Turn raw punches into attendance rows: first punch in, last punch out,
 * status from the hours worked. Approved leave and finalised months are
 * never overwritten.
 */
function applyPunches(punches, source) {
  var st = settingsMap();
  var fullHours = parseFloat(st.full_day_hours || 8);
  var halfHours = parseFloat(st.half_day_hours || 4);

  var byDevice = {}, known = {};
  readSheet('Employees').forEach(function (e) {
    known[String(e.emp_code).toUpperCase()] = e.emp_code;
    if (e.device_id) byDevice[String(e.device_id).trim()] = e.emp_code;
  });

  var lockedMonths = {};
  readSheet('Payroll').forEach(function (r) {
    if (r.status === 'Finalised') lockedMonths[String(r.month)] = true;
  });

  var leaveDays = {};
  readSheet('Attendance').forEach(function (a) {
    if (a.status === 'L') leaveDays[a.emp_code + '_' + a.date] = true;
  });

  var groups = {}, skipped = [], rawRows = [], stamp = new Date().toISOString();
  punches.forEach(function (p, i) {
    var code = p.emp_code && known[p.emp_code.toUpperCase()]
      ? known[p.emp_code.toUpperCase()]
      : (p.device_id ? byDevice[p.device_id] : '');
    var when = parsePunchTime(p.punch_time);
    if (!when) { skipped.push('Row ' + (i + 1) + ': unreadable time "' + p.punch_time + '"'); return; }
    if (!code) {
      skipped.push('Row ' + (i + 1) + ': no employee matches code "' + p.emp_code +
        '" / device id "' + p.device_id + '"');
      return;
    }
    rawRows.push({ id: newId(), punch_time: when.date + ' ' + when.time, emp_code: code,
                   device_id: p.device_id, device: p.device, direction: p.direction,
                   source: source, imported_at: stamp });
    var key = code + '_' + when.date;
    groups[key] = groups[key] || { code: code, date: when.date, times: [] };
    groups[key].times.push(when.time);
  });

  var rows = [], conflicts = 0;
  Object.keys(groups).forEach(function (key) {
    var g = groups[key];
    if (lockedMonths[g.date.slice(0, 7)]) { conflicts++; return; }
    if (leaveDays[key]) { conflicts++; return; }
    g.times.sort();
    var inT = g.times[0], outT = g.times[g.times.length - 1];
    var mins = function (t) { return (+t.slice(0, 2)) * 60 + (+t.slice(3, 5)); };
    var hours = g.times.length > 1 ? (mins(outT) - mins(inT)) / 60 : 0;
    var status, remark = source;
    if (g.times.length < 2) { status = 'P'; remark = source + ' - single punch, verify'; }
    else if (hours >= fullHours) status = 'P';
    else if (hours >= halfHours) { status = 'HD'; remark = source + ' - ' + hours.toFixed(1) + ' h'; }
    else { status = 'A'; remark = source + ' - only ' + hours.toFixed(1) + ' h, verify'; }
    rows.push({
      id: key, date: g.date, emp_code: g.code, status: status,
      in_time: inT, out_time: g.times.length > 1 ? outT : '',
      hours: g.times.length > 1 ? Math.round(hours * 10) / 10 : 0,
      remarks: remark, updated_at: stamp.slice(0, 10)
    });
  });

  if (rawRows.length && String(st.keep_punch_log || 'yes').toLowerCase() === 'yes') {
    appendMany('Punches', rawRows);
    trimPunches();
  }
  if (rows.length) upsertMany('Attendance', rows);

  return {
    punches: punches.length, days: rows.length, skipped: skipped.slice(0, 20),
    skippedCount: skipped.length, protectedDays: conflicts, source: source
  };
}


/* ==================================================================
   WEB PUNCH
   The time comes from this script, not from the browser, so a device
   clock cannot be moved to fake an in-time.
   ================================================================== */

function nowParts() {
  var tz = Session.getScriptTimeZone(), now = new Date();
  return {
    date: Utilities.formatDate(now, tz, 'yyyy-MM-dd'),
    time: Utilities.formatDate(now, tz, 'HH:mm'),
    stamp: Utilities.formatDate(now, tz, "yyyy-MM-dd'T'HH:mm:ss")
  };
}

/** Today's punch record plus any earlier day left open. */
function punchState(empCode) {
  if (!empCode) throw new Error('No employee is linked to this login.');
  var n = nowParts();
  var rows = readSheet('Attendance').filter(function (a) {
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

function webPunch(empCode, kind, note, geo) {
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
  if (readSheet('Payroll').some(function (r) {
    return String(r.month) === n.date.slice(0, 7) && r.status === 'Finalised';
  })) {
    throw new Error('Payroll for this month is finalised, so today cannot be changed.');
  }

  var id = empCode + '_' + n.date;
  var row = null;
  readSheet('Attendance').forEach(function (a) { if (String(a.id) === id) row = a; });
  row = row || { id: id, date: n.date, emp_code: empCode, status: '', in_time: '', out_time: '',
                 hours: 0, remarks: '' };

  if (kind === 'in') {
    if (row.in_time) throw new Error('Already punched in at ' + row.in_time + '.');
    row.in_time = n.time;
    row.out_time = '';
    row.status = 'P';
    row.hours = 0;
    row.remarks = 'web punch in' + (fence.site ? ' @ ' + fence.site : '') + (note ? ' - ' + note : '');
  } else if (kind === 'out') {
    if (!row.in_time) throw new Error('Punch in first.');
    if (row.out_time) throw new Error('Already punched out at ' + row.out_time + '.');
    row.out_time = n.time;
    var mins = function (t) { return (+String(t).slice(0, 2)) * 60 + (+String(t).slice(3, 5)); };
    var hours = (mins(row.out_time) - mins(row.in_time)) / 60;
    if (hours < 0) hours = 0;
    row.hours = Math.round(hours * 10) / 10;
    var full = parseFloat(st.full_day_hours || 8), half = parseFloat(st.half_day_hours || 4);
    row.status = hours >= full ? 'P' : (hours >= half ? 'HD' : 'HD');
    row.remarks = 'web punch ' + row.in_time + '-' + row.out_time +
      (hours < half ? ' (short day, verify)' : '');
  } else {
    throw new Error('Unknown punch type.');
  }
  row.updated_at = n.date;
  upsert('Attendance', row);
  appendMany('Punches', [{
    id: newId(), punch_time: n.date + ' ' + n.time, emp_code: empCode, device_id: emp.device_id || '',
    device: 'web', direction: kind, source: 'web', imported_at: n.stamp,
    lat: geo && geo.lat !== undefined ? geo.lat : '', lng: geo && geo.lng !== undefined ? geo.lng : '',
    accuracy: geo && geo.accuracy ? Math.round(parseFloat(geo.accuracy)) : '',
    site: fence.site || '', distance_m: fence.distance === undefined ? '' : fence.distance
  }]);
  return { record: row, state: punchState(empCode), fence: fence };
}

/* ------------------------------------------------------------------ */
/* Payslips by email                                                   */
/* ------------------------------------------------------------------ */

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
