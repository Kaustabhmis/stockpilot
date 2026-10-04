/**
 * Browser smoke test for the client dashboard (src/ClientApp.html).
 *
 * Loads the real page in headless Chromium with google.script.run replaced by an in-page
 * mock, then drives login → customer upload (CSV + XLSX) → ad builder with image → protected
 * preview → schedule → launch → campaign preview/cancel, on a phone and a desktop viewport.
 *
 * Optional dev test (needs playwright-core and xlsx; not part of the Apps Script project):
 *   npm i playwright-core xlsx      (anywhere; then point NODE_PATH at that node_modules)
 *   NODE_PATH=<dir>/node_modules node whatsapp-automation/tests/ui-smoke.js [screenshotDir]
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright-core');
const XLSX = require('xlsx');

const SHOTS = process.argv[2] || null;
const HTML = fs.readFileSync(path.join(__dirname, '..', 'src', 'ClientApp.html'), 'utf8');
const XLSX_JS = fs.readFileSync(require.resolve('xlsx/dist/xlsx.full.min.js'), 'utf8');

const MOCK = `
<script>
(function () {
  var boot = {
    ok: true,
    profile: { clientId: 'CLI-2026-0001', businessName: 'Sunrise Bakery', email: 'owner@sunrise.example', phone: '+919800000000', website: 'https://sunrise.example' },
    settings: { timezone: 'Asia/Kolkata', today: '2026-10-04', nowTime: '10:00', ctaTextMaxLength: 20, maxImageMb: 5, maxUploadRows: 5000,
      imageCtaStyle: 'IMAGE_THEN_BUTTONS', defaultContactName: 'Customer', defaultCountryCode: '91',
      variables: ['Name','Phone','Email','Company','ClientName','CampaignName','StorePhone','Website'], systemName: 'WhatsApp Campaign Automation' },
    stats: { contacts: 3, optedIn: 2, optedOut: 1 },
    lists: [{ name: 'VIP', count: 2 }],
    subscription: { plan: 'Pro', validUntil: '2026-12-31', quota: 1000, used: 120, remaining: 880, canSend: true, reason: '', dedicatedNumber: true },
    campaigns: [{ id: 'CMP-2026-0001', name: 'Weekend Treats', status: 'SCHEDULED', sendMode: 'SCHEDULE', scheduleDate: '2026-10-10', scheduleTime: '19:00',
      timezone: 'Asia/Kolkata', createdAt: '2026-10-01 10:00', audience: 'TAG:VIP', hasImage: true, message: 'Hi {{Name}}, fresh *croissants* at {{ClientName}}!',
      ctaType: 'URL', ctaText: 'Order Now', ctaValue: 'https://sunrise.example/order', website: 'https://sunrise.example', storePhone: '+919800000000',
      stats: { recipients: 2, sent: 0, delivered: 0, read: 0, failed: 0, pending: 2 }, replies: 0 }],
  };
  window.__calls = [];
  var api = {
    apiLogin: function (email, code) { return code === 'ABCDE-FGHJK' ? Object.assign({ token: 'a'.repeat(64) }, boot) : { ok: false, code: 'AUTH', error: 'Email or access code is incorrect.' }; },
    apiLogout: function () { return { ok: true }; },
    apiBootstrap: function () { return boot; },
    apiCountAudience: function (t, sel) { return { ok: true, count: sel.all ? boot.stats.optedIn : (sel.lists || []).length * 2 }; },
    apiUploadContacts: function (t, p) {
      window.__lastUpload = p;
      boot.lists.push({ name: p.listName, count: p.rows.length });
      boot.stats.contacts += p.rows.length; boot.stats.optedIn += p.rows.length;
      return { ok: true, list: p.listName, added: p.rows.length, updated: 0, invalid: 0, invalidRows: [], duplicatesInFile: 0, keptOptedOut: 0, bootstrap: boot };
    },
    apiCreateCampaign: function (t, p) {
      window.__lastPayload = p;
      boot.campaigns.unshift({ id: 'CMP-2026-0002', name: p.campaignName, status: p.sendMode === 'SCHEDULE' ? 'SCHEDULED' : 'ACTIVE', sendMode: p.sendMode,
        scheduleDate: p.date, scheduleTime: p.time, timezone: 'Asia/Kolkata', createdAt: '2026-10-04 10:05', audience: '', hasImage: !!p.imageDataUrl,
        message: p.message, ctaType: p.ctaType === 'NONE' ? '' : p.ctaType, ctaText: p.ctaText, ctaValue: p.ctaValue, website: p.website, storePhone: p.storePhone,
        stats: { recipients: 2, sent: 0, delivered: 0, read: 0, failed: 0, pending: 2 }, replies: 0 });
      return { ok: true, created: true, campaignId: 'CMP-2026-0002', status: p.sendMode === 'SCHEDULE' ? 'SCHEDULED' : 'ACTIVE', errors: [], warnings: [], campaigns: boot.campaigns };
    },
    apiCancelCampaign: function (t, id) { boot.campaigns.forEach(function (c) { if (c.id === id) c.status = 'CANCELLED'; }); return { ok: true, message: 'cancelled', campaigns: boot.campaigns }; },
    apiGetCampaignImage: function () {
      var c = document.createElement('canvas'); c.width = 400; c.height = 300; var x = c.getContext('2d');
      x.fillStyle = '#f4a261'; x.fillRect(0, 0, 400, 300); x.fillStyle = '#264653'; x.font = 'bold 40px sans-serif'; x.fillText('Fresh bakes', 60, 160);
      return { ok: true, image: c.toDataURL('image/jpeg', 0.8) };
    },
  };
  function runner(success, failure) {
    return new Proxy({}, { get: function (_, k) {
      if (k === 'withSuccessHandler') return function (fn) { return runner(fn, failure); };
      if (k === 'withFailureHandler') return function (fn) { return runner(success, fn); };
      return function () { var args = arguments; window.__calls.push(k);
        setTimeout(function () { try { var r = api[k].apply(null, args); success && success(r); } catch (e) { failure && failure(e); } }, 20); };
    } });
  }
  window.google = { script: { run: runner(null, null) } };
})();
</script>`;

async function run(viewport, label) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2, hasTouch: viewport.width < 600 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: XLSX_JS }));
  await page.route('http://app.test/**', r => r.fulfill({ contentType: 'text/html', body: HTML.replace('<script>', MOCK + '\n<script>') }));
  await page.goto('http://app.test/');
  const shot = async name => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, label + '-' + name + '.png'), fullPage: false }); };
  const noHorizontalScroll = async () => {
    const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(o <= 1, label + ': horizontal overflow of ' + o + 'px');
  };

  // Login
  await page.fill('#loginEmail', 'owner@sunrise.example');
  await page.fill('#loginCode', 'WRONG-WRONG');
  await page.click('#loginBtn');
  await page.waitForSelector('#loginError:not(.hidden)');
  await shot('1-login-error');
  await page.fill('#loginCode', 'ABCDE-FGHJK');
  await page.click('#loginBtn');
  await page.waitForSelector('#app:not(.hidden)');
  assert.strictEqual(await page.textContent('#hdrName'), 'Sunrise Bakery');
  await noHorizontalScroll();
  await shot('2-overview');

  // Customers: CSV upload
  await page.click('#tabs button[data-view=customers]');
  await page.setInputFiles('#custInput', { name: 'diwali-list.csv', mimeType: 'text/csv',
    buffer: Buffer.from('Customer Name,Mobile Number,E-mail,City\nAsha,9876543210,asha@x.com,Kolkata\nRavi,+91 98123 45678,,Delhi\n') });
  await page.waitForSelector('#parseBox:not(.hidden)');
  assert.ok((await page.textContent('#parseInfo')).includes('2 with a valid phone number'));
  assert.strictEqual(await page.$eval('select[data-map=phone]', s => s.options[s.selectedIndex].text), 'Mobile Number');
  assert.strictEqual(await page.$eval('select[data-map=name]', s => s.options[s.selectedIndex].text), 'Customer Name');
  await page.click('#importBtn');
  assert.ok((await page.textContent('#uploadErr')).includes('confirm'));
  await page.check('#consent');
  await noHorizontalScroll();
  await shot('3-upload-mapping');
  await page.click('#importBtn');
  await page.waitForSelector('#uploadResult .alert.ok');
  const up = await page.evaluate(() => window.__lastUpload);
  assert.strictEqual(up.rows.length, 2); assert.strictEqual(up.rows[0].phone, '9876543210'); assert.strictEqual(up.rows[0].tags, 'Kolkata');
  assert.strictEqual(up.listName, 'diwali-list');

  // Customers: XLSX upload with numeric phones (must not become 9.18E+11)
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'WhatsApp'], ['Neha', 919812300000], ['Om', 9812300001]]), 'Sheet1');
  await page.setInputFiles('#custInput', { name: 'vip.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) });
  await page.waitForSelector('#parseBox:not(.hidden)');
  await page.check('#consent');
  await page.click('#importBtn');
  await page.waitForSelector('#uploadResult .alert.ok');
  const up2 = await page.evaluate(() => window.__lastUpload);
  assert.strictEqual(up2.rows[0].phone, '919812300000');
  await shot('4-customers');

  // Create campaign
  await page.click('#tabs button[data-view=create]');
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 1200, 900); g.addColorStop(0, '#e76f51'); g.addColorStop(1, '#2a9d8f'); x.fillStyle = g; x.fillRect(0, 0, 1200, 900);
    x.fillStyle = '#fff'; x.font = 'bold 90px sans-serif'; x.fillText('Product photo', 250, 470); return c.toDataURL('image/png').split(',')[1];
  });
  await page.fill('#cName', 'Festive Offer');
  await page.setInputFiles('#imgInput', { name: 'creative.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForSelector('#thumbRow:not(.hidden)');
  await page.waitForFunction(() => /optimised JPG/.test(document.getElementById('imgInfo').textContent));
  await page.click('#overlayBox summary');
  await page.fill('#ovHead', 'Festive Sale – 30% Off');
  await page.fill('#ovSub', 'This weekend only');
  await page.fill('#cMsg', 'Hi {{Name}},\n\nCelebrate with *fresh* treats from {{ClientName}}. Call {{StorePhone}}.');
  await page.fill('#ctaText', 'Order Now');
  await page.waitForTimeout(500);
  if (viewport.width < 960) {
    await page.click('#fabPreview');
    await page.waitForSelector('#sheet:not(.hidden) canvas');
    const txt = await page.textContent('#sheetBody');
    assert.ok(txt.includes('Hi Customer,') && txt.includes('Sunrise Bakery') && txt.includes('+919800000000') && txt.includes('Order Now'), txt);
    await shot('5-preview-sheet');
    await page.click('#sheetClose');
  } else {
    await page.waitForSelector('#livePreview canvas');
    assert.ok((await page.textContent('#livePreview')).includes('Hi Customer,'));
    await shot('5-builder-with-preview');
  }
  // Protection: right-click on preview is blocked; blur hides the preview.
  const blocked = await page.evaluate(() => {
    const el = document.querySelector('.protected .shield') || document.querySelector('.protected');
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); el.dispatchEvent(ev); return ev.defaultPrevented;
  });
  assert.ok(blocked, 'context menu should be blocked on the preview');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.ok(await page.evaluate(() => document.body.classList.contains('privacy')));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await noHorizontalScroll();

  await page.click('#toStep2');
  await page.check('input[name=aud][value=lists]');
  await page.check('#listPicker input[value=VIP]');
  await page.waitForFunction(() => /Recipients: 2/.test(document.getElementById('audCount').textContent));
  await page.click('#whenSeg button[data-when=SCHEDULE]');
  await page.fill('#sDate', '2026-10-10');
  await page.fill('#sTime', '19:00');
  await shot('6-audience');
  await page.click('#toStep3');
  await page.waitForSelector('#reviewPreview canvas');
  assert.ok((await page.textContent('#summary')).includes('2026-10-10 at 19:00'));
  await shot('7-review');
  await page.click('#launchBtn');
  await page.waitForSelector('#step-done:not(.hidden)');
  const p = await page.evaluate(() => window.__lastPayload);
  assert.ok(p.imageDataUrl.startsWith('data:image/jpeg;base64,'));
  assert.strictEqual(p.ctaType, 'URL'); assert.strictEqual(p.sendMode, 'SCHEDULE');
  assert.strictEqual(JSON.stringify(p.audience), JSON.stringify({ lists: ['VIP'] }));
  assert.ok((await page.textContent('#doneMsg')).includes('SCHEDULED'));
  await shot('8-launched');

  // Campaigns: preview + cancel
  await page.click('#step-done [data-go=campaigns]');
  await page.click('[data-preview="CMP-2026-0001"]');
  await page.waitForSelector('#sheet:not(.hidden) canvas');
  await page.waitForTimeout(200);
  await shot('9-campaign-preview');
  await page.click('#sheetClose');
  await page.click('[data-cancel="CMP-2026-0001"]');
  await page.waitForFunction(() => document.querySelector('#campaignList').textContent.includes('CANCELLED'));
  await noHorizontalScroll();
  await shot('10-campaigns');

  await browser.close();
  assert.deepStrictEqual(errors, [], label + ' console errors: ' + errors.join(' | '));
  console.log('  ✓ ' + label + ' (' + viewport.width + 'x' + viewport.height + ')');
}

(async () => {
  try {
    await run({ width: 390, height: 844 }, 'phone');
    await run({ width: 768, height: 1024 }, 'tablet');
    await run({ width: 1366, height: 860 }, 'desktop');
    console.log('UI smoke test passed');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
