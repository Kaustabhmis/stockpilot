const { call, env } = require('./server.js');
let pass=0,fail=0;
const ok=(n,v,x)=>{console.log((v?'  PASS ':'  FAIL ')+n+(v||!x?'':'  ['+String(x).slice(0,130)+']'));v?pass++:fail++;};
const err=f=>{ try{ const r=f(); return r.status==='error'?r.message:null; }catch(e){ return e.message; } };

const R=Date.now().toString(36);
const reg=call({action:'register',form:{companyName:'Acme',name:'Rohan',
  email:'r'+R+'@acme.in',password:'strongpass123'}});
const A=reg.token;
// Pro, so six people fit
const dir=env.FILES.MASTER.getSheetByName('Directory');
const dd=dir.getDataRange().getValues();
for(let i=1;i<dd.length;i++) if(String(dd[i][1])==='r'+R+'@acme.in'){
  dir.getRange(i+1,4).setValue('Yearly');
  const u=new Date(); u.setDate(u.getDate()+300); dir.getRange(i+1,5).setValue(u.toISOString().slice(0,10)); }

const add=(n,u,role,mgr,prof)=>call({action:'addUser',token:A,form:{name:n,username:u+R,
  email:u+R+'@acme.in',role,manager:mgr?mgr+R:'',jobProfile:prof||'Executive',password:'staffpass123'}});
add('Sruti Charulata','sruti','HOD','', 'Ops Head');
add('Imran Qureshi','imran','HOD','', 'Quality Head');
add('Payel Sanyamath','payel','Doer','sruti');
add('Vikram Rathore','vikram','Doer','sruti');
add('Neha Bhandari','neha','Doer','imran');
const tok=u=>call({action:'login',username:u+R+'@acme.in',password:'staffpass123'}).token;
const T={sruti:tok('sruti'),imran:tok('imran'),payel:tok('payel'),vikram:tok('vikram'),neha:tok('neha')};
const U=u=>u+R;
const due='2026-12-01';
const mk=(token,to,title)=>call({action:'createTask',token,form:{title,assignTo:U(to),dueDate:due,priority:'Medium'}});
const find=(token,title)=>call({action:'getDashboard',token}).tasks.find(t=>t.title===title);

console.log('\n=== an HOD can assign across departments, but the owner\'s manager decides ===');
const x1=mk(T.imran,'payel','Cross-dept ask');
ok('Quality HOD may assign to an Operations doer', x1.status==='success');
ok('and it is routed for approval', x1.routedForApproval===1);
let t1=find(A,'Cross-dept ask');
ok('it sits in Awaiting Approval', t1.status==='Awaiting Approval', t1.status);
ok('the approver is the DOER\'S OWN manager, not the raiser',
   t1.approver===U('sruti'), t1.approver);
ok('it is NOT yet on the doer\'s list',
   !call({action:'getDashboard',token:T.payel}).tasks.some(t=>t.title==='Cross-dept ask' && t.status==='Pending'));
ok('a different HOD cannot decide it',
   /Only .* can decide/.test(err(()=>call({action:'processTaskApproval',token:T.imran,
     taskId:t1.id,isApproved:true}))||''));
ok('the owner cannot approve their own incoming task',
   /Only .* can decide/.test(err(()=>call({action:'processTaskApproval',token:T.payel,
     taskId:t1.id,isApproved:true}))||''));
const okd=call({action:'processTaskApproval',token:T.sruti,taskId:t1.id,isApproved:true});
ok('their manager approves it', okd.status==='success');
t1=find(A,'Cross-dept ask');
ok('and now it is Pending on the doer\'s list', t1.status==='Pending', t1.status);
ok('the doer can see it', call({action:'getDashboard',token:T.payel})
   .tasks.some(t=>t.title==='Cross-dept ask'));

console.log('\n=== rejection must carry a remark ===');
const x2=mk(T.imran,'vikram','Doomed ask');
const t2=find(A,'Doomed ask');
ok('rejecting with no remark is refused',
   /remark saying why/.test(err(()=>call({action:'processTaskApproval',token:T.sruti,
     taskId:t2.id,isApproved:false}))||''));
ok('rejecting with only whitespace is refused',
   /remark saying why/.test(err(()=>call({action:'processTaskApproval',token:T.sruti,
     taskId:t2.id,isApproved:false,remarks:'   '}))||''));
const rej=call({action:'processTaskApproval',token:T.sruti,taskId:t2.id,isApproved:false,
  remarks:'Vikram is on the Shakti audit all week — raise it in November.'});
ok('rejecting with a remark succeeds', rej.status==='success');
const t2b=find(A,'Doomed ask');
ok('status is Rejected', t2b.status==='Rejected', t2b.status);
ok('the remark is in the audit trail',
   /Shakti audit all week/.test(JSON.stringify(t2b.history)));
ok('it never reaches the doer\'s active list',
   !call({action:'getDashboard',token:T.vikram}).tasks
     .some(t=>t.title==='Doomed ask' && ['Pending','In Progress'].includes(t.status)));
ok('the raiser is told why', env.mails.some(m=>/Rejected: Doomed ask/.test(m.subject)));
ok('and the email carries the remark',
   env.mails.filter(m=>/Rejected: Doomed ask/.test(m.subject))
     .some(m=>/Shakti audit all week/.test(m.html||'')));

console.log('\n=== a team member may raise work upward ===');
const up=mk(T.payel,'sruti','Please approve the capex note');
ok('a doer may assign to their own manager', up.status==='success', up.message);
let t3=find(T.payel,'Please approve the capex note');
ok('it waits for that manager to accept', t3.status==='Awaiting Approval', t3.status);
ok('the manager themselves decides, not their boss', t3.approver===U('sruti'), t3.approver);
ok('the manager accepts it',
   call({action:'processTaskApproval',token:T.sruti,taskId:t3.id,isApproved:true}).status==='success');
t3=find(T.sruti,'Please approve the capex note');
ok('and it lands on the manager\'s own list', t3.status==='Pending' && t3.assignee===U('sruti'));

const up2=mk(T.payel,'imran','Question for Quality');
ok('a doer may also raise work to any HOD', up2.status==='success');
ok('which that HOD accepts themselves',
   find(T.payel,'Question for Quality').approver===U('imran'));

console.log('\n=== but not sideways ===');
ok('a doer cannot assign to a peer',
   /manager or a department head/.test(err(()=>mk(T.payel,'vikram','Sideways task'))||''));
ok('a doer cannot assign to another department\'s doer',
   /manager or a department head/.test(err(()=>mk(T.payel,'neha','Sideways task 2'))||''));
ok('nothing was created', !find(A,'Sideways task'));
ok('a doer CAN assign to themselves',
   mk(T.payel,'payel','My own note').status==='success');
ok('and that needs nobody\'s approval',
   find(T.payel,'My own note').status==='Pending');

console.log('\n=== mixed batch: the allowed ones go, the rest are named ===');
const mixed=call({action:'createTask',token:T.payel,form:{title:'Mixed batch',
  assignTo:[U('sruti'),U('vikram')].join(','),dueDate:due,priority:'Low'}});
ok('the upward one is created', mixed.created===1, JSON.stringify(mixed.created));
ok('and the sideways one is reported, not silently dropped',
   mixed.refused.length===1 && /Vikram/.test(mixed.refused[0].name), JSON.stringify(mixed.refused));
ok('the message says who missed out', /Not sent to Vikram/.test(mixed.message), mixed.message);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
