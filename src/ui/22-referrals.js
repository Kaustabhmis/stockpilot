/* ---------- referrals and the partner dashboard (Domebox only) ---------------
   ?ref=CODE on any link is remembered for 30 days in this browser and sent with
   the sign-up. The Plans window has "Invite a business": the company's own
   link, ways to share it, and who has signed up with it. ?partner=KEY opens a
   partner's private dashboard, without signing in. */

(function rememberRef() {
  try {
    var code = new URLSearchParams(location.search).get('ref');
    if (code && /^[A-Za-z0-9]{4,12}$/.test(code)) localStorage.setItem('dbx-ref', JSON.stringify({ code: code.toUpperCase(), at: Date.now() }));
  } catch (e) {}
})();

/** The code a visitor arrived with, if it is under 30 days old. */
function savedRef() {
  try {
    var r = JSON.parse(localStorage.getItem('dbx-ref') || 'null');
    return r && r.code && Date.now() - r.at < 30 * 86400000 ? r.code : '';
  } catch (e) { return ''; }
}

function openInvite() {
  if (LITE || !isAdmin()) return;
  openModal('<div class="p-6 lg:p-7"><div class="flex justify-between items-start mb-1">' +
    '<h2 class="text-2xl font-black">Invite a business</h2>' +
    '<button onclick="closeModal()" class="text-gray-400" aria-label="Close"><span class="material-icons">close</span></button></div>' +
    '<div id="invBody"><p class="text-sm font-bold text-gray-400">Loading…</p></div></div>', 'max-w-xl');
  api('getReferrals').then(function (r) {
    var share = 'We run our team on Domebox — every job has an owner and a deadline, and nobody has to chase. ' +
      'Try it free for 14 days: ' + r.link;
    $('invBody').innerHTML =
      '<p class="text-sm text-gray-500 font-semibold mb-5">Know a business that would run better on Domebox? Share your link. ' +
        'When they become a paying customer, you get <b>' + r.rewardDays + ' days free</b> on your plan.</p>' +
      '<label class="lb" for="invLink">Your link</label>' +
      '<div class="flex gap-2 mb-3"><input id="invLink" class="in" readonly value="' + esc(r.link) + '">' +
        '<button type="button" id="invCopy" class="btn btn-p whitespace-nowrap">Copy</button></div>' +
      '<div class="flex flex-wrap gap-2 mb-6">' +
        '<a class="btn btn-g text-xs" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(share) + '">Share on WhatsApp</a>' +
        '<a class="btn btn-g text-xs" href="mailto:?subject=' + encodeURIComponent('Have a look at Domebox') + '&body=' + encodeURIComponent(share) + '">Email it</a>' +
        '<a class="btn btn-g text-xs" target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(r.link) + '">LinkedIn</a></div>' +
      '<div class="grid grid-cols-3 gap-3 mb-5">' +
        invTile(r.referrals.length, 'Signed up') +
        invTile(r.referrals.filter(function (x) { return x.status === 'rewarded' || x.status === 'banked'; }).length, 'Paying') +
        invTile(r.earnedDays + r.bankedDays, 'Days earned') + '</div>' +
      (r.bankedDays ? '<p class="text-xs font-bold text-amber-700 mb-4">' + r.bankedDays + ' free days are saved for you — they are added when you next choose a plan.</p>' : '') +
      (r.referrals.length ? '<div class="border border-gray-100 rounded-2xl divide-y divide-gray-100">' +
        r.referrals.slice().reverse().map(function (x) {
          var st = x.status === 'rewarded' ? '<span class="text-emerald-700">+' + x.days + ' days</span>'
                 : x.status === 'banked' ? '<span class="text-amber-700">' + x.days + ' days saved</span>'
                 : '<span class="text-gray-400">Signed up · not paying yet</span>';
          return '<div class="flex justify-between gap-3 p-3 text-sm"><span class="font-bold">' + esc(x.company) +
            ' <span class="text-gray-400 font-semibold text-xs">' + esc(x.when) + '</span></span><span class="font-black text-xs">' + st + '</span></div>';
        }).join('') + '</div>'
        : '<p class="text-sm text-gray-400 font-semibold">Nobody has signed up with your link yet.</p>');
    $('invCopy').addEventListener('click', function () {
      var done = function () { toast('Link copied.', 'ok'); };
      try { navigator.clipboard.writeText(r.link).then(done, function () { $('invLink').select(); document.execCommand('copy'); done(); }); }
      catch (e) { $('invLink').select(); document.execCommand('copy'); done(); }
    });
  }).catch(function (e) { $('invBody').innerHTML = '<p class="text-sm font-bold text-red-700">' + esc(e.message) + '</p>'; });
}

function invTile(v, k) {
  return '<div class="bg-white border border-gray-100 rounded-2xl p-3 text-center"><div class="text-2xl font-black">' + esc(v) + '</div>' +
    '<div class="text-[10px] font-black uppercase tracking-wide text-gray-500">' + esc(k) + '</div></div>';
}

/* ---- the partner's own page ---------------------------------------------- */

function openPartnerDashboard(key) {
  ['view-home', 'view-auth', 'view-app'].forEach(function (id) { if ($(id)) $(id).classList.add('hidden'); });
  var box = document.createElement('main');
  box.id = 'partnerView';
  box.className = 'min-h-screen bg-gray-50';
  box.innerHTML = '<div class="bg-[#0b1b3a] text-white"><div class="max-w-4xl mx-auto px-4 py-6">' +
    '<div class="text-sm font-black opacity-80">Domebox · Partner dashboard</div>' +
    '<h1 id="pvName" class="text-2xl font-black mt-1">Loading…</h1></div></div>' +
    '<div id="pvBody" class="max-w-4xl mx-auto px-4 py-6"></div>';
  document.body.appendChild(box);
  /* The key is in the address bar only until the page has read it. */
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  api('getPartnerDashboard', { key: key }).then(function (r) {
    $('pvName').textContent = r.partner.name + (r.partner.firm ? ' · ' + r.partner.firm : '');
    var money = function (v) { return '₹' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); };
    $('pvBody').innerHTML =
      (!r.partner.active ? '<div class="bg-amber-50 text-amber-800 font-bold text-sm rounded-2xl p-4 mb-4">Your partner account is paused. Write to us to switch it back on.</div>' : '') +
      '<div class="bg-white rounded-3xl border border-gray-100 p-5 mb-4">' +
        '<div class="lb">Your link to share</div><div class="flex gap-2"><input id="pvLink" class="in" readonly value="' + esc(r.link) + '">' +
        '<button id="pvCopy" class="btn btn-p">Copy</button></div>' +
        '<p class="text-xs text-gray-500 font-semibold mt-2">You earn <b>' + esc(r.partner.pct) + '%</b> of every payment (before GST) from each company that signs up with your link, for as long as it pays.</p></div>' +
      '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">' +
        invTile(r.companies.length, 'Companies') + invTile(r.companies.filter(function (c) { return c.paying; }).length, 'Paying') +
        invTile(money(r.earned), 'Earned') + invTile(money(r.due), 'Due to you') + '</div>' +
      '<div class="bg-white rounded-3xl border border-gray-100 p-5 mb-4"><h2 class="font-black mb-3">Your companies</h2>' +
        (r.companies.length ? '<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="text-left text-xs text-gray-500">' +
          '<th class="py-2">Company</th><th>Since</th><th>Plan</th><th class="text-right">Your commission</th></tr></thead><tbody>' +
          r.companies.map(function (c) { return '<tr class="border-t border-gray-100"><td class="py-2 font-bold">' + esc(c.company) + '</td><td>' + esc(c.since) +
            '</td><td>' + esc(c.paying ? c.plan : 'Not paying yet') + '</td><td class="text-right font-black">' + money(c.commission) + '</td></tr>'; }).join('') +
          '</tbody></table></div>' : '<p class="text-sm text-gray-400 font-semibold">Nobody has signed up with your link yet.</p>') + '</div>' +
      '<div class="bg-white rounded-3xl border border-gray-100 p-5"><h2 class="font-black mb-3">Payments</h2>' +
        (r.payments.length ? '<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="text-left text-xs text-gray-500">' +
          '<th class="py-2">Date</th><th>Company</th><th class="text-right">Paid (before GST)</th><th class="text-right">Commission</th><th class="text-right">Paid to you</th></tr></thead><tbody>' +
          r.payments.map(function (p) { return '<tr class="border-t border-gray-100"><td class="py-2">' + esc(p.when) + '</td><td>' + esc(p.company) +
            '</td><td class="text-right">' + money(p.net) + '</td><td class="text-right font-black">' + money(p.commission) + '</td><td class="text-right">' +
            (p.paidOut ? '<span class="text-emerald-700 font-bold">' + esc(p.paidOut) + '</span>' : '<span class="text-amber-700 font-bold">Due</span>') + '</td></tr>'; }).join('') +
          '</tbody></table></div>' : '<p class="text-sm text-gray-400 font-semibold">No payments yet.</p>') +
        '<p class="text-xs text-gray-400 font-semibold mt-4">Questions about a payout? Write to info@biscsindia.com with your code ' + esc(r.partner.code) + '.</p></div>';
    $('pvCopy').addEventListener('click', function () {
      try { navigator.clipboard.writeText(r.link).then(function () { toast('Link copied.', 'ok'); }); } catch (e) { $('pvLink').select(); document.execCommand('copy'); }
    });
  }).catch(function (e) {
    $('pvName').textContent = 'Partner dashboard';
    $('pvBody').innerHTML = '<div class="bg-white rounded-3xl border border-gray-100 p-6 font-bold text-red-700">' + esc(e.message) + '</div>';
  });
}
