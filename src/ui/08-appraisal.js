/* ---------- appraisal ---------------------------------------------------- */
function openAppraisal() {
  var staff = (STATE.data.staff || []).filter(function (u) { return u.active !== false; });
  openModal('<div class="p-6 lg:p-7">' +
    '<div class="flex justify-between items-start mb-1"><h2 class="text-2xl font-black">Appraisal</h2>' +
    '<button onclick="closeModal()" class="text-gray-400 hover:text-gray-900">' +
    '<span class="material-icons">close</span></button></div>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">The delegation half is measured from the task ' +
      'record. The rest is your judgement.</p>' +
    '<label class="lb" for="apWho">Person</label>' +
    '<select id="apWho" class="in mb-5"><option value="">Select…</option>' +
      staff.map(function (s) { return '<option value="'+esc(s.username)+'">'+esc(s.name)+
        ' · '+esc(s.jobProfile||s.role)+'</option>'; }).join('') + '</select>' +
    '<div id="apBody"></div></div>', 'max-w-3xl');
  $('apWho').addEventListener('change', function () {
    if (!this.value) { $('apBody').innerHTML = ''; return; }
    loadAppraisal(this.value);
  });
}

function loadAppraisal(username) {
  $('apBody').innerHTML = '<p class="text-sm text-gray-400 font-semibold">Loading…</p>';
  api('getAppraisalForm', { username: username }).then(function (f) {
    $('apBody').innerHTML =
      '<div class="bg-gray-50 rounded-2xl p-4 mb-5 flex items-center gap-5">' +
        '<div><div class="lb mb-0">Delegation score</div>' +
        '<div class="text-3xl font-black">' + (f.hasData ? f.delegationScore : '—') + '</div></div>' +
        '<div class="text-xs text-gray-500 font-semibold flex-1">' +
          (f.hasData ? 'Measured from their task record — on-time delivery, first-pass quality and queue health.'
                     : 'No closed work to measure yet, so this half carries no score.') +
          ' <button type="button" class="text-blue-600 font-black" onclick="showDelBreakdown()">See why</button></div>' +
      '</div>' +
      '<h3 class="font-black text-sm mb-2">KRA ratings</h3>' +
      (f.kras.length ? '<div class="space-y-2 mb-5">' + f.kras.map(function (k, i) {
        return '<div class="border border-gray-100 rounded-xl p-3">' +
          '<div class="flex justify-between items-center gap-3">' +
            '<span class="font-bold text-sm">' + esc(k.item || k.name) + '</span>' +
            '<span class="text-xs font-black text-blue-600 whitespace-nowrap">Weight ' + esc(k.weight) + '</span></div>' +
          (k.desc ? '<div class="text-xs text-gray-500 mt-1">' + esc(k.desc) + '</div>' : '') +
          '<select class="in mt-2 kraR" data-w="' + esc(k.weight) + '">' +
            '<option value="0">Not rated</option>' +
            [1,2,3,4,5].map(function (n) { return '<option value="'+n+'">'+n+' — '+
              ['Poor','Below average','Average','Good','Excellent'][n-1]+'</option>'; }).join('') +
          '</select></div>';
      }).join('') + '</div>'
      : '<p class="text-sm bg-amber-50 text-amber-900 rounded-xl p-3 mb-5 font-semibold">' +
        'No KRAs set for this job profile yet. Add them on the Team tab, under the person.</p>') +
      '<h3 class="font-black text-sm mb-2">Behaviour</h3>' +
      '<div class="space-y-2 mb-5">' + f.behaviors.map(function (b) {
        return '<div class="border border-gray-100 rounded-xl p-3">' +
          '<div class="flex justify-between items-center gap-3">' +
            '<span class="font-bold text-sm">' + esc(b.section) + '</span>' +
            '<span class="text-xs font-black text-purple-600 whitespace-nowrap">Weight ' + b.weight + '</span></div>' +
          '<div class="text-xs text-gray-500 mt-1">' + esc(b.question) + '</div>' +
          '<select class="in mt-2 behR" data-w="' + b.weight + '">' +
            '<option value="0">Not rated</option>' +
            [1,2,3,4,5].map(function (n) { return '<option value="'+n+'">'+n+'</option>'; }).join('') +
          '</select></div>';
      }).join('') + '</div>' +
      '<div class="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex justify-between items-center mb-5">' +
        '<div><div class="font-black text-yellow-900 text-sm">Brownie points</div>' +
        '<div class="text-xs text-yellow-700">For exceptional work the measures above miss. Capped at 5.</div></div>' +
        '<input id="apBrownie" type="number" min="0" max="5" value="0" class="in" style="max-width:80px;text-align:center"></div>' +
      '<div id="apPreview" class="text-sm font-bold text-gray-500 mb-4"></div>' +
      '<div class="flex gap-3">' +
        '<button class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-p flex-1" id="apSubmit">Submit review</button></div>';

    window.__apDel = f.delegationScore;
    window.__apBreak = f.delegationBreakdown || [];
    var preview = function () {
      var kra = Array.prototype.slice.call(document.querySelectorAll('.kraR'));
      var beh = Array.prototype.slice.call(document.querySelectorAll('.behR'));
      var rated = kra.filter(function (s) { return Number(s.value) > 0; }).length;
      $('apPreview').textContent = rated + ' of ' + kra.length + ' KRAs rated, ' +
        beh.filter(function (s) { return Number(s.value) > 0; }).length + ' of ' + beh.length + ' behaviours.';
    };
    document.querySelectorAll('.kraR,.behR').forEach(function (s) { s.addEventListener('change', preview); });
    preview();

    $('apSubmit').addEventListener('click', function () {
      var kras = Array.prototype.slice.call(document.querySelectorAll('.kraR')).map(function (s) {
        return { rating: Number(s.value), weight: Number(s.dataset.w) || 1 }; });
      var behs = Array.prototype.slice.call(document.querySelectorAll('.behR')).map(function (s) {
        return { rating: Number(s.value), weight: Number(s.dataset.w) || 1 }; });
      if (!kras.some(function (k) { return k.rating > 0; }) && !behs.some(function (b) { return b.rating > 0; })) {
        toast('Rate at least one item before submitting.', 'err'); return;
      }
      busy($('apSubmit'), true, 'Saving…');
      api('submitAppraisal', { data: { employee: username, delegationScore: f.delegationScore,
        kras: kras, behaviors: behs, brownie: Number($('apBrownie').value) || 0 } })
        .then(function (r) { toast(r.message, 'ok'); closeModal(); })
        .catch(function (e) { busy($('apSubmit'), false); toast(e.message, 'err'); });
    });
  }).catch(function (e) { $('apBody').innerHTML =
    '<p class="text-sm font-bold text-red-700">' + esc(e.message) + '</p>'; });
}

function showDelBreakdown() {
  var rows = window.__apBreak || [];
  openModal('<div class="p-6 lg:p-7"><div class="flex justify-between items-start mb-4">' +
    '<h2 class="text-xl font-black">How the delegation score was built</h2>' +
    '<button onclick="closeModal()" class="text-gray-400"><span class="material-icons">close</span></button></div>' +
    (rows.length ? '<table class="tbl"><thead><tr><th>Item</th><th>Reason</th><th>Impact</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td class="font-bold text-gray-800">'+esc(r.item)+'</td>' +
        '<td>'+esc(r.reason)+'</td><td class="font-black '+
        (String(r.impact).charAt(0)==='-'?'text-red-700':'text-emerald-700')+'">'+esc(r.impact)+'</td></tr>'; }).join('') +
      '</tbody></table>' : '<p class="text-sm text-gray-400 font-semibold">Nothing has affected it yet.</p>') +
    '</div>', 'max-w-2xl');
}

/* ---------- billing, AI, support, account -------------------------------- */
function openBilling() {
  var u = STATE.usage;
  var plans = [
    { key:'Free',    name:'Free Tier', price:'₹0',       per:'',     bullets:['5 users','50 tasks a month','Task tracking'] },
    { key:'Monthly', name:'Standard',  price:'₹2,499',   per:'/mo',  bullets:['20 users','500 tasks a month','Delegation scoring','Email alerts'] },
    { key:'Yearly',  name:'Pro',       price:'₹19,999',  per:'/yr',  bullets:['300 users','Unlimited tasks','Full reports','Custom KRA forms','WhatsApp alerts'] },
  ];
  openModal('<div class="p-6 lg:p-7">' +
    '<div class="flex justify-between items-start mb-1"><h2 class="text-2xl font-black">Plans</h2>' +
    '<button onclick="closeModal()" class="text-gray-400"><span class="material-icons">close</span></button></div>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">You are on <strong>' + esc(u.planName) + '</strong>' +
      (u.daysLeft !== null ? ', ' + (u.daysLeft >= 0 ? u.daysLeft + ' day(s) left' : 'expired') : '') + '.</p>' +
    '<div class="grid md:grid-cols-3 gap-4">' + plans.map(function (p) {
      var current = p.key === STATE.plan;
      return '<div class="border-2 rounded-2xl p-5 flex flex-col ' +
        (current ? 'border-blue-500 bg-blue-50' : 'border-gray-100') + '">' +
        '<div class="font-black text-lg">' + esc(p.name) + '</div>' +
        '<div class="text-2xl font-black mt-1">' + p.price + '<span class="text-sm font-bold text-gray-400">' + p.per + '</span></div>' +
        '<ul class="text-xs font-semibold text-gray-600 mt-3 space-y-1.5 flex-1">' +
          p.bullets.map(function (b) { return '<li>· ' + esc(b) + '</li>'; }).join('') + '</ul>' +
        (current ? '<div class="text-xs font-black text-blue-700 text-center mt-4 py-2">Current plan</div>'
          : p.key === 'Free' ? ''
          : '<button class="btn btn-p w-full mt-4 buy" data-plan="' + p.key + '">Upgrade</button>') +
        '</div>';
    }).join('') + '</div>' +
    '<div class="mt-5 flex gap-2 items-end">' +
      '<div class="flex-1"><label class="lb" for="promo">Promo code</label>' +
      '<input id="promo" class="in" placeholder="Optional"></div></div>' +
    '<p class="text-xs text-gray-400 font-semibold mt-4">Enterprise: unlimited users and tasks, ' +
      'custom integrations. <button class="text-blue-600 font-black" onclick="openSupport(\'Enterprise enquiry\')">Talk to us</button></p>' +
    '</div>', 'max-w-3xl');

  document.querySelectorAll('.buy').forEach(function (b) {
    b.addEventListener('click', function () { startCheckout(b.dataset.plan, $('promo').value); });
  });
}

function startCheckout(planName, promo) {
  if (typeof Razorpay === 'undefined') { toast('The payment library has not loaded. Refresh and try again.', 'err'); return; }
  toast('Starting payment…', 'info');
  api('initiateRazorpay', { planName: planName, promoCode: promo })
    .then(function (r) {
      var o = r.orderData;
      var rz = new Razorpay({
        key: o.key, order_id: o.order_id, amount: o.amount, currency: o.currency,
        name: o.name, description: o.description, prefill: o.prefill, theme: { color: '#2563eb' },
        /* The response object carries the signature. The old build used an empty
           parameter list here and threw it away, which is why nothing could be
           verified afterwards. */
        handler: function (response) {
          api('paymentSuccess', {
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_signature: response.razorpay_signature
          }).then(function (res) {
            toast(res.message, 'ok'); closeModal();
            STATE.plan = res.plan; return refresh();
          }).catch(function (e) { toast(e.message, 'err'); });
        },
        modal: { ondismiss: function () { toast('Payment cancelled.', 'info'); } }
      });
      rz.open();
    })
    .catch(function (e) { toast(e.message, 'err'); });
}

function openAi() {
  openModal('<div class="p-6 lg:p-7">' +
    '<div class="flex justify-between items-start mb-1">' +
    '<h2 class="text-2xl font-black flex items-center gap-2">' +
    '<span class="material-icons text-blue-600">auto_awesome</span> Executive insight</h2>' +
    '<button onclick="closeModal()" class="text-gray-400"><span class="material-icons">close</span></button></div>' +
    '<p class="text-sm text-gray-400 font-semibold mb-4">Ask about last month\'s delivery. Only summary ' +
      'figures are sent — never your staff records.</p>' +
    '<div class="flex flex-wrap gap-2 mb-3">' +
      ['What should I focus on this month?','Where is the biggest delay risk?',
       'Who needs support?','Is quality improving?'].map(function (q) {
        return '<button class="btn btn-g text-xs py-2 qq">' + esc(q) + '</button>'; }).join('') + '</div>' +
    '<textarea id="aiQ" rows="2" class="in mb-3" placeholder="Ask anything about your team\'s delivery…"></textarea>' +
    '<button class="btn btn-p w-full" id="aiGo">Ask</button>' +
    '<div id="aiOut" class="mt-5"></div></div>', 'max-w-2xl');
  document.querySelectorAll('.qq').forEach(function (b) {
    b.addEventListener('click', function () { $('aiQ').value = b.textContent; $('aiGo').click(); }); });
  $('aiGo').addEventListener('click', function () {
    var q = $('aiQ').value.trim();
    if (!q) { toast('Type a question first.', 'err'); return; }
    busy($('aiGo'), true, 'Thinking…');
    $('aiOut').innerHTML = '';
    api('aiInsight', { question: q })
      .then(function (r) {
        busy($('aiGo'), false);
        $('aiOut').innerHTML = '<div class="bg-blue-50 border border-blue-100 rounded-2xl p-5">' +
          '<div class="text-sm text-gray-800 leading-relaxed whitespace-pre-line">' + esc(r.answer) + '</div>' +
          '<div class="text-[11px] font-bold text-blue-700 mt-3">Based on ' + esc(r.basedOn) + '</div></div>';
      })
      .catch(function (e) { busy($('aiGo'), false);
        $('aiOut').innerHTML = '<p class="text-sm font-bold text-red-700">' + esc(e.message) + '</p>'; });
  });
}

function openSupport(subject) {
  openModal('<form id="fSup" class="p-6 lg:p-7">' +
    '<h2 class="text-xl font-black mb-1">Contact us</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">We reply within one working day.</p>' +
    '<div><label class="lb" for="supSub">Subject</label>' +
    '<input id="supSub" class="in mb-4" required value="' + esc(subject || '') + '"></div>' +
    '<div><label class="lb" for="supMsg">Message</label>' +
    '<textarea id="supMsg" rows="5" class="in mb-5" required></textarea></div>' +
    '<div class="flex gap-3"><button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
    '<button type="submit" class="btn btn-p flex-1">Send</button></div></form>');
  $('fSup').addEventListener('submit', function (e) {
    e.preventDefault();
    busy(e.target.querySelector('button[type=submit]'), true, 'Sending…');
    api('contactSupport', { form: { subject:$('supSub').value, message:$('supMsg').value } })
      .then(function (r) { toast(r.message, 'ok'); closeModal(); })
      .catch(function (err) { toast(err.message, 'err'); });
  });
}

function openAccount() {
  openModal('<div class="p-6 lg:p-7">' +
    '<h2 class="text-xl font-black mb-1">' + esc(STATE.user.name) + '</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">' + esc(STATE.user.email) +
      ' · ' + esc(STATE.user.role) + ' · ' + esc(STATE.company) + '</p>' +
    '<form id="fPw" class="space-y-4 mb-5">' +
      '<div><label class="lb" for="pwOld">Current password</label>' +
      '<input id="pwOld" type="password" class="in" autocomplete="current-password" required></div>' +
      '<div><label class="lb" for="pwNew">New password</label>' +
      '<input id="pwNew" type="password" class="in" autocomplete="new-password" minlength="8" required></div>' +
      '<button type="submit" class="btn btn-p w-full">Change password</button></form>' +
    '<div class="flex gap-3 border-t border-gray-100 pt-5">' +
      '<button class="btn btn-g flex-1" onclick="closeModal();openBilling()">Plan &amp; billing</button>' +
      '<button class="btn btn-g flex-1" onclick="signOut()">Sign out</button></div></div>');
  $('fPw').addEventListener('submit', function (e) {
    e.preventDefault();
    api('changePassword', { currentPassword:$('pwOld').value, newPassword:$('pwNew').value })
      .then(function (r) { toast(r.message, 'ok'); closeModal(); })
      .catch(function (err) { toast(err.message, 'err'); });
  });
}
