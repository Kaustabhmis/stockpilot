import crypto from 'node:crypto';

/**
 * A mock Apps Script runtime: SpreadsheetApp, LockService, PropertiesService and
 * Utilities, installed as globals.
 *
 * Faithful in the places that matter, because these are what the Apps Script
 * store and platform shim actually depend on:
 *
 *   * getLastRow() ignores trailing blank rows, and getValues() on a range past
 *     the data returns empty strings rather than undefined.
 *   * deleteRow() splices, so every row beneath shifts up — the behaviour that
 *     makes delete ordering load-bearing.
 *   * computeHmacSha256Signature and computeDigest return SIGNED byte arrays,
 *     the single most common source of wrong hex in Apps Script code.
 *   * setValues() rejects a mismatched range, as the real API does.
 */
export function installFakeAppsScript() {
  const tabs = new Map();          // title -> array of row arrays
  const properties = new Map();
  const stats = { reads: 0, writes: 0, locks: 0 };
  let lockHeld = false;

  /** Signed bytes, exactly as Apps Script hands them back. */
  const toSigned = (buffer) => Array.from(buffer).map((b) => (b > 127 ? b - 256 : b));

  const driveFiles = new Map();
  let nextFileId = 1000;

  function makeFolder(name) {
    return {
      getName: () => name,
      getId: () => `folder_${name}`,
      createFile(blob) {
        const id = `file_${nextFileId += 1}`;
        const file = {
          getId: () => id,
          getName: () => (blob.getName ? blob.getName() : 'file'),
          getBlob: () => blob,
          setSharing() { file._shared = true; return file; },
          setTrashed(v) { file._trashed = v; return file; }
        };
        driveFiles.set(id, file);
        return file;
      }
    };
  }
  const fromSigned = (bytes) => Buffer.from(bytes.map((b) => (b + 256) % 256));

  function grid(title) {
    if (!tabs.has(title)) tabs.set(title, []);
    return tabs.get(title);
  }

  function makeRange(title, row, col, numRows, numCols) {
    return {
      getValues() {
        stats.reads += 1;
        const out = [];
        const g = grid(title);
        for (let r = 0; r < numRows; r += 1) {
          const source = g[row - 1 + r] || [];
          const line = [];
          for (let c = 0; c < numCols; c += 1) {
            const cell = source[col - 1 + c];
            line.push(cell === undefined || cell === null ? '' : cell);
          }
          out.push(line);
        }
        return out;
      },
      setValues(values) {
        stats.writes += 1;
        if (values.length !== numRows) {
          throw new Error(`setValues: expected ${numRows} rows, got ${values.length}`);
        }
        if (values.some((line) => line.length !== numCols)) {
          throw new Error(`setValues: expected ${numCols} columns`);
        }
        const g = grid(title);
        values.forEach((line, r) => {
          const target = row - 1 + r;
          while (g.length <= target) g.push([]);
          line.forEach((cell, c) => { g[target][col - 1 + c] = cell; });
        });
        return this;
      },
      getValue() {
        stats.reads += 1;
        const cell = (grid(title)[row - 1] || [])[col - 1];
        return cell === undefined || cell === null ? '' : cell;
      },
      setValue(value) {
        stats.writes += 1;
        const g = grid(title);
        while (g.length < row) g.push([]);
        g[row - 1][col - 1] = value;
        return this;
      },
      setFontWeight() { return this; }
    };
  }

  function makeSheet(title) {
    return {
      getName: () => title,
      getLastRow() {
        const g = grid(title);
        // Trailing blank rows do not count, matching the real API.
        let last = 0;
        g.forEach((line, index) => {
          if (line && line.some((cell) => cell !== '' && cell !== null && cell !== undefined)) {
            last = index + 1;
          }
        });
        return last;
      },
      getLastColumn() {
        return grid(title).reduce((max, line) => Math.max(max, line.length), 0);
      },
      getRange(row, col, numRows = 1, numCols = 1) {
        return makeRange(title, row, col, numRows, numCols);
      },
      getDataRange() {
        const g = grid(title);
        return makeRange(title, 1, 1, Math.max(1, g.length),
          Math.max(1, g.reduce((m, l) => Math.max(m, l.length), 0)));
      },
      appendRow(values) {
        stats.writes += 1;
        grid(title).push([...values]);
      },
      deleteRow(rowNumber) {
        stats.writes += 1;
        // Splices, so everything beneath moves up. This is why the store has to
        // delete highest-index-first.
        grid(title).splice(rowNumber - 1, 1);
      },
      setFrozenRows() { return this; },
      clear() { tabs.set(title, []); return this; }
    };
  }

  const book = {
    getSheetByName: (title) => (tabs.has(title) ? makeSheet(title) : null),
    insertSheet(title) { grid(title); return makeSheet(title); },
    getSheets: () => [...tabs.keys()].map(makeSheet),
    getName: () => 'VibeStar Test Book'
  };

  globalThis.SpreadsheetApp = {
    getActiveSpreadsheet: () => book,
    openById: () => book,
    flush() { /* no buffering in the mock */ }
  };

  globalThis.LockService = {
    getScriptLock: () => ({
      tryLock(ms) {
        stats.locks += 1;
        if (lockHeld) return false;
        lockHeld = true;
        return true;
      },
      releaseLock() { lockHeld = false; },
      waitLock(ms) { if (!this.tryLock(ms)) throw new Error('Could not obtain lock'); }
    })
  };

  globalThis.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => (properties.has(key) ? properties.get(key) : null),
      setProperty(key, value) { properties.set(key, String(value)); return this; },
      getProperties: () => Object.fromEntries(properties),
      deleteProperty(key) { properties.delete(key); return this; }
    })
  };

  globalThis.Utilities = {
    getUuid: () => crypto.randomUUID(),

    computeHmacSha256Signature(message, key) {
      const data = typeof message === 'string' ? Buffer.from(message, 'utf8') : fromSigned(message);
      const secret = typeof key === 'string' ? Buffer.from(key, 'utf8') : fromSigned(key);
      return toSigned(crypto.createHmac('sha256', secret).update(data).digest());
    },

    computeDigest(_algorithm, value) {
      const data = typeof value === 'string' ? Buffer.from(value, 'utf8') : fromSigned(value);
      return toSigned(crypto.createHash('sha256').update(data).digest());
    },

    base64Encode(input) {
      const buffer = typeof input === 'string' ? Buffer.from(input, 'utf8') : fromSigned(input);
      return buffer.toString('base64');
    },

    base64Decode: (base64) => toSigned(Buffer.from(String(base64), 'base64')),

    newBlob: (bytes, type, name) => ({
      getBytes: () => bytes,
      getContentType: () => type,
      getName: () => name,
      setName(n) { name = n; return this; }
    }),

    sleep: () => {},
    Charset: { UTF_8: 'UTF_8' },
    DigestAlgorithm: { SHA_256: 'SHA_256' }
  };

  // Services the entry points touch. Thin, but enough to prove doGet, doPost and
  // the trigger installer are wired up.
  globalThis.HtmlService = {
    createTemplateFromFile: (name) => ({
      evaluate() {
        const output = {
          _title: '', _meta: {},
          setTitle(t) { this._title = t; return this; },
          addMetaTag(k, v) { this._meta[k] = v; return this; },
          setXFrameOptionsMode() { return this; },
          getContent: () => `<!-- ${name} -->`
        };
        return output;
      }
    }),
    createHtmlOutputFromFile: (name) => ({ getContent: () => `<!-- ${name} -->` }),
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' }
  };

  globalThis.ContentService = {
    createTextOutput: (text) => ({
      _text: text,
      setMimeType() { return this; },
      getContent: () => text
    }),
    MimeType: { JSON: 'JSON', TEXT: 'TEXT' }
  };

  const triggers = [];
  globalThis.ScriptApp = {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger(trigger) {
      const index = triggers.indexOf(trigger);
      if (index >= 0) triggers.splice(index, 1);
    },
    newTrigger(handler) {
      const spec = { handler, getHandlerFunction: () => handler };
      const builder = {
        timeBased: () => builder,
        atHour: () => builder,
        everyDays: () => builder,
        create() { triggers.push(spec); return spec; }
      };
      return builder;
    }
  };

  globalThis.DriveApp = {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
    Permission: { VIEW: 'VIEW' },
    getRootFolder: () => makeFolder('root'),
    createFolder: (name) => makeFolder(name),
    getFoldersByName: () => ({ hasNext: () => false, next: () => makeFolder('VibeStar Media') }),
    getFolderById: (id) => makeFolder(id),
    getFileById: (id) => {
      const file = driveFiles.get(id);
      if (!file) throw new Error(`No file ${id}`);
      return file;
    }
  };

  return {
    stats,
    properties,
    driveFiles,
    /** Lays down a tab from column names plus row objects. */
    seed(title, headers, rows = []) {
      const g = grid(title);
      g.length = 0;
      g.push([...headers]);
      for (const row of rows) g.push(headers.map((h) => (row[h] === undefined ? '' : row[h])));
    },
    rowCount(title) { return Math.max(0, makeSheet(title).getLastRow() - 1); },
    dump(title) { return grid(title).map((line) => [...line]); },
    restore() {
      delete globalThis.SpreadsheetApp;
      delete globalThis.LockService;
      delete globalThis.PropertiesService;
      delete globalThis.Utilities;
      delete globalThis.HtmlService;
      delete globalThis.ContentService;
      delete globalThis.ScriptApp;
      delete globalThis.DriveApp;
    }
  };
}
