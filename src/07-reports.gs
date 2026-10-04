// ===========================================================================
// DASHBOARD, SCORING, APPRAISALS, REPORTS
// ===========================================================================

function getDashboard_(ctx) {
  if (ctx.serviceStopped) {
    return { status: 'success', serviceStopped: true,
      usage: { planName: ctx.plan.name || ctx.planName, daysLeft: ctx.daysLeft },
      message: 'Your subscription lapsed more than a week ago. Your data is safe and ' +
               'still here — renew to start writing again.' };
  }

  var tasks = readTasks_(ctx);
  var users = readUsers_(ctx);
  var cal = leaveCalendar_(ctx);
  var me = ctx.actor;

  // What this person is allowed to see.
  var visible = tasks.filter(function (t) {
    if (me.role === 'Admin') return true;
    return t.assignee === me.username || t.by === me.username || t.approver === me.username;
  });
  var active = visible.filter(function (t) { return !t.isArchived; });

  var reports = users.filter(function (u) { return u.manager === me.username; })
                     .map(function (u) { return u.username; });

  var del = delegationScore(tasks.filter(function (t) { return !t.isArchived ||
    inThisMonth_(t); }), me.username, new Date(), cal);

  // Last recorded appraisal, if any.
  var lastKra = null;
  var rv = ctx.ss.getSheetByName(TAB.REVIEWS);
  if (rv) {
    var rd = rv.getDataRange().getValues();
    for (var i = rd.length - 1; i > 0; i--) {
      if (String(rd[i][1]) === me.username) { lastKra = Number(rd[i][2]); break; }
    }
  }
  var finalScore = lastKra !== null ? (del.score + lastKra) / 2 : del.score;

  var digest = buildDigest(tasks, { username: me.username, name: me.name, role: me.role },
    new Date(), { reports: reports, escalateAfterDays: 3 });

  var usedTasks = tasksCreatedInMonth(tasks, new Date());
  var activeUsers = users.filter(function (u) { return u.active !== false; }).length;

  return {
    status: 'success', serviceStopped: false,
    user: me, company: ctx.company,
    tasks: visible,
    categories: readCategories_(ctx),
    staff: users.map(function (u) {
      return { name: u.name, username: u.username, role: u.role, email: u.email,
               phone: u.phone, manager: u.manager, dept: u.dept, jobProfile: u.jobProfile,
               active: u.active }; }),
    stats: {
      pending:   active.filter(function (t) { return t.status === 'Pending'; }).length,
      progress:  active.filter(function (t) { return t.status === 'In Progress'; }).length,
      review:    active.filter(function (t) { return t.status === 'For Review'; }).length,
      approval:  active.filter(function (t) { return t.status === 'Awaiting Approval' ||
                                                      t.status === 'Delegation Proposed'; }).length,
      completed: active.filter(function (t) { return t.status === 'Verified'; }).length,
      overdue:   active.filter(function (t) { return isOpen(t.status) && t.due &&
                                dayDiff(new Date(), parseYmd(t.due)) > 0; }).length,
      scores: { delegation: del.score, kra: lastKra === null ? null : Math.round(lastKra),
                final: Math.round(finalScore), breakdown: del.breakdown,
                components: del.components, hasData: del.hasData },
    },
    notifications: buildNotifications_(digest, me),
    usage: {
      planName: ctx.plan.name || ctx.planName, plan: ctx.planName,
      users: activeUsers, maxUsers: ctx.plan.users,
      tasks: usedTasks, maxTasks: ctx.plan.tasksPerMonth,
      allowReports: ctx.plan.analytics, allowWhatsapp: ctx.plan.whatsapp,
      daysLeft: ctx.daysLeft,
      warnings: planUsage(ctx.planName, activeUsers, usedTasks).warnings,
    },
  };
}

function inThisMonth_(t) {
  var d = closedAt(t) || new Date(t.createdDate);
  if (!d || isNaN(d)) return false;
  var now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

/** The bell. Ordered by urgency, because a list nobody can triage gets ignored. */
function buildNotifications_(digest, me) {
  var out = [];
  var b = digest.buckets || {};
  (b.overdue || []).forEach(function (t) {
    out.push({ type: 'overdue', id: t.id, title: t.title,
      msg: 'Overdue' + (t.daysLate ? ' by ' + t.daysLate + ' day(s)' : ''), due: t.due }); });
  (b.awaitingMyApproval || []).forEach(function (t) {
    out.push({ type: 'approval', id: t.id, title: t.title, msg: 'Waiting for your approval', due: t.due }); });
  (b.awaitingMyReview || []).forEach(function (t) {
    out.push({ type: 'review', id: t.id, title: t.title, msg: 'Ready for your review', due: t.due }); });
  (b.dueToday || []).forEach(function (t) {
    out.push({ type: 'today', id: t.id, title: t.title, msg: 'Due today', due: t.due }); });
  (b.teamOverdue || []).forEach(function (t) {
    out.push({ type: 'team', id: t.id, title: t.title, msg: 'Your report is overdue on this', due: t.due }); });
  return out;
}

/* ---------- analytics ---------------------------------------------------- */

function getAnalytics_(ctx, period, offset, span, person) {
  if (!ctx.plan.analytics) {
    return { status: 'error', upgrade: true,
      message: 'Reports are included from the Pro plan up.' };
  }
  var tasks = readTasks_(ctx);
  var users = readUsers_(ctx).filter(function (u) { return u.active !== false; });
  var cal = leaveCalendar_(ctx);

  var kind = ['week','month','quarter','year'].indexOf(period) > -1 ? period : 'month';
  var off = Number(offset || 0);
  var count = Number(span || 12);

  var range = periodRange(kind, off);
  var a = periodAnalytics(tasks, users, range, new Date(), cal);

  var trend = [];
  for (var i = count - 1 + off; i >= off; i--) {
    var r = periodRange(kind, i);
    var p = periodAnalytics(tasks, users, r, new Date(), cal);
    trend.push({ label: r.short, full: r.label, teamScore: p.teamScore, delivered: p.delivered });
  }

  var personTrend = person
    ? scoreTrend(tasks, person, kind, count, null, off, cal).map(function (x) {
        return { label: x.short, score: x.score, delivered: x.delivered }; })
    : null;

  // 20-week delivery heatmap
  var weeks = [];
  for (var w = 19; w >= 0; w--) weeks.push(periodRange('week', w));
  var heat = users.map(function (u) {
    return { name: u.name, username: u.username, values: weeks.map(function (wk) {
      return tasks.filter(function (t) { return t.assignee === u.username &&
        t.status === 'Verified' && inWindow(closedAt(t), wk); }).length; }) };
  });

  return { status: 'success', range: a.range, summary: {
      delivered: a.delivered, overdueNow: a.overdueNow, reworkLoops: a.reworkLoops,
      onTimeRate: a.onTimeRate, teamScore: a.teamScore },
    people: a.people, kra: a.kra, bands: a.bands,
    trend: trend, personTrend: personTrend,
    heatmap: { weeks: weeks.map(function (w) { return w.short; }), rows: heat } };
}

function getAccountability_(ctx) {
  if (!ctx.plan.analytics) return { status: 'error', upgrade: true,
    message: 'Reports are included from the Pro plan up.' };
  var tasks = readTasks_(ctx);
  var byUser = {};
  tasks.forEach(function (t) {
    if (!t.assignee) return;
    var s = byUser[t.assignee] = byUser[t.assignee] || { total: 0, reworks: 0, late: 0 };
    s.total++; s.reworks += Number(t.reworkCount || 0);
    var sub = submittedAt(t), due = parseYmd(t.due);
    if (sub && due && dayDiff(sub, due) > 0) s.late++;
  });
  var names = {};
  readUsers_(ctx).forEach(function (u) { names[u.username] = u.name; });

  return { status: 'success', report: Object.keys(byUser).map(function (k) {
    var s = byUser[k];
    return { username: k, name: names[k] || k, total: s.total, reworkCount: s.reworks,
             lateCount: s.late,
             pct: s.total ? Math.round(s.reworks / s.total * 100) : 0 };
  }).sort(function (a, b) { return b.pct - a.pct; }) };
}

function getPerformanceReport_(ctx) {
  var sh = ctx.ss.getSheetByName(TAB.REVIEWS);
  if (!sh) return { status: 'success', report: [] };
  var d = sh.getDataRange().getValues();
  var names = {};
  readUsers_(ctx).forEach(function (u) { names[u.username] = u.name; });
  var out = [];
  for (var i = 1; i < d.length; i++) {
    if (!d[i][1]) continue;
    out.push({ month: d[i][0], username: d[i][1], name: names[d[i][1]] || d[i][1],
      performance: Number(d[i][2]) || 0, delegation: Number(d[i][3]) || 0,
      score: Number(d[i][4]) || 0, date: toYmd_(d[i][5]),
      band: performanceBand(Number(d[i][4]) || 0).band });
  }
  return { status: 'success', report: out.reverse() };
}

/* ---------- appraisals --------------------------------------------------- */

function getAppraisalForm_(ctx, username) {
  requireManager_(ctx);
  var u = findUser_(ctx.ss, username);
  if (!u) throw new Error('That person is not in this workspace.');

  var tasks = readTasks_(ctx);
  var cal = leaveCalendar_(ctx);
  var del = delegationScore(tasks, username, new Date(), cal);

  // KRAs: the person's own blueprint first, else the job-profile master.
  var kras = (u.kras && u.kras.length) ? u.kras : [];
  if (!kras.length) {
    var sh = ctx.ss.getSheetByName(TAB.KRA);
    if (sh) {
      var d = sh.getDataRange().getValues();
      for (var i = 1; i < d.length; i++) {
        if (String(d[i][0]).trim() === String(u.jobProfile).trim() && d[i][1]) {
          kras.push({ item: d[i][1], desc: d[i][2], weight: Number(d[i][3]) || 1, grid: d[i][4] });
        }
      }
    }
  }

  return { status: 'success', employee: { username: u.username, name: u.name,
      jobProfile: u.jobProfile, dept: u.dept },
    delegationScore: del.score, delegationBreakdown: del.breakdown, hasData: del.hasData,
    kras: kras,
    behaviors: [
      { section: 'Collaboration', question: 'Actively contributes in team discussions', weight: 1 },
      { section: 'Accountability', question: 'Meets commitments without chasing', weight: 2 },
      { section: 'Initiative',     question: 'Raises problems early rather than late', weight: 2 },
      { section: 'Attendance',     question: 'Attendance and punctuality', weight: 1 },
    ],
    weights: APPRAISAL_WEIGHTS };
}

function submitAppraisal_(ctx, data) {
  requireManager_(ctx); blockIfStopped_(ctx);
  data = data || {};
  if (!data.employee) throw new Error('Pick who this appraisal is for.');

  var result = finalAppraisalScore({
    delegation: Number(data.delegationScore) || 0,
    kras: (data.kras || []).map(function (k) {
      return { rating: Number(k.rating) || 0, weight: Number(k.weight) || 1 }; }),
    behaviours: (data.behaviors || []).map(function (b) {
      return { rating: Number(b.rating) || 0, weight: Number(b.weight) || 1 }; }),
    brownie: Number(data.brownie) || 0,
  });

  var month = new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  mkTab_(ctx.ss, TAB.REVIEWS, ['Month','Employee','Performance Score','Delegation Score','Final Score','Date'])
    .appendRow([month, data.employee, result.performance, result.delegation, result.score, new Date()]);

  return { status: 'success', score: result.score, band: performanceBand(result.score),
    breakdown: result.parts,
    message: 'Appraisal saved: ' + result.score + ' (' + performanceBand(result.score).band + ').' };
}

function addKRA_(ctx, data) {
  requireManager_(ctx); blockIfStopped_(ctx);
  data = data || {};
  var u = findUser_(ctx.ss, data.employee);
  if (!u) throw new Error('That person is not in this workspace.');

  var rows = (data.kras || []).filter(function (k) { return String(k.name || k.item || '').trim(); })
    .map(function (k) { return { item: String(k.name || k.item).trim(), desc: String(k.desc || ''),
      weight: Number(k.weight) || 1, grid: String(k.grid || '') }; });

  var v = validateKraBlueprint(rows);
  if (!v.ok) throw new Error(v.error);     // weights over 100% never save

  // Stored against the person, and mirrored to the job-profile master so the
  // next person with the same profile inherits it.
  setUserField_(ctx.ss, u.rowIndex, 'KRAs JSON', JSON.stringify(rows));

  if (u.jobProfile) {
    var sh = mkTab_(ctx.ss, TAB.KRA, ['Job Profile','KRA Title','Description','Weight','Grid/KPI']);
    var d = sh.getDataRange().getValues();
    for (var i = d.length - 1; i > 0; i--) {
      if (String(d[i][0]).trim() === String(u.jobProfile).trim()) sh.deleteRow(i + 1);
    }
    if (rows.length) {
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, 5).setValues(rows.map(function (k) {
        return [u.jobProfile, k.item, k.desc, k.weight, k.grid]; }));
    }
  }
  return { status: 'success', total: v.total, warning: v.warning || '',
    message: 'Saved ' + rows.length + ' KRA(s), ' + v.total + '% allocated.' };
}
