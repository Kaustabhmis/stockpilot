/* app.js — API client, session storage and shared UI helpers. */

(function () {
  'use strict';

  var CFG = window.GB_CONFIG || {};
  var TOKEN_KEY = 'gb_token';
  var USER_KEY = 'gb_referrer';

  // ------------------------------------------------------------- storage
  // localStorage can throw (private mode, blocked site data), so every access
  // is guarded and the page must still work when it comes back empty.

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  var Session = {
    token: function () { return lsGet(TOKEN_KEY) || ''; },
    user: function () {
      try { return JSON.parse(lsGet(USER_KEY) || 'null'); } catch (e) { return null; }
    },
    save: function (token, referrer) {
      lsSet(TOKEN_KEY, token);
      lsSet(USER_KEY, JSON.stringify(referrer || {}));
    },
    update: function (referrer) { lsSet(USER_KEY, JSON.stringify(referrer || {})); },
    clear: function () { lsDel(TOKEN_KEY); lsDel(USER_KEY); },
    isLoggedIn: function () { return !!lsGet(TOKEN_KEY); }
  };

  // ------------------------------------------------------------- api

  /**
   * Calls the Apps Script web app.
   * Content-Type stays text/plain so the browser sends no CORS preflight —
   * Apps Script does not answer OPTIONS requests.
   */
  function api(action, payload) {
    if (!CFG.API_URL || CFG.API_URL.indexOf('PASTE_') === 0) {
      return Promise.reject(new Error('API_URL is not set in assets/config.js'));
    }
    return fetch(CFG.API_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, payload: payload || {}, token: Session.token() })
    })
      .then(function (res) { return res.text(); })
      .then(function (text) {
        var json;
        try { json = JSON.parse(text); }
        catch (e) { throw new Error('Server returned an unexpected response. Check the deployment URL.'); }
        if (!json.ok) {
          var err = new Error(json.error || 'Something went wrong');
          err.code = json.code;
          throw err;
        }
        return json.data;
      });
  }

  /** Sends the user to login when their session has lapsed. */
  function guard(err) {
    if (err && err.code === 'unauthorised') {
      Session.clear();
      location.href = 'login.html?next=' + encodeURIComponent(location.pathname.split('/').pop());
      return true;
    }
    return false;
  }

  function requireLogin() {
    if (!Session.isLoggedIn()) {
      location.href = 'login.html?next=' + encodeURIComponent(location.pathname.split('/').pop());
      return false;
    }
    return true;
  }

  // ------------------------------------------------------------- formatting

  /** ₹ in the Indian numbering system: 12,34,567 rather than 1,234,567. */
  function rupees(n, opts) {
    var v = Number(n) || 0;
    var s = v.toLocaleString('en-IN', {
      maximumFractionDigits: (opts && opts.decimals) || 0,
      minimumFractionDigits: 0
    });
    return '₹' + s;
  }

  /** Short Indian form: 85 L, 1.25 Cr — how buyers actually talk about price. */
  function rupeesShort(n) {
    var v = Number(n) || 0;
    if (v >= 10000000) return '₹' + trimZeros(v / 10000000) + ' Cr';
    if (v >= 100000)   return '₹' + trimZeros(v / 100000) + ' L';
    if (v >= 1000)     return '₹' + trimZeros(v / 1000) + ' K';
    return '₹' + v;
  }

  function trimZeros(x) {
    return String(Math.round(x * 100) / 100).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  /**
   * Accepts what people actually type: "85 lakh", "1.2 cr", "8500000", "85L".
   * Returns rupees, or null if it cannot be read.
   */
  function parseAmount(input) {
    var s = String(input || '').trim().toLowerCase().replace(/[₹,\s]/g, '');
    if (!s) return null;
    var m = s.match(/^(\d+(?:\.\d+)?)(cr|crore|crores|l|lac|lakh|lakhs|k)?$/);
    if (!m) return null;
    var n = parseFloat(m[1]);
    if (isNaN(n)) return null;
    var unit = m[2] || '';
    if (unit.indexOf('cr') === 0) return n * 10000000;
    if (unit === 'l' || unit.indexOf('la') === 0) return n * 100000;
    if (unit === 'k') return n * 1000;
    return n;
  }

  var STAGE_LABELS = {
    new: 'New', contacted: 'Contacted', visit_scheduled: 'Visit scheduled',
    visited: 'Visited', negotiation: 'In negotiation', booked: 'Booked',
    registered: 'Registered', rejected: 'Not converted', duplicate: 'Duplicate',
    expired: 'Expired', payable: 'Payable', paid: 'Paid', cancelled: 'Cancelled'
  };

  function stagePill(stage) {
    var s = String(stage || '').toLowerCase();
    var el = document.createElement('span');
    el.className = 'pill pill-' + s;
    el.textContent = STAGE_LABELS[s] || s || '—';
    return el;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // ------------------------------------------------------------- dom

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function show(el, text, kind) {
    if (!el) return;
    el.textContent = text;
    el.className = 'msg msg-' + (kind || 'error');
    el.hidden = false;
  }
  function hide(el) { if (el) el.hidden = true; }

  function busy(btn, on, busyLabel) {
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.textContent;
      btn.textContent = busyLabel || 'Please wait…';
      btn.disabled = true;
    } else {
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
      btn.disabled = false;
    }
  }

  function siteUrl() {
    if (CFG.SITE_URL) return CFG.SITE_URL.replace(/\/$/, '');
    var path = location.pathname.replace(/[^/]*$/, '');
    return location.origin + path.replace(/\/$/, '');
  }

  function referLink(code) {
    return siteUrl() + '/refer.html?ref=' + encodeURIComponent(code || '');
  }

  function copy(text, btn) {
    var done = function () {
      if (!btn) return;
      var old = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = old; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) {}
    document.body.removeChild(ta);
  }

  /** Renders the header nav according to login state. */
  function paintNav() {
    var nav = $('[data-nav]');
    if (!nav) return;
    var page = location.pathname.split('/').pop() || 'index.html';
    // The third entry marks a link that may be dropped on a narrow screen.
    var links = Session.isLoggedIn()
      ? [['dashboard.html', 'Dashboard'], ['refer.html', 'Refer a buyer'], ['#logout', 'Log out']]
      : [['index.html', 'How it works', true], ['login.html', 'Log in'], ['signup.html', 'Join free']];

    nav.innerHTML = '';
    links.forEach(function (l) {
      var a = document.createElement('a');
      a.href = l[0];
      a.textContent = l[1];
      if (l[0] === page) a.className = 'active';
      if (l[2]) a.className += ' nav-optional';
      if (l[0] === '#logout') {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          api('logout', { token: Session.token() }).catch(function () {}).then(function () {
            Session.clear();
            location.href = 'index.html';
          });
        });
      }
      nav.appendChild(a);
    });
  }

  /** Fills every [data-brand] element once the rate card is known. */
  var ratesPromise = null;
  function rates() {
    if (!ratesPromise) ratesPromise = api('rates', {});
    return ratesPromise;
  }

  window.GB = {
    api: api, Session: Session, guard: guard, requireLogin: requireLogin,
    rupees: rupees, rupeesShort: rupeesShort, parseAmount: parseAmount,
    stagePill: stagePill, STAGE_LABELS: STAGE_LABELS, fmtDate: fmtDate,
    $: $, $$: $$, show: show, hide: hide, busy: busy,
    referLink: referLink, siteUrl: siteUrl, copy: copy,
    paintNav: paintNav, rates: rates
  };

  document.addEventListener('DOMContentLoaded', paintNav);
})();
