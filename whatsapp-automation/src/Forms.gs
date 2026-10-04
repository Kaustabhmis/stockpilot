/**
 * Forms.gs
 * Google Form intake: onFormSubmit (installable trigger) and form generator.
 */

/**
 * Installable "On form submit" trigger (spreadsheet or form). Main campaign entry point.
 * Never throws back to Google: every failure is logged and emailed.
 */
function onFormSubmit(e) {
  let input = null;
  try {
    if (!e) throw new Error('onFormSubmit must be run by its trigger (no event object). Use "Install Triggers".');
    input = readFormInput_(e);
    return createCampaignFromInput_(input, 'FORM');
  } catch (err) {
    logEvent_(LOG_LEVEL.ERROR, 'FORM_SUBMIT_FAILED', { error: err.message, details: err.stack });
    if (input && isValidEmail_(input.email)) {
      sendAttentionEmail_(input, ['We could not process your submission because of a system error. Our team has been notified.']);
    }
    notifyAdmin_('Campaign submission failed', 'Error: ' + err.message + '\n\nInput: ' + safeJson_(input && Object.assign({}, input, { message: truncate_(input.message, 200) })));
    return null;
  }
}

/**
 * Validates and stores one campaign. Shared by onFormSubmit and reprocessFormResponse.
 * @return { ok, campaignId, status, errors, warnings }
 */
function createCampaignFromInput_(input, source) {
  const cfg = getConfig(true);
  const v = validateCampaignInput_(input);
  const d = v.data;

  if (v.errors.length) {
    logEvent_(LOG_LEVEL.WARNING, 'FORM_VALIDATION_FAILED', {
      result: 'REJECTED', error: v.errors.join(' | '),
      details: { business: d.businessName, campaign: d.campaignName, email: d.email ? d.email.replace(/^(.).*(@.*)$/, '$1***$2') : '' },
    });
    if (isValidEmail_(d.email)) sendAttentionEmail_(input, v.errors);
    notifyAdminOfSubmission_(d, null, 'REJECTED', v.errors, v.warnings);
    return { ok: false, errors: v.errors, warnings: v.warnings };
  }

  const clientId = findOrCreateClient_(d);
  if (isDuplicateCampaign_(clientId, d)) {
    const errors = ['A campaign named "' + d.campaignName + '" with the same schedule has already been submitted.'];
    logEvent_(LOG_LEVEL.WARNING, 'DUPLICATE_CAMPAIGN', { clientId: clientId, result: 'REJECTED', error: errors[0] });
    sendAttentionEmail_(input, errors);
    return { ok: false, errors: errors, warnings: v.warnings };
  }

  const campaignId = newCampaignId_();
  const now = new Date();
  const audienceSize = countAudience_(clientId, d.audience);
  const warnings = v.warnings.slice();
  if (!audienceSize) warnings.push('No opted-in active contacts currently match audience "' + d.audience + '". Contacts must be added before the send time.');

  appendObject_(SHEETS.CAMPAIGNS, {
    'Campaign ID': campaignId,
    'Client ID': clientId,
    'Client Name': d.businessName,
    'Campaign Name': d.campaignName,
    'Status': CAMPAIGN_STATUS.VALIDATING,
    'Message': d.message,
    'Image File ID': d.imageFileId,
    'Image URL': '',
    'Website URL': d.website,
    'Store Phone': d.storePhone,
    'CTA Text': d.ctaText,
    'CTA Type': d.ctaType,
    'CTA Value': d.ctaValue,
    'Target Audience': d.audience,
    'Send Mode': d.sendMode,
    'Schedule Date': d.scheduleDate,
    'Schedule Time': d.scheduleTime,
    'Timezone': d.timezone,
    'Created At': now,
    'Updated At': now,
    'Submitted By': d.email,
    'Notes': [d.notes, warnings.length ? 'Warnings: ' + warnings.join(' | ') : ''].filter(Boolean).join('\n'),
  });
  logEvent_(LOG_LEVEL.SUCCESS, 'CAMPAIGN_CREATED', { clientId: clientId, campaignId: campaignId, result: d.sendMode, details: { source: source, audience: d.audience, audienceSize: audienceSize } });

  // Decide the next status.
  let status;
  if (d.sendMode === SEND_MODES.SCHEDULE) {
    status = CAMPAIGN_STATUS.SCHEDULED;
    setCampaignStatus_(campaignId, status, 'Scheduled for ' + d.scheduleDate + ' ' + d.scheduleTime + ' ' + d.timezone + '.');
  } else if (cfg.requireAdminApproval) {
    status = CAMPAIGN_STATUS.READY;
    setCampaignStatus_(campaignId, status, 'Awaiting admin approval (REQUIRE_ADMIN_APPROVAL=YES).');
  } else {
    setCampaignStatus_(campaignId, CAMPAIGN_STATUS.READY, 'Send Now requested.');
    const res = startCampaign(campaignId); // builds the queue; the scheduler trigger sends it
    status = res.ok ? CAMPAIGN_STATUS.ACTIVE : CAMPAIGN_STATUS.ERROR;
    if (!res.ok) warnings.push(res.message);
  }

  const campaign = getCampaign_(campaignId).row;
  sendConfirmationEmail_(campaign, status, warnings);
  notifyAdminOfSubmission_(d, campaignId, status, [], warnings);
  return { ok: true, campaignId: campaignId, status: status, errors: [], warnings: warnings };
}

/**
 * Builds a normalised input object from any of the three event shapes:
 *  - spreadsheet trigger with e.range (typed cell values — preferred)
 *  - spreadsheet trigger with e.namedValues only
 *  - form trigger with e.response (FormResponse)
 */
function readFormInput_(e) {
  const answers = {};
  if (e.range && e.range.getSheet) {
    const sheet = e.range.getSheet();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const values = sheet.getRange(e.range.getRow(), 1, 1, headers.length).getValues()[0];
    headers.forEach((h, i) => { answers[String(h).trim().toLowerCase()] = values[i]; });
  } else if (e.namedValues) {
    Object.keys(e.namedValues).forEach(k => {
      const v = e.namedValues[k];
      answers[String(k).trim().toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
    });
  } else if (e.response && e.response.getItemResponses) {
    e.response.getItemResponses().forEach(ir => {
      const v = ir.getResponse();
      answers[ir.getItem().getTitle().trim().toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
    });
    try { answers['email address'] = e.response.getRespondentEmail(); } catch (err) { /* not collected */ }
  } else {
    throw new Error('Unrecognised form submit event.');
  }

  const get = key => {
    const aliases = FORM_FIELDS[key];
    for (let i = 0; i < aliases.length; i++) {
      const v = answers[aliases[i].toLowerCase()];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return '';
  };
  return {
    businessName: get('businessName'),
    campaignName: get('campaignName'),
    message: get('message'),
    imageRef: get('image'),
    website: get('website'),
    storePhone: get('storePhone'),
    ctaText: get('ctaText'),
    ctaType: get('ctaType'),
    ctaValue: get('ctaValue'),
    audience: get('audience'),
    date: get('date'),
    time: get('time'),
    email: String(get('email') || '').trim(),
    notes: get('notes'),
    sendMode: get('sendMode'),
  };
}

/** Admin tool: re-run campaign creation for a FORM_RESPONSES row (e.g. after fixing contacts). */
function reprocessFormResponse() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Reprocess Form Response', 'Row number in ' + SHEETS.FORM_RESPONSES + ':', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const row = Number(r.getResponseText());
  const sheet = getSheet_(SHEETS.FORM_RESPONSES);
  if (!(row >= 2 && row <= sheet.getLastRow())) return ui.alert('Invalid row.');
  const res = createCampaignFromInput_(readFormInput_({ range: sheet.getRange(row, 1) }), 'REPROCESS');
  ui.alert(res.ok ? 'Created ' + res.campaignId + ' (' + res.status + ')' : 'Rejected:\n' + res.errors.join('\n'));
}

/**
 * Creates the client-facing Google Form linked to this spreadsheet.
 * NOTE: Apps Script's FormApp cannot create File Upload questions. After running this,
 * open the form and add a "File upload" question titled exactly "Campaign Image"
 * (allow: Images, max 1 file, 10 MB). The script then reads it automatically.
 */
function createCampaignForm() {
  const cfg = getConfig(true);
  const ss = ss_();
  const form = FormApp.create('WhatsApp Campaign Request');
  form.setDescription('Submit your WhatsApp marketing campaign. You will receive a confirmation email once it has been validated.')
    .setCollectEmail(false)
    .setConfirmationMessage('Thank you! Your campaign has been submitted. Watch your inbox for the confirmation email.');

  form.addTextItem().setTitle(FORM_FIELDS.businessName[0]).setRequired(true);
  form.addTextItem().setTitle(FORM_FIELDS.campaignName[0]).setRequired(true);
  form.addParagraphTextItem().setTitle(FORM_FIELDS.message[0]).setRequired(true)
    .setHelpText('Personalise with: ' + TEMPLATE_VARIABLES.map(v => '{{' + v + '}}').join(' ') +
      '\nExample: Hi {{Name}}, discover our latest collection. Call us at {{StorePhone}}.');
  form.addSectionHeaderItem().setTitle('Campaign Image')
    .setHelpText('ADMIN: add a "File upload" question titled "Campaign Image" here (FormApp cannot create it automatically).');
  form.addTextItem().setTitle(FORM_FIELDS.website[0]).setRequired(false)
    .setValidation(FormApp.createTextValidation().requireTextIsUrl().setHelpText('Enter a full URL, e.g. https://example.com').build());
  form.addTextItem().setTitle(FORM_FIELDS.storePhone[0]).setRequired(true)
    .setHelpText('Your public business number (used for the Call button and {{StorePhone}}). Include country code if outside +' + cfg.defaultCountryCode + '.');
  form.addTextItem().setTitle(FORM_FIELDS.ctaText[0]).setRequired(false)
    .setHelpText('Button label, max ' + cfg.ctaTextMaxLength + ' characters, e.g. "Explore Collection".');
  form.addMultipleChoiceItem().setTitle(FORM_FIELDS.ctaType[0]).setRequired(true)
    .setChoiceValues(['URL', 'PHONE', 'QUICK_REPLY', 'NONE'])
    .setHelpText('URL opens a link, PHONE calls your store, QUICK_REPLY sends a keyword back, NONE = no button.');
  form.addTextItem().setTitle(FORM_FIELDS.ctaValue[0]).setRequired(false)
    .setHelpText('URL: https://… (blank = Website). PHONE: number (blank = Store Phone). QUICK_REPLY: keyword, e.g. offers.');
  form.addCheckboxItem().setTitle(FORM_FIELDS.audience[0]).setRequired(true)
    .setChoiceValues(cfg.audienceOptions).showOtherOption(true)
    .setHelpText('Use "Other" for TAG:<tag>, e.g. TAG:KOLKATA.');
  form.addMultipleChoiceItem().setTitle(FORM_FIELDS.sendMode[0]).setRequired(true).setChoiceValues(['Send Now', 'Schedule']);
  form.addDateItem().setTitle(FORM_FIELDS.date[0]).setRequired(false).setHelpText('Required when Send Mode = Schedule.');
  form.addTimeItem().setTitle(FORM_FIELDS.time[0]).setRequired(false).setHelpText('Timezone: ' + cfg.timezone + '. Required when Send Mode = Schedule.');
  form.addTextItem().setTitle(FORM_FIELDS.email[0]).setRequired(true)
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().build());
  form.addParagraphTextItem().setTitle(FORM_FIELDS.notes[0]).setRequired(false);

  // Link responses to this spreadsheet and rename the new tab to FORM_RESPONSES.
  const before = ss.getSheets().map(s => s.getSheetId());
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();
  const created = ss_().getSheets().find(s => before.indexOf(s.getSheetId()) < 0);
  if (created) {
    const placeholder = ss.getSheetByName(SHEETS.FORM_RESPONSES);
    if (placeholder && placeholder.getLastRow() <= 1 && !placeholder.getFormUrl()) ss.deleteSheet(placeholder);
    if (!ss.getSheetByName(SHEETS.FORM_RESPONSES)) created.setName(SHEETS.FORM_RESPONSES);
  }

  PropertiesService.getScriptProperties().setProperty('CAMPAIGN_FORM_ID', form.getId());
  logEvent_(LOG_LEVEL.SUCCESS, 'FORM_CREATED', { result: form.getId() });
  const msg = 'Form created.\n\nEdit: ' + form.getEditUrl() + '\nShare with clients: ' + form.getPublishedUrl() +
    '\n\nNEXT STEPS:\n1. Open the edit link and add a "File upload" question titled "Campaign Image" (images only, 1 file).\n2. Run "Install Triggers".';
  try { SpreadsheetApp.getUi().alert(msg); } catch (err) { console.log(msg); }
  return form.getId();
}
