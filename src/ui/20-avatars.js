/* ---------- avatars ----------------------------------------------------------
   Each person can pick one of these professional illustrated avatars from the
   Account menu, upload a photo of their own, or keep their initials (the
   default). Drawn here as small SVGs
   and shown as images, so nothing is loaded from another site. The choice is
   saved on the person's row (the Avatar column) and shown wherever their name
   appears with a bubble: cards, lists, Team, projects, leaderboard, meetings. */
var AVATAR_SKIN = { a: '#F3CFAE', b: '#E2B184', c: '#C98D5B', d: '#A86B3C', e: '#7E4E2C' };
var AVATAR_SET = [
  { id: 'f1', label: 'Long hair, navy blazer', g: 'f', skin: 'b', hair: 'long', hc: '#1F1A17', bg: '#DCE8FB', coat: '#1E3A6E', shirt: '#FFFFFF', ear: true },
  { id: 'f2', label: 'Bun, grey blazer', g: 'f', skin: 'c', hair: 'bun', hc: '#2A1E18', bg: '#FDECC8', coat: '#5B6472', shirt: '#F4F4F4', ear: true },
  { id: 'f3', label: 'Bob cut, glasses', g: 'f', skin: 'a', hair: 'bob', hc: '#3B2A20', bg: '#DDF3EA', coat: '#0F766E', shirt: '#FFFFFF', glasses: true },
  { id: 'f4', label: 'Wavy hair, maroon blazer', g: 'f', skin: 'd', hair: 'wavy', hc: '#1F1A17', bg: '#F6E1EA', coat: '#7A2438', shirt: '#FDF2F4', ear: true },
  { id: 'f5', label: 'Ponytail, light-grey blazer', g: 'f', skin: 'c', hair: 'pony', hc: '#2A1E18', bg: '#E7E3FA', coat: '#CBD2DC', shirt: '#FFFFFF' },
  { id: 'f6', label: 'Hijab, navy blazer', g: 'f', skin: 'b', hair: 'hijab', hc: '#3F5F8F', bg: '#E3EEF2', coat: '#1E3A6E', shirt: '#FFFFFF' },
  { id: 'm1', label: 'Side part, suit and tie', g: 'm', skin: 'b', hair: 'side', hc: '#1F1A17', bg: '#DCE8FB', coat: '#1E3A6E', shirt: '#FFFFFF', tie: '#B91C1C' },
  { id: 'm2', label: 'Beard, grey blazer', g: 'm', skin: 'c', hair: 'short', hc: '#1F1A17', bg: '#FDECC8', coat: '#5B6472', shirt: '#EEF2F7', beard: true },
  { id: 'm3', label: 'Glasses, blue shirt', g: 'm', skin: 'a', hair: 'crew', hc: '#3B2A20', bg: '#DDF3EA', coat: '#2F6FBF', shirt: '#2F6FBF', glasses: true, collar: true },
  { id: 'm4', label: 'Turban and beard, navy blazer', g: 'm', skin: 'c', hair: 'turban', hc: '#1F3A8A', bg: '#E7E3FA', coat: '#1E293B', shirt: '#FFFFFF', beard: true, tie: '#1E3A8A' },
  { id: 'm5', label: 'Curly hair, open collar', g: 'm', skin: 'd', hair: 'curly', hc: '#1F1A17', bg: '#F6E1EA', coat: '#3F3F46', shirt: '#F5F5F5', collar: true },
  { id: 'm6', label: 'Grey hair, moustache, brown blazer', g: 'm', skin: 'e', hair: 'grey', hc: '#9CA3AF', bg: '#E3EEF2', coat: '#6B4A2E', shirt: '#FFFFFF', tie: '#1E3A6E', moustache: true },
];

function avatarSvg(a) {
  var s = AVATAR_SKIN[a.skin], h = a.hc, p = [];
  p.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><clipPath id="c"><circle cx="32" cy="32" r="32"/></clipPath></defs>');
  p.push('<circle cx="32" cy="32" r="32" fill="' + a.bg + '"/><g clip-path="url(#c)">');
  /* behind the head */
  if (a.hair === 'long') p.push('<path d="M18.5 30C18 17 24.5 12.5 32 12.5S46 17 45.5 30L47 47C43 49.5 38.5 48 36.5 44H27.5C25.5 48 21 49.5 17 47Z" fill="' + h + '"/>');
  if (a.hair === 'wavy') p.push('<path d="M18 31C17 17 24.5 12 32 12S47 17 46 31C48 35 45 37 47 41C48 45 44 47 41 46C38 47 37 44 36 43H28C27 44 26 47 23 46C20 47 16 45 17 41C19 37 16 35 18 31Z" fill="' + h + '"/>');
  if (a.hair === 'bob') p.push('<path d="M18.5 31C18 18 25 13.5 32 13.5S46 18 45.5 31L46 38C42 39.5 40.5 37 40.5 34H23.5C23.5 37 22 39.5 18 38Z" fill="' + h + '"/>');
  if (a.hair === 'pony') p.push('<path d="M43 20C50 22 51 32 47 39C46 33 44 28 41 25Z" fill="' + h + '"/>');
  if (a.hair === 'hijab') p.push('<path d="M16.5 31C16.5 17 23.5 11.5 32 11.5S47.5 17 47.5 31L49 48C45 52 19 52 15 48Z" fill="' + h + '"/>');
  /* body */
  p.push('<path d="M5 64C7 51 17 45.5 32 45.5S57 51 59 64Z" fill="' + a.coat + '"/>');
  if (a.collar) p.push('<path d="M24.5 46L32 53L39.5 46L37 44.5H27Z" fill="' + a.shirt + '"/><path d="M27.5 45.5L32 50.5L36.5 45.5" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="1"/>');
  else p.push('<path d="M25 46L32 56L39 46Z" fill="' + a.shirt + '"/>');
  if (a.tie) p.push('<path d="M30.6 48.5H33.4L34.4 57.5L32 61L29.6 57.5Z" fill="' + a.tie + '"/>');
  if (!a.collar && a.coat !== a.shirt) p.push('<path d="M25 46L32 56L28 64M39 46L32 56L36 64" fill="none" stroke="rgba(0,0,0,.22)" stroke-width="1.2"/>');
  /* neck, ears, head */
  p.push('<rect x="27.8" y="37" width="8.4" height="10" rx="3.5" fill="' + s + '"/>');
  p.push('<path d="M27.8 41.5Q32 44 36.2 41.5V44Q32 46 27.8 44Z" fill="rgba(0,0,0,.12)"/>');
  if (a.hair !== 'hijab') p.push('<circle cx="20.8" cy="29.5" r="2.7" fill="' + s + '"/><circle cx="43.2" cy="29.5" r="2.7" fill="' + s + '"/>');
  if (a.ear && a.hair !== 'hijab') p.push('<circle cx="20.8" cy="32.6" r="1.1" fill="#E7B53C"/><circle cx="43.2" cy="32.6" r="1.1" fill="#E7B53C"/>');
  p.push('<ellipse cx="32" cy="28.5" rx="11" ry="12.6" fill="' + s + '"/>');
  /* face */
  var brow = a.hair === 'grey' ? '#6B7280' : (a.hair === 'hijab' || a.hair === 'turban' ? '#2A1E18' : h);
  p.push('<path d="M26 24.6Q28 23.6 30 24.4M34 24.4Q36 23.6 38 24.6" fill="none" stroke="' + brow + '" stroke-width="1.2" stroke-linecap="round"/>');
  p.push('<circle cx="28" cy="28.4" r="1.35" fill="#2B2B2B"/><circle cx="36" cy="28.4" r="1.35" fill="#2B2B2B"/>');
  p.push('<path d="M31.4 30.8Q32 32.6 33 32" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1" stroke-linecap="round"/>');
  if (a.g === 'f') p.push('<circle cx="25.5" cy="32.5" r="1.8" fill="#F28B82" opacity=".35"/><circle cx="38.5" cy="32.5" r="1.8" fill="#F28B82" opacity=".35"/>');
  if (a.beard) p.push('<path d="M21.2 29C21 39.5 26 44 32 44S43 39.5 42.8 29C41.5 35.5 38 37.6 32 37.6S22.5 35.5 21.2 29Z" fill="' + h + '"/>');
  if (a.beard || a.moustache) p.push('<path d="M28 34.3Q32 32.4 36 34.3Q32 35.6 28 34.3Z" fill="' + (a.moustache && !a.beard ? '#4B5563' : h) + '"/>');
  p.push('<path d="M28.6 35.6Q32 38.2 35.4 35.6" fill="none" stroke="#7A3E2B" stroke-width="1.3" stroke-linecap="round"/>');
  if (a.glasses) p.push('<g fill="none" stroke="#1F2937" stroke-width="1.1"><rect x="24.2" y="25.8" width="7.2" height="5.4" rx="2.2"/><rect x="32.6" y="25.8" width="7.2" height="5.4" rx="2.2"/><path d="M31.4 28H32.6M24.2 27.6L21.6 26.8M39.8 27.6L42.4 26.8"/></g>');
  /* over the head */
  if (a.hair === 'long' || a.hair === 'wavy') p.push('<path d="M20.4 27.5C20.6 18 25.6 14.6 32 14.6S43.4 18 43.6 27.5C41 21.6 36.5 19.6 32.5 20.6C28 19.6 23.2 21.8 20.4 27.5Z" fill="' + h + '"/>');
  if (a.hair === 'bun') p.push('<circle cx="32" cy="12.4" r="5.2" fill="' + h + '"/><path d="M20.6 27.5C20.6 17.5 26 14.8 32 14.8S43.4 17.5 43.4 27.5C40.6 21.4 36.4 19.6 32 19.6S23.4 21.4 20.6 27.5Z" fill="' + h + '"/>');
  if (a.hair === 'bob') p.push('<path d="M20.2 28C20.4 18.2 25.6 15 32 15S43.6 18.2 43.8 28C41.8 22 38 20.4 34.5 20.4C30 22.8 24.6 23.6 20.2 28Z" fill="' + h + '"/>');
  if (a.hair === 'pony') p.push('<path d="M20.6 27.5C20.6 17.6 26 14.8 32 14.8S43.4 17.6 43.4 27.5C40.6 21.6 36.4 20 32 20S23.4 21.6 20.6 27.5Z" fill="' + h + '"/>');
  if (a.hair === 'hijab') p.push('<path d="M20.4 28C20.4 19.5 25.6 16 32 16S43.6 19.5 43.6 28" fill="none" stroke="' + h + '" stroke-width="3"/><path d="M20.6 31C21 37 25 42.4 32 42.4S43 37 43.4 31" fill="none" stroke="' + h + '" stroke-width="2.4"/>');
  if (a.hair === 'side') p.push('<path d="M20.6 26.5C20 17 26 14 32.4 14S44 17.2 43.4 26.5C42 21.8 39 20 35.5 19.8C33 21.4 26 22.4 20.6 26.5Z" fill="' + h + '"/>');
  if (a.hair === 'short') p.push('<path d="M20.8 26C20.4 17.4 26 14.4 32 14.4S43.6 17.4 43.2 26C41.4 21 37 19.6 32 19.6S22.6 21 20.8 26Z" fill="' + h + '"/>');
  if (a.hair === 'crew') p.push('<path d="M21.2 24.5C21.4 17.6 26.4 15.4 32 15.4S42.6 17.6 42.8 24.5C40.6 20.6 36.6 19.6 32 19.6S23.4 20.6 21.2 24.5Z" fill="' + h + '"/>');
  if (a.hair === 'grey') p.push('<path d="M20.8 27C20.6 18.6 25.8 15.4 32 15.4S43.4 18.6 43.2 27C41.8 22.6 39 21.4 36 21.4C33 20.2 25 21.4 20.8 27Z" fill="' + h + '"/>');
  if (a.hair === 'curly') p.push('<g fill="' + h + '"><circle cx="23" cy="22" r="3.6"/><circle cx="27" cy="17.6" r="4"/><circle cx="32" cy="16" r="4.2"/><circle cx="37" cy="17.6" r="4"/><circle cx="41" cy="22" r="3.6"/><circle cx="21.6" cy="26" r="2.6"/><circle cx="42.4" cy="26" r="2.6"/></g>');
  if (a.hair === 'turban') p.push('<path d="M19.4 26C19 14.6 25.6 10 32 10S45 14.6 44.6 26C42.4 22.6 37.6 21.4 32 21.4S21.6 22.6 19.4 26Z" fill="' + h + '"/><path d="M22 22.6C26 15.6 36 13.6 42.2 20M24.6 16.4C29 19 35 18.8 40 15.6" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="1.3"/>');
  p.push('</g></svg>');
  return p.join('');
}

var AVATAR_URI = {};
/* Photos arrive by key ("p:…") and are fetched once, then kept in this
   browser: the board never carries the pictures themselves. */
var AVATAR_PHOTOS = {};
function avatarUri(id) {
  if (!id) return '';
  if (id.indexOf('p:') === 0) {
    if (!AVATAR_PHOTOS[id]) { try { var kept = localStorage.getItem('dbx-av:' + id); if (kept) AVATAR_PHOTOS[id] = kept; } catch (e) {} }
    return AVATAR_PHOTOS[id] || '';
  }
  if (!AVATAR_URI[id]) {
    var a = AVATAR_SET.filter(function (x) { return x.id === id; })[0];
    if (!a) return '';
    AVATAR_URI[id] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(avatarSvg(a));
  }
  return AVATAR_URI[id];
}

/** The avatar a person chose, by name (the bubbles are drawn from names), or ''. */
function avatarOf(name) {
  var d = STATE.data;
  if (!d || !name) return '';
  if (d._avatarMap === undefined) {
    var m = {};
    (d.staff || []).forEach(function (u) { if (u && u.name && u.avatar) m[u.name] = u.avatar; });
    d._avatarMap = m;
  }
  return d._avatarMap[name] || '';
}

/** Fetches the photos this board needs and has not got yet, then redraws. */
function loadAvatarPhotos() {
  var d = STATE.data;
  if (!d || !d.staff || !STATE.token) return;
  var need = d.staff.map(function (u) { return u.avatar; })
    .filter(function (k, i, a) { return k && k.indexOf('p:') === 0 && a.indexOf(k) === i && !avatarUri(k); });
  if (!need.length) return;
  api('getAvatarPhotos', { keys: need }, { quiet: true }).then(function (r) {
    var got = r.photos || {}, any = false;
    Object.keys(got).forEach(function (k) {
      AVATAR_PHOTOS[k] = got[k]; any = true;
      try { localStorage.setItem('dbx-av:' + k, got[k]); } catch (e) {}
    });
    if (any) { paintMyAvatar(); try { renderTab(); } catch (e) {} }
  }).catch(function () { /* initials stay until the photo arrives */ });
}

/* A photo is squared (centred, a little above the middle, where a face is)
   and compressed here, in the browser, to a 96 px JPEG of a few KB. */
function compressPhoto(file) {
  return new Promise(function (resolve, reject) {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type || '')) return reject(new Error('Choose a JPEG, PNG or WebP picture.'));
    if (file.size > 20 * 1024 * 1024) return reject(new Error('That picture is over 20 MB. Choose a smaller one.'));
    var reader = new FileReader();
    reader.onerror = function () { reject(new Error('That picture could not be read.')); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { reject(new Error('That picture could not be read. Try a JPEG or PNG.')); };
      img.onload = function () {
        var size = 96, s = Math.min(img.naturalWidth, img.naturalHeight);
        var sx = (img.naturalWidth - s) / 2, sy = (img.naturalHeight - s) * 0.3;
        var make = function (px, q) {
          var c = document.createElement('canvas'); c.width = px; c.height = px;
          var g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, px, px);
          g.imageSmoothingQuality = 'high'; g.drawImage(img, sx, sy, s, s, 0, 0, px, px);
          return c.toDataURL('image/jpeg', q);
        };
        var q = 0.85, out = make(size, q);
        while (out.length > 15000 && q > 0.45) { q -= 0.1; out = make(size, q); }
        if (out.length > 15000) out = make(72, 0.6);
        resolve(out);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** The account button in the top bar shows your own avatar once you pick one. */
function paintMyAvatar() {
  var b = $('btnAccount');
  if (!b || !STATE.user) return;
  var id = avatarUri(avatarOf(STATE.user.name)) ? avatarOf(STATE.user.name) : '', img = b.querySelector('img.myav'), icon = b.querySelector('.material-icons');
  if (id) {
    if (!img) { img = document.createElement('img'); img.className = 'myav'; img.alt = ''; img.width = 28; img.height = 28; img.style.borderRadius = '999px'; img.style.display = 'block'; b.appendChild(img); }
    img.src = avatarUri(id);
    if (icon) icon.classList.add('hidden');
  } else {
    if (img) img.remove();
    if (icon) icon.classList.remove('hidden');
  }
}

function openAvatarPicker() {
  var me = STATE.user || {}, current = avatarOf(me.name), pick = current, photo = '';
  var hasPhoto = current.indexOf('p:') === 0 && avatarUri(current);
  var tile = function (id, inner, label) {
    return '<button type="button" class="avPick rounded-2xl border-2 p-2 flex flex-col items-center gap-1 ' +
      (id === pick ? 'border-blue-600 bg-blue-50' : 'border-gray-100 hover:border-gray-300') + '" data-id="' + id + '" aria-pressed="' + (id === pick) + '" title="' + esc(label) + '">' +
      inner + '</button>';
  };
  var draw = function () {
    var shown = photo || (hasPhoto ? avatarUri(current) : '');
    $('avGrid').innerHTML = tile('', '<span class="av s-' + tintFor(me.name) + '" style="width:56px;height:56px;font-size:20px">' + esc(initials(me.name)) + '</span>' +
        '<span class="text-[11px] font-black text-gray-500">Initials</span>', 'Keep my initials') +
      tile(photo ? 'photo' : (hasPhoto ? current : 'upload'),
        (shown ? '<img src="' + shown + '" alt="Your photo" width="56" height="56" style="border-radius:999px;object-fit:cover">'
               : '<span class="inline-flex items-center justify-center rounded-full bg-gray-100 text-gray-500" style="width:56px;height:56px"><span class="material-icons">add_a_photo</span></span>') +
        '<span class="text-[11px] font-black text-gray-500">' + (shown ? 'Your photo' : 'Upload') + '</span>', 'Upload a photo of your own') +
      AVATAR_SET.map(function (a) { return tile(a.id, '<img src="' + avatarUri(a.id) + '" alt="' + esc(a.label) + '" width="56" height="56" style="border-radius:999px">', a.label); }).join('');
    $('avGrid').querySelectorAll('.avPick').forEach(function (b) { b.addEventListener('click', function () {
      if (b.dataset.id === 'upload') { $('avFile').click(); return; }
      pick = b.dataset.id; draw(); }); });
  };
  openModal('<form id="fAvatar" class="p-6 lg:p-7">' +
    '<h2 class="text-xl font-black mb-1">Choose your avatar</h2>' +
    '<p class="text-sm text-gray-400 font-semibold mb-5">It shows beside your name on tasks, lists, the leaderboard and meetings. Pick one, upload a photo, or keep your initials, as now.</p>' +
    '<div id="avGrid" class="grid grid-cols-4 sm:grid-cols-7 gap-2"></div>' +
    '<input id="avFile" type="file" accept="image/jpeg,image/png,image/webp" class="hidden">' +
    '<button type="button" id="avUpload" class="btn btn-g text-sm mt-3"><span class="material-icons text-base align-middle">add_a_photo</span> Upload a photo</button>' +
    '<p class="text-xs font-semibold text-gray-400 mt-3">A photo is cropped to a square and made small before it is saved. Everyone in your company can see it.</p>' +
    '<div class="flex gap-3 mt-6"><span class="flex-1"></span>' +
      '<button type="button" class="btn btn-g" onclick="closeModal()">Cancel</button>' +
      '<button type="submit" class="btn btn-p px-8">Save</button></div></form>', 'max-w-2xl');
  $('avUpload').addEventListener('click', function () { $('avFile').click(); });
  $('avFile').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    compressPhoto(f).then(function (data) { photo = data; pick = 'photo'; draw(); })
      .catch(function (err) { toast(err.message, 'err'); });
    this.value = '';
  });
  $('fAvatar').addEventListener('submit', function (e) {
    e.preventDefault();
    if (pick === current && pick !== 'photo') { closeModal(); return; }
    var btn = e.target.querySelector('button[type=submit]');
    busy(btn, true);
    api('setAvatar', pick === 'photo' ? { avatar: 'photo', photo: photo } : { avatar: pick })
      .then(function (r) {
        /* Your own new photo is known already: no need to fetch it back. */
        if (pick === 'photo' && r.avatar) { AVATAR_PHOTOS[r.avatar] = photo; try { localStorage.setItem('dbx-av:' + r.avatar, photo); } catch (e) {} }
        toast(r.message, 'ok'); closeModal(); return refresh();
      })
      .catch(function (err) { busy(btn, false); toast(err.message, 'err'); });
  });
  draw();
}
