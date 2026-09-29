/* Which requests take the global script lock.
 *
 * Apps Script allows ONE script-lock holder at a time across the whole
 * workspace. Taking it on every request - reads included - put every screen
 * in the company into one queue: sixty-odd phones and the office screens
 * each ask "has anything changed?" every twenty seconds, which is about
 * three requests a second, every one of them a read. At a second or two of
 * Apps Script overhead each, arrivals outran the queue, it never drained,
 * and a punch that should take two seconds took minutes.
 *
 * So: a read must take no lock, a write must take exactly one, and anything
 * not explicitly known to be a read must lock by default - an action added
 * later has to be safe without anybody remembering this file.
 *
 * This runs against the stub, not a server:
 *   node lock-contention.test.js
 */

const fs = require('fs'), vm = require('vm'), path = require('path');
const STUB = process.env.GAS_STUB ||
  '/tmp/claude-0/-home-user-stockpilot/8aedcd83-0e16-508a-a671-eb29f4bcbbbe/scratchpad/gas-stub.cjs';
const CODE = path.join(__dirname, '..', 'apps-script', 'Code.gs');

let makeEnv, resetMeter, readMeter;
try { ({ makeEnv, resetMeter, readMeter } = require(STUB)); }
catch (e) {
  console.log('skipped: the Apps Script stub is not here (set GAS_STUB to its path)');
  process.exit(0);
}

const env = makeEnv({}); const ctx = vm.createContext(env);
vm.runInContext(fs.readFileSync(CODE, 'utf8'), ctx);
const call = (a, p = {}, t = '') => JSON.parse(vm.runInContext(
  `doPost({postData:{contents: ${JSON.stringify(JSON.stringify({ action: a, payload: p, token: t }))}}}).getContent()`, ctx));

call('setup');
const owner = call('login', { email: 'admin@company.com', password: 'admin123' }).data.token;
call('save', { sheet: 'Employees', row: { emp_code: 'LK-01', name: 'Lock Case',
  status: 'Active', basic: 20000, doj: '2019-01-01' } }, owner);
const emp = call('login', { email: 'lk-01', password: 'LK-01' }).data.token;

/* action, payload, token, and whether it changes anything */
const CASES = [
  ['ping',          {},                                   owner, 'read'],
  ['rev',           {},                                   owner, 'read'],
  ['bootstrap',     {},                                   owner, 'read'],
  ['list',          { sheet: 'Employees' },               owner, 'read'],
  ['listUsers',     {},                                   owner, 'read'],
  ['punchState',    {},                                   emp,   'read'],
  ['punchLog',      { from: '2026-08-01', to: '2026-08-01' }, owner, 'read'],
  ['myMonth',       { month: '2026-08' },                 emp,   'read'],
  ['monthAtt',      { month: '2026-08' },                 owner, 'read'],
  ['secretStatus',  {},                                   owner, 'read'],
  ['payslipMailLog',{ month: '2026-08' },                 owner, 'read'],

  ['save',          { sheet: 'Employees', row: { emp_code: 'LK-02', name: 'W', status: 'Active' } }, owner, 'write'],
  ['saveMany',      { sheet: 'Attendance', rows: [{ id: 'LK-01_2026-08-04', date: '2026-08-04',
                      emp_code: 'LK-01', status: 'P' }] },  owner, 'write'],
  ['saveSettings',  { settings: { company_name: 'Lock Test' } }, owner, 'write'],
  ['webPunch',      { kind: 'in' },                       emp,   'write'],
  ['remove',        { sheet: 'Employees', id: 'LK-02' },   owner, 'write'],
];

let bad = 0;
console.log('who takes the global lock\n');
console.log('  action           kind    locks taken   expected');
CASES.forEach(([action, payload, token, kind]) => {
  resetMeter();
  const res = call(action, payload, token);
  const locks = readMeter().locks;
  const want = kind === 'read' ? 0 : 1;
  const ok = locks === want && res.ok !== false;
  if (!ok) bad++;
  console.log('  ' + action.padEnd(16) + kind.padEnd(8) + String(locks).padStart(8) +
    String(want).padStart(12) + (ok ? '    ' : ' ** ') +
    (res.ok === false ? 'refused: ' + res.error : ''));
});

/* an action nobody has classified must lock, not slip through unserialised */
console.log('\nan action this file has never heard of');
resetMeter();
const unknown = call('somethingNobodyHasWrittenYet', {}, owner);
const locks = readMeter().locks;
const safe = locks === 1 || unknown.ok === false;
if (!safe) bad++;
console.log('  ' + 'unknown action'.padEnd(24) + String(locks).padStart(8) +
  (safe ? '    locks by default, or is refused outright'
        : ' ** slipped through with no lock'));

/* the load that used to collapse the queue: polling is now lock-free */
console.log('\nwhat 65 screens polling every 20 seconds now costs');
resetMeter();
for (let i = 0; i < 65; i++) call('rev', {}, owner);
const pollLocks = readMeter().locks;
if (pollLocks !== 0) bad++;
console.log('  65 "has anything changed?" calls took ' + pollLocks + ' locks' +
  (pollLocks === 0 ? '    they no longer queue behind each other'
                   : ' ** still serialising'));

console.log('\n' + (bad ? '** wrong: ' + bad : 'every request locked exactly when it should'));
process.exit(bad ? 1 : 0);
