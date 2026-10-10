/* ---------- chart toolkit (inline SVG, no library) ------------------------ */
var C = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };
var svgEl = function (n, a) { var e = document.createElementNS('http://www.w3.org/2000/svg', n);
  for (var k in a) e.setAttribute(k, a[k]); return e; };

function showTip(html, e) {
  var tip = $('tip');
  tip.innerHTML = html; tip.style.opacity = 1;
  var pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  var x = e.clientX + pad, y = e.clientY - h - pad;
  if (x + w > innerWidth - 8) x = e.clientX - w - pad;
  if (y < 8) y = e.clientY + pad;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function hideTip() { $('tip').style.opacity = 0; }

/** Null values break the line rather than pretending a quiet period scored zero. */
function lineChart(host, series, opts) {
  opts = opts || {};
  var W = host.clientWidth || 720, H = opts.height || 230;
  var m = { t:14, r:16, b:26, l:34 }, iw = W-m.l-m.r, ih = H-m.t-m.b;
  var n = series[0].points.length, yMax = 100;
  var x = function (i) { return m.l + (n===1 ? iw/2 : i*(iw/(n-1))); };
  var y = function (v) { return m.t + ih - (v/yMax)*ih; };
  host.innerHTML = '';
  var svg = svgEl('svg', { width:'100%', height:H, viewBox:'0 0 '+W+' '+H, role:'img' });

  [0,25,50,75,100].forEach(function (v) {
    svg.appendChild(svgEl('line',{x1:m.l,x2:W-m.r,y1:y(v),y2:y(v),class:'gridline'}));
    var t = svgEl('text',{x:m.l-7,y:y(v)+3.5,class:'axis','text-anchor':'end'});
    t.textContent = v; svg.appendChild(t);
  });
  var step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw/40))));
  series[0].points.forEach(function (p, i) {
    if (i % step) return;
    var t = svgEl('text',{x:x(i),y:H-8,class:'axis','text-anchor':'middle'});
    t.textContent = p.label; svg.appendChild(t);
  });

  series.forEach(function (s) {
    var run = [];
    var flush = function () {
      if (run.length > 1) svg.appendChild(svgEl('path',{ d:'M'+run.map(function(p){return x(p.i)+','+y(p.v);}).join('L'),
        fill:'none', stroke:s.color, 'stroke-width':2, 'stroke-linejoin':'round','stroke-linecap':'round' }));
      else if (run.length === 1) svg.appendChild(svgEl('circle',{cx:x(run[0].i),cy:y(run[0].v),r:3,fill:s.color}));
      run = [];
    };
    s.points.forEach(function (p, i) { if (p.value == null) { flush(); return; } run.push({i:i, v:p.value}); });
    flush();
    s.points.forEach(function (p, i) { if (p.value == null) return;
      svg.appendChild(svgEl('circle',{cx:x(i),cy:y(p.value),r:3.5,fill:s.color,stroke:'#fff','stroke-width':2})); });
    for (var i = s.points.length-1; i >= 0; i--) {
      if (s.points[i].value == null) continue;
      var wide = s.name.length*6.4 + 10, flip = x(i)+wide > W-2;
      var lab = svgEl('text',{ x: flip ? x(i)-8 : x(i)+8, y:y(s.points[i].value)+3.5,
        class:'dlabel', fill:s.color, 'text-anchor': flip ? 'end' : 'start' });
      lab.textContent = s.name; svg.appendChild(lab); break;
    }
  });

  var cross = svgEl('line',{y1:m.t,y2:m.t+ih,stroke:C('--muted'),'stroke-width':1,'stroke-dasharray':'3 3',opacity:0});
  svg.appendChild(cross);
  var hit = svgEl('rect',{x:m.l,y:m.t,width:iw,height:ih,fill:'transparent'});
  svg.appendChild(hit);
  hit.addEventListener('mousemove', function (e) {
    var r = svg.getBoundingClientRect(), px = (e.clientX-r.left)*(W/r.width);
    var i = Math.round((px-m.l)/(iw/Math.max(n-1,1)));
    i = Math.max(0, Math.min(n-1, i));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', 1);
    showTip('<div class="t">'+esc(series[0].points[i].label)+'</div>' +
      series.map(function (s) { return '<div class="r"><span><i style="display:inline-block;width:8px;' +
        'height:8px;border-radius:2px;background:'+s.color+';margin-right:6px"></i>'+esc(s.name)+'</span>' +
        '<b>'+(s.points[i].value==null?'no data':s.points[i].value)+'</b></div>'; }).join(''), e);
  });
  hit.addEventListener('mouseleave', function () { cross.setAttribute('opacity',0); hideTip(); });
  host.appendChild(svg);
}

function barsH(host, rows, opts) {
  opts = opts || {};
  var W = host.clientWidth || 480, rowH = 28, H = Math.max(rows.length*rowH+10, 40);
  var labelW = opts.labelW || 118;
  var longest = rows.reduce(function (m, r) {
    var t = r.value == null ? 'no data' : String(r.display == null ? r.value : r.display);
    return Math.max(m, t.length); }, 3);
  var pad = Math.max(46, longest*6.6 + 14), iw = W-labelW-pad;
  var max = opts.max || Math.max.apply(null, [1].concat(rows.map(function (r) { return r.value||0; })));
  host.innerHTML = '';
  if (!rows.length) { host.innerHTML = '<div class="empty">Nothing in this period.</div>'; return; }
  var svg = svgEl('svg',{width:'100%',height:H,viewBox:'0 0 '+W+' '+H,role:'img'});
  rows.forEach(function (r, i) {
    var y = i*rowH+6, bh = 15;
    var lt = svgEl('text',{x:0,y:y+bh-3,class:'axis',fill:C('--ink2')});
    lt.textContent = r.label; svg.appendChild(lt);
    svg.appendChild(svgEl('rect',{x:labelW,y:y,width:iw,height:bh,rx:4,fill:C('--surface2')}));
    var w = r.value == null ? 0 : Math.max(2, (r.value/max)*iw);
    if (r.value != null) {
      var bar = svgEl('rect',{x:labelW,y:y,width:w,height:bh,rx:4,fill:r.color||C('--s1')});
      bar.addEventListener('mousemove', function (e) {
        showTip('<div class="t">'+esc(r.label)+'</div><div class="r"><span>'+esc(opts.metric||'Value')+
          '</span><b>'+(r.display==null?r.value:r.display)+'</b></div>', e); });
      bar.addEventListener('mouseleave', hideTip);
      svg.appendChild(bar);
    }
    var vt = svgEl('text',{x:labelW+w+7,y:y+bh-3,class:'dlabel'});
    vt.textContent = r.value == null ? 'no data' : (r.display == null ? r.value : r.display);
    if (r.value == null) vt.setAttribute('fill', C('--muted'));
    svg.appendChild(vt);
  });
  host.appendChild(svg);
}

function heatmap(host, rowLabels, colLabels, values) {
  var W = host.clientWidth || 1000, gap = 3;
  var gut = Math.min(130, Math.max(52, Math.round(W*0.3)));
  var cell = Math.max(11, Math.min(26, (W-gut-10)/colLabels.length - 3));
  /* If the cells cannot fit even at their minimum, widen the canvas and let the
     container scroll — clipping would drop whole weeks with nothing to show it. */
  var needed = gut + colLabels.length*(cell+gap) + 10, CW = Math.max(W, needed);
  var H = rowLabels.length*(cell+gap)+30;
  var max = Math.max.apply(null, [1].concat([].concat.apply([], values)));
  var ramp = [C('--r1'),C('--r2'),C('--r3'),C('--r4')];
  host.innerHTML = '';
  var svg = svgEl('svg',{width: CW>W?CW:'100%', height:H, viewBox:'0 0 '+CW+' '+H, role:'img'});
  rowLabels.forEach(function (rl, r) {
    var t = svgEl('text',{x:0,y:r*(cell+gap)+cell-2,class:'axis',fill:C('--ink2')});
    t.textContent = rl; svg.appendChild(t);
    values[r].forEach(function (v, c) {
      var x = gut+c*(cell+gap), y = r*(cell+gap);
      // Zero stays as surface, so "nothing happened" does not read as a value.
      var fill = v === 0 ? C('--surface2') : ramp[Math.min(ramp.length-1, Math.floor((v/max)*ramp.length))];
      var rect = svgEl('rect',{x:x,y:y,width:cell,height:cell,rx:3,fill:fill});
      rect.addEventListener('mousemove', function (e) {
        showTip('<div class="t">'+esc(rl)+'</div><div class="r"><span>'+esc(colLabels[c])+
          '</span><b>'+v+' verified</b></div>', e); });
      rect.addEventListener('mouseleave', hideTip);
      svg.appendChild(rect);
    });
  });
  var cstep = Math.max(1, Math.ceil(34/(cell+gap)));
  colLabels.forEach(function (cl, c) {
    if (c % cstep) return;
    var t = svgEl('text',{x:gut+c*(cell+gap)+cell/2,y:H-8,class:'axis','text-anchor':'middle'});
    t.textContent = cl; svg.appendChild(t);
  });
  host.appendChild(svg);
}

/* ---------- reports ------------------------------------------------------ */
function loadReports() {
  if (!STATE.usage.allowReports) {
    $('reportsBody').classList.add('hidden');
    $('reportsLocked').classList.remove('hidden');
    $('reportsLocked').innerHTML = '<div class="bg-white rounded-3xl border border-gray-100 p-12 text-center">' +
      '<div class="w-14 h-14 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mx-auto mb-5">' +
      '<span class="material-icons text-2xl">lock</span></div>' +
      '<h3 class="text-2xl font-black mb-2">Reports are a Pro feature</h3>' +
      '<p class="text-sm text-gray-500 font-semibold mb-6 max-w-md mx-auto">Trends, per-person scoring, ' +
        'KRA breakdowns and the delivery heatmap are included from the Pro plan up.</p>' +
      '<button class="btn btn-p" onclick="openBilling()">See plans</button></div>';
    return;
  }
  $('reportsLocked').classList.add('hidden');
  $('reportsBody').classList.remove('hidden');
  renderOffsets();
  api('getAnalytics', { period: STATE.period, offset: STATE.offset, span: 12, person: STATE.person })
    .then(function (a) { STATE.analytics = a; renderReports(a); })
    .catch(function (e) { toast(e.message, 'err'); });
}

function renderOffsets() {
  var n = { week:12, month:12, quarter:8, year:3 }[STATE.period] || 12;
  var labels = [];
  for (var i = 0; i < n; i++) labels.push(i);
  $('rOffset').innerHTML = labels.map(function (i) {
    return '<option value="' + i + '"' + (i === STATE.offset ? ' selected' : '') + '>' +
      (i === 0 ? 'This ' + STATE.period : i === 1 ? 'Last ' + STATE.period : i + ' ' + STATE.period + 's ago') +
      '</option>'; }).join('');
}

function renderReports(a) {
  var s = a.summary;
  var tile = function (k, v, sub, icon, colour, tone) {
    return '<div class="tile">' +
      '<span class="ti material-icons" style="color:' + colour + '">' + icon + '</span>' +
      '<div class="tk">' + esc(k) + '</div>' +
      '<div class="tv ' + (tone || '') + '">' + v + '</div>' +
      '<div class="ts">' + esc(sub || '') + '</div></div>';
  };
  var band = function (n) {
    return n == null ? '' : n >= 85 ? 'text-emerald-700' : n >= 60 ? 'text-amber-700' : 'text-red-700';
  };
  $('rTiles').innerHTML =
    tile('Team score', s.teamScore == null ? '\u2014' : s.teamScore, a.range.label,
         'groups', '#5b4bdb', band(s.teamScore)) +
    tile('Delivered', s.delivered, 'tasks verified', 'task_alt', '#0e8f80') +
    tile('On-time', s.onTimeRate == null ? '\u2014' : s.onTimeRate + '%', 'of closed work',
         'schedule', '#2a74c9', band(s.onTimeRate)) +
    tile('Rework loops', s.reworkLoops, 'quality signal', 'replay',
         s.reworkLoops ? '#a9591a' : '#d6cec3', s.reworkLoops ? 'text-orange-700' : '') +
    tile('Overdue now', s.overdueNow, 'open past deadline', 'warning',
         s.overdueNow ? '#c0392b' : '#d6cec3', s.overdueNow ? 'text-red-700' : '');

  $('rTrendSub').textContent = 'Delegation score across 12 ' + STATE.period + 's ending ' + a.range.short;
  var series = [{ name:'Team', color:C('--s1'),
    points: a.trend.map(function (p) { return { label:p.label, value:p.teamScore }; }) }];
  if (a.personTrend) {
    var who = (STATE.data.staff||[]).filter(function (u) { return u.username === STATE.person; })[0];
    series.push({ name: who ? who.name.split(' ')[0] : 'Person', color:C('--s2'),
      points: a.personTrend.map(function (p) { return { label:p.label, value:p.score }; }) });
  }
  $('rLegend').innerHTML = series.length > 1 ? series.map(function (x) {
    return '<span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' +
      x.color + ';margin-right:6px"></i>' + esc(x.name) + '</span>'; }).join('') : '';
  lineChart($('chartTrend'), series, { height: 236 });

  // Band letters ride with the colour: the status palette is not safe on its own.
  var total = Math.max(1, a.bands.A + a.bands.B + a.bands.C + a.bands.none);
  $('chartBands').innerHTML = [['A','A · Top performer',C('--good'),a.bands.A],
    ['B','B · Solid',C('--warn'),a.bands.B], ['C','C · Needs action',C('--bad'),a.bands.C],
    ['—','No data yet',C('--muted'),a.bands.none]].map(function (b) {
    return '<div class="flex items-center gap-3 py-2">' +
      '<span class="w-7 h-7 rounded-lg flex items-center justify-center text-white font-black text-xs" ' +
      'style="background:'+b[2]+'">'+b[0]+'</span>' +
      '<span class="flex-1"><span class="text-sm font-bold text-gray-700">'+esc(b[1])+'</span>' +
      '<span class="block h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden">' +
      '<span style="display:block;height:100%;width:'+(b[3]/total*100)+'%;background:'+b[2]+'"></span></span></span>' +
      '<span class="font-black text-sm">'+b[3]+'</span></div>';
  }).join('');

  var ppl = a.people.slice().sort(function (x, y) { return (y.score==null?-1:y.score)-(x.score==null?-1:x.score); });
  barsH($('chartPeople'), ppl.map(function (p) {
    return { label: String(p.name||p.username).split(' ')[0], value: p.score,
      display: p.score == null ? null : p.score + ' · ' + p.band,
      color: p.score == null ? C('--muted') : p.score >= 85 ? C('--good')
             : p.score >= 60 ? C('--warn') : C('--bad') };
  }), { max:100, metric:'Score' });

  barsH($('chartKra'), a.kra.slice(0,8).map(function (k) {
    return { label:k.kra, value:k.count }; }), { metric:'Tasks', labelW:150 });

  heatmap($('chartHeat'), a.heatmap.rows.map(function (r) { return String(r.name).split(' ')[0]; }),
    a.heatmap.weeks, a.heatmap.rows.map(function (r) { return r.values; }));
}

function openAccountability() {
  openModal('<div class="p-6 lg:p-7"><h2 class="text-xl font-black mb-1">Accountability</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">Both sides of it: who is handing work ' +
    'back in, and who is holding it up.</p>' +
    '<div id="accBody" class="text-sm text-gray-400 font-semibold">Loading…</div>' +
    '<div class="mt-6"><button class="btn btn-g w-full" onclick="closeModal()">Close</button></div></div>', 'max-w-3xl');
  api('getAccountability').then(function (r) {
    var h = '<h3 class="text-[11px] font-black uppercase tracking-widest text-gray-500 mb-2">Rework and lateness</h3>';
    h += r.report.length ? '<table class="tbl"><thead><tr>' +
      '<th>Person</th><th>Tasks</th><th>Reworks</th><th>Late</th><th>Rework %</th></tr></thead><tbody>' +
      r.report.map(function (d) {
        return '<tr><td class="font-bold text-gray-800">'+esc(d.name)+'</td><td>'+d.total+'</td>' +
          '<td class="text-red-700 font-bold">'+d.reworkCount+'</td><td>'+d.lateCount+'</td>' +
          '<td class="font-black '+(d.pct>10?'text-red-700':'text-emerald-700')+'">'+d.pct+'%</td></tr>';
      }).join('') + '</tbody></table>' : '<p class="text-sm text-gray-400 font-semibold">Nothing to report yet.</p>';

    /* Approvals and reviews held. A team that is marked down for lateness its
       managers caused will stop believing the whole report, so this sits beside
       it rather than in a separate screen somebody has to go looking for. */
    var q = r.queue || [];
    h += '<h3 class="text-[11px] font-black uppercase tracking-widest text-gray-500 mt-7 mb-2">' +
      'Approvals and reviews held</h3>';
    h += q.length ? '<table class="tbl"><thead><tr>' +
      '<th>Person</th><th>Decisions</th><th>In time</th><th>On their desk now</th>' +
      '<th>Avg days held</th><th>Cleared in time</th></tr></thead><tbody>' +
      q.map(function (d) {
        var tone = d.score >= 85 ? 'text-emerald-700' : d.score >= 60 ? 'text-amber-700' : 'text-red-700';
        return '<tr><td class="font-bold text-gray-800">'+esc(d.name)+'</td><td>'+d.items+'</td>' +
          '<td>'+d.withinSla+'</td>' +
          '<td class="'+(d.overdueNow?'text-red-700 font-bold':'')+'">' + d.pending +
            (d.overdueNow ? ' (' + d.overdueNow + ' past ' + d.slaDays + ' days)' : '') + '</td>' +
          '<td>'+(d.avgHeldDays == null ? '—' : d.avgHeldDays)+'</td>' +
          '<td class="font-black '+tone+'">'+d.score+'%</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="text-[11px] font-semibold text-gray-500 mt-2">Held time is counted in working ' +
      'days from when the item reached that person. Weekends, company holidays and their own ' +
      'approved leave are not counted.</p>'
      : '<p class="text-sm text-gray-400 font-semibold">Nobody has had a decision waiting on them yet.</p>';
    $('accBody').innerHTML = h;
  }).catch(function (e) { $('accBody').textContent = e.message; });
}

function openReviewHistory() {
  openModal('<div class="p-6 lg:p-7"><h2 class="text-xl font-black mb-5">Review history</h2>' +
    '<div id="rhBody" class="text-sm text-gray-400 font-semibold">Loading…</div>' +
    '<div class="mt-6"><button class="btn btn-g w-full" onclick="closeModal()">Close</button></div></div>', 'max-w-2xl');
  api('getPerformanceReport').then(function (r) {
    $('rhBody').innerHTML = r.report.length ? '<table class="tbl"><thead><tr>' +
      '<th>Month</th><th>Person</th><th>Performance</th><th>Delegation</th><th>Final</th></tr></thead><tbody>' +
      r.report.map(function (d) {
        return '<tr><td class="whitespace-nowrap">'+esc(d.month)+'</td>' +
          '<td class="font-bold text-gray-800">'+esc(d.name)+'</td><td>'+d.performance+'</td>' +
          '<td>'+d.delegation+'</td><td class="font-black">'+d.score+' · '+esc(d.band)+'</td></tr>';
      }).join('') + '</tbody></table>' : '<p>No appraisals recorded yet.</p>';
  }).catch(function (e) { $('rhBody').textContent = e.message; });
}
