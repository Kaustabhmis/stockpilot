import { transact } from '../lib/store.js';
import {
  VALIDATION, PASSWORD_MIN_LENGTH, CHAT_THEMES, DEFAULT_CHAT_THEME
} from '../lib/config.js';
import {
  ok, fail, newId, cleanText, sanitizeUrl, publicUser, userStatusOf,
  verificationStatusOf, chatThemeKeyOf, badgeFor, isAdminUser, toMillis
} from '../lib/util.js';
import {
  hashPassword, newSalt, verifyPassword, createSession, revokeSession,
  loginThrottled, recordFailedLogin, clearLoginThrottle
} from '../lib/auth.js';
import { livePost, liveSubscription } from '../lib/store.js';

function validateSignUp(payload = {}) {
  const fullName = cleanText(payload.fullName, 60);
  const username = cleanText(payload.username, 20).toLowerCase();
  const email = cleanText(payload.email, 120).toLowerCase();
  const password = String(payload.password || '');
  const role = payload.role === 'CELEBRITY' ? 'CELEBRITY' : 'FAN';

  if (fullName.length < 2) return { error: 'Please enter your full name.' };
  if (!VALIDATION.username.test(username)) {
    return { error: 'Username must be 3-20 characters: lowercase letters, numbers or underscore.' };
  }
  if (!VALIDATION.email.test(email)) return { error: 'Please enter a valid email address.' };
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  return { fullName, username, email, password, role };
}

export async function signUp({ body }) {
  const input = validateSignUp(body?.payload || body);
  if (input.error) return fail(input.error);

  const salt = newSalt();
  const passwordHash = await hashPassword(input.password, salt);
  const id = newId(input.role === 'CELEBRITY' ? 'celeb' : 'fan');

  /**
   * Postgres enforced username and email uniqueness with a unique index; a
   * spreadsheet has no such thing, so the check has to be made true by holding
   * the lock across read and write. Without it two simultaneous signups both
   * read "free" and both claim the same name.
   *
   * Deliberately re-reads inside the lock rather than trusting the request's
   * earlier snapshot, which is the whole point of taking it.
   */
  const created = await transact(['Users'], async (store) => {
    const taken = store.users.find((row) => String(row.email).toLowerCase() === input.email);
    if (taken) return { error: 'An account already exists for that email.' };

    const named = store.users.find((row) => String(row.username).toLowerCase() === input.username);
    if (named) return { error: 'That username is taken.' };

    return {
      row: store.users.insert({
        id,
        full_name: input.fullName,
        username: input.username,
        email: input.email,
        password_hash: passwordHash,
        password_salt: salt,
        role: input.role,
        category: input.role === 'CELEBRITY' ? 'Creator' : '',
        monthly_price: input.role === 'CELEBRITY' ? 299 : 0,
        chat_theme: DEFAULT_CHAT_THEME,
        verification_status: 'NONE',
        status: 'ACTIVE',
        created_at: new Date().toISOString()
      })
    };
  });

  if (created.error) return fail(created.error);
  return ok({ token: await createSession(created.row.id), user: publicUser(created.row) });
}

export async function logIn({ store, body }) {
  const email = cleanText(body?.email, 120).toLowerCase();
  const password = String(body?.password || '');
  if (!email || !password) return fail('Enter your email and password.');

  if (await loginThrottled(email)) {
    return fail('Too many failed attempts. Try again in 15 minutes.');
  }

  const row = store.users.find((user) => String(user.email).toLowerCase() === email);

  // Identical response either way, so the endpoint cannot be used to discover
  // which addresses have accounts.
  const generic = 'Incorrect email or password.';

  if (!row) {
    await recordFailedLogin(email);
    return fail(generic);
  }

  const valid = await verifyPassword(password, row.password_salt, row.password_hash);
  if (!valid) {
    await recordFailedLogin(email);
    return fail(generic);
  }

  const status = userStatusOf(row);
  if (status === 'DELETED') {
    await recordFailedLogin(email);
    return fail(generic);
  }
  if (status !== 'ACTIVE') {
    return fail('This account is suspended.' + (row.status_reason ? ` Reason: ${row.status_reason}` : ''));
  }

  await clearLoginThrottle(email);
  return ok({ token: await createSession(row.id), user: publicUser(row) });
}

export async function logOut({ token }) {
  if (token) await revokeSession(token);
  return ok();
}

export async function resumeSession({ user }) {
  return ok({ user: publicUser(user) });
}

// ------------------------------------------------------------- profile
export async function getProfile({ store, user: viewer, body }) {
  const targetId = body?.userId || viewer.id;

  const target = store.users.byId(targetId);
  if (!target) return fail('That profile does not exist.');

  // Deleted accounts stay visible to admins for moderation, nobody else.
  if (userStatusOf(target) === 'DELETED' && !isAdminUser(viewer)) {
    return fail('That profile does not exist.');
  }

  const now = Date.now();
  const authored = store.posts.filter((post) => post.author_id === target.id && livePost(post, now));
  const publicPosts = authored.filter((post) => post.visibility !== 'SUBSCRIBERS');
  const galleryCount = authored.length - publicPosts.length;

  // Counted as distinct actors rather than as rows. Nothing stops a spreadsheet
  // holding two identical follow rows, so counting rows would let a double
  // request inflate a follower count.
  const distinct = (rows, key) => new Set(rows.map((row) => row[key])).size;

  const followers = store.follows.filter((f) => f.followee_id === target.id);
  const following = store.follows.filter((f) => f.follower_id === target.id);
  const subscribers = store.subscriptions.filter(
    (s) => s.celebrity_id === target.id && liveSubscription(s, now));
  const subscriptions = store.subscriptions.filter(
    (s) => s.subscriber_id === target.id && liveSubscription(s, now));

  const likesByPost = countBy(store.likes, 'post_id', 'user_id');
  const commentsByPost = countBy(
    store.comments.filter((c) => String(c.status).toUpperCase() === 'ACTIVE'), 'post_id', 'id');
  const viewerLikes = new Set(
    store.likes.filter((l) => l.user_id === viewer.id).map((l) => l.post_id));

  const profile = publicUser(target);
  profile.galleryCount = galleryCount;
  profile.stats = {
    posts: publicPosts.length,
    followers: distinct(followers, 'follower_id'),
    following: distinct(following, 'followee_id'),
    subscribers: distinct(subscribers, 'subscriber_id'),
    subscriptions: distinct(subscriptions, 'celebrity_id')
  };
  profile.isOwnProfile = target.id === viewer.id;
  profile.viewerIsAdmin = isAdminUser(viewer);
  profile.viewerFollows = followers.some((f) => f.follower_id === viewer.id);
  profile.viewerIsSubscribed = subscribers.some((s) => s.subscriber_id === viewer.id);

  // Only public posts here; the private gallery is fetched separately so it can
  // return locked placeholders without this endpoint having to reason about
  // entitlement twice.
  profile.posts = publicPosts
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
    .map((post) => ({
      id: post.id,
      type: post.type,
      caption: post.caption,
      mediaUrl: sanitizeUrl(post.media_url),
      createdAt: post.created_at,
      expiresAt: post.expires_at,
      likeCount: likesByPost.get(post.id) || 0,
      commentCount: commentsByPost.get(post.id) || 0,
      viewerLiked: viewerLikes.has(post.id)
    }));

  return ok({ profile });
}

/** Distinct-value counts grouped by a column, in one pass. */
export function countBy(rows, groupKey, distinctKey) {
  const sets = new Map();
  for (const row of rows) {
    const group = row[groupKey];
    if (!sets.has(group)) sets.set(group, new Set());
    sets.get(group).add(row[distinctKey]);
  }
  const counts = new Map();
  for (const [group, set] of sets) counts.set(group, set.size);
  return counts;
}

export async function updateProfile({ store, user, body }) {
  const input = body?.payload || body || {};
  const patch = {};

  const fullName = cleanText(input.fullName, 60);
  if (fullName) {
    if (fullName.length < 2) return fail('Please enter your full name.');
    patch.full_name = fullName;
  }

  const username = cleanText(input.username, 20).toLowerCase();
  const changingUsername = Boolean(username) && username !== String(user.username).toLowerCase();
  if (changingUsername && !VALIDATION.username.test(username)) {
    return fail('Username must be 3-20 characters: lowercase letters, numbers or underscore.');
  }

  if (input.bio !== undefined) patch.bio = cleanText(input.bio, 280);

  if (input.avatarUrl !== undefined) {
    const avatar = cleanText(input.avatarUrl, 500);
    if (avatar && !sanitizeUrl(avatar)) return fail('Avatar must be an http(s) image URL.');
    patch.avatar_url = sanitizeUrl(avatar);
  }

  if (input.bannerUrl !== undefined) {
    const banner = cleanText(input.bannerUrl, 500);
    if (banner && !sanitizeUrl(banner)) return fail('Banner must be an http(s) image URL.');
    patch.banner_url = sanitizeUrl(banner);
  }

  // Creator-only fields, ignored for fans rather than silently accepted. Note
  // that verification status, follower count and admin are absent by design:
  // this endpoint can never be used to self-promote.
  if (user.role === 'CELEBRITY') {
    if (input.category !== undefined) patch.category = cleanText(input.category, 40) || 'Creator';
    if (input.monthlyPrice !== undefined) {
      const price = Number(input.monthlyPrice);
      if (!Number.isFinite(price) || price < 0 || price > 100000) {
        return fail('Monthly price must be between 0 and 100000.');
      }
      patch.monthly_price = Math.round(price);
    }
  }

  if (!changingUsername) {
    if (!Object.keys(patch).length) return ok({ user: publicUser(user) });
    store.users.update(user, patch);
    return ok({ user: publicUser(user) });
  }

  // A username change is the one profile edit that can collide with another
  // account, so it alone pays for the lock.
  const result = await transact(['Users'], async (fresh) => {
    const taken = fresh.users.find(
      (row) => String(row.username).toLowerCase() === username && row.id !== user.id);
    if (taken) return { error: 'That username is taken.' };

    const row = fresh.users.byId(user.id);
    if (!row) return { error: 'That account no longer exists.' };

    fresh.users.update(row, { ...patch, username });
    return { row };
  });

  if (result.error) return fail(result.error);

  // Keep the request's own copy in step, so the response reflects the write.
  Object.assign(user, patch, { username });
  return ok({ user: publicUser(result.row) });
}

export async function changePassword({ store, user, body }) {
  const current = String(body?.currentPassword || '');
  const next = String(body?.newPassword || '');

  const valid = await verifyPassword(current, user.password_salt, user.password_hash);
  if (!valid) return fail('Your current password is incorrect.');
  if (next.length < PASSWORD_MIN_LENGTH) {
    return fail(`New password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }

  // Re-salting on change means a stolen old hash cannot be reused.
  const salt = newSalt();
  store.users.update(user, { password_salt: salt, password_hash: await hashPassword(next, salt) });

  return ok({ message: 'Password updated.' });
}

// ---------------------------------------------------------- chat themes
export async function getChatThemes({ user }) {
  return ok({ themes: CHAT_THEMES, current: chatThemeKeyOf(user) });
}

export async function setChatTheme({ store, user, body }) {
  const key = String(body?.themeKey || '').toUpperCase();
  const theme = CHAT_THEMES.find((t) => t.key === key);
  if (!theme) return fail('Unknown chat theme.');

  store.users.update(user, { chat_theme: key });
  return ok({ theme, message: `${theme.label} theme applied.` });
}

export { badgeFor, verificationStatusOf };
