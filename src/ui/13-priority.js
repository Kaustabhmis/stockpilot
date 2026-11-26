/* ---------- the priority list ---------------------------------------------
   A board shows everything at once, which is the wrong shape for the question
   people actually ask on a Monday morning: what do I do first? This answers it
   over a chosen stretch of time — today, this week, this month, this quarter,
   this year — and shows its working on every row, because a ranking nobody can
   see the reasoning for is one people quietly ignore.
   -------------------------------------------------------------------------- */
var PRIORITY_VIEW = { horizon: 'week', person: '' };

function loadPriority() {
  var me = STATE.data.user || {};
  var sel = $('prPerson');
  if (me.role === 'Doer') {
    sel.classList.add('hidden');
  } else {
    sel.classList.remove('hidden');
    var staff = (STATE.data.staff || []).filter(function (u) { return u.active !== false; });
    sel.innerHTML = staff.map(function (u) {
      return '<option value="' + esc(u.username) + '"' +
        ((PRIORITY_VIEW.person || me.username) === u.username ? ' selected' : '') + '>' +
        esc(u.name) + (u.username === me.username ? ' (you)' : '') + '</option>';
    }).join('');
  }
  $('prBody').innerHTML = '<p class="text-sm text-gray-400 font-semibold">Working out the order…</p>';
  api('getPriorityList', { username: PRIORITY_VIEW.person || me.username,
                           horizon: PRIORITY_VIEW.horizon })
    .then(renderPriority)
    .catch(function (e) {
      $('prBody').innerHTML = '<p class="text-sm font-bold text-red-700">' + esc(e.message) + '</p>'; });
}

function renderPriority(r) {
  PRIORITY_VIEW.horizon = r.horizon;

  $('prHorizons').innerHTML = r.horizons.map(function (h) {
    var on = h.key === r.horizon, n = r.counts[h.key] || 0;
    return '<button type="button" data-h="' + h.key + '" ' +
      'class="px-4 py-2 rounded-xl text-xs font-black border-2 ' +
      (on ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500') + '">' +
      esc(h.label) + ' <span class="' + (on ? 'text-blue-500' : 'text-gray-400') + '">' + n + '</span>' +
      '</button>';
  }).join('');
  $('prHorizons').querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () { PRIORITY_VIEW.horizon = b.dataset.h; loadPriority(); });
  });

  /* Decisions this person owes other people go at the very top. The score
     charges them for sitting on these, so burying them under their own work
     would be telling them to do one thing while marking them down for another. */
  var decisions = (r.decisions || []).length
    ? '<h3 class="text-[11px] font-black uppercase tracking-widest text-coral-700 mt-2 mb-1">' +
      'Waiting on you</h3>' +
      '<p class="text-xs font-semibold text-gray-400 mb-2">Other people cannot move until you ' +
      'decide. Holding these costs you score.</p>' +
      r.decisions.map(function (d) {
        return '<div data-task="' + esc(d.id) + '" class="bg-white rounded-2xl border-2 ' +
          'border-coral-300 p-4 mb-2 cursor-pointer hover:shadow-lift transition flex gap-3 items-start">' +
          '<span class="material-icons text-coral-600">' +
            (d.kind === 'review' ? 'rate_review' : 'how_to_reg') + '</span>' +
          '<div class="min-w-0 flex-1"><div class="font-bold text-gray-900">' + esc(d.title) + '</div>' +
          '<div class="text-[13px] font-semibold text-gray-500 mt-0.5">' +
            esc((d.kind === 'review' ? 'To review' : 'To approve') + ' · ' + nameOf(d.assignee)) + '</div>' +
          '<div class="flex flex-wrap gap-1.5 mt-2">' + d.reasons.map(function (x) {
            return '<span class="chip ' + (x.kind === 'held' ? 'bg-red-50 text-red-700'
              : 'bg-gray-100 text-gray-600') + '">' + esc(x.text) + '</span>'; }).join('') +
          '</div></div></div>';
      }).join('')
    : '';

  var handed = (r.handedIn || []).length
    ? '<h3 class="text-[11px] font-black uppercase tracking-widest text-gray-500 mt-6 mb-1">' +
      'Handed in, with someone else</h3>' +
      '<p class="text-xs font-semibold text-gray-400 mb-2">Done your end. Not in the order above ' +
      'because it is not yours to move.</p>' +
      r.handedIn.map(function (x) {
        return '<div data-task="' + esc(x.id) + '" class="bg-gray-50 rounded-2xl border-2 ' +
          'border-gray-200 p-4 mb-2 cursor-pointer hover:bg-white transition">' +
          '<div class="font-bold text-gray-700">' + esc(x.title) + '</div>' +
          '<div class="text-[13px] font-semibold text-gray-500 mt-0.5">Waiting to be reviewed</div>' +
          '</div>';
      }).join('')
    : '';

  if (!r.total && !decisions && !handed) {
    $('prBody').innerHTML = '<div class="bg-white rounded-3xl border-2 border-gray-200 p-10 text-center">' +
      '<span class="material-icons text-emerald-600 text-3xl">task_alt</span>' +
      '<p class="font-black text-gray-700 mt-2">Nothing open in this window.</p>' +
      '<p class="text-sm text-gray-400 font-semibold mt-1">' +
        (r.counts.all ? 'There is work further out — try a wider window.'
                      : 'No open work at all. Enjoy it.') + '</p></div>';
    return;
  }

  var head = '<div class="flex flex-wrap gap-2 mb-4 text-xs font-bold">' +
    (r.overdue ? '<span class="chip bg-red-50 text-red-700">' + r.overdue + ' overdue</span>' : '') +
    '<span class="chip bg-gray-100 text-gray-600">' + r.total + ' of your own</span>' +
    ((r.decisions || []).length ? '<span class="chip bg-coral-100 text-coral-700">' +
      r.decisions.length + ' waiting on you</span>' : '') +
    (r.horizonEnd ? '<span class="chip bg-gray-100 text-gray-600">up to ' +
      esc(fmtDate(r.horizonEnd)) + '</span>' : '') +
    (r.undated ? '<span class="chip bg-amber-50 text-amber-800">' + r.undated +
      ' with no date</span>' : '') +
    '</div>';

  $('prBody').innerHTML = head + decisions +
    band('Do these now', r.doNow, 'border-blue-600', true) +
    band('Then these', r.next, 'border-gray-200', false) +
    band('After that', r.later, 'border-gray-200', false) +
    waitingBand(r.waiting) + handed;

  $('prBody').querySelectorAll('[data-task]').forEach(function (el) {
    el.addEventListener('click', function () { openTask(el.dataset.task); });
  });
}

function band(title, rows, border, lead) {
  if (!rows.length) return '';
  return '<h3 class="text-[11px] font-black uppercase tracking-widest text-gray-500 mt-6 mb-2">' +
    esc(title) + '</h3>' +
    rows.map(function (r, i) { return priorityRow(r, lead ? i + 1 : null, border); }).join('');
}

function priorityRow(r, n, border) {
  var tone = { overdue: 'bg-red-50 text-red-700', today: 'bg-coral-50 text-coral-700',
               soon: 'bg-amber-50 text-amber-800', blocking: 'bg-blue-50 text-blue-700',
               priority: 'bg-gray-100 text-gray-600', started: 'bg-emerald-50 text-emerald-700',
               later: 'bg-gray-100 text-gray-500' };
  return '<div data-task="' + esc(r.id) + '" ' +
    'class="bg-white rounded-2xl border-2 ' + border + ' p-4 mb-2 cursor-pointer hover:shadow-lift ' +
    'transition flex gap-4 items-start">' +
    (n ? '<span class="h-8 w-8 rounded-full bg-blue-600 text-white text-sm font-black ' +
         'flex items-center justify-center shrink-0">' + n + '</span>' : '') +
    '<div class="min-w-0 flex-1">' +
      '<div class="font-bold text-gray-900 leading-snug">' + esc(r.title) + '</div>' +
      (r.projectName ? '<div class="text-[11px] font-bold text-violet-700 mt-0.5">' +
        esc(r.projectName + ' · stage ' + r.stageNo) + '</div>' : '') +
      '<div class="flex flex-wrap gap-1.5 mt-2">' +
        r.reasons.map(function (x) {
          return '<span class="chip ' + (tone[x.kind] || 'bg-gray-100 text-gray-600') + '">' +
            esc(x.text) + '</span>'; }).join('') +
      '</div></div>' +
    '<div class="text-right shrink-0">' +
      '<div class="text-[11px] font-black uppercase tracking-widest text-gray-400">Due</div>' +
      '<div class="text-sm font-black whitespace-nowrap">' + esc(fmtDate(r.due)) + '</div>' +
    '</div></div>';
}

/* Blocked work is shown, but out of the running order: however urgent it is,
   nobody can act on it, and leaving it at the top is how a list stops being
   read. What it is waiting on is named, so the next move is obvious. */
function waitingBand(rows) {
  if (!rows.length) return '';
  return '<h3 class="text-[11px] font-black uppercase tracking-widest text-gray-500 mt-6 mb-1">' +
    'Waiting on something else</h3>' +
    '<p class="text-xs font-semibold text-gray-400 mb-2">You cannot start these yet. They are not ' +
    'in the order above because nobody can act on them today.</p>' +
    rows.map(function (r) {
      return '<div data-task="' + esc(r.id) + '" class="bg-gray-50 rounded-2xl border-2 ' +
        'border-gray-200 p-4 mb-2 cursor-pointer hover:bg-white transition">' +
        '<div class="font-bold text-gray-700">' + esc(r.title) + '</div>' +
        '<div class="text-[13px] font-semibold text-gray-500 mt-0.5">Waiting on ' +
          esc(r.blockedBy.map(function (b) { return b.title; }).join(', ')) + '</div></div>';
    }).join('');
}
