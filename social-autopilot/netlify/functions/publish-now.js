/**
 * POST /api/publish-now { post_id } — publishes every unpublished target of a post now.
 * Targets in draft, pending_approval, approved or failed are sent; published ones are skipped.
 * Instagram videos that are still processing stay `rendering` for the scheduled job.
 */
import { publishTarget } from './lib/publish.js';
import { errorResponse, HttpError, json, readJson, withErrors } from './lib/http.js';
import { createSheet, toRecord } from './lib/sheets.js';
import { requireAuth } from './lib/session.js';
import { requireString } from './lib/validate.js';

export const config = { path: '/api/publish-now' };

const PUBLISHABLE = new Set(['draft', 'pending_approval', 'approved', 'failed']);

export default withErrors(async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  if (req.method !== 'POST') return errorResponse(405, 'Use POST');

  const { post_id } = await readJson(req);
  const postId = requireString(post_id, 'post_id');
  const sheet = createSheet();
  await sheet.preload(['Posts', 'Targets', 'Accounts']);

  const postRow = await sheet.findById('Posts', postId);
  if (!postRow) throw new HttpError(404, 'Post not found');
  const post = toRecord(postRow);
  if (post.status === 'published') throw new HttpError(409, 'This post is already published');

  const accounts = new Map((await sheet.getRows('Accounts')).map((row) => [row.id, row]));
  const targets = (await sheet.getRows('Targets')).filter((target) => target.post_id === postId);
  const due = targets.filter((target) => PUBLISHABLE.has(target.status));
  if (!due.length) throw new HttpError(400, 'Select at least one account, then publish');

  const outcomes = await Promise.all(due.map(async (target) => {
    const accountRow = accounts.get(target.account_id);
    if (!accountRow || accountRow.active !== 'TRUE') {
      return { target, account: null, result: { ok: false, error: 'This account is disconnected. Reconnect it in Accounts.' } };
    }
    const account = toRecord(accountRow);
    const result = await publishTarget({ account, post, caption: target.caption || post.master_text || '' });
    return { target, account, result };
  }));

  const now = new Date().toISOString();
  await sheet.updateRows('Targets', outcomes.map(({ target, result }) => ({
    id: target.id,
    patch: targetPatch(target, result, now),
  })));

  const statuses = targets.map((target) => {
    const outcome = outcomes.find((o) => o.target.id === target.id);
    return outcome ? targetPatch(target, outcome.result, now).status : target.status;
  });
  const postStatus = statuses.includes('rendering') ? 'rendering'
    : statuses.includes('failed') ? 'failed'
      : 'published';
  await sheet.updateRows('Posts', [{ id: postId, patch: { status: postStatus, updated_at: now } }]);

  return json({
    post_status: postStatus,
    results: outcomes.map(({ target, account, result }) => ({
      target_id: target.id,
      platform: account?.platform || '',
      account_name: account?.name || 'Disconnected account',
      ok: Boolean(result.ok),
      pending: Boolean(result.pending),
      permalink: result.permalink || '',
      error: result.error || '',
    })),
  });
});

/**
 * Sheet changes for one target after its publish attempt.
 * @param {Record<string, any>} target raw target row
 * @param {{ ok: boolean, pending?: boolean, containerId?: string, remoteId?: string, permalink?: string, error?: string }} result
 * @param {string} now ISO timestamp
 */
function targetPatch(target, result, now) {
  const attempts = Number(target.attempts || 0) + 1;
  if (result.ok) {
    return {
      status: 'published',
      remote_post_id: result.remoteId || '',
      permalink: result.permalink || '',
      error: '',
      published_at: now,
      attempts,
    };
  }
  if (result.pending) {
    return { status: 'rendering', remote_post_id: `container:${result.containerId}`, error: '', attempts };
  }
  return { status: 'failed', error: result.error || 'Unknown error', attempts };
}
