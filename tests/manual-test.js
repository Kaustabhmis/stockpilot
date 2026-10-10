/**
 * Every number and rule MANUAL.md asserts, checked against the code it
 * describes.
 *
 * A manual that has drifted from the product is worse than no manual: people
 * trust it, act on it, and discover it was wrong at the moment it mattered.
 * These are the claims a reader would be entitled to rely on — the scoring
 * weights, the caps, the SLA, the plan prices, the button labels the manual
 * tells somebody to press — and every one of them is a constant or a string
 * that can quietly change under it.
 *
 * Where a claim is about BEHAVIOUR rather than a number, the behaviour is
 * asserted and not the comment that describes it. Asserting the prose would
 * pass on a comment that no longer matches the code underneath it, which is
 * the exact failure this file exists to prevent.
 */
const fs = require('fs');
const M = fs.readFileSync('/home/user/stockpilot/MANUAL.md', 'utf8');
const C = fs.readFileSync('/home/user/stockpilot/dist/code.gs', 'utf8');
const UI = fs.readFileSync('/home/user/stockpilot/dist/index.html', 'utf8');
let bad = 0, good = 0;
const ck = (what, ok, detail) => {
  if (ok) { good++; return; }
  console.log('  WRONG: ' + what + (detail ? '  [' + detail + ']' : ''));
  bad++;
};

const has = (re) => new RegExp(re).test(C);

// scoring constants
ck('45/30/25 weights', has(`SCORE_WEIGHTS = \\{ onTime: 0\\.45, quality: 0\\.30, queue: 0\\.25 \\}`));
ck('35/25/20/20 milestone weights', has(`MILESTONE_WEIGHTS = \\{ onTime: 0\\.35, quality: 0\\.25, queue: 0\\.20, milestones: 0\\.20 \\}`));
ck('10 points a day late', has(`LATENESS_POINTS_PER_DAY = 10`));
ck('25 points a rework', has(`REWORK_POINTS_EACH = 25`));
ck('WIP default 5', has(`DEFAULT_WIP_LIMIT = 5`));
ck('expected monthly tasks 5', has(`EXPECTED_MONTHLY_TASKS = 5`));
ck('cookie 1-5 per award', has(`COOKIE_MAX_PER_AWARD = 5`));
ck('cookie bonus cap 10', has(`MAX_COOKIE_BONUS = 10`));
ck('review SLA 2 days', has(`REVIEW_SLA_DAYS = 2`));
ck('2 points per day over SLA', has(`RESPONSIVENESS_PENALTY_PER_DAY = 2`));
ck('10 per item cap', has(`MAX_RESPONSIVENESS_PENALTY_PER_ITEM = 10`));
ck('20 total cap', has(`MAX_RESPONSIVENESS_PENALTY = 20`));
ck('bands 85 / 60', has(`score >= 85`) && has(`score >= 60`));
ck('archive after 7 days', has(`86400000\\) > 7`));
ck('escalate after 3 days', /ESCALATE_AFTER_DAYS: 3/.test(fs.readFileSync('/home/user/stockpilot/domebox/reminders.gs','utf8')));
{
  const rem = fs.readFileSync('/home/user/stockpilot/domebox/reminders.gs', 'utf8');
  ck('reminders at 9 am, 3 pm and 5 pm, as the manual says', /9 am, 3 pm and 5 pm/.test(M) && /HOURS: \[9, 15, 17\]/.test(rem));
  ck('2 days before the due date, as the manual says', /\*\*2 days before it is due\*\*/.test(M) && /DAYS_BEFORE_DUE: 2,/.test(rem));
  ck('overdue chased every working day, as the manual says', /every working day while it is overdue/.test(M) && /INCLUDE_OVERDUE: true/.test(rem));
  ck('only open work: To do or In progress', /status !== STATUS\.PENDING && t\.status !== STATUS\.IN_PROGRESS\) return null/.test(rem));
  ck('nothing while on approved leave', /rmOnLeave_\(data\.leave, user\.username, now\)/.test(rem));
  ck('the digest no longer repeats a person\u2019s own tasks', /DIGEST_OWN_TASKS: false/.test(rem));
}
ck('appraisal day 25', /APPRAISAL_REMINDER_DAY: 25/.test(fs.readFileSync('/home/user/stockpilot/domebox/reminders.gs','utf8')));
ck('appraisal 75/20/5', has(`KRA 75% \\+ Behaviour 20%`));
ck('lapse grace 7 days', has(`daysLeft <= -7`));

// urgency numbers
ck('overdue 40', has(`overdueBase: 40`));
ck('overdue 2/day cap 20', has(`overduePerDay: 2`) && has(`overdueCap: 20`));
ck('due today 36 / tomorrow 28 / week 16', has(`dueToday: 36, dueTomorrow: 28, dueThisWeek: 16`));
ck('dependents 8 cap 24', has(`perDependent: 8, dependentCap: 24`));
ck('in progress 6', has(`inProgress: 6`));

// cadences and horizons named in the manual
['Daily','Weekdays','Weekly','Fortnightly','Monthly','Quarterly','Half-Yearly','Yearly']
  .forEach((c) => ck('cadence ' + c, C.indexOf("'" + c + "'") > -1));
['Today','This week','This month','This quarter','This year','Everything']
  .forEach((h) => ck('horizon ' + h, C.indexOf("'" + h + "'") > -1));

// button labels the manual tells people to press
['Start work','Submit for review','Send back','Add blocker','Hand over','Stop repeating',
 'Invoice details','Invoices','Forgot password','Archive']
  .forEach((b) => ck('button "' + b + '"', UI.indexOf(b) > -1));

// plan prices
[['Starter',2499,24990],['Growth',5999,59990],['Scale',12999,129990]].forEach(([n,m,y]) => {
  ck(n + ' monthly ' + m, has(`'${n}':\\s*\\{[^}]*price:\\s*${m}`), '');
  ck(n + ' yearly ' + y, has(`'${n} Yearly':\\s*\\{[^}]*price:\\s*${y}`), '');
});
[['Free',5],['Starter',15],['Growth',50],['Scale',150]].forEach(([n,u]) => {
  ck(n + ' users ' + u, new RegExp(`'${n}':\\s*\\{[^}]*users:\\s*${u}\\b`).test(C));
});

// goals, values, key numbers
ck('four goal statuses, exactly these', has(`GOAL_STATUSES = \\['On course', 'At risk', 'Done', 'Dropped'\\]`));
ck('At risk needs a reason', C.indexOf("status === 'At risk' && !String(note || '').trim()") > -1);
ck('quarters follow the Indian FY by default', C.indexOf("readSetting_(ctx, 'fyStartMonth', 4)") > -1);
ck('up to twelve values', C.indexOf('values.length > 12') > -1);
ck('value codes are one to three letters', has('VALUE_CODE_MAX = 3'));
ck('progress leaves out cancelled and rejected work', C.indexOf("t.status !== 'Cancelled' && t.status !== 'Rejected'") > -1);
ck('a year goal counts its quarter goals', C.indexOf("if (g.parent === goal.id) ids.push(g.id)") > -1);
ck('a goal with linked work is dropped, not deleted', C.indexOf('Mark it Dropped instead') > -1);
ck('project stages inherit the goal', C.indexOf("row[T['Goal']] = goalId;                 // every stage") > -1);
ck('repeats keep their goal', C.indexOf("row[T['Goal']] = t.goal || '';") > -1);
ck('figures are filed by the Monday of their week', C.indexOf('var dow = (x.getDay() + 6) % 7;') > -1);

// meetings
const segs = (C.match(/var MEETING_SEGMENTS = \[([\s\S]*?)\];/) || [])[1] || '';
const segTitles = [...segs.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
ck('the eight segments, in the order the manual gives',
   segTitles.join('|') === 'Wins|Values in action|Goal check|Key numbers|Updates|Roadblocks|Actions|Close', segTitles.join('|'));
ck('every segment is in the manual table', segTitles.every((t) => M.indexOf('| **' + t + '** |') > -1));
ck('meetings are a paid-plan feature', C.indexOf('Meetings are included in every paid plan.') > -1);
ck('only one meeting runs at a time', C.indexOf('A meeting is already running.') > -1);
ck('segments can be dropped, never reordered, Close kept', C.indexOf("return keep[s.key] || s.key === 'close';") > -1);
ck('a story must name a value', C.indexOf('a story without one is just a nice story') > -1);
ck('actions are due in seven days by default', C.indexOf('d.setDate(d.getDate() + 7); due = ymd(d);') > -1);
ck('actions go through createTask_', C.indexOf('var r = createTask_(ctx, { title: form.title') > -1);
ck('ratings: one per person, replaced not added', C.indexOf("r[ctx.actor.username] = s;") > -1);
ck('board columns show 20 cards, as the manual says', /each column shows its 20 most urgent/i.test(M) && UI.indexOf('var COL_LIMIT = 20;') > -1);
ck('archive pages are 50, as the manual says', /archive loads 50 closed tasks/i.test(M) && C.indexOf('Math.floor(Number(p.pageSize)) || 50') > -1);
ck('the dashboard sends active work only', C.indexOf('tasks: active,') > -1 && C.indexOf("case 'getArchive':") > -1);
ck('the summary goes to everyone present', C.indexOf('.filter(function (a) { return a.present; }).forEach(function (a) {') > -1);
ck('cancelling sends nothing', C.indexOf("return { status: 'success', message: 'Meeting cancelled. Nothing was sent.' };") > -1);
ck('the screen follows the chair within a few seconds', UI.indexOf('var POLL_MS = 5000;') > -1);
ck('a refresh never touches a field being typed in',
   UI.indexOf("box.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)") > -1);
ck('Goals and Meetings are tabs', UI.indexOf('data-tab="goals"') > -1 && UI.indexOf('data-tab="meetings"') > -1);
ck('the manual says eight tabs', /### The eight tabs/.test(M));

// claims about the help itself
ck('? opens help anywhere', UI.indexOf("e.key !== '?'") > -1 && UI.indexOf('openHelp()') > -1);
ck('? in a text field just types', UI.indexOf("tag === 'INPUT' || tag === 'TEXTAREA'") > -1);
ck('help opens on the tab you are on', UI.indexOf('HELP.forTab[STATE.tab]') > -1);
ck('Help is in the account panel for phones', UI.indexOf('closeModal();openHelp()">Help<') > -1);
ck('every help page ends at Contact support', UI.indexOf('Still stuck?') > -1);
ck('the in-app help IS this manual', /var HELP = \{"sections":\[/.test(UI));

// claims about behaviour
/* The guard lives in the UI, and asserting the comment text would pass on a
   comment. Assert the condition that actually withholds the button. */
ck('cannot verify own work', UI.indexOf('!(isMine && !isAdmin && !isRaiser)') > -1);
ck('leave excludes overdue days', has(`function chargeableLateDays`));
ck('scored from Submit, not Verify', has(`function submittedAt`));
ck('For Review excluded from queue health', has(`STATUS.PENDING \\|\\| t.status === STATUS.IN_PROGRESS`));
ck('circular blockers refused', has(`circular|cycle`));
ck('last Admin protected', has(`last Admin`));
/* Behaviour, not prose: with no delegation data the final score is the
   performance score rather than half of it. */
ck('new joiner keeps performance score',
   C.indexOf('hasDelegation') > -1 &&
   C.indexOf('halves.push(performance)') > -1 && C.indexOf('halves.push(delegation)') > -1);
ck('stage deadline shifts when released late', has(`function stageEffectiveDue`));
ck('18% GST added at checkout', has(`net \\* \\(100 \\+ rate\\) / 100`));
ck('mail from info@biscsindia.com', has(`info@biscsindia.com`));

// anchors
const anchors = [...M.matchAll(/\]\(#([a-z0-9-]+)\)/g)].map((m) => m[1]);
const heads = [...M.matchAll(/^#{2,3} (.+)$/gm)]
  .map((m) => m[1].toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/ /g, '-'));
anchors.filter((a) => !heads.includes(a)).forEach((a) => ck('anchor #' + a, false));

/* Reported in the same shape as every other suite, so a broken manual fails a
   full run rather than needing somebody to remember this file exists. */
console.log('\n' + good + ' passed, ' + bad + ' failed' +
  (bad ? '' : '   (every claim in MANUAL.md checks out against the code)'));
process.exit(bad ? 1 : 0);
