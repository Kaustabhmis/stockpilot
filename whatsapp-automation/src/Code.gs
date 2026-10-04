/**
 * Code.gs
 * Entry points: setupSystem(), the onOpen() menu and menu action wrappers.
 */

/** Simple trigger: adds the "WhatsApp Automation" menu. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('WhatsApp Automation')
    .addItem('Setup System', 'setupSystem')
    .addItem('Set Maytapi Credentials', 'setMaytapiCredentials')
    .addItem('Create Campaign Form', 'createCampaignForm')
    .addSeparator()
    .addItem('Create Client Login', 'createClientLogin')
    .addItem('Reset Client Access Code', 'resetClientAccessCode')
    .addItem('Show Client App URLs', 'showDashboardUrl')
    .addSeparator()
    .addItem('Test Maytapi Connection', 'testMaytapiConnection')
    .addSeparator()
    .addItem('Send Test Message', 'menuSendTestMessage')
    .addItem('Build Campaign Queue', 'menuBuildCampaignQueue')
    .addItem('Start Campaign', 'menuStartCampaign')
    .addItem('Pause Campaign', 'menuPauseCampaign')
    .addItem('Resume Campaign', 'menuResumeCampaign')
    .addItem('Cancel Campaign', 'menuCancelCampaign')
    .addItem('Process Queue Now', 'menuProcessQueueNow')
    .addItem('Retry Failed Messages', 'retryFailedMessages')
    .addItem('Reprocess Form Response', 'reprocessFormResponse')
    .addSeparator()
    .addItem('Install Triggers', 'installTriggers')
    .addItem('Remove Triggers', 'removeTriggers')
    .addItem('List Triggers', 'listTriggers')
    .addItem('Configure Webhook', 'configureWebhook')
    .addItem('View Dashboard', 'viewDashboard')
    .addToUi();
}

/**
 * Creates any missing sheets, headers, settings and starter templates.
 * Never deletes or overwrites existing data; missing columns are appended at the end.
 */
function setupSystem() {
  requireAdmin_();
  const ss = ss_();
  const report = [];

  // FORM_RESPONSES: adopt a linked "Form Responses N" tab if one exists.
  if (!ss.getSheetByName(SHEETS.FORM_RESPONSES)) {
    const linked = ss.getSheets().find(s => { try { return !!s.getFormUrl(); } catch (err) { return false; } });
    if (linked) { linked.setName(SHEETS.FORM_RESPONSES); report.push('Renamed linked form sheet to FORM_RESPONSES'); }
    else {
      const s = ss.insertSheet(SHEETS.FORM_RESPONSES);
      s.getRange(1, 1).setValue('Link the Google Form here (run "Create Campaign Form", or Form → Responses → Link to Sheets, then rename the tab to FORM_RESPONSES).');
      report.push('Created FORM_RESPONSES placeholder');
    }
  }

  Object.keys(HEADERS).forEach(name => {
    let sheet = ss.getSheetByName(name);
    const headers = HEADERS[name];
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      report.push('Created ' + name);
    } else {
      const lastCol = Math.max(sheet.getLastColumn(), 1);
      const current = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
      const missing = headers.filter(h => current.indexOf(h) < 0);
      if (current.every(h => !h)) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        report.push('Added headers to ' + name);
      } else if (missing.length) {
        sheet.getRange(1, sheet.getLastColumn() + 1, 1, missing.length).setValues([missing]);
        report.push(name + ': added columns ' + missing.join(', '));
      }
    }
    styleHeader_(sheet);
  });

  if (!ss.getSheetByName(SHEETS.DASHBOARD)) { ss.insertSheet(SHEETS.DASHBOARD); report.push('Created DASHBOARD'); }

  // Text formats so Sheets doesn't turn phones into numbers or schedules into dates.
  setTextColumns_(SHEETS.CONTACTS, ['Phone', 'Contact ID', 'Client ID']);
  setTextColumns_(SHEETS.CLIENTS, ['Business Phone', 'Maytapi Phone ID', 'Valid Until', 'Access Code Hash']);
  setTextColumns_(SHEETS.CAMPAIGNS, ['Store Phone', 'Schedule Date', 'Schedule Time', 'CTA Value']);
  setTextColumns_(SHEETS.MESSAGE_QUEUE, ['Phone', 'CTA Value', 'Message ID', 'Sender Phone ID']);
  setTextColumns_(SHEETS.RESPONSES, ['Phone', 'Message ID']);
  setTextColumns_(SHEETS.SETTINGS, ['Value']);

  // Seed missing SETTINGS keys (existing values untouched).
  const settings = readTable_(SHEETS.SETTINGS);
  const have = settings.rows.map(r => String(r['Key']).trim());
  const add = SETTINGS_DEFAULTS.filter(d => have.indexOf(d[0]) < 0).map(d => ({ Key: d[0], Value: d[1], Description: d[2] }));
  if (add.length) { appendObjects_(SHEETS.SETTINGS, add); report.push('SETTINGS: added ' + add.length + ' key(s)'); }

  // Starter auto-reply templates (only when TEMPLATES is empty). All generic.
  if (!readTable_(SHEETS.TEMPLATES).rows.length) {
    const starters = [
      ['Offers', 'offer,offers,view offers', 'TEXT', 'Hi {{Name}}! Thanks for your interest in {{ClientName}} offers. Our latest offers are available at {{Website}} or call us at {{StorePhone}}.'],
      ['Store info', 'store,address,location,visit', 'TEXT', 'You can visit {{ClientName}} or browse online at {{Website}}. For directions or appointments call {{StorePhone}}.'],
      ['Call us', 'call,phone,contact', 'BUTTONS', 'Speak to the {{ClientName}} team directly:', '', 'Call Store', 'PHONE', '{{StorePhone}}'],
      ['Help menu', 'hi,hello,help,menu', 'TEXT', 'Hi {{Name}}! Reply OFFER for current offers, STORE for store details, CALL for our phone number, or STOP to unsubscribe.'],
    ];
    const ids = newTemplateIds_(starters.length);
    appendObjects_(SHEETS.TEMPLATES, starters.map((s, i) => ({
      'Template ID': ids[i], 'Template Name': s[0], 'Trigger': s[1], 'Reply Type': s[2], 'Reply Text': s[3],
      'Image URL': s[4] || '', 'Button Text': s[5] || '', 'Button Type': s[6] || '', 'Button Value': s[7] || '', 'Active': 'YES',
    })));
    report.push('TEMPLATES: added starter replies');
  }

  addValidations_();
  refreshDashboard();

  const v = validateConfig_(getConfig_(true));
  logEvent_(LOG_LEVEL.SUCCESS, 'SETUP_SYSTEM', { result: 'OK', details: report.join('; ') });
  const msg = (report.length ? report.join('\n') : 'All sheets already present.') + '\n\n' + formatValidation_(v) +
    '\n\nNext: Set Maytapi Credentials → Create Campaign Form → Deploy Web App → Configure Webhook → Install Triggers.';
  try { SpreadsheetApp.getUi().alert('Setup complete', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (err) { console.log(msg); }
}

function styleHeader_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (!lastCol) return;
  sheet.getRange(1, 1, 1, lastCol).setFontWeight('bold').setBackground('#e8f5e9');
  sheet.setFrozenRows(1);
}

function setTextColumns_(name, headers) {
  const table = readTable_(name);
  headers.forEach(h => {
    if (table.col[h]) table.sheet.getRange(2, table.col[h], Math.max(1, table.sheet.getMaxRows() - 1), 1).setNumberFormat('@');
  });
}

function addValidations_() {
  const list = values => SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(true).build();
  const apply = (name, header, rule) => {
    const t = readTable_(name);
    if (t.col[header]) t.sheet.getRange(2, t.col[header], Math.max(1, t.sheet.getMaxRows() - 1), 1).setDataValidation(rule);
  };
  apply(SHEETS.CONTACTS, 'Opt In', list(['YES', 'NO']));
  apply(SHEETS.CONTACTS, 'Status', list(['Active', 'Inactive']));
  apply(SHEETS.CLIENTS, 'Status', list(['Active', 'Suspended', 'Inactive']));
  apply(SHEETS.CAMPAIGNS, 'Status', list(Object.keys(CAMPAIGN_STATUS)));
  apply(SHEETS.CAMPAIGNS, 'CTA Type', list(CTA_TYPES.concat([''])));
  apply(SHEETS.TEMPLATES, 'Reply Type', list(['TEXT', 'IMAGE', 'BUTTONS']));
  apply(SHEETS.TEMPLATES, 'Button Type', list(CTA_TYPES));
  apply(SHEETS.TEMPLATES, 'Active', list(['YES', 'NO']));
}

/* ============================== MENU WRAPPERS ============================== */

function menuSendTestMessage() { sendTestMessage(); }

function menuBuildCampaignQueue() {
  runCampaignAction_('Build Campaign Queue', id => {
    const r = buildCampaignQueue_(id);
    return r.added + ' message(s) queued. Duplicates skipped: ' + r.duplicates + '. Invalid phones: ' + r.skipped + '.\n(Queue is sent only while the campaign is ACTIVE — use Start Campaign.)';
  });
}

function menuStartCampaign() { runCampaignAction_('Start Campaign', id => startCampaign_(id).message); }
function menuPauseCampaign() { runCampaignAction_('Pause Campaign', id => pauseCampaign_(id).message); }
function menuResumeCampaign() { runCampaignAction_('Resume Campaign', id => resumeCampaign_(id).message); }

function menuCancelCampaign() {
  const ui = SpreadsheetApp.getUi();
  runCampaignAction_('Cancel Campaign', id => {
    if (ui.alert('Cancel ' + id + '?', 'Unsent messages will be cancelled. This cannot be undone.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return 'Not cancelled.';
    return cancelCampaign_(id).message;
  });
}

function menuProcessQueueNow() {
  requireAdmin_();
  const r = processMessageQueue_();
  refreshDashboard();
  SpreadsheetApp.getUi().alert(r.skippedRun ? 'Another queue run is in progress — try again shortly.'
    : r.dailyLimitReached ? 'Daily send limit reached.'
    : r.error ? 'Configuration invalid — see LOGS.'
    : 'Sent: ' + r.sent + ', failed: ' + r.failed + ', scheduled for retry: ' + r.retried + '.');
}

function runCampaignAction_(title, fn) {
  requireAdmin_();
  const ui = SpreadsheetApp.getUi();
  const id = promptCampaignId_(title);
  if (!id) return;
  try {
    const msg = fn(id);
    refreshDashboard();
    ui.alert(title, msg, ui.ButtonSet.OK);
  } catch (err) {
    logEvent_(LOG_LEVEL.ERROR, title.toUpperCase().replace(/\s+/g, '_'), { campaignId: id, error: err.message });
    ui.alert(title, 'Error: ' + err.message, ui.ButtonSet.OK);
  }
}
