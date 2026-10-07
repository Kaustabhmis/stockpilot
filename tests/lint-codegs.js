const fs=require('fs');
const raw=fs.readFileSync('/home/user/stockpilot/dist/code.gs','utf8');
/* Strip comments and string literals before looking for code. Without this the
   linter reads prose in a comment as a function call and reports nonsense. */
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g,' '))
  .replace(/\/\/[^\n]*/g, '')
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
const rawForSecrets = raw;
let pass=0,fail=0;
const ok=(n,v,x)=>{console.log((v?'  PASS ':'  FAIL ')+n+(v||!x?'':'\n        '+x));v?pass++:fail++;};

// 1. duplicate top-level function declarations
const defs={};
src.split('\n').forEach((l,i)=>{ const m=l.match(/^function\s+([A-Za-z0-9_$]+)\s*\(/);
  if(m) (defs[m[1]]=defs[m[1]]||[]).push(i+1); });
const dupes=Object.entries(defs).filter(([,v])=>v.length>1);
ok('no duplicate function declarations', dupes.length===0,
   dupes.map(([k,v])=>k+' at lines '+v.join(', ')).join('\n        '));

// 2. duplicate top-level var declarations
const vars={};
src.split('\n').forEach((l,i)=>{ const m=l.match(/^var\s+([A-Za-z0-9_$]+)\s*=/);
  if(m) (vars[m[1]]=vars[m[1]]||[]).push(i+1); });
const vdup=Object.entries(vars).filter(([,v])=>v.length>1);
ok('no duplicate top-level vars', vdup.length===0,
   vdup.map(([k,v])=>k+' at lines '+v.join(', ')).join('\n        '));

// 3. every called function is defined somewhere (or is a known global)
const KNOWN=new Set(['parseInt','parseFloat','isNaN','isFinite','String','Number','Boolean','Array',
 'Object','JSON','Math','Date','RegExp','Error','encodeURIComponent','decodeURIComponent','require',
 'SpreadsheetApp','DriveApp','PropertiesService','CacheService','Utilities','UrlFetchApp','GmailApp',
 'MailApp','ContentService','Logger','ScriptApp','HtmlService','LockService','Session','console',
 'setTimeout','if','for','while','switch','catch','return','typeof','function','new','else','do']);
const defined=new Set(Object.keys(defs));
// local `var f = function(){}` / `var f = n => …` are definitions too
[...src.matchAll(/\bvar\s+([A-Za-z_$][\w$]*)\s*=\s*(?:function\s*\(|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g)]
  .forEach(m=>defined.add(m[1]));
/* A parameter that holds a callback is called like any other function. Without
   this, `withLock_(fn)` reports `fn` as undefined — a false alarm that trains
   people to ignore the one check here that catches real typos. */
[...src.matchAll(/\bfunction\s*[A-Za-z0-9_$]*\s*\(([^)]*)\)/g)].forEach(m=>{
  m[1].split(',').map(a=>a.trim()).filter(Boolean).forEach(a=>{
    const name=a.split('=')[0].trim();
    if(/^[A-Za-z_$][\w$]*$/.test(name)) defined.add(name);
  });
});
const called=new Set();
const re=/(?:^|[^.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
let m; while((m=re.exec(src))) called.add(m[1]);
// a name wrapped in `typeof X === 'function'` is deliberately optional
const guarded=new Set([...src.matchAll(/typeof\s+([A-Za-z_$][\w$]*)\s*===?\s*''/g)].map(m=>m[1]));
const missing=[...called].filter(n=>!defined.has(n)&&!KNOWN.has(n)&&!vars[n]&&!guarded.has(n));
ok('every called function is defined', missing.length===0, missing.join(', '));

// 4. no secrets left in source
const secrets=rawForSecrets.match(/rzp_live_\w+|rzp_test_\w+|AIzaSy[\w-]{20,}|['"][A-Za-z0-9]{32,}['"]/g)||[];
ok('no hardcoded secrets', secrets.length===0, secrets.slice(0,3).join(', '));

// 5. the dangerous sharing call is gone
ok('never shares a tenant file publicly',
   !/ANYONE_WITH_LINK|DriveApp\.Access\.ANYONE/.test(src));

// 6. identity is never taken from the request
ok('no handler reads params.user', !/params\.user\b/.test(src));

// 7. passwords never leave the server
ok('no password field in any response', !/password:\s*r\[/.test(src));

// 8. every route in the switch has a handler
// only the router's own switch, not every switch in the file
const routerBody = raw.slice(raw.indexOf('function route_('), raw.indexOf('function tenantContext_('));
const routes=[...routerBody.matchAll(/case '([a-zA-Z]+)':\s*return ([a-zA-Z_$][\w$]*)/g)]
  .map(m=>({route:m[1],fn:m[2]}));
const badRoutes=routes.filter(r=>!defined.has(r.fn));
ok(`all ${routes.length} routes resolve to a defined function`, badRoutes.length===0,
   badRoutes.map(r=>r.route+' -> '+r.fn).join(', '));
console.log('  routes: '+routes.map(r=>r.route).join(', '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
