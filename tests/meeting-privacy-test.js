/**
 * With several meetings able to run at once, each meeting's roadblocks and
 * actions must stay inside it: not readable through an older meeting's
 * summary, not cleared into another meeting, not delegated from another
 * department's meeting, and not editable by someone who does not meet with
 * whoever raised them.
 */
const { call } = require('./server.js');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || x === undefined ? '' : '  [' + String(x).slice(0, 220) + ']')); v ? pass++ : fail++; };
const tick = () => { const t = Date.now(); while (Date.now() - t < 15) {} };   // two meetings never start in the same millisecond

const R = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
const U = (u) => u + R;
const email = 'mp' + R + '@acme.in';
const A = call({ action: 'register', form: { companyName: 'Acme', name: 'Rohan Mehta', email, password: 'strongpass123' } }).token;
[['Q Head', 'qh', 'HOD', ''], ['P Head', 'ph', 'HOD', ''], ['Dee', 'dee', 'Doer', 'qh'], ['Eve', 'eve', 'Doer', 'ph'], ['Mo', 'mo', 'Manager', '']]
  .forEach(([n, u, role, mgr]) => call({ action: 'addUser', token: A, form: { name: n, username: U(u), email: U(u) + '@acme.in', role,
    manager: mgr ? U(mgr) : '', jobProfile: 'Executive', password: 'staffpass123' } }));
const tok = (u) => call({ action: 'login', username: U(u) + '@acme.in', password: 'staffpass123' }).token;
const QH = tok('qh'), PH = tok('ph'), D = tok('dee'), E = tok('eve'), MO = tok('mo');
const ADMIN = call({ action: 'getMeetings', token: A }).status === 'success' ? A : null;
ok('meetings are on for this workspace', !!ADMIN);

console.log('\n=== a past meeting does not show later meetings ===');
const m1 = call({ action: 'startMeeting', token: QH, form: { attendees: [U('dee')] } });
call({ action: 'endMeeting', token: QH, id: m1.id });
tick();
const m2 = call({ action: 'startMeeting', token: QH, form: { attendees: [U('mo')] } });
const r = call({ action: 'addMeetingItem', token: QH, id: m2.id, form: { kind: 'roadblock', text: 'Private roadblock in week 2' } });
const rbId = r.roadblocks.find((x) => /week 2/.test(x.text)).id;
call({ action: 'addMeetingAction', token: QH, id: m2.id, form: { title: 'Private action week 2', assignTo: U('mo') } });
const v1 = call({ action: 'getMeeting', token: D, id: m1.id });
ok('someone from week 1 opens its summary: no week-2 roadblock', v1.status === 'success' && !v1.roadblocks.some((x) => /week 2/.test(x.text)), JSON.stringify(v1.roadblocks));
ok('and no week-2 action', !v1.actions.some((x) => /week 2/.test(x.title)), JSON.stringify(v1.actions));
ok('and cannot open week 2 itself', call({ action: 'getMeeting', token: D, id: m2.id }).status === 'error');
ok('week 2 still has its own', call({ action: 'getMeeting', token: QH, id: m2.id }).roadblocks.some((x) => /week 2/.test(x.text)));

console.log('\n=== clearing lands in the meeting on screen ===');
const mp = call({ action: 'startMeeting', token: PH, form: { attendees: [U('eve')] } });
call({ action: 'addMeetingItem', token: E, id: '', form: { kind: 'roadblock', text: 'Eve outside one' } });
let vp = call({ action: 'getMeeting', token: A, id: mp.id });
const ob = vp.roadblocks.find((x) => /outside one/.test(x.text));
ok('a roadblock raised between meetings shows in its author’s meeting', !!ob);
const cl = call({ action: 'updateMeetingItem', token: A, id: mp.id, itemId: ob.id, form: { clear: true } });
ok('clearing it answers with that same meeting', cl.status === 'success' && cl.meeting && cl.meeting.id === mp.id, cl.meeting && cl.meeting.id);
vp = call({ action: 'getMeeting', token: A, id: mp.id });
ok('and it is recorded as cleared there', vp.roadblocks.some((x) => x.id === ob.id && x.status === 'cleared'), JSON.stringify(vp.roadblocks));
ok('a point from another meeting cannot be changed through this one',
   /not part of this meeting/.test(call({ action: 'updateMeetingItem', token: A, id: mp.id, itemId: rbId, form: { horizon: 'later' } }).message || ''));

console.log('\n=== delegating only from this meeting ===');
const del = call({ action: 'addMeetingAction', token: PH, id: mp.id, form: { title: 'x', assignTo: U('ph'), fromItem: rbId } });
ok('another department’s roadblock cannot be delegated from this meeting', del.status === 'error' && /not part of this meeting/.test(del.message), del.message);
const own = call({ action: 'addMeetingItem', token: E, id: mp.id, form: { kind: 'roadblock', text: 'Press 3 die worn' } });
const ownId = own.roadblocks.find((x) => /die worn/.test(x.text)).id;
const d2 = call({ action: 'addMeetingAction', token: PH, id: mp.id, form: { title: 'Regrind the die', assignTo: U('eve'), fromItem: ownId, clearItem: true } });
ok('its own roadblock can, and clearing it records it here', d2.status === 'success' &&
   d2.roadblocks.some((x) => x.id === ownId && x.status === 'cleared'), JSON.stringify(d2.roadblocks));

console.log('\n=== between meetings ===');
call({ action: 'addMeetingItem', token: E, id: '', form: { kind: 'roadblock', text: 'Eve outside two' } });
const o2 = call({ action: 'getMeeting', token: A, id: mp.id }).roadblocks.find((x) => /outside two/.test(x.text));
ok('a manager who does not meet with its author cannot edit it', /not from a meeting you are in/.test(call({ action: 'updateMeetingItem', token: MO, itemId: o2.id, form: { text: 'changed' } }).message || ''));
ok('nor delete it', call({ action: 'updateMeetingItem', token: QH, itemId: o2.id, form: { remove: true } }).status === 'error');
ok('its author can', call({ action: 'updateMeetingItem', token: E, itemId: o2.id, form: { text: 'Eve outside two, updated' } }).status === 'success');
ok('so can the head who meets with them', call({ action: 'updateMeetingItem', token: PH, itemId: o2.id, form: { horizon: 'later' } }).status === 'success');
ok('and the Admin', call({ action: 'updateMeetingItem', token: A, itemId: o2.id, form: { horizon: 'now' } }).status === 'success');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
