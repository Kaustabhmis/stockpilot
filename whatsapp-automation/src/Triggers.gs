/**
 * Triggers.gs
 * Installable triggers. installTriggers() is idempotent: it never creates duplicates.
 *
 *   onFormSubmit     — installable "On form submit" on this spreadsheet
 *   runScheduler     — every QUEUE_INTERVAL_MINUTES: activate scheduled campaigns + send a batch
 *   refreshDashboard — every 30 minutes
 */

const MANAGED_TRIGGER_HANDLERS = ['onFormSubmit', 'runScheduler', 'refreshDashboard', 'processMessageQueue', 'activateScheduledCampaigns'];

function installTriggers() {
  requireAdmin_();
  const cfg = getConfig_(true);
  const existing = ScriptApp.getProjectTriggers();
  const has = fn => existing.some(t => t.getHandlerFunction() === fn);
  const created = [];

  if (!has('onFormSubmit')) {
    ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss_()).onFormSubmit().create();
    created.push('onFormSubmit (on form submit)');
  }
  if (!has('runScheduler')) {
    const minutes = [1, 5, 10, 15, 30].indexOf(cfg.queueIntervalMinutes) >= 0 ? cfg.queueIntervalMinutes : 5;
    ScriptApp.newTrigger('runScheduler').timeBased().everyMinutes(minutes).create();
    created.push('runScheduler (every ' + minutes + ' min)');
  }
  if (!has('refreshDashboard')) {
    ScriptApp.newTrigger('refreshDashboard').timeBased().everyMinutes(30).create();
    created.push('refreshDashboard (every 30 min)');
  }
  logEvent_(LOG_LEVEL.SUCCESS, 'INSTALL_TRIGGERS', { result: created.length + ' created', details: created.join(', ') || 'all present' });
  const msg = created.length ? 'Installed:\n' + created.join('\n') : 'All triggers already installed.';
  try { SpreadsheetApp.getUi().alert(msg + '\n\n' + describeTriggers_()); } catch (err) { console.log(msg); }
}

function removeTriggers() {
  requireAdmin_();
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (MANAGED_TRIGGER_HANDLERS.indexOf(t.getHandlerFunction()) >= 0) { ScriptApp.deleteTrigger(t); n++; }
  });
  logEvent_(LOG_LEVEL.WARNING, 'REMOVE_TRIGGERS', { result: n + ' removed' });
  try { SpreadsheetApp.getUi().alert(n + ' trigger(s) removed. Campaigns will not send until triggers are reinstalled.'); } catch (err) { console.log(n + ' removed'); }
}

function listTriggers() {
  requireAdmin_();
  const text = describeTriggers_();
  try { SpreadsheetApp.getUi().alert('Project triggers', text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (err) { console.log(text); }
  return text;
}

function describeTriggers_() {
  const list = ScriptApp.getProjectTriggers().map(t => '• ' + t.getHandlerFunction() + ' — ' + String(t.getEventType()));
  return list.length ? 'Current triggers:\n' + list.join('\n') : 'No triggers installed.';
}
