/**
 * Dispatch admin API. Called from Admin.html with google.script.run.
 * Public functions are named admin*; helpers ending in _ stay private to the script.
 */

const BLOCK_TYPES = ['heading', 'text', 'button', 'image', 'divider', 'spacer'];
const STEP_TEMPLATES = ['welcome', 'activation', 'trial-ending'];
const EDITABLE_SETTINGS = ['COMPANY_NAME', 'COMPANY_ADDRESS', 'FROM_NAME', 'REPLY_TO', 'PRODUCT_URL', 'WEBAPP_URL', 'DAILY_SEND_CAP', 'DOUBLE_OPT_IN'];
const TEMPLATES_SHEET = 'Templates';
const PAGE_SIZE = 25;
const IMPORT_LIMIT = 5000;

/* ----------------------------------------------------------------------------
 * Schema: creates missing sheets and appends missing columns to existing ones.
 * Safe to run any time, so upgrades do not need a manual re-setup.
 * -------------------------------------------------------------------------- */

function ensureSchema_() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(HEADERS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
      return;
    }
    const current = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const missing = HEADERS[name].filter(h => !current.includes(h));
    if (missing.length) {
      sh.getRange(1, current.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    }
  });
}

/* ----------------------------------------------------------------------------
 * Helpers
 * -------------------------------------------------------------------------- */

function lockedOrThrow_(fn) {
  const result = withLock_(fn);
  if (result === null) throw new Error('The sheet is busy. Try again in a moment.');
  return result;
}

function fmt_(v) {
  if (v instanceof Date) return isNaN(v) ? '' : Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  return v == null ? '' : String(v);
}

function pct_(n, d) {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

function safeUrl_(u) {
  const s = String(u == null ? '' : u).trim();
  return /^https?:\/\/[^\s"<>]+$/i.test(s) ? s : '';
}

function findCampaign_(name) {
  const camps = readObjects_(SHEET_NAMES.campaigns);
  const row = camps.rows.find(c => String(c.name).trim() === String(name || '').trim());
  if (!row) throw new Error('Campaign not found.');
  return Object.assign({}, row, { __sheet: camps.sheet, __headers: camps.headers });
}

function campaignSummary_(c) {
  return {
    name: fmt_(c.name),
    subject: fmt_(c.subject),
    preheader: fmt_(c.preheader),
    segment_plan: fmt_(c.segment_plan) || 'all',
    status: fmt_(c.status) || 'draft',
    sent_count: Number(c.sent_count) || 0,
    scheduled_at: fmt_(c.scheduled_at),
    sent_at: fmt_(c.sent_at),
  };
}

/** Blocks stored as JSON. Older campaigns without blocks fall back to their plain-text body. */
function blocksOf_(c) {
  try {
    const parsed = JSON.parse(c.blocks || '');
    if (Array.isArray(parsed)) return parsed;
  } catch (err) { /* fall through */ }
  const plain = String(c.body_html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .trim();
  return plain ? [{ type: 'text', text: plain }] : [];
}

function parseBlocksJson_(s) {
  try {
    const parsed = JSON.parse(s || '');
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

/* ----------------------------------------------------------------------------
 * Overview and form options
 * -------------------------------------------------------------------------- */

function adminGetOverview() {
  ensureSchema_();
  const stats = getDashboardStats();
  const recent = readObjects_(SHEET_NAMES.logs).rows.slice(-12).reverse().map(l => ({
    time: fmt_(l.timestamp), type: fmt_(l.type), email: fmt_(l.email), status: fmt_(l.status),
  }));
  return Object.assign(stats, { recent });
}

function adminGetInfo() {
  ensureSchema_();
  const settings = getSettings_();
  const counts = {};
  let active = 0;
  readObjects_(SHEET_NAMES.subscribers).rows.forEach(s => {
    if (String(s.status).toLowerCase() !== 'active') return;
    active++;
    const plan = String(s.plan || 'free').trim().toLowerCase() || 'free';
    counts[plan] = (counts[plan] || 0) + 1;
  });
  const plans = Object.keys(counts).sort().map(p => ({ plan: p, count: counts[p] }));
  return {
    active,
    plans,
    stepTemplates: STEP_TEMPLATES,
    webAppUrl: settings.WEBAPP_URL || ScriptApp.getService().getUrl(),
  };
}

/* ----------------------------------------------------------------------------
 * Audience
 * -------------------------------------------------------------------------- */

function adminListContacts(opts) {
  opts = opts || {};
  const q = String(opts.q || '').toLowerCase().trim();
  const status = String(opts.status || '').toLowerCase().trim();
  const page = Math.max(1, Number(opts.page) || 1);

  const matches = readObjects_(SHEET_NAMES.subscribers).rows
    .filter(r => String(r.email || '').trim())
    .filter(r => !status || String(r.status).toLowerCase() === status)
    .filter(r => !q || [r.email, r.first_name, r.company].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (toMillis_(b.signup_at) || 0) - (toMillis_(a.signup_at) || 0));

  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = matches.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).map(r => ({
    email: fmt_(r.email),
    first_name: fmt_(r.first_name),
    company: fmt_(r.company),
    plan: fmt_(r.plan),
    status: fmt_(r.status),
    source: fmt_(r.source),
    signup_at: fmt_(r.signup_at),
  }));
  return { rows, total: matches.length, page: current, pages };
}

function adminAddContact(input) {
  const settings = getSettings_();
  const email = normalizeEmail_(input && input.email);
  if (!isValidEmail_(email)) throw new Error('Enter a valid email address.');

  return lockedOrThrow_(() => {
    const subs = readObjects_(SHEET_NAMES.subscribers);
    if (subs.rows.some(r => normalizeEmail_(r.email) === email)) {
      throw new Error('That address is already in your audience.');
    }
    // Admins must confirm they hold consent. Without it, the contact waits as pending.
    const consent = !!input.consent;
    const doubleOptIn = String(settings.DOUBLE_OPT_IN).toLowerCase() === 'yes';
    const status = (consent || !doubleOptIn) ? 'active' : 'pending';
    const sub = {
      email,
      first_name: clean_(input.first_name),
      company: clean_(input.company),
      plan: clean_(input.plan) || 'free',
      status,
      source: 'admin',
      signup_at: new Date(),
      drip_step: 0,
      last_sent_at: '',
    };
    subs.sheet.appendRow(subs.headers.map(h => (sub[h] !== undefined ? sub[h] : '')));
    logEvent_('signup', email, 'admin', 'ok', status);
    if (status === 'pending') {
      sendEmail_(sub, 'Please confirm your subscription', 'double-opt-in', settings, {
        type: 'confirm', ref: 'double-opt-in',
        extra: { confirmUrl: buildActionUrl_('confirm', email, settings) },
      });
    }
    return 'Contact added as ' + status + '.';
  });
}

/** Minimal RFC 4180 CSV parser: quoted fields, doubled quotes, CRLF or LF. */
function parseCsv_(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

function adminImportContacts(csvText, consent) {
  const rows = parseCsv_(String(csvText || ''));
  if (!rows.length) throw new Error('Paste CSV with an email column first.');
  if (rows.length > IMPORT_LIMIT + 1) throw new Error('Import at most ' + IMPORT_LIMIT + ' rows at a time.');

  let header = rows[0].map(h => String(h).trim().toLowerCase());
  let start = 1;
  if (!header.includes('email')) {
    header = ['email', 'first_name', 'company', 'plan'];
    start = 0;
  }
  const at = name => header.indexOf(name);
  const settings = getSettings_();
  const doubleOptIn = String(settings.DOUBLE_OPT_IN).toLowerCase() === 'yes';

  return lockedOrThrow_(() => {
    const subs = readObjects_(SHEET_NAMES.subscribers);
    const known = new Set(subs.rows.map(r => normalizeEmail_(r.email)));
    const result = { added: 0, skipped: 0, invalid: 0 };

    for (let i = start; i < rows.length; i++) {
      const get = name => (at(name) >= 0 ? String(rows[i][at(name)] || '') : '');
      const email = normalizeEmail_(get('email'));
      if (!isValidEmail_(email)) { result.invalid++; continue; }
      if (known.has(email)) { result.skipped++; continue; }
      known.add(email);
      // Imported contacts without consent stay pending and are never emailed automatically.
      const status = consent ? 'active' : (doubleOptIn ? 'pending' : 'active');
      const sub = {
        email,
        first_name: clean_(get('first_name')),
        company: clean_(get('company')),
        plan: clean_(get('plan')) || 'free',
        status,
        source: 'import',
        signup_at: new Date(),
        drip_step: 0,
        last_sent_at: '',
      };
      subs.sheet.appendRow(subs.headers.map(h => (sub[h] !== undefined ? sub[h] : '')));
      result.added++;
    }
    logEvent_('import', '', 'admin', 'ok', JSON.stringify(result));
    return result;
  });
}

function adminSetContactStatus(email, status) {
  const allowed = ['active', 'pending', 'unsubscribed'];
  const target = normalizeEmail_(email);
  const next = String(status || '').toLowerCase();
  if (!allowed.includes(next)) throw new Error('Unknown status.');
  return lockedOrThrow_(() => {
    const subs = readObjects_(SHEET_NAMES.subscribers);
    const row = subs.rows.find(r => normalizeEmail_(r.email) === target);
    if (!row) throw new Error('Contact not found.');
    updateFields_(subs.sheet, subs.headers, row.__row, { status: next });
    logEvent_('admin_status', target, '', 'ok', next);
    return 'Status updated.';
  });
}

function adminRemoveContact(email) {
  const target = normalizeEmail_(email);
  return lockedOrThrow_(() => {
    const subs = readObjects_(SHEET_NAMES.subscribers);
    const row = subs.rows.find(r => normalizeEmail_(r.email) === target);
    if (!row) throw new Error('Contact not found.');
    subs.sheet.deleteRow(row.__row);
    logEvent_('admin_remove', target, '', 'ok', '');
    return 'Contact removed.';
  });
}

/* ----------------------------------------------------------------------------
 * Campaigns and the block builder
 * -------------------------------------------------------------------------- */

function sanitizeBlocks_(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 60).map(b => {
    const type = String((b && b.type) || '');
    if (!BLOCK_TYPES.includes(type)) return null;
    const text = String(b.text == null ? '' : b.text).slice(0, 5000);
    if (type === 'heading') return { type, text: text.slice(0, 200) };
    if (type === 'text') return { type, text };
    if (type === 'button') return { type, text: text.slice(0, 60) || 'Learn more', url: safeUrl_(b.url) };
    if (type === 'image') return { type, url: safeUrl_(b.url), alt: String(b.alt || '').slice(0, 200) };
    if (type === 'spacer') return { type, height: Math.min(120, Math.max(8, Number(b.height) || 24)) };
    return { type };
  }).filter(Boolean);
}

/** Email-safe HTML for each block. Merge tags such as {{first_name}} are kept for send time. */
function renderBlocks_(blocks) {
  return blocks.map(b => {
    switch (b.type) {
      case 'heading':
        return '<h2 style="font-family:Georgia,\'Times New Roman\',serif;font-weight:normal;font-size:24px;line-height:1.3;color:#1a1a1a;margin:0 0 16px;">' +
          escapeHtml_(b.text) + '</h2>';
      case 'text':
        return b.text.split(/\n\s*\n/).map(par =>
          '<p style="margin:0 0 16px;">' + escapeHtml_(par.trim()).replace(/\n/g, '<br>') + '</p>'
        ).join('');
      case 'button':
        return '<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:26px auto;"><tr>' +
          '<td style="background:#1a1a1a;"><a href="' + escapeHtml_(b.url || '#') + '" style="display:inline-block;padding:14px 34px;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:2.5px;text-transform:uppercase;">' +
          escapeHtml_(b.text) + '</a></td></tr></table>';
      case 'image':
        return b.url ? '<img src="' + escapeHtml_(b.url) + '" alt="' + escapeHtml_(b.alt) +
          '" width="520" style="display:block;max-width:100%;height:auto;margin:0 auto 16px;border:0;">' : '';
      case 'divider':
        return '<hr style="border:0;border-top:1px solid #ebe5d8;margin:28px 0;">';
      case 'spacer':
        return '<div style="height:' + b.height + 'px;line-height:' + b.height + 'px;font-size:0;">&nbsp;</div>';
      default:
        return '';
    }
  }).join('\n');
}

function adminListCampaigns() {
  ensureSchema_();
  return readObjects_(SHEET_NAMES.campaigns).rows
    .filter(c => String(c.name || '').trim())
    .map(campaignSummary_);
}

function adminGetCampaign(name) {
  ensureSchema_();
  const c = findCampaign_(name);
  return Object.assign(campaignSummary_(c), { blocks: blocksOf_(c) });
}

function adminSaveCampaign(obj) {
  ensureSchema_();
  const name = clean_(obj && obj.name).trim();
  if (!name) throw new Error('Give the campaign a name.');
  const blocks = sanitizeBlocks_(obj.blocks);
  const fields = {
    subject: clean_(obj.subject),
    preheader: clean_(obj.preheader),
    segment_plan: clean_(obj.segment_plan) || 'all',
    template: 'newsletter',
    headline: '',
    body_html: renderBlocks_(blocks),
    blocks: JSON.stringify(blocks),
  };

  return lockedOrThrow_(() => {
    const camps = readObjects_(SHEET_NAMES.campaigns);
    const row = camps.rows.find(c => String(c.name).trim() === name);
    if (row) {
      const status = String(row.status).toLowerCase();
      if (status === 'sent' || status === 'sending') {
        throw new Error('This campaign has been sent, so it is read-only. Save a template or create a new campaign.');
      }
      updateFields_(camps.sheet, camps.headers, row.__row, fields);
    } else {
      const f = Object.assign({ name, status: 'draft', sent_count: 0 }, fields);
      camps.sheet.appendRow(camps.headers.map(h => (f[h] !== undefined ? f[h] : '')));
    }
    return 'Saved.';
  });
}

/** Actions: send (now), schedule (ISO time), pause, resume. */
function adminCampaignAction(name, action, when) {
  const result = lockedOrThrow_(() => {
    const camps = readObjects_(SHEET_NAMES.campaigns);
    const row = camps.rows.find(c => String(c.name).trim() === String(name || '').trim());
    if (!row) throw new Error('Campaign not found.');
    const status = String(row.status).toLowerCase();
    const update = {};
    let message;

    if (action === 'send') {
      if (status === 'sent' || status === 'sending') throw new Error('This campaign is already sending or sent.');
      update.status = 'scheduled';
      update.scheduled_at = new Date();
      message = 'Queued to send now.';
    } else if (action === 'schedule') {
      const t = toMillis_(when);
      if (t === null || t < Date.now() - 60000) throw new Error('Pick a time in the future.');
      update.status = 'scheduled';
      update.scheduled_at = new Date(t);
      message = 'Scheduled.';
    } else if (action === 'pause') {
      if (status !== 'scheduled' && status !== 'sending') throw new Error('Only scheduled or sending campaigns can be paused.');
      update.status = 'paused';
      message = 'Paused.';
    } else if (action === 'resume') {
      if (status !== 'paused') throw new Error('Only paused campaigns can be resumed.');
      update.status = 'scheduled';
      update.scheduled_at = '';
      message = 'Resumed.';
    } else {
      throw new Error('Unknown action.');
    }

    updateFields_(camps.sheet, camps.headers, row.__row, update);
    return { message, sendNow: action === 'send' };
  });

  if (result.sendNow) return result.message + ' ' + runAutomation();
  return result.message;
}

/** Shared by test sends and the preview: the campaign's email body for one subscriber. */
function campaignExtra_(c, sub, settings, track) {
  return {
    headline: merge_(c.headline, sub, false),
    bodyHtml: merge_(c.body_html, sub, true),
    preheader: merge_(c.preheader, sub, false),
    campaignName: String(c.name || ''),
    track: !!track,
  };
}

function adminSendTest(name, email) {
  const addr = normalizeEmail_(email);
  if (!isValidEmail_(addr)) throw new Error('Enter a valid test address.');
  const settings = getSettings_();
  const camp = findCampaign_(name);
  const sub = { email: addr, first_name: 'Test', company: 'Your company', plan: 'pro', status: 'active' };
  const res = sendEmail_(sub, camp.subject, camp.template || 'newsletter', settings, {
    type: 'test', ref: 'test:' + camp.name, extra: campaignExtra_(camp, sub, settings, false),
  });
  return res.ok ? 'Test sent to ' + addr + '.' : 'Test failed. Check the Logs sheet.';
}

function adminPreview(payload) {
  const settings = getSettings_();
  const blocks = sanitizeBlocks_((payload && payload.blocks) || []);
  const sub = { email: 'preview@example.com', first_name: 'Jane', company: 'Northwind', plan: 'pro' };
  const c = {
    name: 'preview',
    headline: '',
    body_html: renderBlocks_(blocks),
    preheader: (payload && payload.preheader) || '',
  };
  return renderEmail_('newsletter', sub, settings, campaignExtra_(c, sub, settings, false));
}

/* ----------------------------------------------------------------------------
 * Tracking: signed open pixel and click redirect (served from doGet)
 * -------------------------------------------------------------------------- */

function hmac_(payload, settings) {
  if (!settings.UNSUBSCRIBE_SECRET) throw new Error('UNSUBSCRIBE_SECRET is empty. Run Set up workbook.');
  const sig = Utilities.computeHmacSha256Signature(payload, settings.UNSUBSCRIBE_SECRET);
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');
}

function trackUrl_(kind, campaign, email, url, settings) {
  const base = settings.WEBAPP_URL || ScriptApp.getService().getUrl();
  const addr = normalizeEmail_(email);
  const payload = [kind, campaign, addr, url || ''].join('|');
  let link = base + '?action=' + kind +
    '&c=' + encodeURIComponent(campaign) +
    '&e=' + encodeURIComponent(addr) +
    '&t=' + hmac_('track|' + payload, settings);
  if (url) link += '&u=' + encodeURIComponent(url);
  return link;
}

function trackLinks_(html, campaign, email, settings) {
  return html.replace(/href="(https?:\/\/[^"]+)"/g, (m, escaped) => {
    const url = escaped.replace(/&amp;/g, '&');
    return 'href="' + escapeHtml_(trackUrl_('click', campaign, email, url, settings)) + '"';
  });
}

function openPixel_(campaign, email, settings) {
  return '<img src="' + escapeHtml_(trackUrl_('open', campaign, email, '', settings)) +
    '" width="1" height="1" alt="" style="display:block;border:0;">';
}

function handleTracking_(action, p) {
  const settings = getSettings_();
  const campaign = String(p.c || '');
  const email = normalizeEmail_(p.e);
  const url = String(p.u || '');
  const payload = [action, campaign, email, action === 'click' ? url : ''].join('|');
  const valid = !!campaign && !!email && String(p.t || '') === hmac_('track|' + payload, settings);

  if (action === 'open') {
    if (valid) logEvent_('open', email, campaign, 'ok', '');
    return ContentService.createTextOutput('');
  }
  if (!valid) return htmlPage_('Link not valid', 'This link is invalid or has expired.');
  if (!safeUrl_(url)) return htmlPage_('Link not valid', 'The destination is not a web address.');

  logEvent_('click', email, campaign, 'ok', url);
  return HtmlService.createHtmlOutput(
    '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=' + escapeHtml_(url) + '">' +
    '<a href="' + escapeHtml_(url) + '">Continue</a>'
  ).setTitle('Redirecting');
}

/* ----------------------------------------------------------------------------
 * Reports
 * -------------------------------------------------------------------------- */

function adminGetReport(name) {
  const target = String(name || '').trim();
  const logs = readObjects_(SHEET_NAMES.logs).rows.filter(l => String(l.ref) === target);
  const campaignLogs = logs.filter(l => l.type === 'campaign');
  const sent = campaignLogs.filter(l => l.status === 'sent').length;
  const bounced = campaignLogs.filter(l => l.status === 'bounced').length;
  const errors = campaignLogs.filter(l => l.status === 'error').length;

  const openers = new Set(logs.filter(l => l.type === 'open').map(l => normalizeEmail_(l.email)));
  const clickLogs = logs.filter(l => l.type === 'click');
  const clickers = new Set(clickLogs.map(l => normalizeEmail_(l.email)));

  const perLink = {};
  clickLogs.forEach(l => {
    const u = String(l.message || '');
    perLink[u] = (perLink[u] || 0) + 1;
  });
  const links = Object.keys(perLink)
    .map(u => ({ url: u, clicks: perLink[u] }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 8);

  return {
    name: target,
    sent,
    bounced,
    errors,
    uniqueOpens: openers.size,
    openRate: pct_(openers.size, sent),
    uniqueClicks: clickers.size,
    clickRate: pct_(clickers.size, sent),
    totalClicks: clickLogs.length,
    links,
  };
}

/* ----------------------------------------------------------------------------
 * Automations (the Sequences sheet, shown as a journey)
 * -------------------------------------------------------------------------- */

function adminListSteps() {
  ensureSchema_();
  return readObjects_(SHEET_NAMES.sequences).rows
    .filter(s => s.step !== '' && !isNaN(Number(s.step)))
    .map(s => ({
      step: Number(s.step),
      delay_days: Number(s.delay_days) || 0,
      subject: fmt_(s.subject),
      template: fmt_(s.template),
      active: isTrue_(s.active),
    }))
    .sort((a, b) => a.step - b.step);
}

function adminSaveStep(input) {
  const step = Number(input && input.step);
  if (!Number.isInteger(step) || step < 0 || step > 50) throw new Error('Step must be a whole number from 0 to 50.');
  const delay = Number(input.delay_days);
  if (!(delay >= 0 && delay <= 365)) throw new Error('Delay must be between 0 and 365 days.');
  const template = String(input.template || '').trim();
  if (!/^[a-z0-9-]+$/.test(template)) throw new Error('Template names use lowercase letters, numbers and hyphens.');
  const subject = clean_(input.subject);
  if (!subject) throw new Error('Add a subject line.');

  const fields = { step, delay_days: delay, subject, template, active: !!input.active };
  return lockedOrThrow_(() => {
    const seq = readObjects_(SHEET_NAMES.sequences);
    const row = seq.rows.find(r => Number(r.step) === step);
    if (row) {
      updateFields_(seq.sheet, seq.headers, row.__row, fields);
    } else {
      seq.sheet.appendRow(seq.headers.map(h => (fields[h] !== undefined ? fields[h] : '')));
    }
    return 'Step saved.';
  });
}

function adminDeleteStep(step) {
  const n = Number(step);
  return lockedOrThrow_(() => {
    const seq = readObjects_(SHEET_NAMES.sequences);
    const row = seq.rows.find(r => Number(r.step) === n);
    if (!row) throw new Error('Step not found.');
    seq.sheet.deleteRow(row.__row);
    return 'Step removed.';
  });
}

/* ----------------------------------------------------------------------------
 * Saved templates (block layouts you can reuse for new campaigns)
 * -------------------------------------------------------------------------- */

function adminListTemplates() {
  ensureSchema_();
  return readObjects_(TEMPLATES_SHEET).rows
    .filter(t => String(t.name || '').trim())
    .map(t => ({
      name: fmt_(t.name),
      blocks: parseBlocksJson_(t.blocks),
      updated_at: fmt_(t.updated_at),
    }));
}

function adminSaveTemplate(name, blocks) {
  const n = clean_(name).trim();
  if (!n) throw new Error('Give the template a name.');
  const data = JSON.stringify(sanitizeBlocks_(blocks));
  return lockedOrThrow_(() => {
    const t = readObjects_(TEMPLATES_SHEET);
    const row = t.rows.find(r => String(r.name).trim() === n);
    const f = { name: n, blocks: data, updated_at: new Date() };
    if (row) {
      updateFields_(t.sheet, t.headers, row.__row, f);
    } else {
      t.sheet.appendRow(t.headers.map(h => (f[h] !== undefined ? f[h] : '')));
    }
    return 'Template saved.';
  });
}

function adminDeleteTemplate(name) {
  const n = String(name || '').trim();
  return lockedOrThrow_(() => {
    const t = readObjects_(TEMPLATES_SHEET);
    const row = t.rows.find(r => String(r.name).trim() === n);
    if (!row) throw new Error('Template not found.');
    t.sheet.deleteRow(row.__row);
    return 'Template deleted.';
  });
}

/* ----------------------------------------------------------------------------
 * Settings
 * -------------------------------------------------------------------------- */

function adminGetSettings() {
  const s = getSettings_();
  const out = {
    webAppUrl: s.WEBAPP_URL || ScriptApp.getService().getUrl(),
    signupKey: s.SIGNUP_API_KEY,
  };
  EDITABLE_SETTINGS.forEach(k => { out[k] = s[k] || ''; });
  return out;
}

function adminSaveSettings(obj) {
  const cap = Number(obj.DAILY_SEND_CAP);
  if (obj.DAILY_SEND_CAP !== undefined && !(cap >= 1 && cap <= 100000)) throw new Error('Daily cap must be between 1 and 100,000.');
  if (obj.DOUBLE_OPT_IN !== undefined && !['yes', 'no'].includes(String(obj.DOUBLE_OPT_IN))) throw new Error('Double opt-in is yes or no.');
  if (obj.REPLY_TO && !isValidEmail_(String(obj.REPLY_TO).trim())) throw new Error('Reply-to must be an email address.');
  if (obj.PRODUCT_URL && !safeUrl_(obj.PRODUCT_URL)) throw new Error('Website must start with https://');
  if (obj.WEBAPP_URL && !safeUrl_(obj.WEBAPP_URL)) throw new Error('Web app URL must start with https://');

  return lockedOrThrow_(() => {
    const st = readObjects_(SHEET_NAMES.settings);
    EDITABLE_SETTINGS.forEach(k => {
      if (obj[k] === undefined) return;
      const value = clean_(obj[k]);
      const row = st.rows.find(r => String(r.key).trim() === k);
      if (row) {
        st.sheet.getRange(row.__row, 2).setValue(value);
      } else {
        st.sheet.appendRow([k, value]);
      }
    });
    return 'Settings saved.';
  });
}
