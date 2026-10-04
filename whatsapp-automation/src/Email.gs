/**
 * Email.gs
 * Client confirmations, validation-failure emails and admin notifications.
 * Emails never contain credentials or other clients' data.
 */

function sendConfirmationEmail_(campaign, status, warnings) {
  const cfg = getConfig_();
  const to = String(campaign['Submitted By'] || '').trim();
  if (!isValidEmail_(to)) return;
  const scheduled = String(campaign['Send Mode']) === SEND_MODES.SCHEDULE
    ? cellDateStr_(campaign['Schedule Date']) + ' ' + cellTimeStr_(campaign['Schedule Time']) + ' (' + campaign['Timezone'] + ')'
    : 'Send Now';
  const lines = [
    'Hello ' + campaign['Client Name'] + ',',
    '',
    'Your WhatsApp campaign has been successfully submitted.',
    '',
    'Campaign:',
    String(campaign['Campaign Name']),
    '',
    'Campaign ID:',
    String(campaign['Campaign ID']),
    '',
    'Scheduled:',
    scheduled,
    '',
    'Status:',
    status === CAMPAIGN_STATUS.READY ? 'READY (awaiting final approval)' : status,
  ];
  if (warnings && warnings.length) {
    lines.push('', 'Please note:');
    warnings.forEach(w => lines.push('• ' + w));
  }
  lines.push('', 'Regards,', cfg.systemName);
  safeSendEmail_(to, 'Campaign Submitted – ' + campaign['Campaign Name'], lines.join('\n'));
}

function sendAttentionEmail_(input, problems) {
  const cfg = getConfig_();
  const to = String(input.email || '').trim();
  if (!isValidEmail_(to)) return;
  const lines = [
    'Hello ' + (input.businessName || 'there') + ',',
    '',
    'Your WhatsApp campaign' + (input.campaignName ? ' "' + input.campaignName + '"' : '') + ' could not be accepted yet. Please correct the following and submit the form again:',
    '',
  ];
  problems.forEach(p => lines.push('• ' + p));
  lines.push('', 'Regards,', cfg.systemName);
  safeSendEmail_(to, 'Campaign Submission Requires Attention', lines.join('\n'));
}

function notifyAdminOfSubmission_(d, campaignId, status, errors, warnings) {
  const cfg = getConfig_();
  if (!cfg.notifyAdmin || !cfg.adminEmail) return;
  const lines = [
    'Client: ' + d.businessName + ' <' + d.email + '>',
    'Campaign: ' + d.campaignName,
    'Campaign ID: ' + (campaignId || '—'),
    'Schedule: ' + (d.sendMode === SEND_MODES.SCHEDULE ? d.scheduleDate + ' ' + d.scheduleTime + ' ' + d.timezone : d.sendMode || '—'),
    'Audience: ' + (d.audience || '—'),
    'CTA: ' + (d.ctaType ? d.ctaType + ' "' + d.ctaText + '" → ' + d.ctaValue : 'none'),
    'Website: ' + (d.website || '—'),
    'Store phone: ' + (d.storePhone ? '+' + d.storePhone : '—'),
    'Image: ' + (d.imageFileId ? d.imageName + ' (' + d.imageFileId + ')' : 'none'),
    'Validation result: ' + status,
  ];
  if (errors && errors.length) lines.push('', 'Errors:', ...errors.map(e => '• ' + e));
  if (warnings && warnings.length) lines.push('', 'Warnings:', ...warnings.map(w => '• ' + w));
  lines.push('', 'Spreadsheet: ' + ss_().getUrl());
  safeSendEmail_(cfg.adminEmail, '[WhatsApp Automation] ' + status + ' – ' + (d.campaignName || 'campaign submission'), lines.join('\n'));
}

function notifyAdmin_(subject, body) {
  const cfg = getConfig_();
  if (!cfg.adminEmail) return;
  safeSendEmail_(cfg.adminEmail, '[WhatsApp Automation] ' + subject, redactSecrets_(body) + '\n\nSpreadsheet: ' + ss_().getUrl());
}

function safeSendEmail_(to, subject, body) {
  try {
    if (MailApp.getRemainingDailyQuota() < 1) {
      logEvent_(LOG_LEVEL.WARNING, 'EMAIL_QUOTA', { error: 'Mail quota exhausted; email to ' + to.replace(/^(.).*(@.*)$/, '$1***$2') + ' not sent.' });
      return false;
    }
    MailApp.sendEmail({ to: to, subject: subject, body: body, name: getConfig_().systemName });
    return true;
  } catch (err) {
    logEvent_(LOG_LEVEL.ERROR, 'EMAIL_FAILED', { error: err.message, details: subject });
    return false;
  }
}
