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
               'updated_at', 'exit_date'],
  Attendance: ['id', 'date', 'emp_code', 'status', 'in_time', 'out_time', 'hours',
               'remarks', 'updated_at'],
  Holidays:   ['id', 'date', 'name', 'optional'],
  Leave:      ['id', 'emp_code', 'type', 'from_date', 'to_date', 'days', 'reason',
               'status', 'applied_at', 'decided_by', 'decided_at', 'decision_note'],
  Payroll:    ['id', 'month', 'emp_code', 'total_days', 'lop_days', 'paid_days',
               'basic', 'hra', 'special_allowance', 'other_allowance', 'gross',
               'pf', 'esi', 'pt', 'tds', 'other_deduction', 'total_deduction', 'net',
               'status', 'generated_at', 'generated_by',
               'arrears', 'bonus', 'pf_employer', 'esi_employer', 'ctc']
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
  if (!row[key]) row[key] = name === 'Employees' ? nextEmpCode() : newId();
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

function upsertMany(name, rows) {
  (rows || []).forEach(function (r) { upsert(name, r); });
  return { saved: (rows || []).length };
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

function nextEmpCode() {
  var max = 0;
  readSheet('Employees').forEach(function (e) {
    var m = String(e.emp_code || '').match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'EMP' + ('000' + (max + 1)).slice(-4);
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
