/* ---------------------------------------------------------------------------
   TASK WORKFLOW
   applyTransition is the single write path for a status change. Every entry
   point — a board drop, a drawer button, a list action — goes through it, so
   the rework counter, the recurrence spawn and the audit trail cannot be
   skipped by taking a different route through the UI.
   ------------------------------------------------------------------------- */
/**
 * Why a permitted transition would still be refused right now. The drawer uses
 * it to disable the button and say so, instead of offering an action that
 * applyTransition is certain to reject the moment it is clicked.
 */
function refusalFor(task, next){
  if (next === S.IN_PROGRESS && task.status === S.PENDING) {
    const blockers = DomeBox.openBlockers(task, Store.tasks);
    if (blockers.length) return 'Blocked by ' + blockers.map(b => b.title).join(', ');
    const wip = DomeBox.wipStatus(Store.tasks, task.assignee, wipLimitFor(task.assignee));
    if (wip.exceeded) return nameOf(task.assignee) + ' is at the WIP limit (' + wip.count + '/' + wip.limit + ')';
  }
  if (next === S.FOR_REVIEW) {
    const sub = DomeBox.subtaskProgress(task);
    if (sub.total && sub.done < sub.total) return 'Checklist is ' + sub.done + '/' + sub.total;
  }
  return '';
}

function applyTransition(task, next, opts){
  opts = opts || {};
  const actor = Store.actor;
  if (!DomeBox.canTransition(task, actor, next)) {
    toast('Your role does not allow that move on this task.', 'err'); return false;
  }

  // Guards the board enforces on drop must hold for button presses too.
  const refusal = refusalFor(task, next);
  if (refusal) { toast(refusal, 'err'); return false; }

  // Review sending work back is a rework loop — the quality signal in the score.
  const isRework = task.status === S.FOR_REVIEW && next === S.IN_PROGRESS;
  if (isRework) task.reworkCount = Number(task.reworkCount || 0) + 1;

  // An approved hand-off is where the new owner actually takes the task.
  if (task.status === S.DELEGATION_PROPOSED && next !== S.DELEGATION_PROPOSED && task.delegateTo) {
    task.assignee = task.delegateTo; task.delegateTo = '';
  }

  task.status = next;
  logHistory(task, next, opts.note || (isRework ? 'Returned for rework' : ''));

  let spawned = null;
  if (next === S.VERIFIED && task.cadence && task.cadence !== CAD.ONE_TIME) spawned = spawnNext(task);

  Store.commit('task', task);
  toast(spawned ? 'Verified — next occurrence due ' + fmtDate(spawned.due)
                : (isRework ? 'Sent back for rework' : 'Moved to ' + next), 'ok');
  return true;
}

/** A recurring task closing creates its next occurrence, never a duplicate of one
 *  that already exists for that date. */
function spawnNext(task){
  const nd = DomeBox.nextOccurrence(task.cadence, task.due, { intervalDays: task.intervalDays });
  if (!nd) return null;
  const due = DomeBox.ymd(nd);
  if (Store.tasks.some(t => t.title === task.title && t.assignee === task.assignee &&
      t.due === due && DomeBox.isOpen(t.status))) return null;
  const next = normTask({
    id: Store.nextId(), title: task.title, desc: task.desc, assignee: task.assignee,
    raisedBy: task.raisedBy, approver: task.approver, status: S.PENDING,
    priority: task.priority, due, kra: task.kra, cadence: task.cadence,
    intervalDays: task.intervalDays,
    subtasks: (task.subtasks || []).map(s => ({ text: s.text, done: false })),
    history: [{ status: S.PENDING, date: new Date().toISOString(), by: 'system',
                note: 'Recurring occurrence of ' + task.id }],
  });
  Store.tasks.push(next);
  return next;
}

function wipLimitFor(username){
  const u = Store.user(username);
  return (u && u.wipLimit != null && u.wipLimit !== '') ? u.wipLimit : Store.wipLimit;
}

/* ---------- assign ------------------------------------------------------- */
function assignForm(){
  const people = Store.active();
  if (!people.length) { toast('Add a team member first.', 'err'); return; }
  const kras = [...new Set(Store.tasks.map(t => t.kra).filter(Boolean))];
  openModal(`
    <form id="fAssign" class="p-6 lg:p-8">
      <h2 class="text-2xl font-black mb-1">Assign a task</h2>
      <p class="text-sm text-gray-400 font-semibold mb-6">It routes for approval automatically when the rules require it.</p>
      <div class="space-y-4">
        <div><label class="dbx-lb" for="aTitle">Task</label>
          <input id="aTitle" name="title" class="dbx-in" required placeholder="What needs doing?"></div>
        <div><label class="dbx-lb" for="aDesc">Detail</label>
          <textarea id="aDesc" name="desc" rows="2" class="dbx-in" placeholder="Context, acceptance criteria…"></textarea></div>
        <div class="grid grid-cols-2 gap-4">
          <div><label class="dbx-lb" for="aAssignee">Assign to</label>
            <select id="aAssignee" name="assignee" class="dbx-in" required>
              ${people.map(u=>`<option value="${esc(u.username)}">${esc(u.name)} · ${esc(u.role)}</option>`).join('')}
            </select></div>
          <div><label class="dbx-lb" for="aDue">Due date</label>
            <input id="aDue" name="due" type="date" class="dbx-in" required value="${DomeBox.ymd(DomeBox.addDays(new Date(),7))}"></div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div><label class="dbx-lb" for="aPriority">Priority</label>
            <select id="aPriority" name="priority" class="dbx-in">
              <option>High</option><option selected>Medium</option><option>Low</option></select></div>
          <div><label class="dbx-lb" for="aKra">KRA</label>
            <input id="aKra" name="kra" class="dbx-in" list="kraList" placeholder="e.g. Vendor Quality">
            <datalist id="kraList">${kras.map(k=>`<option value="${esc(k)}">`).join('')}</datalist></div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div><label class="dbx-lb" for="aCadence">Repeats</label>
            <select id="aCadence" name="cadence" class="dbx-in">
              ${Object.values(CAD).map(c=>`<option${c===CAD.ONE_TIME?' selected':''}>${esc(c)}</option>`).join('')}
            </select></div>
          <div id="aIntervalWrap" class="hidden"><label class="dbx-lb" for="aInterval">Every N days</label>
            <input id="aInterval" name="intervalDays" type="number" min="1" value="30" class="dbx-in"></div>
        </div>
        <div><label class="dbx-lb">Checklist <span class="normal-case tracking-normal font-semibold">(one per line, optional)</span></label>
          <textarea id="aSubs" rows="2" class="dbx-in" placeholder="Collect quotes&#10;Compare rates"></textarea></div>
      </div>
      <div id="aRoute" class="mt-5 text-xs font-bold rounded-xl px-4 py-3 bg-blue-50 text-blue-800"></div>
      <div class="flex gap-3 mt-6">
        <button type="button" onclick="DomeBoxApp._closeModal()" class="flex-1 border-2 border-gray-200 py-3 rounded-2xl font-black text-gray-600">Cancel</button>
        <button type="submit" class="flex-1 bg-blue-600 text-white py-3 rounded-2xl font-black shadow-lg shadow-blue-600/20">Assign</button>
      </div>
    </form>`);

  const routeNote = () => {
    const target = Store.user($('aAssignee').value);
    const r = DomeBox.initialStatusFor(target, Store.actor);
    $('aRoute').textContent = r.status === S.AWAITING_APPROVAL
      ? 'Goes to ' + nameOf(r.approver) + ' for approval before ' + target.name.split(' ')[0] + ' sees it.'
      : 'Lands straight in ' + target.name.split(' ')[0] + "'s To Do.";
  };
  $('aAssignee').addEventListener('change', routeNote);
  $('aCadence').addEventListener('change', e =>
    $('aIntervalWrap').classList.toggle('hidden', e.target.value !== CAD.CUSTOM_DAYS));
  routeNote();

  $('fAssign').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const target = Store.user(f.get('assignee'));
    const route = DomeBox.initialStatusFor(target, Store.actor);
    const t = normTask({
      id: Store.nextId(), title: String(f.get('title')).trim(), desc: f.get('desc'),
      assignee: target.username, raisedBy: Store.actor.username, approver: route.approver,
      status: route.status, priority: f.get('priority'), due: f.get('due'),
      kra: String(f.get('kra')||'').trim(), cadence: f.get('cadence'),
      intervalDays: Number(f.get('intervalDays')||0),
      subtasks: String($('aSubs').value||'').split('\n').map(s=>s.trim()).filter(Boolean)
                 .map(text => ({ text, done:false })),
      history: [{ status: route.status, date:new Date().toISOString(),
                  by: Store.actor.username, note: route.note }],
    });
    Store.tasks.push(t);
    Store.commit('task', t);
    closeModal();
    toast(route.status === S.AWAITING_APPROVAL
      ? 'Sent to ' + nameOf(route.approver) + ' for approval'
      : 'Assigned to ' + target.name, 'ok');
  });
}

/* ---------- detail drawer ------------------------------------------------ */
function openTask(id){
  const t = Store.task(id); if (!t) return;
  const moves = DomeBox.allowedTransitions(t, Store.actor);
  const sub = DomeBox.subtaskProgress(t);
  const blockers = DomeBox.openBlockers(t, Store.tasks);
  const late = overdueBy(t);
  const label = { [S.IN_PROGRESS]: t.status === S.FOR_REVIEW ? 'Send back for rework' : 'Start work',
    [S.FOR_REVIEW]:'Submit for review', [S.VERIFIED]:'Verify & close',
    [S.PENDING]: t.status === S.AWAITING_APPROVAL ? 'Approve' : (t.status === S.DELEGATION_PROPOSED ? 'Approve hand-off' : 'Move to To Do'),
    [S.REJECTED]:'Reject', [S.CANCELLED]:'Cancel task' };

  openDrawer(`
    <div class="p-6 lg:p-8">
      <div class="flex justify-between items-start gap-4 mb-6">
        <div>
          <div class="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">${esc(t.id)} · ${esc(t.status)}</div>
          <h2 class="text-2xl font-black leading-tight">${esc(t.title)}</h2>
        </div>
        <button onclick="DomeBoxApp._closeDrawer()" class="text-gray-400 hover:text-gray-900"><span class="material-icons">close</span></button>
      </div>

      ${late ? `<div class="mb-4 text-xs font-black rounded-xl px-4 py-3 bg-red-50 text-red-800">Overdue by ${late} day${late>1?'s':''}</div>`:''}
      ${blockers.length ? `<div class="mb-4 text-xs font-bold rounded-xl px-4 py-3 bg-amber-50 text-amber-900">
        Blocked by ${blockers.map(b=>esc(b.title)).join(', ')}</div>`:''}
      ${t.delegateTo ? `<div class="mb-4 text-xs font-bold rounded-xl px-4 py-3 bg-purple-50 text-purple-900">
        Hand-off to ${esc(nameOf(t.delegateTo))} awaiting ${esc(nameOf(t.approver))}</div>`:''}

      ${t.desc ? `<p class="text-sm text-gray-600 leading-relaxed mb-6">${esc(t.desc)}</p>`:''}

      <div class="grid grid-cols-2 gap-4 mb-6 text-sm">
        ${[['Owner',nameOf(t.assignee)],['Raised by',nameOf(t.raisedBy)],
           ['Approver',nameOf(t.approver)],['Due',fmtDate(t.due)],
           ['Priority',t.priority],['KRA',t.kra||'—'],
           ['Repeats',t.cadence],['Rework loops',String(t.reworkCount||0)]]
          .map(([k,v])=>`<div><div class="dbx-lb">${esc(k)}</div><div class="font-bold text-gray-800">${esc(v)}</div></div>`).join('')}
      </div>

      ${sub.total ? `<div class="mb-6">
        <div class="flex justify-between items-center mb-2">
          <span class="dbx-lb mb-0">Checklist</span>
          <span class="text-xs font-black text-gray-500">${sub.done}/${sub.total}</span>
        </div>
        <div class="h-1.5 bg-gray-100 rounded-full mb-3 overflow-hidden">
          <div class="h-full bg-blue-600 rounded-full" style="width:${sub.pct}%"></div></div>
        ${t.subtasks.map((s,i)=>`<label class="flex items-center gap-2 py-1.5 text-sm ${s.done?'text-gray-400 line-through':'text-gray-700'}">
          <input type="checkbox" class="w-4 h-4 accent-blue-600 dbx-sub" data-i="${i}" ${s.done?'checked':''}>
          ${esc(s.text)}</label>`).join('')}
      </div>`:''}

      <div class="flex flex-wrap gap-2 mb-6">
        ${moves.map(m=>{ const why = refusalFor(t, m);
          return `<div class="${why?'':'contents'}">
            <button class="dbx-move px-4 py-2.5 rounded-xl font-black text-sm ${
              why?'bg-gray-100 text-gray-400 cursor-not-allowed':
              m===S.VERIFIED?'bg-emerald-700 text-white':
              m===S.REJECTED||m===S.CANCELLED?'border-2 border-gray-200 text-gray-600':
              'bg-blue-600 text-white'}" data-next="${esc(m)}" ${why?'disabled':''}
              >${esc(label[m]||m)}</button>
            ${why?`<div class="text-[11px] font-bold text-gray-400 mt-1">${esc(why)}</div>`:''}
          </div>`;}).join('')
          || '<span class="text-xs font-bold text-gray-400">No actions available to you on this task right now.</span>'}
        ${DomeBox.isOpen(t.status) && (t.assignee===Store.actor.username || Store.actor.role===ROLE.ADMIN)
          ? `<button id="btnDelegate" class="px-4 py-2.5 rounded-xl font-black text-sm border-2 border-gray-200 text-gray-600">Hand over…</button>`:''}
        ${DomeBox.isOpen(t.status)
          ? `<button id="btnBlock" class="px-4 py-2.5 rounded-xl font-black text-sm border-2 border-gray-200 text-gray-600">Add blocker…</button>`:''}
      </div>

      <div class="dbx-lb">History</div>
      <div class="space-y-3 mt-2">
        ${(t.history||[]).slice().reverse().map(h=>`
          <div class="flex gap-3 text-xs">
            <div class="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 shrink-0"></div>
            <div><span class="font-black text-gray-800">${esc(h.status)}</span>
              <span class="text-gray-400"> · ${new Date(h.date).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</span>
              ${h.by?`<span class="text-gray-400"> · ${esc(nameOf(h.by))}</span>`:''}
              ${h.note?`<div class="text-gray-500 mt-0.5">${esc(h.note)}</div>`:''}</div>
          </div>`).join('')}
      </div>
    </div>`);

  $('dbx-drawer').querySelectorAll('.dbx-move').forEach(b =>
    b.addEventListener('click', () => {
      if (b.disabled) return;
      if (applyTransition(t, b.dataset.next)) closeDrawer();
    }));
  $('dbx-drawer').querySelectorAll('.dbx-sub').forEach(cb =>
    cb.addEventListener('change', () => {
      t.subtasks[Number(cb.dataset.i)].done = cb.checked;
      Store.commit('task', t); openTask(t.id);
    }));
  const del = $('btnDelegate'); if (del) del.addEventListener('click', () => delegateForm(t));
  const blk = $('btnBlock');    if (blk) blk.addEventListener('click', () => blockerForm(t));
}

function delegateForm(t){
  const others = Store.active().filter(u => u.username !== t.assignee);
  if (!others.length) { toast('Nobody else to hand it to.', 'err'); return; }
  openModal(`<form id="fDel" class="p-6 lg:p-8">
      <h2 class="text-xl font-black mb-1">Hand over "${esc(t.title)}"</h2>
      <p class="text-sm text-gray-400 font-semibold mb-6">Your manager approves the hand-off unless you are an Admin.</p>
      <label class="dbx-lb" for="dTo">New owner</label>
      <select id="dTo" class="dbx-in mb-6">${others.map(u=>`<option value="${esc(u.username)}">${esc(u.name)} · ${esc(u.role)}</option>`).join('')}</select>
      <div class="flex gap-3">
        <button type="button" onclick="DomeBoxApp._closeModal()" class="flex-1 border-2 border-gray-200 py-3 rounded-2xl font-black text-gray-600">Cancel</button>
        <button type="submit" class="flex-1 bg-blue-600 text-white py-3 rounded-2xl font-black">Propose</button>
      </div></form>`);
  $('fDel').addEventListener('submit', e => {
    e.preventDefault();
    const target = Store.user($('dTo').value);
    const r = DomeBox.proposeDelegation(t, Store.actor, target, Store.user(Store.actor.username));
    if (!r.ok) { toast(r.error, 'err'); return; }
    t.status = r.status; t.assignee = r.assignee; t.approver = r.approver; t.delegateTo = r.delegateTo;
    logHistory(t, r.status, r.note);
    Store.commit('task', t);
    closeModal(); closeDrawer();
    toast(r.note, 'ok');
  });
}

function blockerForm(t){
  const cands = Store.tasks.filter(x => x.id !== t.id && DomeBox.isOpen(x.status) &&
    (t.blockedBy||[]).indexOf(x.id) < 0);
  if (!cands.length) { toast('No other open task could block this.', 'err'); return; }
  openModal(`<form id="fBlk" class="p-6 lg:p-8">
      <h2 class="text-xl font-black mb-6">What is blocking "${esc(t.title)}"?</h2>
      <select id="bId" class="dbx-in mb-6">${cands.map(x=>`<option value="${esc(x.id)}">${esc(x.id)} · ${esc(x.title)}</option>`).join('')}</select>
      <div class="flex gap-3">
        <button type="button" onclick="DomeBoxApp._closeModal()" class="flex-1 border-2 border-gray-200 py-3 rounded-2xl font-black text-gray-600">Cancel</button>
        <button type="submit" class="flex-1 bg-blue-600 text-white py-3 rounded-2xl font-black">Add blocker</button>
      </div></form>`);
  $('fBlk').addEventListener('submit', e => {
    e.preventDefault();
    const r = DomeBox.addDependency(t.id, $('bId').value, Store.tasks);
    if (!r.ok) { toast(r.error, 'err'); return; }   // catches circular chains
    t.blockedBy = r.blockedBy;
    Store.commit('task', t); closeModal(); openTask(t.id);
    toast('Blocker added', 'ok');
  });
}
