/**
 * Campaigns.gs
 * Validation, client records, campaign lifecycle, scheduling and test sends.
 */

/* ============================== VALIDATION ============================== */

/**
 * Validates raw form input. Image processing is included.
 * @return { errors[], warnings[], data } — data holds normalised values.
 */
function validateCampaignInput_(input) {
  const cfg = getConfig_();
  const errors = [];
  const warnings = [];
  const data = {};

  data.businessName = String(input.businessName || '').trim();
  data.campaignName = String(input.campaignName || '').trim();
  data.message = String(input.message || '').trim();
  data.email = String(input.email || '').trim().toLowerCase();
  data.notes = String(input.notes || '').trim();

  if (!data.businessName) errors.push('Client / Business Name is required.');
  if (!data.campaignName) errors.push('Campaign Name is required.');
  if (!data.message) errors.push('Campaign Message is required.');
  if (data.message.length > 4096) errors.push('Campaign Message is longer than 4096 characters.');
  if (!isValidEmail_(data.email)) errors.push('Client Email is missing or invalid.');

  // Unknown {{variables}} are removed at send time; warn so the client knows.
  const unknown = (data.message.match(/\{\{\s*([^}]+?)\s*\}\}/g) || [])
    .map(v => v.replace(/[{}\s]/g, ''))
    .filter(v => TEMPLATE_VARIABLES.map(t => t.toLowerCase()).indexOf(v.replace(/_/g, '').toLowerCase()) < 0);
  if (unknown.length) warnings.push('Unknown variables will be removed from the message: ' + unknown.join(', '));

  // Website
  data.website = '';
  if (String(input.website || '').trim()) {
    data.website = normalizeUrl_(input.website);
    if (!data.website) errors.push('Website / Landing Page URL "' + input.website + '" is not a valid web address.');
  }

  // Store link (optional): Google Maps / store page, available as {{StoreLink}}.
  data.storeLink = '';
  if (String(input.storeLink || '').trim()) {
    data.storeLink = normalizeUrl_(input.storeLink);
    if (!data.storeLink) errors.push('Store link "' + input.storeLink + '" is not a valid web address.');
  }

  // Store phone (client's public number — NOT the Maytapi sending number)
  data.storePhone = '';
  if (String(input.storePhone || '').trim()) {
    data.storePhone = normalizePhoneNumber(input.storePhone);
    if (!data.storePhone) errors.push('Store / Business Phone Number "' + input.storePhone + '" is invalid.');
  }

  // Image (optional: text-only campaigns are allowed)
  data.imageFileId = '';
  data.imageName = '';
  if (input.imageRef && String(input.imageRef).trim()) {
    const img = processCampaignImage_(input.imageRef);
    if (!img.ok) errors.push(img.error);
    else { data.imageFileId = img.fileId; data.imageName = img.fileName; }
  } else {
    warnings.push('No image uploaded — the campaign will be sent as text only.');
  }
  if (data.imageFileId && data.message.length > 900 && cfg.imageCtaStyle !== 'IMAGE_THEN_BUTTONS') {
    errors.push('With an image, the message must be at most 900 characters (WhatsApp captions are limited to 1024, and the button link is added at the end).');
  }

  // CTA
  data.ctaType = String(input.ctaType || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (data.ctaType === 'NONE' || data.ctaType === 'NO_BUTTON') data.ctaType = '';
  data.ctaText = String(input.ctaText || '').trim();
  data.ctaValue = String(input.ctaValue || '').trim();
  if (data.ctaType || data.ctaText) {
    if (CTA_TYPES.indexOf(data.ctaType) < 0) errors.push('CTA Button Type must be URL, PHONE or QUICK_REPLY.');
    if (!data.ctaText) errors.push('CTA Button Text is required when a CTA type is chosen.');
    else if (data.ctaText.length > cfg.ctaTextMaxLength) errors.push('CTA Button Text must be at most ' + cfg.ctaTextMaxLength + ' characters (currently ' + data.ctaText.length + ').');

    if (data.ctaType === 'URL') {
      if (!data.ctaValue) data.ctaValue = data.website ? '{{Website}}' : '';
      const resolved = /\{\{\s*website\s*\}\}/i.test(data.ctaValue) ? data.website
        : /\{\{\s*store_?link\s*\}\}/i.test(data.ctaValue) ? data.storeLink : normalizeUrl_(data.ctaValue);
      if (!resolved) errors.push('CTA Button Value must be a valid URL (or leave blank to use the Website).');
      else if (!/\{\{/.test(data.ctaValue)) data.ctaValue = resolved;
    } else if (data.ctaType === 'PHONE') {
      if (!data.ctaValue) data.ctaValue = data.storePhone ? '{{StorePhone}}' : '';
      const resolved = /\{\{\s*store_?phone\s*\}\}/i.test(data.ctaValue) ? data.storePhone : normalizePhoneNumber(data.ctaValue);
      if (!resolved) errors.push('CTA Button Value must be a valid phone number (or leave blank to use the Store Phone).');
      else if (!/\{\{/.test(data.ctaValue)) data.ctaValue = resolved;
    } else if (data.ctaType === 'QUICK_REPLY') {
      if (!data.ctaValue) data.ctaValue = data.ctaText.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      if (data.ctaValue.length > 256) errors.push('Quick reply value is too long.');
    }
  }

  // Audience
  data.audience = normalizeAudience_(input.audience);
  if (!data.audience) errors.push('Target Audience is required.');
  else {
    const bad = data.audience.split(',').filter(t => !/^(ALL|ALL_OPTED_IN|(TAG|AUDIENCE):[A-Z0-9 _.\-]+|[A-Z0-9 _.\-]+)$/.test(t));
    if (bad.length) errors.push('Target Audience contains invalid values: ' + bad.join(', '));
  }

  // Send mode / schedule
  const mode = String(input.sendMode || '').trim().toUpperCase();
  data.sendMode = mode.indexOf('SCHEDULE') === 0 ? SEND_MODES.SCHEDULE : (mode.indexOf('NOW') >= 0 ? SEND_MODES.NOW : '');
  if (!data.sendMode) errors.push('Send Mode must be "Send Now" or "Schedule".');
  data.timezone = cfg.timezone;
  data.scheduleDate = parseDateValue_(input.date);
  data.scheduleTime = parseTimeValue_(input.time);
  if (data.sendMode === SEND_MODES.SCHEDULE) {
    if (!data.scheduleDate) errors.push('Campaign Date is missing or invalid.');
    if (!data.scheduleTime) errors.push('Campaign Time is missing or invalid.');
    if (data.scheduleDate && data.scheduleTime) {
      const when = buildDateTime_(data.scheduleDate, data.scheduleTime, cfg.timezone);
      if (!when) errors.push('Campaign Date/Time could not be interpreted.');
      else if (when.getTime() < Date.now() - 5 * 60 * 1000) errors.push('Campaign Date/Time (' + data.scheduleDate + ' ' + data.scheduleTime + ' ' + cfg.timezone + ') is in the past.');
    }
  } else if (data.sendMode === SEND_MODES.NOW) {
    data.scheduleDate = '';
    data.scheduleTime = '';
  }

  return { errors: errors, warnings: warnings, data: data };
}

/** "vip, Tag:Kolkata" -> "VIP,TAG:KOLKATA" */
function normalizeAudience_(value) {
  if (Array.isArray(value)) value = value.join(',');
  return String(value || '').split(/[,;\n]/)
    .map(s => s.trim().toUpperCase().replace(/\s*:\s*/, ':'))
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(',');
}

/* ============================== AUDIENCE ============================== */

/**
 * Audience resolvers. Add a new prefix here to extend targeting (e.g. "CITY:", "SPEND>").
 * Each resolver receives (argument, contactInfo) and returns true when the contact matches.
 */
const AUDIENCE_RESOLVERS = {
  ALL: () => true,
  ALL_OPTED_IN: () => true,
  TAG: (arg, c) => c.tags.indexOf(arg) >= 0,
  AUDIENCE: (arg, c) => c.audiences.indexOf(arg) >= 0,
  // Plain token: matches the Audience column or a tag (e.g. VIP, LEADS, KOLKATA).
  _DEFAULT: (arg, c) => c.audiences.indexOf(arg) >= 0 || c.tags.indexOf(arg) >= 0,
};

function contactMatchesAudience_(contact, audience) {
  const split = v => String(v || '').split(/[,;|]/).map(s => s.trim().toUpperCase()).filter(Boolean);
  const info = { tags: split(contact['Tags']), audiences: split(contact['Audience']) };
  return String(audience || '').split(',').filter(Boolean).some(token => {
    if (AUDIENCE_RESOLVERS[token]) return AUDIENCE_RESOLVERS[token]('', info);
    const i = token.indexOf(':');
    if (i > 0 && AUDIENCE_RESOLVERS[token.slice(0, i)]) return AUDIENCE_RESOLVERS[token.slice(0, i)](token.slice(i + 1).trim(), info);
    return AUDIENCE_RESOLVERS._DEFAULT(token, info);
  });
}

/** Marketing eligibility. Opt-out (Opt In != YES) always wins over audience selection. */
function isContactEligible_(contact, clientId) {
  return String(contact['Client ID']).trim() === String(clientId).trim() &&
    isYes_(contact['Opt In']) &&
    /^active$/i.test(String(contact['Status'] || '').trim());
}

function countAudience_(clientId, audience) {
  try {
    return readTable_(SHEETS.CONTACTS).rows
      .filter(c => isContactEligible_(c, clientId) && contactMatchesAudience_(c, audience) && normalizePhoneNumber(c['Phone'])).length;
  } catch (err) {
    return 0;
  }
}

/* ============================== CLIENTS ============================== */

/** Finds a client by email (then by business name) or creates one. Returns the client ID. */
function findOrCreateClient_(data) {
  const table = readTable_(SHEETS.CLIENTS);
  const existing = table.rows.find(r => String(r['Client Email']).trim().toLowerCase() === data.email) ||
    table.rows.find(r => String(r['Business Name']).trim().toLowerCase() === data.businessName.toLowerCase());
  const now = new Date();
  if (existing) {
    const updates = { 'Updated At': now };
    if (data.storePhone) updates['Business Phone'] = data.storePhone;
    if (data.website) updates['Website'] = data.website;
    if (data.storeLink) updates['Store Link'] = data.storeLink;
    if (data.businessName) updates['Business Name'] = data.businessName;
    updateFields_(table, existing._row, updates);
    return String(existing['Client ID']);
  }
  const clientId = newClientId_();
  appendObject_(SHEETS.CLIENTS, {
    'Client ID': clientId,
    'Business Name': data.businessName,
    'Client Email': data.email,
    'Business Phone': data.storePhone,
    'Website': data.website,
    'Store Link': data.storeLink || '',
    'Status': 'Active',
    'Created At': now,
    'Updated At': now,
  });
  logEvent_(LOG_LEVEL.INFO, 'CLIENT_CREATED', { clientId: clientId, result: data.businessName });
  return clientId;
}

/* ============================== CAMPAIGN RECORDS ============================== */

function getCampaign_(campaignId) {
  const table = readTable_(SHEETS.CAMPAIGNS);
  return { table: table, row: findRow_(table, 'Campaign ID', campaignId) };
}

function setCampaignStatus_(campaignId, status, note) {
  const c = getCampaign_(campaignId);
  if (!c.row) throw new Error('Campaign ' + campaignId + ' not found.');
  const fields = { 'Status': status, 'Updated At': new Date() };
  if (note) fields['Notes'] = truncate_((c.row['Notes'] ? c.row['Notes'] + '\n' : '') + '[' + nowInTz_('yyyy-MM-dd HH:mm') + '] ' + note, 5000);
  updateFields_(c.table, c.row._row, fields);
  logEvent_(LOG_LEVEL.INFO, 'CAMPAIGN_STATUS', { campaignId: campaignId, clientId: c.row['Client ID'], result: status, details: note || '' });
}

function isDuplicateCampaign_(clientId, data) {
  return readTable_(SHEETS.CAMPAIGNS).rows.some(r =>
    String(r['Client ID']) === clientId &&
    String(r['Campaign Name']).trim().toLowerCase() === data.campaignName.toLowerCase() &&
    String(r['Send Mode']) === data.sendMode &&
    cellDateStr_(r['Schedule Date']) === data.scheduleDate &&
    cellTimeStr_(r['Schedule Time']) === data.scheduleTime &&
    [CAMPAIGN_STATUS.CANCELLED, CAMPAIGN_STATUS.ERROR, CAMPAIGN_STATUS.COMPLETED].indexOf(String(r['Status'])) < 0);
}

/** Scheduled send time of a campaign row, or null. */
function campaignScheduledAt_(row) {
  return buildDateTime_(cellDateStr_(row['Schedule Date']), cellTimeStr_(row['Schedule Time']), String(row['Timezone'] || getConfig_().timezone));
}

/** Schedule cells are stored as plain text, but tolerate Sheets auto-converting them. */
function cellDateStr_(v) {
  return v instanceof Date ? parseDateValue_(v) : String(v || '').trim();
}

function cellTimeStr_(v) {
  return v instanceof Date ? parseTimeValue_(v) : String(v || '').trim();
}

/* ============================== LIFECYCLE ============================== */

/** Builds the queue (if needed) and activates the campaign. */
function startCampaign_(campaignId) {
  const c = getCampaign_(campaignId);
  if (!c.row) throw new Error('Campaign ' + campaignId + ' not found.');
  const status = String(c.row['Status']);
  if ([CAMPAIGN_STATUS.COMPLETED, CAMPAIGN_STATUS.CANCELLED, CAMPAIGN_STATUS.ACTIVE].indexOf(status) >= 0) {
    return { ok: false, message: 'Campaign is ' + status + ' and cannot be started.' };
  }
  const built = buildCampaignQueue_(campaignId);
  const pending = countQueue_(campaignId, [QUEUE_STATUS.PENDING, QUEUE_STATUS.QUEUED]);
  if (!pending) {
    setCampaignStatus_(campaignId, CAMPAIGN_STATUS.ERROR, 'No eligible (opted-in, active) contacts matched audience ' + c.row['Target Audience']);
    return { ok: false, message: 'No eligible contacts matched the audience. Campaign set to ERROR.' };
  }
  setCampaignStatus_(campaignId, CAMPAIGN_STATUS.ACTIVE, 'Started with ' + pending + ' queued message(s) (' + built.added + ' new).');
  return { ok: true, message: 'Campaign ACTIVE with ' + pending + ' queued message(s).' };
}

function pauseCampaign_(campaignId) {
  const c = getCampaign_(campaignId);
  if (!c.row) throw new Error('Campaign ' + campaignId + ' not found.');
  if ([CAMPAIGN_STATUS.ACTIVE, CAMPAIGN_STATUS.SCHEDULED, CAMPAIGN_STATUS.READY].indexOf(String(c.row['Status'])) < 0) {
    return { ok: false, message: 'Only ACTIVE, SCHEDULED or READY campaigns can be paused.' };
  }
  setCampaignStatus_(campaignId, CAMPAIGN_STATUS.PAUSED, 'Paused (was ' + c.row['Status'] + ').');
  return { ok: true, message: 'Campaign paused. Queued messages are kept.' };
}

function resumeCampaign_(campaignId) {
  const c = getCampaign_(campaignId);
  if (!c.row) throw new Error('Campaign ' + campaignId + ' not found.');
  if (String(c.row['Status']) !== CAMPAIGN_STATUS.PAUSED) return { ok: false, message: 'Campaign is not paused.' };
  const pending = countQueue_(campaignId, [QUEUE_STATUS.PENDING, QUEUE_STATUS.QUEUED]);
  const when = campaignScheduledAt_(c.row);
  if (!pending && String(c.row['Send Mode']) === SEND_MODES.SCHEDULE && when && when.getTime() > Date.now()) {
    setCampaignStatus_(campaignId, CAMPAIGN_STATUS.SCHEDULED, 'Resumed; waiting for schedule.');
    return { ok: true, message: 'Campaign resumed and SCHEDULED for ' + when.toISOString() + '.' };
  }
  if (!pending) {
    setCampaignStatus_(campaignId, CAMPAIGN_STATUS.READY, 'Resumed.');
    return startCampaign_(campaignId);
  }
  setCampaignStatus_(campaignId, CAMPAIGN_STATUS.ACTIVE, 'Resumed with ' + pending + ' pending message(s).');
  return { ok: true, message: 'Campaign resumed (' + pending + ' pending).' };
}

function cancelCampaign_(campaignId) {
  const c = getCampaign_(campaignId);
  if (!c.row) throw new Error('Campaign ' + campaignId + ' not found.');
  if ([CAMPAIGN_STATUS.COMPLETED, CAMPAIGN_STATUS.CANCELLED].indexOf(String(c.row['Status'])) >= 0) {
    return { ok: false, message: 'Campaign is already ' + c.row['Status'] + '.' };
  }
  const cancelled = updateQueueStatusWhere_(campaignId, [QUEUE_STATUS.PENDING, QUEUE_STATUS.QUEUED], QUEUE_STATUS.CANCELLED, 'Campaign cancelled');
  setCampaignStatus_(campaignId, CAMPAIGN_STATUS.CANCELLED, 'Cancelled; ' + cancelled + ' unsent message(s) cancelled.');
  return { ok: true, message: 'Campaign cancelled. ' + cancelled + ' unsent message(s) cancelled.' };
}

/**
 * Activates SCHEDULED campaigns whose time has arrived:
 * SCHEDULED -> (build queue) -> ACTIVE. Runs under the scheduler lock, and the status
 * change prevents a second activation.
 */
function activateScheduledCampaigns_() {
  const table = readTable_(SHEETS.CAMPAIGNS);
  const now = Date.now();
  let activated = 0;
  table.rows.filter(r => String(r['Status']) === CAMPAIGN_STATUS.SCHEDULED).forEach(r => {
    const id = String(r['Campaign ID']);
    const when = campaignScheduledAt_(r);
    if (!when) {
      setCampaignStatus_(id, CAMPAIGN_STATUS.ERROR, 'Schedule date/time could not be interpreted.');
      return;
    }
    if (when.getTime() > now) return;
    try {
      setCampaignStatus_(id, CAMPAIGN_STATUS.VALIDATING, 'Schedule reached; building queue.');
      const res = startCampaign_(id);
      if (res.ok) activated++;
    } catch (err) {
      setCampaignStatus_(id, CAMPAIGN_STATUS.ERROR, 'Activation failed: ' + err.message);
    }
  });
  return activated;
}

/** ACTIVE campaigns with nothing left to send become COMPLETED. */
function completeFinishedCampaigns_() {
  const campaigns = readTable_(SHEETS.CAMPAIGNS).rows.filter(r => String(r['Status']) === CAMPAIGN_STATUS.ACTIVE);
  if (!campaigns.length) return;
  const queue = readTable_(SHEETS.MESSAGE_QUEUE).rows;
  const open = {};
  queue.forEach(q => {
    if ([QUEUE_STATUS.PENDING, QUEUE_STATUS.QUEUED, QUEUE_STATUS.PROCESSING].indexOf(String(q['Status'])) >= 0) open[q['Campaign ID']] = true;
  });
  campaigns.forEach(c => {
    if (!open[c['Campaign ID']]) setCampaignStatus_(String(c['Campaign ID']), CAMPAIGN_STATUS.COMPLETED, 'All messages processed.');
  });
}

/* ============================== TEST MESSAGE ============================== */

/**
 * Sends ONE message for a campaign to a single admin-supplied number.
 * Never touches the queue or the campaign audience. Personalised as "TEST CUSTOMER".
 */
function sendTestMessage(campaignId, testPhone) {
  requireAdmin_();
  const interactive = !campaignId;
  const ui = interactive ? SpreadsheetApp.getUi() : null;
  if (interactive) {
    campaignId = promptCampaignId_('Send Test Message');
    if (!campaignId) return;
    const p = ui.prompt('Send Test Message', 'Test phone number (only this number will receive the message):', ui.ButtonSet.OK_CANCEL);
    if (p.getSelectedButton() !== ui.Button.OK) return;
    testPhone = p.getResponseText();
  }
  const report = msg => { if (ui) ui.alert(msg); else console.log(msg); return msg; };

  const cfg = getConfig_(true);
  const v = validateConfig_(cfg);
  if (!v.ok) return report('Cannot send test — configuration errors:\n' + v.errors.join('\n'));

  const c = getCampaign_(campaignId);
  if (!c.row) return report('Campaign ' + campaignId + ' not found.');
  const phone = normalizePhoneNumber(testPhone);
  if (!phone) return report('Invalid test phone number.');

  const contact = { Name: 'TEST CUSTOMER', Phone: phone, Email: '', Company: '' };
  const spec = buildSpecForContact_(c.row, contact, phone);
  const invalid = validateMessageSpec_(spec, cfg);
  if (invalid) return report('Campaign payload invalid: ' + invalid);
  if (spec.imageFileId || spec.imageUrl) {
    const m = resolveMedia_(spec, cfg, {});
    if (!m.ok) return report('Media invalid: ' + m.error);
  }

  // Send from the same number the tenant's campaign would use.
  const r = sendCampaignMessage_(spec, cfgForClient_(clientsById_()[String(c.row['Client ID'])], cfg), {});
  logEvent_(r.success ? LOG_LEVEL.SUCCESS : LOG_LEVEL.ERROR, 'TEST_MESSAGE', {
    campaignId: campaignId, clientId: c.row['Client ID'], phone: phone, messageId: r.messageId,
    httpStatus: r.httpStatus, result: r.success ? (r.fallbackUsed ? 'SENT (text CTA fallback)' : 'SENT') : 'FAILED', error: r.error,
  });
  return report(r.success
    ? 'Test message sent to ' + maskPhone_(phone) + (r.fallbackUsed ? '\n\nNote: Maytapi rejected the button payload; the CTA was sent as a text link. Check LOGS → BUTTON_FALLBACK.' : '') + '\nMessage ID(s): ' + r.messageId
    : 'Test failed (HTTP ' + r.httpStatus + '): ' + r.error);
}
