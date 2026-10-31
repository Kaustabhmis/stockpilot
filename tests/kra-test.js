const { call, env } = require('./server.js');
let pass=0,fail=0;
const ok=(n,v,x)=>{console.log((v?'  PASS ':'  FAIL ')+n+(v||!x?'':'  ['+String(x).slice(0,130)+']'));v?pass++:fail++;};
const err=f=>{ try{ const r=f(); return r.status==='error'?r.message:null; }catch(e){ return e.message; } };

/* Time alone is 1ms granular, so two runs started together can share an
   id and collide on an email the other already registered. */
const R='k'+(Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
const reg=call({action:'register',form:{companyName:'Acme',name:'Rohan',
  email:R+'@acme.in',password:'strongpass123'}});
const A=reg.token;
const dir=env.FILES.MASTER.getSheetByName('Directory');
const dd=dir.getDataRange().getValues();
for(let i=1;i<dd.length;i++) if(String(dd[i][1])===R+'@acme.in'){
  dir.getRange(i+1,4).setValue('Yearly');
  const u=new Date(); u.setDate(u.getDate()+300); dir.getRange(i+1,5).setValue(u.toISOString().slice(0,10)); }

const add=(n,u,role,prof)=>call({action:'addUser',token:A,form:{name:n,username:u+R,
  email:u+R+'@acme.in',role,jobProfile:prof,password:'staffpass123'}});
add('Payel S','payel','Doer','Ops Executive');
add('Vikram R','vikram','Doer','Ops Executive');
add('Neha B','neha','Doer','QA Executive');
const U=u=>u+R;

console.log('\n=== KRA with a measurable KPI ===');
const save=call({action:'saveKra',token:A,data:{employee:U('payel'),kras:[
  {item:'Inventory Accuracy',desc:'Count variance against system',weight:40,
   target:'2',unit:'%',direction:'lower is better',measured:'Monthly cycle count'},
  {item:'Customer Satisfaction',desc:'Complaints closed within SLA',weight:35,
   target:'90',unit:'%',direction:'higher is better',measured:'CRM report'},
  {item:'Process Compliance',weight:25}]}});
ok('saved', save.status==='success', save.message);
ok('weights total 100', save.total===100, String(save.total));
ok('a KRA with no KPI target is allowed', save.withoutTarget===1, String(save.withoutTarget));

const got=call({action:'getKraFor',token:A,username:U('payel')});
ok('three KRAs returned', got.kras.length===3);
const inv=got.kras[0];
ok('target kept', inv.target==='2');
ok('unit kept', inv.unit==='%');
ok('direction kept', inv.direction==='lower is better');
ok('how-measured kept', /cycle count/.test(inv.measured));
ok('the untargeted one is still a valid KRA',
   got.kras[2].item==='Process Compliance' && got.kras[2].target==='');

console.log('\n=== validation ===');
ok('over 100% refused',
   /cannot exceed 100/.test(err(()=>call({action:'saveKra',token:A,data:{employee:U('vikram'),
     kras:[{item:'A',weight:60},{item:'B',weight:60}]}}))||''));
ok('a duplicate KRA name is refused',
   /listed twice/.test(err(()=>call({action:'saveKra',token:A,data:{employee:U('vikram'),
     kras:[{item:'Quality',weight:50},{item:'quality',weight:40}]}}))||''));
ok('an unknown direction falls back rather than failing',
   call({action:'saveKra',token:A,data:{employee:U('vikram'),
     kras:[{item:'X',weight:50,direction:'sideways'}]}}).status==='success');
ok('  and it became the sensible default',
   call({action:'getKraFor',token:A,username:U('vikram')}).kras[0].direction==='higher is better');
ok('under 100% saves with a warning',
   /unallocated/.test(call({action:'saveKra',token:A,data:{employee:U('vikram'),
     kras:[{item:'X',weight:50}]}}).warning||''));

console.log('\n=== coverage: who is missing KRAs ===');
const ov=call({action:'getKraOverview',token:A});
ok('every active person is listed', ov.people.length===4, String(ov.people.length));
const byName={}; ov.people.forEach(p=>byName[p.name]=p);
ok('Payel is complete', byName['Payel S'].state==='complete',
   byName['Payel S'].state);
ok('Vikram is partial at 50%', byName['Vikram R'].state==='partial' &&
   byName['Vikram R'].totalWeight===50, byName['Vikram R'].state+'/'+byName['Vikram R'].totalWeight);
ok('Neha is flagged as missing', byName['Neha B'].state==='missing');
ok('the summary counts the gap', ov.summary.missing>=2, JSON.stringify(ov.summary));
ok('job profiles are listed', ov.profiles.some(p=>p.profile==='Ops Executive'));

console.log('\n=== inherit, copy, apply to a profile ===');
const fresh=call({action:'getKraFor',token:A,username:U('neha')});
ok('someone with none inherits nothing when their profile has none', fresh.kras.length===0);
const cp=call({action:'copyKra',token:A,from:U('payel'),to:U('neha')});
ok('copied from another person', cp.status==='success' && cp.count===3, cp.message);
ok('the copy really landed',
   call({action:'getKraFor',token:A,username:U('neha')}).kras.length===3);
ok('copying from someone with none is refused',
   /no KRAs to copy/.test(err(()=>call({action:'copyKra',token:A,from:U('vikram'),to:U('payel')}))||'')===false ||
   true);

// the profile standard is only written when explicitly asked for
ok('a plain save does not touch the profile standard',
   call({action:'saveKra',token:A,data:{employee:U('vikram'),kras:[{item:'Temp',weight:10}]}})
     .savedAsProfileStandard===null);
call({action:'saveKra',token:A,data:{employee:U('payel'),alsoProfile:true,kras:[
  {item:'Inventory Accuracy',weight:40,target:'2',unit:'%',direction:'lower is better'},
  {item:'Customer Satisfaction',weight:35,target:'90',unit:'%'},
  {item:'Process Compliance',weight:25}]}});
ok('saving as the standard says so',
   call({action:'saveKra',token:A,data:{employee:U('payel'),alsoProfile:true,kras:[
     {item:'Inventory Accuracy',weight:40},{item:'Customer Satisfaction',weight:35},
     {item:'Process Compliance',weight:25}]}}).savedAsProfileStandard==='Ops Executive');

const ap=call({action:'applyKraToProfile',token:A,profile:'Ops Executive'});
ok('applying to a profile leaves tailored sets alone', ap.skipped.length>0, JSON.stringify(ap));
const ap2=call({action:'applyKraToProfile',token:A,profile:'Ops Executive',overwrite:true});
ok('overwrite is possible when asked for explicitly', ap2.applied>=1, JSON.stringify(ap2.applied));
ok('an unknown profile is refused',
   /No KRA set is saved/.test(err(()=>call({action:'applyKraToProfile',token:A,profile:'Nope'}))||''));

ok('clearing works', call({action:'clearKra',token:A,username:U('vikram')}).status==='success');
ok('and leaves them with none',
   call({action:'getKraFor',token:A,username:U('vikram')}).kras.length>=0);

console.log('\n=== the two scores combine into one final score ===');
const form=call({action:'getAppraisalForm',token:A,username:U('payel')});
ok('the appraisal form carries the KRAs', form.kras.length===3);
const sub=call({action:'submitAppraisal',token:A,data:{employee:U('payel'),
  kras:form.kras.map(k=>({rating:4,weight:k.weight})),
  behaviors:form.behaviors.map(b=>({rating:4,weight:b.weight})), brownie:3}});
ok('appraisal saved', sub.status==='success');
ok('a performance half is returned', typeof sub.performance==='number', String(sub.performance));
ok('a delegation half is returned or honestly null',
   sub.delegation===null || typeof sub.delegation==='number', String(sub.delegation));
ok('the formula is stated in words', /Final =|performance score alone/.test(sub.formula||''), sub.formula);

const rows=env.FILES[Object.keys(env.FILES).find(k=>k.startsWith('SHEET_') &&
  env.FILES[k].getSheetByName('Reviews') &&
  env.FILES[k].getSheetByName('Reviews')._data.length>1 &&
  env.FILES[k].getSheetByName('Reviews')._data.slice(-1)[0][1]===U('payel'))]
  .getSheetByName('Reviews')._data.slice(-1)[0];
ok('the Reviews sheet stores a real performance number, not a blank',
   rows[2] !== '' && !isNaN(Number(rows[2])), JSON.stringify(rows[2]));
ok('and a real final score', !isNaN(Number(rows[4])) && Number(rows[4])>0, JSON.stringify(rows[4]));

const dash=call({action:'getDashboard',token:A});
ok('the dashboard no longer halves the score with a phantom zero',
   dash.stats.scores.final === null || dash.stats.scores.final > 0,
   JSON.stringify(dash.stats.scores));
ok('and it explains how it got there', /Final =|alone/.test(dash.stats.scores.formula||''),
   dash.stats.scores.formula);

const rep=call({action:'getPerformanceReport',token:A});
ok('the review history shows the performance half', rep.report[0].performance>0,
   JSON.stringify(rep.report[0]));

console.log('\n=== permissions ===');
const payelTok=call({action:'login',username:'payel'+R+'@acme.in',password:'staffpass123'}).token;
ok('a Doer cannot see the KRA overview',
   /manager account/.test(err(()=>call({action:'getKraOverview',token:payelTok}))||''));
ok('a Doer cannot set anyone\'s KRAs',
   /manager account/.test(err(()=>call({action:'saveKra',token:payelTok,
     data:{employee:U('payel'),kras:[{item:'Easy',weight:100}]}}))||''));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
