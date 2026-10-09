/**
 * A weekly review, run start to finish through the API, the way a chair and
 * three attendees would. The parts that matter most are the ones a meeting
 * tool usually gets wrong: actions that become real work, roadblocks that
 * survive to the next week, ratings that stay anonymous, and a meeting that
 * only the people in it can read.
 */
const { call, env } = require('./server.js');
let pass = 0, fail = 0;
const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 220) + ']')); v ? pass++ : fail++; };

const R = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
const U = (u) => u + R;
const ymd = (plus) => { const d = new Date(); d.setDate(d.getDate() + plus); return d.toISOString().slice(0, 10); };
const email = 'meet' + R + '@acme.in';
const ME = email.split('@')[0];
const A = call({ action: 'register', form: { companyName: 'Acme Engineering', name: 'Rohan Mehta', email, password: 'strongpass123' } }).token;
const setPlan = (plan) => {
  const dir = env.FILES.MASTER.getSheetByName('Directory');
  dir.getDataRange().getValues().forEach((r, i) => {
    if (String(r[1]).toLowerCase() === email) { dir.getRange(i + 1, 4).setValue(plan);
      const u = new Date(); u.setDate(u.getDate() + 300); dir.getRange(i + 1, 5).setValue(u.toISOString().slice(0, 10)); } });
};

console.log('\n=== the plan ===');
ok('meetings are a paid feature', /paid plan/.test(call({ action: 'getMeetings', token: A }).message || ''));
setPlan('Growth');
[['Sruti Charulata', 'sruti', 'HOD', ''], ['Payel S', 'payel', 'Doer', 'sruti'], ['Vikram R', 'vikram', 'Doer', 'sruti'],
 ['Nita B', 'nita', 'Doer', 'sruti']].forEach(([n, u, role, mgr]) => call({ action: 'addUser', token: A, form: { name: n,
  username: U(u), email: U(u) + '@acme.in', role, manager: mgr ? U(mgr) : '', jobProfile: 'Executive', password: 'staffpass123' } }));
const tok = (u) => call({ action: 'login', username: U(u) + '@acme.in', password: 'staffpass123' }).token;
const H = tok('sruti'), P = tok('payel'), V = tok('vikram'), N = tok('nita');

call({ action: 'saveDirection', token: A, form: { purpose: 'Keep lines running.', values: [
  { code: 'C', title: 'Customer first' }, { code: 'O', title: 'Own it' }] } });
const dirNow = call({ action: 'getDirection', token: A }).now.quarter;
const goal = call({ action: 'saveGoal', token: A, form: { level: 'quarter', period: dirNow, title: 'Launch the 16-inch fan', owner: U('sruti') } });
const num = call({ action: 'saveNumber', token: A, form: { name: 'Fans despatched', owner: U('sruti'), target: 1000, direction: 'at least' } });

console.log('\n=== starting ===');
const ml = call({ action: 'getMeetings', token: A });
ok('the meetings page loads', ml.status === 'success' && ml.live === null, ml.message);
ok('the default agenda has all eight segments, in order',
   ml.agenda.map((a) => a.key).join(',') === 'wins,values,goals,numbers,updates,roadblocks,actions,close');
ok('a Doer cannot start one', call({ action: 'startMeeting', token: P, form: { attendees: [U('sruti')] } }).status === 'error');
ok('one person is not a meeting', call({ action: 'startMeeting', token: A, form: { attendees: [] } }).status === 'error');
const st = call({ action: 'startMeeting', token: A, form: { title: 'Weekly review',
  attendees: [U('sruti'), U('payel'), U('vikram')] } });
ok('the Admin starts it with three others', st.status === 'success', st.message);
ok('only one can run at a time', call({ action: 'startMeeting', token: H, form: { attendees: [U('payel')] } }).status === 'error');
const id = st.id;
let mt = call({ action: 'getMeeting', token: P, id });
ok('an attendee can open it', mt.status === 'success', mt.message);
ok('the chair is marked present, the rest not yet',
   mt.meeting.attendees.filter((a) => a.present).map((a) => a.u).join() === ME, JSON.stringify(mt.meeting.attendees));
ok('someone not invited cannot read it', call({ action: 'getMeeting', token: N, id }).status === 'error');
ok('and does not see it in their list', call({ action: 'getMeetings', token: N }).live === null);
ok('it opens on the first segment', mt.meeting.segment === 0 && mt.meeting.agenda[0].key === 'wins');
ok('the quarter goals are on the table', mt.goals.some((g) => g.id === goal.id));
ok('and the key numbers', mt.numbers.list.some((n) => n.id === num.id));

console.log('\n=== wins ===');
['sruti', 'payel', 'vikram'].forEach((u) => call({ action: 'setAttendance', token: A, id, username: U(u), present: u !== 'vikram' }));
mt = call({ action: 'getMeeting', token: A, id });
ok('the chair takes attendance', mt.meeting.attendees.filter((a) => a.present).length === 3, JSON.stringify(mt.meeting.attendees));
ok('an attendee cannot', call({ action: 'setAttendance', token: P, id, username: U('vikram'), present: true }).status === 'error');
call({ action: 'setAttendance', token: A, id, username: U('nita'), present: true });
ok('somebody who walks in late can be added', call({ action: 'getMeeting', token: N, id }).status === 'success');
ok('anyone in the room shares a win', call({ action: 'addMeetingItem', token: P, id, form: { kind: 'win', text: 'Daughter passed her boards' } }).status === 'success');

console.log('\n=== values in action ===');
ok('a story must name the value lived', call({ action: 'addMeetingItem', token: H, id, form: { kind: 'story',
   text: 'Payel stayed late', person: U('payel') } }).status === 'error');
const story = call({ action: 'addMeetingItem', token: H, id, form: { kind: 'story', text: 'Payel stayed until the motor test passed',
  person: U('payel'), value: 'O', cookies: 2 } });
ok('with a value it is recorded', story.status === 'success', story.message);
ok('and can carry cookie points, under the usual rules', /cookie|Cookie|\ud83c/.test(story.message) &&
   (call({ action: 'getCookies', token: A }).cookies || []).some((c) => c.value === 'O'), story.message);
ok('a value that is not the company’s is refused', call({ action: 'addMeetingItem', token: H, id, form: { kind: 'story',
   text: 'xx yy', value: 'Q' } }).status === 'error');

console.log('\n=== moving through it ===');
ok('only the chair moves the meeting on', call({ action: 'meetingGo', token: P, id, segment: 2 }).status === 'error');
let go = call({ action: 'meetingGo', token: A, id, segment: 2 });
ok('the chair does', go.meeting.segment === 2);
ok('and every attendee sees the same segment on their next poll', call({ action: 'getMeeting', token: V, id }).meeting.segment === 2);
ok('it cannot run past the end', call({ action: 'meetingGo', token: A, id, segment: 99 }).meeting.segment === 7);
call({ action: 'meetingGo', token: A, id, segment: 2 });

console.log('\n=== goal check and key numbers ===');
ok('the goal owner sets its status from the meeting', call({ action: 'setGoalStatus', token: H, id: goal.id,
   goalStatus: 'At risk', note: 'Motor supplier slipped' }).status === 'success');
ok('and the room sees it', call({ action: 'getMeeting', token: P, id }).goals.find((g) => g.id === goal.id).status === 'At risk');
call({ action: 'recordNumber', token: H, id: num.id, value: 870 });
const nrow = call({ action: 'getMeeting', token: A, id }).numbers.list.find((n) => n.id === num.id);
ok('a number entered in the meeting shows as missed against target', nrow.weeks[nrow.weeks.length - 1].hit === false);

console.log('\n=== updates and roadblocks ===');
call({ action: 'addMeetingItem', token: V, id, form: { kind: 'update', text: 'New lathe arrives Thursday' } });
const rb = call({ action: 'addMeetingItem', token: H, id, form: { kind: 'roadblock', text: 'Motor supplier late by two weeks',
  goal: goal.id } });
ok('a roadblock is raised, tied to the goal it threatens', rb.roadblocks.some((r) => r.goal === goal.id && r.status === 'open'));
call({ action: 'addMeetingItem', token: P, id, form: { kind: 'roadblock', text: 'Second shift supervisor needed', horizon: 'later' } });
mt = call({ action: 'getMeeting', token: A, id });
ok('one can be parked for later', mt.roadblocks.some((r) => r.horizon === 'later'));
const rbId = mt.roadblocks.find((r) => /Motor supplier/.test(r.text)).id;
ok('a Doer cannot change someone else’s roadblock', call({ action: 'updateMeetingItem', token: V, itemId: rbId,
   form: { clear: true } }).status === 'error');

console.log('\n=== actions are real tasks ===');
const act = call({ action: 'addMeetingAction', token: A, id, form: { title: 'Line up a second motor supplier',
  assignTo: U('sruti'), goal: goal.id, fromItem: rbId, clearItem: true } });
ok('an action is agreed from the roadblock', act.status === 'success', act.message);
const t = call({ action: 'getDashboard', token: A }).tasks.find((x) => x.title === 'Line up a second motor supplier');
ok('it is a Dome Box task on the person’s board', !!t && t.assignee === U('sruti'));
ok('due a week out unless said otherwise', t && Math.round((new Date(t.due) - new Date(new Date().toISOString().slice(0, 10))) / 864e5) === 7, t && t.due);
ok('tied to the goal, so it moves the goal’s progress', t && t.goal === goal.id &&
   call({ action: 'getDirection', token: A }).goals.find((g) => g.id === goal.id).progress.total === 1);
ok('and to the meeting that raised it', t && t.raisedIn === id);
mt = call({ action: 'getMeeting', token: A, id });
ok('the roadblock it came from is cleared in this meeting', mt.roadblocks.find((r) => r.id === rbId).status === 'cleared');
ok('the action shows in the Actions segment, marked new', mt.actions.some((a) => a.id === t.id && a.newHere));
ok('an action for someone outside the company is refused', call({ action: 'addMeetingAction', token: A, id,
   form: { title: 'x', assignTo: 'nobody' } }).status === 'error');

console.log('\n=== any meeting point can be delegated as a task ===');
mt = call({ action: 'getMeeting', token: A, id });
const upd = mt.updates.find((u) => /New lathe/.test(u.text));
const d1 = call({ action: 'addMeetingAction', token: A, id, form: { title: 'Book the riggers for the lathe',
  assignTo: [U('vikram'), U('payel')].join(','), fromItem: upd.id, priority: 'Medium', dueDate: ymd(3) } });
ok('an update is delegated to two people at once', d1.status === 'success' && /Vikram/.test(d1.message) && /Payel/.test(d1.message), d1.message);
const d1u = d1.updates.find((u) => u.id === upd.id);
ok('the update now shows both tasks made from it, with who and where they stand',
   d1u.tasks.length === 2 && d1u.tasks.every((x) => x.toName && x.status), JSON.stringify(d1u.tasks));
const bt = call({ action: 'getDashboard', token: A }).tasks.filter((x) => x.title === 'Book the riggers for the lathe');
ok('they are real tasks, with the priority and due date picked', bt.length === 2 &&
   bt.every((x) => x.priority === 'Medium' && x.due === ymd(3) && x.raisedIn === id), JSON.stringify(bt.map((x) => [x.priority, x.due])));
ok('and the task says which point it came from', bt.every((x) => /Update: New lathe arrives Thursday/.test(x.desc || x.description || '')),
   bt[0] && (bt[0].desc || bt[0].description));
ok('an update is not "cleared" by delegating it — only roadblocks clear',
   call({ action: 'getMeeting', token: A, id }).updates.find((u) => u.id === upd.id).status === 'open');
const gd = call({ action: 'addMeetingAction', token: A, id, form: { title: 'Weekly call with the motor vendor',
  assignTo: U('sruti'), goal: goal.id, context: 'Goal: ' + goal.title } });
const gt = call({ action: 'getDashboard', token: A }).tasks.find((x) => x.title === 'Weekly call with the motor vendor');
ok('a goal off course is delegated straight from the goal check', gd.status === 'success' && gt && gt.goal === goal.id &&
   /Goal: /.test(gt.desc || gt.description || ''), gt && (gt.desc || gt.description));
ok('a point from another meeting cannot be delegated from this one', call({ action: 'addMeetingAction', token: A, id,
   form: { title: 'x', assignTo: U('sruti'), fromItem: 'I-nonsense' } }).status === 'error');
const doerUp = call({ action: 'addMeetingAction', token: V, id, form: { title: 'Need a second fixture', assignTo: U('payel'),
  fromItem: upd.id } });
ok('a Doer cannot hand work sideways to a peer — the usual assignment rules hold', doerUp.status === 'error', doerUp.message);

console.log('\n=== close ===');
ok('a rating must be 1 to 10', call({ action: 'rateMeeting', token: P, id, score: 11 }).status === 'error');
call({ action: 'rateMeeting', token: P, id, score: 9 });
call({ action: 'rateMeeting', token: H, id, score: 7 });
call({ action: 'rateMeeting', token: P, id, score: 8 });               // changes her mind
mt = call({ action: 'getMeeting', token: A, id });
ok('rating twice replaces, never counts twice', mt.meeting.ratings.count === 2 && mt.meeting.ratings.average === 7.5,
   JSON.stringify(mt.meeting.ratings));
ok('ratings are anonymous — no name ever comes back with a score',
   !/sruti|payel/.test(JSON.stringify(mt.meeting.ratings)) && !('Ratings JSON' in mt.meeting));
ok('each person sees only their own', call({ action: 'getMeeting', token: P, id }).meeting.myRating === 8);
call({ action: 'addUser', token: A, form: { name: 'Zed', username: U('zed'), email: U('zed') + '@acme.in',
  role: 'Doer', jobProfile: 'x', password: 'staffpass123' } });
ok('somebody never in the room cannot rate it', call({ action: 'rateMeeting', token: tok('zed'), id, score: 1 }).status === 'error');

call({ action: 'saveMinutes', token: A, id, text: 'Supplier call Monday. Lathe install Thursday.' });
ok('only the chair writes the minutes', call({ action: 'saveMinutes', token: P, id, text: 'x' }).status === 'error');
const before = env.mails.length;
ok('an attendee cannot end it', call({ action: 'endMeeting', token: P, id }).status === 'error');
const end = call({ action: 'endMeeting', token: A, id });
ok('the chair ends it', end.status === 'success', end.message);
ok('the summary counts what happened', end.summary.present === 4 && end.summary.actionsCreated === 4 &&
   end.summary.roadblocksCleared === 1 && end.summary.roadblocksOpen === 1 && end.summary.goalsAtRisk === 1 &&
   end.summary.numbersMissed === 1 && end.summary.wins === 1 && end.summary.stories === 1, JSON.stringify(end.summary));
const sent = env.mails.slice(before);
ok('everyone present gets the summary', sent.length === 4, sent.map((m) => m.to).join(','));
ok('from info@biscsindia.com', sent.every((m) => m.from === 'info@biscsindia.com'));
ok('with their own actions at the top', /Line up a second motor supplier/.test((sent.find((m) => m.to === U('sruti') + '@acme.in') || {}).html || ''));
ok('and the minutes', sent.every((m) => /Supplier call Monday/.test(m.html)));
ok('nothing can be added after it ends', call({ action: 'addMeetingItem', token: P, id, form: { kind: 'win', text: 'late' } }).status === 'error');

console.log('\n=== next week ===');
const past = call({ action: 'getMeetings', token: H });
ok('it is in the history, with its rating', past.past.length === 1 && past.past[0].rating === 7.5, JSON.stringify(past.past));
const st2 = call({ action: 'startMeeting', token: H, form: { attendees: [ME, U('payel')] } });
ok('an HOD can chair the next one', st2.status === 'success', st2.message);
const wk2 = call({ action: 'getMeeting', token: H, id: st2.id });
ok('last week’s open roadblock is still on the list', wk2.roadblocks.some((r) => /Second shift/.test(r.text) && r.status === 'open'));
ok('the one cleared last week is not', !wk2.roadblocks.some((r) => r.id === rbId));
ok('last week’s action comes back to be checked, not marked new',
   wk2.actions.some((a) => a.id === t.id && !a.newHere));
ok('the Admin can see any meeting', call({ action: 'getMeeting', token: A, id: st2.id }).status === 'success');
ok('cancelling sends nothing', (() => { const b = env.mails.length;
   const c = call({ action: 'cancelMeeting', token: H, id: st2.id }); return c.status === 'success' && env.mails.length === b; })());
ok('and a cancelled meeting is not in the history', call({ action: 'getMeetings', token: H }).past.length === 1);

console.log('\n=== a roadblock can be raised between meetings ===');
ok('outside a meeting', call({ action: 'addMeetingItem', token: P, id: '', form: { kind: 'roadblock', text: 'Paint shop fan noisy' } }).status === 'success');
ok('but a win cannot', call({ action: 'addMeetingItem', token: P, id: '', form: { kind: 'win', text: 'x y' } }).status === 'error');
const st3 = call({ action: 'startMeeting', token: A, form: { attendees: [U('payel')] } });
ok('and the next meeting has it waiting', call({ action: 'getMeeting', token: A, id: st3.id }).roadblocks.some((r) => /Paint shop/.test(r.text)));
call({ action: 'cancelMeeting', token: A, id: st3.id });

console.log('\n=== agenda ===');
const st4 = call({ action: 'startMeeting', token: A, form: { attendees: [U('sruti')], saveAgenda: true,
  agenda: [{ key: 'close', minutes: 5 }, { key: 'roadblocks', minutes: 30 }, { key: 'wins', minutes: 3 }] } });
const ag = call({ action: 'getMeeting', token: A, id: st4.id }).meeting.agenda;
ok('segments can be dropped, but the order is the method and cannot be changed', ag.map((a) => a.key).join(',') === 'wins,roadblocks,close',
   ag.map((a) => a.key).join(','));
ok('minutes per segment can be set', ag.find((a) => a.key === 'roadblocks').minutes === 30);
call({ action: 'cancelMeeting', token: A, id: st4.id });
ok('a saved agenda becomes the default', call({ action: 'getMeetings', token: A }).agenda.map((a) => a.key).join(',') === 'wins,roadblocks,close');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
