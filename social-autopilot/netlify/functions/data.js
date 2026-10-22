/**
 * REST-style CRUD over the Sheet tabs:
 *   GET    /api/data/:tab              list (filter with ?column=value)
 *   GET    /api/data/:tab/:id          one row
 *   POST   /api/data/:tab              create
 *   PUT    /api/data/:tab/:id          partial update
 *   DELETE /api/data/:tab/:id          delete (Posts also delete their Targets)
 *
 * Accounts cannot be created or deleted here: connect them through OAuth. Disconnecting
 * (PUT { active: false }) clears the stored token.
 * Secrets (access_token_enc) are never returned to the browser.
 */
import crypto from 'node:crypto';
import { SHEET_SCHEMA } from './lib/config.js';
import { createSheet, toRecord } from './lib/sheets.js';
import { cleanFields } from './lib/validate.js';
import { errorResponse, HttpError, json, readJson, withErrors } from './lib/http.js';
import { requireAuth } from './lib/session.js';

export const config = { path: ['/api/data/:tab', '/api/data/:tab/:id'] };

/** Default values for new rows, per tab. */
const DEFAULTS = {
  Posts: { status: 'draft', media_type: 'none', media_urls: [], auto_approve: false },
  Targets: { status: 'draft', attempts: 0 },
};

/**
 * @param {Record<string, any>} record
 * @returns {Record<string, any>} the record without the encrypted token
 */
function withoutSecrets(record) {
  const copy = { ...record };
  delete copy.access_token_enc;
  return copy;
}

export default withErrors(async (req, context) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { tab, id } = context.params;
  if (!Object.hasOwn(SHEET_SCHEMA, tab)) throw new HttpError(404, `Unknown table "${tab}"`);

  const sheet = createSheet();
  switch (req.method) {
    case 'GET':
      return read(sheet, tab, id, new URL(req.url).searchParams);
    case 'POST':
      return create(sheet, tab, req);
    case 'PUT':
      return update(sheet, tab, id, req);
    case 'DELETE':
      return remove(sheet, tab, id);
    default:
      return errorResponse(405, 'Method not allowed');
  }
});

/**
 * @param {ReturnType<typeof createSheet>} sheet
 * @param {string} tab
 * @param {string | undefined} id
 * @param {URLSearchParams} query
 */
async function read(sheet, tab, id, query) {
  if (id) {
    const row = await sheet.findById(tab, id);
    if (!row) throw new HttpError(404, 'Not found');
    return json(withoutSecrets(toRecord(row)));
  }
  let rows = await sheet.getRows(tab);
  for (const [column, value] of query) {
    if (SHEET_SCHEMA[tab].includes(column)) rows = rows.filter((row) => row[column] === value);
  }
  return json(rows.map((row) => withoutSecrets(toRecord(row))));
}

/**
 * @param {ReturnType<typeof createSheet>} sheet
 * @param {string} tab
 * @param {Request} req
 */
async function create(sheet, tab, req) {
  if (tab === 'Accounts') throw new HttpError(403, 'Accounts are added by connecting an account');
  const now = new Date().toISOString();
  const record = { ...DEFAULTS[tab], ...cleanFields(tab, await readJson(req)) };
  if (SHEET_SCHEMA[tab].includes('id')) record.id = crypto.randomUUID();
  if (tab === 'Posts') {
    record.created_at = now;
    record.updated_at = now;
  }
  await sheet.appendRow(tab, record);
  return json(withoutSecrets(record), 201);
}

/**
 * @param {ReturnType<typeof createSheet>} sheet
 * @param {string} tab
 * @param {string | undefined} id
 * @param {Request} req
 */
async function update(sheet, tab, id, req) {
  if (!id) throw new HttpError(400, 'An id is required');
  const body = await readJson(req);
  if (tab === 'Accounts') {
    if (body.active !== false) throw new HttpError(400, 'Accounts can only be disconnected with { "active": false }');
    return saveRow(sheet, tab, id, { active: false, access_token_enc: '' });
  }
  const patch = cleanFields(tab, body);
  if (tab === 'Posts') patch.updated_at = new Date().toISOString();
  return saveRow(sheet, tab, id, patch);
}

/**
 * @param {ReturnType<typeof createSheet>} sheet
 * @param {string} tab
 * @param {string} id
 * @param {Record<string, unknown>} patch
 */
async function saveRow(sheet, tab, id, patch) {
  if (!(await sheet.findById(tab, id))) throw new HttpError(404, 'Not found');
  const [row] = await sheet.updateRows(tab, [{ id, patch }]);
  return json(withoutSecrets(toRecord(row)));
}

/**
 * @param {ReturnType<typeof createSheet>} sheet
 * @param {string} tab
 * @param {string | undefined} id
 */
async function remove(sheet, tab, id) {
  if (tab === 'Accounts') throw new HttpError(403, 'Disconnect the account instead of deleting it');
  if (!id) throw new HttpError(400, 'An id is required');
  if (tab === 'Posts') {
    const targetIds = (await sheet.getRows('Targets')).filter((target) => target.post_id === id).map((t) => t.id);
    await sheet.deleteRows('Targets', targetIds);
  }
  const deleted = await sheet.deleteRows(tab, [id]);
  if (!deleted) throw new HttpError(404, 'Not found');
  return new Response(null, { status: 204 });
}
