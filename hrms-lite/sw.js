/* Service worker for the installed app.
 *
 * The rule is simple and deliberate: the app shell is cached so it opens
 * instantly and survives a dead signal, but anything going to the workspace
 * (attendance, punches, payslips) always goes to the network. A punch must
 * never be answered out of a cache, and a stale payslip would be worse than
 * no payslip.
 */
var CACHE = 'biscs-os-v1';
var SHELL = ['./index.html', './manifest.webmanifest',
             './app/icons/icon-192.png', './app/icons/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(SHELL);
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                       // punches are POSTs
  if (req.url.indexOf('script.google.com') >= 0) return;  // never cache the workspace

  /* The page itself: try the network so a redeploy is picked up straight
     away, fall back to the cached copy when there is no signal. */
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html');
      })
    );
    return;
  }
  e.respondWith(caches.match(req).then(function (hit) { return hit || fetch(req); }));
});
