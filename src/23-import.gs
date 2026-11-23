// ===========================================================================
// TEAM IMPORT — add a whole team from an Excel or CSV sheet
// ===========================================================================
//
// Typing forty people in one at a time is where a trial dies. The browser
// reads the sheet (it never leaves the page as a file), shows a preview with
// every problem marked, and sends the good rows here in batches.
//
// Each row goes through addUser_ — the same checks as "Add member": the plan's
// people limit, a username or email already in the team, an email that signs
// in to another company, and only an Admin making an Admin. One bad row never
// stops the others; each gets its own result.
//
// "Reports to" may name someone already in the team, or someone earlier in
// the same sheet, by username, email or full name.

var IMPORT_MAX_ROWS = 50;   // per call; the page sends larger sheets in batches

function importUsers_(ctx, rows, password) {
  requireManager_(ctx); blockIfStopped_(ctx);
  if (!Array.isArray(rows) || !rows.length) throw new Error('There is nobody in that sheet to add.');
  if (rows.length > IMPORT_MAX_ROWS) throw new Error('Send at most ' + IMPORT_MAX_ROWS + ' people at a time.');
  if (!password || String(password).length < 8) throw new Error('Give everyone a starting password of at least 8 characters.');

  var results = [], added = 0;
  rows.forEach(function (raw, i) {
    var r = raw || {};
    var name = String(r.name || '').trim(), email = String(r.email || '').trim().toLowerCase();
    var res = { row: r.row || i + 1, name: name, email: email };
    try {
      if (!name) throw new Error('No name.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('No valid email.');
      var team = readUsers_(ctx);
      var username = importUsername_(String(r.username || '').trim() || email.split('@')[0], team);
      var manager = importManager_(String(r.manager || '').trim(), team);
      if (String(r.manager || '').trim() && !manager) throw new Error('"Reports to" ' + String(r.manager).trim() + ' is not in the team.');
      var role = importRole_(r.role);
      addUser_(ctx, { name: name, username: username, email: email, password: String(password),
        role: role, dept: String(r.dept || '').trim(), jobProfile: String(r.jobProfile || '').trim(),
        phone: String(r.phone || '').trim(), manager: manager });
      res.status = 'added'; res.username = username; added++;
    } catch (e) {
      res.status = 'error'; res.message = e.message;
    }
    results.push(res);
  });
  return { status: 'success', added: added, results: results,
    message: added + ' of ' + rows.length + ' added.' };
}

/** A username from what the sheet gave, made safe and not already taken. */
function importUsername_(wanted, team) {
  var base = String(wanted || 'user').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 24) || 'user';
  var taken = {};
  team.forEach(function (u) { taken[String(u.username).toLowerCase()] = true; });
  var name = base, n = 2;
  while (taken[name]) name = base + n++;
  return name;
}

/** "Reports to" by username, email or full name, among the people already in. */
function importManager_(key, team) {
  if (!key) return '';
  var k = key.toLowerCase();
  for (var i = 0; i < team.length; i++) {
    var u = team[i];
    if (u.active === false) continue;
    if (String(u.username).toLowerCase() === k || String(u.email).toLowerCase() === k ||
        String(u.name).trim().toLowerCase() === k) return u.username;
  }
  return '';
}

/** Admin, HOD or Doer, in the words a sheet might use; anything else is a Doer. */
function importRole_(v) {
  var s = String(v || '').trim().toLowerCase();
  if (s === 'admin' || s === 'owner' || s === 'administrator') return 'Admin';
  if (s === 'hod' || s === 'head' || s === 'manager' || s === 'head of department' || s === 'supervisor') return 'HOD';
  return 'Doer';
}
