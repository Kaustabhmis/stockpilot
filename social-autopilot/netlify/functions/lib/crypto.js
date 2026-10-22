/**
 * AES-256-GCM encryption for tokens stored in the Google Sheet.
 * Key: TOKEN_ENCRYPTION_KEY, 32 random bytes encoded as base64.
 */
import crypto from 'node:crypto';

/** @returns {Buffer} the 32-byte key */
function loadKey() {
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
  return key;
}

/**
 * Encrypts text. Output format: `iv.tag.ciphertext`, each part base64url.
 * @param {string} plain
 * @returns {string}
 */
export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', loadKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

/**
 * Decrypts a value produced by `encrypt`. Throws if the data was tampered with.
 * @param {string} payload
 * @returns {string}
 */
export function decrypt(payload) {
  const [iv, tag, ciphertext] = payload.split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
