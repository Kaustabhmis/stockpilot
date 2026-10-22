/**
 * POST /api/save-post — creates or updates a post and its per-account targets in one request.
 *   { post_id?, master_text, media_type, media_urls, targets: [{ account_id, caption }] }
 * Targets for accounts no longer selected are removed unless already published.
 * Does not publish; use /api/publish-now for that.
 */
import crypto from 'node:crypto';
import { errorResponse, HttpError, json, readJson, withErrors } from './lib/http.js';
import { createSheet, toRecord } from './lib/sheets.js';
import { cleanFields, requireString } from './lib/validate.js';
import { requireAuth } from './lib/session.js';

export const config = { path: '/api/save-post' };

const MAX_TARGETS = 20;

export default withErrors(async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  if (req.method !== 'POST') return errorResponse(405, 'Use POST');

  const body = await readJson(req, 512 * 1024);
  const sheet = createSheet();
  await sheet.preload(['Posts', 'Targets', 'Accounts']);

  const now = new Date().toISOString();
  const postFields = cleanFields('Posts', body);
  const post = body.post_id ? await updatePost(sheet, requireString(body.post_id, 'post_id'), postFields, now)
    : await createPost(sheet, postFields, now);

  const requested = await checkTargets(sheet, body.targets);
  const existing = (await sheet.getRows('Targets')).filter((target) => target.post_id === post.id);
  const existingByAccount = new Map(existing.map((target) => [target.account_id, target]));

  const toUpdate = [];
  const toCreate = [];
  for (const { account_id, caption } of requested) {
    const current = existingByAccount.get(account_id);
    if (!current) {
      toCreate.push({
        id: crypto.randomUUID(),
        post_id: post.id,
        account_id,
        caption,
        status: 'draft',
        attempts: 0,
      });
    } else if (current.status !== 'published') {
      toUpdate.push({ id: current.id, patch: { caption } });
    }
  }
  const toDelete = existing
    .filter((target) => !requested.some((r) => r.account_id === target.account_id) && target.status !== 'published')
    .map((target) => target.id);

  await sheet.updateRows('Targets', toUpdate);
  await sheet.deleteRows('Targets', toDelete);
  await sheet.appendRows('Targets', toCreate);

  const targets = (await sheet.getRows('Targets'))
    .filter((target) => target.post_id === post.id)
    .map(toRecord);
  return json({ post, targets }, 200);
});

/**
 * @param {ReturnType<typeof createSheet>} sheet
 * @param {Record<string, unknown>} fields
 * @param {string} now
 */
async function createPost(sheet, fields, now) {
  const record = {
    status: 'draft',
    media_type: 'none',
    media_urls: [],
    auto_approve: false,
    ...fields,
    id: crypto.randomUUID(),
    created_at: now,
    updated_at: now,
  };
  await sheet.appendRow('Posts', record);
  return record;
}

/**
 * @param {ReturnType<typeof createSheet>} sheet
 * @param {string} postId
 * @param {Record<string, unknown>} fields
 * @param {string} now
 */
async function updatePost(sheet, postId, fields, now) {
  const current = await sheet.findById('Posts', postId);
  if (!current) throw new HttpError(404, 'Post not found');
  if (toRecord(current).status === 'published') throw new HttpError(409, 'Published posts cannot be edited');
  const [row] = await sheet.updateRows('Posts', [{ id: postId, patch: { ...fields, updated_at: now } }]);
  return toRecord(row);
}

/**
 * Validates the requested targets: each account must exist and be connected.
 * @param {ReturnType<typeof createSheet>} sheet
 * @param {unknown} targets
 * @returns {Promise<{ account_id: string, caption: string }[]>}
 */
async function checkTargets(sheet, targets) {
  if (!Array.isArray(targets)) throw new HttpError(400, 'targets must be a list');
  if (targets.length > MAX_TARGETS) throw new HttpError(400, `At most ${MAX_TARGETS} accounts per post`);
  const accounts = new Map((await sheet.getRows('Accounts')).map((row) => [row.id, toRecord(row)]));
  const seen = new Set();
  return targets.map((target) => {
    const accountId = requireString(target?.account_id, 'account_id');
    const account = accounts.get(accountId);
    if (!account || !account.active) throw new HttpError(400, 'One of the selected accounts is not connected');
    if (seen.has(accountId)) throw new HttpError(400, 'An account was selected twice');
    seen.add(accountId);
    const { caption = '' } = cleanFields('Targets', { caption: target.caption ?? '' });
    return { account_id: accountId, caption };
  });
}
