/* ---------------------------------------------------------------------------
   RENDER
   ------------------------------------------------------------------------- */
let MODE = 'board';
const F = { q:'', assignee:'', status:'', priority:'', overdue:false };

function visible(){
  return Store.tasks.filter(t => {
    if (F.assignee && t.assignee !== F.assignee) return false;
    if (F.status && t.status !== F.status) return false;
    if (F.priority && t.priority !== F.priority) return false;
    if (F.overdue && !overdueBy(t)) return false;
    if (F.q) { const q = F.q.toLowerCase();
      if (!(t.title+' '+t.desc+' '+t.kra+' '+t.id).toLowerCase().includes(q)) return false; }
    return true;
  });
}

function taskCard(t){
  const late = overdueBy(t), sub = DomeBox.subtaskProgress(t);
  const blocked = DomeBox.openBlockers(t, Store.tasks).length;
  return `<div class="dbx-card p-${esc(t.priority)}" draggable="true" data-id="${esc(t.id)}">
    <div class="flex justify-between items-start gap-2 mb-2">
      <span class="font-bold text-sm text-gray-800 leading-snug">${esc(t.title)}</span>
      <span class="w-7 h-7 rounded-full bg-blue-50 text-blue-700 text-[10px] font-black
        flex items-center justify-center shrink-0" title="${esc(nameOf(t.assignee))}">${esc(initials(nameOf(t.assignee)))}</span>
    </div>
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="dbx-chip ${late?'bg-red-50 text-red-700':'bg-gray-100 text-gray-500'}">
        <span class="material-icons" style="font-size:12px">event</span>${fmtDate(t.due)}${late?` · ${late}d late`:''}</span>
      ${blocked?`<span class="dbx-chip bg-amber-50 text-amber-800"><span class="material-icons" style="font-size:12px">block</span>Blocked</span>`:''}
      ${sub.total?`<span class="dbx-chip bg-gray-100 text-gray-500">${sub.done}/${sub.total}</span>`:''}
      ${t.reworkCount?`<span class="dbx-chip bg-orange-50 text-orange-700">↺ ${t.reworkCount}</span>`:''}
      ${t.cadence && t.cadence!==CAD.ONE_TIME?`<span class="dbx-chip bg-indigo-50 text-indigo-700"><span class="material-icons" style="font-size:12px">autorenew</span>${esc(t.cadence)}</span>`:''}
    </div></div>`;
}

function renderBoard(rows){
  const board = DomeBox.groupIntoBoard ? null : null;
  $('tasksBoard').innerHTML = DomeBox.BOARD_COLUMNS.map(col => {
    const items = rows.filter(t => col.statuses.indexOf(t.status) > -1);
    return `<div>
      <div class="flex items-center justify-between px-1 mb-2">
        <span class="text-[10px] font-black uppercase tracking-widest text-gray-500">${esc(col.title)}</span>
        <span class="text-[10px] font-black text-gray-400">${items.length}</span>
      </div>
      <div class="dbx-col" data-col="${esc(col.key)}">${items.map(taskCard).join('') ||
        '<div class="text-[11px] text-gray-400 font-semibold px-1 py-3">Nothing here</div>'}</div>
    </div>`;
  }).join('');
  wireDnd();
}

function renderList(rows){
  $('tasksList').innerHTML = `<table class="w-full text-sm">
    <thead><tr class="text-[10px] uppercase tracking-widest text-gray-400 border-b border-gray-100">
      ${['Task','Owner','Status','Priority','Due','KRA'].map(h=>`<th class="text-left font-black px-5 py-3 whitespace-nowrap">${h}</th>`).join('')}
    </tr></thead><tbody>
    ${rows.map(t=>{ const late=overdueBy(t); return `<tr class="border-b border-gray-50 hover:bg-blue-50/40 cursor-pointer dbx-row" data-id="${esc(t.id)}">
      <td class="px-5 py-3 font-bold text-gray-800">${esc(t.title)}
        <span class="text-gray-300 font-semibold ml-1">${esc(t.id)}</span></td>
      <td class="px-5 py-3 text-gray-600 whitespace-nowrap">${esc(nameOf(t.assignee))}</td>
      <td class="px-5 py-3 whitespace-nowrap"><span class="dbx-chip bg-gray-100 text-gray-600">${esc(t.status)}</span></td>
      <td class="px-5 py-3 whitespace-nowrap"><span class="dbx-chip ${
        t.priority==='High'?'bg-red-50 text-red-700':t.priority==='Medium'?'bg-amber-50 text-amber-800':'bg-blue-50 text-blue-700'
      }">${esc(t.priority)}</span></td>
      <td class="px-5 py-3 whitespace-nowrap ${late?'text-red-700 font-black':'text-gray-500'}">${fmtDate(t.due)}${late?` · ${late}d`:''}</td>
      <td class="px-5 py-3 text-gray-500 whitespace-nowrap">${esc(t.kra||'—')}</td></tr>`;}).join('')}
    </tbody></table>`;
  $('tasksList').querySelectorAll('.dbx-row').forEach(r =>
    r.addEventListener('click', () => openTask(r.dataset.id)));
}

function wireDnd(){
  let dragged = null;
  $('tasksBoard').querySelectorAll('.dbx-card').forEach(c => {
    c.addEventListener('dragstart', e => { dragged = c.dataset.id; c.classList.add('drag');
      e.dataTransfer.effectAllowed = 'move'; });
    c.addEventListener('dragend', () => { c.classList.remove('drag'); dragged = null; });
    c.addEventListener('click', () => openTask(c.dataset.id));
  });
  $('tasksBoard').querySelectorAll('.dbx-col').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', () => col.classList.remove('over'));
    col.addEventListener('drop', e => {
      e.preventDefault(); col.classList.remove('over');
      if (!dragged) return;
      const t = Store.task(dragged); if (!t) return;
      // The engine decides, not the drop target.
      const verdict = DomeBox.canDropInColumn(t, Store.actor, col.dataset.col,
        { allTasks: Store.tasks, wipLimit: wipLimitFor(t.assignee) });
      if (verdict.noop) return;
      if (!verdict.ok) { toast(verdict.reason, 'err'); return; }
      applyTransition(t, DomeBox.statusForColumn(col.dataset.col));
    });
  });
}

function renderWip(){
  const mine = DomeBox.wipStatus(Store.tasks, Store.actor.username, wipLimitFor(Store.actor.username));
  const b = $('wipBanner');
  if (!mine.exceeded && !mine.nearing) { b.classList.add('hidden'); return; }
  b.classList.remove('hidden');
  b.innerHTML = `<div class="rounded-2xl px-5 py-3 text-xs font-black ${
    mine.exceeded?'bg-red-50 text-red-800':'bg-amber-50 text-amber-900'}">
    You have ${mine.count} tasks in progress (limit ${mine.limit}).
    ${mine.exceeded?'Finish something before starting more.':'One more reaches your limit.'}</div>`;
}

function render(){
  if (!Store.actor) return;
  const bare = !Store.tasks.length && !Store.users.filter(u=>u.username!==Store.actor.username).length;
  if (!$('view-tasks').classList.contains('hidden')) {
    syncFilters();
    const rows = visible();
    $('tasksEmpty').innerHTML = bare
      ? '<div class="text-lg font-black text-gray-500 mb-2">Nothing here yet</div>'
        + '<div class="text-sm font-semibold text-gray-400">Add your team, then assign the first task.</div>'
      : 'No tasks match these filters.';
    $('tasksEmpty').classList.toggle('hidden', rows.length > 0);
    $('tasksBoard').classList.toggle('hidden', MODE !== 'board' || !rows.length);
    $('tasksList').classList.toggle('hidden', MODE !== 'list' || !rows.length);
    if (rows.length) { MODE === 'board' ? renderBoard(rows) : renderList(rows); }
    renderWip();
  }
  if (!$('view-team').classList.contains('hidden')) renderTeam();
  if (window.DomeBoxAnalytics && !($('view-analytics')||{classList:{contains:()=>true}}).classList.contains('hidden')) {
    DomeBoxAnalytics.setData({ users: Store.users, tasks: Store.tasks });
  }
}

let filtersReady = false;
function syncFilters(){
  if (filtersReady) return;
  filtersReady = true;
  $('fAssignee').innerHTML = '<option value="">Everyone</option>' +
    Store.users.map(u=>`<option value="${esc(u.username)}">${esc(u.name)}</option>`).join('');
  $('fStatus').innerHTML = '<option value="">Any status</option>' +
    Object.values(S).map(s=>`<option>${esc(s)}</option>`).join('');
}

/* ---------------------------------------------------------------------------
   TEAM
   ------------------------------------------------------------------------- */
function renderTeam(){
  const range = DomeBox.periodRange(DomeBox.PERIOD.MONTH, 1);   // last full month
  const open = u => Store.tasks.filter(t => t.assignee === u && DomeBox.isOpen(t.status)).length;

  $('teamStats').innerHTML = [
    ['Members', Store.active().length],
    ['Open tasks', Store.tasks.filter(t=>DomeBox.isOpen(t.status)).length],
    ['Overdue', Store.tasks.filter(t=>overdueBy(t)).length],
    ['Awaiting approval', Store.tasks.filter(t=>t.status===S.AWAITING_APPROVAL||t.status===S.DELEGATION_PROPOSED).length],
  ].map(([k,v])=>`<div class="bg-white rounded-3xl border border-gray-100 p-5">
      <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">${k}</div>
      <div class="text-3xl font-black mt-1 ${k==='Overdue'&&v?'text-red-700':'text-gray-900'}">${v}</div>
    </div>`).join('');

  $('teamTable').innerHTML = `<table class="w-full text-sm">
    <thead><tr class="text-[10px] uppercase tracking-widest text-gray-400 border-b border-gray-100">
      ${['Member','Role','Department','Reports to','Open','WIP','WhatsApp','Last month','']
        .map(h=>`<th class="text-left font-black px-5 py-3 whitespace-nowrap">${h}</th>`).join('')}
    </tr></thead><tbody>
    ${Store.users.map(u=>{
      const wip = DomeBox.wipStatus(Store.tasks, u.username, wipLimitFor(u.username));
      const s = DomeBox.scoreForPeriod(Store.tasks, u.username, range);
      const band = s.hasData ? DomeBox.performanceBand(s.score).band : null;
      return `<tr class="border-b border-gray-50 ${u.active===false?'opacity-45':''}">
        <td class="px-5 py-3">
          <div class="font-bold text-gray-800">${esc(u.name)}</div>
          <div class="text-xs text-gray-400">${esc(u.username)}</div></td>
        <td class="px-5 py-3"><span class="dbx-chip ${
          u.role===ROLE.ADMIN?'bg-purple-50 text-purple-700':u.role===ROLE.MANAGER?'bg-blue-50 text-blue-700':'bg-gray-100 text-gray-600'
        }">${esc(u.role)}</span></td>
        <td class="px-5 py-3 text-gray-600 whitespace-nowrap">${esc(u.dept||'—')}</td>
        <td class="px-5 py-3 text-gray-600 whitespace-nowrap">${esc(u.manager?nameOf(u.manager):'—')}</td>
        <td class="px-5 py-3 font-bold text-gray-700">${open(u.username)}</td>
        <td class="px-5 py-3 font-bold whitespace-nowrap ${wip.exceeded?'text-red-700':wip.nearing?'text-amber-700':'text-gray-700'}">${wip.count}/${wip.limit||'∞'}</td>
        <td class="px-5 py-3 whitespace-nowrap">${
          u.waOptIn && u.phone ? '<span class="dbx-chip bg-emerald-50 text-emerald-800">Opted in</span>'
          : u.phone ? '<span class="dbx-chip bg-gray-100 text-gray-500">Not opted in</span>'
          : '<span class="text-gray-300 text-xs font-bold">—</span>'}</td>
        <td class="px-5 py-3 font-black whitespace-nowrap">${
          s.hasData ? `${s.score} · ${band}` : '<span class="text-gray-300">no data</span>'}</td>
        <td class="px-5 py-3 text-right whitespace-nowrap">
          <button class="dbx-edit text-blue-600 font-black text-xs hover:underline" data-u="${esc(u.username)}">Edit</button></td>
      </tr>`;}).join('')}
    </tbody></table>`;
  $('teamTable').querySelectorAll('.dbx-edit').forEach(b =>
    b.addEventListener('click', () => userForm(Store.user(b.dataset.u))));
}

function userForm(u){
  const editing = !!u;
  u = u || { username:'', name:'', role:ROLE.DOER, dept:'', manager:'', wipLimit:'', active:true, kras:[] };
  const mgrs = Store.active().filter(x => x.username !== u.username);
  openModal(`<form id="fUser" class="p-6 lg:p-8">
    <h2 class="text-2xl font-black mb-1">${editing?'Edit member':'Add member'}</h2>
    <p class="text-sm text-gray-400 font-semibold mb-6">Role decides what they may do; "reports to" decides who approves their work.</p>
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-4">
        <div><label class="dbx-lb" for="uName">Full name</label><input id="uName" class="dbx-in" required value="${esc(u.name)}"></div>
        <div><label class="dbx-lb" for="uMail">Work email</label>
          <input id="uMail" type="email" class="dbx-in" required value="${esc(u.username)}" ${editing?'readonly':''}></div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div><label class="dbx-lb" for="uRole">Role</label><select id="uRole" class="dbx-in">
          ${Object.values(ROLE).map(r=>`<option${r===u.role?' selected':''}>${esc(r)}</option>`).join('')}</select></div>
        <div><label class="dbx-lb" for="uDept">Department</label><input id="uDept" class="dbx-in" value="${esc(u.dept)}"></div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div><label class="dbx-lb" for="uMgr">Reports to</label><select id="uMgr" class="dbx-in">
          <option value="">Nobody (top of the tree)</option>
          ${mgrs.map(m=>`<option value="${esc(m.username)}"${m.username===u.manager?' selected':''}>${esc(m.name)}</option>`).join('')}</select></div>
        <div><label class="dbx-lb" for="uWip">WIP limit</label>
          <input id="uWip" type="number" min="0" class="dbx-in" placeholder="default ${Store.wipLimit}" value="${u.wipLimit==null?'':esc(u.wipLimit)}"></div>
      </div>
      <div class="rounded-2xl border border-gray-100 bg-gray-50 p-4">
        <label class="dbx-lb" for="uPhone">WhatsApp number</label>
        <input id="uPhone" class="dbx-in bg-white" placeholder="9876543210" value="${esc(u.phone||'')}">
        <div id="uPhoneMsg" class="text-xs font-bold mt-1.5"></div>
        <label class="flex items-start gap-2 text-xs font-semibold text-gray-600 mt-3 leading-relaxed">
          <input type="checkbox" id="uWaOptIn" class="w-4 h-4 accent-blue-600 mt-0.5 shrink-0" ${u.waOptIn?'checked':''}>
          <span>Send me Dome Box task reminders on WhatsApp at this number.
            I can reply STOP at any time.</span>
        </label>
        <div class="text-[11px] text-gray-400 font-semibold mt-2">
          Consent must be given by the person themselves. Never tick this on someone's behalf.
        </div>
      </div>
      <div>
        <div class="flex justify-between items-center mb-2">
          <span class="dbx-lb mb-0">KRA blueprint</span>
          <button type="button" id="uAddKra" class="text-blue-600 font-black text-xs">+ Add KRA</button>
        </div>
        <div id="uKras" class="space-y-2"></div>
        <div id="uKraMsg" class="text-xs font-bold mt-2"></div>
      </div>
      ${editing?`<label class="flex items-center gap-2 text-sm font-bold text-gray-600 pt-2">
        <input type="checkbox" id="uActive" class="w-4 h-4 accent-blue-600" ${u.active!==false?'checked':''}> Active
      </label>`:''}
    </div>
    <div class="flex gap-3 mt-6">
      <button type="button" onclick="DomeBoxApp._closeModal()" class="flex-1 border-2 border-gray-200 py-3 rounded-2xl font-black text-gray-600">Cancel</button>
      <button type="submit" class="flex-1 bg-blue-600 text-white py-3 rounded-2xl font-black">${editing?'Save':'Add member'}</button>
    </div></form>`);

  let kras = (u.kras||[]).slice();
  const drawKras = () => {
    $('uKras').innerHTML = kras.map((k,i)=>`<div class="flex gap-2">
      <input class="dbx-in kra-item" data-i="${i}" value="${esc(k.item||'')}" placeholder="Key result area">
      <input class="dbx-in kra-w" data-i="${i}" type="number" min="0" max="100" style="max-width:90px"
             value="${esc(k.weight||0)}" placeholder="%">
      <button type="button" class="kra-del px-3 text-gray-400 hover:text-red-600" data-i="${i}">
        <span class="material-icons text-base">delete</span></button></div>`).join('');
    const v = DomeBox.validateKraBlueprint(kras);
    const m = $('uKraMsg');
    m.textContent = kras.length ? (v.ok ? (v.warning || 'Weights total 100%.') : v.error) : '';
    m.className = 'text-xs font-bold mt-2 ' + (v.ok ? (v.warning?'text-amber-700':'text-emerald-700') : 'text-red-700');
    $('uKras').querySelectorAll('.kra-item').forEach(el => el.addEventListener('input', e => {
      kras[+e.target.dataset.i].item = e.target.value; }));
    $('uKras').querySelectorAll('.kra-w').forEach(el => el.addEventListener('input', e => {
      kras[+e.target.dataset.i].weight = Number(e.target.value||0);
      const vv = DomeBox.validateKraBlueprint(kras);
      m.textContent = vv.ok ? (vv.warning || 'Weights total 100%.') : vv.error;
      m.className = 'text-xs font-bold mt-2 ' + (vv.ok ? (vv.warning?'text-amber-700':'text-emerald-700') : 'text-red-700');
    }));
    $('uKras').querySelectorAll('.kra-del').forEach(el => el.addEventListener('click', e => {
      kras.splice(+e.currentTarget.dataset.i, 1); drawKras(); }));
  };
  drawKras();
  $('uAddKra').addEventListener('click', () => { kras.push({item:'', weight:0}); drawKras(); });

  /* Validated by the same function the sender uses, so a number the form accepts
     can never be one the sender then rejects — or worse, one that reaches a
     stranger. */
  const phoneMsg = () => {
    const raw = $('uPhone').value.trim();
    const box = $('uPhoneMsg'), ok = raw ? DomeBoxWA.waNormalizePhone(raw, '91') : null;
    if (!raw) { box.textContent = ''; return null; }
    box.textContent = ok ? 'Will send to ' + ok : 'Not a usable mobile number.';
    box.className = 'text-xs font-bold mt-1.5 ' + (ok ? 'text-emerald-700' : 'text-red-700');
    return ok;
  };
  $('uPhone').addEventListener('input', phoneMsg);
  phoneMsg();

  $('fUser').addEventListener('submit', e => {
    e.preventDefault();
    const mail = $('uMail').value.trim().toLowerCase();
    if (!editing && Store.user(mail)) { toast('Someone already uses that email.', 'err'); return; }
    const filled = kras.filter(k => String(k.item||'').trim());
    if (filled.length) {
      const v = DomeBox.validateKraBlueprint(filled);
      if (!v.ok) { toast(v.error, 'err'); return; }   // weights over 100% never save
    }
    const phoneRaw = $('uPhone').value.trim();
    const phone = phoneRaw ? DomeBoxWA.waNormalizePhone(phoneRaw, '91') : '';
    if (phoneRaw && !phone) { toast('That WhatsApp number is not usable.', 'err'); return; }
    if ($('uWaOptIn').checked && !phone) {
      toast('Add a usable WhatsApp number before opting in.', 'err'); return;
    }
    const wipRaw = $('uWip').value.trim();
    const rec = normUser({ username: mail, name:$('uName').value.trim(), role:$('uRole').value,
      dept:$('uDept').value.trim(), manager:$('uMgr').value,
      wipLimit: wipRaw === '' ? null : Number(wipRaw),
      phone: phone, waOptIn: $('uWaOptIn').checked,
      waOptInAt: ($('uWaOptIn').checked && !u.waOptIn) ? new Date().toISOString() : (u.waOptInAt || ''),
      active: editing ? $('uActive').checked : true, kras: filled });

    if (editing) {
      const i = Store.users.findIndex(x => x.username === mail);
      // Deactivating someone must not strand their open work in a queue nobody sees.
      if (rec.active === false) {
        const stranded = Store.tasks.filter(t => t.assignee === mail && DomeBox.isOpen(t.status));
        if (stranded.length) { closeModal(); reassignForm(rec, stranded); return; }
      }
      Store.users[i] = rec;
    } else Store.users.push(rec);
    Store.commit('user', rec);
    closeModal();
    toast(editing ? 'Member updated' : 'Member added', 'ok');
  });
}

function reassignForm(user, stranded){
  const others = Store.active().filter(x => x.username !== user.username);
  openModal(`<form id="fRe" class="p-6 lg:p-8">
    <h2 class="text-xl font-black mb-1">${esc(user.name)} has ${stranded.length} open task${stranded.length>1?'s':''}</h2>
    <p class="text-sm text-gray-400 font-semibold mb-6">Deactivating them would hide this work from every board. Hand it to someone first.</p>
    <div class="bg-gray-50 rounded-2xl p-4 mb-6 max-h-40 overflow-y-auto">
      ${stranded.map(t=>`<div class="text-sm font-bold text-gray-700 py-1">${esc(t.title)}
        <span class="text-xs text-gray-400 font-semibold">· due ${fmtDate(t.due)}</span></div>`).join('')}
    </div>
    ${others.length?`<label class="dbx-lb" for="rTo">Move all of it to</label>
    <select id="rTo" class="dbx-in mb-6">${others.map(o=>`<option value="${esc(o.username)}">${esc(o.name)}</option>`).join('')}</select>`
    :`<div class="text-sm font-bold text-red-700 mb-6">There is nobody else active to take it.</div>`}
    <div class="flex gap-3">
      <button type="button" onclick="DomeBoxApp._closeModal()" class="flex-1 border-2 border-gray-200 py-3 rounded-2xl font-black text-gray-600">Cancel</button>
      ${others.length?`<button type="submit" class="flex-1 bg-blue-600 text-white py-3 rounded-2xl font-black">Reassign & deactivate</button>`:''}
    </div></form>`);
  const f = $('fRe');
  if (!others.length) return;
  f.addEventListener('submit', e => {
    e.preventDefault();
    const to = $('rTo').value;
    stranded.forEach(t => { t.assignee = to;
      logHistory(t, t.status, 'Reassigned from ' + user.name + ' on deactivation'); });
    const i = Store.users.findIndex(x => x.username === user.username);
    Store.users[i] = user;
    Store.commit('user', user);
    closeModal();
    toast(stranded.length + ' task(s) moved to ' + nameOf(to), 'ok');
  });
}
