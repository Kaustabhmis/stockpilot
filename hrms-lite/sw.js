/* Service worker for the installed app.
 *
 * The rule is simple and deliberate: the app shell is cached so it opens
 * instantly and survives a dead signal, but anything going to the workspace
 * (attendance, punches, payslips) always goes to the network. A punch must
 * never be answered out of a cache, and a stale payslip would be worse than
 * no payslip.
 */
var CACHE = 'biscs-os-v3';
var SHELL = ['./index.html', './manifest.webmanifest',
             './app/icons/icon-192.png', './app/icons/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(SHELL);
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  /* Only our own old copies. The phone app keeps its shell in a cache of
     its own on this same site, and clearing everything would wipe it - so
     each one would delete the other's offline copy every time it opened. */
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) {
      return k !== CACHE && k.indexOf('biscs-os-') === 0;
    }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                       // punches are POSTs
  if (req.url.indexOf('script.google.com') >= 0) return;  // never cache the workspace

  /* The page itself: hand over the copy we already have straight away and
     fetch a fresh one behind it, which the next open uses. The page is half
     a megabyte, so waiting for it over a phone connection was a second or
     two of blank screen every single time it was opened.

     Nothing goes stale by this. None of the data is in the page: attendance,
     punches and payslips are always fetched from the workspace and are never
     served from here. What it costs is that a redeploy shows up one open
     later - open it twice after putting a new copy on the site. */
  if (req.mode === 'navigate' || req.destination === 'document') {
    /* The phone app lives under /app/ and has a service worker of its own.
       This one is registered at the top of the site, so without this line it
       would answer the phone app's address with the HR page - and then store
       that fetch as the HR shell. Hands it back to the app. */
    if (new URL(req.url).pathname.indexOf('/app/') >= 0) return;
    e.respondWith(
      caches.match('./index.html').then(function (hit) {
        var fresh = fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
          return res;
        });
        if (hit) {
          /* it is fetched anyway, for next time; a dead signal is not an
             error worth reporting when we already have the page */
          fresh.catch(function () { /* offline - the cached copy is serving */ });
          return hit;
        }
        return fresh.catch(function () { return caches.match('./index.html'); });
      })
    );
    return;
  }
  e.respondWith(caches.match(req).then(function (hit) { return hit || fetch(req); }));
});
