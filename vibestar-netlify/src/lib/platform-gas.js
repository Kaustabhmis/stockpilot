/* eslint-disable no-undef */
/**
 * THE APPS SCRIPT HALF OF THE PLATFORM SHIM.
 *
 * Same names as platform-node.js, implemented with Utilities and
 * PropertiesService. This file is never imported by the Node build — the Apps
 * Script bundler substitutes it for platform-node.js when generating Code.gs.
 *
 * Apps Script has no `crypto`, no Buffer and no environment variables, so each
 * primitive is rebuilt from what Utilities offers. Two of them are worth reading
 * carefully, because they are where the platform genuinely constrains the app:
 * password hashing and constant-time comparison.
 */

export const PLATFORM = 'APPS_SCRIPT';

/** Utilities.getUuid is the only randomness Apps Script exposes. */
export function randomHex(bytes) {
  let hex = '';
  while (hex.length < bytes * 2) {
    hex += Utilities.getUuid().replace(/-/g, '');
  }
  return hex.slice(0, bytes * 2);
}

export function base64Encode(input) {
  if (typeof input === 'string') return Utilities.base64Encode(input, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(input);
}

/** Returns a byte array, which is what DriveApp and Utilities work in. */
export function base64DecodeToBytes(base64) {
  return Utilities.base64Decode(String(base64));
}

export function byteLength(bytes) {
  return bytes.length;
}

function toHex(byteArray) {
  let hex = '';
  for (let i = 0; i < byteArray.length; i += 1) {
    // Apps Script's digest bytes are signed, so negative values need the & 0xFF.
    const value = (byteArray[i] + 256) % 256;
    hex += (value < 16 ? '0' : '') + value.toString(16);
  }
  return hex;
}

export function hmacSha256Hex(message, secret) {
  return toHex(Utilities.computeHmacSha256Signature(String(message), String(secret)));
}

export function sha256Hex(message) {
  return toHex(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(message), Utilities.Charset.UTF_8));
}

/**
 * Length-independent comparison, done by hand.
 *
 * There is no timingSafeEqual here. This accumulates the difference across every
 * character rather than returning early, which is the property that matters —
 * though a JIT is free to be cleverer than the source suggests, so treat this as
 * a strong mitigation rather than a guarantee.
 */
export function safeEquals(a, b) {
  const left = String(a);
  const right = String(b);
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Utilities.sleep blocks the whole execution, which is what is wanted here: Apps
 * Script runs each request as its own process, so a lock retry loop genuinely
 * has to wait for another process to finish rather than yield to an event loop
 * it does not share.
 */
export function sleep(ms) {
  Utilities.sleep(ms);
  return Promise.resolve();
}

/** Script Properties stand in for environment variables. */
export function envGet(name) {
  const cached = envGet.cache || (envGet.cache = PropertiesService.getScriptProperties().getProperties());
  return cached[name];
}

// ------------------------------------------------------- password hashing
/**
 * PBKDF2-HMAC-SHA256 only. There is no scrypt on this platform and no way to
 * build one that runs inside a request.
 *
 * The iteration count is a genuine constraint rather than a choice: every
 * iteration is a separate Utilities.computeHmacSha256Signature call across the
 * JavaScript bridge, so the practical ceiling is a few thousand — nowhere near
 * the 600,000 OWASP suggests for PBKDF2-SHA256. That is a real weakness of
 * running auth on Apps Script, and the reason config.js defaults Node
 * deployments to scrypt instead.
 */
export const SUPPORTED_ALGOS = ['pbkdf2'];

export function scryptHex() {
  throw new Error(
    'This deployment cannot verify scrypt password hashes. Apps Script has no '
    + 'scrypt. The account was created by a Node/Netlify deployment configured '
    + 'for scrypt — set PASSWORD_ALGO=pbkdf2 there and have the user reset '
    + 'their password, or sign in through that deployment instead.'
  );
}

/** Real PBKDF2: U1 = HMAC(pw, salt || INT32BE(1)), Un = HMAC(pw, Un-1), XORed. */
export function pbkdf2Hex(password, salt, iterations, keylen) {
  const blocks = Math.ceil(keylen / 32);
  let out = [];

  for (let block = 1; block <= blocks; block += 1) {
    const blockSuffix = String.fromCharCode(
      (block >>> 24) & 0xFF, (block >>> 16) & 0xFF, (block >>> 8) & 0xFF, block & 0xFF);

    let u = Utilities.computeHmacSha256Signature(String(salt) + blockSuffix, String(password));
    const accumulator = u.slice();

    for (let i = 1; i < iterations; i += 1) {
      u = Utilities.computeHmacSha256Signature(u, String(password));
      for (let j = 0; j < accumulator.length; j += 1) accumulator[j] ^= u[j];
    }
    out = out.concat(accumulator);
  }

  return Promise.resolve(toHex(out.slice(0, keylen)));
}

// --------------------------------------------------------- private media
/**
 * A subscriber-only file, as a data URI.
 *
 * Apps Script cannot serve binary, so there is no signed-URL equivalent of the
 * Netlify path. Returning the bytes inline through the already-authenticated API
 * response is what keeps the paywall real on this platform. driveDataUri lives
 * in src/gas/media-gas.js and is inlined into Code.gs alongside this.
 */
export async function presentPrivateMedia(url) {
  const text = String(url || '');

  // Uploaded through this app: held unshared in Drive, so the bytes come back
  // inline and have no URL anyone could pass on.
  // eslint-disable-next-line no-use-before-define
  if (/^vibestar-drive:\/\//.test(text) || /drive\.google\.com/.test(text)) return driveDataUri(text);

  // Anything else is hosted somewhere we do not control — a creator pasting an
  // image URL — and was public wherever it lives regardless. There is nothing to
  // gate, so an entitled viewer simply gets it.
  return /^https?:\/\/[^\s"'<>]+$/i.test(text) ? text : '';
}
