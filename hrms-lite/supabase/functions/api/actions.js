/* The actions, on Postgres.
 *
 * The same thirty-odd actions the Apps Script version answered, so both front
 * ends and the whole rules audit run against this unchanged.
 *
 * A lot of the old file was working around the sheet: tail windows, guessing
 * how many rows to read to reach a month, reading the date column on its own
 * to find a band of rows, then checking the guess because one future-dated row
 * made it wrong. None of that exists here. "One month of the register" is a
 * where clause on an indexed date column.
 */

export function createActions(api, db, deps) {
  const { one, all, rowOut, yes, isHrOrAbove, isOwner, settingsMap,
          listSheet, upsertRow, upsertMany, removeRow, removeMany,
          saveSettings, currentRevision, newId, tableFor } = api;
  const now = deps.now || (() => new Date());
  const tz = deps.timezone || 'Asia/Kolkata';

  /* local calendar date and clock, in the company's own time zone */
  /* Built once. Constructing an Intl formatter is expensive, and building one
     per row turned a five-thousand-punch day into half a second of pure
     formatting. */
  const HM = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit',
    minute: '2-digit', hour12: false });
  const YMDHM = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const asDate = v => v instanceof Date ? v : new Date(v);

  function nowParts() {
    const d = now();
    const s = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(d).reduce((m, p) => (m[p.type] = p.value, m), {});
    return {
      date: `${s.year}-${s.month}-${s.day}`,
      time: `${s.hour === '24' ? '00' : s.hour}:${s.minute}`
    };
  }
  const today = () => nowParts().date;

  /* ---------------------------------------------------------------- */
  /* Rest days - the employee's OWN shift, as the register draws them   */
  /* ---------------------------------------------------------------- */
  const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  function weeklyOffSet(value) {
    const raw = (value === undefined || value === null || String(value) === '')
      ? 'Sun' : String(value);
    const out = {};
    raw.split(',').forEach(part => {
      const t = String(part || '').trim().toLowerCase();
      if (!t) return;
      if (/^[0-7]$/.test(t)) { out[Number(t) === 7 ? 0 : Number(t)] = 1; return; }
      for (let i = 0; i < 7; i++) if (t.slice(0, 3) === DAY_NAMES[i]) out[i] = 1;
    });
    return out;
  }

  function saturdayIsOff(dayOfMonth, policy) {
    const nth = Math.floor((dayOfMonth - 1) / 7) + 1;
    switch (String(policy || 'working')) {
      case 'all_off': return true;
      case '2_4': return nth === 2 || nth === 4;
      case '1_3': return nth === 1 || nth === 3;
      case 'alt':  return nth % 2 === 0;
      default: return false;
    }
  }

  async function shiftOf(empCode) {
    const st = await settingsMap();
    const e = await one('select shift from hrms.employees where emp_code = $1', [empCode]);
    const want = String((e && e.shift) || st.default_shift || 'General').trim().toLowerCase();
    const rows = await all('select * from hrms.shifts where active is true');
    const hit = rows.find(s => String(s.name || '').trim().toLowerCase() === want);
    const use = hit || rows[0] || {};
    return {
      full: Number(use.full_day_hours || 8) || 8,
      half: Number(use.half_day_hours || 4) || 4,
      weekly_off: use.weekly_off,
      saturday_policy: use.saturday_policy
    };
  }

  async function isRestDay(empCode, iso) {
    const sh = await shiftOf(empCode);
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return false;
    const dow = d.getUTCDay();
    if (weeklyOffSet(sh.weekly_off)[dow]) return true;
    if (dow === 6) return saturdayIsOff(Number(iso.slice(8, 10)), sh.saturday_policy);
    return false;
  }

  async function holidaySet() {
    const rows = await all('select date from hrms.holidays where optional is not true');
    const out = {};
    rows.forEach(r => out[rowOut({ date: r.date }).date] = true);
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* Accounts                                                          */
  /* ---------------------------------------------------------------- */
  const LIVE_STATUS = st => { const s = String(st || '').trim().toLowerCase();
                              return s === '' || s === 'active'; };

  async function setPassword(email, plain) {
    await db.query(
      `update hrms.users set password = crypt($2, gen_salt('bf', 10))
        where lower(email) = lower($1)`, [email, String(plain)]);
  }

  /* Checking a password, and quietly moving it forward.
   *
   * A migrated workspace arrives with every password as the sheet kept it:
   * one SHA-256 of 'hrms-lite:' + the password, sixty-four hex characters,
   * no per-user salt. bcrypt cannot read that, so on the morning after a
   * migration nobody could sign in - not one of the sixty-odd people, and
   * not the owner either.
   *
   * So: try bcrypt, and if the stored value is one of the old hashes, check
   * that instead - and on success replace it with a bcrypt hash there and
   * then. Nobody is locked out, nobody is asked to do anything, and every
   * account upgrades itself the first time its owner signs in. The old
   * hashes drain away on their own. */
  const LOOKS_LEGACY = v => /^[0-9a-f]{64}$/i.test(String(v || ''));

  async function checkPassword(email, plain) {
    const pw = String(plain || '');
    const u = await one(
      'select email, password from hrms.users where lower(email) = lower($1)', [email]);
    if (!u) return false;

    if (!LOOKS_LEGACY(u.password)) {
      const r = await one(
        `select 1 as ok from hrms.users
          where lower(email) = lower($1) and password = crypt($2, password)`, [email, pw]);
      return !!r;
    }

    const r = await one(
      `select 1 as ok from hrms.users
        where lower(email) = lower($1)
          and password = encode(digest('hrms-lite:' || $2, 'sha256'), 'hex')`,
      [email, pw]);
    if (!r) return false;
    await setPassword(u.email, pw);        /* upgraded, once, on the way in */
    return true;
  }

  /* One login per person, username = their staff code, first password the
     same. Exactly as before - and the code is still theirs to change. */
  async function makeAccountsFor(codes, dirty) {
    let made = 0;
    for (const code of codes) {
      const e = await one('select emp_code, status from hrms.employees where emp_code = $1', [code]);
      if (!e || !LIVE_STATUS(e.status)) continue;
      const user = String(code).trim().toLowerCase();
      const existing = await one(
        'select email from hrms.users where emp_code = $1 or lower(email) = $2',
        [code, user]);
      if (existing) continue;
      await db.query(
        `insert into hrms.users (email, password, role, emp_code, active)
         values ($1, crypt($2, gen_salt('bf', 10)), 'employee', $3, true)`,
        [user, String(code), code]);
      made++;
    }
    if (made && dirty) dirty.Users = 1;
    return made;
  }

  async function backfillAccounts(dirty) {
    const rows = await all('select emp_code, status from hrms.employees');
    const made = await makeAccountsFor(
      rows.filter(r => LIVE_STATUS(r.status)).map(r => r.emp_code), dirty);
    return { created: made };
  }

  /* ---------------------------------------------------------------- */
  /* Sign in                                                           */
  /* ---------------------------------------------------------------- */
  async function login(email, password, byMonth) {
    const typed = String(email || '').trim().toLowerCase();
    if (!typed) throw new Error('Type your staff code or email.');

    /* the staff code, the login name, or the address on their record */
    let u = await one('select * from hrms.users where lower(email) = $1', [typed]);
    if (!u) {
      u = await one(
        `select us.* from hrms.users us
          where lower(us.emp_code) = $1
             or us.emp_code in (select emp_code from hrms.employees
                                 where lower(email) = $1)
          limit 1`, [typed]);
    }
    if (!u) throw new Error('No account found for that staff code or email');
    if (!u.active) throw new Error('That account has been switched off. Ask HR.');
    if (!(await checkPassword(u.email, password))) throw new Error('Wrong password');

    const who = { email: u.email, role: u.role, emp_code: u.emp_code || '' };
    who.token = await api.signToken(who);
    who.expires_in_hours = 12;
    try { who.workspace = await bootstrap(who, byMonth); } catch (e) { /* sign in anyway */ }
    return who;
  }

  async function changePassword(email, oldPassword, newPassword) {
    if (String(newPassword || '').length < 8) {
      throw new Error('Use at least 8 characters.');
    }
    if (!(await checkPassword(email, oldPassword))) throw new Error('Wrong current password');
    await setPassword(email, newPassword);
    return { changed: true };
  }

  async function listUsers() {
    const rows = await all(
      'select email, role, emp_code, active from hrms.users order by email');
    return rows.map(rowOut);
  }

  async function saveUser(user, caller, dirty) {
    const email = String((user && user.email) || '').trim().toLowerCase();
    if (!email) throw new Error('A staff code or an email is needed.');
    const code = String((user && user.emp_code) || '').trim();

    /* one person, one login */
    if (code) {
      const clash = await one(
        'select email from hrms.users where emp_code = $1 and lower(email) <> $2',
        [code, email]);
      if (clash) {
        throw new Error(code + ' already has a login: ' + clash.email +
          '. Change the role or the password on that one rather than adding a second.');
      }
    }
    const exists = await one('select email from hrms.users where lower(email) = $1', [email]);
    if (!exists && !(user && user.password)) {
      throw new Error('Set a password for the new account.');
    }
    if (user && user.password && String(user.password).length < 8 &&
        String(user.password) !== code) {
      throw new Error('Use at least 8 characters.');
    }
    /* nobody may lock the last owner out of the workspace */
    if (caller && String(caller.email).toLowerCase() === email) {
      if (user.role && !isOwner(user.role)) throw new Error('You cannot take away your own owner access.');
      if (user.active !== undefined && !yes(user.active)) throw new Error('You cannot switch off your own account.');
    }

    if (exists) {
      await db.query(
        `update hrms.users set role = coalesce($2, role),
                               emp_code = coalesce($3, emp_code),
                               active = coalesce($4, active)
          where lower(email) = $1`,
        [email, user.role || null, code || null,
         user.active === undefined ? null : yes(user.active)]);
    } else {
      await db.query(
        `insert into hrms.users (email, password, role, emp_code, active)
         values ($1, crypt($2, gen_salt('bf',10)), $3, $4, $5)`,
        [email, String(user.password), user.role || 'employee', code || null,
         user.active === undefined ? true : yes(user.active)]);
    }
    if (user.password && exists) await setPassword(email, user.password);
    if (dirty) dirty.Users = 1;
    return { saved: email, role: user.role || 'employee', created: !exists };
  }

  async function removeUser(email, caller, dirty) {
    const want = String(email || '').trim().toLowerCase();
    if (caller && String(caller.email).toLowerCase() === want) {
      throw new Error('You cannot delete your own login.');
    }
    await db.query('delete from hrms.users where lower(email) = $1', [want]);
    if (dirty) dirty.Users = 1;
    return { removed: want };
  }

  /* ---------------------------------------------------------------- */
  /* Attendance                                                        */
  /* ---------------------------------------------------------------- */
  /* One where clause. No tail window, no guessing how far back to read,
     no checking the guess - the whole apparatus the sheet needed is gone. */
  async function attendanceBetween(fromIso, toIso, empCode) {
    const rows = empCode
      ? await all(`select * from hrms.attendance
                    where date >= $1 and date <= $2 and emp_code = $3
                    order by date`, [fromIso, toIso, empCode])
      : await all(`select * from hrms.attendance
                    where date >= $1 and date <= $2 order by date`, [fromIso, toIso]);
    return rows.map(rowOut);
  }

  const monthStart = ym => ym + '-01';
  const monthEnd = ym => {
    const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
    return ym + '-' + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0');
  };

  function bootstrapMonths(back) {
    const ym = today().slice(0, 7);
    let y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
    const out = [];
    const n = back === undefined ? 2 : back;
    for (let i = 0; i < n; i++) {
      out.push(y + '-' + String(m).padStart(2, '0'));
      m--; if (m < 1) { m = 12; y--; }
    }
    return out;
  }

  async function monthAtt(ym) {
    const want = String(ym || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(want)) throw new Error('Which month? Use YYYY-MM.');
    return { month: want, rows: await attendanceBetween(monthStart(want), monthEnd(want)) };
  }

  async function myMonth(empCode, ym) {
    if (!empCode) throw new Error('No employee is linked to this login.');
    const want = String(ym || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(want)) throw new Error('Which month? Use YYYY-MM.');
    return { month: want,
             rows: await attendanceBetween(monthStart(want), monthEnd(want), empCode) };
  }

  /* ---------------------------------------------------------------- */
  /* Punching                                                          */
  /* ---------------------------------------------------------------- */
  const clockOf = v => {
    const m = String(v == null ? '' : v).match(/(\d{1,2}):(\d{2})/);
    if (!m) return '';
    const h = Number(m[1]);
    return (h < 10 ? '0' + h : String(h)) + ':' + m[2];
  };
  const minutesOfClock = v => {
    const m = String(v || '').match(/^(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };

  /* The day is bounded by the first tap and the last, whatever recorded them.
     The device's own in/out flag is ignored on purpose: it is only as right
     as the mode the reader was left in. */
  async function rebuildDay(empCode, iso, source, extraTimes, dirty) {
    const existing = await one(
      'select * from hrms.attendance where emp_code = $1 and date = $2', [empCode, iso]);
    /* approved leave is a decision somebody signed; a punch does not overrule it */
    if (existing && String(existing.status) === 'L') return null;

    const taps = await all(
      `select punch_time from hrms.punches
        where emp_code = $1
          and punch_time >= $2::date and punch_time < ($2::date + interval '1 day')
        order by punch_time`, [empCode, iso]);

    const times = [];
    const add = t => { const c = clockOf(t); if (c && times.indexOf(c) < 0) times.push(c); };
    taps.forEach(t => {
      add(HM.format(asDate(t.punch_time)));
    });
    (extraTimes || []).forEach(add);
    if (existing) { add(rowOut(existing).in_time); add(rowOut(existing).out_time); }
    if (!times.length) return null;

    times.sort();
    const inT = times[0], outT = times[times.length - 1], n = times.length;
    let hours = 0;
    if (inT !== outT) hours = (minutesOfClock(outT) - minutesOfClock(inT)) / 60;

    const sh = await shiftOf(empCode);
    let status, remark;
    if (inT === outT) { status = 'P'; remark = source + ' - single punch, verify'; }
    else if (hours >= sh.full) { status = 'P'; remark = source + (n > 2 ? ' - ' + n + ' punches' : ''); }
    else if (hours >= sh.half) { status = 'HD'; remark = source + ' - ' + hours.toFixed(1) + ' h'; }
    else { status = 'A'; remark = source + ' - only ' + hours.toFixed(1) + ' h, verify'; }

    const row = {
      id: empCode + '_' + iso, date: iso, emp_code: empCode, status,
      in_time: inT, out_time: inT === outT ? '' : outT,
      hours: inT === outT ? 0 : Math.round(hours * 10) / 10,
      remarks: remark, updated_at: today()
    };
    return await upsertRow('Attendance', row, dirty);
  }

  async function punchState(empCode) {
    const st = await settingsMap();
    const n = nowParts();
    const row = await one(
      'select * from hrms.attendance where emp_code = $1 and date = $2', [empCode, n.date]);
    const open = await all(
      `select date from hrms.attendance
        where emp_code = $1 and date < $2 and in_time is not null and out_time is null
        order by date desc limit 5`, [empCode, n.date]);
    const taps = await all(
      `select punch_time from hrms.punches
        where emp_code = $1
          and punch_time >= $2::date and punch_time < ($2::date + interval '1 day')
        order by punch_time`, [empCode, n.date]);
    const r = row ? rowOut(row) : {};
    return {
      geofence: {
        enabled: yes(st.geofence_enabled), mode: st.geofence_mode || 'block',
        accuracy: Number(st.geofence_accuracy_m || 120)
      },
      date: n.date, time: n.time,
      in_time: r.in_time || '', out_time: r.out_time || '',
      status: r.status || '', hours: r.hours || 0,
      openDays: open.map(o => rowOut(o).date),
      taps: taps.map(t => HM.format(asDate(t.punch_time))),
      mandatory: String(st.punch_out_mandatory || 'yes').toLowerCase() === 'yes'
    };
  }

  async function webPunch(empCodeAsked, kind, note, geo, caller, dirty) {
    const st = await settingsMap();
    if (String(st.web_punch_enabled || 'yes').toLowerCase() === 'no') {
      throw new Error('Punching from the app is switched off.');
    }
    /* always the code on the session - never the one in the request */
    const empCode = isHrOrAbove(caller.role) && empCodeAsked
      ? String(empCodeAsked) : String(caller.emp_code || '');
    if (!empCode) throw new Error('No employee is linked to this login.');

    const n = nowParts();
    const emp = await one('select emp_code, device_id from hrms.employees where emp_code = $1',
      [empCode]);
    if (!emp) throw new Error('That staff code is not on the list.');

    const byOther = caller.email && String(caller.emp_code || '') !== empCode;
    await db.query(
      `insert into hrms.punches (id, punch_time, emp_code, device_id, device, direction,
                                 source, imported_at, lat, lng, accuracy, site, distance_m)
       values ($1, ($2::date + $3::time) at time zone $4, $5, $6, $7, $8, $9, now(),
               $10, $11, $12, $13, $14)`,
      [newId(), n.date, n.time, tz, empCode, emp.device_id || '',
       byOther ? 'app (by ' + caller.email + ')' : 'app', String(kind || ''),
       byOther ? 'app-on-behalf' : 'app',
       geo && geo.lat !== undefined ? geo.lat : null,
       geo && geo.lng !== undefined ? geo.lng : null,
       geo && geo.accuracy ? Math.round(Number(geo.accuracy)) : null,
       (geo && geo.site) || null, null]);
    if (dirty) dirty.Punches = 1;

    const record = await rebuildDay(empCode, n.date, 'app', [n.time], dirty);
    return { record, state: await punchState(empCode) };
  }

  async function punchLog(from, to) {
    const a = String(from || '').slice(0, 10);
    let b = String(to || from || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a)) throw new Error('Pick a date first.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b)) b = a;
    const rows = await all(
      `select * from hrms.punches
        where punch_time >= $1::date and punch_time < ($2::date + interval '1 day')
        order by punch_time, emp_code`, [a < b ? a : b, a < b ? b : a]);
    return {
      from: a < b ? a : b, to: a < b ? b : a,
      rows: rows.map(r => {
        const o = rowOut(r);
        const p = YMDHM.formatToParts(asDate(r.punch_time))
          .reduce((m, x) => (m[x.type] = x.value, m), {});
        o.punch_time = `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
        return o;
      })
    };
  }

  /* Accepts the many field names eSSL exports use. */
  function normalizePunch(p) {
    const pick = keys => {
      for (const want of keys) {
        for (const k in p) {
          if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === want) return p[k];
        }
      }
      return '';
    };
    const code = String(pick(['empcode', 'employeecode', 'userid', 'usrid', 'staffcode',
      'code', 'employeeid', 'empid']) || '').trim();
    const dateRaw = String(pick(['logdate', 'punchdate', 'date', 'attendancedate']) || '').trim();
    const timeRaw = String(pick(['logtime', 'punchtime', 'time']) || '').trim();
    const stamp = String(pick(['punchtime', 'logdatetime', 'datetime', 'timestamp']) || '').trim();

    let date = '', time = '';
    const iso = (dateRaw || stamp).match(/(\d{4})-(\d{2})-(\d{2})/);
    const dmy = (dateRaw || stamp).match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (iso) date = iso[0];
    else if (dmy) date = dmy[3] + '-' + String(dmy[2]).padStart(2, '0') + '-' +
                         String(dmy[1]).padStart(2, '0');
    time = clockOf(timeRaw) || clockOf(stamp.slice(10)) || '';
    if (!code || !date || !time) return null;
    return { emp_code: code, date, time,
             device_id: String(pick(['deviceid', 'device', 'machineid']) || ''),
             direction: String(pick(['direction', 'inout', 'c1', 'punchtype']) || '') };
  }

  async function ingestPunches(punches, source, dirty) {
    const rows = (punches || []).map(normalizePunch).filter(Boolean);
    if (!rows.length) return { added: 0, days: 0, skipped: (punches || []).length };

    /* map a device id to a staff code where the code itself is unknown */
    const byDevice = {};
    (await all('select emp_code, device_id from hrms.employees where device_id is not null'))
      .forEach(e => byDevice[String(e.device_id)] = e.emp_code);
    const known = new Set((await all('select emp_code from hrms.employees'))
      .map(e => String(e.emp_code)));

    const days = {};
    for (const r of rows) {
      const code = known.has(r.emp_code) ? r.emp_code : (byDevice[r.emp_code] || r.emp_code);
      await db.query(
        `insert into hrms.punches (id, punch_time, emp_code, device_id, device,
                                   direction, source, imported_at)
         values ($1, ($2::date + $3::time) at time zone $4, $5, $6, $7, $8, $9, now())`,
        [newId(), r.date, r.time, tz, code, r.device_id, source || 'agent',
         r.direction, source || 'agent']);
      days[code + '|' + r.date] = { code, date: r.date };
    }
    if (dirty) dirty.Punches = 1;

    let written = 0;
    for (const k of Object.keys(days)) {
      if (!known.has(days[k].code)) continue;       /* a card with nobody behind it */
      const got = await rebuildDay(days[k].code, days[k].date, source || 'device', [], dirty);
      if (got) written++;
    }
    return { added: rows.length, days: written, skipped: (punches || []).length - rows.length };
  }

  /* ---------------------------------------------------------------- */
  /* Approvals                                                         */
  /* ---------------------------------------------------------------- */
  async function markLeaveOnRegister(leave, dirty) {
    const st = await settingsMap();
    const sandwich = String(st.sandwich_rule || 'no').toLowerCase() === 'yes';
    const holidays = await holidaySet();
    const from = String(leave.from_date || ''), to = String(leave.to_date || from);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return 0;

    let n = 0;
    for (let d = new Date(from + 'T00:00:00Z'), end = new Date(to + 'T00:00:00Z');
         d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const off = (await isRestDay(leave.emp_code, iso)) || holidays[iso];
      if (off && !sandwich) continue;
      await upsertRow('Attendance', {
        id: leave.emp_code + '_' + iso, date: iso, emp_code: leave.emp_code,
        status: 'L', in_time: '', out_time: '', hours: 0,
        remarks: 'leave: ' + (leave.type || ''), updated_at: iso
      }, dirty);
      n++;
    }
    return n;
  }

  async function applyRequestToRegister(req, dirty) {
    const iso = String(req.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 0;
    const t = await one('select effect from hrms.request_types where upper(code) = upper($1)',
      [String(req.type || '')]);
    const effect = t ? String(t.effect || 'none') : '';
    if (effect !== 'present' && effect !== 'times') return 0;

    let to = String(req.to_date || iso);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || to < iso) to = iso;
    const have = {};
    (await attendanceBetween(iso, to, req.emp_code)).forEach(a => have[a.date] = a);

    if (effect === 'present') {
      const holidays = await holidaySet();
      let n = 0;
      for (let d = new Date(iso + 'T00:00:00Z'), end = new Date(to + 'T00:00:00Z');
           d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const day = d.toISOString().slice(0, 10);
        if ((await isRestDay(req.emp_code, day)) || holidays[day]) continue;
        const was = have[day] || {};
        await upsertRow('Attendance', {
          id: req.emp_code + '_' + day, date: day, emp_code: req.emp_code, status: 'OD',
          in_time: was.in_time || '', out_time: was.out_time || '', hours: was.hours || 0,
          remarks: 'OD approved: ' + String(req.reason || 'out of office duty').slice(0, 80),
          updated_at: day
        }, dirty);
        n++;
      }
      return n;
    }

    const was = have[iso] || {};
    const inT = clockOf(req.in_time) || was.in_time || '';
    const outT = clockOf(req.out_time) || was.out_time || '';
    if (!inT && !outT) return 0;
    let mins = minutesOfClock(outT) - minutesOfClock(inT);
    if (mins < 0) mins += 24 * 60;
    const worked = (minutesOfClock(inT) === null || minutesOfClock(outT) === null)
      ? null : mins / 60;
    const sh = await shiftOf(req.emp_code);
    let status = was.status || 'P';
    if (worked !== null) status = worked >= sh.full ? 'P' : (worked >= sh.half ? 'HD' : 'P');
    await upsertRow('Attendance', {
      id: req.emp_code + '_' + iso, date: iso, emp_code: req.emp_code, status,
      in_time: inT, out_time: outT,
      hours: worked === null ? (was.hours || 0) : Math.round(worked * 10) / 10,
      remarks: 'punch corrected by approval', updated_at: iso
    }, dirty);
    return 1;
  }

  async function decide(sheet, id, status, note, caller, dirty) {
    const t = tableFor(sheet);
    const row = await one(`select * from hrms.${t} where id = $1`, [id]);
    if (!row) throw new Error('That application is not there any more.');
    const r = rowOut(row);
    if (String(r.status) === 'Rejected') throw new Error('This has already been rejected.');
    if (String(r.status) === 'Approved') throw new Error('This has already been approved.');

    const kind = sheet === 'Leave' ? 'Leave' : 'Requests';
    const levels = (await all(
      `select * from hrms.approval_levels
        where active is true and (applies_to = $1 or applies_to = '' or applies_to = 'All')
        order by level`, [kind])).map(rowOut);

    const total = levels.length || 1;
    const cleared = Number(r.level || 0) + 1;
    const trail = String(r.approvals || '');
    const stamp = today() + ' ' + nowParts().time;
    const entry = cleared + '~' + (caller.emp_code || caller.email) + '~' + stamp +
                  '~' + String(note || '');

    if (String(status) === 'Rejected') {
      await upsertRow(sheet, Object.assign({}, r, {
        status: 'Rejected', level: cleared, decided_by: caller.email,
        decided_at: today(), approvals: trail ? trail + '|' + entry : entry
      }), dirty);
      return { id, status: 'Rejected', days_marked: 0, cleared, total, done: true, next: '' };
    }

    const done = cleared >= total;
    const next = done ? '' : (levels[cleared] ? (levels[cleared].label ||
      levels[cleared].approver) : '');
    const finalStatus = done ? 'Approved' : 'Pending';
    await upsertRow(sheet, Object.assign({}, r, {
      status: finalStatus, level: cleared,
      decided_by: done ? caller.email : (r.decided_by || ''),
      decided_at: done ? today() : (r.decided_at || ''),
      approvals: trail ? trail + '|' + entry : entry
    }), dirty);

    let marked = 0;
    if (done) {
      marked = sheet === 'Leave'
        ? await markLeaveOnRegister(Object.assign({}, r), dirty)
        : await applyRequestToRegister(Object.assign({}, r), dirty);
    }
    return { id, status: finalStatus, days_marked: marked, cleared, total, done, next };
  }

  /* ---------------------------------------------------------------- */
  /* Opening the app                                                   */
  /* ---------------------------------------------------------------- */
  const OWNER_ONLY = /^(essl_|sql_|sync_|smtp_|payslip_mail_)/;

  async function bootstrap(caller, byMonth) {
    const st = await settingsMap();
    const months = bootstrapMonths(byMonth ? undefined : 6);
    const from = monthStart(months[months.length - 1]), to = monthEnd(months[0]);

    if (isHrOrAbove(caller.role)) {
      const owner = isOwner(caller.role);
      const hrSettings = {};
      Object.keys(st).forEach(k => { if (owner || !OWNER_ONLY.test(k)) hrSettings[k] = st[k]; });
      return {
        role: owner ? 'owner' : 'hr',
        settings: hrSettings,
        employees: await listSheet('Employees'),
        attendance: await attendanceBetween(from, to),
        attMonths: months,
        leave: await listSheet('Leave'),
        payroll: await listSheet('Payroll'),
        bonus: await listSheet('Bonus'),
        gratuity: await listSheet('Gratuity'),
        increment: await listSheet('Increment'),
        holidays: await listSheet('Holidays'),
        events: await listSheet('Events'),
        sites: await listSheet('Sites'),
        shifts: await listSheet('Shifts'),
        leaveTypes: await listSheet('LeaveTypes'),
        requestTypes: await listSheet('RequestTypes'),
        requests: await listSheet('Requests'),
        ctcVariables: await listSheet('CtcVariables'),
        ctcComponents: await listSheet('CtcComponents'),
        ctcValues: await listSheet('CtcValues'),
        notices: await listSheet('Notices'),
        approvalLevels: await listSheet('ApprovalLevels'),
        secrets: owner ? {} : {},
        users: owner ? await listUsers() : []
      };
    }

    const code = String(caller.emp_code || '');
    const me = code
      ? rowOut(await one('select * from hrms.employees where emp_code = $1', [code]))
      : null;
    const mine = code ? await attendanceBetween(from, to, code) : [];
    const staffSettings = {};
    ['company_name', 'currency', 'web_punch_enabled', 'punch_out_mandatory',
     'geofence_enabled', 'geofence_mode', 'geofence_accuracy_m', 'default_shift',
     'weekly_off'].forEach(k => { if (st[k] !== undefined) staffSettings[k] = st[k]; });

    return {
      role: 'employee',
      settings: staffSettings,
      employees: me ? [me] : [],
      attendance: mine,
      attMonths: months,
      punch: code ? await punchState(code) : null,
      leave: code ? (await all('select * from hrms.leave where emp_code = $1', [code])).map(rowOut) : [],
      payroll: code ? (await all('select * from hrms.payroll where emp_code = $1 order by month', [code])).map(rowOut) : [],
      /* Their own only. Bonus and gratuity are money owed to them and
         belong on their payslip screen; increment is their own pay history. */
      bonus: code ? (await all('select * from hrms.bonus where emp_code = $1 order by fy', [code])).map(rowOut) : [],
      gratuity: code ? (await all('select * from hrms.gratuity where emp_code = $1 order by as_on', [code])).map(rowOut) : [],
      increment: code ? (await all('select * from hrms.increment where emp_code = $1 order by effective_from', [code])).map(rowOut) : [],
      requests: code ? (await all('select * from hrms.requests where emp_code = $1', [code])).map(rowOut) : [],
      ctcValues: code ? (await all('select * from hrms.ctc_values where emp_code = $1', [code])).map(rowOut) : [],
      holidays: await listSheet('Holidays'),
      events: await listSheet('Events'),
      shifts: await listSheet('Shifts'),
      leaveTypes: await listSheet('LeaveTypes'),
      requestTypes: await listSheet('RequestTypes'),
      notices: (await all(
        `select * from hrms.notices
          where active is true
            and (start_date is null or start_date <= current_date)
            and (end_date is null or end_date >= current_date)`)).map(rowOut),
      approvalLevels: await listSheet('ApprovalLevels'),
      inbox: await inboxFor(code)
    };
  }

  async function inboxFor(code) {
    if (!code) return { isManager: false, team: [], teamLeave: [], teamRequests: [] };
    const me = await one('select emp_code, name from hrms.employees where emp_code = $1', [code]);
    const team = (await all(
      `select * from hrms.employees
        where manager = $1 or manager = $2`, [code, (me && me.name) || code])).map(rowOut);
    if (!team.length) return { isManager: false, team: [], teamLeave: [], teamRequests: [] };
    const codes = team.map(t => t.emp_code);
    return {
      isManager: true, team,
      teamLeave: (await all(
        `select * from hrms.leave where emp_code = any($1) and status = 'Pending'`, [codes])).map(rowOut),
      teamRequests: (await all(
        `select * from hrms.requests where emp_code = any($1) and status = 'Pending'`, [codes])).map(rowOut)
    };
  }

  /* How many rows every table holds, so a migration can be checked against
     the sheet it came from rather than believed. */
  async function tally() {
    const names = Object.keys(api.TABLE);
    const out = {};
    for (const n of names) out[n] = await api.countRows(n);
    return out;
  }

  async function payslipMailLog(month) {
    return (await all('select * from hrms.payslip_mail where month = $1', [month])).map(rowOut);
  }

  return {
    nowParts, today, login, changePassword, listUsers, saveUser, removeUser,
    backfillAccounts, makeAccountsFor, bootstrap, monthAtt, myMonth,
    punchState, webPunch, punchLog, ingestPunches, decide, payslipMailLog, tally,
    attendanceBetween, isRestDay, rebuildDay, setPassword, checkPassword
  };
}
