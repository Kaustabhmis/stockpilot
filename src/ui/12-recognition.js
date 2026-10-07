/* ---------- cookie points & the org chart ---------------------------------
   Recognition on the day it happens, and a chart of who reports to whom that
   nobody has to draw — it is a view of the "reports to" already set on each
   person, so it cannot drift out of date the way a drawn one does.
   -------------------------------------------------------------------------- */

function openCookie(preset) {
  var me = STATE.data.user || {};
  var staff = (STATE.data.staff || []).filter(function (u) {
    if (u.active === false || u.username === me.username) return false;
    return me.role === 'Admin' || u.manager === me.username;
  });

  if (!staff.length) {
    toast('Cookie points go to the people who report to you, and nobody does yet.', 'err');
    return;
  }

  openModal('<form id="fCookie" class="p-6 lg:p-7">' +
    '<h2 class="text-2xl font-black mb-1">Cookie points</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">For work worth marking on the day it ' +
      'happened, not six months later. It counts towards their score this month and is on the ' +
      'record at their review.</p>' +
    '<label class="lb" for="ckWho">Who</label>' +
    '<select id="ckWho" class="in mb-4">' + staff.map(function (u) {
      return '<option value="' + esc(u.username) + '"' +
        (preset && preset === u.username ? ' selected' : '') + '>' + esc(u.name) + '</option>';
    }).join('') + '</select>' +
    '<label class="lb">How many</label>' +
    '<div class="flex gap-2 mb-4" id="ckPts">' + [1, 2, 3, 4, 5].map(function (n) {
      return '<button type="button" data-n="' + n + '" class="flex-1 py-3 rounded-xl border ' +
        'font-black ' + (n === 2 ? 'border-blue-600 bg-blue-50 text-blue-700 on'
                                 : 'border-gray-200 text-gray-500') + '">' + n + '</button>';
    }).join('') + '</div>' +
    '<label class="lb" for="ckWhy">What it is for</label>' +
    '<textarea id="ckWhy" class="in" rows="3" required minlength="5" ' +
      'placeholder="e.g. Stayed back to clear the audit list before the visit"></textarea>' +
    '<p class="text-xs font-semibold text-gray-400 mt-2">They will see this, and so will whoever ' +
      'writes their appraisal. An award with no stated reason reads as favouritism.</p>' +
    '<div class="flex gap-3 mt-6">' +
      '<button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
      '<button type="submit" class="btn btn-p flex-1">Award</button></div></form>', 'max-w-lg');

  var points = 2;
  $('ckPts').querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () {
      points = Number(b.dataset.n);
      $('ckPts').querySelectorAll('button').forEach(function (x) {
        var on = x === b;
        x.className = 'flex-1 py-3 rounded-xl border font-black ' +
          (on ? 'border-blue-600 bg-blue-50 text-blue-700 on' : 'border-gray-200 text-gray-500');
      });
    });
  });

  $('fCookie').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = e.target.querySelector('button[type=submit]');
    busy(btn, true, 'Awarding…');
    api('awardCookie', { data: { employee: $('ckWho').value, points: points,
      reason: $('ckWhy').value } })
      .then(function (r) { toast(r.message, 'ok'); closeModal(); return refresh(); })
      .catch(function (err) { busy(btn, false); toast(err.message, 'err'); });
  });
}

function openCookieFeed() {
  openModal('<div class="p-6 lg:p-7"><div class="flex justify-between items-start mb-1">' +
    '<h2 class="text-2xl font-black">Cookie points</h2>' +
    '<button onclick="closeModal()" class="text-gray-400 hover:text-gray-900">' +
    '<span class="material-icons">close</span></button></div>' +
    '<div id="ckBody" class="text-sm text-gray-400 font-semibold mt-4">Loading…</div></div>', 'max-w-2xl');
  api('getCookies').then(function (r) {
    $('ckBody').innerHTML =
      '<p class="text-sm text-gray-400 font-semibold mb-4">' + esc(r.month) +
        '. Up to ' + r.maxBonus + ' points can move a score in a month — anything beyond that is ' +
        'still recorded and still counts at the review.</p>' +
      (r.leaderboard.length ? '<table class="tbl mb-6"><thead><tr><th>Person</th>' +
        '<th>Points</th><th>Counting towards score</th></tr></thead><tbody>' +
        r.leaderboard.map(function (l) {
          return '<tr><td class="font-bold text-gray-800">' + esc(l.name) + '</td>' +
            '<td class="font-black">' + l.points + '</td>' +
            '<td class="' + (l.bonus < l.points ? 'text-amber-700 font-bold' : '') + '">+' + l.bonus +
              (l.bonus < l.points ? ' (capped)' : '') + '</td></tr>';
        }).join('') + '</tbody></table>' : '') +
      (r.cookies.length ? r.cookies.map(function (c) {
        return '<div class="border-b border-gray-100 py-3">' +
          '<div class="text-sm font-bold text-gray-800">' + esc(c.toName) +
            ' <span class="chip bg-emerald-50 text-emerald-700 ml-1">+' + c.points + '</span></div>' +
          '<div class="text-[13px] text-gray-600 font-semibold mt-0.5">' + esc(c.reason) + '</div>' +
          '<div class="text-[11px] text-gray-400 font-semibold mt-0.5">' +
            esc('from ' + c.byName) + ' · ' + fmtDate(String(c.date).slice(0, 10)) + '</div></div>';
      }).join('') : '<p class="text-sm text-gray-400 font-semibold">Nothing awarded this month yet.</p>');
  }).catch(function (e) { $('ckBody').textContent = e.message; });
}

/* ---------- org chart ----------------------------------------------------- */
function openOrgChart() {
  openModal('<div class="p-6 lg:p-7"><div class="flex justify-between items-start mb-1">' +
    '<h2 class="text-2xl font-black">Org chart</h2>' +
    '<button onclick="closeModal()" class="text-gray-400 hover:text-gray-900">' +
    '<span class="material-icons">close</span></button></div>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">Built from who reports to whom. ' +
      'Change a person\'s manager on the Team tab and this changes with it.</p>' +
    '<div id="orgBody" class="text-sm text-gray-400 font-semibold">Loading…</div></div>', 'max-w-3xl');

  api('getOrgChart').then(function (r) {
    $('orgBody').innerHTML =
      '<div class="grid grid-cols-3 gap-3 mb-5">' +
        orgTile('People', r.people) + orgTile('Levels', r.levels) +
        orgTile('No manager set', r.unassigned.length, r.unassigned.length ? 'text-amber-700' : '') +
      '</div>' +
      (r.cycles.length ? '<div class="rounded-2xl border border-red-200 bg-red-50 p-3 mb-4 ' +
        'text-[13px] font-bold text-red-900">' +
        esc(r.cycles.map(function (c) { return c.name + ' and ' + c.managerName +
          ' report to each other'; }).join('; ')) +
        '. Approvals between them cannot go anywhere — fix one of the two on the Team tab.</div>' : '') +
      (r.note ? '<div class="rounded-2xl border border-amber-200 bg-amber-50 p-3 mb-4 ' +
        'text-[13px] font-bold text-amber-900">' + esc(r.note) + '</div>' : '') +
      '<div class="overflow-x-auto">' + r.tree.map(function (n) { return orgBranch(n); }).join('') + '</div>';
  }).catch(function (e) { $('orgBody').textContent = e.message; });
}

function orgTile(k, v, tone) {
  return '<div class="bg-gray-50 rounded-2xl p-3 text-center">' +
    '<div class="text-[10px] font-black uppercase tracking-widest text-gray-400">' + esc(k) + '</div>' +
    '<div class="text-2xl font-black mt-1 ' + (tone || '') + '">' + v + '</div></div>';
}

/* Drawn as an indented tree rather than boxes and connectors: it stays legible
   at six levels, it reads on a phone, and it never needs a scroll in two
   directions at once. */
function orgBranch(n) {
  var roleTone = n.role === 'Admin' ? 'bg-purple-50 text-purple-700'
    : n.role === 'HOD' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600';
  /* Inline, not a utility class: the indent and the rule that draws the line
     down a branch are structural, and they have to survive whatever stylesheet
     the page is served with. */
  return '<div style="' + (n.level ? 'margin-left:18px;padding-left:16px;' +
      'border-left:2px solid #e5e7eb' : '') + '">' +
    '<div class="flex flex-wrap items-center gap-2 py-2">' +
      '<span class="h-8 w-8 rounded-full bg-blue-50 text-blue-700 text-[10px] font-black ' +
        'flex items-center justify-center shrink-0">' + esc(initials(n.name)) + '</span>' +
      '<span class="font-bold text-sm text-gray-800">' + esc(n.name) + '</span>' +
      '<span class="chip ' + roleTone + '">' + esc(n.role) + '</span>' +
      (n.jobProfile ? '<span class="text-xs font-semibold text-gray-400">' + esc(n.jobProfile) + '</span>' : '') +
      (n.headcount ? '<span class="chip bg-slate-100 text-slate-600">' + n.headcount + ' under them</span>' : '') +
      (n.openTasks ? '<span class="chip bg-gray-100 text-gray-500">' + n.openTasks + ' open</span>' : '') +
      (n.impliedManager ? '<span class="chip bg-amber-50 text-amber-800" ' +
        'title="No manager set, so an Admin approves their work">manager not set</span>' : '') +
    '</div>' +
    n.reports.map(function (c) { return orgBranch(c); }).join('') +
    '</div>';
}

/* ---------- the landing page ----------------------------------------------
   Shown to anybody who is not signed in. Its job is to say what this is, who
   it is for, and why the scoring can be trusted — then get out of the way.
   -------------------------------------------------------------------------- */
function showHome() {
  $('view-home').classList.remove('hidden');
  $('view-auth').classList.add('hidden');
  $('view-app').classList.add('hidden');
  renderHomePlans();
  window.scrollTo(0, 0);
}

/** Straight to the form, from any of the buttons on the landing page. */
function goAuth(which) {
  $('view-home').classList.add('hidden');
  $('view-app').classList.add('hidden');
  $('view-auth').classList.remove('hidden');
  resetAuthForms();
  showAuth(which || 'login');
  window.scrollTo(0, 0);
  var first = which === 'signup' ? $('suCompany') : $('liUser');
  if (first) { try { first.focus(); } catch (e) {} }
}

function renderHomePlans() {
  var el = $('homePlans');
  if (!el) return;
  el.innerHTML = PLAN_CARDS.map(function (p) {
    var lead = p.tag === 'Most popular';
    return '<div class="rounded-3xl border-2 p-5 flex flex-col ' +
      (lead ? 'border-blue-600 shadow-lg' : 'border-gray-100') + '">' +
      (p.tag ? '<div class="text-[10px] font-black uppercase tracking-widest mb-2 ' +
        (lead ? 'text-blue-600' : 'text-amber-600') + '">' + esc(p.tag) + '</div>'
       : '<div class="h-[18px] mb-2"></div>') +
      '<div class="font-black text-lg">' + esc(p.name) + '</div>' +
      '<div class="text-[13px] font-semibold text-gray-500 mt-0.5 min-h-[36px]">' + esc(p.blurb) + '</div>' +
      '<div class="text-3xl font-black mt-3">' + esc(p.price) +
        '<span class="text-sm font-bold text-gray-400">' + esc(p.per) + '</span></div>' +
      '<ul class="text-[13px] font-semibold text-gray-600 mt-4 space-y-1.5 flex-1">' +
        p.bullets.map(function (b) {
          return '<li class="flex gap-2"><span class="material-icons text-[16px] text-emerald-600">check</span>' +
            '<span>' + esc(b) + '</span></li>'; }).join('') + '</ul>' +
      '<button class="btn ' + (lead ? 'btn-p' : 'btn-g') + ' w-full mt-5" ' +
        (p.key === 'Enterprise'
          ? 'onclick="goAuth(\'signup\')">Talk to us'
          : 'onclick="goAuth(\'signup\')">' + (p.key === 'Free' ? 'Start free' : 'Get ' + esc(p.name))) +
      '</button></div>';
  }).join('');
}
