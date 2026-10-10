// ===========================================================================
// DEMO WORKSPACE
// ===========================================================================
/**
 * DOME BOX — A DEMO ACCOUNT, BUILT FROM THE REAL PRODUCT
 * =============================================================================
 * Run createDemoAccount() once in the Apps Script editor. It prints a login.
 *
 * WHY IT SEEDS WORK RATHER THAN JUST CREATING A LOGIN
 *
 * An empty workspace demonstrates nothing. The things worth showing a
 * prospect — the score and the working behind it, the leaderboard, the
 * priority list, a project releasing its next stage, an appraisal with real
 * KRAs — all need history to exist at all. A fresh signup shows five empty
 * boards and a score of "no data", which is the worst possible first look at a
 * product whose whole argument is that it measures delivery.
 *
 * So this builds a month of plausible work: eight people in a real reporting
 * line, forty-odd tasks closed at different times against different deadlines,
 * some late, some reworked, a two-stage project mid-flight, cookie points, a
 * leave entry, and KRAs on every profile.
 *
 * EVERYTHING GOES THROUGH THE REAL CODE PATHS
 *
 * registerCompany_, addUser_, createTask_, updateTask_, createProject_,
 * awardCookie_ — the same functions the API calls. Nothing is written straight
 * into a sheet. A demo built by poking rows into a spreadsheet drifts from the
 * product within one release and starts showing things the product cannot
 * actually do; this one cannot, because if it stops working the product has
 * stopped working.
 *
 * IT IS A REAL TENANT
 *
 * Not a special case, not a mode, no flag the rest of the code has to know
 * about. It is an ordinary company on the top plan, which is the only honest
 * way to demo: whatever a prospect sees, they get.
 *
 * To remove it afterwards: deleteDemoAccount() prints what it would remove,
 * and takes true to actually do it.
 * =============================================================================
 */

var DEMO_EMAIL    = 'demo@biscsindia.com';
var DEMO_PASSWORD = 'DomeBoxDemo2026';
var DEMO_COMPANY  = 'Dome Box Demo — Sharma Precision Works';
/* Enterprise: every cap lifted, every feature on. A demo on a plan that hides
   half the product sells half the product. */
var DEMO_PLAN     = 'Enterprise';
var DEMO_DAYS     = 365;

/**
 * @param {string=} email     defaults to DEMO_EMAIL
 * @param {string=} password  defaults to DEMO_PASSWORD, minimum 8 characters
 */
function createDemoAccount(email, password) {
  var out = ['', '=== DOME BOX DEMO ACCOUNT ===', ''];
  email = String(email || DEMO_EMAIL).trim().toLowerCase();
  password = String(password || DEMO_PASSWORD);

  /* Every path returns the report as well as logging it, so this is usable
     from a test and from another function, not only from the editor. */
  var say = function (lines) { var t = lines.join('\n'); Logger.log(t); return t; };

  var c = CFG();
  if (!c.masterId || !c.templateId) {
    return say(out.concat(['MASTER_DB_ID and TEMPLATE_ID must be set first. Run setupDomeBox().']));
  }
  if (password.length < 8) {
    return say(out.concat(['The password must be at least 8 characters.']));
  }

  /* Refuse rather than build a second one. Two demo companies on the same
     address is how a sales call ends up logged into last quarter's data. */
  var existing = null;
  try {
    var dir = SpreadsheetApp.openById(c.masterId).getSheetByName(TAB.DIRECTORY);
    var d = dir.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][1]).trim().toLowerCase() === email) existing = { company: d[i][0], plan: d[i][3], until: d[i][4] };
    }
  } catch (e) {}
  if (existing) {
    out.push('A workspace already exists on ' + email + ':');
    out.push('  ' + existing.company + ' — ' + existing.plan + ', valid to ' + existing.until);
    out.push('');
    out.push('Sign in with it, or run removeDemoAccount first and then this again.');
    return say(out);
  }

  /* ---- the company, through the signup the public uses ------------------ */
  var reg = registerCompany_({ companyName: DEMO_COMPANY, name: 'Anil Sharma',
                               email: email, password: password });
  var sheetId = requireSession(reg.token).sheetId;
  out.push('Workspace created.');

  /* ---- the plan -------------------------------------------------------- */
  grantDemoPlan_(sheetId, DEMO_PLAN, DEMO_DAYS);
  out.push('Plan: ' + DEMO_PLAN + ', ' + DEMO_DAYS + ' days.');

  /* The context has to be rebuilt after the grant, or every cap check below
     still sees the Free plan this workspace was one second ago. */
  var ctx = tenantContext_(requireSession(login_(email, password).token));

  /* ---- the team -------------------------------------------------------- */
  var TEAM = [
    ['Sruti Charulata',  'sruti',  'HOD',  '',       'Operations',  'Operations Head'],
    ['Imran Qureshi',    'imran',  'HOD',  '',       'Quality',     'Quality Head'],
    ['Payel Sanyamath',  'payel',  'Doer', 'sruti',  'Operations',  'Executive'],
    ['Vikram Rathore',   'vikram', 'Doer', 'sruti',  'Operations',  'Executive'],
    ['Nita Bose',        'nita',   'Doer', 'imran',  'Quality',     'Executive'],
    ['Rafiq Ahmed',      'rafiq',  'Doer', 'imran',  'Quality',     'Technician'],
    ['Meera Iyer',       'meera',  'Doer', 'sruti',  'Stores',      'Storekeeper'],
  ];
  TEAM.forEach(function (t) {
    try {
      addUser_(ctx, { name: t[0], username: t[1], email: t[1] + '@demo.domebox.in',
        role: t[2], manager: t[3], dept: t[4], jobProfile: t[5],
        password: 'DemoStaff2026', wipLimit: 6 });
    } catch (e) { out.push('  could not add ' + t[0] + ': ' + e.message); }
  });
  dropCache_(ctx);
  out.push('Team: ' + (readUsers_(ctx).length) + ' people, in a real reporting line.');

  /* ---- a month of work ------------------------------------------------- */
  var made = seedDemoWork_(ctx);
  out.push('Work: ' + made.closed + ' closed, ' + made.open + ' in flight, ' +
           made.late + ' delivered late, ' + made.reworked + ' sent back once.');

  /* ---- a project mid-flight -------------------------------------------- */
  try {
    createProject_(ctx, { name: 'ISO 9001 surveillance audit',
      stages: [
        { title: 'Close last audit NCs', assignTo: 'nita',  dueDate: demoYmd_(-6), priority: 'High' },
        { title: 'Internal audit round', assignTo: 'imran', dueDate: demoYmd_(4),  priority: 'Critical' },
        { title: 'Management review',    assignTo: 'sruti', dueDate: demoYmd_(14), priority: 'High' },
      ] });
    out.push('Project: a three-stage audit, stage one already released.');
  } catch (e) { out.push('  project: ' + e.message); }

  /* ---- recognition, leave, KRAs ---------------------------------------- */
  try {
    awardCookie_(ctx, { employee: 'payel', points: 4,
      reason: 'Stayed back to clear the despatch backlog before the audit' });
    awardCookie_(ctx, { employee: 'rafiq', points: 2,
      reason: 'Caught the calibration drift nobody else had noticed' });
    out.push('Recognition: two cookie awards on the record.');
  } catch (e) { out.push('  cookies: ' + e.message); }

  /* ---- purpose, values, goals, numbers, one weekly review --------------- */
  try { seedDemoDirection_(ctx, out); } catch (e) { out.push('  goals: ' + e.message); }

  try {
    setLeave_(ctx, 'meera', demoYmd_(-3), demoYmd_(-1), 'Family function');
    out.push('Leave: one entry, so the demo shows deadlines that respect it.');
  } catch (e) { out.push('  leave: ' + e.message); }

  /* Measurable, not aspirational. "Improve quality" cannot be rated by anyone
     in good faith; "repeat NCs in the surveillance audit, target 0" can, and
     an appraisal screen full of the first kind is what makes people distrust
     the whole exercise. */
  var KRA_SETS = {
    exec: [
      { item: 'On-time despatch', desc: 'Orders leave on the promised date', weight: 40,
        measured: 'Despatches on or before the committed date', target: '95', unit: '%' },
      { item: 'First-pass quality', desc: 'Work accepted without being sent back', weight: 35,
        measured: 'Jobs verified without a rework loop', target: '90', unit: '%' },
      { item: 'Housekeeping', desc: '5S in the allotted bay', weight: 25,
        measured: 'Weekly 5S audit score out of 5', target: '4' },
    ],
    quality: [
      { item: 'Audit readiness', desc: 'No repeat non-conformities', weight: 50,
        measured: 'Repeat NCs raised in the surveillance audit', target: '0',
        direction: 'lower is better' },
      { item: 'Review turnaround', desc: 'Work does not sit waiting on quality', weight: 50,
        measured: 'Items cleared within the review SLA', target: '90', unit: '%' },
    ],
  };
  [['payel', 'exec'], ['vikram', 'exec'], ['meera', 'exec'], ['rafiq', 'exec'],
   ['nita', 'quality'], ['imran', 'quality'], ['sruti', 'quality']].forEach(function (pair) {
    try { saveKra_(ctx, { employee: pair[0], kras: KRA_SETS[pair[1]] }); }
    catch (e) { out.push('  KRAs: ' + pair[0] + ' — ' + e.message); }
  });
  out.push('KRAs: measurable ones on every person, so the appraisal has numbers.');

  /* ---- what to do with it ---------------------------------------------- */
  var url = '';
  try { url = ScriptApp.getService().getUrl() ? CFG().siteUrl : ''; } catch (e) {}

  out.push('');
  out.push('=== SIGN IN ===');
  out.push('  Site      ' + (url || CFG().siteUrl));
  out.push('  Email     ' + email);
  out.push('  Password  ' + password);
  out.push('');
  out.push('  Any team member:  <username>@demo.domebox.in  /  DemoStaff2026');
  out.push('  e.g. payel@demo.domebox.in — the Doer view, which is the one worth');
  out.push('  showing second: the same data, only their own work, and a score');
  out.push('  they can open and argue with.');
  out.push('');
  out.push('Worth opening in this order on a call:');
  out.push('  1. Tasks     — the board, then one card: history, rework, who is waiting');
  out.push('  2. Priority  — what to do today, and WHY each row is where it is');
  out.push('  3. Board     — the leaderboard, top to bottom, for the month');
  out.push('  4. Reports   — the score, then "see why" for the full working');
  out.push('  5. Projects  — a stage releasing the next one automatically');
  out.push('  6. Goals     — purpose, values, goals with the work behind them');
  out.push('  7. Meetings  — last week\'s review: wins, roadblocks, actions');
  out.push('');
  out.push('No email was sent to anyone: the addresses are @demo.domebox.in,');
  out.push('which does not exist, so nothing can reach a real inbox by accident.');
  out.push('');
  out.push('To remove it:  run removeDemoAccount');
  return say(out);
}

/** Calendar offset of the date N working days (Mon–Fri) before today. */
function demoWorkdaysBack_(n) {
  var d = new Date(), back = 0;
  while (n > 0) { d.setDate(d.getDate() - 1); back++; if (d.getDay() !== 0 && d.getDay() !== 6) n--; }
  return back;
}

/** The offset moved back, if it lands on a weekend, to the Friday before. */
function demoWeekdayOnOrBefore_(offset) {
  var d = new Date(); d.setDate(d.getDate() + offset);
  while (d.getDay() === 0 || d.getDay() === 6) { d.setDate(d.getDate() - 1); offset--; }
  return offset;
}

/** ymd this many days from today. Negative is the past. */
function demoYmd_(offset) {
  var d = new Date();
  d.setDate(d.getDate() + Number(offset || 0));
  return ymd(d);
}

/**
 * Grants a plan without going near Razorpay. Separate from grantPlan_ so the
 * demo cannot accidentally issue an invoice for a payment that never happened —
 * an invoice in a numbered series for ₹0 is a real problem, not a cosmetic one.
 */
function grantDemoPlan_(sheetId, planName, days) {
  return withLock_(function () {
    var dir = SpreadsheetApp.openById(CFG().masterId).getSheetByName(TAB.DIRECTORY);
    var d = dir.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][5]).trim() !== String(sheetId).trim()) continue;
      var until = new Date();
      until.setDate(until.getDate() + Number(days || 365));
      dir.getRange(i + 1, 4).setValue(planName);
      dir.getRange(i + 1, 5).setValue(ymd(until));
      dir.getRange(i + 1, 7).setValue('Active');
      return ymd(until);
    }
    throw new Error('The demo workspace is not in the registry.');
  });
}

/**
 * A month of work, through createTask_ and updateTask_ exactly as a person
 * would. The spread is deliberate: without late deliveries and rework loops
 * every score is 100 and the whole argument of the product is invisible.
 */
/**
 * The direction a demo is worth showing: a purpose, four values, a year goal
 * with two quarter goals under it and real work linked to them, three key
 * numbers with six weeks of history, and one finished weekly review.
 *
 * The review is ended QUIETLY. Ending a meeting emails its summary to everyone
 * who was there, and the demo's Admin address is a real inbox.
 */
function seedDemoDirection_(ctx, out) {
  saveDirection_(ctx, { purpose: 'Parts that fit first time, delivered on the day we promised.',
    values: [
      { code: 'OWN', title: 'Own it', detail: 'If it is yours, it is finished or it is flagged — never left.' },
      { code: 'FIT', title: 'Right first time', detail: 'Check before it leaves the bench, not after it leaves the gate.' },
      { code: 'DAY', title: 'Keep the date', detail: 'A promised date is a promise. Say early if it will slip.' },
      { code: 'TEA', title: 'Help the next desk', detail: 'Your output is someone else’s input. Hand it over clean.' },
    ] });

  var fy = fyPeriod_(new Date(), fyStartMonth_(ctx));
  var year = saveGoal_(ctx, { level: 'year', period: fy.year, owner: ctx.actor.username,
    title: 'Win two new OEM accounts without a single repeat NC',
    detail: 'Growth only counts if the audit stays clean while it happens.' }).id;
  var qDespatch = saveGoal_(ctx, { level: 'quarter', period: fy.quarter, parent: year, owner: 'sruti',
    title: 'On-time despatch at 95% or better',
    detail: 'Measured weekly on the Key numbers. Every miss gets a roadblock.' }).id;
  var qAudit = saveGoal_(ctx, { level: 'quarter', period: fy.quarter, parent: year, owner: 'imran',
    title: 'Pass the ISO surveillance audit with zero repeat NCs' }).id;
  saveGoal_(ctx, { level: 'quarter', period: fy.quarter, owner: 'meera',
    title: 'Cut inventory variance below 1%' });
  setGoalStatus_(ctx, qAudit, 'At risk', 'CC-19 needed a second pass; internal audit round is due this week.');

  var linked = 0;
  readTasks_(ctx).forEach(function (t) {
    var g = /^Despatch /.test(t.title) ? qDespatch
          : /NC-|CC-19|PPAP|control plan|ISO|internal audit|Gauge R&R|calibration/i.test(t.title) ? qAudit : '';
    if (!g) return;
    var hit = findTaskRow_(ctx, t.id);
    if (hit) { writeTaskField_(hit, 'Goal', g); linked++; }
  });
  dropCache_(ctx);
  out.push('Goals: one year goal, three for the quarter (one at risk), ' + linked + ' tasks linked.');

  var NUMS = [
    { name: 'On-time despatch', owner: 'payel', unit: '%', target: 95, direction: 'at least', goal: qDespatch,
      weeks: [92, 96, 94, 97, 91, 96] },
    { name: 'Customer rejections', owner: 'nita', unit: 'parts', target: 5, direction: 'at most', goal: qAudit,
      weeks: [7, 4, 3, 6, 2, 3] },
    { name: 'Open roadblocks', owner: 'sruti', unit: '', target: 3, direction: 'at most', goal: '',
      weeks: [5, 4, 4, 2, 3, 2] },
  ];
  NUMS.forEach(function (n) {
    var id = saveNumber_(ctx, n).id;
    n.weeks.forEach(function (v, i) {
      var d = new Date(); d.setDate(d.getDate() - 7 * (n.weeks.length - 1 - i));
      recordNumber_(ctx, id, v, ymd(d));
    });
  });
  out.push('Key numbers: three, six weeks of figures each, misses included.');

  /* One open roadblock waiting for the next review, raised outside a meeting. */
  addMeetingItem_(ctx, '', { kind: 'roadblock', goal: qDespatch,
    text: 'Krishna Castings keep shipping short — two despatches waited on them this month.' });

  var m = startMeeting_(ctx, { title: 'Weekly review',
    attendees: ['sruti', 'imran', 'payel', 'nita', 'meera'] }).id;
  ['sruti', 'imran', 'payel', 'nita'].forEach(function (u) { setAttendance_(ctx, m, u, true); });
  addMeetingItem_(ctx, m, { kind: 'win', person: 'payel',
    text: 'All five Mahindra despatches left on the promised day.' });
  addMeetingItem_(ctx, m, { kind: 'story', person: 'rafiq', value: 'FIT', cookies: 2,
    text: 'Rafiq stopped CNC-3 when the bore drifted, before a single bad part reached inspection.' });
  var up = addMeetingItem_(ctx, m, { kind: 'update', person: 'imran', goal: qAudit,
    text: 'Internal audit checklist is ready; two clauses still need evidence from Stores.' });
  var upId = ((up.updates || [])[0] || {}).id;
  var rb = addMeetingItem_(ctx, m, { kind: 'roadblock', goal: qAudit,
    text: 'Calibration certificates for the torque wrenches are missing from the file.' });
  var rbId = '';
  (rb.roadblocks || []).forEach(function (it) { if (/torque wrenches/.test(it.text)) rbId = it.id; });
  addMeetingAction_(ctx, m, { title: 'Get the torque wrench certificates from the lab', assignTo: 'rafiq',
    goal: qAudit, fromItem: rbId, clearItem: true });
  addMeetingAction_(ctx, m, { title: 'Call Krishna Castings about short shipments', assignTo: 'meera',
    goal: qDespatch });
  if (upId) addMeetingAction_(ctx, m, { title: 'Send Imran the Stores evidence for the two open clauses',
    assignTo: 'meera', goal: qAudit, fromItem: upId, priority: 'Critical' });
  saveMinutes_(ctx, m, 'Despatch on track. Audit at risk on calibration evidence — Rafiq owns it. ' +
    'Meera to escalate Krishna Castings before the next review.');
  rateMeeting_(ctx, m, 8);
  endMeeting_(ctx, m, false, true);
  /* Held three days ago, so it reads as last week's review, not a test run. */
  var ago = new Date(); ago.setDate(ago.getDate() - 3); ago.setHours(10, 0, 0, 0);
  var end = new Date(ago.getTime() + 55 * 60000);
  writeMeeting_(ctx, meetingById_(ctx, m), { 'Date': ymd(ago), 'Started': ago, 'Ended': end });
  dropCache_(ctx);
  out.push('Meetings: last week’s review — a win, a values story, three actions (one delegated from an update) — and one roadblock waiting.');
}

function seedDemoWork_(ctx) {
  var JOBS = [
    // [title, who, dueOffset, priority, category, outcome]
    ['Despatch 240 flanges to Tata Motors',      'payel',  -24, 'Critical', 'Despatch',   'ontime'],
    ['Raise GRN for the Bharat Forge inward',    'meera',  -22, 'Medium',   'Stores',     'ontime'],
    ['Recalibrate the torque wrenches',          'rafiq',  -21, 'High',     'Maintenance','ontime'],
    ['Close NC-2026-14 from the last audit',     'nita',   -20, 'Critical', 'Quality',    'late'],
    ['Monthly stock reconciliation',             'meera',  -18, 'High',     'Stores',     'ontime'],
    ['Vendor rating review — Q2',                'imran',  -17, 'Medium',   'Quality',    'ontime'],
    ['Despatch 80 housings to Ashok Leyland',    'payel',  -16, 'Critical', 'Despatch',   'ontime'],
    ['Replace the coolant on CNC-3',             'rafiq',  -15, 'High',     'Maintenance','rework'],
    ['Update the PPAP file for part 7781',       'nita',   -14, 'High',     'Quality',    'ontime'],
    ['Reorder carbide inserts',                  'meera',  -13, 'Medium',   'Stores',     'late'],
    ['Despatch 150 brackets to Mahindra',        'payel',  -12, 'Critical', 'Despatch',   'ontime'],
    ['First-article inspection, part 8120',      'nita',   -11, 'High',     'Quality',    'ontime'],
    ['Weekly 5S audit — machine shop',           'rafiq',  -10, 'Low',      'Quality',    'ontime'],
    ['Quote for the Endurance enquiry',          'sruti',   -9, 'High',     'Sales',      'ontime'],
    ['Despatch 60 shafts to Endurance',          'payel',   -8, 'Critical', 'Despatch',   'late'],
    ['Service the compressor',                   'rafiq',   -7, 'High',     'Maintenance','ontime'],
    ['Scrap reconciliation for the month',       'meera',   -6, 'Medium',   'Stores',     'ontime'],
    ['Train two operators on the new fixture',   'sruti',   -6, 'Medium',   'Training',   'ontime'],
    ['Close customer complaint CC-19',           'nita',    -5, 'Critical', 'Quality',    'rework'],
    /* Not a flawless top performer. A demo whose best person scores 100 reads
       as a mock-up — the number people believe is the one with a reason to be
       short of perfect, and the rework loop is what the breakdown screen is
       there to explain. */
    ['Despatch 300 washers to Tata Motors',      'payel',   -4, 'High',     'Despatch',   'rework'],
    ['Preventive maintenance — CNC-1 and 2',     'rafiq',   -3, 'High',     'Maintenance','ontime'],
    ['Issue the revised control plan',           'imran',   -3, 'High',     'Quality',    'ontime'],
    ['Cycle count — bin A to F',                 'meera',   -2, 'Medium',   'Stores',     'ontime'],
    ['Despatch 95 covers to Mahindra',           'payel',   -1, 'Critical', 'Despatch',   'late'],

    // still open, so the board and the priority list have something on them
    ['Despatch 180 flanges to Bharat Forge',     'payel',    2, 'Critical', 'Despatch',   'progress'],
    ['Gauge R&R study on the new CMM',           'nita',     3, 'High',     'Quality',    'progress'],
    ['Rework 12 rejected housings',              'vikram',   1, 'Critical', 'Production', 'progress'],
    ['Quarterly calibration of the CMM',         'rafiq',    6, 'High',     'Maintenance','open'],
    ['Stock-take before the audit',              'meera',    5, 'High',     'Stores',     'open'],
    ['Prepare the management review pack',       'sruti',    9, 'High',     'Quality',    'open'],
    ['Supplier audit — Krishna Castings',        'imran',   12, 'Medium',   'Quality',    'open'],
    ['Despatch 40 spindles to Endurance',        'vikram',   4, 'High',     'Despatch',   'open'],

    // overdue, because every real workshop has some
    ['Replace the guarding on the press',        'rafiq',   -2, 'Critical', 'Maintenance','overdue'],
    ['Return the rejected lot to Krishna',       'meera',   -4, 'High',     'Stores',     'overdue'],

    /* The owner's own work. Without it the Priority tab — the second thing
       anybody clicks on a demo — opens on "No open work at all. Enjoy it."
       for the account you signed in with, which reads as an empty product
       rather than an empty day. Owners of a works this size carry jobs. */
    /* One of his own delivered late, deliberately. The owner topping his own
       leaderboard on two jobs is the wrong story to tell a prospect, and it is
       also the wrong answer: the person who carried ten should be above the
       person who carried two. */
    ['__me__|Sign off the revised price list',          -11, 'High',     'Sales',      'late'],
    ['__me__|Approve the CNC-4 capex note',              -5, 'Critical', 'Finance',    'ontime'],
    ['__me__|Review the audit readiness pack',            2, 'Critical', 'Quality',    'progress'],
    ['__me__|Call Endurance about the Q3 schedule',       1, 'High',     'Sales',      'open'],
    ['__me__|Renew the factory licence',                 -1, 'Critical', 'Compliance', 'overdue'],
  ];

  var stats = { closed: 0, open: 0, late: 0, reworked: 0 };

  /* The offsets above are written as "up to 24 days ago", but the reports and
     the leaderboard default to the CALENDAR month — so a demo opened on the
     3rd would show almost nothing, through no fault of the data. The closed
     work is compressed into the days since the 1st instead, so the default
     view is full whatever day the demo is given. Ten days minimum, because a
     demo on the 1st still has to show a month's work.
     Only the past is squeezed; future deadlines are left where they are. */
  var dayOfMonth = new Date().getDate();
  var span = Math.max(10, dayOfMonth - 1);
  var squeeze = function (offset) {
    if (offset >= 0) return offset;
    return -Math.max(1, Math.round(Math.abs(offset) / 24 * span));
  };

  JOBS.forEach(function (j) {
    /* The owner's rows are written one field shorter and marked, because his
       username comes from the email he signed up with and is not known until
       the workspace exists. */
    if (String(j[0]).indexOf('__me__|') === 0) {
      j = [String(j[0]).split('|')[1], ctx.me.username, j[1], j[2], j[3], j[4]];
    }
    var offset = squeeze(j[2]);
    /* Lateness is counted in working days, never weekends or leave — so a past
       date has to be a weekday, and an "overdue" job needs enough working days
       behind it to still be late when the demo is built on a Saturday or a
       Monday. Built on a Saturday before this, the demo had nothing overdue. */
    if (j[5] === 'overdue') offset = -demoWorkdaysBack_(Math.max(2, Math.round(Math.abs(j[2]) * 1.5)));
    else if (offset < 0) offset = demoWeekdayOnOrBefore_(offset);
    var title = j[0], who = j[1], due = demoYmd_(offset), priority = j[3],
        cat = j[4], outcome = j[5];
    try {
      createTask_(ctx, { title: title, assignTo: who, dueDate: due, priority: priority,
        jobCategory: cat, kra: cat, desc: '' });
      dropCache_(ctx);
      var t = demoFindTask_(ctx, title);
      if (!t) return;

      if (outcome === 'open') { stats.open++; return; }
      if (outcome === 'overdue') { updateTask_(ctx, t.id, 'In Progress'); stats.open++; return; }
      if (outcome === 'progress') { updateTask_(ctx, t.id, 'In Progress'); stats.open++; return; }

      updateTask_(ctx, t.id, 'In Progress');
      updateTask_(ctx, t.id, 'For Review');
      if (outcome === 'rework') {
        /* A rework loop is the single most useful thing in a demo: it is the
           part of the score a manager argues with, and the part that proves
           the trail is real. */
        updateTask_(ctx, t.id, 'In Progress', 'Dimensions not to the revised drawing');
        updateTask_(ctx, t.id, 'For Review');
        stats.reworked++;
      }
      updateTask_(ctx, t.id, 'Verified');
      demoBackdate_(ctx, t.id, offset, outcome === 'late');
      if (outcome === 'late') stats.late++;
      stats.closed++;
    } catch (e) {
      Logger.log('demo: ' + title + ' — ' + e.message);
    }
  });

  /* One recurring job with a stop rule, so the cadence and the countdown are
     both visible without anyone having to set one up on the call. */
  try {
    createTask_(ctx, { title: 'Monthly preventive maintenance round', assignTo: 'rafiq',
      dueDate: demoYmd_(7), priority: 'High', jobCategory: 'Maintenance',
      frequency: 'Monthly', repeatCount: 12 });
    stats.open++;
  } catch (e) {}

  dropCache_(ctx);
  return stats;
}

/**
 * Moves a finished task's timestamps back to when it would really have
 * happened. The one place this file writes to a cell directly, and it is
 * deliberate: no public path can travel in time, and without this every
 * "closed" job was created, submitted and verified in the same second — today
 * — against a deadline a month in the past.
 *
 * Which means every single delivery scored as late. The whole team came out in
 * band C, "on time" in the seed data was a label that described nothing, and
 * the leaderboard ranked by who happened to have fewest tasks. A demo whose
 * numbers contradict its own story is worse than one with no numbers.
 *
 * The STATUSES and the notes are untouched — those came from the real writers
 * and still have to be true. Only the clock moves.
 *
 * @param dueOffset  days from today the deadline sits (negative = past)
 * @param late       true to submit after the deadline rather than before it
 */
function demoBackdate_(ctx, taskId, dueOffset, late) {
  try {
    var hit = findTaskRow_(ctx, taskId);
    if (!hit) return;
    var hist = hit.task.history || [];
    if (!hist.length) return;

    var at = function (days) {
      var d = new Date();
      d.setDate(d.getDate() + Number(dueOffset) + days);
      d.setHours(10 + (Math.abs(Number(dueOffset)) % 7), 30, 0, 0);
      return d.toISOString();
    };
    /* Relative to the deadline: raised a week before, started two days later,
       handed in just before it — or three days after it when the job is one of
       the ones meant to be late — and verified the day after that. */
    var submitted = late ? 3 : -1;
    var marks = [-7, -5, submitted, submitted + 1, submitted + 2, submitted + 3];

    hist.forEach(function (h, i) {
      h.date = at(marks[Math.min(i, marks.length - 1)]);
    });
    writeTaskField_(hit, 'History JSON', JSON.stringify(hist));
    writeTaskField_(hit, 'Date Created', new Date(at(-7)));
    dropCache_(ctx);
  } catch (e) {
    Logger.log('demo backdate: ' + e.message);
  }
}

/**
 * deleteDemoAccount(true), for the Apps Script editor.
 *
 * The editor's Run button calls a function with no arguments, so
 * deleteDemoAccount(true) cannot be run from it — choosing deleteDemoAccount
 * there only ever does the dry run. Every guide that said "run
 * deleteDemoAccount(true)" was describing a thing nobody could do without
 * writing code. This is the button.
 */
function removeDemoAccount() { return deleteDemoAccount(true); }

function demoFindTask_(ctx, title) {
  var all = readTasks_(ctx);
  for (var i = all.length - 1; i >= 0; i--) if (all[i].title === title) return all[i];
  return null;
}

/**
 * Removes the demo workspace. Prints what it would do; pass true to do it.
 *
 * The tenant spreadsheet is TRASHED, not deleted outright, so a mistyped email
 * is recoverable from Drive's bin for thirty days. The registry rows are
 * removed properly, because a stale row there is what makes a later signup on
 * the same address fail with "that email is already registered".
 */
function deleteDemoAccount(reallyDoIt, email) {
  email = String(email || DEMO_EMAIL).trim().toLowerCase();
  var out = ['', '=== REMOVE DEMO ACCOUNT ===', ''];
  var master = SpreadsheetApp.openById(CFG().masterId);
  var dir = master.getSheetByName(TAB.DIRECTORY);
  var d = dir.getDataRange().getValues();
  var hits = [];
  for (var i = d.length - 1; i >= 1; i--) {
    if (String(d[i][1]).trim().toLowerCase() === email) hits.push({ row: i + 1, company: d[i][0], sheetId: String(d[i][5]).trim() });
  }
  if (!hits.length) { var m = 'Nothing registered on ' + email + '.'; Logger.log(m); return m; }

  hits.forEach(function (h) { out.push('  ' + h.company + '  (' + h.sheetId + ')'); });
  if (!reallyDoIt) {
    out.push('');
    out.push('Nothing removed. Run removeDemoAccount to go ahead.');
    Logger.log(out.join('\n'));
    return out.join('\n');
  }

  withLock_(function () {
    hits.forEach(function (h) {
      try { DriveApp.getFileById(h.sheetId).setTrashed(true); out.push('  trashed ' + h.sheetId + ' (recoverable for 30 days)'); }
      catch (e) { out.push('  could not trash ' + h.sheetId + ': ' + e.message); }
      dir.deleteRow(h.row);
    });
    var g = master.getSheetByName(TAB.GLOBAL);
    if (g) {
      var gd = g.getDataRange().getValues();
      for (var k = gd.length - 1; k >= 1; k--) {
        if (String(gd[k][0]).trim().toLowerCase() === email) g.deleteRow(k + 1);
      }
    }
  });
  out.push('');
  out.push('Removed. createDemoAccount() will build a fresh one.');
  Logger.log(out.join('\n'));
  return out.join('\n');
}
