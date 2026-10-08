/* ---------------------------------------------------------------------------
   HELP CENTRE

   The user manual, inside the app. HELP is injected at build time from
   MANUAL.md by web/_build/manual.js — the same file handed to customers, and
   the same file tests/manual-test.js holds against the code. So the help a
   person reads here cannot drift from the product, and cannot drift from the
   manual either.

   Three things make it help rather than a document:

     · It opens where you are. Press ? on the Priority tab and you land on
       Priority, not on a table of contents you then have to search.
     · It searches as you type, across every section, and says how many places
       matched — "score" is in nine sections and the right one is rarely the
       first.
     · It ends at a person. Every section closes with "Still stuck?", because
       help that cannot hand you on is just a longer way of being stuck.
--------------------------------------------------------------------------- */

var HC = { section: null, query: '', tab: null };

function helpSections() {
  var all = (typeof HELP !== 'undefined' && HELP.sections) || [];
  /* Everyone sees every section — knowing how your manager is measured is part
     of trusting your own score — but a Doer's list puts their own work first
     and the managing-people sections after it, labelled. */
  if (STATE.user && STATE.user.role === 'Doer') {
    return all.filter(function (s) { return !s.managers; })
              .concat(all.filter(function (s) { return s.managers; }));
  }
  return all;
}

/**
 * @param sectionId  optional — open on this section. Omitted, it opens on the
 *                   section for the tab you are on.
 */
function openHelp(sectionId) {
  /* There is one modal, so opening help replaces whatever is in it. That is
     fine over a read-only screen and a real loss over a half-filled form — a
     task description typed and then thrown away by pressing ?. So if the open
     modal holds a form with anything in it, help waits. */
  var m = $('modal');
  if ($('scrim').classList.contains('on') && m && !m.classList.contains('hc-modal')) {
    var dirty = Array.prototype.some.call(m.querySelectorAll('input,textarea'), function (el) {
      if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'hidden') return el.checked && !el.defaultChecked;
      return el.value && el.value !== el.defaultValue;
    });
    if (dirty) { toast('Finish or cancel this first — help would replace it.', 'info'); return; }
  }
  var secs = helpSections();
  if (!secs.length) { openSupport(''); return; }      // a build without the manual still gets you to a person

  var fromTab = (typeof HELP !== 'undefined' && HELP.forTab) ? HELP.forTab[STATE.tab] : null;
  /* Asked from the same tab as last time, resume where you were reading —
     closing help to try something and coming back is the common case. Asked
     from a different tab, open on that tab's section: pressing ? on Projects
     and landing on the Scores page you read an hour ago is help being
     unhelpful. The tab is remembered for exactly this comparison. */
  var sameTab = HC.tab === STATE.tab;
  HC.tab = STATE.tab;
  HC.section = sectionId || (sameTab && HC.section) || fromTab || HC.section || secs[0].id;
  if (!secs.some(function (s) { return s.id === HC.section; })) HC.section = secs[0].id;
  HC.query = '';

  openModal('<div class="hc">' +
    '<div class="hc-side">' +
      '<div class="flex items-center justify-between mb-3">' +
        '<h2 class="text-xl font-black">Help</h2>' +
        '<button onclick="closeModal()" class="text-gray-400 md-down" aria-label="Close">' +
          '<span class="material-icons">close</span></button></div>' +
      '<div class="relative mb-3">' +
        '<span class="material-icons hc-searchicon">search</span>' +
        '<input id="hcQ" class="in hc-search" placeholder="Search help" autocomplete="off" ' +
          'aria-label="Search help"></div>' +
      '<div id="hcList" class="hc-nav" role="navigation"></div>' +
    '</div>' +
    '<div class="hc-main">' +
      '<div class="flex justify-end md-up mb-1">' +
        '<button onclick="closeModal()" class="text-gray-400" aria-label="Close">' +
          '<span class="material-icons">close</span></button></div>' +
      '<article id="hcBody" class="hc-body"></article>' +
    '</div></div>', 'max-w-5xl hc-modal');

  renderHelpList();
  renderHelpSection(HC.section);

  var q = $('hcQ');
  q.addEventListener('input', function () { HC.query = q.value.trim().toLowerCase(); renderHelpList(); });
  /* Enter opens the first match, so search-then-read is two keystrokes. */
  q.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var first = $('hcList').querySelector('[data-sec]');
    if (first) { e.preventDefault(); renderHelpSection(first.dataset.sec, true); }
  });
  /* On a phone the list and the article stack, so the search box would sit on
     top of the article you opened help to read. Focus it only where it is
     beside the article rather than above it. */
  if (window.matchMedia && window.matchMedia('(min-width:768px)').matches) setTimeout(function () { q.focus(); }, 30);
}

function helpMatches(s, q) {
  if (!q) return 0;
  var n = 0, i = s.text.indexOf(q);
  while (i > -1) { n++; i = s.text.indexOf(q, i + q.length); }
  return n;
}

function renderHelpList() {
  var secs = helpSections(), q = HC.query;
  var rows = secs.map(function (s) { return { s: s, n: helpMatches(s, q) }; });
  if (q) {
    rows = rows.filter(function (r) { return r.n > 0; });
    // the section that mentions it most is usually the one that is about it
    rows.sort(function (a, b) { return b.n - a.n; });
  }

  var html = '';
  if (q && !rows.length) {
    html = '<div class="text-xs font-bold text-gray-400 px-2 py-4">Nothing matches “' + esc(q) + '”.' +
      '<button class="hc-link block mt-2" onclick="openSupport(\'' + esc(q).replace(/'/g, '&#39;') +
      '\')">Ask us instead →</button></div>';
  } else {
    var managersHeaded = false;
    html = rows.map(function (r) {
      var head = '';
      if (!q && r.s.managers && !managersHeaded && STATE.user && STATE.user.role === 'Doer') {
        managersHeaded = true;
        head = '<div class="hc-group">How your managers work</div>';
      }
      return head + '<button class="hc-item' + (r.s.id === HC.section ? ' on' : '') + '" data-sec="' +
        esc(r.s.id) + '">' + '<span>' + esc(r.s.title) + '</span>' +
        (q ? '<span class="hc-count">' + r.n + '</span>'
           : (r.s.managers && STATE.user && STATE.user.role !== 'Doer' ? '' :
              r.s.managers ? '<span class="hc-tag">managers</span>' : '')) +
        '</button>';
    }).join('');
    if (q) html = '<div class="hc-group">' + rows.length +
      (rows.length === 1 ? ' section mentions' : ' sections mention') + ' “' + esc(q) + '”</div>' + html;
  }
  $('hcList').innerHTML = html;
  $('hcList').querySelectorAll('[data-sec]').forEach(function (b) {
    b.addEventListener('click', function () { renderHelpSection(b.dataset.sec, true); });
  });
}

/** Wraps search hits in <mark> — in text only, never inside a tag. */
function helpHighlight(html, q) {
  if (!q || q.length < 2) return html;
  var safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var re = new RegExp('(' + safe + ')', 'gi');
  return html.split(/(<[^>]+>)/).map(function (part) {
    return part.charAt(0) === '<' ? part : part.replace(re, '<mark>$1</mark>');
  }).join('');
}

/**
 * @param fromUser  true when somebody tapped to get here. Only then does a
 *                  phone scroll down to the article — doing it on first open
 *                  pushed the search box and the close button off the top of
 *                  the screen before the person had read a word.
 */
function renderHelpSection(id, fromUser) {
  var secs = helpSections();
  var s = secs.filter(function (x) { return x.id === id; })[0] || secs[0];
  HC.section = s.id;

  var i = secs.indexOf(s);
  var prev = secs[i - 1], next = secs[i + 1];

  $('hcBody').innerHTML =
    (s.managers ? '<div class="hc-tag mb-2 inline-block">For managers and admins</div>' : '') +
    '<h1 class="hc-h1">' + esc(s.title) + '</h1>' +
    helpHighlight(s.html, HC.query) +
    '<div class="hc-pager">' +
      (prev ? '<button class="hc-link" data-sec="' + esc(prev.id) + '">← ' + esc(prev.title) + '</button>' : '<span></span>') +
      (next ? '<button class="hc-link" data-sec="' + esc(next.id) + '">' + esc(next.title) + ' →</button>' : '<span></span>') +
    '</div>' +
    '<div class="hc-stuck">' +
      '<div><div class="font-black text-sm">Still stuck?</div>' +
      '<div class="text-xs font-semibold text-gray-500">We reply within one working day.</div></div>' +
      '<button class="btn btn-p" onclick="openSupport(\'Help: ' + esc(s.title).replace(/'/g, '&#39;') + '\')">' +
        'Contact support</button>' +
    '</div>';

  // links between sections stay inside the Help Centre
  $('hcBody').querySelectorAll('[data-go],[data-sec]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      renderHelpSection(a.dataset.go || a.dataset.sec, true);
    });
  });

  var main = $('hcBody').parentNode;
  if (main && main.scrollTo) main.scrollTo(0, 0);
  // on a phone, choosing a section should bring you to it, not leave you on the list
  if (fromUser && window.matchMedia && !window.matchMedia('(min-width:768px)').matches) {
    $('hcBody').scrollIntoView({ block: 'start' });
  }
  renderHelpList();
}

/* ? anywhere opens help — unless you are typing, when ? is just a character. */
document.addEventListener('keydown', function (e) {
  if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
  var t = e.target, tag = (t && t.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
  if (!STATE.user) return;                              // signed out: nothing to help with yet
  e.preventDefault();
  openHelp();
});
