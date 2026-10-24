// ===========================================================================
// FRESH START — build the whole backend from nothing, in one run
// ===========================================================================
//
// For a new installation with no customer data worth moving. Instead of making
// a Master sheet and a Template sheet by hand, copying their ids into Script
// Properties and editing reminders.gs, run freshStart() once in a NEW Apps
// Script project:
//
//   - a "Domebox" folder in this account's Google Drive
//   - "Domebox Master": the registry every login and payment goes through
//     (Directory, Global_Users, Reset_Tokens, Billing, Invoices)
//   - "Domebox Template": the blank workspace each new company is copied from,
//     with every tab and column the app reads
//   - MASTER_DB_ID, TEMPLATE_ID and the two secret keys, saved in Script
//     Properties
//   - REMINDERS_LIVE, so reminders.gs needs no hand edits
//
// It refuses to run if this project already points at a Master sheet that
// opens, so it can never replace a working installation by accident.
//
// setCustomerPlan() puts a company on a plan by hand — for a customer who paid
// on the old system and has signed up again here.

var FRESH_FOLDER_NAME = 'Domebox';

function freshStart() {
  var p = PropertiesService.getScriptProperties();
  var out = ['', '=== DOMEBOX FRESH START ===', ''];

  /* Never over a working installation. */
  var existing = p.getProperty('MASTER_DB_ID');
  if (existing) {
    var opens = false;
    try { SpreadsheetApp.openById(existing); opens = true; } catch (e) {}
    if (opens) {
      out.push('STOPPED. This project already has a Master sheet (MASTER_DB_ID):');
      out.push('  ' + existing);
      out.push('Nothing was created or changed. freshStart is for a brand-new project.');
      out.push('To check this installation instead, run setupDomeBox.');
      return say_(out);
    }
    out.push('Note: MASTER_DB_ID was set but that file cannot be opened, so a new one is made.');
  }

  var folder = DriveApp.createFolder(FRESH_FOLDER_NAME);
  var put = function (ss) {
    try { DriveApp.getFileById(ss.getId()).moveTo(folder); } catch (e) {}
    return ss;
  };

  /* ---- the Master sheet ---------------------------------------------- */
  var master = put(SpreadsheetApp.create('Domebox Master'));
  p.setProperty('MASTER_DB_ID', master.getId());
  ensureRegistry();
  dropBlankSheets_(master);

  /* ---- the Template sheet -------------------------------------------- */
  var tpl = put(SpreadsheetApp.create('Domebox Template'));
  ensureTenantTabs_(tpl);
  dropBlankSheets_(tpl);
  p.setProperty('TEMPLATE_ID', tpl.getId());

  /* ---- secrets and switches ------------------------------------------- */
  if (!p.getProperty('AUTH_PEPPER'))  p.setProperty('AUTH_PEPPER', Utilities.getUuid() + Utilities.getUuid());
  if (!p.getProperty('TOKEN_SECRET')) p.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  /* reminders.gs reads the Master id and this switch from Script Properties,
     so it can be pasted in exactly as it is. */
  p.setProperty('REMINDERS_LIVE', 'yes');

  out.push('Created in your Google Drive, folder "' + FRESH_FOLDER_NAME + '":');
  out.push('  Domebox Master    ' + master.getUrl());
  out.push('  Domebox Template  ' + tpl.getUrl());
  out.push('');
  out.push('Saved in Script Properties: MASTER_DB_ID, TEMPLATE_ID, AUTH_PEPPER, TOKEN_SECRET, REMINDERS_LIVE.');
  out.push('Do not rename, move to another account, or delete these two sheets.');
  out.push('');
  out.push('NEXT:');
  out.push('  1. Add the files reminders.gs and backup.gs to this project (paste, no edits needed).');
  out.push('  2. Run switchOnSchedules once.');
  out.push('  3. Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).');
  out.push('  4. Run setupDomeBox — it prints your /exec URL and anything still missing.');
  out.push('  5. Run createDemoAccount, so the live demo on the website works.');
  out.push('');
  out.push('Back up AUTH_PEPPER (Project Settings > Script Properties) somewhere safe.');
  return say_(out);
}

/**
 * Every scheduled job in one run: reminders, the morning digest, repeating
 * tasks and renewal notices (reminders.gs), nightly backups (backup.gs) and
 * the monthly move of year-old work to the archive. Safe to run again: each
 * installer replaces its own triggers rather than adding more.
 */
function switchOnSchedules() {
  var out = ['', '=== SCHEDULES ==='];
  if (typeof installDomeBoxSchedules === 'function') {
    installDomeBoxSchedules();
    out.push('  ok      reminders at 9, 3 and 5, the morning digest, repeating tasks, renewal notices');
  } else {
    out.push('  MISSING reminders.gs is not in this project — add it, then run this again.');
  }
  if (typeof installBackupSchedule === 'function') {
    installBackupSchedule();
    out.push('  ok      nightly backups');
  } else {
    out.push('  MISSING backup.gs is not in this project — add it, then run this again.');
  }
  installTaskArchiveSchedule();
  out.push('  ok      year-old work moves to the archive on the 1st of each month');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'reconcilePayments') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('reconcilePayments').timeBased().everyMinutes(15).create();
  out.push('  ok      every 15 minutes, any paid order the page missed is granted (no webhook needed)');
  return say_(out);
}

/** A new spreadsheet comes with an empty first tab; the app has no use for it. */
function dropBlankSheets_(ss) {
  var keep = {};
  [TAB.DIRECTORY, TAB.GLOBAL, TAB.TOKENS, 'Billing', 'Invoices', TAB.USERS, TAB.TASKS, TAB.KRA, TAB.REVIEWS,
   TAB.LEAVE, TAB.COOKIES, TAB.DIRECTION, TAB.GOALS, TAB.NUMBERS, TAB.NUMBER_LOG, TAB.MEETINGS,
   TAB.MEETING_ITEMS, TAB.SETTINGS].forEach(function (n) { keep[n] = true; });
  ss.getSheets().forEach(function (sh) {
    if (keep[sh.getName()]) return;
    if (sh.getLastRow() === 0 && ss.getSheets().length > 1) {
      try { ss.deleteSheet(sh); } catch (e) {}
    }
  });
}

/**
 * Puts a company on a plan by hand, without a payment, a receipt or an invoice.
 * For a customer who paid on the old system and has signed up again here.
 *
 *   setCustomerPlan('owner@client.com', 'Growth Yearly')        // a year from today
 *   setCustomerPlan('owner@client.com', 'Growth', '2027-03-31')  // until a date
 *
 * Plan names: Team, Starter, Growth, Scale (monthly) or Team Yearly, Starter Yearly, Growth Yearly,
 * Scale Yearly, or Enterprise.
 */
function setCustomerPlan(email, planName, untilYmd) {
  var key = String(email || '').trim().toLowerCase();
  if (!key) return say_(['Give the email the company signed up with, e.g. setCustomerPlan(\'owner@client.com\', \'Growth Yearly\').']);
  var plan = normalizePlan(planName);
  if (!PLANS[plan] || plan === 'Free' || String(planName || '').trim() === '') {
    return say_(['Unknown plan "' + planName + '". Use one of: ' + Object.keys(PLANS).filter(function (k) {
      return PLANS[k].offered && k !== 'Free'; }).join(', ') + '.']);
  }
  var until = untilYmd ? parseYmd(String(untilYmd)) : null;
  if (untilYmd && !until) return say_(['The date must look like 2027-03-31.']);
  if (!until) { until = new Date(); until.setDate(until.getDate() + planTermDays(plan)); }

  var dir = SpreadsheetApp.openById(CFG().masterId).getSheetByName(TAB.DIRECTORY);
  var d = dir ? dir.getDataRange().getValues() : [];
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][1]).trim().toLowerCase() !== key) continue;
    dir.getRange(i + 1, 4).setValue(plan);
    dir.getRange(i + 1, 5).setValue(ymd(until));
    dir.getRange(i + 1, 7).setValue('Active');
    return say_(['Done: ' + d[i][0] + ' (' + key + ') is on ' + plan + ' until ' + ymd(until) + '.',
                 'No email, receipt or invoice was sent.']);
  }
  return say_(['No company signed up with ' + key + '. Ask them to sign up first, then run this again.']);
}
