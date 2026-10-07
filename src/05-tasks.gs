// ===========================================================================
// TASKS
// ===========================================================================

/* Serialised: this reads, decides, then writes. Without the lock two
   simultaneous calls both pass the check — a workspace slipping past its monthly task cap. */
function createTask_(ctx, form) {
  return withLock_(function () { return createTask_locked_(ctx,form); });
}
function createTask_locked_(ctx, form) {
  /* Deliberately NOT requireManager_: a Doer may raise work upward, to their own
     manager or to a department head. canAssignTo decides per recipient. */
  blockIfStopped_(ctx);
  form = form || {};

  var title = String(form.title || '').trim();
  if (!title) throw new Error('Give the task a title.');
  var assignees = String(form.assignTo || '').split(',')
    .map(function (s) { return s.trim(); }).filter(function (s) { return s; });
  if (!assignees.length) throw new Error('Pick at least one person.');

  var users = readUsers_(ctx);
  var byName = {};
  users.forEach(function (u) { byName[u.username] = u; });

  /* The published plan promises a monthly cap. Enforced here, on the server,
     because a limit checked in the browser is a suggestion. */
  var tasks = readTasks_(ctx);
  var used = tasksCreatedInMonth(tasks, new Date());
  var gate = canCreateTask(ctx.planName, used + assignees.length - 1);
  if (!gate.ok) throw new Error(gate.reason + (gate.upgradeTo ? ' Upgrade to ' + gate.upgradeTo + '.' : ''));

  var sheet = ctx.ss.getSheetByName(TAB.TASKS);
  var created = [], routed = 0;

  var refused = [];
  assignees.forEach(function (username) {
    var target = byName[username];
    if (!target || target.active === false) return;

    var allowed = canAssignTo(ctx.me, target);
    if (!allowed.ok) { refused.push({ name: target.name, reason: allowed.reason }); return; }

    // The engine decides who, if anyone, has to agree before this lands.
    var route = initialStatusFor(target, ctx.me);
    var id = newTaskId_();
    var row = blankTaskRow_();
    row[T['ID']] = id;
    row[T['Date Created']] = new Date();
    row[T['Due Date']] = form.dueDate || '';
    row[T['Title']] = title;
    row[T['Description']] = String(form.desc || '');
    row[T['Assigned By']] = ctx.actor.username;
    row[T['Assigned To']] = username;
    row[T['Status']] = route.status;
    row[T['KRA Tag']] = String(form.kra || 'General');
    row[T['Priority']] = form.priority || 'Medium';
    row[T['Frequency']] = form.frequency || 'One Time';
    row[T['Reworks']] = 0;
    row[T['History JSON']] = JSON.stringify([{ date: new Date().toISOString(),
      status: route.status, user: ctx.actor.name, note: route.note }]);
    row[T['Job Category']] = String(form.jobCategory || 'General');
    row[T['Approver Manager']] = route.status === 'Awaiting Approval' ? route.approver : '';
    row[T['Status']] = route.status;
    row[T['Spawned By']] = '';
    row[T['Blocked By']] = JSON.stringify([]);
    row[T['Subtasks JSON']] = JSON.stringify(parseChecklist_(form.checklist));
    row[T['Delegate To']] = '';
    sheet.appendRow(row);
    dropCache_(ctx);
    created.push({ id: id, to: username });
    if (route.status === 'Awaiting Approval') routed++;

    try { notifyAssignment_(ctx, target, byName[route.approver], title, form.dueDate, id, route.status); }
    catch (e) { logError_('createTask:notify', e.message); }
  });

  if (!created.length) {
    throw new Error(refused.length ? refused[0].reason
      : 'None of those people are active in this workspace.');
  }
  return { status: 'success', created: created.length, routedForApproval: routed,
    refused: refused,
    message: created.length + ' task(s) created' +
      (routed ? ', ' + routed + ' sent for approval' : '') + '.' +
      (refused.length ? ' Not sent to ' +
        refused.map(function (r) { return r.name; }).join(', ') + '.' : '') };
}

function parseChecklist_(raw) {
  if (Array.isArray(raw)) return raw.map(function (x) {
    return typeof x === 'string' ? { text: x, done: false } : { text: String(x.text||''), done: !!x.done }; });
  return String(raw || '').split('\n').map(function (s) { return s.trim(); })
    .filter(function (s) { return s; }).map(function (s) { return { text: s, done: false }; });
}

/**
 * The single write path for a status change. Board, list and detail all route
 * through here so the rework counter, the recurrence spawn and the audit trail
 * cannot be skipped by taking a different path through the UI.
 */
function updateTask_(ctx, taskId, status, note, newDueDate) {
  blockIfStopped_(ctx);
  var hit = findTaskRow_(ctx, taskId);
  if (!hit) throw new Error('That task no longer exists.');
  var t = hit.task;

  if (!canTransition(t, ctx.actor, status)) {
    if (status === 'Verified' && t.assignee === ctx.actor.username) {
      throw new Error('You cannot sign off your own work — it needs the person who raised it.');
    }
    throw new Error('Your role does not allow that move on this task.');
  }

  var all = readTasks_(ctx);

  if (status === 'In Progress' && t.status === 'Pending') {
    var blockers = openBlockers(t, all);
    if (blockers.length) {
      throw new Error('Blocked by: ' + blockers.map(function (b) { return b.title; }).join(', '));
    }
    var limit = wipLimitFor_(ctx, t.assignee);
    var wip = wipStatus(all, t.assignee, limit);
    if (wip.exceeded) {
      throw new Error(nameOf_(ctx, t.assignee) + ' already has ' + wip.count +
        ' tasks in progress (limit ' + wip.limit + ').');
    }
  }
  if (status === 'For Review') {
    var sub = subtaskProgress(t);
    if (sub.total && sub.done < sub.total) {
      throw new Error('Finish the checklist first (' + sub.done + '/' + sub.total + ').');
    }
  }

  /* Rework is specifically review sending work BACK. The old build incremented
     this on any move to In Progress, so simply starting a task cost five points
     on the score. Only the For Review -> In Progress path counts. */
  var isRework = (t.status === 'For Review' && status === 'In Progress');
  if (isRework) writeTaskField_(hit, 'Reworks', Number(t.reworkCount || 0) + 1);

  // An approved hand-off is where the new owner actually takes the task.
  if (t.status === 'Delegation Proposed' && t.delegateTo && status !== 'Delegation Proposed') {
    writeTaskField_(hit, 'Assigned To', t.delegateTo);
    writeTaskField_(hit, 'Delegate To', '');
  }

  if (isRework && newDueDate) writeTaskField_(hit, 'Due Date', newDueDate);

  writeTaskField_(hit, 'Status', status);
  appendHistory_(hit, status, ctx.actor.name, note || (isRework ? 'Returned for rework' : ''),
    isRework && newDueDate ? { setDate: newDueDate } : null);

  var spawned = null;
  if (status === 'Verified' && t.frequency && t.frequency !== 'One Time') {
    spawned = spawnNextOccurrence_(ctx, hit, t);
  }

  /* Signing off a stage closes it, and a closed blocker stops blocking, so the
     next stage releases itself. All that is left is to tell whoever it landed
     on — silently unblocking work nobody is watching is how a project stalls
     for a week between two people who were each waiting on the other. */
  var released = null;
  if (status === 'Verified' && t.projectId && t.stageGate !== 'parallel') {
    var siblings = projectStages(readTasks_(ctx), t.projectId);
    for (var si = 0; si < siblings.length; si++) {
      if (Number(siblings[si].stageNo) === Number(t.stageNo) + 1 && isOpen(siblings[si].status)) {
        released = siblings[si];
        try { notifyStageReleased_(ctx, t.projectName, released); }
        catch (e) { logError_('updateTask:stageRelease', e.message); }
        break;
      }
    }
  }

  try { notifyStatus_(ctx, t, status, note); } catch (e) { logError_('updateTask:notify', e.message); }

  return { status: 'success',
    message: released
             ? 'Verified. Stage ' + released.stageNo + ' is now open for ' +
               nameOf_(ctx, released.assignee) + '.'
           : spawned ? 'Verified. Next occurrence due ' + spawned
           : isRework ? 'Sent back for rework.' : 'Moved to ' + status + '.',
    spawnedDue: spawned,
    releasedStage: released ? { id: released.id, stage: Number(released.stageNo),
                                title: released.title, to: released.assignee } : null };
}

function spawnNextOccurrence_(ctx, hit, t) {
  var next = nextOccurrence(t.frequency, t.due, {});
  if (!next) return null;
  var due = ymd(next);

  // Never create a second copy for a date that already has an open occurrence.
  var existing = readTasks_(ctx);
  for (var i = 0; i < existing.length; i++) {
    var x = existing[i];
    if (x.title === t.title && x.assignee === t.assignee && x.due === due && isOpen(x.status)) return null;
  }

  var row = blankTaskRow_();
  row[T['ID']] = newTaskId_();
  row[T['Date Created']] = new Date();
  row[T['Due Date']] = due;
  row[T['Title']] = t.title;
  row[T['Description']] = t.desc;
  row[T['Assigned By']] = t.by;
  row[T['Assigned To']] = t.assignee;
  row[T['Status']] = 'Pending';
  row[T['KRA Tag']] = t.kra;
  row[T['Priority']] = t.priority;
  row[T['Frequency']] = t.frequency;
  row[T['Reworks']] = 0;
  row[T['History JSON']] = JSON.stringify([{ date: new Date().toISOString(), status: 'Pending',
    user: 'System', note: 'Recurring occurrence of ' + t.id }]);
  row[T['Job Category']] = t.jobCategory;
  /* Marked system-generated so it does not spend the tenant's monthly task
     quota — nobody chose to create it, and a Free customer with five daily
     recurring jobs would otherwise burn all 50 in ten days. */
  row[T['Spawned By']] = t.id;
  row[T['Blocked By']] = JSON.stringify([]);
  row[T['Subtasks JSON']] = JSON.stringify((t.subtasks || []).map(function (s) {
    return { text: s.text, done: false }; }));
  row[T['Delegate To']] = '';
  ctx.ss.getSheetByName(TAB.TASKS).appendRow(row);
  dropCache_(ctx);
  return due;
}

function processApproval_(ctx, taskId, isApproved, remarks) {
  blockIfStopped_(ctx);
  var hit = findTaskRow_(ctx, taskId);
  if (!hit) throw new Error('That task no longer exists.');
  var t = hit.task;

  if (t.status !== 'Awaiting Approval' && t.status !== 'Delegation Proposed') {
    throw new Error('That task is not waiting for approval.');
  }
  if (t.approver !== ctx.actor.username && ctx.actor.role !== 'Admin') {
    throw new Error('Only ' + nameOf_(ctx, t.approver) + ' can decide this one.');
  }

  /* A rejection without a reason is the thing people complain about: the task
     vanishes and whoever raised it has to go and ask why. The remark is the
     answer, recorded against the task. */
  remarks = String(remarks || '').trim();
  if (!isApproved && !remarks) {
    throw new Error('Add a remark saying why you are rejecting it. ' +
      'The person who raised it will see this.');
  }

  var next = isApproved ? 'Pending' : 'Rejected';
  if (t.status === 'Delegation Proposed' && isApproved && t.delegateTo) {
    writeTaskField_(hit, 'Assigned To', t.delegateTo);
    writeTaskField_(hit, 'Delegate To', '');
  }
  writeTaskField_(hit, 'Status', next);
  writeTaskField_(hit, 'Approver Manager', '');
  appendHistory_(hit, next, ctx.actor.name,
    (isApproved ? 'Approved' : 'Rejected') + (remarks ? ': ' + remarks : ''));

  try { notifyDecision_(ctx, t, isApproved, remarks); }
  catch (e) { logError_('processApproval:notify', e.message); }

  return { status: 'success', remarks: remarks,
    message: isApproved ? 'Approved — it is on their list now.'
                        : 'Rejected, and ' + nameOf_(ctx, t.by) + ' has been told why.' };
}

function delegateTask_(ctx, taskId, toUsername) {
  blockIfStopped_(ctx);
  var hit = findTaskRow_(ctx, taskId);
  if (!hit) throw new Error('That task no longer exists.');
  var target = findUser_(ctx.ss, toUsername);
  if (!target) throw new Error('That person is not in this workspace.');

  var r = proposeDelegation(hit.task, ctx.actor, target, ctx.me);
  if (!r.ok) throw new Error(r.error);

  writeTaskField_(hit, 'Status', r.status);
  writeTaskField_(hit, 'Assigned To', r.assignee);
  writeTaskField_(hit, 'Approver Manager', r.status === 'Delegation Proposed' ? r.approver : '');
  writeTaskField_(hit, 'Delegate To', r.delegateTo || '');
  appendHistory_(hit, r.status, ctx.actor.name, r.note);

  return { status: 'success', message: r.note };
}

function addBlocker_(ctx, taskId, blockerId) {
  blockIfStopped_(ctx);
  var all = readTasks_(ctx);
  var r = addDependency(taskId, blockerId, all);
  if (!r.ok) throw new Error(r.error);          // refuses circular chains
  var hit = findTaskRow_(ctx, taskId);
  writeTaskField_(hit, 'Blocked By', JSON.stringify(r.blockedBy));
  return { status: 'success', message: 'Blocker added.' };
}

function toggleSubtask_(ctx, taskId, index, done) {
  blockIfStopped_(ctx);
  var hit = findTaskRow_(ctx, taskId);
  if (!hit) throw new Error('That task no longer exists.');
  var t = hit.task;
  if (t.assignee !== ctx.actor.username && ctx.actor.role === 'Doer') {
    throw new Error('Only the owner can tick off their checklist.');
  }
  var subs = t.subtasks || [];
  if (index < 0 || index >= subs.length) throw new Error('No such checklist item.');
  subs[index].done = !!done;
  writeTaskField_(hit, 'Subtasks JSON', JSON.stringify(subs));
  return { status: 'success', progress: subtaskProgress({ subtasks: subs }) };
}

function stopRecurring_(ctx, taskId) {
  requireManager_(ctx); blockIfStopped_(ctx);
  var hit = findTaskRow_(ctx, taskId);
  if (!hit) throw new Error('That task no longer exists.');
  writeTaskField_(hit, 'Frequency', 'One Time');
  appendHistory_(hit, hit.task.status, ctx.actor.name, 'Recurrence stopped');
  return { status: 'success', message: 'This will not repeat again.' };
}

function editTask_(ctx, form) {
  blockIfStopped_(ctx);
  form = form || {};
  var hit = findTaskRow_(ctx, form.taskId);
  if (!hit) throw new Error('That task no longer exists.');
  var t = hit.task;

  var mayEdit = ctx.actor.role === 'Admin' || t.by === ctx.actor.username;
  if (!mayEdit) throw new Error('Only an Admin or the person who raised it can edit this task.');

  var changes = [];
  [['title','Title'],['desc','Description'],['dueDate','Due Date'],
   ['priority','Priority'],['kra','KRA Tag'],['jobCategory','Job Category']].forEach(function (pair) {
    if (form[pair[0]] !== undefined && String(form[pair[0]]) !== String(hit.raw[T[pair[1]]])) {
      writeTaskField_(hit, pair[1], form[pair[0]]);
      changes.push(pair[1]);
    }
  });
  if (form.status && form.status !== t.status && ctx.actor.role === 'Admin') {
    writeTaskField_(hit, 'Status', form.status);
    changes.push('Status');
  }
  if (changes.length) appendHistory_(hit, form.status || t.status, ctx.actor.name,
    'Edited: ' + changes.join(', '));
  return { status: 'success', message: changes.length ? 'Saved.' : 'Nothing changed.' };
}

function wipLimitFor_(ctx, username) {
  var u = findUser_(ctx.ss, username);
  return (u && u.wipLimit != null && !isNaN(u.wipLimit)) ? u.wipLimit : DEFAULT_WIP_LIMIT;
}
function nameOf_(ctx, username) {
  var u = findUser_(ctx.ss, username);
  return u ? u.name : (username || 'someone');
}

/**
 * The priority list: what this person should do next, in order, with the
 * reason each item is where it is.
 *
 * A manager may ask for somebody else's list — that is most of the value of it
 * for them — but a Doer only ever gets their own.
 */
function getPriorityList_(ctx, username, horizon) {
  var who = String(username || '').trim() || ctx.me.username;
  if (ctx.me.role === ROLE.DOER && who !== ctx.me.username) {
    throw new Error('You can only see your own list.');
  }
  var target = findUser_(ctx.ss, who);
  if (!target) throw new Error('That person is not in this workspace.');

  var want = String(horizon || 'week');
  var known = HORIZONS.some(function (h) { return h.key === want; });
  var q = priorityQueue(readTasks_(ctx), who, new Date(), leaveCalendar_(ctx),
                        { horizon: known ? want : 'week' });
  return { status: 'success', employee: { username: target.username, name: target.name },
    priorities: readPriorities_(ctx), horizons: HORIZONS,
    horizon: q.horizon, horizonEnd: q.horizonEnd, counts: q.counts,
    doNow: q.doNow, next: q.next, later: q.later, waiting: q.waiting,
    decisions: q.decisions, handedIn: q.handedIn,
    total: q.total, overdue: q.overdue, undated: q.undated };
}
