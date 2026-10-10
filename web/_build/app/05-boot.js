/* ---------------------------------------------------------------------------
   SEED — a small manufacturing SME, so the workflow is demonstrable on a fresh
   browser before any real data exists. Replaced the moment setBackend/loadAll
   returns rows, and never written over data already in localStorage.
   ------------------------------------------------------------------------- */
function seed(){
  Store.users = [
    { username:'rohan@acme.in',  name:'Rohan Mehta',     role:ROLE.ADMIN,   dept:'Management', manager:'' },
    { username:'sruti@acme.in',  name:'Sruti Charulata', role:ROLE.MANAGER, dept:'Operations', manager:'rohan@acme.in' },
    { username:'imran@acme.in',  name:'Imran Qureshi',   role:ROLE.MANAGER, dept:'Quality',    manager:'rohan@acme.in' },
    { username:'payel@acme.in',  name:'Payel Sanyamath', role:ROLE.DOER,    dept:'Operations', manager:'sruti@acme.in' },
    { username:'vikram@acme.in', name:'Vikram Rathore',  role:ROLE.DOER,    dept:'Purchase',   manager:'sruti@acme.in' },
    { username:'neha@acme.in',   name:'Neha Bhandari',   role:ROLE.DOER,    dept:'Quality',    manager:'imran@acme.in' },
  ].map(u => normUser(Object.assign({_demo:true}, u)));

  const d = n => DomeBox.ymd(DomeBox.addDays(new Date(), n));
  const h = (status, back, note) => ({ status,
    date: DomeBox.addDays(new Date(), -back).toISOString(), by:'rohan@acme.in', note: note||'' });

  Store.tasks = [
    { id:'T-1001', title:'Vendor audit — Shakti Engineering', assignee:'vikram@acme.in',
      raisedBy:'sruti@acme.in', approver:'sruti@acme.in', status:S.IN_PROGRESS, priority:'High',
      due:d(-2), kra:'Vendor Quality', desc:'Full QMS audit before the annual rate contract.',
      subtasks:[{text:'Collect ISO certificates',done:true},{text:'Site visit',done:true},{text:'Score against checklist',done:false}],
      history:[h(S.PENDING,9),h(S.IN_PROGRESS,6)] },
    { id:'T-1002', title:'Monthly stock reconciliation', assignee:'payel@acme.in',
      raisedBy:'sruti@acme.in', approver:'sruti@acme.in', status:S.FOR_REVIEW, priority:'Medium',
      due:d(1), kra:'Inventory Accuracy', cadence:CAD.MONTHLY,
      desc:'Physical count against the system for all A-class items.',
      history:[h(S.PENDING,12),h(S.IN_PROGRESS,7),h(S.FOR_REVIEW,1)] },
    { id:'T-1003', title:'Rejection analysis — Line 2', assignee:'neha@acme.in',
      raisedBy:'imran@acme.in', approver:'imran@acme.in', status:S.PENDING, priority:'High',
      due:d(3), kra:'Rejection Control', blockedBy:['T-1001'],
      desc:'Root-cause the 4.2% rejection spike. Needs the vendor audit findings first.',
      history:[h(S.PENDING,2)] },
    { id:'T-1004', title:'AMC renewal — compressors', assignee:'vikram@acme.in',
      raisedBy:'rohan@acme.in', approver:'rohan@acme.in', status:S.PENDING, priority:'Low',
      due:d(14), kra:'Cost Savings', cadence:CAD.YEARLY, history:[h(S.PENDING,3)] },
    { id:'T-1005', title:'Operator training — new PDI checklist', assignee:'neha@acme.in',
      raisedBy:'imran@acme.in', approver:'imran@acme.in', status:S.AWAITING_APPROVAL, priority:'Medium',
      due:d(10), kra:'Capability Building', history:[h(S.AWAITING_APPROVAL,1,'Awaiting manager approval')] },
    { id:'T-1006', title:'Customer complaint closure — Batch 88', assignee:'payel@acme.in',
      raisedBy:'sruti@acme.in', approver:'sruti@acme.in', status:S.VERIFIED, priority:'High',
      due:d(-8), kra:'Customer Satisfaction', reworkCount:1,
      history:[h(S.PENDING,20),h(S.IN_PROGRESS,16),h(S.FOR_REVIEW,12),
               h(S.IN_PROGRESS,11,'Returned for rework'),h(S.FOR_REVIEW,10),h(S.VERIFIED,9)] },
    { id:'T-1007', title:'Weekly line balancing review', assignee:'payel@acme.in',
      raisedBy:'sruti@acme.in', approver:'sruti@acme.in', status:S.VERIFIED, priority:'Medium',
      due:d(-5), kra:'Process Compliance', cadence:CAD.WEEKLY,
      history:[h(S.PENDING,12),h(S.IN_PROGRESS,9),h(S.FOR_REVIEW,6),h(S.VERIFIED,5)] },
    { id:'T-1008', title:'Calibration of torque wrenches', assignee:'neha@acme.in',
      raisedBy:'imran@acme.in', approver:'imran@acme.in', status:S.VERIFIED, priority:'Medium',
      due:d(-15), kra:'Process Compliance', cadence:CAD.QUARTERLY,
      history:[h(S.PENDING,25),h(S.IN_PROGRESS,20),h(S.FOR_REVIEW,17),h(S.VERIFIED,16)] },
  ].map(t => normTask(Object.assign({_demo:true}, t)));
  Store.persist();
}

/* ---------- wiring ------------------------------------------------------- */
$('btnNewTask').addEventListener('click', assignForm);
$('btnNewUser').addEventListener('click', () => userForm(null));
$('fSearch').addEventListener('input', e => { F.q = e.target.value; render(); });
$('fAssignee').addEventListener('change', e => { F.assignee = e.target.value; render(); });
$('fStatus').addEventListener('change', e => { F.status = e.target.value; render(); });
$('fPriority').addEventListener('change', e => { F.priority = e.target.value; render(); });
$('fOverdue').addEventListener('change', e => { F.overdue = e.target.checked; render(); });
document.querySelectorAll('.dbx-mode').forEach(b => b.addEventListener('click', () => {
  MODE = b.dataset.mode;
  document.querySelectorAll('.dbx-mode').forEach(x =>
    x.classList.toggle('bg-white', x === b) || x.classList.toggle('shadow-sm', x === b));
  document.querySelectorAll('.dbx-mode').forEach(x => {
    x.classList.toggle('bg-white', x === b);
    x.classList.toggle('shadow-sm', x === b);
    x.classList.toggle('text-gray-900', x === b);
    x.classList.toggle('text-gray-500', x !== b);
  });
  render();
}));
document.querySelector('.dbx-mode[data-mode="board"]').classList.add('bg-white','shadow-sm','text-gray-900');
document.querySelector('.dbx-mode[data-mode="list"]').classList.add('text-gray-500');

/* ---------- public API --------------------------------------------------- */
window.DomeBoxApp = {
  /** Who is using the app. Everything the UI offers is derived from this. */
  signIn: function(actor){
    const known = Store.user(actor.username);
    Store.actor = { username: actor.username,
      role: actor.role || (known && known.role) || ROLE.DOER,
      name: actor.name || (known && known.name) || actor.username };
    if (!known) Store.users.push(normUser(Store.actor));
    render();
    return this;
  },
  /** Point it at your Apps Script backend. All three functions are optional and
   *  may return promises; without them everything persists to localStorage. */
  setBackend: function(b){ Store.backend = b; return this; },
  setCompany: function(id){ Store.company = id || 'domebox'; return this; },
  /** The tenant's plan decides the caps and which features are offered. */
  setPlan: function(p){ Store.plan = DomeBoxPlans.normalizePlan(p); render(); return this; },
  usage: function(){ return DomeBoxPlans.planUsage(Store.plan, Store.active().length,
    DomeBoxPlans.tasksCreatedInMonth(Store.tasks, new Date())); },
  /**
   * The one entry point. Nothing loads until this is called, so a backend is
   * always attached before any data exists.
   *   DomeBoxApp.start({ company:'acme', backend:{...} })   // live
   *   DomeBoxApp.start({ demo:true })                       // sales demo
   * Pass demo:true ONLY on a sandbox. It is the only thing that creates sample
   * rows, and those rows are refused by any backend write.
   */
  start: function(opts){
    opts = opts || {};
    if (opts.company) Store.company = opts.company;
    /* A demo exists to show the whole product, and the sample company has six
       people — on the Free tier's five-user cap the first click would be an
       upgrade wall. A live tenant with no plan given stays on Free, which is the
       safe default there. */
    if (opts.plan) Store.plan = DomeBoxPlans.normalizePlan(opts.plan);
    else if (opts.demo === true) Store.plan = 'Pro Yearly';
    if (opts.backend) Store.backend = opts.backend;
    /* Load BEFORE signing in. signIn() adds the actor to the roster, and an
       actor sitting in the roster would make the store look non-empty and
       suppress the demo seed. */
    const self = this;
    return Promise.resolve(Store.load({ demo: opts.demo === true }))
      .then(function(){ if (opts.actor) self.signIn(opts.actor); });
  },
  load: function(opts){ return Store.load(opts || {}); },
  open: function(){ render(); },
  refresh: render,
  data: function(){ return { users: Store.users, tasks: Store.tasks }; },
  /** Wipe the local demo — useful once real data is wired in. */
  resetDemo: function(){ try { localStorage.removeItem(Store.key()); } catch(e){}
    Store.users = []; Store.tasks = []; return Store.load(); },
  _closeModal: closeModal, _closeDrawer: closeDrawer,
  /* Exposed so the workflow can be driven headlessly in tests and by a backend
     that needs to apply a transition it received from another client. */
  _test: { applyTransition, spawnNext, Store },
};

/* Deliberately no auto-load. Call DomeBoxApp.start() once you know who is
   signed in and where the data lives. */
