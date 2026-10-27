/* A small in-memory Google Apps Script environment, so the real code.gs can be
   executed and driven by the real index.html. Only what code.gs actually uses
   is implemented; anything missing throws loudly rather than silently passing. */
const crypto = require('crypto');

function makeSheet(name, rows) {
  const data = rows ? rows.map(r => r.slice()) : [];
  const api = {
    _name: name, _data: data,
    getName: () => name,
    getLastRow: () => data.length,
    getLastColumn: () => data.reduce((m, r) => Math.max(m, r.length), 0),
    setFrozenRows: () => api,
    clear() { data.length = 0; return api; },
    appendRow(row) { data.push(row.slice()); return api; },
    deleteRow(i) { data.splice(i - 1, 1); return api; },
    deleteRows(i, n) { data.splice(i - 1, n); return api; },
    getDataRange() {
      const w = api.getLastColumn();
      return { getValues: () => data.map(r => {
        const c = r.slice(); while (c.length < w) c.push(''); return c; }) };
    },
    getRange(row, col, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      return {
        setValue(v) {
          while (data.length < row) data.push([]);
          const r = data[row - 1];
          while (r.length < col) r.push('');
          r[col - 1] = v; return this;
        },
        setValues(vals) {
          vals.forEach((rv, ri) => {
            while (data.length < row + ri) data.push([]);
            const r = data[row - 1 + ri];
            rv.forEach((v, ci) => { while (r.length < col + ci) r.push(''); r[col - 1 + ci] = v; });
          });
          return this;
        },
        /* Real Apps Script empties the cells and leaves the rows in place;
           anything else here would hide a bug rather than catch one. */
        clearContent() {
          for (let i = 0; i < nr; i++) {
            const r = data[row - 1 + i];
            if (!r) continue;
            for (let j = 0; j < nc; j++) if (r[col - 1 + j] !== undefined) r[col - 1 + j] = '';
          }
          return this;
        },
        getValue() { const r = data[row - 1] || []; return r[col - 1] === undefined ? '' : r[col - 1]; },
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) { const r = data[row - 1 + i] || [], o = [];
            for (let j = 0; j < nc; j++) o.push(r[col - 1 + j] === undefined ? '' : r[col - 1 + j]);
            out.push(o); }
          return out;
        },
      };
    },
  };
  return api;
}

function makeSpreadsheet(id, name) {
  const sheets = [];
  return {
    _id: id,
    getId: () => id, getName: () => name,
    getSheets: () => sheets.slice(),
    getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id + '/edit',
    deleteSheet(sh) { const k = sheets.indexOf(sh); if (k > -1) sheets.splice(k, 1); },
    getSheetByName: n => sheets.find(s => s._name === n) || null,
    insertSheet(n) { const s = makeSheet(n); sheets.push(s); return s; },
    _clone(newId, newName) {
      const copy = makeSpreadsheet(newId, newName);
      sheets.forEach(s => { const t = copy.insertSheet(s._name); s._data.forEach(r => t.appendRow(r)); });
      return copy;
    },
  };
}

function build() {
  const FILES = {};            // id -> spreadsheet
  const META = {};             // id -> {sharing}
  const props = {};
  const cache = {};
  const mails = [];
  let seq = 0;

  const G = {};
  G.SpreadsheetApp = {
    openById(id) {
      if (!FILES[id]) throw new Error('No item with the given ID could be found: ' + id);
      return FILES[id];
    },
    /* A new spreadsheet comes with one empty tab, as in Sheets. */
    create(name) {
      const nid = 'SHEET_' + (++seq);
      FILES[nid] = makeSpreadsheet(nid, name);
      FILES[nid].insertSheet('Sheet1');
      META[nid] = { sharing: 'PRIVATE' };
      return FILES[nid];
    },
  };
  G.DriveApp = {
    getFileById(id) {
      if (!FILES[id]) throw new Error('No item with the given ID could be found');
      return {
        getId: () => id,
        getName: () => FILES[id].getName(),
        makeCopy(newName, folder) {
          const nid = 'SHEET_' + (++seq);
          FILES[nid] = FILES[id]._clone(nid, newName);
          META[nid] = { sharing: 'PRIVATE' };
          if (folder && folder._ids) folder._ids.push(nid);
          return { getId: () => nid, getName: () => newName,
                   setSharing(a, p) { META[nid] = { sharing: String(a) }; } };
        },
        setSharing(a) { META[id] = { sharing: String(a) }; },
        getSharingAccess: () => (META[id] || {}).sharing || 'PRIVATE',
        moveTo(folder) { if (folder && folder._ids && folder._ids.indexOf(id) < 0) folder._ids.push(id); return this; },
      };
    },
    /* Folders, enough for backup.gs: create, find by name or id, list files. */
    _folders: {},
    createFolder(name) {
      const fid = 'FOLDER_' + (++seq), drive = G.DriveApp;
      const it = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
      const fileObj = (nid) => ({ getId: () => nid, getName: () => FILES[nid].getName(),
        setTrashed(v) { if (v) { const k = folder._ids.indexOf(nid); if (k > -1) folder._ids.splice(k, 1); } },
        makeCopy: (n, f) => drive.getFileById(nid).makeCopy(n, f), getDateCreated: () => new Date() });
      const folder = { _ids: [], getId: () => fid, getName: () => name, setName(n) { name = n; return folder; },
        getFiles: () => it(folder._ids.map(fileObj)),
        getFilesByName: (n) => it(folder._ids.filter((x) => FILES[x].getName() === n).map(fileObj)) };
      drive._folders[fid] = folder;
      return folder;
    },
    getFolderById(fid) { if (!G.DriveApp._folders[fid]) throw new Error('No folder ' + fid); return G.DriveApp._folders[fid]; },
    getFoldersByName(name) {
      const list = Object.values(G.DriveApp._folders).filter((f) => f.getName() === name); let i = 0;
      return { hasNext: () => i < list.length, next: () => list[i++] };
    },
  };
  G.PropertiesService = { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; },
    getProperties: () => Object.assign({}, props),
  })};
  /* One script-wide lock, as Apps Script has. Single-threaded here, so the
     lock can never actually be contended — but the calls have to exist or the
     code under test takes a different path from production. */
  let locked = false;
  G.LockService = {
    getScriptLock: () => ({
      waitLock(ms) { if (locked) throw new Error('Could not obtain lock'); locked = true; },
      tryLock(ms) { if (locked) return false; locked = true; return true; },
      releaseLock() { locked = false; },
      hasLock() { return locked; },
    }),
  };
  G.LockService.getDocumentLock = G.LockService.getScriptLock;
  G.LockService.getUserLock = G.LockService.getScriptLock;

  G.CacheService = { getScriptCache: () => ({
    get: k => (k in cache ? cache[k] : null),
    put: (k, v) => { cache[k] = v; },
    remove: k => { delete cache[k]; },
  })};
  G.Utilities = {
    getUuid: () => crypto.randomUUID(),
    /* As strict as Apps Script: (String, String) or (Byte[], Byte[]) — never
       one of each. Lenient here, a mixed call passed every test and failed on
       the first real signup. */
    computeHmacSha256Signature(data, key) {
      const kind = (v) => Array.isArray(v) ? 'number[]' : 'String';
      if (kind(data) !== kind(key)) {
        throw new Error('Exception: The parameters (' + kind(data) + ',' + kind(key) +
          ") don't match the method signature for Utilities.computeHmacSha256Signature.");
      }
      const bytes = (v) => Array.isArray(v) ? Buffer.from(v.map(x => x < 0 ? x + 256 : x)) : Buffer.from(String(v), 'utf8');
      return [...crypto.createHmac('sha256', bytes(key)).update(bytes(data)).digest()].map(b => b > 127 ? b - 256 : b);
    },
    computeDigest: (alg, s) => [...crypto.createHash('sha256').update(String(s)).digest()].map(b => b > 127 ? b - 256 : b),
    base64Encode: s => Buffer.from(String(s), 'utf8').toString('base64'),
    base64EncodeWebSafe: s => Buffer.from(String(s), 'utf8').toString('base64url'),
    base64DecodeWebSafe: s => [...Buffer.from(String(s), 'base64url')],
    newBlob: b => {
      const buf = Array.isArray(b) ? Buffer.from(b.map(x => x < 0 ? x + 256 : x)) : Buffer.from(String(b), 'utf8');
      return { getDataAsString: () => buf.toString('utf8'), getBytes: () => [...buf].map(x => x > 127 ? x - 256 : x) };
    },
    formatDate: (d, tz, fmt) => new Date(d).toISOString(),
    DigestAlgorithm: { SHA_256: 'SHA_256' },
  };
  /* The account the script runs as. Its own address can send without being an
     alias; a test changes it to run a project under another account. */
  const me = { email: 'owner@biscsindia.com' };
  G.Session = { getScriptTimeZone: () => 'Asia/Kolkata',
    getEffectiveUser: () => ({ getEmail: () => me.email }), __setUser(e) { me.email = e; } };
  G.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 503, getContentText: () => '{}' }) };
  /* The send-as alias is the whole point of the mail rules, so the shim records
     what each message was actually sent AS — not just that something was sent.
     `aliases` is mutable so a test can take the alias away and prove nothing
     goes out from the wrong address. */
  const aliases = ['info@biscsindia.com'];
  G.GmailApp = {
    getAliases: () => aliases.slice(),
    __setAliases(list) { aliases.length = 0; list.forEach(a => aliases.push(a)); },
    sendEmail(to, subject, body, opts) {
      opts = opts || {};
      /* As Apps Script does: `from` must be one of the account's aliases. */
      if (opts.from && aliases.indexOf(opts.from) < 0) throw new Error('Invalid argument: from');
      mails.push({ to, subject, html: opts.htmlBody, body,
                   from: opts.from || me.email, replyTo: opts.replyTo || null,
                   name: opts.name || null, via: 'gmail' });
    },
  };
  /* MailApp cannot set a from address at all — it always sends as the script
     owner. Recorded as via:'mailapp' so a test can assert that no CUSTOMER mail
     ever went out this way. */
  G.MailApp = { sendEmail(o) {
    mails.push({ to: o.to, subject: o.subject, html: o.htmlBody, body: o.body,
                 from: null, name: o.name || null, via: 'mailapp' });
  } };
  G.ContentService = {
    MimeType: { JSON: 'JSON', TEXT: 'TEXT' },
    createTextOutput(t) { return { _t: t, setMimeType() { return this; }, getContent: () => t }; },
  };
  /* setupDomeBox() reads what it printed back to the caller, so the log has to
     be real here rather than swallowed. */
  const logs = [];
  G.Logger = { log: (m) => { logs.push(String(m)); } };

  /* Triggers and the deployment URL are project state in Apps Script, not
     config, so the shim holds them as mutable arrays a test can arrange: "no
     triggers installed", "two of three", "not deployed yet". Those are the
     states setupDomeBox exists to find. */
  const triggers = [];
  const triggerHours = [];
  let execUrl = '';
  G.ScriptApp = {
    getProjectTriggers: () => triggers.map((fn) => ({
      getHandlerFunction: () => fn, getEventType: () => 'CLOCK' })),
    newTrigger: (fn) => ({ timeBased: () => ({
      atHour: (h) => ({ everyDays: () => ({ create() { triggers.push(fn); triggerHours.push([fn, h]); } }) }),
      onMonthDay: (d) => ({ atHour: (h) => ({ create() { triggers.push(fn); triggerHours.push([fn, h, d]); } }) }),
      everyMinutes: (m) => ({ create() { triggers.push(fn); triggerHours.push([fn, 'every', m]); } }),
    }) }),
    deleteTrigger(t) {
      const i = triggers.indexOf(t.getHandlerFunction());
      if (i > -1) triggers.splice(i, 1);
    },
    getService: () => ({ getUrl: () => execUrl }),
  };

  return { G, FILES, META, props, mails, logs,
    triggers, triggerHours,
    setExecUrl(u) { execUrl = u || ''; },
    makeSpreadsheet, makeSheet,
    newFile(id, name) { FILES[id] = makeSpreadsheet(id, name); META[id] = { sharing: 'PRIVATE' }; return FILES[id]; },
    /* New workspaces start on a 14-day Growth trial. A test about the Free
       plan ends that trial first — exactly what happens on day 15. */
    endTrial(email) {
      const m = FILES[props.MASTER_DB_ID || 'MASTER'];
      const dir = m && m.getSheetByName('Directory');
      if (!dir) return false;
      const d = dir.getDataRange().getValues();
      const y = new Date(); y.setDate(y.getDate() - 1);
      for (let i = 1; i < d.length; i++) {
        if (String(d[i][1]).toLowerCase() === String(email).toLowerCase()) {
          dir.getRange(i + 1, 5).setValue(y.toISOString().slice(0, 10)); return true;
        }
      }
      return false;
    } };
}

module.exports = { build };
