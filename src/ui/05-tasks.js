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
  var staff = byName(STATE.data.staff);
  var cats = STATE.data.categories || [];
  if (!filtersReady) {
    $('fStatus').innerHTML = '<option value="">Any status</option>' +
      STATUS_LIST.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
    filtersReady = true;
  }
  $('fAssignee').innerHTML = '<option value="">Everyone</option>' +
    staff.map(function (u) { return '<option value="' + esc(u.username) + '">' + esc(u.name) + '</option>'; }).join('');
  $('fBy').innerHTML = '<option value="">Any assignor</option>' +
    staff.map(function (u) { return '<option value="' + esc(u.username) + '"' +
      (u.username === FILTER.by ? ' selected' : '') + '>By ' + esc(u.name) + '</option>'; }).join('');
  $('fCategory').innerHTML = '<option value="">Any category</option>' +
    cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  /* The goal filter appears only once there are goals to filter by, so a
     company that never sets any never sees an empty control. */
  if ($('fGoal')) {
    var hasGoals = STATE.dir && STATE.dir.goals && STATE.dir.goals.length;
    $('fGoal').classList.toggle('hidden', !hasGoals);
    if (hasGoals) $('fGoal').innerHTML = goalOptions(FILTER.goal, 'Any goal');
  }
  $('rPerson').innerHTML = '<option value="">Team only</option>' +
    staff.map(function (u) { return '<option value="' + esc(u.username) + '">' + esc(u.name) + '</option>'; }).join('');
}

function visibleTasks() {
  /* Archive rows come from the server already filtered and paged; the active
     board is filtered here. */
  var src = STATE.archive ? (STATE.arch && STATE.arch.rows) || [] : (STATE.data.tasks || []);
  return src.filter(function (t) {
    if (!!t.isArchived !== STATE.archive) return false;
    if (FILTER.assignee && t.assignee !== FILTER.assignee) return false;
    if (FILTER.by && t.by !== FILTER.by) return false;
    if (FILTER.from || FILTER.to) {
      var day = taskDay(t, FILTER.dateOn);
      if (!day || (FILTER.from && day < FILTER.from) || (FILTER.to && day > FILTER.to)) return false;
    }
    if (FILTER.status && t.status !== FILTER.status) return false;
    if (FILTER.category && t.jobCategory !== FILTER.category) return false;
    if (FILTER.goal && t.goal !== FILTER.goal) return false;
    if (FILTER.overdue && !daysLate(t)) return false;
    if (FILTER.q) {
      var q = FILTER.q.toLowerCase();
      if ((t.title + ' ' + t.desc + ' ' + t.kra + ' ' + t.jobCategory + ' ' + t.id)
          .toLowerCase().indexOf(q) < 0) return false;
    }
    return true;
  });
}

/* ---------- the date filter: one button, a small dialog ------------------ */
function datesLabel() {
  if (!FILTER.from && !FILTER.to) return 'Any date';
  var on = FILTER.dateOn === 'created' ? 'Assigned' : 'Due';
  if (FILTER.from && FILTER.to) return on + ' ' + fmtDate(FILTER.from) + ' – ' + fmtDate(FILTER.to);
  return on + (FILTER.from ? ' from ' + fmtDate(FILTER.from) : ' until ' + fmtDate(FILTER.to));
}
function syncDatesButton() {
  $('fDatesLabel').textContent = datesLabel();
  $('fDatesBtn').classList.toggle('on', !!(FILTER.from || FILTER.to));
}
function openDateFilter() {
  var on = FILTER.dateOn === 'created' ? 'created' : 'due';
  var preset = function (k, label) { return '<button type="button" class="chip t-slate dfPre" data-k="' + k + '">' + label + '</button>'; };
  openModal('<form id="fDateDlg" class="p-6 lg:p-7">' +
    '<h2 class="text-xl font-black mb-4">Filter by date</h2>' +
    '<div class="lb">Which date</div>' +
    '<div class="seg flex gap-1 bg-gray-100 p-1 rounded-xl mb-4" id="dfOn">' +
      '<button type="button" data-on="created" class="flex-1' + (on === 'created' ? ' on' : '') + '">Assign date</button>' +
      '<button type="button" data-on="due" class="flex-1' + (on === 'due' ? ' on' : '') + '">Due date</button></div>' +
    '<div class="grid grid-cols-2 gap-3 mb-3">' +
      '<div><label class="lb" for="dfFrom">From</label><input id="dfFrom" type="date" class="in" value="' + esc(FILTER.from) + '"></div>' +
      '<div><label class="lb" for="dfTo">To</label><input id="dfTo" type="date" class="in" value="' + esc(FILTER.to) + '"></div></div>' +
    '<div class="flex flex-wrap gap-2 mb-6">' + preset('week', 'This week') + preset('month', 'This month') +
      preset('last', 'Last month') + preset('next7', 'Next 7 days') + '</div>' +
    '<div class="flex gap-3">' +
      '<button type="button" id="dfClear" class="btn btn-g">Clear</button><span class="flex-1"></span>' +
      '<button type="button" class="btn btn-g" onclick="closeModal()">Cancel</button>' +
      '<button type="submit" class="btn btn-p px-8">OK</button></div></form>', 'max-w-md');
  $('dfOn').querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () {
      on = b.dataset.on;
      $('dfOn').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
    });
  });
  var ymdOf = function (d) { var m = String(d.getMonth() + 1), day = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day); };
  document.querySelectorAll('.dfPre').forEach(function (b) {
    b.addEventListener('click', function () {
      var now = new Date(), a, z;
      if (b.dataset.k === 'week') { a = new Date(now); a.setDate(now.getDate() - ((now.getDay() + 6) % 7)); z = new Date(a); z.setDate(a.getDate() + 6); }
      if (b.dataset.k === 'month') { a = new Date(now.getFullYear(), now.getMonth(), 1); z = new Date(now.getFullYear(), now.getMonth() + 1, 0); }
      if (b.dataset.k === 'last') { a = new Date(now.getFullYear(), now.getMonth() - 1, 1); z = new Date(now.getFullYear(), now.getMonth(), 0); }
      if (b.dataset.k === 'next7') { a = new Date(now); z = new Date(now); z.setDate(now.getDate() + 6); }
      $('dfFrom').value = ymdOf(a); $('dfTo').value = ymdOf(z);
    });
  });
  var apply = function (from, to) {
    /* A range typed backwards (To before From) is read the right way round. */
    if (from && to && from > to) { var x = from; from = to; to = x; }
    FILTER.dateOn = on; FILTER.from = from; FILTER.to = to;
    closeModal(); syncDatesButton(); filtersChanged();
  };
  $('dfClear').addEventListener('click', function () { apply('', ''); });
  $('fDateDlg').addEventListener('submit', function (e) { e.preventDefault(); apply($('dfFrom').value, $('dfTo').value); });
}

/* ---------- sorting the list by person ------------------------------------
   Click "Assigned to" or "Assigned by": A–Z, then Z–A, then back to the usual
   order. */
function sortRows(rows) {
  var m = /^(to|by)-(asc|desc)$/.exec(FILTER.sort || '');
  if (!m) return rows;
  var key = m[1] === 'to' ? 'toName' : 'byName', dir = m[2] === 'asc' ? 1 : -1;
  return rows.slice().sort(function (a, b) {
    return dir * String(a[key] || '').localeCompare(String(b[key] || ''), 'en', { sensitivity: 'base' }) ||
      String(a.due || '').localeCompare(String(b.due || ''));
  });
}
function cycleSort(col) {
  FILTER.sort = FILTER.sort === col + '-asc' ? col + '-desc' : FILTER.sort === col + '-desc' ? '' : col + '-asc';
  renderTasks();
}

/** The day a task falls on for the date filter: its due date, or the day it
 *  was assigned in the viewer's own time zone. */
function taskDay(t, on) {
  if (on !== 'created') return String(t.due || '').slice(0, 10);
  var d = new Date(t.createdDate);
  if (isNaN(d)) return '';
  var m = String(d.getMonth() + 1), day = String(d.getDate());
  return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
}

/* The workspace's own levels, with whatever a given task already carries kept
   in the list even if the level has since been renamed — otherwise opening an
   old task would silently change its priority on save. */
function priorityNames(current) {
  var names = (STATE.data.priorities || []).map(function (p) { return p.name; });
  if (!names.length) names = ['Critical', 'High', 'Medium', 'Low'];
  if (current && names.indexOf(current) < 0) names = names.concat([current]);
  return names;
}

/* ---------- the tab bar, as the company's Admin arranged it ----------------
   Order and hidden tabs come from the server with the dashboard, so everyone in
   the company sees the same bar. Tasks and Team can never be hidden. */
var TAB_ALWAYS = ['tasks', 'team'];
function tabLayout() {
  var l = (STATE.data && STATE.data.layout) || {};
  return { order: l.order || ['tasks','priority','projects','meetings','goals','board','reports','team'],
           hidden: l.hidden || [] };
}
function applyTabLayout() {
  var l = tabLayout();
  ['navTabs', 'navTabsMobile'].forEach(function (id) {
    var bar = $(id);
    if (!bar) return;
    l.order.forEach(function (k) {
      var b = bar.querySelector('button[data-tab="' + k + '"]');
      if (b) { bar.appendChild(b); b.classList.toggle('hidden', l.hidden.indexOf(k) > -1); }
    });
  });
  if (l.hidden.indexOf(STATE.tab) > -1) STATE.tab = 'tasks';
}
function tabLabel(k) {
  var b = document.querySelector('#navTabs button[data-tab="' + k + '"]');
  return b ? b.textContent.trim() : k;
}

/* ---------- the task workflow, chosen by the Admin for everybody ---------- */
function openWorkflow() {
  var cur = shortFlow() ? 'short' : 'standard';
  var opt = function (k, title, flow, note) {
    return '<label class="flex gap-3 items-start border rounded-2xl p-4 cursor-pointer mb-3 ' +
      (k === cur ? 'border-blue-600 bg-blue-50' : 'border-gray-200') + '">' +
      '<input type="radio" name="wfMode" value="' + k + '" class="mt-1 w-4 h-4 accent-blue-600"' + (k === cur ? ' checked' : '') + '>' +
      '<span><span class="block font-black text-gray-900">' + title + '</span>' +
      '<span class="block text-sm font-bold text-blue-700 mt-1">' + flow + '</span>' +
      '<span class="block text-xs font-semibold text-gray-500 mt-1">' + note + '</span></span></label>';
  };
  openModal('<form id="fWorkflow" class="p-6 lg:p-7">' +
    '<h2 class="text-xl font-black mb-1">Task workflow</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">How every task in the company moves. Only an Admin can change this.</p>' +
    opt('standard', 'Three steps', 'To do → Start work → Submit for review → Verify &amp; close',
      'People mark when they start, so the board shows what is under way.') +
    opt('short', 'Two steps', 'To do → Submit for review → Verify &amp; close',
      'No "In progress" stage. Send back returns a task to To do. Tasks already in progress can still be submitted.') +
    '<div class="flex gap-3 mt-5"><button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
    '<button type="submit" class="btn btn-p flex-1">Save</button></div></form>');
  $('fWorkflow').querySelectorAll('input[name=wfMode]').forEach(function (r) {
    r.addEventListener('change', function () {
      $('fWorkflow').querySelectorAll('label').forEach(function (l) {
        var on = l.querySelector('input').checked;
        l.classList.toggle('border-blue-600', on); l.classList.toggle('bg-blue-50', on); l.classList.toggle('border-gray-200', !on);
      });
    });
  });
  $('fWorkflow').addEventListener('submit', function (e) {
    e.preventDefault();
    var mode = $('fWorkflow').querySelector('input[name=wfMode]:checked').value;
    busy(e.target.querySelector('button[type=submit]'), true);
    api('saveWorkflow', { workflow: mode })
      .then(function (r) { toast(r.message, 'ok'); closeModal(); return refresh(); })
      .catch(function (err) { busy(e.target.querySelector('button[type=submit]'), false); toast(err.message, 'err'); });
  });
}

function openTabLayout() {
  if (!isAdmin()) { toast('Only an Admin can arrange the tabs.', 'warn'); return; }
  var l = tabLayout(), order = l.order.slice(), hidden = l.hidden.slice();
  openModal('<div class="p-6 lg:p-7">' +
    '<h2 class="text-xl font-black mb-1">Arrange tabs</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">Put the tabs in the order your company uses them, ' +
      'and hide the ones you do not need. This changes the bar for everybody. Tasks and Team always stay.</p>' +
    '<div id="tlList" class="space-y-2"></div>' +
    '<div class="flex flex-wrap gap-3 mt-6">' +
      '<button class="btn btn-g" id="tlReset">Reset to default</button><span class="flex-1"></span>' +
      '<button class="btn btn-g" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-p" id="tlSave">Save</button></div></div>', 'max-w-lg');
  function draw() {
    $('tlList').innerHTML = order.map(function (k, i) {
      var locked = TAB_ALWAYS.indexOf(k) > -1, off = hidden.indexOf(k) > -1;
      return '<div class="tlRow flex items-center gap-2 rounded-xl border-2 px-3 py-2 ' +
          (off ? 'border-gray-100 bg-gray-50' : 'border-blue-100 bg-white') + '" data-k="' + k + '">' +
        '<span class="w-5 text-xs font-black text-gray-400">' + (i + 1) + '</span>' +
        '<span class="flex-1 font-black ' + (off ? 'text-gray-400 line-through' : '') + '">' + esc(tabLabel(k)) + '</span>' +
        '<button type="button" class="tlUp barbtn w-8 h-8 rounded-lg" data-i="' + i + '" aria-label="Move ' + esc(tabLabel(k)) + ' up"' +
          (i === 0 ? ' disabled style="opacity:.3"' : '') + '><span class="material-icons text-[20px]">arrow_upward</span></button>' +
        '<button type="button" class="tlDown barbtn w-8 h-8 rounded-lg" data-i="' + i + '" aria-label="Move ' + esc(tabLabel(k)) + ' down"' +
          (i === order.length - 1 ? ' disabled style="opacity:.3"' : '') + '><span class="material-icons text-[20px]">arrow_downward</span></button>' +
        (locked ? '<span class="text-[11px] font-black text-gray-400 w-20 text-center">Always on</span>'
          : '<button type="button" class="tlToggle btn ' + (off ? 'btn-g' : 'btn-p') + ' text-xs py-1.5 w-20" data-k="' + k + '">' +
            (off ? 'Hidden' : 'Shown') + '</button>') +
        '</div>';
    }).join('');
    $('tlList').querySelectorAll('.tlUp').forEach(function (b) { b.addEventListener('click', function () {
      var i = +b.dataset.i; if (i > 0) { order.splice(i - 1, 0, order.splice(i, 1)[0]); draw(); } }); });
    $('tlList').querySelectorAll('.tlDown').forEach(function (b) { b.addEventListener('click', function () {
      var i = +b.dataset.i; if (i < order.length - 1) { order.splice(i + 1, 0, order.splice(i, 1)[0]); draw(); } }); });
    $('tlList').querySelectorAll('.tlToggle').forEach(function (b) { b.addEventListener('click', function () {
      var k = b.dataset.k, at = hidden.indexOf(k);
      if (at > -1) hidden.splice(at, 1); else hidden.push(k);
      draw(); }); });
  }
  draw();
  $('tlReset').addEventListener('click', function () {
    order = ['tasks','priority','projects','meetings','goals','board','reports','team']; hidden = []; draw(); });
  $('tlSave').addEventListener('click', function () {
    var btn = $('tlSave'); busy(btn, true, 'Saving…');
    api('saveTabLayout', { layout: { order: order, hidden: hidden } })
      .then(function (r) {
        STATE.data.layout = r.layout; applyTabLayout(); renderTab();
        toast(r.message, 'ok'); closeModal();
      })
      .catch(function (e) { busy(btn, false); toast(e.message, 'err'); });
  });
}

function renderTab() {
  ['tasks','priority','projects','team','reports','board','goals','meetings'].forEach(function (t) {
    $('tab-' + t).classList.toggle('hidden', t !== STATE.tab); });
  document.querySelectorAll('#navTabs button,#navTabsMobile button').forEach(function (b) {
    b.classList.toggle('on', b.dataset.tab === STATE.tab); });
  if (STATE.tab === 'tasks') renderTasks();
  if (STATE.tab === 'priority') loadPriority();
  if (STATE.tab === 'projects') loadProjects();
  if (STATE.tab === 'team') loadTeam();
  if (STATE.tab === 'reports') loadReports();
  if (STATE.tab === 'board') loadLeaderboard();
  if (STATE.tab === 'goals') loadGoals();
  if (STATE.tab === 'meetings') loadMeetings();
  /* Leaving a running meeting's screen stops its polling; coming back resumes. */
  if (STATE.tab !== 'meetings') stopMeetingPoll();
}

/* Closed work is fetched a page at a time, newest first, searched on the
   server — never the whole history at once. */
function loadArchive(reset) {
  if (reset || !STATE.arch) STATE.arch = { rows: [], total: 0, page: -1, loading: false };
  var a = STATE.arch;
  if (a.loading) return;
  a.loading = true;
  return api('getArchive', { page: a.page + 1, q: FILTER.q, assignee: FILTER.assignee,
      by: FILTER.by, dateOn: FILTER.dateOn, from: FILTER.from, to: FILTER.to,
      status: FILTER.status, category: FILTER.category, goal: FILTER.goal })
    .then(function (r) {
      if (STATE.arch !== a) return;
      a.rows = a.rows.concat(r.tasks || []); a.total = r.total; a.page = r.page; a.loading = false;
      renderTasks();
    }).catch(function (e) { a.loading = false; toast(e.message, 'err'); });
}

/* Filters re-query the archive (it lives on the server) but only re-draw the
   board. Typing waits a moment so a search is one request, not one per key. */
var archiveTimer = null;
function filtersChanged(typing) {
  if (!STATE.archive) return renderTasks();
  clearTimeout(archiveTimer);
  archiveTimer = setTimeout(function () { loadArchive(true); }, typing ? 350 : 0);
}

function renderTasks() {
  var rows = visibleTasks();
  var more = $('archiveMore');
  if (more) {
    var a = STATE.arch;
    var left = STATE.archive && a ? a.total - a.rows.length : 0;
    more.classList.toggle('hidden', !(STATE.archive && a && a.rows.length));
    if (STATE.archive && a) more.innerHTML = '<span class="text-xs font-bold text-gray-400">Showing ' + a.rows.length +
      ' of ' + a.total + ' closed tasks, newest first</span>' +
      (left > 0 ? '<button class="btn btn-g text-xs py-2" id="btnArchiveMore">Load ' + Math.min(50, left) + ' more</button>' : '');
    if ($('btnArchiveMore')) $('btnArchiveMore').onclick = function () { loadArchive(false); };
  }
  if (STATE.archive && (!STATE.arch || STATE.arch.page < 0)) {
    $('tasksEmpty').classList.remove('hidden'); $('tasksEmpty').innerHTML = spin('Loading closed work…');
    $('board').classList.add('hidden'); $('list').classList.add('hidden');
    if (!STATE.arch || !STATE.arch.loading) loadArchive(true);
    return;
  }
  $('tasksEmpty').classList.toggle('hidden', rows.length > 0);
  $('tasksEmpty').textContent = STATE.archive
    ? (STATE.arch && STATE.arch.total === 0 && !FILTER.q && !FILTER.assignee
        ? 'Nothing archived yet. Closed work moves here after a week.' : 'No closed tasks match these filters.')
    : (STATE.data.tasks || []).length ? 'No tasks match these filters.'
      : 'No tasks yet. Assign the first one.';
  /* The archive is always a list: a board of closed work has one column. */
  var mode = STATE.archive ? 'list' : STATE.mode;
  $('board').classList.toggle('hidden', mode !== 'board' || !rows.length);
  $('list').classList.toggle('hidden', mode !== 'list' || !rows.length);
  if (!rows.length && !STATE.archive && !(STATE.data.tasks || []).length) renderFirstRun();
  if (!rows.length) return;
  if (mode === 'board') renderBoard(rows); else renderList(rows);
}

/* A new workspace's empty board is where a trial is won or lost, so instead
   of "no tasks" it shows the three things that get a team running, ticking
   them off as they are done. */
function renderFirstRun() {
  if (!STATE.user || STATE.user.role === 'Doer' || STATE.demo) return;
  var people = (STATE.data.staff || []).filter(function (u) { return u.active !== false; }).length;
  var step = function (done, n, title, sub, action, label) {
    return '<div class="flex items-center gap-4 py-3 border-t border-gray-100 first:border-0">' +
      '<span class="w-9 h-9 rounded-xl flex items-center justify-center font-black shrink-0 ' +
        (done ? 'bg-emerald-600 text-white' : 'bg-blue-50 text-blue-700') + '">' +
        (done ? '<span class="material-icons text-[20px]">check</span>' : n) + '</span>' +
      '<div class="flex-1 text-left"><div class="font-black text-gray-900">' + title + '</div>' +
        '<div class="text-[13px] font-semibold text-gray-500">' + sub + '</div></div>' +
      (done ? '' : '<button class="btn btn-p text-sm" onclick="' + action + '">' + label + '</button>') + '</div>';
  };
  $('tasksEmpty').innerHTML = '<div class="max-w-[620px] mx-auto bg-white rounded-3xl border-2 border-gray-200 p-6 text-left">' +
    '<div class="text-[11px] font-black uppercase tracking-widest text-blue-600">Get started</div>' +
    '<div class="text-xl font-black text-gray-900 mt-1">Three steps and your team is running</div>' +
    '<div class="mt-3">' +
      step(people > 1, 1, 'Add your team', 'Name, role and their manager — that becomes the approval chain.',
           "STATE.tab='team'; renderTab(); setTimeout(function(){ openUser(); }, 600)", 'Add a person') +
      step(false, 2, 'Assign the first job', 'A due date and a priority. Reminders go out by themselves.',
           'openAssign()', 'Assign a job') +
      step(false, 3, 'Show your team how it works', 'A printable manual with a picture of every screen.',
           "window.open('/user-manual.pdf','_blank')", 'Open the manual') +
    '</div></div>';
}

function taskCard(t) {
  var late = daysLate(t);
  var sub = (t.subtasks || []), done = sub.filter(function (s) { return s.done; }).length;
  return '<div class="card p-' + esc(t.priority) + '" draggable="true" data-id="' + esc(t.id) + '">' +
    '<div class="flex justify-between items-start gap-2 mb-2">' +
      '<span class="font-bold text-sm leading-snug">' + esc(t.title) + '</span>' +
      avatar(t.toName, 28) + '</div>' +
    /* A checklist deserves a bar, not a fraction nobody reads. */
    (sub.length ? '<div class="h-1.5 rounded-full bg-gray-100 overflow-hidden mb-2">' +
      '<div class="h-full" style="width:' + Math.round(done / sub.length * 100) + '%;' +
      'background:' + (done === sub.length ? '#067647' : '#1e4fbf') + '"></div></div>' : '') +
    '<div class="flex flex-wrap items-center gap-1.5">' +
      '<span class="chip ' + (late ? 't-coral' : 't-slate') + '">' +
        fmtDate(t.due) + (late ? ' \u00b7 ' + late + 'd late' : '') + '</span>' +
      priorityChip(t.priority) +
      (t.projectId ? '<span class="chip t-violet" title="' + esc(t.projectName) + '">' +
        esc(t.projectName) + ' \u00b7 ' + t.stageNo + '/' + t.stageCount + '</span>' : '') +
      ((t.blockedBy || []).length ? '<span class="chip t-amber">Blocked</span>' : '') +
      (sub.length ? '<span class="chip t-slate">' + done + '/' + sub.length + '</span>' : '') +
      (t.reworkCount ? '<span class="chip t-rust">Rework ' + t.reworkCount + '</span>' : '') +
      (t.frequency && t.frequency !== 'One Time' ? '<span class="chip t-plum">' + esc(repeatLabel(t)) + '</span>' : '') +
      (t.goal && goalTitle(t.goal) ? '<span class="chip t-sky" title="Serves this goal">◎ ' + esc(goalTitle(t.goal)) + '</span>' : '') +
      (t.jobCategory && t.jobCategory !== 'General'
        ? tintChip(t.jobCategory, t.jobCategory) : '') +
    '</div></div>';
}

/* A column shows its most urgent cards first and stops at COL_LIMIT, with a
   button for the rest — a team of fifty would otherwise scroll a To do column
   for minutes. Late work first (latest first), then by due date; Verified by
   the most recently closed. */
var COL_LIMIT = 20;
function columnOrder(key, items) {
  var lastAt = function (t) { var h = t.history || []; return h.length ? String(h[h.length - 1].date) : ''; };
  return items.slice().sort(function (a, b) {
    if (key === 'done') return lastAt(b) < lastAt(a) ? -1 : lastAt(b) > lastAt(a) ? 1 : 0;
    var la = daysLate(a), lb = daysLate(b);
    if (la !== lb) return lb - la;
    return String(a.due || '9') < String(b.due || '9') ? -1 : String(a.due || '9') > String(b.due || '9') ? 1 : 0;
  });
}

function renderBoard(rows) {
  STATE.colOpen = STATE.colOpen || {};
  var cols = COLUMNS.filter(function (c) {
    return c.key !== 'doing' || !shortFlow() || rows.some(function (t) { return t.status === 'In Progress'; });
  });
  $('board').style.gridTemplateColumns = 'repeat(' + cols.length + ',minmax(230px,1fr))';
  $('board').innerHTML = cols.map(function (c) {
    var all = columnOrder(c.key, rows.filter(function (t) { return c.statuses.indexOf(t.status) > -1; }));
    var open = STATE.colOpen[c.key] || all.length <= COL_LIMIT + 5;
    var items = open ? all : all.slice(0, COL_LIMIT);
    var tone = stateTone(c.title).tone;
    /* The column carries the colour of the state it holds, so the eye learns
       the flow left to right. The heading still says the word — the colour is
       never the only thing saying which column this is. */
    return '<div><div class="flex items-center justify-between px-1 mb-2">' +
      '<span class="colhead"><span class="coldot" style="background:' + tone + '"></span>' +
      '<span class="text-[10px] font-black uppercase tracking-widest text-gray-600">' +
        esc(c.title) + '</span></span>' +
      '<span class="text-[10px] font-black text-gray-400">' + all.length + '</span></div>' +
      '<div class="col" data-col="' + c.key + '" style="--col-tone:' + tone + '">' +
      (items.map(taskCard).join('') ||
        '<div class="text-[11px] text-gray-400 font-semibold px-1 py-3">Nothing here</div>') +
      (all.length > items.length ? '<button class="colMore w-full text-xs font-black py-2 rounded-lg hover:bg-white" ' +
        'style="color:var(--brand)" data-col="' + c.key + '">Show all ' + all.length + '</button>'
        : (STATE.colOpen[c.key] && all.length > COL_LIMIT + 5 ? '<button class="colMore w-full text-xs font-black py-2 rounded-lg hover:bg-white" ' +
          'style="color:var(--brand)" data-col="' + c.key + '">Show fewer</button>' : '')) +
      '</div></div>';
  }).join('');
  $('board').querySelectorAll('.colMore').forEach(function (b) {
    b.addEventListener('click', function () { STATE.colOpen[b.dataset.col] = !STATE.colOpen[b.dataset.col]; renderTasks(); });
  });
  wireBoard();
}

function renderList(rows) {
  rows = sortRows(rows);
  var head = function (h) {
    var col = h === 'Assigned to' ? 'to' : h === 'Assigned by' ? 'by' : '';
    if (!col) return '<th>' + h + '</th>';
    var s = FILTER.sort === col + '-asc' ? ' <span class="text-blue-600">A–Z ↓</span>'
          : FILTER.sort === col + '-desc' ? ' <span class="text-blue-600">Z–A ↑</span>'
          : ' <span class="material-icons text-xs align-middle text-gray-300">unfold_more</span>';
    return '<th><button type="button" class="sortBy font-black uppercase whitespace-nowrap hover:text-gray-800" ' +
      'data-col="' + col + '" title="Sort A–Z / Z–A">' + h + s + '</button></th>';
  };
  $('list').innerHTML = '<table class="tbl"><thead><tr>' +
    ['Task','Category','Assigned to','Assigned by','Status','Priority','Due'].map(head).join('') +
    '</tr></thead><tbody>' +
    rows.map(function (t) {
      var late = daysLate(t);
      return '<tr class="cursor-pointer" data-id="' + esc(t.id) + '">' +
        '<td class="font-bold text-gray-800">' + esc(t.title) +
          '<span class="text-gray-300 font-semibold ml-1">' + esc(t.id) + '</span></td>' +
        '<td class="whitespace-nowrap">' +
          (t.jobCategory ? tintChip(t.jobCategory, t.jobCategory) : '—') + '</td>' +
        '<td class="whitespace-nowrap"><span class="flex items-center gap-2">' +
          avatar(t.toName, 22) + esc(t.toName) + '</span></td>' +
        '<td class="whitespace-nowrap text-gray-600">' + esc(t.byName || '—') + '</td>' +
        '<td class="whitespace-nowrap"><span class="chip ' + stateTone(t.status).chip + '">' +
          esc(t.status) + '</span></td>' +
        '<td class="whitespace-nowrap">' + priorityChip(t.priority) + '</td>' +
        '<td class="whitespace-nowrap ' + (late ? 'text-red-700 font-black' : '') + '">' +
          fmtDate(t.due) + (late ? ' · ' + late + 'd' : '') + '</td></tr>';
    }).join('') + '</tbody></table>';
  $('list').querySelectorAll('tr[data-id]').forEach(function (r) {
    r.addEventListener('click', function () { openTask(r.dataset.id); }); });
  $('list').querySelectorAll('.sortBy').forEach(function (b) {
    b.addEventListener('click', function () { cycleSort(b.dataset.col); }); });
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
        toast('Approval is not something you can drag a task into.', 'warn'); return; }
      if ((next === 'In Progress' || next === 'Pending') && t.status === 'For Review') { openStatus(t.id, next); return; }
      doTransition(t.id, next);
    });
  });
}

function taskById(id) {
  var list = (STATE.data.tasks || []).concat((STATE.arch && STATE.arch.rows) || []);
  for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i];
  return null;
}

/** The two-step workflow (To do -> For review -> Verified), set by an Admin. */
function shortFlow() { return !!(STATE.data && STATE.data.workflow === 'short'); }

function doTransition(id, status, note, newDue) {
  return api('updateTask', { taskId: id, status: status, note: note, newDueDate: newDue })
    .then(function (r) { toast(r.message, 'ok'); closeDrawer(); return refresh(); })
    .catch(function (e) { toast(e.message, 'err'); });
}

/* ---------- detail drawer ------------------------------------------------ */
function openTask(id) {
  var t = taskById(id);
  /* Closed work is not on the board any more; fetch it by its id rather than
     claiming it does not exist — a meeting's actions link to closed tasks. */
  if (!t && !openTask.fetching) {
    openTask.fetching = true;
    return api('getArchive', { q: id, pageSize: 10 }).then(function (r) {
      openTask.fetching = false;
      var hit = (r.tasks || []).filter(function (x) { return String(x.id) === String(id); })[0];
      if (!hit) return toast('That task is not one you can see.', 'warn');
      STATE.arch = STATE.arch || { rows: [], total: 0, page: -1 };
      STATE.arch.rows.push(hit);
      openTask(id);
    }).catch(function (e) { openTask.fetching = false; toast(e.message, 'err'); });
  }
  if (!t) return;
  var me = STATE.user;
  var late = daysLate(t);
  var subs = t.subtasks || [];
  var doneN = subs.filter(function (s) { return s.done; }).length;
  var isMine = t.assignee === me.username;
  var isRaiser = t.by === me.username;
  var isApprover = t.approver === me.username;
  var isAdmin = me.role === 'Admin';
  var isOpenTask = ['Awaiting Approval','Delegation Proposed','Pending','In Progress','For Review'].indexOf(t.status) > -1;
  var editSteps = isAdmin && isOpenTask && !t.coldStore;
  var acts = [];

  if (t.status === 'Awaiting Approval' || t.status === 'Delegation Proposed') {
    if (isApprover || isAdmin) {
      acts.push(['approve','Approve','btn-p']); acts.push(['reject','Reject','btn-g']);
    }
  } else if (t.status === 'Pending' && (isMine || isAdmin)) {
    acts.push(shortFlow() ? ['submit','Submit for review','btn-p'] : ['start','Start work','btn-p']);
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
  if (subs.length && doneN < subs.length && (t.status === 'In Progress' || (shortFlow() && t.status === 'Pending'))) {
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
       ['KRA', t.kra || '—'], ['Repeats', repeatLabel(t)], ['Rework loops', String(t.reworkCount || 0)],
       ['Serves goal', t.goal ? (goalTitle(t.goal) || '—') : '—']]
      .map(function (p) { return '<div><div class="lb">' + esc(p[0]) + '</div>' +
        '<div class="font-bold text-gray-800">' + esc(p[1]) + '</div></div>'; }).join('') + '</div>' +

    (subs.length || editSteps ? '<div class="mb-5"><div class="flex justify-between items-center mb-2">' +
      '<span class="lb mb-0">Checklist</span><span class="text-xs font-black text-gray-500">' +
      (subs.length ? doneN + '/' + subs.length : 'no steps yet') + '</span></div>' +
      (subs.length ? '<div class="h-1.5 bg-gray-100 rounded-full mb-3 overflow-hidden"><div class="h-full bg-blue-600" ' +
      'style="width:' + Math.round(doneN / subs.length * 100) + '%"></div></div>' : '') +
      subs.map(function (s, i) {
        return '<div class="flex items-center gap-2"><label class="flex-1 flex items-center gap-2 py-1.5 text-sm ' +
          (s.done ? 'text-gray-400 line-through' : 'text-gray-700') + '">' +
          '<input type="checkbox" class="w-4 h-4 accent-blue-600 sub" data-i="' + i + '"' +
          (s.done ? ' checked' : '') + (isMine || isAdmin ? '' : ' disabled') + '> ' + esc(s.text) + '</label>' +
          (editSteps ? '<button type="button" class="stepDel text-gray-300 hover:text-red-600" data-i="' + i + '" ' +
            'title="Delete this step" aria-label="Delete step"><span class="material-icons text-base">delete</span></button>' : '') +
          '</div>';
      }).join('') +
      /* Only an Admin changes the steps, and only while the task is open. */
      (editSteps ? '<div class="flex gap-2 mt-2"><input id="stepNew" class="in" maxlength="200" placeholder="Add a step">' +
        '<button type="button" id="stepAdd" class="btn btn-g whitespace-nowrap">Add step</button></div>' : '') +
      '</div>' : '') +

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
    /* Archive and delete are the Admin's alone. */
    (isAdmin && !t.coldStore ? '<div class="flex flex-wrap items-center gap-2 mb-5 pt-4 border-t border-gray-100">' +
      '<span class="lb mb-0 mr-1">Admin</span>' +
      (t.archivedOn ? '<button class="btn btn-g act" data-act="restore">Restore to board</button>'
        : !t.isArchived && !(t.projectId && isOpenTask) ? '<button class="btn btn-g act" data-act="archive">' +
          '<span class="material-icons text-base align-middle">inventory_2</span> Archive</button>' : '') +
      (!t.projectId ? '<button class="btn btn-g act text-red-700" data-act="delete">' +
        '<span class="material-icons text-base align-middle">delete</span> Delete</button>' : '') +
    '</div>' : '') +

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
      if (a === 'rework')  return openStatus(t.id, shortFlow() ? 'Pending' : 'In Progress');
      if (a === 'delegate')return openDelegate(t);
      if (a === 'block')   return openBlocker(t);
      if (a === 'stop')    return stopRecurring(t.id);
      if (a === 'edit')    return openEdit(t);
      if (a === 'archive') return adminTask('archiveTask', t, 'Archive "' + t.title + '"?' +
        (isOpenTask ? ' It is still open, so it will be cancelled: no more reminders, and it counts against nobody. You can restore it.' : ''), 'Archive');
      if (a === 'restore') return adminTask('restoreTask', t, 'Put "' + t.title + '" back on the board?', 'Restore');
      if (a === 'delete')  return adminTask('deleteTask', t, 'Delete "' + t.title + '" for good? This cannot be undone.', 'Delete', true);
    });
  });
  var reopen = function () { return refresh().then(function () { openTask(t.id); }); };
  var addStep = function () {
    var v = $('stepNew').value.trim();
    if (!v) return $('stepNew').focus();
    api('addTaskStep', { taskId: t.id, text: v }).then(reopen).catch(function (e) { toast(e.message, 'err'); });
  };
  if ($('stepAdd')) {
    $('stepAdd').addEventListener('click', addStep);
    $('stepNew').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addStep(); } });
  }
  $('drawer').querySelectorAll('.stepDel').forEach(function (b) {
    b.addEventListener('click', function () {
      var s = subs[Number(b.dataset.i)];
      confirmBox('Delete the step "' + s.text + '"?', { ok: 'Delete', danger: true }).then(function (yes) {
        if (!yes) return;
        api('removeTaskStep', { taskId: t.id, index: Number(b.dataset.i), text: s.text }).then(reopen)
          .catch(function (e) { toast(e.message, 'err'); });
      });
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

/** Archive, restore or delete — Admin only, always after a confirmation. */
function adminTask(action, t, question, ok, danger) {
  confirmBox(question, { ok: ok, danger: !!danger }).then(function (yes) {
    if (!yes) return;
    api(action, { taskId: t.id })
      .then(function (r) { toast(r.message, 'ok'); closeDrawer(); return refresh(); })
      .then(function () { if (STATE.archive && typeof loadArchive === 'function') loadArchive(true); })
      .catch(function (e) { toast(e.message, 'err'); });
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
/**
 * The cadence AND how it ends, in one phrase. "Monthly" alone is a promise the
 * product cannot keep looking at — the useful thing to know on a task that
 * repeats is when it will stop, and how much of it is left.
 */
function repeatLabel(t) {
  if (!t.frequency || t.frequency === 'One Time') return 'One Time';
  if (t.repeatCount) {
    var made = Number(t.repeatMade || 1);
    return t.frequency + ' · ' + made + ' of ' + t.repeatCount;
  }
  if (t.repeatUntil) return t.frequency + ' · until ' + t.repeatUntil;
  return t.frequency;
}

function openStatus(id, status) {
  var cur = taskById(id);
  var rework = status === 'In Progress' || (status === 'Pending' && cur && cur.status === 'For Review');
  /* "fStatusChange", not "fStatus": the status FILTER on the Tasks bar is
     #fStatus and sits earlier in the page, so $('fStatus') used to find the
     filter, the submit handler landed on a <select>, and pressing Submit here
     did a native form submit — reloading the page and saving nothing. Every
     Submit for review, Verify and Send back from this dialog was lost. */
  openModal('<form id="fStatusChange" class="p-6 lg:p-7">' +
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

  $('fStatusChange').addEventListener('submit', function (e) {
    e.preventDefault();
    var note = $('stNote').value.trim();
    var due = rework ? $('stDate').value : null;
    if (rework && !due) { toast('Set a new deadline.', 'warn'); return; }
    busy(e.target.querySelector('button[type=submit]'), true);
    doTransition(id, status, note, due).then(closeModal);
  });
}

function openDelegate(t) {
  var others = (STATE.data.staff || []).filter(function (u) {
    return u.username !== t.assignee && u.active !== false; });
  if (!others.length) { toast('There is nobody else to hand it to.', 'warn'); return; }
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
  if (!cands.length) { toast('No other open task could block this.', 'warn'); return; }
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
  openModal('<form id="fEdit" class="p-6 lg:p-7">' +
    '<h2 class="text-xl font-black mb-5">Edit task</h2><div class="space-y-4">' +
    '<div><label class="lb" for="edTitle">Title</label><input id="edTitle" class="in" required value="' + esc(t.title) + '"></div>' +
    '<div><label class="lb" for="edDesc">Detail</label><textarea id="edDesc" rows="2" class="in">' + esc(t.desc) + '</textarea></div>' +
    '<div class="grid grid-cols-2 gap-4">' +
      '<div><label class="lb" for="edDue">Due date</label><input id="edDue" type="date" class="in" value="' + esc(t.due) + '"></div>' +
      '<div><label class="lb" for="edPri">Priority</label><select id="edPri" class="in">' +
        priorityNames(t.priority).map(function (p) {
          return '<option' + (p === t.priority ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') +
      '</select></div></div>' +
    '<div class="grid grid-cols-2 gap-4">' +
      '<div><label class="lb" for="edCat">Category</label>' + catPickerHtml('edCat', t.jobCategory) + '</div>' +
      '<div><label class="lb" for="edKra">KRA tag</label><input id="edKra" class="in" value="' + esc(t.kra) + '"></div></div>' +
    (STATE.user.role === 'Admin' ? '<div><label class="lb" for="edStatus">Status</label><select id="edStatus" class="in">' +
      STATUS_LIST.map(function (s) { return '<option' + (s === t.status ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
      '</select></div>' : '') +
    '</div><div class="flex gap-3 mt-6">' +
    '<button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
    '<button type="submit" class="btn btn-p flex-1">Save</button></div></form>');
  bindCatPicker('edCat');
  $('fEdit').addEventListener('submit', function (e) {
    e.preventDefault();
    var cat = readCatPicker('edCat');
    if (cat === null) return;
    api('editTask', { form: { taskId: t.id, title: $('edTitle').value, desc: $('edDesc').value,
      dueDate: $('edDue').value, priority: $('edPri').value, jobCategory: cat,
      kra: $('edKra').value, status: $('edStatus') ? $('edStatus').value : undefined } })
      .then(function (r) { toast(r.message, 'ok'); closeModal(); closeDrawer(); return refresh(); })
      .catch(function (err) { toast(err.message, 'err'); });
  });
}

/* ---------- assign ------------------------------------------------------- */
/* ---------- job category picker -----------------------------------------
   Managers can type a new category right where they need it; the server adds
   it to the company's list. A task's current category is always offered, even
   if it has since been renamed or removed, so editing never changes it
   silently. */
function canManageCats() { return !!(STATE.user && (STATE.user.role === 'Admin' || STATE.user.role === 'HOD')); }
function catPickerHtml(id, current) {
  var cats = (STATE.data.categories || []).slice();
  if (current && cats.indexOf(current) < 0) cats.unshift(current);
  return '<select id="' + id + '" class="in">' +
    cats.map(function (c) { return '<option' + (c === current ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
    (canManageCats() ? '<option value="__new__">＋ New category…</option>' : '') + '</select>' +
    '<input id="' + id + 'New" class="in mt-2 hidden" maxlength="60" placeholder="New category name">';
}
function bindCatPicker(id) {
  var sel = $(id), box = $(id + 'New');
  if (!sel || !box) return;
  sel.addEventListener('change', function () {
    var on = sel.value === '__new__';
    box.classList.toggle('hidden', !on);
    if (on) box.focus();
  });
}
/** The chosen category, or null (with a warning) when "new" was picked but left empty. */
function readCatPicker(id) {
  var sel = $(id);
  if (!sel) return '';
  if (sel.value !== '__new__') return sel.value;
  var v = $(id + 'New').value.trim();
  if (!v) { toast('Type the new category name, or pick one from the list.', 'warn'); return null; }
  return v;
}

/* ---------- finding people in a long list --------------------------------- */
function personSearchText(s) {
  return [s.name, s.username, s.role, s.dept, s.jobProfile].join(' ').toLowerCase();
}

function openAssign() {
  var staff = (STATE.data.staff || []).filter(function (u) { return u.active !== false; });
  if (!staff.length) { toast('Add a team member first.', 'warn'); return; }
  var cats = STATE.data.categories || [];
  var u = STATE.usage;
  var left = (u.maxTasks == null) ? null : Math.max(0, u.maxTasks - u.tasks);

  openModal('<form id="fAssign" class="p-6 lg:p-7">' +
    '<h2 class="text-2xl font-black mb-1">Assign a task</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">Pick several people to give each of them their own copy.</p>' +
    '<div class="space-y-4">' +
      '<div><label class="lb" for="asTitle">Task</label><input id="asTitle" class="in" required placeholder="What needs doing?"></div>' +
      '<div><label class="lb" for="asDesc">Detail</label><textarea id="asDesc" rows="2" class="in" placeholder="Context, what done looks like…"></textarea></div>' +
      '<div><div class="flex items-end justify-between"><label class="lb" for="asWhoQ">Assign to</label>' +
          '<span class="flex items-center gap-3 mb-1"><span id="asWhoCount" class="text-[11px] font-black text-gray-400"></span>' +
          '<button type="button" id="asWhoSort" class="text-[11px] font-black text-blue-700 hover:underline" ' +
            'title="Sort the names">A–Z ↓</button></span></div>' +
        /* With a team of fifty, scrolling a list of names is how the wrong
           person gets ticked. Search by name, role, department or job. */
        '<div class="relative mb-2"><span class="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">search</span>' +
          '<input id="asWhoQ" class="in" style="padding-left:2.4rem" autocomplete="off" ' +
          'placeholder="Search by name, role or department"></div>' +
        '<div id="asWhoList" class="border border-gray-200 rounded-xl max-h-48 overflow-y-auto bg-gray-50 p-1">' +
        staff.map(function (s) {
          return '<label class="asWhoRow flex items-center gap-2 px-2 py-1.5 hover:bg-white rounded-lg cursor-pointer" ' +
            'data-q="' + esc(personSearchText(s)) + '">' +
            '<input type="checkbox" class="asWho w-4 h-4 accent-blue-600" value="' + esc(s.username) + '">' +
            '<span class="text-sm font-semibold">' + esc(s.name) + '</span>' +
            '<span class="text-xs text-gray-400">' + esc(s.role) + (s.dept ? ' · ' + esc(s.dept) : '') + '</span></label>';
        }).join('') +
        '<div id="asWhoNone" class="hidden text-xs font-bold text-gray-400 px-2 py-3">Nobody matches that.</div></div>' +
        '<div id="asRoute" class="text-[11px] font-bold mt-2 text-blue-700"></div></div>' +
      '<div class="grid grid-cols-2 gap-4">' +
        '<div><label class="lb" for="asDue">Due date</label><input id="asDue" type="date" class="in" required value="' + addDaysYmd(7) + '"></div>' +
        '<div><label class="lb" for="asPri">Priority</label><select id="asPri" class="in">' +
          priorityNames().map(function (p, i) {
            return '<option' + (i === Math.min(1, priorityNames().length - 1) ? ' selected' : '') +
              '>' + esc(p) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="grid grid-cols-2 gap-4">' +
        '<div><label class="lb" for="asCat">Job category</label>' + catPickerHtml('asCat', '') + '</div>' +
        '<div><label class="lb" for="asFreq">Repeats</label><select id="asFreq" class="in">' +
          ['One Time','Daily','Weekdays','Weekly','Fortnightly','Monthly','Quarterly','Half-Yearly','Yearly']
            .map(function (f) { return '<option>' + f + '</option>'; }).join('') + '</select></div></div>' +
      /* A repeat with no end is a standing instruction nobody owns. Asked at
         the moment the cadence is chosen, because that is the only moment the
         person is actually thinking about how long this should go on. */
      '<div id="asStopWrap" class="hidden rounded-xl bg-gray-50 border border-gray-100 p-4">' +
        '<label class="lb">Stop repeating</label>' +
        '<div class="flex flex-wrap gap-2 mb-3" id="asStopMode">' +
          [['never','Never'],['date','On a date'],['count','After a number of times']]
            .map(function (m, i) {
              return '<button type="button" data-mode="' + m[0] + '" class="btn ' +
                (i === 0 ? 'btn-p' : 'btn-g') + ' text-xs py-2 stopMode">' + m[1] + '</button>';
            }).join('') + '</div>' +
        '<div id="asStopDate" class="hidden"><input id="asUntil" type="date" class="in"></div>' +
        '<div id="asStopCount" class="hidden"><input id="asTimes" type="number" min="2" max="500" ' +
          'class="in" placeholder="e.g. 12"></div>' +
        '<div class="text-[11px] font-semibold text-gray-400 mt-2" id="asStopNote">' +
          'It will keep repeating until somebody stops it.</div>' +

      '</div>' +
      '<div class="grid grid-cols-2 gap-4">' +
        '<div><label class="lb" for="asKra">KRA tag</label><input id="asKra" class="in" placeholder="e.g. Vendor Quality"></div>' +
        /* Which goal this serves. Optional — most daily work serves no goal in
           particular, and pretending otherwise inflates every goal's count. */
        '<div><label class="lb" for="asGoal">Serves goal</label><select id="asGoal" class="in">' + goalOptions('', 'None') + '</select></div></div>' +
      '<div><label class="lb">Checklist <span class="normal-case tracking-normal font-semibold">(one per line, optional)</span></label>' +
        '<textarea id="asChk" rows="2" class="in" placeholder="Collect quotes&#10;Compare rates"></textarea></div>' +
    '</div>' +
    (left !== null ? '<div class="text-[11px] font-bold mt-3 ' + (left <= 5 ? 'text-amber-700' : 'text-gray-400') + '">' +
      left + ' of ' + u.maxTasks + ' tasks left this month' + (canBill() && u.planName ? ' on ' + esc(u.planName) : '') + '.</div>' : '') +
    '<div class="flex gap-3 mt-6">' +
    '<button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
    '<button type="submit" class="btn btn-p flex-1">Assign</button></div></form>');

  var routeNote = function () {
    var picked = Array.prototype.slice.call(document.querySelectorAll('.asWho:checked'));
    $('asWhoCount').textContent = picked.length ? picked.length + ' selected' : '';
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
  /* Ticked people stay ticked while the search hides them. Enter ticks the
     first match instead of submitting a half-filled form. */
  var filterWho = function () {
    var q = $('asWhoQ').value.trim().toLowerCase(), shown = 0;
    document.querySelectorAll('.asWhoRow').forEach(function (r) {
      var hit = !q || q.split(/\s+/).every(function (w) { return r.dataset.q.indexOf(w) > -1; });
      r.classList.toggle('hidden', !hit); if (hit) shown++;
    });
    $('asWhoNone').classList.toggle('hidden', shown > 0);
  };
  $('asWhoQ').addEventListener('input', filterWho);
  /* A–Z to start; one click turns it Z–A. Rows move, ticks stay with them. */
  var whoDir = 1;
  $('asWhoSort').addEventListener('click', function () {
    whoDir = -whoDir;
    var list = $('asWhoList'), none = $('asWhoNone');
    Array.prototype.slice.call(list.querySelectorAll('.asWhoRow')).sort(function (a, b) {
      return whoDir * a.querySelector('span').textContent.localeCompare(b.querySelector('span').textContent, 'en', { sensitivity: 'base' });
    }).forEach(function (r) { list.insertBefore(r, none); });
    this.textContent = whoDir > 0 ? 'A–Z ↓' : 'Z–A ↑';
  });
  $('asWhoQ').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var first = document.querySelector('.asWhoRow:not(.hidden) .asWho:not(:checked)');
    if (first) { first.checked = true; routeNote(); $('asWhoQ').value = ''; filterWho(); }
  });
  bindCatPicker('asCat');

  /* One mode at a time, and the note says in words what was chosen — a date
     field and a count field both filled in is a rule nobody can predict. */
  var stopMode = 'never';
  var paintStop = function () {
    var on = $('asFreq').value !== 'One Time';
    $('asStopWrap').classList.toggle('hidden', !on);
    if (!on) { stopMode = 'never'; }
    $('asStopDate').classList.toggle('hidden', stopMode !== 'date');
    $('asStopCount').classList.toggle('hidden', stopMode !== 'count');
    document.querySelectorAll('.stopMode').forEach(function (b) {
      b.className = 'btn ' + (b.dataset.mode === stopMode ? 'btn-p' : 'btn-g') + ' text-xs py-2 stopMode';
    });
    $('asStopNote').textContent =
      stopMode === 'date'  ? ($('asUntil').value ? 'Last occurrence on or before ' + $('asUntil').value + '.'
                                                 : 'Pick the date it should stop after.')
    : stopMode === 'count' ? ($('asTimes').value ? 'It will run ' + $('asTimes').value + ' times, then stop.'
                                                 : 'How many times should it run in total?')
    : 'It will keep repeating until somebody stops it.';
  };
  $('asFreq').addEventListener('change', paintStop);
  document.querySelectorAll('.stopMode').forEach(function (b) {
    b.addEventListener('click', function () { stopMode = b.dataset.mode; paintStop(); }); });
  $('asUntil').addEventListener('change', paintStop);
  $('asTimes').addEventListener('input', paintStop);

  $('fAssign').addEventListener('submit', function (e) {
    e.preventDefault();
    var who = Array.prototype.slice.call(document.querySelectorAll('.asWho:checked'))
      .map(function (c) { return c.value; });
    if (!who.length) { toast('Pick at least one person.', 'warn'); return; }
    var cat = readCatPicker('asCat');
    if (cat === null) return;
    var btn = e.target.querySelector('button[type=submit]');
    busy(btn, true, 'Assigning…');
    api('createTask', { form: { title: $('asTitle').value, desc: $('asDesc').value,
      assignTo: who.join(','), dueDate: $('asDue').value, priority: $('asPri').value,
      jobCategory: cat, frequency: $('asFreq').value, kra: $('asKra').value,
      goal: $('asGoal') ? $('asGoal').value : '',
      repeatUntil: stopMode === 'date' ? $('asUntil').value : '',
      repeatCount: stopMode === 'count' ? Number($('asTimes').value || 0) : 0,
      checklist: $('asChk').value } })
      .then(function (r) { toast(r.message, 'ok'); closeModal(); return refresh(); })
      .catch(function (err) { busy(btn, false); toast(err.message, 'err'); });
  });
}
