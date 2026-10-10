/**
 * DOME BOX — PLAN LIMITS
 * =============================================================================
 * The published pricing promises specific caps. Nothing enforced them, so every
 * plan was effectively Enterprise. These are the rules; they are pure, so the
 * browser and the server can both run them and agree.
 *
 * Enforce on the SERVER. A limit checked only in the browser is a suggestion.
 * =============================================================================
 */

/* Keyed by the values the Directory sheet stores. The display name is separate,
   so the sheet keeps its vocabulary while the UI shows a sellable name.

   This matters more than it looks: normalizePlan falls back to the LEAST
   generous tier on an unknown name, so keying these by anything else would
   silently downgrade every paying customer the moment they were read back.

   PRICING SHAPE — charge for team size, not for features.
   Every paid plan carries the whole product. A plan that withholds the scoring
   and the appraisals is selling a worse board, and it gives a buyer a reason to
   stay small rather than a reason to grow. The price per user falls as a
   company grows, so growing with us is rewarded and the bill still rises.

   Yearly is ten times monthly — two months free — which also keeps the ladder
   honest: the old Standard at 2,499/mo was 29,988 a year against a Pro at
   19,999 a year with fifteen times the users, so no informed buyer ever had a
   reason to pick it.

   LEGACY KEYS stay exactly as they were sold. Monthly and Yearly are what
   existing paying customers have in the Directory, and their caps and prices
   are untouched — but they are given the full feature set, because nobody
   should lose capability for having bought early. They are not offered to new
   buyers (offered:false). */
var PLANS = {
  'Free':       { name:'Free Tier',  price:0,      termDays:365, users:5,    tasksPerMonth:100,
                  analytics:false, whatsapp:false, email:false, kraForms:false, offered:true },

  'Starter':        { name:'Starter', price:2499,   termDays:30,  users:15,  tasksPerMonth:null,
                      analytics:true, whatsapp:true, email:true, kraForms:true, offered:true },
  'Starter Yearly': { name:'Starter', price:24990,  termDays:365, users:15,  tasksPerMonth:null,
                      analytics:true, whatsapp:true, email:true, kraForms:true, offered:true },

  'Growth':         { name:'Growth',  price:5999,   termDays:30,  users:50,  tasksPerMonth:null,
                      analytics:true, whatsapp:true, email:true, kraForms:true, offered:true },
  'Growth Yearly':  { name:'Growth',  price:59990,  termDays:365, users:50,  tasksPerMonth:null,
                      analytics:true, whatsapp:true, email:true, kraForms:true, offered:true },

  'Scale':          { name:'Scale',   price:12999,  termDays:30,  users:150, tasksPerMonth:null,
                      analytics:true, whatsapp:true, email:true, kraForms:true, offered:true },
  'Scale Yearly':   { name:'Scale',   price:129990, termDays:365, users:150, tasksPerMonth:null,
                      analytics:true, whatsapp:true, email:true, kraForms:true, offered:true },

  /* --- sold before the change; honoured, not offered --- */
  'Monthly':    { name:'Standard',   price:2499,  termDays:30,  users:20,   tasksPerMonth:500,
                  analytics:true, whatsapp:true, email:true, kraForms:true, offered:false, legacy:true },
  'Yearly':     { name:'Pro',        price:19999, termDays:365, users:300,  tasksPerMonth:null,
                  analytics:true, whatsapp:true, email:true, kraForms:true, offered:false, legacy:true },

  'Enterprise': { name:'Enterprise', price:0,     termDays:365, users:null, tasksPerMonth:null,
                  analytics:true, whatsapp:true, email:true, kraForms:true, offered:true },
};

/* What a seat costs beyond a plan's band, for a company that needs a few more
   rather than the next tier. Handled by hand on request — there is no
   self-serve flow for it, so nothing here pretends otherwise. */
var EXTRA_SEAT_PRICE = 149;

/* Both vocabularies resolve: what the sheet stores, and what the pricing page
   calls them. An unrecognised name is treated as Free, never as the most
   generous tier. */
var PLAN_ALIASES = {
  '': 'Free', 'free': 'Free', 'free tier': 'Free', 'freetier': 'Free', 'trial': 'Free',
  'monthly': 'Monthly', 'standard': 'Monthly', 'basic': 'Monthly',
  'yearly': 'Yearly', 'pro': 'Yearly', 'pro yearly': 'Yearly', 'proyearly': 'Yearly',
  'premium': 'Yearly', 'annual': 'Yearly',
  'starter': 'Starter', 'starter monthly': 'Starter',
  'starter yearly': 'Starter Yearly', 'starteryearly': 'Starter Yearly',
  'growth': 'Growth', 'growth monthly': 'Growth',
  'growth yearly': 'Growth Yearly', 'growthyearly': 'Growth Yearly',
  'scale': 'Scale', 'scale monthly': 'Scale',
  'scale yearly': 'Scale Yearly', 'scaleyearly': 'Scale Yearly',
  'enterprise': 'Enterprise', 'custom': 'Enterprise',
};

function normalizePlan(name) {
  var raw = String(name == null ? '' : name).trim();
  if (PLANS[raw]) return raw;
  var k = raw.toLowerCase().replace(/\s+/g, ' ');
  return PLAN_ALIASES[k] || 'Free';
}

function planLimits(name) { return PLANS[normalizePlan(name)]; }

/**
 * Counts tasks created in the calendar month a date falls in. Recurring
 * occurrences spawned by the system are NOT counted: a customer on Free with
 * five daily recurring jobs would otherwise burn the whole 50 in ten days
 * through no action of their own, and would rightly call that a bug. The cap is
 * on what people create.
 */
function tasksCreatedInMonth(tasks, when) {
  var ref = when || new Date();
  var from = new Date(ref.getFullYear(), ref.getMonth(), 1);
  var to = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  var n = 0;
  (tasks || []).forEach(function (t) {
    if (t.spawnedBy || t.systemGenerated) return;
    var created = firstHistoryDate_(t);
    if (!created) return;
    var d = startOfDay(created);
    if (d >= startOfDay(from) && d <= startOfDay(to)) n++;
  });
  return n;
}

function firstHistoryDate_(task) {
  var h = task.history || [];
  for (var i = 0; i < h.length; i++) {
    var raw = h[i].date || h[i].at;
    if (raw) { var d = new Date(raw); if (!isNaN(d)) return d; }
  }
  return task.createdAt ? new Date(task.createdAt) : null;
}

/** May this tenant add another active user? */
function canAddUser(plan, activeUserCount) {
  var lim = planLimits(plan);
  if (lim.users == null) return { ok: true, unlimited: true };
  if (activeUserCount < lim.users) {
    return { ok: true, remaining: lim.users - activeUserCount, limit: lim.users };
  }
  return { ok: false, limit: lim.users,
    reason: lim.name + ' includes ' + lim.users + ' users. You have ' + activeUserCount + '.',
    upgradeTo: nextPlanUp(plan) };
}

/** May this tenant create another task this month? */
function canCreateTask(plan, tasksThisMonth) {
  var lim = planLimits(plan);
  if (lim.tasksPerMonth == null) return { ok: true, unlimited: true };
  if (tasksThisMonth < lim.tasksPerMonth) {
    return { ok: true, remaining: lim.tasksPerMonth - tasksThisMonth, limit: lim.tasksPerMonth };
  }
  return { ok: false, limit: lim.tasksPerMonth,
    reason: lim.name + ' includes ' + lim.tasksPerMonth + ' tasks a month. ' +
            'You have created ' + tasksThisMonth + '. It resets on the 1st.',
    upgradeTo: nextPlanUp(plan) };
}

function planAllows(plan, feature) { return !!planLimits(plan)[feature]; }

/* The ladder a customer is pushed up when they hit a cap. Legacy plans are not
   on it — nextPlanUp maps them onto the band that actually fits. */
var PLAN_ORDER = ['Free', 'Starter', 'Growth', 'Scale', 'Enterprise'];
var LEGACY_NEXT = { 'Monthly': 'Growth', 'Yearly': 'Enterprise' };
function nextPlanUp(plan) {
  var cur = normalizePlan(plan);
  /* A legacy plan is not on the ladder, so point its holder at the band that
     actually fits rather than at nothing. */
  if (LEGACY_NEXT[cur]) return PLANS[LEGACY_NEXT[cur]].name;
  var i = PLAN_ORDER.indexOf(cur);
  var next = i > -1 && i < PLAN_ORDER.length - 1 ? PLAN_ORDER[i + 1] : null;
  return next ? PLANS[next].name : null;      // the name the customer recognises
}

/** The plans a new buyer may actually purchase, cheapest first. */
function offeredPlans() {
  return Object.keys(PLANS).filter(function (k) {
    return PLANS[k].offered && k !== 'Free' && k !== 'Enterprise'; });
}

/** How long a payment for this plan buys. */
function planTermDays(plan) {
  var lim = planLimits(plan);
  return lim && lim.termDays ? lim.termDays : 30;
}

/**
 * What a tenant should see before they hit a wall. Warning at 80% is early
 * enough to upgrade without the work stopping mid-week.
 */
function planUsage(plan, activeUsers, tasksThisMonth) {
  var lim = planLimits(plan), warnings = [];
  var pct = function (n, cap) { return cap == null ? 0 : Math.round(n / cap * 100); };

  var uPct = pct(activeUsers, lim.users), tPct = pct(tasksThisMonth, lim.tasksPerMonth);
  if (lim.users != null && uPct >= 80) {
    warnings.push({ kind: 'users', pct: uPct, atLimit: activeUsers >= lim.users,
      text: activeUsers >= lim.users
        ? 'You are at your ' + lim.users + '-user limit.'
        : 'You are using ' + activeUsers + ' of ' + lim.users + ' users.' });
  }
  if (lim.tasksPerMonth != null && tPct >= 80) {
    warnings.push({ kind: 'tasks', pct: tPct, atLimit: tasksThisMonth >= lim.tasksPerMonth,
      text: tasksThisMonth >= lim.tasksPerMonth
        ? 'You have used all ' + lim.tasksPerMonth + ' tasks this month.'
        : 'You have used ' + tasksThisMonth + ' of ' + lim.tasksPerMonth + ' tasks this month.' });
    }
  return { plan: normalizePlan(plan), limits: lim, users: { used: activeUsers, limit: lim.users, pct: uPct },
    tasks: { used: tasksThisMonth, limit: lim.tasksPerMonth, pct: tPct },
    warnings: warnings, upgradeTo: nextPlanUp(plan) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANS: PLANS, normalizePlan: normalizePlan, planLimits: planLimits,
    tasksCreatedInMonth: tasksCreatedInMonth, canAddUser: canAddUser,
    canCreateTask: canCreateTask, planAllows: planAllows, planUsage: planUsage,
    nextPlanUp: nextPlanUp, PLAN_ORDER: PLAN_ORDER,
    offeredPlans: offeredPlans, planTermDays: planTermDays,
    EXTRA_SEAT_PRICE: EXTRA_SEAT_PRICE,
  };
}
