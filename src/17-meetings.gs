// ===========================================================================
// MEETINGS
// ===========================================================================
/**
 * DOME BOX — THE WEEKLY REVIEW
 * =============================================================================
 * A meeting with a fixed shape, run from one screen, that leaves work behind
 * rather than minutes nobody reads.
 *
 *   Wins              who is here, and one good thing from each
 *   Values in action  a story of somebody living one of the company's values
 *   Goal check        each quarter goal: on course, at risk, done
 *   Key numbers       this week's figures against their targets
 *   Updates           anything everyone needs to know
 *   Roadblocks        problems and opportunities, worked one at a time
 *   Actions           what was agreed, by whom, by when
 *   Close             everyone rates the meeting 1–10
 *
 * WHAT IS DIFFERENT HERE
 *
 * An action agreed in the meeting is not a line in a list. It is a Dome Box
 * task: it lands on the person's board, it is chased by the daily digest, it
 * counts toward their score, and if it is tagged to a goal it moves that goal's
 * progress. The next meeting opens with last week's actions, done or not —
 * which is the whole point of having the meeting weekly.
 *
 * Roadblocks are not per meeting either. One raised and not cleared is still
 * there next week, until somebody clears it.
 *
 * Ratings are anonymous: the sheet keeps who rated so each person rates once,
 * but nothing the app returns ever pairs a name with a score.
 *
 * The screen polls every few seconds rather than holding a connection, because
 * Apps Script has no sockets. A chair moving to the next segment reaches
 * everyone within one poll.
 * =============================================================================
 */

var MEETING_SEGMENTS = [
  { key: 'wins',       title: 'Wins',             minutes: 5,  hint: 'Who is here today — and one good thing each, from work or home.' },
  { key: 'values',     title: 'Values in action', minutes: 5,  hint: 'Who lived one of our values this week? Tell the story.' },
  { key: 'goals',      title: 'Goal check',       minutes: 5,  hint: 'Each quarter goal: on course, at risk, or done. No discussion here — raise a roadblock.' },
  { key: 'numbers',    title: 'Key numbers',      minutes: 5,  hint: 'This week’s figures against their targets. A miss becomes a roadblock.' },
  { key: 'updates',    title: 'Updates',          minutes: 5,  hint: 'Anything everybody needs to know. One line each.' },
  { key: 'roadblocks', title: 'Roadblocks',       minutes: 60, hint: 'Work them one at a time, most important first, until each is cleared or becomes an action.' },
  { key: 'actions',    title: 'Actions',          minutes: 5,  hint: 'Last week’s actions: done or not. This week’s: who, what, by when.' },
  { key: 'close',      title: 'Close',            minutes: 5,  hint: 'Rate the meeting from 1 to 10. Anything under 8, say why.' },
];
var ITEM_KINDS = ['win', 'story', 'update', 'roadblock'];

function requireMeetings_(ctx) {
  if (!ctx.plan.analytics) {
    var e = new Error('Meetings are included in every paid plan.'); e.upgrade = true; throw e;
  }
}

/* ---------- reading ------------------------------------------------------ */

function readMeetings_(ctx) {
  return cached_(ctx, 'meetings', function () {
    var sh = ctx.ss.getSheetByName(TAB.MEETINGS);
    if (!sh) return [];
    return sh.getDataRange().getValues().slice(1).map(function (r, i) { r.row_ = i + 2; return r; })
      .filter(function (r) { return r[0]; }).map(function (r) {
      return { id: String(r[0]), title: String(r[1] || ''), date: toYmd_(r[2]), status: String(r[3] || 'ended'),
               chair: String(r[4] || ''), started: toIso_(r[5]), ended: toIso_(r[6]),
               attendees: safeJson_(r[7], []), agenda: safeJson_(r[8], []),
               segment: Number(r[9]) || 0, minutes: String(r[10] || ''),
               ratings: safeJson_(r[11], {}), summary: safeJson_(r[12], null), row: r.row_ };
    });
  });
}

function readItems_(ctx) {
  return cached_(ctx, 'meetingItems', function () {
    var sh = ctx.ss.getSheetByName(TAB.MEETING_ITEMS);
    if (!sh) return [];
    return sh.getDataRange().getValues().slice(1).map(function (r, i) { r.row_ = i + 2; return r; })
      .filter(function (r) { return r[0]; }).map(function (r) {
      return { id: String(r[0]), meeting: String(r[1] || ''), kind: String(r[2] || ''), text: String(r[3] || ''),
               person: String(r[4] || ''), value: String(r[5] || ''), goal: String(r[6] || ''),
               status: String(r[7] || 'open'), horizon: String(r[8] || 'now'),
               by: String(r[9] || ''), at: toIso_(r[10]), clearedIn: String(r[11] || ''),
               tasks: String(r[12] || '').split(',').filter(function (x) { return x; }), row: r.row_ };
    });
  });
}

function meetingById_(ctx, id) {
  return readMeetings_(ctx).filter(function (m) { return m.id === String(id || ''); })[0] || null;
}

function liveMeeting_(ctx) {
  return readMeetings_(ctx).filter(function (m) { return m.status === 'live'; })[0] || null;
}

/* Who may see a meeting: its attendees, its chair, and any Admin. A Doer who
   was not in the room does not read the room's roadblocks. */
function canSeeMeeting_(ctx, m) {
  var me = ctx.actor.username;
  return ctx.actor.role === ROLE.ADMIN || m.chair === me || m.attendees.some(function (a) { return a.u === me; });
}
function canChair_(ctx, m) { return ctx.actor.role === ROLE.ADMIN || m.chair === ctx.actor.username; }

/* ---------- the list ---------------------------------------------------- */

function getMeetings_(ctx) {
  requireMeetings_(ctx);
  var mine = readMeetings_(ctx).filter(function (m) { return canSeeMeeting_(ctx, m) && m.status !== 'cancelled'; });
  var live = mine.filter(function (m) { return m.status === 'live'; })[0] || null;
  return { status: 'success',
    live: live ? { id: live.id, title: live.title, chair: live.chair, started: live.started,
                   segment: live.agenda[live.segment] ? live.agenda[live.segment].title : '' } : null,
    past: mine.filter(function (m) { return m.status === 'ended'; }).reverse().slice(0, 40).map(function (m) {
      return { id: m.id, title: m.title, date: m.date, attendees: m.attendees.length,
               present: m.attendees.filter(function (a) { return a.p; }).length,
               rating: m.summary ? m.summary.rating : null,
               actions: m.summary ? m.summary.actionsCreated : 0 };
    }),
    segments: MEETING_SEGMENTS, agenda: defaultAgenda_(ctx),
    canStart: ctx.actor.role !== ROLE.DOER };
}

function defaultAgenda_(ctx) {
  var saved = safeJson_(readSetting_(ctx, 'meetingAgenda', ''), null);
  if (saved && saved.length) return saved;
  return MEETING_SEGMENTS.map(function (s) { return { key: s.key, title: s.title, minutes: s.minutes }; });
}

/* ---------- starting, moving, ending ------------------------------------- */

function startMeeting_(ctx, form) {
  requireMeetings_(ctx); requireManager_(ctx); blockIfStopped_(ctx);
  form = form || {};
  if (liveMeeting_(ctx)) throw new Error('A meeting is already running. Join it, or end it first.');

  var users = readUsers_(ctx).filter(function (u) { return u.active !== false; });
  var byName = {}; users.forEach(function (u) { byName[u.username] = u; });
  var invited = (form.attendees || []).map(String).filter(function (u) { return byName[u]; });
  if (invited.indexOf(ctx.actor.username) < 0) invited.unshift(ctx.actor.username);
  if (invited.length < 2) throw new Error('A meeting needs at least two people. Pick who is attending.');

  /* The agenda is chosen per meeting from the fixed segment list, in its fixed
     order. Segments can be dropped and their minutes changed, never reordered:
     the order is the method — numbers before roadblocks, so misses are on the
     table when the hard conversation starts. Close is always last and kept. */
  var picked = form.agenda && form.agenda.length ? form.agenda : defaultAgenda_(ctx);
  var keep = {}; picked.forEach(function (a) { keep[a.key] = a; });
  var agenda = MEETING_SEGMENTS.filter(function (s) { return keep[s.key] || s.key === 'close'; }).map(function (s) {
    var m = Number((keep[s.key] || {}).minutes);
    return { key: s.key, title: s.title, minutes: (m > 0 && m <= 180) ? Math.round(m) : s.minutes };
  });
  if (form.saveAgenda) writeSetting_(ctx, 'meetingAgenda', JSON.stringify(agenda));

  return withLock_(function () {
    if (liveMeeting_(ctx)) throw new Error('A meeting is already running.');
    var id = 'M-' + Utilities.getUuid().slice(0, 8), now = new Date();
    var title = String(form.title || 'Weekly review').trim().slice(0, 80);
    tab_(ctx, TAB.MEETINGS, MEETING_COLS).appendRow([id, title, ymd(now), 'live', ctx.actor.username, now, '',
      JSON.stringify(invited.map(function (u) { return { u: u, p: u === ctx.actor.username }; })),
      JSON.stringify(agenda), 0, '', '{}', '']);
    dropCache_(ctx);
    return { status: 'success', id: id, message: title + ' started.' };
  });
}

function writeMeeting_(ctx, m, fields) {
  var sh = tab_(ctx, TAB.MEETINGS, MEETING_COLS);
  Object.keys(fields).forEach(function (k) {
    var col = MEETING_COLS.indexOf(k) + 1;
    if (col > 0) sh.getRange(m.row, col).setValue(fields[k]);
  });
  dropCache_(ctx);
}

function liveFor_(ctx, id) {
  requireMeetings_(ctx);
  var m = meetingById_(ctx, id);
  if (!m || !canSeeMeeting_(ctx, m)) throw new Error('That meeting is not one you are in.');
  if (m.status !== 'live') throw new Error('That meeting has ended.');
  return m;
}

function meetingGo_(ctx, id, segment) {
  blockIfStopped_(ctx);
  var m = liveFor_(ctx, id);
  if (!canChair_(ctx, m)) throw new Error('Only the person chairing can move the meeting on.');
  var n = Math.max(0, Math.min(m.agenda.length - 1, Number(segment) || 0));
  return withLock_(function () {
    writeMeeting_(ctx, m, { 'Segment': n });
    return getMeeting_(ctx, id);
  });
}

function setAttendance_(ctx, id, username, present) {
  blockIfStopped_(ctx);
  var m = liveFor_(ctx, id);
  if (!canChair_(ctx, m)) throw new Error('Only the person chairing takes attendance.');
  return withLock_(function () {
    var m2 = meetingById_(ctx, id), found = false;
    var list = m2.attendees.map(function (a) {
      if (a.u === username) { found = true; return { u: a.u, p: !!present }; }
      return a;
    });
    if (!found) {
      if (!findUser_(ctx.ss, username)) throw new Error('That person is not in this workspace.');
      list.push({ u: username, p: !!present });            // somebody who walked in late
    }
    writeMeeting_(ctx, m2, { 'Attendees JSON': JSON.stringify(list) });
    return getMeeting_(ctx, id);
  });
}

function saveMinutes_(ctx, id, text) {
  blockIfStopped_(ctx);
  var m = liveFor_(ctx, id);
  if (!canChair_(ctx, m)) throw new Error('Only the person chairing keeps the minutes.');
  return withLock_(function () {
    writeMeeting_(ctx, m, { 'Minutes': String(text || '').slice(0, 40000) });
    return { status: 'success', message: 'Minutes saved.' };
  });
}

/* ---------- items: wins, stories, updates, roadblocks ------------------- */

function addMeetingItem_(ctx, id, form) {
  blockIfStopped_(ctx);
  form = form || {};
  var kind = String(form.kind || '');
  if (ITEM_KINDS.indexOf(kind) < 0) throw new Error('Unknown item.');
  var text = String(form.text || '').trim();
  if (text.length < 2) throw new Error('Write something first.');

  /* A roadblock can be raised outside a meeting, into the list the next
     meeting will work through. Everything else belongs to a live meeting. */
  var m = null;
  if (id) m = liveFor_(ctx, id);
  else if (kind !== 'roadblock') throw new Error('Wins, stories and updates are shared in a meeting.');
  else requireMeetings_(ctx);

  var person = String(form.person || '').trim();
  if (person && !findUser_(ctx.ss, person)) throw new Error('That person is not in this workspace.');
  var val = '';
  if (form.value) {
    var v = valueByTag_(ctx, form.value);
    if (!v) throw new Error('That value is not one of this company’s values.');
    val = v.code || v.title;
  }
  if (kind === 'story' && !val) throw new Error('Which value did they live? Pick one — a story without one is just a nice story.');
  var goal = String(form.goal || '').trim();
  if (goal && !goalById_(ctx, goal)) throw new Error('That goal no longer exists.');
  var horizon = form.horizon === 'later' ? 'later' : 'now';

  var row = ['I-' + Utilities.getUuid().slice(0, 8), m ? m.id : '', kind, text.slice(0, 2000), person, val, goal,
             'open', horizon, ctx.actor.username, new Date(), '', ''];
  tab_(ctx, TAB.MEETING_ITEMS, MEETING_ITEM_COLS).appendRow(row);
  dropCache_(ctx);

  /* A story can carry cookie points with it. Through awardCookie_, so the same
     rules hold: a manager, for someone who reports to them, with a reason. */
  var cookie = null;
  if (kind === 'story' && person && Number(form.cookies) > 0) {
    cookie = awardCookie_(ctx, { employee: person, points: Number(form.cookies), reason: text, value: val });
  }
  var out = m ? getMeeting_(ctx, m.id) : { status: 'success' };
  out.message = cookie ? cookie.message : 'Added.';
  return out;
}

function updateMeetingItem_(ctx, itemId, form) {
  blockIfStopped_(ctx);
  form = form || {};
  var it = readItems_(ctx).filter(function (x) { return x.id === itemId; })[0];
  if (!it) throw new Error('That item no longer exists.');
  var live = liveMeeting_(ctx);
  var mine = it.by === ctx.actor.username;
  if (!mine && ctx.actor.role === ROLE.DOER) throw new Error('Only whoever raised it, or a manager, can change it.');
  return withLock_(function () {
    var sh = tab_(ctx, TAB.MEETING_ITEMS, MEETING_ITEM_COLS);
    if (form.remove) {
      if (it.kind === 'roadblock' && it.status !== 'open') throw new Error('A cleared roadblock stays on the record.');
      sh.deleteRow(it.row);
    } else {
      if (form.text !== undefined) sh.getRange(it.row, 4).setValue(String(form.text).slice(0, 2000));
      if (form.horizon) sh.getRange(it.row, 9).setValue(form.horizon === 'later' ? 'later' : 'now');
      if (form.goal !== undefined) {
        if (form.goal && !goalById_(ctx, form.goal)) throw new Error('That goal no longer exists.');
        sh.getRange(it.row, 7).setValue(String(form.goal || ''));
      }
      if (form.clear !== undefined) {
        sh.getRange(it.row, 8).setValue(form.clear ? 'cleared' : 'open');
        sh.getRange(it.row, 12).setValue(form.clear ? (live ? live.id : 'outside a meeting') : '');
      }
    }
    dropCache_(ctx);
    return live && canSeeMeeting_(ctx, live) ? getMeeting_(ctx, live.id) : { status: 'success' };
  });
}

/**
 * Delegates a meeting point as a task — any of them: a roadblock, a win, a
 * story, an update, a goal off course, a number that missed. Through
 * createTask_, so it is assigned, routed and capped exactly like any other
 * work; tagged with the meeting it came from and, if given, the goal. The
 * point keeps a link to every task made from it, so the room can see it has
 * already been handed out instead of handing it out twice.
 */
function addMeetingAction_(ctx, id, form) {
  form = form || {};
  var m = liveFor_(ctx, id);
  var item = null;
  if (form.fromItem) {
    item = readItems_(ctx).filter(function (x) { return x.id === String(form.fromItem); })[0];
    if (!item || (item.meeting !== m.id && !(item.kind === 'roadblock' && (item.status === 'open' || item.clearedIn === m.id)))) {
      throw new Error('That point is not part of this meeting.');
    }
  }
  var due = String(form.dueDate || '').trim();
  if (!due) { var d = new Date(); d.setDate(d.getDate() + 7); due = ymd(d); }
  var KIND = { win: 'Win', story: 'Values story', update: 'Update', roadblock: 'Roadblock' };
  var context = item ? KIND[item.kind] + ': ' + item.text : String(form.context || '').trim().slice(0, 500);
  var desc = String(form.desc || '').trim() || ('Agreed in ' + m.title + ', ' + m.date + '.' + (context ? '\n' + context : ''));
  var priority = ['Low', 'Medium', 'High', 'Critical'].indexOf(form.priority) > -1 ? form.priority : 'High';
  var r = createTask_(ctx, { title: form.title, desc: desc,
    assignTo: form.assignTo, dueDate: due, priority: priority,
    goal: form.goal || '', raisedIn: m.id, jobCategory: form.jobCategory || 'General' });

  if (item) {
    withLock_(function () {
      var fresh = readItems_(ctx).filter(function (x) { return x.id === item.id; })[0];
      if (!fresh) return;
      tab_(ctx, TAB.MEETING_ITEMS, MEETING_ITEM_COLS).getRange(fresh.row, 13)
        .setValue(fresh.tasks.concat(r.ids || []).join(','));
      dropCache_(ctx);
    });
    if (item.kind === 'roadblock' && form.clearItem) {
      try { updateMeetingItem_(ctx, item.id, { clear: true }); } catch (e) {}
    }
  }
  var out = getMeeting_(ctx, m.id);
  var names = String(form.assignTo || '').split(',').map(function (u) {
    var who = findUser_(ctx.ss, u.trim()); return who ? who.name : ''; }).filter(function (n) { return n; });
  var sent = names.filter(function (n) { return !(r.refused || []).some(function (x) { return x.name === n; }); });
  out.message = 'Delegated to ' + (sent.join(', ') || 'them') + ', due ' + due + '.' +
    ((r.refused || []).length ? ' Not sent to ' + r.refused.map(function (x) { return x.name + ' (' + x.reason + ')'; }).join(', ') + '.' : '');
  return out;
}

function rateMeeting_(ctx, id, score) {
  blockIfStopped_(ctx);
  var m = liveFor_(ctx, id);
  var s = Math.round(Number(score));
  if (!(s >= 1 && s <= 10)) throw new Error('Rate it from 1 to 10.');
  if (!m.attendees.some(function (a) { return a.u === ctx.actor.username; })) {
    throw new Error('Only people in the meeting rate it.');
  }
  return withLock_(function () {
    var m2 = meetingById_(ctx, id);
    var r = m2.ratings || {};
    r[ctx.actor.username] = s;                       // re-rating replaces, never adds a second vote
    writeMeeting_(ctx, m2, { 'Ratings JSON': JSON.stringify(r) });
    return getMeeting_(ctx, id);
  });
}

/* ---------- the live view ------------------------------------------------ */

function getMeeting_(ctx, id) {
  requireMeetings_(ctx);
  var m = meetingById_(ctx, id);
  if (!m || !canSeeMeeting_(ctx, m)) throw new Error('That meeting is not one you are in.');
  var users = readUsers_(ctx), names = {};
  users.forEach(function (u) { names[u.username] = u.name; });
  var items = readItems_(ctx);
  var tasks = readTasks_(ctx);
  var taskById = {}; tasks.forEach(function (t) { taskById[t.id] = t; });
  var dir = readDirection_(ctx);
  var goals = readGoals_(ctx);
  var sm = fyStartMonth_(ctx), q = fyPeriod_(m.date ? parseYmd(m.date) : new Date(), sm);

  var here = items.filter(function (i) { return i.meeting === m.id; });
  var road = items.filter(function (i) {
    return i.kind === 'roadblock' && (i.status === 'open' || i.clearedIn === m.id);
  });

  /* Actions: everything raised in a meeting that is still open, plus whatever
     closed since the previous meeting — last week's, done or not. */
  var prev = readMeetings_(ctx).filter(function (x) {
    return x.status === 'ended' && x.id !== m.id && x.started && x.started < (m.started || '9'); }).pop();
  var since = prev ? prev.started : '';
  var meetingIds = {}; readMeetings_(ctx).forEach(function (x) { meetingIds[x.id] = x; });
  var actions = tasks.filter(function (t) {
    if (!t.raisedIn || !meetingIds[t.raisedIn]) return false;
    if (t.raisedIn === m.id) return true;
    if (isOpen(t.status)) return true;
    var closed = closedAt(t);
    return closed && since && closed.toISOString() >= since;
  }).map(function (t) {
    return { id: t.id, title: t.title, to: t.assignee, toName: names[t.assignee] || t.assignee,
             due: t.due, status: t.status, goal: t.goal, newHere: t.raisedIn === m.id,
             late: isOpen(t.status) && t.due && dayDiff(new Date(), parseYmd(t.due)) > 0 };
  });

  var ratings = m.ratings || {}, rk = Object.keys(ratings);
  var label = function (i) { return { id: i.id, text: i.text, person: i.person, personName: names[i.person] || '',
    value: i.value, goal: i.goal, status: i.status, horizon: i.horizon, by: i.by,
    byName: names[i.by] || i.by, at: i.at, mine: i.by === ctx.actor.username,
    tasks: i.tasks.map(function (tid) { return taskById[tid]; }).filter(function (t) { return t; }).map(function (t) {
      return { id: t.id, title: t.title, to: t.assignee, toName: names[t.assignee] || t.assignee, status: t.status, due: t.due }; }) }; };

  return { status: 'success', meeting: {
      id: m.id, title: m.title, date: m.date, status: m.status, chair: m.chair, chairName: names[m.chair] || m.chair,
      started: m.started, ended: m.ended, segment: m.segment, agenda: m.agenda,
      attendees: m.attendees.map(function (a) { return { u: a.u, name: names[a.u] || a.u, present: !!a.p }; }),
      minutes: m.minutes, summary: m.summary,
      iAmChair: canChair_(ctx, m), iRated: ratings.hasOwnProperty(ctx.actor.username),
      myRating: ratings[ctx.actor.username] || null,
      /* Anonymous: a count and an average, never a name next to a number. */
      ratings: { count: rk.length, average: rk.length ? Math.round(rk.reduce(function (s, k) { return s + ratings[k]; }, 0) / rk.length * 10) / 10 : null,
                 expected: m.attendees.filter(function (a) { return a.p; }).length } },
    wins: here.filter(function (i) { return i.kind === 'win'; }).map(label),
    stories: here.filter(function (i) { return i.kind === 'story'; }).map(label),
    updates: here.filter(function (i) { return i.kind === 'update'; }).map(label),
    roadblocks: road.map(label),
    actions: actions,
    goals: goals.filter(function (g) { return g.level === 'quarter' && g.period === q.quarter && g.status !== 'Dropped'; })
      .map(function (g) { return { id: g.id, title: g.title, owner: g.owner, ownerName: names[g.owner] || g.owner,
        status: g.status, note: g.note, progress: goalProgress_(g, goals, tasks) }; }),
    quarter: q.quarter,
    numbers: readNumbersWithLog_(ctx, names),
    values: dir.values.map(function (v) { return { code: v.code, title: v.title }; }), purpose: dir.purpose,
    segments: MEETING_SEGMENTS };
}

/* ---------- ending ------------------------------------------------------- */

/**
 * @param quiet  skip the summary email. Not reachable from the API — the router
 *               always passes false. Only the demo builder sets it, because its
 *               sample meeting is "attended" by an Admin whose address is real.
 */
function endMeeting_(ctx, id, cancel, quiet) {
  blockIfStopped_(ctx);
  var m = liveFor_(ctx, id);
  if (!canChair_(ctx, m)) throw new Error('Only the person chairing can end the meeting.');
  if (cancel) {
    return withLock_(function () {
      writeMeeting_(ctx, m, { 'Status': 'cancelled', 'Ended': new Date() });
      return { status: 'success', message: 'Meeting cancelled. Nothing was sent.' };
    });
  }

  var view = getMeeting_(ctx, id);
  var r = view.meeting.ratings;
  var summary = {
    present: view.meeting.attendees.filter(function (a) { return a.present; }).length,
    invited: view.meeting.attendees.length,
    wins: view.wins.length, stories: view.stories.length, updates: view.updates.length,
    roadblocksCleared: view.roadblocks.filter(function (x) { return x.status === 'cleared'; }).length,
    roadblocksOpen: view.roadblocks.filter(function (x) { return x.status === 'open'; }).length,
    actionsCreated: view.actions.filter(function (a) { return a.newHere; }).length,
    actionsCarried: view.actions.filter(function (a) { return !a.newHere && isOpen(a.status); }).length,
    goalsAtRisk: view.goals.filter(function (g) { return g.status === 'At risk'; }).length,
    numbersMissed: view.numbers.list.filter(function (n) {
      var w = n.weeks[n.weeks.length - 1]; return w && w.hit === false; }).length,
    rating: r.average, ratingCount: r.count,
  };

  withLock_(function () {
    writeMeeting_(ctx, meetingById_(ctx, id), { 'Status': 'ended', 'Ended': new Date(),
      'Summary JSON': JSON.stringify(summary) });
  });

  /* The summary goes to everyone who was there, from the company address, with
     their own actions at the top — the thing they actually need on Monday. */
  if (!quiet) try {
    var users = readUsers_(ctx);
    view.meeting.attendees.filter(function (a) { return a.present; }).forEach(function (a) {
      var u = users.filter(function (x) { return x.username === a.u; })[0];
      if (!u || !u.email) return;
      var mineList = view.actions.filter(function (x) { return x.to === a.u && isOpen(x.status); });
      sendEmail_(u.email, view.meeting.title + ' — ' + view.meeting.date, meetingSummaryHtml_(view, summary, mineList));
    });
  } catch (e) { logError_('endMeeting:mail', e.message); }

  return { status: 'success', summary: summary,
    message: 'Meeting ended. The summary has gone to everyone who was there.' };
}

function meetingSummaryHtml_(v, s, mine) {
  var row = function (a) {
    return '<li style="margin:4px 0"><strong>' + esc_(a.title) + '</strong> — ' + esc_(a.toName) +
      ', due ' + esc_(a.due || 'no date') + '</li>'; };
  return mailShell_(v.meeting.title + ' — ' + v.meeting.date,
    (mine.length ? '<p><strong>Your actions</strong></p><ul style="padding-left:18px">' + mine.map(row).join('') + '</ul>'
                 : '<p>You have no open actions from this meeting.</p>') +
    infoTable_([['Present', s.present + ' of ' + s.invited],
      ['Roadblocks cleared', String(s.roadblocksCleared)], ['Still open', String(s.roadblocksOpen)],
      ['New actions', String(s.actionsCreated)], ['Goals at risk', String(s.goalsAtRisk)],
      ['Key numbers missed', String(s.numbersMissed)],
      ['Rating', s.rating === null ? 'not rated' : s.rating + ' / 10 (' + s.ratingCount + ')']]) +
    (v.meeting.minutes ? '<p><strong>Minutes</strong></p><p style="white-space:pre-wrap">' + esc_(v.meeting.minutes) + '</p>' : '') +
    btn_('Open Dome Box', CFG().siteUrl));
}
