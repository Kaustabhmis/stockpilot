/**
 * Public.gs
 * Admin-only public entry points with the names used in the specification.
 *
 * The real implementations end in "_" (private), so google.script.run calls from the
 * client dashboard cannot reach them. These wrappers let the administrator run them from
 * the script editor or menu, and refuse anyone else (see requireAdmin_ in Security.gs).
 * Internal code always calls the "_" versions.
 */

/** Returns the configuration with secrets masked. */
function getConfig(forceReload) {
  requireAdmin_();
  const cfg = Object.assign({}, getConfig_(forceReload));
  cfg.apiToken = cfg.apiToken ? '***' : '';
  cfg.webhookSecret = cfg.webhookSecret ? '***' : '';
  return cfg;
}

function validateConfig() { requireAdmin_(); return validateConfig_(); }

function maytapiRequest(method, path, payload) { requireAdmin_(); return maytapiRequest_(method, path, payload); }
function sendMaytapiText(toNumber, text) { requireAdmin_(); return sendMaytapiText_(toNumber, text); }
function sendMaytapiMedia(toNumber, media, caption, filename) { requireAdmin_(); return sendMaytapiMedia_(toNumber, media, caption, filename); }
function sendMaytapiButtons(toNumber, body, buttons) { requireAdmin_(); return sendMaytapiButtons_(toNumber, body, buttons); }
function sendMaytapiList() { requireAdmin_(); return sendMaytapiList_(); }
function sendMaytapiCarousel() { requireAdmin_(); return sendMaytapiCarousel_(); }
function maytapiListPhones() { requireAdmin_(); return maytapiListPhones_(); }
function maytapiPhoneStatus() { requireAdmin_(); return maytapiPhoneStatus_(); }
function maytapiSetWebhook(webhookUrl) { requireAdmin_(); return maytapiSetWebhook_(webhookUrl); }

function processCampaignImage(fileRef) { requireAdmin_(); return processCampaignImage_(fileRef); }
function buildCampaignQueue(campaignId) { requireAdmin_(); return buildCampaignQueue_(campaignId); }
function startCampaign(campaignId) { requireAdmin_(); return startCampaign_(campaignId); }
function pauseCampaign(campaignId) { requireAdmin_(); return pauseCampaign_(campaignId); }
function resumeCampaign(campaignId) { requireAdmin_(); return resumeCampaign_(campaignId); }
function cancelCampaign(campaignId) { requireAdmin_(); return cancelCampaign_(campaignId); }
function activateScheduledCampaigns() { requireAdmin_(); return activateScheduledCampaigns_(); }
function processMessageQueue() { requireAdmin_(); return processMessageQueue_(); }
function retryFailedMessages(campaignId) { requireAdmin_(); return retryFailedMessages_(campaignId); }

/** Returns the webhook URL including its secret key — admin only. */
function getWebhookUrl() { requireAdmin_(); return getWebhookUrl_(); }
