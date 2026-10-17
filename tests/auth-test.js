/* Runs auth.gs under a shim for the Apps Script globals it uses, so the logic
   that protects every customer's password is actually tested. */
const crypto = require('crypto'), fs = require('fs');
const props = { AUTH_PEPPER: 'test-pepper-aaaa-bbbb', TOKEN_SECRET: 'test-token-secret-cccc' };
const cache = {};
const sandbox = {
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => props[k] || null, setProperty: (k,v) => props[k]=v }) },
  CacheService: { getScriptCache: () => ({
    get: k => cache[k] ?? null, put: (k,v) => cache[k]=v, remove: k => delete cache[k] }) },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    computeHmacSha256Signature: (data, key) => {
      const d = Buffer.isBuffer(data) ? data : (Array.isArray(data) ? Buffer.from(data) : Buffer.from(String(data),'utf8'));
      return [...crypto.createHmac('sha256', String(key)).update(d).digest()].map(b => b > 127 ? b - 256 : b);
    },
    base64EncodeWebSafe: s => Buffer.from(String(s),'utf8').toString('base64url'),
    base64DecodeWebSafe: s => [...Buffer.from(String(s),'base64url')],
    newBlob: b => ({ getDataAsString: () => Buffer.from(b.map(x=>x<0?x+256:x)).toString('utf8') }),
  },
  Logger: { log: () => {} },
  SHARE: { MASTER_DB_ID: '' },
  Date,
};
const src = fs.readFileSync('/home/user/stockpilot/domebox/auth.gs','utf8');
const fn = new Function(...Object.keys(sandbox), src + `
  return { AUTH, makePasswordHash, verifyPassword_, isHashed_, safeEquals_, hashPassword_,
           issueToken, requireSession, requireAdmin, loginAllowed_, recordFailedLogin_,
           clearLoginFailures_ };`);
const A = fn(...Object.values(sandbox));
A.AUTH.ITERATIONS = 50;   // keep the test fast; the algorithm is identical

let pass=0,fail=0;
const ok=(n,v,x)=>{console.log((v?'  PASS ':'  FAIL ')+n+(v||!x?'':'  ['+x+']'));v?pass++:fail++;};

console.log('\n=== hashing ===');
const h = A.makePasswordHash('correct horse battery');
ok('produces a versioned hash', /^v1\$50\$[0-9a-f]{16}\$[0-9a-f]{64}$/.test(h), h.slice(0,40));
ok('the password is not in the hash', !h.includes('correct horse battery'));
ok('same password hashes differently each time (unique salt)',
   A.makePasswordHash('same') !== A.makePasswordHash('same'));
ok('correct password verifies', A.verifyPassword_('correct horse battery', h).ok);
ok('wrong password rejected', !A.verifyPassword_('wrong horse battery', h).ok);
ok('near-miss rejected', !A.verifyPassword_('correct horse batter', h).ok);
ok('empty rejected', !A.verifyPassword_('', h).ok);
ok('a verified hash needs no upgrade', A.verifyPassword_('correct horse battery', h).needsUpgrade === false);

console.log('\n=== transparent migration from plaintext ===');
const legacy = 'mypassword123';
const v = A.verifyPassword_('mypassword123', legacy);
ok('an existing plaintext password still logs in', v.ok);
ok('and is flagged for upgrade', v.needsUpgrade === true);
ok('a wrong password against plaintext fails', !A.verifyPassword_('nope', legacy).ok);
ok('no stored value fails closed', !A.verifyPassword_('anything', '').ok);
ok('null stored value fails closed', !A.verifyPassword_('anything', null).ok);
ok('isHashed_ tells them apart', A.isHashed_(h) && !A.isHashed_(legacy));

console.log('\n=== verifying across an iteration-count change ===');
const old = A.hashPassword_('pw', 'fixedsalt0000000');
A.AUTH.ITERATIONS = 200;                       // operator raises the cost later
ok('old hashes still verify at their own cost', A.verifyPassword_('pw', old).ok);
ok('and a wrong password still fails', !A.verifyPassword_('bad', old).ok);
A.AUTH.ITERATIONS = 50;

console.log('\n=== session tokens: the server stops trusting the browser ===');
const tok = A.issueToken('SHEET123','asha@x.in','Admin');
const s = A.requireSession(tok);
ok('a valid token yields the identity', [s.sheetId,s.username,s.role].join('|')==='SHEET123|asha@x.in|Admin');
const thrown = f => { try { f(); return null; } catch(e){ return e.message; } };
ok('no token is refused', /Not signed in/.test(thrown(()=>A.requireSession(null))));
ok('garbage is refused', /invalid/.test(thrown(()=>A.requireSession('abc.def'))));
const [b,sig] = tok.split('.');
const forged = Buffer.from('SHEET123|attacker@evil.in|Admin|'+(Date.now()+99999999),'utf8').toString('base64url');
ok('a self-minted Admin token is refused', /invalid/.test(thrown(()=>A.requireSession(forged+'.'+sig))));
ok('a tampered signature is refused', /invalid/.test(thrown(()=>A.requireSession(b+'.'+'0'.repeat(64)))));
const expired = A.issueToken('S','u','Doer');
A.AUTH.SESSION_HOURS = -1;
ok('an expired token is refused', /expired/.test(thrown(()=>A.requireSession(A.issueToken('S','u','Doer')))));
A.AUTH.SESSION_HOURS = 12;
ok('role gate lets an Admin through', !!A.requireAdmin({role:'Admin'}));
ok('role gate stops a Doer', /Admin account/.test(thrown(()=>A.requireAdmin({role:'Doer'}))));
ok('role gate stops a missing session', /Admin account/.test(thrown(()=>A.requireAdmin(null))));

console.log('\n=== login throttle ===');
let st = A.loginAllowed_('a@x.in');
ok('first attempt allowed', st.ok);
for (let i=0;i<8;i++){ st = A.loginAllowed_('a@x.in'); A.recordFailedLogin_(st); }
ok('blocked after 8 failures', !A.loginAllowed_('a@x.in').ok);
ok('a different account is unaffected', A.loginAllowed_('b@x.in').ok);
A.clearLoginFailures_(A.loginAllowed_('a@x.in'));
ok('a successful login clears the counter', A.loginAllowed_('a@x.in').ok);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
