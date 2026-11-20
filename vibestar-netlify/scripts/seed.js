#!/usr/bin/env node
/**
 * Seeds an explorable demo. Every account's password is "demo1234".
 *
 * Email addresses span many providers on purpose: sign-in here is this app's own
 * credential system, not Google sign-in, so any address works.
 *
 * Delete the demo rows before real users arrive — with a spreadsheet you can
 * simply select and delete them by hand, which is one of the genuine upsides of
 * this backend.
 */
import crypto from 'node:crypto';
import { openStore, closePool, BACKEND } from '../src/lib/store.js';

// Either backend will do; store.js throws with instructions if neither is set.
console.log(`Seeding the ${BACKEND === 'POSTGRES' ? 'Postgres' : 'Google Sheets'} backend.`);

const PASSWORD = 'demo1234';
const scrypt = (password, salt) => new Promise((resolve, reject) =>
  crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 },
    (err, key) => (err ? reject(err) : resolve(key.toString('hex')))));

const id = (p) => `${p}_${crypto.randomBytes(9).toString('hex')}`;
const iso = (ms) => new Date(ms).toISOString();
const DAY = 86400000;

const USERS = [
  { u: 'admin',   n: 'Platform Admin',  e: 'admin@vibestar.app',        role: 'FAN',       admin: true, bio: 'Keeps the lights on.' },
  { u: 'aarohi',  n: 'Aarohi Sharma',   e: 'aarohi@vibestar.app',       role: 'CELEBRITY', admin: true, cat: 'Actress & Influencer', price: 299, followers: 12000,
    bio: 'Actor. Occasional over-sharer. I read everything you send me here.',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400' },
  { u: 'meerak',  n: 'Meera Kapoor',    e: 'meera.kapoor@gmail.com',    role: 'CELEBRITY', cat: 'Playback Singer', price: 499, followers: 22400,
    bio: 'Singer. Studio rat. I post the demos nobody else hears.',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400' },
  { u: 'kabirr',  n: 'Kabir Raina',     e: 'kabir.raina@yahoo.com',     role: 'CELEBRITY', cat: 'Stand-up Comedian', price: 199, followers: 16500,
    bio: 'Jokes first, apologies later.',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400' },
  { u: 'zoyaf',   n: 'Zoya Fernandes',  e: 'zoya.f@outlook.com',        role: 'CELEBRITY', cat: 'Dancer & Choreographer', price: 249, followers: 6200,
    bio: 'Choreographer. Rehearsal clips live here for 30 days, then vanish.',
    avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400' },
  { u: 'rohitd',  n: 'Rohit Desai',     e: 'rohit@desaistudio.in',      role: 'CELEBRITY', cat: 'Cinematographer', price: 149, followers: 4100,
    bio: 'I shoot other people for a living.' },
  { u: 'tanyab',  n: 'Tanya Bose',      e: 'tanya.bose@proton.me',      role: 'CELEBRITY', cat: 'Fashion Stylist', price: 99, pending: true,
    bio: 'Stylist. Building slowly and on purpose.' },
  { u: 'rahulv',  n: 'Rahul Verma',     e: 'rahul@vibestar.app',        role: 'FAN' },
  { u: 'priyan',  n: 'Priya Nair',      e: 'priya.nair@hotmail.com',    role: 'FAN' },
  { u: 'arjunm',  n: 'Arjun Menon',     e: 'arjun.menon@zoho.com',      role: 'FAN' },
  { u: 'spambot', n: 'Spam Bot',        e: 'bot@throwaway.xyz',         role: 'FAN', suspended: 'Automated spam in creator threads.' }
];

// [author, type, ageDays, caption, media, visibility]
const POSTS = [
  ['aarohi', 'IMAGE', 0,  'Exclusive preview from my upcoming movie! 🎬✨', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=1200', 'PUBLIC'],
  ['meerak', 'IMAGE', 1,  'Scratch vocals from this morning. Raw and a bit flat, but honest.', 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=1200', 'PUBLIC'],
  ['kabirr', 'VIDEO', 2,  'Testing new material on a very unimpressed audience 🎤', 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=1200', 'PUBLIC'],
  ['zoyaf',  'VIDEO', 3,  'Rehearsal, take 14. My knees are filing a complaint.', 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=1200', 'PUBLIC'],
  ['aarohi', 'IMAGE', 6,  'Between takes. Cold coffee number four.', 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=1200', 'PUBLIC'],
  ['rohitd', 'IMAGE', 9,  'Golden hour lasted about nine minutes today.', 'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=1200', 'PUBLIC'],
  ['meerak', 'IMAGE', 34, 'Old tour poster — this one has already aged out.', 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=1200', 'PUBLIC'],
  // Private gallery entries, so the paywall has something behind it on day one.
  ['aarohi', 'IMAGE', 1,  'Subscribers only: the script pages I am not supposed to show anyone.', 'https://images.unsplash.com/photo-1455390582262-044cdead277a?w=1200', 'SUBSCRIBERS'],
  ['meerak', 'IMAGE', 4,  'Gallery: the unreleased bridge. Do not share this one.', 'https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?w=1200', 'SUBSCRIBERS']
];

try {
  const store = await openStore([
    'Users', 'Posts', 'Follows', 'Likes', 'Comments',
    'Subscriptions', 'Messages', 'VerificationRequests'
  ]);

  const ids = {};
  let created = 0;

  for (const spec of USERS) {
    const existing = store.users.find(
      (row) => String(row.email).toLowerCase() === spec.e.toLowerCase());

    if (existing) { ids[spec.u] = existing.id; continue; }

    const salt = crypto.randomBytes(16).toString('hex');
    const uid = id(spec.role === 'CELEBRITY' ? 'celeb' : 'fan');

    store.users.insert({
      id: uid,
      full_name: spec.n,
      username: spec.u,
      email: spec.e,
      password_hash: await scrypt(PASSWORD, salt),
      password_salt: salt,
      role: spec.role,
      category: spec.cat || (spec.role === 'CELEBRITY' ? 'Creator' : ''),
      bio: spec.bio || '',
      avatar_url: spec.avatar || '',
      banner_url: '',
      monthly_price: spec.price || 0,
      is_admin: Boolean(spec.admin),
      verification_status: spec.followers ? 'APPROVED' : (spec.pending ? 'PENDING' : 'NONE'),
      verification_route: spec.followers || spec.pending ? 'FOLLOWERS' : '',
      verified_follower_count: spec.followers || 0,
      verified_at: spec.followers ? iso(Date.now()) : '',
      status: spec.suspended ? 'SUSPENDED' : 'ACTIVE',
      status_reason: spec.suspended || '',
      chat_theme: 'MIDNIGHT',
      created_at: iso(Date.now())
    });

    ids[spec.u] = uid;
    created += 1;

    if (spec.pending) {
      store.verificationRequests.insert({
        id: id('vreq'),
        user_id: uid,
        route: 'FOLLOWERS',
        platform: 'INSTAGRAM',
        profile_url: 'https://instagram.com/tanyabose',
        claimed_follower_count: 7300,
        status: 'PENDING',
        created_at: iso(Date.now())
      });
    }
  }

  const postIds = [];
  for (const [author, type, ageDays, caption, media, visibility] of POSTS) {
    const createdAt = Date.now() - ageDays * DAY;
    const expiresAt = createdAt + 30 * DAY;
    const pid = id('post');

    store.posts.insert({
      id: pid,
      author_id: ids[author],
      type,
      caption,
      media_url: media,
      status: expiresAt <= Date.now() ? 'EXPIRED' : 'ACTIVE',
      visibility,
      share_views: 0,
      created_at: iso(createdAt),
      expires_at: iso(expiresAt)
    });
    postIds.push(pid);
  }

  const follows = [
    ['rahulv', 'aarohi'], ['rahulv', 'meerak'], ['rahulv', 'kabirr'], ['priyan', 'aarohi'],
    ['priyan', 'zoyaf'],  ['priyan', 'rahulv'], ['arjunm', 'meerak'], ['arjunm', 'kabirr'],
    ['arjunm', 'rohitd'], ['aarohi', 'meerak'], ['meerak', 'aarohi'], ['zoyaf', 'kabirr'],
    ['kabirr', 'aarohi'], ['tanyab', 'zoyaf'],  ['rohitd', 'aarohi'], ['admin', 'aarohi']
  ];
  for (const [follower, followee] of follows) {
    store.follows.insert({
      id: id('flw'),
      follower_id: ids[follower],
      followee_id: ids[followee],
      created_at: iso(Date.now())
    });
  }

  for (const [liker, index] of [['rahulv', 0], ['priyan', 0], ['arjunm', 0], ['priyan', 1], ['rahulv', 1], ['arjunm', 2]]) {
    store.likes.insert({
      id: id('like'), post_id: postIds[index], user_id: ids[liker], created_at: iso(Date.now())
    });
  }

  for (const [author, index, text] of [
    ['rahulv', 0, 'This looks incredible 🔥'],
    ['priyan', 0, 'Cannot wait for this one!'],
    ['arjunm', 1, 'The rawness is the best part honestly.']
  ]) {
    store.comments.insert({
      id: id('cmt'), post_id: postIds[index], user_id: ids[author],
      content: text, status: 'ACTIVE', created_at: iso(Date.now())
    });
  }

  // A live subscription and conversation, so the messenger and the private
  // gallery are not empty on first login.
  store.subscriptions.insert({
    id: id('sub'),
    subscriber_id: ids.rahulv,
    celebrity_id: ids.aarohi,
    status: 'ACTIVE',
    created_at: iso(Date.now() - 3 * DAY),
    expires_at: iso(Date.now() + 27 * DAY)
  });

  for (const [from, text, minsAgo, read] of [
    ['rahulv', 'Just subscribed! Loved the trailer 🎬', 180, true],
    ['aarohi', 'Thank you Rahul! Shooting the last scenes this week.', 150, true],
    ['rahulv', 'Any chance of a Kolkata screening?', 40, false]
  ]) {
    const at = Date.now() - minsAgo * 60000;
    store.messages.insert({
      id: id('msg'),
      subscriber_id: ids.rahulv,
      celebrity_id: ids.aarohi,
      sender_id: ids[from],
      content: text,
      read_at: read ? iso(at + 60000) : '',
      created_at: iso(at)
    });
  }

  await store.flush();

  console.log(`Seeded: ${created} new users, ${postIds.length} posts, `
            + `${follows.length} follows, 1 subscription, 3 messages.`);
  console.log('Log in as admin@vibestar.app / demo1234');
  await closePool();
} catch (err) {
  console.error(`Seed failed: ${err.message}`);
  await closePool().catch(() => {});
  process.exit(1);
}
