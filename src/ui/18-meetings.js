/* ---------------------------------------------------------------------------
   MEETINGS — the weekly review, run from one screen

   Everyone in the meeting has this screen open. The chair moves it on; the
   others follow on their next poll (every 5 seconds — Apps Script has no
   sockets). Each segment is drawn in two parts:

     · the fixed part — the forms people type into — drawn once per segment;
     · the live part (#segLive) — lists, attendance, ratings — redrawn on
       every poll, EXCEPT while something inside it has focus. A refresh that
       wipes the figure you are halfway through typing is the fastest way to
       make a room stop using the tool.
--------------------------------------------------------------------------- */

var MEET = { id: null, v: null, poll: null, tick: null, seg: -1, segAt: 0 };
var POLL_MS = 5000;

function stopMeetingPoll() {
  if (MEET.poll) clearInterval(MEET.poll);
  if (MEET.tick) clearInterval(MEET.tick);
  MEET.poll = MEET.tick = null;
}

function isManager() { return STATE.user && STATE.user.role !== 'Doer'; }

function loadMeetings() {
  stopMeetingPoll();
  MEET.id = null;
  $('meetBody').innerHTML = '<div class="text-sm font-bold text-gray-400 py-10 text-center">Loading…</div>';
  if (!STATE.dir) loadDirection();
  api('getMeetings', {}).then(renderMeetingList).catch(function (e) {
    $('meetBody').innerHTML = '<div class="max-w-[700px] mx-auto px-4 py-12 text-center">' +
      '<div class="text-xl font-black mb-2">Weekly reviews</div>' +
      '<p class="text-sm font-semibold text-gray-500 mb-5">' + esc(e.message) + '</p>' +
      (/paid plan/.test(e.message) ? '<button class="btn btn-p" onclick="openBilling()">See plans</button>' : '') + '</div>';
  });
}

function renderMeetingList(r) {
  MEET.list = r;
  var live = r.live
    ? '<div class="rounded-2xl p-5 mb-6 text-white flex flex-wrap items-center gap-4" style="background:linear-gradient(135deg,#5b4bdb,#8e3fb8)">' +
        '<span class="w-3 h-3 rounded-full bg-white animate-pulse"></span>' +
        '<div class="flex-1 min-w-[200px]"><div class="font-black text-lg">' + esc(r.live.title) + ' is running</div>' +
        '<div class="text-xs font-bold opacity-80">Now on: ' + esc(r.live.segment) + '</div></div>' +
        '<button class="btn bg-white text-gray-900 font-black" onclick="openMeeting(\'' + esc(r.live.id) + '\')">Join</button></div>'
    : '';
  $('meetBody').innerHTML = '<div class="max-w-[1000px] mx-auto px-4 lg:px-6 py-6">' +
    '<div class="flex flex-wrap items-center gap-2 mb-5"><h2 class="text-2xl font-black mr-auto">Meetings</h2>' +
      (r.canStart && !r.live ? '<button class="btn btn-p" onclick="openStartMeeting()">Start a weekly review</button>' : '') +
      '<button class="btn btn-g" onclick="openRaiseRoadblock()">Raise a roadblock</button></div>' +
    live +
    (!r.past.length && !r.live
      ? '<div class="bg-white rounded-2xl border border-dashed border-gray-200 p-10 text-center">' +
          '<div class="font-black mb-1">No meetings yet</div>' +
          '<p class="text-sm font-semibold text-gray-400 max-w-md mx-auto">A weekly review runs in eight short segments, from ' +
          'wins to actions. Every action agreed becomes a task on that person’s board, and next week’s meeting ' +
          'opens by checking them.</p></div>'
      : '<div class="lb">Past meetings</div><div class="bg-white rounded-2xl border border-gray-100 overflow-hidden">' +
        r.past.map(function (m) {
          return '<button class="w-full text-left flex flex-wrap items-center gap-4 px-5 py-3.5 border-t border-gray-100 first:border-t-0 hover:bg-gray-50" ' +
            'onclick="openMeetingSummary(\'' + esc(m.id) + '\')">' +
            '<div class="flex-1 min-w-[160px]"><div class="font-black text-sm">' + esc(m.title) + '</div>' +
            '<div class="text-[11px] font-semibold text-gray-400">' + esc(m.date) + '</div></div>' +
            '<span class="text-xs font-bold text-gray-500">' + m.present + '/' + m.attendees + ' present</span>' +
            '<span class="text-xs font-bold text-gray-500">' + m.actions + ' action' + (m.actions === 1 ? '' : 's') + '</span>' +
            '<span class="chip ' + (m.rating === null ? 't-slate' : m.rating >= 8 ? 't-teal' : 't-amber') + '">' +
              (m.rating === null ? 'not rated' : m.rating + ' / 10') + '</span></button>'; }).join('') + '</div>') +
    '</div>';
}

/* ---------- starting ----------------------------------------------------- */

function openStartMeeting() {
  var r = MEET.list, staff = ((STATE.data && STATE.data.staff) || []).filter(function (u) { return u.active !== false; });
  var on = {}; (r.agenda || []).forEach(function (a) { on[a.key] = a; });
  openModal('<form id="fStart" class="p-6 lg:p-7">' +
    '<h2 class="text-2xl font-black mb-4">Start a weekly review</h2>' +
    '<label class="lb" for="mtTitle">Title</label><input id="mtTitle" class="in mb-5" value="Weekly review" maxlength="80">' +
    '<div class="lb">Who is attending</div>' +
    '<div class="grid sm:grid-cols-2 gap-1.5 mb-5 max-h-48 overflow-y-auto">' + staff.map(function (u) {
      var me = u.username === STATE.user.username;
      return '<label class="flex items-center gap-2 text-sm font-semibold py-1"><input type="checkbox" class="w-4 h-4 mtWho" value="' +
        esc(u.username) + '"' + (me || u.role !== 'Doer' ? ' checked' : '') + (me ? ' disabled' : '') + '> ' + esc(u.name) +
        ' <span class="text-[11px] text-gray-400">' + esc(u.role) + '</span></label>'; }).join('') + '</div>' +
    '<div class="lb">Agenda <span class="normal-case tracking-normal font-semibold">— drop a segment or change its minutes; the order is fixed</span></div>' +
    '<div class="space-y-1.5 mb-4">' + r.segments.map(function (s) {
      var keep = !!on[s.key] || s.key === 'close', mins = (on[s.key] || s).minutes;
      return '<div class="flex items-center gap-3 text-sm"><label class="flex items-center gap-2 font-bold flex-1">' +
        '<input type="checkbox" class="w-4 h-4 mtSeg" value="' + s.key + '"' + (keep ? ' checked' : '') +
        (s.key === 'close' ? ' disabled' : '') + '> ' + esc(s.title) + '</label>' +
        '<input class="in w-20 py-1.5 text-center mtMin" data-k="' + s.key + '" value="' + mins + '" inputmode="numeric" aria-label="' + esc(s.title) + ' minutes">' +
        '<span class="text-xs text-gray-400 w-8">min</span></div>'; }).join('') + '</div>' +
    '<label class="flex items-center gap-2 text-sm font-semibold mb-6"><input type="checkbox" id="mtSave" class="w-4 h-4"> ' +
      'Make this our default agenda</label>' +
    '<div class="flex gap-3"><button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
    '<button type="submit" class="btn btn-p flex-1">Start</button></div></form>', 'max-w-xl');
  $('fStart').addEventListener('submit', function (e) {
    e.preventDefault();
    var mins = {}; document.querySelectorAll('.mtMin').forEach(function (i) { mins[i.dataset.k] = Number(i.value); });
    var agenda = Array.prototype.filter.call(document.querySelectorAll('.mtSeg'), function (c) { return c.checked; })
      .map(function (c) { return { key: c.value, minutes: mins[c.value] }; });
    var who = Array.prototype.filter.call(document.querySelectorAll('.mtWho'), function (c) { return c.checked && !c.disabled; })
      .map(function (c) { return c.value; });
    busy(e.target.querySelector('button[type=submit]'), true, 'Starting…');
    api('startMeeting', { form: { title: $('mtTitle').value, attendees: who, agenda: agenda, saveAgenda: $('mtSave').checked } })
      .then(function (res) { closeModal(); toast(res.message, 'ok'); openMeeting(res.id); })
      .catch(function (err) { busy(e.target.querySelector('button[type=submit]'), false); toast(err.message, 'err'); });
  });
}

function openRaiseRoadblock() {
  openModal('<form id="fRb" class="p-6 lg:p-7">' +
    '<h2 class="text-xl font-black mb-1">Raise a roadblock</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-4">A problem or an opportunity. It waits on the list for the next weekly review.</p>' +
    '<textarea id="rbText" class="in mb-3" rows="3" required placeholder="What is in the way?"></textarea>' +
    '<label class="lb" for="rbGoal">Threatens goal</label><select id="rbGoal" class="in mb-5">' + goalOptions('', 'None') + '</select>' +
    '<div class="flex gap-3"><button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
    '<button type="submit" class="btn btn-p flex-1">Raise it</button></div></form>', 'max-w-md');
  $('fRb').addEventListener('submit', function (e) {
    e.preventDefault();
    api('addMeetingItem', { id: '', form: { kind: 'roadblock', text: $('rbText').value, goal: $('rbGoal').value } })
      .then(function () { toast('Raised. It will be on the next review.', 'ok'); closeModal(); })
      .catch(function (err) { toast(err.message, 'err'); });
  });
}

/* ---------- the runner --------------------------------------------------- */

function openMeeting(id) {
  stopMeetingPoll();
  MEET.id = id; MEET.seg = -1;
  if (STATE.tab !== 'meetings') { STATE.tab = 'meetings'; renderTab(); }
  $('meetBody').innerHTML = '<div class="text-sm font-bold text-gray-400 py-10 text-center">Joining…</div>';
  return pollMeeting(true).then(function () {
    MEET.poll = setInterval(function () { pollMeeting(false); }, POLL_MS);
    MEET.tick = setInterval(paintClock, 1000);
  });
}

function pollMeeting(first) {
  if (!MEET.id) return Promise.resolve();
  return api('getMeeting', { id: MEET.id }).then(function (v) { showMeeting(v, first); })
    .catch(function (e) { if (first) { toast(e.message, 'err'); loadMeetings(); } });
}

/** Called with every fresh view of the meeting — from a poll or after an action. */
function showMeeting(v, force) {
  if (!v || !v.meeting) return;
  if (v.meeting.status !== 'live') { stopMeetingPoll(); return showEnded(v); }
  var segChanged = v.meeting.segment !== MEET.seg;
  MEET.v = v;
  if (segChanged) { MEET.seg = v.meeting.segment; MEET.segAt = Date.now(); }
  if (force || segChanged || !$('mRunner')) return drawRunner(v);
  drawLive(v);
}

function fmtClock(ms) {
  var s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60);
  return (m < 10 ? '0' : '') + m + ':' + ('0' + (s % 60)).slice(-2);
}
function paintClock() {
  if (!MEET.v || !$('mSegClock')) return;
  var seg = MEET.v.meeting.agenda[MEET.v.meeting.segment] || {}, planned = (seg.minutes || 0) * 60000;
  var used = Date.now() - MEET.segAt;
  $('mSegClock').textContent = fmtClock(used) + ' / ' + (seg.minutes || 0) + ':00';
  $('mSegClock').className = 'font-black tabular-nums ' + (planned && used > planned ? 'text-red-600' : 'text-gray-800');
  $('mTotal').textContent = fmtClock(Date.now() - new Date(MEET.v.meeting.started).getTime());
}

function drawRunner(v) {
  var m = v.meeting, seg = m.agenda[m.segment], last = m.segment === m.agenda.length - 1;
  var def = v.segments.filter(function (s) { return s.key === seg.key; })[0] || {};
  $('meetBody').innerHTML = '<div id="mRunner">' +
    '<div class="bg-white border-b border-gray-100 sticky top-0 z-10">' +
      '<div class="max-w-[1100px] mx-auto px-4 lg:px-6 py-3 flex flex-wrap items-center gap-3">' +
        '<div class="mr-auto min-w-0"><div class="text-[10px] font-black uppercase tracking-widest" style="color:var(--brand)">' +
          '● Live · chaired by ' + esc(m.chairName) + '</div><div class="font-black truncate">' + esc(m.title) + '</div></div>' +
        '<div class="text-xs font-bold text-gray-400 text-right"><div>This segment <span id="mSegClock"></span></div>' +
          '<div>Meeting <span id="mTotal" class="tabular-nums"></span></div></div>' +
        '<button class="btn btn-g" onclick="openMinutes()">Minutes</button>' +
        (m.iAmChair
          ? (m.segment > 0 ? '<button class="btn btn-g" onclick="meetGo(-1)">← Back</button>' : '') +
            (last ? '<button class="btn btn-p" onclick="endMeeting()">End meeting</button>'
                  : '<button class="btn btn-p" onclick="meetGo(1)">Next →</button>') +
            '<button class="btn btn-g text-red-600" onclick="cancelMeeting()">Cancel</button>'
          : '<button class="btn btn-g" onclick="loadMeetings()">Leave screen</button>') +
      '</div>' +
      '<div class="max-w-[1100px] mx-auto px-4 lg:px-6 pb-3 flex gap-1.5 overflow-x-auto">' +
        m.agenda.map(function (a, i) {
          var cls = i === m.segment ? 'background:var(--brand);color:#fff' : i < m.segment ? 'background:#e7f6f3;color:#0e8f80' : 'background:#f3efe9;color:#7d7570';
          return '<button class="shrink-0 rounded-full px-3 py-1.5 text-xs font-black whitespace-nowrap" style="' + cls + '"' +
            (m.iAmChair ? ' onclick="meetGoTo(' + i + ')"' : ' disabled') + '>' + (i < m.segment ? '✓ ' : (i + 1) + ' · ') + esc(a.title) + '</button>';
        }).join('') + '</div></div>' +
    '<div class="max-w-[1100px] mx-auto px-4 lg:px-6 py-6">' +
      '<h2 class="text-2xl font-black">' + esc(seg.title) + '</h2>' +
      '<p class="text-sm font-semibold text-gray-500 mb-5">' + esc(def.hint || '') + '</p>' +
      segmentFixed(seg.key, v) +
      '<div id="segLive"></div></div></div>';
  bindFixed(seg.key);
  drawLive(v);
  paintClock();
}

/** The live part: redrawn on every poll unless somebody is typing in it. */
function drawLive(v) {
  var box = $('segLive');
  if (!box) return;
  if (box.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  var seg = v.meeting.agenda[v.meeting.segment];
  box.innerHTML = segmentLive(seg.key, v);
  bindLive(seg.key, v);
}

function meetGo(step) { meetGoTo(MEET.v.meeting.segment + step); }
function meetGoTo(i) {
  api('meetingGo', { id: MEET.id, segment: i }).then(function (v) { showMeeting(v, true); })
    .catch(function (e) { toast(e.message, 'err'); });
}

function act(action, params, msg) {
  params = params || {}; params.id = params.id === undefined ? MEET.id : params.id;
  return api(action, params).then(function (v) {
    if (msg !== false) toast(msg || v.message || 'Done.', 'ok');
    if (v && v.meeting) { MEET.v = v; drawLive(v); }
    return v;
  }).catch(function (e) { toast(e.message, 'err'); throw e; });
}

function personOptions(v, selected, label) {
  var staff = ((STATE.data && STATE.data.staff) || []).filter(function (u) { return u.active !== false; });
  return '<option value="">' + esc(label || 'Tag a person (optional)') + '</option>' + staff.map(function (u) {
    return '<option value="' + esc(u.username) + '"' + (u.username === selected ? ' selected' : '') + '>' + esc(u.name) + '</option>';
  }).join('');
}

function itemCard(i, extra) {
  return '<div class="bg-white rounded-xl border border-gray-100 px-4 py-3 flex gap-3 items-start">' +
    '<div class="flex-1 min-w-0"><div class="text-sm font-semibold text-gray-800 whitespace-pre-wrap">' + esc(i.text) + '</div>' +
    '<div class="flex flex-wrap gap-1.5 mt-1.5 items-center text-[11px] font-bold text-gray-400">' +
      (i.personName ? '<span>' + esc(i.personName) + '</span>' : '') +
      (i.value ? '<span class="chip t-plum">' + esc(i.value) + '</span>' : '') +
      (i.goal ? '<span class="chip t-sky">◎ ' + esc(goalTitle(i.goal)) + '</span>' : '') +
      '<span>· ' + esc(i.byName) + '</span></div></div>' + (extra || '') + '</div>';
}

/* ---------- segments: the fixed part ------------------------------------ */

function segmentFixed(key, v) {
  var form = function (id, ph, more, btn) {
    return '<form id="' + id + '" class="bg-white rounded-2xl border border-dashed border-gray-200 p-4 mb-5">' +
      '<textarea class="in mb-3" rows="2" required placeholder="' + esc(ph) + '"></textarea>' +
      '<div class="flex flex-wrap gap-2 items-center">' + (more || '') +
      '<button type="submit" class="btn btn-p ml-auto">' + esc(btn) + '</button></div></form>';
  };
  if (key === 'wins') return form('fWin', 'One good thing from your week — work or home.', '', 'Share');
  if (key === 'values') return (v.purpose ? '<div class="rounded-2xl p-4 mb-4 text-sm font-bold" style="background:#f4f2ff;color:#3d2fa8">' +
      '“' + esc(v.purpose) + '”</div>' : '') +
    (v.values.length ? '' : '<div class="text-sm font-bold text-amber-700 mb-4">No values are set up yet — an Admin adds them under Goals.</div>') +
    form('fStory', 'Who lived one of our values this week? What did they do?',
      '<select class="in max-w-[200px]" name="person">' + personOptions(v, '', 'Who (optional)') + '</select>' +
      '<select class="in max-w-[230px]" name="value" required>' + valueOptions('', 'Which value?') + '</select>' +
      (isManager() ? '<select class="in max-w-[150px]" name="cookies"><option value="0">No cookie points</option>' +
        [1, 2, 3, 4, 5].map(function (n) { return '<option value="' + n + '">+' + n + ' cookie points</option>'; }).join('') + '</select>' : ''),
      'Add story');
  if (key === 'updates') return form('fUpd', 'What does everybody need to know?', '', 'Add update');
  if (key === 'roadblocks') return form('fRoad', 'What is in the way — or what opportunity should we grab?',
      '<select class="in max-w-[260px]" name="goal">' + goalOptions('', 'Threatens goal (optional)') + '</select>' +
      '<select class="in max-w-[130px]" name="horizon"><option value="now">Now</option><option value="later">Later</option></select>',
      'Raise');
  if (key === 'actions') return '<form id="fAct" class="bg-white rounded-2xl border border-dashed border-gray-200 p-4 mb-5 grid gap-3" ' +
      'style="grid-template-columns:1fr">' +
      '<input class="in" name="title" required placeholder="What, specifically, will be done?">' +
      '<div class="flex flex-wrap gap-2 items-center">' +
        '<select class="in max-w-[200px]" name="assignTo" required>' + personOptions(v, '', 'Who?') + '</select>' +
        '<input class="in max-w-[170px]" type="date" name="dueDate" value="' + addDaysYmd(7) + '" aria-label="Due">' +
        '<select class="in max-w-[260px]" name="goal">' + goalOptions('', 'Serves goal (optional)') + '</select>' +
        '<button type="submit" class="btn btn-p ml-auto">Add action</button></div>' +
      '<div class="text-[11px] font-semibold text-gray-400">Becomes a task on their board, chased like any other, and counted toward the goal.</div></form>';
  return '';
}

function bindFixed(key) {
  var hook = function (id, build) {
    var f = $(id); if (!f) return;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = f.querySelector('button[type=submit]'); busy(btn, true, '…');
      build(f).then(function () { f.reset(); var d = f.querySelector('[name=dueDate]'); if (d) d.value = addDaysYmd(7); })
        .catch(function () {}).then(function () { busy(btn, false); });
    });
  };
  var txt = function (f) { return f.querySelector('textarea').value; };
  var val = function (f, n) { var el = f.querySelector('[name=' + n + ']'); return el ? el.value : ''; };
  hook('fWin', function (f) { return act('addMeetingItem', { form: { kind: 'win', text: txt(f) } }, 'Shared.'); });
  hook('fStory', function (f) { return act('addMeetingItem', { form: { kind: 'story', text: txt(f),
    person: val(f, 'person'), value: val(f, 'value'), cookies: Number(val(f, 'cookies') || 0) } }); });
  hook('fUpd', function (f) { return act('addMeetingItem', { form: { kind: 'update', text: txt(f) } }, 'Added.'); });
  hook('fRoad', function (f) { return act('addMeetingItem', { form: { kind: 'roadblock', text: txt(f),
    goal: val(f, 'goal'), horizon: val(f, 'horizon') } }, 'Raised.'); });
  hook('fAct', function (f) { return act('addMeetingAction', { form: { title: val(f, 'title'), assignTo: val(f, 'assignTo'),
    dueDate: val(f, 'dueDate'), goal: val(f, 'goal') } }); });
}

/* ---------- segments: the live part ------------------------------------- */

function segmentLive(key, v) {
  var m = v.meeting, list = function (arr, empty, extra) {
    return arr.length ? '<div class="space-y-2">' + arr.map(function (i) { return itemCard(i, extra ? extra(i) : ''); }).join('') + '</div>'
                      : '<div class="text-sm font-semibold text-gray-400 py-4">' + esc(empty) + '</div>';
  };

  if (key === 'wins') {
    return '<div class="lb">Who is here — ' + m.attendees.filter(function (a) { return a.present; }).length + ' of ' + m.attendees.length + '</div>' +
      '<div class="flex flex-wrap gap-2 mb-6">' + m.attendees.map(function (a) {
        return '<button class="att flex items-center gap-2 rounded-full pl-1 pr-3 py-1 border text-sm font-bold ' +
          (a.present ? 'border-teal-300 bg-teal-50 text-teal-800' : 'border-gray-200 text-gray-400') + '" data-u="' + esc(a.u) +
          '" data-p="' + (a.present ? 1 : 0) + '"' + (m.iAmChair ? '' : ' disabled') + '>' + avatar(a.name, 24) + esc(a.name) +
          (a.present ? ' ✓' : '') + '</button>'; }).join('') +
        (m.iAmChair ? '<select id="attAdd" class="in max-w-[200px] py-1.5 text-xs">' + personOptions(v, '', '+ Someone walked in') + '</select>' : '') +
      '</div><div class="lb">Wins</div>' + list(v.wins, 'Nobody has shared one yet.');
  }
  if (key === 'values') return '<div class="lb">Stories</div>' + list(v.stories, 'No stories yet.');
  if (key === 'updates') return '<div class="lb">Updates</div>' + list(v.updates, 'Nothing shared yet.');

  if (key === 'goals') {
    if (!v.goals.length) return '<div class="bg-white rounded-2xl border border-dashed border-gray-200 p-8 text-center text-sm font-bold text-gray-400">' +
      'No goals for ' + esc(v.quarter) + ' yet. Set them up under the Goals tab.</div>';
    return '<div class="lb">' + esc(v.quarter) + '</div><div class="bg-white rounded-2xl border border-gray-100 px-5">' + v.goals.map(function (g) {
      var can = isManager() || g.owner === STATE.user.username;
      return '<div class="flex flex-wrap items-center gap-3 py-3 border-t border-gray-100 first:border-t-0">' +
        '<div class="flex-1 min-w-[200px]"><div class="font-black text-sm">' + esc(g.title) + '</div>' +
        '<div class="text-[11px] font-semibold text-gray-400">' + esc(g.ownerName) +
          (g.status === 'At risk' && g.note ? ' · <span class="text-amber-700">' + esc(g.note) + '</span>' : '') + '</div></div>' +
        progressBar(g.progress) +
        (can ? '<select class="in max-w-[130px] text-xs py-1.5 mGoal" data-id="' + esc(g.id) + '">' +
            ['On course', 'At risk', 'Done', 'Dropped'].map(function (s) { return '<option' + (s === g.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>'
             : '<span class="chip ' + GOAL_TONE[g.status] + '">' + esc(g.status) + '</span>') + '</div>'; }).join('') + '</div>';
  }

  if (key === 'numbers') {
    var n = v.numbers;
    if (!n.list.length) return '<div class="bg-white rounded-2xl border border-dashed border-gray-200 p-8 text-center text-sm font-bold text-gray-400">' +
      'No key numbers yet. Add them under the Goals tab.</div>';
    return '<div class="bg-white rounded-2xl border border-gray-100 overflow-x-auto"><table class="w-full text-sm"><thead>' +
      '<tr class="text-[10px] font-black uppercase tracking-widest text-gray-400 text-left"><th class="py-2 pl-4">Number</th><th>Owner</th><th>Target</th>' +
      '<th class="text-center">Last week</th><th class="text-center pr-4">This week</th></tr></thead><tbody>' +
      n.list.map(function (x) {
        var cur = x.weeks[x.weeks.length - 1], prev = x.weeks[x.weeks.length - 2] || {};
        var can = isManager() || x.owner === STATE.user.username;
        return '<tr class="border-t border-gray-100"><td class="py-2.5 pl-4 font-black">' + esc(x.name) + '</td>' +
          '<td class="text-xs font-semibold text-gray-500">' + esc(x.ownerName) + '</td>' +
          '<td class="text-xs font-bold">' + (x.target === null ? '—' : (x.direction === 'at most' ? '≤ ' : '≥ ') + esc(x.target) + ' ' + esc(x.unit)) + '</td>' +
          '<td class="text-center text-xs font-black ' + (prev.hit === false ? 'text-red-600' : prev.hit ? 'text-teal-700' : 'text-gray-300') + '">' +
            (prev.value == null ? '·' : esc(prev.value)) + '</td>' +
          '<td class="text-center pr-4">' + (can ? '<input style="width:96px" class="in mNum text-center py-1.5 ' +
            (cur.hit === false ? 'border-red-300 text-red-700' : cur.hit ? 'border-teal-300' : '') + '" data-id="' + esc(x.id) + '" value="' +
            (cur.value == null ? '' : esc(cur.value)) + '" inputmode="decimal" aria-label="' + esc(x.name) + '">'
            : '<span class="font-black">' + (cur.value == null ? '·' : esc(cur.value)) + '</span>') + '</td></tr>'; }).join('') +
      '</tbody></table></div><div class="text-[11px] font-semibold text-gray-400 mt-2">A miss in red becomes a roadblock — raise it in Roadblocks.</div>';
  }

  if (key === 'roadblocks') {
    var tabs = { now: [], later: [], cleared: [] };
    v.roadblocks.forEach(function (r) { (r.status === 'cleared' ? tabs.cleared : tabs[r.horizon === 'later' ? 'later' : 'now']).push(r); });
    MEET.rbTab = MEET.rbTab || 'now';
    var btns = function (r) {
      if (r.status === 'cleared') return '<span class="chip t-teal shrink-0">Cleared</span>';
      var mine = isManager() || r.mine;
      return '<div class="flex gap-1 shrink-0">' +
        '<button class="btn btn-g text-xs py-1.5 rbAct" data-id="' + esc(r.id) + '" title="Turn into an action">→ Action</button>' +
        (mine ? '<button class="btn btn-g text-xs py-1.5 rbClear" data-id="' + esc(r.id) + '">Clear</button>' +
          '<button class="btn btn-g text-xs py-1.5 rbMove" data-id="' + esc(r.id) + '" data-h="' + (r.horizon === 'later' ? 'now' : 'later') + '">' +
            (r.horizon === 'later' ? 'Now' : 'Later') + '</button>' : '') + '</div>';
    };
    return '<div class="flex gap-1 bg-gray-100 p-1 rounded-xl mb-3 w-max">' + ['now', 'later', 'cleared'].map(function (k) {
        return '<button class="rbTab px-3 py-1.5 rounded-lg text-xs font-black ' + (MEET.rbTab === k ? 'bg-white shadow' : 'text-gray-500') +
          '" data-k="' + k + '">' + ({ now: 'Now', later: 'Later', cleared: 'Cleared here' })[k] + ' ' + tabs[k].length + '</button>'; }).join('') + '</div>' +
      list(tabs[MEET.rbTab], MEET.rbTab === 'cleared' ? 'Nothing cleared yet in this meeting.' : 'Nothing here.', btns);
  }

  if (key === 'actions') {
    if (!v.actions.length) return '<div class="text-sm font-semibold text-gray-400">No actions yet.</div>';
    var tone = function (s) { return s === 'Verified' ? 't-teal' : s === 'For Review' ? 't-plum' : s === 'In Progress' ? 't-sky' : 't-slate'; };
    return '<div class="bg-white rounded-2xl border border-gray-100 overflow-x-auto"><table class="w-full text-sm"><thead>' +
      '<tr class="text-[10px] font-black uppercase tracking-widest text-gray-400 text-left"><th class="py-2 pl-4">Action</th><th>Who</th><th>Due</th><th class="pr-4">Status</th></tr></thead><tbody>' +
      v.actions.map(function (a) {
        return '<tr class="border-t border-gray-100"><td class="py-2.5 pl-4"><button class="font-bold text-left hover:underline" onclick="openTask(\'' + esc(a.id) + '\')">' +
          esc(a.title) + '</button>' + (a.newHere ? ' <span class="chip t-plum">new</span>' : ' <span class="text-[10px] font-bold text-gray-400">from an earlier meeting</span>') +
          (a.goal ? '<div class="text-[10px] font-bold text-gray-400">◎ ' + esc(goalTitle(a.goal)) + '</div>' : '') + '</td>' +
          '<td class="text-xs font-semibold text-gray-600">' + esc(a.toName) + '</td>' +
          '<td class="text-xs font-bold ' + (a.late ? 'text-red-600' : 'text-gray-500') + '">' + esc(a.due) + '</td>' +
          '<td class="pr-4"><span class="chip ' + tone(a.status) + '">' + esc(a.status) + '</span></td></tr>'; }).join('') +
      '</tbody></table></div>';
  }

  if (key === 'close') {
    var r = m.ratings;
    return '<div class="bg-white rounded-2xl border border-gray-100 p-5 mb-4">' +
      '<div class="flex justify-between font-black"><span>Ratings in</span><span>' + r.count + ' / ' + r.expected + '</span></div>' +
      '<div class="h-2 rounded-full bg-gray-100 mt-2 overflow-hidden"><div class="h-2 rounded-full" style="background:#5b4bdb;width:' +
        (r.expected ? Math.min(100, r.count / r.expected * 100) : 0) + '%"></div></div>' +
      '<div class="text-[11px] font-semibold text-gray-400 mt-2">Anonymous — nobody’s name is shown against a score.' +
        (r.average !== null && m.iAmChair ? ' Average so far: <strong>' + r.average + '</strong>.' : '') + '</div></div>' +
      '<div class="bg-white rounded-2xl border border-gray-100 p-5"><div class="font-black mb-1">Your rating</div>' +
      '<div class="text-xs font-semibold text-gray-400 mb-3">1 = a waste of time · 10 = exactly what we needed</div>' +
      '<div class="flex flex-wrap gap-2">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) {
        return '<button class="rate w-11 h-11 rounded-xl border font-black ' + (m.myRating === n ? 'border-transparent text-white' : 'border-gray-200') +
          '" style="' + (m.myRating === n ? 'background:var(--brand)' : '') + '" data-n="' + n + '">' + n + '</button>'; }).join('') + '</div>' +
      (m.myRating ? '<div class="text-xs font-bold text-teal-700 mt-3">Thanks — you can change it until the meeting ends.</div>' : '') + '</div>';
  }
  return '';
}

function bindLive(key, v) {
  var all = function (sel, fn) { document.querySelectorAll('#segLive ' + sel).forEach(function (el) { el.addEventListener(fn[0], fn[1].bind(null, el)); }); };
  all('.att', ['click', function (el) { act('setAttendance', { username: el.dataset.u, present: el.dataset.p !== '1' }, false); }]);
  if ($('attAdd')) $('attAdd').addEventListener('change', function () {
    if (this.value) act('setAttendance', { username: this.value, present: true }, 'Added.'); });
  all('.mGoal', ['change', function (el) { setGoalStatus(el.dataset.id, el.value, function () { pollMeeting(false); }); }]);
  all('.mNum', ['change', function (el) {
    api('recordNumber', { id: el.dataset.id, value: el.value }).then(function (r) {
      toast(r.hit === false ? 'Below target — raise it in Roadblocks.' : 'Saved.', r.hit === false ? 'info' : 'ok');
      el.blur(); pollMeeting(false); }).catch(function (e) { toast(e.message, 'err'); }); }]);
  all('.rbTab', ['click', function (el) { MEET.rbTab = el.dataset.k; drawLive(MEET.v); }]);
  all('.rbClear', ['click', function (el) { act('updateMeetingItem', { id: undefined, itemId: el.dataset.id, form: { clear: true } }, 'Cleared.'); }]);
  all('.rbMove', ['click', function (el) { act('updateMeetingItem', { itemId: el.dataset.id, form: { horizon: el.dataset.h } }, false); }]);
  all('.rbAct', ['click', function (el) { openActionFromRoadblock(el.dataset.id); }]);
  all('.rate', ['click', function (el) { act('rateMeeting', { score: Number(el.dataset.n) }, 'Rated ' + el.dataset.n + '.'); }]);
}

function openActionFromRoadblock(itemId) {
  var r = MEET.v.roadblocks.filter(function (x) { return x.id === itemId; })[0];
  openModal('<form id="fRbAct" class="p-6 lg:p-7">' +
    '<h2 class="text-xl font-black mb-1">Turn into an action</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-4">' + esc(r.text) + '</p>' +
    '<label class="lb" for="raTitle">Action</label><input id="raTitle" class="in mb-4" required value="' + esc(r.text.slice(0, 120)) + '">' +
    '<div class="grid grid-cols-2 gap-3 mb-4"><div><label class="lb" for="raWho">Who</label><select id="raWho" class="in" required>' +
      personOptions(MEET.v, r.person, 'Who?') + '</select></div>' +
      '<div><label class="lb" for="raDue">Due</label><input id="raDue" type="date" class="in" value="' + addDaysYmd(7) + '"></div></div>' +
    '<label class="lb" for="raGoal">Serves goal</label><select id="raGoal" class="in mb-4">' + goalOptions(r.goal, 'None') + '</select>' +
    '<label class="flex items-center gap-2 text-sm font-semibold mb-6"><input type="checkbox" id="raClear" class="w-4 h-4" checked> ' +
      'This clears the roadblock</label>' +
    '<div class="flex gap-3"><button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
    '<button type="submit" class="btn btn-p flex-1">Create action</button></div></form>', 'max-w-lg');
  $('fRbAct').addEventListener('submit', function (e) {
    e.preventDefault();
    act('addMeetingAction', { form: { title: $('raTitle').value, assignTo: $('raWho').value, dueDate: $('raDue').value,
      goal: $('raGoal').value, fromItem: itemId, clearItem: $('raClear').checked } }).then(function () { closeModal(); });
  });
}

/* ---------- minutes, ending ---------------------------------------------- */

function openMinutes() {
  var m = MEET.v.meeting;
  openDrawer('<div class="p-6"><div class="flex justify-between items-center mb-3"><h2 class="text-xl font-black">Minutes</h2>' +
    '<button onclick="closeDrawer()" class="text-gray-400"><span class="material-icons">close</span></button></div>' +
    (m.iAmChair
      ? '<textarea id="minText" class="in" rows="18" placeholder="Decisions, numbers quoted, anything worth having in writing.">' + esc(m.minutes) + '</textarea>' +
        '<div class="flex justify-between items-center mt-3"><span class="text-[11px] font-semibold text-gray-400">Sent to everyone with the summary.</span>' +
        '<button class="btn btn-p" id="minSave">Save</button></div>'
      : '<div class="text-sm whitespace-pre-wrap text-gray-700">' + (m.minutes ? esc(m.minutes) : '<span class="text-gray-400">Nothing yet. The chair keeps the minutes.</span>') + '</div>') +
    '</div>');
  if ($('minSave')) {
    var save = function (quiet) { return api('saveMinutes', { id: MEET.id, text: $('minText').value })
      .then(function () { MEET.v.meeting.minutes = $('minText').value; if (!quiet) toast('Minutes saved.', 'ok'); })
      .catch(function (e) { toast(e.message, 'err'); }); };
    $('minSave').addEventListener('click', function () { save(false); });
    $('minText').addEventListener('blur', function () { save(true); });
  }
}

function endMeeting() {
  var r = MEET.v.meeting.ratings;
  if (r.count < r.expected && !window.confirm(r.count + ' of ' + r.expected + ' have rated. End the meeting anyway?')) return;
  api('endMeeting', { id: MEET.id }).then(function (res) {
    stopMeetingPoll(); toast(res.message, 'ok');
    return api('getMeeting', { id: MEET.id }).then(showEnded);
  }).catch(function (e) { toast(e.message, 'err'); });
}

function cancelMeeting() {
  if (!window.confirm('Cancel this meeting? Nothing is sent, and it is not kept in the history. Actions already created stay on people’s boards.')) return;
  api('cancelMeeting', { id: MEET.id }).then(function (r) { toast(r.message, 'ok'); loadMeetings(); })
    .catch(function (e) { toast(e.message, 'err'); });
}

function summaryHtml(v) {
  var s = v.meeting.summary || {}, m = v.meeting;
  var stat = function (n, l, warn) { return '<div class="bg-white rounded-2xl border border-gray-100 p-4 text-center">' +
    '<div class="text-2xl font-black ' + (warn && n ? 'text-amber-700' : '') + '">' + (n === null || n === undefined ? '—' : n) + '</div>' +
    '<div class="text-[10px] font-black uppercase tracking-widest text-gray-400">' + l + '</div></div>'; };
  return '<div class="grid gap-3 mb-5" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">' +
      stat(s.present + '/' + s.invited, 'Present') + stat(s.rating === null ? '—' : s.rating, 'Rating') +
      stat(s.actionsCreated, 'New actions') + stat(s.roadblocksCleared, 'Cleared') +
      stat(s.roadblocksOpen, 'Still open', true) + stat(s.goalsAtRisk, 'Goals at risk', true) +
      stat(s.numbersMissed, 'Numbers missed', true) + '</div>' +
    (v.actions.filter(function (a) { return a.newHere; }).length ? '<div class="lb">Actions agreed</div><div class="space-y-1.5 mb-5">' +
      v.actions.filter(function (a) { return a.newHere; }).map(function (a) {
        return '<div class="text-sm"><strong>' + esc(a.title) + '</strong> — ' + esc(a.toName) + ', due ' + esc(a.due) + '</div>'; }).join('') + '</div>' : '') +
    (v.stories.length ? '<div class="lb">Values in action</div><div class="space-y-2 mb-5">' + v.stories.map(function (i) { return itemCard(i); }).join('') + '</div>' : '') +
    (m.minutes ? '<div class="lb">Minutes</div><div class="text-sm whitespace-pre-wrap text-gray-700">' + esc(m.minutes) + '</div>' : '');
}

function showEnded(v) {
  MEET.id = null;
  $('meetBody').innerHTML = '<div class="max-w-[900px] mx-auto px-4 lg:px-6 py-8">' +
    '<div class="text-[10px] font-black uppercase tracking-widest text-teal-700">Ended</div>' +
    '<h2 class="text-2xl font-black mb-1">' + esc(v.meeting.title) + ' — ' + esc(v.meeting.date) + '</h2>' +
    '<p class="text-sm font-semibold text-gray-500 mb-5">The summary has gone to everyone who was there, with their own actions at the top.</p>' +
    summaryHtml(v) + '<button class="btn btn-g mt-6" onclick="loadMeetings()">← All meetings</button></div>';
}

function openMeetingSummary(id) {
  api('getMeeting', { id: id }).then(function (v) {
    openModal('<div class="p-6 lg:p-7"><div class="flex justify-between items-start mb-4"><div>' +
      '<h2 class="text-2xl font-black">' + esc(v.meeting.title) + '</h2>' +
      '<div class="text-sm font-semibold text-gray-400">' + esc(v.meeting.date) + ' · chaired by ' + esc(v.meeting.chairName) + '</div></div>' +
      '<button onclick="closeModal()" class="text-gray-400"><span class="material-icons">close</span></button></div>' +
      summaryHtml(v) + '</div>', 'max-w-3xl');
  }).catch(function (e) { toast(e.message, 'err'); });
}
