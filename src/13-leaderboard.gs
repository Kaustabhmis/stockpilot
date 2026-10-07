// ===========================================================================
// LEADERBOARD
// ===========================================================================
/**
 * DOME BOX — THE LEADERBOARD
 * =============================================================================
 * Top of the month to bottom, for a workspace that wants its best work seen.
 *
 * WHAT THIS DELIBERATELY IS NOT
 *
 * It is not a second scoring system. It ranks the score the rest of the product
 * already computes — rate × load credit, capped at 100, starting from 0 — so a
 * person cannot be first here and middling on their own dashboard. A
 * leaderboard that disagreed with the score it claims to rank would be the
 * fastest way to make both of them ignored.
 *
 * WHO CAN SEE IT
 *
 * A published ranking is a strong instrument and it points at real people, so
 * it is the Admin's call, not ours. `leaderboardVisibility` is one of:
 *
 *   everyone  (default)  the whole board, top to bottom, to every member
 *   top       the top three plus "you are 9th of 24" to a Doer; managers see all
 *   managers             only Admin, HOD and Managers see it at all
 *
 * The default is the whole board because that is what a company that asks for a
 * leaderboard is asking for. The other two exist because the first week of
 * running one is when people find out whether their culture wants it.
 *
 * A Doer always sees their own row whatever the setting, because a ranking you
 * are in but cannot see is the worst of both worlds.
 * =============================================================================
 */

var LEADERBOARD_VISIBILITY = ['everyone', 'top', 'managers'];
var LEADERBOARD_TOP_N = 3;

function leaderboardVisibility_(ctx) {
  var v = String(readSetting_(ctx, 'leaderboardVisibility', 'everyone'));
  return LEADERBOARD_VISIBILITY.indexOf(v) > -1 ? v : 'everyone';
}

/* Anyone who is not a Doer, matching requireManager_ exactly. Spelled from the
   same side as that guard so the two can never drift apart and leave the board
   visible to someone the rest of the product treats as staff. */
function isManagerish_(actor) { return actor.role !== ROLE.DOER; }

/**
 * The board for one period.
 *
 * `period` is any of the existing period kinds — the month is the default
 * because "employee of the month" is the thing people actually run — and
 * `offset` walks backwards, so last month is offset 1.
 */
function getLeaderboard_(ctx, period, offset) {
  var kind = ['week', 'month', 'quarter', 'year'].indexOf(period) > -1 ? period : 'month';
  var off = Math.max(0, Number(offset || 0));
  var vis = leaderboardVisibility_(ctx);
  var mine = ctx.actor.username;
  var manager = isManagerish_(ctx.actor);

  if (vis === 'managers' && !manager) {
    return { status: 'error',
      message: 'The leaderboard is only shown to managers in this workspace.' };
  }

  var tasks = readTasks_(ctx);
  var users = readUsers_(ctx).filter(function (u) { return u.active !== false; });
  var cal = leaveCalendar_(ctx);
  var opts = scoreOptsMap_(ctx);
  var optsFor = function (u) { return opts[u.username]; };

  var range = periodRange(kind, off);
  var now = new Date();
  var board = leaderboard(
    periodAnalytics(tasks, users, range, now, cal, optsFor).people,
    /* Last period's board, for the movement arrows. Computed rather than
       stored: a stored rank goes stale the moment anything is back-dated, and
       people notice a wrong arrow faster than a wrong score. */
    leaderboard(periodAnalytics(tasks, users, periodRange(kind, off + 1), now, cal, optsFor).people).rows
  );

  var me = null;
  board.rows.forEach(function (r) { if (r.username === mine) me = r; });
  var meUnranked = null;
  board.unranked.forEach(function (u) { if (u.username === mine) meUnranked = u; });

  var rows = board.rows;
  var trimmed = false;
  if (vis === 'top' && !manager) {
    /* The top three, plus the viewer's own row wherever it sits. Their own
       position is given in full — "9th of 24" — because being told you are
       outside the top three without being told where is worse than silence. */
    rows = board.rows.filter(function (r) {
      return r.rank <= LEADERBOARD_TOP_N || r.username === mine;
    });
    trimmed = rows.length < board.rows.length;
  }

  return {
    status: 'success',
    range: { label: range.label, short: range.short, from: ymd(range.from), to: ymd(range.to) },
    period: kind, offset: off,
    rows: rows,
    trimmed: trimmed,
    /* The unranked are never shown as a tail of the ranking. A Doer is only
       told about their own absence, not about everybody else's. */
    unranked: manager ? board.unranked : (meUnranked ? [meUnranked] : []),
    unrankedCount: board.counts.unranked,
    champion: board.champion,
    sharedFirst: board.shared,
    championBelowFirst: board.championBelowFirst,
    me: me || meUnranked || null,
    myRank: me ? me.rank : null,
    counts: board.counts,
    stats: { top: board.top, median: board.median, bottom: board.bottom },
    visibility: vis,
    canSetVisibility: ctx.actor.role === ROLE.ADMIN,
  };
}

function setLeaderboardVisibility_(ctx, value) {
  requireAdmin_(ctx);
  var v = String(value || '').trim();
  if (LEADERBOARD_VISIBILITY.indexOf(v) < 0) {
    throw new Error('Choose who sees the leaderboard: everyone, top or managers.');
  }
  writeSetting_(ctx, 'leaderboardVisibility', v);
  return { status: 'success', visibility: v, message:
    v === 'everyone' ? 'Everyone sees the full board.'
  : v === 'top'      ? 'The team sees the top ' + LEADERBOARD_TOP_N + ' and their own place.'
                     : 'Only managers see the board.' };
}
