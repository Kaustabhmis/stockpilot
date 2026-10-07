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
  };
  G.DriveApp = {
    getFileById(id) {
      if (!FILES[id]) throw new Error('No item with the given ID could be found');
      return {
        getId: () => id,
        getName: () => FILES[id].getName(),
        makeCopy(newName) {
          const nid = 'SHEET_' + (++seq);
          FILES[nid] = FILES[id]._clone(nid, newName);
          META[nid] = { sharing: 'PRIVATE' };
          return { getId: () => nid, getName: () => newName,
                   setSharing(a, p) { META[nid] = { sharing: String(a) }; } };
        },
        setSharing(a) { META[id] = { sharing: String(a) }; },
        getSharingAccess: () => (META[id] || {}).sharing || 'PRIVATE',
      };
    },
  };
  G.PropertiesService = { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; },
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
    computeHmacSha256Signature(data, key) {
      const d = Buffer.isBuffer(data) ? data
        : Array.isArray(data) ? Buffer.from(data.map(x => x < 0 ? x + 256 : x))
        : Buffer.from(String(data), 'utf8');
      return [...crypto.createHmac('sha256', String(key)).update(d).digest()].map(b => b > 127 ? b - 256 : b);
    },
    computeDigest: (alg, s) => [...crypto.createHash('sha256').update(String(s)).digest()].map(b => b > 127 ? b - 256 : b),
    base64Encode: s => Buffer.from(String(s), 'utf8').toString('base64'),
    base64EncodeWebSafe: s => Buffer.from(String(s), 'utf8').toString('base64url'),
    base64DecodeWebSafe: s => [...Buffer.from(String(s), 'base64url')],
    newBlob: b => ({ getDataAsString: () => Buffer.from(b.map(x => x < 0 ? x + 256 : x)).toString('utf8') }),
    formatDate: (d, tz, fmt) => new Date(d).toISOString(),
    DigestAlgorithm: { SHA_256: 'SHA_256' },
  };
  G.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 503, getContentText: () => '{}' }) };
  G.GmailApp = { sendEmail(to, subject, body, opts) { mails.push({ to, subject, html: (opts||{}).htmlBody }); } };
  G.MailApp = { sendEmail(o) { mails.push({ to: o.to, subject: o.subject, html: o.htmlBody }); } };
  G.ContentService = {
    MimeType: { JSON: 'JSON', TEXT: 'TEXT' },
    createTextOutput(t) { return { _t: t, setMimeType() { return this; }, getContent: () => t }; },
  };
  G.Logger = { log: () => {} };
  G.ScriptApp = { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ atHour: () => ({ everyDays: () => ({ create(){} }) }) }) }), deleteTrigger(){} };

  return { G, FILES, META, props, mails,
    makeSpreadsheet, makeSheet,
    newFile(id, name) { FILES[id] = makeSpreadsheet(id, name); META[id] = { sharing: 'PRIVATE' }; return FILES[id]; } };
}

module.exports = { build };
