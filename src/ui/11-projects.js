/* ---------- projects ------------------------------------------------------
   A project is a run of stages, each with its own owner and its own deadline.
   The list is built so the first thing you see is which stage is live and who
   is on the hook — the question anyone opening this screen is actually asking.
   -------------------------------------------------------------------------- */
var PROJECTS = [];

function loadProjects() {
  $('projectList').innerHTML = '<p class="text-sm text-gray-400 font-semibold">Loading…</p>';
  api('getProjects').then(function (r) { PROJECTS = r.projects || []; renderProjects(); })
    .catch(function (e) { $('projectList').innerHTML =
      '<p class="text-sm font-bold text-red-700">' + esc(e.message) + '</p>'; });
}

function renderProjects() {
  if (!PROJECTS.length) {
    $('projectList').innerHTML = '<div class="bg-white rounded-3xl border border-gray-100 p-10 text-center">' +
      '<p class="font-black text-gray-700">No projects yet.</p>' +
      '<p class="text-sm text-gray-400 font-semibold mt-1">Use one when a job passes through ' +
      'several hands — design, then build, then sign-off — and each hand has a date to hit.</p></div>';
    return;
  }
  $('projectList').innerHTML = PROJECTS.map(projectCard).join('');
  $('projectList').querySelectorAll('[data-task]').forEach(function (el) {
    el.addEventListener('click', function () { openTask(el.dataset.task); });
  });
}

function projectCard(p) {
  var tone = p.complete ? 'bg-emerald-500' : p.stalled ? 'bg-red-500' : 'bg-blue-600';
  return '<div class="bg-white rounded-3xl border border-gray-100 p-5 mb-4">' +
    '<div class="flex flex-wrap items-start gap-3 mb-3">' +
      '<div class="min-w-0"><div class="font-black text-lg leading-tight">' + esc(p.name) + '</div>' +
        '<div class="text-xs font-semibold text-gray-400 mt-0.5">' +
          esc(p.done + ' of ' + p.stages + ' stages signed off') +
          (p.metOnTime ? esc(' · ' + p.metOnTime + ' deadline' + (p.metOnTime === 1 ? '' : 's') + ' met') : '') +
          (p.gate === 'parallel' ? ' · all stages run at once' : '') +
        '</div></div>' +
      '<span class="flex-1"></span>' +
      (p.complete ? '<span class="chip bg-emerald-50 text-emerald-700">Complete</span>'
        : p.currentStage ? '<span class="chip bg-blue-50 text-blue-700">Stage ' + p.currentStage +
            ' with ' + esc(p.currentOwnerName) + '</span>'
        : '<span class="chip bg-gray-100 text-gray-600">Nothing open</span>') +
    '</div>' +
    '<div class="h-2 rounded-full bg-gray-100 overflow-hidden mb-4">' +
      '<div class="h-full ' + tone + '" style="width:' + p.percent + '%"></div></div>' +
    '<div class="overflow-x-auto"><table class="tbl"><thead><tr>' +
      '<th>Stage</th><th>Owner</th><th>Deadline</th><th>Status</th><th>Outcome</th>' +
      '</tr></thead><tbody>' +
    p.stageList.map(function (s) {
      var statusTone = s.blocked ? 't-slate' : stateTone(s.status).chip;
      var outcome = s.metOnTime === true
          ? '<span class="chip t-teal">Met · scored</span>'
        : s.metOnTime === false
          ? '<span class="chip t-coral">' + s.daysLate + 'd late</span>'
        : s.blocked ? '<span class="text-gray-400 font-semibold">Waiting on the stage before it</span>'
        : '<span class="text-gray-400 font-semibold">Open</span>';
      return '<tr class="cursor-pointer" data-task="' + esc(s.id) + '">' +
        '<td class="font-bold text-gray-800 whitespace-nowrap">' + s.no + '. ' + esc(s.title) + '</td>' +
        '<td class="whitespace-nowrap"><span class="flex items-center gap-2">' +
          avatar(s.ownerName, 22) + esc(s.ownerName) + '</span></td>' +
        '<td class="whitespace-nowrap">' + fmtDate(s.due) +
          /* When the stage before it ran over, the owner is answerable for a
             later date than the plan first said. Showing the original with the
             revised one beside it is the only honest way to present that. */
          (s.extended ? '<span class="block text-[11px] font-bold text-amber-700">' +
            'moved to ' + fmtDate(s.effectiveDue) + ' — the stage before it ran over</span>' : '') +
        '</td>' +
        '<td class="whitespace-nowrap"><span class="chip ' + statusTone + '">' +
          esc(s.blocked && s.status === 'Pending' ? 'Blocked' : s.status) + '</span></td>' +
        '<td class="whitespace-nowrap">' + outcome + '</td></tr>';
    }).join('') + '</tbody></table></div></div>';
}

/* ---------- the builder --------------------------------------------------- */
function openProjectBuilder() {
  var staff = (STATE.data.staff || []).filter(function (u) { return u.active !== false; });
  var cats = STATE.data.categories || [];
  var stages = [blankStage(), blankStage()];

  openModal('<form id="fProj" class="p-6 lg:p-7">' +
    '<h2 class="text-2xl font-black mb-1">New project</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">Each stage is a task with its own owner ' +
      'and its own deadline. Meeting a stage deadline earns that person score.</p>' +
    '<div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">' +
      '<div class="lg:col-span-2"><label class="lb" for="pName">Project name</label>' +
        '<input id="pName" class="in" required placeholder="e.g. Fixture line upgrade"></div>' +
      '<div><label class="lb" for="pCat">Category</label><select id="pCat" class="in">' +
        cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></div>' +
    '</div>' +
    '<div class="mb-5"><span class="lb">How the stages run</span>' +
      '<div class="grid grid-cols-1 lg:grid-cols-2 gap-3">' +
        gateOption('sequential', 'One after another', 'A stage opens only when the one before it is ' +
          'signed off. Nobody can start out of order.', true) +
        gateOption('parallel', 'All at once', 'Every stage is live from day one. Use it when the ' +
          'stages do not depend on each other.', false) +
      '</div></div>' +
    '<div class="flex justify-between items-center mb-2">' +
      '<span class="lb mb-0">Stages</span>' +
      '<button type="button" id="pAdd" class="text-blue-600 font-black text-xs">+ Add stage</button></div>' +
    '<div id="pStages" class="space-y-3"></div>' +
    '<div id="pMsg" class="text-xs font-bold mt-3"></div>' +
    '<div class="flex gap-3 mt-6">' +
      '<button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
      '<button type="submit" class="btn btn-p flex-1">Create project</button></div></form>', 'max-w-3xl');

  function blankStage() { return { title:'', assignTo:'', dueDate:'', priority:'Medium' }; }

  function gate() {
    var on = document.querySelector('input[name="pGate"]:checked');
    return on ? on.value : 'sequential';
  }

  function draw() {
    $('pStages').innerHTML = stages.map(function (s, i) {
      return '<div class="rounded-2xl border border-gray-100 bg-gray-50/60 p-3">' +
        '<div class="flex items-center gap-2 mb-2">' +
          '<span class="h-6 w-6 rounded-full bg-blue-600 text-white text-xs font-black ' +
            'flex items-center justify-center shrink-0">' + (i + 1) + '</span>' +
          '<input class="in pT flex-1" data-i="' + i + '" placeholder="What happens at this stage" ' +
            'value="' + esc(s.title) + '">' +
          (stages.length > 2 ? '<button type="button" class="pD px-2 text-gray-400 hover:text-red-600" ' +
            'data-i="' + i + '"><span class="material-icons text-base">delete</span></button>' : '') +
        '</div>' +
        '<div class="grid grid-cols-1 lg:grid-cols-3 gap-2">' +
          '<select class="in pW" data-i="' + i + '"><option value="">Who does it</option>' +
            staff.map(function (u) {
              return '<option value="' + esc(u.username) + '"' + (u.username === s.assignTo ? ' selected' : '') +
                '>' + esc(u.name) + '</option>'; }).join('') + '</select>' +
          '<input type="date" class="in pDue" data-i="' + i + '" value="' + esc(s.dueDate) + '" ' +
            'aria-label="Stage ' + (i + 1) + ' deadline">' +
          '<select class="in pP" data-i="' + i + '">' + ['High','Medium','Low'].map(function (x) {
            return '<option' + (x === s.priority ? ' selected' : '') + '>' + x + '</option>'; }).join('') +
          '</select></div></div>';
    }).join('');
    check();
    var bind = function (cls, fn) {
      $('pStages').querySelectorAll(cls).forEach(function (el) {
        el.addEventListener('input', function () { fn(stages[+el.dataset.i], el.value); check(); });
        el.addEventListener('change', function () { fn(stages[+el.dataset.i], el.value); check(); });
      });
    };
    bind('.pT', function (s, v) { s.title = v; });
    bind('.pW', function (s, v) { s.assignTo = v; });
    bind('.pDue', function (s, v) { s.dueDate = v; });
    bind('.pP', function (s, v) { s.priority = v; });
    $('pStages').querySelectorAll('.pD').forEach(function (el) {
      el.addEventListener('click', function () { stages.splice(+el.dataset.i, 1); draw(); }); });
  }

  /* Checked here as well as on the server, because being told what is wrong
     while you are still typing is worth more than being told after you submit.
     The server checks it again regardless; this is a courtesy, not the rule. */
  function check() {
    var m = $('pMsg'), problems = [];
    stages.forEach(function (s, i) {
      if (!s.title.trim()) problems.push('Stage ' + (i + 1) + ' has no title.');
      else if (!s.assignTo) problems.push('Stage ' + (i + 1) + ' has nobody on it.');
      else if (!s.dueDate) problems.push('Stage ' + (i + 1) + ' has no deadline.');
    });
    if (!problems.length && gate() === 'sequential') {
      for (var i = 1; i < stages.length; i++) {
        if (stages[i].dueDate < stages[i - 1].dueDate) {
          problems.push('Stage ' + (i + 1) + ' is due before stage ' + i +
            '. Each stage has to finish after the one it waits on.');
          break;
        }
      }
    }
    m.textContent = problems.length ? problems[0]
      : stages.length + ' stages, finishing ' + fmtDate(stages[stages.length - 1].dueDate) + '.';
    m.className = 'text-xs font-bold mt-3 ' + (problems.length ? 'text-amber-700' : 'text-emerald-700');
    return !problems.length;
  }

  draw();
  $('pAdd').addEventListener('click', function () { stages.push(blankStage()); draw(); });
  document.querySelectorAll('input[name="pGate"]').forEach(function (r) {
    r.addEventListener('change', check); });

  $('fProj').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!check()) { toast($('pMsg').textContent, 'err'); return; }
    var btn = e.target.querySelector('button[type=submit]');
    busy(btn, true, 'Creating…');
    api('createProject', { form: { name: $('pName').value, jobCategory: $('pCat').value,
      gate: gate(), stages: stages } })
      .then(function (r) {
        toast(r.message, 'ok'); closeModal();
        STATE.tab = 'projects'; renderTab();
        return refresh();
      })
      .catch(function (err) { busy(btn, false); toast(err.message, 'err'); });
  });
}

function gateOption(value, title, blurb, checked) {
  return '<label class="flex gap-2 items-start rounded-2xl border border-gray-100 p-3 cursor-pointer">' +
    '<input type="radio" name="pGate" value="' + value + '" class="mt-1 accent-blue-600"' +
      (checked ? ' checked' : '') + '>' +
    '<span><span class="block font-black text-sm">' + title + '</span>' +
    '<span class="block text-xs font-semibold text-gray-400">' + blurb + '</span></span></label>';
}
