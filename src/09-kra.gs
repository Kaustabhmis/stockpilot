// ===========================================================================
// KRA / KPI
// ===========================================================================
//
// A KRA is the area someone is answerable for. A KPI is the number that says
// whether they are meeting it. The old build stored only a title and a weight,
// which makes an appraisal a matter of opinion — "did you do well on Vendor
// Quality?" has no answer without a target. Each row now carries a measurable
// target, its unit, and which direction is good, so two managers rating the
// same person reach the same conclusion.
//
// KRA_MASTER_COLS is the old sheet plus appended columns. Existing rows keep
// working; nothing is rewritten.
// ===========================================================================

var KRA_MASTER_COLS = ['Job Profile','KRA Title','Description','Weight','Grid/KPI',
                       'KPI Target','Unit','Direction','How Measured'];

var KPI_UNITS = ['%','days','hours','count','₹','ratio','score'];
var KPI_DIRECTIONS = ['higher is better','lower is better','on target'];

/** One row, normalised. Accepts the old shape so nothing already saved is lost. */
function normKra_(k) {
  k = k || {};
  var dir = String(k.direction || '').toLowerCase();
  if (KPI_DIRECTIONS.indexOf(dir) < 0) dir = 'higher is better';
  return {
    item:      String(k.item || k.name || '').trim(),
    desc:      String(k.desc || k.description || '').trim(),
    weight:    Math.max(0, Number(k.weight) || 0),
    target:    k.target === '' || k.target == null ? '' : String(k.target).trim(),
    unit:      KPI_UNITS.indexOf(String(k.unit || '')) > -1 ? String(k.unit) : '',
    direction: dir,
    measured:  String(k.measured || k.howMeasured || '').trim(),
    grid:      String(k.grid || '').trim(),     // kept so old rows survive a round trip
  };
}

/**
 * Who has a usable KRA set and who does not. The point is to make the gap
 * visible: a workspace where half the team has no KRAs produces appraisals that
 * look rigorous and are not.
 */
function getKraOverview_(ctx) {
  requireManager_(ctx);
  var users = readUsers_(ctx).filter(function (u) { return u.active !== false; });
  var profiles = {};

  var rows = users.map(function (u) {
    var kras = (u.kras || []).map(normKra_).filter(function (k) { return k.item; });
    var total = kras.reduce(function (s, k) { return s + k.weight; }, 0);
    var withTarget = kras.filter(function (k) { return k.target !== ''; }).length;
    if (u.jobProfile) (profiles[u.jobProfile] = profiles[u.jobProfile] || []).push(u.username);

    var state = !kras.length ? 'missing'
              : total > 100 ? 'over'
              : total < 100 ? 'partial'
              : withTarget < kras.length ? 'no-targets'
              : 'complete';
    return { username:u.username, name:u.name, role:u.role, dept:u.dept,
             jobProfile:u.jobProfile || '', count:kras.length, totalWeight:total,
             withTarget:withTarget, state:state, kras:kras };
  });

  return { status:'success', people: rows,
    profiles: Object.keys(profiles).map(function (p) {
      return { profile:p, people:profiles[p].length }; }),
    units: KPI_UNITS, directions: KPI_DIRECTIONS,
    summary: {
      total: rows.length,
      complete: rows.filter(function (r) { return r.state === 'complete'; }).length,
      missing: rows.filter(function (r) { return r.state === 'missing'; }).length,
      partial: rows.filter(function (r) { return r.state === 'partial' || r.state === 'no-targets'; }).length,
    } };
}

/** Saves one person's set. Replaces addKRA_ and keeps its route working. */
function saveKra_(ctx, data) {
  requireManager_(ctx); blockIfStopped_(ctx);
  data = data || {};
  var u = findUser_(ctx.ss, data.employee);
  if (!u) throw new Error('That person is not in this workspace.');
  if (u.role === 'Admin' && ctx.actor.role !== 'Admin') {
    throw new Error('Only an Admin can set another Admin\'s KRAs.');
  }

  var rows = (data.kras || []).map(normKra_).filter(function (k) { return k.item; });
  var v = validateKraBlueprint(rows);
  if (!v.ok) throw new Error(v.error);

  var dupes = {};
  for (var i = 0; i < rows.length; i++) {
    var key = rows[i].item.toLowerCase();
    if (dupes[key]) throw new Error('"' + rows[i].item + '" is listed twice.');
    dupes[key] = true;
  }

  setUserField_(ctx.ss, u.rowIndex, 'KRAs JSON', JSON.stringify(rows));

  /* Writing the job-profile standard is OPT-IN. It used to happen on every save,
     so tailoring one person's KRAs quietly redefined the standard for everyone
     holding that job title — and the next person to inherit it got whatever the
     last editor happened to type. */
  if (u.jobProfile && data.alsoProfile === true) writeProfileMaster_(ctx, u.jobProfile, rows);

  return { status:'success', total:v.total, warning:v.warning || '',
    withoutTarget: rows.filter(function (k) { return k.target === ''; }).length,
    savedAsProfileStandard: u.jobProfile && data.alsoProfile === true ? u.jobProfile : null,
    message: 'Saved ' + rows.length + ' KRA(s) for ' + u.name + ', ' + v.total + '% allocated.' +
      (u.jobProfile && data.alsoProfile === true
        ? ' Also saved as the standard for "' + u.jobProfile + '".' : '') };
}

/** The job-profile master, so the next person hired into the role inherits it. */
function writeProfileMaster_(ctx, profile, rows) {
  var sh = mkTab_(ctx.ss, TAB.KRA, KRA_MASTER_COLS);
  widen_(sh, KRA_MASTER_COLS);
  var d = sh.getDataRange().getValues();
  for (var i = d.length - 1; i > 0; i--) {
    if (String(d[i][0]).trim().toLowerCase() === String(profile).trim().toLowerCase()) sh.deleteRow(i + 1);
  }
  if (!rows.length) return;
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, KRA_MASTER_COLS.length)
    .setValues(rows.map(function (k) {
      return [profile, k.item, k.desc, k.weight, k.grid, k.target, k.unit, k.direction, k.measured]; }));
}

function readProfileMaster_(ctx, profile) {
  var sh = ctx.ss.getSheetByName(TAB.KRA);
  if (!sh) return [];
  var d = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][0]).trim().toLowerCase() !== String(profile).trim().toLowerCase()) continue;
    if (!d[i][1]) continue;
    out.push(normKra_({ item:d[i][1], desc:d[i][2], weight:d[i][3], grid:d[i][4],
                        target:d[i][5], unit:d[i][6], direction:d[i][7], measured:d[i][8] }));
  }
  return out;
}

/** What to prefill the editor with: their own set, else their profile's. */
function getKraFor_(ctx, username) {
  requireManager_(ctx);
  var u = findUser_(ctx.ss, username);
  if (!u) throw new Error('That person is not in this workspace.');
  var own = (u.kras || []).map(normKra_).filter(function (k) { return k.item; });
  var fromProfile = own.length ? [] : readProfileMaster_(ctx, u.jobProfile);
  return { status:'success',
    employee: { username:u.username, name:u.name, jobProfile:u.jobProfile || '', dept:u.dept, role:u.role },
    kras: own.length ? own : fromProfile,
    inheritedFromProfile: !own.length && fromProfile.length > 0,
    units: KPI_UNITS, directions: KPI_DIRECTIONS };
}

/** Copies one person's set onto another. */
function copyKraFrom_(ctx, fromUsername, toUsername) {
  requireManager_(ctx); blockIfStopped_(ctx);
  var from = findUser_(ctx.ss, fromUsername), to = findUser_(ctx.ss, toUsername);
  if (!from || !to) throw new Error('One of those people is not in this workspace.');
  var rows = (from.kras || []).map(normKra_).filter(function (k) { return k.item; });
  if (!rows.length) throw new Error(from.name + ' has no KRAs to copy.');
  setUserField_(ctx.ss, to.rowIndex, 'KRAs JSON', JSON.stringify(rows));
  return { status:'success', count: rows.length,
    message: 'Copied ' + rows.length + ' KRA(s) from ' + from.name + ' to ' + to.name + '.' };
}

/**
 * Applies a profile's set to everyone holding that profile. Only fills people
 * who have none unless overwrite is explicitly asked for — quietly replacing a
 * manager's tailored set with a generic one is how trust in the tool is lost.
 */
function applyKraToProfile_(ctx, profile, overwrite) {
  requireManager_(ctx); blockIfStopped_(ctx);
  if (!profile) throw new Error('Pick a job profile.');
  var rows = readProfileMaster_(ctx, profile);
  if (!rows.length) throw new Error('No KRA set is saved for "' + profile + '" yet.');

  var users = readUsers_(ctx).filter(function (u) {
    return u.active !== false &&
           String(u.jobProfile || '').trim().toLowerCase() === String(profile).trim().toLowerCase(); });
  if (!users.length) throw new Error('Nobody holds the profile "' + profile + '".');

  var applied = 0, skipped = [];
  users.forEach(function (u) {
    var own = (u.kras || []).filter(function (k) { return k && (k.item || k.name); });
    if (own.length && !overwrite) { skipped.push(u.name); return; }
    setUserField_(ctx.ss, u.rowIndex, 'KRAs JSON', JSON.stringify(rows));
    applied++;
  });

  return { status:'success', applied:applied, skipped:skipped,
    message: applied + ' of ' + users.length + ' updated' +
      (skipped.length ? '. Left alone, because they already have their own: ' + skipped.join(', ') : '.') };
}

/** Removes a person's set without touching the profile master. */
function clearKra_(ctx, username) {
  requireManager_(ctx); blockIfStopped_(ctx);
  var u = findUser_(ctx.ss, username);
  if (!u) throw new Error('That person is not in this workspace.');
  setUserField_(ctx.ss, u.rowIndex, 'KRAs JSON', JSON.stringify([]));
  return { status:'success', message: 'Cleared the KRAs for ' + u.name + '.' };
}
