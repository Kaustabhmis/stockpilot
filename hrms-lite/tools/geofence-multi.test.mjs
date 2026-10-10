/* The fence, with a person assigned to TWO sites.
 *
 * The bug: a supervisor who works at Unit 1 AND Unit 2 could punch at the
 * first and was turned away at the second. The employee's site field holds a
 * list - "Unit 1, Unit 2" - and the check read it as one string, so with two
 * set it matched neither and fell back to "any site", or honoured only a lone
 * one. And on this backend there was no server-side fence at all: whatever
 * the phone sent was stored.
 *
 * Checked on whichever backend the url points at, so the sheet version and
 * the Postgres version are held to the same behaviour:
 *   - at Unit 1: allowed
 *   - at Unit 2: allowed   (this is the one that used to fail)
 *   - far from both: refused in block mode
 *   - the punch that lands stores the site it was nearest, and a distance
 *
 *   node geofence-multi.test.mjs http://127.0.0.1:8101
 */
const BASE = process.argv[2] || 'http://127.0.0.1:8101';
const call = async (action, payload, token) => {
  const r = await fetch(BASE + '/exec', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, token }) });
  const j = await r.json();
  if (!j.ok) { const e = new Error(j.error); e.refused = true; return e; }
  return j.data;
};
let bad = 0;
const ok = (pass, label, why) => { if (!pass) bad++;
  console.log('   ' + (pass ? 'ok  ' : '**  ') + String(label).padEnd(40) + (why || '')); };

const token = (await call('login', { email: 'admin@company.com', password: 'admin123' })).token;

/* two sites a good distance apart - Kolkata and Delhi, so "near one" is
   unambiguous and nobody is accidentally within 150 m of both */
const U1 = { lat: 22.5726, lng: 88.3639 };     // Unit 1
const U2 = { lat: 28.6139, lng: 77.2090 };     // Unit 2
await call('saveMany', { sheet: 'Sites', rows: [
  { id: 'SITE-U1', name: 'Unit 1', lat: U1.lat, lng: U1.lng, radius_m: 200, active: 'yes' },
  { id: 'SITE-U2', name: 'Unit 2', lat: U2.lat, lng: U2.lng, radius_m: 200, active: 'yes' },
] }, token);
await call('saveSettings', { settings: {
  geofence_enabled: 'yes', geofence_mode: 'block', geofence_accuracy_m: '0',
  web_punch_enabled: 'yes', geofence_allow_od: 'no'
} }, token);

/* a supervisor who covers both units */
await call('save', { sheet: 'Employees', row: {
  emp_code: 'SUP-1', name: 'Two Site Super', status: 'Active', wage_type: 'Salary',
  basic: 20000, doj: '2024-01-01', site: 'Unit 1, Unit 2' } }, token);
await call('saveUser', { user: { email: 'sup-1', emp_code: 'SUP-1', role: 'employee',
  password: 'sup-1pass' } }, token);
const sup = (await call('login', { email: 'sup-1', password: 'sup-1pass' })).token;

console.log('a supervisor assigned to Unit 1 AND Unit 2\n');

/* punch at Unit 1 */
const a = await call('webPunch', { kind: 'in', geo: { lat: U1.lat, lng: U1.lng, accuracy: 10 } }, sup);
ok(!a.refused, 'punches at Unit 1', a.refused ? a.message : 'in at ' + (a.record ? a.record.in_time : '?'));

/* the one that used to fail: punch at Unit 2 */
const b = await call('webPunch', { kind: 'out', geo: { lat: U2.lat, lng: U2.lng, accuracy: 10 } }, sup);
ok(!b.refused, 'punches at Unit 2 as well', b.refused ? b.message : 'the site that used to be refused');

/* far from both - a point in the sea off Mumbai */
const c = await call('webPunch', { kind: 'in', geo: { lat: 18.0, lng: 70.0, accuracy: 10 } }, sup);
ok(c.refused, 'refused far from both', c.refused ? c.message.slice(0, 54) : 'LET THROUGH - fence open');
ok(c.refused && /Unit 1, Unit 2|Unit 2, Unit 1/.test(c.message || ''),
   'and told which sites count', 'the refusal lists both, not one');

/* the stored punch carries where it happened */
const log = await call('punchLog', { from: '2020-01-01', to: '2035-01-01' }, token);
const atU2 = (log.rows || log || []).filter(r => String(r.emp_code) === 'SUP-1' && String(r.site) === 'Unit 2');
ok(atU2.length > 0, 'punch stored against Unit 2', atU2.length + ' row(s) with site = Unit 2');
ok(atU2.length > 0 && atU2.every(r => r.distance_m !== '' && r.distance_m !== null),
   'with a distance recorded', 'the server worked out where it was, not the phone');

/* a lone-site person still restricted to that one */
await call('save', { sheet: 'Employees', row: {
  emp_code: 'SUP-2', name: 'One Site', status: 'Active', wage_type: 'Salary',
  basic: 20000, doj: '2024-01-01', site: 'Unit 1' } }, token);
await call('saveUser', { user: { email: 'sup-2', emp_code: 'SUP-2', role: 'employee',
  password: 'sup-2pass' } }, token);
const one = (await call('login', { email: 'sup-2', password: 'sup-2pass' })).token;
const d = await call('webPunch', { kind: 'in', geo: { lat: U2.lat, lng: U2.lng, accuracy: 10 } }, one);
ok(d.refused, 'one-site person refused at the other', d.refused ? 'still fenced to Unit 1' : 'LET THROUGH');

console.log('\n' + (bad ? '** ' + bad + ' did not hold' : 'both sites work, and the fence still holds'));
process.exit(bad ? 1 : 0);
