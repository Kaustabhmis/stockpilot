// ===========================================================================
// INVOICES
// ===========================================================================
/**
 * DOME BOX — TAX INVOICES
 * =============================================================================
 * Every rupee that reaches the Razorpay account leaves a document behind, sent
 * to the customer from info@biscsindia.com without anyone pressing a button.
 *
 * WHY THIS IS NOT JUST A PRETTIER RECEIPT
 *
 * The receipt mail says "you paid". An invoice is the thing the customer's
 * accountant files, and in India it has to carry specific fields or it is not
 * one: the supplier's legal name, address and GSTIN; a serial number unique
 * and gapless within the financial year; the date; the recipient's name,
 * address and GSTIN where they have one; the SAC for the service; the taxable
 * value; the rate and amount of tax split the right way; and the place of
 * supply. Miss the GSTIN and the customer cannot claim input credit, which for
 * a ₹60,000 yearly plan is about ₹9,000 of their money.
 *
 * TWO DOCUMENTS, AND THE RULE THAT PICKS ONE
 *
 * Until SELLER_GSTIN is set, BISCS India is treated as not registered: no tax
 * is charged, no tax lines appear, and the document is titled "Invoice". The
 * moment a GSTIN is set it becomes a "Tax Invoice", 18% is charged on top of
 * the listed price — which is what www.domebox.in has always promised — and
 * the tax is split by place of supply:
 *
 *   buyer's state  ==  seller's state   ->  CGST 9% + SGST 9%
 *   buyer's state  !=  seller's state   ->  IGST 18%
 *
 * Getting that split wrong is not a rounding error, it is a filing correction,
 * so when the buyer's state is unknown the invoice is still issued (the
 * customer has paid; they are owed the document) and flagged for review.
 *
 * The number series is the part that cannot be rebuilt later. It is derived
 * under the registry lock from the rows already written, so two payments
 * landing in the same second cannot take the same number and a crash between
 * numbering and writing cannot leave a hole.
 * =============================================================================
 */

var SAC_SOFTWARE = '998314';          // IT design and development services
var GST_RATE_DEFAULT = 18;

/** Who is selling, read from Script Properties so nothing legal is hardcoded. */
function sellerIdentity_() {
  var p = PropertiesService.getScriptProperties();
  var gstin = String(p.getProperty('SELLER_GSTIN') || '').trim().toUpperCase();
  return {
    legalName: p.getProperty('SELLER_LEGAL_NAME') || 'BISCS India',
    address:   p.getProperty('SELLER_ADDRESS') || '',
    gstin:     gstin,
    pan:       String(p.getProperty('SELLER_PAN') || '').trim().toUpperCase(),
    state:     p.getProperty('SELLER_STATE') || '',
    stateCode: gstin ? gstin.slice(0, 2) : String(p.getProperty('SELLER_STATE_CODE') || '').trim(),
    email:     CFG().mailFrom,
    phone:     p.getProperty('SELLER_PHONE') || '',
    prefix:    p.getProperty('INVOICE_PREFIX') || 'BISCS',
    sac:       p.getProperty('SAC_CODE') || SAC_SOFTWARE,
    /* No GSTIN means not registered, which means charging GST would be an
       offence rather than an oversight. The rate follows the registration. */
    rate:      gstin ? (Number(p.getProperty('GST_RATE')) || GST_RATE_DEFAULT) : 0,
    registered: !!gstin,
  };
}

/** The rate a sale attracts today. The checkout and the invoice must agree. */
function gstRate_() { return sellerIdentity_().rate; }

/** Indian financial year, April to March: 2026-01-07 -> "25-26". */
function financialYear_(d) {
  d = d || new Date();
  var y = d.getFullYear(), start = (d.getMonth() >= 3) ? y : y - 1;
  return String(start).slice(2) + '-' + String(start + 1).slice(2);
}

/* Place of supply is decided by the state code, not by how the address is
   spelled. The buyer's GSTIN carries it in its first two digits, which is why
   a GSTIN is trusted over a typed state name. */
var STATE_CODES = {
  '01':'Jammu and Kashmir','02':'Himachal Pradesh','03':'Punjab','04':'Chandigarh',
  '05':'Uttarakhand','06':'Haryana','07':'Delhi','08':'Rajasthan','09':'Uttar Pradesh',
  '10':'Bihar','11':'Sikkim','12':'Arunachal Pradesh','13':'Nagaland','14':'Manipur',
  '15':'Mizoram','16':'Tripura','17':'Meghalaya','18':'Assam','19':'West Bengal',
  '20':'Jharkhand','21':'Odisha','22':'Chhattisgarh','23':'Madhya Pradesh','24':'Gujarat',
  '26':'Dadra and Nagar Haveli and Daman and Diu','27':'Maharashtra','29':'Karnataka',
  '30':'Goa','31':'Lakshadweep','32':'Kerala','33':'Tamil Nadu','34':'Puducherry',
  '35':'Andaman and Nicobar Islands','36':'Telangana','37':'Andhra Pradesh',
  '38':'Ladakh','96':'Other Country','97':'Other Territory',
};
function stateCodeFor_(name) {
  var n = String(name || '').trim().toLowerCase();
  if (!n) return '';
  for (var k in STATE_CODES) if (STATE_CODES[k].toLowerCase() === n) return k;
  return '';
}
function stateNameFor_(code) { return STATE_CODES[String(code || '').trim()] || ''; }

/** A GSTIN is 15 characters: 2 state + 10 PAN + entity + 'Z' + checksum. */
function validGstin_(g) {
  return /^[0-3][0-9A-Z][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(String(g || '').trim().toUpperCase());
}

/* ---------- billing details -------------------------------------------- */

var BILLING_HEADERS = ['SheetID','Legal Name','GSTIN','Address','City','State',
                       'State Code','PIN','Billing Email','Updated'];

function billingSheet_() {
  return mkTab_(SpreadsheetApp.openById(CFG().masterId), 'Billing', BILLING_HEADERS);
}

/** What we will print on this customer's invoice. Never throws: a missing row
 *  must not stop an invoice, it only makes it a less complete one. */
function billingFor_(sheetId) {
  try {
    var d = billingSheet_().getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][0]).trim() === String(sheetId).trim()) {
        return { sheetId: sheetId, legalName: d[i][1] || '', gstin: String(d[i][2] || '').toUpperCase(),
                 address: d[i][3] || '', city: d[i][4] || '', state: d[i][5] || '',
                 stateCode: String(d[i][6] || ''), pin: String(d[i][7] || ''),
                 email: d[i][8] || '', row: i + 1 };
      }
    }
  } catch (e) { logError_('billingFor', e.message); }
  return null;
}

function getBilling_(ctx) {
  requireAdmin_(ctx);
  var b = billingFor_(ctx.sheetId) || {};
  return { status: 'success', billing: {
    legalName: b.legalName || ctx.company, gstin: b.gstin || '', address: b.address || '',
    city: b.city || '', state: b.state || '', pin: b.pin || '', email: b.email || ctx.me.email },
    states: Object.keys(STATE_CODES).map(function (c) { return STATE_CODES[c]; }).sort() };
}

function saveBilling_(ctx, form) {
  requireAdmin_(ctx);
  form = form || {};
  var gstin = String(form.gstin || '').trim().toUpperCase();
  if (gstin && !validGstin_(gstin)) throw new Error('That GSTIN does not look right. It is 15 characters, like 19AABCB1234C1ZQ.');

  /* The GSTIN is the stronger claim about where supply happens, so when both
     are given and disagree, the GSTIN wins and the state is corrected to match
     rather than quietly producing an invoice that contradicts itself. */
  var code = gstin ? gstin.slice(0, 2) : stateCodeFor_(form.state);
  var state = gstin ? (stateNameFor_(code) || form.state || '') : (form.state || '');
  if (gstin && !stateNameFor_(code)) throw new Error('That GSTIN starts with an unknown state code.');

  var row = [ctx.sheetId, String(form.legalName || ctx.company).trim(), gstin,
             String(form.address || '').trim(), String(form.city || '').trim(), state, code,
             String(form.pin || '').trim(), String(form.email || ctx.me.email).trim(), new Date()];

  return withLock_(function () {
    var sh = billingSheet_(), existing = billingFor_(ctx.sheetId);
    if (existing) sh.getRange(existing.row, 1, 1, BILLING_HEADERS.length).setValues([row]);
    else sh.appendRow(row);
    /* This row lives in the registry rather than the tenant sheet, so nothing
       memoised is actually stale — but every write in a request drops the
       cache here, with no exceptions to remember and nothing to get wrong. */
    dropCache_(ctx);
    return { status: 'success', message: 'Billing details saved. They appear on every invoice from now on.' };
  });
}

/* ---------- the tax arithmetic ------------------------------------------ */

/**
 * Split a gross amount in paise into taxable value and tax.
 *
 * The charged amount is always treated as tax-inclusive and the taxable value
 * is derived back out of it. That is deliberate: whichever path granted the
 * plan — the browser handler or the webhook — the invoice then adds up to the
 * exact figure on the customer's card statement, to the paisa. Deriving it the
 * other way around leaves invoices that are a rupee off the payment.
 */
function gstSplit_(grossPaise, ratePercent, interState) {
  var gross = Math.round(Number(grossPaise) || 0);
  var rate = Number(ratePercent) || 0;
  if (!rate) return { gross: gross, taxable: gross, rate: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 };
  var taxable = Math.round(gross * 100 / (100 + rate));
  var tax = gross - taxable;
  if (interState) return { gross: gross, taxable: taxable, rate: rate, cgst: 0, sgst: 0, igst: tax, tax: tax };
  var cgst = Math.round(tax / 2);
  return { gross: gross, taxable: taxable, rate: rate, cgst: cgst, sgst: tax - cgst, igst: 0, tax: tax };
}

function rupees_(paise) {
  return (Math.round(Number(paise) || 0) / 100).toLocaleString('en-IN',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

var ONES = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven',
  'Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
var TENS = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
function twoDigits_(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
}
/** Indian grouping — crore, lakh, thousand, hundred. An invoice is expected to
 *  carry the amount in words, and "1,20,000" is "One Lakh Twenty Thousand". */
function amountInWords_(paise) {
  var total = Math.round(Number(paise) || 0);
  var rs = Math.floor(total / 100), ps = total % 100, out = [];
  if (!rs) out.push('Zero');
  var units = [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand'], [100, 'Hundred']];
  units.forEach(function (u) {
    var q = Math.floor(rs / u[0]);
    if (q) { out.push((u[0] >= 100000 ? amountChunk_(q) : twoDigits_(q)) + ' ' + u[1]); rs %= u[0]; }
  });
  if (rs) out.push(twoDigits_(rs));
  var words = 'Rupees ' + out.join(' ');
  if (ps) words += ' and ' + twoDigits_(ps) + ' Paise';
  return words + ' Only';
}
function amountChunk_(n) { return n < 100 ? twoDigits_(n) : twoDigits_(Math.floor(n / 100)) + ' Hundred' + (n % 100 ? ' ' + twoDigits_(n % 100) : ''); }

/* ---------- the ledger -------------------------------------------------- */

var INVOICE_HEADERS = ['Invoice No','Date','FY','SheetID','Company','Legal Name','Buyer GSTIN',
  'Place of Supply','State Code','Plan','Period','Payment ID','Order ID','Taxable','Rate',
  'CGST','SGST','IGST','Total','Status','Sent To'];

function invoiceSheet_() {
  return mkTab_(SpreadsheetApp.openById(CFG().masterId), 'Invoices', INVOICE_HEADERS);
}

/**
 * The next serial for this financial year, derived from the rows that exist.
 * Caller must already hold the script lock.
 *
 * A counter in Script Properties would be faster and would be wrong: bump it,
 * fail to write the row, and the series has a hole that has to be explained to
 * an auditor. Reading the ledger means the number and the row are decided from
 * the same source of truth.
 */
function nextInvoiceNo_(fy) {
  var seller = sellerIdentity_(), d = invoiceSheet_().getDataRange().getValues(), max = 0;
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][2]).trim() !== fy) continue;
    var n = Number(String(d[i][0]).split('/').pop());
    if (n > max) max = n;
  }
  return seller.prefix + '/' + fy + '/' + ('000' + (max + 1)).slice(-4);
}

/** Has this payment already been invoiced? Razorpay can deliver the same
 *  capture twice, and the browser handler and the webhook both grant plans. */
function invoiceForPayment_(paymentId) {
  if (!paymentId) return null;
  try {
    var d = invoiceSheet_().getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][11]).trim() === String(paymentId).trim()) {
        return { number: d[i][0], date: d[i][1], total: d[i][18] };
      }
    }
  } catch (e) { logError_('invoiceForPayment', e.message); }
  return null;
}

/**
 * Issue and email the invoice for a captured payment.
 * Caller must already hold the script lock — grantPlan_locked_ does.
 * Never throws: the customer has paid and the plan is granted either way, so a
 * failure here is an operator problem, not a customer-facing one.
 */
function issueInvoice_locked_(sheetId, planName, paid, company, until) {
  try {
    var paymentId = String((paid && paid.id) || '');
    var already = invoiceForPayment_(paymentId);
    if (already) return already;          // idempotent: both payment paths land here

    var seller = sellerIdentity_(), bill = billingFor_(sheetId) || {};
    var buyerCode = String(bill.stateCode || '');
    var interState = !!(buyerCode && seller.stateCode && buyerCode !== seller.stateCode);
    var split = gstSplit_((paid && paid.amount) || 0, seller.rate, interState);

    var plan = PLANS[planName] || { name: planName };
    var now = new Date(), fy = financialYear_(now);
    var number = nextInvoiceNo_(fy);
    var reg = registryRow_(sheetId) || {};
    var to = bill.email || reg.email || '';

    /* An invoice whose place of supply is a guess is still owed to the
       customer, but it must not be filed without someone looking at it. */
    var status = 'Issued';
    if (seller.registered && !buyerCode) status = 'Review — place of supply unknown';

    var inv = {
      number: number, date: ymd(now), fy: fy, sheetId: sheetId,
      company: company || reg.company || '', legalName: bill.legalName || company || reg.company || '',
      buyerGstin: bill.gstin || '',
      address: [bill.address, bill.city, (bill.state || '') + (bill.pin ? ' ' + bill.pin : '')]
                 .filter(function (x) { return String(x || '').trim(); }).join(', '),
      placeOfSupply: bill.state || stateNameFor_(buyerCode) || '',
      stateCode: buyerCode, interState: interState,
      plan: plan.name || planName, planKey: planName,
      period: ymd(now) + ' to ' + (until || ''),
      paymentId: paymentId, orderId: String((paid && paid.order_id) || ''),
      seller: seller, split: split, status: status, to: to,
      words: amountInWords_(split.gross),
    };

    invoiceSheet_().appendRow([inv.number, inv.date, inv.fy, inv.sheetId, inv.company,
      inv.legalName, inv.buyerGstin, inv.placeOfSupply, inv.stateCode, inv.plan, inv.period,
      inv.paymentId, inv.orderId, split.taxable / 100, split.rate, split.cgst / 100,
      split.sgst / 100, split.igst / 100, split.gross / 100, inv.status, to]);

    if (to) sendEmail_(to, (seller.registered ? 'Tax invoice ' : 'Invoice ') + inv.number +
                           ' — Dome Box', invoiceHtml_(inv));
    else logError_('invoice:noEmail', inv.number + ' has no address to send to (' + sheetId + ')');

    if (status !== 'Issued') {
      sendOpsMail_(CFG().mailFrom, 'Invoice ' + inv.number + ' needs a place of supply',
        'Invoice ' + inv.number + ' was issued to ' + inv.legalName + ' for ' +
        '₹' + rupees_(split.gross) + ', charged as ' + (interState ? 'IGST' : 'CGST+SGST') +
        ' with no state on file. Ask them to fill in Plans > Invoice details, then run ' +
        'reissueFlaggedInvoices in the Apps Script editor.');
    }
    logPayment_('INVOICE', sheetId, inv.number + ' ₹' + rupees_(split.gross));
    return inv;
  } catch (e) {
    logError_('issueInvoice', e.message + ' (' + sheetId + ')');
    return null;
  }
}

/* ---------- the document ------------------------------------------------ */

function invRow_(label, value, strong) {
  return '<tr><td style="padding:7px 12px;color:#6b7280;border-bottom:1px solid #eee">' + esc_(label) +
    '</td><td style="padding:7px 12px;text-align:right;border-bottom:1px solid #eee' +
    (strong ? ';font-weight:800;font-size:15px' : '') + '">' + esc_(value) + '</td></tr>';
}

function invoiceHtml_(inv) {
  var s = inv.seller, sp = inv.split;
  var title = s.registered ? 'Tax Invoice' : 'Invoice';

  var taxLines = '';
  if (sp.rate) {
    taxLines = sp.igst
      ? invRow_('IGST @ ' + sp.rate + '%', '₹' + rupees_(sp.igst))
      : invRow_('CGST @ ' + (sp.rate / 2) + '%', '₹' + rupees_(sp.cgst)) +
        invRow_('SGST @ ' + (sp.rate / 2) + '%', '₹' + rupees_(sp.sgst));
  }

  var party = '<table style="width:100%;font-size:13px;margin:18px 0"><tr style="vertical-align:top">' +
    '<td style="width:50%;padding-right:12px">' +
      '<div style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:800">From</div>' +
      '<div style="font-weight:800;margin-top:4px">' + esc_(s.legalName) + '</div>' +
      (s.address ? '<div>' + esc_(s.address) + '</div>' : '') +
      (s.gstin ? '<div>GSTIN: <strong>' + esc_(s.gstin) + '</strong></div>' : '') +
      (s.pan ? '<div>PAN: ' + esc_(s.pan) + '</div>' : '') +
      (s.state ? '<div>State: ' + esc_(s.state) + (s.stateCode ? ' (' + esc_(s.stateCode) + ')' : '') + '</div>' : '') +
      '<div>' + esc_(s.email) + '</div></td>' +
    '<td style="width:50%">' +
      '<div style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:800">Billed to</div>' +
      '<div style="font-weight:800;margin-top:4px">' + esc_(inv.legalName) + '</div>' +
      (inv.address ? '<div>' + esc_(inv.address) + '</div>' : '') +
      (inv.buyerGstin ? '<div>GSTIN: <strong>' + esc_(inv.buyerGstin) + '</strong></div>' : '') +
      (inv.placeOfSupply ? '<div>Place of supply: ' + esc_(inv.placeOfSupply) +
        (inv.stateCode ? ' (' + esc_(inv.stateCode) + ')' : '') + '</div>' : '') +
    '</td></tr></table>';

  return mailShell_(title + ' ' + inv.number,
    '<p>Thank you — your payment has been received. This is your ' +
      (s.registered ? 'GST invoice' : 'invoice') + ', and it is also saved against your account.</p>' +
    party +
    '<table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #eee;border-radius:8px">' +
      '<tr><td style="padding:7px 12px;color:#6b7280;border-bottom:1px solid #eee">Invoice number</td>' +
        '<td style="padding:7px 12px;text-align:right;border-bottom:1px solid #eee;font-weight:800">' + esc_(inv.number) + '</td></tr>' +
      invRow_('Invoice date', inv.date) +
      invRow_('Description', 'Dome Box — ' + inv.plan + ' subscription') +
      invRow_('SAC', s.sac) +
      invRow_('Subscription period', inv.period) +
      invRow_(s.registered ? 'Taxable value' : 'Amount', '₹' + rupees_(sp.taxable)) +
      taxLines +
      invRow_('Total paid', '₹' + rupees_(sp.gross), true) +
      invRow_('Amount in words', inv.words) +
      invRow_('Payment reference', inv.paymentId) +
    '</table>' +
    (s.registered ? '' :
      '<p style="font-size:12px;color:#6b7280">' + esc_(s.legalName) +
      ' is not registered under GST, so no tax has been charged and none may be claimed on this invoice.</p>') +
    '<p style="font-size:12px;color:#6b7280">Computer generated — valid without a signature. ' +
      'Something wrong on it? Reply to this email and we will reissue it.</p>');
}

/** Every invoice this company has been issued, newest first. Admin only: it
 *  is the company's financial history, not team information. */
function getInvoices_(ctx) {
  requireAdmin_(ctx);
  var out = [];
  try {
    var d = invoiceSheet_().getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][3]).trim() !== String(ctx.sheetId).trim()) continue;
      if (String(d[i][19]).indexOf('Superseded') === 0) continue;
      out.push({ number: d[i][0], date: ymd(new Date(d[i][1])), plan: d[i][9], period: d[i][10],
                 taxable: Number(d[i][13]) || 0, rate: Number(d[i][14]) || 0,
                 cgst: Number(d[i][15]) || 0, sgst: Number(d[i][16]) || 0,
                 igst: Number(d[i][17]) || 0, total: Number(d[i][18]) || 0,
                 gstin: d[i][6] || '', sentTo: d[i][20] || '' });
    }
  } catch (e) { logError_('getInvoices', e.message); }
  out.reverse();
  return { status: 'success', invoices: out, seller: {
    legalName: sellerIdentity_().legalName, gstin: sellerIdentity_().gstin } };
}

/* ---------- operator tools ---------------------------------------------- */

/**
 * Reissue an invoice after the customer's billing details are corrected.
 * The original row is kept and marked, because an issued invoice is not
 * something you edit — you supersede it and both stay in the series.
 */
function reissueInvoice(number) {
  return withLock_(function () {
    var sh = invoiceSheet_(), d = sh.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][0]).trim() !== String(number).trim()) continue;
      var sheetId = String(d[i][3]).trim(), paymentId = String(d[i][11]).trim();
      sh.getRange(i + 1, 20).setValue('Superseded');
      sh.getRange(i + 1, 12).setValue(paymentId + ' (superseded)');   // frees the idempotency key
      var reg = registryRow_(sheetId) || {};
      var inv = issueInvoice_locked_(sheetId, d[i][9], { id: paymentId,
        amount: Math.round(Number(d[i][18]) * 100) }, d[i][4], reg.validUntil || '');
      Logger.log(inv ? 'Reissued ' + number + ' as ' + inv.number : 'Could not reissue ' + number);
      return inv;
    }
    Logger.log('No invoice numbered ' + number);
    return null;
  });
}

/**
 * Reissues every invoice that was flagged for review and can now be fixed.
 *
 * The only reason an invoice is flagged is an unknown place of supply — the
 * customer paid before giving a state or GSTIN. Once they have, this
 * supersedes each such invoice with one taxed correctly. No arguments, so it
 * can be run from the editor's Run button: the alert used to say "run
 * reissueInvoice("BISCS/26-27/0007")", which nobody can do from that button.
 *
 * Invoices whose customer still has no state on file are left alone and
 * listed, since reissuing them would only produce a second wrong one.
 */
function reissueFlaggedInvoices() {
  var out = ['', '=== REISSUE FLAGGED INVOICES ===', ''];
  var d = invoiceSheet_().getDataRange().getValues(), todo = [], waiting = [];
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][19]).indexOf('Review') !== 0) continue;
    var bill = billingFor_(String(d[i][3]).trim());
    if (bill && bill.stateCode) todo.push(String(d[i][0])); else waiting.push(String(d[i][0]) + ' (' + d[i][5] + ')');
  }
  todo.forEach(function (n) {
    var inv = reissueInvoice(n);
    out.push(inv ? '  reissued ' + n + ' as ' + inv.number : '  could not reissue ' + n);
  });
  if (!todo.length) out.push('  Nothing ready to reissue.');
  if (waiting.length) {
    out.push('');
    out.push('Still waiting on the customer for a state or GSTIN:');
    waiting.forEach(function (w) { out.push('  ' + w); });
  }
  Logger.log(out.join('\n'));
  return out.join('\n');
}

/** Print what the next invoice would look like, without sending anything. */
function previewInvoice() {
  var s = sellerIdentity_();
  var out = ['', '=== INVOICE SETUP ===', ''];
  out.push('  Seller      ' + s.legalName);
  out.push('  Address     ' + (s.address || 'MISSING — required on every invoice'));
  out.push('  GSTIN       ' + (s.gstin || 'not set — issuing non-GST invoices, charging no tax'));
  out.push('  State       ' + (s.state || 'MISSING') + (s.stateCode ? ' (' + s.stateCode + ')' : ''));
  out.push('  SAC         ' + s.sac);
  out.push('  Tax rate    ' + s.rate + '%');
  out.push('  Next number ' + nextInvoiceNo_(financialYear_(new Date())));
  if (s.registered && !s.stateCode) out.push('  WARNING no seller state code — every invoice will be CGST+SGST.');
  if (!s.address) out.push('  WARNING an invoice without the supplier address is not a valid one.');
  Logger.log(out.join('\n'));
}
