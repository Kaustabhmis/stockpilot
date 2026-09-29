/* BISCS OS - the workspace API, on Postgres.
 *
 * Same contract as the Apps Script version: one endpoint, a body of
 * { action, payload, token }, a reply of { ok, data } or { ok:false, error }.
 * That is deliberate - both front ends already speak it, so they change only
 * their address, and the rules audit in tools/ runs against this unchanged.
 *
 * Nothing here knows whether it is running under Deno on Supabase or under
 * Node on a laptop: it is handed a `db` with one method, query(sql, params).
 *
 * What is DIFFERENT from the sheet version, on purpose:
 *
 *   Passwords are bcrypt with a per-user salt, checked inside Postgres by
 *   pgcrypto. The sheet stored one fast SHA-256 with a shared prefix, which
 *   anybody holding the Users tab could run through a word list in seconds -
 *   and the first password is the staff code, which everyone knows.
 *
 *   Reads take no lock and never did here; Postgres handles concurrent
 *   readers itself. The global lock that put the whole company in one queue
 *   has no equivalent and is simply gone.
 */

/* ------------------------------------------------------------------ */
/* Tables. The left-hand name is what the front ends call a "sheet".    */
/* ------------------------------------------------------------------ */
const TABLE = {
  Settings: 'settings', Users: 'users', Employees: 'employees',
  Attendance: 'attendance', Holidays: 'holidays', Events: 'events',
  Sites: 'sites', Shifts: 'shifts', LeaveTypes: 'leave_types',
  RequestTypes: 'request_types', Requests: 'requests',
  CtcVariables: 'ctc_variables', CtcComponents: 'ctc_components',
  CtcValues: 'ctc_values', Notices: 'notices',
  ApprovalLevels: 'approval_levels', PayslipMail: 'payslip_mail',
  Punches: 'punches', Leave: 'leave', Payroll: 'payroll'
};

/* Columns the front ends send as 'yes'/'no' but Postgres holds as booleans,
   and dates/times it sends as '' for "not set". Converting at the edge keeps
   every screen and every report exactly as it was. */
const BOOL_COLS = new Set([
  'active', 'optional', 'pinned', 'paid', 'carry_forward', 'allow_half_day',
  'allow_half', 'needs_approval', 'taxable', 'in_gross', 'in_pf_wage',
  'in_esi_wage', 'show_payslip', 'pf_applicable', 'esi_applicable'
]);
const DATE_COLS = new Set([
  'date', 'doj', 'exit_date', 'dob', 'from_date', 'to_date', 'applied_at',
  'decided_at', 'adjust_date', 'start_date', 'end_date', 'updated_at',
  'generated_at'
]);
const TIME_COLS = new Set(['in_time', 'out_time', 'start_time', 'end_time']);

const yes = v => v === true || /^(yes|true|1)$/i.test(String(v == null ? '' : v));
const blankToNull = v => (v === '' || v === undefined) ? null : v;

/* Postgres hands back a Date for a date column and a string for time; the
   screens want 'YYYY-MM-DD' and 'HH:MM', which is what the sheet gave them. */
function outValue(col, v) {
  if (v === null || v === undefined) {
    if (BOOL_COLS.has(col)) return 'no';
    return '';
  }
  if (BOOL_COLS.has(col)) return v ? 'yes' : 'no';
  if (v instanceof Date) {
    if (DATE_COLS.has(col)) return v.toISOString().slice(0, 10);
    return v.toISOString();
  }
  if (TIME_COLS.has(col)) return String(v).slice(0, 5);
  if (typeof v === 'string' && DATE_COLS.has(col)) return v.slice(0, 10);
  /* numeric comes back as a string from the driver; the screens do their own
     num() on it, but a plain number reads better and compares safely */
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return v;
}

function rowOut(row) {
  if (!row) return row;
  const out = {};
  for (const k of Object.keys(row)) out[k] = outValue(k, row[k]);
  return out;
}

function inValue(col, v) {
  if (BOOL_COLS.has(col)) return yes(v);
  if (DATE_COLS.has(col) || TIME_COLS.has(col)) return blankToNull(v);
  return v === undefined ? null : v;
}

/* ------------------------------------------------------------------ */
/* Errors that mean "sign in again" rather than "that did not work".    */
/* ------------------------------------------------------------------ */
const AUTH_PREFIX = 'AUTH:';
const authError = m => { const e = new Error(AUTH_PREFIX + m); e.authFailed = true; return e; };

/* ------------------------------------------------------------------ */
export function createApi(db, opts = {}) {
  const SESSION_HOURS = opts.sessionHours || 12;
  const secret = opts.tokenSecret || 'change-me';
  const crypto = opts.crypto;              /* { hmac(key, msg) -> hex } */

  const one = async (sql, params) => (await db.query(sql, params)).rows[0] || null;
  const all = async (sql, params) => (await db.query(sql, params)).rows;

  const columnsOf = async table => {
    const rows = await all(
      `select column_name from information_schema.columns
        where table_schema = 'hrms' and table_name = $1`, [table]);
    return rows.map(r => r.column_name);
  };
  const colCache = {};
  const cols = async table => (colCache[table] || (colCache[table] = await columnsOf(table)));

  const tableFor = sheet => {
    const t = TABLE[sheet];
    if (!t) throw new Error('There is no ' + sheet + ' table.');
    return t;
  };

  /* -------------------------------------------------------------- */
  /* Settings                                                        */
  /* -------------------------------------------------------------- */
  async function settingsMap() {
    const rows = await all('select key, value from hrms.settings');
    const m = {};
    rows.forEach(r => m[r.key] = r.value);
    return m;
  }

  /* -------------------------------------------------------------- */
  /* The revision counter the screens poll                           */
  /* -------------------------------------------------------------- */
  const STAFF_TABS = new Set(['Leave', 'Requests', 'Notices', 'Holidays', 'Settings',
    'Employees', 'Payroll', 'Shifts', 'LeaveTypes', 'RequestTypes',
    'ApprovalLevels', 'Sites', 'Users']);

  async function bumpRevision(dirty) {
    const tabs = Object.keys(dirty || {});
    if (!tabs.length) return null;
    const staffToo = tabs.some(t => STAFF_TABS.has(t));
    const r = await one(
      `update hrms.revision
          set rev = rev + 1,
              staff = staff + case when $2 then 1 else 0 end,
              tabs = $1
        where id = 1
      returning rev, staff`, [tabs.join(','), staffToo]);
    return r ? { rev: Number(r.rev), staff: Number(r.staff) } : null;
  }

  async function currentRevision(caller) {
    const r = await one('select rev, staff, tabs from hrms.revision where id = 1');
    if (!r) return { rev: 0, tabs: '' };
    const hr = isHrOrAbove(caller.role);
    return { rev: Number(hr ? r.rev : r.staff), tabs: hr ? (r.tabs || '') : '' };
  }

  /* -------------------------------------------------------------- */
  /* Who is calling                                                  */
  /* -------------------------------------------------------------- */
  const isOwner = r => r === 'owner' || r === 'admin';
  const isHrOrAbove = r => isOwner(r) || r === 'hr';

  async function signToken(who) {
    const body = JSON.stringify({
      email: who.email, role: who.role, emp_code: who.emp_code || '',
      exp: Date.now() + SESSION_HOURS * 3600 * 1000
    });
    const b64 = btoa(body);
    const sig = await crypto.hmac(secret, b64);
    return b64 + '.' + sig;
  }

  async function readToken(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) throw authError('Please sign in again.');
    const want = await crypto.hmac(secret, parts[0]);
    if (want !== parts[1]) throw authError('Please sign in again.');
    let body;
    try { body = JSON.parse(atob(parts[0])); }
    catch (e) { throw authError('Please sign in again.'); }
    if (!body.exp || body.exp < Date.now()) throw authError('Your session has expired.');
    return body;
  }

  const PUBLIC_ACTIONS = new Set(['login', 'ping', 'setup']);
  const EMPLOYEE_ACTIONS = new Set(['bootstrap', 'changePassword', 'punchState',
    'webPunch', 'ping', 'rev', 'myMonth', 'save', 'remove', 'decide']);
  const OWNER_ACTIONS = new Set(['saveUser', 'removeUser', 'listUsers',
    'setSecret', 'secretStatus', 'testIntegration', 'esslPull', 'esslPush']);

  async function authenticate(action, token) {
    if (!token && PUBLIC_ACTIONS.has(action)) return { role: 'public', email: '' };
    const body = await readToken(token);
    /* the account is re-read every request: disabling somebody has to take
       effect now, not when their twelve hours run out */
    const u = await one(
      'select email, role, emp_code, active from hrms.users where lower(email) = lower($1)',
      [body.email]);
    if (!u) throw authError('That account no longer exists.');
    if (!u.active) throw authError('That account has been switched off.');
    return { email: u.email, role: u.role, emp_code: u.emp_code || '' };
  }

  /* What an employee may write, and to which of their own fields. */
  const EMPLOYEE_WRITE = new Set(['Leave', 'Requests']);
  const EMPLOYEE_OWN_FIELDS = new Set(['phone', 'email', 'address', 'dob', 'gender',
    'blood_group']);

  async function authorize(action, p, caller) {
    if (caller.role === 'public') {
      if (!PUBLIC_ACTIONS.has(action)) throw authError('Please sign in.');
      return;
    }
    if (isOwner(caller.role)) return;

    if (isHrOrAbove(caller.role)) {
      if (OWNER_ACTIONS.has(action)) {
        throw new Error('Not allowed. Only the system owner can do this.');
      }
      if (['save', 'saveMany', 'remove', 'removeMany'].includes(action) && p.sheet === 'Users') {
        throw new Error('Not allowed. Only the system owner can change accounts.');
      }
      return;
    }

    if (!EMPLOYEE_ACTIONS.has(action)) {
      throw new Error('Not allowed. Your account does not have permission for this.');
    }
    const code = String(caller.emp_code || '');
    if (['bootstrap', 'ping', 'rev', 'myMonth', 'decide', 'punchState', 'webPunch',
         'changePassword'].includes(action)) return;

    if (action === 'save') {
      if (p.sheet === 'Employees') {
        /* their own record, and only the handful of fields that are theirs */
        if (String(p.row && p.row.emp_code) !== code) {
          throw new Error('Not allowed. You can only change your own details.');
        }
        const touched = Object.keys(p.row || {}).filter(k => k !== 'emp_code');
        const bad = touched.filter(k => !EMPLOYEE_OWN_FIELDS.has(k));
        if (bad.length) {
          throw new Error('Not allowed. HR sets ' + bad.join(', ') + '.');
        }
        return;
      }
      if (!EMPLOYEE_WRITE.has(p.sheet)) {
        throw new Error('Not allowed. Your account does not have permission for this.');
      }
      /* always filed under their own code, whatever the request claims */
      p.row = Object.assign({}, p.row, { emp_code: code });
      return;
    }
    if (action === 'remove') {
      if (!EMPLOYEE_WRITE.has(p.sheet)) {
        throw new Error('Not allowed. Your account does not have permission for this.');
      }
      const row = await one(
        `select emp_code, status from hrms.${tableFor(p.sheet)} where id = $1`, [p.id]);
      if (!row || String(row.emp_code) !== code) {
        throw new Error('Not allowed. That is not yours.');
      }
      if (String(row.status || '') !== 'Pending') {
        throw new Error('That has already been decided.');
      }
      return;
    }
    throw new Error('Not allowed. Your account does not have permission for this.');
  }

  /* -------------------------------------------------------------- */
  /* Generic reads and writes                                        */
  /* -------------------------------------------------------------- */
  async function listSheet(sheet) {
    const t = tableFor(sheet);
    const order = { Attendance: 'date', Punches: 'punch_time', Payroll: 'month',
                    CtcComponents: 'seq' }[sheet];
    const rows = await all(`select * from hrms.${t}` + (order ? ` order by ${order}` : ''));
    return rows.map(rowOut);
  }

  async function upsertRow(sheet, row, dirty) {
    const t = tableFor(sheet);
    const known = await cols(t);
    const data = {};
    for (const k of Object.keys(row || {})) {
      if (known.includes(k)) data[k] = inValue(k, row[k]);
    }
    const key = sheet === 'Settings' ? 'key' : (sheet === 'Users' ? 'email'
              : (sheet === 'Employees' ? 'emp_code' : 'id'));
    if (!data[key]) {
      if (key === 'id') data.id = newId();
      else throw new Error('A ' + key + ' is needed.');
    }
    if (sheet === 'Users') data.email = String(data.email).trim().toLowerCase();

    const names = Object.keys(data);
    const ph = names.map((_, i) => '$' + (i + 1));
    const updates = names.filter(n => n !== key)
      .map(n => `${n} = excluded.${n}`).join(', ');
    const sql = `insert into hrms.${t} (${names.join(',')}) values (${ph.join(',')})
                 on conflict (${key}) do update set ${updates || key + ' = excluded.' + key}
                 returning *`;
    const saved = await one(sql, names.map(n => data[n]));
    if (dirty) dirty[sheet] = 1;
    return rowOut(saved);
  }

  async function upsertMany(sheet, rows, dirty) {
    const out = [];
    for (const r of rows || []) out.push(await upsertRow(sheet, r, dirty));
    return { saved: out.length, rows: out };
  }

  async function removeRow(sheet, id, dirty) {
    const t = tableFor(sheet);
    const key = sheet === 'Settings' ? 'key' : (sheet === 'Users' ? 'email'
              : (sheet === 'Employees' ? 'emp_code' : 'id'));
    await db.query(`delete from hrms.${t} where ${key} = $1`, [id]);
    if (dirty) dirty[sheet] = 1;
    return { removed: id };
  }

  async function removeMany(sheet, ids, dirty) {
    const t = tableFor(sheet);
    const key = sheet === 'Settings' ? 'key' : (sheet === 'Users' ? 'email'
              : (sheet === 'Employees' ? 'emp_code' : 'id'));
    await db.query(`delete from hrms.${t} where ${key} = any($1)`, [ids || []]);
    if (dirty) dirty[sheet] = 1;
    return { removed: (ids || []).length };
  }

  async function saveSettings(settings, dirty) {
    const entries = Object.entries(settings || {});
    for (const [k, v] of entries) {
      await db.query(
        `insert into hrms.settings (key, value) values ($1, $2)
         on conflict (key) do update set value = excluded.value`,
        [k, v === undefined || v === null ? '' : String(v)]);
    }
    if (dirty && entries.length) dirty.Settings = 1;
    return { saved: entries.length };
  }

  let idSeq = 0;
  function newId() {
    idSeq = (idSeq + 1) % 100000;
    return Date.now().toString(36) + idSeq.toString(36) +
           Math.floor(Math.random() * 1e6).toString(36);
  }

  return {
    TABLE, isOwner, isHrOrAbove, settingsMap, bumpRevision, currentRevision,
    signToken, readToken, authenticate, authorize,
    listSheet, upsertRow, upsertMany, removeRow, removeMany, saveSettings,
    newId, one, all, cols, tableFor, rowOut, yes,
    AUTH_PREFIX
  };
}

export { TABLE, AUTH_PREFIX };
