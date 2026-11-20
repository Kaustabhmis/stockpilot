import crypto from 'node:crypto';

/**
 * THE NODE HALF OF THE PLATFORM SHIM.
 *
 * Everything in the app that needs a primitive the runtime supplies — random
 * bytes, base64, HMAC, a password KDF, environment variables — goes through this
 * interface. platform-gas.js implements the same names using Apps Script's
 * Utilities and PropertiesService, which is what lets one codebase run as a
 * Netlify function and as a Google Apps Script.
 *
 * Keep this surface small. Every name added here has to be implementable twice.
 */

export const PLATFORM = 'NODE';

export function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function base64Encode(input) {
  return Buffer.from(input).toString('base64');
}

export function base64DecodeToBytes(base64) {
  return Buffer.from(String(base64), 'base64');
}

export function byteLength(bytes) {
  return bytes.length;
}

export function hmacSha256Hex(message, secret) {
  return crypto.createHmac('sha256', String(secret))
    .update(String(message), 'utf8').digest('hex');
}

export function sha256Hex(message) {
  return crypto.createHash('sha256').update(String(message), 'utf8').digest('hex');
}

/** Comparison whose duration does not depend on where the bytes differ. */
export function safeEquals(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Yields; the Apps Script implementation blocks with Utilities.sleep. */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function envGet(name) {
  return process.env[name];
}

// ------------------------------------------------------- password hashing
/**
 * scrypt, memory-hard, and the right default when running on Node.
 *
 * PBKDF2 is here as well, and it is the interoperable option: Apps Script has no
 * scrypt and no way to implement one at a usable speed, so a deployment that
 * needs the SAME accounts to work on both platforms must use PBKDF2. See
 * PASSWORD_ALGO in config.js.
 */
export const SUPPORTED_ALGOS = ['scrypt', 'pbkdf2'];

export function scryptHex(password, salt, { N, r, p, keylen }) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), String(salt), keylen, { N, r, p },
      (err, derived) => (err ? reject(err) : resolve(derived.toString('hex'))));
  });
}

export function pbkdf2Hex(password, salt, iterations, keylen) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(String(password), String(salt), iterations, keylen, 'sha256',
      (err, derived) => (err ? reject(err) : resolve(derived.toString('hex'))));
  });
}

// --------------------------------------------------------- private media
/**
 * How a subscriber-only file is handed to an entitled viewer.
 *
 * On Node this is a short-lived HMAC-signed URL pointing at /media/:key, which
 * the media function verifies. Apps Script cannot serve binary at all, so its
 * implementation returns a data URI instead — see platform-gas.js.
 */
export async function presentPrivateMedia(url, viewerId) {
  const { mediaKeyFromUrl, signMediaUrl } = await import('./util.js');
  const key = mediaKeyFromUrl(url);
  return key ? signMediaUrl(key, viewerId) : '';
}
