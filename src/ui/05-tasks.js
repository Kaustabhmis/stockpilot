/* ---------- tasks: board, list, detail ----------------------------------- */

var COLUMNS = [
  { key:'inbox',  title:'Needs approval', statuses:['Awaiting Approval','Delegation Proposed'] },
  { key:'todo',   title:'To do',          statuses:['Pending'] },
  { key:'doing',  title:'In progress',    statuses:['In Progress'] },
  { key:'review', title:'For review',     statuses:['For Review'] },
  { key:'done',   title:'Verified',       statuses:['Verified'] },
];
var STATUS_LIST = ['Awaiting Approval','Delegation Proposed','Pending','In Progress',
                   'For Review','Verified','Rejected','Cancelled'];

var filtersReady = false;
function syncFilters() {
  var staff = STATE.data.staff || [];
  var cats = STATE.data.categories || [];
  if (!filtersReady) {
    $('fStatus').innerHTML = '<option value="">Any status</option>' +
      STATUS_LIST.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
    filtersReady = true;
  }
  $('fAssignee').innerHTML = '<option value="">Everyone</option>' +
    staff.map(function (u) { return '<option value="' + esc(u.username) + '">' + esc(u.name) + '</option>'; }).join('');
  $('fCategory').innerHTML = '<option value="">Any category</option>' +
    cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  $('rPerson').innerHTML = '<option value="">Team only</option>' +
    staff.map(function (u) { return '<option value="' + esc(u.username) + '">' + esc(u.name) + '</option>'; }).join('');
}

function visibleTasks() {
  return (STATE.data.tasks || []).filter(function (t) {
    if (!!t.isArchived !== STATE.archive) return false;
    if (FILTER.assignee && t.assignee !== FILTER.assignee) return false;
    if (FILTER.status && t.status !== FILTER.status) return false;
    if (FILTER.category && t.jobCategory !== FILTER.category) return false;
    if (FILTER.overdue && !daysLate(t)) return false;
    if (FILTER.q) {
      var q = FILTER.q.toLowerCase();
      if ((t.title + ' ' + t.desc + ' ' + t.kra + ' ' + t.jobCategory + ' ' + t.id)
          .toLowerCase().indexOf(q) < 0) return false;
    }
    return true;
  });
}

function renderTab() {
  ['tasks','team','reports'].forEach(function (t) {
    $('tab-' + t).classList.toggle('hidden', t !== STATE.tab); });
  document.querySelectorAll('#navTabs button,#navTabsMobile button').forEach(function (b) {
    b.classList.toggle('on', b.dataset.tab === STATE.tab); });
  if (STATE.tab === 'tasks') renderTasks();
  if (STATE.tab === 'team') loadTeam();
  if (STATE.tab === 'reports') loadReports();
}

function renderTasks() {
  var rows = visibleTasks();
  $('tasksEmpty').classList.toggle('hidden', rows.length > 0);
  $('tasksEmpty').textContent = STATE.archive
    ? 'Nothing archived yet. Closed work moves here after a week.'
    : (STATE.data.tasks || []).length ? 'No tasks match these filters.'
      : 'No tasks yet. Assign the first one.';
  $('board').classList.toggle('hidden', STATE.mode !== 'board' || !rows.length);
  $('list').classList.toggle('hidden', STATE.mode !== 'list' || !rows.length);
  if (!rows.length) return;
  if (STATE.mode === 'board') renderBoard(rows); else renderList(rows);
}

function taskCard(t) {
  var late = daysLate(t);
  var done = (t.subtasks || []).filter(function (s) { return s.done; }).length;
  return '<div class="card p-' + esc(t.priority) + '" draggable="true" data-id="' + esc(t.id) + '">' +
    '<div class="flex justify-between items-start gap-2 mb-2">' +
      '<span class="font-bold text-sm leading-snug">' + esc(t.title) + '</span>' +
      '<span class="w-7 h-7 rounded-full bg-blue-50 text-blue-700 text-[10px] font-black ' +
        'flex items-center justify-center shrink-0" title="' + esc(t.toName) + '">' +
        esc(initials(t.toName)) + '</span></div>' +
    '<div class="flex flex-wrap items-center gap-1.5">' +
      '<span class="chip ' + (late ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500') + '">' +
        fmtDate(t.due) + (late ? ' · ' + late + 'd late' : '') + '</span>' +
      ((t.blockedBy || []).length ? '<span class="chip bg-amber-50 text-amber-800">Blocked</span>' : '') +
      ((t.subtasks || []).length ? '<span class="chip bg-gray-100 text-gray-500">' + done + '/' + t.subtasks.length + '</span>' : '') +
      (t.reworkCount ? '<span class="chip bg-orange-50 text-orange-700">Rework ' + t.reworkCount + '</span>' : '') +
      (t.frequency && t.frequency !== 'One Time' ? '<span class="chip bg-indigo-50 text-indigo-700">' + esc(t.frequency) + '</span>' : '') +
      (t.jobCategory && t.jobCategory !== 'General' ? '<span class="chip bg-slate-100 text-slate-600">' + esc(t.jobCategory) + '</span>' : '') +
    '</div></div>';
}

function renderBoard(rows) {
  $('board').innerHTML = COLUMNS.map(function (c) {
    var items = rows.filter(function (t) { return c.statuses.indexOf(t.status) > -1; });
    return '<div><div class="flex items-center justify-between px-1 mb-2">' +
      '<span class="text-[10px] font-black uppercase tracking-widest text-gray-500">' + esc(c.title) + '</span>' +
      '<span class="text-[10px] font-black text-gray-400">' + items.length + '</span></div>' +
      '<div class="col" data-col="' + c.key + '">' +
      (items.map(taskCard).join('') ||
        '<div class="text-[11px] text-gray-400 font-semibold px-1 py-3">Nothing here</div>') +
      '</div></div>';
  }).join('');
  wireBoard();
}

function renderList(rows) {
  $('list').innerHTML = '<table class="tbl"><thead><tr>' +
    ['Task','Category','Owner','Status','Priority','Due'].map(function (h) {
      return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
    rows.map(function (t) {
      var late = daysLate(t);
      return '<tr class="cursor-pointer" data-id="' + esc(t.id) + '">' +
        '<td class="font-bold text-gray-800">' + esc(t.title) +
          '<span class="text-gray-300 font-semibold ml-1">' + esc(t.id) + '</span></td>' +
        '<td class="whitespace-nowrap">' + esc(t.jobCategory || '—') + '</td>' +
        '<td class="whitespace-nowrap">' + esc(t.toName) + '</td>' +
        '<td class="whitespace-nowrap"><span class="chip bg-gray-100 text-gray-600">' + esc(t.status) + '</span></td>' +
        '<td class="whitespace-nowrap"><span class="chip ' +
          (t.priority === 'High' ? 'bg-red-50 text-red-700' : t.priority === 'Medium'
            ? 'bg-amber-50 text-amber-800' : 'bg-blue-50 text-blue-700') + '">' + esc(t.priority) + '</span></td>' +
        '<td class="whitespace-nowrap ' + (late ? 'text-red-700 font-black' : '') + '">' +
          fmtDate(t.due) + (late ? ' · ' + late + 'd' : '') + '</td></tr>';
    }).join('') + '</tbody></table>';
  $('list').querySelectorAll('tr[data-id]').forEach(function (r) {
    r.addEventListener('click', function () { openTask(r.dataset.id); }); });
}

/* Dropping a card is just a status change; the server re-checks every rule, so
   a refusal here is the engine's own reason, not a guess. */
function wireBoard() {
  var dragged = null;
  $('board').querySelectorAll('.card').forEach(function (c) {
    c.addEventListener('dragstart', function (e) { dragged = c.dataset.id; c.classList.add('drag');
      e.dataTransfer.effectAllowed = 'move'; });
    c.addEventListener('dragend', function () { c.classList.remove('drag'); dragged = null; });
    c.addEventListener('click', function () { openTask(c.dataset.id); });
  });
  $('board').querySelectorAll('.col').forEach(function (col) {
    col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', function () { col.classList.remove('over'); });
    col.addEventListener('drop', function (e) {
      e.preventDefault(); col.classList.remove('over');
      if (!dragged) return;
      var t = taskById(dragged); if (!t) return;
      var target = COLUMNS.filter(function (c) { return c.key === col.dataset.col; })[0];
      if (!target || target.statuses.indexOf(t.status) > -1) return;
      var next = target.statuses[0];
      if (next === 'Awaiting Approval' || next === 'Delegation Proposed') {
        toast('Approval is not something you can drag a task into.', 'err'); return; }
      if (next === 'In Progress' && t.status === 'For Review') { openStatus(t.id, 'In Progress'); return; }
      doTransition(t.id, next);
    });
  });
}

function taskById(id) {
  var list = STATE.data.tasks || [];
  for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i];
  return null;
}

function doTransition(id, status, note, newDue) {
  return api('updateTask', { taskId: id, status: status, note: note, newDueDate: newDue })
    .then(function (r) { toast(r.message, 'ok'); closeDrawer(); return refresh(); })
    .catch(function (e) { toast(e.message, 'err'); });
}

/* ---------- detail drawer ------------------------------------------------ */
function openTask(id) {
  var t = taskById(id);
  if (!t) { toast('That task is not in your current view.', 'err'); return; }
  var me = STATE.user;
  var late = daysLate(t);
  var subs = t.subtasks || [];
  var doneN = subs.filter(function (s) { return s.done; }).length;
  var isMine = t.assignee === me.username;
  var isRaiser = t.by === me.username;
  var isApprover = t.approver === me.username;
  var isAdmin = me.role === 'Admin';
  var acts = [];

  if (t.status === 'Awaiting Approval' || t.status === 'Delegation Proposed') {
    if (isApprover || isAdmin) {
      acts.push(['approve','Approve','btn-p']); acts.push(['reject','Reject','btn-g']);
    }
  } else if (t.status === 'Pending' && (isMine || isAdmin)) {
    acts.push(['start','Start work','btn-p']);
  } else if (t.status === 'In Progress' && (isMine || isAdmin)) {
    acts.push(['submit','Submit for review','btn-p']);
  } else if (t.status === 'For Review' && (isRaiser || isApprover || isAdmin) && !(isMine && !isAdmin && !isRaiser)) {
    acts.push(['verify','Verify &amp; close','btn-p']); acts.push(['rework','Send back','btn-g']);
  }

  var blockReason = '';
  if (t.status === 'Pending' && (t.blockedBy || []).length) {
    var names = (t.blockedBy || []).map(function (bid) {
      var b = taskById(bid); return b && b.status !== 'Verified' ? b.title : null;
    }).filter(Boolean);
    if (names.length) blockReason = 'Blocked by ' + names.join(', ');
  }
  if (subs.length && doneN < subs.length && t.status === 'In Progress') {
    blockReason = 'Checklist is ' + doneN + '/' + subs.length;
  }

  openDrawer('<div class="p-6 lg:p-7">' +
    '<div class="flex justify-between items-start gap-4 mb-5">' +
      '<div><div class="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">' +
        esc(t.id) + ' · ' + esc(t.status) + '</div>' +
        '<h2 class="text-2xl font-black leading-tight">' + esc(t.title) + '</h2></div>' +
      '<button onclick="closeDrawer()" class="text-gray-400 hover:text-gray-900">' +
        '<span class="material-icons">close</span></button></div>' +

    (late ? '<div class="mb-4 text-xs font-black rounded-xl px-4 py-3 bg-red-50 text-red-800">' +
      'Overdue by ' + late + ' day(s)</div>' : '') +
    (t.delegateTo ? '<div class="mb-4 text-xs font-bold rounded-xl px-4 py-3 bg-purple-50 text-purple-900">' +
      'Hand-off to ' + esc(nameOf(t.delegateTo)) + ' awaiting ' + esc(nameOf(t.approver)) + '</div>' : '') +
    (t.desc ? '<p class="text-sm text-gray-600 leading-relaxed mb-5">' + esc(t.desc) + '</p>' : '') +

    '<div class="grid grid-cols-2 gap-4 mb-5 text-sm">' +
      [['Owner', t.toName], ['Raised by', t.byName], ['Approver', nameOf(t.approver)],
       ['Due', fmtDate(t.due)], ['Priority', t.priority], ['Category', t.jobCategory || '—'],
       ['KRA', t.kra || '—'], ['Repeats', t.frequency], ['Rework loops', String(t.reworkCount || 0)]]
      .map(function (p) { return '<div><div class="lb">' + esc(p[0]) + '</div>' +
        '<div class="font-bold text-gray-800">' + esc(p[1]) + '</div></div>'; }).join('') + '</div>' +

    (subs.length ? '<div class="mb-5"><div class="flex justify-between items-center mb-2">' +
      '<span class="lb mb-0">Checklist</span><span class="text-xs font-black text-gray-500">' +
      doneN + '/' + subs.length + '</span></div>' +
      '<div class="h-1.5 bg-gray-100 rounded-full mb-3 overflow-hidden"><div class="h-full bg-blue-600" ' +
      'style="width:' + Math.round(doneN / subs.length * 100) + '%"></div></div>' +
      subs.map(function (s, i) {
        return '<label class="flex items-center gap-2 py-1.5 text-sm ' +
          (s.done ? 'text-gray-400 line-through' : 'text-gray-700') + '">' +
          '<input type="checkbox" class="w-4 h-4 accent-blue-600 sub" data-i="' + i + '"' +
          (s.done ? ' checked' : '') + (isMine || isAdmin ? '' : ' disabled') + '> ' + esc(s.text) + '</label>';
      }).join('') + '</div>' : '') +

    '<div class="flex flex-wrap gap-2 mb-2">' +
      acts.map(function (a) {
        var off = blockReason && (a[0] === 'submit' || a[0] === 'start');
        return '<button class="btn ' + (off ? 'btn-g' : a[2]) + ' act" data-act="' + a[0] + '"' +
          (off ? ' disabled' : '') + '>' + a[1] + '</button>';
      }).join('') +
      (['Verified','Rejected','Cancelled'].indexOf(t.status) < 0 && (isMine || isAdmin)
        ? '<button class="btn btn-g act" data-act="delegate">Hand over…</button>' : '') +
      (['Verified','Rejected','Cancelled'].indexOf(t.status) < 0 && (isRaiser || isAdmin)
        ? '<button class="btn btn-g act" data-act="block">Add blocker…</button>' : '') +
      (t.frequency !== 'One Time' && (isRaiser || isAdmin)
        ? '<button class="btn btn-g act" data-act="stop">Stop repeating</button>' : '') +
      (isAdmin || isRaiser ? '<button class="btn btn-g act" data-act="edit">Edit</button>' : '') +
      (!acts.length ? '<span class="text-xs font-bold text-gray-400 py-2">No actions available to you here.</span>' : '') +
    '</div>' +
    (blockReason ? '<div class="text-[11px] font-bold text-amber-700 mb-4">' + esc(blockReason) + '</div>' : '<div class="mb-4"></div>') +

    '<div class="lb">History</div><div class="space-y-3 mt-2">' +
      (t.history || []).slice().reverse().map(function (h) {
        return '<div class="flex gap-3 text-xs">' +
          '<div class="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 shrink-0"></div><div>' +
          '<span class="font-black text-gray-800">' + esc(h.status) + '</span>' +
          '<span class="text-gray-400"> · ' + new Date(h.date).toLocaleDateString('en-IN',
            { day:'2-digit', month:'short' }) + '</span>' +
          (h.user ? '<span class="text-gray-400"> · ' + esc(h.user) + '</span>' : '') +
          (h.note ? '<div class="text-gray-600 mt-0.5 bg-yellow-50 border border-yellow-100 rounded p-2">' +
            esc(h.note) + '</div>' : '') +
          (h.setDate ? '<div class="text-[10px] text-red-600 font-black mt-1">New deadline: ' +
            esc(h.setDate) + '</div>' : '') + '</div></div>';
      }).join('') + '</div></div>');

  $('drawer').querySelectorAll('.act').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.disabled) return;
      var a = b.dataset.act;
      if (a === 'approve') return approve(t.id, true);
      if (a === 'reject')  return approve(t.id, false);
      if (a === 'start')   return doTransition(t.id, 'In Progress');
      if (a === 'submit')  return openStatus(t.id, 'For Review');
      if (a === 'verify')  return openStatus(t.id, 'Verified');
      if (a === 'rework')  return openStatus(t.id, 'In Progress');
      if (a === 'delegate')return openDelegate(t);
      if (a === 'block')   return openBlocker(t);
      if (a === 'stop')    return stopRecurring(t.id);
      if (a === 'edit')    return openEdit(t);
    });
  });
  $('drawer').querySelectorAll('.sub').forEach(function (cb) {
    cb.addEventListener('change', function () {
      api('toggleSubtask', { taskId: t.id, index: Number(cb.dataset.i), done: cb.checked })
        .then(function () { return refresh(); })
        .then(function () { openTask(t.id); })
        .catch(function (e) { toast(e.message, 'err'); cb.checked = !cb.checked; });
    });
  });
}

function approve(id, yes) {
  api('processTaskApproval', { taskId: id, isApproved: yes })
    .then(function (r) { toast(r.message, 'ok'); closeDrawer(); return refresh(); })
    .catch(function (e) { toast(e.message, 'err'); });
}
function stopRecurring(id) {
  api('stopRecurringTask', { taskId: id })
    .then(function (r) { toast(r.message, 'ok'); closeDrawer(); return refresh(); })
    .catch(function (e) { toast(e.message, 'err'); });
}

/** Status change with a note, and a mandatory new deadline when sending back. */
function openStatus(id, status) {
  var rework = status === 'In Progress';
  openModal('<form id="fStatus" class="p-6 lg:p-7">' +
    '<h2 class="text-xl font-black mb-1">' +
      (rework ? 'Send back for rework' : status === 'Verified' ? 'Verify and close' : 'Submit for review') + '</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">' +
      (rework ? 'Say what needs fixing, and give them a realistic new date.'
              : 'Add a note if it helps whoever picks this up.') + '</p>' +
    (rework ? '<div class="mb-4"><label class="lb" for="stDate">New deadline</label>' +
      '<input id="stDate" type="date" class="in" required value="' + addDaysYmd(3) + '"></div>' : '') +
    '<label class="lb" for="stNote">Note' + (rework ? '' : ' (optional)') + '</label>' +
    '<textarea id="stNote" rows="3" class="in mb-5"' + (rework ? ' required' : '') + '></textarea>' +
    '<div class="flex gap-3"><button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
    '<button type="submit" class="btn btn-p flex-1">' + (rework ? 'Send back' : 'Confirm') + '</button></div></form>');

  $('fStatus').addEventListener('submit', function (e) {
    e.preventDefault();
    var note = $('stNote').value.trim();
    var due = rework ? $('stDate').value : null;
    if (rework && !due) { toast('Set a new deadline.', 'err'); return; }
    busy(e.target.querySelector('button[type=submit]'), true);
    doTransition(id, status, note, due).then(closeModal);
  });
}

function openDelegate(t) {
  var others = (STATE.data.staff || []).filter(function (u) {
    return u.username !== t.assignee && u.active !== false; });
  if (!others.length) { toast('There is nobody else to hand it to.', 'err'); return; }
  openModal('<form id="fDel" class="p-6 lg:p-7">' +
    '<h2 class="text-xl font-black mb-1">Hand over "' + esc(t.title) + '"</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">Unless you are an Admin, your manager approves the hand-off.</p>' +
    '<label class="lb" for="delTo">New owner</label><select id="delTo" class="in mb-5">' +
    others.map(function (u) { return '<option value="' + esc(u.username) + '">' + esc(u.name) +
      ' · ' + esc(u.role) + '</option>'; }).join('') + '</select>' +
    '<div class="flex gap-3"><button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
    '<button type="submit" class="btn btn-p flex-1">Propose</button></div></form>');
  $('fDel').addEventListener('submit', function (e) {
    e.preventDefault();
    api('delegateTask', { taskId: t.id, toUsername: $('delTo').value })
      .then(function (r) { toast(r.message, 'ok'); closeModal(); closeDrawer(); return refresh(); })
      .catch(function (err) { toast(err.message, 'err'); });
  });
}

function openBlocker(t) {
  var cands = (STATE.data.tasks || []).filter(function (x) {
    return x.id !== t.id && ['Verified','Rejected','Cancelled'].indexOf(x.status) < 0 &&
           (t.blockedBy || []).indexOf(x.id) < 0; });
  if (!cands.length) { toast('No other open task could block this.', 'err'); return; }
  openModal('<form id="fBlk" class="p-6 lg:p-7">' +
    '<h2 class="text-xl font-black mb-5">What is blocking "' + esc(t.title) + '"?</h2>' +
    '<select id="blkId" class="in mb-5">' + cands.map(function (x) {
      return '<option value="' + esc(x.id) + '">' + esc(x.title) + ' · ' + esc(x.toName) + '</option>'; }).join('') +
    '</select><div class="flex gap-3">' +
    '<button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
    '<button type="submit" class="btn btn-p flex-1">Add blocker</button></div></form>');
  $('fBlk').addEventListener('submit', function (e) {
    e.preventDefault();
    api('addBlocker', { taskId: t.id, blockerId: $('blkId').value })
      .then(function (r) { toast(r.message, 'ok'); closeModal(); return refresh(); })
      .then(function () { openTask(t.id); })
      .catch(function (err) { toast(err.message, 'err'); });
  });
}

function openEdit(t) {
  var cats = STATE.data.categories || [];
  openModal('<form id="fEdit" class="p-6 lg:p-7">' +
    '<h2 class="text-xl font-black mb-5">Edit task</h2><div class="space-y-4">' +
    '<div><label class="lb" for="edTitle">Title</label><input id="edTitle" class="in" required value="' + esc(t.title) + '"></div>' +
    '<div><label class="lb" for="edDesc">Detail</label><textarea id="edDesc" rows="2" class="in">' + esc(t.desc) + '</textarea></div>' +
    '<div class="grid grid-cols-2 gap-4">' +
      '<div><label class="lb" for="edDue">Due date</label><input id="edDue" type="date" class="in" value="' + esc(t.due) + '"></div>' +
      '<div><label class="lb" for="edPri">Priority</label><select id="edPri" class="in">' +
        ['High','Medium','Low'].map(function (p) { return '<option' + (p === t.priority ? ' selected' : '') + '>' + p + '</option>'; }).join('') +
      '</select></div></div>' +
    '<div class="grid grid-cols-2 gap-4">' +
      '<div><label class="lb" for="edCat">Category</label><select id="edCat" class="in">' +
        cats.map(function (c) { return '<option' + (c === t.jobCategory ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
      '</select></div>' +
      '<div><label class="lb" for="edKra">KRA tag</label><input id="edKra" class="in" value="' + esc(t.kra) + '"></div></div>' +
    (STATE.user.role === 'Admin' ? '<div><label class="lb" for="edStatus">Status</label><select id="edStatus" class="in">' +
      STATUS_LIST.map(function (s) { return '<option' + (s === t.status ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
      '</select></div>' : '') +
    '</div><div class="flex gap-3 mt-6">' +
    '<button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
    '<button type="submit" class="btn btn-p flex-1">Save</button></div></form>');
  $('fEdit').addEventListener('submit', function (e) {
    e.preventDefault();
    api('editTask', { form: { taskId: t.id, title: $('edTitle').value, desc: $('edDesc').value,
      dueDate: $('edDue').value, priority: $('edPri').value, jobCategory: $('edCat').value,
      kra: $('edKra').value, status: $('edStatus') ? $('edStatus').value : undefined } })
      .then(function (r) { toast(r.message, 'ok'); closeModal(); closeDrawer(); return refresh(); })
      .catch(function (err) { toast(err.message, 'err'); });
  });
}

/* ---------- assign ------------------------------------------------------- */
function openAssign() {
  var staff = (STATE.data.staff || []).filter(function (u) { return u.active !== false; });
  if (!staff.length) { toast('Add a team member first.', 'err'); return; }
  var cats = STATE.data.categories || [];
  var u = STATE.usage;
  var left = (u.maxTasks == null) ? null : Math.max(0, u.maxTasks - u.tasks);

  openModal('<form id="fAssign" class="p-6 lg:p-7">' +
    '<h2 class="text-2xl font-black mb-1">Assign a task</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">Pick several people to give each of them their own copy.</p>' +
    '<div class="space-y-4">' +
      '<div><label class="lb" for="asTitle">Task</label><input id="asTitle" class="in" required placeholder="What needs doing?"></div>' +
      '<div><label class="lb" for="asDesc">Detail</label><textarea id="asDesc" rows="2" class="in" placeholder="Context, what done looks like…"></textarea></div>' +
      '<div><label class="lb">Assign to</label>' +
        '<div class="border border-gray-200 rounded-xl max-h-40 overflow-y-auto bg-gray-50 p-1">' +
        staff.map(function (s) {
          return '<label class="flex items-center gap-2 px-2 py-1.5 hover:bg-white rounded-lg cursor-pointer">' +
            '<input type="checkbox" class="asWho w-4 h-4 accent-blue-600" value="' + esc(s.username) + '">' +
            '<span class="text-sm font-semibold">' + esc(s.name) + '</span>' +
            '<span class="text-xs text-gray-400">' + esc(s.role) + '</span></label>';
        }).join('') + '</div>' +
        '<div id="asRoute" class="text-[11px] font-bold mt-2 text-blue-700"></div></div>' +
      '<div class="grid grid-cols-2 gap-4">' +
        '<div><label class="lb" for="asDue">Due date</label><input id="asDue" type="date" class="in" required value="' + addDaysYmd(7) + '"></div>' +
        '<div><label class="lb" for="asPri">Priority</label><select id="asPri" class="in">' +
          '<option>High</option><option selected>Medium</option><option>Low</option></select></div></div>' +
      '<div class="grid grid-cols-2 gap-4">' +
        '<div><label class="lb" for="asCat">Job category</label><select id="asCat" class="in">' +
          cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></div>' +
        '<div><label class="lb" for="asFreq">Repeats</label><select id="asFreq" class="in">' +
          ['One Time','Daily','Weekdays','Weekly','Fortnightly','Monthly','Quarterly','Half-Yearly','Yearly']
            .map(function (f) { return '<option>' + f + '</option>'; }).join('') + '</select></div></div>' +
      '<div><label class="lb" for="asKra">KRA tag</label><input id="asKra" class="in" placeholder="e.g. Vendor Quality"></div>' +
      '<div><label class="lb">Checklist <span class="normal-case tracking-normal font-semibold">(one per line, optional)</span></label>' +
        '<textarea id="asChk" rows="2" class="in" placeholder="Collect quotes&#10;Compare rates"></textarea></div>' +
    '</div>' +
    (left !== null ? '<div class="text-[11px] font-bold mt-3 ' + (left <= 5 ? 'text-amber-700' : 'text-gray-400') + '">' +
      left + ' of ' + u.maxTasks + ' tasks left this month on ' + esc(u.planName) + '.</div>' : '') +
    '<div class="flex gap-3 mt-6">' +
    '<button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
    '<button type="submit" class="btn btn-p flex-1">Assign</button></div></form>');

  var routeNote = function () {
    var picked = Array.prototype.slice.call(document.querySelectorAll('.asWho:checked'));
    if (!picked.length) { $('asRoute').textContent = ''; return; }
    var needApproval = picked.filter(function (c) {
      var s = staff.filter(function (x) { return x.username === c.value; })[0];
      return s && s.manager && s.manager !== STATE.user.username && STATE.user.role !== 'Admin';
    }).length;
    $('asRoute').textContent = needApproval
      ? needApproval + ' of these go to their manager for approval first.'
      : 'These land straight in their To Do.';
  };
  document.querySelectorAll('.asWho').forEach(function (c) {
    c.addEventListener('change', routeNote); });

  $('fAssign').addEventListener('submit', function (e) {
    e.preventDefault();
    var who = Array.prototype.slice.call(document.querySelectorAll('.asWho:checked'))
      .map(function (c) { return c.value; });
    if (!who.length) { toast('Pick at least one person.', 'err'); return; }
    var btn = e.target.querySelector('button[type=submit]');
    busy(btn, true, 'Assigning…');
    api('createTask', { form: { title: $('asTitle').value, desc: $('asDesc').value,
      assignTo: who.join(','), dueDate: $('asDue').value, priority: $('asPri').value,
      jobCategory: $('asCat').value, frequency: $('asFreq').value, kra: $('asKra').value,
      checklist: $('asChk').value } })
      .then(function (r) { toast(r.message, 'ok'); closeModal(); return refresh(); })
      .catch(function (err) { busy(btn, false); toast(err.message, 'err'); });
  });
}
