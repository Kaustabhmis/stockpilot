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

var PLANS = {
  'Free Tier':  { users: 5,   tasksPerMonth: 50,   analytics: false, whatsapp: false, email: false, kraForms: false },
  'Standard':   { users: 20,  tasksPerMonth: 500,  analytics: false, whatsapp: false, email: true,  kraForms: false },
  'Pro Yearly': { users: 300, tasksPerMonth: null, analytics: true,  whatsapp: true,  email: true,  kraForms: true },
  'Enterprise': { users: null, tasksPerMonth: null, analytics: true, whatsapp: true,  email: true,  kraForms: true },
};

var PLAN_ALIASES = {
  'free': 'Free Tier', 'free tier': 'Free Tier', 'trial': 'Free Tier', '': 'Free Tier',
  'standard': 'Standard', 'basic': 'Standard',
  'pro': 'Pro Yearly', 'pro yearly': 'Pro Yearly', 'proyearly': 'Pro Yearly', 'premium': 'Pro Yearly',
  'enterprise': 'Enterprise', 'custom': 'Enterprise',
};

/** An unknown plan name must fall back to the LEAST generous tier, never the most. */
function normalizePlan(name) {
  var raw = String(name == null ? '' : name).trim();
  if (PLANS[raw]) return raw;
  var k = raw.toLowerCase().replace(/\s+/g, ' ');
  return PLAN_ALIASES[k] || 'Free Tier';
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
    reason: normalizePlan(plan) + ' includes ' + lim.users + ' users. You have ' + activeUserCount + '.',
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
    reason: normalizePlan(plan) + ' includes ' + lim.tasksPerMonth + ' tasks a month. ' +
            'You have created ' + tasksThisMonth + '. It resets on the 1st.',
    upgradeTo: nextPlanUp(plan) };
}

function planAllows(plan, feature) { return !!planLimits(plan)[feature]; }

var PLAN_ORDER = ['Free Tier', 'Standard', 'Pro Yearly', 'Enterprise'];
function nextPlanUp(plan) {
  var i = PLAN_ORDER.indexOf(normalizePlan(plan));
  return i > -1 && i < PLAN_ORDER.length - 1 ? PLAN_ORDER[i + 1] : null;
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
  };
}
