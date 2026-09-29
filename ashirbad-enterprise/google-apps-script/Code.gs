/**
 * Ashirbad Enterprise – private Google Sheets backend
 * =====================================================================
 * Paste this whole file into the Apps Script editor of YOUR PRIVATE
 * Google Sheet (Extensions → Apps Script), then deploy it as a Web App:
 *   Deploy → New deployment → Web app
 *     Execute as:      Me
 *     Who has access:  Anyone
 * Copy the Web App URL into assets/js/config.js (APPS_SCRIPT_URL).
 *
 * The spreadsheet itself is NEVER shared. Visitors only talk to this
 * script, which exposes a fixed set of actions:
 *   public   – read projects, commercial listings and published posts
 *   addLead  – submit an enquiry (validated, rate-limited, write-only)
 *   login    – exchange the admin password for a 6-hour session token
 *   all / save / bulkSave / remove / upload – admin only (token required)
 *
 * The admin password is stored as a salted SHA-256 hash in Script
 * Properties (set it from the sheet menu: Website Admin → Set admin password).
 * See README.md → "Google Sheets setup" for step-by-step instructions.
 */

var SCHEMA = {
  projects: ['id', 'title', 'slug', 'location', 'stage', 'status_label', 'rera_no', 'plot_size', 'carpet_area', 'config', 'price',
    'description', 'img', 'images', 'lat', 'lng', 'completed_year', 'sort_order', 'sold_at', 'created_at'],
  commercial: ['id', 'title', 'type', 'area', 'size', 'img', 'sort_order', 'created_at'],
  posts: ['id', 'slug', 'title', 'category', 'author', 'excerpt', 'content', 'cover', 'read_time', 'published',
    'published_at', 'created_at'],
  leads: ['id', 'created_at', 'status', 'name', 'phone', 'email', 'interest', 'project', 'config', 'budget', 'location',
    'visit_date', 'message', 'source', 'utm']
};
var TYPES = { images: 'json', utm: 'json', lat: 'num', lng: 'num', sort_order: 'num', published: 'bool' };
var PUBLIC_COLLECTIONS = ['projects', 'commercial', 'posts'];
var TOKEN_TTL_SECONDS = 6 * 60 * 60;          // admin session length (CacheService max)
var PUBLIC_CACHE_SECONDS = 300;                // server-side cache of public data
var MAX_LEADS_PER_10_MIN = 40;                 // basic spam protection
var MAX_CELL = 49000;                          // Google Sheets cell limit is 50,000 chars
var ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/* ===================================================================
 * Web app entry points
 * ================================================================= */
function doGet() {
  // Intentionally reveals nothing.
  return ContentService.createTextOutput('OK');
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e && e.postData && e.postData.contents || '{}');
  } catch (err) {
    return respond_({ ok: false, error: 'Bad request' });
  }
  try {
    return respond_({ ok: true, result: route_(req) });
  } catch (err) {
    return respond_({ ok: false, error: err.message || String(err), code: err.code || null });
  }
}

function route_(req) {
  switch (req.action) {
    case 'public': return getPublic_();
    case 'addLead': return addLead_(req.lead || {});
    case 'login': return login_(req.password);
    case 'check': requireAdmin_(req.token); return true;
    case 'logout': if (req.token) CacheService.getScriptCache().remove(tokenKey_(req.token)); return true;
    case 'all': requireAdmin_(req.token); return readAll_();
    case 'save': requireAdmin_(req.token); return afterContentChange_(req.collection, withLock_(function () { return saveRows_(collection_(req.collection), [req.row || {}])[0]; }));
    case 'bulkSave': requireAdmin_(req.token); return afterContentChange_(req.collection, withLock_(function () { return saveRows_(collection_(req.collection), req.rows || []).length; }));
    case 'remove': requireAdmin_(req.token); return afterContentChange_(req.collection, withLock_(function () { return removeRow_(collection_(req.collection), req.id); }));
    case 'upload': requireAdmin_(req.token); return upload_(req.data, req.mime, req.name);
    default: throw new Error('Unknown action');
  }
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(message, code) {
  var err = new Error(message);
  if (code) err.code = code;
  throw err;
}

function collection_(name) {
  if (!SCHEMA[name]) fail_('Unknown collection');
  return name;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var out = fn();
    invalidatePublicCache_();
    return out;
  } finally {
    lock.releaseLock();
  }
}

/* ===================================================================
 * Sheet helpers
 * ================================================================= */
function sheet_(name) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name);
  var headers = SCHEMA[name];
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setNumberFormat('@').setValues([headers]);
    sh.setFrozenRows(1);
    return sh;
  }
  // Add any missing columns (keeps older sheets compatible after updates)
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var current = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var missing = headers.filter(function (h) { return current.indexOf(h) === -1; });
  if (missing.length) {
    var start = current.filter(String).length + 1;
    sh.getRange(1, start, 1, missing.length).setNumberFormat('@').setValues([missing]);
  }
  return sh;
}

function headers_(sh) {
  return sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
}

function decode_(key, v) {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  var t = TYPES[key];
  if (t === 'json') { try { return JSON.parse(v); } catch (e) { return null; } }
  if (t === 'num') { var n = Number(v); return isNaN(n) ? null : n; }
  if (t === 'bool') return v === true || String(v).toLowerCase() === 'true';
  return String(v);
}

function encode_(key, v) {
  if (v === null || v === undefined) return '';
  var t = TYPES[key];
  var s;
  if (t === 'json') s = JSON.stringify(v);
  else if (t === 'bool') s = v ? 'true' : 'false';
  else s = String(v);
  if (s.length > MAX_CELL) s = s.slice(0, MAX_CELL);
  // Stop spreadsheet formula injection (=, +, -, @ at the start of a cell)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

function read_(name) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var head = headers_(sh);
  var values = sh.getRange(2, 1, last - 1, head.length).getValues();
  return values.filter(function (r) { return r[0] !== ''; }).map(function (r) {
    var o = {};
    head.forEach(function (h, i) { if (h) o[h] = decode_(h, r[i]); });
    return o;
  });
}

function saveRows_(name, rows) {
  var sh = sheet_(name);
  var head = headers_(sh);
  var last = sh.getLastRow();
  var ids = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  var saved = [];
  rows.forEach(function (row) {
    if (!row.id) row.id = Utilities.getUuid();
    if (!row.created_at) row.created_at = new Date().toISOString();
    var idx = ids.indexOf(String(row.id));
    var rowNum;
    if (idx >= 0) {
      rowNum = idx + 2;
      // Merge with the stored row so fields not sent are kept
      var existing = sh.getRange(rowNum, 1, 1, head.length).getValues()[0];
      head.forEach(function (h, i) { if (!(h in row)) row[h] = decode_(h, existing[i]); });
    } else {
      ids.push(String(row.id));
      rowNum = ids.length + 1;
    }
    var values = head.map(function (h) { return h ? encode_(h, row[h]) : ''; });
    sh.getRange(rowNum, 1, 1, head.length).setNumberFormat('@').setValues([values]);
    var out = {};
    head.forEach(function (h, i) { if (h) out[h] = decode_(h, values[i].replace(/^'/, '')); });
    saved.push(out);
  });
  return saved;
}

function removeRow_(name, id) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2 || !id) return false;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); });
  var idx = ids.indexOf(String(id));
  if (idx < 0) return false;
  sh.deleteRow(idx + 2);
  return true;
}

function readAll_() {
  var out = {};
  Object.keys(SCHEMA).forEach(function (c) { out[c] = read_(c); });
  return out;
}

/* ===================================================================
 * Public data (cached)
 * ================================================================= */
function getPublic_() {
  var cache = CacheService.getScriptCache();
  var meta = cache.get('pub_meta');
  if (meta) {
    var n = Number(meta);
    var keys = [];
    for (var i = 0; i < n; i++) keys.push('pub_' + i);
    var parts = cache.getAll(keys);
    if (keys.every(function (k) { return parts[k] != null; })) {
      return JSON.parse(keys.map(function (k) { return parts[k]; }).join(''));
    }
  }
  var data = {};
  PUBLIC_COLLECTIONS.forEach(function (c) { data[c] = read_(c); });
  data.posts = data.posts.filter(function (p) { return p.published !== false; });
  var json = JSON.stringify(data);
  var CHUNK = 90000; // CacheService values are limited to 100 KB
  var chunks = {};
  var count = Math.ceil(json.length / CHUNK);
  if (count <= 20) {
    for (var j = 0; j < count; j++) chunks['pub_' + j] = json.slice(j * CHUNK, (j + 1) * CHUNK);
    chunks.pub_meta = String(count);
    cache.putAll(chunks, PUBLIC_CACHE_SECONDS);
  }
  return data;
}

function invalidatePublicCache_() {
  CacheService.getScriptCache().remove('pub_meta');
}

/* ===================================================================
 * Leads (public, write-only)
 * ================================================================= */
function addLead_(lead) {
  var cache = CacheService.getScriptCache();
  var count = Number(cache.get('lead_count') || 0);
  if (count >= MAX_LEADS_PER_10_MIN) fail_('We are receiving many enquiries right now. Please try again in a few minutes or call us.');
  cache.put('lead_count', String(count + 1), 600);

  var str = function (v, max) { return v == null ? '' : String(v).trim().slice(0, max); };
  var name = str(lead.name, 120);
  var phone = str(lead.phone, 20);
  var email = str(lead.email, 200);
  if (name.length < 2) fail_('Please enter your name.');
  if (!/^[+\d][\d\s-]{7,19}$/.test(phone)) fail_('Please enter a valid phone number.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail_('Please enter a valid email address.');

  var utm = null;
  if (lead.utm && typeof lead.utm === 'object') {
    utm = {};
    Object.keys(lead.utm).slice(0, 10).forEach(function (k) { utm[str(k, 40)] = str(lead.utm[k], 200); });
  }
  var visit = str(lead.visit_date, 10);
  var row = {
    id: Utilities.getUuid(),
    created_at: new Date().toISOString(),
    status: 'New',
    name: name,
    phone: phone,
    email: email || null,
    interest: str(lead.interest, 120) || null,
    project: str(lead.project, 160) || null,
    config: str(lead.config, 60) || null,
    budget: str(lead.budget, 60) || null,
    location: str(lead.location, 120) || null,
    visit_date: /^\d{4}-\d{2}-\d{2}$/.test(visit) ? visit : null,
    message: str(lead.message, 3000) || null,
    source: str(lead.source, 120) || null,
    utm: utm
  };
  withLock_(function () { saveRows_('leads', [row]); });
  notifyNewLead_(row);
  return true;
}

function notifyNewLead_(row) {
  var to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  if (!to) return;
  try {
    var lines = ['Name: ' + row.name, 'Phone: ' + row.phone];
    ['email', 'interest', 'project', 'config', 'budget', 'location', 'visit_date', 'message', 'source'].forEach(function (k) {
      if (row[k]) lines.push(k.replace('_', ' ') + ': ' + row[k]);
    });
    MailApp.sendEmail(to, 'New website enquiry: ' + row.name + (row.project ? ' – ' + row.project : ''), lines.join('\n'));
  } catch (e) {
    console.error(e);
  }
}

/* ===================================================================
 * Admin authentication
 * ================================================================= */
function hash_(salt, password) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function login_(password) {
  var props = PropertiesService.getScriptProperties();
  var stored = props.getProperty('ADMIN_PASSWORD_HASH');
  var salt = props.getProperty('ADMIN_PASSWORD_SALT');
  if (!stored || !salt) fail_('Admin password is not set yet. Open the Google Sheet and use Website Admin → Set admin password.');

  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('login_fail') || 0);
  if (fails >= 5) Utilities.sleep(Math.min(fails, 10) * 1000); // slow down password guessing

  if (typeof password !== 'string' || hash_(salt, password) !== stored) {
    cache.put('login_fail', String(fails + 1), 900);
    fail_('Incorrect password.');
  }
  cache.remove('login_fail');
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put(tokenKey_(token), '1', TOKEN_TTL_SECONDS);
  return token;
}

// Session keys include an "epoch" so every session can be revoked at once.
function tokenKey_(token) {
  var epoch = PropertiesService.getScriptProperties().getProperty('SESSION_EPOCH') || '0';
  return 'tok_' + epoch + '_' + token;
}

function requireAdmin_(token) {
  if (!token || typeof token !== 'string' || !CacheService.getScriptCache().get(tokenKey_(token))) fail_('Your session has expired. Please sign in again.', 'AUTH');
}

/* ===================================================================
 * Image uploads → private Drive folder, files viewable by link
 * ================================================================= */
function mediaFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('MEDIA_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* recreate below */ }
  }
  var folder = DriveApp.createFolder('Website Media');
  props.setProperty('MEDIA_FOLDER_ID', folder.getId());
  return folder;
}

function upload_(base64, mime, name) {
  if (ALLOWED_MIME.indexOf(mime) === -1) fail_('Only JPG, PNG, WebP or GIF images are allowed.');
  if (!base64 || base64.length > 11000000) fail_('Image is too large (max 8 MB).');
  var safeName = String(name || 'image').replace(/[^\w.\-]+/g, '-').slice(0, 80);
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, Date.now() + '-' + safeName);
  var file = mediaFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://lh3.googleusercontent.com/d/' + file.getId();
}

/* ===================================================================
 * Automatic website rebuild (pre-rendered SEO pages)
 * When content changes, ping the hosting provider's "build hook" URL
 * about a minute later, so several quick edits cause a single rebuild.
 * ================================================================= */
function afterContentChange_(collection, result) {
  if (collection !== 'leads') scheduleRebuild_();
  return result;
}

function scheduleRebuild_() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('BUILD_HOOK_URL')) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('rebuild_pending')) return;
  cache.put('rebuild_pending', '1', 300);
  try {
    ScriptApp.newTrigger('runScheduledRebuild').timeBased().after(60 * 1000).create();
  } catch (e) {
    // Trigger quota or permission problem: rebuild immediately instead
    cache.remove('rebuild_pending');
    pingBuildHook_();
  }
}

function runScheduledRebuild() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runScheduledRebuild') ScriptApp.deleteTrigger(t);
  });
  CacheService.getScriptCache().remove('rebuild_pending');
  pingBuildHook_();
}

function pingBuildHook_() {
  var url = PropertiesService.getScriptProperties().getProperty('BUILD_HOOK_URL');
  if (!url) return false;
  var res = UrlFetchApp.fetch(url, { method: 'post', muteHttpExceptions: true, contentType: 'application/json', payload: '{}' });
  return res.getResponseCode() < 300;
}

function setBuildHookPrompt() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Website rebuild hook', 'Paste the build hook URL from your hosting provider (Netlify / Cloudflare Pages / Vercel). Leave empty to turn off.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var url = res.getResponseText().trim();
  var props = PropertiesService.getScriptProperties();
  if (url && !/^https:\/\//.test(url)) { ui.alert('The URL must start with https://'); return; }
  if (url) props.setProperty('BUILD_HOOK_URL', url); else props.deleteProperty('BUILD_HOOK_URL');
  ui.alert(url ? 'Saved. The website will rebuild about a minute after each change in the admin panel.' : 'Automatic rebuilds turned off.');
}

function rebuildNow() {
  var ok = pingBuildHook_();
  SpreadsheetApp.getUi().alert(ok ? 'Rebuild started. The website will update in a few minutes.' : 'No build hook set, or the hook returned an error.');
}

/* ===================================================================
 * Sheet menu (only visible to people who can open the private sheet)
 * ================================================================= */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Website Admin')
    .addItem('1. Create / repair tabs', 'setupSheets')
    .addItem('2. Set admin password', 'setAdminPasswordPrompt')
    .addItem('3. Set lead notification email', 'setNotifyEmailPrompt')
    .addItem('4. Set website rebuild hook', 'setBuildHookPrompt')
    .addSeparator()
    .addItem('Rebuild website now', 'rebuildNow')
    .addItem('Sign out all admin sessions', 'signOutEveryone')
    .addToUi();
}

function setupSheets() {
  Object.keys(SCHEMA).forEach(sheet_);
  var ss = SpreadsheetApp.getActive();
  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
  mediaFolder_();
  SpreadsheetApp.getUi().alert('Tabs are ready: projects, commercial, posts, leads.\nA private Drive folder "Website Media" was created for uploads.');
}

function setAdminPasswordPrompt() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Set admin password', 'Enter a strong password (at least 10 characters). It is stored only as a salted hash.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var pw = res.getResponseText();
  if (pw.length < 10) { ui.alert('Password must be at least 10 characters.'); return; }
  setAdminPassword_(pw);
  ui.alert('Admin password saved. Any existing admin sessions were signed out.');
}

function setNotifyEmailPrompt() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Lead notifications', 'Email address to notify for every new enquiry (leave empty to turn off):', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var email = res.getResponseText().trim();
  var props = PropertiesService.getScriptProperties();
  if (email) props.setProperty('NOTIFY_EMAIL', email); else props.deleteProperty('NOTIFY_EMAIL');
  ui.alert(email ? 'New enquiries will be emailed to ' + email : 'Lead notifications turned off.');
}

function signOutEveryone() {
  PropertiesService.getScriptProperties().setProperty('SESSION_EPOCH', String(Date.now()));
  SpreadsheetApp.getUi().alert('All admin sessions have been signed out. Change the password too if you think it was leaked.');
}

function setAdminPassword_(pw) {
  var salt = Utilities.getUuid();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_PASSWORD_SALT', salt);
  props.setProperty('ADMIN_PASSWORD_HASH', hash_(salt, pw));
  props.setProperty('SESSION_EPOCH', String(Date.now())); // new password signs out old sessions
}
