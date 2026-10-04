/**
 * Messaging.gs
 * Turns a "message spec" into Maytapi calls. Shared by the queue processor,
 * test messages and automated replies, so all three behave identically.
 *
 * spec = {
 *   phone:       '919876543210',
 *   text:        'rendered message',
 *   imageFileId: 'Drive file id' (optional),
 *   imageUrl:    'https://…'     (optional, MEDIA_MODE=URL),
 *   cta:         { type: 'URL'|'PHONE'|'QUICK_REPLY', text: 'Explore Now', value: '…' } (optional)
 * }
 */

/** Validates a spec before any API call. Returns '' or an error string. */
function validateMessageSpec_(spec, cfg) {
  if (!spec.phone || !normalizePhoneNumber(spec.phone)) return 'Invalid recipient phone number.';
  const hasImage = !!(spec.imageFileId || spec.imageUrl);
  if (!String(spec.text || '').trim() && !hasImage) return 'Message is empty.';
  if (String(spec.text || '').length > 4096) return 'Message exceeds the 4096-character WhatsApp limit.';
  if (spec.cta) {
    const err = validateCta_(spec.cta, cfg);
    if (err) return err;
  }
  return '';
}

/** Validates an already-rendered CTA. */
function validateCta_(cta, cfg) {
  cfg = cfg || getConfig_();
  const type = String(cta.type || '').toUpperCase();
  if (CTA_TYPES.indexOf(type) < 0) return 'CTA type must be URL, PHONE or QUICK_REPLY.';
  if (!String(cta.text || '').trim()) return 'CTA button text is empty.';
  if (String(cta.text).length > cfg.ctaTextMaxLength) return 'CTA button text must be at most ' + cfg.ctaTextMaxLength + ' characters.';
  if (type === 'URL' && !normalizeUrl_(cta.value)) return 'CTA URL is not a valid web address.';
  if (type === 'PHONE' && !normalizePhoneNumber(cta.value)) return 'CTA phone number is invalid.';
  if (type === 'QUICK_REPLY' && !String(cta.value || '').trim()) return 'Quick reply value is empty.';
  return '';
}

/** Text form of a CTA, used for CAPTION_LINK style and the button fallback. */
function ctaAsText_(cta) {
  if (!cta) return '';
  const type = String(cta.type).toUpperCase();
  if (type === 'URL') return '👉 ' + cta.text + ': ' + normalizeUrl_(cta.value);
  if (type === 'PHONE') return '📞 ' + cta.text + ': +' + normalizePhoneNumber(cta.value);
  return '💬 ' + cta.text + ' — reply "' + cta.value + '"';
}

function withCtaText_(text, cta) {
  const line = ctaAsText_(cta);
  return line ? (String(text || '').trim() + '\n\n' + line).trim() : String(text || '');
}

/**
 * Sends a spec. Returns the Maytapi-style result plus:
 *   messageIds[]  all message IDs created (image + button message)
 *   partial       true if the image went out but the follow-up text did not (do NOT retry)
 *   fallbackUsed  true if buttons were replaced by a text CTA
 */
function sendCampaignMessage_(spec, cfg, mediaCache) {
  cfg = cfg || getConfig_();
  const invalid = validateMessageSpec_(spec, cfg);
  if (invalid) return Object.assign(failResult_(0, invalid), { messageIds: [] });

  const to = normalizePhoneNumber(spec.phone);
  const text = String(spec.text || '');
  const cta = spec.cta && spec.cta.type ? {
    type: String(spec.cta.type).toUpperCase(),
    text: String(spec.cta.text).trim(),
    value: String(spec.cta.type).toUpperCase() === 'URL' ? normalizeUrl_(spec.cta.value) : String(spec.cta.value).trim(),
  } : null;

  let media = null;
  if (spec.imageFileId || spec.imageUrl) {
    media = resolveMedia_(spec, cfg, mediaCache);
    if (!media.ok) return Object.assign(failResult_(0, media.error), { messageIds: [] });
  }

  // 1) No CTA: one message.
  if (!cta) {
    const r = media ? sendMaytapiMedia_(to, media.media, captionSafe_(text), media.filename, cfg) : sendMaytapiText_(to, text, cfg);
    return finalize_(r, [r]);
  }

  const singleCaption = () => {
    const body = withCtaText_(text, cta);
    const r = media ? sendMaytapiMedia_(to, media.media, captionSafe_(body), media.filename, cfg) : sendMaytapiText_(to, body, cfg);
    return r;
  };

  // 2) CAPTION_LINK (default): ONE message — image + text + CTA link line. Always supported.
  if (cfg.imageCtaStyle === 'CAPTION_LINK' || (cfg.imageCtaStyle === 'BUTTONS_WITH_IMAGE' && media && !cfg.buttonImageField)) {
    const r = singleCaption();
    return finalize_(r, [r]);
  }

  // 3) BUTTONS_WITH_IMAGE: ONE message — image header + text + real button.
  //    If Maytapi rejects the payload, fall back to CAPTION_LINK so it is still one message.
  if (cfg.imageCtaStyle === 'BUTTONS_WITH_IMAGE') {
    const rb = sendMaytapiButtons_(to, text, [cta], cfg, media ? { field: cfg.buttonImageField, media: media.media } : null);
    if (rb.success || rb.retryable || rb.authError || !cfg.ctaFallbackToText) return finalize_(rb, [rb]);
    logEvent_(LOG_LEVEL.WARNING, 'BUTTON_FALLBACK', { phone: to, httpStatus: rb.httpStatus, error: rb.error, details: 'Image+button message rejected; sending one image message with the CTA as a link.' });
    const rc = singleCaption();
    const out = finalize_(rc, [rb, rc]);
    out.fallbackUsed = true;
    return out;
  }

  // 4) IMAGE_THEN_BUTTONS: image first (no caption), then the message with an interactive button.
  const results = [];
  if (media) {
    const r1 = sendMaytapiMedia_(to, media.media, '', media.filename, cfg);
    results.push(r1);
    if (!r1.success) return finalize_(r1, results);
  }
  const r2 = sendMaytapiButtons_(to, text, [cta], cfg);
  results.push(r2);
  if (r2.success) return finalize_(r2, results);

  // Button payload rejected (non-transient) => text fallback so the customer still gets the CTA.
  if (cfg.ctaFallbackToText && !r2.retryable && !r2.authError) {
    logEvent_(LOG_LEVEL.WARNING, 'BUTTON_FALLBACK', { phone: to, httpStatus: r2.httpStatus, error: r2.error, details: 'Buttons rejected; sending CTA as text.' });
    const r3 = sendMaytapiText_(to, withCtaText_(text, cta), cfg);
    results.push(r3);
    const out = finalize_(r3, results);
    out.fallbackUsed = true;
    if (!r3.success && media) out.partial = true;
    return out;
  }
  const out = finalize_(r2, results);
  if (media) out.partial = true; // image already delivered — retrying would duplicate it
  return out;
}

function captionSafe_(text) {
  // WhatsApp captions are limited to 1024 characters.
  return truncate_(text, 1024);
}

function finalize_(last, results) {
  const out = Object.assign({}, last);
  out.messageIds = results.filter(r => r.success && r.messageId).map(r => r.messageId);
  out.messageId = out.messageIds.join(',');
  out.partial = false;
  out.fallbackUsed = false;
  return out;
}

/** Builds the spec for a CAMPAIGNS row + contact (used by tests; the queue stores pre-rendered values). */
function buildSpecForContact_(campaign, contact, phone) {
  const ctaType = String(campaign['CTA Type'] || '').toUpperCase();
  return {
    phone: phone,
    text: renderTemplate(campaign['Message'], contact, campaign),
    imageFileId: campaign['Image File ID'],
    imageUrl: campaign['Image URL'],
    cta: CTA_TYPES.indexOf(ctaType) >= 0 ? {
      type: ctaType,
      text: renderTemplate(campaign['CTA Text'], contact, campaign),
      value: renderTemplate(campaign['CTA Value'], contact, campaign),
    } : null,
  };
}
