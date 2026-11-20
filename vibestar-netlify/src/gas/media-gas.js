/* eslint-disable no-undef */
/**
 * MEDIA ON APPS SCRIPT — Google Drive.
 *
 * PUBLIC uploads are shared with anyone-who-has-the-link, so <img> and <video>
 * can hotlink them and a crawler can fetch them for a preview card.
 *
 * PRIVATE uploads are NOT shared. That is the important part. Apps Script cannot
 * serve binary — ContentService returns text, JSON or XML and nothing else — so
 * the trick the Netlify build uses (a signed URL to a function that streams the
 * bytes) has no equivalent here. A shared Drive link would be readable by
 * anybody who obtained it, which would make the subscription paywall
 * decoration.
 *
 * So subscriber-only files are delivered as a base64 data URI inside the
 * authenticated API response. The entitlement check happens where it always
 * does, in the route, and the bytes never have a URL at all. The cost is real:
 * a data URI cannot be cached by the browser and inflates the payload by a
 * third, so private galleries are slower here than on Netlify. That is the
 * honest trade for keeping the paywall intact on this platform.
 */

const FOLDER_PROPERTY = 'VIBESTAR_DRIVE_FOLDER';

function mediaFolder() {
  const properties = PropertiesService.getScriptProperties();
  const saved = properties.getProperty(FOLDER_PROPERTY);

  if (saved) {
    try { return DriveApp.getFolderById(saved); } catch (err) { /* recreate below */ }
  }

  const existing = DriveApp.getFoldersByName('VibeStar Media');
  const folder = existing.hasNext() ? existing.next() : DriveApp.createFolder('VibeStar Media');
  properties.setProperty(FOLDER_PROPERTY, folder.getId());
  return folder;
}

/** Uploads bytes and returns { url, fileId }. */
export function driveUpload(bytes, mimeType, filename, isPrivate) {
  const blob = Utilities.newBlob(bytes, mimeType, filename);
  const file = mediaFolder().createFile(blob);

  if (isPrivate) {
    // Left unshared on purpose. Reachable only by this script, which is what
    // lets the route decide who sees it.
    return { url: `vibestar-drive://${file.getId()}`, fileId: file.getId() };
  }

  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { url: `https://drive.google.com/uc?export=view&id=${file.getId()}`, fileId: file.getId() };
}

export function driveDelete(url) {
  const id = fileIdFromUrl(url);
  if (!id) return false;
  try { DriveApp.getFileById(id).setTrashed(true); return true; } catch (err) { return false; }
}

export function fileIdFromUrl(url) {
  const text = String(url || '');
  const scheme = /^vibestar-drive:\/\/(.+)$/.exec(text);
  if (scheme) return scheme[1];
  const query = /[?&]id=([^&]+)/.exec(text);
  return query ? query[1] : '';
}

/**
 * A subscriber-only file as a data URI. Only ever called for a viewer the route
 * has already established is entitled.
 */
export function driveDataUri(url) {
  const id = fileIdFromUrl(url);
  if (!id) return '';

  try {
    const file = DriveApp.getFileById(id);
    const blob = file.getBlob();
    return `data:${blob.getContentType()};base64,${Utilities.base64Encode(blob.getBytes())}`;
  } catch (err) {
    return '';
  }
}
