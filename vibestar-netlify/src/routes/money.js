import { transact, liveSubscription } from '../lib/store.js';
import { base64Encode, hmacSha256Hex } from '../lib/platform.js';
import {
  RAZORPAY_API, PAYMENT_CURRENCY, VERIFICATION_FEE, MIN_FOLLOWERS_TO_APPLY,
  BADGE_MIN_FOLLOWERS, BADGE_TIERS, SUPPORTED_PLATFORMS, TIP_MIN_RUPEES,
  TIP_MAX_RUPEES, SUBSCRIPTION_TTL_DAYS, REMINDER_LEAD_DAYS,
  WINBACK_WINDOW_DAYS, DAY_MS, env
} from '../lib/config.js';
import {
  ok, fail, newId, cleanText, sanitizeUrl, safeEquals, splitAmount,
  verificationStatusOf, userStatusOf, badgeFor, toMillis
} from '../lib/util.js';
import { emitNotification } from '../lib/notify.js';

// ------------------------------------------------------------ gateway
function razorpayAuthHeader() {
  return 'Basic ' + base64Encode(`${env.razorpayKeyId()}:${env.razorpayKeySecret()}`);
}

async function razorpayFetch(path, method = 'GET', payload = null) {
  if (env.paymentMode() !== 'RAZORPAY') {
    return { ok: false, status: 0, data: { error: { description: 'Razorpay keys are not configured.' } } };
  }

  const response = await fetch(RAZORPAY_API + path, {
    method,
    headers: { Authorization: razorpayAuthHeader(), 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined
  });

  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  return { ok: response.ok, status: response.status, data };
}

export function hmacHex(message, secret) {
  return hmacSha256Hex(message, secret);
}

export async function getPaymentConfig() {
  const mode = env.paymentMode();
  return ok({
    mode,
    // Only the public key id ever leaves the server.
    keyId: mode === 'RAZORPAY' ? env.razorpayKeyId() : '',
    live: mode === 'RAZORPAY' && env.isLiveKey(),
    currency: PAYMENT_CURRENCY,
    verificationFee: VERIFICATION_FEE,
    commissionPercent: env.commissionPercent()
  });
}

// ------------------------------------------------------------- pricing
/**
 * Works out what a purchase costs, server-side. The client never supplies an
 * amount, so it cannot pay ₹1 for a ₹499 subscription.
 */
function priceFor(store, user, purpose, targetId, amountRupees) {
  if (purpose === 'VERIFICATION') {
    if (user.role !== 'CELEBRITY') return { error: 'Only creator accounts can pay for verification.' };
    if (verificationStatusOf(user) === 'APPROVED') return { error: 'Your account is already verified.' };
    return {
      amountPaise: VERIFICATION_FEE * 100,
      description: 'VibeStar creator verification',
      beneficiaryId: '',
      // No creator on the other side, so the whole fee is platform revenue.
      // This keeps platform income a single sum over commission_paise.
      commissionPercent: 100
    };
  }

  const creator = store.users.byId(String(targetId || ''));
  if (!creator || creator.role !== 'CELEBRITY') return { error: 'That creator does not exist.' };
  if (userStatusOf(creator) !== 'ACTIVE') return { error: 'That creator is not available.' };
  if (creator.id === user.id) {
    return { error: purpose === 'TIP' ? 'You cannot tip yourself.' : 'You cannot subscribe to yourself.' };
  }

  if (purpose === 'TIP') {
    const tip = Number(amountRupees);
    if (!Number.isFinite(tip) || tip < TIP_MIN_RUPEES || tip > TIP_MAX_RUPEES) {
      return { error: `Tip must be between ₹${TIP_MIN_RUPEES} and ₹${TIP_MAX_RUPEES}.` };
    }
    return {
      amountPaise: Math.round(tip) * 100,
      description: `Tip for ${creator.full_name}`,
      beneficiaryId: creator.id,
      commissionPercent: env.commissionPercent()
    };
  }

  const rupees = Number(creator.monthly_price) || 0;
  if (rupees <= 0) return { error: 'That creator has not set a subscription price.' };

  return {
    amountPaise: Math.round(rupees * 100),
    description: `VibeStar subscription to ${creator.full_name}`,
    beneficiaryId: creator.id,
    commissionPercent: env.commissionPercent()
  };
}

// -------------------------------------------------------------- orders
export async function createPaymentOrder({ store, user, body }) {
  const purpose = String(body?.purpose || '').toUpperCase();
  if (!['SUBSCRIPTION', 'VERIFICATION', 'TIP'].includes(purpose)) {
    return fail('Unknown payment purpose.');
  }

  const priced = priceFor(store, user, purpose, body?.targetId, body?.amountRupees);
  if (priced.error) return fail(priced.error);

  if (env.paymentMode() === 'DEMO') {
    return fail('Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET '
              + 'in your Netlify environment variables to take payments.');
  }

  const receipt = newId('rcpt');
  const created = await razorpayFetch('/orders', 'POST', {
    amount: priced.amountPaise,
    currency: PAYMENT_CURRENCY,
    receipt,
    // Notes ride to the dashboard and the webhook, so a webhook-only
    // completion can still find the right account.
    notes: { vibestarUserId: user.id, vibestarPurpose: purpose, vibestarTargetId: body?.targetId || '' }
  });

  if (!created.ok || !created.data.id) {
    return fail(created.data?.error?.description || `Razorpay rejected the order (HTTP ${created.status}).`);
  }

  // No lock needed: this only appends, and the order id it carries is minted by
  // Razorpay, so two of these can never describe the same order.
  store.payments.insert({
    id: receipt,
    user_id: user.id,
    purpose,
    target_id: body?.targetId || '',
    beneficiary_id: priced.beneficiaryId,
    order_id: created.data.id,
    amount_paise: priced.amountPaise,
    currency: PAYMENT_CURRENCY,
    status: 'CREATED',
    mode: 'RAZORPAY',
    // Snapshotted now, so a later rate change never rewrites this split.
    commission_percent: priced.commissionPercent,
    created_at: new Date().toISOString()
  });

  return ok({
    orderId: created.data.id,
    amount: priced.amountPaise,
    amountDisplay: priced.amountPaise / 100,
    currency: PAYMENT_CURRENCY,
    keyId: env.razorpayKeyId(),
    description: priced.description,
    receipt,
    prefill: { name: user.full_name, email: user.email }
  });
}

/**
 * Called with whatever Razorpay Checkout handed back. Verifies the signature,
 * then hands off to settlePayment, which independently confirms the payment
 * with Razorpay before anything is granted.
 */
export async function confirmPayment({ store, user, body }) {
  const response = body?.response || body || {};
  const orderId = cleanText(response.razorpay_order_id, 64);
  const paymentId = cleanText(response.razorpay_payment_id, 64);
  const signature = cleanText(response.razorpay_signature, 128);

  if (!orderId || !paymentId || !signature) return fail('Incomplete payment response from Razorpay.');

  const record = store.payments.find((row) => row.order_id === orderId);
  if (!record) return fail('No matching order. Start the payment again.');
  // The order belongs to whoever opened it, not whoever is asking about it.
  if (record.user_id !== user.id) return fail('That order belongs to another account.');
  if (record.status === 'PAID') return ok({ message: 'This payment was already processed.', alreadyProcessed: true });

  const expected = hmacHex(`${orderId}|${paymentId}`, env.razorpayKeySecret());
  if (!safeEquals(expected, signature)) {
    store.payments.update(record, { status: 'FAILED', failure_reason: 'Signature mismatch' });
    return fail('Payment signature could not be verified. Nothing was activated.');
  }

  return settlePayment(orderId, paymentId, true);
}

/**
 * THE SINGLE PLACE AN ENTITLEMENT IS GRANTED.
 *
 * Re-fetches the payment from Razorpay so a forged callback cannot activate
 * anything, then does the whole read-check-write under the spreadsheet lock.
 *
 * The lock is not optional here. Postgres made a double grant impossible with a
 * unique index on payment_id and SELECT … FOR UPDATE; a spreadsheet offers
 * neither, and the browser callback and the webhook routinely arrive at the
 * same moment for the same payment. Holding the lock across "is it already
 * PAID?" and "mark it PAID" is the only thing standing between one payment and
 * two subscriptions.
 */
export async function settlePayment(orderId, paymentId, signatureVerified) {
  const fetched = await razorpayFetch(`/payments/${encodeURIComponent(paymentId)}`);
  if (!fetched.ok || !fetched.data.id) {
    return fail('Could not confirm the payment with Razorpay. Nothing was activated.');
  }

  const payment = fetched.data;
  const settled = payment.status === 'captured' || payment.status === 'authorized';

  return transact(
    ['Payments', 'Users', 'Subscriptions', 'VerificationRequests', 'Notifications'],
    async (store) => {
      const record = store.payments.find((row) => row.order_id === orderId);
      if (!record) return fail('No matching order.');
      if (record.status === 'PAID') {
        return ok({ message: 'This payment was already processed.', alreadyProcessed: true });
      }

      if (!settled) {
        store.payments.update(record, {
          status: 'FAILED', payment_id: paymentId, failure_reason: `Razorpay status: ${payment.status}`
        });
        return fail(`Razorpay reports this payment as ${payment.status}.`);
      }
      if (String(payment.order_id) !== String(orderId)) {
        return fail('That payment belongs to a different order.');
      }
      if (Number(payment.amount) !== Number(record.amount_paise)) {
        store.payments.update(record, {
          status: 'FAILED',
          payment_id: paymentId,
          failure_reason: `Amount mismatch: paid ${payment.amount}, expected ${record.amount_paise}`
        });
        return fail('The amount paid does not match the order. Nothing was activated.');
      }

      // A payment id already spent on another order is a replay.
      const reused = store.payments.find(
        (row) => row.payment_id === paymentId && row.id !== record.id);
      if (reused) return fail('That payment has already been used.');

      // The rate was snapshotted on the order, so the split reflects what was in
      // force when the fan committed, not whatever it is today.
      const split = splitAmount(record.amount_paise, record.commission_percent);
      const now = new Date().toISOString();
      store.payments.update(record, {
        status: 'PAID',
        payment_id: paymentId,
        paid_at: now,
        signature_verified: Boolean(signatureVerified),
        failure_reason: '',
        commission_paise: split.commission,
        net_paise: split.net,
        granted_at: now
      });

      const granted = grantEntitlement(store, record, paymentId);
      return ok({
        message: granted.message,
        purpose: record.purpose,
        amount: Number(record.amount_paise) / 100,
        paymentId
      });
    }
  );
}

/** Applies what a settled payment bought. Only settlePayment calls this. */
function grantEntitlement(store, record, paymentId) {
  if (record.purpose === 'SUBSCRIPTION') {
    const expiresAt = applySubscription(store, record.user_id, record.target_id);
    emitNotification(store, record.target_id, 'SUBSCRIPTION', record.user_id);
    return { message: `Subscription active until ${new Date(expiresAt).toDateString()}.` };
  }

  if (record.purpose === 'TIP') {
    // A tip buys no access — it is a gift, so the only effects are the record
    // and telling the creator. The amount is not private, so it rides as meta.
    const rupees = Number(record.amount_paise) / 100;
    emitNotification(store, record.target_id, 'TIP', record.user_id, '', rupees);
    return { message: `Tip of ₹${rupees.toLocaleString('en-IN')} sent. Thank you!` };
  }

  // VERIFICATION: paying grants the tick immediately. The coloured badge still
  // waits on an admin-confirmed follower count, so money cannot buy a tier.
  const user = store.users.byId(record.user_id);
  const now = new Date().toISOString();
  const followers = user ? Number(user.verified_follower_count) || 0 : 0;

  if (user) {
    store.users.update(user, {
      verification_status: 'APPROVED', verification_route: 'PAYMENT', verified_at: now
    });
  }

  const pending = store.verificationRequests.find(
    (row) => row.user_id === record.user_id && row.status === 'PENDING');

  if (pending) {
    store.verificationRequests.update(pending, {
      status: 'APPROVED',
      payment_reference: paymentId,
      reviewed_at: now,
      note: `Auto-approved on Razorpay payment ${paymentId}`,
      verified_follower_count: followers
    });
  } else {
    store.verificationRequests.insert({
      id: newId('vreq'),
      user_id: record.user_id,
      route: 'PAYMENT',
      platform: 'OTHER',
      fee_amount: VERIFICATION_FEE,
      payment_reference: paymentId,
      status: 'APPROVED',
      note: `Approved by Razorpay payment ${paymentId}`,
      reviewed_at: now,
      verified_follower_count: followers,
      created_at: now
    });
  }

  emitNotification(store, record.user_id, 'VERIFICATION', '', 'APPROVED');

  return {
    message: followers >= BADGE_MIN_FOLLOWERS
      ? 'Verified. Your badge is live.'
      : `Verified. Your coloured badge unlocks once ${BADGE_MIN_FOLLOWERS} followers are confirmed.`
  };
}

// ------------------------------------------------------- subscriptions
/**
 * Writes the 30-day subscription, extending an existing one rather than
 * stacking a second row.
 *
 * Postgres guaranteed the one-live-row-per-pair rule with a partial unique
 * index. Here the caller must already hold the lock — every path into this
 * function runs inside `transact`.
 */
function applySubscription(store, subscriberId, celebrityId) {
  const now = Date.now();
  const existing = store.subscriptions.find(
    (row) => row.subscriber_id === subscriberId
          && row.celebrity_id === celebrityId
          && liveSubscription(row, now));

  if (existing) {
    const extended = new Date(toMillis(existing.expires_at) + SUBSCRIPTION_TTL_DAYS * DAY_MS);
    store.subscriptions.update(existing, {
      expires_at: extended.toISOString(),
      // Clearing the stamps re-arms the reminders for the new cycle.
      expiring_notified_at: '',
      expired_notified_at: ''
    });
    return extended.toISOString();
  }

  const expiresAt = new Date(now + SUBSCRIPTION_TTL_DAYS * DAY_MS).toISOString();
  store.subscriptions.insert({
    id: newId('sub'),
    subscriber_id: subscriberId,
    celebrity_id: celebrityId,
    status: 'ACTIVE',
    created_at: new Date(now).toISOString(),
    expires_at: expiresAt
  });
  return expiresAt;
}

/** Free activation, DEMO mode only. Refuses outright once keys are configured. */
export async function processSubscription({ user, body }) {
  if (env.paymentMode() === 'RAZORPAY') {
    return fail('Payment required. Start checkout instead of activating directly.');
  }

  const celebrityId = String(body?.celebrityId || '');

  const result = await transact(
    ['Users', 'Subscriptions', 'Payments', 'Notifications'],
    async (store) => {
      const actor = store.users.byId(user.id);
      const priced = priceFor(store, actor || user, 'SUBSCRIPTION', celebrityId);
      if (priced.error) return { error: priced.error };

      const expiresAt = applySubscription(store, user.id, celebrityId);
      const now = new Date().toISOString();

      // Logged as a zero-value DEMO row so the ledger explains why access exists.
      store.payments.insert({
        id: newId('rcpt'),
        user_id: user.id,
        purpose: 'SUBSCRIPTION',
        target_id: celebrityId,
        beneficiary_id: celebrityId,
        amount_paise: 0,
        currency: PAYMENT_CURRENCY,
        status: 'PAID',
        mode: 'DEMO',
        commission_percent: 0,
        commission_paise: 0,
        net_paise: 0,
        failure_reason: 'No gateway configured — granted without payment',
        created_at: now,
        paid_at: now,
        granted_at: now
      });

      emitNotification(store, celebrityId, 'SUBSCRIPTION', user.id);
      return { expiresAt };
    }
  );

  if (result.error) return fail(result.error);
  return ok({ message: 'Subscription activated. Chat unlocked.', expiresAt: result.expiresAt, mode: 'DEMO' });
}

export async function cancelSubscription({ store, user, body }) {
  const now = Date.now();
  const cancelled = store.subscriptions.updateWhere(
    (row) => row.subscriber_id === user.id
          && row.celebrity_id === String(body?.celebrityId || '')
          && liveSubscription(row, now),
    { status: 'CANCELLED' }
  );

  if (!cancelled.length) return fail('You do not have an active subscription to cancel.');
  return ok({ message: 'Subscription cancelled.' });
}

// -------------------------------------------------------------- receipts
function mapPayment(row) {
  return {
    id: row.id,
    purpose: row.purpose,
    targetId: row.target_id || '',
    orderId: row.order_id || '',
    paymentId: row.payment_id || '',
    amount: Number(row.amount_paise) / 100,
    commission: Number(row.commission_paise) / 100,
    net: Number(row.net_paise) / 100,
    commissionPercent: Number(row.commission_percent),
    beneficiaryId: row.beneficiary_id || '',
    currency: row.currency,
    status: row.status,
    mode: row.mode,
    failureReason: row.failure_reason || '',
    createdAt: row.created_at,
    paidAt: row.paid_at
  };
}

export async function getMyPayments({ store, user }) {
  const payments = store.payments
    .filter((row) => row.user_id === user.id)
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
    .slice(0, 100)
    .map(mapPayment);

  return ok({ payments, mode: env.paymentMode() });
}

/** What a creator has earned. DEMO rows are excluded: no money moved. */
export async function getCreatorEarnings({ store, user }) {
  if (user.role !== 'CELEBRITY') return fail('Only creator accounts have earnings.');

  const earned = store.payments.filter(
    (row) => row.beneficiary_id === user.id && row.status === 'PAID' && row.mode !== 'DEMO');

  const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
  const ofPurpose = (purpose) => {
    const rows = earned.filter((row) => row.purpose === purpose);
    return {
      count: rows.length,
      gross: sum(rows, 'amount_paise') / 100,
      net: sum(rows, 'net_paise') / 100
    };
  };

  return ok({
    commissionPercent: env.commissionPercent(),
    gross: sum(earned, 'amount_paise') / 100,
    commission: sum(earned, 'commission_paise') / 100,
    net: sum(earned, 'net_paise') / 100,
    subscriptions: ofPurpose('SUBSCRIPTION'),
    tips: ofPurpose('TIP'),
    recent: earned
      .sort((a, b) => toMillis(b.paid_at) - toMillis(a.paid_at))
      .slice(0, 20)
      .map(mapPayment),
    // Deliberately blunt: Razorpay pays the full amount into the platform
    // account, so this balance is a liability, not something transferred.
    payoutsConfigured: false
  });
}

// ---------------------------------------------------------- verification
export function verificationConfig() {
  return {
    fee: VERIFICATION_FEE,
    minFollowersToApply: MIN_FOLLOWERS_TO_APPLY,
    badgeMinFollowers: BADGE_MIN_FOLLOWERS,
    platforms: SUPPORTED_PLATFORMS,
    tiers: [...BADGE_TIERS].reverse().map(({ key, label, color, min }) => ({ key, label, color, min }))
  };
}

function mapRequest(row) {
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
    verifiedFollowerCount: Number(row.verified_follower_count) || 0
  };
}

export async function getVerificationState({ store, user }) {
  const requests = store.verificationRequests
    .filter((row) => row.user_id === user.id)
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
    .map(mapRequest);

  return ok({
    config: verificationConfig(),
    status: verificationStatusOf(user),
    route: user.verification_route || '',
    verifiedFollowerCount: Number(user.verified_follower_count) || 0,
    verifiedAt: user.verified_at,
    badge: badgeFor(user),
    eligibleForBadge: (Number(user.verified_follower_count) || 0) >= BADGE_MIN_FOLLOWERS,
    pendingRequest: requests.find((r) => r.status === 'PENDING') || null,
    requests
  });
}

export async function submitVerificationRequest({ user, body }) {
  const input = body?.payload || body || {};
  if (user.role !== 'CELEBRITY') return fail('Only creator accounts can apply for verification.');
  if (verificationStatusOf(user) === 'APPROVED') return fail('Your account is already verified.');

  const route = input.route === 'PAYMENT' ? 'PAYMENT' : 'FOLLOWERS';

  // With a gateway configured the paid route is a checkout, not a queue entry.
  if (route === 'PAYMENT' && env.paymentMode() === 'RAZORPAY') {
    return fail(`Pay the ₹${VERIFICATION_FEE} fee to verify instantly — `
              + 'no review queue needed for the paid route.');
  }

  const platform = String(input.platform || '').toUpperCase();
  const profileUrl = sanitizeUrl(input.profileUrl);
  const claimed = Math.floor(Number(input.claimedFollowerCount) || 0);

  if (!SUPPORTED_PLATFORMS.includes(platform)) return fail('Choose the social platform your audience is on.');
  if (!profileUrl) return fail('Add a public http(s) link to that profile so it can be checked.');
  if (claimed < 0 || claimed > 1_000_000_000) return fail('Enter a realistic follower count.');
  if (route === 'FOLLOWERS' && claimed < MIN_FOLLOWERS_TO_APPLY) {
    return fail(`The follower route needs at least ${MIN_FOLLOWERS_TO_APPLY} followers. `
              + `You can pay the ₹${VERIFICATION_FEE} fee instead.`);
  }

  // One open request per creator was a partial unique index in Postgres; here
  // it is a check made reliable by holding the lock across it.
  const result = await transact(['Users', 'VerificationRequests'], async (store) => {
    const open = store.verificationRequests.find(
      (row) => row.user_id === user.id && row.status === 'PENDING');
    if (open) return { error: 'You already have a request under review.' };

    const row = store.verificationRequests.insert({
      id: newId('vreq'),
      user_id: user.id,
      route,
      platform,
      profile_url: profileUrl,
      claimed_follower_count: claimed,
      fee_amount: route === 'PAYMENT' ? VERIFICATION_FEE : 0,
      payment_reference: cleanText(input.paymentReference, 80),
      status: 'PENDING',
      created_at: new Date().toISOString()
    });

    const account = store.users.byId(user.id);
    if (account) {
      store.users.update(account, { verification_status: 'PENDING', verification_route: route });
    }

    return { row };
  });

  if (result.error) return fail(result.error);
  return ok({ message: 'Request submitted for review.', request: mapRequest(result.row) });
}

export async function cancelVerificationRequest({ store, user }) {
  const now = new Date().toISOString();
  const withdrawn = store.verificationRequests.updateWhere(
    (row) => row.user_id === user.id && row.status === 'PENDING',
    { status: 'CANCELLED', reviewed_at: now }
  );

  if (!withdrawn.length) return fail('You have no request under review.');

  if (verificationStatusOf(user) === 'PENDING') {
    store.users.update(user, { verification_status: 'NONE', verification_route: '' });
  }
  return ok({ message: 'Request withdrawn.' });
}

// -------------------------------------------------- expiry reminders
/**
 * Warns subscribers before a subscription lapses, nudges them again after, and
 * tells the creator when someone churns. Each row stamps when each reminder
 * went out, so a re-run the same day sends nothing twice.
 *
 * Runs against a store the scheduled function owns, so all of it lands in that
 * job's single write.
 */
export function sendExpiryReminders(store, now = Date.now()) {
  const leadWindow = now + REMINDER_LEAD_DAYS * DAY_MS;
  const winbackFloor = now - WINBACK_WINDOW_DAYS * DAY_MS;

  const subscriberIsActive = (row) => {
    const subscriber = store.users.byId(row.subscriber_id);
    return subscriber && userStatusOf(subscriber) === 'ACTIVE';
  };

  const expiring = store.subscriptions.filter((row) => row.status === 'ACTIVE'
    && toMillis(row.expires_at) > now
    && toMillis(row.expires_at) <= leadWindow
    && !row.expiring_notified_at
    && subscriberIsActive(row));

  for (const row of expiring) {
    const daysLeft = Math.max(1, Math.ceil((toMillis(row.expires_at) - now) / DAY_MS));
    emitNotification(store, row.subscriber_id, 'SUB_EXPIRING', row.celebrity_id, row.celebrity_id, daysLeft);
    store.subscriptions.update(row, { expiring_notified_at: new Date(now).toISOString() });
  }

  const lapsed = store.subscriptions.filter((row) => row.status === 'ACTIVE'
    && toMillis(row.expires_at) <= now
    && toMillis(row.expires_at) > winbackFloor
    && !row.expired_notified_at
    && subscriberIsActive(row));

  for (const row of lapsed) {
    emitNotification(store, row.subscriber_id, 'SUB_EXPIRED', row.celebrity_id, row.celebrity_id);
    emitNotification(store, row.celebrity_id, 'SUB_CHURNED', row.subscriber_id);
    store.subscriptions.update(row, { expired_notified_at: new Date(now).toISOString() });
  }

  return { expiringReminders: expiring.length, lapsedReminders: lapsed.length };
}
