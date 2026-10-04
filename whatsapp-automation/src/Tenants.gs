/**
 * Tenants.gs
 * Multi-tenant controls. Each row in CLIENTS is a tenant (a business you sell the service to).
 *
 * Per-tenant columns in CLIENTS (all optional; edited by the administrator):
 *   Status            Active | Suspended   (Suspended blocks dashboard login and all sending)
 *   Plan              free text shown to the client, e.g. "Starter", "Pro"
 *   Maytapi Phone ID  the tenant's own WhatsApp number inside your Maytapi product.
 *                     Blank = the platform's shared number (Script Property MAYTAPI_PHONE_ID).
 *                     This is always admin-controlled; a client's Store Phone never changes it.
 *   Monthly Quota     max campaign messages per calendar month. Blank = unlimited.
 *   Valid Until       last day of the subscription (yyyy-MM-dd). Blank = no expiry.
 *
 * Isolation guarantees (enforced elsewhere, relied on here): campaigns only queue contacts
 * with the same Client ID; dashboard sessions only read/write their own Client ID; webhook
 * events arriving on a tenant's dedicated number are scoped to that tenant.
 */

function clientsById_() {
  const map = {};
  readTable_(SHEETS.CLIENTS).rows.forEach(r => { map[String(r['Client ID'])] = r; });
  return map;
}

/** The Maytapi phone ID this tenant sends from. */
function tenantPhoneId_(client, cfg) {
  cfg = cfg || getConfig_();
  const own = client ? String(client['Maytapi Phone ID'] || '').trim() : '';
  return own || cfg.phoneId;
}

/** Copy of the config whose phoneId is the tenant's sending number. */
function cfgForClient_(client, cfg) {
  cfg = cfg || getConfig_();
  return Object.assign({}, cfg, { phoneId: tenantPhoneId_(client, cfg) });
}

/** Clients that own `phoneId` as a dedicated number (empty for the shared platform number). */
function tenantsForPhoneId_(phoneId, cfg) {
  cfg = cfg || getConfig_();
  const id = String(phoneId || '').trim();
  if (!id || id === String(cfg.phoneId)) return [];
  return readTable_(SHEETS.CLIENTS).rows.filter(r => String(r['Maytapi Phone ID'] || '').trim() === id);
}

/** Every phone ID this deployment sends from (platform + tenant numbers). */
function knownPhoneIds_(cfg) {
  cfg = cfg || getConfig_();
  const ids = {};
  if (cfg.phoneId) ids[String(cfg.phoneId)] = true;
  readTable_(SHEETS.CLIENTS).rows.forEach(r => {
    const id = String(r['Maytapi Phone ID'] || '').trim();
    if (id) ids[id] = true;
  });
  return Object.keys(ids);
}

function monthKey_(d) {
  return d instanceof Date && !isNaN(d) ? Utilities.formatDate(d, getConfig_().timezone, 'yyyy-MM') : '';
}

/** { clientId: messages sent this calendar month } from MESSAGE_QUEUE rows. */
function monthlySentByClient_(queueRows) {
  const month = monthKey_(new Date());
  const out = {};
  queueRows.forEach(q => {
    if (monthKey_(toDate_(q['Sent At'])) === month) out[q['Client ID']] = (out[q['Client ID']] || 0) + 1;
  });
  return out;
}

/**
 * Can this tenant send right now?
 * @return { ok, reason, plan, quota, used, remaining, validUntil, dedicatedNumber }
 */
function tenantEntitlement_(client, usedThisMonth) {
  const plan = String((client && client['Plan']) || '').trim();
  const quotaRaw = String((client && client['Monthly Quota']) || '').trim();
  const quota = quotaRaw === '' ? null : Math.max(0, Number(quotaRaw) || 0);
  const used = Number(usedThisMonth || 0);
  const validUntil = client ? cellDateStr_(client['Valid Until']) : '';
  const out = {
    ok: true, reason: '', plan: plan, quota: quota, used: used,
    remaining: quota === null ? null : Math.max(0, quota - used),
    validUntil: validUntil,
    dedicatedNumber: !!(client && String(client['Maytapi Phone ID'] || '').trim()),
  };
  if (!client) { out.ok = false; out.reason = 'Client record not found.'; }
  else if (!/^active$/i.test(String(client['Status'] || ''))) { out.ok = false; out.reason = 'Account is ' + (client['Status'] || 'inactive') + '.'; }
  else if (validUntil && validUntil < todayKey_()) { out.ok = false; out.reason = 'Subscription expired on ' + validUntil + '.'; }
  else if (quota !== null && used >= quota) { out.ok = false; out.reason = 'Monthly message quota (' + quota + ') reached.'; }
  return out;
}

/** Entitlement for one client ID, counting this month's usage from the queue. */
function tenantEntitlementById_(clientId) {
  const client = clientsById_()[clientId];
  const used = monthlySentByClient_(readTable_(SHEETS.MESSAGE_QUEUE).rows)[clientId] || 0;
  return tenantEntitlement_(client, used);
}
