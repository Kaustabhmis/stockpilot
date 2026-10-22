/**
 * Account rows: insert a connected account, or refresh its token if it is already stored.
 */
import crypto from 'node:crypto';
import { encrypt } from './crypto.js';

/**
 * @param {ReturnType<import('./sheets.js').createSheet>} sheet
 * @param {{ platform: string, external_id: string, name: string, token: string, expiresAt?: string }} account
 * @returns {Promise<string>} the account id
 */
export async function upsertAccount(sheet, { platform, external_id, name, token, expiresAt = '' }) {
  const patch = {
    name,
    access_token_enc: encrypt(token),
    expires_at: expiresAt,
    connected_at: new Date().toISOString(),
    active: true,
  };
  const existing = (await sheet.getRows('Accounts')).find(
    (row) => row.platform === platform && row.external_id === external_id,
  );
  if (existing) {
    await sheet.updateRows('Accounts', [{ id: existing.id, patch }]);
    return existing.id;
  }
  const id = crypto.randomUUID();
  await sheet.appendRow('Accounts', { id, platform, external_id, ...patch });
  return id;
}
