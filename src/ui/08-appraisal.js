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
      '<div class="bg-gray-50 rounded-2xl p-4 mb-3 flex items-center gap-5">' +
        '<div><div class="lb mb-0">Delegation score</div>' +
        '<div class="text-3xl font-black">' + (f.hasData ? f.delegationScore : '\u2014') + '</div></div>' +
        '<div class="text-xs text-gray-500 font-semibold flex-1">' +
          (f.hasData ? 'Measured from their task record — on-time delivery, first-pass quality and queue health.'
                     : 'No closed work to measure yet, so this half carries no score.') +
          ' <button type="button" class="text-blue-600 font-black" onclick="showDelBreakdown()">See why</button></div>' +
      '</div>' +
      /* How they treated OTHER people's work. A department head who delivers
         their own tasks and sits on everyone else's would otherwise appraise
         well, which is the exact behaviour a team notices first. */
      (f.responsiveness ? '<div class="rounded-2xl border ' +
        (f.responsiveness.penalty ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50') +
        ' p-4 mb-5 text-[13px] font-semibold text-gray-700">' +
        '<span class="font-black text-gray-900">Approvals and reviews: </span>' +
        esc(f.responsiveness.withinSla + ' of ' + f.responsiveness.items + ' cleared within ' +
            f.responsiveness.slaDays + ' working days') +
        (f.responsiveness.avgHeldDays != null
          ? esc(', ' + f.responsiveness.avgHeldDays + ' days held on average') : '') +
        (f.responsiveness.pending ? esc('. ' + f.responsiveness.pending + ' still waiting on them') +
          (f.responsiveness.overdueNow ? esc(', ' + f.responsiveness.overdueNow + ' past the mark') : '') : '') +
        (f.responsiveness.penalty
          ? '<span class="block font-black text-red-800 mt-1">' +
            esc('\u2212' + f.responsiveness.penalty + ' \u2014 already counted in the delegation score above') + '</span>'
          : '<span class="block font-black text-emerald-800 mt-1">Nothing lost here</span>') +
        '</div>' : '') +
      '<h3 class="font-black text-sm mb-2">KRA ratings</h3>' +
      (f.kras.length ? '<div class="space-y-2 mb-5">' + f.kras.map(function (k, i) {
        return '<div class="border border-gray-100 rounded-xl p-3">' +
          '<div class="flex justify-between items-center gap-3">' +
            '<span class="font-bold text-sm">' + esc(k.item || k.name) + '</span>' +
            '<span class="text-xs font-black text-blue-600 whitespace-nowrap">Weight ' + esc(k.weight) + '</span></div>' +
          (k.desc ? '<div class="text-xs text-gray-500 mt-1">' + esc(k.desc) + '</div>' : '') +
          /* The target is what stops this being two people's recollections. */
          (k.target ? '<div class="text-xs font-bold text-gray-700 mt-1">Target: ' +
            esc(k.target + (k.unit ? ' ' + k.unit : '')) +
            (k.direction ? '<span class="font-semibold text-gray-400"> · ' + esc(k.direction) + '</span>' : '') +
            (k.measured ? '<span class="font-semibold text-gray-400"> · ' + esc(k.measured) + '</span>' : '') +
            '</div>'
            : '<div class="text-xs font-semibold text-gray-400 mt-1">No KPI target — rate this on judgement.</div>') +
          '<select class="in mt-2 kraR" data-w="' + esc(k.weight) + '">' +
            '<option value="0">Not rated</option>' +
            [1,2,3,4,5].map(function (n) { return '<option value="'+n+'">'+n+' — '+
              ['Poor','Below average','Average','Good','Excellent'][n-1]+'</option>'; }).join('') +
          '</select></div>';
      }).join('') + '</div>'
      : '<p class="text-sm bg-amber-50 text-amber-900 rounded-xl p-3 mb-5 font-semibold">' +
        'No KRAs set for this person yet, so the appraisal rests on behaviour and ' +
        'delivery alone. Set them up under Team \u2192 KRA &amp; KPI.</p>') +
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
/* The single list of plans the front end shows. The landing page and the
   billing modal both read it, so a price cannot be right in one place and
   stale in the other. The server decides what a plan actually allows — this is
   only how it is described.

   Every paid band carries the whole product; what you pay for is the size of
   your team. That removes the "which plan do I need?" conversation entirely,
   and it stops a customer sitting on a crippled tier that makes the product
   look weaker than it is. */
var PLAN_CARDS = [
  { key:'Free', yearKey:'Free', name:'Free Tier', price:0, yearPrice:0, users:5, tag:'',
    blurb:'For a small team testing the water.',
    bullets:['Up to 5 users','100 tasks a month','Board, approvals and reminders'] },

  { key:'Starter', yearKey:'Starter Yearly', name:'Starter', price:2499, yearPrice:24990,
    users:15, tag:'',
    blurb:'For a first team that needs the work written down.',
    bullets:['Up to 15 users','Unlimited tasks','Scoring, reports and analytics',
             'KRA / KPI and appraisals','Projects and milestones','Email and WhatsApp alerts'] },

  { key:'Growth', yearKey:'Growth Yearly', name:'Growth', price:5999, yearPrice:59990,
    users:50, tag:'Most popular',
    blurb:'For a company running several departments.',
    bullets:['Up to 50 users','Unlimited tasks','Everything in Starter',
             'Multi-level approvals across departments','Org chart and cookie points'] },

  { key:'Scale', yearKey:'Scale Yearly', name:'Scale', price:12999, yearPrice:129990,
    users:150, tag:'Best value per user',
    blurb:'For a full factory or a multi-branch business.',
    bullets:['Up to 150 users','Unlimited tasks','Everything in Growth','Priority support'] },

  { key:'Enterprise', yearKey:'Enterprise', name:'Enterprise', price:null, yearPrice:null,
    users:null, tag:'',
    blurb:'For large or multi-site operations.',
    bullets:['Unlimited users and tasks','Custom integrations','Dedicated support'] },
];

var EXTRA_SEAT_PRICE = 149;

/** ₹1,29,990 — grouped the way an Indian reader expects, not 129,990. */
function inr(n) {
  var x = String(Math.round(n));
  if (x.length <= 3) return '₹' + x;
  var last3 = x.slice(-3), rest = x.slice(0, -3);
  return '₹' + rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
}

/** Monthly or yearly. Yearly is shown first because it is the better deal. */
var PLAN_CYCLE = 'yearly';
function setPlanCycle(c) {
  PLAN_CYCLE = c === 'monthly' ? 'monthly' : 'yearly';
  if ($('homePlans')) renderHomePlans();
  if ($('billingPlans')) renderBillingPlans();
}

function planPriceLabel(p) {
  if (p.price === null) return { price: 'Custom', per: '', note: '' };
  if (!p.price) return { price: '₹0', per: '', note: 'No card needed' };
  return PLAN_CYCLE === 'yearly'
    ? { price: inr(p.yearPrice), per: '/year',
        note: inr(Math.round(p.yearPrice / 12)) + ' a month, billed yearly' }
    : { price: inr(p.price), per: '/month', note: 'Billed monthly' };
}

/** Which PLANS key a purchase of this card actually buys. */
function planKeyForCycle(p) { return PLAN_CYCLE === 'yearly' ? p.yearKey : p.key; }

function cycleToggle(id) {
  return '<div class="inline-flex gap-1 bg-gray-100 p-1 rounded-xl" id="' + id + '">' +
    ['yearly', 'monthly'].map(function (c) {
      var on = PLAN_CYCLE === c;
      return '<button type="button" onclick="setPlanCycle(\'' + c + '\')" ' +
        'class="px-4 py-2 rounded-lg text-xs font-black ' +
        (on ? 'bg-white shadow text-gray-900' : 'text-gray-500') + '">' +
        (c === 'yearly' ? 'Yearly — 2 months free' : 'Monthly') + '</button>';
    }).join('') + '</div>';
}

function openBilling() {
  var u = STATE.usage;
  openModal('<div class="p-6 lg:p-7">' +
    '<div class="flex justify-between items-start mb-1"><h2 class="text-2xl font-black">Plans</h2>' +
    '<button onclick="closeModal()" class="text-gray-400"><span class="material-icons">close</span></button></div>' +
    '<p class="text-sm text-gray-400 font-semibold mb-4">You are on <strong>' + esc(u.planName) + '</strong>' +
      (u.daysLeft !== null ? ', ' + (u.daysLeft >= 0 ? u.daysLeft + ' day(s) left' : 'expired') : '') + '. ' +
      'Every paid plan carries the whole product — you pay for the size of your team.</p>' +
    '<div class="mb-5">' + cycleToggle('billingCycle') + '</div>' +
    '<div id="billingPlans" class="grid md:grid-cols-3 gap-4"></div>' +
    '<div class="mt-5 flex gap-2 items-end">' +
      '<div class="flex-1 max-w-xs"><label class="lb" for="promo">Promo code</label>' +
      '<input id="promo" class="in" placeholder="Optional"></div></div>' +
    '<div class="mt-5 flex flex-wrap gap-2">' +
      '<button class="btn btn-g" onclick="openInvoices()">Invoices</button>' +
      '<button class="btn btn-g" onclick="openBillingDetails()">Invoice details</button></div>' +
    '<p class="text-xs text-gray-400 font-semibold mt-4">Prices exclude 18% GST, added at checkout. ' +
    'A GST invoice is emailed the moment a payment goes through. ' +
      'Need a few more seats than a band allows? Extra seats are ' + inr(EXTRA_SEAT_PRICE) +
      ' per user a month — ' +
      '<button class="text-blue-600 font-black" onclick="openSupport(\'Extra seats\')">ask us</button>. ' +
      'Enterprise: unlimited users, custom integrations, dedicated support — ' +
      '<button class="text-blue-600 font-black" onclick="openSupport(\'Enterprise enquiry\')">talk to us</button>.</p>' +
    '</div>', 'max-w-4xl');
  renderBillingPlans();
}

function renderBillingPlans() {
  var el = $('billingPlans');
  if (!el) return;
  /* Free is not a thing to buy, and Enterprise is a conversation. */
  var buyable = PLAN_CARDS.filter(function (p) { return p.price; });
  el.innerHTML = buyable.map(function (p) {
    var key = planKeyForCycle(p);
    var current = key === STATE.plan || p.key === STATE.plan || p.yearKey === STATE.plan;
    var L = planPriceLabel(p);
    var lead = p.tag === 'Most popular';
    return '<div class="border-2 rounded-2xl p-5 flex flex-col ' +
      (current ? 'border-blue-500 bg-blue-50' : lead ? 'border-blue-200' : 'border-gray-100') + '">' +
      '<div class="font-black text-lg">' + esc(p.name) + '</div>' +
      '<div class="text-[11px] font-black uppercase tracking-widest text-gray-400 mt-0.5">' +
        'Up to ' + p.users + ' users</div>' +
      '<div class="text-2xl font-black mt-2">' + esc(L.price) +
        '<span class="text-sm font-bold text-gray-400">' + esc(L.per) + '</span></div>' +
      '<div class="text-[11px] font-semibold text-gray-400">' + esc(L.note) + '</div>' +
      '<ul class="text-xs font-semibold text-gray-600 mt-3 space-y-1.5 flex-1">' +
        p.bullets.map(function (b) { return '<li>· ' + esc(b) + '</li>'; }).join('') + '</ul>' +
      (current ? '<div class="text-xs font-black text-blue-700 text-center mt-4 py-2">Current plan</div>'
        : '<button class="btn btn-p w-full mt-4 buy" data-plan="' + esc(key) + '">' +
          'Get ' + esc(p.name) + '</button>') +
      '</div>';
  }).join('');
  el.querySelectorAll('.buy').forEach(function (b) {
    b.addEventListener('click', function () { startCheckout(b.dataset.plan, $('promo').value); });
  });
}

/**
 * The invoice is issued the instant the payment lands, so the details it will
 * be written from are collected first. Asked once: if a state or a GSTIN is
 * already on file we go straight to the card.
 */
function startCheckout(planName, promo) {
  if (typeof Razorpay === 'undefined') { toast('The payment library has not loaded. Refresh and try again.', 'err'); return; }
  api('getBilling', {})
    .then(function (r) {
      if (r.billing && (r.billing.gstin || r.billing.state)) return payNow(planName, promo);
      openBillingDetails(function () { payNow(planName, promo); });
    })
    .catch(function () { payNow(planName, promo); });   // never block a sale on this
}

function payNow(planName, promo) {
  toast('Starting payment…', 'info');
  api('initiateRazorpay', { planName: planName, promoCode: promo })
    .then(function (r) {
      var o = r.orderData, ch = r.charge || {};
      /* The site prices exclude GST, so the figure on the card is larger than
         the figure on the plan card. Saying so before the payment sheet opens
         is the difference between a sale and a chargeback. */
      if (ch.tax) toast(inr(ch.net) + ' + ' + ch.rate + '% GST ' + inr(ch.tax) +
                        ' = ' + inr(ch.total) + ' payable', 'info');
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
