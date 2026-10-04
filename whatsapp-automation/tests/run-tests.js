/**
 * Offline test harness: loads every .gs file into a Node VM with in-memory mocks of
 * the Apps Script services, then exercises the full flow:
 *   setup -> form submit -> queue -> Maytapi send (mocked) -> webhook ack -> STOP opt-out.
 *
 * Run:  node whatsapp-automation/tests/run-tests.js
 * No network calls are made. Maytapi responses are simulated.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

/* ----------------------------- mocks ----------------------------- */

function chain() {
  return new Proxy(function () {}, { get: (t, k) => (k === 'build' ? () => ({}) : () => chain()), apply: () => chain() });
}

function makeSheet(ss, name) {
  const s = {
    name, data: [], formUrl: null,
    getName: () => s.name,
    setName: n => { s.name = n; return s; },
    getSheetId: () => s.id,
    getLastRow: () => { for (let r = s.data.length; r > 0; r--) if (s.data[r - 1].some(v => v !== '' && v !== null && v !== undefined)) return r; return 0; },
    getLastColumn: () => s.data.reduce((m, row) => { let c = row.length; while (c > 0 && (row[c - 1] === '' || row[c - 1] === undefined)) c--; return Math.max(m, c); }, 0),
    getMaxRows: () => Math.max(1000, s.data.length),
    getFormUrl: () => s.formUrl,
    appendRow: row => { s.data[s.getLastRow()] = row.slice(); },
    clear: () => { s.data = []; return s; },
    setFrozenRows: () => s, autoResizeColumns: () => s,
    getActiveRange: () => ({ getRow: () => 1 }),
    getRange: (r, c, nr, nc) => makeRange(s, r, c, nr || 1, nc || 1),
  };
  s.id = Math.floor(Math.random() * 1e9);
  return s;
}

function makeRange(sheet, r, c, nr, nc) {
  const cell = (i, j) => { const row = sheet.data[r - 1 + i] || []; const v = row[c - 1 + j]; return v === undefined ? '' : v; };
  const set = (i, j, v) => { const ri = r - 1 + i; while (sheet.data.length <= ri) sheet.data.push([]); sheet.data[ri][c - 1 + j] = v; };
  const rng = {
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(i, j))),
    getValue: () => cell(0, 0),
    setValues: vals => { vals.forEach((row, i) => row.forEach((v, j) => set(i, j, v))); return rng; },
    setValue: v => { set(0, 0, v); return rng; },
    getRow: () => r,
    getSheet: () => sheet,
  };
  const proxy = new Proxy(rng, { get: (t, k) => (k in t ? t[k] : () => proxy) });
  ['setValues', 'setValue'].forEach(k => { const f = rng[k]; rng[k] = v => { f(v); return proxy; }; });
  return proxy;
}

const spreadsheet = {
  sheets: [],
  getSheetByName: n => spreadsheet.sheets.find(s => s.name === n) || null,
  getSheets: () => spreadsheet.sheets.slice(),
  insertSheet: n => { const s = makeSheet(spreadsheet, n); spreadsheet.sheets.push(s); return s; },
  deleteSheet: s => { spreadsheet.sheets = spreadsheet.sheets.filter(x => x !== s); },
  getSpreadsheetTimeZone: () => 'Asia/Kolkata',
  getSpreadsheetLocale: () => 'en_IN',
  getUrl: () => 'https://docs.google.com/spreadsheets/d/TEST',
  getId: () => 'TEST',
  getActiveSheet: () => spreadsheet.sheets[0],
  setActiveSheet: () => {},
};

const props = {};
const fetchLog = [];
let fetchResponder = () => ({ code: 200, body: { success: true, data: { chatId: 'x@c.us', msgId: 'MSG' + (fetchLog.length) } } });
const mails = [];

const driveFiles = {
  IMG_FILE_ID_1234567890ABCDEFG: { name: 'banner.jpg', mime: 'image/jpeg', size: 200000, trashed: false },
  PDF_FILE_ID_1234567890ABCDEFG: { name: 'doc.pdf', mime: 'application/pdf', size: 1000, trashed: false },
};

function pad(n, w = 2) { return String(n).padStart(w, '0'); }
function formatDate(d, tz, fmt) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d).map(p => [p.type, p.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +hour, +parts.minute, +parts.second);
  const offMin = Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  const z = (offMin >= 0 ? '+' : '-') + pad(Math.floor(Math.abs(offMin) / 60)) + pad(Math.abs(offMin) % 60);
  return fmt.replace(/'([^']*)'/g, '$1').replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day)
    .replace('HH', hour).replace('mm', parts.minute).replace('ss', parts.second).replace('Z', z);
}

const cacheStore = {};
const session = { active: 'owner@example.com', effective: 'owner@example.com' };
const folders = {};
function makeFolder(name) {
  const id = 'FOLDER_' + Object.keys(folders).length + '_' + name.replace(/\W/g, '');
  const children = [];
  const f = {
    getId: () => id, getName: () => name,
    createFolder: n => { const c = makeFolder(n); children.push(c); return c; },
    getFoldersByName: n => { const m = children.filter(c => c.getName() === n); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++] }; },
    createFile: blob => {
      const fid = 'CREATIVE_' + Object.keys(driveFiles).length + '_ABCDEFGHIJKLMNOPQRSTU';
      driveFiles[fid] = { name: blob.name, mime: blob.mime, size: blob.bytes.length, trashed: false, folder: name };
      return { getId: () => fid };
    },
  };
  folders[id] = f;
  return f;
}
const lock = { waitLock: () => {}, tryLock: () => true, releaseLock: () => {} };

const context = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  Utilities: {
    formatDate, sleep: () => {}, getUuid: () => require('crypto').randomUUID(),
    base64Encode: b => Buffer.from(b).toString('base64'),
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64url'),
    base64Decode: s => Array.from(Buffer.from(s, 'base64')),
    newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, str) => Array.from(require('crypto').createHash('sha256').update(String(str), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
  },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); },
    getProperties: () => Object.assign({}, props),
  }) },
  Session: {
    getActiveUser: () => ({ getEmail: () => session.active }),
    getEffectiveUser: () => ({ getEmail: () => session.effective }),
  },
  CacheService: { getScriptCache: () => ({ get: k => cacheStore[k] || null, put: (k, v) => { cacheStore[k] = v; }, remove: k => { delete cacheStore[k]; } }) },
  LockService: { getScriptLock: () => lock, getDocumentLock: () => lock, getUserLock: () => lock },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => spreadsheet, flush: () => {},
    getUi: () => { throw new Error('No UI in tests'); },
    newDataValidation: () => chain(),
  },
  UrlFetchApp: { fetch: (url, opts) => {
    fetchLog.push({ url, opts, payload: opts.payload ? JSON.parse(opts.payload) : null });
    const r = fetchResponder(url, opts);
    return { getResponseCode: () => r.code, getContentText: () => JSON.stringify(r.body) };
  } },
  DriveApp: {
    getFileById: id => {
      const f = driveFiles[id]; if (!f) throw new Error('not found');
      return { getName: () => f.name, getMimeType: () => f.mime, getSize: () => f.size, isTrashed: () => f.trashed,
        setTrashed: v => { f.trashed = v; }, getBlob: () => ({ getContentType: () => f.mime, getBytes: () => [1, 2, 3] }) };
    },
    createFolder: name => makeFolder(name),
    getFolderById: id => { if (!folders[id]) throw new Error('no folder'); return folders[id]; },
  },
  HtmlService: {
    createHtmlOutput: html => { const o = { html, setTitle: () => o, addMetaTag: () => o, setXFrameOptionsMode: () => o }; return o; },
    createHtmlOutputFromFile: () => ({ getContent: () => fs.readFileSync(path.join(__dirname, '..', 'src', 'ClientApp.html'), 'utf8') }),
    XFrameOptionsMode: { DEFAULT: 'DEFAULT' },
  },
  MailApp: { getRemainingDailyQuota: () => 100, sendEmail: m => mails.push(m) },
  ContentService: { createTextOutput: t => ({ text: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/ABC/exec' }), getProjectTriggers: () => [] },
};
vm.createContext(context);
const srcDir = path.join(__dirname, '..', 'src');
const code = fs.readdirSync(srcDir).filter(f => f.endsWith('.gs')).map(f => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\n');
vm.runInContext(code + '\n;this.__api = { CONFIG_RESET: () => { CONFIG_CACHE_ = null; } };', context);
const G = context;

/* ----------------------------- helpers ----------------------------- */

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); } catch (err) { console.log('  ✗ ' + name + '\n    ' + err.stack); process.exitCode = 1; }
}
const table = name => G.readTable_(name).rows;

/* ----------------------------- tests ----------------------------- */

console.log('Unit');
test('normalizePhoneNumber formats', () => {
  props.DEFAULT_COUNTRY_CODE = '91';
  assert.strictEqual(G.normalizePhoneNumber('9876543210'), '919876543210');
  assert.strictEqual(G.normalizePhoneNumber('+919876543210'), '919876543210');
  assert.strictEqual(G.normalizePhoneNumber('919876543210'), '919876543210');
  assert.strictEqual(G.normalizePhoneNumber('09876543210'), '919876543210');
  assert.strictEqual(G.normalizePhoneNumber('0091 98765-43210'), '919876543210');
  assert.strictEqual(G.normalizePhoneNumber(919876543210), '919876543210');
  assert.strictEqual(G.normalizePhoneNumber('+1 (415) 555-0100'), '14155550100');
  assert.strictEqual(G.normalizePhoneNumber('12345'), '');
  assert.strictEqual(G.normalizePhoneNumber('1234567890123456'), '');
});
test('maskPhone_', () => assert.strictEqual(G.maskPhone_('919876543210'), '91******3210'));
test('parse date/time', () => {
  assert.strictEqual(G.parseDateValue_('2026-12-05'), '2026-12-05');
  assert.strictEqual(G.parseDateValue_('05/12/2026'), '2026-12-05'); // en_IN => day first
  assert.strictEqual(G.parseDateValue_('31/02/2026'), '');
  assert.strictEqual(G.parseTimeValue_('7:05 PM'), '19:05');
  assert.strictEqual(G.parseTimeValue_('19:00:00'), '19:00');
  assert.strictEqual(G.parseTimeValue_('12:30 AM'), '00:30');
});
test('buildDateTime_ applies timezone', () => {
  assert.strictEqual(G.buildDateTime_('2026-12-05', '19:00', 'Asia/Kolkata').toISOString(), '2026-12-05T13:30:00.000Z');
});
test('extractDriveFileId_', () => {
  assert.strictEqual(G.extractDriveFileId_('https://drive.google.com/open?id=IMG_FILE_ID_1234567890ABCDEFG'), 'IMG_FILE_ID_1234567890ABCDEFG');
  assert.strictEqual(G.extractDriveFileId_('https://drive.google.com/file/d/IMG_FILE_ID_1234567890ABCDEFG/view'), 'IMG_FILE_ID_1234567890ABCDEFG');
});
test('normalizeUrl_', () => {
  assert.strictEqual(G.normalizeUrl_('example.com/x'), 'https://example.com/x');
  assert.strictEqual(G.normalizeUrl_('not a url'), '');
});

console.log('Setup');
test('setupSystem creates sheets idempotently', () => {
  G.setupSystem();
  G.setupSystem();
  ['SETTINGS', 'FORM_RESPONSES', 'CLIENTS', 'CONTACTS', 'CAMPAIGNS', 'MESSAGE_QUEUE', 'LOGS', 'RESPONSES', 'TEMPLATES', 'DASHBOARD']
    .forEach(n => assert.ok(spreadsheet.getSheetByName(n), n));
  assert.strictEqual(table('SETTINGS').filter(r => r.Key === 'BATCH_SIZE').length, 1);
  assert.strictEqual(table('TEMPLATES').length, 4);
  assert.ok(!table('SETTINGS').some(r => /TOKEN/.test(r.Key)));
});
test('renderTemplate with unknown variable', () => {
  const out = G.renderTemplate('Hi {{Name}}, call {{ StorePhone }} {{Foo}}!', { Name: '' }, { 'Store Phone': '9876543210' });
  assert.strictEqual(out, 'Hi Customer, call +919876543210 !');
});

console.log('Config');
test('validateConfig reports missing credentials', () => {
  G.__api.CONFIG_RESET();
  const v = G.validateConfig_(G.getConfig_(true));
  assert.ok(!v.ok);
  assert.ok(v.errors.join(' ').includes('MAYTAPI_API_TOKEN'));
});

// Credentials + contacts
Object.assign(props, { MAYTAPI_PRODUCT_ID: 'prod-1', MAYTAPI_PHONE_ID: '12345', MAYTAPI_API_TOKEN: 'super-secret-token', WEBHOOK_SECRET: 'hooksecret', ADMIN_EMAIL: 'admin@example.com' });
G.__api.CONFIG_RESET();

function submit(answers) {
  const sheet = spreadsheet.getSheetByName('FORM_RESPONSES');
  const headers = ['Timestamp', 'Client / Business Name', 'Campaign Name', 'Campaign Message', 'Campaign Image', 'Website / Landing Page URL',
    'Store / Business Phone Number', 'CTA Button Text', 'CTA Button Type', 'CTA Button Value', 'Target Audience', 'Send Mode',
    'Campaign Date', 'Campaign Time', 'Client Email', 'Additional Notes'];
  sheet.data[0] = headers;
  const row = headers.map(h => (h === 'Timestamp' ? new Date() : (answers[h] !== undefined ? answers[h] : '')));
  sheet.data.push(row);
  return G.onFormSubmit({ range: sheet.getRange(sheet.data.length, 1, 1, headers.length) });
}

const baseAnswers = {
  'Client / Business Name': 'Acme Store',
  'Campaign Name': 'Festive Launch',
  'Campaign Message': 'Hi {{Name}}, discover our new collection at {{ClientName}}. Call {{StorePhone}}.',
  'Campaign Image': 'https://drive.google.com/open?id=IMG_FILE_ID_1234567890ABCDEFG',
  'Website / Landing Page URL': 'https://acme.example.com',
  'Store / Business Phone Number': '9800000000',
  'CTA Button Text': 'Explore Collection',
  'CTA Button Type': 'URL',
  'CTA Button Value': '',
  'Target Audience': 'VIP, TAG:KOLKATA',
  'Send Mode': 'Send Now',
  'Client Email': 'owner@acme.example.com',
};

console.log('Form submission');
test('invalid submission is rejected with attention email', () => {
  mails.length = 0;
  const r = submit(Object.assign({}, baseAnswers, { 'Campaign Image': 'https://drive.google.com/open?id=PDF_FILE_ID_1234567890ABCDEFG', 'CTA Button Text': 'This label is far too long for a button' }));
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /not an image/.test(e)));
  assert.ok(r.errors.some(e => /at most 20/.test(e)));
  assert.ok(mails.some(m => m.subject === 'Campaign Submission Requires Attention' && m.to === 'owner@acme.example.com'));
  assert.strictEqual(table('CAMPAIGNS').length, 0);
});

test('valid Send Now submission with no contacts => ERROR + warning', () => {
  const r = submit(baseAnswers);
  assert.ok(r.ok);
  assert.strictEqual(r.status, 'ERROR');
  assert.ok(/^CMP-\d{4}-0001$/.test(r.campaignId));
  assert.ok(/^CLI-\d{4}-0001$/.test(table('CLIENTS')[0]['Client ID']));
});

// Add contacts for the client
const clientId = table('CLIENTS')[0]['Client ID'];
G.appendObjects_('CONTACTS', [
  { 'Contact ID': 'CON-1', 'Client ID': clientId, Name: 'Asha', Phone: '9876543210', Tags: 'VIP', 'Opt In': 'YES', Status: 'Active' },
  { 'Contact ID': 'CON-2', 'Client ID': clientId, Name: 'Ravi', Phone: '+919876500000', Tags: 'kolkata', 'Opt In': 'YES', Status: 'Active' },
  { 'Contact ID': 'CON-3', 'Client ID': clientId, Name: 'NoConsent', Phone: '9876511111', Tags: 'VIP', 'Opt In': 'NO', Status: 'Active' },
  { 'Contact ID': 'CON-4', 'Client ID': clientId, Name: 'Dup', Phone: '919876543210', Tags: 'VIP', 'Opt In': 'YES', Status: 'Active' },
  { 'Contact ID': 'CON-5', 'Client ID': 'CLI-OTHER', Name: 'Other', Phone: '9876522222', Tags: 'VIP', 'Opt In': 'YES', Status: 'Active' },
  { 'Contact ID': 'CON-6', 'Client ID': clientId, Name: 'Inactive', Phone: '9876533333', Tags: 'VIP', 'Opt In': 'YES', Status: 'Inactive' },
]);

let campaignId;
test('Send Now submission builds queue (opt-in, client isolation, dedupe)', () => {
  mails.length = 0;
  const r = submit(Object.assign({}, baseAnswers, { 'Campaign Name': 'Festive Launch 2' }));
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.status, 'ACTIVE');
  campaignId = r.campaignId;
  const q = table('MESSAGE_QUEUE').filter(x => x['Campaign ID'] === campaignId);
  assert.strictEqual(JSON.stringify(q.map(x => x.Phone).sort()), JSON.stringify(['919876500000', '919876543210']));
  assert.ok(/^QUE-\d{4}-000001$/.test(q[0]['Queue ID']));
  assert.strictEqual(q.find(x => x.Name === 'Asha')['Rendered Message'], 'Hi Asha, discover our new collection at Acme Store. Call +919800000000.');
  assert.strictEqual(q[0]['CTA Value'], 'https://acme.example.com');
  assert.ok(mails.some(m => m.subject === 'Campaign Submitted – Festive Launch 2'));
  assert.ok(mails.some(m => m.to === 'admin@example.com'));
});

test('duplicate submission rejected', () => {
  const r = submit(Object.assign({}, baseAnswers, { 'Campaign Name': 'Festive Launch 2' }));
  assert.strictEqual(r.ok, false);
  assert.ok(/already been submitted/.test(r.errors[0]));
});

test('buildCampaignQueue is idempotent', () => {
  const r = G.buildCampaignQueue_(campaignId);
  assert.strictEqual(r.added, 0);
  assert.strictEqual(r.duplicates, 3); // Asha, Ravi and the second record sharing Asha's number
});

console.log('Sending');
test('processMessageQueue sends image then buttons with correct Maytapi payloads', () => {
  fetchLog.length = 0;
  const r = G.processMessageQueue_();
  assert.strictEqual(r.sent, 2);
  assert.strictEqual(fetchLog.length, 4);
  const [img, btn] = fetchLog;
  assert.strictEqual(img.url, 'https://api.maytapi.com/api/prod-1/12345/sendMessage');
  assert.strictEqual(img.opts.headers['x-maytapi-key'], 'super-secret-token');
  assert.strictEqual(img.opts.muteHttpExceptions, true);
  assert.strictEqual(img.payload.type, 'media');
  assert.ok(img.payload.message.startsWith('data:image/jpeg;base64,'));
  assert.strictEqual(btn.payload.type, 'buttons');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(btn.payload.buttons)), [{ text: 'Explore Collection', url: 'https://acme.example.com' }]);
  const q = table('MESSAGE_QUEUE').filter(x => x['Campaign ID'] === campaignId);
  assert.ok(q.every(x => x.Status === 'SENT' && /MSG\d,MSG\d/.test(x['Message ID'])));
  assert.strictEqual(table('CAMPAIGNS').find(c => c['Campaign ID'] === campaignId).Status, 'COMPLETED');
});

test('token never written to sheets', () => {
  const dump = JSON.stringify(spreadsheet.sheets.map(s => s.data));
  assert.ok(!dump.includes('super-secret-token'));
});

test('button rejection falls back to text CTA; 5xx retries; 401 stops batch', () => {
  const r0 = submit(Object.assign({}, baseAnswers, { 'Campaign Name': 'Fallback test', 'Campaign Image': '' }));
  fetchResponder = (url, opts) => {
    const p = JSON.parse(opts.payload);
    if (p.type === 'buttons') return { code: 400, body: { success: false, message: 'Invalid buttons' } };
    if (p.to_number === '919876500000') return { code: 503, body: { success: false, message: 'Service unavailable' } };
    return { code: 200, body: { success: true, data: { msgId: 'TXT1' } } };
  };
  fetchLog.length = 0;
  G.processMessageQueue_();
  const q = table('MESSAGE_QUEUE').filter(x => x['Campaign ID'] === r0.campaignId);
  const asha = q.find(x => x.Name === 'Asha');
  const ravi = q.find(x => x.Name === 'Ravi');
  assert.strictEqual(asha.Status, 'SENT');
  assert.ok(fetchLog.some(f => f.payload.type === 'text' && f.payload.message.includes('👉 Explore Collection: https://acme.example.com')));
  assert.strictEqual(ravi.Status, 'QUEUED');
  assert.strictEqual(Number(ravi.Attempts), 1);

  // Make Ravi due again, then auth error
  const qt = G.readTable_('MESSAGE_QUEUE');
  G.updateFields_(qt, ravi._row, { 'Scheduled At': new Date(Date.now() - 1000) });
  fetchResponder = () => ({ code: 401, body: { success: false, message: 'Unauthorized' } });
  G.processMessageQueue_();
  const ravi2 = table('MESSAGE_QUEUE').find(x => x['Queue ID'] === ravi['Queue ID']);
  assert.strictEqual(ravi2.Status, 'FAILED');
  assert.ok(table('LOGS').some(l => l.Action === 'QUEUE_BATCH_STOPPED'));
  fetchResponder = () => ({ code: 200, body: { success: true, data: { msgId: 'OK' + fetchLog.length } } });
});

console.log('Webhook');
const firstMsgId = table('MESSAGE_QUEUE').find(x => x['Campaign ID'] === campaignId && x.Name === 'Asha')['Message ID'].split(',')[1];
test('rejects webhook without key', () => {
  const out = JSON.parse(G.doPost({ parameter: {}, postData: { contents: '{}' } }).text);
  assert.strictEqual(out.ok, false);
});
test('ack updates queue status (never downgrades)', () => {
  const post = body => G.doPost({ parameter: { key: 'hooksecret' }, postData: { contents: JSON.stringify(body) } });
  post({ type: 'ack', phone_id: 12345, data: [{ msgId: firstMsgId, ackType: 'read', ackCode: 3 }] });
  post({ type: 'ack', phone_id: 12345, data: [{ msgId: firstMsgId, ackType: 'delivered', ackCode: 2 }] });
  const row = table('MESSAGE_QUEUE').find(x => String(x['Message ID']).includes(firstMsgId));
  assert.strictEqual(row.Status, 'READ');
});
test('keyword auto-reply uses TEMPLATES and client info', () => {
  fetchLog.length = 0;
  G.doPost({ parameter: { key: 'hooksecret' }, postData: { contents: JSON.stringify({
    type: 'message', phone_id: 12345, message: { type: 'text', text: 'Offer', fromMe: false, id: 'in1' },
    user: { id: '919876543210@c.us', name: 'Asha', phone: '919876543210' }, conversation: '919876543210@c.us' }) } });
  assert.strictEqual(fetchLog.length, 1);
  assert.ok(fetchLog[0].payload.message.includes('Acme Store'));
  assert.ok(table('RESPONSES').some(r => r['Event Type'] === 'message' && /^YES: replied/.test(r.Processed)));
});
test('redelivered webhook message is processed once', () => {
  fetchLog.length = 0;
  const body = JSON.stringify({ type: 'message', phone_id: 12345, message: { type: 'text', text: 'Offer', fromMe: false, id: 'in1' },
    user: { id: '919876543210@c.us', phone: '919876543210' }, conversation: '919876543210@c.us' });
  G.doPost({ parameter: { key: 'hooksecret' }, postData: { contents: body } });
  assert.strictEqual(fetchLog.length, 0);
});
test('STOP opts out every record for the phone and future queues skip it', () => {
  G.doPost({ parameter: { key: 'hooksecret' }, postData: { contents: JSON.stringify({
    type: 'message', phone_id: 12345, message: { type: 'text', text: 'stop', fromMe: false, id: 'in2' },
    user: { phone: '919876543210' }, conversation: '919876543210@c.us' }) } });
  const recs = table('CONTACTS').filter(c => G.normalizePhoneNumber(c.Phone) === '919876543210');
  assert.ok(recs.length === 2 && recs.every(c => c['Opt In'] === 'NO'));
  const r = submit(Object.assign({}, baseAnswers, { 'Campaign Name': 'After stop' }));
  const q = table('MESSAGE_QUEUE').filter(x => x['Campaign ID'] === r.campaignId);
  assert.strictEqual(JSON.stringify(q.map(x => x.Phone)), JSON.stringify(['919876500000']));
});
test('unknown inbound number becomes a lead with Opt In = NO', () => {
  G.doPost({ parameter: { key: 'hooksecret' }, postData: { contents: JSON.stringify({
    type: 'message', phone_id: 12345, message: { type: 'text', text: 'price?', fromMe: false, id: 'in3' },
    user: { phone: '919999999999', name: 'New' }, conversation: '919999999999@c.us' }) } });
  const lead = table('CONTACTS').find(c => c.Phone === '919999999999');
  assert.ok(lead && lead['Opt In'] === 'NO' && lead.Audience === 'LEADS');
});

console.log('Scheduling');
test('scheduled campaign activates only when due', () => {
  const future = new Date(Date.now() + 2 * 3600 * 1000);
  const d = formatDate(future, 'Asia/Kolkata', 'yyyy-MM-dd');
  const t = formatDate(future, 'Asia/Kolkata', 'HH:mm');
  const r = submit(Object.assign({}, baseAnswers, { 'Campaign Name': 'Scheduled one', 'Send Mode': 'Schedule', 'Campaign Date': d, 'Campaign Time': t }));
  assert.strictEqual(r.status, 'SCHEDULED');
  assert.strictEqual(G.activateScheduledCampaigns_(), 0);
  const ct = G.readTable_('CAMPAIGNS');
  const row = ct.rows.find(c => c['Campaign ID'] === r.campaignId);
  G.updateFields_(ct, row._row, { 'Schedule Date': formatDate(new Date(Date.now() - 60000), 'Asia/Kolkata', 'yyyy-MM-dd'), 'Schedule Time': formatDate(new Date(Date.now() - 60000), 'Asia/Kolkata', 'HH:mm') });
  assert.strictEqual(G.activateScheduledCampaigns_(), 1);
  assert.strictEqual(G.activateScheduledCampaigns_(), 0);
  assert.strictEqual(table('CAMPAIGNS').find(c => c['Campaign ID'] === r.campaignId).Status, 'ACTIVE');
});
test('past schedule rejected', () => {
  const r = submit(Object.assign({}, baseAnswers, { 'Campaign Name': 'Past', 'Send Mode': 'Schedule', 'Campaign Date': '2020-01-01', 'Campaign Time': '10:00' }));
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /in the past/.test(e)));
});
test('pause / resume / cancel', () => {
  const r = submit(Object.assign({}, baseAnswers, { 'Campaign Name': 'Lifecycle' }));
  assert.ok(G.pauseCampaign_(r.campaignId).ok);
  G.processMessageQueue_();
  assert.ok(table('MESSAGE_QUEUE').filter(q => q['Campaign ID'] === r.campaignId).every(q => q.Status === 'PENDING'));
  assert.ok(G.resumeCampaign_(r.campaignId).ok);
  assert.ok(G.cancelCampaign_(r.campaignId).ok);
  assert.ok(table('MESSAGE_QUEUE').filter(q => q['Campaign ID'] === r.campaignId).every(q => q.Status === 'CANCELLED'));
});
test('dashboard renders', () => {
  G.refreshDashboard();
  const d = spreadsheet.getSheetByName('DASHBOARD').data;
  assert.strictEqual(d[0][0], 'WhatsApp Campaign Dashboard');
  assert.ok(d.some(r => r[0] === 'Messages Read' && r[1] >= 1));
});
test('doGet health exposes no secrets', () => {
  const t = G.doGet({ parameter: { health: '1' } }).text;
  assert.ok(JSON.parse(t).status === 'ok' && !t.includes('secret'));
});

console.log('Spec §39 example + §40 multi-client');
test('ABC Jewellery scheduled example reaches only its own customers, personalised, with image + URL button', () => {
  // Two new clients, each with their own contacts. Client B must never receive Client A's campaign.
  const abcEmail = 'owner@abc-jewellery.example';
  const xyzEmail = 'sales@xyz-realty.example';
  const target = new Date(Math.max(Date.parse('2026-10-10T13:30:00Z'), Date.now() + 2 * 86400000));
  const example = {
    'Client / Business Name': 'ABC Jewellery',
    'Campaign Name': 'Festival Gold Offer',
    'Campaign Message': 'Hi {{Name}},\n\nDiscover our latest jewellery collection ✨\n\nEnjoy special offers for a limited time.\n\nStore:\n{{StorePhone}}',
    'Campaign Image': 'https://drive.google.com/open?id=IMG_FILE_ID_1234567890ABCDEFG',
    'Website / Landing Page URL': 'https://example.com',
    'Store / Business Phone Number': '9830012345',
    'CTA Button Text': 'Explore Collection',
    'CTA Button Type': 'URL',
    'CTA Button Value': 'https://example.com/collection',
    'Target Audience': 'ALL_OPTED_IN',
    'Send Mode': 'Schedule',
    'Campaign Date': formatDate(target, 'Asia/Kolkata', 'yyyy-MM-dd'),
    'Campaign Time': '19:00',
    'Client Email': abcEmail,
  };
  // Register Client B first via its own (rejected) submission so it has a Client ID.
  submit(Object.assign({}, baseAnswers, { 'Client / Business Name': 'XYZ Realty', 'Client Email': xyzEmail, 'Campaign Name': 'Open House' }));
  const r = submit(example);
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.status, 'SCHEDULED');
  const clients = table('CLIENTS');
  const abc = clients.find(c => c['Client Email'] === abcEmail)['Client ID'];
  const xyz = clients.find(c => c['Client Email'] === xyzEmail)['Client ID'];
  assert.notStrictEqual(abc, xyz);
  G.appendObjects_('CONTACTS', [
    { 'Contact ID': 'CON-A1', 'Client ID': abc, Name: 'Rahul', Phone: '9830000001', 'Opt In': 'YES', Status: 'Active' },
    { 'Contact ID': 'CON-B1', 'Client ID': xyz, Name: 'Priya', Phone: '9830000002', 'Opt In': 'YES', Status: 'Active' },
  ]);
  // Make it due, activate, send.
  const ct = G.readTable_('CAMPAIGNS');
  const row = ct.rows.find(c => c['Campaign ID'] === r.campaignId);
  const past = new Date(Date.now() - 60000);
  G.updateFields_(ct, row._row, { 'Schedule Date': formatDate(past, 'Asia/Kolkata', 'yyyy-MM-dd'), 'Schedule Time': formatDate(past, 'Asia/Kolkata', 'HH:mm') });
  // Drain any other campaigns' items so this batch only contains the example.
  G.updateQueueStatusWhere_('*', ['PENDING', 'QUEUED'], 'CANCELLED', 'test isolation');
  G.activateScheduledCampaigns_();
  const q = table('MESSAGE_QUEUE').filter(x => x['Campaign ID'] === r.campaignId);
  assert.strictEqual(JSON.stringify(q.map(x => x.Name)), JSON.stringify(['Rahul']));
  fetchLog.length = 0;
  G.processMessageQueue_();
  const toRahul = fetchLog.filter(f => f.payload.to_number === '919830000001');
  assert.ok(!fetchLog.some(f => f.payload.to_number === '919830000002'), 'Client B customer must not receive Client A campaign');
  assert.strictEqual(toRahul[0].payload.type, 'media');
  assert.ok(toRahul[0].payload.message.startsWith('data:image/jpeg;base64,'));
  assert.strictEqual(toRahul[1].payload.type, 'buttons');
  assert.ok(toRahul[1].payload.message.startsWith('Hi Rahul,\n\nDiscover our latest jewellery collection ✨'));
  assert.ok(toRahul[1].payload.message.includes('+919830012345'));
  assert.strictEqual(JSON.stringify(toRahul[1].payload.buttons), JSON.stringify([{ text: 'Explore Collection', url: 'https://example.com/collection' }]));
  assert.ok(/^CMP-\d{4}-\d{4}$/.test(r.campaignId));
});

console.log('Security: admin guard');
test('admin-only functions refuse web-app visitors and mask secrets for the admin', () => {
  session.active = ''; // anonymous dashboard visitor (web app executes as owner)
  ['getConfig', 'validateConfig', 'sendTestMessage', 'startCampaign', 'cancelCampaign', 'getWebhookUrl', 'setupSystem',
    'installTriggers', 'sendMaytapiText', 'maytapiRequest', 'processMessageQueue', 'retryFailedMessages']
    .forEach(fn => assert.throws(() => G[fn]('x', 'y'), /Administrator access required/, fn));
  session.active = 'someone@else.com';
  assert.throws(() => G.getConfig(), /Administrator/);
  session.active = 'owner@example.com';
  const cfg = G.getConfig(true);
  assert.strictEqual(cfg.apiToken, '***');
  assert.strictEqual(cfg.webhookSecret, '***');
});
test('onFormSubmit rejects fake (browser-built) events', () => {
  const before = table('CAMPAIGNS').length;
  const r = G.onFormSubmit({ namedValues: { 'Campaign Name': ['x'] } });
  assert.strictEqual(r, null);
  assert.strictEqual(table('CAMPAIGNS').length, before);
});

console.log('Client dashboard API');
let tokenA, codeA, clientA, clientB;
test('login: wrong code rejected, lockout after 5 failures, correct code returns session + bootstrap', () => {
  clientA = G.findOrCreateClient_({ businessName: 'Tenant A Store', email: 'a@tenant-a.example', storePhone: '919800000001', website: 'https://a.example' });
  clientB = G.findOrCreateClient_({ businessName: 'Tenant B Realty', email: 'b@tenant-b.example', storePhone: '919800000002', website: 'https://b.example' });
  codeA = G.issueAccessCode_(clientA);
  G.issueAccessCode_(clientB);
  assert.ok(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(codeA));
  const bad = G.apiLogin('a@tenant-a.example', 'WRONG-CODE1');
  assert.strictEqual(bad.ok, false); assert.strictEqual(bad.code, 'AUTH');
  const r = G.apiLogin('A@Tenant-A.example', codeA.toLowerCase());
  assert.ok(r.ok, JSON.stringify(r));
  tokenA = r.token;
  assert.strictEqual(r.profile.clientId, clientA);
  assert.ok(!JSON.stringify(r).includes('Access Code Hash'));
  assert.ok(!JSON.stringify(table('CLIENTS')).includes(codeA), 'plain code never stored');
  for (let i = 0; i < 5; i++) G.apiLogin('b@tenant-b.example', 'NOPE0-NOPE0');
  assert.ok(/Too many attempts/.test(G.apiLogin('b@tenant-b.example', 'NOPE0-NOPE0').error));
});
test('api calls without a valid session are rejected', () => {
  assert.strictEqual(G.apiBootstrap('deadbeef').code, 'AUTH');
  assert.strictEqual(G.apiUploadContacts('', {}).code, 'AUTH');
});
test('upload: consent required, phones normalised, dedupe, invalid rows reported, opted-out kept', () => {
  assert.ok(/confirm/.test(G.apiUploadContacts(tokenA, { listName: 'VIP', consent: false, rows: [{ phone: '9876500001' }] }).error));
  const r = G.apiUploadContacts(tokenA, { listName: 'Diwali 2026!', consent: true, rows: [
    { name: 'Rahul', phone: '9876500001', tags: 'VIP' },
    { name: 'Rahul dup', phone: '+91 98765 00001' },
    { name: 'Meera', phone: '9876500002', optIn: 'no' },
    { name: 'Bad', phone: '123' },
  ] });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.list, 'Diwali 2026');
  assert.strictEqual(r.added, 2); assert.strictEqual(r.duplicatesInFile, 1); assert.strictEqual(r.invalid, 1);
  assert.strictEqual(JSON.stringify(r.invalidRows), '[5]');
  const mine = table('CONTACTS').filter(c => c['Client ID'] === clientA);
  assert.strictEqual(mine.find(c => c.Name === 'Rahul')['Opt In'], 'YES');
  assert.ok(/VIP/.test(mine.find(c => c.Name === 'Rahul').Tags) && /Diwali 2026/.test(mine.find(c => c.Name === 'Rahul').Tags));
  assert.strictEqual(mine.find(c => c.Name === 'Meera')['Opt In'], 'NO');
  assert.ok(/consent confirmed/.test(mine[0].Source));
  // Re-upload must not re-subscribe Meera.
  const r2 = G.apiUploadContacts(tokenA, { listName: 'Again', consent: true, rows: [{ name: 'Meera', phone: '9876500002' }] });
  assert.strictEqual(r2.keptOptedOut, 1);
  assert.strictEqual(table('CONTACTS').find(c => c.Name === 'Meera')['Opt In'], 'NO');
  assert.strictEqual(r2.bootstrap.stats.optedIn, 1);
});
test('create campaign from dashboard: image saved privately, audience by list, only own contacts queued', () => {
  // Tenant B has a contact with the same list name — must never be targeted by tenant A.
  G.appendObjects_('CONTACTS', [{ 'Contact ID': 'CON-BX', 'Client ID': clientB, Name: 'B cust', Phone: '9876500009', Tags: 'Diwali 2026', 'Opt In': 'YES', Status: 'Active' }]);
  assert.strictEqual(G.apiCountAudience(tokenA, { lists: ['Diwali 2026'] }).count, 1);
  const jpg = 'data:image/jpeg;base64,' + Buffer.from('fakejpegbytes').toString('base64');
  const r = G.apiCreateCampaign(tokenA, {
    campaignName: 'Dashboard Launch', message: 'Hi {{Name}}, welcome to {{ClientName}}', imageDataUrl: jpg,
    ctaType: 'URL', ctaText: 'Shop Now', ctaValue: '', audience: { lists: ['Diwali 2026'] }, sendMode: 'NOW',
  });
  assert.ok(r.ok && r.created, JSON.stringify(r));
  assert.strictEqual(r.status, 'ACTIVE');
  const camp = table('CAMPAIGNS').find(c => c['Campaign ID'] === r.campaignId);
  assert.strictEqual(camp['Client ID'], clientA);
  assert.strictEqual(camp['Client Name'], 'Tenant A Store');
  assert.strictEqual(camp['Target Audience'], 'TAG:DIWALI 2026');
  assert.ok(driveFiles[camp['Image File ID']] && driveFiles[camp['Image File ID']].folder === clientA);
  const q = table('MESSAGE_QUEUE').filter(x => x['Campaign ID'] === r.campaignId);
  assert.strictEqual(JSON.stringify(q.map(x => x.Phone)), JSON.stringify(['919876500001']));
  assert.strictEqual(q[0]['Rendered Message'], 'Hi Rahul, welcome to Tenant A Store');
  assert.strictEqual(q[0]['CTA Value'], 'https://a.example');
  assert.ok(r.campaigns.some(c => c.id === r.campaignId));
});
test('validation errors are returned inline (no email) and the uploaded image is trashed', () => {
  mails.length = 0;
  const jpg = 'data:image/jpeg;base64,' + Buffer.from('x').toString('base64');
  const r = G.apiCreateCampaign(tokenA, { campaignName: '', message: 'Hi', imageDataUrl: jpg, ctaType: 'NONE', audience: { all: true }, sendMode: 'SCHEDULE', date: '2020-01-01', time: '10:00' });
  assert.ok(r.ok && !r.created);
  assert.ok(r.errors.some(e => /Campaign Name/.test(e)) && r.errors.some(e => /past/.test(e)));
  assert.strictEqual(mails.length, 0);
  const lastCreative = Object.keys(driveFiles).filter(k => k.startsWith('CREATIVE_')).pop();
  assert.strictEqual(driveFiles[lastCreative].trashed, true);
});
test('tenant B cannot see, cancel or preview tenant A campaigns', () => {
  const codeB = G.issueAccessCode_(clientB);
  const tB = G.apiLogin('b@tenant-b.example', codeB);
  // B was locked out by earlier failures — clear the lock for this test.
  Object.keys(cacheStore).filter(k => k.startsWith('loginfail_')).forEach(k => delete cacheStore[k]);
  const loginB = tB.ok ? tB : G.apiLogin('b@tenant-b.example', codeB);
  assert.ok(loginB.ok, JSON.stringify(loginB));
  const aCamp = table('CAMPAIGNS').find(c => c['Client ID'] === clientA)['Campaign ID'];
  assert.ok(!loginB.campaigns.some(c => c.id === aCamp));
  assert.strictEqual(G.apiCancelCampaign(loginB.token, aCamp).error, 'Campaign not found.');
  assert.strictEqual(G.apiGetCampaignImage(loginB.token, aCamp).error, 'Campaign not found.');
  assert.ok(G.apiGetCampaignImage(tokenA, aCamp).ok);
});
test('resetting the access code ends existing sessions', () => {
  G.issueAccessCode_(clientA);
  assert.strictEqual(G.apiBootstrap(tokenA).code, 'AUTH');
});
test('doGet serves the dashboard; ?health=1 returns JSON', () => {
  assert.ok(/Campaign Studio/.test(G.doGet({ parameter: {} }).html));
  assert.strictEqual(JSON.parse(G.doGet({ parameter: { health: '1' } }).text).status, 'ok');
});

console.log('Multi-tenant');
function setClient(id, fields) { const t = G.readTable_('CLIENTS'); G.updateFields_(t, G.findRow_(t, 'Client ID', id)._row, fields); }
test('tenant with a dedicated number sends from it; others use the platform number', () => {
  setClient(clientA, { 'Maytapi Phone ID': '777' });
  G.updateQueueStatusWhere_('*', ['PENDING', 'QUEUED'], 'CANCELLED', 'isolation');
  const ct = G.readTable_('CAMPAIGNS');
  const camp = ct.rows.find(c => c['Client ID'] === clientA && c['Campaign Name'] === 'Dashboard Launch');
  G.updateFields_(ct, camp._row, { Status: 'COMPLETED' });
  // New campaign for tenant A
  const codeA2 = G.issueAccessCode_(clientA);
  const t = G.apiLogin('a@tenant-a.example', codeA2).token;
  const r = G.apiCreateCampaign(t, { campaignName: 'Own number', message: 'Hello {{Name}}', ctaType: 'NONE', audience: { all: true }, sendMode: 'NOW' });
  assert.ok(r.created, JSON.stringify(r));
  fetchLog.length = 0;
  G.processMessageQueue();
  assert.ok(fetchLog.length >= 1);
  assert.ok(fetchLog.every(f => f.url === 'https://api.maytapi.com/api/prod-1/777/sendMessage'), fetchLog.map(f => f.url).join());
  const q = table('MESSAGE_QUEUE').filter(x => x['Campaign ID'] === r.campaignId);
  assert.ok(q.every(x => String(x['Sender Phone ID']) === '777' && x.Status === 'SENT'));
});
test('monthly quota reached pauses the campaign without failing messages', () => {
  setClient(clientA, { 'Monthly Quota': 1 });
  G.appendObjects_('CONTACTS', [{ 'Contact ID': 'CON-A9', 'Client ID': clientA, Name: 'Zed', Phone: '9876500003', 'Opt In': 'YES', Status: 'Active' }]);
  const codeA3 = G.issueAccessCode_(clientA);
  const t = G.apiLogin('a@tenant-a.example', codeA3).token;
  const r = G.apiCreateCampaign(t, { campaignName: 'Over quota', message: 'Hi', ctaType: 'NONE', audience: { all: true }, sendMode: 'NOW' });
  assert.ok(r.created && r.warnings.some(w => /messages remain/.test(w)), JSON.stringify(r));
  G.processMessageQueue();
  assert.strictEqual(table('CAMPAIGNS').find(c => c['Campaign ID'] === r.campaignId).Status, 'PAUSED');
  assert.ok(table('MESSAGE_QUEUE').filter(x => x['Campaign ID'] === r.campaignId).every(x => x.Status === 'PENDING'));
  assert.strictEqual(G.apiBootstrap(t).subscription.canSend, false);
});
test('expired or suspended tenants cannot create campaigns or sign in', () => {
  setClient(clientA, { 'Monthly Quota': '', 'Valid Until': '2020-01-31' });
  const codeA4 = G.issueAccessCode_(clientA);
  const t = G.apiLogin('a@tenant-a.example', codeA4).token;
  const r = G.apiCreateCampaign(t, { campaignName: 'Expired', message: 'Hi', ctaType: 'NONE', audience: { all: true }, sendMode: 'NOW' });
  assert.ok(!r.created && /expired/.test(r.errors[0]), JSON.stringify(r));
  setClient(clientA, { 'Valid Until': '', Status: 'Suspended' });
  assert.strictEqual(G.apiBootstrap(t).code, 'AUTH');
  assert.strictEqual(G.apiLogin('a@tenant-a.example', codeA4).ok, false);
  setClient(clientA, { Status: 'Active' });
});
test('webhook on a dedicated number: opt-out and templates scoped to that tenant', () => {
  // Same customer number exists for tenant A (dedicated 777) and tenant B (shared).
  G.appendObjects_('CONTACTS', [{ 'Contact ID': 'CON-B2', 'Client ID': clientB, Name: 'Shared cust', Phone: '9876500001', 'Opt In': 'YES', Status: 'Active' }]);
  G.appendObjects_('TEMPLATES', [{ 'Template ID': 'TPL-A', 'Template Name': 'A offer', Trigger: 'offer', 'Reply Type': 'TEXT', 'Reply Text': 'Tenant A special offer', Active: 'YES', 'Client ID': clientA }]);
  const post = text => G.doPost({ parameter: { key: 'hooksecret' }, postData: { contents: JSON.stringify({
    type: 'message', phone_id: 777, message: { type: 'text', text: text, fromMe: false, id: 'ded-' + text },
    user: { phone: '919876500001' }, conversation: '919876500001@c.us' }) } });
  fetchLog.length = 0;
  post('offer');
  assert.strictEqual(fetchLog.length, 1);
  assert.strictEqual(fetchLog[0].payload.message, 'Tenant A special offer');
  assert.ok(fetchLog[0].url.includes('/777/'), 'reply from the receiving number');
  post('STOP');
  const recs = table('CONTACTS').filter(c => G.normalizePhoneNumber(c.Phone) === '919876500001');
  assert.strictEqual(recs.find(c => c['Client ID'] === clientA)['Opt In'], 'NO');
  assert.strictEqual(recs.find(c => c['Client ID'] === clientB)['Opt In'], 'YES', 'other tenant unaffected');
  const unknown = JSON.parse(G.doPost({ parameter: { key: 'hooksecret' }, postData: { contents: JSON.stringify({ type: 'message', phone_id: 999, message: { text: 'x' } }) } }).text);
  assert.strictEqual(unknown.ignored, 'unknown phone');
});
test('admin dashboard lists tenants with usage', () => {
  G.refreshDashboard();
  const d = spreadsheet.getSheetByName('DASHBOARD').data;
  assert.ok(d.some(r => String(r[0]).includes('Tenant A Store') && String(r[3]).includes('Dedicated (777)')));
});

console.log('Single-file build');
test('dist/Code.gs is up to date and valid JavaScript', () => {
  const { build } = require('../tools/build-single-file.js');
  const built = build();
  const distPath = path.join(__dirname, '..', 'dist', 'Code.gs');
  assert.ok(fs.existsSync(distPath), 'run tools/build-single-file.js');
  assert.strictEqual(fs.readFileSync(distPath, 'utf8'), built, 'dist/Code.gs is stale — run tools/build-single-file.js');
  new vm.Script(built);
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
