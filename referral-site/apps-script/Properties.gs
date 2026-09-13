/**
 * Properties.gs — reads the live listings sheet so partners can see real
 * properties in a buyer's budget, each with what they would earn on it.
 *
 * The listings sheet is a SEPARATE spreadsheet (the classifieds backend). Its
 * ID goes in Config as `listings_sheet_id`. This script only ever reads it.
 *
 * The Price column there is free text — "81 Lakhs Onwards", "Rs 2.44 - Rs 4.25 Cr",
 * "34 laksh ownerds". None of it parses as a number, so parsePriceText_ below
 * does the work. It is tested against all 147 live values in test/.
 */

function listingsSheet_() {
  var id = String(getConfig().listings_sheet_id || '').trim();
  if (!id) throw new Error('Set listings_sheet_id in the Config tab');
  var tab = String(getConfig().listings_tab || 'Properties').trim();
  var book = SpreadsheetApp.openById(id);
  var sh = book.getSheetByName(tab);
  if (!sh) throw new Error('Tab "' + tab + '" not found in the listings sheet');
  return sh;
}

/**
 * All usable listings, trimmed to what the cards need and cached, because
 * scanning 147 rows on every keystroke of the calculator would be slow.
 */
function loadListings_() {
  var cached = readCache_('listings');
  if (cached) return cached;

  var sh = listingsSheet_();
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];

  var head = values[0];
  var col = {};
  head.forEach(function (h, i) { col[String(h).trim()] = i; });

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (row.join('') === '') continue;

    var price = parsePriceText_(row[col.Price]);
    if (!price) continue;                       // no readable price, no earning to show

    var image = firstImage_(row[col.ImageURL]);
    if (!image) continue;                       // a card without a picture is not worth showing

    var status = String(row[col.Status] || '').toLowerCase();
    if (status && status !== 'available') continue;

    out.push({
      id: String(row[col.ID] || ''),
      title: String(row[col.Title] || '').trim(),
      location: String(row[col.Location] || '').trim(),
      type: String(row[col.Type] || '').trim(),
      bhk: bhkLabel_(row[col.Bedrooms]),
      area: String(row[col.Area] || '').trim(),
      priceLabel: cleanPriceLabel_(row[col.Price]),
      priceMin: price.min,
      priceMax: price.max,
      image: image,
      possession: String(row[col.Possession] || '').trim()
    });
  }

  writeCache_('listings', out, 600);           // 10 minutes
  return out;
}

/**
 * Public action: listings near a budget, each with the partner's earning.
 * A listing is a candidate when its entry price sits in a band around the
 * budget; if too few qualify we widen to the nearest ones rather than showing
 * an empty grid, since an empty grid teaches the partner nothing.
 */
function actionListings_(p) {
  var budget = Number(p.budget) || 0;
  var limit = Math.min(Number(p.limit) || 6, 24);
  var all;
  try {
    all = loadListings_();
  } catch (e) {
    return err_(e.message, 'listings_unavailable');
  }
  if (!all.length) return ok_({ listings: [], budget: budget, matched: false });

  var lowBand  = cfgNum_('listing_band_low', 0.5);
  var highBand = cfgNum_('listing_band_high', 1.25);

  var scored = all.map(function (l) {
    return { l: l, distance: Math.abs(l.priceMin - budget) };
  }).sort(function (a, b) { return a.distance - b.distance; });

  var inBand = scored.filter(function (s) {
    return s.l.priceMin >= budget * lowBand && s.l.priceMin <= budget * highBand;
  });

  var chosen = (budget && inBand.length >= 3) ? inBand : scored;
  var matched = budget ? inBand.length >= 3 : false;

  return ok_({
    budget: budget,
    matched: matched,
    total: all.length,
    listings: chosen.slice(0, limit).map(function (s) {
      var q = commissionFor_(s.l.priceMin);
      return {
        id: s.l.id, title: s.l.title, location: s.l.location, type: s.l.type,
        bhk: s.l.bhk, area: s.l.area, image: s.l.image,
        priceLabel: s.l.priceLabel, priceMin: s.l.priceMin, priceMax: s.l.priceMax,
        possession: s.l.possession,
        earning: q.netPayable, sharePct: q.sharePct
      };
    })
  });
}

// ---------------------------------------------------------------- parsing

/**
 * Pulls rupee figures out of free text. Returns {min, max} or null.
 *
 * Handles the shapes that actually occur in the sheet:
 *   "81 Lakhs Onwards"             -> 81,00,000
 *   "Price: Rs 2.20 Cr Onwards*"   -> 2,20,00,000
 *   "Rs 2.44  - Rs 4.25 Cr"        -> first figure inherits Cr from the second
 *   "Rs 69 Lakhs - Rs 1.25+ Cr"    -> the '+' must not detach the unit
 *   "Rs 1.75 Cr 3 BHK, 2.60 Cr 4BHK" -> "3" and "4" are rooms, not prices
 *   "34 laksh ownerds"             -> yes, that spelling is in the data
 */
function parsePriceText_(text) {
  var s = String(text == null ? '' : text).toLowerCase();
  if (!s.trim()) return null;
  s = s.replace(/[₹*]/g, ' ').replace(/,(?=\d{3}\b)/g, '');

  var re = /(\d+(?:\.\d+)?)\s*\+?\s*(crores?|cr|lakhs?|lakshs?|lacs?|l|k)?\b(?!\s*(?:bhk|seater|sq|kmpl|airbags?|litres?))/gi;
  var tokens = [], m;
  while ((m = re.exec(s)) !== null) {
    var raw = parseFloat(m[1]);
    if (isNaN(raw)) continue;
    var tail = s.slice(m.index + m[0].length, m.index + m[0].length + 8);
    if (/^\s*(bhk|seater|sq|bed)/.test(tail)) continue;
    tokens.push({ value: raw, unit: normaliseUnit_(m[2]) });
  }
  if (!tokens.length) return null;

  // A figure with no unit borrows the next one that has it, then the first.
  var carry = null;
  for (var i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].unit) carry = tokens[i].unit;
    else if (carry) tokens[i].unit = carry;
  }
  var lead = null;
  for (var j = 0; j < tokens.length; j++) { if (tokens[j].unit) { lead = tokens[j].unit; break; } }
  tokens.forEach(function (t) { if (!t.unit) t.unit = lead; });

  var rupees = tokens.map(tokenToRupees_).filter(function (n) { return n && n >= 100000; });
  if (!rupees.length) return null;
  return { min: Math.min.apply(null, rupees), max: Math.max.apply(null, rupees) };
}

function normaliseUnit_(u) {
  if (!u) return null;
  u = String(u).toLowerCase();
  if (u.indexOf('cr') === 0) return 'cr';
  if (u.charAt(0) === 'l') return 'l';          // lakh / lac / laksh
  if (u === 'k') return 'k';
  return null;
}

function tokenToRupees_(t) {
  if (t.unit === 'cr') return Math.round(t.value * 10000000);
  if (t.unit === 'l')  return Math.round(t.value * 100000);
  if (t.unit === 'k')  return Math.round(t.value * 1000);
  return Math.round(t.value);
}

function cleanPriceLabel_(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').replace(/^price:\s*/i, '').trim();
}

/**
 * Bedrooms recovery. Sheets turned entries like "3,4" into the date 4 March,
 * so a Date in this column carries the two numbers as month and day. Checked
 * against the BHK range stated in the titles: 7 of 7 rows agree, 0 disagree.
 */
function bhkLabel_(value) {
  if (value instanceof Date) {
    return value.getMonth() + 1 === value.getDate()
      ? String(value.getDate())
      : (value.getMonth() + 1) + '–' + value.getDate();
  }
  var s = String(value == null ? '' : value).trim();
  if (!s) return '';
  s = s.replace(/\s*bhk\s*/ig, '').replace(/^beds?:\s*/i, '').replace(/\s*&\s*/g, ',').trim();
  var parts = s.split(/\s*,\s*/).filter(Boolean);
  if (parts.length > 1) return parts[0] + '–' + parts[parts.length - 1];
  return parts[0] || '';
}

/** ImageURL holds a comma-separated list; the first one is the cover shot. */
function firstImage_(value) {
  var s = String(value == null ? '' : value).trim();
  if (!s) return '';
  var first = s.split(',')[0].trim();
  return /^https?:\/\//i.test(first) ? first : '';
}

// ---------------------------------------------------------------- cache

/** Script cache caps a value at 100 KB, so a large list is split across keys. */
function readCache_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var meta = cache.get(key + ':n');
    if (!meta) return null;
    var parts = [];
    for (var i = 0; i < Number(meta); i++) {
      var chunk = cache.get(key + ':' + i);
      if (chunk === null) return null;          // a piece expired; treat as a miss
      parts.push(chunk);
    }
    return JSON.parse(parts.join(''));
  } catch (e) {
    return null;
  }
}

function writeCache_(key, value, seconds) {
  try {
    var text = JSON.stringify(value);
    var size = 90000;
    var chunks = Math.ceil(text.length / size);
    if (chunks > 12) return;                    // too big to be worth caching
    var payload = { };
    for (var i = 0; i < chunks; i++) payload[key + ':' + i] = text.substr(i * size, size);
    payload[key + ':n'] = String(chunks);
    CacheService.getScriptCache().putAll(payload, seconds);
  } catch (e) {
    // Caching is an optimisation; a failure here must not break the response.
  }
}

/** Admin helper: clear the cache after editing the listings sheet. */
function refreshListings() {
  try {
    var cache = CacheService.getScriptCache();
    var n = Number(cache.get('listings:n') || 0);
    var keys = ['listings:n'];
    for (var i = 0; i < n; i++) keys.push('listings:' + i);
    cache.removeAll(keys);
  } catch (e) {}
  return 'Listings cache cleared — ' + loadListings_().length + ' listings reloaded.';
}
