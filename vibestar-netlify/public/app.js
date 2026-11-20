
// Server-rendered share pages live at /p/:id and are their own document, so the
// SPA never needs an injected payload. Kept as a constant for the boot check.
const SHARED_POST = null;

// ---------------------------------------------------------------- app state
const state = {
  token: null,
  user: null,
  activePeer: null,
  conversations: [],
  creators: [],
  posts: [],
  authorized: false,
  serverMessages: [],
  pendingMessages: [],
  signupRole: 'FAN',
  postType: 'IMAGE',
  postSource: 'UPLOAD',
  postVisibility: 'PUBLIC',
  galleryCreatorId: null,
  verification: null,
  verifyRoute: 'FOLLOWERS',
  adminFilter: 'PENDING',
  adminPane: 'overview',
  payment: { mode: 'DEMO', keyId: '', live: false, currency: 'INR' },
  themes: null,
  currentTheme: 'MIDNIGHT',
  feedScope: 'ALL',
  searchScope: 'ALL',
  searchPosts: [],
  savedCount: 0,
  galleryItems: [],
  notifications: [],
  notifUnread: 0,
  notifTimer: null,
  tipTarget: null,
  commentPostId: null,
  feedTimer: null,
  lastFeedRefresh: null,
  profileId: null,
  adminUserFilter: { query: '', role: 'ALL', status: 'ALL' },
  adminPostFilter: { query: '', status: 'ALL', visibility: 'ALL' },
  adminPaymentFilter: { status: 'ALL', purpose: 'ALL' },
  tab: 'feed',
  pollTimer: null
};

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const EMOJI = ['😍','🔥','✨','😂','🥰','😭','🙌','👏','💜','💫','🎬','📸','🙏','😮','💯','🤍'];
const TOKEN_KEY = 'vibestar_token';

// ------------------------------------------------------------------ helpers
function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** Only http(s) reaches an img src; mirrors the server-side check. */
function safeUrl(value) {
  const url = String(value || '').trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(url) ? url : '';
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2)
    .map(function (part) { return part.charAt(0).toUpperCase(); }).join('');
}

/**
 * Award-rosette badge: a scalloped medal with two ribbon tails, tinted to the
 * tier colour. Drawn as inline SVG so it stays crisp at any size and needs no
 * image assets. Used on profile pictures, where there is room for the shape to
 * read; compact name rows keep the small tick instead.
 */
function rosetteSvg(color, px) {
  const lobes = 11, cx = 32, cy = 27, valley = 18.5, peak = 24;
  let medal = '';

  for (let i = 0; i < lobes; i++) {
    const a1 = (i / lobes) * Math.PI * 2 - Math.PI / 2;
    const a2 = ((i + 1) / lobes) * Math.PI * 2 - Math.PI / 2;
    const mid = (a1 + a2) / 2;

    const x1 = (cx + valley * Math.cos(a1)).toFixed(2);
    const y1 = (cy + valley * Math.sin(a1)).toFixed(2);
    const x2 = (cx + valley * Math.cos(a2)).toFixed(2);
    const y2 = (cy + valley * Math.sin(a2)).toFixed(2);
    const cpx = (cx + peak * Math.cos(mid)).toFixed(2);
    const cpy = (cy + peak * Math.sin(mid)).toFixed(2);

    if (i === 0) medal += 'M' + x1 + ',' + y1;
    medal += 'Q' + cpx + ',' + cpy + ' ' + x2 + ',' + y2;
  }
  medal += 'Z';

  // Ribbon tails, drawn first so the medal overlaps their tops.
  const leftTail = '24,43 32,47 18,61 16,55 10,57';
  const rightTail = '40,43 32,47 46,61 48,55 54,57';

  // A linear sheen makes the medal read as struck metal rather than a flat
  // shape. The gradient id is per-instance so multiple badges cannot collide.
  const gid = 'sheen' + Math.random().toString(36).slice(2, 9);

  return '<svg viewBox="0 0 64 64" width="' + px + '" height="' + px + '" ' +
    'aria-hidden="true" style="display:block">' +
    '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#ffffff" stop-opacity=".55"/>' +
      '<stop offset="38%" stop-color="' + esc(color) + '"/>' +
      '<stop offset="100%" stop-color="' + esc(color) + '" stop-opacity=".72"/>' +
    '</linearGradient></defs>' +
    '<polygon points="' + leftTail + '" fill="' + esc(color) + '" opacity="0.68"/>' +
    '<polygon points="' + rightTail + '" fill="' + esc(color) + '" opacity="0.68"/>' +
    '<path d="' + medal + '" fill="url(#' + gid + ')"/>' +
    '<circle cx="' + cx + '" cy="' + cy + '" r="12.5" fill="#0f172a" opacity="0.22"/>' +
    '<circle cx="' + cx + '" cy="' + cy + '" r="12.5" fill="none" stroke="#ffffff" ' +
      'stroke-opacity="0.85" stroke-width="2.4"/>' +
    '</svg>';
}

/** A display picture with its tier rosette pinned to the corner. */
function avatarWithRosette(user, sizeClass, textClass, rosettePx) {
  const inner = avatarHtml(user, sizeClass, textClass);
  const badge = user && user.badge;
  if (!badge) return inner;

  return '<span class="relative inline-block align-middle">' + inner +
    '<span class="absolute -bottom-1 -right-1" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.55))" ' +
      'title="Verified · ' + esc(badge.label) + ' tier · ' +
      Number(badge.followers).toLocaleString() + ' followers">' +
      rosetteSvg(badge.color, rosettePx) +
    '</span></span>';
}

/**
 * Verification badge, coloured by tier. The server decides whether a badge
 * exists at all and which tier it is; this only paints it.
 */
function badgeHtml(user, sizeClass) {
  if (!user) return '';
  const size = sizeClass || 'w-4 h-4';
  const badge = user.badge;

  if (badge) {
    return '<span title="Verified · ' + esc(badge.label) + ' tier · ' +
      Number(badge.followers).toLocaleString() + ' followers" ' +
      'style="color:' + esc(badge.color) + '" class="inline-flex shrink-0">' +
      '<i data-lucide="badge-check" class="' + size + '"></i></span>';
  }
  // Verified, but still short of the follower floor the badge needs.
  if (user.isVerified) {
    return '<span title="Verified account" class="inline-flex shrink-0 text-slate-500">' +
      '<i data-lucide="badge-check" class="' + size + '"></i></span>';
  }
  return '';
}

function avatarHtml(user, sizeClass, textClass) {
  const url = safeUrl(user && user.avatarUrl);
  if (url) {
    return '<img src="' + esc(url) + '" alt="" class="' + sizeClass +
           ' rounded-full object-cover bg-slate-800 shrink-0" />';
  }
  return '<span class="' + sizeClass + ' rounded-full shrink-0 bg-gradient-to-tr from-indigo-500 to-purple-600 ' +
         'flex items-center justify-center font-bold text-white ' + (textClass || 'text-xs') + '">' +
         esc(initials(user && user.fullName)) + '</span>';
}

function fmtTime(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function dayLabel(date) {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return mins + 'm';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h';
  const days = Math.floor(hours / 24);
  if (days < 7) return days + 'd';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function daysUntil(iso) {
  return Math.max(0, Math.ceil((new Date(iso) - new Date()) / 86400000));
}

function icons() { if (window.lucide) lucide.createIcons(); }

function toast(message, kind) {
  const host = document.getElementById('toastHost');
  const tone = kind === 'error'
    ? 'bg-rose-500/15 border-rose-500/30 text-rose-200'
    : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200';
  const icon = kind === 'error' ? 'circle-alert' : 'circle-check';

  const el = document.createElement('div');
  el.className = 'fade-up flex items-center gap-2.5 px-4 py-3 rounded-2xl border backdrop-blur-xl ' +
                 'text-xs font-medium shadow-2xl max-w-xs ' + tone;
  el.innerHTML = '<i data-lucide="' + icon + '" class="w-4 h-4 shrink-0"></i><span>' + esc(message) + '</span>';
  host.appendChild(el);
  icons();

  setTimeout(function () {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(function () { el.remove(); }, 320);
  }, 3200);
}

function setLoading(button, isLoading, label) {
  if (!button) return;
  if (isLoading) {
    button.dataset.label = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span><span>' + esc(label || 'Working…') + '</span>';
  } else {
    button.disabled = false;
    if (button.dataset.label) button.innerHTML = button.dataset.label;
    icons();
  }
}

/**
 * Calls the API. Every endpoint is POST /api/<name> with a JSON body, and the
 * session token travels as a bearer header rather than a body field.
 */
function api(fnName) {
  const args = Array.prototype.slice.call(arguments, 1);
  const payload = buildPayload(fnName, args);

  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;

  return fetch('/api/' + fnName, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload)
  }).then(function (response) {
    if (response.status === 401) {
      forceLogout('Your session expired. Please log in again.');
      throw new Error('SESSION_EXPIRED');
    }
    if (response.status === 403) throw new Error('You do not have permission to do that.');

    return response.json().catch(function () {
      throw new Error('Unexpected server response.');
    });
  }).then(function (parsed) {
    if (parsed && parsed.ok === false && parsed.error === 'SESSION_EXPIRED') {
      forceLogout('Your session expired. Please log in again.');
      throw new Error('SESSION_EXPIRED');
    }
    return parsed;
  });
}

/**
 * The UI was written against positional Apps Script calls. Rather than rewrite
 * every call site, positional arguments are named here — one table, one place
 * to look, and the server keeps a self-documenting JSON contract.
 */
const API_ARGS = {
  logIn: ['email', 'password'],
  signUp: ['payload'],
  resumeSession: [],
  logOut: [],
  getProfile: ['userId'],
  updateProfile: ['payload'],
  changePassword: ['currentPassword', 'newPassword'],
  getChatThemes: [],
  setChatTheme: ['themeKey'],
  getPublicFeed: ['scope'],
  getCreators: [],
  createPost: ['type', 'caption', 'mediaUrl', 'visibility'],
  deletePost: ['postId'],
  toggleLike: ['postId'],
  addComment: ['postId', 'content'],
  getComments: ['postId'],
  deleteComment: ['commentId'],
  getShareLink: ['postId'],
  getCreatorGallery: ['creatorId'],
  search: ['query', 'scope'],
  toggleSave: ['postId'],
  getSavedPosts: [],
  getSharedPost: ['postId'],
  followUser: ['userId'],
  unfollowUser: ['userId'],
  getFollowList: ['userId', 'type'],
  getConversations: [],
  getChatMessages: ['peerId'],
  sendMessage: ['peerId', 'content'],
  getNotifications: ['options'],
  markNotificationsRead: ['notificationIds'],
  getPaymentConfig: [],
  createPaymentOrder: ['purpose', 'targetId', 'amountRupees'],
  confirmPayment: ['response'],
  processSubscription: ['celebrityId'],
  cancelSubscription: ['celebrityId'],
  getMyPayments: [],
  getCreatorEarnings: [],
  getVerificationState: [],
  submitVerificationRequest: ['payload'],
  cancelVerificationRequest: [],
  uploadMedia: ['payload'],
  getMediaLimits: [],
  deleteMedia: ['mediaId'],
  adminGetOverview: [],
  adminGetRevenue: [],
  adminListUsers: ['options'],
  adminSetUserStatus: ['userId', 'status', 'reason'],
  adminSetUserRole: ['userId', 'role'],
  adminSetUserAdmin: ['userId', 'makeAdmin'],
  adminListPosts: ['options'],
  adminSetPostStatus: ['postId', 'status'],
  adminListPayments: ['options'],
  adminListMedia: [],
  listVerificationRequests: ['statusFilter'],
  reviewVerificationRequest: ['requestId', 'decision', 'verifiedFollowerCount', 'note'],
  setVerifiedFollowerCount: ['userId', 'count']
};

function buildPayload(fnName, args) {
  const names = API_ARGS[fnName];
  if (!names) return args[0] && typeof args[0] === 'object' ? args[0] : {};

  const payload = {};
  names.forEach(function (name, index) {
    const value = args[index];
    if (value === undefined) return;
    // `options` and `payload` are already objects; spread them so the server
    // sees flat named fields either way.
    if (name === 'options' && value && typeof value === 'object') {
      Object.keys(value).forEach(function (key) { payload[key] = value[key]; });
    } else {
      payload[name] = value;
    }
  });
  return payload;
}

function storeToken(token) {
  state.token = token;
  try { localStorage.setItem(TOKEN_KEY, token); } catch (e) { /* private mode */ }
}

function readToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
}

function clearToken() {
  state.token = null;
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
}

// --------------------------------------------------------------- bootstrap
window.onload = function () {
  icons();
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  // A share link renders a standalone public page: no session, no app shell.
    buildEmojiPanel();
  setAuthMode('login');
  setSignupRole('FAN');
  setPostType('IMAGE');

  const token = readToken();
  if (!token) return showAuth();

  // Set before the call, not after: api() reads state.token to build the
  // Authorization header, so assigning it later would send an anonymous request.
  state.token = token;

  api('resumeSession').then(function (res) {
    if (res.ok) {
      enterApp(res.user);
    } else {
      clearToken();
      showAuth();
    }
  }).catch(function () {
    clearToken();
    showAuth();
  });
};

document.addEventListener('click', function (e) {
  const notif = document.getElementById('notifPanel');
  if (notif && !notif.classList.contains('hidden') &&
      !e.target.closest('#notifPanel') && !e.target.closest('button[onclick="toggleNotifications()"]')) {
    notif.classList.add('hidden');
  }

  const picker = document.getElementById('themePicker');
  if (picker && !picker.classList.contains('hidden') &&
      !e.target.closest('#themePicker') && !e.target.closest('button[onclick="toggleThemePicker()"]')) {
    picker.classList.add('hidden');
  }

  const menu = document.getElementById('userMenu');
  if (!menu || menu.classList.contains('hidden')) return;
  if (!e.target.closest('#userMenu') && !e.target.closest('button[onclick="toggleUserMenu()"]')) {
    menu.classList.add('hidden');
  }
});

// ------------------------------------------------------------------- auth UI
function setAuthMode(mode) {
  const isLogin = mode === 'login';
  const active = 'flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all bg-slate-800 text-white shadow';
  const idle = 'flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all text-slate-500 hover:text-slate-300';

  document.getElementById('authTabLogin').className = isLogin ? active : idle;
  document.getElementById('authTabSignup').className = isLogin ? idle : active;
  document.getElementById('loginForm').classList.toggle('hidden', !isLogin);
  document.getElementById('signupForm').classList.toggle('hidden', isLogin);
  hide('loginError'); hide('signupError');
  icons();
}

function setSignupRole(role) {
  state.signupRole = role;
  const active = 'text-left p-3 rounded-2xl border transition-all bg-indigo-500/15 border-indigo-400/40 text-indigo-200';
  const idle = 'text-left p-3 rounded-2xl border transition-all bg-slate-900/60 border-white/10 text-slate-400 hover:border-white/20';
  document.getElementById('roleCardFan').className = role === 'FAN' ? active : idle;
  document.getElementById('roleCardCeleb').className = role === 'CELEBRITY' ? active : idle;
  icons();
}

function togglePassword(inputId, button) {
  const input = document.getElementById(inputId);
  input.type = input.type === 'password' ? 'text' : 'password';
  button.innerHTML = '<i data-lucide="' + (input.type === 'password' ? 'eye' : 'eye-off') + '" class="w-4 h-4"></i>';
  icons();
}

function renderPasswordMeter() {
  const value = document.getElementById('signupPassword').value;
  let score = 0;
  if (value.length >= 8) score++;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++;
  if (/\d/.test(value) || /[^A-Za-z0-9]/.test(value)) score++;

  const colors = ['bg-rose-500', 'bg-amber-500', 'bg-emerald-500'];
  const hints = ['Too short — 8 characters minimum', 'Add mixed case to strengthen it', 'Strong enough'];

  [1, 2, 3].forEach(function (n) {
    const bar = document.getElementById('pwBar' + n);
    bar.className = 'h-1 flex-1 rounded-full ' + (score >= n ? colors[score - 1] : 'bg-slate-800');
  });
  document.getElementById('pwHint').textContent = value ? hints[Math.max(0, score - 1)] : '';
}

function fillDemo() {
  document.getElementById('loginEmail').value = 'aarohi@vibestar.app';
  document.getElementById('loginPassword').value = 'demo1234';
}

function show(id, text) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.classList.remove('hidden');
}

function hide(id) { document.getElementById(id).classList.add('hidden'); }

function handleLogin(e) {
  e.preventDefault();
  hide('loginError');
  const btn = document.getElementById('loginBtn');
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!email || !password) return show('loginError', 'Enter your email and password.');

  setLoading(btn, true, 'Logging in…');
  api('logIn', email, password).then(function (res) {
    setLoading(btn, false);
    if (!res.ok) return show('loginError', res.error);
    storeToken(res.token);
    enterApp(res.user);
  }).catch(function (err) {
    setLoading(btn, false);
    show('loginError', err.message);
  });
}

function handleSignUp(e) {
  e.preventDefault();
  hide('signupError');
  const btn = document.getElementById('signupBtn');

  const payload = {
    fullName: document.getElementById('signupName').value.trim(),
    username: document.getElementById('signupUsername').value.trim().toLowerCase(),
    email: document.getElementById('signupEmail').value.trim(),
    password: document.getElementById('signupPassword').value,
    role: state.signupRole
  };

  const consent = document.getElementById('signupConsent');
  if (consent && !consent.checked) {
    return show('signupError', 'Please confirm you are 18 or older and accept the policies.');
  }
  if (!payload.fullName) return show('signupError', 'Please enter your full name.');
  if (payload.username.length < 3) return show('signupError', 'Username must be at least 3 characters.');
  if (payload.password.length < 8) return show('signupError', 'Password must be at least 8 characters.');

  setLoading(btn, true, 'Creating account…');
  api('signUp', payload).then(function (res) {
    setLoading(btn, false);
    if (!res.ok) return show('signupError', res.error);
    storeToken(res.token);
    enterApp(res.user);
    toast('Welcome to VibeStar, ' + res.user.fullName.split(' ')[0] + '.');
  }).catch(function (err) {
    setLoading(btn, false);
    show('signupError', err.message);
  });
}

function showAuth() {
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('appShell').classList.add('hidden');
  icons();
}

function forceLogout(message) {
  stopThreadPolling();
  stopNotificationPolling();
  stopDiscoveryRefresh();
  clearToken();
  state.user = null;
  state.activePeer = null;
  showAuth();
  if (message) toast(message, 'error');
}

function handleLogOut() {
  const token = state.token;
  document.getElementById('userMenu').classList.add('hidden');
  forceLogout();
  if (token) api('logOut', token).catch(function () { /* best effort */ });
}

function toggleUserMenu() {
  document.getElementById('userMenu').classList.toggle('hidden');
}

// ------------------------------------------------------------- app entry
function enterApp(user) {
  state.user = user;
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');

  document.getElementById('headerAvatar').innerHTML =
    avatarWithRosette(user, 'w-7 h-7', 'text-[10px]', 14);
  document.getElementById('headerName').textContent = user.fullName;
  document.getElementById('headerRole').textContent = user.role === 'CELEBRITY' ? 'Creator' : 'Fan';
  document.getElementById('creatorActionContainer').classList.toggle('hidden', user.role !== 'CELEBRITY');
  document.getElementById('nav-admin').classList.toggle('hidden', !user.isAdmin);
  document.getElementById('convSubtitle').textContent =
    user.role === 'CELEBRITY' ? 'Your active subscribers' : 'Creators you subscribe to';

  loadPaymentConfig();
  loadChatThemes();
  loadNotifications();
  startNotificationPolling();
  startDiscoveryRefresh();
  setFeedScope('ALL');
  switchTab('feed');
  loadFeed();
  loadCreators();
  loadConversations();
  if (user.isAdmin) refreshQueueBadge();
  icons();
}

/** Pending-review count on the admin nav item. */
function refreshQueueBadge() {
  api('listVerificationRequests', 'PENDING').then(function (res) {
    if (!res.ok) return;
    const badge = document.getElementById('navQueue');
    badge.textContent = res.requests.length;
    badge.classList.toggle('hidden', res.requests.length === 0);
  }).catch(function () { /* non-critical */ });
}

function switchTab(tab) {
  state.tab = tab;
  ['feed', 'reels', 'search', 'saved', 'chat', 'profile', 'admin'].forEach(function (t) {
    document.getElementById('view-' + t).classList.add('hidden');
    const navBtn = document.getElementById('nav-' + t);
    const wasHidden = navBtn.classList.contains('hidden');
    navBtn.className = 'w-full flex items-center gap-3 px-4 py-3 rounded-xl font-semibold ' +
      'text-slate-400 hover:bg-slate-900 transition-all' + (wasHidden ? ' hidden' : '');
  });
  document.getElementById('view-' + tab).classList.remove('hidden');
  document.getElementById('nav-' + tab).className =
    'w-full flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-slate-200 bg-slate-900 border border-slate-800';

  // The messenger needs the extra column the discovery rail normally occupies.
  const main = document.getElementById('mainCol');
  const aside = document.getElementById('asideCol');
  const wide = tab === 'chat';
  main.className = wide ? 'md:col-span-3' : 'md:col-span-2';
  aside.classList.toggle('hidden', wide);

  if (tab === 'chat') {
    loadConversations();
    startThreadPolling();
  } else {
    stopThreadPolling();
  }
  if (tab === 'reels') renderReels();
  if (tab === 'profile') viewProfile(state.user.id);
  if (tab === 'admin') switchAdminPane(state.adminPane || 'overview');
  if (tab === 'saved') loadSaved();
  if (tab === 'search') {
    setSearchScope(state.searchScope || 'ALL');
    const input = document.getElementById('searchInput');
    if (input) input.focus();
  }
  icons();
}

// ----------------------------------------------------------------- feed
function setFeedScope(scope) {
  state.feedScope = scope;
  ['ALL', 'FOLLOWING'].forEach(function (key) {
    document.getElementById('fscope-' + key).className =
      'flex-1 py-2.5 rounded-xl text-[11px] font-semibold transition-all ' +
      (key === scope ? 'bg-slate-800 text-white shadow' : 'text-slate-500 hover:text-slate-300');
  });
  const note = document.getElementById('feedScopeNote');
  if (note) {
    note.textContent = scope === 'FOLLOWING'
      ? 'People you follow, newest first.'
      : 'Ranked by likes, comments and shares. Refreshes every 15 minutes.';
  }
  loadFeed();
}

function loadFeed() {
  api('getPublicFeed', state.feedScope).then(function (res) {
    if (!res.ok) return;
    state.posts = res.posts;
    state.lastFeedRefresh = Date.now();
    renderFeed();
    renderRefreshStamp();
    if (state.tab === 'reels') renderReels();
  }).catch(function () { /* handled by api() */ });
}

function renderFeed() {
  const container = document.getElementById('feedContainer');
  const posts = state.posts.filter(function (p) { return p.type !== 'VIDEO'; });

  if (!posts.length) {
    container.innerHTML = state.feedScope === 'FOLLOWING'
      ? emptyCard('user-plus', 'Your Following feed is empty',
          'Follow a few people and their posts will land here. Following is free.')
      : emptyCard('image-off', 'No posts yet',
          state.user.role === 'CELEBRITY'
            ? 'Publish your first 30-day post to get started.'
            : 'Follow or subscribe to a creator, or check back once someone posts.');
    icons();
    return;
  }

  container.innerHTML = posts.map(function (post) {
    const author = post.author;
    const mine = author.id === state.user.id;
    const media = safeUrl(post.mediaUrl);

    return '' +
      '<article class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl fade-up">' +
        '<div class="flex items-center justify-between p-4 border-b border-slate-800/60">' +
          '<button onclick="viewProfile(\'' + esc(author.id) + '\')" class="flex items-center gap-3 text-left group">' +
            avatarWithRosette(author, 'w-10 h-10', 'text-sm', 18) +
            '<span>' +
              '<span class="flex items-center gap-1 font-semibold text-sm text-slate-100 group-hover:text-indigo-300 transition-colors">' +
                esc(author.fullName) +
                badgeHtml(author, 'w-3.5 h-3.5') +
              '</span>' +
              '<span class="block text-xs text-slate-400">@' + esc(author.username) + ' · ' + esc(author.category || 'Creator') + '</span>' +
            '</span>' +
          '</button>' +
          '<div class="flex items-center gap-2">' +
            '<span class="text-[11px] px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-medium whitespace-nowrap">' +
              'Expires in ' + daysUntil(post.expiresAt) + 'd' +
            '</span>' +

            (mine
              ? '<button onclick="removePost(\'' + esc(post.id) + '\')" title="Delete" class="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>'
              : '') +
          '</div>' +
        '</div>' +
        (post.caption ? '<p class="p-4 text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">' + esc(post.caption) + '</p>' : '') +
        mediaHtml(post, 'w-full max-h-96 object-cover bg-black') +
        '<div class="px-4 py-3 border-t border-slate-800/60">' + actionBarHtml(post) + '</div>' +
        (!mine ? '<div class="px-3 pb-3 flex gap-2">' +
            followButtonHtml(author, 'px-4 py-2 text-xs') +
            (post.viewerIsSubscribed
              ? '<button onclick="openThreadWith(\'' + esc(author.id) + '\')" class="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"><i data-lucide="message-square" class="w-3.5 h-3.5"></i> Message</button>'
              : '<button onclick="subscribeTo(\'' + esc(author.id) + '\')" class="flex-1 py-2 rounded-xl btn-primary text-xs font-bold transition-all">Subscribe ₹' + esc(author.monthlyPrice) + '/mo</button>') +
          '</div>' : '') +
      '</article>';
  }).join('');
  icons();
}

function renderReels() {
  const container = document.getElementById('reelsContainer');
  const reels = state.posts.filter(function (p) { return p.type === 'VIDEO'; });

  if (!reels.length) {
    container.innerHTML = emptyCard('clapperboard', 'No reels yet',
      'Reels are posts published as "Reel". They follow the same 30-day clock.');
    icons();
    return;
  }

  container.innerHTML = reels.map(function (post) {
    const media = safeUrl(post.mediaUrl);
    const isDriveVideo = /drive\.google\.com/.test(media);
    return '' +
      '<div class="max-w-[380px] mx-auto h-[620px] bg-black rounded-3xl overflow-hidden relative border border-slate-800 shadow-2xl flex flex-col justify-end p-4 fade-up">' +
        (media
          ? (isDriveVideo
              ? '<iframe src="' + esc(media) + '" class="absolute inset-0 w-full h-full" allow="autoplay" allowfullscreen frameborder="0"></iframe>'
              : (post.type === 'VIDEO'
                  ? '<video src="' + esc(media) + '" class="absolute inset-0 w-full h-full object-cover" controls playsinline preload="metadata"></video>'
                  : '<img src="' + esc(media) + '" class="absolute inset-0 w-full h-full object-cover opacity-85" />'))
          : '') +
        '<div class="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/90 to-transparent"></div>' +
        '<div class="relative z-10 space-y-2 text-white">' +
          '<div class="flex items-center gap-2">' +
            avatarHtml(post.author, 'w-8 h-8', 'text-[10px]') +
            '<span class="font-bold text-sm">@' + esc(post.author.username) + '</span>' +
            badgeHtml(post.author, 'w-4 h-4') +
          '</div>' +
          (post.caption ? '<p class="text-xs text-slate-200 leading-relaxed">' + esc(post.caption) + '</p>' : '') +
          '<p class="text-[10px] text-amber-400">Expires in ' + daysUntil(post.expiresAt) + ' days</p>' +
          '<div class="pt-2">' + actionBarHtml(post, 'dark') + '</div>' +
        '</div>' +
      '</div>';
  }).join('');
  icons();
}

/**
 * Renders a post's media. Drive-hosted video cannot be hotlinked into a
 * <video> tag, so its preview player is embedded instead; other video URLs get
 * a normal player.
 */
function mediaHtml(post, classes) {
  const url = safeUrl(post.mediaUrl);
  if (!url) return '';

  if (post.type === 'VIDEO') {
    if (/drive\.google\.com/.test(url)) {
      return '<div class="relative w-full bg-black" style="aspect-ratio:9/16;max-height:32rem">' +
        '<iframe src="' + esc(url) + '" class="absolute inset-0 w-full h-full" ' +
        'allow="autoplay" allowfullscreen frameborder="0"></iframe></div>';
    }
    return '<video src="' + esc(url) + '" controls playsinline preload="metadata" ' +
      'class="' + (classes || 'w-full max-h-96 bg-black') + '"></video>';
  }

  return '<img src="' + esc(url) + '" alt="" class="' + (classes || 'w-full max-h-96 object-cover bg-black') + '" />';
}

/** Like / comment / share bar, shared by feed cards and reels. */
function actionBarHtml(post, tone) {
  const dark = tone === 'dark';
  const base = dark
    ? 'flex items-center gap-1.5 text-white/90 hover:text-white'
    : 'flex items-center gap-1.5 text-slate-400 hover:text-slate-100';

  return '<div class="flex items-center gap-5">' +
    '<button onclick="toggleLike(\'' + esc(post.id) + '\')" class="' + base + ' transition-colors" ' +
      'title="' + (post.viewerLiked ? 'Unlike' : 'Like') + '">' +
      '<i data-lucide="heart" class="w-[18px] h-[18px] transition-transform" ' +
        (post.viewerLiked ? 'style="fill:#C4636F;color:#C4636F"' : '') + '></i>' +
      '<span class="text-xs tabular-nums' + (post.viewerLiked ? ' text-rose-400' : '') + '">' +
        (post.likeCount || 0) + '</span>' +
    '</button>' +

    '<button onclick="openComments(\'' + esc(post.id) + '\')" class="' + base + ' transition-colors" title="Comments">' +
      '<i data-lucide="message-circle" class="w-[18px] h-[18px]"></i>' +
      '<span class="text-xs tabular-nums">' + (post.commentCount || 0) + '</span>' +
    '</button>' +

    '<button onclick="toggleSave(\'' + esc(post.id) + '\')" id="save-' + esc(post.id) + '" ' +
      'class="' + base + ' transition-colors ml-auto" ' +
      'title="' + (post.viewerSaved ? 'Remove from saved' : 'Save for later') + '">' +
      '<i data-lucide="bookmark" class="w-[18px] h-[18px]" ' +
        (post.viewerSaved ? 'style="fill:#a78bfa;color:#a78bfa"' : '') + '></i>' +
    '</button>' +

    '<button onclick="openShareModal(\'' + esc(post.id) + '\')" class="' + base + ' transition-colors" title="Share">' +
      '<i data-lucide="share-2" class="w-[18px] h-[18px]"></i>' +
    '</button>' +
  '</div>';
}

function loadingCard(label) {
  return '<div class="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 text-center">' +
    '<div class="w-5 h-5 mx-auto mb-3 border-2 border-slate-700 border-t-indigo-400 rounded-full animate-spin"></div>' +
    '<p class="text-xs text-slate-500">' + esc(label || 'Loading…') + '</p>' +
  '</div>';
}

// --------------------------------------------------------------- search
/**
 * Debounced so typing "aarohi" is one request rather than six. That matters more
 * on this backend than most: the Sheets API allows roughly 300 reads a minute
 * for the whole site, and a search-as-you-type that fired per keystroke would
 * spend a serious share of it on one person.
 */
let searchTimer = null;
const SEARCH_DEBOUNCE_MS = 350;

function onSearchInput() {
  const input = document.getElementById('searchInput');
  const clearBtn = document.getElementById('searchClearBtn');
  clearBtn.classList.toggle('hidden', !input.value);

  clearTimeout(searchTimer);
  const query = input.value.trim();

  if (query.length < 2) {
    document.getElementById('searchResults').innerHTML = query.length
      ? emptyCard('type', 'Keep typing', 'Two characters or more.')
      : searchIdleHtml();
    icons();
    return;
  }

  searchTimer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
}

function clearSearch() {
  const input = document.getElementById('searchInput');
  input.value = '';
  document.getElementById('searchClearBtn').classList.add('hidden');
  document.getElementById('searchResults').innerHTML = searchIdleHtml();
  state.searchPosts = [];
  input.focus();
  icons();
}

function searchIdleHtml() {
  return '<div class="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">' +
    '<p class="text-xs text-slate-400 mb-3 font-semibold">Try searching for</p>' +
    '<ul class="space-y-2 text-[11px] text-slate-500">' +
      '<li class="flex items-center gap-2"><i data-lucide="at-sign" class="w-3.5 h-3.5 text-cyan-500/70"></i> a handle, like <span class="text-slate-400">@aarohi</span></li>' +
      '<li class="flex items-center gap-2"><i data-lucide="user" class="w-3.5 h-3.5 text-cyan-500/70"></i> someone\'s name</li>' +
      '<li class="flex items-center gap-2"><i data-lucide="briefcase" class="w-3.5 h-3.5 text-cyan-500/70"></i> what they do, like <span class="text-slate-400">photographer</span></li>' +
      '<li class="flex items-center gap-2"><i data-lucide="text" class="w-3.5 h-3.5 text-cyan-500/70"></i> words from a caption</li>' +
    '</ul>' +
    '<p class="text-[10px] text-slate-600 mt-4 pt-3 border-t border-white/5">' +
      'Private gallery posts only appear if you already subscribe to that creator.</p>' +
  '</div>';
}

function setSearchScope(scope) {
  state.searchScope = scope;
  ['ALL', 'PEOPLE', 'POSTS'].forEach(function (key) {
    const btn = document.getElementById('sscope-' + key);
    if (!btn) return;
    btn.className = 'flex-1 py-2 rounded-xl text-[11px] font-semibold transition-all ' +
      (key === scope ? 'bg-slate-800 text-white shadow' : 'text-slate-500 hover:text-slate-300');
  });

  const input = document.getElementById('searchInput');
  if (input && input.value.trim().length >= 2) runSearch();
  else if (input && !input.value) {
    document.getElementById('searchResults').innerHTML = searchIdleHtml();
    icons();
  }
  icons();
}

function runSearch() {
  clearTimeout(searchTimer);
  const query = document.getElementById('searchInput').value.trim();
  const results = document.getElementById('searchResults');
  if (query.length < 2) return;

  results.innerHTML = loadingCard('Searching…');

  api('search', query, state.searchScope || 'ALL').then(function (res) {
    if (!res.ok) {
      results.innerHTML = emptyCard('alert-triangle', 'Search failed', res.error || '');
      icons();
      return;
    }
    state.searchPosts = res.posts || [];
    renderSearchResults(res);
  });
}

function renderSearchResults(res) {
  const results = document.getElementById('searchResults');

  if (!res.people.length && !res.posts.length) {
    results.innerHTML = emptyCard('search-x', 'Nothing found for "' + esc(res.query) + '"',
      'Try a shorter word, or check the spelling of the handle.');
    icons();
    return;
  }

  let html = '';

  if (res.people.length) {
    html += '<div>' +
      '<h3 class="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-3 px-1">' +
        'People · ' + res.people.length + '</h3>' +
      '<div class="space-y-2">' + res.people.map(searchPersonHtml).join('') + '</div>' +
    '</div>';
  }

  if (res.posts.length) {
    html += '<div>' +
      '<h3 class="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-3 px-1">' +
        'Posts · ' + res.posts.length + '</h3>' +
      '<div class="space-y-4">' + res.posts.map(searchPostHtml).join('') + '</div>' +
    '</div>';
  }

  if (res.truncated) {
    html += '<p class="text-[10px] text-slate-600 text-center pt-2">' +
      'Showing the closest matches only. Narrow the search for more.</p>';
  }

  results.innerHTML = html;
  icons();
}

function searchPersonHtml(person) {
  return '<div class="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex items-center gap-3 fade-up">' +
    '<button onclick="viewProfile(\'' + esc(person.id) + '\')" class="flex items-center gap-3 flex-1 min-w-0 text-left group">' +
      avatarWithRosette(person, 'w-11 h-11', 'text-sm', 18) +
      '<span class="min-w-0">' +
        '<span class="flex items-center gap-1 font-semibold text-sm text-slate-100 group-hover:text-indigo-300 transition-colors truncate">' +
          esc(person.fullName) + badgeHtml(person, 'w-3.5 h-3.5') +
        '</span>' +
        '<span class="block text-[11px] text-slate-500 truncate">@' + esc(person.username) +
          (person.role === 'CELEBRITY' ? ' · ' + esc(person.category || 'Creator') : '') +
          ' · ' + Number(person.followerCount).toLocaleString() + ' followers</span>' +
      '</span>' +
    '</button>' +
    (person.isSelf
      ? '<span class="text-[10px] text-slate-600 px-2 whitespace-nowrap">You</span>'
      : followButtonHtml(person, 'px-3 py-1.5 text-[11px]')) +
  '</div>';
}

function searchPostHtml(post) {
  const author = post.author;
  return '<article class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden fade-up">' +
    '<div class="flex items-center justify-between px-4 py-3 border-b border-slate-800/60">' +
      '<button onclick="viewProfile(\'' + esc(author.id) + '\')" class="flex items-center gap-2.5 text-left group min-w-0">' +
        avatarWithRosette(author, 'w-8 h-8', 'text-[11px]', 14) +
        '<span class="min-w-0">' +
          '<span class="flex items-center gap-1 font-semibold text-[13px] text-slate-100 group-hover:text-indigo-300 transition-colors truncate">' +
            esc(author.fullName) + badgeHtml(author, 'w-3 h-3') +
          '</span>' +
          '<span class="block text-[10px] text-slate-500">' + esc(relTime(post.createdAt)) + ' ago</span>' +
        '</span>' +
      '</button>' +
      (post.visibility === 'SUBSCRIBERS'
        ? '<span class="text-[10px] px-2 py-0.5 bg-violet-500/10 text-violet-300 border border-violet-500/20 rounded-full font-semibold whitespace-nowrap">Private</span>'
        : '') +
    '</div>' +
    (post.caption ? '<p class="px-4 py-3 text-[13px] text-slate-200 leading-relaxed whitespace-pre-wrap">' + esc(post.caption) + '</p>' : '') +
    mediaHtml(post, 'w-full max-h-72 object-cover bg-black') +
    '<div class="px-4 py-2.5 border-t border-slate-800/60">' + actionBarHtml(post) + '</div>' +
  '</article>';
}

// ---------------------------------------------------------------- saving
/**
 * Optimistic, like the heart: a bookmark should feel instant. Every copy of the
 * post in memory is updated so the icon is right whichever view you came from.
 */
function toggleSave(postId) {
  const lists = [state.posts, state.searchPosts, state.galleryItems];
  let next = null;

  lists.forEach(function (list) {
    (list || []).forEach(function (p) {
      if (p.id !== postId) return;
      if (next === null) next = !p.viewerSaved;
      p.viewerSaved = next;
    });
  });
  if (next === null) next = true;

  paintSaveIcon(postId, next);

  api('toggleSave', postId).then(function (res) {
    if (!res.ok) {
      // Put it back the way it was and say why.
      lists.forEach(function (list) {
        (list || []).forEach(function (p) { if (p.id === postId) p.viewerSaved = !next; });
      });
      paintSaveIcon(postId, !next);
      toast(res.error || 'Could not save that.', 'error');
      return;
    }
    // The badge is only meaningful once the Saved view has been opened and set a
    // real total; before that this keeps it from drifting below zero.
    state.savedCount = Math.max(0, (state.savedCount || 0) + (res.saved ? 1 : -1));
    renderSavedBadge();
    // If the Saved view is open, keep it truthful rather than stale.
    if (state.tab === 'saved') loadSaved();
  });
}

function paintSaveIcon(postId, saved) {
  const btn = document.getElementById('save-' + postId);
  if (!btn) return;
  const icon = btn.querySelector('i, svg');
  if (icon) {
    icon.style.fill = saved ? '#a78bfa' : '';
    icon.style.color = saved ? '#a78bfa' : '';
  }
  btn.title = saved ? 'Remove from saved' : 'Save for later';
}

function renderSavedBadge() {
  const badge = document.getElementById('navSaved');
  if (!badge) return;
  const count = state.savedCount || 0;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.classList.toggle('hidden', count === 0);
}

function loadSaved() {
  const container = document.getElementById('savedContainer');
  container.innerHTML = loadingCard('Loading your saved posts…');

  api('getSavedPosts').then(function (res) {
    if (!res.ok) {
      container.innerHTML = emptyCard('alert-triangle', 'Could not load your saved posts', res.error || '');
      icons();
      return;
    }

    state.savedCount = res.total;
    renderSavedBadge();

    const note = document.getElementById('savedCountNote');
    if (note) {
      note.textContent = res.total
        ? res.available + ' of ' + res.total + ' still available'
        : '';
    }

    if (!res.items.length) {
      container.innerHTML = emptyCard('bookmark', 'Nothing saved yet',
        'Tap the bookmark on any post to keep it here. Posts still expire after 30 days.');
      icons();
      return;
    }

    container.innerHTML = res.items.map(savedCardHtml).join('');
    icons();
  });
}

/**
 * A saved post can be in one of four states, and each is shown honestly rather
 * than dropped: available, expired, locked behind a lapsed subscription, or gone.
 */
function savedCardHtml(item) {
  if (item.unavailable && item.reason === 'REMOVED') {
    return '<div class="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex items-center gap-3">' +
      '<i data-lucide="trash-2" class="w-4 h-4 text-slate-600"></i>' +
      '<span class="text-xs text-slate-500">This post was removed by its author or an administrator.</span>' +
    '</div>';
  }

  if (item.unavailable && item.reason === 'EXPIRED') {
    return '<div class="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">' +
      '<div class="flex items-center gap-2 mb-2">' +
        '<i data-lucide="hourglass" class="w-3.5 h-3.5 text-amber-500/70"></i>' +
        '<span class="text-[10px] uppercase tracking-wider text-amber-500/70 font-semibold">Expired</span>' +
      '</div>' +
      (item.caption ? '<p class="text-xs text-slate-400 leading-relaxed">' + esc(item.caption) + '</p>' : '') +
      '<p class="text-[10px] text-slate-600 mt-2">Its 30 days are up, so the media is gone. ' +
        'That is the deal on every post here.</p>' +
    '</div>';
  }

  if (item.locked) {
    return '<div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-center">' +
      '<i data-lucide="lock" class="w-6 h-6 mx-auto text-violet-400/70 mb-3"></i>' +
      '<p class="text-sm font-semibold text-slate-200 mb-1">Locked again</p>' +
      '<p class="text-[11px] text-slate-500 mb-4">Your subscription to ' +
        esc(item.author.fullName) + ' has lapsed, so this one is behind the paywall again.</p>' +
      '<button onclick="subscribeTo(\'' + esc(item.author.id) + '\')" ' +
        'class="px-4 py-2 btn-primary rounded-xl text-xs font-bold transition-all">Resubscribe</button>' +
    '</div>';
  }

  const author = item.author;
  return '' +
    '<article class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl fade-up">' +
      '<div class="flex items-center justify-between p-4 border-b border-slate-800/60">' +
        '<button onclick="viewProfile(\'' + esc(author.id) + '\')" class="flex items-center gap-3 text-left group">' +
          avatarWithRosette(author, 'w-9 h-9', 'text-xs', 16) +
          '<span>' +
            '<span class="flex items-center gap-1 font-semibold text-sm text-slate-100 group-hover:text-indigo-300 transition-colors">' +
              esc(author.fullName) + badgeHtml(author, 'w-3.5 h-3.5') +
            '</span>' +
            '<span class="block text-[11px] text-slate-500">Saved ' + esc(relTime(item.savedAt)) + ' ago</span>' +
          '</span>' +
        '</button>' +
        (item.visibility === 'SUBSCRIBERS'
          ? '<span class="text-[10px] px-2 py-1 bg-violet-500/10 text-violet-300 border border-violet-500/20 rounded-full font-semibold">Private</span>'
          : '<span class="text-[11px] px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-medium whitespace-nowrap">' +
              'Expires in ' + daysUntil(item.expiresAt) + 'd</span>') +
      '</div>' +
      (item.caption ? '<p class="p-4 text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">' + esc(item.caption) + '</p>' : '') +
      mediaHtml(item, 'w-full max-h-80 object-cover bg-black') +
      '<div class="px-4 py-3 border-t border-slate-800/60">' + actionBarHtml(item) + '</div>' +
    '</article>';
}

function toggleLike(postId) {
  // Optimistic, so the heart responds instantly rather than after a round trip.
  const post = (state.posts || []).filter(function (p) { return p.id === postId; })[0];
  if (post) {
    post.viewerLiked = !post.viewerLiked;
    post.likeCount = Math.max(0, (post.likeCount || 0) + (post.viewerLiked ? 1 : -1));
    renderFeed();
    if (state.tab === 'reels') renderReels();
  }

  api('toggleLike', postId).then(function (res) {
    if (!res.ok) {
      toast(res.error, 'error');
      return loadFeed();
    }
    if (post) {
      post.viewerLiked = res.liked;
      post.likeCount = res.likeCount;
      renderFeed();
      if (state.tab === 'reels') renderReels();
    }
    if (state.tab === 'profile' && state.galleryCreatorId) loadGallery(state.galleryCreatorId);
  }).catch(function (err) {
    toast(err.message, 'error');
    loadFeed();
  });
}

function openComments(postId) {
  state.commentPostId = postId;
  document.getElementById('commentModal').classList.remove('hidden');
  document.getElementById('commentList').innerHTML =
    '<p class="text-xs text-slate-500 text-center py-8">Loading…</p>';
  document.getElementById('commentInput').value = '';
  loadComments();
}

function closeComments() {
  document.getElementById('commentModal').classList.add('hidden');
  state.commentPostId = null;
}

function loadComments() {
  if (!state.commentPostId) return;

  api('getComments', state.commentPostId).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    renderComments(res.comments);
  }).catch(function (err) { toast(err.message, 'error'); });
}

function renderComments(comments) {
  const list = document.getElementById('commentList');
  document.getElementById('commentCount').textContent =
    comments.length + (comments.length === 1 ? ' comment' : ' comments');

  if (!comments.length) {
    list.innerHTML = '<p class="text-xs text-slate-500 text-center py-10 font-light">' +
      'No comments yet. Say the first thing.</p>';
    icons();
    return;
  }

  list.innerHTML = comments.map(function (c) {
    return '<div class="flex items-start gap-2.5 px-1 py-2.5">' +
      (c.author
        ? '<button onclick="closeComments();viewProfile(\'' + esc(c.author.id) + '\')">' +
          avatarWithRosette(c.author, 'w-8 h-8', 'text-[10px]', 14) + '</button>'
        : '<span class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 shrink-0">' +
          '<i data-lucide="user" class="w-3.5 h-3.5"></i></span>') +

      '<div class="min-w-0 flex-1">' +
        '<div class="flex items-center gap-1.5">' +
          '<span class="text-[11px] font-semibold text-slate-200 truncate">' +
            esc(c.author ? c.author.fullName : 'Removed account') + '</span>' +
          (c.author ? badgeHtml(c.author, 'w-3 h-3') : '') +
          '<span class="text-[10px] text-slate-600">' + esc(relTime(c.createdAt)) + '</span>' +
        '</div>' +
        '<p class="text-xs text-slate-300 mt-0.5 leading-relaxed whitespace-pre-wrap break-words">' +
          esc(c.content) + '</p>' +
      '</div>' +

      (c.canDelete
        ? '<button onclick="removeComment(\'' + esc(c.id) + '\')" title="Delete" ' +
          'class="p-1 rounded text-slate-600 hover:text-rose-400 transition-colors shrink-0">' +
          '<i data-lucide="trash-2" class="w-3 h-3"></i></button>'
        : '') +
    '</div>';
  }).join('');
  icons();
}

function submitComment(e) {
  if (e && e.preventDefault) e.preventDefault();

  const input = document.getElementById('commentInput');
  const content = input.value.trim();
  if (!content || !state.commentPostId) return;

  input.value = '';

  api('addComment', state.commentPostId, content).then(function (res) {
    if (!res.ok) {
      input.value = content;   // hand the text back rather than losing it
      return toast(res.error, 'error');
    }
    loadComments();

    const post = (state.posts || []).filter(function (p) { return p.id === state.commentPostId; })[0];
    if (post) {
      post.commentCount = (post.commentCount || 0) + 1;
      renderFeed();
      if (state.tab === 'reels') renderReels();
    }
  }).catch(function (err) {
    input.value = content;
    toast(err.message, 'error');
  });
}

function removeComment(commentId) {
  if (!confirm('Delete this comment?')) return;

  api('deleteComment', commentId).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    loadComments();

    const post = (state.posts || []).filter(function (p) { return p.id === state.commentPostId; })[0];
    if (post) {
      post.commentCount = Math.max(0, (post.commentCount || 0) - 1);
      renderFeed();
    }
  }).catch(function (err) { toast(err.message, 'error'); });
}

function emptyCard(icon, title, body) {
  return '<div class="bg-slate-900/60 border border-slate-800 rounded-2xl py-14 flex flex-col items-center text-center px-8">' +
    '<div class="w-14 h-14 rounded-2xl bg-slate-800/60 border border-white/5 flex items-center justify-center text-slate-500 mb-3">' +
      '<i data-lucide="' + icon + '" class="w-6 h-6"></i>' +
    '</div>' +
    '<p class="text-sm font-semibold text-slate-300">' + esc(title) + '</p>' +
    '<p class="text-xs text-slate-500 mt-1 max-w-xs leading-relaxed">' + esc(body) + '</p>' +
  '</div>';
}

// ------------------------------------------------------------- creators
function loadCreators() {
  api('getCreators').then(function (res) {
    if (!res.ok) return;
    state.creators = res.creators;
    renderCreators();
  }).catch(function () { /* handled */ });
}

function renderCreators() {
  const list = document.getElementById('creatorList');
  const others = state.creators.filter(function (c) { return !c.isSelf; });
  document.getElementById('creatorRailNote').textContent =
    others.some(function (c) { return c.recommended; })
      ? 'Ranked by engagement' : '';

  if (!others.length) {
    list.innerHTML = '<p class="px-3 py-6 text-xs text-slate-500 text-center">No other creators yet.</p>';
    return;
  }

  list.innerHTML = others.map(function (c) {
    return '' +
      '<div class="p-2.5 rounded-xl hover:bg-white/5 transition-colors">' +
        '<button onclick="viewProfile(\'' + esc(c.id) + '\')" class="w-full flex items-center gap-2.5 text-left">' +
          avatarWithRosette(c, 'w-9 h-9', 'text-[11px]', 16) +
          '<span class="min-w-0 flex-1">' +
            '<span class="flex items-center gap-1 text-xs font-semibold text-slate-100 truncate">' +
              esc(c.fullName) +
              badgeHtml(c, 'w-3 h-3') +
              (c.recommended
                ? '<span class="shrink-0 text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ' +
                  'bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">Rising</span>'
                : '') +
            '</span>' +
            '<span class="block text-[10px] text-slate-500 truncate">' +
              Number(c.followerCount).toLocaleString() + ' followers · ' + c.subscriberCount + ' subs</span>' +
            (c.engagement && (c.engagement.likes || c.engagement.comments)
              ? '<span class="block text-[9px] text-slate-600 truncate">' +
                c.engagement.likes + ' likes · ' + c.engagement.comments + ' comments</span>'
              : '') +
          '</span>' +
        '</button>' +
        '<div class="mt-2 flex gap-1.5">' +
          followButtonHtml(c, 'flex-1 py-1.5 text-[10px]') +
          (c.viewerIsSubscribed
            ? '<button onclick="openThreadWith(\'' + esc(c.id) + '\')" class="flex-1 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold transition-colors">Message</button>'
            : '<button onclick="subscribeTo(\'' + esc(c.id) + '\')" class="flex-1 py-1.5 rounded-xl btn-primary text-[10px] font-bold transition-all">₹' + esc(c.monthlyPrice) + '</button>') +
        '</div>' +
      '</div>';
  }).join('');
  icons();
}

// ----------------------------------------------------------- notifications
const NOTIF_STYLE = {
  FOLLOW:       { icon: 'user-plus',   tone: 'text-sky-400 bg-sky-500/10 border-sky-500/20' },
  MESSAGE:      { icon: 'message-square', tone: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  SUBSCRIPTION: { icon: 'sparkles',    tone: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' },
  VERIFICATION: { icon: 'badge-check', tone: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  TIP:          { icon: 'gift',        tone: 'text-pink-400 bg-pink-500/10 border-pink-500/20' },
  SUB_EXPIRING: { icon: 'clock',       tone: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  SUB_EXPIRED:  { icon: 'lock',        tone: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
  SUB_CHURNED:  { icon: 'user-minus',  tone: 'text-slate-400 bg-slate-500/10 border-slate-500/20' },
  LIKE:         { icon: 'heart',       tone: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
  COMMENT:      { icon: 'message-circle', tone: 'text-sky-400 bg-sky-500/10 border-sky-500/20' }
};

function notificationText(n) {
  const who = n.actor ? n.actor.fullName : 'Someone';

  if (n.type === 'FOLLOW') {
    return n.count > 1
      ? esc(who) + ' and ' + (n.count - 1) + ' other' + (n.count > 2 ? 's' : '') + ' followed you'
      : '<strong class="text-slate-100">' + esc(who) + '</strong> started following you';
  }
  if (n.type === 'MESSAGE') {
    return '<strong class="text-slate-100">' + esc(who) + '</strong> sent you ' +
      (n.count > 1 ? n.count + ' messages' : 'a message');
  }
  if (n.type === 'SUBSCRIPTION') {
    return '<strong class="text-slate-100">' + esc(who) + '</strong> subscribed to you';
  }
  if (n.type === 'VERIFICATION') {
    return n.targetId === 'REJECTED'
      ? 'Your verification request was <strong class="text-rose-300">declined</strong>'
      : 'Your account is now <strong class="text-emerald-300">verified</strong>';
  }
  if (n.type === 'TIP') {
    return '<strong class="text-slate-100">' + esc(who) + '</strong> tipped you ' +
      '<strong class="text-pink-300">₹' + esc(n.meta || '?') + '</strong>';
  }
  if (n.type === 'SUB_EXPIRING') {
    const days = Number(n.meta) || 1;
    return 'Your subscription to <strong class="text-slate-100">' + esc(who) + '</strong> ends in ' +
      days + ' day' + (days === 1 ? '' : 's') + ' — renew to keep the chat';
  }
  if (n.type === 'SUB_EXPIRED') {
    return 'Your subscription to <strong class="text-slate-100">' + esc(who) + '</strong> has ended. ' +
      'Resubscribe to reopen the thread';
  }
  if (n.type === 'SUB_CHURNED') {
    return '<strong class="text-slate-100">' + esc(who) + '</strong> let their subscription lapse';
  }
  if (n.type === 'LIKE') {
    return n.count > 1
      ? '<strong class="text-slate-100">' + esc(who) + '</strong> and ' + (n.count - 1) +
        ' other' + (n.count > 2 ? 's' : '') + ' liked your post'
      : '<strong class="text-slate-100">' + esc(who) + '</strong> liked your post';
  }
  if (n.type === 'COMMENT') {
    return '<strong class="text-slate-100">' + esc(who) + '</strong> commented on your post';
  }
  return 'Activity on your account';
}

function loadNotifications() {
  return api('getNotifications', { limit: 30 }).then(function (res) {
    if (!res.ok) return;
    state.notifications = res.notifications;
    state.notifUnread = res.unreadCount;
    renderBellBadge();
    if (!document.getElementById('notifPanel').classList.contains('hidden')) {
      renderNotifications();
    }
  }).catch(function () { /* non-critical */ });
}

function renderBellBadge() {
  const badge = document.getElementById('bellBadge');
  badge.textContent = state.notifUnread > 99 ? '99+' : state.notifUnread;
  badge.classList.toggle('hidden', state.notifUnread === 0);
}

function renderNotifications() {
  const list = document.getElementById('notifList');
  document.getElementById('markAllBtn').classList.toggle('hidden', state.notifUnread === 0);

  if (!state.notifications.length) {
    list.innerHTML =
      '<div class="px-6 py-10 text-center">' +
        '<div class="w-12 h-12 mx-auto rounded-2xl bg-slate-800/60 border border-white/5 flex items-center justify-center text-slate-500 mb-3">' +
          '<i data-lucide="bell-off" class="w-5 h-5"></i></div>' +
        '<p class="text-xs font-semibold text-slate-300">Nothing yet</p>' +
        '<p class="text-[11px] text-slate-500 mt-1 leading-relaxed">New followers, messages and subscriptions land here.</p>' +
      '</div>';
    icons();
    return;
  }

  list.innerHTML = state.notifications.map(function (n) {
    const style = NOTIF_STYLE[n.type] || NOTIF_STYLE.FOLLOW;

    return '<button onclick="openNotification(\'' + esc(n.id) + '\')" ' +
      'class="w-full flex items-start gap-3 px-4 py-3 text-left border-b border-white/5 last:border-0 ' +
      'hover:bg-white/5 transition-colors ' + (n.read ? '' : 'bg-indigo-500/[0.06]') + '">' +

      (n.actor
        ? avatarWithRosette(n.actor, 'w-9 h-9', 'text-[11px]', 15)
        : '<span class="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 shrink-0">' +
          '<i data-lucide="user" class="w-4 h-4"></i></span>') +

      '<span class="min-w-0 flex-1">' +
        '<span class="block text-[11px] text-slate-400 leading-relaxed">' + notificationText(n) + '</span>' +
        '<span class="flex items-center gap-1.5 mt-1">' +
          '<span class="inline-flex items-center justify-center w-4 h-4 rounded border ' + style.tone + '">' +
            '<i data-lucide="' + style.icon + '" class="w-2.5 h-2.5"></i></span>' +
          '<span class="text-[10px] text-slate-600">' + esc(relTime(n.createdAt)) + ' ago</span>' +
        '</span>' +
      '</span>' +

      (n.read ? '' : '<span class="w-2 h-2 rounded-full bg-indigo-400 shrink-0 mt-1.5"></span>') +
    '</button>';
  }).join('');
  icons();
}

/** Opening a notification marks it read and jumps to whatever it refers to. */
function openNotification(id) {
  const n = state.notifications.filter(function (x) { return x.id === id; })[0];
  if (!n) return;

  document.getElementById('notifPanel').classList.add('hidden');

  if (!n.read) {
    api('markNotificationsRead', [id]).then(function () {
      loadNotifications();
    }).catch(function () { /* non-critical */ });
  }

  if (n.type === 'MESSAGE' && n.actor) {
    openThreadWith(n.actor.id);
  } else if ((n.type === 'LIKE' || n.type === 'COMMENT') && n.targetId) {
    switchTab('feed');
    openComments(n.targetId);
  } else if ((n.type === 'SUB_EXPIRING' || n.type === 'SUB_EXPIRED') && n.actor) {
    viewProfile(n.actor.id);
  } else if (n.type === 'VERIFICATION') {
    switchTab('profile');
  } else if (n.actor) {
    viewProfile(n.actor.id);
  }
}

function markAllNotificationsRead() {
  api('markNotificationsRead', []).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    loadNotifications();
  }).catch(function (err) { toast(err.message, 'error'); });
}

function toggleNotifications() {
  const panel = document.getElementById('notifPanel');
  const opening = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');

  if (opening) {
    renderNotifications();
    loadNotifications();
  }
}

/**
 * Discovery refresh. Ranking shifts as engagement lands, so the feed is pulled
 * again every fifteen minutes. It only fires while the Discover tab is open
 * and the tab is visible, so a backgrounded browser is not burning quota.
 */
const DISCOVERY_REFRESH_MS = 15 * 60 * 1000;

function startDiscoveryRefresh() {
  if (state.feedTimer) clearInterval(state.feedTimer);

  state.feedTimer = setInterval(function () {
    if (state.tab !== 'feed') return;
    if (document.hidden) return;
    loadFeed();
    loadCreators();
    state.lastFeedRefresh = Date.now();
    renderRefreshStamp();
  }, DISCOVERY_REFRESH_MS);
}

function stopDiscoveryRefresh() {
  if (state.feedTimer) clearInterval(state.feedTimer);
  state.feedTimer = null;
}

function renderRefreshStamp() {
  const el = document.getElementById('feedRefreshedAt');
  if (!el) return;
  el.textContent = state.lastFeedRefresh
    ? 'Updated ' + relTime(new Date(state.lastFeedRefresh).toISOString()) + ' ago'
    : '';
}

function refreshDiscoveryNow() {
  loadFeed();
  loadCreators();
  state.lastFeedRefresh = Date.now();
  renderRefreshStamp();
  toast('Discovery refreshed.');
}

/** Background poll, slower than the chat poll to stay well inside quotas. */
function startNotificationPolling() {
  if (state.notifTimer) clearInterval(state.notifTimer);
  state.notifTimer = setInterval(loadNotifications, 45000);
}

function stopNotificationPolling() {
  if (state.notifTimer) clearInterval(state.notifTimer);
  state.notifTimer = null;
}

// ------------------------------------------------------- public share page
/**
 * The signed-out view behind a share link. Everything it needs was injected
 * server-side, so it renders with no session and no round trip.
 */
function renderSharePage(shared) {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appShell').classList.add('hidden');
  document.getElementById('shareScreen').classList.remove('hidden');

  const appUrl = safeUrl(shared.appUrl) || '#';
  document.getElementById('shareBrand').href = appUrl;
  const body = document.getElementById('shareBody');

  if (!shared.found) {
    body.innerHTML =
      '<div class="bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center fade-up">' +
        '<div class="w-14 h-14 mx-auto rounded-2xl bg-slate-800/60 border border-white/5 flex items-center justify-center text-slate-500 mb-4">' +
          '<i data-lucide="link-2-off" class="w-6 h-6"></i></div>' +
        '<h1 class="text-lg font-bold text-white">This post is not available</h1>' +
        '<p class="text-xs text-slate-500 mt-2 leading-relaxed">It may have been removed, or the link may be wrong.</p>' +
        '<a href="' + esc(appUrl) + '" target="_blank" rel="noopener" ' +
          'class="mt-6 inline-block px-6 py-3 btn-primary rounded-2xl text-sm font-bold">Explore VibeStar</a>' +
      '</div>';
    icons();
    return;
  }

  const post = shared.post;
  const author = post.author;
  const media = safeUrl(post.mediaUrl);

  body.innerHTML =
    '<article class="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl fade-up">' +
      '<div class="flex items-center justify-between p-4 border-b border-slate-800/60">' +
        '<div class="flex items-center gap-3 min-w-0">' +
          avatarWithRosette(author, 'w-11 h-11', 'text-sm', 20) +
          '<div class="min-w-0">' +
            '<div class="flex items-center gap-1 font-semibold text-sm text-slate-100">' +
              '<span class="truncate">' + esc(author.fullName) + '</span>' + badgeHtml(author, 'w-3.5 h-3.5') +
            '</div>' +
            '<p class="text-xs text-slate-500 truncate">@' + esc(author.username) +
              (author.category ? ' · ' + esc(author.category) : '') + '</p>' +
          '</div>' +
        '</div>' +
        (shared.expired
          ? '<span class="text-[10px] px-2.5 py-1 bg-slate-800 text-slate-400 border border-white/10 rounded-full font-semibold shrink-0">ARCHIVED</span>'
          : '<span class="text-[11px] px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-medium shrink-0">' +
            post.daysLeft + 'd left</span>') +
      '</div>' +

      (post.caption
        ? '<p class="p-4 text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">' + esc(post.caption) + '</p>'
        : '') +

      mediaHtml(post, 'w-full max-h-[26rem] object-cover bg-black') +

      (shared.expired
        ? '<div class="m-4 p-4 rounded-2xl bg-slate-800/40 border border-white/5 text-center">' +
            '<i data-lucide="hourglass" class="w-5 h-5 text-slate-500 mx-auto mb-2"></i>' +
            '<p class="text-xs text-slate-400 leading-relaxed">This post finished its 30-day run, so the ' +
            'media is gone. That is the point — on VibeStar nothing follows you forever.</p>' +
          '</div>'
        : '') +

      '<div class="px-4 py-3 border-t border-slate-800/60 flex items-center gap-5 text-slate-400">' +
        '<span class="flex items-center gap-1.5"><i data-lucide="heart" class="w-4 h-4"></i>' +
          '<span class="text-xs tabular-nums">' + (post.likeCount || 0) + '</span></span>' +
        '<span class="flex items-center gap-1.5"><i data-lucide="message-circle" class="w-4 h-4"></i>' +
          '<span class="text-xs tabular-nums">' + (post.commentCount || 0) + '</span></span>' +
      '</div>' +
      '<div class="p-4 border-t border-slate-800/60 space-y-3">' +
        '<a href="' + esc(appUrl) + '" target="_blank" rel="noopener" ' +
          'class="block w-full py-3 btn-primary rounded-2xl text-sm font-bold text-center">' +
          (author.role === 'CELEBRITY'
            ? 'Follow ' + esc(author.fullName.split(' ')[0]) + ' on VibeStar'
            : 'See more on VibeStar') + '</a>' +
        (author.role === 'CELEBRITY' && author.monthlyPrice
          ? '<p class="text-[11px] text-slate-500 text-center">Following is free · private chat from ₹' +
            esc(author.monthlyPrice) + '/month</p>'
          : '') +
      '</div>' +
    '</article>' +

    '<div class="mt-4 flex items-center justify-center gap-2">' +
      shareTargetsHtml(shared.shareUrl, post) +
    '</div>' +
    '<p class="text-[10px] text-slate-600 text-center mt-6">Posts on VibeStar expire after 30 days.</p>';

  icons();
}

/** Share destinations. Built from the canonical URL the server generated. */
function shareTargetsHtml(shareUrl, post) {
  const url = encodeURIComponent(shareUrl || '');
  const author = post && post.author ? post.author.fullName : '';
  const text = encodeURIComponent(
    (post && post.caption ? post.caption.slice(0, 90) : 'Seen on VibeStar') +
    (author ? ' — ' + author : ''));

  const targets = [
    { label: 'WhatsApp', icon: 'message-circle', href: 'https://wa.me/?text=' + text + '%20' + url },
    { label: 'X', icon: 'twitter', href: 'https://twitter.com/intent/tweet?text=' + text + '&url=' + url },
    { label: 'Facebook', icon: 'facebook', href: 'https://www.facebook.com/sharer/sharer.php?u=' + url },
    { label: 'Telegram', icon: 'send', href: 'https://t.me/share/url?url=' + url + '&text=' + text }
  ];

  return targets.map(function (t) {
    return '<a href="' + esc(t.href) + '" target="_blank" rel="noopener" title="' + esc(t.label) + '" ' +
      'class="w-10 h-10 rounded-xl bg-slate-800/70 border border-white/10 hover:bg-slate-700 ' +
      'flex items-center justify-center text-slate-300 transition-colors">' +
      '<i data-lucide="' + t.icon + '" class="w-4 h-4"></i></a>';
  }).join('') +
  '<button onclick="copyShareUrl(\'' + esc(shareUrl || '') + '\')" title="Copy link" ' +
    'class="w-10 h-10 rounded-xl bg-slate-800/70 border border-white/10 hover:bg-slate-700 ' +
    'flex items-center justify-center text-slate-300 transition-colors">' +
    '<i data-lucide="link" class="w-4 h-4"></i></button>';
}

function copyShareUrl(url) {
  if (!url) return toast('No share link available yet.', 'error');

  const done = function () { toast('Link copied.'); };
  const fallback = function () {
    // clipboard API needs a secure context, which the Apps Script iframe
    // does not always provide; a hidden textarea always works.
    const field = document.createElement('textarea');
    field.value = url;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { toast('Copy failed — select the link manually.', 'error'); }
    document.body.removeChild(field);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(fallback);
  } else {
    fallback();
  }
}

/** Share sheet for a post inside the app. */
function openShareModal(postId) {
  api('getShareLink', postId).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');

    const post = (state.posts || []).filter(function (p) { return p.id === postId; })[0] || {};
    const body = document.getElementById('shareModalBody');

    body.innerHTML =
      '<div class="flex items-center gap-2 p-2.5 bg-slate-800/70 border border-white/10 rounded-xl">' +
        '<i data-lucide="link" class="w-3.5 h-3.5 text-slate-500 shrink-0"></i>' +
        '<input readonly value="' + esc(res.url) + '" onclick="this.select()" ' +
          'class="flex-1 bg-transparent border-0 outline-none text-[11px] text-slate-300 font-mono" />' +
      '</div>' +
      '<button onclick="copyShareUrl(\'' + esc(res.url) + '\')" ' +
        'class="w-full mt-3 py-2.5 btn-primary rounded-xl text-xs font-bold transition-all">Copy link</button>' +
      '<div class="flex items-center justify-center gap-2 mt-3">' +
        shareTargetsHtml(res.url, post) +
      '</div>' +
      '<div class="mt-4 pt-3 border-t border-slate-800 space-y-1.5">' +
        '<p class="text-[11px] text-slate-400 flex items-center gap-1.5">' +
          '<i data-lucide="eye" class="w-3.5 h-3.5 text-indigo-400"></i>' +
          Number(res.shareViews).toLocaleString() + ' view' + (res.shareViews === 1 ? '' : 's') +
          ' from shared links</p>' +
        (res.previewsConfigured
          ? '<p class="text-[10px] text-emerald-400 flex items-start gap-1.5">' +
            '<i data-lucide="circle-check" class="w-3 h-3 shrink-0 mt-0.5"></i>' +
            'Rich image previews are configured.</p>'
          : '<p class="text-[10px] text-amber-400 flex items-start gap-1.5">' +
            '<i data-lucide="triangle-alert" class="w-3 h-3 shrink-0 mt-0.5"></i>' +
            'The link works, but WhatsApp and X will not show an image card until the ' +
            'preview worker is deployed and SHARE_BASE_URL is set.</p>') +
      '</div>';

    document.getElementById('shareModal').classList.remove('hidden');
    icons();
  }).catch(function (err) { toast(err.message, 'error'); });
}

function closeShareModal() {
  document.getElementById('shareModal').classList.add('hidden');
}

// ----------------------------------------------------------- chat themes
/** Hex-only guard: colours come from the server, but never trust them into CSS. */
function safeHex(value) {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(value || '')) ? String(value) : '#6366f1';
}

function loadChatThemes() {
  return api('getChatThemes').then(function (res) {
    if (!res.ok) return;
    state.themes = res.themes;
    state.currentTheme = res.current;
    renderThemeSwatches();
    applyChatTheme(res.current);
  }).catch(function () { /* non-critical */ });
}

function applyChatTheme(key) {
  const theme = (state.themes || []).filter(function (t) { return t.key === key; })[0];
  const pane = document.getElementById('threadPane');
  if (!theme || !pane) return;

  state.currentTheme = key;
  pane.style.setProperty('--own-from', safeHex(theme.ownFrom));
  pane.style.setProperty('--own-to', safeHex(theme.ownTo));
  pane.style.setProperty('--peer-bg', safeHex(theme.peerBg));
  pane.style.setProperty('--canvas', safeHex(theme.canvas));
  pane.style.setProperty('--accent', safeHex(theme.accent));
  renderThemeSwatches();
}

function renderThemeSwatches() {
  const host = document.getElementById('themeSwatches');
  if (!host || !state.themes) return;

  host.innerHTML = state.themes.map(function (t) {
    const on = state.currentTheme === t.key;
    return '<button onclick="chooseChatTheme(\'' + esc(t.key) + '\')" title="' + esc(t.label) + '" ' +
      'aria-pressed="' + (on ? 'true' : 'false') + '" ' +
      'class="theme-swatch h-9 rounded-xl border border-white/10" ' +
      'style="--accent:' + esc(safeHex(t.accent)) + ';background:linear-gradient(135deg,' +
        esc(safeHex(t.ownFrom)) + ',' + esc(safeHex(t.ownTo)) + ')"></button>';
  }).join('');
}

function chooseChatTheme(key) {
  applyChatTheme(key);   // optimistic, so the swap feels instant
  document.getElementById('themePicker').classList.add('hidden');

  api('setChatTheme', key).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    toast(res.message);
  }).catch(function (err) { toast(err.message, 'error'); });
}

function toggleThemePicker() {
  document.getElementById('themePicker').classList.toggle('hidden');
}

// --------------------------------------------------------------- follows
/**
 * Following is free and open to everyone. It is not a subscription: it does
 * not unlock private chat, which still requires a paid subscription.
 */
function toggleFollow(userId, currentlyFollowing) {
  const fn = currentlyFollowing ? 'unfollowUser' : 'followUser';

  api(fn, userId).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    toast(res.message);
    loadCreators();
    loadFeed();
    if (state.tab === 'profile') viewProfile(state.profileId || userId);
  }).catch(function (err) { toast(err.message, 'error'); });
}

function followButtonHtml(user, sizeClasses) {
  if (!user || user.id === state.user.id) return '';
  const on = !!user.viewerFollows;

  return '<button onclick="toggleFollow(\'' + esc(user.id) + '\', ' + (on ? 'true' : 'false') + ')" ' +
    'class="' + (sizeClasses || 'px-3 py-2 text-[11px]') + ' rounded-xl font-semibold transition-colors ' +
    (on ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-white/5'
        : 'bg-slate-100 text-slate-950 hover:bg-white') + '">' +
    (on ? 'Following' : 'Follow') + '</button>';
}

function openFollowList(userId, type) {
  api('getFollowList', userId, type).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    renderFollowModal(res, type);
  }).catch(function (err) { toast(err.message, 'error'); });
}

function renderFollowModal(data, type) {
  const modal = document.getElementById('followModal');
  const title = type === 'FOLLOWING' ? 'Following' : 'Followers';

  document.getElementById('followModalTitle').textContent = title + ' · ' + data.total;
  document.getElementById('followModalBody').innerHTML = data.people.length
    ? data.people.map(function (person) {
        return '<div class="flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-white/5 transition-colors">' +
          '<button onclick="closeFollowModal();viewProfile(\'' + esc(person.id) + '\')" class="flex items-center gap-2.5 min-w-0 flex-1 text-left">' +
            avatarWithRosette(person, 'w-9 h-9', 'text-[11px]', 16) +
            '<span class="min-w-0">' +
              '<span class="flex items-center gap-1 text-xs font-semibold text-slate-100 truncate">' +
                esc(person.fullName) + badgeHtml(person, 'w-3 h-3') + '</span>' +
              '<span class="block text-[10px] text-slate-500 truncate">@' + esc(person.username) + '</span>' +
            '</span>' +
          '</button>' +
          followButtonHtml(person, 'px-3 py-1.5 text-[10px]') +
        '</div>';
      }).join('')
    : '<p class="text-xs text-slate-500 text-center py-10">Nobody here yet.</p>';

  modal.classList.remove('hidden');
  icons();
}

function closeFollowModal() {
  document.getElementById('followModal').classList.add('hidden');
}

// -------------------------------------------------------------- payments
function loadPaymentConfig() {
  return api('getPaymentConfig').then(function (res) {
    if (res.ok) state.payment = res;
    return state.payment;
  }).catch(function () { return state.payment; });
}

/**
 * Opens Razorpay Checkout, then hands the result to the server. Nothing is
 * granted here: the server verifies the signature and re-checks the payment
 * with Razorpay before activating anything.
 */
function startCheckout(purpose, targetId, amountRupees) {
  if (typeof Razorpay === 'undefined') {
    return toast('Razorpay Checkout could not load. Check your connection.', 'error');
  }

  api('createPaymentOrder', purpose, targetId || '', amountRupees || '')
    .then(function (order) {
    if (!order.ok) return toast(order.error, 'error');

    const checkout = new Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: 'VibeStar',
      description: order.description,
      prefill: order.prefill,
      theme: { color: '#6366f1' },
      handler: function (response) {
        toast('Payment received, confirming…');
        api('confirmPayment', {
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature
        }).then(function (res) {
          if (!res.ok) return toast(res.error, 'error');
          toast(res.message);
          afterPurchase(purpose, targetId);
        }).catch(function (err) { toast(err.message, 'error'); });
      },
      modal: {
        ondismiss: function () {
          // The order stays CREATED. If the payment did complete, the webhook
          // settles it server-side regardless of this window closing.
          toast('Checkout closed before payment completed.', 'error');
        }
      }
    });

    checkout.on('payment.failed', function (res) {
      toast(res && res.error && res.error.description ? res.error.description : 'Payment failed.', 'error');
    });

    checkout.open();
  }).catch(function (err) { toast(err.message, 'error'); });
}

function afterPurchase(purpose, targetId) {
  loadFeed();
  loadCreators();
  loadConversations();
  loadNotifications();

  if (purpose === 'TIP') {
    if (state.tab === 'profile') viewProfile(state.profileId || targetId);
    return;
  }

  if (purpose === 'SUBSCRIPTION') {
    if (state.activePeer && state.activePeer.id === targetId) openThreadWith(targetId);
    if (state.tab === 'profile') viewProfile(targetId);
    return;
  }

  // Verification changes our own badge, so refresh the session user.
  api('resumeSession').then(function (res) {
    if (res.ok) {
      state.user = res.user;
      document.getElementById('headerAvatar').innerHTML =
        avatarWithRosette(res.user, 'w-7 h-7', 'text-[10px]', 14);
    }
    if (state.tab === 'profile') viewProfile(state.user.id);
  }).catch(function () { /* non-critical */ });
}

/** One-line honesty about which mode is live, shown next to any pay button. */
function paymentModeNotice() {
  if (state.payment.mode === 'RAZORPAY') {
    return state.payment.live ? '' :
      '<p class="text-[10px] text-amber-400 mt-2 flex items-start gap-1.5">' +
      '<i data-lucide="flask-conical" class="w-3 h-3 shrink-0 mt-0.5"></i>' +
      'Razorpay test mode — use a test card, no real money moves.</p>';
  }
  return '<p class="text-[10px] text-amber-400 mt-2 flex items-start gap-1.5">' +
    '<i data-lucide="triangle-alert" class="w-3 h-3 shrink-0 mt-0.5"></i>' +
    'Demo mode: no gateway configured, so this activates without payment.</p>';
}

// ------------------------------------------------------------------- tips
const TIP_PRESETS = [50, 100, 250, 500];

function openTipModal(creatorId, creatorName) {
  if (state.payment.mode !== 'RAZORPAY') {
    return toast('Connect Razorpay to accept tips. Demo mode cannot take money.', 'error');
  }

  state.tipTarget = { id: creatorId, name: creatorName };
  document.getElementById('tipModalName').textContent = 'Tip ' + creatorName;
  document.getElementById('tipPresets').innerHTML = TIP_PRESETS.map(function (amount) {
    return '<button type="button" onclick="setTipAmount(' + amount + ')" ' +
      'class="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold transition-colors">₹' +
      amount + '</button>';
  }).join('');
  document.getElementById('tipAmount').value = '';
  hide('tipError');
  document.getElementById('tipModal').classList.remove('hidden');
  icons();
}

function tipActivePeer() {
  if (!state.activePeer) return;
  // Only the fan side tips; a creator tipping their own subscriber makes no sense.
  if (state.activePeer.role !== 'CELEBRITY') {
    return toast('Tips go to creators.', 'error');
  }
  openTipModal(state.activePeer.id, state.activePeer.fullName);
}

function setTipAmount(amount) {
  document.getElementById('tipAmount').value = amount;
}

function closeTipModal() {
  document.getElementById('tipModal').classList.add('hidden');
}

function sendTip() {
  const amount = Number(document.getElementById('tipAmount').value);
  if (!isFinite(amount) || amount < 10 || amount > 100000) {
    return show('tipError', 'Enter an amount between ₹10 and ₹100000.');
  }
  if (!state.tipTarget) return;

  closeTipModal();
  startCheckout('TIP', state.tipTarget.id, amount);
}

// -------------------------------------------------------- creator earnings
function loadEarnings() {
  api('getCreatorEarnings').then(function (res) {
    if (!res.ok) return;
    renderEarningsCard(res);
  }).catch(function () { /* non-critical */ });
}

function renderEarningsCard(data) {
  const slot = document.getElementById('earningsSlot');
  if (!slot) return;

  const money = function (v) { return '₹' + Number(v || 0).toLocaleString('en-IN'); };

  slot.innerHTML =
    '<div class="mt-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 fade-up">' +
      '<div class="flex items-center justify-between mb-4">' +
        '<h3 class="text-sm font-bold text-white">Earnings</h3>' +
        '<span class="text-[10px] text-slate-500">' + data.commissionPercent + '% platform fee</span>' +
      '</div>' +

      '<div class="grid grid-cols-3 gap-2 text-center pb-4 border-b border-slate-800">' +
        '<div><strong class="block text-white text-base">' + esc(money(data.gross)) + '</strong>' +
          '<span class="text-[10px] text-slate-500">Gross</span></div>' +
        '<div><strong class="block text-slate-400 text-base">−' + esc(money(data.commission)) + '</strong>' +
          '<span class="text-[10px] text-slate-500">Fee</span></div>' +
        '<div><strong class="block text-emerald-400 text-base">' + esc(money(data.net)) + '</strong>' +
          '<span class="text-[10px] text-slate-500">Yours</span></div>' +
      '</div>' +

      '<div class="grid grid-cols-2 gap-3 pt-4 text-[11px]">' +
        '<div class="p-3 rounded-xl bg-slate-800/40">' +
          '<p class="text-slate-500">Subscriptions</p>' +
          '<p class="text-white font-bold mt-0.5">' + esc(money(data.subscriptions.net)) + '</p>' +
          '<p class="text-[10px] text-slate-600">' + data.subscriptions.count + ' payment' +
            (data.subscriptions.count === 1 ? '' : 's') + '</p></div>' +
        '<div class="p-3 rounded-xl bg-slate-800/40">' +
          '<p class="text-slate-500">Tips</p>' +
          '<p class="text-white font-bold mt-0.5">' + esc(money(data.tips.net)) + '</p>' +
          '<p class="text-[10px] text-slate-600">' + data.tips.count + ' tip' +
            (data.tips.count === 1 ? '' : 's') + '</p></div>' +
      '</div>' +

      (data.net > 0 && !data.payoutsConfigured
        ? '<p class="text-[10px] text-amber-400 mt-3 flex items-start gap-1.5">' +
          '<i data-lucide="triangle-alert" class="w-3 h-3 shrink-0 mt-0.5"></i>' +
          'No payout method is connected yet, so this balance has not been transferred.</p>'
        : '') +
    '</div>';
  icons();
}

// ---------------------------------------------------------- subscriptions
function subscribeTo(celebrityId) {
  // With Razorpay configured, every activation goes through checkout — the
  // free-grant endpoint is refused server-side in that mode regardless.
  if (state.payment.mode === 'RAZORPAY') {
    return startCheckout('SUBSCRIPTION', celebrityId);
  }

  api('processSubscription', celebrityId).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    toast(res.message);
    afterPurchase('SUBSCRIPTION', celebrityId);
  }).catch(function (err) { toast(err.message, 'error'); });
}

function subscribeToActivePeer() {
  if (state.activePeer) subscribeTo(state.activePeer.id);
}

function cancelSub(celebrityId) {
  if (!confirm('Cancel this subscription? You will lose access to the private thread.')) return;
  api('cancelSubscription', celebrityId).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    toast(res.message);
    loadFeed();
    loadCreators();
    loadConversations();
    viewProfile(celebrityId);
  }).catch(function (err) { toast(err.message, 'error'); });
}

// ------------------------------------------------------------ conversations
function loadConversations() {
  api('getConversations').then(function (res) {
    if (!res.ok) return;
    state.conversations = res.conversations;
    renderConversations();
    renderUnreadBadge();
  }).catch(function () { /* handled */ });
}

function renderUnreadBadge() {
  const total = state.conversations.reduce(function (sum, c) { return sum + c.unreadCount; }, 0);
  const badge = document.getElementById('navUnread');
  badge.textContent = total > 99 ? '99+' : total;
  badge.classList.toggle('hidden', total === 0);
}

function renderConversations() {
  const list = document.getElementById('convList');

  if (!state.conversations.length) {
    list.innerHTML = '<p class="px-3 py-8 text-[11px] text-slate-500 text-center leading-relaxed">' +
      (state.user.role === 'CELEBRITY'
        ? 'No subscribers yet. Threads appear here once someone subscribes.'
        : 'Subscribe to a creator to open a private thread.') + '</p>';
    return;
  }

  list.innerHTML = state.conversations.map(function (c) {
    const active = state.activePeer && state.activePeer.id === c.peer.id;
    const preview = c.lastMessage
      ? (c.lastMessage.fromMe ? 'You: ' : '') + c.lastMessage.content
      : 'No messages yet';

    return '' +
      '<button onclick="openThreadWith(\'' + esc(c.peer.id) + '\')" ' +
        'class="w-full flex items-center gap-2.5 p-2.5 rounded-xl text-left transition-all ' +
        (active ? 'bg-indigo-500/15 border border-indigo-400/30' : 'border border-transparent hover:bg-white/5') + '">' +
        avatarHtml(c.peer, 'w-9 h-9', 'text-[11px]') +
        '<span class="min-w-0 flex-1">' +
          '<span class="flex items-center gap-1">' +
            '<span class="text-xs font-semibold text-slate-100 truncate">' + esc(c.peer.fullName) + '</span>' +
            badgeHtml(c.peer, 'w-3 h-3') +
            '<span class="ml-auto text-[10px] text-slate-500 shrink-0">' + esc(relTime(c.lastActivityAt)) + '</span>' +
          '</span>' +
          '<span class="block text-[10px] text-slate-500 truncate mt-0.5">' + esc(preview) + '</span>' +
        '</span>' +
        (c.unreadCount
          ? '<span class="min-w-4 h-4 px-1 rounded-full bg-indigo-500 text-white text-[9px] font-bold flex items-center justify-center shrink-0">' + c.unreadCount + '</span>'
          : '') +
      '</button>';
  }).join('');
  icons();
}

// ------------------------------------------------------------------ thread
function openThreadWith(peerId) {
  switchTabIfNeeded('chat');

  api('getChatMessages', peerId).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');

    state.activePeer = res.peer;
    state.authorized = res.authorized;
    state.serverMessages = res.messages || [];
    state.pendingMessages = [];

    document.getElementById('threadEmpty').classList.add('hidden');
    document.getElementById('threadPane').classList.remove('hidden');

    document.getElementById('threadAvatar').innerHTML =
      avatarWithRosette(res.peer, 'w-11 h-11', 'text-sm', 20);
    document.getElementById('threadName').textContent = res.peer.fullName;
    document.getElementById('threadVerified').innerHTML = badgeHtml(res.peer, 'w-4 h-4');
    document.getElementById('threadPresence').textContent =
      res.peer.role === 'CELEBRITY' ? 'Exclusive paid chat' : 'Subscriber';

    document.getElementById('lockTitle').textContent = 'Direct line to ' + res.peer.fullName.split(' ')[0];
    document.getElementById('lockCta').textContent = 'Unlock for ₹' + res.peer.monthlyPrice;
    document.getElementById('subscribeBtnLabel').textContent = 'Subscribe ₹' + res.peer.monthlyPrice;

    renderSubscriptionState(res.authorized, res.subscriptionExpiresAt);

    const overlay = document.getElementById('chatLockOverlay');
    overlay.classList.toggle('hidden', res.authorized);
    overlay.classList.toggle('flex', !res.authorized);

    renderThread();
    renderConversations();
    updateComposerState();
    loadConversations();
    loadNotifications();
    icons();
  }).catch(function (err) { toast(err.message, 'error'); });
}

function switchTabIfNeeded(tab) {
  if (state.tab !== tab) switchTab(tab);
}

function renderSubscriptionState(authorized, expiresAt) {
  const pill = document.getElementById('chatStatusPill');
  const btn = document.getElementById('subscribeBtn');
  const iAmCreatorSide = state.user.role === 'CELEBRITY';

  if (authorized) {
    btn.classList.add('hidden');
    btn.classList.remove('flex');
    pill.classList.remove('hidden');
    pill.classList.add('flex');

    let label = 'Subscribed';
    let urgent = false;
    if (expiresAt) {
      const left = daysUntil(expiresAt);
      urgent = !iAmCreatorSide && left <= 5;
      label = iAmCreatorSide
        ? 'Active · ' + left + 'd left'
        : (urgent ? 'Ends in ' + left + 'd' : 'Active · ' + left + 'd left');
    }
    document.getElementById('chatStatusText').textContent = label;

    // Nudge the fan while there is still time to renew.
    pill.className = urgent
      ? 'flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-300'
      : 'flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300';

    if (urgent) {
      btn.classList.remove('hidden');
      btn.classList.add('flex');
      document.getElementById('subscribeBtnLabel').textContent = 'Renew';
    }
  } else {
    pill.classList.add('hidden');
    pill.classList.remove('flex');
    // A creator cannot subscribe on the fan's behalf, so no CTA on that side.
    btn.classList.toggle('hidden', iAmCreatorSide);
    btn.classList.toggle('flex', !iAmCreatorSide);
  }
}

function renderThread() {
  const box = document.getElementById('messagesContainer');
  const all = state.serverMessages.concat(state.pendingMessages);

  if (!all.length) {
    box.innerHTML = '<div class="h-full flex flex-col items-center justify-center text-center px-8">' +
      '<div class="w-14 h-14 rounded-2xl bg-slate-800/60 border border-white/5 flex items-center justify-center text-slate-500 mb-3">' +
        '<i data-lucide="sparkles" class="w-6 h-6"></i></div>' +
      '<p class="text-sm font-semibold text-slate-300">This is the beginning</p>' +
      '<p class="text-xs text-slate-500 mt-1 max-w-[15rem] leading-relaxed">' +
        'Say hello — your messages here stay between the two of you.</p></div>';
    icons();
    return;
  }

  let html = '';
  let lastDayKey = null;

  all.forEach(function (msg, i) {
    const at = new Date(msg.createdAt);
    const dayKey = at.toDateString();

    if (dayKey !== lastDayKey) {
      html += '<div class="flex items-center gap-3 my-4">' +
        '<div class="flex-1 h-px bg-white/5"></div>' +
        '<span class="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">' + esc(dayLabel(at)) + '</span>' +
        '<div class="flex-1 h-px bg-white/5"></div></div>';
      lastDayKey = dayKey;
    }

    const prev = all[i - 1];
    const next = all[i + 1];
    const isMe = msg.senderId === state.user.id;

    const groupedWithPrev = prev && prev.senderId === msg.senderId &&
      new Date(prev.createdAt).toDateString() === dayKey &&
      (at - new Date(prev.createdAt)) < GROUP_WINDOW_MS;

    const groupedWithNext = next && next.senderId === msg.senderId &&
      new Date(next.createdAt).toDateString() === dayKey &&
      (new Date(next.createdAt) - at) < GROUP_WINDOW_MS;

    let corners = 'rounded-2xl ';
    if (isMe) {
      if (groupedWithPrev) corners += 'rounded-tr-md ';
      if (groupedWithNext) corners += 'rounded-br-md ';
    } else {
      if (groupedWithPrev) corners += 'rounded-tl-md ';
      if (groupedWithNext) corners += 'rounded-bl-md ';
    }

    const avatar = isMe ? '' : (groupedWithNext
      ? '<div class="w-7 shrink-0"></div>'
      : '<span class="self-end">' + avatarHtml(state.activePeer, 'w-7 h-7', 'text-[10px]') + '</span>');

    // One tick = stored on the server, two = the other person opened the thread.
    let receipt = '';
    if (isMe) {
      receipt = msg.pending
        ? '<i data-lucide="clock" class="w-3 h-3 text-slate-500"></i>'
        : (msg.readByPeer
            ? '<i data-lucide="check-check" class="w-3.5 h-3.5 text-indigo-400"></i>'
            : '<i data-lucide="check" class="w-3 h-3 text-slate-500"></i>');
    }

    const meta = groupedWithNext ? '' :
      '<div class="flex items-center gap-1 mt-1 px-1 ' + (isMe ? 'justify-end' : 'justify-start') + '">' +
        '<span class="text-[10px] text-slate-500 tabular-nums">' + esc(fmtTime(at)) + '</span>' + receipt +
      '</div>';

    html += '<div class="msg-in flex items-end gap-2 ' + (isMe ? 'justify-end' : 'justify-start') + ' ' +
      (groupedWithPrev ? 'mt-0.5' : 'mt-2.5') + '">' + avatar +
      '<div class="flex flex-col ' + (isMe ? 'items-end' : 'items-start') + ' max-w-[80%]">' +
        '<div class="bubble ' + corners + (isMe ? 'bubble-me' : 'bubble-them') +
          (msg.pending ? ' bubble-pending' : '') + '">' + esc(msg.content) + '</div>' + meta +
      '</div></div>';
  });

  box.innerHTML = html;
  icons();
  scrollThreadToBottom(true);
}

function scrollThreadToBottom(smooth) {
  const box = document.getElementById('messagesContainer');
  box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

/** Light polling so an incoming reply shows up without a manual refresh. */
function startThreadPolling() {
  stopThreadPolling();
  state.pollTimer = setInterval(function () {
    if (!state.activePeer || !state.authorized) return;
    if (state.pendingMessages.length) return; // don't race an in-flight send

    api('getChatMessages', state.activePeer.id).then(function (res) {
      if (!res.ok || !res.authorized) return;
      const changed = res.messages.length !== state.serverMessages.length ||
        res.messages.some(function (m, i) {
          const known = state.serverMessages[i];
          return !known || known.id !== m.id || known.readByPeer !== m.readByPeer;
        });
      if (!changed) return;
      state.serverMessages = res.messages;
      renderThread();
      loadConversations();
    }).catch(function () { /* transient */ });
  }, 12000);
}

function stopThreadPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

// ---------------------------------------------------------------- composer
function handleComposerInput() {
  const input = document.getElementById('chatInput');
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 112) + 'px';
  updateComposerState();
}

function updateComposerState() {
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const count = document.getElementById('charCount');

  sendBtn.disabled = !(input.value.trim().length && state.authorized && state.activePeer);
  count.textContent = input.value.length > 700 ? input.value.length + '/1000' : '';
}

function handleComposerKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSendMessage(e);
  }
}

function handleSendMessage(e) {
  if (e && e.preventDefault) e.preventDefault();

  const input = document.getElementById('chatInput');
  const content = input.value.trim();
  if (!content || !state.activePeer || !state.authorized) return;

  const peerId = state.activePeer.id;

  state.pendingMessages.push({
    senderId: state.user.id,
    content: content,
    createdAt: new Date().toISOString(),
    pending: true
  });

  input.value = '';
  input.style.height = 'auto';
  document.getElementById('emojiPanel').classList.add('hidden');
  updateComposerState();
  renderThread();
  document.getElementById('typingStrip').classList.remove('hidden');

  api('sendMessage', peerId, content).then(function (res) {
    document.getElementById('typingStrip').classList.add('hidden');
    state.pendingMessages = [];

    if (!res.ok) {
      renderThread();
      return toast(res.error, 'error');
    }
    state.serverMessages.push(res.message);
    renderThread();
    loadConversations();
  }).catch(function (err) {
    document.getElementById('typingStrip').classList.add('hidden');
    state.pendingMessages = [];
    renderThread();
    toast(err.message, 'error');
  });
}

function buildEmojiPanel() {
  document.getElementById('emojiPanel').innerHTML = EMOJI.map(function (ch) {
    return '<button type="button" onclick="insertEmoji(\'' + ch + '\')" ' +
      'class="w-8 h-8 rounded-lg text-lg leading-none hover:bg-white/10 active:scale-90 transition-all">' + ch + '</button>';
  }).join('');
}

function toggleEmojiPanel() {
  document.getElementById('emojiPanel').classList.toggle('hidden');
}

function insertEmoji(ch) {
  const input = document.getElementById('chatInput');
  input.value += ch;
  input.focus();
  handleComposerInput();
}

// ----------------------------------------------------------------- profile
function openMyProfile() {
  document.getElementById('userMenu').classList.add('hidden');
  switchTab('profile');
}

function viewProfile(userId) {
  if (!userId) return;
  switchTabIfNeeded('profile');

  state.profileId = userId;
  api('getProfile', userId).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    renderProfile(res.profile);
  }).catch(function (err) { toast(err.message, 'error'); });
}

function renderProfile(profile) {
  const isOwn = profile.isOwnProfile;
  const isCreator = profile.role === 'CELEBRITY';
  const container = document.getElementById('profileContainer');

  const actions = isOwn
    ? '<div class="flex gap-2">' +
        '<button onclick="toggleEditProfile(true)" class="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5">' +
          '<i data-lucide="pencil" class="w-3.5 h-3.5"></i> Edit profile</button>' +
        '<button onclick="toggleSecurity()" class="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold transition-colors flex items-center gap-1.5">' +
          '<i data-lucide="key-round" class="w-3.5 h-3.5"></i> Password</button>' +
      '</div>'
    : '<div class="flex flex-wrap gap-2">' +
        followButtonHtml(profile, 'px-5 py-2.5 text-xs') +
        (isCreator
          ? (profile.viewerIsSubscribed
              ? '<button onclick="openThreadWith(\'' + esc(profile.id) + '\')" class="flex-1 py-2.5 rounded-xl btn-primary text-xs font-bold transition-all flex items-center justify-center gap-1.5">' +
                  '<i data-lucide="message-square" class="w-3.5 h-3.5"></i> Private chat</button>' +
                '<button onclick="cancelSub(\'' + esc(profile.id) + '\')" class="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-rose-500/15 hover:text-rose-300 text-xs font-semibold transition-colors">Cancel</button>'
              : '<button onclick="subscribeTo(\'' + esc(profile.id) + '\')" class="flex-1 py-2.5 rounded-xl btn-primary text-xs font-bold transition-all">' +
                  'Subscribe ₹' + esc(profile.monthlyPrice) + '/mo</button>') +
            '<button onclick="openTipModal(\'' + esc(profile.id) + '\', \'' + esc(profile.fullName.replace(/'/g, "")) + '\')" ' +
              'title="Send a tip" class="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-pink-500/15 hover:text-pink-300 text-xs font-semibold transition-colors flex items-center gap-1.5">' +
              '<i data-lucide="gift" class="w-3.5 h-3.5"></i> Tip</button>'
          : '') +
      '</div>';

  container.innerHTML = '' +
    '<div class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden fade-up">' +
      '<div class="relative h-32 bg-gradient-to-r from-indigo-600/40 via-purple-600/30 to-fuchsia-600/30">' +
        (safeUrl(profile.bannerUrl)
          ? '<img src="' + esc(safeUrl(profile.bannerUrl)) + '" alt="" class="absolute inset-0 w-full h-full object-cover" />'
          : '') +
        (isOwn
          ? '<div class="absolute top-2 right-2 flex gap-1.5">' +
              '<button onclick="pickProfileImage(\'BANNER\')" title="Upload banner" ' +
                'class="w-8 h-8 rounded-full bg-black/60 backdrop-blur text-slate-200 hover:text-white flex items-center justify-center">' +
                '<i data-lucide="image-plus" class="w-3.5 h-3.5"></i></button>' +
              '<button onclick="openCameraFor(\'BANNER\')" title="Capture banner" ' +
                'class="w-8 h-8 rounded-full bg-black/60 backdrop-blur text-slate-200 hover:text-white flex items-center justify-center">' +
                '<i data-lucide="camera" class="w-3.5 h-3.5"></i></button>' +
            '</div>'
          : '') +
      '</div>' +
      '<div class="px-5 pb-5">' +
        '<div class="flex items-end justify-between -mt-10 mb-4">' +
          '<div class="relative p-1 bg-slate-900 rounded-full">' +
            avatarWithRosette(profile, 'w-20 h-20', 'text-xl', 30) +
            (isOwn
              ? '<button onclick="pickProfileImage(\'AVATAR\')" title="Change profile picture" ' +
                'class="absolute -bottom-1 -left-1 w-8 h-8 rounded-full bg-slate-800 border border-white/15 ' +
                'text-slate-200 hover:text-white flex items-center justify-center shadow-lg">' +
                '<i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>'
              : '') +
          '</div>' +
          (isCreator ? '<span class="mb-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-400/25">Creator</span>'
                     : '<span class="mb-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-slate-800 text-slate-400 border border-white/10">Fan</span>') +
        '</div>' +

        '<div class="flex items-center gap-1.5">' +
          '<h2 class="text-xl font-bold text-white tracking-tight">' + esc(profile.fullName) + '</h2>' +
          badgeHtml(profile, 'w-5 h-5') +
        '</div>' +
        '<p class="text-xs text-slate-400 mt-0.5">@' + esc(profile.username) +
          (isCreator ? ' · ' + esc(profile.category || 'Creator') : '') + '</p>' +
        (profile.bio ? '<p class="text-sm text-slate-300 mt-3 leading-relaxed whitespace-pre-wrap">' + esc(profile.bio) + '</p>' : '') +

        '<div class="grid grid-cols-4 gap-2 text-center my-5 py-3 border-y border-slate-800">' +
          '<div><strong class="block text-white text-base">' + profile.stats.posts + '</strong>' +
            '<span class="text-[10px] text-slate-500">Posts</span></div>' +
          '<button onclick="openFollowList(\'' + esc(profile.id) + '\', \'FOLLOWERS\')" class="hover:text-indigo-300 transition-colors">' +
            '<strong class="block text-white text-base">' + Number(profile.stats.followers).toLocaleString() + '</strong>' +
            '<span class="text-[10px] text-slate-500">Followers</span></button>' +
          '<button onclick="openFollowList(\'' + esc(profile.id) + '\', \'FOLLOWING\')" class="hover:text-indigo-300 transition-colors">' +
            '<strong class="block text-white text-base">' + Number(profile.stats.following).toLocaleString() + '</strong>' +
            '<span class="text-[10px] text-slate-500">Following</span></button>' +
          '<div><strong class="block text-white text-base">' + profile.stats.subscribers + '</strong>' +
            '<span class="text-[10px] text-slate-500">Subscribers</span></div>' +
        '</div>' +

        (isCreator && !isOwn
          ? '<p class="text-[11px] text-slate-500 mb-3 flex items-start gap-1.5"><i data-lucide="info" class="w-3.5 h-3.5 shrink-0 mt-0.5"></i> ' +
            '<span>Following is free and public. Subscribing is paid and unlocks a private thread for 30 days.</span></p>'
          : '') +
        actions +
      '</div>' +
    '</div>' +

    (isCreator ? '<div id="gallerySlot" class="mt-4"></div>' : '') +
    (isOwn && isCreator ? '<div id="earningsSlot"></div><div id="verificationSlot"></div>' : '') +
    (isOwn ? editProfileFormHtml(profile) + securityFormHtml() : '') +

    (isCreator && profile.posts.length
      ? '<div class="mt-4"><h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 px-1">' +
          'Active posts · ' + profile.posts.length + '</h3>' +
        '<div class="grid grid-cols-2 gap-3">' + profile.posts.map(function (p) {
          const media = safeUrl(p.mediaUrl);
          return '<div class="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">' +
            (media ? '<img src="' + esc(media) + '" class="w-full h-28 object-cover bg-black" />' : '') +
            '<div class="p-2.5">' +
              '<p class="text-[11px] text-slate-300 line-clamp-2 leading-relaxed">' + esc(p.caption || '—') + '</p>' +
              '<div class="flex items-center gap-2.5 mt-1.5 text-[10px] text-slate-500">' +
                '<span class="flex items-center gap-1"><i data-lucide="heart" class="w-2.5 h-2.5"></i>' +
                  (p.likeCount || 0) + '</span>' +
                '<span class="flex items-center gap-1"><i data-lucide="message-circle" class="w-2.5 h-2.5"></i>' +
                  (p.commentCount || 0) + '</span>' +
              '</div>' +
              '<div class="flex items-center justify-between mt-1">' +
                '<p class="text-[10px] text-amber-400">' + daysUntil(p.expiresAt) + 'd left</p>' +
                '<button onclick="openShareModal(\'' + esc(p.id) + '\')" title="Share" ' +
                  'class="p-1 rounded text-slate-500 hover:text-indigo-300 transition-colors">' +
                  '<i data-lucide="share-2" class="w-3 h-3"></i></button>' +
              '</div>' +
            '</div></div>';
        }).join('') + '</div></div>'
      : '');

  icons();
  if (isCreator) loadGallery(profile.id);
  if (isOwn && isCreator) {
    loadEarnings();
    loadVerification();
  }
}

// ------------------------------------------------------- private gallery
function loadGallery(creatorId) {
  state.galleryCreatorId = creatorId;
  api('getCreatorGallery', creatorId).then(function (res) {
    if (!res.ok) return;
    renderGallery(res);
  }).catch(function () { /* non-critical */ });
}

function renderGallery(data) {
  const slot = document.getElementById('gallerySlot');
  if (!slot) return;

  // Tracked so a bookmark tapped on a gallery tile repaints everywhere at once.
  state.galleryItems = data.items || [];

  if (!data.count && !data.isOwner) {
    slot.innerHTML = '';
    return;
  }

  const header =
    '<div class="flex items-center justify-between mb-3 px-1">' +
      '<h3 class="text-xs font-bold uppercase text-slate-400 flex items-center gap-1.5">' +
        '<i data-lucide="lock" class="w-3.5 h-3.5 text-indigo-400"></i> Private gallery' +
      '</h3>' +
      '<span class="text-[10px] text-slate-500">' + data.count +
        (data.count === 1 ? ' post' : ' posts') + '</span>' +
    '</div>';

  if (!data.count) {
    slot.innerHTML = header + emptyCard('lock',
      'Your private gallery is empty',
      'Publish a post to "Subscribers" and it will live here, visible only to people who pay.');
    icons();
    return;
  }

  if (!data.entitled) {
    // Locked view: the shape of what is behind the wall, none of the substance.
    slot.innerHTML = header +
      '<div class="relative rounded-2xl overflow-hidden border border-slate-800 bg-slate-900">' +
        '<div class="grid grid-cols-3 gap-1 p-1">' +
          data.items.slice(0, 9).map(function (item) {
            return '<div class="aspect-square rounded-lg bg-gradient-to-br from-slate-800 to-slate-900 ' +
              'flex items-center justify-center">' +
              '<i data-lucide="' + (item.type === 'VIDEO' ? 'clapperboard' : 'image') +
              '" class="w-5 h-5 text-slate-700"></i></div>';
          }).join('') +
        '</div>' +

        '<div class="absolute inset-0 backdrop-blur-[3px] bg-slate-950/70 flex flex-col ' +
          'items-center justify-center text-center px-6">' +
          '<div class="w-12 h-12 rounded-2xl bg-indigo-500/15 border border-indigo-400/25 ' +
            'flex items-center justify-center text-indigo-300 mb-3">' +
            '<i data-lucide="lock-keyhole" class="w-5 h-5"></i></div>' +
          '<p class="text-sm font-bold text-white">' + data.count +
            (data.count === 1 ? ' private post' : ' private posts') + '</p>' +
          '<p class="text-[11px] text-slate-400 mt-1 mb-4 max-w-[16rem] leading-relaxed">' +
            'Only ' + esc(data.creator.fullName.split(' ')[0]) + '\u2019s subscribers can open these.</p>' +
          '<button onclick="subscribeTo(\'' + esc(data.creator.id) + '\')" ' +
            'class="px-6 py-3 btn-primary rounded-2xl text-xs font-bold transition-all">' +
            'Subscribe ₹' + esc(data.monthlyPrice) + '/mo to unlock</button>' +
        '</div>' +
      '</div>';
    icons();
    return;
  }

  // Entitled: the real thing.
  slot.innerHTML = header +
    '<div class="grid grid-cols-2 gap-3">' +
      data.items.map(function (post) {
        const media = safeUrl(post.mediaUrl);
        return '<div class="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden fade-up">' +
          (media
            ? (post.type === 'VIDEO'
                ? '<video src="' + esc(media) + '" class="w-full h-32 object-cover bg-black" ' +
                  'controls playsinline preload="metadata"></video>'
                : '<img src="' + esc(media) + '" class="w-full h-32 object-cover bg-black" />')
            : '<div class="w-full h-32 bg-slate-800 flex items-center justify-center text-slate-600">' +
              '<i data-lucide="file-text" class="w-5 h-5"></i></div>') +
          '<div class="p-2.5">' +
            '<p class="text-[11px] text-slate-300 line-clamp-2 leading-relaxed">' +
              esc(post.caption || '—') + '</p>' +
            '<div class="flex items-center justify-between mt-2">' +
              '<span class="text-[10px] text-amber-400">' + daysUntil(post.expiresAt) + 'd left</span>' +
              '<div class="flex items-center gap-2">' +
                '<button onclick="toggleLike(\'' + esc(post.id) + '\')" ' +
                  'class="flex items-center gap-1 text-[10px] ' +
                  (post.viewerLiked ? 'text-rose-400' : 'text-slate-500 hover:text-slate-300') + '">' +
                  '<i data-lucide="heart" class="w-3 h-3"' +
                  (post.viewerLiked ? ' style="fill:#C4636F"' : '') + '></i>' +
                  (post.likeCount || 0) + '</button>' +
                '<button onclick="openComments(\'' + esc(post.id) + '\')" ' +
                  'class="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300">' +
                  '<i data-lucide="message-circle" class="w-3 h-3"></i>' +
                  (post.commentCount || 0) + '</button>' +
                (data.isOwner
                  ? '<button onclick="removePost(\'' + esc(post.id) + '\')" ' +
                    'class="text-slate-600 hover:text-rose-400"><i data-lucide="trash-2" class="w-3 h-3"></i></button>'
                  : '') +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>' +
    (data.isOwner
      ? '<p class="text-[10px] text-slate-600 mt-3 px-1 flex items-start gap-1.5">' +
        '<i data-lucide="info" class="w-3 h-3 shrink-0 mt-0.5"></i>' +
        'Only your active subscribers can open these. Files are served through ' +
        'expiring links, so a copied address will not work for long.</p>'
      : '');
  icons();
}

// ------------------------------------------------------------ verification
function loadVerification() {
  api('getVerificationState').then(function (res) {
    if (!res.ok) return;
    state.verification = res;
    renderVerificationCard(res);
  }).catch(function () { /* handled */ });
}

function tierLadderHtml(config, currentKey, followers) {
  return '<div class="flex gap-1.5 mt-3">' + config.tiers.map(function (t) {
    const reached = followers >= t.min;
    const isCurrent = currentKey === t.key;
    return '<div class="flex-1 text-center">' +
      '<div class="h-1.5 rounded-full mb-1.5" style="background:' +
        (reached ? esc(t.color) : '#1e293b') + '"></div>' +
      '<span class="block text-[9px] font-bold ' + (isCurrent ? '' : 'opacity-60') + '" style="color:' +
        (reached ? esc(t.color) : '#64748b') + '">' + esc(t.label) + '</span>' +
      '<span class="block text-[9px] text-slate-600">' + (t.min / 1000) + 'K</span>' +
    '</div>';
  }).join('') + '</div>';
}

function renderVerificationCard(data) {
  const slot = document.getElementById('verificationSlot');
  if (!slot) return;

  const config = data.config;
  const badge = data.badge;
  let body = '';

  if (data.status === 'APPROVED') {
    const followers = data.verifiedFollowerCount;

    body =
      '<div class="flex items-start justify-between gap-3">' +
        '<div>' +
          '<div class="flex items-center gap-1.5">' +
            (badge
              ? '<span style="color:' + esc(badge.color) + '" class="inline-flex"><i data-lucide="badge-check" class="w-5 h-5"></i></span>' +
                '<span class="text-sm font-bold" style="color:' + esc(badge.color) + '">' + esc(badge.label) + ' badge</span>'
              : '<i data-lucide="badge-check" class="w-5 h-5 text-slate-500"></i>' +
                '<span class="text-sm font-bold text-slate-300">Verified</span>') +
          '</div>' +
          '<p class="text-[11px] text-slate-500 mt-1">' +
            Number(followers).toLocaleString() + ' verified followers' +
            (data.route ? ' · via ' + (data.route === 'PAYMENT' ? 'paid verification' : 'follower count') : '') +
          '</p>' +
        '</div>' +
      '</div>' +

      (badge
        ? (badge.nextTier
            ? '<p class="text-[11px] text-slate-400 mt-3">' +
                Number(badge.nextTier.remaining).toLocaleString() + ' more followers to reach ' +
                '<strong style="color:' + esc(badge.nextTier.color) + '">' + esc(badge.nextTier.label) + '</strong>.</p>'
            : '<p class="text-[11px] text-slate-400 mt-3">Top tier reached.</p>')
        : '<p class="text-[11px] text-amber-400 mt-3 flex items-start gap-1.5">' +
            '<i data-lucide="info" class="w-3.5 h-3.5 shrink-0 mt-0.5"></i>' +
            'Your badge appears once a verified count of ' +
            Number(config.badgeMinFollowers).toLocaleString() + ' followers is reached.</p>') +

      tierLadderHtml(config, badge ? badge.key : null, followers) +
      '<p class="text-[10px] text-slate-600 mt-3 leading-relaxed">' +
        'Follower counts are confirmed by a reviewer, so tier changes are not instant.</p>';

  } else if (data.status === 'PENDING') {
    const req = data.pendingRequest;
    body =
      '<div class="flex items-center gap-2">' +
        '<i data-lucide="clock" class="w-4 h-4 text-amber-400"></i>' +
        '<span class="text-sm font-bold text-white">Under review</span>' +
      '</div>' +
      (req
        ? '<div class="mt-3 space-y-1.5 text-[11px] text-slate-400">' +
            '<p>Route: <span class="text-slate-200">' +
              (req.route === 'PAYMENT' ? 'Paid — ₹' + req.feeAmount : 'Follower count') + '</span></p>' +
            '<p>Platform: <span class="text-slate-200">' + esc(req.platform) + '</span></p>' +
            '<p>Claimed followers: <span class="text-slate-200">' +
              Number(req.claimedFollowerCount).toLocaleString() + '</span></p>' +
            (req.route === 'PAYMENT'
              ? '<p class="text-amber-400">Reviewed once the ₹' + req.feeAmount + ' fee is confirmed.</p>'
              : '') +
          '</div>'
        : '') +
      '<button onclick="withdrawVerification()" class="mt-4 w-full py-2.5 rounded-xl bg-slate-800 hover:bg-rose-500/15 hover:text-rose-300 text-xs font-semibold transition-colors">' +
        'Withdraw request</button>';

  } else {
    const rejected = data.status === 'REJECTED';
    const lastNote = (data.requests || []).filter(function (r) { return r.status === 'REJECTED'; })[0];

    body =
      '<div class="flex items-center gap-2">' +
        '<i data-lucide="' + (rejected ? 'circle-alert' : 'badge-check') + '" class="w-4 h-4 ' +
          (rejected ? 'text-rose-400' : 'text-indigo-400') + '"></i>' +
        '<span class="text-sm font-bold text-white">' +
          (rejected ? 'Verification declined' : 'Get verified') + '</span>' +
      '</div>' +
      (rejected && lastNote && lastNote.note
        ? '<p class="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2 mt-3">' +
            esc(lastNote.note) + '</p>'
        : '') +

      '<p class="text-[11px] text-slate-400 mt-3 leading-relaxed">' +
        'Qualify either way: <strong class="text-slate-200">' +
        Number(config.minFollowersToApply).toLocaleString() + '+ followers</strong> on a social platform, ' +
        'or a one-off <strong class="text-slate-200">₹' + config.fee + '</strong> fee. ' +
        'The badge itself appears at ' + Number(config.badgeMinFollowers).toLocaleString() +
        ' verified followers, and its colour rises with your audience.</p>' +

      tierLadderHtml(config, null, 0) +

      '<div class="grid grid-cols-2 gap-1 p-1 bg-slate-800/60 rounded-xl mt-4">' +
        '<button type="button" id="vrouteFOLLOWERS" onclick="setVerifyRoute(\'FOLLOWERS\')" ' +
          'class="py-2 rounded-lg text-[11px] font-semibold transition-all">' +
          Number(config.minFollowersToApply).toLocaleString() + '+ followers</button>' +
        '<button type="button" id="vroutePAYMENT" onclick="setVerifyRoute(\'PAYMENT\')" ' +
          'class="py-2 rounded-lg text-[11px] font-semibold transition-all">Pay ₹' + config.fee + '</button>' +
      '</div>' +

      '<div class="space-y-3 mt-3">' +
        '<label class="block"><span class="text-[11px] font-semibold text-slate-400 mb-1.5 block">Platform</span>' +
          '<select id="verifyPlatform" class="field">' +
            config.platforms.map(function (p) {
              return '<option value="' + esc(p) + '">' + esc(p.charAt(0) + p.slice(1).toLowerCase()) + '</option>';
            }).join('') +
          '</select></label>' +

        '<label class="block"><span class="text-[11px] font-semibold text-slate-400 mb-1.5 block">Public profile link</span>' +
          '<input id="verifyUrl" class="field" placeholder="https://facebook.com/yourpage" /></label>' +

        '<label class="block"><span class="text-[11px] font-semibold text-slate-400 mb-1.5 block">Follower count</span>' +
          '<input id="verifyFollowers" type="number" min="0" class="field" placeholder="e.g. 8500" /></label>' +

        '<label class="block" id="paymentRefWrap"><span class="text-[11px] font-semibold text-slate-400 mb-1.5 block">' +
          'Payment reference <span class="text-slate-600">(optional)</span></span>' +
          '<input id="verifyPaymentRef" class="field" placeholder="UPI / transaction ID" /></label>' +

        '<p id="verifyError" class="hidden text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2"></p>' +

        '<button onclick="submitVerification()" id="verifyBtn" class="btn-primary w-full py-3 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2">' +
          ((state.verifyRoute || 'FOLLOWERS') === 'PAYMENT' && state.payment.mode === 'RAZORPAY'
            ? 'Pay ₹' + config.fee + ' with Razorpay'
            : 'Submit for review') + '</button>' +

        paymentModeNotice() +

        '<p class="text-[10px] text-slate-600 leading-relaxed">' +
          'On the follower route a reviewer confirms your count before the tick is issued. ' +
          'Paying verifies you straight away — but the coloured badge still waits on ' +
          Number(config.badgeMinFollowers).toLocaleString() + ' confirmed followers, so the fee ' +
          'cannot buy a tier.</p>' +
      '</div>';
  }

  slot.innerHTML = '<div class="mt-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 fade-up">' + body + '</div>';
  icons();
  if (data.status !== 'APPROVED' && data.status !== 'PENDING') setVerifyRoute(state.verifyRoute || 'FOLLOWERS');
}

function setVerifyRoute(route) {
  state.verifyRoute = route;
  const active = 'py-2 rounded-lg text-[11px] font-semibold transition-all bg-slate-700 text-white';
  const idle = 'py-2 rounded-lg text-[11px] font-semibold transition-all text-slate-400 hover:text-white';

  const followersBtn = document.getElementById('vrouteFOLLOWERS');
  const paymentBtn = document.getElementById('vroutePAYMENT');
  if (!followersBtn || !paymentBtn) return;

  followersBtn.className = route === 'FOLLOWERS' ? active : idle;
  paymentBtn.className = route === 'PAYMENT' ? active : idle;

  // The payment reference only makes sense on the DEMO-mode paid route.
  const refWrap = document.getElementById('paymentRefWrap');
  if (refWrap) {
    refWrap.classList.toggle('hidden', route !== 'PAYMENT' || state.payment.mode === 'RAZORPAY');
  }

  // Razorpay mode needs no profile link or claim to take the fee.
  const needsClaim = route === 'FOLLOWERS' || state.payment.mode !== 'RAZORPAY';
  ['verifyPlatform', 'verifyUrl', 'verifyFollowers'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el && el.parentElement) el.parentElement.classList.toggle('hidden', !needsClaim);
  });

  const btn = document.getElementById('verifyBtn');
  if (btn) {
    btn.textContent = route === 'PAYMENT' && state.payment.mode === 'RAZORPAY'
      ? 'Pay ₹' + state.payment.verificationFee + ' with Razorpay'
      : 'Submit for review';
  }
}

function submitVerification() {
  const btn = document.getElementById('verifyBtn');
  hide('verifyError');

  const payload = {
    route: state.verifyRoute || 'FOLLOWERS',
    platform: document.getElementById('verifyPlatform').value,
    profileUrl: document.getElementById('verifyUrl').value.trim(),
    claimedFollowerCount: document.getElementById('verifyFollowers').value,
    paymentReference: document.getElementById('verifyPaymentRef').value.trim()
  };

  // In Razorpay mode the paid route is an instant checkout, not a queue entry.
  if (payload.route === 'PAYMENT' && state.payment.mode === 'RAZORPAY') {
    return startCheckout('VERIFICATION', '');
  }

  if (!payload.profileUrl) return show('verifyError', 'Add a public link to your social profile.');

  setLoading(btn, true, 'Submitting…');
  api('submitVerificationRequest', payload).then(function (res) {
    setLoading(btn, false);
    if (!res.ok) return show('verifyError', res.error);
    toast(res.message);
    loadVerification();
  }).catch(function (err) {
    setLoading(btn, false);
    show('verifyError', err.message);
  });
}

function withdrawVerification() {
  api('cancelVerificationRequest').then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    toast(res.message);
    loadVerification();
  }).catch(function (err) { toast(err.message, 'error'); });
}

// ------------------------------------------------------------- admin panel
function switchAdminPane(pane) {
  state.adminPane = pane;
  const panes = {
    overview: 'adminOverviewPane',
    users: 'adminUsersPane',
    posts: 'adminPostsPane',
    payments: 'adminPaymentsPane',
    verification: 'adminContainer'
  };
  const active = 'flex-1 py-2.5 rounded-xl text-[11px] font-semibold transition-all bg-slate-800 text-white shadow';
  const idle = 'flex-1 py-2.5 rounded-xl text-[11px] font-semibold transition-all text-slate-500 hover:text-slate-300';

  Object.keys(panes).forEach(function (key) {
    document.getElementById(panes[key]).classList.toggle('hidden', key !== pane);
    document.getElementById('apane-' + key).className = key === pane ? active : idle;
  });

  if (pane === 'overview') loadAdminOverview();
  if (pane === 'users') loadAdminUsers();
  if (pane === 'posts') loadAdminPosts();
  if (pane === 'payments') loadAdminPayments();
  if (pane === 'verification') loadAdminQueue();
}

function statTile(label, value, tone, sub) {
  return '<div class="bg-slate-900 border border-slate-800 rounded-2xl p-4">' +
    '<p class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">' + esc(label) + '</p>' +
    '<p class="text-2xl font-bold mt-1 ' + (tone || 'text-white') + '">' + esc(value) + '</p>' +
    (sub ? '<p class="text-[10px] text-slate-500 mt-0.5">' + esc(sub) + '</p>' : '') +
  '</div>';
}

function loadAdminOverview() {
  api('adminGetOverview').then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    const pane = document.getElementById('adminOverviewPane');
    const n = function (v) { return Number(v || 0).toLocaleString(); };
    loadAdminRevenue();

    pane.innerHTML =
      '<div class="grid grid-cols-2 sm:grid-cols-3 gap-3 fade-up">' +
        statTile('Users', n(res.users.total), 'text-white',
          res.users.creators + ' creators · ' + res.users.fans + ' fans') +
        statTile('Verified', n(res.users.verified), 'text-sky-400', 'creators with a tick') +
        statTile('Admins', n(res.users.admins), 'text-indigo-400') +
        statTile('Suspended', n(res.users.suspended), res.users.suspended ? 'text-rose-400' : 'text-white',
          res.users.deleted + ' deleted') +
        statTile('Active posts', n(res.posts.active), 'text-emerald-400',
          res.posts.expired + ' expired · ' + res.posts.deleted + ' removed') +
        statTile('Active subs', n(res.subscriptions.active), 'text-white',
          '₹' + n(res.subscriptions.projectedMonthlyValue) + '/mo committed') +
        statTile('Messages', n(res.messages.total), 'text-white') +
        statTile('Follows', n(res.follows.total), 'text-white', 'follow relationships') +
        statTile('Notifications', n(res.notifications.total), 'text-white',
          res.notifications.unread + ' unread') +
        statTile('Engagement', n(res.engagement.likes + res.engagement.comments), 'text-white',
          res.engagement.likes + ' likes · ' + res.engagement.comments + ' comments') +
        statTile('Uploads', n(res.media.count), 'text-white',
          Math.round(res.media.bytes / 1048576) + 'MB in Drive') +
        statTile('Pending reviews', n(res.verification.pending),
          res.verification.pending ? 'text-amber-400' : 'text-white',
          res.verification.approved + ' approved · ' + res.verification.rejected + ' rejected') +
      '</div>' +
      '<div id="adminRevenueBlock" class="mt-4"></div>' +
      '<p class="text-[10px] text-slate-600 mt-4 leading-relaxed">' +
        'Committed value is the sum of active subscription prices. Collected figures below ' +
        'come from settled Razorpay payments only.</p>';
    icons();
  }).catch(function (err) { toast(err.message, 'error'); });
}

function loadAdminRevenue() {
  api('adminGetRevenue').then(function (res) {
    if (!res.ok) return;
    const block = document.getElementById('adminRevenueBlock');
    if (!block) return;

    const money = function (v) { return '₹' + Number(v || 0).toLocaleString('en-IN'); };
    const b = res.breakdown;

    block.innerHTML =
      '<div class="bg-slate-900 border border-slate-800 rounded-2xl p-4">' +
        '<div class="flex items-center justify-between mb-3">' +
          '<h3 class="text-xs font-bold text-slate-200">Revenue</h3>' +
          '<span class="text-[10px] text-slate-500">' + res.commissionPercent + '% commission</span>' +
        '</div>' +

        '<div class="grid grid-cols-3 gap-2 text-center pb-3 border-b border-slate-800">' +
          '<div><strong class="block text-white text-sm">' + esc(money(res.grossProcessed)) + '</strong>' +
            '<span class="text-[9px] text-slate-500">processed</span></div>' +
          '<div><strong class="block text-emerald-400 text-sm">' + esc(money(res.platformRevenue)) + '</strong>' +
            '<span class="text-[9px] text-slate-500">platform</span></div>' +
          '<div><strong class="block text-amber-400 text-sm">' + esc(money(res.owedToCreators)) + '</strong>' +
            '<span class="text-[9px] text-slate-500">owed out</span></div>' +
        '</div>' +

        '<div class="grid grid-cols-3 gap-2 pt-3 text-[10px] text-center">' +
          '<div><p class="text-slate-500">Subs</p><p class="text-slate-200 font-semibold">' +
            esc(money(b.subscriptions.commission)) + '</p></div>' +
          '<div><p class="text-slate-500">Tips</p><p class="text-slate-200 font-semibold">' +
            esc(money(b.tips.commission)) + '</p></div>' +
          '<div><p class="text-slate-500">Verification</p><p class="text-slate-200 font-semibold">' +
            esc(money(b.verification.commission)) + '</p></div>' +
        '</div>' +

        (res.payoutsPending > 0
          ? '<p class="text-[10px] text-amber-400 mt-3 flex items-start gap-1.5">' +
            '<i data-lucide="triangle-alert" class="w-3 h-3 shrink-0 mt-0.5"></i>' +
            esc(money(res.payoutsPending)) + ' is owed to creators and has not been transferred. ' +
            'Razorpay pays the full amount into your account — wire up Razorpay Route to split at source.</p>'
          : '') +

        (res.owed.length
          ? '<div class="mt-3 pt-3 border-t border-slate-800 space-y-1.5">' +
            res.owed.slice(0, 5).map(function (row) {
              return '<div class="flex items-center justify-between text-[10px]">' +
                '<span class="text-slate-400 truncate">' +
                  esc(row.creator ? row.creator.fullName : row.creatorId) + '</span>' +
                '<span class="text-slate-200 font-semibold">' + esc(money(row.net)) + '</span></div>';
            }).join('') + '</div>'
          : '') +
      '</div>';
    icons();
  }).catch(function () { /* non-critical */ });
}

// ------------------------------------------------------------- admin: users
function loadAdminUsers() {
  api('adminListUsers', state.adminUserFilter).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    renderAdminUsers(res.users);
  }).catch(function (err) { toast(err.message, 'error'); });
}

function setUserFilter(key, value) {
  state.adminUserFilter[key] = value;
  loadAdminUsers();
}

function onUserSearch(value) {
  state.adminUserFilter.query = value;
  clearTimeout(state.userSearchTimer);
  state.userSearchTimer = setTimeout(loadAdminUsers, 300);
}

function filterRow(options, currentValue, onSelect) {
  return '<div class="flex gap-1 p-1 bg-slate-900/80 border border-white/5 rounded-xl">' +
    options.map(function (o) {
      const on = currentValue === o.value;
      return '<button onclick="' + onSelect + '(\'' + o.value + '\')" ' +
        'class="flex-1 py-1.5 rounded-lg text-[10px] font-semibold transition-all ' +
        (on ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300') + '">' +
        esc(o.label) + '</button>';
    }).join('') + '</div>';
}

function setUserRoleFilter(v) { setUserFilter('role', v); }
function setUserStatusFilter(v) { setUserFilter('status', v); }

function renderAdminUsers(users) {
  const pane = document.getElementById('adminUsersPane');

  const controls =
    '<div class="space-y-2 mb-4">' +
      '<div class="relative">' +
        '<i data-lucide="search" class="w-3.5 h-3.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"></i>' +
        '<input id="userSearch" class="field pl-9" placeholder="Search name, username or email" ' +
          'value="' + esc(state.adminUserFilter.query) + '" oninput="onUserSearch(this.value)" />' +
      '</div>' +
      '<div class="grid grid-cols-2 gap-2">' +
        filterRow([{ label: 'All roles', value: 'ALL' }, { label: 'Creators', value: 'CELEBRITY' },
                   { label: 'Fans', value: 'FAN' }], state.adminUserFilter.role, 'setUserRoleFilter') +
        filterRow([{ label: 'All', value: 'ALL' }, { label: 'Active', value: 'ACTIVE' },
                   { label: 'Suspended', value: 'SUSPENDED' }, { label: 'Deleted', value: 'DELETED' }],
                  state.adminUserFilter.status, 'setUserStatusFilter') +
      '</div>' +
      '<p class="text-[10px] text-slate-500 px-1">' + users.length + ' account' + (users.length === 1 ? '' : 's') + '</p>' +
    '</div>';

  if (!users.length) {
    pane.innerHTML = controls + emptyCard('users', 'No matching accounts', 'Try a different search or filter.');
    icons();
    return;
  }

  const statusTone = {
    ACTIVE: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    SUSPENDED: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
    DELETED: 'text-slate-400 bg-slate-500/10 border-slate-500/20'
  };

  pane.innerHTML = controls + users.map(function (u) {
    const isMe = u.id === state.user.id;
    const suspended = u.status === 'SUSPENDED';
    const deleted = u.status === 'DELETED';

    return '<div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-3 fade-up' +
        (deleted ? ' opacity-60' : '') + '">' +

      '<div class="flex items-start justify-between gap-3">' +
        '<button onclick="viewProfile(\'' + esc(u.id) + '\')" class="flex items-center gap-2.5 text-left min-w-0">' +
          avatarHtml(u, 'w-10 h-10', 'text-xs') +
          '<span class="min-w-0">' +
            '<span class="flex items-center gap-1 text-xs font-semibold text-slate-100">' +
              esc(u.fullName) + badgeHtml(u, 'w-3 h-3') +
              (u.isAdmin ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-400/25">ADMIN</span>' : '') +
              (isMe ? '<span class="text-[9px] text-slate-500">(you)</span>' : '') +
            '</span>' +
            '<span class="block text-[10px] text-slate-500 truncate">@' + esc(u.username) + ' · ' + esc(u.email) + '</span>' +
          '</span>' +
        '</button>' +
        '<span class="text-[9px] font-bold uppercase px-2 py-1 rounded-full border shrink-0 ' +
          (statusTone[u.status] || statusTone.DELETED) + '">' + esc(u.status) + '</span>' +
      '</div>' +

      (u.statusReason
        ? '<p class="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2 mt-3">' +
          esc(u.statusReason) + '</p>'
        : '') +

      '<div class="grid grid-cols-5 gap-2 mt-3 text-center">' +
        '<div><strong class="block text-xs text-white">' + (u.role === 'CELEBRITY' ? 'Creator' : 'Fan') + '</strong>' +
          '<span class="text-[9px] text-slate-500">role</span></div>' +
        '<div><strong class="block text-xs text-white">' + u.stats.posts + '</strong>' +
          '<span class="text-[9px] text-slate-500">posts</span></div>' +
        '<div><strong class="block text-xs text-white">' + u.stats.subscribers + '</strong>' +
          '<span class="text-[9px] text-slate-500">subs</span></div>' +
        '<div><strong class="block text-xs text-white">' +
          (u.verifiedFollowerCount ? Number(u.verifiedFollowerCount).toLocaleString() : '—') + '</strong>' +
          '<span class="text-[9px] text-slate-500">verified ext.</span></div>' +
        '<div><strong class="block text-xs text-white">' + Number(u.stats.inAppFollowers).toLocaleString() + '</strong>' +
          '<span class="text-[9px] text-slate-500">in-app</span></div>' +
      '</div>' +

      (isMe
        ? '<p class="text-[10px] text-slate-500 mt-3 pt-3 border-t border-slate-800 flex items-center gap-1.5">' +
          '<i data-lucide="info" class="w-3 h-3"></i> You cannot moderate your own account.</p>'
        : '<div class="mt-3 pt-3 border-t border-slate-800 flex flex-wrap gap-2">' +
            (deleted
              ? '<button onclick="setUserStatus(\'' + esc(u.id) + '\', \'ACTIVE\')" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold transition-colors">Restore</button>'
              : (suspended
                  ? '<button onclick="setUserStatus(\'' + esc(u.id) + '\', \'ACTIVE\')" class="px-3 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 text-[11px] font-semibold transition-colors">Unsuspend</button>'
                  : '<button onclick="setUserStatus(\'' + esc(u.id) + '\', \'SUSPENDED\')" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-amber-500/15 hover:text-amber-300 text-[11px] font-semibold transition-colors">Suspend</button>')) +

            '<button onclick="setUserRole(\'' + esc(u.id) + '\', \'' + (u.role === 'CELEBRITY' ? 'FAN' : 'CELEBRITY') + '\')" ' +
              'class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold transition-colors">' +
              'Make ' + (u.role === 'CELEBRITY' ? 'fan' : 'creator') + '</button>' +

            '<button onclick="setUserAdmin(\'' + esc(u.id) + '\', ' + (u.isAdmin ? 'false' : 'true') + ')" ' +
              'class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-indigo-500/15 hover:text-indigo-300 text-[11px] font-semibold transition-colors">' +
              (u.isAdmin ? 'Revoke admin' : 'Make admin') + '</button>' +

            (u.verificationStatus === 'APPROVED'
              ? '<button onclick="promptRecount(\'' + esc(u.id) + '\', ' + (Number(u.verifiedFollowerCount) || 0) + ')" ' +
                'class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold transition-colors">Set followers</button>'
              : '') +

            (!deleted
              ? '<button onclick="setUserStatus(\'' + esc(u.id) + '\', \'DELETED\')" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-rose-500/15 hover:text-rose-300 text-[11px] font-semibold transition-colors">Delete</button>'
              : '') +
          '</div>') +
    '</div>';
  }).join('');
  icons();
}

function setUserStatus(userId, status) {
  let reason = '';
  if (status === 'SUSPENDED') {
    reason = prompt('Reason for suspending this account (shown to them at login):', '');
    if (reason === null) return;
  } else if (status === 'DELETED') {
    if (!confirm('Delete this account? Their sessions end immediately and their posts leave the feed. ' +
                 'This is reversible from the Deleted filter.')) return;
  }

  api('adminSetUserStatus', userId, status, reason).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    toast(res.message);
    loadAdminUsers();
    loadFeed();
    loadCreators();
  }).catch(function (err) { toast(err.message, 'error'); });
}

function setUserRole(userId, role) {
  const warning = role === 'FAN'
    ? 'Demote to fan? Any verification and badge on the account is cleared.'
    : 'Promote to creator? They will be able to publish posts and take subscribers.';
  if (!confirm(warning)) return;

  api('adminSetUserRole', userId, role).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    toast(res.message);
    loadAdminUsers();
    loadCreators();
    loadFeed();
  }).catch(function (err) { toast(err.message, 'error'); });
}

function setUserAdmin(userId, makeAdmin) {
  if (!confirm(makeAdmin ? 'Grant full admin access to this account?' : 'Revoke admin access?')) return;

  api('adminSetUserAdmin', userId, makeAdmin).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    toast(res.message);
    loadAdminUsers();
  }).catch(function (err) { toast(err.message, 'error'); });
}

function promptRecount(userId, current) {
  const value = prompt('Verified follower count (drives the badge tier):', current);
  if (value === null) return;

  api('setVerifiedFollowerCount', userId, value).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    toast(res.message);
    loadAdminUsers();
    loadCreators();
    loadFeed();
  }).catch(function (err) { toast(err.message, 'error'); });
}

// ------------------------------------------------------------- admin: posts
function loadAdminPosts() {
  api('adminListPosts', state.adminPostFilter).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    renderAdminPosts(res.posts);
  }).catch(function (err) { toast(err.message, 'error'); });
}

function setPostStatusFilter(value) {
  state.adminPostFilter.status = value;
  loadAdminPosts();
}

function setPostVisibilityFilter(value) {
  state.adminPostFilter.visibility = value;
  loadAdminPosts();
}

function onPostSearch(value) {
  state.adminPostFilter.query = value;
  clearTimeout(state.postSearchTimer);
  state.postSearchTimer = setTimeout(loadAdminPosts, 300);
}

function renderAdminPosts(posts) {
  const pane = document.getElementById('adminPostsPane');

  const controls =
    '<div class="space-y-2 mb-4">' +
      '<div class="relative">' +
        '<i data-lucide="search" class="w-3.5 h-3.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"></i>' +
        '<input class="field pl-9" placeholder="Search caption or author" ' +
          'value="' + esc(state.adminPostFilter.query) + '" oninput="onPostSearch(this.value)" />' +
      '</div>' +
      filterRow([{ label: 'All', value: 'ALL' }, { label: 'Active', value: 'ACTIVE' },
                 { label: 'Expired', value: 'EXPIRED' }, { label: 'Removed', value: 'DELETED' }],
                state.adminPostFilter.status, 'setPostStatusFilter') +
      filterRow([{ label: 'All posts', value: 'ALL' }, { label: 'Public', value: 'PUBLIC' },
                 { label: 'Private gallery', value: 'SUBSCRIBERS' }],
                state.adminPostFilter.visibility || 'ALL', 'setPostVisibilityFilter') +
      '<p class="text-[10px] text-slate-500 px-1">' + posts.length + ' post' + (posts.length === 1 ? '' : 's') + '</p>' +
    '</div>';

  if (!posts.length) {
    pane.innerHTML = controls + emptyCard('file-x', 'No matching posts', 'Try a different search or filter.');
    icons();
    return;
  }

  const statusTone = {
    ACTIVE: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    EXPIRED: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    DELETED: 'text-rose-400 bg-rose-500/10 border-rose-500/20'
  };

  pane.innerHTML = controls + posts.map(function (p) {
    const media = safeUrl(p.mediaUrl);
    const expired = new Date(p.expiresAt) <= new Date();

    return '<div class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden mb-3 fade-up' +
        (p.status !== 'ACTIVE' ? ' opacity-70' : '') + '">' +
      '<div class="flex gap-3 p-3">' +
        (media
          ? '<img src="' + esc(media) + '" class="w-16 h-16 rounded-xl object-cover bg-black shrink-0" />'
          : '<div class="w-16 h-16 rounded-xl bg-slate-800 flex items-center justify-center text-slate-600 shrink-0">' +
            '<i data-lucide="file-text" class="w-5 h-5"></i></div>') +

        '<div class="min-w-0 flex-1">' +
          '<div class="flex items-start justify-between gap-2">' +
            (p.author
              ? '<button onclick="viewProfile(\'' + esc(p.author.id) + '\')" class="flex items-center gap-1 text-[11px] font-semibold text-slate-200 hover:text-indigo-300 transition-colors min-w-0">' +
                '<span class="truncate">' + esc(p.author.fullName) + '</span>' + badgeHtml(p.author, 'w-3 h-3') + '</button>'
              : '<span class="text-[11px] text-slate-500">Unknown author</span>') +
            (p.visibility === 'SUBSCRIBERS'
              ? '<span class="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border shrink-0 ' +
                'bg-indigo-500/15 text-indigo-300 border-indigo-400/25">PRIVATE</span>'
              : '') +
            '<span class="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border shrink-0 ' +
              (statusTone[p.status] || statusTone.DELETED) + '">' +
              esc(p.status === 'DELETED' ? 'REMOVED' : p.status) + '</span>' +
          '</div>' +
          '<p class="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">' + esc(p.caption || '—') + '</p>' +
          '<p class="text-[10px] text-slate-600 mt-1">' + esc(p.type) + ' · posted ' + esc(relTime(p.createdAt)) + ' ago · ' +
            (expired ? 'window closed' : daysUntil(p.expiresAt) + 'd left') + '</p>' +
        '</div>' +
      '</div>' +

      '<div class="px-3 pb-3 flex gap-2">' +
        (p.status === 'ACTIVE'
          ? '<button onclick="setPostStatus(\'' + esc(p.id) + '\', \'DELETED\')" class="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-rose-500/15 hover:text-rose-300 text-[11px] font-semibold transition-colors">Remove</button>' +
            '<button onclick="setPostStatus(\'' + esc(p.id) + '\', \'EXPIRED\')" class="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-amber-500/15 hover:text-amber-300 text-[11px] font-semibold transition-colors">Expire now</button>'
          : (expired
              ? '<p class="text-[10px] text-slate-600 py-2 flex items-center gap-1.5">' +
                '<i data-lucide="lock" class="w-3 h-3"></i> Past its 30-day window — cannot be restored.</p>'
              : '<button onclick="setPostStatus(\'' + esc(p.id) + '\', \'ACTIVE\')" class="flex-1 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 text-[11px] font-semibold transition-colors">Restore</button>')) +
      '</div>' +
    '</div>';
  }).join('');
  icons();
}

function setPostStatus(postId, status) {
  if (status === 'DELETED' && !confirm('Remove this post from the platform?')) return;

  api('adminSetPostStatus', postId, status).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    toast(res.message);
    loadAdminPosts();
    loadFeed();
  }).catch(function (err) { toast(err.message, 'error'); });
}

// ---------------------------------------------------------- admin: payments
function loadAdminPayments() {
  api('adminListPayments', state.adminPaymentFilter).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    renderAdminPayments(res);
  }).catch(function (err) { toast(err.message, 'error'); });
}

function setPaymentStatusFilter(v) { state.adminPaymentFilter.status = v; loadAdminPayments(); }
function setPaymentPurposeFilter(v) { state.adminPaymentFilter.purpose = v; loadAdminPayments(); }

function renderAdminPayments(data) {
  const pane = document.getElementById('adminPaymentsPane');
  const t = data.totals;
  const money = function (v) { return '₹' + Number(v || 0).toLocaleString(); };

  const header =
    '<div class="grid grid-cols-3 gap-3 mb-4 fade-up">' +
      statTile('Collected', money(t.collected), 'text-white', t.paidCount + ' paid') +
      statTile('Commission', money(t.commission), 'text-emerald-400', 'platform share') +
      statTile('To creators', money(t.netToCreators), 'text-amber-400', 'not yet paid out') +
    '</div>' +
    (data.mode === 'DEMO'
      ? '<p class="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2 mb-3 flex items-start gap-2">' +
        '<i data-lucide="triangle-alert" class="w-3.5 h-3.5 shrink-0 mt-0.5"></i>' +
        '<span>Demo mode — no Razorpay keys configured, so access is granted without payment ' +
        'and every row below is worth ₹0. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in ' +
        'Script Properties to take real payments.</span></p>'
      : '') +
    '<div class="space-y-2 mb-4">' +
      filterRow([{ label: 'All', value: 'ALL' }, { label: 'Paid', value: 'PAID' },
                 { label: 'Started', value: 'CREATED' }, { label: 'Failed', value: 'FAILED' }],
                state.adminPaymentFilter.status, 'setPaymentStatusFilter') +
      filterRow([{ label: 'All', value: 'ALL' }, { label: 'Subs', value: 'SUBSCRIPTION' },
                 { label: 'Tips', value: 'TIP' }, { label: 'Verify', value: 'VERIFICATION' }],
                state.adminPaymentFilter.purpose, 'setPaymentPurposeFilter') +
      '<p class="text-[10px] text-slate-500 px-1">' + data.payments.length + ' record' +
        (data.payments.length === 1 ? '' : 's') +
        ' · ' + t.pendingCount + ' unfinished · ' + t.failedCount + ' failed</p>' +
    '</div>';

  if (!data.payments.length) {
    pane.innerHTML = header + emptyCard('receipt', 'No payments yet', 'Records appear here once checkout runs.');
    icons();
    return;
  }

  const tone = {
    PAID: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    CREATED: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    FAILED: 'text-rose-400 bg-rose-500/10 border-rose-500/20'
  };

  pane.innerHTML = header + data.payments.map(function (p) {
    return '<div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-3 fade-up">' +
      '<div class="flex items-start justify-between gap-3">' +
        '<div class="min-w-0">' +
          '<div class="flex items-center gap-1.5">' +
            '<span class="text-sm font-bold text-white">' + esc(money(p.amount)) + '</span>' +
            (p.status === 'PAID' && p.commission
              ? '<span class="text-[10px] text-slate-500">(' + esc(money(p.commission)) + ' fee)</span>'
              : '') +
            '<span class="text-[10px] text-slate-500 uppercase tracking-wider">' + esc(p.purpose) + '</span>' +
            (p.mode === 'DEMO'
              ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/25">DEMO</span>'
              : '') +
          '</div>' +
          '<p class="text-[11px] text-slate-400 mt-1 truncate">' +
            (p.payer ? esc(p.payer.fullName) + ' <span class="text-slate-600">@' + esc(p.payer.username) + '</span>' : 'Unknown payer') +
            (p.target ? ' <span class="text-slate-600">→</span> ' + esc(p.target.fullName) : '') +
          '</p>' +
        '</div>' +
        '<span class="text-[9px] font-bold uppercase px-2 py-1 rounded-full border shrink-0 ' +
          (tone[p.status] || tone.FAILED) + '">' + esc(p.status) + '</span>' +
      '</div>' +

      '<div class="mt-3 pt-3 border-t border-slate-800 space-y-1 text-[10px] text-slate-500 font-mono break-all">' +
        (p.orderId ? '<p>order ' + esc(p.orderId) + '</p>' : '') +
        (p.paymentId ? '<p>payment ' + esc(p.paymentId) + '</p>' : '') +
        '<p class="font-sans">' + esc(relTime(p.createdAt)) + ' ago' +
          (p.paidAt ? ' · paid ' + esc(relTime(p.paidAt)) + ' ago' : '') + '</p>' +
      '</div>' +

      (p.failureReason
        ? '<p class="text-[10px] text-rose-300 mt-2">' + esc(p.failureReason) + '</p>'
        : '') +
    '</div>';
  }).join('');
  icons();
}

// ------------------------------------------------------ admin: verification
function loadAdminQueue(filter) {
  state.adminFilter = filter || state.adminFilter || 'PENDING';

  api('listVerificationRequests', state.adminFilter).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    renderAdminQueue(res);
  }).catch(function (err) { toast(err.message, 'error'); });
}

function renderAdminQueue(data) {
  const container = document.getElementById('adminContainer');
  const filters = ['PENDING', 'APPROVED', 'REJECTED', 'ALL'];

  const tabs = '<div class="flex gap-1 p-1 bg-slate-900/80 border border-white/5 rounded-2xl mb-4">' +
    filters.map(function (f) {
      const on = state.adminFilter === f;
      return '<button onclick="loadAdminQueue(\'' + f + '\')" class="flex-1 py-2 rounded-xl text-[11px] font-semibold transition-all ' +
        (on ? 'bg-slate-800 text-white shadow' : 'text-slate-500 hover:text-slate-300') + '">' +
        f.charAt(0) + f.slice(1).toLowerCase() + '</button>';
    }).join('') + '</div>';

  if (!data.requests.length) {
    container.innerHTML = tabs + emptyCard('inbox', 'Nothing here',
      'No ' + state.adminFilter.toLowerCase() + ' verification requests.');
    icons();
    return;
  }

  container.innerHTML = tabs + data.requests.map(function (r) {
    const applicant = r.applicant;
    const pending = r.status === 'PENDING';
    const statusTone = { PENDING: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
                         APPROVED: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
                         REJECTED: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
                         CANCELLED: 'text-slate-400 bg-slate-500/10 border-slate-500/20' }[r.status] ||
                       'text-slate-400 bg-slate-500/10 border-slate-500/20';

    return '<div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-3 fade-up">' +
      '<div class="flex items-start justify-between gap-3">' +
        '<button onclick="viewProfile(\'' + esc(r.userId) + '\')" class="flex items-center gap-2.5 text-left min-w-0">' +
          (applicant ? avatarHtml(applicant, 'w-9 h-9', 'text-[11px]') : '') +
          '<span class="min-w-0">' +
            '<span class="flex items-center gap-1 text-xs font-semibold text-slate-100 truncate">' +
              esc(applicant ? applicant.fullName : r.userId) +
              (applicant ? badgeHtml(applicant, 'w-3 h-3') : '') +
            '</span>' +
            '<span class="block text-[10px] text-slate-500">@' + esc(applicant ? applicant.username : '') + '</span>' +
          '</span>' +
        '</button>' +
        '<span class="text-[10px] font-bold uppercase px-2 py-1 rounded-full border ' + statusTone + '">' +
          esc(r.status) + '</span>' +
      '</div>' +

      '<div class="grid grid-cols-2 gap-2 mt-3 text-[11px]">' +
        '<div><span class="text-slate-500">Route</span><br>' +
          '<span class="text-slate-200 font-medium">' +
          (r.route === 'PAYMENT' ? 'Paid ₹' + r.feeAmount : 'Followers') + '</span></div>' +
        '<div><span class="text-slate-500">Platform</span><br>' +
          '<span class="text-slate-200 font-medium">' + esc(r.platform) + '</span></div>' +
        '<div><span class="text-slate-500">Claimed</span><br>' +
          '<span class="text-slate-200 font-medium">' + Number(r.claimedFollowerCount).toLocaleString() + '</span></div>' +
        '<div><span class="text-slate-500">Submitted</span><br>' +
          '<span class="text-slate-200 font-medium">' + esc(relTime(r.createdAt)) + ' ago</span></div>' +
      '</div>' +

      (r.profileUrl
        ? '<a href="' + esc(r.profileUrl) + '" target="_blank" rel="noopener noreferrer" ' +
          'class="mt-2 inline-flex items-center gap-1.5 text-[11px] text-indigo-400 hover:text-indigo-300 break-all">' +
          '<i data-lucide="external-link" class="w-3 h-3 shrink-0"></i>' + esc(r.profileUrl) + '</a>'
        : '') +

      (r.paymentReference
        ? '<p class="text-[11px] text-slate-400 mt-2">Payment ref: <span class="text-slate-200">' +
          esc(r.paymentReference) + '</span></p>'
        : '') +

      (r.note ? '<p class="text-[11px] text-slate-400 mt-2 italic">“' + esc(r.note) + '”</p>' : '') +

      (r.status === 'APPROVED'
        ? '<p class="text-[11px] text-emerald-400 mt-2">Verified at ' +
          Number(r.verifiedFollowerCount).toLocaleString() + ' followers</p>'
        : '') +

      (pending
        ? '<div class="mt-4 pt-3 border-t border-slate-800 space-y-2.5">' +
            '<div class="grid grid-cols-2 gap-2">' +
              '<label class="block"><span class="text-[10px] font-semibold text-slate-500 mb-1 block">Verified followers</span>' +
                '<input id="verified_' + esc(r.id) + '" type="number" min="0" class="field" ' +
                'value="' + esc(r.claimedFollowerCount) + '" /></label>' +
              '<label class="block"><span class="text-[10px] font-semibold text-slate-500 mb-1 block">Note</span>' +
                '<input id="note_' + esc(r.id) + '" class="field" placeholder="Reason (for rejections)" /></label>' +
            '</div>' +
            '<div class="flex gap-2">' +
              '<button onclick="reviewRequest(\'' + esc(r.id) + '\', \'APPROVE\')" ' +
                'class="flex-1 py-2.5 rounded-xl btn-primary text-xs font-bold transition-all">Approve</button>' +
              '<button onclick="reviewRequest(\'' + esc(r.id) + '\', \'REJECT\')" ' +
                'class="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-rose-500/15 hover:text-rose-300 text-xs font-semibold transition-colors">Reject</button>' +
            '</div>' +
          '</div>'
        : '') +

      (r.status === 'APPROVED'
        ? '<div class="mt-3 pt-3 border-t border-slate-800 flex gap-2 items-end">' +
            '<label class="block flex-1"><span class="text-[10px] font-semibold text-slate-500 mb-1 block">Recount followers</span>' +
              '<input id="recount_' + esc(r.userId) + '" type="number" min="0" class="field" ' +
              'value="' + esc(r.verifiedFollowerCount) + '" /></label>' +
            '<button onclick="recountFollowers(\'' + esc(r.userId) + '\')" ' +
              'class="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold transition-colors">Update tier</button>' +
          '</div>'
        : '') +
    '</div>';
  }).join('');
  icons();
}

function reviewRequest(requestId, decision) {
  const followers = document.getElementById('verified_' + requestId);
  const note = document.getElementById('note_' + requestId);

  if (decision === 'REJECT' && !confirm('Reject this verification request?')) return;

  api('reviewVerificationRequest', requestId, decision,
      followers ? followers.value : '', note ? note.value : '').then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    toast(res.message);
    loadAdminQueue();
    refreshQueueBadge();
    loadCreators();
    loadFeed();
  }).catch(function (err) { toast(err.message, 'error'); });
}

function recountFollowers(userId) {
  const input = document.getElementById('recount_' + userId);
  if (!input) return;

  api('setVerifiedFollowerCount', userId, input.value).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    toast(res.message);
    loadAdminQueue();
    loadCreators();
    loadFeed();
  }).catch(function (err) { toast(err.message, 'error'); });
}

function editProfileFormHtml(profile) {
  return '' +
    '<div id="editProfileCard" class="hidden mt-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3.5 fade-up">' +
      '<div class="flex items-center justify-between">' +
        '<h3 class="text-sm font-bold text-white">Edit profile</h3>' +
        '<button onclick="toggleEditProfile(false)" class="text-slate-500 hover:text-white text-xl leading-none">&times;</button>' +
      '</div>' +

      '<label class="block"><span class="text-[11px] font-semibold text-slate-400 mb-1.5 block">Full name</span>' +
        '<input id="editName" class="field" value="' + esc(profile.fullName) + '" /></label>' +

      '<label class="block"><span class="text-[11px] font-semibold text-slate-400 mb-1.5 block">Username</span>' +
        '<input id="editUsername" class="field" value="' + esc(profile.username) + '" oninput="this.value = this.value.toLowerCase()" /></label>' +

      '<label class="block"><span class="text-[11px] font-semibold text-slate-400 mb-1.5 block">Bio</span>' +
        '<textarea id="editBio" rows="3" maxlength="280" class="field resize-none" placeholder="Tell people who you are">' + esc(profile.bio) + '</textarea></label>' +

      '<label class="block"><span class="text-[11px] font-semibold text-slate-400 mb-1.5 block">Profile picture</span>' +
        '<div class="flex gap-2">' +
          '<input id="editAvatar" class="field flex-1" placeholder="https://… or upload" value="' + esc(profile.avatarUrl) + '" />' +
          '<button type="button" onclick="pickProfileImage(\'AVATAR\')" title="Upload" ' +
            'class="px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors">' +
            '<i data-lucide="upload" class="w-4 h-4"></i></button>' +
          '<button type="button" onclick="openCameraFor(\'AVATAR\')" title="Take a selfie" ' +
            'class="px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors">' +
            '<i data-lucide="camera" class="w-4 h-4"></i></button>' +
        '</div></label>' +

      '<label class="block"><span class="text-[11px] font-semibold text-slate-400 mb-1.5 block">Banner</span>' +
        '<div class="flex gap-2">' +
          '<input id="editBanner" class="field flex-1" placeholder="https://… or upload" value="' + esc(profile.bannerUrl || '') + '" />' +
          '<button type="button" onclick="pickProfileImage(\'BANNER\')" title="Upload" ' +
            'class="px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors">' +
            '<i data-lucide="upload" class="w-4 h-4"></i></button>' +
        '</div></label>' +

      (profile.role === 'CELEBRITY'
        ? '<div class="grid grid-cols-2 gap-3">' +
            '<label class="block"><span class="text-[11px] font-semibold text-slate-400 mb-1.5 block">Category</span>' +
              '<input id="editCategory" class="field" value="' + esc(profile.category) + '" placeholder="Actress" /></label>' +
            '<label class="block"><span class="text-[11px] font-semibold text-slate-400 mb-1.5 block">Price ₹/month</span>' +
              '<input id="editPrice" type="number" min="0" max="100000" class="field" value="' + esc(profile.monthlyPrice) + '" /></label>' +
          '</div>'
        : '') +

      '<p id="editError" class="hidden text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2"></p>' +

      '<button onclick="saveProfile()" id="saveProfileBtn" class="btn-primary w-full py-3 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2">' +
        'Save changes</button>' +
    '</div>';
}

function securityFormHtml() {
  return '' +
    '<div id="securityCard" class="hidden mt-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3.5 fade-up">' +
      '<div class="flex items-center justify-between">' +
        '<h3 class="text-sm font-bold text-white">Change password</h3>' +
        '<button onclick="toggleSecurity()" class="text-slate-500 hover:text-white text-xl leading-none">&times;</button>' +
      '</div>' +
      '<label class="block"><span class="text-[11px] font-semibold text-slate-400 mb-1.5 block">Current password</span>' +
        '<input id="currentPassword" type="password" autocomplete="current-password" class="field" /></label>' +
      '<label class="block"><span class="text-[11px] font-semibold text-slate-400 mb-1.5 block">New password</span>' +
        '<input id="newPassword" type="password" autocomplete="new-password" class="field" placeholder="At least 8 characters" /></label>' +
      '<p id="securityError" class="hidden text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2"></p>' +
      '<button onclick="savePassword()" id="savePasswordBtn" class="btn-primary w-full py-3 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2">' +
        'Update password</button>' +
    '</div>';
}

function toggleEditProfile(open) {
  const card = document.getElementById('editProfileCard');
  if (!card) return;
  card.classList.toggle('hidden', !open);
  if (open) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function toggleSecurity() {
  const card = document.getElementById('securityCard');
  if (!card) return;
  card.classList.toggle('hidden');
  if (!card.classList.contains('hidden')) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function saveProfile() {
  const btn = document.getElementById('saveProfileBtn');
  hide('editError');

  const payload = {
    fullName: document.getElementById('editName').value,
    username: document.getElementById('editUsername').value,
    bio: document.getElementById('editBio').value,
    avatarUrl: document.getElementById('editAvatar').value
  };
  const bannerField = document.getElementById('editBanner');
  if (bannerField) payload.bannerUrl = bannerField.value;
  const category = document.getElementById('editCategory');
  const price = document.getElementById('editPrice');
  if (category) payload.category = category.value;
  if (price) payload.monthlyPrice = price.value;

  setLoading(btn, true, 'Saving…');
  api('updateProfile', payload).then(function (res) {
    setLoading(btn, false);
    if (!res.ok) return show('editError', res.error);

    state.user = res.user;
    document.getElementById('headerAvatar').innerHTML =
      avatarWithRosette(res.user, 'w-7 h-7', 'text-[10px]', 14);
    document.getElementById('headerName').textContent = res.user.fullName;
    toast('Profile updated.');
    viewProfile(res.user.id);
    loadFeed();
    loadCreators();
    loadConversations();
  }).catch(function (err) {
    setLoading(btn, false);
    show('editError', err.message);
  });
}

function savePassword() {
  const btn = document.getElementById('savePasswordBtn');
  hide('securityError');

  const current = document.getElementById('currentPassword').value;
  const next = document.getElementById('newPassword').value;
  if (next.length < 8) return show('securityError', 'New password must be at least 8 characters.');

  setLoading(btn, true, 'Updating…');
  api('changePassword', current, next).then(function (res) {
    setLoading(btn, false);
    if (!res.ok) return show('securityError', res.error);
    document.getElementById('currentPassword').value = '';
    document.getElementById('newPassword').value = '';
    toggleSecurity();
    toast('Password updated.');
  }).catch(function (err) {
    setLoading(btn, false);
    show('securityError', err.message);
  });
}

// ------------------------------------------------------------- create post
/**
 * PHOTO STUDIO
 *
 * Filters are baked into the pixels at publish time rather than stored as a
 * CSS string on the post. A stored filter name would not survive into a
 * WhatsApp link preview or an email, so the flattened file is what everyone
 * sees. The source is a local File, so the canvas is never cross-origin
 * tainted and toDataURL stays available.
 */
const PHOTO_FILTERS = [
  { key: 'NONE',     label: 'Original', css: '' },
  { key: 'GLAM',     label: 'Glam',     css: 'brightness(1.08) contrast(1.06) saturate(1.18)' },
  { key: 'GOLDEN',   label: 'Golden',   css: 'sepia(0.34) saturate(1.4) brightness(1.06)' },
  { key: 'NOIR',     label: 'Noir',     css: 'grayscale(1) contrast(1.3) brightness(0.97)' },
  { key: 'VELVET',   label: 'Velvet',   css: 'saturate(1.5) contrast(1.14) hue-rotate(-8deg)' },
  { key: 'BLUSH',    label: 'Blush',    css: 'sepia(0.14) saturate(1.25) hue-rotate(-14deg) brightness(1.05)' },
  { key: 'ICE',      label: 'Ice',      css: 'saturate(0.85) hue-rotate(14deg) brightness(1.07) contrast(1.08)' },
  { key: 'FADE',     label: 'Fade',     css: 'contrast(0.86) saturate(0.8) brightness(1.12)' },
  { key: 'CINEMA',   label: 'Cinema',   css: 'contrast(1.22) saturate(0.9) hue-rotate(-6deg) brightness(0.96)' },
  { key: 'PLATINUM', label: 'Platinum', css: 'grayscale(0.6) brightness(1.1) contrast(1.12)' }
];

const OVERLAYS = [
  { key: 'VIGNETTE', label: 'Vignette' },
  { key: 'GRAIN',    label: 'Grain' },
  { key: 'SPARKLE',  label: 'Sparkle' },
  { key: 'FRAME',    label: 'Gold frame' },
  { key: 'LEAK',     label: 'Light leak' }
];

/** Sticker sets place a fixed arrangement, so there is no dragging to get wrong. */
const STICKERS = [
  { key: 'CROWN',   emoji: '👑', spots: [[0.5, 0.17]], size: 0.19 },
  { key: 'SPARKLE', emoji: '✨', spots: [[0.13, 0.22], [0.87, 0.3], [0.22, 0.83], [0.8, 0.74], [0.52, 0.11]], size: 0.1 },
  { key: 'HEART',   emoji: '💕', spots: [[0.15, 0.79], [0.85, 0.21]], size: 0.14 },
  { key: 'FIRE',    emoji: '🔥', spots: [[0.13, 0.86], [0.87, 0.86]], size: 0.13 },
  { key: 'STAR',    emoji: '⭐', spots: [[0.5, 0.88]], size: 0.14 },
  { key: 'SHADES',  emoji: '🕶️', spots: [[0.5, 0.42]], size: 0.26 }
];

const MAX_UPLOAD_EDGE = 1600;

const studio = {
  image: null,        // the loaded HTMLImageElement
  file: null,         // the original File
  kind: null,         // 'IMAGE' | 'VIDEO'
  filter: 'NONE',
  intensity: 1,
  overlays: {},
  stickers: {},
  canvasFilterSupported: true
};

function setPostSource(source) {
  state.postSource = source;
  const active = 'flex-1 py-2 rounded-lg text-xs font-semibold transition-all bg-slate-700 text-white';
  const idle = 'flex-1 py-2 rounded-lg text-xs font-semibold transition-all text-slate-400 hover:text-white';
  document.getElementById('src-UPLOAD').className = source === 'UPLOAD' ? active : idle;
  document.getElementById('src-LINK').className = source === 'LINK' ? active : idle;
  document.getElementById('uploadPane').classList.toggle('hidden', source !== 'UPLOAD');
  document.getElementById('linkPane').classList.toggle('hidden', source !== 'LINK');
  icons();
}

function setPostVisibility(visibility) {
  state.postVisibility = visibility;
  const active = 'text-left p-3 rounded-2xl border transition-all bg-indigo-500/15 border-indigo-400/40 text-indigo-200';
  const idle = 'text-left p-3 rounded-2xl border transition-all bg-slate-900/60 border-white/10 text-slate-400 hover:border-white/20';
  document.getElementById('vis-PUBLIC').className = visibility === 'PUBLIC' ? active : idle;
  document.getElementById('vis-SUBSCRIBERS').className = visibility === 'SUBSCRIBERS' ? active : idle;
  icons();
}

function setPostType(type) {
  state.postType = type;
  const active = 'flex-1 py-2 rounded-lg text-xs font-semibold transition-all bg-slate-700 text-white';
  const idle = 'flex-1 py-2 rounded-lg text-xs font-semibold transition-all text-slate-400 hover:text-white';
  document.getElementById('postTypeIMAGE').className = type === 'IMAGE' ? active : idle;
  document.getElementById('postTypeVIDEO').className = type === 'VIDEO' ? active : idle;
}

function handleMediaPicked(file) {
  if (!file) return;
  hide('postError');

  const isVideo = /^video\//.test(file.type);
  const isImage = /^image\//.test(file.type);
  if (!isVideo && !isImage) return show('postError', 'Choose an image or a video file.');

  // Refuse oversized video here rather than after a long doomed upload.
  // Images are downscaled below, so their original size does not matter.
  if (isVideo && file.size > 12 * 1024 * 1024) {
    return show('postError', 'That video is ' + Math.round(file.size / 1048576) +
      'MB. The limit is 12MB — trim it or export smaller.');
  }

  studio.file = file;
  studio.kind = isVideo ? 'VIDEO' : 'IMAGE';
  state.postType = isVideo ? 'VIDEO' : 'IMAGE';

  if (isVideo) {
    document.getElementById('studio').classList.add('hidden');
    document.getElementById('videoPane').classList.remove('hidden');
    document.getElementById('videoPreview').src = URL.createObjectURL(file);
    icons();
    return;
  }

  const reader = new FileReader();
  reader.onload = function () {
    const img = new Image();
    img.onload = function () {
      studio.image = img;
      document.getElementById('videoPane').classList.add('hidden');
      document.getElementById('studio').classList.remove('hidden');
      buildStudioControls();
      renderStudio();
      icons();
    };
    img.onerror = function () { show('postError', 'That image could not be read.'); };
    img.src = reader.result;
  };
  reader.onerror = function () { show('postError', 'That file could not be read.'); };
  reader.readAsDataURL(file);
}

function clearMedia() {
  studio.image = null;
  studio.file = null;
  studio.kind = null;
  studio.filter = 'NONE';
  studio.intensity = 1;
  studio.overlays = {};
  studio.stickers = {};
  document.getElementById('studio').classList.add('hidden');
  document.getElementById('videoPane').classList.add('hidden');
  document.getElementById('mediaFile').value = '';
  document.getElementById('mediaCamera').value = '';
  hide('postError');
}

function buildStudioControls() {
  // ctx.filter is unsupported in some older Safari builds; without it the
  // strength slider would be a lie, so it is hidden rather than left inert.
  const probe = document.createElement('canvas').getContext('2d');
  studio.canvasFilterSupported = typeof probe.filter === 'string';
  document.getElementById('intensityWrap').classList.toggle('hidden', !studio.canvasFilterSupported);

  document.getElementById('filterRow').innerHTML = PHOTO_FILTERS.map(function (f) {
    const on = studio.filter === f.key;
    return '<button type="button" onclick="setFilter(\'' + f.key + '\')" ' +
      'class="shrink-0 px-3 py-2 rounded-xl text-[11px] font-semibold border transition-all ' +
      (on ? 'bg-indigo-500/20 border-indigo-400/50 text-indigo-200'
          : 'bg-slate-800/60 border-white/5 text-slate-400 hover:text-white') + '">' +
      esc(f.label) + '</button>';
  }).join('');

  document.getElementById('overlayRow').innerHTML = OVERLAYS.map(function (o) {
    const on = !!studio.overlays[o.key];
    return '<button type="button" onclick="toggleOverlay(\'' + o.key + '\')" ' +
      'class="px-3 py-1.5 rounded-lg text-[10px] font-semibold border transition-all ' +
      (on ? 'bg-indigo-500/20 border-indigo-400/50 text-indigo-200'
          : 'bg-slate-800/60 border-white/5 text-slate-400 hover:text-white') + '">' +
      esc(o.label) + '</button>';
  }).join('');

  document.getElementById('stickerRow').innerHTML = STICKERS.map(function (st) {
    const on = !!studio.stickers[st.key];
    return '<button type="button" onclick="toggleSticker(\'' + st.key + '\')" ' +
      'class="w-10 h-10 rounded-xl text-lg leading-none border transition-all ' +
      (on ? 'bg-indigo-500/20 border-indigo-400/50' : 'bg-slate-800/60 border-white/5 hover:bg-slate-700') +
      '">' + st.emoji + '</button>';
  }).join('');
}

function setFilter(key) { studio.filter = key; buildStudioControls(); renderStudio(); }
function toggleOverlay(key) { studio.overlays[key] = !studio.overlays[key]; buildStudioControls(); renderStudio(); }
function toggleSticker(key) { studio.stickers[key] = !studio.stickers[key]; buildStudioControls(); renderStudio(); }

function setIntensity(value) {
  studio.intensity = Number(value) / 100;
  document.getElementById('intensityValue').textContent = value + '%';
  renderStudio();
}

/** Draws the current look onto a canvas. Used for preview and for publishing. */
function renderStudio(targetCanvas) {
  const img = studio.image;
  if (!img) return null;

  const canvas = targetCanvas || document.getElementById('studioCanvas');
  const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  const filter = PHOTO_FILTERS.filter(function (f) { return f.key === studio.filter; })[0];

  // Unfiltered base, then the filtered copy at the chosen strength on top.
  // Compositing like this is what makes the strength slider continuous.
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.drawImage(img, 0, 0, w, h);

  if (filter && filter.css && studio.canvasFilterSupported && studio.intensity > 0) {
    ctx.globalAlpha = studio.intensity;
    ctx.filter = filter.css;
    ctx.drawImage(img, 0, 0, w, h);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
  }

  paintOverlays(ctx, w, h);
  return canvas;
}

/** Effects and stickers, shared by the studio and the live camera preview. */
function paintOverlays(ctx, w, h) {
  if (studio.overlays.LEAK) {
    const leak = ctx.createRadialGradient(w * 0.88, h * 0.12, 0, w * 0.88, h * 0.12, Math.max(w, h) * 0.7);
    leak.addColorStop(0, 'rgba(255, 214, 140, 0.42)');
    leak.addColorStop(0.45, 'rgba(255, 186, 110, 0.14)');
    leak.addColorStop(1, 'rgba(255, 186, 110, 0)');
    ctx.fillStyle = leak;
    ctx.fillRect(0, 0, w, h);
  }

  if (studio.overlays.VIGNETTE) {
    const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.78);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  if (studio.overlays.GRAIN) {
    // Scattered translucent specks. Cheaper than per-pixel noise and reads
    // the same at display size.
    const count = Math.round((w * h) / 900);
    ctx.save();
    for (let i = 0; i < count; i++) {
      const light = Math.random() > 0.5;
      ctx.fillStyle = light ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.2, 1.2);
    }
    ctx.restore();
  }

  if (studio.overlays.SPARKLE) {
    ctx.save();
    for (let i = 0; i < 34; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = (Math.random() * 0.9 + 0.35) * (Math.min(w, h) / 120);
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
      glow.addColorStop(0, 'rgba(255,250,225,0.92)');
      glow.addColorStop(0.35, 'rgba(255,236,180,0.32)');
      glow.addColorStop(1, 'rgba(255,236,180,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (studio.overlays.FRAME) {
    const inset = Math.max(6, Math.round(Math.min(w, h) * 0.022));
    ctx.strokeStyle = 'rgba(201,162,39,0.92)';
    ctx.lineWidth = Math.max(2, Math.round(Math.min(w, h) * 0.006));
    ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
    ctx.strokeStyle = 'rgba(255,244,206,0.42)';
    ctx.lineWidth = 1;
    ctx.strokeRect(inset + 4, inset + 4, w - (inset + 4) * 2, h - (inset + 4) * 2);
  }

  STICKERS.forEach(function (st) {
    if (!studio.stickers[st.key]) return;
    const size = Math.round(Math.min(w, h) * st.size);
    ctx.save();
    ctx.font = size + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = size * 0.14;
    st.spots.forEach(function (spot) {
      ctx.fillText(st.emoji, spot[0] * w, spot[1] * h);
    });
    ctx.restore();
  });
}

function renderPostPreview() {
  const url = safeUrl(document.getElementById('postMediaUrl').value);
  const preview = document.getElementById('postPreview');
  if (url) {
    preview.src = url;
    preview.classList.remove('hidden');
  } else {
    preview.classList.add('hidden');
  }
}

function openCreateModal() {
  document.getElementById('createModal').classList.remove('hidden');
  hide('postError');
  setPostSource(state.postSource || 'UPLOAD');
  setPostType(state.postType || 'IMAGE');
  setPostVisibility(state.postVisibility || 'PUBLIC');
  icons();
}

function closeCreateModal() {
  document.getElementById('createModal').classList.add('hidden');
}

/** Reads a File as bare base64, without the data: prefix. */
function fileToBase64(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = function () { reject(new Error('That file could not be read.')); };
    reader.readAsDataURL(file);
  });
}

function submitPost() {
  const btn = document.getElementById('postBtn');
  hide('postError');

  const caption = document.getElementById('postCaption').value.trim();
  const usingUpload = state.postSource !== 'LINK';
  const linkUrl = usingUpload ? '' : document.getElementById('postMediaUrl').value.trim();

  if (usingUpload && !studio.file && !caption) {
    return show('postError', 'Attach a photo or video, or write a caption.');
  }
  if (!usingUpload && !linkUrl && !caption) {
    return show('postError', 'Add a media URL or a caption.');
  }

  // Text-only, or a linked URL: no upload step needed.
  if (!usingUpload || !studio.file) {
    return publishPost(btn, caption, linkUrl, state.postType);
  }

  setLoading(btn, true, 'Preparing…');

  const prepare = studio.kind === 'IMAGE'
    ? Promise.resolve(canvasToBase64(renderStudio(document.createElement('canvas'))))
    : fileToBase64(studio.file).then(function (data) {
        return { data: data, mimeType: studio.file.type };
      });

  prepare.then(function (payload) {
    setLoading(btn, true, 'Uploading…');
    return api('uploadMedia', {
      data: payload.data,
      mimeType: payload.mimeType,
      kind: studio.kind
    });
  }).then(function (res) {
    if (!res.ok) {
      setLoading(btn, false);
      return show('postError', res.error);
    }
    publishPost(btn, caption, res.url, res.kind);
  }).catch(function (err) {
    setLoading(btn, false);
    show('postError', err.message || 'Upload failed.');
  });
}

/** Flattens the studio canvas to JPEG. Filters are baked in at this point. */
function canvasToBase64(canvas) {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  return { data: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: 'image/jpeg' };
}

function publishPost(btn, caption, mediaUrl, type) {
  setLoading(btn, true, 'Publishing…');

  api('createPost', type || 'IMAGE', caption, mediaUrl || '', state.postVisibility).then(function (res) {
    setLoading(btn, false);
    if (!res.ok) return show('postError', res.error);

    document.getElementById('postCaption').value = '';
    document.getElementById('postMediaUrl').value = '';
    renderPostPreview();
    clearMedia();
    closeCreateModal();
    toast(res.message);
    loadFeed();
  }).catch(function (err) {
    setLoading(btn, false);
    show('postError', err.message);
  });
}

function removePost(postId) {
  if (!confirm('Delete this post?')) return;
  api('deletePost', postId).then(function (res) {
    if (!res.ok) return toast(res.error, 'error');
    toast(res.message);
    loadFeed();
  }).catch(function (err) { toast(err.message, 'error'); });
}

// ============================================================== LIVE CAMERA
/**
 * Selfie / webcam capture with live filter preview.
 *
 * getUserMedia gives a MediaStream; the frames are drawn to a canvas on every
 * animation frame with the chosen look applied, so what you see moving is
 * exactly what gets captured. Snapping simply stops the loop and hands the last
 * frame to the same studio pipeline the file picker uses, which means filters,
 * effects and stickers all behave identically either way.
 *
 * On the honest limits: these are colour/light effects and overlays. Snapchat's
 * dog ears track facial landmarks, which needs a face-mesh model (MediaPipe or
 * similar, several megabytes of weights) running per frame. That is a different
 * class of feature and is not pretended at here.
 */
const cam = {
  stream: null,
  facing: 'user',      // 'user' = selfie, 'environment' = rear
  raf: null,
  mirrored: true,
  ready: false
};

async function openCamera(facing) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return toast('This browser cannot reach the camera.', 'error');
  }

  cam.facing = facing || cam.facing;
  // A selfie feels wrong unless it is mirrored, the way a real mirror behaves.
  cam.mirrored = cam.facing === 'user';

  closeCameraStream();
  document.getElementById('cameraModal').classList.remove('hidden');
  document.getElementById('cameraError').classList.add('hidden');
  buildCameraControls();
  icons();

  try {
    cam.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: cam.facing, width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: false
    });
  } catch (err) {
    const message = err && err.name === 'NotAllowedError'
      ? 'Camera permission was denied. Allow it in your browser settings and try again.'
      : (err && err.name === 'NotFoundError'
          ? 'No camera was found on this device.'
          : 'The camera could not be opened: ' + (err && err.message ? err.message : err));
    const box = document.getElementById('cameraError');
    box.textContent = message;
    box.classList.remove('hidden');
    return;
  }

  const video = document.getElementById('cameraVideo');
  video.srcObject = cam.stream;
  await video.play().catch(function () { /* autoplay policies; the loop still draws */ });
  cam.ready = true;
  drawCameraFrame();
}

function drawCameraFrame() {
  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('cameraCanvas');
  if (!canvas || !cam.stream) return;

  if (video.videoWidth) {
    // Square crop, centred: a portrait frame is what people expect from a
    // selfie, and it keeps the captured aspect predictable.
    const side = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - side) / 2;
    const sy = (video.videoHeight - side) / 2;
    const size = Math.min(720, side);

    if (canvas.width !== size) { canvas.width = size; canvas.height = size; }

    const ctx = canvas.getContext('2d');
    const filter = PHOTO_FILTERS.filter(function (f) { return f.key === studio.filter; })[0];

    ctx.save();
    if (cam.mirrored) { ctx.translate(size, 0); ctx.scale(-1, 1); }
    ctx.filter = 'none';
    ctx.drawImage(video, sx, sy, side, side, 0, 0, size, size);
    if (filter && filter.css && studio.intensity > 0) {
      ctx.globalAlpha = studio.intensity;
      ctx.filter = filter.css;
      ctx.drawImage(video, sx, sy, side, side, 0, 0, size, size);
      ctx.globalAlpha = 1;
      ctx.filter = 'none';
    }
    ctx.restore();

    // Effects and stickers draw unmirrored, so text-bearing emoji read correctly.
    paintOverlays(ctx, size, size);
  }

  cam.raf = requestAnimationFrame(drawCameraFrame);
}

function buildCameraControls() {
  document.getElementById('camFilterRow').innerHTML = PHOTO_FILTERS.map(function (f) {
    const on = studio.filter === f.key;
    return '<button type="button" onclick="setCameraFilter(\'' + f.key + '\')" ' +
      'class="shrink-0 px-3 py-1.5 rounded-xl text-[10px] font-semibold border transition-all ' +
      (on ? 'bg-indigo-500/25 border-indigo-400/50 text-indigo-100'
          : 'bg-black/40 border-white/10 text-slate-300 hover:text-white') + '">' +
      esc(f.label) + '</button>';
  }).join('');

  document.getElementById('camEffectRow').innerHTML = OVERLAYS.map(function (o) {
    const on = !!studio.overlays[o.key];
    return '<button type="button" onclick="toggleCameraOverlay(\'' + o.key + '\')" ' +
      'class="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-all ' +
      (on ? 'bg-indigo-500/25 border-indigo-400/50 text-indigo-100'
          : 'bg-black/40 border-white/10 text-slate-300') + '">' + esc(o.label) + '</button>';
  }).join('') + STICKERS.map(function (st) {
    const on = !!studio.stickers[st.key];
    return '<button type="button" onclick="toggleCameraSticker(\'' + st.key + '\')" ' +
      'class="w-8 h-8 rounded-lg text-base leading-none border transition-all ' +
      (on ? 'bg-indigo-500/25 border-indigo-400/50' : 'bg-black/40 border-white/10') + '">' +
      st.emoji + '</button>';
  }).join('');
}

function setCameraFilter(key) { studio.filter = key; buildCameraControls(); }
function toggleCameraOverlay(key) { studio.overlays[key] = !studio.overlays[key]; buildCameraControls(); }
function toggleCameraSticker(key) { studio.stickers[key] = !studio.stickers[key]; buildCameraControls(); }

function setCameraIntensity(value) {
  studio.intensity = Number(value) / 100;
  document.getElementById('camIntensityValue').textContent = value + '%';
}

function flipCamera() {
  openCamera(cam.facing === 'user' ? 'environment' : 'user');
}

function toggleMirror() {
  cam.mirrored = !cam.mirrored;
  toast(cam.mirrored ? 'Mirrored' : 'Unmirrored');
}

/**
 * Freezes the current frame and routes it into the studio, so the captured
 * shot goes through exactly the same edit-and-publish path as a chosen file.
 */
function captureFromCamera() {
  const canvas = document.getElementById('cameraCanvas');
  if (!canvas || !canvas.width) return toast('The camera is still starting.', 'error');

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  closeCamera();

  const img = new Image();
  img.onload = function () {
    studio.image = img;
    studio.kind = 'IMAGE';
    studio.file = { type: 'image/jpeg', name: 'capture.jpg', size: dataUrl.length };

    if (cam.target === 'AVATAR' || cam.target === 'BANNER') {
      uploadProfileImage(cam.target, canvas);
      return;
    }

    document.getElementById('createModal').classList.remove('hidden');
    setPostSource('UPLOAD');
    document.getElementById('videoPane').classList.add('hidden');
    document.getElementById('studio').classList.remove('hidden');
    buildStudioControls();
    renderStudio();
    icons();
  };
  img.src = dataUrl;
}

function closeCameraStream() {
  if (cam.raf) { cancelAnimationFrame(cam.raf); cam.raf = null; }
  if (cam.stream) {
    // Every track must be stopped or the camera light stays on.
    cam.stream.getTracks().forEach(function (track) { track.stop(); });
    cam.stream = null;
  }
  cam.ready = false;
}

function closeCamera() {
  closeCameraStream();
  document.getElementById('cameraModal').classList.add('hidden');
}

/** Opens the camera aimed at a profile picture or banner rather than a post. */
function openCameraFor(target) {
  cam.target = target || 'POST';
  studio.overlays = {};
  studio.stickers = {};
  openCamera(target === 'BANNER' ? 'environment' : 'user');
}

// ==================================================== PROFILE IMAGE UPLOAD
/**
 * Profile picture and banner. Both run through the same downscale-and-upload
 * path; only the target dimensions and the field they write differ.
 */
const PROFILE_IMAGE_SPECS = {
  AVATAR: { edge: 512, square: true, field: 'avatarUrl', label: 'Profile picture' },
  BANNER: { edge: 1600, square: false, field: 'bannerUrl', label: 'Banner' }
};

function pickProfileImage(target) {
  const input = document.getElementById('profileImageFile');
  input.dataset.target = target;
  input.click();
}

function handleProfileImagePicked(file, target) {
  if (!file) return;
  if (!/^image\//.test(file.type)) return toast('Choose an image file.', 'error');

  const reader = new FileReader();
  reader.onload = function () {
    const img = new Image();
    img.onload = function () {
      const spec = PROFILE_IMAGE_SPECS[target] || PROFILE_IMAGE_SPECS.AVATAR;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (spec.square) {
        // Centre-crop to a square so an avatar is never stretched.
        const side = Math.min(img.width, img.height);
        canvas.width = canvas.height = Math.min(spec.edge, side);
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side,
                      0, 0, canvas.width, canvas.height);
      } else {
        // Banners keep a 3:1 letterbox.
        const targetWidth = Math.min(spec.edge, img.width);
        const targetHeight = Math.round(targetWidth / 3);
        const cropHeight = Math.min(img.height, Math.round(img.width / 3));
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        ctx.drawImage(img, 0, (img.height - cropHeight) / 2, img.width, cropHeight,
                      0, 0, targetWidth, targetHeight);
      }

      uploadProfileImage(target, canvas);
    };
    img.onerror = function () { toast('That image could not be read.', 'error'); };
    img.src = reader.result;
  };
  reader.onerror = function () { toast('That file could not be read.', 'error'); };
  reader.readAsDataURL(file);
}

function uploadProfileImage(target, sourceCanvas) {
  const spec = PROFILE_IMAGE_SPECS[target] || PROFILE_IMAGE_SPECS.AVATAR;
  toast('Uploading ' + spec.label.toLowerCase() + '…');

  const encoded = canvasToBase64(sourceCanvas);
  api('uploadMedia', { data: encoded.data, mimeType: encoded.mimeType, purpose: target })
    .then(function (res) {
      if (!res.ok) return toast(res.error, 'error');

      const patch = {};
      patch[spec.field] = res.url;
      return api('updateProfile', patch).then(function (saved) {
        if (!saved.ok) return toast(saved.error, 'error');

        state.user = saved.user;
        document.getElementById('headerAvatar').innerHTML =
          avatarWithRosette(saved.user, 'w-7 h-7', 'text-[10px]', 14);
        toast(spec.label + ' updated.');
        viewProfile(state.user.id);
      });
    })
    .catch(function (err) { toast(err.message, 'error'); });
}

