/* Seeds a realistic manufacturing SME with everything the newer features need:
   uneven workloads (so the load-credited score is visible), a running project,
   cookie points, KRAs with targets, and a held review. */
const http = require('http');
const post = (body) => new Promise((res, rej) => {
  const d = JSON.stringify(body);
  const r = http.request({ host: 'localhost', port: 8095, path: '/exec', method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(d) } }, (s) => {
    let b = ''; s.on('data', (c) => b += c); s.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  });
  r.on('error', rej); r.write(d); r.end();
});
const hit = (path) => new Promise((res, rej) =>
  http.get('http://localhost:8095' + path, (r) => { r.resume(); r.on('end', res); }).on('error', rej));
const ymd = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

(async () => {
  const RUN = Date.now().toString(36);
  const email = 'rohan+' + RUN + '@acme.in';
  const A = (await post({ action: 'register', form: { companyName: 'Acme Engineering',
    name: 'Rohan Mehta', email, phone: '9876543210', password: 'strongpass123' } })).token;
  await hit('/__setplan?email=' + encodeURIComponent(email) + '&plan=Yearly');

  const U = (n) => n + '-' + RUN;
  const people = [
    ['Sruti Charulata', 'sruti', 'HOD', 'Operations', 'Ops Head', ''],
    ['Imran Qureshi', 'imran', 'HOD', 'Quality', 'Quality Head', ''],
    ['Payel Sanyamath', 'payel', 'Doer', 'Operations', 'Executive', 'sruti'],
    ['Vikram Rathore', 'vikram', 'Doer', 'Purchase', 'Executive', 'sruti'],
    ['Neha Bhandari', 'neha', 'Doer', 'Quality', 'Executive', 'imran'],
  ];
  const me = (await post({ action: 'getUsers', token: A })).users.find((u) => u.role === 'Admin').username;
  for (const [name, u, role, dept, profile, mgr] of people) {
    await post({ action: 'addUser', token: A, form: { name, username: U(u), email: u + '+' + RUN + '@acme.in',
      role, dept, jobProfile: profile, manager: mgr ? U(mgr) : me, password: 'staffpass123' } });
  }
  const tok = {};
  for (const [, u] of people) tok[u] = (await post({ action: 'login',
    username: u + '+' + RUN + '@acme.in', password: 'staffpass123' })).token;

  const mk = (f) => post({ action: 'createTask', token: A, form: f });
  const dash = async () => (await post({ action: 'getDashboard', token: A })).tasks;
  const by = async (t) => (await dash()).find((x) => x.title.indexOf(t) === 0);
  const move = (who, id, status, note, newDueDate) =>
    post({ action: 'updateTask', token: who, taskId: id, status, note, newDueDate });

  /* Payel carries a real load and mostly hits it. Vikram has one easy job. The
     two of them side by side are the whole point of the scoring change. */
  const payelWork = [
    ['Monthly stock reconciliation', 'Physical count against the system for all A-class items.', 'INVENTORY PLAN', 'Inventory Accuracy', 'High', -2],
    ['Customer complaint closure — Batch 88', '', 'CRM', 'Customer Satisfaction', 'High', -8],
    ['Weekly line balancing review', '', 'Production', 'Process Compliance', 'Medium', -1],
    ['Layout revision — assembly bay', '', 'SYSTEM IMPLEMENTATION', 'Process Compliance', 'Medium', -5],
    ['Costing review — Q3 variances', '', 'PURCHASE', 'Cost Savings', 'High', -4],
    ['Supplier CAPA — Shakti', '', 'SUPPLIER', 'Vendor Quality', 'Medium', -6],
  ];
  for (const [title, desc, cat, kra, pri, due] of payelWork) {
    await mk({ title, desc, assignTo: U('payel'), dueDate: ymd(due), priority: pri, jobCategory: cat, kra });
    const t = await by(title);
    await move(tok.payel, t.id, 'In Progress');
    await move(tok.payel, t.id, 'For Review');
    await move(A, t.id, 'Verified');
  }
  await mk({ title: 'PDI checklist update', assignTo: U('vikram'), dueDate: ymd(3),
    priority: 'Low', jobCategory: 'PDI', kra: 'Process Compliance' });
  {
    const t = await by('PDI checklist update');
    await move(tok.vikram, t.id, 'In Progress');
    await move(tok.vikram, t.id, 'For Review');
    await move(A, t.id, 'Verified');
  }

  // Live work, in a believable spread of states.
  await mk({ title: 'Vendor audit — Shakti Engineering', desc: 'Full QMS audit before the annual rate contract.',
    assignTo: U('vikram'), dueDate: ymd(-3), priority: 'High', jobCategory: 'PURCHASE', kra: 'Vendor Quality',
    checklist: 'Collect ISO certificates\nSite visit\nScore against checklist' });
  await mk({ title: 'Rejection analysis — Line 2', desc: 'Root-cause the 4.2% rejection spike.',
    assignTo: U('neha'), dueDate: ymd(4), priority: 'High', jobCategory: 'PQC', kra: 'Rejection Control' });
  await mk({ title: 'Calibration of torque wrenches', assignTo: U('neha'), dueDate: ymd(6),
    priority: 'Medium', jobCategory: 'Quality', kra: 'Process Compliance', frequency: 'Quarterly' });
  await mk({ title: 'AMC renewal — compressors', assignTo: U('vikram'), dueDate: ymd(14),
    priority: 'Low', jobCategory: 'MAINTENANCE', kra: 'Cost Savings', frequency: 'Yearly' });
  await mk({ title: 'Operator training — new PDI checklist', assignTo: U('neha'), dueDate: ymd(9),
    priority: 'Medium', jobCategory: 'HR', kra: 'Capability Building' });

  const audit = await by('Vendor audit');
  await move(tok.vikram, audit.id, 'In Progress');
  await post({ action: 'toggleSubtask', token: tok.vikram, taskId: audit.id, index: 0, done: true });
  await post({ action: 'toggleSubtask', token: tok.vikram, taskId: audit.id, index: 1, done: true });
  const rej = await by('Rejection analysis');
  await post({ action: 'addBlocker', token: A, taskId: rej.id, blockerId: audit.id });
  const amc = await by('AMC renewal');
  await post({ action: 'delegateTask', token: tok.vikram, taskId: amc.id, toUsername: U('payel') });

  // A review left sitting, so the responsiveness screens have something real.
  const train = await by('Operator training');
  await move(tok.neha, train.id, 'In Progress');
  await move(tok.neha, train.id, 'For Review');
  await hit('/__backdate?email=' + encodeURIComponent(email) +
            '&title=' + encodeURIComponent('Operator training — new PDI checklist') + '&days=9');

  // A project, one stage in.
  await post({ action: 'createProject', token: A, form: { name: 'Fixture line upgrade',
    jobCategory: 'NPD', gate: 'sequential', stages: [
      { title: 'Design the fixture', assignTo: U('payel'), dueDate: ymd(-6), priority: 'High' },
      { title: 'Fabricate and trial', assignTo: U('vikram'), dueDate: ymd(8), priority: 'High' },
      { title: 'Train the operators', assignTo: U('neha'), dueDate: ymd(18), priority: 'Medium' },
    ] } });
  const s1 = await by('Design the fixture');
  await move(tok.payel, s1.id, 'In Progress');
  await move(tok.payel, s1.id, 'For Review');
  await move(A, s1.id, 'Verified');

  // KRAs with real targets, and cookie points.
  await post({ action: 'saveKra', token: A, data: { employee: U('payel'), kras: [
    { item: 'Inventory Accuracy', desc: 'Count variance against the system', weight: 35,
      target: '2', unit: '%', direction: 'lower is better', measured: 'Monthly physical count' },
    { item: 'Customer Satisfaction', desc: 'Complaints closed within SLA', weight: 35,
      target: '90', unit: '%', direction: 'higher is better', measured: 'CRM closure report' },
    { item: 'Process Compliance', desc: 'Audit findings closed', weight: 30,
      target: '', unit: '', direction: 'on target', measured: 'Internal audit' }] } });
  await post({ action: 'awardCookie', token: tok.sruti, data: { employee: U('payel'), points: 4,
    reason: 'Stayed back to clear the audit list before the Shakti visit' } });
  await post({ action: 'awardCookie', token: A, data: { employee: U('sruti'), points: 2,
    reason: 'Held Operations together through the shutdown week' } });
  await post({ action: 'awardCookie', token: tok.imran, data: { employee: U('neha'), points: 1,
    reason: 'Spotted the torque drift before it reached the customer' } });

  await post({ action: 'setLeave', token: A, username: U('neha'), from: ymd(1), to: ymd(5),
    reason: 'Annual leave' });

  const form = await post({ action: 'getAppraisalForm', token: A, username: U('payel') });
  await post({ action: 'submitAppraisal', token: A, data: { employee: U('payel'),
    kras: form.kras.map((k) => ({ rating: 4, weight: k.weight })),
    behaviors: form.behaviors.map((b) => ({ rating: 4, weight: b.weight })), brownie: 3 } });

  console.log(JSON.stringify({ email, payel: 'payel+' + RUN + '@acme.in',
    sruti: 'sruti+' + RUN + '@acme.in', run: RUN }));
})().catch((e) => { console.error('SEED FAILED', e.message); process.exit(1); });
