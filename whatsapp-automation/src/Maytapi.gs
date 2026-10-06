/**
 * Maytapi.gs
 * Thin, isolated API layer for Maytapi (https://maytapi.com/documentation).
 *
 * ---------------------------------------------------------------------------
 * API CONTRACT USED HERE  — re-check against the live docs before go-live
 * ---------------------------------------------------------------------------
 * Base URL ............ https://api.maytapi.com/api/{product_id}
 * Auth header ......... x-maytapi-key: {API token}
 * Send ................ POST /{phone_id}/sendMessage
 *   text  ............. { "to_number": "<intl digits>", "type": "text",  "message": "<text>" }
 *   media ............. { "to_number": "...", "type": "media", "message": "<https URL | data:<mime>;base64,...>",
 *                         "text": "<caption>", "filename": "<optional>" }
 *   buttons ........... { "to_number": "...", "type": "buttons", "message": "<body>", "buttons": [ ... ] }
 * Success response .... { "success": true, "data": { "chatId": "...", "msgId": "..." } }
 * Error response ...... { "success": false, "message": "..." }
 * Connection checks ... GET /listPhones, GET /{phone_id}/status
 * Webhook ............. POST /setWebhook  { "webhook": "<url>" }
 *
 * Text, media, status, listPhones and setWebhook are Maytapi's long-standing core
 * endpoints. Interactive BUTTON messages are flagged by Maytapi as a newer/BETA
 * feature and their schema has changed over time, so the button JSON is built in
 * ONE function (buildButtonsPayload_) and every button send automatically falls
 * back to a plain-text CTA if Maytapi rejects it (CTA_FALLBACK_TO_TEXT=YES).
 * Run "Send Test Message" after any Maytapi change to confirm the live format.
 *
 * List and carousel messages are intentionally NOT implemented: they could not be
 * verified against the current documentation, and guessing payloads is unsafe.
 * ---------------------------------------------------------------------------
 *
 * Every function returns:
 *   { success, httpStatus, messageId, response, error, retryable, rateLimited, authError, stopBatch }
 * The API token never appears in a return value, log row or exception message.
 */

const MAYTAPI_BASE_URL = 'https://api.maytapi.com/api';

/**
 * Low-level request. `path` is relative to /api/{product_id}, e.g. '/123/sendMessage'.
 */
function maytapiRequest_(method, path, payload, cfg) {
  cfg = cfg || getConfig_();
  if (!cfg.productId || !cfg.apiToken) {
    return failResult_(0, 'Maytapi credentials are not configured (Script Properties).', { authError: true, stopBatch: true });
  }
  const url = MAYTAPI_BASE_URL + '/' + encodeURIComponent(cfg.productId) + path;
  const options = {
    method: (method || 'get').toLowerCase(),
    contentType: 'application/json',
    headers: { 'x-maytapi-key': cfg.apiToken },
    muteHttpExceptions: true,
    followRedirects: true,
  };
  if (payload !== undefined && payload !== null) options.payload = JSON.stringify(payload);

  let res;
  try {
    res = UrlFetchApp.fetch(url, options);
  } catch (err) {
    // Network error / timeout: transient.
    return failResult_(0, 'Network error: ' + redactSecrets_(err.message), { retryable: true });
  }

  const status = res.getResponseCode();
  const text = res.getContentText() || '';
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (err) { json = null; }

  const apiSuccess = json && typeof json === 'object' && json.success !== false;
  const ok = status >= 200 && status < 300 && (json ? apiSuccess : true);
  const data = json && json.data;
  const messageId = (data && !Array.isArray(data) && (data.msgId || data.id || data.messageId)) || (json && json.msgId) || '';
  const response = json || truncate_(text, 2000);

  if (ok) {
    return { success: true, httpStatus: status, messageId: String(messageId || ''), response: response, error: '' };
  }
  const errorText = redactSecrets_(
    (json && (json.message || json.error || (json.data && json.data.message))) || truncate_(text, 500) || ('HTTP ' + status)
  );
  return classifyFailure_(status, errorText, response);
}

function failResult_(status, error, flags) {
  return Object.assign({
    success: false, httpStatus: status, messageId: '', response: null, error: error,
    retryable: false, rateLimited: false, authError: false, stopBatch: false,
  }, flags || {});
}

/** Decides whether a failure is transient, permanent, rate-limited or batch-stopping. */
function classifyFailure_(status, errorText, response) {
  const msg = String(errorText || '').toLowerCase();
  const r = failResult_(status, errorText);
  r.response = response;
  if (status === 429 || /rate.?limit|too many|throttl/.test(msg)) {
    r.rateLimited = true; r.retryable = true; r.stopBatch = true;
  } else if (status === 401 || status === 403 || /unauthori[sz]ed|invalid (api )?(key|token)|forbidden/.test(msg)) {
    r.authError = true; r.stopBatch = true;
  } else if (/not\s+connected|disconnected|\bqr\b|phone.*(offline|inactive|not active|loading)/.test(msg)) {
    // Sending phone problem: every message would fail. Keep items, stop the batch.
    r.retryable = true; r.stopBatch = true;
  } else if (/invalid.*(number|phone)|not.*(registered|exist|on whatsapp)|wrong number/.test(msg)) {
    r.retryable = false;
  } else if (status === 0 || status === 408 || status >= 500) {
    r.retryable = true;
  } else if (status >= 200 && status < 300) {
    // HTTP 200 with success:false and an unrecognised reason — treat as transient.
    r.retryable = true;
  } else {
    r.retryable = false; // other 4xx: bad request, won't fix itself
  }
  return r;
}

function phonePath_(cfg, endpoint) {
  return '/' + encodeURIComponent(cfg.phoneId) + '/' + endpoint;
}

/* ============================== MESSAGE TYPES ============================== */

function sendMaytapiText_(toNumber, text, cfg) {
  cfg = cfg || getConfig_();
  return maytapiRequest_('post', phonePath_(cfg, 'sendMessage'), {
    to_number: toNumber,
    type: 'text',
    message: String(text || ''),
  }, cfg);
}

/**
 * @param media  https URL or data URI (data:<mime>;base64,...) — see Media.gs
 * @param caption optional caption text
 */
function sendMaytapiMedia_(toNumber, media, caption, filename, cfg) {
  cfg = cfg || getConfig_();
  const payload = { to_number: toNumber, type: 'media', message: media };
  if (caption) payload.text = String(caption);
  if (filename) payload.filename = filename;
  return maytapiRequest_('post', phonePath_(cfg, 'sendMessage'), payload, cfg);
}

/**
 * Sends an interactive button message.
 * @param buttons [{ type: 'URL'|'PHONE'|'QUICK_REPLY', text, value }]
 */
function sendMaytapiButtons_(toNumber, body, buttons, cfg, image) {
  cfg = cfg || getConfig_();
  const payload = buildButtonsPayload_(toNumber, body, buttons);
  // Optional image header (BUTTONS_WITH_IMAGE). The field name comes from SETTINGS → BUTTON_IMAGE_FIELD,
  // copied from Maytapi's documentation, because it could not be verified here.
  if (image && image.field && image.media) payload[image.field] = image.media;
  return maytapiRequest_('post', phonePath_(cfg, 'sendMessage'), payload, cfg);
}

/**
 * THE ONLY PLACE THE BUTTON SCHEMA IS DEFINED.
 * Maytapi button entries (per its "Buttons Message" example):
 *   quick reply -> { "id": "<payload>", "text": "<label>" }
 *   url         -> { "text": "<label>", "url": "https://..." }
 *   phone       -> { "text": "<label>", "phoneNumber": "+<intl number>" }
 * If Maytapi changes this format, edit here only.
 */
function buildButtonsPayload_(toNumber, body, buttons) {
  return {
    to_number: toNumber,
    type: 'buttons',
    message: String(body || ''),
    buttons: (buttons || []).map((b, i) => {
      const type = String(b.type || '').toUpperCase();
      if (type === 'URL') return { text: b.text, url: b.value };
      if (type === 'PHONE') return { text: b.text, phoneNumber: '+' + String(b.value).replace(/\D/g, '') };
      return { id: String(b.value || ('btn_' + (i + 1))), text: b.text };
    }),
  };
}

/** Not implemented on purpose — see file header. */
function sendMaytapiList_() {
  return failResult_(0, 'List messages are not enabled: payload not verified against the current Maytapi documentation.');
}

/** Not implemented on purpose — see file header. */
function sendMaytapiCarousel_() {
  return failResult_(0, 'Carousel messages are not enabled: payload not verified against the current Maytapi documentation.');
}

/* ============================== ACCOUNT / CONNECTION ============================== */

function maytapiListPhones_(cfg) {
  return maytapiRequest_('get', '/listPhones', null, cfg);
}

function maytapiPhoneStatus_(cfg) {
  cfg = cfg || getConfig_();
  return maytapiRequest_('get', phonePath_(cfg, 'status'), null, cfg);
}

function maytapiSetWebhook_(webhookUrl, cfg) {
  return maytapiRequest_('post', '/setWebhook', { webhook: webhookUrl }, cfg);
}

/**
 * Menu / editor: checks credentials, that MAYTAPI_PHONE_ID belongs to the product,
 * and the phone's connection status. Prints nothing secret.
 */
function testMaytapiConnection() {
  requireAdmin_();
  const cfg = getConfig_(true);
  const v = validateConfig_(cfg);
  const lines = [formatValidation_(v)];
  let ok = v.ok;
  if (v.ok) {
    const phones = maytapiListPhones_(cfg);
    if (!phones.success) {
      ok = false;
      lines.push('listPhones failed (HTTP ' + phones.httpStatus + '): ' + phones.error);
    } else {
      const list = Array.isArray(phones.response) ? phones.response : (phones.response && phones.response.data) || [];
      const match = Array.isArray(list) ? list.find(p => String(p.id) === String(cfg.phoneId)) : null;
      lines.push('Product reachable. Phones on product: ' + (Array.isArray(list) ? list.length : 'unknown') + '.');
      if (Array.isArray(list) && !match) { ok = false; lines.push('MAYTAPI_PHONE_ID was NOT found on this product.'); }
      if (match) lines.push('Sending phone: ' + maskPhone_(match.number || '') + ' (status: ' + (match.status || 'n/a') + ')');
      // Tenant dedicated numbers must also exist on this product.
      if (Array.isArray(list)) {
        readTable_(SHEETS.CLIENTS).rows.forEach(c => {
          const pid = String(c['Maytapi Phone ID'] || '').trim();
          if (!pid) return;
          const p = list.find(x => String(x.id) === pid);
          if (!p) { ok = false; lines.push('Tenant ' + c['Client ID'] + ': Maytapi Phone ID ' + pid + ' NOT found on this product.'); }
          else lines.push('Tenant ' + c['Client ID'] + ': phone ' + maskPhone_(p.number || '') + ' (status: ' + (p.status || 'n/a') + ')');
        });
      }
    }
    const st = maytapiPhoneStatus_(cfg);
    if (st.success) {
      const s = st.response && (st.response.status || st.response.data || st.response);
      lines.push('Phone status: ' + truncate_(safeJson_(s), 300));
    } else {
      lines.push('Phone status check failed (HTTP ' + st.httpStatus + '): ' + st.error);
    }
  }
  logEvent_(ok ? LOG_LEVEL.SUCCESS : LOG_LEVEL.ERROR, 'TEST_CONNECTION', { result: ok ? 'OK' : 'FAILED', details: lines.join(' | ') });
  try { SpreadsheetApp.getUi().alert('Maytapi connection test', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK); } catch (err) { console.log(lines.join('\n')); }
  return { ok: ok, details: lines };
}

/**
 * True when a /status response says the phone is logged in to WhatsApp.
 * The exact response shape could not be verified, so several common field names are accepted.
 */
function maytapiLooksConnected_(response) {
  if (!response || typeof response !== 'object') return false;
  const st = response.status && typeof response.status === 'object' ? response.status : (response.data || response);
  if (st && (st.loggedIn === true || st.isLoggedIn === true || st.connected === true)) return true;
  const text = JSON.stringify(st || {}).toLowerCase();
  return /"(state|status)"\s*:\s*"(connected|active|ready|authenticated|logged_in|loggedin)"/.test(text);
}

/**
 * GET /{phone_id}/qrCode — returns a data URL of the QR image to link WhatsApp, or '' when
 * Maytapi returns no image (already logged in, phone loading, or endpoint unavailable).
 */
function maytapiQrCode_(cfg) {
  cfg = cfg || getConfig_();
  if (!cfg.productId || !cfg.apiToken || !cfg.phoneId) return '';
  try {
    const res = UrlFetchApp.fetch(MAYTAPI_BASE_URL + '/' + encodeURIComponent(cfg.productId) + phonePath_(cfg, 'qrCode'), {
      method: 'get', headers: { 'x-maytapi-key': cfg.apiToken }, muteHttpExceptions: true,
    });
    const type = String((res.getHeaders() || {})['Content-Type'] || (res.getHeaders() || {})['content-type'] || '');
    if (res.getResponseCode() !== 200 || !/^image\//i.test(type)) return '';
    return 'data:' + type.split(';')[0] + ';base64,' + Utilities.base64Encode(res.getContent());
  } catch (err) {
    return '';
  }
}
