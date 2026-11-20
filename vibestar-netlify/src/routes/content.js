import { openStore, livePost, liveSubscription } from '../lib/store.js';
import {
  POST_TTL_DAYS, DAY_MS, COMMENT_MAX_LENGTH, SCORE_WEIGHTS, env
} from '../lib/config.js';
import {
  ok, fail, newId, cleanText, sanitizeUrl, publicUser, postScore,
  recencyWeight, userStatusOf, isAdminUser, toMillis
} from '../lib/util.js';
import { presentPrivateMedia } from '../lib/platform.js';
import { emitNotification } from '../lib/notify.js';
import { countBy } from './auth.js';

/**
 * EXPIRY IS A PROPERTY OF THE CLOCK, NOT OF A STORED FLAG.
 *
 * The Postgres build flipped elapsed posts to EXPIRED on every feed read. On a
 * spreadsheet that would be a write on every read, against a quota of about
 * sixty writes a minute for the whole site — the feed alone would exhaust it.
 *
 * So `livePost` compares expires_at to now, and the stored status is only
 * tidied up by the scheduled maintenance job. Readers get the right answer
 * immediately either way; the sheet just catches up later.
 */
export function markExpiredPosts(store, now = Date.now()) {
  const stale = store.posts.filter(
    (post) => String(post.status).toUpperCase() === 'ACTIVE'
           && new Date(post.expires_at).getTime() <= now);

  stale.forEach((post) => store.posts.update(post, { status: 'EXPIRED' }));
  return stale.length;
}

/**
 * Whether a viewer may see a subscriber-only post: the author, an active
 * subscriber, or an admin. Everyone else gets a locked placeholder.
 */
function entitledTo(post, viewer, subscribedTo) {
  if (post.visibility !== 'SUBSCRIBERS') return true;
  if (!viewer) return false;
  if (post.author_id === viewer.id) return true;
  if (isAdminUser(viewer)) return true;
  return subscribedTo.has(post.author_id);
}

/**
 * Private media is handed out as a short-lived signed URL bound to the viewer.
 * Without this the paywall would be decoration: /media/:key is otherwise a
 * public address, and anyone holding it would bypass the subscription.
 */
async function presentMedia(post, viewer, entitled) {
  // A Drive-backed private file has no http(s) URL at all, so sanitizeUrl would
  // reject it. Check visibility before sanitising.
  const raw = String(post.media_url || '');
  if (!raw) return '';

  if (post.visibility !== 'SUBSCRIBERS') return sanitizeUrl(raw);
  if (!entitled || !viewer) return '';

  // Netlify returns a short-lived signed URL; Apps Script returns a data URI,
  // because it cannot serve binary at all. Either way the bytes are reachable
  // only by a viewer the route has already checked.
  return presentPrivateMedia(raw, viewer.id);
}

/** The creators this viewer currently has a live subscription to. */
function subscribedSet(store, viewerId, now = Date.now()) {
  return new Set(
    store.subscriptions
      .filter((s) => s.subscriber_id === viewerId && liveSubscription(s, now))
      .map((s) => s.celebrity_id)
  );
}

function mapPost(post, counts) {
  return {
    id: post.id,
    authorId: post.author_id,
    type: post.type,
    caption: post.caption,
    mediaUrl: sanitizeUrl(post.media_url),
    visibility: post.visibility || 'PUBLIC',
    createdAt: post.created_at,
    expiresAt: post.expires_at,
    status: post.status,
    shareViews: Number(post.share_views) || 0,
    likeCount: counts.likes.get(post.id) || 0,
    commentCount: counts.comments.get(post.id) || 0,
    viewerLiked: counts.viewerLiked.has(post.id),
    viewerFollows: false,
    viewerIsSubscribed: false
  };
}

/**
 * Engagement counts for every post in one pass.
 *
 * Likes are counted as DISTINCT user ids, not as rows. A spreadsheet cannot
 * hold a unique index, so a genuine double tap can leave two like rows; making
 * the count distinct means that duplicate is harmless, which in turn means the
 * like path never has to take the lock. Correctness where it shows, and no
 * quota spent on the most frequent write in the app.
 */
function engagementCounts(store, viewerId) {
  return {
    likes: countBy(store.likes.all(), 'post_id', 'user_id'),
    comments: countBy(
      store.comments.filter((c) => String(c.status).toUpperCase() === 'ACTIVE'), 'post_id', 'id'),
    viewerLiked: new Set(
      store.likes.filter((l) => l.user_id === viewerId).map((l) => l.post_id))
  };
}

// ------------------------------------------------------------------ feed
export async function getPublicFeed({ store, user, body }) {
  const scope = String(body?.scope || 'ALL').toUpperCase();
  const viewerId = user?.id || null;
  const now = Date.now();

  const counts = engagementCounts(store, viewerId);
  const saved = savedSet(store, viewerId);

  const followed = new Set(
    store.follows.filter((f) => f.follower_id === viewerId).map((f) => f.followee_id));
  const subscribed = subscribedSet(store, viewerId, now);
  const authors = new Map(store.users.all().map((u) => [u.id, u]));

  const visible = store.posts.filter((post) => {
    if (!livePost(post, now)) return false;

    const author = authors.get(post.author_id);
    if (!author || userStatusOf(author) !== 'ACTIVE') return false;

    if (scope === 'FOLLOWING' && !followed.has(post.author_id)) return false;

    // A creator's private gallery never leaks into the feed. It is visible only
    // to the author and to people with a live subscription; everyone else
    // browses it as locked tiles on the profile instead.
    if (post.visibility === 'SUBSCRIBERS'
        && post.author_id !== viewerId
        && !subscribed.has(post.author_id)) return false;

    return true;
  });

  // presentMedia is async because one platform has to read bytes to build a data
  // URI. Resolved as a batch so the feed still costs one pass.
  const posts = await Promise.all(visible.map(async (post) => {
    const mapped = mapPost(post, counts);
    mapped.author = publicUser(authors.get(post.author_id));
    mapped.viewerFollows = followed.has(post.author_id);
    mapped.viewerIsSubscribed = subscribed.has(post.author_id);
    mapped.viewerSaved = saved.has(post.id);
    mapped.mediaUrl = await presentMedia(post, user, true);
    mapped.score = postScore(mapped) * recencyWeight(mapped.createdAt);
    return mapped;
  }));

  if (scope === 'FOLLOWING') {
    // A feed of people you chose belongs in the order it happened.
    posts.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  } else {
    // Discovery ranks by engagement, with recency breaking ties so a wall of
    // zero-engagement posts still surfaces newest-first.
    posts.sort((a, b) => (b.score - a.score) || (toMillis(b.createdAt) - toMillis(a.createdAt)));
  }

  return ok({ posts, scope, rankedBy: scope === 'FOLLOWING' ? 'RECENT' : 'TRENDING' });
}

/** Creator directory, ranked by engagement. */
export async function getCreators({ store, user }) {
  const viewerId = user?.id || null;
  const now = Date.now();

  const likesByPost = countBy(store.likes.all(), 'post_id', 'user_id');
  const commentsByPost = countBy(
    store.comments.filter((c) => String(c.status).toUpperCase() === 'ACTIVE'), 'post_id', 'id');

  const engagement = new Map();
  for (const post of store.posts.all()) {
    if (!livePost(post, now)) continue;
    const entry = engagement.get(post.author_id)
      || { likes: 0, comments: 0, shares: 0, raw: 0 };

    const likes = likesByPost.get(post.id) || 0;
    const comments = commentsByPost.get(post.id) || 0;
    const shares = Number(post.share_views) || 0;

    entry.likes += likes;
    entry.comments += comments;
    entry.shares += shares;
    entry.raw += likes * SCORE_WEIGHTS.like
               + comments * SCORE_WEIGHTS.comment
               + shares * SCORE_WEIGHTS.share;
    engagement.set(post.author_id, entry);
  }

  const followerCounts = countBy(store.follows.all(), 'followee_id', 'follower_id');
  const liveSubs = store.subscriptions.filter((s) => liveSubscription(s, now));
  const subscriberCounts = countBy(liveSubs, 'celebrity_id', 'subscriber_id');

  const viewerFollows = new Set(
    store.follows.filter((f) => f.follower_id === viewerId).map((f) => f.followee_id));
  const viewerSubs = new Set(
    liveSubs.filter((s) => s.subscriber_id === viewerId).map((s) => s.celebrity_id));

  const creators = store.users
    .filter((row) => row.role === 'CELEBRITY' && userStatusOf(row) === 'ACTIVE')
    .map((row) => {
      const stats = engagement.get(row.id) || { likes: 0, comments: 0, shares: 0, raw: 0 };
      const creator = publicUser(row);

      creator.followerCount = followerCounts.get(row.id) || 0;
      creator.subscriberCount = subscriberCounts.get(row.id) || 0;
      creator.viewerFollows = viewerFollows.has(row.id);
      creator.viewerIsSubscribed = viewerSubs.has(row.id);
      creator.isSelf = viewerId === row.id;
      creator.engagement = { likes: stats.likes, comments: stats.comments, shares: stats.shares };
      creator.score = Math.round(
        stats.raw
        + creator.followerCount * SCORE_WEIGHTS.follower
        + creator.subscriberCount * SCORE_WEIGHTS.subscriber
      );
      return creator;
    })
    .sort((a, b) => (b.score - a.score) || (b.subscriberCount - a.subscriberCount));

  // The top few earn a flag, but only having actually earned something —
  // otherwise a brand new platform "recommends" whoever sorts first at zero.
  creators.forEach((creator, index) => {
    creator.rank = index + 1;
    creator.recommended = index < 3 && creator.score > 0;
  });

  return ok({ creators, rankedBy: 'ENGAGEMENT' });
}

// -------------------------------------------------------------- posting
export async function createPost({ store, user, body }) {
  if (user.role !== 'CELEBRITY') return fail('Only creator accounts can publish posts.');

  const type = body?.type === 'VIDEO' ? 'VIDEO' : 'IMAGE';
  const visibility = String(body?.visibility || 'PUBLIC').toUpperCase() === 'SUBSCRIBERS'
    ? 'SUBSCRIBERS' : 'PUBLIC';
  const caption = cleanText(body?.caption, 2000);
  const rawUrl = String(body?.mediaUrl || '').trim();
  const mediaUrl = sanitizeUrl(rawUrl);

  if (!caption && !mediaUrl) return fail('Add a caption, or attach a photo or video.');
  if (rawUrl && !mediaUrl) return fail('Media URL must start with http:// or https://');

  const expiresAt = new Date(Date.now() + POST_TTL_DAYS * DAY_MS);
  store.posts.insert({
    id: newId('post'),
    author_id: user.id,
    type,
    caption,
    media_url: mediaUrl,
    status: 'ACTIVE',
    visibility,
    share_views: 0,
    created_at: new Date().toISOString(),
    expires_at: expiresAt.toISOString()
  });

  return ok({
    message: visibility === 'SUBSCRIBERS'
      ? 'Posted to your private gallery for 30 days.'
      : 'Post published for 30 days.',
    visibility,
    expiresAt: expiresAt.toISOString()
  });
}

export async function deletePost({ store, user, body }) {
  const post = store.posts.byId(String(body?.postId || ''));
  if (!post) return fail('That post no longer exists.');
  if (post.author_id !== user.id && !isAdminUser(user)) {
    return fail('You can only delete your own posts.');
  }

  store.posts.update(post, { status: 'DELETED' });
  return ok({ message: 'Post deleted.' });
}

// ---------------------------------------------------------------- likes
/**
 * A post this viewer may interact with, or null. A private post is only
 * reachable by the author, an active subscriber, or an admin — otherwise
 * someone could like or comment on a gallery they cannot see.
 */
function visiblePost(store, postId, viewer) {
  const post = store.posts.byId(String(postId || ''));
  if (!post || !livePost(post)) return null;

  const author = store.users.byId(post.author_id);
  if (!author || userStatusOf(author) !== 'ACTIVE') return null;

  return entitledTo(post, viewer, subscribedSet(store, viewer?.id)) ? post : null;
}

export async function toggleLike({ store, user, body }) {
  const post = visiblePost(store, body?.postId, user);
  if (!post) return fail('That post is no longer available.');

  const mine = store.likes.filter((row) => row.post_id === post.id && row.user_id === user.id);

  let liked;
  if (mine.length) {
    // removeWhere rather than remove: if a race once left two rows for this
    // pair, unliking should clear both rather than leave a ghost like behind.
    mine.forEach((row) => store.likes.remove(row));
    liked = false;
  } else {
    store.likes.insert({
      id: newId('like'),
      post_id: post.id,
      user_id: user.id,
      created_at: new Date().toISOString()
    });
    liked = true;
    emitNotification(store, post.author_id, 'LIKE', user.id, post.id);
  }

  const likeCount = new Set(
    store.likes.filter((row) => row.post_id === post.id).map((row) => row.user_id)).size;

  return ok({ liked, likeCount });
}

// ------------------------------------------------------------- comments
export async function addComment({ store, user, body }) {
  const post = visiblePost(store, body?.postId, user);
  if (!post) return fail('That post is no longer available.');

  const content = cleanText(body?.content, COMMENT_MAX_LENGTH);
  if (!content) return fail('Write something first.');

  const id = newId('cmt');
  const createdAt = new Date().toISOString();
  store.comments.insert({
    id, post_id: post.id, user_id: user.id, content, status: 'ACTIVE', created_at: createdAt
  });

  emitNotification(store, post.author_id, 'COMMENT', user.id, post.id);

  return ok({
    comment: { id, content, createdAt, author: publicUser(user), isOwn: true, canDelete: true }
  });
}

export async function getComments({ store, user, body }) {
  const post = visiblePost(store, body?.postId, user);
  if (!post) return fail('That post is no longer available.');

  const viewerIsAdmin = isAdminUser(user);
  const comments = store.comments
    .filter((row) => row.post_id === post.id && String(row.status).toUpperCase() === 'ACTIVE')
    .sort((a, b) => toMillis(a.created_at) - toMillis(b.created_at))
    .map((row) => {
      const author = store.users.byId(row.user_id);
      return {
        id: row.id,
        content: row.content,
        createdAt: row.created_at,
        // A suspended commenter's text stays but loses its clickable identity.
        author: author && userStatusOf(author) === 'ACTIVE' ? publicUser(author) : null,
        isOwn: row.user_id === user.id,
        // The post's author moderates their own thread, as does an admin.
        canDelete: row.user_id === user.id || post.author_id === user.id || viewerIsAdmin
      };
    });

  return ok({ comments, total: comments.length });
}

export async function deleteComment({ store, user, body }) {
  const row = store.comments.find(
    (c) => c.id === String(body?.commentId || '') && String(c.status).toUpperCase() === 'ACTIVE');
  if (!row) return fail('That comment no longer exists.');

  const post = store.posts.byId(row.post_id);
  const allowed = row.user_id === user.id
    || (post && post.author_id === user.id)
    || isAdminUser(user);
  if (!allowed) return fail('You can only delete your own comments.');

  store.comments.update(row, { status: 'DELETED' });
  return ok({ message: 'Comment removed.' });
}

// ------------------------------------------------------- private gallery
/**
 * A creator's subscriber-only gallery.
 *
 * Non-subscribers still get a response, but a deliberately thin one: counts and
 * locked placeholders, never captions or media. Enough to know what they are
 * missing and decide to pay, and nothing that would make paying pointless.
 */
export async function getCreatorGallery({ store, user, body }) {
  const creatorId = String(body?.creatorId || '');

  const creator = store.users.byId(creatorId);
  if (!creator || creator.role !== 'CELEBRITY' || userStatusOf(creator) !== 'ACTIVE') {
    return fail('That creator does not exist.');
  }

  const now = Date.now();
  const isSubscribed = store.subscriptions.filter(
    (s) => s.subscriber_id === user.id && s.celebrity_id === creatorId && liveSubscription(s, now)
  ).length > 0;

  const isOwner = creator.id === user.id;
  const entitled = isOwner || isSubscribed || isAdminUser(user);

  const counts = engagementCounts(store, user.id);
  const saved = savedSet(store, user.id);

  const galleryPosts = store.posts
    .filter((post) => post.author_id === creatorId
                   && livePost(post, now)
                   && post.visibility === 'SUBSCRIBERS')
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at));

  const items = await Promise.all(galleryPosts.map(async (post) => {
      if (!entitled) {
        // A locked tile: the shape of the thing, none of the substance.
        return {
          id: post.id,
          locked: true,
          type: post.type,
          hasMedia: Boolean(sanitizeUrl(post.media_url)),
          createdAt: post.created_at,
          expiresAt: post.expires_at
        };
      }

      const mapped = mapPost(post, counts);
      mapped.locked = false;
      mapped.viewerIsSubscribed = true;
      mapped.viewerSaved = saved.has(post.id);
      mapped.mediaUrl = await presentMedia(post, user, true);
      mapped.author = publicUser(creator);
      return mapped;
  }));

  return ok({
    creator: publicUser(creator),
    entitled,
    isOwner,
    count: items.length,
    monthlyPrice: Number(creator.monthly_price) || 0,
    items
  });
}

// --------------------------------------------------------------- search
/**
 * SEARCH
 *
 * Ranked substring matching over people and captions, done in JavaScript.
 *
 * Postgres would use a tsvector and a GIN index. There is no such thing here,
 * and there does not need to be: the route already holds every row in memory
 * from its one batched read, so scanning them costs nothing extra. What matters
 * instead is that the ranking is sensible and that the visibility rules from the
 * feed are applied identically — search must not become the hole in the paywall.
 */
const SEARCH_MIN_LENGTH = 2;
const SEARCH_LIMIT = 30;

/**
 * Scores a match so an exact handle beats a passing mention in a bio.
 * Returns 0 for no match, and the caller drops those.
 */
function scoreMatch(needle, fields) {
  let best = 0;
  for (const { value, weight } of fields) {
    const text = String(value || '').toLowerCase();
    if (!text) continue;

    if (text === needle) best = Math.max(best, weight * 4);
    else if (text.startsWith(needle)) best = Math.max(best, weight * 3);
    // A word boundary beats a match buried mid-word: "art" should rank
    // "art director" above "Bharti".
    else if (new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text)) {
      best = Math.max(best, weight * 2);
    } else if (text.includes(needle)) best = Math.max(best, weight);
  }
  return best;
}

export async function search({ store, user, body }) {
  const raw = cleanText(body?.query, 80);
  const needle = raw.toLowerCase().replace(/^@/, '');
  const scope = String(body?.scope || 'ALL').toUpperCase();

  if (needle.length < SEARCH_MIN_LENGTH) {
    return ok({
      query: raw, people: [], posts: [], totals: { people: 0, posts: 0 },
      message: `Type at least ${SEARCH_MIN_LENGTH} characters.`
    });
  }

  const now = Date.now();
  const subscribed = subscribedSet(store, user.id, now);
  const followed = new Set(
    store.follows.filter((f) => f.follower_id === user.id).map((f) => f.followee_id));
  const viewerIsAdmin = isAdminUser(user);

  // ------------------------------------------------------------- people
  const followerCounts = countBy(store.follows.all(), 'followee_id', 'follower_id');

  const people = scope === 'POSTS' ? [] : store.users
    .filter((row) => userStatusOf(row) === 'ACTIVE')
    .map((row) => ({
      row,
      score: scoreMatch(needle, [
        { value: row.username, weight: 10 },
        { value: row.full_name, weight: 8 },
        { value: row.category, weight: 3 },
        { value: row.bio, weight: 1 }
      ])
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => (b.score - a.score)
      // Ties break on reach, so the better-known match of two comes first.
      || ((followerCounts.get(b.row.id) || 0) - (followerCounts.get(a.row.id) || 0)))
    .slice(0, SEARCH_LIMIT)
    .map(({ row }) => {
      const person = publicUser(row);
      person.followerCount = followerCounts.get(row.id) || 0;
      person.viewerFollows = followed.has(row.id);
      person.viewerIsSubscribed = subscribed.has(row.id);
      person.isSelf = row.id === user.id;
      return person;
    });

  // -------------------------------------------------------------- posts
  const counts = engagementCounts(store, user.id);
  const saved = savedSet(store, user.id);

  const scoredPosts = scope === 'PEOPLE' ? [] : store.posts
    .filter((post) => {
      if (!livePost(post, now)) return false;

      const author = store.users.byId(post.author_id);
      if (!author || userStatusOf(author) !== 'ACTIVE') return false;

      // The same rule the feed applies. A private post is findable only by
      // someone already entitled to see it — otherwise search would leak the
      // captions the paywall exists to protect.
      if (post.visibility === 'SUBSCRIBERS'
          && post.author_id !== user.id
          && !subscribed.has(post.author_id)
          && !viewerIsAdmin) return false;

      return scoreMatch(needle, [{ value: post.caption, weight: 1 }]) > 0;
    })
    .map((post) => ({
      post,
      score: scoreMatch(needle, [{ value: post.caption, weight: 1 }]),
      engagement: (counts.likes.get(post.id) || 0) + (counts.comments.get(post.id) || 0)
    }))
    .sort((a, b) => (b.score - a.score)
      || (b.engagement - a.engagement)
      || (toMillis(b.post.created_at) - toMillis(a.post.created_at)))
    .slice(0, SEARCH_LIMIT);

  const posts = await Promise.all(scoredPosts.map(async ({ post }) => {
      const mapped = mapPost(post, counts);
      mapped.author = publicUser(store.users.byId(post.author_id));
      mapped.viewerFollows = followed.has(post.author_id);
      mapped.viewerIsSubscribed = subscribed.has(post.author_id);
      mapped.viewerSaved = saved.has(post.id);
      mapped.mediaUrl = await presentMedia(post, user, true);
      return mapped;
  }));

  return ok({
    query: raw,
    scope,
    people,
    posts,
    totals: { people: people.length, posts: posts.length },
    truncated: people.length >= SEARCH_LIMIT || posts.length >= SEARCH_LIMIT
  });
}

// ---------------------------------------------------------- saved posts
/** The post ids this viewer has bookmarked. */
function savedSet(store, viewerId) {
  if (!store.saves) return new Set();
  return new Set(store.saves.filter((row) => row.user_id === viewerId).map((row) => row.post_id));
}

export async function toggleSave({ store, user, body }) {
  const post = visiblePost(store, body?.postId, user);
  if (!post) return fail('That post is no longer available.');

  const mine = store.saves.filter(
    (row) => row.user_id === user.id && row.post_id === post.id);

  let saved;
  if (mine.length) {
    // Clear every row for the pair: a lost race could have left two, and one
    // unsave should not leave a ghost bookmark behind.
    mine.forEach((row) => store.saves.remove(row));
    saved = false;
  } else {
    store.saves.insert({
      id: newId('save'),
      user_id: user.id,
      post_id: post.id,
      created_at: new Date().toISOString()
    });
    saved = true;
  }

  // Deliberately no notification. A bookmark is private — telling the author
  // who saved their post would turn a quiet action into a public one.
  return ok({ saved, message: saved ? 'Saved.' : 'Removed from saved.' });
}

/**
 * The viewer's bookmarks, newest save first.
 *
 * Entitlement is re-checked on every read rather than trusted from when the save
 * happened. If a subscription has lapsed since, the saved private post comes
 * back locked — saving must not become a way to keep access after paying stops.
 * Posts that expired or were deleted are reported as such instead of vanishing
 * silently, so the count the user sees matches what they saved.
 */
export async function getSavedPosts({ store, user }) {
  const now = Date.now();
  const subscribed = subscribedSet(store, user.id, now);
  const counts = engagementCounts(store, user.id);
  const viewerIsAdmin = isAdminUser(user);

  const mine = store.saves
    .filter((row) => row.user_id === user.id)
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at));

  const items = await Promise.all(mine.map(async (save) => {
      const post = store.posts.byId(save.post_id);
      const author = post ? store.users.byId(post.author_id) : null;

      if (!post || !author
          || String(post.status).toUpperCase() === 'DELETED'
          || userStatusOf(author) !== 'ACTIVE') {
        return { id: save.post_id, savedAt: save.created_at, unavailable: true, reason: 'REMOVED' };
      }

      if (!livePost(post, now)) {
        return {
          id: post.id, savedAt: save.created_at, unavailable: true, reason: 'EXPIRED',
          caption: post.caption, author: publicUser(author)
        };
      }

      const entitled = post.visibility !== 'SUBSCRIBERS'
        || post.author_id === user.id
        || subscribed.has(post.author_id)
        || viewerIsAdmin;

      if (!entitled) {
        return {
          id: post.id, savedAt: save.created_at, locked: true,
          type: post.type, visibility: 'SUBSCRIBERS',
          author: publicUser(author)
        };
      }

      const mapped = mapPost(post, counts);
      mapped.savedAt = save.created_at;
      mapped.viewerSaved = true;
      mapped.author = publicUser(author);
      mapped.viewerIsSubscribed = subscribed.has(post.author_id);
      mapped.mediaUrl = await presentMedia(post, user, true);
      return mapped;
  }));

  return ok({
    items,
    total: items.length,
    available: items.filter((item) => !item.unavailable && !item.locked).length
  });
}

// --------------------------------------------------------- share links
/**
 * Builds the payload behind a public /p/:id page.
 *
 * Takes a store when the caller already has one; opens its own otherwise, which
 * is what the server-rendered share function does.
 */
export async function buildSharePayload(postId, { countView = true, store = null } = {}) {
  const db = store || await openStore(['Posts', 'Users', 'Likes', 'Comments']);
  const appUrl = env.siteUrl();

  const post = db.posts.byId(String(postId || ''));
  if (!post || String(post.status).toUpperCase() === 'DELETED') {
    return { found: false, reason: 'NOT_FOUND', appUrl };
  }

  const author = db.users.byId(post.author_id);
  if (!author || userStatusOf(author) !== 'ACTIVE') {
    return { found: false, reason: 'NOT_FOUND', appUrl };
  }

  const expired = String(post.status).toUpperCase() === 'EXPIRED'
               || toMillis(post.expires_at) <= Date.now();
  const shareUrl = `${appUrl}/p/${encodeURIComponent(post.id)}`;

  // A share link is by definition public, so a subscriber-only post is returned
  // as a teaser: who posted, and nothing else. Sharing must not become a way
  // around the paywall.
  if (post.visibility === 'SUBSCRIBERS') {
    return {
      found: true, locked: true, expired, appUrl, shareUrl,
      post: {
        id: post.id, type: post.type, caption: '', mediaUrl: '',
        visibility: 'SUBSCRIBERS',
        createdAt: post.created_at, expiresAt: post.expires_at,
        daysLeft: expired ? 0 : Math.max(0, Math.ceil((toMillis(post.expires_at) - Date.now()) / DAY_MS)),
        likeCount: 0, commentCount: 0,
        author: publicUser(author)
      }
    };
  }

  if (!expired && countView) {
    // Deliberately lock-free and best-effort. A view counter is never worth
    // failing a page render over, and it is certainly not worth three API calls
    // of write quota per visitor — a lost increment under concurrency is the
    // right trade here.
    db.posts.update(post, { share_views: (Number(post.share_views) || 0) + 1 });
    if (!store) db.flush().catch(() => {});
  }

  const likeCount = new Set(
    db.likes.filter((l) => l.post_id === post.id).map((l) => l.user_id)).size;
  const commentCount = db.comments.count(
    (c) => c.post_id === post.id && String(c.status).toUpperCase() === 'ACTIVE');

  return {
    found: true, locked: false, expired, appUrl, shareUrl,
    post: {
      id: post.id,
      type: post.type,
      caption: post.caption || '',
      // An expired post keeps its text but loses its media: the 30-day promise
      // is the product, so it has to hold on a public page too.
      mediaUrl: expired ? '' : sanitizeUrl(post.media_url),
      createdAt: post.created_at,
      expiresAt: post.expires_at,
      daysLeft: expired ? 0 : Math.max(0, Math.ceil((toMillis(post.expires_at) - Date.now()) / DAY_MS)),
      likeCount,
      commentCount,
      author: publicUser(author)
    }
  };
}

export async function getSharedPost({ store, body }) {
  return ok(await buildSharePayload(body?.postId, { store }));
}

export async function getShareLink({ store, body }) {
  const post = store.posts.byId(String(body?.postId || ''));
  if (!post || String(post.status).toUpperCase() === 'DELETED') {
    return fail('That post is no longer available.');
  }

  return ok({
    url: `${env.siteUrl()}/p/${encodeURIComponent(post.id)}`,
    shareViews: Number(post.share_views) || 0,
    expired: !livePost(post),
    // Previews are server-rendered on this stack, so they always work.
    previewsConfigured: true
  });
}
