/* Serves dist/index.html and routes its API calls into the real code.gs,
   executed on the shim. This exercises both delivered files together. */
const http = require('http'), fs = require('fs'), { build } = require('./gas-shim');

const env = build();
const src = fs.readFileSync('/home/user/stockpilot/dist/code.gs', 'utf8');
const names = Object.keys(env.G);
const APP = new Function(...names, src + '\n;return { doPost: doPost, doGet: doGet, setupDomeBox: setupDomeBox, ensureRegistry: ensureRegistry, __env: 1 };')(...names.map(n => env.G[n]));

/* Seed: a registry and a template, exactly as a real deployment would have. */
const master = env.newFile('MASTER', 'Dome Box Registry');
const tpl = env.newFile('TEMPLATE', 'Dome Box Template');
['Users','Tasks','KRA_Master','Reviews','Leave','Settings'].forEach(n => tpl.insertSheet(n));
tpl.getSheetByName('Settings').appendRow(['General']);

env.props.MASTER_DB_ID = 'MASTER';
env.props.TEMPLATE_ID  = 'TEMPLATE';
env.props.SITE_URL     = 'http://localhost:8095';
env.props.AUTH_PEPPER  = 'test-pepper-for-the-harness';
env.props.TOKEN_SECRET = 'test-token-secret-for-the-harness';
APP.ensureRegistry();

const call = body => {
  const res = APP.doPost({ postData: { contents: JSON.stringify(body) }, parameter: {} });
  return JSON.parse(res.getContent());
};

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/exec') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      let out;
      try { out = call(JSON.parse(b)); }
      catch (e) { out = { status: 'error', message: e.message }; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  if (req.url === '/' || req.url.startsWith('/index.html') || req.url.startsWith('/?')) {
    let html = fs.readFileSync('/home/user/stockpilot/dist/index.html', 'utf8');
    html = html.replace("var API_URL = 'PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE';",
                        "var API_URL = '/exec';");
    /* The stylesheet is compiled into dist/index.html by the build, so there is
       nothing to substitute any more. Fail loudly if a CDN tag ever comes back:
       this sandbox blocks it, and a silently unstyled page would be mistaken
       for a layout bug in every screenshot taken afterwards. */
    if (html.indexOf('cdn.tailwindcss.com') > -1) {
      throw new Error('dist/index.html still loads Tailwind from the CDN — run build-index.js');
    }
    // vendor the fonts so the harness renders what production renders
    html = html.replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/g, '');
    html = html.replace('</style>', '</style><link rel="stylesheet" href="/fonts.css">');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html); return;
  }
  if (req.url === '/fonts.css') {
    res.writeHead(200, {'Content-Type':'text/css'});
    res.end(fs.readFileSync(__dirname + '/fonts.css')); return;
  }
  if (req.url.startsWith('/fonts/')) {
    const f = __dirname + req.url;
    if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type': req.url.endsWith('.ttf') ? 'font/ttf' : 'font/woff2'});
    res.end(fs.readFileSync(f)); return;
  }
  /* HARNESS ONLY — not part of code.gs. Lets the screenshot seed put a tenant
     on a paid plan without going through Razorpay. */
  if (req.url.startsWith('/__setplan')) {
    const q = new URL('http://x' + req.url).searchParams;
    const dir = env.FILES.MASTER.getSheetByName('Directory');
    const d = dir.getDataRange().getValues();
    let done = false;
    for (let i = 1; i < d.length; i++) {
      if (String(d[i][1]).toLowerCase() === String(q.get('email')).toLowerCase()) {
        dir.getRange(i+1, 4).setValue(q.get('plan') || 'Yearly');
        const until = new Date(); until.setDate(until.getDate() + 300);
        dir.getRange(i+1, 5).setValue(until.toISOString().slice(0,10));
        done = true;
      }
    }
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ ok: done })); return;
  }
  /* HARNESS ONLY — writes months of completed work straight into a tenant sheet
     so the charts show what an established customer sees. Nothing in code.gs
     does this; it is screenshot scaffolding. */
  if (req.url.startsWith('/__history')) {
    const q = new URL('http://x' + req.url).searchParams;
    const dir = env.FILES.MASTER.getSheetByName('Directory');
    const d = dir.getDataRange().getValues();
    let sheetId = null;
    for (let i = 1; i < d.length; i++)
      if (String(d[i][1]).toLowerCase() === String(q.get('email')).toLowerCase()) sheetId = String(d[i][5]);
    if (!sheetId) { res.writeHead(404); res.end('{}'); return; }

    const ss = env.FILES[sheetId];
    const users = ss.getSheetByName('Users').getDataRange().getValues().slice(1)
      .filter(r => r[1] && r[4] !== 'Admin').map(r => ({ u: r[1], skill: 0.55 + Math.random()*0.4 }));
    const tasksSheet = ss.getSheetByName('Tasks');
    const KRAS = ['Vendor Quality','Inventory Accuracy','Rejection Control','Cost Savings',
                  'Process Compliance','Customer Satisfaction','Capability Building'];
    const TITLES = ['Vendor audit','Stock reconciliation','Rejection analysis','AMC negotiation',
      'PDI checklist update','Complaint closure','Operator training','Costing review',
      'Supplier CAPA','Line balancing','Calibration','Layout revision'];
    const pick = a => a[Math.floor(Math.random()*a.length)];
    const ymd2 = dt => dt.toISOString().slice(0,10);
    let n = 0;
    for (let back = 300; back >= 7; back--) {
      const day = new Date(); day.setDate(day.getDate() - back);
      if (day.getDay() === 0 || day.getDay() === 6) continue;
      users.forEach(p => {
        if (Math.random() > 0.30) return;
        const due = new Date(day); due.setDate(due.getDate() + 3 + Math.floor(Math.random()*7));
        if (due > new Date()) return;
        const onTime = Math.random() < p.skill;
        const sub = new Date(due); sub.setDate(sub.getDate() + (onTime ? -1 : 1 + Math.floor(Math.random()*6)));
        const ver = new Date(sub); ver.setDate(ver.getDate() + 1);
        if (ver > new Date()) return;
        const rework = Math.random() < (1 - p.skill) * 0.5 ? 1 : 0;
        const hist = [{date: day.toISOString(), status:'Pending', user:'System', note:''}];
        if (rework) hist.push({date: new Date(sub.getTime()-86400000).toISOString(), status:'In Progress', user:'Manager', note:'Returned'});
        hist.push({date: sub.toISOString(), status:'For Review', user:'Doer', note:''});
        hist.push({date: ver.toISOString(), status:'Verified', user:'Manager', note:''});
        const row = new Array(19).fill('');
        row[0]='H'+(++n); row[1]=day; row[2]=ymd2(due); row[3]=pick(TITLES);
        row[4]=''; row[5]='system'; row[6]=p.u; row[7]='Verified'; row[8]=pick(KRAS);
        row[9]=pick(['High','Medium','Medium','Low']); row[10]='One Time'; row[11]=rework;
        row[12]=JSON.stringify(hist); row[13]='General'; row[14]='';
        row[15]='seed'; row[16]='[]'; row[17]='[]'; row[18]='';
        tasksSheet.appendRow(row);
      });
    }
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ added: n })); return;
  }
  /* HARNESS ONLY — pushes a task's history back in time so the review clock can
     be seen running without waiting three days for it. Not part of code.gs. */
  if (req.url.startsWith('/__backdate')) {
    const q = new URL('http://x' + req.url).searchParams;
    const dir = env.FILES.MASTER.getSheetByName('Directory');
    const d = dir.getDataRange().getValues();
    let sheetId = null;
    for (let i = 1; i < d.length; i++)
      if (String(d[i][1]).toLowerCase() === String(q.get('email')).toLowerCase()) sheetId = String(d[i][5]);
    if (!sheetId) { res.writeHead(404); res.end('{}'); return; }
    const back = Number(q.get('days') || 10);
    const rows = env.FILES[sheetId].getSheetByName('Tasks')._data
      .filter(r => !q.get('title') || r[3] === q.get('title'));
    rows.forEach(r => {
      let h; try { h = JSON.parse(r[12] || '[]'); } catch (e) { h = []; }
      h.forEach(e => { const t = new Date(e.date);
        t.setDate(t.getDate() - back); e.date = t.toISOString(); });
      r[12] = JSON.stringify(h);
    });
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ moved: rows.length })); return;
  }
  if (req.url === '/__mails') { res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify(env.mails)); return; }
  if (req.url === '/__sharing') { res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify(env.META)); return; }
  res.writeHead(404); res.end('not found');
});

module.exports = { call, env, APP, server };
if (require.main === module) server.listen(8095, () => console.log('harness on 8095'));
