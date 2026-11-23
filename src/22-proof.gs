// ===========================================================================
// PHOTO PROOF — an optional photo when work is handed in for review
// ===========================================================================
//
// The doer may attach one photo when they submit a task for review: the
// cleaned machine, the packed despatch, the signed delivery challan. The
// checker sees it in the task's history before verifying.
//
// Where it lives: a Google Drive folder per company, made the first time a
// photo is saved. A real photo is far too big for a sheet cell, and keeping it
// in Drive leaves the Tasks tab exactly as it was. The task's history entry
// carries only the file's id.
//
// Who can see it: only someone who can see the task, in that company — the
// same rule as the board. A file id from another task or another company is
// refused, so ids cannot be guessed across workspaces.
//
// The browser shrinks the photo before it is sent (longest side 1280 px,
// JPEG), so a 5 MB phone picture arrives as 100–250 KB.

var PROOF_PHOTO_MAX = 700000;   // characters of data: URI, about 500 KB of JPEG
var PROOF_PHOTO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+\/]+={0,2}$/;

/** The company's photo folder in Drive, made on first use. */
function proofFolder_(ctx) {
  var key = 'PROOF_FOLDER_' + ctx.sheetId;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(key);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var folder = DriveApp.createFolder('Domebox photos — ' + String(ctx.company || 'company') + ' (' + ctx.sheetId + ')');
  props.setProperty(key, folder.getId());
  return folder;
}

/** Checks and stores a hand-in photo; returns the Drive file id. */
function saveProofPhoto_(ctx, taskId, photo) {
  var uri = String(photo || '');
  if (uri.length > PROOF_PHOTO_MAX) throw new Error('That photo is too large. Try again — it is made smaller automatically.');
  if (!PROOF_PHOTO_RE.test(uri)) throw new Error('That photo could not be read. Try a JPEG or PNG picture.');
  var bytes = Utilities.base64Decode(uri.slice(uri.indexOf(',') + 1));
  var name = 'task-' + String(taskId).replace(/[^\w-]/g, '') + '-' + Date.now() + '.jpg';
  var file = proofFolder_(ctx).createFile(Utilities.newBlob(bytes, 'image/jpeg', name));
  return file.getId();
}

/** A hand-in photo, for someone who can see that task. */
function getProofPhoto_(ctx, taskId, fileId) {
  var hit = findTaskRow_(ctx, taskId);
  if (!hit || !visibleTasks_(ctx, [hit.task]).length) throw new Error('That photo is not available.');
  var ok = (hit.task.history || []).some(function (h) { return h && h.proof && String(h.proof) === String(fileId); });
  if (!ok) throw new Error('That photo is not available.');
  var blob;
  try { blob = DriveApp.getFileById(String(fileId)).getBlob(); }
  catch (e) { throw new Error('That photo has been removed from Drive.'); }
  return { status: 'success', photo: 'data:image/jpeg;base64,' + Utilities.base64Encode(blob.getBytes()) };
}

/** On erasing a company: its photos go to the Drive bin with the rest. */
function trashProofFolder_(sheetId) {
  var props = PropertiesService.getScriptProperties(), key = 'PROOF_FOLDER_' + sheetId;
  var id = props.getProperty(key);
  if (!id) return false;
  try { DriveApp.getFolderById(id).setTrashed(true); } catch (e) {}
  props.deleteProperty(key);
  return true;
}
