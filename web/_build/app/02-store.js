'use strict';
const S = DomeBox.STATUS, ROLE = DomeBox.ROLE, CAD = DomeBox.CADENCE;
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------------------------------------------------------------------------
   STORE
   One place owns the data. Every mutation goes through commit(), which persists
   and then re-renders whatever view is open — so the board, the list, the team
   page and the reports can never drift apart.
   ------------------------------------------------------------------------- */
const Store = {
  users: [], tasks: [], actor: null, wipLimit: 5, company: 'domebox',
  backend: null,          // { loadAll, saveTask, saveUser } — all optional
  seq: 0,

  key(){ return 'domebox:' + this.company; },

  /* Demo rows are NEVER created unless the host explicitly asks for them. On a
     live deployment the block must come up empty and wait for real data rather
     than inventing any, because anything it invents can be edited and pushed
     back to a customer's sheet. */
  load(opts){
    opts = opts || {};
    /* Drop whatever the previous tenant left in memory FIRST. Without this, a
       user who signs out of one company and into another in the same tab still
       has the first company's rows loaded — and a later save would write them
       into the second company's sheet. */
    this.users = []; this.tasks = [];
    if (this.backend && this.backend.loadAll) {
      return Promise.resolve(this.backend.loadAll()).then(d => {
        this.users = (d.users||[]).map(normUser);
        this.tasks = (d.tasks||[]).map(normTask);
        this.reseq(); render();
      });
    }
    try {
      const raw = localStorage.getItem(this.key());
      if (raw) { const d = JSON.parse(raw);
        this.users = (d.users||[]).map(normUser);
        this.tasks = (d.tasks||[]).map(normTask); }
    } catch(e){ /* private mode or cleared storage: come up empty, never guess */ }
    if (!this.users.length && opts.demo === true) seed();
    this.reseq(); render();
    return Promise.resolve();
  },

  /* Ids must not collide with ones already loaded from the server. */
  reseq(){
    this.seq = this.tasks.reduce((m,t) => {
      const n = parseInt(String(t.id).replace(/\D/g,''), 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 1000);
  },
  nextId(){ return 'T-' + (++this.seq); },

  persist(){
    try { localStorage.setItem(this.key(), JSON.stringify({users:this.users, tasks:this.tasks})); }
    catch(e){ /* quota or private mode: the session still works, it just won't survive reload */ }
  },

  commit(what, rec){
    this.persist();
    if (this.backend) {
      /* Second line of defence. If a browser still holds demo rows from before a
         backend was attached, editing one must not write sample data into a real
         customer's spreadsheet. */
      if (rec && rec._demo) {
        toast('That is demo data and was not sent to the server. Run DomeBoxApp.resetDemo() first.', 'err');
        render(); return;
      }
      try {
        if (what === 'task' && this.backend.saveTask) this.backend.saveTask(rec);
        if (what === 'user' && this.backend.saveUser) this.backend.saveUser(rec);
      } catch(e){ toast('Saved locally, but the server rejected it: ' + e.message, 'err'); }
    }
    render();
  },

  user(u){ return this.users.find(x => x.username === u) || null; },
  task(id){ return this.tasks.find(t => t.id === id) || null; },
  active(){ return this.users.filter(u => u.active !== false); },
};

function normUser(u){
  return { username:u.username||u.email||'', name:u.name||u.username||'', role:u.role||ROLE.DOER,
    dept:u.dept||u.department||'', manager:u.manager||'', active:u.active !== false,
    wipLimit: u.wipLimit == null ? null : Number(u.wipLimit), kras: u.kras || [] };
}
function normTask(t){
  return { id:t.id, title:t.title||'', desc:t.desc||'', assignee:t.assignee||'',
    raisedBy:t.raisedBy||'', approver:t.approver||'', delegateTo:t.delegateTo||'',
    status:t.status||S.PENDING, priority:t.priority||'Medium', due:t.due||'',
    kra:t.kra||'', cadence:t.cadence||CAD.ONE_TIME, intervalDays:t.intervalDays||0,
    reworkCount:Number(t.reworkCount||0), blockedBy:t.blockedBy||[],
    subtasks:t.subtasks||[], history:t.history||[], comments:t.comments||[], _demo: !!t._demo };
}

/* ---------- shared UI ---------------------------------------------------- */
function toast(msg, kind){
  const el = document.createElement('div');
  el.className = 'dbx-toast ' + (kind || 'info');
  el.textContent = msg;
  $('dbx-toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 5200 : 3200);
}
function openModal(html){ $('dbx-modal').innerHTML = html; $('dbx-scrim').classList.add('on'); }
function closeModal(){ $('dbx-scrim').classList.remove('on'); $('dbx-modal').innerHTML = ''; }
function openDrawer(html){ $('dbx-drawer').innerHTML = html; $('dbx-drawer').classList.add('on'); }
function closeDrawer(){ $('dbx-drawer').classList.remove('on'); }
$('dbx-scrim').addEventListener('click', e => { if (e.target.id === 'dbx-scrim') closeModal(); });
addEventListener('keydown', e => { if (e.key === 'Escape'){ closeModal(); closeDrawer(); } });

const fmtDate = s => { const d = DomeBox.parseYmd(s); return d ? d.toLocaleDateString('en-IN',
  {day:'2-digit', month:'short'}) : '—'; };
const nameOf = u => (Store.user(u) || {}).name || u || '—';
const initials = n => String(n).trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();

/** Days a task is late by, or null when it is not. */
function overdueBy(t){
  if (DomeBox.isClosed(t.status) || t.status === S.FOR_REVIEW) return null;
  const d = DomeBox.parseYmd(t.due);
  if (!d) return null;
  const n = DomeBox.dayDiff(new Date(), d);
  return n > 0 ? n : null;
}

function logHistory(t, status, note){
  t.history = t.history || [];
  t.history.push({ status, date: new Date().toISOString(), by: Store.actor.username, note: note || '' });
}
