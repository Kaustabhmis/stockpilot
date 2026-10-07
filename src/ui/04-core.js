/* ===========================================================================
   DOME BOX — FRONT END
   Talks to the Apps Script web app. Put your /exec URL in API_URL below.
   =========================================================================== */
'use strict';

var API_URL = 'PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE';

var $ = function (id) { return document.getElementById(id); };
var esc = function (s) { return String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;'); };

var STATE = { token:null, user:null, company:'', plan:'Free', data:null,
              tab:'tasks', mode:'board', archive:false, usage:null,
              period:'month', offset:0, person:'', analytics:null };

var FILTER = { q:'', assignee:'', status:'', category:'', overdue:false };

/* ---------- API ----------------------------------------------------------
   Apps Script does not answer CORS preflight, so the request has to stay
   "simple": text/plain content type and no custom headers. The body is still
   JSON; only the declared type differs. */
function api(action, params) {
  var body = Object.assign({ action: action }, params || {});
  if (STATE.token) body.token = STATE.token;

  return fetch(API_URL, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  }).then(function (r) {
    if (!r.ok) throw new Error('The server is not reachable right now.');
    return r.text();
  }).then(function (text) {
    var j;
    try { j = JSON.parse(text); }
    catch (e) { throw new Error('The server sent something unexpected. Try again.'); }
    if (j.status === 'error') {
      /* An expired or forged token must drop the session, or the user sits on a
         dead screen pressing buttons that will never work. */
      if (/signed in|session|expired/i.test(j.message || '')) signOut(true);
      throw new Error(j.message || 'Something went wrong.');
    }
    return j;
  });
}

/* ---------- small UI helpers --------------------------------------------- */
function toast(msg, kind) {
  var el = document.createElement('div');
  el.className = 'toast ' + (kind || 'info');
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(function () { el.remove(); }, kind === 'err' ? 5500 : 3200);
}
function openModal(html, width) {
  $('modal').className = width || 'max-w-lg';
  $('modal').innerHTML = html;
  $('scrim').classList.add('on');
}
function closeModal() { $('scrim').classList.remove('on'); $('modal').innerHTML = ''; }
function openDrawer(html) { $('drawer').innerHTML = html; $('drawer').classList.add('on'); }
function closeDrawer() { $('drawer').classList.remove('on'); }
function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.textContent = label || 'Working…'; }
  else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
}

var fmtDate = function (s) {
  if (!s) return '—';
  var d = new Date(s + 'T00:00:00');
  return isNaN(d) ? s : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};
var initials = function (n) { return String(n || '?').trim().split(/\s+/).slice(0,2)
  .map(function (w) { return w[0] || ''; }).join('').toUpperCase(); };
function nameOf(u) {
  var s = (STATE.data && STATE.data.staff) || [];
  for (var i = 0; i < s.length; i++) if (s[i].username === u) return s[i].name;
  return u || '—';
}
function daysLate(t) {
  if (!t.due || ['Verified','Rejected','Cancelled','For Review'].indexOf(t.status) > -1) return 0;
  var due = new Date(t.due + 'T00:00:00'); if (isNaN(due)) return 0;
  var today = new Date(); today.setHours(0,0,0,0);
  var n = Math.round((today - due) / 86400000);
  return n > 0 ? n : 0;
}
function todayYmd() {
  var d = new Date(), m = String(d.getMonth()+1), day = String(d.getDate());
  return d.getFullYear() + '-' + (m.length<2?'0'+m:m) + '-' + (day.length<2?'0'+day:day);
}
function addDaysYmd(n) {
  var d = new Date(); d.setDate(d.getDate() + n);
  var m = String(d.getMonth()+1), day = String(d.getDate());
  return d.getFullYear() + '-' + (m.length<2?'0'+m:m) + '-' + (day.length<2?'0'+day:day);
}

/* ---------- auth ---------------------------------------------------------- */
function showAuth(which) {
  ['Login','Signup','Forgot','Reset'].forEach(function (n) {
    $('form' + n).classList.toggle('hidden', n.toLowerCase() !== which);
  });
}

function saveSession(res) {
  STATE.token = res.token; STATE.user = res.user;
  STATE.company = res.company || ''; STATE.plan = res.plan || 'Free';
  try { sessionStorage.setItem('dbx', JSON.stringify({
    token: res.token, user: res.user, company: res.company, plan: res.plan })); } catch (e) {}
}
function restoreSession() {
  try {
    var raw = sessionStorage.getItem('dbx');
    if (!raw) return false;
    var s = JSON.parse(raw);
    if (!s.token) return false;
    STATE.token = s.token; STATE.user = s.user;
    STATE.company = s.company || ''; STATE.plan = s.plan || 'Free';
    return true;
  } catch (e) { return false; }
}
function signOut(expired) {
  STATE.token = null; STATE.user = null; STATE.data = null;
  try { sessionStorage.removeItem('dbx'); } catch (e) {}
  closeModal(); closeDrawer();
  $('view-app').classList.add('hidden');
  $('view-auth').classList.remove('hidden');
  resetAuthForms();
  showAuth('login');
  if (expired) toast('Your session ended. Please sign in again.', 'info');
}

/**
 * A successful sign-in leaves its button disabled and reading "Signing in…",
 * because the page navigates into the app rather than finishing the call. On
 * the way back out that stale state would lock the user out of their own login
 * form until they refreshed, so every auth button and password field is reset
 * whenever the auth view is shown.
 */
function resetAuthForms() {
  ['btnLogin','btnSignup','btnForgot','btnReset'].forEach(function (id) {
    busy($(id), false);
  });
  ['liPass','suPass','rsPass','rsPass2'].forEach(function (id) {
    if ($(id)) $(id).value = '';
  });
}

function enterApp() {
  $('view-auth').classList.add('hidden');
  $('view-app').classList.remove('hidden');
  $('navName').textContent = STATE.user.name;
  $('navRole').textContent = STATE.user.role;
  $('navCompany').textContent = STATE.company;
  refresh();
}

function refresh() {
  return api('getDashboard').then(function (d) {
    STATE.data = d;
    STATE.usage = d.usage;
    if (d.serviceStopped) { renderStopped(d); return; }
    renderBanner();
    renderTiles();
    renderBell();
    syncFilters();
    renderTab();
  }).catch(function (e) { toast(e.message, 'err'); });
}

function renderStopped(d) {
  $('banner').className = '';
  $('banner').innerHTML = '<div class="bg-red-50 border-b border-red-200 px-4 py-4 text-center">' +
    '<div class="font-black text-red-900">Your subscription lapsed</div>' +
    '<div class="text-sm text-red-800 mt-1">' + esc(d.message) + '</div>' +
    '<button class="btn btn-p mt-3" onclick="openBilling()">Renew now</button></div>';
  ['tab-tasks','tab-team','tab-reports'].forEach(function (id) { $(id).classList.add('hidden'); });
}

function renderBanner() {
  var u = STATE.usage, b = $('banner');
  var msgs = [];
  if (u.daysLeft !== null && u.daysLeft <= 7 && u.daysLeft >= 0 && STATE.plan !== 'Free') {
    msgs.push({ tone: 'warn', text: 'Your plan renews in ' + u.daysLeft + ' day(s).' });
  }
  if (u.daysLeft !== null && u.daysLeft < 0 && STATE.plan !== 'Free') {
    msgs.push({ tone: 'bad', text: 'Payment is overdue. Access stops ' +
      Math.max(0, 7 + u.daysLeft) + ' day(s) from now.' });
  }
  (u.warnings || []).forEach(function (w) {
    msgs.push({ tone: w.atLimit ? 'bad' : 'warn', text: w.text });
  });
  if (!msgs.length) { b.className = 'hidden'; b.innerHTML = ''; return; }
  var worst = msgs.some(function (m) { return m.tone === 'bad'; }) ? 'bad' : 'warn';
  b.className = '';
  b.innerHTML = '<div class="' + (worst === 'bad' ? 'bg-red-50 text-red-900 border-red-200'
      : 'bg-amber-50 text-amber-900 border-amber-200') +
    ' border-b px-4 lg:px-6 py-3 flex flex-wrap items-center gap-3 text-sm font-bold">' +
    '<span class="text-[10px] uppercase tracking-widest font-black">' + esc(u.planName) + '</span>' +
    msgs.map(function (m) { return '<span>' + esc(m.text) + '</span>'; }).join('') +
    '<span class="flex-1"></span>' +
    '<button class="btn btn-p text-xs py-2" onclick="openBilling()">Upgrade</button></div>';
}

function renderTiles() {
  var s = STATE.data.stats, sc = s.scores;
  var tile = function (k, v, sub, tone) {
    return '<div class="bg-white rounded-2xl border border-gray-100 p-4">' +
      '<div class="text-[10px] font-black uppercase tracking-widest text-gray-400">' + esc(k) + '</div>' +
      '<div class="text-3xl font-black mt-1 ' + (tone || '') + '">' + v + '</div>' +
      (sub ? '<div class="text-[11px] font-semibold text-gray-400 mt-0.5">' + esc(sub) + '</div>' : '') +
      '</div>';
  };
  $('statTiles').innerHTML =
    tile('Pending', s.pending) +
    tile('In progress', s.progress) +
    tile('For review', s.review) +
    tile('Overdue', s.overdue, 'needs attention', s.overdue ? 'text-red-700' : '') +
    tile('Delegation', sc.hasData && sc.delegation != null ? sc.delegation : '\u2014', sc.hasData ? 'this month' : 'no data yet',
         sc.hasData ? (sc.delegation >= 85 ? 'text-emerald-700' : sc.delegation >= 60 ? 'text-amber-700' : 'text-red-700') : 'text-gray-300') +
    '<div class="bg-white rounded-2xl border border-gray-100 p-4 cursor-pointer hover:border-blue-300" onclick="openScoreBreakdown()">' +
      '<div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Final score</div>' +
      '<div class="text-3xl font-black mt-1">' + (sc.final == null ? '\u2014' : sc.final) + '</div>' +
      '<div class="text-[11px] font-black text-blue-600 mt-0.5">See why →</div></div>';
}

function openScoreBreakdown() {
  var sc = STATE.data.stats.scores;
  var rows = (sc.breakdown || []);
  var resp = sc.responsiveness;

  /* Grouped, because a deduction for sitting on somebody else's work is a
     different conversation from a late delivery, and lumping them into one
     list is how a score stops being arguable in good faith. */
  var order = ['Project Milestones', 'On-Time Delivery', 'First-Pass Quality',
               'Queue Health', 'Review Responsiveness'];
  var groups = {};
  rows.forEach(function (r) { (groups[r.group || 'Other'] = groups[r.group || 'Other'] || []).push(r); });
  var names = order.filter(function (g) { return groups[g]; })
    .concat(Object.keys(groups).filter(function (g) { return order.indexOf(g) < 0; }));

  var table = names.map(function (g) {
    return '<h3 class="text-[11px] font-black uppercase tracking-widest text-gray-500 mt-5 mb-2">' +
      esc(g) + '</h3>' +
      '<table class="tbl"><thead><tr><th>Item</th><th>Reason</th><th>Impact</th></tr></thead><tbody>' +
      groups[g].map(function (r) {
        return '<tr><td class="font-bold text-gray-800">' + esc(r.item) + '</td>' +
          '<td>' + esc(r.reason) + '</td>' +
          '<td class="font-black ' + (String(r.impact).charAt(0) === '-' ? 'text-red-700' : 'text-emerald-700') +
          '">' + esc(r.impact) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }).join('');

  var respPanel = resp ? '<div class="rounded-2xl border ' +
      (resp.penalty ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50') +
      ' p-4 mb-5">' +
    '<div class="flex items-start gap-3">' +
      '<span class="material-icons ' + (resp.penalty ? 'text-red-700' : 'text-emerald-700') + '">' +
      (resp.penalty ? 'hourglass_bottom' : 'task_alt') + '</span>' +
      '<div class="min-w-0">' +
      '<div class="text-sm font-black text-gray-900">Work waiting on you</div>' +
      '<div class="text-[13px] font-semibold text-gray-700 mt-0.5">' +
        esc(resp.withinSla + ' of ' + resp.items + ' approvals and reviews cleared within ' +
            resp.slaDays + ' working days') +
        (resp.avgHeldDays != null ? esc(' · ' + resp.avgHeldDays + ' days held on average') : '') +
      '</div>' +
      (resp.pending ? '<div class="text-[13px] font-bold text-gray-800 mt-1">' +
         esc(resp.pending + ' still on your desk') +
         (resp.overdueNow ? esc(', ' + resp.overdueNow + ' of them past the ' + resp.slaDays +
                                '-day mark') : '') + '</div>' : '') +
      (resp.penalty ? '<div class="text-[13px] font-black text-red-800 mt-1">' +
         esc('\u2212' + resp.penalty + ' points for holding your team up') + '</div>'
       : '<div class="text-[13px] font-black text-emerald-800 mt-1">No points lost here</div>') +
      '<div class="text-[11px] font-semibold text-gray-500 mt-1">' +
        'Counted in working days from when it reached you. Weekends, company holidays ' +
        'and your own approved leave are not counted.</div>' +
      '</div></div></div>' : '';

  /* The gains, stated as plainly as the losses. A score that only ever shows a
     person what went wrong is read as a punishment ledger, and stops changing
     anybody's behaviour after the first month. */
  var ms = sc.milestones;
  var msPanel = ms ? '<div class="rounded-2xl border ' +
      (ms.missed ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50') + ' p-4 mb-5">' +
    '<div class="flex items-start gap-3">' +
      '<span class="material-icons ' + (ms.missed ? 'text-amber-700' : 'text-emerald-700') + '">flag</span>' +
      '<div class="min-w-0">' +
      '<div class="text-sm font-black text-gray-900">Project stage deadlines</div>' +
      '<div class="text-[13px] font-semibold text-gray-700 mt-0.5">' +
        esc(ms.met + ' met' + (ms.missed ? ', ' + ms.missed + ' missed' : '')) +
        (ms.hitRate != null ? esc(' · ' + ms.hitRate + '% hit rate') : '') +
        (ms.pending ? esc(' · ' + ms.pending + ' stage' + (ms.pending === 1 ? '' : 's') + ' still running') +
          (ms.atRisk ? esc(', ' + ms.atRisk + ' past the date') : '') : '') +
      '</div>' +
      (ms.met ? '<div class="text-[13px] font-black text-emerald-800 mt-1">' +
         esc('Every stage deadline you meet adds to this score') + '</div>' : '') +
      '<div class="text-[11px] font-semibold text-gray-500 mt-1">' +
        'A stage date is a promise to the people downstream, so it is scored in its own right. ' +
        'If the stage before yours ran over, your date moves out with it.</div>' +
      '</div></div></div>' : '';

  openModal('<div class="p-6 lg:p-7">' +
    '<div class="flex justify-between items-start mb-1">' +
      '<h2 class="text-2xl font-black">How your score is built</h2>' +
      '<button onclick="closeModal()" class="text-gray-400 hover:text-gray-900">' +
      '<span class="material-icons">close</span></button></div>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">Every number here comes from your own task record. ' +
      'Nothing is estimated.</p>' +
    (sc.formula ? '<p class="text-[13px] font-bold text-gray-700 bg-gray-50 rounded-xl px-3 py-2 mb-5">' +
       esc(sc.formula) + '</p>' : '') +
    msPanel + respPanel +
    '<div class="grid gap-3 mb-1" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">' +
      (sc.components || []).map(function (c) {
        return '<div class="bg-gray-50 rounded-2xl p-3 text-center">' +
          '<div class="text-[10px] font-black uppercase tracking-widest text-gray-400">' + esc(c.label) + '</div>' +
          '<div class="text-2xl font-black mt-1">' + (c.score == null ? '\u2014' : c.score) + '</div>' +
          '<div class="text-[10px] font-semibold text-gray-400">' + esc(c.basis) + '</div></div>';
      }).join('') + '</div>' +
    (table ||
      '<p class="text-sm text-gray-400 font-semibold mt-5">Nothing has affected your score yet this month.</p>') +
    '</div>', 'max-w-2xl');
}

/* ---------- notifications ------------------------------------------------ */
function renderBell() {
  var n = STATE.data.notifications || [];
  var c = $('bellCount');
  c.textContent = n.length;
  c.classList.toggle('hidden', n.length === 0);
  var icon = { overdue:['warning','bg-red-100 text-red-700'], approval:['how_to_reg','bg-amber-100 text-amber-800'],
    review:['rate_review','bg-purple-100 text-purple-700'], today:['event','bg-blue-100 text-blue-700'],
    team:['groups','bg-gray-100 text-gray-600'] };
  $('bellList').innerHTML = n.length ? n.map(function (x) {
    var i = icon[x.type] || ['info','bg-gray-100 text-gray-600'];
    return '<button class="w-full text-left p-3 border-b hover:bg-gray-50 flex gap-3 items-start" ' +
      'onclick="closeBell();openTask(\'' + esc(x.id) + '\')">' +
      '<span class="h-8 w-8 rounded-full ' + i[1] + ' flex items-center justify-center shrink-0">' +
      '<span class="material-icons text-sm">' + i[0] + '</span></span>' +
      '<span class="min-w-0"><span class="block text-xs font-black text-gray-800 truncate">' + esc(x.title) + '</span>' +
      '<span class="block text-[11px] text-gray-500">' + esc(x.msg) + '</span></span></button>';
  }).join('') : '<div class="p-8 text-center text-gray-400 text-xs font-bold">Nothing needs you right now.</div>';
}
function closeBell() { $('bellMenu').classList.add('hidden'); }
