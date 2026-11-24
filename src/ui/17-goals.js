/* ---------------------------------------------------------------------------
   GOALS — purpose, values, year and quarter goals, key numbers

   STATE.dir is the last getDirection() result. It is loaded once on sign-in
   and again whenever something here changes, because three other screens read
   it to offer tags: the Assign form (which goal does this serve?), the project
   builder, and the cookie award (which value did this recognise?).
--------------------------------------------------------------------------- */

var GOALS = { quarter: null, owner: '', scope: '' };
var OUTLOOK_TONE = { good: 't-teal', warn: 't-amber', bad: 't-rose', none: 't-slate' };
var GOAL_TONE = { 'On course': 't-teal', 'At risk': 't-amber', 'Done': 't-sky', 'Dropped': 't-slate' };

function loadDirection() {
  return api('getDirection', {}).then(function (d) { STATE.dir = d; return d; })
    .catch(function () { STATE.dir = STATE.dir || null; return null; });
}

/** <option>s for "which goal does this serve?" — this quarter's and the year's. */
function goalOptions(selected, label) {
  var d = STATE.dir;
  var opts = '<option value="">' + esc(label || 'No goal') + '</option>';
  if (!d || !d.goals) return opts;
  var live = d.goals.filter(function (g) { return g.status !== 'Dropped' && g.status !== 'Done'; });
  var year = live.filter(function (g) { return g.level === 'year'; });
  var qtr = live.filter(function (g) { return g.level === 'quarter'; });
  if (qtr.length) opts += '<optgroup label="Quarter goals">' + qtr.map(function (g) {
    return '<option value="' + esc(g.id) + '"' + (g.id === selected ? ' selected' : '') + '>' +
      esc(g.title) + ' (' + esc(g.period.replace(/^FY\S+ /, '')) + ')</option>'; }).join('') + '</optgroup>';
  if (year.length) opts += '<optgroup label="Year goals">' + year.map(function (g) {
    return '<option value="' + esc(g.id) + '"' + (g.id === selected ? ' selected' : '') + '>' +
      esc(g.title) + '</option>'; }).join('') + '</optgroup>';
  return opts;
}

function valueOptions(selected, label) {
  var d = STATE.dir;
  var opts = '<option value="">' + esc(label || 'No value') + '</option>';
  if (!d || !d.values) return opts;
  return opts + d.values.map(function (v) {
    var key = v.code || v.title;
    return '<option value="' + esc(key) + '"' + (key === selected ? ' selected' : '') + '>' +
      (v.code ? esc(v.code) + ' — ' : '') + esc(v.title) + '</option>'; }).join('');
}

function goalTitle(id) {
  var g = STATE.dir && STATE.dir.goals ? STATE.dir.goals.filter(function (x) { return x.id === id; })[0] : null;
  return g ? g.title : '';
}

function progressBar(p) {
  if (!p || !p.total) return '<span class="text-[11px] font-bold text-gray-400">No work linked yet</span>';
  return '<div class="flex items-center gap-2 min-w-[140px]">' +
    '<div class="h-2 rounded-full bg-gray-100 flex-1 overflow-hidden">' +
      '<div class="h-2 rounded-full" style="width:' + p.percent + '%;background:var(--brand)"></div></div>' +
    '<span class="text-[11px] font-black text-gray-600 whitespace-nowrap">' + p.done + '/' + p.total +
      (p.overdue ? ' · <span class="text-red-600">' + p.overdue + ' late</span>' : '') + '</span></div>';
}

/** Which department a goal belongs to, or "Company". */
function goalWhere(g) { return g.scope === 'dept' && g.dept ? g.dept : 'Company'; }

/** The verdict chip and its one-line reason: "On track", "At risk"... */
function outlookBadge(g) {
  var o = g.outlook;
  if (!o) return '';
  return '<span class="chip ' + (OUTLOOK_TONE[o.tone] || 't-slate') + ' goalVerdict" title="' + esc(o.reason || '') + '">' + esc(o.verdict) + '</span>';
}

/** A goal with a target figure: how far along it is, with a tick where it should be by now. */
function metricBar(g) {
  var m = g.metric, o = g.outlook || {};
  if (!m) return progressBar(g.progress);
  var unit = m.unit ? (m.unit === '%' ? '%' : ' ' + m.unit) : '';
  var col = { good: '#0b8a7a', warn: '#c98a14', bad: '#c0264f' }[o.tone] || 'var(--brand)';
  var w = Math.max(0, Math.min(100, o.percent || 0));
  return '<div class="min-w-[170px] flex-1 max-w-[260px]">' +
    '<div class="relative h-2 rounded-full bg-gray-100 overflow-hidden">' +
      '<div class="h-2 rounded-full" style="width:' + w + '%;background:' + col + '"></div>' +
      (o.expected != null && o.expected < 100 ? '<div class="absolute top-0 h-2 w-0.5 bg-gray-700" style="left:' + o.expected + '%" title="Where it should be by now"></div>' : '') +
    '</div>' +
    '<div class="text-[11px] font-black text-gray-600 mt-1 whitespace-nowrap">' +
      (o.last != null ? esc(String(o.last)) : esc(String(m.start))) + ' \u2192 ' + esc(String(m.target)) + esc(unit) +
      (o.percent != null ? ' \u00b7 ' + o.percent + '%' : '') + '</div></div>';
}

/**
 * The progress review: how many goals are on track, at risk, off track, and
 * the same by department, so an Admin sees at a glance where help is needed.
 */
function renderGoalReview(d, list) {
  var live = list.filter(function (g) { return g.status !== 'Dropped'; });
  if (!live.length) return '';
  var KEYS = ['On track', 'At risk', 'Off track', 'Needs data', 'Achieved'];
  var bucket = function (v) { return v === 'Missed' ? 'Off track' : v === 'Not started' || v === 'In progress' ? 'Needs data' : v; };
  var count = function (arr) { var c = {}; KEYS.forEach(function (k) { c[k] = 0; });
    arr.forEach(function (g) { var b = bucket(g.outlook ? g.outlook.verdict : 'Needs data'); if (c[b] != null) c[b]++; }); return c; };
  var all = count(live);
  var tone = { 'On track': 't-teal', 'At risk': 't-amber', 'Off track': 't-rose', 'Needs data': 't-slate', 'Achieved': 't-sky' };
  var tiles = '<div class="grid gap-3 mb-4" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">' + KEYS.map(function (k) {
    return '<div class="rounded-xl p-3 ' + tone[k] + '"><div class="text-2xl font-black">' + all[k] + '</div>' +
      '<div class="text-[11px] font-black uppercase tracking-wide">' + k + '</div></div>'; }).join('') + '</div>';
  var groups = {};
  live.forEach(function (g) { (groups[goalWhere(g)] = groups[goalWhere(g)] || []).push(g); });
  var names = Object.keys(groups).sort(function (a, b) { return a === 'Company' ? -1 : b === 'Company' ? 1 : a.localeCompare(b); });
  var rows = names.length > 1 ? '<div class="overflow-x-auto"><table class="w-full text-sm" id="goalReviewTable"><thead><tr class="text-left text-[11px] uppercase tracking-wide text-gray-400">' +
      '<th class="py-2 pr-3">Where</th><th class="py-2 px-2 text-right">Goals</th>' + KEYS.map(function (k) { return '<th class="py-2 px-2 text-right">' + k + '</th>'; }).join('') +
      '<th class="py-2 pl-3">Verdict</th></tr></thead><tbody>' +
    names.map(function (n) {
      var c = count(groups[n]), tot = groups[n].length;
      var worst = c['Off track'] ? ['Needs help', 't-rose'] : c['At risk'] || c['Needs data'] ? ['Watch', 't-amber'] : ['On course', 't-teal'];
      return '<tr class="border-t border-gray-100"><td class="py-2 pr-3 font-black">' + esc(n) + '</td><td class="py-2 px-2 text-right font-bold">' + tot + '</td>' +
        KEYS.map(function (k) { return '<td class="py-2 px-2 text-right font-bold' + (c[k] ? '' : ' text-gray-300') + '">' + c[k] + '</td>'; }).join('') +
        '<td class="py-2 pl-3"><span class="chip ' + worst[1] + '">' + worst[0] + '</span></td></tr>';
    }).join('') + '</tbody></table></div>' : '';
  var watch = live.filter(function (g) { var b = bucket(g.outlook ? g.outlook.verdict : ''); return b === 'Off track' || b === 'At risk'; });
  var notes = watch.length ? '<div class="lb mt-4">Needs attention</div>' + watch.slice(0, 8).map(function (g) {
    return '<div class="text-xs font-semibold text-gray-600 py-1.5 border-t border-gray-100"><b class="text-gray-900">' + esc(g.title) + '</b> \u00b7 ' +
      esc(goalWhere(g)) + ' \u00b7 ' + esc(g.ownerName) + '<br>' + esc(g.outlook.reason || '') + '</div>'; }).join('') : '';
  return '<div class="bg-white rounded-2xl border border-gray-100 p-5 mb-6" id="goalReview">' +
    '<div class="flex items-center gap-2 mb-3"><span class="material-icons text-[20px]" style="color:var(--brand)">insights</span>' +
      '<h3 class="font-black text-lg">Are we on track?</h3><span class="text-xs font-bold text-gray-400 ml-auto">' + esc(GOALS.quarter) + ' and the year</span></div>' +
    tiles + rows + notes + '</div>';
}

function openGoalCheckin(id) {
  var g = STATE.dir.goals.filter(function (x) { return x.id === id; })[0];
  if (!g || !g.metric) return;
  var m = g.metric, recent = (g.checkins || []).slice(-6).reverse();
  openModal('<form id="fGoalCheck" class="p-6 lg:p-7">' +
    '<h2 class="text-2xl font-black mb-1">Enter today\'s figure</h2>' +
    '<p class="text-sm font-semibold text-gray-500 mb-4">' + esc(g.title) + ' \u2014 from ' + esc(String(m.start)) + ' to ' + esc(String(m.target)) + ' ' + esc(m.unit || '') + '</p>' +
    '<label class="lb" for="gcValue">Where it stands today' + (m.unit ? ' (' + esc(m.unit) + ')' : '') + '</label>' +
    '<input id="gcValue" class="in mb-4" type="number" step="any" required inputmode="decimal">' +
    '<label class="lb" for="gcNote">Note (optional)</label><input id="gcNote" class="in mb-4" maxlength="200" placeholder="What moved it">' +
    (recent.length ? '<div class="lb">Earlier figures</div><div class="text-xs font-semibold text-gray-500 mb-4">' + recent.map(function (c) {
      return '<div class="py-1 border-t border-gray-100">' + esc(c.d) + ' \u00b7 <b class="text-gray-800">' + esc(String(c.v)) + '</b>' + (c.note ? ' \u00b7 ' + esc(c.note) : '') + '</div>'; }).join('') + '</div>' : '') +
    '<div class="flex gap-3"><button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
    '<button type="submit" class="btn btn-p flex-1">Save figure</button></div></form>', 'max-w-md');
  $('fGoalCheck').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = this.querySelector('button[type=submit]'); btn.disabled = true;
    api('goalCheckin', { id: g.id, value: $('gcValue').value, note: $('gcNote').value })
      .then(function (r) { toast(r.message, r.outlook && r.outlook.tone === 'bad' ? 'info' : 'ok'); closeModal(); loadGoals(); })
      .catch(function (err) { btn.disabled = false; toast(err.message, 'err'); });
  });
}

function loadGoals() {
  $('goalsBody').innerHTML = spin();
  loadDirection().then(function (d) {
    if (!d) { $('goalsBody').innerHTML = '<div class="text-sm font-bold text-gray-400 py-10 text-center">Could not load goals.</div>'; return; }
    if (!GOALS.quarter) GOALS.quarter = d.now.quarter;
    renderGoals(d);
  });
}

function renderGoals(d) {
  var q = GOALS.quarter;
  var inScope = function (g) { return !GOALS.scope || goalWhere(g) === GOALS.scope; };
  var years = d.goals.filter(function (g) { return g.level === 'year' && inScope(g); });
  var quarters = d.goals.filter(function (g) {
    return g.level === 'quarter' && g.period === q && inScope(g) && (!GOALS.owner || g.owner === GOALS.owner); });
  var reviewList = d.goals.filter(function (g) { return inScope(g) && (g.level === 'year' || g.period === q); });
  var parentOf = function (g) { var p = d.goals.filter(function (x) { return x.id === g.parent; })[0]; return p ? p.title : ''; };

  var valuesBlock =
    '<div class="bg-white rounded-2xl border border-gray-100 p-6 mb-6">' +
      '<div class="flex justify-between items-start gap-3 mb-1">' +
        '<div class="lb mb-0">Our purpose</div>' +
        (d.canEditValues ? '<button class="btn btn-g text-xs py-2" onclick="openDirectionEditor()">Edit purpose &amp; values</button>' : '') +
      '</div>' +
      (d.purpose ? '<p class="text-xl lg:text-2xl font-black leading-snug mt-1" style="color:var(--ink)">' + esc(d.purpose) + '</p>'
                 : '<p class="text-sm font-semibold text-gray-400 mt-1">' +
                   (d.canEditValues ? 'Not set yet. One sentence: why does this company exist?' : 'Not set yet.') + '</p>') +
      '<div class="lb mt-6">Our values</div>' +
      (d.values.length ? '<div class="grid gap-3" style="grid-template-columns:repeat(auto-fill,minmax(230px,1fr))">' +
        d.values.map(function (v) {
          return '<div class="rounded-xl border border-gray-100 p-4 flex gap-3">' +
            (v.code ? '<div class="h-9 px-2 rounded-xl shrink-0 flex items-center justify-center font-black text-white text-xs tracking-wide" ' +
              'style="background:var(--navy);min-width:36px">' + esc(v.code) + '</div>' : '') +
            '<div class="min-w-0"><div class="font-black text-sm">' + esc(v.title) + '</div>' +
            (v.detail ? '<div class="text-xs font-semibold text-gray-500 mt-0.5">' + esc(v.detail) + '</div>' : '') +
            '</div></div>'; }).join('') + '</div>'
        : '<p class="text-sm font-semibold text-gray-400">No values yet.</p>') +
    '</div>';

  var goalRow = function (g) {
    var canStatus = g.canManage || g.owner === STATE.user.username;
    var p = parentOf(g);
    return '<div class="goalRow py-3 border-t border-gray-100 first:border-t-0" data-id="' + esc(g.id) + '">' +
      '<div class="flex flex-wrap items-center gap-3">' +
      '<div class="flex-1 min-w-[200px]">' +
        '<div class="font-black text-sm">' + (g.scope === 'dept' ? '<span class="chip t-violet mr-1.5">' + esc(g.dept) + '</span>' : '') + esc(g.title) + '</div>' +
        '<div class="text-[11px] font-semibold text-gray-400">' + esc(g.ownerName) +
          (p && g.scope === 'dept' ? ' · serves <span class="text-gray-600">' + esc(p) + '</span>' : '') +
          (g.status === 'At risk' && g.note ? ' · <span class="text-amber-700">' + esc(g.note) + '</span>' : '') + '</div></div>' +
      metricBar(g) + outlookBadge(g) +
      (g.canCheckIn ? '<button class="btn btn-g text-xs py-1.5 goalFigure" onclick="openGoalCheckin(\'' + esc(g.id) + '\')">Enter figure</button>' : '') +
      (canStatus
        ? '<select class="in max-w-[130px] text-xs py-1.5 goalStatus" title="Your status for this goal" aria-label="Status" data-id="' + esc(g.id) + '">' +
            d.statuses.map(function (s) { return '<option' + (s === g.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
          '</select>'
        : (g.status !== 'On course' ? '<span class="chip ' + GOAL_TONE[g.status] + '" title="Set by the owner">Marked ' + esc(g.status.toLowerCase()) + '</span>' : '')) +
      (g.canManage ? '<button class="text-gray-400 hover:text-gray-800" title="Edit" onclick="openGoalEditor(\'' + esc(g.id) + '\')">' +
        '<span class="material-icons text-[18px]">edit</span></button>' : '') +
    '</div>' +
    (g.outlook && g.outlook.reason && g.outlook.verdict !== 'Dropped' ? '<div class="text-[11px] font-semibold text-gray-500 mt-1 goalReason">' + esc(g.outlook.reason) + '</div>' : '') +
    '</div>';
  };

  var placed = {};
  var withServing = function (g) {
    placed[g.id] = 1;
    var under = quarters.filter(function (x) { return x.parent === g.id && !placed[x.id]; });
    return goalRow(g) + (under.length ? '<div class="pl-4 ml-1 border-l-2 border-violet-100">' + under.map(withServing).join('') + '</div>' : '');
  };
  var groups = years.map(function (y) {
    var kids = quarters.filter(function (g) { return g.parent === y.id; });
    return '<div class="bg-white rounded-2xl border border-gray-100 p-5 mb-4">' +
      '<div class="flex flex-wrap items-center gap-3 mb-2">' +
        '<span class="chip t-plum">Year goal · ' + esc(y.period) + (y.scope === 'dept' ? ' · ' + esc(y.dept) : '') + '</span>' +
        '<div class="font-black flex-1 min-w-[200px]">' + esc(y.title) + '</div>' + metricBar(y) + outlookBadge(y) +
        (y.canCheckIn ? '<button class="btn btn-g text-xs py-1.5 goalFigure" onclick="openGoalCheckin(\'' + esc(y.id) + '\')">Enter figure</button>' : '') +
        (y.canManage ? '<button class="text-gray-400 hover:text-gray-800" onclick="openGoalEditor(\'' + esc(y.id) + '\')">' +
          '<span class="material-icons text-[18px]">edit</span></button>' : '') + '</div>' +
      (kids.length ? kids.map(withServing).join('')
                   : '<div class="text-xs font-semibold text-gray-400 py-2">No ' + esc(q.replace(/^FY\S+ /, '')) + ' goals under this yet.</div>') +
    '</div>';
  }).join('');
  var loose = quarters.filter(function (g) { return !placed[g.id] && !(g.parent && quarters.some(function (x) { return x.id === g.parent; })); });
  var looseHtml = loose.map(withServing).join('') + quarters.filter(function (g) { return !placed[g.id]; }).map(goalRow).join('');
  if (looseHtml) groups += '<div class="bg-white rounded-2xl border border-gray-100 p-5 mb-4">' +
    (years.length ? '<div class="lb">Not under a year goal</div>' : '') + looseHtml + '</div>';
  if (!years.length && !quarters.length) groups = '<div class="bg-white rounded-2xl border border-dashed border-gray-200 p-8 text-center ' +
    'text-sm font-bold text-gray-400 mb-4">No goals for ' + esc(q) + ' yet.' +
    (d.canEdit ? ' Start with one year goal, then the three to seven things this quarter that move it.' : '') + '</div>';

  var owners = {}; d.goals.forEach(function (g) { owners[g.owner] = g.ownerName; });
  var wheres = {}; d.goals.forEach(function (g) { wheres[goalWhere(g)] = 1; });
  (d.depts || []).forEach(function (x) { wheres[x] = 1; });
  var whereNames = Object.keys(wheres).sort(function (a, b) { return a === 'Company' ? -1 : b === 'Company' ? 1 : a.localeCompare(b); });

  $('goalsBody').innerHTML = valuesBlock +
    '<div class="flex flex-wrap items-center gap-2 mb-4">' +
      '<h2 class="text-xl font-black mr-auto">Goals</h2>' +
      '<select id="gQ" class="in max-w-[170px]">' + d.quarters.map(function (x) {
        return '<option' + (x === q ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' +
      (whereNames.length > 1 ? '<select id="gScope" class="in max-w-[170px]"><option value="">All goals</option>' + whereNames.map(function (x) {
        return '<option value="' + esc(x) + '"' + (x === GOALS.scope ? ' selected' : '') + '>' + esc(x === 'Company' ? 'Company goals' : x) + '</option>'; }).join('') + '</select>' : '') +
      '<select id="gOwner" class="in max-w-[170px]"><option value="">Everyone</option>' + Object.keys(owners).map(function (u) {
        return '<option value="' + esc(u) + '"' + (u === GOALS.owner ? ' selected' : '') + '>' + esc(owners[u]) + '</option>'; }).join('') + '</select>' +
      (d.canEdit ? '<button class="btn btn-p" onclick="openGoalEditor()">+ Goal</button>' : '') +
    '</div>' + (d.canEdit ? renderGoalReview(d, reviewList) : '') + groups + renderNumbers(d);

  $('gQ').addEventListener('change', function () { GOALS.quarter = this.value; renderGoals(d); });
  if ($('gScope')) $('gScope').addEventListener('change', function () { GOALS.scope = this.value; renderGoals(d); });
  $('gOwner').addEventListener('change', function () { GOALS.owner = this.value; renderGoals(d); });
  document.querySelectorAll('.goalStatus').forEach(function (sel) {
    sel.addEventListener('change', function () { setGoalStatus(sel.dataset.id, sel.value); });
  });
  document.querySelectorAll('.numIn').forEach(function (inp) {
    inp.addEventListener('change', function () {
      api('recordNumber', { id: inp.dataset.id, value: inp.value })
        .then(function (r) { toast(r.hit === false ? 'Saved — below target.' : 'Saved.', r.hit === false ? 'info' : 'ok'); loadGoals(); })
        .catch(function (e) { toast(e.message, 'err'); });
    });
  });
}

function setGoalStatus(id, status, after) {
  var send = function (note) {
    return api('setGoalStatus', { id: id, goalStatus: status, note: note || '' })
      .then(function (r) { toast(r.message, 'ok'); return loadDirection(); })
      .then(function () { if (after) after(); else if (STATE.tab === 'goals') renderGoals(STATE.dir); })
      .catch(function (e) { toast(e.message, 'err'); if (after) after(); else if (STATE.tab === 'goals') loadGoals(); });
  };
  if (status !== 'At risk') return send('');
  /* "At risk" needs a reason, asked for in a form rather than a browser prompt
     — prompts are blocked or clumsy on phones, which is where a goal owner
     often is when they find out. */
  openModal('<form id="fRisk" class="p-6 lg:p-7">' +
    '<h2 class="text-xl font-black mb-1">What is putting it at risk?</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-4">One line. It is shown next to the goal, so the conversation starts in the right place.</p>' +
    '<input id="riskNote" class="in mb-5" required minlength="3" placeholder="e.g. Motor supplier slipped two weeks">' +
    '<div class="flex gap-3"><button type="button" class="btn btn-g flex-1" id="riskCancel">Cancel</button>' +
    '<button type="submit" class="btn btn-p flex-1">Mark at risk</button></div></form>', 'max-w-md');
  setTimeout(function () { $('riskNote').focus(); }, 30);
  $('riskCancel').addEventListener('click', function () {
    closeModal(); if (after) after(); else if (STATE.tab === 'goals') renderGoals(STATE.dir); });
  $('fRisk').addEventListener('submit', function (e) {
    e.preventDefault(); var n = $('riskNote').value; closeModal(); send(n); });
}

function renderNumbers(d) {
  var n = d.numbers;
  var weekLabel = function (w) { var x = new Date(w + 'T00:00:00'); return x.getDate() + ' ' + x.toLocaleString('en-IN', { month: 'short' }); };
  return '<div class="flex items-center gap-2 mt-8 mb-3"><h2 class="text-xl font-black mr-auto">Key numbers</h2>' +
      (d.canEdit ? '<button class="btn btn-g" onclick="openNumberEditor()">+ Number</button>' : '') + '</div>' +
    (n.list.length ? '<div class="bg-white rounded-2xl border border-gray-100 overflow-x-auto"><table class="w-full text-sm">' +
      '<thead><tr class="text-[10px] font-black uppercase tracking-widest text-gray-400 text-left">' +
        '<th class="py-2 pl-4">Number</th><th>Owner</th><th>Target</th>' +
        n.weeks.slice(0, 5).map(function (w) { return '<th class="text-center">' + weekLabel(w) + '</th>'; }).join('') +
        '<th class="text-center pr-4">This week</th></tr></thead><tbody>' +
      n.list.map(function (x) {
        var can = d.canEdit || x.owner === STATE.user.username;
        var cur = x.weeks[x.weeks.length - 1];
        return '<tr class="border-t border-gray-100">' +
          '<td class="py-2.5 pl-4 font-black">' + esc(x.name) + (x.goal ? '<div class="text-[10px] font-bold text-gray-400">◎ ' + esc(goalTitle(x.goal)) + '</div>' : '') + '</td>' +
          '<td class="text-xs font-semibold text-gray-500">' + esc(x.ownerName) + '</td>' +
          '<td class="text-xs font-bold whitespace-nowrap">' + (x.target === null ? '—' : (x.direction === 'at most' ? '≤ ' : '≥ ') +
            esc(x.target) + ' ' + esc(x.unit)) + '</td>' +
          x.weeks.slice(0, 5).map(function (w) {
            return '<td class="text-center text-xs font-black ' + (w.hit === true ? 'text-teal-700' : w.hit === false ? 'text-red-600' : 'text-gray-300') + '">' +
              (w.value === null ? '·' : esc(w.value)) + '</td>'; }).join('') +
          '<td class="text-center pr-4">' + (can
            ? '<input style="width:96px" class="in numIn text-center py-1.5 ' + (cur.hit === false ? 'border-red-300' : '') + '" data-id="' + esc(x.id) +
              '" value="' + (cur.value === null ? '' : esc(cur.value)) + '" inputmode="decimal" aria-label="' + esc(x.name) + ' this week">'
            : '<span class="font-black ' + (cur.hit === false ? 'text-red-600' : '') + '">' + (cur.value === null ? '·' : esc(cur.value)) + '</span>') +
          '</td></tr>'; }).join('') + '</tbody></table></div>'
      : '<div class="bg-white rounded-2xl border border-dashed border-gray-200 p-8 text-center text-sm font-bold text-gray-400">' +
        'No key numbers yet. Pick the five to fifteen weekly figures that tell you whether the week went well.</div>');
}

/* ---------- editors ------------------------------------------------------ */

function staffOptionsHtml(selected) {
  return ((STATE.data && STATE.data.staff) || []).filter(function (u) { return u.active !== false; }).map(function (u) {
    return '<option value="' + esc(u.username) + '"' + (u.username === selected ? ' selected' : '') + '>' + esc(u.name) + '</option>';
  }).join('');
}

function openDirectionEditor() {
  var d = STATE.dir;
  var rows = (d.values.length ? d.values : [{}, {}, {}]).concat([{}]);
  var row = function (v, i) {
    return '<div class="grid gap-2 mb-2 dvRow" style="grid-template-columns:64px 1fr">' +
      '<input class="in text-center font-black dvCode" maxlength="3" placeholder="C" value="' + esc(v.code || '') + '" aria-label="Short code">' +
      '<input class="in dvTitle" placeholder="e.g. Customer first" value="' + esc(v.title || '') + '" aria-label="Value">' +
      '<div></div><input class="in dvDetail text-xs" placeholder="What it looks like in practice (optional)" value="' + esc(v.detail || '') + '">' +
    '</div>';
  };
  openModal('<form id="fDir" class="p-6 lg:p-7">' +
    '<h2 class="text-2xl font-black mb-1">Purpose &amp; values</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">Set once, used every week: stories in meetings and cookie ' +
      'awards are tagged to these.</p>' +
    '<label class="lb" for="dvPurpose">Purpose — why the company exists</label>' +
    '<textarea id="dvPurpose" class="in mb-5" rows="2" placeholder="One sentence.">' + esc(d.purpose || '') + '</textarea>' +
    '<div class="lb">Values <span class="normal-case tracking-normal font-semibold">— a short code, the value, and what it looks like</span></div>' +
    '<div id="dvRows">' + rows.map(row).join('') + '</div>' +
    '<button type="button" class="hc-link mb-5" id="dvAdd">+ Another value</button>' +
    '<div class="flex gap-3"><button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
    '<button type="submit" class="btn btn-p flex-1">Save</button></div></form>', 'max-w-xl');
  $('dvAdd').addEventListener('click', function () { $('dvRows').insertAdjacentHTML('beforeend', row({}, 0)); });
  $('fDir').addEventListener('submit', function (e) {
    e.preventDefault();
    var vals = Array.prototype.map.call(document.querySelectorAll('.dvRow'), function (r) {
      return { code: r.querySelector('.dvCode').value, title: r.querySelector('.dvTitle').value,
               detail: r.querySelector('.dvDetail').value }; });
    busy(e.target.querySelector('button[type=submit]'), true, 'Saving…');
    api('saveDirection', { form: { purpose: $('dvPurpose').value, values: vals } })
      .then(function (r) { toast(r.message, 'ok'); closeModal(); loadGoals(); })
      .catch(function (err) { busy(e.target.querySelector('button[type=submit]'), false); toast(err.message, 'err'); });
  });
}

function openGoalEditor(id) {
  var d = STATE.dir;
  var g = id ? d.goals.filter(function (x) { return x.id === id; })[0] : null;
  var level = g ? g.level : 'quarter';
  /* Admins set company goals and any department's; a head of department sets their own department's. */
  var where = g ? goalWhere(g) : (d.canCompanyGoals ? (GOALS.scope || 'Company') : (d.myDept || ''));
  var choices = (d.canCompanyGoals ? ['Company'] : []).concat(d.depts || []);
  if (where && choices.indexOf(where) < 0) choices.push(where);
  var m = g && g.metric;
  if (!g && !d.canCompanyGoals && !(d.depts || []).length) {
    toast('Your department is not set yet. Ask an Admin to set it on your profile, then you can set goals for your team.', 'info');
    return;
  }
  openModal('<form id="fGoalEdit" class="p-6 lg:p-7">' +
    '<h2 class="text-2xl font-black mb-4">' + (g ? 'Edit goal' : 'New goal') + '</h2>' +
    '<div class="seg flex gap-1 bg-gray-100 p-1 rounded-xl mb-4" id="glLevel">' +
      ['quarter', 'year'].map(function (l) { return '<button type="button" data-l="' + l + '" class="flex-1 text-xs' +
        (l === level ? ' on' : '') + '">' + (l === 'year' ? 'Year goal' : 'Quarter goal') + '</button>'; }).join('') + '</div>' +
    (choices.length > 1 || !d.canCompanyGoals
      ? '<label class="lb" for="glWhere">Whose goal</label><select id="glWhere" class="in mb-4"' + (g ? ' disabled' : '') + '>' + choices.map(function (x) {
          return '<option value="' + esc(x) + '"' + (x === where ? ' selected' : '') + '>' + esc(x === 'Company' ? 'Company goal' : x + ' department') + '</option>'; }).join('') + '</select>'
      : '') +
    '<label class="lb" for="glTitle">Goal</label>' +
    '<input id="glTitle" class="in mb-1" required maxlength="140" value="' + esc(g ? g.title : '') + '" ' +
      'placeholder="Specific enough that everyone agrees whether it happened">' +
    '<div class="text-[11px] font-semibold text-gray-400 mb-4">Done or not done by the end of the period — no "improve" or "work on".</div>' +
    '<label class="lb" for="glDetail">Detail</label>' +
    '<textarea id="glDetail" class="in mb-4" rows="2">' + esc(g ? g.detail : '') + '</textarea>' +
    '<div class="grid grid-cols-2 gap-4 mb-4">' +
      '<div><label class="lb" for="glOwner">Owner</label><select id="glOwner" class="in"></select></div>' +
      '<div id="glPeriodWrap"><label class="lb" for="glPeriod">Quarter</label><select id="glPeriod" class="in">' +
        d.quarters.map(function (x) { return '<option' + (x === (g ? g.period : GOALS.quarter || d.now.quarter) ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') +
      '</select></div></div>' +
    '<div class="rounded-xl border border-gray-100 p-4 mb-4">' +
      '<div class="lb mb-1">Target figure (optional)</div>' +
      '<div class="text-[11px] font-semibold text-gray-400 mb-3">Give it a number and the owner enters where it stands each week. Domebox then tells you whether it is on track.</div>' +
      '<div class="grid grid-cols-3 gap-3">' +
        '<div><label class="lb" for="glStart">Starts at</label><input id="glStart" class="in" type="number" step="any" value="' + (m ? esc(String(m.start)) : '') + '" placeholder="0"></div>' +
        '<div><label class="lb" for="glTarget">Target</label><input id="glTarget" class="in" type="number" step="any" value="' + (m ? esc(String(m.target)) : '') + '" placeholder="e.g. 95"></div>' +
        '<div><label class="lb" for="glUnit">Unit</label><input id="glUnit" class="in" maxlength="20" value="' + (m ? esc(m.unit) : '') + '" placeholder="%, lakh, pcs"></div>' +
      '</div><div class="text-[11px] font-semibold text-gray-400 mt-2">For a figure that should come down (rejections, days late), put a target lower than the start.</div></div>' +
    '<div id="glParentWrap" class="mb-5"><label class="lb" for="glParent">Serves</label><select id="glParent" class="in"></select></div>' +
    '<div class="flex gap-3">' +
      (g ? '<button type="button" class="btn btn-g" id="glDel">Delete</button>' : '') +
      '<button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
      '<button type="submit" class="btn btn-p flex-1">Save</button></div></form>', 'max-w-lg');

  var curWhere = function () { return $('glWhere') ? $('glWhere').value : where; };
  var paintOwners = function () {
    var w = curWhere(), keep = $('glOwner').value || (g ? g.owner : STATE.user.username);
    var staff = ((STATE.data && STATE.data.staff) || []).filter(function (u) { return u.active !== false; });
    var pool = w === 'Company' ? staff : staff.filter(function (u) { return u.dept === w || u.username === STATE.user.username && !d.canCompanyGoals; });
    if (!pool.length) { $('glOwner').innerHTML = staffOptionsHtml(keep); return; }
    if (!pool.some(function (u) { return u.username === keep; })) keep = pool.some(function (u) { return u.username === STATE.user.username; }) ? STATE.user.username : pool[0].username;
    $('glOwner').innerHTML = pool.map(function (u) {
      return '<option value="' + esc(u.username) + '"' + (u.username === keep ? ' selected' : '') + '>' + esc(u.name) + '</option>'; }).join('');
  };
  var paintParents = function () {
    var w = curWhere(), keep = $('glParent').value || (g ? g.parent : '');
    var live = d.goals.filter(function (x) { return x.status !== 'Dropped' && (!g || x.id !== g.id); });
    var opts = [];
    if (w === 'Company') {
      if (level === 'quarter') opts = live.filter(function (x) { return x.level === 'year' && x.scope !== 'dept'; });
    } else {
      opts = live.filter(function (x) { return x.scope !== 'dept' || (level === 'quarter' && x.level === 'year' && x.dept === w); });
    }
    $('glParentWrap').classList.toggle('hidden', !opts.length && w === 'Company' && level === 'year');
    $('glParent').innerHTML = '<option value="">' + (w === 'Company' ? 'None' : 'No company goal') + '</option>' + opts.map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (x.id === keep ? ' selected' : '') + '>' +
        esc((x.scope === 'dept' ? x.dept + ': ' : 'Company: ') + x.title + (x.level === 'quarter' ? ' (' + x.period.replace(/^FY\S+ /, '') + ')' : ' (year)')) + '</option>'; }).join('');
  };
  var paint = function () {
    $('glPeriodWrap').classList.toggle('hidden', level === 'year');
    document.querySelectorAll('#glLevel button').forEach(function (b) { b.classList.toggle('on', b.dataset.l === level); });
    paintParents();
  };
  document.querySelectorAll('#glLevel button').forEach(function (b) {
    b.addEventListener('click', function () { level = b.dataset.l; paint(); }); });
  if ($('glWhere')) $('glWhere').addEventListener('change', function () { paintOwners(); paintParents(); });
  paintOwners(); paint();
  if ($('glDel')) $('glDel').addEventListener('click', function () {
    api('deleteGoal', { id: g.id }).then(function (r) { toast(r.message, 'ok'); closeModal(); loadGoals(); })
      .catch(function (e) { toast(e.message, 'err'); });
  });
  $('fGoalEdit').addEventListener('submit', function (e) {
    e.preventDefault();
    var w = curWhere();
    api('saveGoal', { form: { id: g ? g.id : '', level: level, title: $('glTitle').value, detail: $('glDetail').value,
      owner: $('glOwner').value, period: level === 'year' ? '' : $('glPeriod').value,
      parent: $('glParentWrap').classList.contains('hidden') ? '' : $('glParent').value, status: g ? g.status : 'On course',
      scope: w === 'Company' ? 'company' : 'dept', dept: w === 'Company' ? '' : w,
      start: $('glStart').value, target: $('glTarget').value, unit: $('glUnit').value } })
      .then(function (r) { toast(r.message, 'ok'); closeModal(); loadGoals(); })
      .catch(function (err) { toast(err.message, 'err'); });
  });
}

function openNumberEditor() {
  openModal('<form id="fNum" class="p-6 lg:p-7">' +
    '<h2 class="text-2xl font-black mb-4">New key number</h2>' +
    '<label class="lb" for="nmName">Number</label><input id="nmName" class="in mb-4" required placeholder="e.g. Fans despatched">' +
    '<div class="grid grid-cols-3 gap-3 mb-4">' +
      '<div><label class="lb" for="nmDir">Good is</label><select id="nmDir" class="in"><option value="at least">at least</option>' +
        '<option value="at most">at most</option></select></div>' +
      '<div><label class="lb" for="nmTarget">Target</label><input id="nmTarget" class="in" inputmode="decimal"></div>' +
      '<div><label class="lb" for="nmUnit">Unit</label><input id="nmUnit" class="in" placeholder="units, %, ₹ lakh"></div></div>' +
    '<div class="grid grid-cols-2 gap-3 mb-5">' +
      '<div><label class="lb" for="nmOwner">Owner</label><select id="nmOwner" class="in">' + staffOptionsHtml(STATE.user.username) + '</select></div>' +
      '<div><label class="lb" for="nmGoal">Tracks goal</label><select id="nmGoal" class="in">' + goalOptions('', 'None') + '</select></div></div>' +
    '<div class="flex gap-3"><button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
    '<button type="submit" class="btn btn-p flex-1">Add</button></div></form>', 'max-w-lg');
  $('fNum').addEventListener('submit', function (e) {
    e.preventDefault();
    api('saveNumber', { form: { name: $('nmName').value, direction: $('nmDir').value, target: $('nmTarget').value,
      unit: $('nmUnit').value, owner: $('nmOwner').value, goal: $('nmGoal').value } })
      .then(function (r) { toast(r.message, 'ok'); closeModal(); loadGoals(); })
      .catch(function (err) { toast(err.message, 'err'); });
  });
}
