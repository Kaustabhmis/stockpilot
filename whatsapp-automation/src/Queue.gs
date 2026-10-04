/**
 * Queue.gs
 * Queue building, batch processing with locking, throttling, retries and the scheduler.
 */

const MAX_EXECUTION_MS = 4.5 * 60 * 1000;     // stay well below Apps Script's 6-minute limit
const STUCK_PROCESSING_MS = 15 * 60 * 1000;   // PROCESSING rows older than this were interrupted

/**
 * Creates personalised MESSAGE_QUEUE rows for every eligible contact of a campaign.
 * Eligible = same Client ID, Opt In = YES, Status = Active, valid phone, audience match.
 * Duplicates (same campaign + phone) are never queued twice.
 * @return { added, skipped, duplicates }
 */
function buildCampaignQueue(campaignId) {
  const cfg = getConfig();
  const c = getCampaign_(campaignId);
  if (!c.row) throw new Error('Campaign ' + campaignId + ' not found.');
  const campaign = c.row;
  if ([CAMPAIGN_STATUS.CANCELLED, CAMPAIGN_STATUS.COMPLETED].indexOf(String(campaign['Status'])) >= 0) {
    throw new Error('Campaign ' + campaignId + ' is ' + campaign['Status'] + '.');
  }
  const clientId = String(campaign['Client ID']);
  const audience = String(campaign['Target Audience']);

  const existing = {};
  readTable_(SHEETS.MESSAGE_QUEUE).rows.forEach(q => {
    if (String(q['Campaign ID']) === campaignId) existing[normalizePhoneNumber(q['Phone'])] = true;
  });

  const contacts = readTable_(SHEETS.CONTACTS).rows;
  const now = new Date();
  const items = [];
  let skipped = 0;
  let duplicates = 0;
  const ctaType = String(campaign['CTA Type'] || '').toUpperCase();

  contacts.forEach(contact => {
    if (!isContactEligible_(contact, clientId) || !contactMatchesAudience_(contact, audience)) return;
    const phone = normalizePhoneNumber(contact['Phone'], cfg.defaultCountryCode);
    if (!phone) { skipped++; return; }
    if (existing[phone]) { duplicates++; return; }
    existing[phone] = true;
    const spec = buildSpecForContact_(campaign, contact, phone);
    items.push({
      'Campaign ID': campaignId,
      'Client ID': clientId,
      'Contact ID': contact['Contact ID'],
      'Phone': phone,
      'Name': contact['Name'],
      'Rendered Message': spec.text,
      'Image File ID': campaign['Image File ID'],
      'Image URL': campaign['Image URL'],
      'CTA Type': spec.cta ? ctaType : '',
      'CTA Text': spec.cta ? spec.cta.text : '',
      'CTA Value': spec.cta ? spec.cta.value : '',
      'Status': QUEUE_STATUS.PENDING,
      'Attempts': 0,
      'Scheduled At': now,
      'Created At': now,
    });
  });

  if (items.length) {
    const ids = newQueueIds_(items.length);
    items.forEach((it, i) => { it['Queue ID'] = ids[i]; });
    appendObjects_(SHEETS.MESSAGE_QUEUE, items);
  }
  logEvent_(LOG_LEVEL.INFO, 'QUEUE_BUILT', {
    campaignId: campaignId, clientId: clientId, result: items.length + ' queued',
    details: { added: items.length, invalidPhones: skipped, duplicates: duplicates, audience: audience },
  });
  return { added: items.length, skipped: skipped, duplicates: duplicates };
}

function countQueue_(campaignId, statuses) {
  return readTable_(SHEETS.MESSAGE_QUEUE).rows
    .filter(q => String(q['Campaign ID']) === campaignId && statuses.indexOf(String(q['Status'])) >= 0).length;
}

/** Bulk status change for one campaign (or all campaigns when campaignId is '*'). Returns count. */
function updateQueueStatusWhere_(campaignId, fromStatuses, toStatus, error) {
  const table = readTable_(SHEETS.MESSAGE_QUEUE);
  let n = 0;
  table.rows.forEach(q => {
    if ((campaignId === '*' || String(q['Campaign ID']) === campaignId) && fromStatuses.indexOf(String(q['Status'])) >= 0) {
      q['Status'] = toStatus;
      if (error !== undefined) q['Error'] = error;
      writeRowObject_(table, q);
      n++;
    }
  });
  return n;
}

/**
 * Sends up to BATCH_SIZE due messages. Safe to call from a trigger every minute:
 * a script lock prevents overlapping executions.
 */
function processMessageQueue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    console.log('processMessageQueue: another execution holds the lock; skipping.');
    return { sent: 0, skippedRun: true };
  }
  try {
    return processMessageQueueLocked_();
  } finally {
    lock.releaseLock();
  }
}

function processMessageQueueLocked_() {
  const started = Date.now();
  const cfg = getConfig(true);
  const v = validateConfig(cfg);
  if (!v.ok) {
    logEvent_(LOG_LEVEL.ERROR, 'QUEUE_CONFIG_INVALID', { error: v.errors.join(' ') });
    return { sent: 0, error: 'config' };
  }

  const queue = readTable_(SHEETS.MESSAGE_QUEUE);
  const campaigns = {};
  readTable_(SHEETS.CAMPAIGNS).rows.forEach(r => { campaigns[r['Campaign ID']] = r; });
  const contactsTable = readTable_(SHEETS.CONTACTS);
  const contacts = {};
  contactsTable.rows.forEach(r => { contacts[r['Contact ID']] = r; });

  // Recover rows left in PROCESSING by an execution that died (timeout/crash).
  // Delivery is unknown, so they are marked FAILED (not resent automatically) to avoid duplicates.
  queue.rows.forEach(q => {
    const startedAt = toDate_(q['Started At']);
    if (String(q['Status']) === QUEUE_STATUS.PROCESSING && (!startedAt || Date.now() - startedAt.getTime() > STUCK_PROCESSING_MS)) {
      q['Status'] = QUEUE_STATUS.FAILED;
      q['Error'] = 'INTERRUPTED: execution stopped mid-send; delivery unknown. Use "Retry Failed Messages" to resend.';
      writeRowObject_(queue, q);
      logEvent_(LOG_LEVEL.WARNING, 'QUEUE_INTERRUPTED', { campaignId: q['Campaign ID'], contactId: q['Contact ID'], phone: q['Phone'] });
    }
  });

  const today = todayKey_();
  const sentToday = queue.rows.filter(q => dateKey_(toDate_(q['Sent At'])) === today).length;
  let dailyRemaining = cfg.dailySendLimit - sentToday;
  if (dailyRemaining <= 0) {
    console.log('Daily send limit reached (' + cfg.dailySendLimit + ').');
    return { sent: 0, dailyLimitReached: true };
  }

  const now = Date.now();
  const due = queue.rows.filter(q => {
    const st = String(q['Status']);
    if (st !== QUEUE_STATUS.PENDING && st !== QUEUE_STATUS.QUEUED) return false;
    const camp = campaigns[q['Campaign ID']];
    if (!camp || String(camp['Status']) !== CAMPAIGN_STATUS.ACTIVE) return false;
    const at = toDate_(q['Scheduled At']);
    return !at || at.getTime() <= now;
  }).sort((a, b) => (toDate_(a['Scheduled At']) || 0) - (toDate_(b['Scheduled At']) || 0));

  const batch = due.slice(0, Math.min(cfg.batchSize, dailyRemaining));
  const mediaCache = {};
  let sent = 0, failed = 0, retried = 0;

  for (let i = 0; i < batch.length; i++) {
    if (Date.now() - started > MAX_EXECUTION_MS) {
      logEvent_(LOG_LEVEL.WARNING, 'QUEUE_TIME_BUDGET', { details: 'Stopping early to avoid the Apps Script timeout; next run continues.' });
      break;
    }
    const q = batch[i];
    const campaign = campaigns[q['Campaign ID']];
    const ctx = { campaignId: q['Campaign ID'], clientId: q['Client ID'], contactId: q['Contact ID'], phone: q['Phone'] };

    // Opt-out always wins, even after queueing.
    const contact = contacts[q['Contact ID']];
    // Re-read Opt In right before sending so an opt-out received mid-batch is honoured.
    if (contact) contact['Opt In'] = contactsTable.sheet.getRange(contact._row, contactsTable.col['Opt In']).getValue();
    if (!contact || !isYes_(contact['Opt In']) || !/^active$/i.test(String(contact['Status'] || ''))) {
      q['Status'] = QUEUE_STATUS.SKIPPED;
      q['Error'] = 'Contact opted out, inactive or deleted before send.';
      writeRowObject_(queue, q);
      logEvent_(LOG_LEVEL.WARNING, 'SEND_SKIPPED', Object.assign({ result: 'SKIPPED', error: q['Error'] }, ctx));
      continue;
    }

    q['Status'] = QUEUE_STATUS.PROCESSING;
    q['Started At'] = new Date();
    q['Last Attempt'] = new Date();
    q['Attempts'] = Number(q['Attempts'] || 0) + 1;
    writeRowObject_(queue, q);
    SpreadsheetApp.flush();

    let r;
    try {
      r = sendCampaignMessage_({
        phone: q['Phone'],
        text: q['Rendered Message'],
        imageFileId: q['Image File ID'],
        imageUrl: q['Image URL'],
        cta: q['CTA Type'] ? { type: q['CTA Type'], text: q['CTA Text'], value: q['CTA Value'] } : null,
      }, cfg, mediaCache);
    } catch (err) {
      r = Object.assign(failResult_(0, 'Unexpected error: ' + err.message, { retryable: true }), { messageIds: [] });
    }

    if (r.success) {
      q['Status'] = QUEUE_STATUS.SENT;
      q['Sent At'] = new Date();
      q['Message ID'] = r.messageId;
      q['Error'] = r.fallbackUsed ? 'Buttons rejected by API; CTA sent as text.' : '';
      writeRowObject_(queue, q);
      updateFields_(contactsTable, contact._row, { 'Last Sent': new Date(), 'Last Message ID': r.messageId, 'Updated At': new Date() });
      sent++;
      dailyRemaining--;
      logEvent_(LOG_LEVEL.SUCCESS, 'MESSAGE_SENT', Object.assign({ messageId: r.messageId, httpStatus: r.httpStatus, result: 'SENT' }, ctx));
    } else {
      const attempts = Number(q['Attempts']);
      q['Error'] = truncate_(r.error, 1000);
      if (r.rateLimited) {
        q['Status'] = QUEUE_STATUS.QUEUED;
        q['Attempts'] = attempts - 1; // rate limiting is not the message's fault
        q['Scheduled At'] = new Date(Date.now() + cfg.retryBaseMinutes * 60000);
        retried++;
      } else if (r.retryable && !r.partial && attempts < cfg.maxRetries) {
        q['Status'] = QUEUE_STATUS.QUEUED;
        q['Scheduled At'] = new Date(Date.now() + cfg.retryBaseMinutes * Math.pow(2, attempts - 1) * 60000);
        retried++;
      } else {
        q['Status'] = QUEUE_STATUS.FAILED;
        if (r.partial) q['Error'] = 'PARTIAL: image sent, text/CTA failed — ' + q['Error'];
        if (r.messageId) q['Message ID'] = r.messageId;
        failed++;
      }
      writeRowObject_(queue, q);
      logEvent_(q['Status'] === QUEUE_STATUS.FAILED ? LOG_LEVEL.ERROR : LOG_LEVEL.WARNING, 'MESSAGE_FAILED', Object.assign({
        httpStatus: r.httpStatus, result: q['Status'], error: r.error,
        details: { attempts: attempts, retryable: !!r.retryable, rateLimited: !!r.rateLimited, partial: !!r.partial },
      }, ctx));

      if (r.stopBatch) {
        logEvent_(LOG_LEVEL.ERROR, 'QUEUE_BATCH_STOPPED', Object.assign({ error: r.error, details: r.authError ? 'Authentication problem — check Maytapi credentials.' : 'Rate limit or sending-phone problem — will resume on next run.' }, ctx));
        if (r.authError) notifyAdmin_('Maytapi authentication error', 'Queue processing stopped: ' + r.error);
        break;
      }
    }

    if (i < batch.length - 1) randomDelay_(cfg);
  }

  completeFinishedCampaigns_();
  if (batch.length) console.log('Queue run: sent=' + sent + ' failed=' + failed + ' retry=' + retried);
  return { sent: sent, failed: failed, retried: retried };
}

/**
 * Resets FAILED messages to PENDING (attempts cleared) for one campaign or all ('*').
 * Re-activates COMPLETED campaigns that get messages back.
 */
function retryFailedMessages(campaignId) {
  const interactive = campaignId === undefined;
  if (interactive) {
    const ui = SpreadsheetApp.getUi();
    const r = ui.prompt('Retry Failed Messages', 'Campaign ID (or * for all campaigns):', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    campaignId = r.getResponseText().trim() || '*';
  }
  const table = readTable_(SHEETS.MESSAGE_QUEUE);
  const touched = {};
  let n = 0;
  table.rows.forEach(q => {
    if (String(q['Status']) !== QUEUE_STATUS.FAILED) return;
    if (campaignId !== '*' && String(q['Campaign ID']) !== campaignId) return;
    if (/^Invalid recipient/i.test(String(q['Error']))) return; // permanent: bad number
    q['Status'] = QUEUE_STATUS.PENDING;
    q['Attempts'] = 0;
    q['Scheduled At'] = new Date();
    q['Error'] = '';
    writeRowObject_(table, q);
    touched[q['Campaign ID']] = true;
    n++;
  });
  const campaigns = readTable_(SHEETS.CAMPAIGNS);
  Object.keys(touched).forEach(id => {
    const row = findRow_(campaigns, 'Campaign ID', id);
    if (row && [CAMPAIGN_STATUS.COMPLETED, CAMPAIGN_STATUS.ERROR].indexOf(String(row['Status'])) >= 0) {
      setCampaignStatus_(id, CAMPAIGN_STATUS.ACTIVE, 'Re-activated to retry failed messages.');
    }
  });
  logEvent_(LOG_LEVEL.INFO, 'RETRY_FAILED', { campaignId: campaignId === '*' ? '' : campaignId, result: n + ' reset' });
  if (interactive) SpreadsheetApp.getUi().alert(n + ' failed message(s) reset to PENDING.');
  return n;
}

/**
 * Time-driven entry point: activates due scheduled campaigns, then sends a batch.
 * Holds the script lock for both steps so two runs never activate the same campaign.
 */
function runScheduler() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    try {
      const n = activateScheduledCampaigns();
      if (n) logEvent_(LOG_LEVEL.INFO, 'SCHEDULER', { result: n + ' campaign(s) activated' });
    } catch (err) {
      logEvent_(LOG_LEVEL.ERROR, 'SCHEDULER_ACTIVATE', { error: err.message });
    }
    processMessageQueueLocked_();
  } catch (err) {
    logEvent_(LOG_LEVEL.ERROR, 'SCHEDULER', { error: err.message, details: err.stack });
  } finally {
    lock.releaseLock();
  }
}
