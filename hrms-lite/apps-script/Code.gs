/**
 * HRMS Lite - Google Apps Script backend
 * Database: the Google Spreadsheet this script is bound to.
 *
 * Deploy: Extensions > Apps Script > paste this file > Deploy > New deployment
 *         > Web app > Execute as "Me" > Who has access "Anyone" > Deploy.
 * Copy the /exec URL into the API URL box on the HRMS Lite login screen.
 */

var SHEETS = {
  Settings:   ['key', 'value'],
  Users:      ['email', 'password', 'role', 'emp_code', 'active'],
  Employees:  ['emp_code', 'name', 'email', 'phone', 'department', 'designation',
               'doj', 'status', 'basic', 'hra', 'special_allowance', 'other_allowance',
               'pf_applicable', 'esi_applicable', 'tds_monthly', 'pan', 'uan', 'esic_no',
               'bank_account', 'ifsc', 'manager', 'dob', 'gender', 'address', 'notes',
               'updated_at', 'exit_date', 'device_id', 'company', 'shift'],
  Attendance: ['id', 'date', 'emp_code', 'status', 'in_time', 'out_time', 'hours',
               'remarks', 'updated_at'],
  Holidays:   ['id', 'date', 'name', 'optional'],
  Shifts:     ['id', 'name', 'start_time', 'end_time', 'grace_minutes', 'full_day_hours',
               'half_day_hours', 'weekly_off', 'saturday_policy', 'ot_after_minutes', 'active'],
  LeaveTypes: ['id', 'name', 'paid', 'quota', 'carry_forward', 'max_consecutive', 'notice_days',
               'allow_half_day', 'active'],
  Punches:    ['id', 'punch_time', 'emp_code', 'device_id', 'device', 'direction', 'source', 'imported_at'],
  Leave:      ['id', 'emp_code', 'type', 'from_date', 'to_date', 'days', 'reason',
               'status', 'applied_at', 'decided_by', 'decided_at', 'decision_note'],
  Payroll:    ['id', 'month', 'emp_code', 'total_days', 'lop_days', 'paid_days',
               'basic', 'hra', 'special_allowance', 'other_allowance', 'gross',
               'pf', 'esi', 'pt', 'tds', 'other_deduction', 'total_deduction', 'net',
               'status', 'generated_at', 'generated_by',
               'arrears', 'bonus', 'pf_employer', 'esi_employer', 'ctc',
               'ot_hours', 'ot_amount', 'late_deduction_days', 'unpaid_leave_days']
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
  if (p.action) return handle(p.action, p.payload ? JSON.parse(p.payload) : {}, p.callback);
  return json({ ok: true, service: 'HRMS Lite', version: 1 });
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { body = {}; }
  return handle(body.action, body.payload || {}, null);
}

function handle(action, payload, callback) {
  var out;
  try {
    var lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      out = { ok: true, data: route(action, payload || {}) };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return callback ? jsonp(out, callback) : json(out);
}

function route(action, p) {
  switch (action) {
    case 'ping':        return { service: 'HRMS Lite', version: 1 };
    case 'setup':       return setup();
    case 'login':       return login(p.email, p.password);
    case 'bootstrap':   return bootstrap();
    case 'list':        return readSheet(p.sheet);
    case 'save':        return upsert(p.sheet, p.row);
    case 'saveMany':    return upsertMany(p.sheet, p.rows);
    case 'remove':      return removeRow(p.sheet, p.id);
    case 'removeMany':  return removeMany(p.sheet, p.ids);
    case 'saveSettings':return saveSettings(p.settings);
    case 'changePassword': return changePassword(p.email, p.oldPassword, p.newPassword);
    case 'setSecret':     return setSecret(p.key, p.value);
    case 'secretStatus':  return secretStatus();
    case 'esslPull':      return esslPull(p.from, p.to);
    case 'esslPush':      return esslPush(p.month, p.rows);
    case 'ingestPunches': return ingestPunches(p.punches, p.token, p.source);
    case 'testIntegration': return testIntegration();
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

  return { created: created, sheets: Object.keys(SHEETS) };
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
  return {
    email: user.email,
    role: String(user.role || 'employee').toLowerCase(),
    emp_code: user.emp_code || '',
    token: Utilities.base64Encode(user.email + '|' + Date.now())
  };
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

function bootstrap() {
  return {
    settings:   settingsMap(),
    employees:  readSheet('Employees'),
    attendance: readSheet('Attendance'),
    leave:      readSheet('Leave'),
    payroll:    readSheet('Payroll'),
    holidays:   readSheet('Holidays'),
    shifts:     readSheet('Shifts'),
    leaveTypes: readSheet('LeaveTypes'),
    secrets:    secretStatus(),
    users:      readSheet('Users').map(function (u) {
      return { email: u.email, role: u.role, emp_code: u.emp_code, active: u.active };
    })
  };
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
