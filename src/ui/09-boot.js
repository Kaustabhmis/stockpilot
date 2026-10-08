/* ---------- wiring ------------------------------------------------------- */
$('formLogin').addEventListener('submit', function (e) {
  e.preventDefault();
  busy($('btnLogin'), true, 'Signing in…');
  api('login', { username: $('liUser').value.trim(), password: $('liPass').value })
    .then(function (r) { saveSession(r); enterApp(); })
    .catch(function (err) { busy($('btnLogin'), false); toast(err.message, 'err'); });
});

$('formSignup').addEventListener('submit', function (e) {
  e.preventDefault();
  busy($('btnSignup'), true, 'Creating…');
  api('register', { form: { companyName:$('suCompany').value, name:$('suName').value,
    email:$('suEmail').value, phone:$('suPhone').value, password:$('suPass').value } })
    .then(function (r) { saveSession(r); toast('Workspace created. Add your team next.', 'ok'); enterApp(); })
    .catch(function (err) { busy($('btnSignup'), false); toast(err.message, 'err'); });
});

$('formForgot').addEventListener('submit', function (e) {
  e.preventDefault();
  busy($('btnForgot'), true, 'Sending…');
  api('forgotPassword', { email: $('fpEmail').value.trim() })
    .then(function (r) { busy($('btnForgot'), false); toast(r.message, 'ok'); showAuth('login'); })
    .catch(function (err) { busy($('btnForgot'), false); toast(err.message, 'err'); });
});

$('formReset').addEventListener('submit', function (e) {
  e.preventDefault();
  if ($('rsPass').value !== $('rsPass2').value) { toast('The two passwords do not match.', 'err'); return; }
  busy($('btnReset'), true, 'Saving…');
  var params = new URLSearchParams(location.search);
  api('resetPassword', { token: params.get('reset_token'), password: $('rsPass').value })
    .then(function (r) {
      toast(r.message, 'ok');
      history.replaceState({}, '', location.pathname);
      showAuth('login');
    })
    .catch(function (err) { busy($('btnReset'), false); toast(err.message, 'err'); });
});

document.querySelectorAll('#navTabs button,#navTabsMobile button').forEach(function (b) {
  b.addEventListener('click', function () { STATE.tab = b.dataset.tab; renderTab(); });
});
document.querySelectorAll('#viewMode button').forEach(function (b) {
  b.addEventListener('click', function () {
    STATE.mode = b.dataset.mode;
    document.querySelectorAll('#viewMode button').forEach(function (x) {
      x.classList.toggle('on', x === b); });
    renderTasks();
  });
});
document.querySelectorAll('#periodSeg button').forEach(function (b) {
  b.addEventListener('click', function () {
    STATE.period = b.dataset.p; STATE.offset = 0;
    document.querySelectorAll('#periodSeg button').forEach(function (x) {
      x.classList.toggle('on', x === b); });
    loadReports();
  });
});
$('rOffset').addEventListener('change', function () { STATE.offset = Number(this.value); loadReports(); });
$('rPerson').addEventListener('change', function () { STATE.person = this.value; loadReports(); });

$('fSearch').addEventListener('input', function () { FILTER.q = this.value; renderTasks(); });
$('fAssignee').addEventListener('change', function () { FILTER.assignee = this.value; renderTasks(); });
$('fStatus').addEventListener('change', function () { FILTER.status = this.value; renderTasks(); });
$('fCategory').addEventListener('change', function () { FILTER.category = this.value; renderTasks(); });
$('fOverdue').addEventListener('change', function () { FILTER.overdue = this.checked; renderTasks(); });

$('btnHistory').addEventListener('click', function () {
  STATE.archive = !STATE.archive;
  this.classList.toggle('btn-p', STATE.archive);
  this.classList.toggle('btn-g', !STATE.archive);
  renderTasks();
});
$('btnNewTask').addEventListener('click', openAssign);
$('btnNewUser').addEventListener('click', function () { openUser(null); });
$('btnLeave').addEventListener('click', openLeave);
$('btnCategories').addEventListener('click', openCategories);
$('btnKra').addEventListener('click', openKraOverview);
$('btnNewProject').addEventListener('click', openProjectBuilder);
$('btnOrg').addEventListener('click', openOrgChart);
$('prPerson').addEventListener('change', function () {
  PRIORITY_VIEW.person = this.value; loadPriority(); });
$('btnCookie').addEventListener('click', function () {
  /* A Doer has nobody to recognise, so the same button shows them what they
     have been given rather than a form they cannot use. */
  if ((STATE.data.user || {}).role === 'Doer') openCookieFeed(); else openCookie();
});
$('btnAppraise').addEventListener('click', openAppraisal);
$('btnAccount2').addEventListener('click', openAccountability);

document.querySelectorAll('#lbPeriod button').forEach(function (b) {
  b.addEventListener('click', function () { setLbPeriod(b.dataset.p); }); });
$('lbOffset').addEventListener('change', function () {
  LB.offset = Number(this.value || 0); loadLeaderboard(); });
$('lbVis').addEventListener('change', function () {
  var v = this.value;
  api('setLeaderboardVisibility', { visibility: v })
    .then(function (r) { toast(r.message, 'ok'); loadLeaderboard(); })
    .catch(function (e) { toast(e.message, 'err'); loadLeaderboard(); });
});
$('btnHistoryRpt').addEventListener('click', openReviewHistory);
$('btnAi').addEventListener('click', openAi);
$('btnHelp').addEventListener('click', function () { openHelp(); });
$('btnAccount').addEventListener('click', openAccount);
$('btnBell').addEventListener('click', function (e) {
  e.stopPropagation(); $('bellMenu').classList.toggle('hidden'); });

document.addEventListener('click', function (e) {
  if (!e.target.closest('#bellMenu') && !e.target.closest('#btnBell')) closeBell();
});
$('scrim').addEventListener('click', function (e) { if (e.target.id === 'scrim') closeModal(); });
addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeModal(); closeDrawer(); closeBell(); } });

var rsz;
addEventListener('resize', function () {
  clearTimeout(rsz);
  rsz = setTimeout(function () {
    if (STATE.tab === 'reports' && STATE.analytics) renderReports(STATE.analytics);
    else if (STATE.tab === 'tasks' && STATE.data) renderTasks();
  }, 200);
});

/* Re-check quietly while the tab is in front. 30 seconds, paused when hidden:
   Apps Script allows about 90 minutes of execution a day, and a 5-second poll
   per user burns through that before lunch. */
setInterval(function () {
  if (document.hidden || !STATE.token || !STATE.data) return;
  api('getDashboard').then(function (d) {
    if (d.serviceStopped) { STATE.data = d; renderStopped(d); return; }
    var changed = JSON.stringify(d.tasks) !== JSON.stringify(STATE.data.tasks);
    STATE.data = d; STATE.usage = d.usage;
    renderBanner(); renderTiles(); renderBell();
    if (changed && STATE.tab === 'tasks') renderTasks();
  }).catch(function () { /* a failed background poll must not shout at the user */ });
}, 30000);

/* ---------- boot --------------------------------------------------------- */
(function boot() {
  var params = new URLSearchParams(location.search);
  /* Somebody following a reset link wants the form, not the sales page. */
  if (params.get('reset_token')) { goAuth('reset'); return; }
  if (API_URL.indexOf('PASTE_YOUR') === 0) {
    toast('Set API_URL at the top of this file to your Apps Script /exec URL.', 'err');
    return;
  }
  if (restoreSession()) {
    enterApp();
    return;
  }
  /* A stranger gets the home page; ?login=1 and ?signup=1 go straight to the
     form, so a link in an email or an ad can land where it means to. */
  if (params.get('signup')) goAuth('signup');
  else if (params.get('login')) goAuth('login');
  else showHome();
})();
