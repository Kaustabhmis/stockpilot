/* ---------- import the team from Excel or CSV -------------------------------
   The sheet is read here, in the browser: an .xlsx is a zip of XML files, and
   the browser can unzip it itself, so no library is loaded and the file never
   leaves the page. Everyone is shown in a preview with any problem marked;
   only the good rows are sent, twenty at a time, through the same checks as
   "Add member". */

var IMPORT_COLS = [
  ['name', /^(full\s*)?name$|^employee(\s*name)?$|^staff(\s*name)?$/],
  ['email', /^e-?mail(\s*(id|address))?$/],
  ['phone', /^(phone|mobile|whatsapp|contact)(\s*(no\.?|number))?$/],
  ['role', /^role$|^access$/],
  ['dept', /^dep(artmen)?t\.?$|^department$|^section$/],
  ['jobProfile', /^job\s*(profile|title)$|^designation$|^position$|^post$/],
  ['manager', /^reports?\s*to$|^manager$|^reporting\s*(manager|to)$|^supervisor$/],
  ['username', /^user\s*-?name$|^login$/],
];

function openImport() {
  openModal('<div class="p-6 lg:p-7">' +
    '<h2 class="text-2xl font-black mb-1">Import your team</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">From an Excel (.xlsx) or CSV file. One person per row; ' +
      'the first row is the column names. Nothing is added until you check the preview.</p>' +
    '<div class="flex flex-wrap gap-3 mb-4">' +
      '<button type="button" id="impPick" class="btn btn-p flex items-center gap-1"><span class="material-icons text-base">upload_file</span> Choose file</button>' +
      '<button type="button" id="impTpl" class="btn btn-g flex items-center gap-1"><span class="material-icons text-base">download</span> Download template</button>' +
      '<input type="file" id="impFile" class="hidden" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv">' +
    '</div>' +
    '<p class="text-xs text-gray-500 font-semibold mb-4">Columns: <b>Name</b>, <b>Email</b> (needed), and any of Phone, Role (Admin, HOD or Doer), ' +
      'Department, Job profile, Reports to (their manager’s name or email).</p>' +
    '<div id="impBody"></div></div>', 'max-w-4xl');
  $('impPick').addEventListener('click', function () { $('impFile').click(); });
  $('impTpl').addEventListener('click', downloadImportTemplate);
  $('impFile').addEventListener('change', function () {
    var f = this.files && this.files[0]; this.value = '';
    if (!f) return;
    $('impBody').innerHTML = '<p class="text-sm font-bold text-gray-500">Reading ' + esc(f.name) + '…</p>';
    readTeamSheet(f).then(function (rows) { previewImport(rowsToPeople(rows)); })
      .catch(function (e) { $('impBody').innerHTML = '<p class="text-sm font-bold text-red-700">' + esc(e.message) + '</p>'; });
  });
}

function downloadImportTemplate() {
  var lines = ['Name,Email,Phone,Role,Department,Job profile,Reports to',
    'Sruti Das,sruti@yourcompany.in,9876543210,HOD,Operations,Operations Head,',
    'Payel Sen,payel@yourcompany.in,9876500001,Doer,Despatch,Executive,Sruti Das'];
  /* The byte-order mark makes Excel read it as UTF-8, so names stay intact. */
  var blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'domebox-team-template.csv';
  document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/** The sheet's rows as arrays of text, from .xlsx or .csv. */
function readTeamSheet(file) {
  var name = String(file.name || '').toLowerCase();
  if (file.size > 5 * 1024 * 1024) return Promise.reject(new Error('That file is over 5 MB. A team list is far smaller — is it the right file?'));
  if (/\.csv$/.test(name) || file.type === 'text/csv') {
    return file.text().then(function (t) { return parseCsv(t.replace(/^﻿/, '')); });
  }
  if (/\.xlsx$/.test(name)) return file.arrayBuffer().then(readXlsx);
  if (/\.xls$/.test(name)) return Promise.reject(new Error('That is the old .xls format. In Excel, use File → Save As → Excel Workbook (.xlsx) or CSV, then choose it again.'));
  return Promise.reject(new Error('Choose an Excel (.xlsx) or CSV file.'));
}

function parseCsv(text) {
  var rows = [], row = [], cell = '', q = false;
  var sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/* ---- a small .xlsx reader: the zip directory, then the first sheet's XML ---- */
function readXlsx(buf) {
  var v = new DataView(buf), bytes = new Uint8Array(buf);
  if (typeof DecompressionStream === 'undefined') {
    return Promise.reject(new Error('This browser cannot open Excel files. Save the sheet as CSV and choose that instead.'));
  }
  var eocd = -1;
  for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return Promise.reject(new Error('That file is not a readable Excel workbook.'));
  var count = v.getUint16(eocd + 10, true), p = v.getUint32(eocd + 16, true), files = {};
  var dec = new TextDecoder();
  for (var n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    var method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
    var nlen = v.getUint16(p + 28, true), elen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
    var local = v.getUint32(p + 42, true), fname = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    files[fname] = { method: method, csize: csize, local: local };
    p += 46 + nlen + elen + clen;
  }
  var read = function (fname) {
    var f = files[fname];
    if (!f) return Promise.resolve('');
    var lh = f.local, start = lh + 30 + v.getUint16(lh + 26, true) + v.getUint16(lh + 28, true);
    var data = bytes.subarray(start, start + f.csize);
    if (f.method === 0) return Promise.resolve(dec.decode(data));
    if (f.method !== 8) return Promise.reject(new Error('That workbook is packed in a way this page cannot read. Save it as CSV.'));
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  };
  var sheet = Object.keys(files).filter(function (f) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(f); })
    .sort(function (a, b) { return Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]); })[0];
  if (!sheet) return Promise.reject(new Error('That workbook has no sheet in it.'));
  return Promise.all([read('xl/sharedStrings.xml'), read(sheet)]).then(function (xs) {
    var P = new DOMParser();
    var shared = [];
    if (xs[0]) P.parseFromString(xs[0], 'application/xml').querySelectorAll('si').forEach(function (si) {
      shared.push(Array.prototype.map.call(si.querySelectorAll('t'), function (t) { return t.textContent; }).join(''));
    });
    var rows = [];
    P.parseFromString(xs[1], 'application/xml').querySelectorAll('sheetData > row').forEach(function (r) {
      var out = [];
      r.querySelectorAll('c').forEach(function (c) {
        var ref = c.getAttribute('r') || '', col = 0, m = ref.match(/^[A-Z]+/);
        if (m) for (var k = 0; k < m[0].length; k++) col = col * 26 + (m[0].charCodeAt(k) - 64);
        var t = c.getAttribute('t'), val = c.querySelector('v'), txt = '';
        if (t === 's') txt = shared[Number(val && val.textContent)] || '';
        else if (t === 'inlineStr') txt = Array.prototype.map.call(c.querySelectorAll('is t'), function (x) { return x.textContent; }).join('');
        else txt = val ? val.textContent : '';
        out[(col || out.length + 1) - 1] = txt;
      });
      for (var j = 0; j < out.length; j++) if (out[j] == null) out[j] = '';
      rows.push(out);
    });
    return rows;
  });
}

/** Rows of text into people, by the column names in the first non-empty row. */
function rowsToPeople(rows) {
  rows = rows.filter(function (r) { return r && r.some(function (c) { return String(c || '').trim(); }); });
  if (rows.length < 2) throw new Error('That sheet has no people in it: the first row should be column names, then one person per row.');
  var head = rows[0].map(function (h) { return String(h || '').trim().toLowerCase().replace(/[_*]/g, ' ').replace(/\s+/g, ' '); });
  var at = {};
  IMPORT_COLS.forEach(function (c) { var i = head.findIndex(function (h) { return c[1].test(h); }); if (i > -1) at[c[0]] = i; });
  if (at.name == null || at.email == null) throw new Error('The first row needs a "Name" and an "Email" column. Download the template to see the layout.');
  return rows.slice(1).map(function (r, i) {
    var p = { row: i + 2 };
    IMPORT_COLS.forEach(function (c) { if (at[c[0]] != null) p[c[0]] = String(r[at[c[0]]] == null ? '' : r[at[c[0]]]).trim(); });
    p.email = String(p.email || '').toLowerCase();
    if (/^\d+\.\d+e\+?\d+$/i.test(p.phone || '')) p.phone = String(Math.round(Number(p.phone)));
    return p;
  });
}

/** What is wrong with a row before it is sent, so the preview can say so. */
function importProblem(p, seen) {
  if (!p.name) return 'No name';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) return 'No valid email';
  if (seen[p.email]) return 'Twice in this sheet (row ' + seen[p.email] + ')';
  if ((TEAM || []).some(function (u) { return String(u.email).toLowerCase() === p.email; })) return 'Already in the team';
  if (p.role && !/^(admin|owner|administrator|hod|head|manager|head of department|supervisor|doer|staff|member|employee)$/i.test(p.role)) return 'Role must be Admin, HOD or Doer';
  return '';
}

function previewImport(people) {
  var seen = {}, good = [];
  people.forEach(function (p) { p.problem = importProblem(p, seen); if (!seen[p.email] && p.email) seen[p.email] = p.row; if (!p.problem) good.push(p); });
  /* Managers first: someone who reports to a person further down the sheet is
     added after them, so "Reports to" finds them. */
  var byKey = {};
  good.forEach(function (p) { byKey[p.email] = p; byKey[p.name.toLowerCase()] = p; });
  var ordered = [], placed = {};
  var visiting = {};
  var place = function (p) {
    if (placed[p.row] || visiting[p.row]) return;   // already in, or a loop (A reports to B, B to A)
    visiting[p.row] = true;
    var m = p.manager && byKey[p.manager.toLowerCase()];
    if (m && m !== p) place(m);
    placed[p.row] = true; ordered.push(p);
  };
  good.forEach(function (p) { place(p); });

  var bad = people.length - good.length;
  $('impBody').innerHTML =
    '<div class="flex flex-wrap items-center gap-3 mb-3">' +
      '<span class="text-sm font-black text-emerald-700">' + good.length + ' ready to add</span>' +
      (bad ? '<span class="text-sm font-black text-red-700">' + bad + ' with a problem (left out)</span>' : '') + '</div>' +
    '<div class="max-h-[42vh] overflow-auto border border-gray-100 rounded-2xl mb-4"><table class="w-full text-xs">' +
      '<thead class="bg-gray-50 sticky top-0"><tr class="text-left text-gray-500">' +
        '<th class="p-2">Row</th><th class="p-2">Name</th><th class="p-2">Email</th><th class="p-2">Role</th>' +
        '<th class="p-2 sm-up">Department</th><th class="p-2 sm-up">Reports to</th><th class="p-2">Check</th></tr></thead><tbody>' +
      people.map(function (p) {
        return '<tr class="border-t border-gray-100' + (p.problem ? ' bg-red-50' : '') + '" data-row="' + p.row + '">' +
          '<td class="p-2 text-gray-400">' + p.row + '</td><td class="p-2 font-bold">' + esc(p.name) + '</td>' +
          '<td class="p-2">' + esc(p.email) + '</td><td class="p-2">' + esc(p.role || 'Doer') + '</td>' +
          '<td class="p-2 sm-up">' + esc(p.dept || '') + '</td><td class="p-2 sm-up">' + esc(p.manager || '') + '</td>' +
          '<td class="p-2 font-black imp-st ' + (p.problem ? 'text-red-700' : 'text-emerald-700') + '">' + esc(p.problem || 'OK') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
    (good.length ?
      '<label class="lb" for="impPw">Starting password for everyone</label>' +
      '<div class="flex flex-wrap gap-3 items-start"><input id="impPw" class="in max-w-xs" minlength="8" value="' + esc(suggestPassword()) + '">' +
      '<button type="button" id="impGo" class="btn btn-p">Add ' + good.length + ' ' + (good.length === 1 ? 'person' : 'people') + '</button></div>' +
      '<p class="text-[11px] text-gray-400 font-semibold mt-1">Each person gets a welcome email with their sign-in. Tell them this password, ' +
        'or they can use “Forgot password” to set their own.</p><div id="impProg" class="text-sm font-black mt-3"></div>' : '');
  if (!good.length) return;
  $('impGo').addEventListener('click', function () {
    var pw = $('impPw').value.trim();
    if (pw.length < 8) { toast('The starting password needs at least 8 characters.', 'warn'); return; }
    this.disabled = true;
    runImport(ordered, pw);
  });
}

function suggestPassword() {
  var w = ['Team', 'Plant', 'Shift', 'Work', 'Domebox'][Math.floor(Math.random() * 5)];
  return w + '@' + (1000 + Math.floor(Math.random() * 9000));
}

function runImport(people, pw) {
  var size = 20, done = 0, added = 0, failed = 0, i = 0;
  var prog = function (html) { var el = $('impProg'); if (el) el.innerHTML = html; };
  var mark = function (r) {
    var body = $('impBody'), tr = body && body.querySelector('tr[data-row="' + r.row + '"] .imp-st');
    if (!tr) return;
    tr.textContent = r.status === 'added' ? 'Added' : r.message;
    tr.className = 'p-2 font-black imp-st ' + (r.status === 'added' ? 'text-emerald-700' : 'text-red-700');
  };
  var next = function () {
    if (i >= people.length) {
      prog('<span class="text-emerald-700">' + added + ' added.</span>' +
        (failed ? ' <span class="text-red-700">' + failed + ' could not be added — see the reason on each row.</span>' : ''));
      /* The window may have been closed while it worked: say how it went. */
      if (!$('impProg')) toast('Import finished: ' + added + ' added' + (failed ? ', ' + failed + ' could not be added.' : '.'), failed ? 'warn' : 'ok');
      if (added && typeof loadTeam === 'function') loadTeam();
      return;
    }
    var batch = people.slice(i, i + size); i += size;
    prog('Adding… ' + done + ' of ' + people.length);
    api('importUsers', { rows: batch, password: pw }, { quiet: true }).then(function (r) {
      (r.results || []).forEach(function (x) { mark(x); if (x.status === 'added') added++; else failed++; });
      done += batch.length; next();
    }).catch(function (e) {
      batch.forEach(function (p) { mark({ row: p.row, status: 'error', message: e.message }); failed++; });
      done += batch.length; next();
    });
  };
  next();
}
