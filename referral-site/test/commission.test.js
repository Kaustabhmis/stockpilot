/* Offline test harness — run with:  node test/commission.test.js

   Stubs the Apps Script globals, loads the real .gs sources and the browser
   app.js, then checks the commission maths, phone normalisation and the
   amount parser. No network, no spreadsheet, no deployment needed. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');

const CONFIG = {
  brokerage_pct: 2, tier_threshold: 10000000, tier_low_pct: 15,
  tier_high_pct: 20, platform_fee_pct: 10, tds_pct: 2, attribution_lock_days: 90,
  payout_days_after_registration: 15, brand_name: 'Grihobazar Partners'
};

const sandbox = {
  console,
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'pepper', setProperty: () => {} }) },
  SpreadsheetApp: { getActive: () => { throw new Error('no sheet in harness'); }, flush: () => {} },
  Session: { getScriptTimeZone: () => 'Asia/Kolkata', getActiveUser: () => ({ getEmail: () => '' }),
             getEffectiveUser: () => ({ getEmail: () => '' }) },
  Utilities: {
    getUuid: () => 'uuid-' + Math.random().toString(36).slice(2),
    formatDate: (d) => d.toISOString().slice(0, 19),
    computeDigest: () => [1, 2, 3],
    base64Encode: () => 'b64',
    newBlob: () => ({ getBytes: () => [] }),
    DigestAlgorithm: { SHA_256: 'sha256' }
  },
  ContentService: {
    createTextOutput: (s) => ({ setMimeType: () => ({ getContent: () => s }), getContent: () => s }),
    MimeType: { JSON: 'json' }
  },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  MailApp: { sendEmail: () => {} },
  HtmlService: {},
};
vm.createContext(sandbox);

for (const f of ['Util.gs', 'Auth.gs', 'Referrals.gs', 'Deals.gs', 'Properties.gs', 'Code.gs']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script', f), 'utf8'), sandbox, { filename: f });
}
// Config comes from the sheet in production; feed it directly here.
vm.runInContext('getConfig = function () { return ' + JSON.stringify(CONFIG) + '; };', sandbox);

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = Math.abs(Number(got) - Number(want)) < 0.01;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + got + ' want=' + want);
  ok ? pass++ : fail++;
}

console.log('\ncommissionFor_ — below the ₹1 Cr threshold (15% share)');
let q = vm.runInContext('commissionFor_(8500000)', sandbox);   // ₹85 L
eq('brokerage @2%', q.brokerageAmount, 170000);
eq('share pct', q.sharePct, 15);
eq('gross commission', q.grossCommission, 25500);
eq('platform fee @10%', q.platformFeeAmount, 2550);
eq('commission after fee', q.commissionAfterFee, 22950);
eq('TDS @2% of after-fee', q.tdsAmount, 459);
eq('net payable', q.netPayable, 22491);

console.log('\ncommissionFor_ — exactly at the threshold (20% share)');
q = vm.runInContext('commissionFor_(10000000)', sandbox);      // ₹1 Cr
eq('share pct', q.sharePct, 20);
eq('gross commission', q.grossCommission, 40000);
eq('platform fee', q.platformFeeAmount, 4000);
eq('net payable', q.netPayable, 35280);

console.log('\ncommissionFor_ — one rupee below the threshold stays at 15%');
q = vm.runInContext('commissionFor_(9999999)', sandbox);
eq('share pct', q.sharePct, 15);

console.log('\ncommissionFor_ — a ₹2.5 Cr deal');
q = vm.runInContext('commissionFor_(25000000)', sandbox);
eq('brokerage', q.brokerageAmount, 500000);
eq('share pct', q.sharePct, 20);
eq('gross commission', q.grossCommission, 100000);
eq('platform fee', q.platformFeeAmount, 10000);
eq('net payable', q.netPayable, 88200);

console.log('\ncommissionFor_ — every figure is a whole number of rupees');
for (const value of [4500000, 7350000, 8500000, 12345678, 25000000]) {
  const r = vm.runInContext('commissionFor_(' + value + ')', sandbox);
  const whole = [r.brokerageAmount, r.grossCommission, r.platformFeeAmount,
                 r.commissionAfterFee, r.tdsAmount, r.netPayable]
    .every(n => Number.isInteger(n));
  console.log((whole ? '  ok   ' : '  FAIL ') + 'whole rupees @ ' + value +
              '  net=' + r.netPayable);
  whole ? pass++ : fail++;
}

console.log('\ncommissionFor_ — the deductions must add up to the gross');
for (const value of [4500000, 8500000, 10000000, 25000000, 61000000]) {
  const r = vm.runInContext('commissionFor_(' + value + ')', sandbox);
  eq('gross = fee + tds + net @ ' + value,
     r.platformFeeAmount + r.tdsAmount + r.netPayable, r.grossCommission);
}

console.log('\ncommissionFor_ — platform fee is our cut of the brokerage, not extra revenue');
q = vm.runInContext('commissionFor_(25000000)', sandbox);
eq('we keep brokerage minus partner share plus fee',
   q.brokerageAmount - q.grossCommission + q.platformFeeAmount, 410000);

console.log('\ncommissionFor_ — junk input must not produce a payout');
q = vm.runInContext('commissionFor_("abc")', sandbox);
eq('net payable', q.netPayable, 0);
eq('platform fee', q.platformFeeAmount, 0);

console.log('\nnormPhone_ / isValidPhone_');
const cases = [
  ['9932187116', '9932187116', true],
  ['+91 99321 87116', '9932187116', true],
  ['09932187116', '9932187116', true],
  ['1234567890', '1234567890', false],
  ['99321', '99321', false]
];
for (const [input, wantNorm, wantValid] of cases) {
  const gotNorm = vm.runInContext('normPhone_(' + JSON.stringify(input) + ')', sandbox);
  const gotValid = vm.runInContext('isValidPhone_(' + JSON.stringify(input) + ')', sandbox);
  const ok = gotNorm === wantNorm && gotValid === wantValid;
  console.log((ok ? '  ok   ' : '  FAIL ') + input + ' -> ' + gotNorm + ' valid=' + gotValid);
  ok ? pass++ : fail++;
}

console.log('\nparsePriceText_ — the free-text Price column from the live sheet');
{
  const shapes = [
    ['81 Lakhs Onwards',              8100000,  8100000],
    ['78 Lakhs onwards.',             7800000,  7800000],
    ['₹64 Lakh Onwards',              6400000,  6400000],
    ['₹55 Lakhs Onwards*',            5500000,  5500000],
    ['Price: ₹2.20 Cr Onwards*',     22000000, 22000000],
    ['68 Lakh Approx',                6800000,  6800000],
    // The first figure carries no unit and must inherit Cr from the second.
    ['₹2.44  - ₹4.25 Cr',            24400000, 42500000],
    // A '+' between number and unit must not detach the unit.
    ['₹69 Lakhs – ₹1.25+ Cr',         6900000, 12500000],
    ['4.35+ Crore Onwards',          43500000, 43500000],
    // Room counts are not prices.
    ['₹1.75 Cr 3 BHK, 2.60 Cr 4BHK', 17500000, 26000000],
    // Yes, this spelling is in the data.
    ['34 laksh ownerds',              3400000,  3400000],
    ['₹1.05 Cr – ₹1.42+ Cr',         10500000, 14200000]
  ];
  for (const [text, wantMin, wantMax] of shapes) {
    const r = vm.runInContext('parsePriceText_(' + JSON.stringify(text) + ')', sandbox);
    const ok = r && r.min === wantMin && r.max === wantMax;
    console.log((ok ? '  ok   ' : '  FAIL ') + JSON.stringify(text).padEnd(34) +
                (r ? r.min + ' – ' + r.max : 'null') +
                (ok ? '' : '   want ' + wantMin + ' – ' + wantMax));
    ok ? pass++ : fail++;
  }

  // Things that are not prices must be rejected, not guessed at.
  for (const junk of ['', 'Price on request', 'Call for price', '1064', 'abc']) {
    const r = vm.runInContext('parsePriceText_(' + JSON.stringify(junk) + ')', sandbox);
    const ok = r === null;
    console.log((ok ? '  ok   ' : '  FAIL ') + 'rejects ' + JSON.stringify(junk));
    ok ? pass++ : fail++;
  }

  // Every Price value from the live sheet, as a regression guard.
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures-prices.json'), 'utf8'));
  let parsedCount = 0;
  const unparsed = [];
  for (const text of live) {
    const r = vm.runInContext('parsePriceText_(' + JSON.stringify(text) + ')', sandbox);
    if (r && r.min > 0 && r.max >= r.min) parsedCount++; else unparsed.push(text);
  }
  const allParsed = parsedCount === live.length;
  console.log((allParsed ? '  ok   ' : '  FAIL ') + 'all ' + live.length +
              ' live Price values parse (' + parsedCount + ')');
  if (!allParsed) unparsed.slice(0, 5).forEach(u => console.log('        unparsed: ' + JSON.stringify(u)));
  allParsed ? pass++ : fail++;
}

console.log('\nbhkLabel_ — recovering the cells Sheets turned into dates');
{
  // "3,4" became 4 March 2026. Month and day carry the two numbers; checked
  // against the BHK ranges stated in the listing titles, 7 of 7 agree.
  const dated = [
    [new Date(2026, 2, 4), '3–4'],
    [new Date(2026, 1, 3), '2–3'],
    [new Date(2026, 3, 6), '4–6'],
    [new Date(2026, 0, 3), '1–3']
  ];
  for (const [d, want] of dated) {
    const got = vm.runInContext('bhkLabel_(new Date(' + d.getTime() + '))', sandbox);
    const ok = got === want;
    console.log((ok ? '  ok   ' : '  FAIL ') + d.toDateString() + ' -> ' + got + (ok ? '' : '  want ' + want));
    ok ? pass++ : fail++;
  }
  const plain = [['2,3', '2–3'], ['3', '3'], ['Beds: 2, 3 & 4 BHK', '2–4'], ['', ''], [null, '']];
  for (const [input, want] of plain) {
    const got = vm.runInContext('bhkLabel_(' + JSON.stringify(input) + ')', sandbox);
    const ok = got === want;
    console.log((ok ? '  ok   ' : '  FAIL ') + JSON.stringify(input) + ' -> ' + JSON.stringify(got));
    ok ? pass++ : fail++;
  }
}

console.log('\nfirstImage_ — ImageURL holds a comma-separated list');
{
  const cases = [
    ['https://a.test/1, https://a.test/2', 'https://a.test/1'],
    ['https://a.test/only', 'https://a.test/only'],
    ['', ''],
    ['not a url', '']
  ];
  for (const [input, want] of cases) {
    const got = vm.runInContext('firstImage_(' + JSON.stringify(input) + ')', sandbox);
    const ok = got === want;
    console.log((ok ? '  ok   ' : '  FAIL ') + JSON.stringify(input) + ' -> ' + JSON.stringify(got));
    ok ? pass++ : fail++;
  }
}

console.log('\nclient parseAmount — what people actually type');
const dom = {
  window: {}, document: { addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  navigator: {}, location: { pathname: '/', origin: 'https://x.test', search: '' },
  fetch: () => Promise.reject(new Error('no network in harness')), console
};
dom.window = dom;
vm.createContext(dom);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'web/assets/app.js'), 'utf8'), dom, { filename: 'app.js' });

const amounts = [
  ['85 lakh', 8500000], ['85L', 8500000], ['85 l', 8500000], ['1.2 cr', 12000000],
  ['1.2Cr', 12000000], ['₹85,00,000', 8500000], ['8500000', 8500000], ['2 crore', 20000000],
  ['50k', 50000], ['', null], ['abc', null], ['85 lakhs onwards', null]
];
for (const [input, want] of amounts) {
  const got = vm.runInContext('GB.parseAmount(' + JSON.stringify(input) + ')', dom);
  const ok = (want === null) ? (got === null) : Math.abs(got - want) < 0.01;
  console.log((ok ? '  ok   ' : '  FAIL ') + JSON.stringify(input) + ' -> ' + got);
  ok ? pass++ : fail++;
}

console.log('\nclient rupeesShort');
for (const [n, want] of [[8500000, '₹85 L'], [12000000, '₹1.2 Cr'], [10000000, '₹1 Cr'], [50000, '₹50 K']]) {
  const got = vm.runInContext('GB.rupeesShort(' + n + ')', dom);
  const ok = got === want;
  console.log((ok ? '  ok   ' : '  FAIL ') + n + ' -> ' + got + ' (want ' + want + ')');
  ok ? pass++ : fail++;
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
