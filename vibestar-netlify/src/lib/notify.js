import { NOTIFICATION_TYPES, COALESCING_TYPES } from './config.js';
import { newId } from './util.js';

/**
 * Notification rows record who did what, never the content of what they did.
 * A MESSAGE notification deliberately carries no message body: threads are
 * subscription-gated, so copying their text into a second table would route
 * private content around that gate. `meta` is for small non-private values
 * only — a tip amount, days remaining.
 *
 * Writes go through the caller's store, so a request that emits three
 * notifications still costs one append.
 */
export function emitNotification(store, recipientId, type, actorId, targetId = '', meta = '') {
  if (!recipientId || recipientId === actorId) return null;
  if (!NOTIFICATION_TYPES.includes(type)) return null;

  const notifications = store.notifications;
  if (!notifications) throw new Error('emitNotification needs the Notifications table loaded.');

  if (COALESCING_TYPES.includes(type)) {
    // Postgres did this with a partial unique index and an atomic upsert. A
    // spreadsheet has no such index, so the coalescing is a find-and-increment.
    // Two simultaneous emits can therefore leave two rows instead of one that
    // reads "2 messages" — a cosmetic duplicate in a notification list, which
    // is why this is not worth the cost of taking the lock on a chat send.
    const existing = notifications.find((row) => row.user_id === recipientId
      && row.type === type
      && row.actor_id === (actorId || '')
      && !row.read_at);

    if (existing) {
      notifications.update(existing, {
        count: Number(existing.count || 1) + 1,
        created_at: new Date().toISOString(),
        target_id: targetId || existing.target_id,
        meta: meta === '' || meta === null ? existing.meta : String(meta)
      });
      return existing.id;
    }
  }

  const id = newId('ntf');
  notifications.insert({
    id,
    user_id: recipientId,
    type,
    actor_id: actorId || '',
    target_id: targetId || '',
    count: 1,
    meta: meta === null ? '' : String(meta),
    read_at: '',
    created_at: new Date().toISOString()
  });
  return id;
}

/** Clears MESSAGE badges for one peer, when their thread is opened. */
export function markMessageNotificationsRead(store, userId, actorId) {
  const now = new Date().toISOString();
  return store.notifications.updateWhere(
    (row) => row.user_id === userId && row.type === 'MESSAGE'
          && row.actor_id === actorId && !row.read_at,
    { read_at: now }
  ).length;
}
