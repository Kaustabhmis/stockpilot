/**
 * Media.gs
 * Campaign image handling, isolated behind two functions:
 *
 *   processCampaignImage_(fileRef)  -> validates the Form upload, returns { fileId, ... }
 *   resolveMedia_(spec, cfg, cache) -> returns the value Maytapi's media "message" field receives
 *
 * MEDIA MODES (SETTINGS → MEDIA_MODE)
 *   BASE64 (default) — The Drive file's bytes are read by Apps Script and sent inline as a
 *                      data URI (data:image/jpeg;base64,...). Maytapi's media message accepts
 *                      either a public URL or base64 content, so the client's Drive file
 *                      never has to be made public. No extra hosting is required.
 *   URL              — Maytapi downloads the image from a public HTTPS URL. The URL is taken
 *                      from the campaign's "Image URL" column (admin can paste a CDN/S3/
 *                      Cloudinary/website link) or built as MEDIA_BASE_URL + "/" + file name.
 *
 * We deliberately do NOT build Google Drive "sharing"/"uc?export" links: they are not a
 * documented media host, can return HTML interstitials instead of image bytes, and would
 * require making the client's file public. To add another host later (S3, Cloudinary,
 * Firebase Storage…), add a branch in resolveMedia_ — nothing else in the system changes.
 */

/**
 * Validates the File Upload answer of the Google Form.
 * @param fileRef Drive URL(s) as stored in the response sheet, a bare file ID, or an
 *                array of IDs (FormResponse.getResponse() for file-upload items).
 * @return { ok, fileId, fileName, mimeType, sizeBytes, error }
 */
function processCampaignImage_(fileRef) {
  const cfg = getConfig_();
  const fileId = extractDriveFileId_(fileRef);
  if (!fileId) return { ok: false, error: 'No campaign image was uploaded or the file reference could not be read.' };

  let file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (err) {
    return { ok: false, fileId: fileId, error: 'The uploaded image could not be opened in Google Drive (deleted or no permission).' };
  }
  try {
    if (file.isTrashed()) return { ok: false, fileId: fileId, error: 'The uploaded image is in the Drive trash.' };
    const mimeType = file.getMimeType();
    const sizeBytes = file.getSize();
    if (String(mimeType).indexOf('image/') !== 0) {
      return { ok: false, fileId: fileId, error: 'The uploaded file is not an image (type: ' + mimeType + ').' };
    }
    if (SUPPORTED_IMAGE_MIME.indexOf(mimeType) < 0) {
      return { ok: false, fileId: fileId, error: 'Unsupported image format (' + mimeType + '). Please upload a JPG or PNG.' };
    }
    if (sizeBytes > cfg.maxImageMb * 1024 * 1024) {
      return { ok: false, fileId: fileId, error: 'Image is ' + (sizeBytes / 1048576).toFixed(1) + ' MB; the maximum is ' + cfg.maxImageMb + ' MB.' };
    }
    return { ok: true, fileId: fileId, fileName: file.getName(), mimeType: mimeType, sizeBytes: sizeBytes, error: '' };
  } catch (err) {
    return { ok: false, fileId: fileId, error: 'Google Drive error while reading the image: ' + err.message };
  }
}

/** Extracts the first Drive file ID from a URL, comma-separated list, array or bare ID. */
function extractDriveFileId_(ref) {
  if (!ref) return '';
  if (Array.isArray(ref)) ref = ref[0];
  const s = String(ref).split(',')[0].trim();
  if (!s) return '';
  let m = s.match(/[?&]id=([-\w]{20,})/);
  if (m) return m[1];
  m = s.match(/\/d\/([-\w]{20,})/);
  if (m) return m[1];
  if (/^[-\w]{20,}$/.test(s)) return s;
  return '';
}

/**
 * Returns { ok, media, filename, error } for a message spec { imageFileId, imageUrl }.
 * `cache` (optional object) memoises base64 per file within one execution.
 */
function resolveMedia_(spec, cfg, cache) {
  cfg = cfg || getConfig_();
  cache = cache || {};
  const fileId = String(spec.imageFileId || '').trim();
  const explicitUrl = String(spec.imageUrl || '').trim();

  if (cfg.mediaMode === 'URL' || (!fileId && explicitUrl)) {
    let url = explicitUrl;
    if (!url && fileId && cfg.mediaBaseUrl) {
      try { url = cfg.mediaBaseUrl + '/' + encodeURIComponent(DriveApp.getFileById(fileId).getName()); } catch (err) { url = ''; }
    }
    if (!/^https:\/\//i.test(url)) {
      return { ok: false, error: 'MEDIA_MODE=URL requires a public HTTPS Image URL (campaign "Image URL" column or MEDIA_BASE_URL).' };
    }
    return { ok: true, media: url, filename: url.split('/').pop().split('?')[0] || 'image' };
  }

  if (!fileId) return { ok: false, error: 'Campaign has no image.' };
  if (cache[fileId]) return cache[fileId];
  try {
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    const mime = blob.getContentType();
    if (SUPPORTED_IMAGE_MIME.indexOf(mime) < 0) return { ok: false, error: 'Unsupported image type ' + mime };
    const result = {
      ok: true,
      media: 'data:' + mime + ';base64,' + Utilities.base64Encode(blob.getBytes()),
      filename: file.getName(),
    };
    cache[fileId] = result;
    return result;
  } catch (err) {
    return { ok: false, error: 'Could not read campaign image from Drive: ' + err.message };
  }
}
