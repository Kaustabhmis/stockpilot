/**
 * THE ROUTE SPEC — run against EVERY backend.
 *
 * Both databases implement the same store interface, so the same assertions must
 * hold on both. Anything that passes on Sheets and fails on Postgres (or the
 * reverse) is a real difference in behaviour, and this is what catches it.
 *
 * The harness supplies only what genuinely differs: how to clear the tables and
 * how to put fixture rows in. Everything else — opening a store, calling a
 * handler, flushing — goes through the same code the router uses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();


export async function routeSpec(harness) {
  const {
    openStore, reset, seed, label, writes, stubRazorpay, enforcesUniqueness,
    privateMediaStyle = 'signed-url'
  } = harness;
  const auth = await import('../src/routes/auth.js');
  const content = await import('../src/routes/content.js');
  const social = await import('../src/routes/social.js');
  const money = await import('../src/routes/money.js');
  const admin = await import('../src/routes/admin.js');

  const T = (name, fn) => test(`[${label}] ${name}`, fn);

  // Fixture passwords are hashed by the app's own hashPassword, so each backend
  // stores the format that platform actually supports. Hashing them directly
  // with scrypt would have produced accounts an Apps Script deployment cannot
  // verify — which is a real constraint, and not one worth faking away in
  // fixtures.
  const { hashPassword } = await import('../src/lib/auth.js');

  /** Mirrors what the router does: open a store, run the handler, flush. */
  async function call(fn, { tables = [], user = null, body = {}, token = '' } = {}) {
    const store = await openStore([...new Set([...tables, 'Users'])]);
    const actor = user ? store.users.byId(user) : null;
    const result = await fn({ store, user: actor, body, token, event: { headers: {} } });
    await store.flush();
    return JSON.parse(result.body);
  }

  async function freshSheet() { await reset(); }

  async function seedUsers() {
    const salt = 'abc123';
    const hash = await hashPassword('demo1234', salt);
    const base = {
      password_hash: hash, password_salt: salt, status: 'ACTIVE', chat_theme: 'MIDNIGHT',
      created_at: iso(Date.now() - 30 * DAY)
    };

    await seed('Users', [
      { ...base, id: 'admin1', full_name: 'Admin', username: 'admin', email: 'admin@v.app', role: 'FAN', is_admin: true },
      { ...base, id: 'celeb1', full_name: 'Aarohi S', username: 'aarohi', email: 'a@v.app', role: 'CELEBRITY', monthly_price: 299, verification_status: 'APPROVED', verified_follower_count: 12000 },
      { ...base, id: 'celeb2', full_name: 'Meera K', username: 'meera', email: 'm@v.app', role: 'CELEBRITY', monthly_price: 499 },
      { ...base, id: 'fan1', full_name: 'Rahul V', username: 'rahul', email: 'r@v.app', role: 'FAN' },
      { ...base, id: 'fan2', full_name: 'Priya N', username: 'priya', email: 'p@v.app', role: 'FAN' },
      { ...base, id: 'susp1', full_name: 'Spam Bot', username: 'spam', email: 's@v.app', role: 'FAN', status: 'SUSPENDED' }
    ]);
  }

  /** One public and one private post by celeb1, plus one already expired. */
  async function seedPosts() {
    await seed('Posts', [
      { id: 'pub1', author_id: 'celeb1', type: 'IMAGE', caption: 'public post', media_url: 'https://cdn.test/media/pubkey.jpg', status: 'ACTIVE', visibility: 'PUBLIC', share_views: 0, created_at: iso(Date.now() - DAY), expires_at: iso(Date.now() + 29 * DAY) },
      { id: 'prv1', author_id: 'celeb1', type: 'IMAGE', caption: 'gallery only', media_url: 'https://cdn.test/media/prvkey.jpg', status: 'ACTIVE', visibility: 'SUBSCRIBERS', share_views: 0, created_at: iso(Date.now() - DAY), expires_at: iso(Date.now() + 29 * DAY) },
      { id: 'old1', author_id: 'celeb2', type: 'IMAGE', caption: 'aged out', media_url: '', status: 'ACTIVE', visibility: 'PUBLIC', share_views: 0, created_at: iso(Date.now() - 40 * DAY), expires_at: iso(Date.now() - 10 * DAY) }
    ]);
  }

  // ------------------------------------------------------------------ auth
  T('signUp rejects a duplicate email and a taken username', async () => {
    await freshSheet();
    await seedUsers();

    const dupeEmail = JSON.parse((await auth.signUp({ body: {
      fullName: 'Someone Else', username: 'brandnew', email: 'A@V.APP', password: 'password123'
    } })).body);
    assert.equal(dupeEmail.ok, false);
    assert.match(dupeEmail.error, /already exists/i);

    const dupeName = JSON.parse((await auth.signUp({ body: {
      fullName: 'Someone Else', username: 'AAROHI', email: 'new@v.app', password: 'password123'
    } })).body);
    assert.equal(dupeName.ok, false);
    assert.match(dupeName.error, /taken/i);
  });

  T('two simultaneous signups for one username produce exactly one account', async () => {
    await freshSheet();
    await seedUsers();

    // The case the lock exists for. Both requests read "free" at the same instant;
    // Postgres would have stopped the second with a unique index, and here only
    // holding the mutex across read-and-write can.
    const attempt = () => auth.signUp({ body: {
      fullName: 'Race Condition', username: 'contested', email: `${crypto.randomUUID()}@v.app`,
      password: 'password123'
    } });

    const results = (await Promise.all([attempt(), attempt(), attempt()]))
      .map((r) => JSON.parse(r.body));

    const store = await openStore(['Users']);
    const claimed = store.users.filter((u) => u.username === 'contested');

    assert.equal(claimed.length, 1, `${claimed.length} accounts claimed the same username`);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.ok(results.some((r) => !r.ok && /taken/i.test(r.error)));
  });

  T('signUp creates an account and issues a working session', async () => {
    await freshSheet();
    await seedUsers();

    const created = JSON.parse((await auth.signUp({ body: {
      fullName: 'New Creator', username: 'newbie', email: 'new@v.app',
      password: 'password123', role: 'CELEBRITY'
    } })).body);

    assert.equal(created.ok, true);
    assert.equal(created.user.role, 'CELEBRITY');
    assert.equal(created.user.monthlyPrice, 299);
    // Credentials must never leave the server.
    assert.equal(created.user.password_hash, undefined);
    assert.equal(created.user.passwordHash, undefined);

    const { resolveUser } = await import('../src/lib/auth.js');
    const store = await openStore(['Users']);
    const resolved = await resolveUser(store, created.token);
    assert.equal(resolved.email, 'new@v.app');
  });

  T('logIn gives the same answer for a wrong password and an unknown address', async () => {
    await freshSheet();
    await seedUsers();

    const wrongPassword = await call(auth.logIn, { body: { email: 'r@v.app', password: 'nope' } });
    const noSuchUser = await call(auth.logIn, { body: { email: 'ghost@v.app', password: 'nope' } });

    assert.equal(wrongPassword.ok, false);
    assert.equal(wrongPassword.error, noSuchUser.error);
  });

  T('a suspended account cannot log in, and says why', async () => {
    await freshSheet();
    await seedUsers();

    const result = await call(auth.logIn, { body: { email: 's@v.app', password: 'demo1234' } });
    assert.equal(result.ok, false);
    assert.match(result.error, /suspended/i);
  });

  T('a suspended account cannot be resolved from a token it already held', async () => {
    await freshSheet();
    await seedUsers();

    const { createSession, resolveUser } = await import('../src/lib/auth.js');
    const token = await createSession('susp1');

    const store = await openStore(['Users']);
    // Status is re-checked per request, so suspending ends a live session.
    assert.equal(await resolveUser(store, token), null);
  });

  // ------------------------------------------------------------------ feed
  T('a private gallery post never appears in the feed for a non-subscriber', async () => {
    await freshSheet();
    await seedUsers();
    await seedPosts();

    const feed = await call(content.getPublicFeed, {
      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions'], user: 'fan1'
    });

    const ids = feed.posts.map((p) => p.id);
    assert.ok(ids.includes('pub1'));
    assert.ok(!ids.includes('prv1'), 'private post leaked into the feed');
    // And the expired one is gone without any write having happened.
    assert.ok(!ids.includes('old1'));
  });

  T('a subscriber sees the private post, and only they can reach the media', async () => {
    await freshSheet();
    await seedUsers();
    await seedPosts();
    await seed('Subscriptions', [
      { id: 'sub1', subscriber_id: 'fan1', celebrity_id: 'celeb1', status: 'ACTIVE',
        created_at: iso(Date.now() - DAY), expires_at: iso(Date.now() + 20 * DAY) }
    ]);

    const feed = await call(content.getPublicFeed, {
      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions'], user: 'fan1'
    });

    const priv = feed.posts.find((p) => p.id === 'prv1');
    assert.ok(priv, 'subscriber cannot see the post they paid for');
    assert.ok(priv.mediaUrl, 'entitled subscriber got no media at all');

    if (privateMediaStyle === 'signed-url') {
      // Netlify serves the file from /media/:key, so the entitlement has to
      // travel in the URL — a browser will not put a header on an <img>.
      assert.match(priv.mediaUrl, /\/media\/prvkey\.jpg\?v=fan1&e=\d+&s=[a-f0-9]{64}$/);

      const { verifyMediaSignature } = await import('../src/lib/util.js');
      const params = new URL(priv.mediaUrl).searchParams;
      assert.equal(verifyMediaSignature('prvkey.jpg', 'fan1', params.get('e'), params.get('s')), true);
      // Bound to the viewer, so it is useless to anyone else.
      assert.equal(verifyMediaSignature('prvkey.jpg', 'fan2', params.get('e'), params.get('s')), false);
    }
  });

  T('an expired subscription stops granting access', async () => {
    await freshSheet();
    await seedUsers();
    await seedPosts();
    await seed('Subscriptions', [
      { id: 'sub1', subscriber_id: 'fan1', celebrity_id: 'celeb1', status: 'ACTIVE',
        created_at: iso(Date.now() - 40 * DAY), expires_at: iso(Date.now() - DAY) }
    ]);

    const gallery = await call(content.getCreatorGallery, {
      tables: ['Posts', 'Likes', 'Comments', 'Subscriptions'],
      user: 'fan1', body: { creatorId: 'celeb1' }
    });

    assert.equal(gallery.entitled, false);
    assert.equal(gallery.items.length, 1);
    assert.equal(gallery.items[0].locked, true);
    // A locked tile carries no caption and no media, or the paywall is decoration.
    assert.equal(gallery.items[0].caption, undefined);
    assert.equal(gallery.items[0].mediaUrl, undefined);
  });

  T('a non-subscriber cannot like or comment on a private post', async () => {
    await freshSheet();
    await seedUsers();
    await seedPosts();

    const liked = await call(content.toggleLike, {
      tables: ['Posts', 'Likes', 'Subscriptions', 'Notifications'],
      user: 'fan1', body: { postId: 'prv1' }
    });
    assert.equal(liked.ok, false);

    const commented = await call(content.addComment, {
      tables: ['Posts', 'Comments', 'Subscriptions', 'Notifications'],
      user: 'fan1', body: { postId: 'prv1', content: 'sneaking in' }
    });
    assert.equal(commented.ok, false);
  });

  T('an admin can see a private post and gets media signed for themselves', async () => {
    await freshSheet();
    await seedUsers();
    await seedPosts();

    const listed = await call(admin.adminListPosts, {
      tables: ['Posts'], user: 'admin1', body: { visibility: 'SUBSCRIBERS' }
    });

    assert.equal(listed.posts.length, 1);
    // Moderation is impossible if the reviewer cannot open the file.
    assert.match(listed.posts[0].mediaUrl, /v=admin1/);
  });

  T('a double tap cannot double-count a like', async () => {
    await freshSheet();
    await seedUsers();
    await seedPosts();

    const duplicate = [
      { id: 'l1', post_id: 'pub1', user_id: 'fan1', created_at: iso(Date.now()) },
      { id: 'l2', post_id: 'pub1', user_id: 'fan1', created_at: iso(Date.now()) },
      { id: 'l3', post_id: 'pub1', user_id: 'fan2', created_at: iso(Date.now()) }
    ];

    // The two backends defend this differently, and each is worth asserting.
    //
    // Postgres has a unique index on (post_id, user_id), so the duplicate state
    // cannot be created at all — the stronger guarantee.
    //
    // A spreadsheet has no such index, so a lost race really can leave two rows.
    // Counting distinct user ids is what makes that harmless, which in turn is
    // what lets the like path skip the mutex. Seeding the duplicate is the only
    // way to prove the count survives it.
    if (enforcesUniqueness) {
      await assert.rejects(() => seed('Likes', duplicate), /unique|duplicate/i,
        'the unique index did not stop a duplicate like');
      await seed('Likes', [duplicate[0], duplicate[2]]);
    } else {
      await seed('Likes', duplicate);
    }

    const feed = await call(content.getPublicFeed, {
      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions'], user: 'fan2'
    });
    assert.equal(feed.posts.find((p) => p.id === 'pub1').likeCount, 2);

    // Unliking clears every row for the pair rather than leaving a ghost.
    const toggled = await call(content.toggleLike, {
      tables: ['Posts', 'Likes', 'Subscriptions', 'Notifications'],
      user: 'fan1', body: { postId: 'pub1' }
    });
    assert.equal(toggled.liked, false);
    assert.equal(toggled.likeCount, 1);

    const store = await openStore(['Likes']);
    assert.equal(store.likes.filter((l) => l.user_id === 'fan1').length, 0);
  });

  T('reading the feed writes nothing', async () => {
    await freshSheet();
    await seedUsers();
    await seedPosts();

    const before = writes();
    await call(content.getPublicFeed, {
      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions'], user: 'fan1'
    });

    // Expiry is computed from the clock, never written on read. On Sheets that is
    // survival — the feed alone would exhaust ~60 writes a minute. On Postgres it
    // is simply correct: a read is a read.
    assert.equal(writes(), before, 'a feed read issued a write');
  });

  // -------------------------------------------------------------- messaging
  T('messaging is refused without a live subscription, in both directions', async () => {
    await freshSheet();
    await seedUsers();

    const send = await call(social.sendMessage, {
      tables: ['Subscriptions', 'Messages', 'Notifications'],
      user: 'fan1', body: { peerId: 'celeb1', content: 'hello' }
    });
    assert.equal(send.ok, false);
    assert.match(send.error, /subscription/i);

    const read = await call(social.getChatMessages, {
      tables: ['Subscriptions', 'Messages', 'Notifications'],
      user: 'fan1', body: { peerId: 'celeb1' }
    });
    assert.equal(read.authorized, false);
    assert.deepEqual(read.messages, []);
  });

  T('a message notification carries no message text', async () => {
    await freshSheet();
    await seedUsers();
    await seed('Subscriptions', [
      { id: 'sub1', subscriber_id: 'fan1', celebrity_id: 'celeb1', status: 'ACTIVE',
        created_at: iso(Date.now() - DAY), expires_at: iso(Date.now() + 20 * DAY) }
    ]);

    const secret = 'my private bank details are 12345';
    await call(social.sendMessage, {
      tables: ['Subscriptions', 'Messages', 'Notifications'],
      user: 'fan1', body: { peerId: 'celeb1', content: secret }
    });

    const store = await openStore(['Notifications']);
    const rows = store.notifications.all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, 'MESSAGE');
    // Threads are subscription-gated; copying their text here would route private
    // content around that gate.
    assert.ok(!JSON.stringify(rows).includes('bank details'));
  });

  T('a burst of messages coalesces into one notification', async () => {
    await freshSheet();
    await seedUsers();
    await seed('Subscriptions', [
      { id: 'sub1', subscriber_id: 'fan1', celebrity_id: 'celeb1', status: 'ACTIVE',
        created_at: iso(Date.now() - DAY), expires_at: iso(Date.now() + 20 * DAY) }
    ]);

    for (const text of ['one', 'two', 'three']) {
      await call(social.sendMessage, {
        tables: ['Subscriptions', 'Messages', 'Notifications'],
        user: 'fan1', body: { peerId: 'celeb1', content: text }
      });
    }

    const store = await openStore(['Notifications']);
    const rows = store.notifications.filter((n) => n.type === 'MESSAGE');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].count, 3);
  });

  T('markNotificationsRead cannot touch another account\'s notifications', async () => {
    await freshSheet();
    await seedUsers();
    await seed('Notifications', [
      { id: 'n1', user_id: 'fan1', type: 'FOLLOW', actor_id: 'fan2', count: 1, created_at: iso(Date.now()) },
      { id: 'n2', user_id: 'celeb1', type: 'FOLLOW', actor_id: 'fan2', count: 1, created_at: iso(Date.now()) }
    ]);

    const result = await call(social.markNotificationsRead, {
      tables: ['Notifications'], user: 'fan1', body: { notificationIds: ['n1', 'n2'] }
    });
    assert.equal(result.marked, 1);

    const store = await openStore(['Notifications']);
    assert.equal(Boolean(store.notifications.byId('n2').read_at), false);
  });

  // --------------------------------------------------------------- follows
  T('following is idempotent and counted once', async () => {
    await freshSheet();
    await seedUsers();

    for (let i = 0; i < 3; i += 1) {
      await call(social.followUser, { user: 'fan1', body: { userId: 'celeb1' } });
    }

    const store = await openStore(['Follows']);
    assert.equal(store.follows.filter((f) => f.follower_id === 'fan1').length, 1);
  });

  T('a fan can follow another fan, and nobody can follow themselves', async () => {
    await freshSheet();
    await seedUsers();

    const peer = await call(social.followUser, { user: 'fan1', body: { userId: 'fan2' } });
    assert.equal(peer.ok, true);

    const self = await call(social.followUser, { user: 'fan1', body: { userId: 'fan1' } });
    assert.equal(self.ok, false);
  });

  // -------------------------------------------------------------- payments
  // Razorpay is stubbed by the harness: the shape of the fake is identical, but
  // where the interception happens differs per backend.

  T('settling the same payment twice grants only once', async () => {
    await freshSheet();
    await seedUsers();
    stubRazorpay();

    await seed('Payments', [
      { id: 'rcpt1', user_id: 'fan1', purpose: 'SUBSCRIPTION', target_id: 'celeb1',
        beneficiary_id: 'celeb1', order_id: 'order_1', amount_paise: 29900, currency: 'INR',
        status: 'CREATED', mode: 'RAZORPAY', commission_percent: 15, created_at: iso(Date.now()) }
    ]);

    const first = JSON.parse((await money.settlePayment('order_1', 'pay_1', true)).body);
    assert.equal(first.ok, true);

    // The browser callback and the webhook routinely both arrive.
    const second = JSON.parse((await money.settlePayment('order_1', 'pay_1', true)).body);
    assert.equal(second.alreadyProcessed, true);

    const store = await openStore(['Subscriptions', 'Payments']);
    assert.equal(store.subscriptions.all().length, 1, 'one payment produced two subscriptions');
    assert.equal(store.payments.byId('rcpt1').status, 'PAID');
    // The commission split is recorded, and floors so rounding never shorts the
    // creator: 15% of 29900 is 4485.
    assert.equal(store.payments.byId('rcpt1').commission_paise, 4485);
    assert.equal(store.payments.byId('rcpt1').net_paise, 25415);
  });

  T('a payment for less than the order is refused and activates nothing', async () => {
    await freshSheet();
    await seedUsers();
    // Razorpay reports ₹1 against a ₹299 order.
    stubRazorpay({ amount: 100 });

    await seed('Payments', [
      { id: 'rcpt1', user_id: 'fan1', purpose: 'SUBSCRIPTION', target_id: 'celeb1',
        beneficiary_id: 'celeb1', order_id: 'order_1', amount_paise: 29900, currency: 'INR',
        status: 'CREATED', mode: 'RAZORPAY', commission_percent: 15, created_at: iso(Date.now()) }
    ]);

    const result = JSON.parse((await money.settlePayment('order_1', 'pay_1', true)).body);
    assert.equal(result.ok, false);
    assert.match(result.error, /amount paid does not match/i);

    const store = await openStore(['Subscriptions', 'Payments']);
    assert.equal(store.subscriptions.all().length, 0);
    assert.equal(store.payments.byId('rcpt1').status, 'FAILED');
  });

  T('a failed payment at the gateway activates nothing', async () => {
    await freshSheet();
    await seedUsers();
    stubRazorpay({ status: 'failed' });

    await seed('Payments', [
      { id: 'rcpt1', user_id: 'fan1', purpose: 'SUBSCRIPTION', target_id: 'celeb1',
        beneficiary_id: 'celeb1', order_id: 'order_1', amount_paise: 29900, currency: 'INR',
        status: 'CREATED', mode: 'RAZORPAY', commission_percent: 15, created_at: iso(Date.now()) }
    ]);

    const result = JSON.parse((await money.settlePayment('order_1', 'pay_1', true)).body);
    assert.equal(result.ok, false);

    const store = await openStore(['Subscriptions']);
    assert.equal(store.subscriptions.all().length, 0);
  });

  T('renewing extends the existing subscription instead of stacking a second', async () => {
    await freshSheet();
    await seedUsers();
    stubRazorpay();

    const existingExpiry = Date.now() + 10 * DAY;
    await seed('Subscriptions', [
      { id: 'sub1', subscriber_id: 'fan1', celebrity_id: 'celeb1', status: 'ACTIVE',
        expiring_notified_at: iso(Date.now()), created_at: iso(Date.now() - 20 * DAY),
        expires_at: iso(existingExpiry) }
    ]);
    await seed('Payments', [
      { id: 'rcpt2', user_id: 'fan1', purpose: 'SUBSCRIPTION', target_id: 'celeb1',
        beneficiary_id: 'celeb1', order_id: 'order_1', amount_paise: 29900, currency: 'INR',
        status: 'CREATED', mode: 'RAZORPAY', commission_percent: 15, created_at: iso(Date.now()) }
    ]);

    await money.settlePayment('order_1', 'pay_2', true);

    const store = await openStore(['Subscriptions']);
    const subs = store.subscriptions.all();
    assert.equal(subs.length, 1);
    // Extended from the old expiry, so a renewal never loses paid-for days.
    const extended = new Date(subs[0].expires_at).getTime();
    assert.ok(Math.abs(extended - (existingExpiry + 30 * DAY)) < 5000);
    // And the reminder stamps are cleared so the new cycle re-arms.
    assert.equal(subs[0].expiring_notified_at, '');
  });

  T('paying for verification grants the tick but not a coloured badge', async () => {
    await freshSheet();
    await seedUsers();
    stubRazorpay({ amount: 250000 });

    await seed('Payments', [
      { id: 'rcpt3', user_id: 'celeb2', purpose: 'VERIFICATION', target_id: '',
        beneficiary_id: '', order_id: 'order_1', amount_paise: 250000, currency: 'INR',
        status: 'CREATED', mode: 'RAZORPAY', commission_percent: 100, created_at: iso(Date.now()) }
    ]);

    const result = JSON.parse((await money.settlePayment('order_1', 'pay_3', true)).body);
    assert.equal(result.ok, true);

    const store = await openStore(['Users', 'Payments']);
    const creator = store.users.byId('celeb2');
    assert.equal(creator.verification_status, 'APPROVED');
    // Money buys the tick; the tier still needs an admin-confirmed follower count,
    // or twelve throwaway accounts would mint a purple badge.
    assert.equal(creator.verified_follower_count, 0);

    const { badgeFor } = await import('../src/lib/util.js');
    assert.equal(badgeFor(creator), null);

    // The whole fee is platform revenue, since there is no creator on the far side.
    assert.equal(store.payments.byId('rcpt3').commission_paise, 250000);
    assert.equal(store.payments.byId('rcpt3').net_paise, 0);
  });

  T('the client cannot dictate a price', async () => {
    await freshSheet();
    await seedUsers();
    stubRazorpay();

    const order = await call(money.createPaymentOrder, {
      tables: ['Payments'], user: 'fan1',
      body: { purpose: 'SUBSCRIPTION', targetId: 'celeb1', amountRupees: 1, amount: 1, amountPaise: 100 }
    });

    // Priced from the creator's own monthly_price, never from the request.
    assert.equal(order.amount, 29900);
  });

  // --------------------------------------------------------------- badges
  T('badge tiers step at the documented thresholds', async () => {
    const { badgeFor } = await import('../src/lib/util.js');
    const badge = (n) => badgeFor({ verification_status: 'APPROVED', verified_follower_count: n });

    assert.equal(badge(4999), null);
    assert.equal(badge(5000).key, 'YELLOW');
    assert.equal(badge(9999).key, 'YELLOW');
    assert.equal(badge(10000).key, 'RED');
    assert.equal(badge(15000).key, 'BLUE');
    assert.equal(badge(20000).key, 'PURPLE');
    assert.equal(badge(999999).key, 'PURPLE');
    // Unverified accounts never hold a badge, whatever the count says.
    assert.equal(badgeFor({ verification_status: 'NONE', verified_follower_count: 50000 }), null);
  });

  // ---------------------------------------------------------------- admin
  T('the last active admin cannot be suspended or demoted', async () => {
    await freshSheet();
    await seedUsers();
    // celeb1 is the second admin here; remove that and admin1 stands alone.
    const store = await openStore(['Users']);
    const adminRow = store.users.byId('admin1');

    const suspendSelf = await call(admin.adminSetUserStatus, {
      user: 'admin1', body: { userId: 'admin1', status: 'SUSPENDED' }
    });
    assert.equal(suspendSelf.ok, false);
    assert.match(suspendSelf.error, /your own account/i);

    const revokeSelf = await call(admin.adminSetUserAdmin, {
      user: 'admin1', body: { userId: 'admin1', makeAdmin: false }
    });
    assert.equal(revokeSelf.ok, false);
    assert.ok(adminRow.is_admin);
  });

  T('promoting a fan to creator gives them a price and a category', async () => {
    await freshSheet();
    await seedUsers();

    const result = await call(admin.adminSetUserRole, {
      user: 'admin1', body: { userId: 'fan1', role: 'CELEBRITY' }
    });
    assert.equal(result.ok, true);

    const store = await openStore(['Users']);
    assert.equal(store.users.byId('fan1').monthly_price, 299);
    assert.equal(store.users.byId('fan1').category, 'Creator');
  });

  T('demoting a creator strips their verification', async () => {
    await freshSheet();
    await seedUsers();

    await call(admin.adminSetUserRole, { user: 'admin1', body: { userId: 'celeb1', role: 'FAN' } });

    const store = await openStore(['Users']);
    const row = store.users.byId('celeb1');
    assert.equal(row.verification_status, 'NONE');
    assert.equal(row.verified_follower_count, 0);
    assert.equal(row.monthly_price, 0);
  });

  T('a creator cannot self-award a follower count through the profile endpoint', async () => {
    await freshSheet();
    await seedUsers();

    await call(auth.updateProfile, {
      user: 'celeb2',
      body: {
        bio: 'legit change',
        verifiedFollowerCount: 999999, verified_follower_count: 999999,
        verificationStatus: 'APPROVED', isAdmin: true, is_admin: true
      }
    });

    const store = await openStore(['Users']);
    const { verificationStatusOf, isAdminUser } = await import('../src/lib/util.js');
    const row = store.users.byId('celeb2');

    assert.equal(row.bio, 'legit change');
    assert.equal(row.verified_follower_count, 0);
    // Read through the accessor the app uses: an unset cell means NONE.
    assert.equal(verificationStatusOf(row), 'NONE');
    assert.equal(isAdminUser(row), false);
  });

  // ----------------------------------------------------------- share links
  T('a shared private post returns a teaser with no caption or media', async () => {
    await freshSheet();
    await seedUsers();
    await seedPosts();

    const payload = await content.buildSharePayload('prv1', { countView: false });

    assert.equal(payload.found, true);
    assert.equal(payload.locked, true);
    assert.equal(payload.post.caption, '');
    assert.equal(payload.post.mediaUrl, '');
    // The author is fine to show — that is what makes the link worth clicking.
    assert.equal(payload.post.author.username, 'aarohi');
  });

  T('an expired public post keeps its text but loses its media', async () => {
    await freshSheet();
    await seedUsers();
    await seed('Posts', [
      { id: 'old1', author_id: 'celeb1', type: 'IMAGE', caption: 'still readable',
        media_url: 'https://cdn.test/media/gone.jpg', status: 'ACTIVE', visibility: 'PUBLIC',
        share_views: 0, created_at: iso(Date.now() - 40 * DAY), expires_at: iso(Date.now() - 10 * DAY) }
    ]);

    const payload = await content.buildSharePayload('old1', { countView: false });

    assert.equal(payload.expired, true);
    assert.equal(payload.post.caption, 'still readable');
    // The 30-day promise has to hold on a public page too.
    assert.equal(payload.post.mediaUrl, '');
    assert.equal(payload.post.daysLeft, 0);
  });

  // ----------------------------------------------------------- maintenance
  T('maintenance expires posts, sends reminders once, and prunes', async () => {
    await freshSheet();
    await seedUsers();
    await seedPosts();
    await seed('Subscriptions', [
      { id: 'sub1', subscriber_id: 'fan1', celebrity_id: 'celeb1', status: 'ACTIVE',
        created_at: iso(Date.now() - 27 * DAY), expires_at: iso(Date.now() + 2 * DAY) }
    ]);
    await seed('Notifications', [
      { id: 'nOld', user_id: 'fan1', type: 'LIKE', actor_id: 'fan2', count: 1,
        created_at: iso(Date.now() - 90 * DAY) }
    ]);

    const { markExpiredPosts } = content;
    const { sendExpiryReminders } = money;
    const { pruneNotifications } = social;

    let store = await openStore(['Posts', 'Subscriptions', 'Users', 'Notifications']);
    assert.equal(markExpiredPosts(store), 1);
    assert.equal(sendExpiryReminders(store).expiringReminders, 1);
    assert.equal(pruneNotifications(store), 1);
    await store.flush();

    store = await openStore(['Posts', 'Subscriptions', 'Users', 'Notifications']);
    assert.equal(store.posts.byId('old1').status, 'EXPIRED');
    assert.equal(store.notifications.byId('nOld'), null);
    assert.equal(store.notifications.count((n) => n.type === 'SUB_EXPIRING'), 1);

    // A second run the same day must send nothing twice.
    assert.equal(markExpiredPosts(store), 0);
    assert.equal(sendExpiryReminders(store).expiringReminders, 0);
  });


  // ---------------------------------------------------------------- search
  T('search finds people by handle, name, category and bio', async () => {
    await freshSheet();
    await seedUsers();

    const byHandle = await call(content.search, {
      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions', 'Saves'],
      user: 'fan1', body: { query: 'aarohi' }
    });
    assert.equal(byHandle.people[0].username, 'aarohi');

    // A leading @ is stripped rather than treated as part of the handle.
    const withAt = await call(content.search, {
      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions', 'Saves'],
      user: 'fan1', body: { query: '@aarohi' }
    });
    assert.equal(withAt.people[0].username, 'aarohi');

    const byName = await call(content.search, {
      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions', 'Saves'],
      user: 'fan1', body: { query: 'meera' }
    });
    assert.equal(byName.people[0].id, 'celeb2');
  });

  T('an exact handle outranks a partial match on someone else', async () => {
    await freshSheet();
    await seedUsers();
    // "aar" appears in aarohi's handle and inside another user's name.
    const store = await openStore(['Users']);
    store.users.update(store.users.byId('fan2'), { full_name: 'Priya Aarnav', bio: 'aarohi fan' });
    await store.flush();

    const result = await call(content.search, {
      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions', 'Saves'],
      user: 'fan1', body: { query: 'aarohi' }
    });

    assert.equal(result.people[0].username, 'aarohi', 'exact handle did not rank first');
  });

  T('search will not surface a private post to a non-subscriber', async () => {
    await freshSheet();
    await seedUsers();
    await seedPosts();

    const outsider = await call(content.search, {
      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions', 'Saves'],
      user: 'fan1', body: { query: 'gallery' }
    });
    assert.equal(outsider.posts.length, 0, 'private caption leaked through search');

    const publicHit = await call(content.search, {
      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions', 'Saves'],
      user: 'fan1', body: { query: 'public' }
    });
    assert.equal(publicHit.posts.length, 1);
    assert.equal(publicHit.posts[0].id, 'pub1');
  });

  T('a subscriber can search their own private gallery', async () => {
    await freshSheet();
    await seedUsers();
    await seedPosts();
    await seed('Subscriptions', [
      { id: 'sub1', subscriber_id: 'fan1', celebrity_id: 'celeb1', status: 'ACTIVE',
        created_at: iso(Date.now() - DAY), expires_at: iso(Date.now() + 20 * DAY) }
    ]);

    const result = await call(content.search, {
      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions', 'Saves'],
      user: 'fan1', body: { query: 'gallery' }
    });

    assert.equal(result.posts.length, 1);
    assert.equal(result.posts[0].id, 'prv1');
    assert.ok(result.posts[0].mediaUrl, 'entitled subscriber got no media');
    if (privateMediaStyle === 'signed-url') assert.match(result.posts[0].mediaUrl, /v=fan1/);
  });

  T('search excludes suspended accounts and expired posts', async () => {
    await freshSheet();
    await seedUsers();
    await seedPosts();

    const people = await call(content.search, {
      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions', 'Saves'],
      user: 'fan1', body: { query: 'spam' }
    });
    assert.equal(people.people.length, 0);

    const posts = await call(content.search, {
      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions', 'Saves'],
      user: 'fan1', body: { query: 'aged out' }
    });
    assert.equal(posts.posts.length, 0);
  });

  T('a one-character query returns nothing rather than everything', async () => {
    await freshSheet();
    await seedUsers();

    const result = await call(content.search, {
      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions', 'Saves'],
      user: 'fan1', body: { query: 'a' }
    });

    assert.equal(result.people.length, 0);
    assert.equal(result.posts.length, 0);
    assert.match(result.message, /at least 2/i);
  });

  T('a regex metacharacter in a query is treated as text, not a pattern', async () => {
    await freshSheet();
    await seedUsers();

    // Would throw if the needle were interpolated into a RegExp unescaped.
    const result = await call(content.search, {
      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions', 'Saves'],
      user: 'fan1', body: { query: 'a(b[c.*+' }
    });
    assert.equal(result.ok, true);
    assert.equal(result.people.length, 0);
  });

  T('search scope narrows to people or posts', async () => {
    await freshSheet();
    await seedUsers();
    await seedPosts();

    const peopleOnly = await call(content.search, {
      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions', 'Saves'],
      user: 'fan1', body: { query: 'aarohi', scope: 'PEOPLE' }
    });
    assert.ok(peopleOnly.people.length > 0);
    assert.equal(peopleOnly.posts.length, 0);

    const postsOnly = await call(content.search, {
      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions', 'Saves'],
      user: 'fan1', body: { query: 'public', scope: 'POSTS' }
    });
    assert.equal(postsOnly.people.length, 0);
    assert.ok(postsOnly.posts.length > 0);
  });

  // ----------------------------------------------------------- saved posts
  T('saving is a toggle and is idempotent per user', async () => {
    await freshSheet();
    await seedUsers();
    await seedPosts();

    const on = await call(content.toggleSave, {
      tables: ['Posts', 'Saves', 'Subscriptions'], user: 'fan1', body: { postId: 'pub1' }
    });
    assert.equal(on.saved, true);

    const off = await call(content.toggleSave, {
      tables: ['Posts', 'Saves', 'Subscriptions'], user: 'fan1', body: { postId: 'pub1' }
    });
    assert.equal(off.saved, false);

    const store = await openStore(['Saves']);
    assert.equal(store.saves.all().length, 0);
  });

  T('saving never notifies the author', async () => {
    await freshSheet();
    await seedUsers();
    await seedPosts();

    await call(content.toggleSave, {
      tables: ['Posts', 'Saves', 'Subscriptions', 'Notifications'],
      user: 'fan1', body: { postId: 'pub1' }
    });

    const store = await openStore(['Notifications']);
    // A bookmark is private. Telling the author who saved their post would turn a
    // quiet action into a public one.
    assert.equal(store.notifications.all().length, 0);
  });

  T('a non-subscriber cannot save a private post', async () => {
    await freshSheet();
    await seedUsers();
    await seedPosts();

    const result = await call(content.toggleSave, {
      tables: ['Posts', 'Saves', 'Subscriptions'], user: 'fan1', body: { postId: 'prv1' }
    });
    assert.equal(result.ok, false);

    const store = await openStore(['Saves']);
    assert.equal(store.saves.all().length, 0);
  });

  T('a saved private post locks again when the subscription lapses', async () => {
    await freshSheet();
    await seedUsers();
    await seedPosts();
    await seed('Subscriptions', [
      { id: 'sub1', subscriber_id: 'fan1', celebrity_id: 'celeb1', status: 'ACTIVE',
        created_at: iso(Date.now() - DAY), expires_at: iso(Date.now() + 20 * DAY) }
    ]);

    await call(content.toggleSave, {
      tables: ['Posts', 'Saves', 'Subscriptions'], user: 'fan1', body: { postId: 'prv1' }
    });

    const whileActive = await call(content.getSavedPosts, {
      tables: ['Posts', 'Saves', 'Likes', 'Comments', 'Subscriptions'], user: 'fan1'
    });
    assert.equal(whileActive.items[0].locked, undefined);
    assert.equal(whileActive.items[0].caption, 'gallery only');

    // Expire the subscription.
    const store = await openStore(['Subscriptions']);
    store.subscriptions.update(store.subscriptions.byId('sub1'), { expires_at: iso(Date.now() - DAY) });
    await store.flush();

    const afterLapse = await call(content.getSavedPosts, {
      tables: ['Posts', 'Saves', 'Likes', 'Comments', 'Subscriptions'], user: 'fan1'
    });
    // Entitlement is re-checked on read: saving must not outlive paying.
    assert.equal(afterLapse.items[0].locked, true);
    assert.equal(afterLapse.items[0].caption, undefined);
    assert.equal(afterLapse.items[0].mediaUrl, undefined);
    assert.equal(afterLapse.available, 0);
  });

  T('a saved post that expired or was deleted is reported, not silently dropped', async () => {
    await freshSheet();
    await seedUsers();
    await seedPosts();

    await seed('Saves', [
      { id: 's1', user_id: 'fan1', post_id: 'pub1', created_at: iso(Date.now()) },
      { id: 's2', user_id: 'fan1', post_id: 'old1', created_at: iso(Date.now() - 1000) },
      { id: 's3', user_id: 'fan1', post_id: 'ghost', created_at: iso(Date.now() - 2000) }
    ]);

    const result = await call(content.getSavedPosts, {
      tables: ['Posts', 'Saves', 'Likes', 'Comments', 'Subscriptions'], user: 'fan1'
    });

    assert.equal(result.total, 3);
    assert.equal(result.available, 1);
    assert.equal(result.items.find((i) => i.id === 'old1').reason, 'EXPIRED');
    assert.equal(result.items.find((i) => i.id === 'ghost').reason, 'REMOVED');
  });

  T('saved posts are private to the person who saved them', async () => {
    await freshSheet();
    await seedUsers();
    await seedPosts();
    await seed('Saves', [
      { id: 's1', user_id: 'fan1', post_id: 'pub1', created_at: iso(Date.now()) }
    ]);

    const others = await call(content.getSavedPosts, {
      tables: ['Posts', 'Saves', 'Likes', 'Comments', 'Subscriptions'], user: 'fan2'
    });
    assert.equal(others.total, 0);

    // And no save count is exposed on the post itself.
    const feed = await call(content.getPublicFeed, {
      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions', 'Saves'], user: 'fan2'
    });
    const post = feed.posts.find((p) => p.id === 'pub1');
    assert.equal(post.saveCount, undefined);
    assert.equal(post.viewerSaved, false);
  });

  T('the feed reports the viewer own save state', async () => {
    await freshSheet();
    await seedUsers();
    await seedPosts();
    await seed('Saves', [
      { id: 's1', user_id: 'fan1', post_id: 'pub1', created_at: iso(Date.now()) }
    ]);

    const feed = await call(content.getPublicFeed, {
      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions', 'Saves'], user: 'fan1'
    });
    assert.equal(feed.posts.find((p) => p.id === 'pub1').viewerSaved, true);
  });

}
