import { transact, livePost, liveSubscription } from '../lib/store.js';
import { BADGE_MIN_FOLLOWERS, env } from '../lib/config.js';
import {
  ok, fail, cleanText, sanitizeUrl, publicUser, badgeFor,
  verificationStatusOf, userStatusOf, isAdminUser, toMillis,
  signMediaUrl, mediaKeyFromUrl
} from '../lib/util.js';
import { revokeUserSessions } from '../lib/auth.js';
import { emitNotification } from '../lib/notify.js';
import { countBy } from './auth.js';
import { verificationConfig } from './money.js';

/** Guards an admin against locking themselves out. */
function guardSelf(admin, targetId, action) {
  return admin.id === targetId ? `You cannot ${action} your own account.` : null;
}

function countActiveAdmins(store, excludeId) {
  const configured = env.adminEmails();
  return store.users.count((row) => userStatusOf(row) === 'ACTIVE'
    && row.id !== excludeId
    && (row.is_admin === true || configured.includes(String(row.email).toLowerCase())));
}

// ------------------------------------------------------------- overview
export async function adminGetOverview({ store }) {
  const now = Date.now();
  const users = store.users.all();
  const posts = store.posts.all();
  const subscriptions = store.subscriptions.all();
  const requests = store.verificationRequests.all();

  const liveSubs = subscriptions.filter((row) => liveSubscription(row, now));
  const projected = liveSubs.reduce((total, row) => {
    const creator = store.users.byId(row.celebrity_id);
    return total + (creator ? Number(creator.monthly_price) || 0 : 0);
  }, 0);

  return ok({
    users: {
      total: users.length,
      creators: users.filter((u) => u.role === 'CELEBRITY').length,
      fans: users.filter((u) => u.role === 'FAN').length,
      admins: users.filter((u) => isAdminUser(u)).length,
      suspended: users.filter((u) => userStatusOf(u) === 'SUSPENDED').length,
      deleted: users.filter((u) => userStatusOf(u) === 'DELETED').length,
      verified: users.filter((u) => verificationStatusOf(u) === 'APPROVED').length
    },
    posts: {
      total: posts.length,
      // Counted against the clock, not the stored flag: a post whose window has
      // closed is expired whether or not maintenance has rewritten the row yet.
      active: posts.filter((p) => livePost(p, now)).length,
      expired: posts.filter((p) => String(p.status).toUpperCase() !== 'DELETED' && !livePost(p, now)).length,
      deleted: posts.filter((p) => String(p.status).toUpperCase() === 'DELETED').length,
      private: posts.filter((p) => p.visibility === 'SUBSCRIBERS' && livePost(p, now)).length
    },
    subscriptions: {
      total: subscriptions.length,
      active: liveSubs.length,
      projectedMonthlyValue: projected
    },
    messages: { total: store.messages.count() },
    follows: { total: store.follows.count() },
    engagement: {
      likes: store.likes.count(),
      comments: store.comments.count((c) => String(c.status).toUpperCase() === 'ACTIVE')
    },
    notifications: {
      total: store.notifications.count(),
      unread: store.notifications.count((n) => !n.read_at)
    },
    media: {
      count: store.media.count(),
      bytes: store.media.all().reduce((total, row) => total + (Number(row.bytes) || 0), 0)
    },
    verification: {
      pending: requests.filter((r) => r.status === 'PENDING').length,
      approved: requests.filter((r) => r.status === 'APPROVED').length,
      rejected: requests.filter((r) => r.status === 'REJECTED').length
    }
  });
}

export async function adminGetRevenue({ store }) {
  const paid = store.payments.filter((row) => row.status === 'PAID' && row.mode !== 'DEMO');
  const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);

  const pick = (purpose) => {
    const rows = paid.filter((row) => row.purpose === purpose);
    return {
      count: rows.length,
      gross: sum(rows, 'amount_paise') / 100,
      commission: sum(rows, 'commission_paise') / 100
    };
  };

  const byCreator = new Map();
  for (const row of paid) {
    if (!row.beneficiary_id) continue;
    byCreator.set(row.beneficiary_id,
      (byCreator.get(row.beneficiary_id) || 0) + (Number(row.net_paise) || 0));
  }

  return ok({
    commissionPercent: env.commissionPercent(),
    grossProcessed: sum(paid, 'amount_paise') / 100,
    platformRevenue: sum(paid, 'commission_paise') / 100,
    owedToCreators: sum(paid, 'net_paise') / 100,
    payoutsPending: sum(paid, 'net_paise') / 100,
    breakdown: { subscriptions: pick('SUBSCRIPTION'), tips: pick('TIP'), verification: pick('VERIFICATION') },
    owed: [...byCreator.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([creatorId, net]) => {
        const creator = store.users.byId(creatorId);
        return { creatorId, creator: creator ? publicUser(creator) : null, net: net / 100 };
      })
  });
}

// ----------------------------------------------------------------- users
export async function adminListUsers({ store, body }) {
  const search = cleanText(body?.query, 80).toLowerCase();
  const role = String(body?.role || 'ALL').toUpperCase();
  const status = String(body?.status || 'ALL').toUpperCase();
  const now = Date.now();

  const postCounts = countBy(store.posts.filter((p) => livePost(p, now)), 'author_id', 'id');
  const followerCounts = countBy(store.follows.all(), 'followee_id', 'follower_id');
  const liveSubs = store.subscriptions.filter((s) => liveSubscription(s, now));
  const subscriberCounts = countBy(liveSubs, 'celebrity_id', 'subscriber_id');
  const subscriptionCounts = countBy(liveSubs, 'subscriber_id', 'celebrity_id');

  const users = store.users
    .filter((row) => {
      if (role !== 'ALL' && row.role !== role) return false;
      if (status !== 'ALL' && userStatusOf(row) !== status) return false;
      if (search) {
        const haystack = `${row.full_name} ${row.username} ${row.email}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
    .map((row) => {
      const user = publicUser(row);
      // Admin-only fields, deliberately absent from publicUser.
      user.email = row.email;
      user.statusReason = row.status_reason || '';
      user.stats = {
        posts: postCounts.get(row.id) || 0,
        // In-app followers, for context only. Badge tiers still run off the
        // admin-verified external count so follows cannot be farmed into a tier.
        inAppFollowers: followerCounts.get(row.id) || 0,
        subscribers: subscriberCounts.get(row.id) || 0,
        subscriptions: subscriptionCounts.get(row.id) || 0
      };
      return user;
    });

  return ok({ users, total: users.length });
}

export async function adminSetUserStatus({ user: admin, body }) {
  const targetId = String(body?.userId || '');
  const next = String(body?.status || '').toUpperCase();
  if (!['ACTIVE', 'SUSPENDED', 'DELETED'].includes(next)) {
    return fail('Status must be ACTIVE, SUSPENDED or DELETED.');
  }

  // Locked because of the last-admin guard: two admins demoting each other at
  // once would both read "another admin exists" and leave nobody able to log in.
  const result = await transact(['Users'], async (store) => {
    const target = store.users.byId(targetId);
    if (!target) return { error: 'That account does not exist.' };

    if (next !== 'ACTIVE') {
      const guard = guardSelf(admin, targetId, next === 'DELETED' ? 'delete' : 'suspend');
      if (guard) return { error: guard };

      // Never leave the platform without a reachable admin.
      if (isAdminUser(target) && countActiveAdmins(store, targetId) === 0) {
        return { error: 'This is the last active admin. Appoint another admin first.' };
      }
    }

    store.users.update(target, {
      status: next,
      status_reason: next === 'ACTIVE' ? '' : cleanText(body?.reason, 280),
      status_changed_at: new Date().toISOString()
    });

    return { name: target.full_name };
  });

  if (result.error) return fail(result.error);

  // Revoking sessions makes a suspension bite immediately, and resolveUser
  // re-checks status anyway so nothing survives on a warm path.
  if (next !== 'ACTIVE') await revokeUserSessions(targetId);

  const verb = { ACTIVE: 'restored', SUSPENDED: 'suspended', DELETED: 'deleted' }[next];
  return ok({ message: `${result.name} ${verb}.` });
}

export async function adminSetUserRole({ store, user: admin, body }) {
  const targetId = String(body?.userId || '');
  const next = String(body?.role || '').toUpperCase();
  if (!['FAN', 'CELEBRITY'].includes(next)) return fail('Role must be FAN or CELEBRITY.');

  const target = store.users.byId(targetId);
  if (!target) return fail('That account does not exist.');

  const guard = guardSelf(admin, targetId, 'change the role of');
  if (guard) return fail(guard);

  if (next === 'FAN') {
    // Demoting must not leave a verified badge on an account that can no longer
    // publish or take subscribers.
    store.users.update(target, {
      role: 'FAN',
      verification_status: 'NONE',
      verification_route: '',
      verified_follower_count: 0,
      verified_at: '',
      monthly_price: 0
    });
  } else {
    store.users.update(target, {
      role: 'CELEBRITY',
      monthly_price: Number(target.monthly_price) > 0 ? Number(target.monthly_price) : 299,
      category: target.category || 'Creator'
    });
  }

  return ok({ message: `${target.full_name} is now a ${next === 'FAN' ? 'fan' : 'creator'}.` });
}

export async function adminSetUserAdmin({ user: admin, body }) {
  const targetId = String(body?.userId || '');
  const grant = body?.makeAdmin === true || String(body?.makeAdmin).toLowerCase() === 'true';

  const result = await transact(['Users'], async (store) => {
    const target = store.users.byId(targetId);
    if (!target) return { error: 'That account does not exist.' };

    if (!grant) {
      const guard = guardSelf(admin, targetId, 'revoke admin on');
      if (guard) return { error: guard };
      if (countActiveAdmins(store, targetId) === 0) {
        return { error: 'This is the last active admin. Appoint another admin first.' };
      }
      // An ADMIN_EMAILS entry outranks the column, so the revoke would not stick.
      if (env.adminEmails().includes(String(target.email).toLowerCase())) {
        return { error: 'This account is an admin via the ADMIN_EMAILS environment variable. Remove it there first.' };
      }
    }

    store.users.update(target, { is_admin: grant });
    return { name: target.full_name };
  });

  if (result.error) return fail(result.error);
  return ok({ message: `${result.name}${grant ? ' is now an admin.' : ' is no longer an admin.'}` });
}

// ----------------------------------------------------------------- posts
export async function adminListPosts({ store, user: admin, body }) {
  const status = String(body?.status || 'ALL').toUpperCase();
  const search = cleanText(body?.query, 80).toLowerCase();
  const visibility = String(body?.visibility || 'ALL').toUpperCase();

  const posts = store.posts
    .filter((row) => {
      if (status !== 'ALL' && String(row.status).toUpperCase() !== status) return false;
      if (visibility !== 'ALL' && (row.visibility || 'PUBLIC') !== visibility) return false;
      if (search) {
        const author = store.users.byId(row.author_id);
        const haystack = `${row.caption} ${author?.full_name || ''} ${author?.username || ''}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
    .slice(0, 300)
    .map((row) => {
      const author = store.users.byId(row.author_id);
      const raw = sanitizeUrl(row.media_url);
      const isPrivate = row.visibility === 'SUBSCRIBERS';
      const key = isPrivate ? mediaKeyFromUrl(raw) : '';

      return {
        id: row.id,
        type: row.type,
        caption: row.caption,
        // Private media is served only against a per-viewer signature, so the
        // raw URL would 403 even for an admin. Moderation is impossible without
        // being able to actually open the file, so sign it for them here.
        mediaUrl: isPrivate ? (key ? signMediaUrl(key, admin.id) : '') : raw,
        visibility: row.visibility || 'PUBLIC',
        status: row.status,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        shareViews: Number(row.share_views) || 0,
        author: author ? publicUser(author) : null
      };
    });

  return ok({ posts, total: posts.length });
}

export async function adminSetPostStatus({ store, body }) {
  const next = String(body?.status || '').toUpperCase();
  if (!['ACTIVE', 'EXPIRED', 'DELETED'].includes(next)) {
    return fail('Status must be ACTIVE, EXPIRED or DELETED.');
  }

  const post = store.posts.byId(String(body?.postId || ''));
  if (!post) return fail('That post does not exist.');

  // Restoring only makes sense while the 30-day window is still open.
  if (next === 'ACTIVE' && toMillis(post.expires_at) <= Date.now()) {
    return fail('That post is past its 30-day window and cannot be restored.');
  }

  store.posts.update(post, { status: next });
  const verb = { ACTIVE: 'restored', EXPIRED: 'expired', DELETED: 'deleted' }[next];
  return ok({ message: `Post ${verb}.` });
}

// ---------------------------------------------------------- verification
export async function listVerificationRequests({ store, body }) {
  const status = String(body?.statusFilter || body?.status || 'PENDING').toUpperCase();

  const requests = store.verificationRequests
    .filter((row) => status === 'ALL' || row.status === status)
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
    .map((row) => {
      const applicant = store.users.byId(row.user_id);
      return {
        id: row.id,
        userId: row.user_id,
        route: row.route,
        platform: row.platform || '',
        profileUrl: sanitizeUrl(row.profile_url),
        claimedFollowerCount: Number(row.claimed_follower_count) || 0,
        feeAmount: Number(row.fee_amount) || 0,
        paymentReference: row.payment_reference || '',
        status: row.status,
        note: row.note || '',
        createdAt: row.created_at,
        reviewedAt: row.reviewed_at,
        verifiedFollowerCount: Number(row.verified_follower_count) || 0,
        applicant: applicant ? publicUser(applicant) : null
      };
    });

  return ok({ requests, config: verificationConfig() });
}

/**
 * Approves or rejects. On approval the admin sets the follower count they
 * actually confirmed, which is what decides the badge tier — the applicant's
 * claim is only a starting suggestion, so a creator cannot award themselves a
 * tier by typing a big number.
 *
 * Locked so two admins reviewing the same queue entry cannot both apply a
 * decision, leaving the applicant's account reflecting one and the request row
 * the other.
 */
export async function reviewVerificationRequest({ user: admin, body }) {
  const approve = String(body?.decision || '').toUpperCase() === 'APPROVE';
  const note = cleanText(body?.note, 280);

  const result = await transact(
    ['Users', 'VerificationRequests', 'Notifications'],
    async (store) => {
      const request = store.verificationRequests.byId(String(body?.requestId || ''));
      if (!request) return { error: 'That request does not exist.' };
      if (request.status !== 'PENDING') return { error: 'That request was already reviewed.' };

      const applicant = store.users.byId(request.user_id);
      if (!applicant) return { error: 'The applicant no longer exists.' };

      const now = new Date().toISOString();

      if (!approve) {
        store.verificationRequests.update(request, {
          status: 'REJECTED', note, reviewed_by: admin.id, reviewed_at: now
        });
        store.users.update(applicant, { verification_status: 'REJECTED', verification_route: '' });
        emitNotification(store, applicant.id, 'VERIFICATION', admin.id, 'REJECTED');
        return { message: 'Request rejected.' };
      }

      const raw = body?.verifiedFollowerCount;
      const confirmed = (raw === '' || raw === null || raw === undefined)
        ? Number(request.claimed_follower_count) || 0
        : Number(raw);

      if (!Number.isFinite(confirmed) || confirmed < 0 || confirmed > 1_000_000_000) {
        return { error: 'Enter a realistic verified follower count.' };
      }

      store.verificationRequests.update(request, {
        status: 'APPROVED',
        note,
        reviewed_by: admin.id,
        reviewed_at: now,
        verified_follower_count: Math.floor(confirmed)
      });
      store.users.update(applicant, {
        verification_status: 'APPROVED',
        verification_route: request.route,
        verified_follower_count: Math.floor(confirmed),
        verified_at: now
      });

      emitNotification(store, applicant.id, 'VERIFICATION', admin.id, 'APPROVED');

      const badge = badgeFor(applicant);
      return {
        badge,
        message: badge
          ? `Approved. ${applicant.full_name} now holds the ${badge.label} badge.`
          : `Approved. The badge unlocks at ${BADGE_MIN_FOLLOWERS} verified followers.`
      };
    }
  );

  if (result.error) return fail(result.error);
  return ok({ message: result.message, badge: result.badge || null });
}

/** Admin-only follower recount, which is how a badge steps up a tier. */
export async function setVerifiedFollowerCount({ store, body }) {
  const targetId = String(body?.userId || '');
  const value = Number(body?.count);
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000) {
    return fail('Enter a realistic follower count.');
  }

  const target = store.users.byId(targetId);
  if (!target) return fail('That account does not exist.');
  if (verificationStatusOf(target) !== 'APPROVED') {
    return fail('Verify the account before setting a follower count.');
  }

  store.users.update(target, {
    verified_follower_count: Math.floor(value),
    verified_at: new Date().toISOString()
  });
  const badge = badgeFor(target);

  return ok({
    message: badge
      ? `Updated. Badge is now ${badge.label}.`
      : `Updated. Below ${BADGE_MIN_FOLLOWERS} followers, so no badge is shown.`,
    badge
  });
}

// ----------------------------------------------------------- payments
export async function adminListPayments({ store, body }) {
  const status = String(body?.status || 'ALL').toUpperCase();
  const purpose = String(body?.purpose || 'ALL').toUpperCase();

  const payments = store.payments
    .filter((row) => (status === 'ALL' || row.status === status)
                  && (purpose === 'ALL' || row.purpose === purpose))
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
    .slice(0, 300)
    .map((row) => {
      const payer = store.users.byId(row.user_id);
      const target = row.beneficiary_id ? store.users.byId(row.beneficiary_id) : null;
      return {
        id: row.id,
        purpose: row.purpose,
        orderId: row.order_id || '',
        paymentId: row.payment_id || '',
        amount: Number(row.amount_paise) / 100,
        commission: Number(row.commission_paise) / 100,
        net: Number(row.net_paise) / 100,
        status: row.status,
        mode: row.mode,
        failureReason: row.failure_reason || '',
        createdAt: row.created_at,
        paidAt: row.paid_at,
        payer: payer ? publicUser(payer) : null,
        target: target ? publicUser(target) : null
      };
    });

  const paid = payments.filter((p) => p.status === 'PAID');
  const sum = (list, key) => list.reduce((total, p) => total + p[key], 0);

  return ok({
    payments,
    mode: env.paymentMode(),
    totals: {
      collected: sum(paid, 'amount'),
      commission: sum(paid, 'commission'),
      netToCreators: sum(paid, 'net'),
      subscriptions: sum(paid.filter((p) => p.purpose === 'SUBSCRIPTION'), 'amount'),
      tips: sum(paid.filter((p) => p.purpose === 'TIP'), 'amount'),
      verification: sum(paid.filter((p) => p.purpose === 'VERIFICATION'), 'amount'),
      paidCount: paid.length,
      failedCount: payments.filter((p) => p.status === 'FAILED').length,
      pendingCount: payments.filter((p) => p.status === 'CREATED').length
    }
  });
}

// -------------------------------------------------------------- media
export async function adminListMedia({ store }) {
  const media = store.media.all()
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
    .slice(0, 300)
    .map((row) => {
      const owner = store.users.byId(row.owner_id);
      return {
        id: row.id,
        storeKey: row.store_key,
        kind: row.kind,
        mimeType: row.mime_type,
        bytes: Number(row.bytes),
        url: sanitizeUrl(row.url),
        createdAt: row.created_at,
        owner: owner ? publicUser(owner) : null
      };
    });

  return ok({
    media,
    totalBytes: store.media.all().reduce((total, row) => total + (Number(row.bytes) || 0), 0),
    count: store.media.count()
  });
}
