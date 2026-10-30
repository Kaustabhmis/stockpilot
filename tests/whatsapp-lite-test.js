/**
 * WhatsApp through Maytapi, Domebox Lite only: one message when a task lands
 * on someone's list, one more two days before it is due. Never from the full
 * edition, never without the Script Properties, never twice for the same thing.
 */
const fs = require('fs');
const { build } = require('./gas-shim');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 260) + ']')); v ? pass++ : fail++; };
const pad = (n) => String(n).padStart(2, '0');
const day = (k) => { const d = new Date(); d.setDate(d.getDate() + k); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const MAYTAPI = { MAYTAPI_PRODUCT_ID: 'prod-123', MAYTAPI_TOKEN: 'tok-456', MAYTAPI_PHONE_ID: '789' };

function setup(file, withMaytapi) {
  const env = build();
  Object.assign(env.props, { MASTER_DB_ID: 'MASTER', TEMPLATE_ID: 'TEMPLATE', AUTH_PEPPER: 'a', TOKEN_SECRET: 'b' }, withMaytapi ? MAYTAPI : {});
  env.G.GmailApp.__setAliases(['info@biscsindia.com', 'mis@dynamicengineers.in']);
  env.newFile('MASTER', 'Master');
  const tpl = env.newFile('TEMPLATE', 'Template');
  ['Users', 'Tasks', 'KRA_Master', 'Reviews', 'Leave', 'Settings'].forEach((n) => tpl.insertSheet(n));
  tpl.getSheetByName('Settings').appendRow(['General']);
  const sent = [];
  let reply = { code: 200, body: '{"success":true,"data":{"msgId":"x"}}' };
  env.G.UrlFetchApp = { fetch: (url, o) => { sent.push({ url, o, body: JSON.parse(o.payload) });
    return { getResponseCode: () => reply.code, getContentText: () => reply.body }; } };
  const names = Object.keys(env.G);
  const X = new Function(...names, fs.readFileSync(__dirname + file, 'utf8') +
    '\n;return { doPost, ensureRegistry, waLiteDueReminders, switchOnSchedules, switchOnWhatsApp, waLiteTest, setupDomeBox, waLiteNumber_ };')(...names.map((n) => env.G[n]));
  X.ensureRegistry();
  const call = (b) => JSON.parse(X.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).getContent());
  const A = call({ action: 'register', form: { companyName: 'Acme', name: 'Owner', email: 'o@a.in', password: 'ownerpass123' } }).token;
  const add = (n, u, role, mgr, phone) => call({ action: 'addUser', token: A, form: { name: n, username: u, email: u + '@a.in', role, manager: mgr || '', jobProfile: 'Ops', password: 'staffpass123', phone: phone || '' } });
  add('Sruti', 'sruti', 'HOD', '', '9830000001');
  add('Payel', 'payel', 'Doer', 'sruti', '098300 12345');
  add('Arun', 'arun', 'HOD', '', '');
  add('Vikram', 'vikram', 'Doer', 'arun', '+91 98300-67890');
  add('Ravi', 'ravi', 'Doer', 'sruti', '');
  const T = (u) => call({ action: 'login', username: u + '@a.in', password: 'staffpass123' }).token;
  const tenant = Object.values(env.FILES).find((f) => f.getSheetByName && f.getSheetByName('Tasks') && f !== tpl);
  const log = () => { const sh = tenant.getSheetByName('WhatsApp_Log'); return sh ? sh.getDataRange().getValues().slice(1) : []; };
  const task = (title) => call({ action: 'getDashboard', token: A }).tasks.find((t) => t.title === title);
  return { env, X, call, A, S: T('sruti'), P: T('payel'), H: T('arun'), sent, log, task, setReply: (r) => { reply = r; } };
}

console.log('\n######## Domebox (full edition) ########');
{
  const f = setup('/../dist/code.gs', true);
  f.call({ action: 'createTask', token: f.S, form: { title: 'Full job', assignTo: 'payel', dueDate: day(2) } });
  ok('assigning a task sends nothing, even with the Maytapi properties set', f.sent.length === 0 && f.log().length === 0);
  ok('the daily job says it is Lite only, and sends nothing', /Lite only/.test(f.X.waLiteDueReminders()) && f.sent.length === 0);
  f.X.switchOnSchedules();
  ok('switchOnSchedules installs no WhatsApp job', !f.env.G.ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'waLiteDueReminders'));
  ok('setupDomeBox has no WhatsApp section', !/WHATSAPP \(MAYTAPI\)/.test(f.X.setupDomeBox()));
}

console.log('\n######## Domebox Lite, Maytapi not set up ########');
{
  const f = setup('/../dist/lite/Code.gs', false);
  const r = f.call({ action: 'createTask', token: f.S, form: { title: 'Quiet job', assignTo: 'payel', dueDate: day(2) } });
  ok('the task is created as before', r.status === 'success', JSON.stringify(r));
  ok('and nothing is sent or logged', f.sent.length === 0 && f.log().length === 0);
  ok('the daily job says what to add', /MAYTAPI_PRODUCT_ID, MAYTAPI_TOKEN and MAYTAPI_PHONE_ID/.test(f.X.waLiteDueReminders()) && f.sent.length === 0);
  ok('setupDomeBox marks it optional', /off\s+optional: add MAYTAPI_PRODUCT_ID/.test(f.X.setupDomeBox()));
}

console.log('\n######## Domebox Lite, with Maytapi ########');
{
  const f = setup('/../dist/lite/Code.gs', true);

  console.log('\n=== the first message, on assignment ===');
  f.call({ action: 'createTask', token: f.S, form: { title: 'Gate fabrication', assignTo: 'payel', dueDate: '2026-12-01' } });
  const g = f.task('Gate fabrication');
  const m = f.sent[0] || { o: { headers: {} }, body: {} };
  ok('one message is sent', f.sent.length === 1, f.sent.length);
  ok('to the Maytapi sendMessage address for this product and phone', m.url === 'https://api.maytapi.com/api/prod-123/789/sendMessage', m.url);
  ok('as a JSON POST with the token in x-maytapi-key', m.o.method === 'post' && m.o.contentType === 'application/json' && m.o.headers['x-maytapi-key'] === 'tok-456' && m.o.muteHttpExceptions === true);
  ok('to the number in Team, written as 91 + the mobile', m.body.to_number === '919830012345' && m.body.type === 'text', JSON.stringify(m.body));
  ok('naming the task, who gave it, and its reference', /New task for you/.test(m.body.message) && m.body.message.includes('Gate fabrication') &&
    m.body.message.includes('Assigned by: Sruti') && m.body.message.includes('Ref: ' + g.id), m.body.message);
  const row = f.log()[0] || [];
  ok('the log keeps the last four digits only', row[1] === g.id && row[2] === 'assigned' && row[3] === '…2345' && row[4] === 'sent' &&
    !JSON.stringify(f.log()).includes('9830012345'), JSON.stringify(row));

  console.log('\n=== nobody is messaged who should not be ===');
  f.call({ action: 'createTask', token: f.S, form: { title: 'No phone job', assignTo: 'ravi', dueDate: '2026-12-01' } });
  ok('no mobile number in Team: nothing sent, logged as skipped', f.sent.length === 1 && f.log().some((r) => r[4] === 'skipped' && /no valid mobile/.test(r[5])));
  f.call({ action: 'createTask', token: f.S, form: { title: 'Peer job', assignTo: 'vikram', dueDate: '2026-12-02' } });
  const peer = f.task('Peer job');
  ok('a task waiting for approval by their manager sends nothing yet', peer.status === 'Awaiting Approval' && f.sent.length === 1, peer.status);
  ok('the approval sends it to the person doing it', f.call({ action: 'processTaskApproval', token: f.H, taskId: peer.id, isApproved: true }).status === 'success' &&
    f.sent.length === 2 && f.sent[1].body.to_number === '919830067890' && f.sent[1].body.message.includes('Peer job'));
  f.call({ action: 'createTask', token: f.S, form: { title: 'Turned down', assignTo: 'vikram', dueDate: '2026-12-02' } });
  f.call({ action: 'processTaskApproval', token: f.H, taskId: f.task('Turned down').id, isApproved: false, remarks: 'Not now' });
  ok('a rejection sends nothing', f.sent.length === 2);

  console.log('\n=== a failure never breaks the task ===');
  f.setReply({ code: 401, body: '{"success":false,"message":"Invalid token"}' });
  const r = f.call({ action: 'createTask', token: f.S, form: { title: 'While down', assignTo: 'payel', dueDate: '2026-12-03' } });
  ok('the task is still created', r.status === 'success' && !!f.task('While down'));
  ok('and the failure is logged with the reason', f.log().some((x) => x[1] === f.task('While down').id && x[4] === 'failed' && /401: Invalid token/.test(x[5])));
  f.setReply({ code: 200, body: '{"success":true}' });

  console.log('\n=== the second message, two days before it is due ===');
  const mk = (title, to, due) => { f.call({ action: 'createTask', token: f.S, form: { title, assignTo: to, dueDate: due } }); return f.task(title); };
  mk('Due in two days', 'payel', day(2));
  const going = mk('Under way, due in two days', 'vikram', day(2));
  f.call({ action: 'processTaskApproval', token: f.H, taskId: going.id, isApproved: true });
  f.call({ action: 'updateTask', token: f.call({ action: 'login', username: 'vikram@a.in', password: 'staffpass123' }).token, taskId: going.id, status: 'In Progress' });
  mk('Due tomorrow', 'payel', day(1));
  mk('Due in three days', 'payel', day(3));
  const handed = mk('Handed in, due in two days', 'payel', day(2));
  f.call({ action: 'updateTask', token: f.P, taskId: handed.id, status: 'In Progress' });
  f.call({ action: 'updateTask', token: f.P, taskId: handed.id, status: 'For Review' });
  const before = f.sent.length;
  const out = f.X.waLiteDueReminders();
  const due = f.sent.slice(before);
  ok('only the To do and under-way tasks due in two days get one', due.length === 2 &&
    due.some((x) => x.body.message.includes('Due in two days') && x.body.to_number === '919830012345') &&
    due.some((x) => x.body.message.includes('Under way, due in two days') && x.body.to_number === '919830067890'),
    due.map((x) => x.body.message.split('\n')[2]).join(' | '));
  ok('it reads as a reminder with the due date', due.every((x) => /^\*Reminder: due in 2 days\*/.test(x.body.message) && /Due: /.test(x.body.message)));
  ok('the run reports what it did', /sent 2 /.test(out), out);
  f.X.waLiteDueReminders();
  ok('running it again the same day sends nothing twice', f.sent.length === before + 2);

  console.log('\n=== the schedule ===');
  f.X.switchOnSchedules(); f.X.switchOnSchedules();
  ok('switchOnSchedules installs the daily job once, at 9 am',
    f.env.G.ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'waLiteDueReminders').length === 1);
  const setup2 = f.X.setupDomeBox();
  ok('setupDomeBox reports it on', /a WhatsApp goes out when a task is assigned/.test(setup2) && /daily around 9 am/.test(setup2), setup2.split('WHATSAPP')[1]);
  ok('waLiteTest sends a test to the number given', /test message sent to …4321/.test(f.X.waLiteTest('9876504321')) && f.sent[f.sent.length - 1].body.to_number === '919876504321');

  console.log('\n=== numbers as people type them ===');
  const n = f.X.waLiteNumber_;
  ok('10 digits, leading 0, +91, 0091 and spaces all become 91…', ['9830012345', '09830012345', '+91 98300 12345', '0091-98300-12345', '919830012345'].every((x) => n(x) === '919830012345'));
  ok('a short or empty number is refused', n('12345') === '' && n('') === '' && n(null) === '');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
