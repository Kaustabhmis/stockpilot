const { call, env } = require('./server.js');
let pass=0,fail=0;
const ok=(n,v,x)=>{console.log((v?'  PASS ':'  FAIL ')+n+(v||!x?'':'  ['+String(x).slice(0,100)+']'));v?pass++:fail++;};
const err=f=>{ try{ const r=f(); return r.status==='error'?r.message:null; }catch(e){ return e.message; } };

const reg = call({action:'register', form:{companyName:'Delta Tools', name:'Ravi K',
  email:'ravi@delta.in', password:'strongpass123'}});
const A = reg.token;
call({action:'addUser', token:A, form:{name:'Meena S', username:'meena', email:'meena@delta.in',
  role:'Doer', jobProfile:'Executive', password:'staffpass123'}});

console.log('\n=== stop a recurring series ===');
call({action:'createTask', token:A, form:{title:'Weekly line check', assignTo:'meena',
  dueDate:'2026-10-20', frequency:'Weekly', priority:'Medium'}});
let d = call({action:'getDashboard', token:A});
const rec = d.tasks.find(t=>t.title==='Weekly line check');
ok('created as Weekly', rec.frequency==='Weekly');
ok('stop recurrence succeeds', call({action:'stopRecurringTask', token:A, taskId:rec.id}).status==='success');
d = call({action:'getDashboard', token:A});
ok('now One Time', d.tasks.find(t=>t.id===rec.id).frequency==='One Time');
const m = call({action:'login', username:'meena@delta.in', password:'staffpass123'}).token;
call({action:'updateTask', token:m, taskId:rec.id, status:'In Progress'});
call({action:'updateTask', token:m, taskId:rec.id, status:'For Review'});
const n0 = call({action:'getDashboard', token:A}).tasks.length;
call({action:'updateTask', token:A, taskId:rec.id, status:'Verified'});
ok('verifying a stopped series spawns nothing',
   call({action:'getDashboard', token:A}).tasks.length===n0);

console.log('\n=== archive after a week ===');
const sheet = env.FILES[Object.keys(env.FILES).find(k=>k.startsWith('SHEET_') &&
  env.FILES[k].getSheetByName('Tasks') &&
  env.FILES[k].getSheetByName('Tasks')._data.some(r=>r[3]==='Weekly line check'))];
const tasksSheet = sheet.getSheetByName('Tasks');
const row = tasksSheet._data.find(r=>r[3]==='Weekly line check');
const old = new Date(); old.setDate(old.getDate()-20);
row[12] = JSON.stringify([{date: old.toISOString(), status:'Verified', user:'Ravi K', note:''}]);
const dashAfter = call({action:'getDashboard', token:A});
ok('work closed 20 days ago leaves the board — the dashboard no longer carries it',
   !dashAfter.tasks.some(t=>t.title==='Weekly line check') && dashAfter.archivedCount>=1);
const after = call({action:'getArchive', token:A, q:'Weekly line check'}).tasks.find(t=>t.title==='Weekly line check');
ok('work closed 20 days ago is archived, and found in Archive', !!after && after.isArchived===true);
ok('and leaves the active counts alone',
   call({action:'getDashboard', token:A}).stats.completed===0);

console.log('\n=== read-only guards on a Doer ===');
call({action:'addUser', token:A, form:{name:'Kabir N', username:'kabir', email:'kabir@delta.in',
  role:'Doer', jobProfile:'Executive', password:'staffpass123'}});
ok('a Doer cannot hand work to a colleague',
   /Ask your manager/.test(err(()=>call({action:'createTask', token:m,
     form:{title:'x', assignTo:'kabir', dueDate:'2026-11-01'}}))||''));
// Multi-level assignment: raising work UPWARD is allowed, and waits for the
// senior person to accept it rather than landing on their list unannounced.
const up = call({action:'createTask', token:m,
  form:{title:'Need a PO signed', assignTo:'ravi', dueDate:'2026-11-01'}});
ok('but may raise work for their own manager', up.status==='success', up.message);
ok('which waits for that manager to accept it',
   (call({action:'getDashboard', token:A}).tasks.find(t=>t.title==='Need a PO signed')||{})
     .status==='Awaiting Approval');
ok('a Doer cannot add people',
   /manager account/.test(err(()=>call({action:'addUser', token:m,
     form:{name:'X', username:'x', email:'x@d.in', password:'strongpass123'}}))||''));
ok('a Doer cannot open an appraisal',
   /manager account/.test(err(()=>call({action:'getAppraisalForm', token:m, username:'meena'}))||''));
ok('a Doer cannot buy a plan',
   /Admin account/.test(err(()=>call({action:'initiateRazorpay', token:m, planName:'Yearly'}))||''));

console.log('\n=== tenants cannot see each other ===');
const other = call({action:'register', form:{companyName:'Zeta Ltd', name:'Zed',
  email:'zed@zeta.in', password:'strongpass123'}});
call({action:'createTask', token:other.token, form:{title:'Zeta secret work',
  assignTo:'zed', dueDate:'2026-11-01'}});
const mine = call({action:'getDashboard', token:A}).tasks.map(t=>t.title);
ok('one tenant never sees another\'s tasks', mine.indexOf('Zeta secret work')<0);
const zed = call({action:'getDashboard', token:other.token}).tasks.map(t=>t.title);
ok('and the reverse holds', zed.indexOf('Weekly line check')<0);
ok('every tenant file is private',
   Object.values(env.META).every(m=>m.sharing==='PRIVATE'), JSON.stringify(env.META));

console.log('\n=== plan names: the sheet\'s vocabulary must keep working ===');
/* The Directory sheet stores Free / Monthly / Yearly / Enterprise. normalizePlan
   falls back to the LEAST generous tier on an unknown name, so if these stopped
   resolving, every paying customer would be silently downgraded to Free the
   moment the new code read their row. */
const fs2 = require('fs'); const pm = {exports:{}};
new Function('module','exports', fs2.readFileSync('/home/user/stockpilot/domebox/plans.gs','utf8'))(pm, pm.exports);
const P = pm.exports;
/* Legacy rows keep the caps they were sold, but gain the full feature set:
   nobody should lose capability for having bought early. */
[['Yearly','Yearly',300,true],['Monthly','Monthly',20,true],['Free','Free',5,false],
 ['Enterprise','Enterprise',null,true]].forEach(([stored,want,users,analytics])=>{
  ok('stored "'+stored+'" resolves', P.normalizePlan(stored)===want, P.normalizePlan(stored));
  ok('  and keeps its user cap', P.planLimits(stored).users===users, String(P.planLimits(stored).users));
  ok('  and its reports entitlement', P.planAllows(stored,'analytics')===analytics);
});
[['Pro Yearly','Yearly'],['Standard','Monthly'],['Free Tier','Free'],['pro','Yearly'],
 ['PRO YEARLY','Yearly']].forEach(([shown,want])=>{
  ok('pricing-page name "'+shown+'" also resolves', P.normalizePlan(shown)===want, P.normalizePlan(shown));
});
ok('an unknown plan falls back to Free, never upward', P.normalizePlan('Platinum')==='Free');
ok('and that fallback is a real key', P.planLimits('Platinum').users===5);
ok('upgrade prompts name what the customer sees', P.nextPlanUp('Free')==='Starter', P.nextPlanUp('Free'));
ok('a legacy plan still points somewhere that fits', P.nextPlanUp('Monthly')==='Growth', P.nextPlanUp('Monthly'));
ok('and the largest legacy plan points at Enterprise', P.nextPlanUp('Yearly')==='Enterprise');

/* The ladder has to stay honest. The old Standard at 2,499/mo was 29,988 a
   year next to a Pro at 19,999 with fifteen times the users, so nobody who did
   the arithmetic ever bought it. Yearly is exactly ten times monthly. */
[['Starter','Starter Yearly',15],['Growth','Growth Yearly',50],['Scale','Scale Yearly',150]]
  .forEach(([m,y,users])=>{
  ok(m+': yearly is ten times monthly', P.PLANS[y].price === P.PLANS[m].price*10,
     P.PLANS[y].price+' vs '+P.PLANS[m].price);
  ok('  both bands hold '+users+' users', P.PLANS[m].users===users && P.PLANS[y].users===users);
  ok('  and a yearly payment buys a year', P.planTermDays(y)===365 && P.planTermDays(m)===30);
});
ok('every paid plan carries the whole product',
   P.offeredPlans().every(k=>P.PLANS[k].analytics && P.PLANS[k].kraForms && P.PLANS[k].whatsapp),
   P.offeredPlans().filter(k=>!P.PLANS[k].analytics).join(','));
ok('price per user falls as the band grows',
   P.PLANS['Scale'].price/P.PLANS['Scale'].users < P.PLANS['Growth'].price/P.PLANS['Growth'].users &&
   P.PLANS['Growth'].price/P.PLANS['Growth'].users < P.PLANS['Starter'].price/P.PLANS['Starter'].users);
ok('plans that are no longer sold are not offered to new buyers',
   P.offeredPlans().indexOf('Monthly')<0 && P.offeredPlans().indexOf('Yearly')<0,
   P.offeredPlans().join(','));
ok('the free tier is wide enough to show the product', P.PLANS.Free.tasksPerMonth===100);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
