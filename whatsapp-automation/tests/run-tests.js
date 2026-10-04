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
const lock = { waitLock: () => {}, tryLock: () => true, releaseLock: () => {} };

const context = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  Utilities: {
    formatDate, sleep: () => {}, getUuid: () => require('crypto').randomUUID(),
    base64Encode: b => Buffer.from(b).toString('base64'),
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64url'),
  },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); },
    getProperties: () => Object.assign({}, props),
  }) },
  CacheService: { getScriptCache: () => ({ get: k => cacheStore[k] || null, put: (k, v) => { cacheStore[k] = v; } }) },
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
  DriveApp: { getFileById: id => {
    const f = driveFiles[id]; if (!f) throw new Error('not found');
    return { getName: () => f.name, getMimeType: () => f.mime, getSize: () => f.size, isTrashed: () => f.trashed,
      getBlob: () => ({ getContentType: () => f.mime, getBytes: () => [1, 2, 3] }) };
  } },
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
  const v = G.validateConfig(G.getConfig(true));
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
  const r = G.buildCampaignQueue(campaignId);
  assert.strictEqual(r.added, 0);
  assert.strictEqual(r.duplicates, 3); // Asha, Ravi and the second record sharing Asha's number
});

console.log('Sending');
test('processMessageQueue sends image then buttons with correct Maytapi payloads', () => {
  fetchLog.length = 0;
  const r = G.processMessageQueue();
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
  G.processMessageQueue();
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
  G.processMessageQueue();
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
  assert.strictEqual(G.activateScheduledCampaigns(), 0);
  const ct = G.readTable_('CAMPAIGNS');
  const row = ct.rows.find(c => c['Campaign ID'] === r.campaignId);
  G.updateFields_(ct, row._row, { 'Schedule Date': formatDate(new Date(Date.now() - 60000), 'Asia/Kolkata', 'yyyy-MM-dd'), 'Schedule Time': formatDate(new Date(Date.now() - 60000), 'Asia/Kolkata', 'HH:mm') });
  assert.strictEqual(G.activateScheduledCampaigns(), 1);
  assert.strictEqual(G.activateScheduledCampaigns(), 0);
  assert.strictEqual(table('CAMPAIGNS').find(c => c['Campaign ID'] === r.campaignId).Status, 'ACTIVE');
});
test('past schedule rejected', () => {
  const r = submit(Object.assign({}, baseAnswers, { 'Campaign Name': 'Past', 'Send Mode': 'Schedule', 'Campaign Date': '2020-01-01', 'Campaign Time': '10:00' }));
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /in the past/.test(e)));
});
test('pause / resume / cancel', () => {
  const r = submit(Object.assign({}, baseAnswers, { 'Campaign Name': 'Lifecycle' }));
  assert.ok(G.pauseCampaign(r.campaignId).ok);
  G.processMessageQueue();
  assert.ok(table('MESSAGE_QUEUE').filter(q => q['Campaign ID'] === r.campaignId).every(q => q.Status === 'PENDING'));
  assert.ok(G.resumeCampaign(r.campaignId).ok);
  assert.ok(G.cancelCampaign(r.campaignId).ok);
  assert.ok(table('MESSAGE_QUEUE').filter(q => q['Campaign ID'] === r.campaignId).every(q => q.Status === 'CANCELLED'));
});
test('dashboard renders', () => {
  G.refreshDashboard();
  const d = spreadsheet.getSheetByName('DASHBOARD').data;
  assert.strictEqual(d[0][0], 'WhatsApp Campaign Dashboard');
  assert.ok(d.some(r => r[0] === 'Messages Read' && r[1] >= 1));
});
test('doGet health exposes no secrets', () => {
  const t = G.doGet({}).text;
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
  G.activateScheduledCampaigns();
  const q = table('MESSAGE_QUEUE').filter(x => x['Campaign ID'] === r.campaignId);
  assert.strictEqual(JSON.stringify(q.map(x => x.Name)), JSON.stringify(['Rahul']));
  fetchLog.length = 0;
  G.processMessageQueue();
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
