/* Seeds a realistic manufacturing SME over the HTTP harness, so the screenshots
   show the product with work in it rather than an empty shell. */
const http = require('http');
const post = body => new Promise((res, rej) => {
  const d = JSON.stringify(body);
  const r = http.request({ host:'localhost', port:8095, path:'/exec', method:'POST',
    headers:{'Content-Type':'text/plain','Content-Length':Buffer.byteLength(d)} }, s => {
    let b=''; s.on('data',c=>b+=c); s.on('end',()=>{ try{res(JSON.parse(b));}catch(e){rej(e);} });
  });
  r.on('error', rej); r.write(d); r.end();
});

(async () => {
  const RUN = Date.now().toString(36);
  const email = 'rohan+' + RUN + '@acme.in';
  const reg = await post({action:'register', form:{companyName:'Acme Engineering',
    name:'Rohan Mehta', email, phone:'9876543210', password:'strongpass123'}});
  const A = reg.token;

  // Put this demo tenant on Pro before adding people: Free caps at 5 users and
  // this company has 6, which the server correctly refuses.
  await new Promise((res, rej) => http.get(
    'http://localhost:8095/__setplan?email=' + encodeURIComponent(email) + '&plan=Yearly',
    r => { r.resume(); r.on('end', res); }).on('error', rej));

  const people = [
    ['Sruti Charulata','sruti','HOD','Operations','Ops Head',''],
    ['Imran Qureshi','imran','HOD','Quality','Quality Head',''],
    ['Payel Sanyamath','payel','Doer','Operations','Executive','sruti'],
    ['Vikram Rathore','vikram','Doer','Purchase','Executive','sruti'],
    ['Neha Bhandari','neha','Doer','Quality','Executive','imran'],
  ];
  for (const [name,u,role,dept,profile,mgr] of people) {
    await post({action:'addUser', token:A, form:{ name, username:u+'-'+RUN,
      email:u+'+'+RUN+'@acme.in', role, dept, jobProfile:profile,
      manager: mgr ? mgr+'-'+RUN : '', password:'staffpass123' }});
  }
  const U = n => n + '-' + RUN;

  const ymd = n => { const d=new Date(); d.setDate(d.getDate()+n);
    return d.toISOString().slice(0,10); };

  const tasks = [
    ['Vendor audit — Shakti Engineering','Full QMS audit before the annual rate contract.',
     U('vikram'), ymd(-3),'High','PURCHASE','Vendor Quality','One Time','Collect ISO certificates\nSite visit\nScore against checklist'],
    ['Monthly stock reconciliation','Physical count against the system for all A-class items.',
     U('payel'), ymd(2),'Medium','INVENTORY PLAN','Inventory Accuracy','Monthly',''],
    ['Rejection analysis — Line 2','Root-cause the 4.2% rejection spike.',
     U('neha'), ymd(4),'High','PQC','Rejection Control','One Time',''],
    ['AMC renewal — compressors','',U('vikram'), ymd(14),'Low','MAINTENANCE','Cost Savings','Yearly',''],
    ['Operator training — new PDI checklist','',U('neha'), ymd(9),'Medium','HR','Capability Building','One Time',''],
    ['Customer complaint closure — Batch 88','',U('payel'), ymd(-8),'High','CRM','Customer Satisfaction','One Time',''],
    ['Weekly line balancing review','',U('payel'), ymd(-1),'Medium','Production','Process Compliance','Weekly',''],
    ['Calibration of torque wrenches','',U('neha'), ymd(6),'Medium','Quality','Process Compliance','Quarterly',''],
  ];
  const ids = {};
  for (const [title,desc,to,due,pri,cat,kra,freq,chk] of tasks) {
    await post({action:'createTask', token:A, form:{ title, desc, assignTo:to, dueDate:due,
      priority:pri, jobCategory:cat, kra, frequency:freq, checklist:chk }});
  }

  let d = await post({action:'getDashboard', token:A});
  const by = t => { const x = d.tasks.find(y => y.title.indexOf(t) === 0);
    if (!x) throw new Error('seed: no task starting with "' + t + '" — have: ' +
      d.tasks.map(y=>y.title).join(' | ')); return x; };
  const tok = {};
  for (const [,u] of people.map(p=>[p[0],p[1]])) {
    const r = await post({action:'login', username:u+'+'+RUN+'@acme.in', password:'staffpass123'});
    tok[u] = r.token;
  }

  // Move work into a realistic spread of states.
  const audit = by('Vendor audit');
  await post({action:'updateTask', token:tok.vikram, taskId:audit.id, status:'In Progress'});
  await post({action:'toggleSubtask', token:tok.vikram, taskId:audit.id, index:0, done:true});
  await post({action:'toggleSubtask', token:tok.vikram, taskId:audit.id, index:1, done:true});

  const stock = by('Monthly stock');
  await post({action:'updateTask', token:tok.payel, taskId:stock.id, status:'In Progress'});
  await post({action:'updateTask', token:tok.payel, taskId:stock.id, status:'For Review'});

  const complaint = by('Customer complaint');
  await post({action:'updateTask', token:tok.payel, taskId:complaint.id, status:'In Progress'});
  await post({action:'updateTask', token:tok.payel, taskId:complaint.id, status:'For Review'});
  await post({action:'updateTask', token:A, taskId:complaint.id, status:'In Progress',
    note:'Root cause is not evidenced — please attach the 5-why.', newDueDate:ymd(1)});
  await post({action:'updateTask', token:tok.payel, taskId:complaint.id, status:'For Review'});
  await post({action:'updateTask', token:A, taskId:complaint.id, status:'Verified'});

  const line = by('Weekly line balancing');
  await post({action:'updateTask', token:tok.payel, taskId:line.id, status:'In Progress'});
  await post({action:'updateTask', token:tok.payel, taskId:line.id, status:'For Review'});
  await post({action:'updateTask', token:A, taskId:line.id, status:'Verified'});

  const rej = by('Rejection analysis');
  await post({action:'addBlocker', token:A, taskId:rej.id, blockerId:audit.id});

  // A Doer proposing a hand-off, waiting on their manager.
  const amc = by('AMC renewal');
  await post({action:'delegateTask', token:tok.vikram, taskId:amc.id, toUsername:U('payel')});

  // KRAs and one completed appraisal so Reports has something to show.
  await post({action:'addKRA', token:A, data:{ employee:U('payel'), kras:[
    {name:'Inventory Accuracy', desc:'Count variance under 2%', weight:35, grid:'<2%'},
    {name:'Customer Satisfaction', desc:'Complaints closed within SLA', weight:35, grid:'>90%'},
    {name:'Process Compliance', desc:'Audit findings closed', weight:30, grid:'100%'}]}});
  const form = await post({action:'getAppraisalForm', token:A, username:U('payel')});
  await post({action:'submitAppraisal', token:A, data:{ employee:U('payel'),
    delegationScore:form.delegationScore,
    kras:form.kras.map(k=>({rating:4,weight:k.weight})),
    behaviors:form.behaviors.map(b=>({rating:4,weight:b.weight})), brownie:3 }});

  await post({action:'setLeave', token:A, username:U('neha'), from:ymd(1), to:ymd(5), reason:'Annual leave'});

  console.log(JSON.stringify({ email, run:RUN, tasks:(await post({action:'getDashboard', token:A})).tasks.length }));
})().catch(e => { console.error('SEED FAILED', e.message); process.exit(1); });
