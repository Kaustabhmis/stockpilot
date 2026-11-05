/* ---------------------------------------------------------------------------
   BILLING DETAILS AND INVOICES

   The invoice is written the moment the payment lands, from whatever is on
   file at that instant. So the details are asked for BEFORE the card, not
   after: a customer who pays first and gives their GSTIN second has an invoice
   they cannot claim credit on, and fixing it means superseding a document in a
   numbered series. One short form at the right moment avoids all of that.
--------------------------------------------------------------------------- */

var BILLING_CACHE = null;

function billingField(id, label, value, placeholder, hint) {
  return '<div><label class="lb" for="' + id + '">' + esc(label) + '</label>' +
    '<input id="' + id + '" class="in" value="' + esc(value || '') + '" placeholder="' +
    esc(placeholder || '') + '">' +
    (hint ? '<div class="text-[11px] font-semibold text-gray-400 mt-1">' + esc(hint) + '</div>' : '') +
    '</div>';
}

/**
 * @param after  called once details are saved. Passed so the form can sit in
 *               front of the checkout without the checkout knowing about it.
 */
function openBillingDetails(after) {
  api('getBilling', {}).then(function (r) {
    BILLING_CACHE = r.billing;
    var b = r.billing;
    openModal('<div class="p-6 lg:p-7">' +
      '<div class="flex justify-between items-start mb-1">' +
      '<h2 class="text-2xl font-black">Invoice details</h2>' +
      '<button onclick="closeModal()" class="text-gray-400"><span class="material-icons">close</span></button></div>' +
      '<p class="text-sm text-gray-400 font-semibold mb-5">This is what we print on your invoice. ' +
        (after ? 'We ask now rather than after you pay, so the invoice is right the first time.'
               : 'Changes apply to invoices issued from now on.') + '</p>' +
      '<div class="grid gap-4">' +
        billingField('bLegal', 'Registered name', b.legalName, 'Acme Engineering Pvt Ltd',
                     'The name on your GST registration, not the trading name') +
        billingField('bGstin', 'GSTIN', b.gstin, '19AABCB1234C1ZQ',
                     'Leave blank if you are not registered — no credit can be claimed without it') +
        billingField('bAddr', 'Address', b.address, '7 Camac Street') +
        '<div class="grid grid-cols-2 gap-4">' +
          billingField('bCity', 'City', b.city, 'Kolkata') +
          billingField('bPin', 'PIN', b.pin, '700017') + '</div>' +
        '<div><label class="lb" for="bState">State</label>' +
          '<select id="bState" class="in"><option value="">Select…</option>' +
          (r.states || []).map(function (s) {
            return '<option' + (s === b.state ? ' selected' : '') + '>' + esc(s) + '</option>';
          }).join('') + '</select>' +
          '<div class="text-[11px] font-semibold text-gray-400 mt-1">Decides whether your invoice ' +
          'carries CGST+SGST or IGST. Taken from the GSTIN when you give one.</div></div>' +
        billingField('bEmail', 'Send invoices to', b.email, 'accounts@acme.in') +
      '</div>' +
      '<div class="flex gap-2 mt-6">' +
        '<button class="btn btn-p flex-1" id="bSave">' +
          (after ? 'Save and continue to payment' : 'Save') + '</button>' +
        '<button class="btn btn-g" onclick="closeModal()">Cancel</button></div>' +
      '</div>', 'max-w-lg');

    $('bSave').addEventListener('click', function () {
      var btn = this;
      busy(btn, true, 'Saving…');
      api('saveBilling', { form: {
        legalName: $('bLegal').value, gstin: $('bGstin').value.trim().toUpperCase(),
        address: $('bAddr').value, city: $('bCity').value, pin: $('bPin').value,
        state: $('bState').value, email: $('bEmail').value } })
        .then(function (res) {
          BILLING_CACHE = null;
          toast(res.message, 'ok');
          if (after) after(); else closeModal();
        })
        .catch(function (e) { busy(btn, false); toast(e.message, 'err'); });
    });
  }).catch(function (e) { toast(e.message, 'err'); });
}

function openInvoices() {
  api('getInvoices', {}).then(function (r) {
    var rows = r.invoices || [];
    openModal('<div class="p-6 lg:p-7">' +
      '<div class="flex justify-between items-start mb-1">' +
      '<h2 class="text-2xl font-black">Invoices</h2>' +
      '<button onclick="closeModal()" class="text-gray-400"><span class="material-icons">close</span></button></div>' +
      '<p class="text-sm text-gray-400 font-semibold mb-5">Every invoice was emailed when the payment ' +
        'went through. Need another copy? ' +
        '<button class="text-blue-600 font-black" onclick="openSupport(\'Invoice copy\')">ask us</button>.</p>' +
      (rows.length ? '<div class="overflow-x-auto"><table class="w-full text-sm">' +
        '<thead><tr class="text-[11px] font-black uppercase tracking-widest text-gray-400 text-left">' +
          '<th class="py-2">Number</th><th>Date</th><th>Plan</th>' +
          '<th class="text-right">Taxable</th><th class="text-right">Tax</th>' +
          '<th class="text-right">Total</th></tr></thead><tbody>' +
        rows.map(function (i) {
          var tax = (i.cgst || 0) + (i.sgst || 0) + (i.igst || 0);
          return '<tr class="border-t border-gray-100">' +
            '<td class="py-2.5 font-black">' + esc(i.number) + '</td>' +
            '<td class="font-semibold text-gray-500">' + esc(i.date) + '</td>' +
            '<td class="font-semibold text-gray-500">' + esc(i.plan) + '</td>' +
            '<td class="text-right font-semibold">' + inr(i.taxable) + '</td>' +
            '<td class="text-right font-semibold text-gray-500">' +
              (tax ? inr(tax) + ' <span class="text-[10px]">' + (i.igst ? 'IGST' : 'CGST+SGST') + '</span>'
                   : '<span class="text-[10px]">none</span>') + '</td>' +
            '<td class="text-right font-black">' + inr(i.total) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<p class="text-sm font-semibold text-gray-400 py-8 text-center">' +
          'No invoices yet — they appear here the moment a payment goes through.</p>') +
      '<div class="flex gap-2 mt-6">' +
        '<button class="btn btn-g" onclick="openBillingDetails()">Edit invoice details</button>' +
        '<button class="btn btn-g" onclick="openBilling()">Back to plans</button></div>' +
      '</div>', 'max-w-2xl');
  }).catch(function (e) { toast(e.message, 'err'); });
}
