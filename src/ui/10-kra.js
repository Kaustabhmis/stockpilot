/* ---------- KRA / KPI ------------------------------------------------------
   A KRA is what somebody is answerable for; a KPI is the number that settles
   whether they met it. Without the number an appraisal is two people's
   recollections, so the editor asks for a target, its unit and which direction
   is good — but never insists, because plenty of real KRAs ("keep the plant
   audit-ready") are judged, not counted. The overview exists to make the gap
   visible: a workspace where half the team has no KRAs produces appraisals that
   look rigorous and are not.
   -------------------------------------------------------------------------- */
var KRA = { units: ['%','days','hours','count','₹','ratio','score'],
            directions: ['higher is better','lower is better','on target'] };

function openKraOverview() {
  openModal('<div class="p-6 lg:p-7"><div class="flex justify-between items-start mb-1">' +
    '<h2 class="text-2xl font-black">KRA &amp; KPI</h2>' +
    '<button onclick="closeModal()" class="text-gray-400 hover:text-gray-900">' +
    '<span class="material-icons">close</span></button></div>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">What each person is answerable for, and ' +
      'the number that settles it.</p>' +
    '<div id="kraBody" class="text-sm text-gray-400 font-semibold">Loading…</div></div>', 'max-w-4xl');
  loadKraOverview();
}

function loadKraOverview() {
  api('getKraOverview').then(function (r) {
    KRA.units = r.units || KRA.units;
    KRA.directions = r.directions || KRA.directions;
    var s = r.summary;
    var tile = function (k, v, tone) {
      return '<div class="bg-gray-50 rounded-2xl p-3 text-center">' +
        '<div class="text-[10px] font-black uppercase tracking-widest text-gray-400">' + esc(k) + '</div>' +
        '<div class="text-2xl font-black mt-1 ' + (tone || '') + '">' + v + '</div></div>';
    };
    var label = { complete: ['Complete', 'bg-emerald-50 text-emerald-700'],
                  partial:  ['Weights short of 100%', 'bg-amber-50 text-amber-800'],
                  over:     ['Weights over 100%', 'bg-red-50 text-red-700'],
                  missing:  ['No KRAs set', 'bg-red-50 text-red-700'] };

    $('kraBody').innerHTML =
      '<div class="grid grid-cols-3 gap-3 mb-5">' +
        tile('People', s.total) +
        tile('Fully set', s.complete, s.complete ? 'text-emerald-700' : '') +
        tile('Needs attention', s.missing + s.partial, (s.missing + s.partial) ? 'text-red-700' : '') +
      '</div>' +
      (s.missing ? '<div class="rounded-2xl border border-amber-200 bg-amber-50 p-3 mb-4 text-[13px] ' +
        'font-bold text-amber-900">' + esc(s.missing + ' ' + (s.missing === 1 ? 'person has' : 'people have') +
        ' no KRAs. Their appraisal can only be scored on delivery until that is fixed.') + '</div>' : '') +
      (s.withoutTargets ? '<p class="text-[13px] font-semibold text-gray-500 mb-4">' +
        esc(s.withoutTargets + ' ' + (s.withoutTargets === 1 ? 'person has a KRA' : 'people have KRAs') +
        ' with no KPI target. That is allowed — those are rated by judgement at appraisal.') +
        '</p>' : '') +
      '<table class="tbl"><thead><tr><th>Person</th><th>Job profile</th><th>KRAs</th>' +
        '<th>Weight</th><th>With a target</th><th>State</th><th></th></tr></thead><tbody>' +
      r.people.map(function (x) {
        var l = label[x.state] || ['—', 'bg-gray-100 text-gray-600'];
        return '<tr><td class="font-bold text-gray-800">' + esc(x.name) + '</td>' +
          '<td>' + esc(x.jobProfile || '—') + '</td>' +
          '<td>' + x.count + '</td>' +
          '<td class="font-bold ' + (x.totalWeight > 100 ? 'text-red-700' : '') + '">' +
            (x.count ? x.totalWeight + '%' : '—') + '</td>' +
          '<td>' + (x.count ? x.withTarget + ' of ' + x.count : '—') + '</td>' +
          '<td><span class="chip ' + l[1] + '">' + esc(l[0]) + '</span></td>' +
          '<td class="text-right whitespace-nowrap">' +
            '<button class="text-blue-600 font-black text-xs hover:underline kEdit" data-u="' +
            esc(x.username) + '">' + (x.count ? 'Edit' : 'Set up') + '</button></td></tr>';
      }).join('') + '</tbody></table>' +
      (r.profiles.length ? '<div class="mt-5 pt-5 border-t"><div class="lb">Job profile standards</div>' +
        '<p class="text-[13px] font-semibold text-gray-500 mb-3">Rolling a standard out fills in anyone ' +
          'who has none. People with their own tailored set are left alone unless you say otherwise.</p>' +
        '<div class="flex flex-wrap gap-2 items-end">' +
        '<select id="kProfile" class="in max-w-[240px]">' + r.profiles.map(function (p) {
          return '<option value="' + esc(p.profile) + '">' + esc(p.profile) + ' (' + p.people + ')</option>';
        }).join('') + '</select>' +
        '<label class="flex items-center gap-2 text-sm font-bold text-gray-600">' +
          '<input type="checkbox" id="kOver" class="w-4 h-4 accent-blue-600"> Overwrite tailored sets</label>' +
        '<button id="kApply" class="btn btn-g">Apply to everyone on it</button></div></div>' : '');

    $('kraBody').querySelectorAll('.kEdit').forEach(function (b) {
      b.addEventListener('click', function () { openKraEditor(b.dataset.u); });
    });
    if ($('kApply')) $('kApply').addEventListener('click', function () {
      var btn = $('kApply'); busy(btn, true, 'Applying…');
      api('applyKraToProfile', { profile: $('kProfile').value, overwrite: $('kOver').checked })
        .then(function (res) { toast(res.message, 'ok'); loadKraOverview(); })
        .catch(function (e) { busy(btn, false); toast(e.message, 'err'); });
    });
  }).catch(function (e) { $('kraBody').textContent = e.message; });
}

function openKraEditor(username) {
  api('getKraFor', { username: username }).then(function (r) {
    KRA.units = r.units || KRA.units;
    KRA.directions = r.directions || KRA.directions;
    var rows = (r.kras || []).map(function (k) { return JSON.parse(JSON.stringify(k)); });
    var emp = r.employee;

    openModal('<form id="fKra" class="p-6 lg:p-7">' +
      '<h2 class="text-2xl font-black mb-1">KRAs for ' + esc(emp.name) + '</h2>' +
      '<p class="text-sm text-gray-400 font-semibold mb-4">' +
        esc(emp.jobProfile ? emp.jobProfile : 'No job profile set') +
        '. A KPI target is optional — leave it blank where the result is judged rather than counted.</p>' +
      (r.inheritedFromProfile ? '<div class="rounded-2xl border border-blue-200 bg-blue-50 p-3 mb-4 ' +
        'text-[13px] font-bold text-blue-900">Started from the "' + esc(emp.jobProfile) +
        '" standard. Nothing is saved for ' + esc(emp.name) + ' until you save.</div>' : '') +
      '<div id="kRows" class="space-y-3"></div>' +
      '<button type="button" id="kAdd" class="text-blue-600 font-black text-xs mt-3">+ Add KRA</button>' +
      '<div id="kMsg" class="text-xs font-bold mt-3"></div>' +
      (emp.jobProfile ? '<label class="flex items-start gap-2 text-sm font-bold text-gray-600 mt-4">' +
        '<input type="checkbox" id="kAlso" class="w-4 h-4 accent-blue-600 mt-0.5">' +
        '<span>Also save this as the standard for "' + esc(emp.jobProfile) + '"' +
        '<span class="block text-xs font-semibold text-gray-400">Future hires on that profile start ' +
        'from it. Nobody already set up is changed.</span></span></label>' : '') +
      '<div class="flex gap-3 mt-6">' +
      '<button type="button" class="btn btn-g flex-1" onclick="closeModal()">Cancel</button>' +
      '<button type="submit" class="btn btn-p flex-1">Save KRAs</button></div></form>', 'max-w-3xl');

    function draw() {
      $('kRows').innerHTML = rows.length ? rows.map(function (k, i) {
        return '<div class="rounded-2xl border border-gray-100 p-3 bg-gray-50/60">' +
          '<div class="flex gap-2">' +
            '<input class="in kI" data-i="' + i + '" placeholder="Key result area" value="' + esc(k.item || '') + '">' +
            '<div class="relative" style="max-width:104px">' +
              '<input class="in kW w-full pr-7" data-i="' + i + '" type="number" min="0" max="100" ' +
                'aria-label="Weight in percent" placeholder="Weight" value="' + esc(k.weight || 0) + '">' +
              '<span class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">%</span>' +
            '</div>' +
            '<button type="button" class="kD px-3 text-gray-400 hover:text-red-600" data-i="' + i + '">' +
              '<span class="material-icons text-base">delete</span></button></div>' +
          '<div class="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-2">' +
            '<input class="in kT" data-i="' + i + '" placeholder="Target (optional)" value="' + esc(k.target || '') + '">' +
            '<select class="in kU" data-i="' + i + '"><option value="">Unit</option>' +
              KRA.units.map(function (unit) {
                return '<option value="' + esc(unit) + '"' + (unit === k.unit ? ' selected' : '') + '>' +
                  esc(unit) + '</option>'; }).join('') + '</select>' +
            '<select class="in kDir" data-i="' + i + '">' + KRA.directions.map(function (d) {
                return '<option value="' + esc(d) + '"' + (d === k.direction ? ' selected' : '') + '>' +
                  esc(d) + '</option>'; }).join('') + '</select>' +
            '<input class="in kM" data-i="' + i + '" placeholder="How it is measured" value="' + esc(k.measured || '') + '">' +
          '</div></div>';
      }).join('') : '<p class="text-sm text-gray-400 font-semibold">No KRAs yet. Add the two or three ' +
        'things this person is actually answerable for.</p>';
      check();
      var bind = function (cls, fn) {
        $('kRows').querySelectorAll(cls).forEach(function (el) {
          el.addEventListener('input', function () { fn(rows[+el.dataset.i], el.value); check(); });
          el.addEventListener('change', function () { fn(rows[+el.dataset.i], el.value); check(); });
        });
      };
      bind('.kI', function (k, v) { k.item = v; });
      bind('.kW', function (k, v) { k.weight = Number(v || 0); });
      bind('.kT', function (k, v) { k.target = v; });
      bind('.kU', function (k, v) { k.unit = v; });
      bind('.kDir', function (k, v) { k.direction = v; });
      bind('.kM', function (k, v) { k.measured = v; });
      $('kRows').querySelectorAll('.kD').forEach(function (el) {
        el.addEventListener('click', function () { rows.splice(+el.dataset.i, 1); draw(); }); });
    }

    function check() {
      var m = $('kMsg');
      var live = rows.filter(function (k) { return String(k.item || '').trim(); });
      if (!live.length) { m.textContent = ''; m.className = 'text-xs font-bold mt-3'; return true; }
      var total = live.reduce(function (s, k) { return s + (Number(k.weight) || 0); }, 0);
      var blank = live.filter(function (k) { return !String(k.target || '').trim(); }).length;
      var good = total <= 100;
      var note = good
        ? (total < 100 ? 'Weights total ' + total + '% — ' + (100 - total) + '% unallocated.'
                       : 'Weights total 100%.')
        : 'Weights total ' + total + '%. They cannot go above 100%.';
      if (good && blank) note += ' ' + blank + ' of ' + live.length + ' have no KPI target, so they will be rated by judgement.';
      m.textContent = note;
      m.className = 'text-xs font-bold mt-3 ' +
        (!good ? 'text-red-700' : total < 100 ? 'text-amber-700' : 'text-emerald-700');
      return good;
    }

    draw();
    $('kAdd').addEventListener('click', function () {
      rows.push({ item:'', weight:0, target:'', unit:'', direction:'higher is better', measured:'' });
      draw();
    });

    $('fKra').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!check()) { toast('Fix the weights first.', 'err'); return; }
      var btn = e.target.querySelector('button[type=submit]');
      busy(btn, true, 'Saving…');
      api('saveKra', { data: { employee: emp.username,
        kras: rows.filter(function (k) { return String(k.item || '').trim(); }),
        alsoProfile: !!($('kAlso') && $('kAlso').checked) } })
        .then(function (res) {
          toast(res.message, 'ok');
          openKraOverview();
        })
        .catch(function (err) { busy(btn, false); toast(err.message, 'err'); });
    });
  }).catch(function (e) { toast(e.message, 'err'); });
}
