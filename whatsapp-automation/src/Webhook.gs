/**
 * Webhook.gs
 * Web App endpoints (doGet health check, doPost Maytapi webhook), automated replies
 * and opt-out handling.
 *
 * MAYTAPI WEBHOOK EVENTS (one JSON body per POST, field "type" identifies the event):
 *   "message" — incoming message:
 *       { type, product_id, phone_id, message: { type, text, fromMe, id, ... },
 *         user: { id: "<digits>@c.us", name, phone }, conversation: "<digits>@c.us",
 *         conversation_name, receiver, timestamp }
 *   "ack"     — delivery status of messages we sent:
 *       { type: "ack", product_id, phone_id, data: [ { msgId, ackType: "sent"|"delivered"|"read"|"failed", ackCode, chatId, time } ] }
 *   "status"  — sending phone state changes;  "error" — account/phone errors.
 * Parsing is defensive: unknown/missing fields never crash the handler, the raw payload
 * is always stored in RESPONSES, and unrecognised events are logged for review.
 *
 * SECURITY: Maytapi does not sign webhook requests, and Apps Script web apps cannot read
 * request headers. The webhook URL therefore carries a secret query parameter
 * (?key=WEBHOOK_SECRET) which is set via "Configure Webhook" and checked on every call.
 */

/** Health/status endpoint. Exposes no secrets or data. */
function doGet(e) {
  let configured = false;
  try { configured = validateConfig(getConfig(true)).ok; } catch (err) { configured = false; }
  return jsonOut_({
    status: 'ok',
    service: 'whatsapp-campaign-automation',
    version: SYSTEM_VERSION,
    configured: configured,
    time: new Date().toISOString(),
  });
}

/** Maytapi webhook receiver. Always returns 200 + JSON so Maytapi does not retry-storm. */
function doPost(e) {
  const cfg = getConfig(true);
  try {
    if (cfg.webhookSecret) {
      const key = e && e.parameter ? String(e.parameter.key || '') : '';
      if (key !== cfg.webhookSecret) {
        logEvent_(LOG_LEVEL.WARNING, 'WEBHOOK_REJECTED', { error: 'Missing or invalid webhook key.' });
        return jsonOut_({ ok: false, error: 'unauthorized' });
      }
    }
    const raw = e && e.postData ? e.postData.contents : '';
    let payload;
    try { payload = JSON.parse(raw || '{}'); } catch (err) {
      logEvent_(LOG_LEVEL.WARNING, 'WEBHOOK_BAD_JSON', { error: err.message, details: truncate_(raw, 500) });
      return jsonOut_({ ok: false, error: 'invalid json' });
    }
    // Ignore events for other Maytapi phones on the same product.
    const phoneId = payload.phone_id || payload.phoneId;
    if (phoneId && cfg.phoneId && String(phoneId) !== String(cfg.phoneId)) return jsonOut_({ ok: true, ignored: 'other phone' });

    const type = String(payload.type || '').toLowerCase();
    if (type === 'message') handleIncomingMessage_(payload, raw, cfg);
    else if (type === 'ack') handleAck_(payload, raw);
    else {
      recordResponse_({ eventType: type || 'unknown', status: payload.status || '', raw: raw, processed: 'LOGGED' });
      logEvent_(type === 'error' ? LOG_LEVEL.ERROR : LOG_LEVEL.INFO, 'WEBHOOK_' + (type || 'UNKNOWN').toUpperCase(), { details: truncate_(raw, 1000) });
      if (type === 'error') notifyAdmin_('Maytapi error event', truncate_(raw, 2000));
    }
    return jsonOut_({ ok: true });
  } catch (err) {
    logEvent_(LOG_LEVEL.ERROR, 'WEBHOOK_ERROR', { error: err.message, details: err.stack });
    return jsonOut_({ ok: false, error: 'internal' });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ============================== INCOMING MESSAGES ============================== */

function handleIncomingMessage_(payload, raw, cfg) {
  const m = payload.message || {};
  if (m.fromMe === true || m.fromMe === 'true') return; // our own outgoing messages echo back
  const conversation = String(payload.conversation || (payload.user && payload.user.id) || '');
  if (/@g\.us$/.test(conversation)) return; // group chats are out of scope

  // Webhook senders may redeliver the same event (Apps Script answers POSTs with a 302
  // redirect, which some senders treat as a failure). Process each message ID once.
  if (m.id && isDuplicateEvent_('msg:' + m.id)) return;

  const phone = normalizePhoneNumber((payload.user && payload.user.phone) || conversation.split('@')[0]);
  const name = (payload.user && payload.user.name) || payload.conversation_name || '';
  const text = String(m.text || m.caption || m.body || '').trim();
  const ctx = resolveContactContext_(phone);

  const base = {
    clientId: ctx.clientId, campaignId: ctx.campaignId, phone: phone, name: name,
    messageId: m.id || '', messageType: m.type || '', text: text, eventType: 'message', raw: raw,
  };
  if (!phone) {
    recordResponse_(Object.assign(base, { status: 'IGNORED', processed: 'NO: unreadable sender' }));
    return;
  }

  // Track the response on the contact (or create an inbound lead).
  touchContactResponse_(ctx, phone, name, text, cfg);

  // 1) Opt-out keywords override everything.
  const upper = text.toUpperCase().replace(/[^\w ]/g, '').trim();
  if (upper && cfg.optOutKeywords.indexOf(upper) >= 0) {
    const n = optOutPhone_(phone, 'Keyword "' + upper + '"');
    if (cfg.optOutReply) sendMaytapiText(phone, cfg.optOutReply, cfg);
    recordResponse_(Object.assign(base, { status: 'OPTED_OUT', processed: 'YES: opt-out (' + n + ' contact record(s))' }));
    return;
  }

  // 2) Keyword auto-replies from TEMPLATES.
  let processed = 'NO: no matching template';
  if (cfg.autoReplyEnabled) {
    const candidates = replyCandidates_(m, text, ctx.campaign);
    const tpl = findReplyTemplate_(candidates);
    if (tpl) {
      const r = sendTemplateReply_(tpl, phone, ctx, cfg);
      processed = r.success ? 'YES: replied with ' + tpl['Template ID'] : 'ERROR: ' + r.error;
      logEvent_(r.success ? LOG_LEVEL.SUCCESS : LOG_LEVEL.ERROR, 'AUTO_REPLY', {
        clientId: ctx.clientId, campaignId: ctx.campaignId, contactId: ctx.contact && ctx.contact['Contact ID'],
        phone: phone, messageId: r.messageId, httpStatus: r.httpStatus, result: tpl['Template ID'], error: r.error,
      });
    }
  }
  recordResponse_(Object.assign(base, { status: 'RECEIVED', processed: processed }));
}

/** True if this event key was already seen in the last 6 hours (script cache). */
function isDuplicateEvent_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const k = 'wh_' + Utilities.base64EncodeWebSafe(String(key)).slice(0, 200);
    if (cache.get(k)) return true;
    cache.put(k, '1', 21600);
  } catch (err) { /* cache unavailable: fall through and process */ }
  return false;
}

/** Text, button payloads and (for QUICK_REPLY campaigns) the campaign's CTA value. */
function replyCandidates_(m, text, campaign) {
  const out = [text, m.payload, m.selectedButtonId, m.buttonId, m.button_id, m.selectedId, m.selectedRowId]
    .filter(v => v !== undefined && v !== null && String(v).trim() !== '')
    .map(v => String(v).trim().toLowerCase());
  if (campaign && String(campaign['CTA Type']).toUpperCase() === 'QUICK_REPLY' &&
      text.toLowerCase() === String(campaign['CTA Text']).trim().toLowerCase()) {
    out.push(String(campaign['CTA Value']).trim().toLowerCase());
  }
  return out;
}

/** Finds the most recent campaign this phone received, plus the matching contact. */
function resolveContactContext_(phone) {
  const ctx = { clientId: '', campaignId: '', campaign: null, contact: null, contactsTable: null };
  if (!phone) return ctx;
  let latest = null;
  readTable_(SHEETS.MESSAGE_QUEUE).rows.forEach(q => {
    if (normalizePhoneNumber(q['Phone']) !== phone) return;
    const t = toDate_(q['Sent At']) || toDate_(q['Created At']);
    if (t && (!latest || t > latest.t)) latest = { t: t, q: q };
  });
  if (latest) {
    ctx.clientId = String(latest.q['Client ID']);
    ctx.campaignId = String(latest.q['Campaign ID']);
    ctx.campaign = getCampaign_(ctx.campaignId).row;
  }
  ctx.contactsTable = readTable_(SHEETS.CONTACTS);
  const matches = ctx.contactsTable.rows.filter(c => normalizePhoneNumber(c['Phone']) === phone);
  ctx.contact = matches.find(c => String(c['Client ID']) === ctx.clientId) || matches[0] || null;
  if (ctx.contact && !ctx.clientId) ctx.clientId = String(ctx.contact['Client ID'] || '');
  return ctx;
}

function touchContactResponse_(ctx, phone, name, text, cfg) {
  const now = new Date();
  if (ctx.contact) {
    updateFields_(ctx.contactsTable, ctx.contact._row, { 'Last Response': truncate_(text, 500), 'Updated At': now });
    return;
  }
  if (!cfg.createInboundContacts) return;
  // Unknown sender => lead. Opt In stays NO: messaging us is not marketing consent.
  appendObject_(SHEETS.CONTACTS, {
    'Contact ID': newContactIds_(1)[0], 'Client ID': ctx.clientId, 'Name': name, 'Phone': phone,
    'Tags': 'INBOUND', 'Audience': 'LEADS', 'Opt In': 'NO', 'Status': 'Active',
    'Last Response': truncate_(text, 500), 'Created At': now, 'Updated At': now,
  });
  logEvent_(LOG_LEVEL.INFO, 'LEAD_CREATED', { clientId: ctx.clientId, phone: phone });
}

/**
 * Opt-out: Opt In = NO on EVERY contact record with this phone (the sending number is
 * shared across clients) and unsent queue items are skipped. Returns records changed.
 */
function optOutPhone_(phone, reason) {
  const contacts = readTable_(SHEETS.CONTACTS);
  let n = 0;
  contacts.rows.forEach(c => {
    if (normalizePhoneNumber(c['Phone']) === phone) {
      updateFields_(contacts, c._row, { 'Opt In': 'NO', 'Updated At': new Date() });
      n++;
    }
  });
  const queue = readTable_(SHEETS.MESSAGE_QUEUE);
  queue.rows.forEach(q => {
    if (normalizePhoneNumber(q['Phone']) === phone && [QUEUE_STATUS.PENDING, QUEUE_STATUS.QUEUED].indexOf(String(q['Status'])) >= 0) {
      updateFields_(queue, q._row, { 'Status': QUEUE_STATUS.SKIPPED, 'Error': 'Recipient opted out' });
    }
  });
  logEvent_(LOG_LEVEL.WARNING, 'OPT_OUT', { phone: phone, result: n + ' record(s)', details: reason });
  return n;
}

/* ============================== AUTO-REPLY ENGINE ============================== */

/** First active template whose comma-separated Trigger list contains a candidate (case-insensitive). */
function findReplyTemplate_(candidates) {
  if (!candidates.length) return null;
  const templates = readTable_(SHEETS.TEMPLATES).rows.filter(t => isYes_(t['Active']));
  return templates.find(t => String(t['Trigger'] || '').split(',')
    .map(s => s.trim().toLowerCase()).filter(Boolean)
    .some(trigger => candidates.indexOf(trigger) >= 0)) || null;
}

function sendTemplateReply_(tpl, phone, ctx, cfg) {
  const contact = ctx.contact || { Name: '', Phone: phone };
  const campaign = ctx.campaign || clientAsCampaign_(ctx.clientId);
  const type = String(tpl['Reply Type'] || 'TEXT').toUpperCase();
  const image = String(tpl['Image URL'] || '').trim();
  const spec = { phone: phone, text: renderTemplate(tpl['Reply Text'], contact, campaign) };
  if (image && (type === 'IMAGE' || type === 'BUTTONS')) {
    if (/^https:\/\//i.test(image)) spec.imageUrl = image; else spec.imageFileId = extractDriveFileId_(image);
  }
  if (type === 'BUTTONS' && tpl['Button Type']) {
    spec.cta = {
      type: String(tpl['Button Type']).toUpperCase(),
      text: renderTemplate(tpl['Button Text'], contact, campaign),
      value: renderTemplate(tpl['Button Value'], contact, campaign),
    };
  }
  return sendCampaignMessage_(spec, cfg, {});
}

/** Minimal campaign-like object from CLIENTS so {{StorePhone}}/{{Website}} work in replies. */
function clientAsCampaign_(clientId) {
  if (!clientId) return {};
  const c = findRow_(readTable_(SHEETS.CLIENTS), 'Client ID', clientId);
  return c ? { 'Client Name': c['Business Name'], 'Store Phone': c['Business Phone'], 'Website URL': c['Website'] } : {};
}

/* ============================== ACKS ============================== */

function handleAck_(payload, raw) {
  const acks = Array.isArray(payload.data) ? payload.data : (payload.data ? [payload.data] : []);
  if (!acks.length) {
    recordResponse_({ eventType: 'ack', status: 'EMPTY', raw: raw, processed: 'NO: no ack data' });
    return;
  }
  const queue = readTable_(SHEETS.MESSAGE_QUEUE);
  const byMsgId = {};
  queue.rows.forEach(q => String(q['Message ID'] || '').split(',').map(s => s.trim()).filter(Boolean).forEach(id => { byMsgId[id] = q; }));

  acks.forEach(a => {
    const msgId = String(a.msgId || a.id || a.messageId || '');
    const status = ackToStatus_(a);
    const q = byMsgId[msgId];
    let processed = 'NO: message not in queue';
    if (q && status) {
      const current = String(q['Status']);
      if (status === QUEUE_STATUS.FAILED) {
        updateFields_(queue, q._row, { 'Status': QUEUE_STATUS.FAILED, 'Error': 'Delivery failed (ack)' });
        processed = 'YES: FAILED';
      } else if ((QUEUE_STATUS_RANK[status] || 0) > (QUEUE_STATUS_RANK[current] || 0)) {
        updateFields_(queue, q._row, { 'Status': status });
        q['Status'] = status;
        processed = 'YES: ' + status;
      } else {
        processed = 'YES: no change (' + current + ')';
      }
    }
    recordResponse_({
      clientId: q ? q['Client ID'] : '', campaignId: q ? q['Campaign ID'] : '',
      phone: q ? q['Phone'] : normalizePhoneNumber(String(a.chatId || '').split('@')[0]),
      name: q ? q['Name'] : '', messageId: msgId, eventType: 'ack', status: status || String(a.ackType || a.ackCode || ''),
      raw: safeJson_(a), processed: processed,
    });
  });
}

function ackToStatus_(a) {
  const t = String(a.ackType || a.status || '').toLowerCase();
  if (t === 'read' || t === 'played' || t === 'viewed') return QUEUE_STATUS.READ;
  if (t === 'delivered' || t === 'received') return QUEUE_STATUS.DELIVERED;
  if (t === 'sent' || t === 'server') return QUEUE_STATUS.SENT;
  if (t === 'failed' || t === 'error') return QUEUE_STATUS.FAILED;
  const code = Number(a.ackCode);
  if (code >= 3) return QUEUE_STATUS.READ;
  if (code === 2) return QUEUE_STATUS.DELIVERED;
  if (code === 1) return QUEUE_STATUS.SENT;
  if (code < 0) return QUEUE_STATUS.FAILED;
  return '';
}

function recordResponse_(r) {
  appendObject_(SHEETS.RESPONSES, {
    'Timestamp': new Date(),
    'Client ID': r.clientId || '',
    'Campaign ID': r.campaignId || '',
    'Phone': r.phone || '',
    'Name': r.name || '',
    'Message ID': r.messageId || '',
    'Message Type': r.messageType || '',
    'Message Text': truncate_(r.text || '', 2000),
    'Event Type': r.eventType || '',
    'Status': r.status || '',
    'Raw Payload': truncate_(redactSecrets_(r.raw || ''), 45000),
    'Processed': r.processed || '',
  });
}

/* ============================== WEBHOOK SETUP ============================== */

/**
 * Returns the webhook URL including the secret key. Uses SETTINGS → WEBHOOK_URL if set,
 * otherwise ScriptApp.getService().getUrl() (the deployed Web App URL).
 */
function getWebhookUrl() {
  const cfg = getConfig(true);
  let base = cfg.webhookUrl;
  if (!base) { try { base = ScriptApp.getService().getUrl(); } catch (err) { base = ''; } }
  if (!base) return '';
  base = base.replace(/\?.*$/, '');
  return cfg.webhookSecret ? base + '?key=' + encodeURIComponent(cfg.webhookSecret) : base;
}

/** Menu: creates a webhook secret if needed and registers the URL with Maytapi (setWebhook). */
function configureWebhook() {
  ensureWebhookSecret_();
  const cfg = getConfig(true);
  const v = validateConfig(cfg);
  const ui = SpreadsheetApp.getUi();
  if (!v.ok) return ui.alert('Fix configuration first:\n' + v.errors.join('\n'));
  const url = getWebhookUrl();
  if (!url) return ui.alert('No Web App URL found. Deploy → New deployment → Web app (Execute as: Me, Access: Anyone), then paste the /exec URL into SETTINGS → WEBHOOK_URL.');
  if (/\/dev(\?|$)/.test(url)) return ui.alert('The URL is a /dev test URL, which Maytapi cannot call. Paste the deployed /exec URL into SETTINGS → WEBHOOK_URL.');

  const r = maytapiSetWebhook(url, cfg);
  if (r.success) {
    const settings = readTable_(SHEETS.SETTINGS);
    const row = findRow_(settings, 'Key', 'WEBHOOK_URL');
    if (row && !String(row['Value']).trim()) updateFields_(settings, row._row, { 'Value': url.replace(/\?.*$/, '') });
  }
  logEvent_(r.success ? LOG_LEVEL.SUCCESS : LOG_LEVEL.ERROR, 'CONFIGURE_WEBHOOK', { httpStatus: r.httpStatus, result: r.success ? 'OK' : 'FAILED', error: r.error });
  ui.alert(r.success
    ? 'Webhook registered with Maytapi:\n' + url.replace(/key=[^&]+/, 'key=***')
    : 'setWebhook failed (HTTP ' + r.httpStatus + '): ' + r.error);
}
