/**
 * The invoice details are asked for before the card, not after. That ordering
 * is the whole point — an invoice is written the instant the payment lands and
 * cannot be quietly edited afterwards — so it is worth a test that actually
 * clicks through it in a browser.
 */
const { chromium } = require('playwright');
const http = require('http');
const post = (body) => new Promise((res, rej) => {
  const d = JSON.stringify(body);
  const r = http.request({ host: 'localhost', port: 8095, path: '/exec', method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(d) } }, (s) => {
    let b = ''; s.on('data', (c) => b += c); s.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  });
  r.on('error', rej); r.write(d); r.end();
});

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, v, x) => { console.log((v ? '  PASS ' : '  FAIL ') + n + (v || !x ? '' : '  [' + String(x).slice(0, 170) + ']')); v ? pass++ : fail++; };

  const RUN = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const email = 'bill+' + RUN + '@acme.in';
  await post({ action: 'register', form: { companyName: 'Acme Engineering',
    name: 'Rohan Mehta', email, password: 'strongpass123' } });

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
  await p.goto('http://localhost:8095/?login=1', { waitUntil: 'networkidle' });
  await p.fill('#liUser', email); await p.fill('#liPass', 'strongpass123');
  await p.click('#btnLogin'); await p.waitForTimeout(1600);

  await p.evaluate(() => openBilling());
  await p.waitForTimeout(500);
  const plans = await p.locator('#modal').textContent();
  console.log('\n--- the plans screen says what will be charged ---');
  ok('it warns that GST is added at checkout', /added at checkout/.test(plans));
  ok('it promises the invoice', /invoice is emailed/i.test(plans));
  ok('there is a way to the invoice list', await p.locator('#modal button:has-text("Invoices")').count() === 1);
  ok('and to the details behind it', await p.locator('#modal button:has-text("Invoice details")').count() === 1);
  await p.screenshot({ path: 'shot-25-plans-gst.png' });

  console.log('\n--- the details form ---');
  await p.click('#modal button:has-text("Invoice details")');
  await p.waitForTimeout(600);
  ok('the registered name is prefilled from the company', await p.inputValue('#bLegal') === 'Acme Engineering');
  ok('a GSTIN field is offered', await p.locator('#bGstin').count() === 1);
  ok('the state is a list, not free text', await p.locator('select#bState option').count() > 30);
  ok('it explains what the state decides', /CGST\+SGST or IGST/.test(await p.locator('#modal').textContent()));
  await p.screenshot({ path: 'shot-26-invoice-details.png' });

  console.log('\n--- a wrong GSTIN is caught before it reaches an invoice ---');
  await p.fill('#bGstin', 'NOTAGSTIN');
  await p.click('#bSave'); await p.waitForTimeout(800);
  ok('the form says so rather than saving it',
     /does not look right/.test(await p.locator('#toasts').textContent()));
  ok('and the form is still open to correct', await p.locator('#bGstin').count() === 1);

  await p.fill('#bGstin', '19AABCB1234C1ZQ');
  await p.fill('#bAddr', '7 Camac Street'); await p.fill('#bCity', 'Kolkata');
  await p.fill('#bPin', '700017');
  await p.click('#bSave'); await p.waitForTimeout(900);
  ok('a good one saves', /saved/i.test(await p.locator('#toasts').textContent()));
  ok('the state was taken from the GSTIN',
     (await post({ action: 'getBilling', token: (await post({ action: 'login',
       username: email, password: 'strongpass123' })).token })).billing.state === 'West Bengal');

  console.log('\n--- the invoice list ---');
  await p.evaluate(() => openInvoices());
  await p.waitForTimeout(700);
  const list = await p.locator('#modal').textContent();
  ok('an account with no payments says so plainly', /No invoices yet/.test(list));
  ok('and offers a way to fix the details', /Edit invoice details/.test(list));
  await p.screenshot({ path: 'shot-27-invoices-empty.png' });

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
