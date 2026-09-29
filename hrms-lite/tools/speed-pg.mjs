/* How long the Postgres workspace takes, at Dynamic Engineers' real size.
 *
 *   node speed-pg.mjs [base-url]
 *
 * Seeds 62 staff and about eight months of register, then times the calls
 * that people actually wait for. What it reports is the server's own time -
 * add the trip to the server on top, which from an office in India to a
 * Supabase region in Singapore or Mumbai is roughly 40-120 ms.
 */
const BASE = process.argv[2] || 'http://127.0.0.1:8105';

const call = async (action, payload, token) => {
  const r = await fetch(BASE + '/exec', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, token }) });
  const j = await r.json();
  if (!j.ok) throw new Error(action + ': ' + j.error);
  return j.data;
};

const token = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;

const N = 62, DAYS = 234;
const codes = Array.from({ length: N }, (_, i) =>
  (i < 12 ? 'SP-I-' : 'SP-S-') + String(i).padStart(3, '0'));

console.log('seeding ' + N + ' staff and ' + (N * DAYS) + ' attendance rows...');
for (const code of codes) {
  await call('save', { sheet: 'Employees', row: { emp_code: code, name: 'Speed ' + code,
    status: 'Active', basic: 18000, hra: 7200, special_allowance: 800,
    pf_applicable: 'yes', esi_applicable: 'no', doj: '2019-01-01',
    department: code.startsWith('SP-I') ? 'ITI' : 'Office' } }, token);
}
const base = Date.now() - DAYS * 864e5;
let rows = [];
for (let d = 0; d < DAYS; d++) {
  const iso = new Date(base + d * 864e5).toISOString().slice(0, 10);
  for (const code of codes) {
    rows.push({ id: code + '_' + iso, date: iso, emp_code: code, status: 'P',
      in_time: '09:28', out_time: '18:35', hours: 9 });
  }
  if (rows.length >= 2000) { await call('saveMany', { sheet: 'Attendance', rows }, token); rows = []; }
}
if (rows.length) await call('saveMany', { sheet: 'Attendance', rows }, token);

const punches = [];
for (let i = 0; i < 5000; i++) {
  punches.push({ EmpCode: codes[i % N], LogDate: '2026-09-01',
    LogTime: String(8 + (i % 10)).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0') });
}
for (let i = 0; i < punches.length; i += 1000) {
  await call('ingestPunches', { punches: punches.slice(i, i + 1000), source: 'seed' }, token);
}

const empTok = await (async () => {
  await call('saveUser', { user: { email: 'sp-s-020', role: 'employee',
    emp_code: 'SP-S-020', active: 'yes', password: 'pw123456' } }, token);
  return (await call('login', { email: 'sp-s-020', password: 'pw123456' })).token;
})();

const time = async (label, fn, n = 5) => {
  await fn();                                   /* once to warm the plan cache */
  const runs = [];
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime.bigint();
    await fn();
    runs.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  runs.sort((a, b) => a - b);
  console.log('  ' + label.padEnd(34) + runs[Math.floor(n / 2)].toFixed(0).padStart(6) + ' ms' +
    '   (best ' + runs[0].toFixed(0) + ', worst ' + runs[n - 1].toFixed(0) + ')');
  return runs[Math.floor(n / 2)];
};

const ym = new Date().toISOString().slice(0, 7);
const older = (() => { const d = new Date(); d.setMonth(d.getMonth() - 5);
  return d.toISOString().slice(0, 7); })();

console.log('\nwhat people wait for, server time only\n');
await time('HR signs in', () => call('login', { email: 'admin@company.com',
  password: 'admin123', months: true }));
await time('a worker signs in', () => call('login', { email: 'sp-s-020',
  password: 'pw123456', months: true }));
await time('a worker punches', () => call('webPunch', { kind: 'in' }, empTok));
await time('"has anything changed?"', () => call('rev', {}, token));
await time('HR opens a 5-month-old month', () => call('monthAtt', { month: older }, token));
await time('a worker opens an old month', () => call('myMonth', { month: older }, empTok));
await time('the punch log for one day', () => call('punchLog', { from: '2026-09-01',
  to: '2026-09-01' }, token));

console.log('\nfor comparison, the Apps Script workspace on the same data');
console.log('  reported by the office: several minutes at the worst');
console.log('  typical Apps Script overhead alone: 1,000-3,000 ms per call,');
console.log('  before it reads a single row');
