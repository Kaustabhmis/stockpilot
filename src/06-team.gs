// ===========================================================================
// TEAM
// ===========================================================================

function getUsers_(ctx) {
  var users = readUsers_(ctx);
  var tasks = readTasks_(ctx);
  var range = periodRange(PERIOD.MONTH, 1);               // last full month
  var cal = leaveCalendar_(ctx);

  return { status: 'success', users: users.map(function (u) {
    if (!canSeePerson_(ctx, u.username)) {
      /* A colleague outside your line: enough to recognise and assign to,
         not their contact details, score or KRAs. */
      var pub = publicPerson_(ctx, { name: u.name, username: u.username, role: u.role, jobProfile: u.jobProfile,
        dept: u.dept, manager: u.manager, active: u.active });
      /* Present but empty, so the screen shows "no data" rather than "undefined". */
      pub.openTasks = tasks.filter(function (t) { return t.assignee === u.username && isOpen(t.status); }).length;
      pub.wip = null; pub.lastMonthScore = null; pub.lastMonthBand = null; pub.canEdit = false;
      return pub;
    }
    var wip = wipStatus(tasks, u.username, u.wipLimit == null ? DEFAULT_WIP_LIMIT : u.wipLimit);
    var s = scoreForPeriod(tasks, u.username, range, cal, scoreOpts_(ctx, u.username));
    return {
      /* Deliberately no password field. The old getUsersList returned every
         employee's password to the browser in plain text. */
      name: u.name, username: u.username, email: u.email, role: u.role,
      jobProfile: u.jobProfile, dept: u.dept, phone: u.phone, manager: u.manager,
      active: u.active, wipLimit: u.wipLimit, kras: u.kras, waOptIn: u.waOptIn,
      openTasks: tasks.filter(function (t) { return t.assignee === u.username && isOpen(t.status); }).length,
      wip: { count: wip.count, limit: wip.limit, exceeded: wip.exceeded },
      lastMonthScore: s.hasData ? s.score : null,
      lastMonthBand: s.hasData ? performanceBand(s.score).band : null,
      /* Whether the Edit button would work: a manager, on their own line, and
         only an Admin edits an Admin. The server checks again on save. */
      canEdit: ctx.actor.role !== ROLE.DOER && !(u.role === ROLE.ADMIN && ctx.actor.role !== ROLE.ADMIN),
    };
  }) };
}

/* Serialised: this reads, decides, then writes. Without the lock two
   simultaneous calls both pass the check — a duplicate username, or one user more than the plan allows. */
function addUser_(ctx, form) {
  return withLock_(function () { return addUser_locked_(ctx,form); });
}
function addUser_locked_(ctx, form) {
  requireManager_(ctx); blockIfStopped_(ctx);
  form = form || {};
  var username = String(form.username || '').trim();
  var email = String(form.email || '').trim().toLowerCase();
  if (!username || !email || !form.name) throw new Error('Name, username and email are required.');
  if (!form.password || String(form.password).length < 8) {
    throw new Error('Give them a password of at least 8 characters.');
  }

  var users = readUsers_(ctx);
  var active = users.filter(function (u) { return u.active !== false; }).length;
  var gate = canAddUser(ctx.planName, active);
  if (!gate.ok) throw new Error(gate.reason + (gate.upgradeTo ? ' Upgrade to ' + gate.upgradeTo + '.' : ''));

  for (var i = 0; i < users.length; i++) {
    if (users[i].username.toLowerCase() === username.toLowerCase()) throw new Error('That username is taken.');
    if (users[i].email.toLowerCase() === email) throw new Error('That email is already in this workspace.');
  }
  /* One email opens one workspace. Sign-up already refuses an email in use
     anywhere; without the same rule here a second row is written, sign-in
     always finds the first, and this person can never get into this company. */
  if (emailInOtherWorkspace_(email, ctx.sheetId)) throw new Error(EMAIL_ELSEWHERE_MSG);
  // A Doer must not be able to mint an Admin.
  var role = ['Admin','HOD','Doer'].indexOf(form.role) > -1 ? form.role : 'Doer';
  if (role === 'Admin' && ctx.actor.role !== 'Admin') throw new Error('Only an Admin can create another Admin.');

  var hash = makePasswordHash(String(form.password));
  var row = blankUserRow_();
  row[U['Name']] = String(form.name).trim();
  row[U['Username']] = username;
  row[U['Password']] = hash;
  row[U['Email']] = email;
  row[U['Role']] = role;
  row[U['Job Profile']] = String(form.jobProfile || '');
  row[U['Dept']] = String(form.dept || '');
  row[U['Phone']] = String(form.phone || '');
  row[U['Manager']] = String(form.manager || '').trim();
  row[U['Active']] = true;
  row[U['WIP Limit']] = form.wipLimit === '' || form.wipLimit == null ? '' : Number(form.wipLimit);
  row[U['KRAs JSON']] = JSON.stringify(form.kras || []);
  row[U['WhatsApp OptIn']] = !!form.waOptIn;
  ctx.ss.getSheetByName(TAB.USERS).appendRow(row);
  dropCache_(ctx);

  // Global registry entry, so this person can sign in.
  try {
    var g = mkTab_(SpreadsheetApp.openById(CFG().masterId), TAB.GLOBAL,
      ['Email','Password','SheetID','Username']);
    g.appendRow([email, hash, ctx.sheetId, username]);
    dropCache_(ctx);
  } catch (e) { logError_('addUser:global', e.message); }

  try { sendWelcomeStaff_(email, form.name, ctx.company, username); } catch (e) {}
  return { status: 'success', message: form.name + ' added.' };
}

var EMAIL_ELSEWHERE_MSG = 'That email already signs in to another Domebox workspace. ' +
  'Each email opens one workspace, so use a different email for this person, ' +
  'or ask the other company to remove them first.';

/** Is this email on the sign-in list for a company other than this one? */
function emailInOtherWorkspace_(email, sheetId) {
  var master = SpreadsheetApp.openById(CFG().masterId);
  var g = master.getSheetByName(TAB.GLOBAL);
  if (!g) return false;
  /* Only companies that still exist count. A row left behind by a company
     that was removed (an old demo, a test signup) must not make an email look
     taken for ever. */
  var live = {}, dir = master.getSheetByName(TAB.DIRECTORY);
  if (dir) dir.getDataRange().getValues().slice(1).forEach(function (r) { live[String(r[5]).trim()] = true; });
  var d = g.getDataRange().getValues(), key = String(email).trim().toLowerCase();
  for (var i = 1; i < d.length; i++) {
    var sid = String(d[i][2]).trim();
    if (String(d[i][0]).trim().toLowerCase() === key && sid !== String(sheetId).trim() && live[sid]) return true;
  }
  return false;
}

function renameGlobalEmail_(oldEmail, newEmail, sheetId) {
  try {
    var g = SpreadsheetApp.openById(CFG().masterId).getSheetByName(TAB.GLOBAL);
    if (!g) return;
    var d = g.getDataRange().getValues(), key = String(oldEmail).trim().toLowerCase();
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][0]).trim().toLowerCase() === key && String(d[i][2]).trim() === String(sheetId).trim()) {
        g.getRange(i + 1, 1).setValue(newEmail);
      }
    }
  } catch (e) { logError_('renameGlobalEmail', e.message); }
}

function updateUser_(ctx, form) {
  requireManager_(ctx); blockIfStopped_(ctx);
  form = form || {};
  var target = findUser_(ctx.ss, form.originalUsername || form.username);
  if (!target) throw new Error('That person is not in this workspace.');

  if (target.role === 'Admin' && ctx.actor.role !== 'Admin') {
    throw new Error('Only an Admin can edit another Admin.');
  }
  /* A manager edits their own team, not a peer manager or another team — or
     anyone could set a colleague's password and sign in as them. Their own
     record they may tidy, but not their password (that needs the current one),
     their manager, or whether they are active. */
  if (target.username !== ctx.actor.username) requireCanManage_(ctx, target.username);
  else if (ctx.actor.role !== 'Admin' && (form.password ||
      (form.manager !== undefined && String(form.manager).trim() !== String(target.manager || '').trim()) ||
      (form.active !== undefined && !!form.active !== (target.active !== false)))) {
    throw new Error('Change your own password from your account menu. Your manager or an Admin changes the rest.');
  }
  if (form.role && form.role !== target.role && ctx.actor.role !== 'Admin') {
    throw new Error('Only an Admin can change a role.');
  }

  var sh = ctx.ss.getSheetByName(TAB.USERS);
  var set = function (col, val) {
    sh.getRange(target.rowIndex, U[col] + 1).setValue(val);
    dropCache_(ctx);
  };

  if (form.name) set('Name', String(form.name).trim());
  var newEmail = form.email ? String(form.email).trim().toLowerCase() : '';
  if (newEmail && newEmail !== String(target.email).toLowerCase()) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) throw new Error('That email does not look right.');
    readUsers_(ctx).forEach(function (u) {
      if (u.username !== target.username && String(u.email).toLowerCase() === newEmail) {
        throw new Error('That email is already in this workspace.');
      }
    });
    if (emailInOtherWorkspace_(newEmail, ctx.sheetId)) throw new Error(EMAIL_ELSEWHERE_MSG);
    set('Email', newEmail);
    /* The sign-in list is keyed by email: move it too, or they keep signing
       in with the old address and a new password never reaches it. */
    renameGlobalEmail_(target.email, newEmail, ctx.sheetId);
  }
  if (form.role && ['Admin','HOD','Doer'].indexOf(form.role) > -1) set('Role', form.role);
  if (form.jobProfile !== undefined) set('Job Profile', String(form.jobProfile));
  if (form.dept !== undefined) set('Dept', String(form.dept));
  if (form.phone !== undefined) set('Phone', String(form.phone));
  if (form.manager !== undefined) set('Manager', String(form.manager).trim());
  if (form.wipLimit !== undefined) set('WIP Limit', form.wipLimit === '' || form.wipLimit == null ? '' : Number(form.wipLimit));
  if (form.waOptIn !== undefined) set('WhatsApp OptIn', !!form.waOptIn);

  if (form.kras !== undefined) {
    var v = validateKraBlueprint(form.kras);
    if (!v.ok && (form.kras || []).length) throw new Error(v.error);
    set('KRAs JSON', JSON.stringify(form.kras || []));
  }

  if (form.password) {
    if (String(form.password).length < 8) throw new Error('Password must be at least 8 characters.');
    var hash = makePasswordHash(String(form.password));
    set('Password', hash);
    syncGlobalPassword_(newEmail || target.email, ctx.sheetId, hash);
    endSessions_(ctx, target.username);
  }

  if (form.active === false) return deactivateUser_(ctx, target, form.reassignTo);
  if (form.active === true) set('Active', true);

  return { status: 'success', message: 'Saved.' };
}

/**
 * Deactivating someone who still holds open work would hide that work from
 * every board — it is still owed, and nobody can see it. So the caller must say
 * where it goes.
 */
function deactivateUser_(ctx, target, reassignTo) {
  var tasks = readTasks_(ctx);
  var stranded = tasks.filter(function (t) { return t.assignee === target.username && isOpen(t.status); });

  if (stranded.length && !reassignTo) {
    return { status: 'needs_reassign', count: stranded.length,
      tasks: stranded.map(function (t) { return { id: t.id, title: t.title, due: t.due }; }),
      message: target.name + ' still has ' + stranded.length + ' open task(s). Choose who takes them.' };
  }
  if (stranded.length) {
    var to = findUser_(ctx.ss, reassignTo);
    if (!to || to.active === false) throw new Error('Pick an active person to take the work.');
    stranded.forEach(function (t) {
      var hit = findTaskRow_(ctx, t.id);
      if (!hit) return;
      writeTaskField_(hit, 'Assigned To', to.username);
      appendHistory_(hit, t.status, ctx.actor.name,
        'Reassigned from ' + target.name + ' on deactivation');
    });
  }
  ctx.ss.getSheetByName(TAB.USERS).getRange(target.rowIndex, U['Active'] + 1).setValue(false);
  dropCache_(ctx);
  return { status: 'success',
    message: target.name + ' deactivated' + (stranded.length ? '; ' + stranded.length + ' task(s) moved.' : '.') };
}

function deleteUser_(ctx, username, reassignTo) {
  requireAdmin_(ctx); blockIfStopped_(ctx);
  var target = findUser_(ctx.ss, username);
  if (!target) throw new Error('That person is not in this workspace.');
  if (target.username === ctx.actor.username) throw new Error('You cannot remove your own account.');

  var admins = readUsers_(ctx).filter(function (u) { return u.role === 'Admin' && u.active !== false; });
  if (target.role === 'Admin' && admins.length <= 1) {
    throw new Error('That is the last Admin. Promote someone else first, or the workspace locks itself out.');
  }

  /* Deactivate rather than delete. Removing the row orphans every task they ever
     touched and silently rewrites history — the audit trail stops making sense. */
  var res = deactivateUser_(ctx, target, reassignTo);
  if (res.status === 'needs_reassign') return res;

  try {
    var g = SpreadsheetApp.openById(CFG().masterId).getSheetByName(TAB.GLOBAL);
    if (g) {
      var d = g.getDataRange().getValues();
      for (var i = d.length - 1; i > 0; i--) {
        if (String(d[i][0]).trim().toLowerCase() === target.email.toLowerCase() &&
            String(d[i][2]).trim() === String(ctx.sheetId)) { g.deleteRow(i + 1); }
      /* The global login registry, not this tenant's sheets — but the user row
         itself has already changed, so the cache goes either way. */
      dropCache_(ctx);
      }
    }
  } catch (e) { logError_('deleteUser:global', e.message); }

  return { status: 'success',
    message: target.name + ' can no longer sign in. Their task history is kept.' };
}
