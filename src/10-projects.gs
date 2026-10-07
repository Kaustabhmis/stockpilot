// ===========================================================================
// PROJECTS — multi-stage work
// ===========================================================================
//
// A project is a run of stages that share a Project ID. Every stage is an
// ordinary task: same board, same approval route, same review, its own owner
// and its own deadline. Nothing about a stage is a special case, which is why
// delegation, rework, blockers and reminders all work on it unchanged.
//
// On a sequential project each stage is blocked by the one before it, using
// the blocker mechanism that already existed. Signing off a stage closes it,
// and a closed blocker stops blocking — so the next stage releases itself with
// no extra bookkeeping to go wrong.
// ===========================================================================

/* Serialised: this reads, decides, then writes. Without the lock two
   simultaneous calls both pass the check — a project whose stages straddle the task cap. */
function createProject_(ctx, form) {
  return withLock_(function () { return createProject_locked_(ctx,form); });
}
function createProject_locked_(ctx, form) {
  requireManager_(ctx); blockIfStopped_(ctx);
  form = form || {};

  var name = String(form.name || '').trim();
  if (!name) throw new Error('Give the project a name.');

  var gate = String(form.gate || 'sequential').toLowerCase() === 'parallel' ? 'parallel' : 'sequential';
  var stages = (form.stages || []).map(function (s, i) {
    return {
      no: i + 1,
      title: String((s && s.title) || '').trim(),
      desc: String((s && s.desc) || ''),
      assignTo: String((s && s.assignTo) || '').trim(),
      due: String((s && s.dueDate) || '').trim(),
      priority: (s && s.priority) || 'Medium',
      checklist: (s && s.checklist) || '',
    };
  }).filter(function (s) { return s.title || s.assignTo || s.due; });

  if (stages.length < 2) {
    throw new Error('A project needs at least two stages. One stage on its own is just a task.');
  }

  var users = readUsers_(ctx), byName = {};
  users.forEach(function (u) { byName[u.username] = u; });

  stages.forEach(function (s) {
    if (!s.title) throw new Error('Stage ' + s.no + ' has no title.');
    if (!s.assignTo) throw new Error('Stage ' + s.no + ' (' + s.title + ') has nobody on it.');
    if (!s.due) throw new Error('Stage ' + s.no + ' (' + s.title + ') has no deadline. ' +
      'Every stage carries its own — that is the point of running it as a project.');
    var who = byName[s.assignTo];
    if (!who || who.active === false) throw new Error('Stage ' + s.no + ' is assigned to somebody who is not active.');
    var allowed = canAssignTo(ctx.me, who);
    if (!allowed.ok) throw new Error('Stage ' + s.no + ': ' + allowed.reason);
  });

  /* On a sequential run the dates have to move forwards, or the plan is telling
     somebody to finish before the work they depend on exists. */
  if (gate === 'sequential') {
    for (var i = 1; i < stages.length; i++) {
      if (parseYmd(stages[i].due) < parseYmd(stages[i - 1].due)) {
        throw new Error('Stage ' + (i + 1) + ' is due before stage ' + i +
          '. On a sequential project each stage has to finish after the one it waits on.');
      }
    }
  }

  var all = readTasks_(ctx);
  var used = tasksCreatedInMonth(all, new Date());
  var quota = canCreateTask(ctx.planName, used + stages.length - 1);
  if (!quota.ok) {
    throw new Error(quota.reason + ' This project needs ' + stages.length + ' of them.' +
      (quota.upgradeTo ? ' Upgrade to ' + quota.upgradeTo + '.' : ''));
  }

  var projectId = 'P' + Date.now().toString(36).toUpperCase() +
                  Math.floor(Math.random() * 1000).toString(36).toUpperCase();
  var sheet = ctx.ss.getSheetByName(TAB.TASKS);
  var created = [], routed = 0, prevId = '';

  stages.forEach(function (s) {
    var target = byName[s.assignTo];
    var route = initialStatusFor(target, ctx.me);
    var id = newTaskId_();
    var row = blankTaskRow_();
    row[T['ID']] = id;
    row[T['Date Created']] = new Date();
    row[T['Due Date']] = s.due;
    row[T['Title']] = s.title;
    row[T['Description']] = s.desc;
    row[T['Assigned By']] = ctx.actor.username;
    row[T['Assigned To']] = s.assignTo;
    row[T['Status']] = route.status;
    row[T['KRA Tag']] = String(form.kra || 'General');
    row[T['Priority']] = s.priority;
    row[T['Frequency']] = 'One Time';
    row[T['Reworks']] = 0;
    row[T['History JSON']] = JSON.stringify([{ date: new Date().toISOString(),
      status: route.status, user: ctx.actor.name,
      note: 'Stage ' + s.no + ' of ' + stages.length + ' — ' + name }]);
    row[T['Job Category']] = String(form.jobCategory || 'General');
    row[T['Approver Manager']] = route.status === 'Awaiting Approval' ? route.approver : '';
    row[T['Spawned By']] = '';
    row[T['Blocked By']] = JSON.stringify(gate === 'sequential' && prevId ? [prevId] : []);
    row[T['Subtasks JSON']] = JSON.stringify(parseChecklist_(s.checklist));
    row[T['Delegate To']] = '';
    row[T['Project ID']] = projectId;
    row[T['Project']] = name;
    row[T['Stage No']] = s.no;
    row[T['Stage Count']] = stages.length;
    row[T['Stage Gate']] = gate;
    sheet.appendRow(row);
    dropCache_(ctx);

    created.push({ id: id, stage: s.no, to: s.assignTo });
    if (route.status === 'Awaiting Approval') routed++;
    prevId = id;

    /* Only the people who can actually start are told to start. Telling stage 5
       to begin on day one trains everybody to ignore the mail. */
    if (gate === 'parallel' || s.no === 1) {
      try { notifyAssignment_(ctx, target, byName[route.approver], s.title, s.due, id, route.status); }
      catch (e) { logError_('createProject:notify', e.message); }
    }
  });

  return { status: 'success', projectId: projectId, stages: created.length,
    routedForApproval: routed, gate: gate,
    message: name + ' created with ' + created.length + ' stages' +
      (routed ? ', ' + routed + ' sent for approval' : '') + '. ' +
      (gate === 'sequential'
        ? 'Stage 1 is live; each stage opens when the one before it is signed off.'
        : 'All stages are live at once.') };
}

/** Every project in the workspace, with where each one has got to. */
function getProjects_(ctx) {
  var tasks = readTasks_(ctx);
  var names = {};
  readUsers_(ctx).forEach(function (u) { names[u.username] = u.name; });

  var ids = [];
  tasks.forEach(function (t) { if (t.projectId && ids.indexOf(t.projectId) < 0) ids.push(t.projectId); });

  var mine = ctx.me.role === ROLE.DOER;
  var out = [];
  ids.forEach(function (id) {
    var stages = projectStages(tasks, id);
    if (mine && !stages.some(function (s) {
      return s.assignee === ctx.me.username || s.raisedBy === ctx.me.username; })) return;

    var sum = projectSummary(tasks, id);
    if (!sum) return;
    sum.currentOwnerName = sum.currentOwner ? (names[sum.currentOwner] || sum.currentOwner) : '';
    sum.stageList = stages.map(function (s) {
      var due = stageEffectiveDue(stages, s);
      var sub = submittedAt(s);
      return {
        id: s.id, no: Number(s.stageNo), title: s.title, status: s.status,
        owner: s.assignee, ownerName: names[s.assignee] || s.assignee,
        due: s.due, priority: s.priority,
        /* The date they are actually answerable for. It moves out when the
           stage before them overran, so nobody wears somebody else's slip. */
        effectiveDue: due ? ymd(due) : s.due,
        extended: !!(due && parseYmd(s.due) && startOfDay(due) > parseYmd(s.due)),
        metOnTime: s.status === 'Verified' && sub && due ? dayDiff(sub, due) <= 0 : null,
        daysLate: s.status === 'Verified' && sub && due ? Math.max(0, dayDiff(sub, due)) : null,
        blocked: openBlockers(s, tasks).length > 0,
      };
    });
    out.push(sum);
  });

  out.sort(function (a, b) {
    if (a.complete !== b.complete) return a.complete ? 1 : -1;
    return String(a.currentDue || a.finalDue).localeCompare(String(b.currentDue || b.finalDue));
  });
  return { status: 'success', projects: out };
}
