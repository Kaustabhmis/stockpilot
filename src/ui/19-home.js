/* ===========================================================================
   HOME PAGE — the product tour, the ROI calculator and the call-back form.
   Everything here describes the product as it is; the calculator works only
   from the visitor's own figures and says that it is an estimate.
   =========================================================================== */

var TOUR = [
  { key: 'board', icon: 'view_kanban', label: 'Task board', img: '16-lead-board',
    title: 'Every job, its owner and its date — on one board',
    points: ['Assign to one person or tick several; each gets their own copy.',
             'Work moves To do → In progress → For review → Verified. It is done only when the person who asked says so.',
             'A red edge means late. Filters find one person’s work, a category, or everything overdue.'] },
  { key: 'priority', icon: 'low_priority', label: 'What to do first', img: '08-priority',
    title: 'One list that says what to do next — and why',
    points: ['Ranked by what is really pressing: late work, due today, other people waiting on it.',
             'Every row gives its reason, so nobody argues about the order.',
             'Managers see the decisions waiting on them in the same place.'] },
  { key: 'projects', icon: 'account_tree', label: 'Projects', img: '11-projects',
    title: 'Multi-stage work that hands itself on',
    points: ['Each stage has its own owner and deadline; the next one opens when the last is verified.',
             'Its owner is emailed the moment it is their turn.',
             'If a stage runs late, the next one keeps the days the plan gave it.'] },
  { key: 'meetings', icon: 'groups', label: 'Weekly meeting', img: '23-meeting-wins',
    title: 'A weekly review that turns talk into tasks',
    points: ['Eight timed parts: wins, values, goals, key numbers, updates, roadblocks, actions, rating.',
             'Everyone follows the chair on their own screen.',
             'Delegate any point and it becomes a real task with a due date and reminders.'] },
  { key: 'goals', icon: 'flag', label: 'Goals', img: '12-goals',
    title: 'Purpose, values and goals the work is tied to',
    points: ['Year goals and quarter goals on the Indian financial year.',
             'Progress is the share of linked work actually verified — not a guess.',
             'Weekly key numbers with targets, a miss in red.'] },
  { key: 'score', icon: 'speed', label: 'Fair scores', img: '09-score-why',
    title: 'A score with the working shown',
    points: ['On time, right first time, and nothing left late — weighted by priority and by the load carried.',
             '“See why” lists every task behind every point. Leave and weekends never count as lateness.',
             'The same number on the dashboard, the leaderboard, the reports and the appraisal.'] },
  { key: 'reports', icon: 'insights', label: 'Reports', img: '20-reports',
    title: 'The month in four numbers, and every person in one view',
    points: ['Team score, work delivered, the on-time share, rework loops and late work.',
             'A twelve-month trend, the A / B / C spread, and score by person.',
             'Accountability shows who is holding work up — managers included.'] },
  { key: 'appraisal', icon: 'workspace_premium', label: 'Appraisals', img: '21-appraisal',
    title: 'An appraisal you can defend',
    points: ['Rate each KRA and behaviour 0 to 5, with targets that make it about evidence.',
             'Half the final score is your rating, half is the measured record.',
             'Every appraisal is stored, so the history is there at the next review.'] },
  { key: 'phone', icon: 'smartphone', label: 'On a phone', img: '15-phone', phone: true,
    title: 'Works on any phone, nothing to install',
    points: ['The board, priority list, meetings and scores all fit a small screen.',
             'Email reminders at 9, 3 and 5 for work assigned today, due in two days, or late.',
             'Help is one tap away, with a printable manual for training.'] },
];

function renderTour(key) {
  var tabs = $('tourTabs');
  if (!tabs) return;
  var t = TOUR.filter(function (x) { return x.key === key; })[0] || TOUR[0];
  tabs.innerHTML = TOUR.map(function (x) {
    return '<button type="button" role="tab" aria-selected="' + (x.key === t.key) + '" class="' +
      (x.key === t.key ? 'on' : '') + '" onclick="renderTour(\'' + x.key + '\')">' +
      '<span class="material-icons">' + x.icon + '</span>' + esc(x.label) + '</button>';
  }).join('');
  var img = $('tourImg');
  img.src = '/img/' + t.img + '.jpg';
  img.alt = t.title;
  $('tourFig').style.maxWidth = t.phone ? '340px' : '';
  $('tourFig').style.margin = t.phone ? '0 auto' : '';
  $('tourText').innerHTML = '<h3 class="text-2xl font-black tracking-tight">' + esc(t.title) + '</h3>' +
    t.points.map(function (p) {
      return '<div class="tour-point"><span class="material-icons">check_circle</span><span>' + esc(p) + '</span></div>';
    }).join('') +
    '<div class="flex flex-wrap gap-3 mt-6">' +
      '<button class="btn btn-gold" onclick="goAuth(\'signup\')">Start free trial</button>' +
      '<button class="btn btn-g" onclick="openDemo(\'owner\', this)">Try it in the live demo</button></div>';
}

/** The cheapest paid band that fits a team of this size, per month (billed yearly). */
function roiPlanFor(people) {
  var paid = PLAN_CARDS.filter(function (p) { return p.price && p.users && p.users >= people; });
  if (!paid.length) return null;
  var p = paid[0];
  return { name: p.name, monthly: Math.round(p.yearPrice / 12) };
}

function roiCalc() {
  var out = $('roiOut');
  if (!out) return;
  var num = function (id, d) { var v = Number($(id).value); return isFinite(v) && v >= 0 ? v : d; };
  var people = Math.max(1, num('roiPeople', 25)), mgrs = Math.max(0, num('roiMgrs', 4));
  var mins = num('roiMins', 45), pay = num('roiPay', 45000);
  var DAYS = 25, HOURS = 8;
  var hours = mgrs * mins * DAYS / 60;
  var cost = hours * (pay / (DAYS * HOURS));
  var plan = roiPlanFor(people);
  var half = cost / 2;
  out.innerHTML =
    '<div class="text-[11px] font-black uppercase tracking-widest" style="color:#9fb3d1">Chasing, every month</div>' +
    '<div class="roi-big mt-1">' + Math.round(hours).toLocaleString('en-IN') + ' hours</div>' +
    '<div class="font-bold text-sm" style="color:#c9d6ea">of manager time, worth about <b class="text-white">' + inr(cost) + '</b></div>' +
    '<div class="mt-5">' +
      '<div class="roi-row"><span>Half of that time back is worth</span><b>' + inr(half) + ' a month</b></div>' +
      (plan
        ? '<div class="roi-row"><span>Domebox ' + esc(plan.name) + ' for ' + people + ' people</span><b>' + inr(plan.monthly) + ' a month</b></div>' +
          '<div class="roi-row" style="border:0"><span>That is</span><b class="win">' +
            (plan.monthly ? (Math.round(half / plan.monthly * 10) / 10) + '× what it costs' : '—') + '</b></div>'
        : '<div class="roi-row" style="border:0"><span>For more than 150 people</span><b>Talk to us</b></div>') +
    '</div>' +
    '<p class="fine text-[12px] font-semibold mt-3 leading-relaxed">An estimate from your own figures: ' +
      DAYS + ' working days of ' + HOURS + ' hours, plan price billed yearly, before GST. It counts only the ' +
      'chasing — not late deliveries, rework or appraisal time.</p>' +
    '<button class="btn btn-gold w-full mt-4" onclick="goAuth(\'signup\')">Start your free 14-day trial</button>';
}

function sendCallback(e) {
  e.preventDefault();
  var phone = String($('cbPhone').value || '').replace(/[^\d+]/g, '');
  if (phone.replace(/\D/g, '').length < 10) { toast('Please enter a phone number we can call.', 'err'); return false; }
  var btn = $('btnCallback');
  busy(btn, true, 'Sending…');
  api('contactSales', { form: {
    kind: 'callback', name: $('cbName').value, companyName: $('cbCompany').value, phone: phone,
    email: $('cbEmail').value, size: $('cbSize').value, when: $('cbWhen').value, message: $('cbNote').value } })
    .then(function (r) {
      busy(btn, false);
      $('formCallback').innerHTML = '<div class="sm:col-span-2 text-center py-6"><span class="material-icons text-emerald-600 text-[40px]">check_circle</span>' +
        '<div class="font-black text-lg mt-2">Thank you — we will call you back</div>' +
        '<div class="text-gray-600 font-semibold mt-1">' + esc(r.message || 'Within one working day.') + '</div></div>';
    })
    .catch(function (err) { busy(btn, false); toast(err.message, 'err'); });
  return false;
}

function initHome() {
  renderTour('board');
  roiCalc();
}
