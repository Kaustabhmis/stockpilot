/* ---------------------------------------------------------------------------
   THE LEADERBOARD

   Top of the month to bottom. The ordering rules live on the server — this
   file's only job is to make the order legible, and to keep three things on
   screen that a bare list of names would leave out:

     · WHY somebody is where they are. Score, delivered, on-time and load are
       all visible, so first place is a fact rather than a claim.
     · WHO MOVED. "Up four" is the part people act on; a static wall of names
       is read once and ignored.
     · WHO IS NOT RANKED, and why. Listing someone as last because they were on
       leave is the single fastest way to make a team hate a leaderboard.

   The bar is one hue at varying length, because it encodes a magnitude. Rank
   is already carried by position, so colouring by rank would say the same
   thing twice and leave nothing for the band to say.
--------------------------------------------------------------------------- */

var LB = { period: 'month', offset: 0, data: null };

function loadLeaderboard() {
  if (!$('lbOffset').options.length) fillLbOffsets();
  $('lbBody').innerHTML = '<div class="text-sm font-bold text-gray-400 py-10 text-center">Working out the order…</div>';
  api('getLeaderboard', { period: LB.period, offset: LB.offset })
    .then(function (r) { LB.data = r; renderLeaderboard(r); })
    .catch(function (e) {
      $('lbBody').innerHTML = '<div class="text-sm font-bold text-gray-400 py-10 text-center">' +
        esc(e.message) + '</div>';
    });
}

function setLbPeriod(p) {
  LB.period = p; LB.offset = 0;
  document.querySelectorAll('#lbPeriod button').forEach(function (b) {
    b.classList.toggle('on', b.dataset.p === p); });
  fillLbOffsets();
  loadLeaderboard();
}

function fillLbOffsets() {
  var label = { week: 'week', month: 'month', quarter: 'quarter', year: 'year' }[LB.period];
  var opts = [];
  for (var i = 0; i < 12; i++) {
    opts.push('<option value="' + i + '"' + (i === LB.offset ? ' selected' : '') + '>' +
      (i === 0 ? 'This ' + label : i === 1 ? 'Last ' + label : i + ' ' + label + 's ago') + '</option>');
  }
  $('lbOffset').innerHTML = opts.join('');
}

/* Columns are hidden with the project's own md-up / md-down / sm-up helpers,
   never with Tailwind's `hidden md:table-cell`: .hidden carries !important in
   this stylesheet, so it beats the breakpoint rule and the column never comes
   back. The helpers hide without .hidden, so the cell's natural display
   survives. */
var MEDAL = ['🥇', '🥈', '🥉'];

function moveChip(r) {
  if (r.movement === 'new') return '<span class="text-[10px] font-black text-gray-400">NEW</span>';
  if (r.movement === 'same') return '<span class="text-[10px] font-black text-gray-300">—</span>';
  var up = r.movement === 'up';
  return '<span class="text-[10px] font-black ' + (up ? 'text-green-600' : 'text-red-500') + '">' +
    (up ? '▲' : '▼') + ' ' + r.moved + '</span>';
}

function lbBar(score) {
  /* One hue, length carries the number. The track is always full width so the
     bars are read against a common baseline rather than against each other. */
  return '<div class="h-2 rounded-full bg-gray-100 overflow-hidden w-full">' +
    '<div class="h-2 rounded-full" style="width:' + Math.max(2, Number(score) || 0) +
    '%;background:#5b4bdb"></div></div>';
}

function championCard(c, shared, range, belowFirst) {
  if (!c) {
    return '<div class="rounded-2xl border-2 border-dashed border-gray-200 p-6 text-center mb-6">' +
      '<div class="text-sm font-black text-gray-400">No one is named for ' + esc(range.label) + '.</div>' +
      '<div class="text-xs font-semibold text-gray-400 mt-1">Nobody delivered a full enough load of ' +
      'their own to be crowned on it. The ranking below still stands.</div></div>';
  }
  return '<div class="rounded-2xl p-6 mb-6 text-white" style="background:linear-gradient(135deg,#5b4bdb,#8e3fb8)">' +
    '<div class="text-[11px] font-black uppercase tracking-widest opacity-80">' +
      (shared ? 'Joint best delivery in ' : 'Best delivery in ') + esc(range.label) + '</div>' +
    '<div class="flex items-center gap-4 mt-3">' +
      '<div class="text-4xl">' + MEDAL[0] + '</div>' +
      '<div class="flex-1 min-w-0">' +
        '<div class="text-2xl font-black truncate">' + esc(c.name) + '</div>' +
        '<div class="text-xs font-bold opacity-80">' + esc(c.role || '') +
          (c.dept ? ' · ' + esc(c.dept) : '') + '</div></div>' +
      '<div class="text-right"><div class="text-4xl font-black">' + c.score + '</div>' +
        '<div class="text-[11px] font-black uppercase tracking-widest opacity-80">score</div></div>' +
    '</div>' +
    (belowFirst
      ? '<div class="text-[11px] font-bold opacity-80 mt-3">Ranked ' + ordinal(c.rank) +
        ' overall — the places above are approvals cleared rather than work delivered.</div>'
      : '') +
    '<div class="flex flex-wrap gap-4 mt-4 text-xs font-bold opacity-90">' +
      '<span>' + c.delivered + ' delivered</span>' +
      (c.onTime !== null && c.onTime !== undefined ? '<span>' + c.onTime + ' on timeliness</span>' : '') +
      (c.loadPercent !== null && c.loadPercent !== undefined ? '<span>' + c.loadPercent + '% of a full load</span>' : '') +
      (c.cookiePoints ? '<span>🍪 ' + c.cookiePoints + '</span>' : '') +
    '</div></div>';
}

function lbRow(r, mine) {
  var top3 = r.rank <= 3;
  return '<tr class="border-t border-gray-100 ' + (mine ? 'bg-blue-50' : '') + '">' +
    '<td class="py-3 pl-3 w-14"><span class="font-black text-lg ' +
      (top3 ? '' : 'text-gray-400') + '">' + (top3 ? MEDAL[r.rank - 1] : r.rank) + '</span></td>' +
    '<td class="py-3"><div class="flex items-center gap-2.5">' + avatar(r.name, 30) +
      '<div class="min-w-0"><div class="font-black text-sm truncate">' + esc(r.name) +
        (mine ? '<span class="text-[10px] font-black text-blue-600 ml-1.5">YOU</span>' : '') + '</div>' +
      '<div class="text-[11px] font-semibold text-gray-400 truncate">' + esc(r.role || '') +
        (r.dept ? ' · ' + esc(r.dept) : '') + '</div></div></div></td>' +
    '<td class="py-3 w-20 text-center">' + moveChip(r) + '</td>' +
    '<td class="py-3 w-48 md-up"><div class="flex items-center gap-2">' +
      lbBar(r.score) + '<span class="text-xs font-black w-7 text-right">' + r.score + '</span></div></td>' +
    '<td class="py-3 w-14 text-center md-down font-black">' + r.score + '</td>' +
    '<td class="py-3 w-20 text-center text-xs font-bold text-gray-500">' + r.delivered + '</td>' +
    '<td class="py-3 w-24 text-center text-xs font-bold text-gray-500 sm-up">' +
      /* The on-time COMPONENT, not the share delivered on time: a day late on
         a Low task scores better than a week late on a Critical one. Labelled
         "Timely" rather than "On time" so the number is not read as a count. */
      (r.onTime === null || r.onTime === undefined ? '—' : r.onTime) + '</td>' +
    '<td class="py-3 pr-3 w-28 text-right">' +
      (r.provisional
        ? '<span class="chip t-amber" title="Too little work closed this period for the score to be read as settled">thin month</span>'
        : r.decisionsOnly
        ? '<span class="chip t-slate" title="Scored on approvals and reviews cleared, not on work of their own">approvals</span>'
        : r.band ? '<span class="chip t-slate">' + esc(r.band) + '</span>' : '') +
    '</td></tr>';
}

function renderLeaderboard(r) {
  var mine = STATE.user.username;

  if ($('lbVisWrap')) {
    $('lbVisWrap').classList.toggle('hidden', !r.canSetVisibility);
    if (r.canSetVisibility) $('lbVis').value = r.visibility;
  }

  var head = '<thead><tr class="text-[11px] font-black uppercase tracking-widest text-gray-400 text-left">' +
    '<th class="pl-3 py-2">#</th><th>Person</th><th class="text-center">Move</th>' +
    '<th class="md-up">Score</th><th class="text-center md-down">Score</th>' +
    '<th class="text-center">Done</th>' +
    '<th class="text-center sm-up">Timely</th>' +
    '<th class="text-right pr-3">Band</th></tr></thead>';

  var body = r.rows.length
    ? '<div class="bg-white rounded-2xl border border-gray-100 overflow-hidden">' +
      '<table class="w-full">' + head + '<tbody>' +
      r.rows.map(function (x) { return lbRow(x, x.username === mine); }).join('') +
      '</tbody></table></div>'
    : '<div class="bg-white rounded-2xl border border-gray-100 p-10 text-center">' +
      '<div class="text-sm font-black text-gray-400">Nothing was closed in ' + esc(r.range.label) + '.</div>' +
      '<div class="text-xs font-semibold text-gray-400 mt-1">A leaderboard needs delivered work to rank.</div></div>';

  /* The people who are not in the ranking are shown apart from it, with the
     reason. They are not at the bottom of the list, because "no data" is not a
     worse month than a low score — it is a different thing entirely. */
  var un = (r.unranked || []).length
    ? '<div class="mt-5 bg-white rounded-2xl border border-gray-100 p-5">' +
      '<div class="lb">Not ranked this ' + esc(r.period) + '</div>' +
      '<div class="text-xs font-semibold text-gray-400 mb-3">Nothing closed, so there is nothing to rank. ' +
      'This is not last place.</div>' +
      '<div class="flex flex-wrap gap-2">' + r.unranked.map(function (u) {
        return '<span class="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">' +
          avatar(u.name, 24) + '<span class="text-xs font-bold">' + esc(u.name) + '</span></span>';
      }).join('') + '</div></div>'
    : '';

  var myLine = (!r.myRank && r.me) || r.trimmed || r.myRank
    ? '<div class="text-xs font-bold text-gray-500 mb-4">' +
      (r.myRank ? 'You are ' + ordinal(r.myRank) + ' of ' + r.counts.ranked
                : 'You are not ranked this ' + esc(r.period) + '.') +
      (r.trimmed ? ' · Your workspace shows the top 3 to everyone.' : '') + '</div>'
    : '';

  var stats = r.rows.length
    ? '<div class="grid grid-cols-3 gap-3 mb-6">' +
      [['Top', r.stats.top], ['Median', r.stats.median], ['Lowest', r.stats.bottom]]
        .map(function (s) {
          return '<div class="bg-white rounded-2xl border border-gray-100 p-4 text-center">' +
            '<div class="text-2xl font-black">' + (s[1] === null ? '—' : s[1]) + '</div>' +
            '<div class="text-[11px] font-black uppercase tracking-widest text-gray-400">' + s[0] + '</div></div>';
        }).join('') + '</div>'
    : '';

  $('lbBody').innerHTML = championCard(r.champion, r.sharedFirst, r.range, r.championBelowFirst) + stats + myLine + body + un;
}

function ordinal(n) {
  var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
