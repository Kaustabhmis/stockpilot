import {
  SCRYPT, PBKDF2, PASSWORD_ALGO, SESSION_TTL_DAYS, DAY_MS,
  MAX_LOGIN_ATTEMPTS, LOGIN_WINDOW_MS
} from './config.js';
import { randomHex, scryptHex, pbkdf2Hex, SUPPORTED_ALGOS } from './platform.js';
import { newId, newToken, safeEquals, userStatusOf, isAdminUser } from './util.js';
import {
  putSession, readSession, deleteSession, deleteUserSessions,
  readThrottle, writeThrottle, clearThrottle
} from './kv.js';

/**
 * PASSWORD HASHING, ACROSS TWO RUNTIMES.
 *
 * A stored hash records which algorithm produced it:
 *
 *   scrypt$16384$8$1$<hex>      memory-hard, the default on Node
 *   pbkdf2$210000$<hex>         interoperable; the only option on Apps Script
 *
 * Tagging the format is what makes the two deployments able to share a
 * database. Verification dispatches on the tag, so a hash written by either
 * platform is readable by any platform that can compute that algorithm — and
 * when it cannot, the error says so plainly instead of looking like a wrong
 * password.
 *
 * The asymmetry is real and worth stating: Apps Script has no scrypt, and every
 * PBKDF2 iteration there is a separate call across the JavaScript bridge, so its
 * iteration count has to stay in the low thousands. If you intend to run both
 * platforms against one database, set PASSWORD_ALGO=pbkdf2 so every account is
 * verifiable everywhere — and understand you are trading scrypt's memory
 * hardness for that portability.
 */
export function newSalt() {
  return randomHex(16);
}

/** Hashes with the configured algorithm, returning the tagged form. */
export async function hashPassword(password, salt, algo = PASSWORD_ALGO) {
  const chosen = SUPPORTED_ALGOS.includes(algo) ? algo : SUPPORTED_ALGOS[0];

  if (chosen === 'scrypt') {
    const hex = await scryptHex(password, salt, SCRYPT);
    return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${hex}`;
  }

  const hex = await pbkdf2Hex(password, salt, PBKDF2.iterations, PBKDF2.keylen);
  return `pbkdf2$${PBKDF2.iterations}$${hex}`;
}

/**
 * Verifies against whatever produced the stored hash.
 *
 * An untagged hash is treated as legacy scrypt with the current parameters,
 * which is what the pre-Apps-Script builds wrote.
 */
export async function verifyPassword(password, salt, storedHash) {
  const stored = String(storedHash || '');
  if (!stored) return false;

  const parts = stored.split('$');

  if (parts.length === 1) {
    // Legacy: bare scrypt hex, no tag.
    if (!SUPPORTED_ALGOS.includes('scrypt')) throw new Error(UNSUPPORTED_MESSAGE);
    const hex = await scryptHex(password, salt, SCRYPT);
    return safeEquals(hex, stored);
  }

  const [algo, ...rest] = parts;

  if (algo === 'scrypt') {
    if (!SUPPORTED_ALGOS.includes('scrypt')) throw new Error(UNSUPPORTED_MESSAGE);
    const [N, r, p, hex] = rest;
    const candidate = await scryptHex(password, salt,
      { N: Number(N), r: Number(r), p: Number(p), keylen: SCRYPT.keylen });
    return safeEquals(candidate, hex);
  }

  if (algo === 'pbkdf2') {
    const [iterations, hex] = rest;
    // Length is derived from the stored hash, so an old hash with a different
    // key length still verifies.
    const candidate = await pbkdf2Hex(password, salt, Number(iterations), hex.length / 2);
    return safeEquals(candidate, hex);
  }

  return false;
}

const UNSUPPORTED_MESSAGE =
  'This deployment cannot verify that account\'s password format (scrypt). '
  + 'Sign in through the Netlify deployment, or set PASSWORD_ALGO=pbkdf2 there '
  + 'and reset the password so it works on both.';

// ------------------------------------------------------------- sessions
export async function createSession(userId) {
  const token = newToken();
  await putSession(token, userId, Date.now() + SESSION_TTL_DAYS * DAY_MS);
  return token;
}

export async function revokeSession(token) {
  await deleteSession(token);
}

export async function revokeUserSessions(userId) {
  return deleteUserSessions(userId);
}

/**
 * Resolves a bearer token against an already-loaded store.
 *
 * The token lookup is a keyed blob read; the user row comes from the batch the
 * request already paid for, so authentication adds no spreadsheet reads at all.
 *
 * Account status is re-checked here rather than only at login, so suspending
 * someone ends their live session on their next request instead of leaving it
 * valid until the token expires.
 */
export async function resolveUser(store, token) {
  const userId = await readSession(token);
  if (!userId) return null;

  const row = store.users.byId(userId);
  if (!row) return null;
  return userStatusOf(row) === 'ACTIVE' ? row : null;
}

/** Reads the token from an Authorization header or the legacy body field. */
export function tokenFrom(event, body) {
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match) return match[1].trim();
  return body?.token ? String(body.token) : '';
}

/** Sentinel errors the router turns into 401/403. */
export class SessionExpired extends Error {
  constructor() { super('SESSION_EXPIRED'); this.name = 'SessionExpired'; }
}
export class Forbidden extends Error {
  constructor() { super('FORBIDDEN'); this.name = 'Forbidden'; }
}

export async function requireUser(store, token) {
  const user = await resolveUser(store, token);
  if (!user) throw new SessionExpired();
  return user;
}

export async function requireAdmin(store, token) {
  const user = await requireUser(store, token);
  if (!isAdminUser(user)) throw new Forbidden();
  return user;
}

// ------------------------------------------------------- login throttle
export async function loginThrottled(email) {
  const record = await readThrottle(email);
  if (!record) return false;

  if (Date.now() - Number(record.firstAt || 0) > LOGIN_WINDOW_MS) {
    await clearThrottle(email);
    return false;
  }
  return Number(record.attempts || 0) >= MAX_LOGIN_ATTEMPTS;
}

export async function recordFailedLogin(email) {
  const record = await readThrottle(email);
  const windowOpen = record && Date.now() - Number(record.firstAt || 0) <= LOGIN_WINDOW_MS;

  await writeThrottle(email, windowOpen
    ? { attempts: Number(record.attempts || 0) + 1, firstAt: record.firstAt }
    : { attempts: 1, firstAt: Date.now() });
}

export async function clearLoginThrottle(email) {
  await clearThrottle(email);
}

export { newId };
