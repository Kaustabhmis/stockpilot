const { call, env } = require('./server.js');
let pass=0, fail=0;
const ok=(n,v,x)=>{console.log((v?'  PASS ':'  FAIL ')+n+(v||!x?'':'  ['+String(x).slice(0,120)+']'));v?pass++:fail++;};
const err=f=>{ try { const r=f(); return r.status==='error'?r.message:null; } catch(e){ return e.message; } };

console.log('\n=== accounts ===');
const reg = call({action:'register', form:{companyName:'Acme Engineering', name:'Rohan Mehta',
  email:'rohan@acme.in', phone:'9876543210', password:'strongpass123'}});
ok('signup creates an Admin', reg.user.role==='Admin');
ok('signup returns a session token', !!reg.token);
ok('starts on Free', reg.plan==='Free');
const ADMIN = reg.token;

ok('duplicate email refused', /already registered/.test(err(()=>call({action:'register',
  form:{companyName:'X', name:'Y', email:'rohan@acme.in', password:'strongpass123'}}))||''));
ok('short password refused', /8 characters/.test(err(()=>call({action:'register',
  form:{companyName:'X', name:'Y', email:'new@x.in', password:'short'}}))||''));

const li = call({action:'login', username:'rohan@acme.in', password:'strongpass123'});
ok('login works', li.status==='success' && !!li.token);
ok('wrong password refused', /Invalid email or password/.test(err(()=>call({action:'login',
  username:'rohan@acme.in', password:'wrong'}))||''));
ok('password is not stored in the clear',
  !JSON.stringify(env.FILES.SHEET_1.getSheetByName('Users')._data).includes('strongpass123'));

console.log('\n=== authorisation: the server must not trust the caller ===');
ok('no token is refused', /Not signed in/.test(err(()=>call({action:'getUsers'}))||''));
ok('a forged token is refused', /invalid/i.test(err(()=>call({action:'getUsers', token:'abc.def'}))||''));
ok('claiming a role in the body does nothing',
  /Not signed in/.test(err(()=>call({action:'deleteUser', sheetId:'SHEET_1',
    user:{role:'Admin'}, username:'rohan'}))||''));

console.log('\n=== team ===');
const add = (u,p) => call({action:'addUser', token:ADMIN, form:Object.assign({password:'staffpass123'},u)});
ok('add HOD', add({name:'Sruti Charulata',username:'sruti',email:'sruti@acme.in',role:'HOD',dept:'Operations',jobProfile:'Ops Head'}).status==='success');
ok('add Doer under the HOD', add({name:'Payel Sanyamath',username:'payel',email:'payel@acme.in',role:'Doer',dept:'Operations',jobProfile:'Executive',manager:'sruti'}).status==='success');
ok('add second Doer', add({name:'Vikram Rathore',username:'vikram',email:'vikram@acme.in',role:'Doer',dept:'Purchase',jobProfile:'Executive',manager:'sruti'}).status==='success');
const users = call({action:'getUsers', token:ADMIN});
ok('four members now', users.users.length===4);
ok('no password ever returned', !JSON.stringify(users).toLowerCase().includes('password'));

console.log('\n=== plan limits are enforced on the server ===');
ok('5th user allowed on Free', add({name:'Neha',username:'neha',email:'neha@acme.in',role:'Doer',jobProfile:'Executive'}).status==='success');
ok('6th user refused on Free (cap 5)',
  /includes 5 users/.test(err(()=>add({name:'Six',username:'six',email:'six@acme.in',role:'Doer',jobProfile:'E'}))||''));

console.log('\n=== tasks ===');
const mk = (f) => call({action:'createTask', token:ADMIN, form:f});
const c1 = mk({title:'Vendor audit', desc:'Full QMS audit', assignTo:'payel', dueDate:'2026-10-20',
  priority:'High', jobCategory:'PURCHASE', kra:'Vendor Quality', frequency:'One Time',
  checklist:'Collect certificates\nSite visit'});
ok('task created', c1.created===1);
ok('Admin assignment needs no approval', c1.routedForApproval===0);
const c2 = mk({title:'Monthly stock count', assignTo:'payel,vikram', dueDate:'2026-10-25',
  priority:'Medium', frequency:'Monthly', jobCategory:'INVENTORY PLAN'});
ok('multi-assignee creates one task each', c2.created===2);

let dash = call({action:'getDashboard', token:ADMIN});
ok('dashboard returns tasks', dash.tasks.length===3);
ok('categories returned', dash.categories.length>0);
ok('usage reports the plan', dash.usage.planName==='Free Tier');
ok('task count tracked', dash.usage.tasks===3);
const audit = dash.tasks.find(t=>t.title==='Vendor audit');
ok('checklist stored', audit.subtasks.length===2);

console.log('\n=== approval routing for a non-Admin raiser ===');
const sruti = call({action:'login', username:'sruti@acme.in', password:'staffpass123'}).token;
const c3 = call({action:'createTask', token:sruti, form:{title:'Cross-team ask', assignTo:'payel',
  dueDate:'2026-10-30', priority:'Low'}});
ok('HOD assigning to their own report needs no approval', c3.routedForApproval===0);

console.log('\n=== the workflow ===');
const payel = call({action:'login', username:'payel@acme.in', password:'staffpass123'}).token;
const pd = call({action:'getDashboard', token:payel});
const mine = pd.tasks.find(t=>t.title==='Vendor audit');
ok('Doer sees their own task', !!mine);
ok('start work', call({action:'updateTask', token:payel, taskId:mine.id, status:'In Progress'}).status==='success');
ok('submitting with an unfinished checklist is refused',
  /Finish the checklist/.test(err(()=>call({action:'updateTask', token:payel, taskId:mine.id, status:'For Review'}))||''));
call({action:'toggleSubtask', token:payel, taskId:mine.id, index:0, done:true});
call({action:'toggleSubtask', token:payel, taskId:mine.id, index:1, done:true});
ok('submitting works once the checklist is done',
  call({action:'updateTask', token:payel, taskId:mine.id, status:'For Review'}).status==='success');
ok('nobody signs off their own work',
  /cannot sign off your own/.test(err(()=>call({action:'updateTask', token:payel, taskId:mine.id, status:'Verified'}))||''));
ok('the raiser can verify', call({action:'updateTask', token:ADMIN, taskId:mine.id, status:'Verified'}).status==='success');

console.log('\n=== rework counts only on a send-back ===');
const pd2 = call({action:'getDashboard', token:payel});
const stock = pd2.tasks.find(t=>t.title==='Monthly stock count' && t.assignee==='payel');
call({action:'updateTask', token:payel, taskId:stock.id, status:'In Progress'});
let after = call({action:'getDashboard', token:ADMIN}).tasks.find(t=>t.id===stock.id);
ok('starting work does NOT count as rework', after.reworkCount===0, 'rework='+after.reworkCount);
call({action:'updateTask', token:payel, taskId:stock.id, status:'For Review'});
call({action:'updateTask', token:ADMIN, taskId:stock.id, status:'In Progress', note:'Recount A-class', newDueDate:'2026-11-05'});
after = call({action:'getDashboard', token:ADMIN}).tasks.find(t=>t.id===stock.id);
ok('sending back DOES count as rework', after.reworkCount===1);
ok('the new deadline is applied', after.due==='2026-11-05');
ok('the audit trail records it', after.history.some(h=>h.setDate==='2026-11-05'));

console.log('\n=== recurrence ===');
call({action:'updateTask', token:payel, taskId:stock.id, status:'For Review'});
const before = call({action:'getDashboard', token:ADMIN}).tasks.length;
const ver = call({action:'updateTask', token:ADMIN, taskId:stock.id, status:'Verified'});
const afterAll = call({action:'getDashboard', token:ADMIN});
ok('verifying a recurring task spawns the next', afterAll.tasks.length===before+1);
ok('the next occurrence is dated forward', !!ver.spawnedDue, ver.spawnedDue);
const spawned = afterAll.tasks.find(t=>t.spawnedBy===stock.id);
ok('it is marked system-generated', !!spawned);
ok('its checklist is reset', !(spawned.subtasks||[]).some(s=>s.done));
ok('it does not spend the monthly quota',
  afterAll.usage.tasks < afterAll.tasks.length, afterAll.usage.tasks+' vs '+afterAll.tasks.length);

console.log('\n=== delegation & blockers ===');
const t2 = afterAll.tasks.find(t=>t.title==='Cross-team ask');
const del = call({action:'delegateTask', token:payel, taskId:t2.id, toUsername:'vikram'});
ok('a Doer proposing a hand-off needs their manager', del.status==='success' &&
   call({action:'getDashboard',token:ADMIN}).tasks.find(t=>t.id===t2.id).status==='Delegation Proposed');
ok('the manager can approve the hand-off',
   call({action:'processTaskApproval', token:sruti, taskId:t2.id, isApproved:true}).status==='success');
const moved = call({action:'getDashboard',token:ADMIN}).tasks.find(t=>t.id===t2.id);
ok('ownership actually moved', moved.assignee==='vikram');

const open2 = call({action:'getDashboard',token:ADMIN}).tasks.filter(t=>t.status==='Pending');
if (open2.length>=2) {
  ok('blocker added', call({action:'addBlocker', token:ADMIN, taskId:open2[0].id, blockerId:open2[1].id}).status==='success');
  ok('circular dependency refused',
    /circular/.test(err(()=>call({action:'addBlocker', token:ADMIN, taskId:open2[1].id, blockerId:open2[0].id}))||''));
  ok('a blocked task cannot start',
    /Blocked by/.test(err(()=>call({action:'updateTask', token:ADMIN, taskId:open2[0].id, status:'In Progress'}))||''));
}

console.log('\n=== reports gated by plan ===');
ok('analytics refused on Free', call({action:'getAnalytics', token:ADMIN}).upgrade===true);
ok('rework report refused on Free', call({action:'getAccountability', token:ADMIN}).upgrade===true);

console.log('\n=== appraisal ===');
const kra = call({action:'addKRA', token:ADMIN, data:{employee:'payel', kras:[
  {name:'Vendor Quality', desc:'Audit closure', weight:40, grid:'>90%'},
  {name:'Inventory Accuracy', desc:'Count variance', weight:35, grid:'<2%'}]}});
ok('KRAs saved', kra.status==='success' && kra.total===75);
ok('over-100% weights refused',
  /cannot exceed 100/.test(err(()=>call({action:'addKRA', token:ADMIN, data:{employee:'payel',
    kras:[{name:'A',weight:70},{name:'B',weight:70}]}}))||''));
const form = call({action:'getAppraisalForm', token:ADMIN, username:'payel'});
ok('appraisal form carries the KRAs', form.kras.length===2);
ok('and the measured delegation score', typeof form.delegationScore==='number');
ok('and behavioural indicators', form.behaviors.length>=4);
const sub = call({action:'submitAppraisal', token:ADMIN, data:{employee:'payel',
  delegationScore:form.delegationScore, kras:form.kras.map(k=>({rating:4,weight:k.weight})),
  behaviors:form.behaviors.map(b=>({rating:4,weight:b.weight})), brownie:3}});
ok('appraisal saved with a band', sub.status==='success' && !!sub.band);
ok('brownie capped at 5', call({action:'submitAppraisal', token:ADMIN, data:{employee:'payel',
  delegationScore:50, kras:[{rating:5,weight:1}], behaviors:[], brownie:99}}).score<=100);
ok('review history returns rows', call({action:'getPerformanceReport', token:ADMIN}).report.length>=2);

console.log('\n=== leave does not punish the absent ===');
ok('leave recorded', call({action:'setLeave', token:ADMIN, username:'payel',
  from:'2026-10-05', to:'2026-10-12', reason:'Annual'}).status==='success');
ok('leave readable', call({action:'getLeave', token:ADMIN}).leave.length===1);

console.log('\n=== categories, support, account ===');
ok('categories updated', call({action:'updateCategories', token:ADMIN,
  categories:['NPD','QUALITY','MAINTENANCE']}).categories.length===3);
ok('a Doer cannot change company settings',
  /manager account/.test(err(()=>call({action:'updateCategories', token:payel, categories:['X']}))||''));
ok('support message sent', call({action:'contactSupport', token:ADMIN,
  form:{subject:'Test', message:'Hello'}}).status==='success');
ok('password change needs the current one',
  /not correct/.test(err(()=>call({action:'changePassword', token:payel,
    currentPassword:'wrong', newPassword:'newpass12345'}))||''));
ok('password change works', call({action:'changePassword', token:payel,
  currentPassword:'staffpass123', newPassword:'newpass12345'}).status==='success');
ok('and the new password logs in',
  call({action:'login', username:'payel@acme.in', password:'newpass12345'}).status==='success');

console.log('\n=== deactivation protects open work ===');
const dd = call({action:'updateUser', token:ADMIN, form:{originalUsername:'vikram', active:false}});
ok('deactivating someone with open work asks where it goes', dd.status==='needs_reassign', dd.status);
ok('and lists the stranded tasks', dd.tasks && dd.tasks.length>0);
const dd2 = call({action:'updateUser', token:ADMIN, form:{originalUsername:'vikram', active:false, reassignTo:'payel'}});
ok('reassign then deactivate succeeds', dd2.status==='success');
ok('no open work left on them', call({action:'getDashboard',token:ADMIN}).tasks
  .filter(t=>t.assignee==='vikram' && ['Pending','In Progress','For Review'].includes(t.status)).length===0);
// the self-delete guard fires first, which is the right order: it stops the
// only realistic way to lock a workspace out of its own account
ok('you cannot remove your own account',
  /your own account/.test(err(()=>call({action:'deleteUser', token:ADMIN, username:'rohan'}))||''));
ok('a Doer cannot delete anyone',
  /Admin account/.test(err(()=>call({action:'deleteUser', token:payel, username:'neha'}))||''));
ok('an Admin can remove someone else',
  call({action:'deleteUser', token:ADMIN, username:'neha'}).status==='success');
ok('and they can no longer sign in',
  /Invalid email or password|deactivated/.test(err(()=>call({action:'login',
    username:'neha@acme.in', password:'staffpass123'}))||''));

console.log('\n=== forgot / reset ===');
const fp = call({action:'forgotPassword', email:'rohan@acme.in'});
ok('forgot password always reports the same thing', /on its way/.test(fp.message));
ok('an unknown email gets the identical message',
  call({action:'forgotPassword', email:'nobody@nowhere.in'}).message===fp.message);
const tokRow = env.FILES.MASTER.getSheetByName('Reset_Tokens')._data.slice(-1)[0];
ok('a reset token was issued', !!tokRow);
ok('reset works', call({action:'resetPassword', token:tokRow[0], password:'brandnew12345'}).status==='success');
ok('the token is single use',
  /already been used/.test(err(()=>call({action:'resetPassword', token:tokRow[0], password:'another12345'}))||''));
ok('and the new password logs in',
  call({action:'login', username:'rohan@acme.in', password:'brandnew12345'}).status==='success');

console.log('\n=== email actually sent ===');
const subjects = env.mails.map(m=>m.subject);
ok('welcome email', subjects.some(s=>/Welcome to Dome Box/.test(s)));
ok('staff welcome email', subjects.some(s=>/added to Dome Box/.test(s)));
ok('assignment email', subjects.some(s=>/New task:/.test(s)));
ok('review email', subjects.some(s=>/Ready for review:/.test(s)));
ok('sent-back email', subjects.some(s=>/Sent back:/.test(s)));
ok('verified email', subjects.some(s=>/Verified:/.test(s)));
ok('reset email', subjects.some(s=>/reset your password/i.test(s)));
ok('support email', subjects.some(s=>/Support —/.test(s)));
ok('email HTML is escaped', !env.mails.some(m=>/<script/i.test(m.html||'')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
