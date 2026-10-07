// ===========================================================================
// COOKIE POINTS — recognition on the day, not six months later
// ===========================================================================
//
// An appraisal happens once. Good work happens on a Tuesday. Cookie points let
// a manager mark it while it is still true, and the award carries a name and a
// reason — an anonymous bonus with no stated cause is indistinguishable from
// favouritism, and a team reads it that way.
//
// The score effect is capped (MAX_COOKIE_BONUS). Cookies are a thank-you, not
// a back door to a score nobody earned on the work.
// ===========================================================================

var COOKIE_COLS = ['Date', 'To', 'By', 'Points', 'Reason'];

function readCookies_(ctx) {
  var sh = ctx.ss.getSheetByName(TAB.COOKIES);
  if (!sh) return [];
  var d = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < d.length; i++) {
    if (!d[i][1]) continue;
    out.push({ date: toIso_(d[i][0]), to: String(d[i][1]).trim(), by: String(d[i][2]).trim(),
               points: Number(d[i][3]) || 0, reason: String(d[i][4] || '') });
  }
  return out;
}

/** This month's cookies for one person, named, ready for the score engine. */
function cookiesFor_(ctx, username, range) {
  var names = {};
  readUsers_(ctx).forEach(function (u) { names[u.username] = u.name; });
  return readCookies_(ctx).filter(function (c) {
    if (c.to !== username) return false;
    if (!range) return true;
    var d = new Date(c.date);
    return !isNaN(d) && inWindow(d, range);
  }).map(function (c) {
    return { date: c.date, points: c.points, reason: c.reason,
             by: c.by, byName: names[c.by] || c.by };
  });
}

function awardCookie_(ctx, data) {
  requireManager_(ctx); blockIfStopped_(ctx);
  data = data || {};

  var to = String(data.employee || '').trim();
  var who = findUser_(ctx.ss, to);
  if (!who) throw new Error('That person is not in this workspace.');

  /* Nobody hands themselves a bonus. */
  if (who.username === ctx.actor.username) {
    throw new Error('Cookie points are for other people. You cannot award them to yourself.');
  }

  /* A head of department recognises their own people. An Admin may recognise
     anyone — somebody has to be able to thank a manager. */
  if (ctx.actor.role !== ROLE.ADMIN && who.manager !== ctx.actor.username) {
    throw new Error(who.name + ' does not report to you. Their own manager, or an Admin, ' +
      'can award this.');
  }

  var points = Math.round(Number(data.points) || 0);
  if (points < 1 || points > COOKIE_MAX_PER_AWARD) {
    throw new Error('Award between 1 and ' + COOKIE_MAX_PER_AWARD + ' cookie points.');
  }

  var reason = String(data.reason || '').trim();
  if (reason.length < 5) {
    throw new Error('Say what this is for. The reason is shown to them and counts ' +
      'at their appraisal — an award with no reason reads as favouritism.');
  }

  mkTab_(ctx.ss, TAB.COOKIES, COOKIE_COLS)
    .appendRow([new Date(), who.username, ctx.actor.username, points, reason]);

  try { notifyCookie_(ctx, who, points, reason); }
  catch (e) { logError_('awardCookie:notify', e.message); }

  var month = cookiesFor_(ctx, who.username, periodRange(PERIOD.MONTH, 0));
  var tally = cookieBonus(month);
  return { status: 'success', points: points, monthTotal: tally.awarded,
    capped: tally.capped,
    message: points + ' cookie point' + (points === 1 ? '' : 's') + ' to ' + who.name + '.' +
      (tally.capped ? ' Their score bonus is already at the ' + MAX_COOKIE_BONUS +
        '-point cap this month — the recognition still stands and shows at appraisal.' : '') };
}

/** Everything awarded this month, for the team screen. */
function getCookies_(ctx) {
  var names = {};
  readUsers_(ctx).forEach(function (u) { names[u.username] = u.name; });
  var range = periodRange(PERIOD.MONTH, 0);
  var mine = ctx.me.role === ROLE.DOER;

  var rows = readCookies_(ctx).filter(function (c) {
    var d = new Date(c.date);
    if (isNaN(d) || !inWindow(d, range)) return false;
    return !mine || c.to === ctx.me.username;
  }).map(function (c) {
    return { date: c.date, points: c.points, reason: c.reason,
             to: c.to, toName: names[c.to] || c.to,
             by: c.by, byName: names[c.by] || c.by };
  }).reverse();

  var tally = {};
  rows.forEach(function (c) { tally[c.to] = (tally[c.to] || 0) + c.points; });

  return { status: 'success', month: range.label, cookies: rows,
    leaderboard: Object.keys(tally).map(function (u) {
      return { username: u, name: names[u] || u, points: tally[u],
               bonus: Math.min(tally[u], MAX_COOKIE_BONUS) };
    }).sort(function (a, b) { return b.points - a.points; }),
    maxPerAward: COOKIE_MAX_PER_AWARD, maxBonus: MAX_COOKIE_BONUS };
}

// ===========================================================================
// ORG CHART — built from who reports to whom
// ===========================================================================
//
// Nobody draws this by hand. "Reports to" is already set on every person when
// they are added, so the chart is a view of data the workspace has rather than
// a second copy of it that drifts out of date.
// ===========================================================================

/** One person and everybody under them. Split out so the recursion is testable. */
function orgNode_(username, level, byName, kids, open, implied) {
  var u = byName[username];
  var children = kids[username].sort(function (a, b) {
    return String(byName[a].name).localeCompare(String(byName[b].name)); })
    .map(function (c) { return orgNode_(c, level + 1, byName, kids, open, implied); });
  return {
    username: u.username, name: u.name, role: u.role, dept: u.dept || '',
    jobProfile: u.jobProfile || '', email: u.email,
    openTasks: open[u.username] || 0,
    /* Placed here because somebody has to approve their work, not because a
       manager was chosen for them. The UI says so. */
    impliedManager: !!(implied && implied[username]),
    reports: children,
    /* Everyone underneath, not only the direct line — the number a head of
       department is actually answerable for. */
    headcount: children.reduce(function (n, c) { return n + 1 + c.headcount; }, 0),
    depth: children.reduce(function (n, c) { return Math.max(n, c.depth); }, level + 1),
    level: level,
  };
}

function getOrgChart_(ctx) {
  var users = readUsers_(ctx).filter(function (u) { return u.active !== false; });
  var tasks = readTasks_(ctx);

  var byName = {}, kids = {};
  users.forEach(function (u) { byName[u.username] = u; kids[u.username] = []; });

  var roots = [], cycles = [];
  users.forEach(function (u) {
    var mgr = String(u.manager || '').trim();
    if (!mgr || !byName[mgr] || mgr === u.username) { roots.push(u.username); return; }

    /* A reports to B reports to A would hang the walk below. Spotting it here
       and naming both people is more use than a blank screen. */
    var seen = {}, cursor = mgr, loop = false;
    while (cursor && byName[cursor]) {
      if (cursor === u.username) { loop = true; break; }
      if (seen[cursor]) break;
      seen[cursor] = true;
      cursor = String(byName[cursor].manager || '').trim();
    }
    if (loop) { cycles.push({ username: u.username, name: u.name,
      manager: mgr, managerName: byName[mgr].name }); roots.push(u.username); return; }

    kids[mgr].push(u.username);
  });

  var open = {};
  tasks.forEach(function (t) {
    if (t.assignee && isOpen(t.status) && !t.isArchived) open[t.assignee] = (open[t.assignee] || 0) + 1;
  });

  /* A person with nobody above them still has somebody above them in practice:
     an Admin approves their work. Hanging them off the owner with a marker
     makes the chart automatic without pretending a manager was set — the gap
     is still named in `unassigned` and in the note. */
  var owners = roots.filter(function (r) { return byName[r].role === ROLE.ADMIN; });
  var implied = {};
  if (owners.length === 1) {
    var owner = owners[0];
    roots = roots.filter(function (r) {
      if (r === owner || byName[r].role === ROLE.ADMIN) return true;
      if (String(byName[r].manager || '').trim()) return true;   // a real loop, leave it out
      kids[owner].push(r); implied[r] = true; return false;
    });
  }

  var tree = roots.sort(function (a, b) {
    var ra = byName[a].role === ROLE.ADMIN ? 0 : byName[a].role === ROLE.MANAGER ? 1 : 2;
    var rb = byName[b].role === ROLE.ADMIN ? 0 : byName[b].role === ROLE.MANAGER ? 1 : 2;
    return ra - rb || String(byName[a].name).localeCompare(String(byName[b].name));
  }).map(function (r) { return orgNode_(r, 0, byName, kids, open, implied); });

  var depth = tree.reduce(function (n, t) { return Math.max(n, t.depth); }, 0);

  var unassigned = Object.keys(implied)
    .map(function (r) { return { username: r, name: byName[r].name, role: byName[r].role }; });

  return { status: 'success', tree: tree, levels: depth, people: users.length,
    cycles: cycles, unassigned: unassigned,
    /* Someone with nobody above them cannot have their work approved by anyone
       but an Admin, so this is worth saying out loud rather than leaving to be
       discovered when an approval goes nowhere. */
    note: unassigned.length
      ? unassigned.length + ' ' + (unassigned.length === 1 ? 'person reports' : 'people report') +
        ' to nobody. Their work is approved by an Admin until you set a manager.'
      : '' };
}
