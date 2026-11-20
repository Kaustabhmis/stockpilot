import { getStore } from '@netlify/blobs';

/**
 * EPHEMERAL STATE — sessions and login throttling.
 *
 * These deliberately do not live in the spreadsheet. Both are touched on
 * effectively every request, and Sheets cannot index: resolving one bearer
 * token would mean reading the entire session table, every time, against a
 * ~300-reads-per-minute quota. A failed-login counter would spend a write.
 *
 * Neither is business data — nothing here is worth looking at in a spreadsheet,
 * and losing all of it logs everybody out and costs nothing else. Blobs gives a
 * keyed lookup at no quota cost, so the spreadsheet is left holding the records
 * that actually matter.
 */
const SESSION_STORE = 'vibestar-sessions';
const THROTTLE_STORE = 'vibestar-throttle';

/**
 * An in-process stand-in, used ONLY when VIBESTAR_LOCAL_KV=1 is set.
 *
 * Netlify Blobs needs the Netlify runtime, which a plain `node scripts/…` or a
 * test run does not have. The flag is opt-in and never set in deployment on
 * purpose: silently falling back in production would give each container its own
 * session store, and users would appear to be logged out at random depending on
 * which container answered.
 */
const localKv = new Map();
const useLocalKv = process.env.VIBESTAR_LOCAL_KV === '1';

function localStore(name) {
  if (!localKv.has(name)) localKv.set(name, new Map());
  const map = localKv.get(name);
  return {
    get: async (key) => (map.has(key) ? JSON.parse(map.get(key)) : null),
    setJSON: async (key, value) => { map.set(key, JSON.stringify(value)); },
    delete: async (key) => { map.delete(key); },
    list: async () => ({ blobs: [...map.keys()].map((key) => ({ key })) })
  };
}

function sessions() {
  return useLocalKv ? localStore(SESSION_STORE)
    : getStore({ name: SESSION_STORE, consistency: 'strong' });
}

function throttles() {
  return useLocalKv ? localStore(THROTTLE_STORE)
    : getStore({ name: THROTTLE_STORE, consistency: 'strong' });
}

// -------------------------------------------------------------- sessions
export async function putSession(token, userId, expiresAtMs) {
  await sessions().setJSON(token, { userId, expiresAt: expiresAtMs, createdAt: Date.now() });
}

/** The user id behind a token, or '' when absent or expired. */
export async function readSession(token) {
  if (!token) return '';

  let record;
  try {
    record = await sessions().get(token, { type: 'json' });
  } catch {
    return '';
  }
  if (!record) return '';

  if (!record.expiresAt || record.expiresAt <= Date.now()) {
    // Expired tokens are cleaned up as they are encountered, so the store does
    // not accumulate dead keys waiting on a scheduled sweep.
    try { await sessions().delete(token); } catch { /* already gone */ }
    return '';
  }
  return String(record.userId || '');
}

export async function deleteSession(token) {
  if (!token) return;
  try { await sessions().delete(token); } catch { /* already gone */ }
}

/**
 * Revokes every session for one user, which is what makes a suspension bite
 * straight away.
 *
 * Blobs has no "delete by value", so this lists and filters. Suspension is rare
 * and administrative, so the cost is acceptable here in a way it would not be
 * on a per-request path. `resolveUser` re-checks account status on every
 * request regardless, so this is belt as well as braces.
 */
export async function deleteUserSessions(userId) {
  const store = sessions();
  let removed = 0;

  try {
    const { blobs } = await store.list();
    for (const blob of blobs || []) {
      const record = await store.get(blob.key, { type: 'json' }).catch(() => null);
      if (record && String(record.userId) === String(userId)) {
        await store.delete(blob.key).catch(() => {});
        removed += 1;
      }
    }
  } catch {
    // A listing failure must not block the suspension itself.
  }
  return removed;
}

// ------------------------------------------------------------- throttling
const throttleKey = (email) => `login:${String(email).toLowerCase()}`;

export async function readThrottle(email) {
  try {
    return await throttles().get(throttleKey(email), { type: 'json' });
  } catch {
    return null;
  }
}

export async function writeThrottle(email, record) {
  try {
    await throttles().setJSON(throttleKey(email), record);
  } catch { /* throttling is a mitigation, never a hard dependency */ }
}

export async function clearThrottle(email) {
  try {
    await throttles().delete(throttleKey(email));
  } catch { /* already gone */ }
}
