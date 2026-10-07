/* ---------- team ---------------------------------------------------------- */
var TEAM = [];

function loadTeam() {
  api('getUsers').then(function (r) { TEAM = r.users; renderTeam(); })
    .catch(function (e) { toast(e.message, 'err'); });
}

function renderTeam() {
  var active = TEAM.filter(function (u) { return u.active !== false; });
  var u = STATE.usage;
  var tile = function (k, v, icon, colour, tone) {
    return '<div class="tile">' +
      '<span class="ti material-icons" style="color:' + colour + '">' + icon + '</span>' +
      '<div class="tk">' + esc(k) + '</div>' +
      '<div class="tv ' + (tone || '') + '">' + v + '</div></div>';
  };
  var atLimit = active.filter(function (x) { return x.wip && x.wip.exceeded; }).length;
  $('teamStats').innerHTML =
    tile('Members', active.length +
         (u.maxUsers ? ' <span class="text-base text-gray-400">/ ' + u.maxUsers + '</span>' : ''),
         'groups', '#5b4bdb') +
    tile('Open tasks', active.reduce(function (n, x) { return n + (x.openTasks || 0); }, 0),
         'assignment', '#2a74c9') +
    tile('At WIP limit', atLimit, 'running_with_errors',
         atLimit ? '#b07d12' : '#d6cec3', atLimit ? 'text-amber-700' : '') +
    tile('Scored last month', active.filter(function (x) { return x.lastMonthScore !== null; }).length,
         'military_tech', '#0e8f80');

  $('teamTable').innerHTML = '<table class="tbl"><thead><tr>' +
    ['Member','Role','Department','Reports to','Open','WIP','Last month',''].map(function (h) {
      return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
    TEAM.map(function (x) {
      return '<tr class="' + (x.active === false ? 'opacity-45' : '') + '">' +
        '<td><div class="flex items-center gap-2.5">' + avatar(x.name, 32) +
          '<span><span class="block font-bold text-gray-800">' + esc(x.name) + '</span>' +
          '<span class="block text-xs text-gray-400">' + esc(x.email) + '</span></span></div></td>' +
        '<td><span class="chip ' + (x.role === 'Admin' ? 't-plum'
          : x.role === 'HOD' ? 't-violet' : 't-slate') + '">' + esc(x.role) + '</span></td>' +
        '<td class="whitespace-nowrap">' +
          (x.dept ? tintChip(x.dept, x.dept) : '—') + '</td>' +
        '<td class="whitespace-nowrap">' + esc(x.manager ? nameOf(x.manager) : '—') + '</td>' +
        '<td class="font-bold">' + (x.openTasks || 0) + '</td>' +
        '<td class="font-bold whitespace-nowrap ' + (x.wip && x.wip.exceeded ? 'text-red-700' : '') + '">' +
          (x.wip ? x.wip.count + '/' + (x.wip.limit || '∞') : '—') + '</td>' +
        '<td class="whitespace-nowrap">' + (x.lastMonthScore !== null
          ? '<span class="chip ' + (x.lastMonthScore >= 85 ? 't-teal'
              : x.lastMonthScore >= 60 ? 't-amber' : 't-coral') + '">' +
            x.lastMonthScore + ' · ' + esc(x.lastMonthBand) + '</span>'
          : '<span class="text-gray-300 font-bold">no data</span>') + '</td>' +
        '<td class="text-right whitespace-nowrap">' +
          '<button class="text-blue-600 font-black text-xs hover:underline edit" data-u="' + esc(x.username) + '">Edit</button>' +
        '</td></tr>';
    }).join('') + '</tbody></table>';

  $('teamTable').querySelectorAll('.edit').forEach(function (b) {
    b.addEventListener('click', function () {
      openUser(TEAM.filter(function (x) { return x.username === b.dataset.u; })[0]); });
  });
}

function openUser(u) {
  var editing = !!u;
  u = u || { name:'', username:'', email:'', role:'Doer', jobProfile:'', dept:'', phone:'',
             manager:'', wipLimit:'', kras:[], active:true };
  var others = TEAM.filter(function (x) { return x.username !== u.username && x.active !== false; });

  openModal('<form id="fUser" class="p-6 lg:p-7">' +
    '<h2 class="text-2xl font-black mb-1">' + (editing ? 'Edit member' : 'Add member') + '</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">Role decides what they may do. ' +
      '"Reports to" decides who approves their work.</p>' +
    '<div class="space-y-4">' +
      '<div class="grid grid-cols-2 gap-4">' +
        '<div><label class="lb" for="uName">Full name</label><input id="uName" class="in" required value="' + esc(u.name) + '"></div>' +
        '<div><label class="lb" for="uUser">Username</label><input id="uUser" class="in" required value="' + esc(u.username) + '"' +
          (editing ? ' readonly' : '') + '></div></div>' +
      '<div class="grid grid-cols-2 gap-4">' +
        '<div><label class="lb" for="uMail">Work email</label><input id="uMail" type="email" class="in" required value="' + esc(u.email) + '"></div>' +
        '<div><label class="lb" for="uPhone">Phone</label><input id="uPhone" class="in" value="' + esc(u.phone) + '"></div></div>' +
      '<div class="grid grid-cols-2 gap-4">' +
        '<div><label class="lb" for="uRole">Role</label><select id="uRole" class="in">' +
          ['Doer','HOD','Admin'].map(function (r) {
            return '<option' + (r === u.role ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></div>' +
        '<div><label class="lb" for="uDept">Department</label><input id="uDept" class="in" value="' + esc(u.dept) + '"></div></div>' +
      '<div class="grid grid-cols-2 gap-4">' +
        '<div><label class="lb" for="uProfile">Job profile</label><input id="uProfile" class="in" value="' + esc(u.jobProfile) + '"' +
          ' placeholder="matches the KRA set"></div>' +
        '<div><label class="lb" for="uMgr">Reports to</label><select id="uMgr" class="in">' +
          '<option value="">Nobody</option>' + others.map(function (m) {
            return '<option value="' + esc(m.username) + '"' + (m.username === u.manager ? ' selected' : '') +
              '>' + esc(m.name) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="grid grid-cols-2 gap-4">' +
        '<div><label class="lb" for="uWip">WIP limit</label><input id="uWip" type="number" min="0" class="in" ' +
          'placeholder="default 5" value="' + (u.wipLimit == null ? '' : esc(u.wipLimit)) + '"></div>' +
        '<div><label class="lb" for="uPass">' + (editing ? 'New password (optional)' : 'Password') + '</label>' +
          '<input id="uPass" type="password" class="in" autocomplete="new-password" minlength="8"' +
          (editing ? '' : ' required') + '></div></div>' +
      '<div><div class="flex justify-between items-center mb-2">' +
        '<span class="lb mb-0">KRA blueprint</span>' +
        '<button type="button" id="uAddKra" class="text-blue-600 font-black text-xs">+ Add KRA</button></div>' +
        '<div id="uKras" class="space-y-2"></div>' +
        '<div id="uKraMsg" class="text-xs font-bold mt-2"></div></div>' +
      (editing ? '<label class="flex items-center gap-2 text-sm font-bold text-gray-600 pt-1">' +
        '<input type="checkbox" id="uActive" class="w-4 h-4 accent-blue-600"' +
        (u.active !== false ? ' checked' : '') + '> Active</label>' : '') +
    '</div><div class="flex gap-3 mt-6">' +
    '<button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
    '<button type="submit" class="btn btn-p flex-1">' + (editing ? 'Save' : 'Add member') + '</button></div></form>',
    'max-w-2xl');

  var kras = (u.kras || []).slice();
  function drawKras() {
    $('uKras').innerHTML = kras.map(function (k, i) {
      return '<div class="flex gap-2">' +
        '<input class="in kItem" data-i="' + i + '" placeholder="Key result area" value="' + esc(k.item || k.name || '') + '">' +
        '<input class="in kW" data-i="' + i + '" type="number" min="0" max="100" style="max-width:88px" ' +
          'placeholder="%" value="' + esc(k.weight || 0) + '">' +
        '<button type="button" class="kDel px-3 text-gray-400 hover:text-red-600" data-i="' + i + '">' +
          '<span class="material-icons text-base">delete</span></button></div>';
    }).join('');
    checkKras();
    $('uKras').querySelectorAll('.kItem').forEach(function (el) {
      el.addEventListener('input', function () { kras[+el.dataset.i].item = el.value; }); });
    $('uKras').querySelectorAll('.kW').forEach(function (el) {
      el.addEventListener('input', function () { kras[+el.dataset.i].weight = Number(el.value || 0); checkKras(); }); });
    $('uKras').querySelectorAll('.kDel').forEach(function (el) {
      el.addEventListener('click', function () { kras.splice(+el.dataset.i, 1); drawKras(); }); });
  }
  function checkKras() {
    var m = $('uKraMsg');
    var rows = kras.filter(function (k) { return String(k.item || '').trim(); });
    if (!rows.length) { m.textContent = ''; return true; }
    var total = rows.reduce(function (s, k) { return s + (Number(k.weight) || 0); }, 0);
    var okNow = total <= 100;
    m.textContent = okNow ? (total < 100 ? 'Weights total ' + total + '% — ' + (100 - total) + '% unallocated.'
                                         : 'Weights total 100%.')
                          : 'KRA weights total ' + total + '%. They cannot exceed 100%.';
    m.className = 'text-xs font-bold mt-2 ' + (okNow ? (total < 100 ? 'text-amber-700' : 'text-emerald-700') : 'text-red-700');
    return okNow;
  }
  drawKras();
  $('uAddKra').addEventListener('click', function () { kras.push({ item:'', weight:0 }); drawKras(); });

  $('fUser').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!checkKras()) { toast('Fix the KRA weights first.', 'err'); return; }
    var rows = kras.filter(function (k) { return String(k.item || '').trim(); });
    var form = { name:$('uName').value, username:$('uUser').value, email:$('uMail').value,
      phone:$('uPhone').value, role:$('uRole').value, dept:$('uDept').value,
      jobProfile:$('uProfile').value, manager:$('uMgr').value,
      wipLimit: $('uWip').value === '' ? '' : Number($('uWip').value),
      kras: rows };
    if ($('uPass').value) form.password = $('uPass').value;
    var btn = e.target.querySelector('button[type=submit]');
    busy(btn, true, 'Saving…');

    if (!editing) {
      api('addUser', { form: form })
        .then(function (r) { toast(r.message, 'ok'); closeModal(); loadTeam(); return refresh(); })
        .catch(function (err) { busy(btn, false); toast(err.message, 'err'); });
      return;
    }
    form.originalUsername = u.username;
    if ($('uActive') && !$('uActive').checked) form.active = false;
    else if ($('uActive')) form.active = true;

    api('updateUser', { form: form }).then(function (r) {
      if (r.status === 'needs_reassign') { busy(btn, false); closeModal(); askReassign(u, r, form); return; }
      toast(r.message, 'ok'); closeModal(); loadTeam(); return refresh();
    }).catch(function (err) { busy(btn, false); toast(err.message, 'err'); });
  });
}

/** Deactivating someone with open work would hide it from every board, so the
 *  work has to go somewhere first. */
function askReassign(u, r, form) {
  var others = TEAM.filter(function (x) { return x.username !== u.username && x.active !== false; });
  openModal('<form id="fRe" class="p-6 lg:p-7">' +
    '<h2 class="text-xl font-black mb-1">' + esc(u.name) + ' still has ' + r.count + ' open task(s)</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">Deactivating them would hide this work from every ' +
      'board. It is still owed — hand it to someone first.</p>' +
    '<div class="bg-gray-50 rounded-2xl p-4 mb-5 max-h-40 overflow-y-auto">' +
      r.tasks.map(function (t) { return '<div class="text-sm font-bold text-gray-700 py-1">' + esc(t.title) +
        ' <span class="text-xs text-gray-400 font-semibold">· due ' + fmtDate(t.due) + '</span></div>'; }).join('') +
    '</div>' +
    (others.length ? '<label class="lb" for="reTo">Move all of it to</label>' +
      '<select id="reTo" class="in mb-5">' + others.map(function (o) {
        return '<option value="' + esc(o.username) + '">' + esc(o.name) + '</option>'; }).join('') + '</select>'
      : '<div class="text-sm font-bold text-red-700 mb-5">There is nobody else active to take it.</div>') +
    '<div class="flex gap-3"><button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
    (others.length ? '<button type="submit" class="btn btn-p flex-1">Reassign &amp; deactivate</button>' : '') +
    '</div></form>');
  if (!others.length) return;
  $('fRe').addEventListener('submit', function (e) {
    e.preventDefault();
    form.reassignTo = $('reTo').value;
    api('updateUser', { form: form })
      .then(function (res) { toast(res.message, 'ok'); closeModal(); loadTeam(); return refresh(); })
      .catch(function (err) { toast(err.message, 'err'); });
  });
}

function openLeave() {
  var staff = (STATE.data.staff || []).filter(function (u) { return u.active !== false; });
  openModal('<form id="fLv" class="p-6 lg:p-7">' +
    '<h2 class="text-xl font-black mb-1">Record leave</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">Days on approved leave are not counted as lateness, ' +
      'so time off does not damage someone\'s score.</p>' +
    '<div class="space-y-4">' +
      '<div><label class="lb" for="lvWho">Person</label><select id="lvWho" class="in">' +
        staff.map(function (s) { return '<option value="' + esc(s.username) + '">' + esc(s.name) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="grid grid-cols-2 gap-4">' +
        '<div><label class="lb" for="lvFrom">From</label><input id="lvFrom" type="date" class="in" required value="' + todayYmd() + '"></div>' +
        '<div><label class="lb" for="lvTo">To</label><input id="lvTo" type="date" class="in" required value="' + todayYmd() + '"></div></div>' +
      '<div><label class="lb" for="lvWhy">Reason</label><input id="lvWhy" class="in" placeholder="Annual leave"></div>' +
    '</div><div class="flex gap-3 mt-6">' +
    '<button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
    '<button type="submit" class="btn btn-p flex-1">Record</button></div></form>');
  $('fLv').addEventListener('submit', function (e) {
    e.preventDefault();
    api('setLeave', { username:$('lvWho').value, from:$('lvFrom').value,
      to:$('lvTo').value, reason:$('lvWhy').value })
      .then(function (r) { toast(r.message, 'ok'); closeModal(); })
      .catch(function (err) { toast(err.message, 'err'); });
  });
}

function openCategories() {
  var cats = (STATE.data.categories || []).slice();
  var levels = (STATE.data.priorities || []).map(function (p) {
    return { name: p.name, weight: p.weight }; });

  openModal('<div class="p-6 lg:p-7">' +
    '<h2 class="text-xl font-black mb-1">Categories &amp; priorities</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">Both appear when assigning a task. The ' +
      'priority levels also decide how work is ranked on the priority list, and how much each ' +
      'piece counts towards a score.</p>' +

    '<div class="lb">Job categories</div>' +
    '<div id="catList" class="space-y-2 max-h-48 overflow-y-auto mb-2"></div>' +
    '<button type="button" id="catAdd" class="text-blue-600 font-black text-xs mb-6">+ Add category</button>' +

    '<div class="lb">Priority levels</div>' +
    '<p class="text-xs font-semibold text-gray-400 mb-2">Name them however your floor talks — ' +
      '"Line Down", "Customer Hold", "Routine". The weight is how much more a task at this level ' +
      'counts in a score than one at weight 1, and the order here is the order work is ranked in.</p>' +
    '<div id="priList" class="space-y-2 mb-2"></div>' +
    '<button type="button" id="priAdd" class="text-blue-600 font-black text-xs">+ Add level</button>' +
    '<div id="priMsg" class="text-xs font-bold mt-2"></div>' +

    '<div class="flex gap-3 mt-6"><button class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-p flex-1" id="catSave">Save</button></div></div>', 'max-w-xl');

  function draw() {
    $('catList').innerHTML = cats.map(function (c, i) {
      return '<div class="flex gap-2"><input class="in cIn" data-i="' + i + '" value="' + esc(c) + '">' +
        '<button type="button" class="cDel px-3 text-gray-400 hover:text-red-600" data-i="' + i + '">' +
        '<span class="material-icons text-base">delete</span></button></div>';
    }).join('');
    $('catList').querySelectorAll('.cIn').forEach(function (el) {
      el.addEventListener('input', function () { cats[+el.dataset.i] = el.value; }); });
    $('catList').querySelectorAll('.cDel').forEach(function (el) {
      el.addEventListener('click', function () { cats.splice(+el.dataset.i, 1); draw(); }); });
  }

  function drawPri() {
    $('priList').innerHTML = levels.map(function (l, i) {
      return '<div class="flex gap-2 items-center">' +
        '<span class="w-6 text-center text-xs font-black text-gray-400">' + (i + 1) + '</span>' +
        '<input class="in pIn flex-1" data-i="' + i + '" placeholder="Level name" value="' + esc(l.name) + '">' +
        '<input class="in pW" data-i="' + i + '" type="number" min="1" max="10" style="max-width:86px" ' +
          'aria-label="Weight" value="' + esc(l.weight) + '">' +
        (levels.length > 1 ? '<button type="button" class="pDel px-2 text-gray-400 hover:text-red-600" ' +
          'data-i="' + i + '"><span class="material-icons text-base">delete</span></button>'
         : '<span class="px-2 w-8"></span>') +
        '</div>';
    }).join('');
    var bind = function (cls, fn) {
      $('priList').querySelectorAll(cls).forEach(function (el) {
        el.addEventListener('input', function () { fn(levels[+el.dataset.i], el.value); checkPri(); }); });
    };
    bind('.pIn', function (l, v) { l.name = v; });
    bind('.pW', function (l, v) { l.weight = Number(v || 0); });
    $('priList').querySelectorAll('.pDel').forEach(function (el) {
      el.addEventListener('click', function () { levels.splice(+el.dataset.i, 1); drawPri(); }); });
    checkPri();
  }

  /* Checked here as a courtesy; the server checks it again, and only the server
     knows which levels are still sitting on open work. */
  function checkPri() {
    var m = $('priMsg'), named = levels.filter(function (l) { return String(l.name).trim(); });
    var dupe = null, seen = {};
    named.forEach(function (l) {
      var k = l.name.trim().toLowerCase();
      if (seen[k]) dupe = l.name;
      seen[k] = true;
    });
    var bad = named.filter(function (l) { return !(l.weight >= 1 && l.weight <= 10); });
    var msg = !named.length ? 'Keep at least one level.'
      : dupe ? '"' + dupe + '" is listed twice.'
      : bad.length ? 'Give "' + bad[0].name + '" a weight between 1 and 10.'
      : named.map(function (l) { return l.name; }).join(' › ') + ' — most urgent first.';
    m.textContent = msg;
    m.className = 'text-xs font-bold mt-2 ' +
      (!named.length || dupe || bad.length ? 'text-red-700' : 'text-gray-500');
    return !!named.length && !dupe && !bad.length;
  }

  draw(); drawPri();
  $('catAdd').addEventListener('click', function () { cats.push(''); draw(); });
  $('priAdd').addEventListener('click', function () { levels.push({ name: '', weight: 2 }); drawPri(); });

  $('catSave').addEventListener('click', function () {
    if (!checkPri()) { toast($('priMsg').textContent, 'err'); return; }
    var btn = $('catSave');
    busy(btn, true, 'Saving…');
    api('updateCategories', { categories: cats.filter(function (c) { return String(c).trim(); }) })
      .then(function () {
        return api('updatePriorities', { priorities: levels
          .filter(function (l) { return String(l.name).trim(); })
          .map(function (l) { return { name: String(l.name).trim(), weight: Number(l.weight) }; }) });
      })
      .then(function () { toast('Categories and priorities saved.', 'ok'); closeModal(); return refresh(); })
      .catch(function (e) { busy(btn, false); toast(e.message, 'err'); });
  });
}
