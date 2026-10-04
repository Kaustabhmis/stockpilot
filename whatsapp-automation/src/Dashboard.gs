/**
 * Dashboard.gs
 * Script-generated summary (refreshed by trigger every 30 min, after menu actions,
 * and on demand via "View Dashboard").
 */

function refreshDashboard() {
  const sheet = getSheet_(SHEETS.DASHBOARD);
  const clients = readTable_(SHEETS.CLIENTS).rows;
  const contacts = readTable_(SHEETS.CONTACTS).rows;
  const campaigns = readTable_(SHEETS.CAMPAIGNS).rows;
  const queue = readTable_(SHEETS.MESSAGE_QUEUE).rows;
  const replies = readTable_(SHEETS.RESPONSES).rows.filter(r => String(r['Event Type']) === 'message');
  const today = todayKey_();

  const st = q => String(q['Status']);
  const delivered = s => s === QUEUE_STATUS.DELIVERED || s === QUEUE_STATUS.READ;
  const sentLike = s => s === QUEUE_STATUS.SENT || delivered(s);

  const kpis = [
    ['Total Clients', clients.length],
    ['Total Contacts', contacts.length],
    ['Opted-In Contacts', contacts.filter(c => isYes_(c['Opt In'])).length],
    ['Active Campaigns', campaigns.filter(c => String(c['Status']) === CAMPAIGN_STATUS.ACTIVE).length],
    ['Scheduled Campaigns', campaigns.filter(c => String(c['Status']) === CAMPAIGN_STATUS.SCHEDULED).length],
    ['Pending Messages', queue.filter(q => [QUEUE_STATUS.PENDING, QUEUE_STATUS.QUEUED, QUEUE_STATUS.PROCESSING].indexOf(st(q)) >= 0).length],
    ['Messages Sent', queue.filter(q => sentLike(st(q))).length],
    ['Messages Failed', queue.filter(q => st(q) === QUEUE_STATUS.FAILED).length],
    ['Messages Delivered', queue.filter(q => delivered(st(q))).length],
    ['Messages Read', queue.filter(q => st(q) === QUEUE_STATUS.READ).length],
    ['Replies', replies.length],
    ["Today's Sent", queue.filter(q => dateKey_(toDate_(q['Sent At'])) === today).length],
    ["Today's Failed", queue.filter(q => st(q) === QUEUE_STATUS.FAILED && dateKey_(toDate_(q['Last Attempt'])) === today).length],
  ];

  const perCampaign = {};
  queue.forEach(q => {
    const id = q['Campaign ID'];
    const p = perCampaign[id] || (perCampaign[id] = { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0 });
    const s = st(q);
    if (s !== QUEUE_STATUS.CANCELLED && s !== QUEUE_STATUS.SKIPPED) p.queued++;
    if (sentLike(s)) p.sent++;
    if (delivered(s)) p.delivered++;
    if (s === QUEUE_STATUS.READ) p.read++;
    if (s === QUEUE_STATUS.FAILED) p.failed++;
  });
  const repliesBy = {};
  replies.forEach(r => { if (r['Campaign ID']) repliesBy[r['Campaign ID']] = (repliesBy[r['Campaign ID']] || 0) + 1; });

  const table = campaigns.slice().reverse().map(c => {
    const p = perCampaign[c['Campaign ID']] || { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
    return [
      c['Campaign ID'] + ' – ' + c['Campaign Name'], c['Client Name'], c['Target Audience'],
      p.queued, p.sent, p.delivered, p.read, p.failed, repliesBy[c['Campaign ID']] || 0, c['Status'],
    ];
  });

  sheet.clear();
  sheet.getRange(1, 1).setValue('WhatsApp Campaign Dashboard').setFontSize(16).setFontWeight('bold');
  sheet.getRange(2, 1).setValue('Updated ' + nowInTz_('yyyy-MM-dd HH:mm') + ' (' + getConfig_().timezone + ')').setFontColor('#666666');

  sheet.getRange(4, 1, 1, 2).setValues([['Metric', 'Value']]).setFontWeight('bold').setBackground('#1f7a4d').setFontColor('#ffffff');
  sheet.getRange(5, 1, kpis.length, 2).setValues(kpis);

  const top = 5 + kpis.length + 2;
  const head = ['Campaign', 'Client', 'Audience', 'Queued', 'Sent', 'Delivered', 'Read', 'Failed', 'Replies', 'Status'];
  sheet.getRange(top, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#1f7a4d').setFontColor('#ffffff');
  if (table.length) sheet.getRange(top + 1, 1, table.length, head.length).setValues(table);

  // Tenants (clients you sell the service to): plan, sending number and usage.
  const used = monthlySentByClient_(queue);
  const tz = getConfig_().timezone;
  const tenantRows = clients.map(c => {
    const id = String(c['Client ID']);
    const ent = tenantEntitlement_(c, used[id] || 0);
    const lastLogin = toDate_(c['Last Login']);
    return [
      id + ' – ' + c['Business Name'], ent.plan || '—', String(c['Status'] || ''),
      String(c['Maytapi Phone ID'] || '').trim() ? 'Dedicated (' + c['Maytapi Phone ID'] + ')' : 'Shared',
      ent.used, ent.quota === null ? 'Unlimited' : ent.quota, ent.remaining === null ? '—' : ent.remaining,
      ent.validUntil || '—', contacts.filter(x => isContactEligible_(x, id)).length,
      lastLogin ? Utilities.formatDate(lastLogin, tz, 'yyyy-MM-dd HH:mm') : '—',
      ent.ok ? 'OK' : ent.reason,
    ];
  });
  const tTop = top + table.length + 3;
  const tHead = ['Tenant', 'Plan', 'Status', 'Sending Number', 'Sent This Month', 'Monthly Quota', 'Remaining', 'Valid Until', 'Opted-In Contacts', 'Last Login', 'Can Send'];
  sheet.getRange(tTop - 1, 1).setValue('Tenants').setFontWeight('bold');
  sheet.getRange(tTop, 1, 1, tHead.length).setValues([tHead]).setFontWeight('bold').setBackground('#1f7a4d').setFontColor('#ffffff');
  if (tenantRows.length) sheet.getRange(tTop + 1, 1, tenantRows.length, tHead.length).setValues(tenantRows);
  sheet.autoResizeColumns(1, 11);
  sheet.setFrozenRows(0);
}

function viewDashboard() {
  requireAdmin_();
  refreshDashboard();
  ss_().setActiveSheet(getSheet_(SHEETS.DASHBOARD));
}
