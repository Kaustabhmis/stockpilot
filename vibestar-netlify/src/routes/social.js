import { transact, liveSubscription } from '../lib/store.js';
import { MESSAGE_MAX_LENGTH, NOTIFICATION_TTL_DAYS, DAY_MS } from '../lib/config.js';
import {
  ok, fail, newId, cleanText, publicUser, userStatusOf, toMillis
} from '../lib/util.js';
import { emitNotification, markMessageNotificationsRead } from '../lib/notify.js';

// -------------------------------------------------------------- follows
/**
 * Following is free, public and open to everyone — fans can follow fans. It is
 * not a subscription: it unlocks no private thread, and it has no bearing on
 * badge tiers, which run off the admin-verified external follower count.
 *
 * Takes the lock so a double request cannot leave two rows for one pair. Every
 * follower count in the app is a count of distinct ids as well, so even if a
 * duplicate did slip through it would not inflate anything.
 */
export async function followUser({ user, body }) {
  const targetId = String(body?.userId || '');
  if (targetId === user.id) return fail('You cannot follow yourself.');

  const result = await transact(['Users', 'Follows', 'Notifications'], async (store) => {
    const target = store.users.byId(targetId);
    if (!target) return { error: 'That account does not exist.' };
    if (userStatusOf(target) !== 'ACTIVE') return { error: 'That account is not available.' };

    const existing = store.follows.find(
      (row) => row.follower_id === user.id && row.followee_id === targetId);

    if (!existing) {
      store.follows.insert({
        id: newId('flw'),
        follower_id: user.id,
        followee_id: targetId,
        created_at: new Date().toISOString()
      });
      emitNotification(store, targetId, 'FOLLOW', user.id);
    }

    return { name: target.full_name };
  });

  if (result.error) return fail(result.error);
  return ok({ following: true, message: `You now follow ${result.name}.` });
}

export async function unfollowUser({ store, user, body }) {
  const removed = store.follows.removeWhere(
    (row) => row.follower_id === user.id && row.followee_id === String(body?.userId || ''));

  return ok({ following: false, message: removed.length ? 'Unfollowed.' : 'Not following.' });
}

export async function getFollowList({ store, user, body }) {
  const targetId = String(body?.userId || user.id);
  const type = String(body?.type || 'FOLLOWERS').toUpperCase();

  // FOLLOWERS: rows pointing at the target, read across to the follower.
  // FOLLOWING: rows from the target, read across to the followee.
  const matchKey = type === 'FOLLOWING' ? 'follower_id' : 'followee_id';
  const readKey = type === 'FOLLOWING' ? 'followee_id' : 'follower_id';

  const viewerFollows = new Set(
    store.follows.filter((row) => row.follower_id === user.id).map((row) => row.followee_id));

  const seen = new Set();
  const people = store.follows
    .filter((row) => row[matchKey] === targetId)
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
    .map((row) => store.users.byId(row[readKey]))
    .filter((row) => {
      if (!row || userStatusOf(row) !== 'ACTIVE') return false;
      if (seen.has(row.id)) return false;   // a duplicated row must not list twice
      seen.add(row.id);
      return true;
    })
    .map((row) => {
      const person = publicUser(row);
      person.viewerFollows = viewerFollows.has(row.id);
      person.isSelf = row.id === user.id;
      return person;
    });

  return ok({ people, type, total: people.length });
}

// ------------------------------------------------------------- messaging
/**
 * Every thread is one (subscriber, celebrity) pair. The acting user's role
 * decides which side of that pair they are, so a caller cannot claim to be
 * someone else's counterparty.
 */
function resolveThread(actor, peer) {
  return actor.role === 'CELEBRITY'
    ? { subscriberId: peer.id, celebrityId: actor.id }
    : { subscriberId: actor.id, celebrityId: peer.id };
}

function activeSubscriptionExpiry(store, subscriberId, celebrityId) {
  const now = Date.now();
  const live = store.subscriptions
    .filter((row) => row.subscriber_id === subscriberId
                  && row.celebrity_id === celebrityId
                  && liveSubscription(row, now))
    .sort((a, b) => toMillis(b.expires_at) - toMillis(a.expires_at));

  return live.length ? live[0].expires_at : null;
}

export async function getConversations({ store, user }) {
  const isCreator = user.role === 'CELEBRITY';
  const mineKey = isCreator ? 'celebrity_id' : 'subscriber_id';
  const peerKey = isCreator ? 'subscriber_id' : 'celebrity_id';
  const now = Date.now();

  const conversations = store.subscriptions
    .filter((row) => row[mineKey] === user.id && liveSubscription(row, now))
    .map((subscription) => {
      const peer = store.users.byId(subscription[peerKey]);
      if (!peer || userStatusOf(peer) !== 'ACTIVE') return null;

      const thread = store.messages.filter(
        (m) => m.subscriber_id === subscription.subscriber_id
            && m.celebrity_id === subscription.celebrity_id);

      const unreadCount = thread.filter((m) => m.sender_id !== user.id && !m.read_at).length;
      const sorted = thread.sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at));
      const latest = sorted[0] || null;

      return {
        peer: publicUser(peer),
        subscriptionExpiresAt: subscription.expires_at,
        unreadCount,
        lastMessage: latest
          ? { content: latest.content, createdAt: latest.created_at, fromMe: latest.sender_id === user.id }
          : null,
        lastActivityAt: latest ? latest.created_at : subscription.created_at
      };
    })
    .filter(Boolean)
    .sort((a, b) => toMillis(b.lastActivityAt) - toMillis(a.lastActivityAt));

  return ok({ conversations, role: user.role });
}

export async function getChatMessages({ store, user, body }) {
  const peer = store.users.byId(String(body?.peerId || ''));
  if (!peer) return fail('That person does not exist.');
  if (peer.id === user.id) return fail('You cannot message yourself.');

  const thread = resolveThread(user, peer);

  // STRICT SERVER-SIDE AUTHORIZATION CHECK
  const expiresAt = activeSubscriptionExpiry(store, thread.subscriberId, thread.celebrityId);
  if (!expiresAt) {
    return ok({ authorized: false, subscriptionExpiresAt: null, peer: publicUser(peer), messages: [] });
  }

  const messages = store.messages
    .filter((m) => m.subscriber_id === thread.subscriberId && m.celebrity_id === thread.celebrityId)
    .sort((a, b) => toMillis(a.created_at) - toMillis(b.created_at));

  // Mark the peer's messages read. Read receipts have to reflect this open, so
  // the flags are set before the thread is serialised below.
  const now = new Date().toISOString();
  messages.forEach((message) => {
    if (message.sender_id !== user.id && !message.read_at) {
      store.messages.update(message, { read_at: now });
    }
  });
  markMessageNotificationsRead(store, user.id, peer.id);

  return ok({
    authorized: true,
    subscriptionExpiresAt: expiresAt,
    peer: publicUser(peer),
    messages: messages.map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      content: m.content,
      createdAt: m.created_at,
      // Read receipts reflect the peer actually opening the thread.
      readByPeer: m.sender_id === user.id ? Boolean(m.read_at) : true
    }))
  });
}

export async function sendMessage({ store, user, body }) {
  const content = cleanText(body?.content, MESSAGE_MAX_LENGTH);
  if (!content) return fail('Message cannot be empty.');

  const peer = store.users.byId(String(body?.peerId || ''));
  if (!peer) return fail('That person does not exist.');
  if (peer.id === user.id) return fail('You cannot message yourself.');

  const thread = resolveThread(user, peer);

  // STRICT SERVER-SIDE AUTHORIZATION CHECK BEFORE SAVING
  const expiresAt = activeSubscriptionExpiry(store, thread.subscriberId, thread.celebrityId);
  if (!expiresAt) return fail('An active subscription is required for this conversation.');

  const id = newId('msg');
  const createdAt = new Date().toISOString();
  store.messages.insert({
    id,
    subscriber_id: thread.subscriberId,
    celebrity_id: thread.celebrityId,
    sender_id: user.id,
    content,
    read_at: '',
    created_at: createdAt
  });

  emitNotification(store, peer.id, 'MESSAGE', user.id);

  return ok({ message: { id, senderId: user.id, content, createdAt, readByPeer: false } });
}

// --------------------------------------------------------- notifications
export async function getNotifications({ store, user, body }) {
  const limit = Math.min(Math.max(Number(body?.limit) || 30, 1), 100);
  const unreadOnly = body?.unreadOnly === true;

  const mine = store.notifications.filter((row) => row.user_id === user.id);
  const unreadCount = mine.filter((row) => !row.read_at).length;

  const notifications = mine
    .filter((row) => !unreadOnly || !row.read_at)
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
    .slice(0, limit)
    .map((row) => {
      const actor = row.actor_id ? store.users.byId(row.actor_id) : null;
      return {
        id: row.id,
        type: row.type,
        count: Number(row.count) || 1,
        meta: row.meta || '',
        read: Boolean(row.read_at),
        createdAt: row.created_at,
        targetId: row.target_id || '',
        // A suspended actor's notification survives but loses its identity.
        actor: actor && userStatusOf(actor) === 'ACTIVE' ? publicUser(actor) : null
      };
    });

  return ok({ notifications, unreadCount, total: mine.length });
}

export async function markNotificationsRead({ store, user, body }) {
  const ids = Array.isArray(body?.notificationIds) ? new Set(body.notificationIds.map(String)) : null;
  const now = new Date().toISOString();

  // Always scoped to the caller, so one user cannot mark another's read.
  const marked = store.notifications.updateWhere(
    (row) => row.user_id === user.id && !row.read_at && (!ids || ids.has(row.id)),
    { read_at: now }
  );

  return ok({ marked: marked.length });
}

/** Scheduled cleanup: notifications past their 60-day life. */
export function pruneNotifications(store, now = Date.now()) {
  const cutoff = now - NOTIFICATION_TTL_DAYS * DAY_MS;
  return store.notifications.removeWhere((row) => toMillis(row.created_at) < cutoff).length;
}
