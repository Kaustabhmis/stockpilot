/**
 * ClientApi.gs
 * Server side of the client dashboard (ClientApp.html), served by the Web App's doGet().
 *
 * Every api* function:
 *   - takes the session token first and resolves it with requireSession_() (Security.gs),
 *   - only reads/writes rows whose Client ID equals the session's client,
 *   - returns plain JSON (no Date objects) as { ok: true, ... } or { ok: false, error, code }.
 * Business values (name, email) always come from the CLIENTS row, never from the browser,
 * so a client cannot create campaigns for another business.
 */

const MAX_UPLOAD_ROWS = 5000;
const CREATIVES_FOLDER_NAME = 'WhatsApp Campaign Creatives';

/** Serves the dashboard page. */
function serveClientApp_() {
  const html = typeof CLIENT_APP_HTML_ !== 'undefined'
    ? CLIENT_APP_HTML_                                            // single-file build (dist/Code.gs)
    : HtmlService.createHtmlOutputFromFile('ClientApp').getContent(); // multi-file project
  return HtmlService.createHtmlOutput(html)
    .setTitle(getConfig_().systemName)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT); // no embedding by other sites
}

/** Wraps an API handler: session check, error shaping, logging. */
function apiCall_(token, action, handler) {
  try {
    const session = requireSession_(token);
    const result = handler(session) || {};
    return Object.assign({ ok: true }, result);
  } catch (err) {
    if (err.code === 'AUTH') return { ok: false, code: 'AUTH', error: err.message };
    logEvent_(LOG_LEVEL.ERROR, 'API_' + action, { error: err.message, details: err.stack });
    return { ok: false, error: err.message || 'Something went wrong. Please try again.' };
  }
}

/* ============================== AUTH ============================== */

function apiLogin(email, accessCode) {
  try {
    const s = loginClient_(email, accessCode);
    return Object.assign({ ok: true, token: s.token }, buildBootstrap_(s.clientId));
  } catch (err) {
    return { ok: false, code: err.code || 'ERROR', error: err.code === 'AUTH' ? err.message : 'Sign-in failed. Please try again.' };
  }
}

function apiLogout(token) {
  logoutClient_(token);
  return { ok: true };
}

/* ============================== DATA ============================== */

function apiBootstrap(token) {
  return apiCall_(token, 'BOOTSTRAP', s => buildBootstrap_(s.clientId));
}

function buildBootstrap_(clientId) {
  const cfg = getConfig_(true);
  const client = findRow_(readTable_(SHEETS.CLIENTS), 'Client ID', clientId);
  const contacts = readTable_(SHEETS.CONTACTS).rows.filter(c => String(c['Client ID']) === clientId);
  const eligible = contacts.filter(c => isContactEligible_(c, clientId) && normalizePhoneNumber(c['Phone']));

  const lists = {};
  eligible.forEach(c => {
    String(c['Tags'] || '').split(/[,;|]/).map(t => t.trim()).filter(Boolean).forEach(t => {
      const key = t.toUpperCase();
      lists[key] = lists[key] || { name: t, count: 0 };
      lists[key].count++;
    });
  });

  return {
    profile: {
      clientId: clientId,
      businessName: String(client['Business Name'] || ''),
      email: String(client['Client Email'] || ''),
      phone: client['Business Phone'] ? '+' + normalizePhoneNumber(client['Business Phone']) : '',
      website: String(client['Website'] || ''),
    },
    settings: {
      timezone: cfg.timezone,
      today: todayKey_(),
      nowTime: nowInTz_('HH:mm'),
      ctaTextMaxLength: cfg.ctaTextMaxLength,
      maxImageMb: cfg.maxImageMb,
      maxUploadRows: MAX_UPLOAD_ROWS,
      imageCtaStyle: cfg.imageCtaStyle,
      defaultContactName: cfg.defaultContactName,
      defaultCountryCode: cfg.defaultCountryCode,
      variables: TEMPLATE_VARIABLES,
      systemName: cfg.systemName,
    },
    stats: {
      contacts: contacts.length,
      optedIn: eligible.length,
      optedOut: contacts.filter(c => !isYes_(c['Opt In'])).length,
    },
    lists: Object.keys(lists).sort().map(k => lists[k]),
    subscription: (function () {
      const ent = tenantEntitlement_(client, monthlySentByClient_(readTable_(SHEETS.MESSAGE_QUEUE).rows)[clientId] || 0);
      return {
        plan: ent.plan, validUntil: ent.validUntil, quota: ent.quota, used: ent.used, remaining: ent.remaining,
        canSend: ent.ok, reason: ent.reason, dedicatedNumber: ent.dedicatedNumber,
      };
    })(),
    campaigns: clientCampaignSummaries_(clientId),
  };
}

function clientCampaignSummaries_(clientId) {
  const campaigns = readTable_(SHEETS.CAMPAIGNS).rows.filter(c => String(c['Client ID']) === clientId);
  const stats = {};
  readTable_(SHEETS.MESSAGE_QUEUE).rows.forEach(q => {
    if (String(q['Client ID']) !== clientId) return;
    const st = String(q['Status']);
    const p = stats[q['Campaign ID']] || (stats[q['Campaign ID']] = { recipients: 0, sent: 0, delivered: 0, read: 0, failed: 0, pending: 0 });
    if (st !== QUEUE_STATUS.CANCELLED && st !== QUEUE_STATUS.SKIPPED) p.recipients++;
    if ([QUEUE_STATUS.SENT, QUEUE_STATUS.DELIVERED, QUEUE_STATUS.READ].indexOf(st) >= 0) p.sent++;
    if (st === QUEUE_STATUS.DELIVERED || st === QUEUE_STATUS.READ) p.delivered++;
    if (st === QUEUE_STATUS.READ) p.read++;
    if (st === QUEUE_STATUS.FAILED) p.failed++;
    if ([QUEUE_STATUS.PENDING, QUEUE_STATUS.QUEUED, QUEUE_STATUS.PROCESSING].indexOf(st) >= 0) p.pending++;
  });
  const replies = {};
  readTable_(SHEETS.RESPONSES).rows.forEach(r => {
    if (String(r['Client ID']) === clientId && String(r['Event Type']) === 'message' && r['Campaign ID']) {
      replies[r['Campaign ID']] = (replies[r['Campaign ID']] || 0) + 1;
    }
  });
  return campaigns.slice().reverse().map(c => {
    const id = String(c['Campaign ID']);
    const created = toDate_(c['Created At']);
    return {
      id: id,
      name: String(c['Campaign Name'] || ''),
      status: String(c['Status'] || ''),
      sendMode: String(c['Send Mode'] || ''),
      scheduleDate: cellDateStr_(c['Schedule Date']),
      scheduleTime: cellTimeStr_(c['Schedule Time']),
      timezone: String(c['Timezone'] || ''),
      createdAt: created ? Utilities.formatDate(created, getConfig_().timezone, 'yyyy-MM-dd HH:mm') : '',
      audience: String(c['Target Audience'] || ''),
      hasImage: !!String(c['Image File ID'] || c['Image URL'] || '').trim(),
      message: String(c['Message'] || ''),
      ctaType: String(c['CTA Type'] || ''),
      ctaText: String(c['CTA Text'] || ''),
      ctaValue: String(c['CTA Value'] || ''),
      website: String(c['Website URL'] || ''),
      storePhone: c['Store Phone'] ? '+' + normalizePhoneNumber(c['Store Phone']) : '',
      stats: Object.assign({ recipients: 0, sent: 0, delivered: 0, read: 0, failed: 0, pending: 0 }, stats[id] || {}),
      replies: replies[id] || 0,
    };
  });
}

/* ============================== AUDIENCE ============================== */

/** { all: true } or { lists: ['VIP', 'Diwali 2026'] } -> audience string understood by Campaigns.gs */
function audienceFromSelection_(sel) {
  sel = sel || {};
  if (sel.all) return 'ALL_OPTED_IN';
  const lists = (sel.lists || []).map(sanitizeListName_).filter(Boolean);
  return lists.map(l => 'TAG:' + l.toUpperCase()).join(',');
}

function sanitizeListName_(name) {
  return String(name || '').replace(/[^A-Za-z0-9 _.\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function apiCountAudience(token, selection) {
  return apiCall_(token, 'COUNT_AUDIENCE', s => {
    const audience = audienceFromSelection_(selection);
    return { count: audience ? countAudience_(s.clientId, audience) : 0 };
  });
}

/* ============================== CONTACT UPLOAD ============================== */

/**
 * Imports customers parsed in the browser from Excel/CSV.
 * payload = { listName, consent: true, rows: [{ name, phone, email, company, tags, optIn }] }
 * - New numbers are added for this client only, tagged with the list name.
 * - Existing numbers are updated (name/email/company/tags) but an opted-out customer is
 *   NEVER re-subscribed by an upload. A file value of NO opts the customer out.
 */
function apiUploadContacts(token, payload) {
  return apiCall_(token, 'UPLOAD_CONTACTS', s => {
    payload = payload || {};
    if (payload.consent !== true) throw new Error('Please confirm that these customers agreed to receive WhatsApp messages from your business.');
    const listName = sanitizeListName_(payload.listName);
    if (!listName) throw new Error('Please enter a list name (letters, numbers, spaces, . _ -).');
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) throw new Error('The file has no customer rows.');
    if (rows.length > MAX_UPLOAD_ROWS) throw new Error('Maximum ' + MAX_UPLOAD_ROWS + ' customers per upload. Split the file and upload again.');

    const cfg = getConfig_();
    const now = new Date();
    const source = 'UPLOAD "' + listName + '" by ' + s.client['Client Email'] + ' on ' + nowInTz_('yyyy-MM-dd HH:mm') + ' (consent confirmed)';
    const table = readTable_(SHEETS.CONTACTS);
    const existing = {};
    table.rows.forEach(c => {
      if (String(c['Client ID']) !== s.clientId) return;
      const p = normalizePhoneNumber(c['Phone']);
      if (p && !existing[p]) existing[p] = c;
    });

    const seen = {};
    const toAdd = [];
    const invalidRows = [];
    let updated = 0, duplicatesInFile = 0, keptOptedOut = 0;
    const clean = v => String(v === undefined || v === null ? '' : v).trim().slice(0, 200);
    const mergeTags = (a, b) => {
      const out = [];
      String(a || '').split(/[,;|]/).concat(String(b || '').split(/[,;|]/)).map(t => t.trim()).filter(Boolean).forEach(t => {
        if (!out.some(x => x.toUpperCase() === t.toUpperCase())) out.push(t);
      });
      return out.join(', ');
    };

    rows.forEach((r, i) => {
      const phone = normalizePhoneNumber(r && r.phone, cfg.defaultCountryCode);
      if (!phone) { invalidRows.push(i + 2); return; } // +2: header row + 1-based
      if (seen[phone]) { duplicatesInFile++; return; }
      seen[phone] = true;
      const fileSaysNo = /^(NO|N|FALSE|0|OPT.?OUT|UNSUBSCRIBED)$/i.test(clean(r.optIn));
      const tags = mergeTags(r.tags, listName);
      const ex = existing[phone];
      if (ex) {
        if (!isYes_(ex['Opt In']) && !fileSaysNo) keptOptedOut++;
        ex['Name'] = clean(r.name) || ex['Name'];
        ex['Email'] = clean(r.email) || ex['Email'];
        ex['Company'] = clean(r.company) || ex['Company'];
        ex['Tags'] = mergeTags(ex['Tags'], tags);
        if (fileSaysNo) ex['Opt In'] = 'NO';
        ex['Updated At'] = now;
        writeRowObject_(table, ex);
        updated++;
      } else {
        toAdd.push({
          'Client ID': s.clientId, 'Name': clean(r.name), 'Phone': phone, 'Email': clean(r.email),
          'Company': clean(r.company), 'Tags': tags, 'Audience': '', 'Opt In': fileSaysNo ? 'NO' : 'YES',
          'Status': 'Active', 'Created At': now, 'Updated At': now, 'Source': source,
        });
      }
    });

    if (toAdd.length) {
      const ids = newContactIds_(toAdd.length);
      toAdd.forEach((c, i) => { c['Contact ID'] = ids[i]; });
      appendObjects_(SHEETS.CONTACTS, toAdd);
    }
    logEvent_(LOG_LEVEL.SUCCESS, 'CONTACTS_UPLOADED', {
      clientId: s.clientId, result: toAdd.length + ' added, ' + updated + ' updated',
      details: { list: listName, rows: rows.length, invalid: invalidRows.length, duplicatesInFile: duplicatesInFile, keptOptedOut: keptOptedOut, consent: true },
    });
    return {
      list: listName, added: toAdd.length, updated: updated, invalid: invalidRows.length,
      invalidRows: invalidRows.slice(0, 20), duplicatesInFile: duplicatesInFile, keptOptedOut: keptOptedOut,
      bootstrap: buildBootstrap_(s.clientId),
    };
  });
}

/* ============================== CAMPAIGNS ============================== */

/**
 * Creates a campaign from the dashboard.
 * p = { campaignName, message, imageDataUrl, website, storePhone, ctaType, ctaText, ctaValue,
 *       audience: { all } | { lists: [] }, sendMode: 'NOW' | 'SCHEDULE', date: 'yyyy-MM-dd', time: 'HH:mm' }
 */
function apiCreateCampaign(token, p) {
  return apiCall_(token, 'CREATE_CAMPAIGN', s => {
    p = p || {};
    const audience = audienceFromSelection_(p.audience);
    if (!audience) return { created: false, errors: ['Choose who should receive this campaign.'] };

    let imageFileId = '';
    if (p.imageDataUrl) {
      const saved = saveCreativeToDrive_(s.clientId, p.imageDataUrl);
      if (!saved.ok) return { created: false, errors: [saved.error] };
      imageFileId = saved.fileId;
    }

    const input = {
      businessName: s.client['Business Name'],
      email: s.client['Client Email'],
      campaignName: p.campaignName,
      message: p.message,
      imageRef: imageFileId,
      website: p.website || s.client['Website'],
      storePhone: p.storePhone || s.client['Business Phone'],
      ctaText: p.ctaType && p.ctaType !== 'NONE' ? p.ctaText : '',
      ctaType: p.ctaType && p.ctaType !== 'NONE' ? p.ctaType : '',
      ctaValue: p.ctaType && p.ctaType !== 'NONE' ? p.ctaValue : '',
      audience: audience,
      sendMode: p.sendMode === 'SCHEDULE' ? 'Schedule' : 'Send Now',
      date: p.sendMode === 'SCHEDULE' ? p.date : '',
      time: p.sendMode === 'SCHEDULE' ? p.time : '',
      notes: 'Created from client dashboard',
    };
    const res = createCampaignFromInput_(input, 'DASHBOARD', { silent: true, expectedClientId: s.clientId });
    if (!res.ok && imageFileId) {
      try { DriveApp.getFileById(imageFileId).setTrashed(true); } catch (err) { /* ignore */ }
    }
    return {
      created: res.ok, campaignId: res.campaignId || '', status: res.status || '',
      errors: res.errors || [], warnings: res.warnings || [],
      campaigns: res.ok ? clientCampaignSummaries_(s.clientId) : undefined,
    };
  });
}

/** Saves a processed creative (data URL) privately in Drive: <root>/WhatsApp Campaign Creatives/<Client ID>/ */
function saveCreativeToDrive_(clientId, dataUrl) {
  const m = String(dataUrl).match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return { ok: false, error: 'The image must be a JPG or PNG.' };
  const bytes = Utilities.base64Decode(m[2]);
  const maxBytes = getConfig_().maxImageMb * 1024 * 1024;
  if (bytes.length > maxBytes) return { ok: false, error: 'The processed image is larger than ' + getConfig_().maxImageMb + ' MB.' };
  try {
    const folder = creativesFolder_(clientId);
    const ext = m[1] === 'image/png' ? 'png' : 'jpg';
    const name = clientId + '_' + nowInTz_('yyyyMMdd_HHmmss') + '.' + ext;
    const file = folder.createFile(Utilities.newBlob(bytes, m[1], name));
    return { ok: true, fileId: file.getId() };
  } catch (err) {
    return { ok: false, error: 'Could not save the image to Google Drive: ' + err.message };
  }
}

function creativesFolder_(clientId) {
  const props = PropertiesService.getScriptProperties();
  let root = null;
  const rootId = props.getProperty('CREATIVES_FOLDER_ID');
  if (rootId) { try { root = DriveApp.getFolderById(rootId); } catch (err) { root = null; } }
  if (!root) {
    root = DriveApp.createFolder(CREATIVES_FOLDER_NAME);
    props.setProperty('CREATIVES_FOLDER_ID', root.getId());
  }
  const it = root.getFoldersByName(clientId);
  return it.hasNext() ? it.next() : root.createFolder(clientId);
}

function clientCampaignRow_(clientId, campaignId) {
  const c = getCampaign_(String(campaignId || ''));
  if (!c.row || String(c.row['Client ID']) !== clientId) throw new Error('Campaign not found.');
  return c.row;
}

function apiCancelCampaign(token, campaignId) {
  return apiCall_(token, 'CANCEL_CAMPAIGN', s => {
    const row = clientCampaignRow_(s.clientId, campaignId);
    const allowed = [CAMPAIGN_STATUS.READY, CAMPAIGN_STATUS.SCHEDULED, CAMPAIGN_STATUS.ACTIVE, CAMPAIGN_STATUS.PAUSED];
    if (allowed.indexOf(String(row['Status'])) < 0) throw new Error('This campaign can no longer be cancelled.');
    const r = cancelCampaign_(String(row['Campaign ID']));
    return { message: r.message, campaigns: clientCampaignSummaries_(s.clientId) };
  });
}

/**
 * Returns a campaign's image for the protected (canvas + watermark) preview only.
 * The Drive file itself is never shared or linked.
 */
function apiGetCampaignImage(token, campaignId) {
  return apiCall_(token, 'CAMPAIGN_IMAGE', s => {
    const row = clientCampaignRow_(s.clientId, campaignId);
    const fileId = String(row['Image File ID'] || '').trim();
    if (!fileId) return { image: '' };
    const blob = DriveApp.getFileById(fileId).getBlob();
    return { image: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
  });
}
