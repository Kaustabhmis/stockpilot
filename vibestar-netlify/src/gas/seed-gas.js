/* eslint-disable no-undef */
/**
 * Demo data for the Apps Script build.
 *
 * scripts/seed.js does this for the Netlify targets; it cannot run here because
 * Apps Script has no Node. The fixture list is the same, and both write through
 * the store, so the two produce equivalent rows.
 */
export async function seedDemoAccounts() {
  const PASSWORD = 'demo1234';
  const DAY = 86400000;
  const iso = (ms) => new Date(ms).toISOString();

  const USERS = [
    { u: 'admin',   n: 'Platform Admin', e: 'admin@vibestar.app',     role: 'FAN', admin: true, bio: 'Keeps the lights on.' },
    { u: 'aarohi',  n: 'Aarohi Sharma',  e: 'aarohi@vibestar.app',    role: 'CELEBRITY', admin: true, cat: 'Actress & Influencer', price: 299, followers: 12000, bio: 'Actor. I read everything you send me here.' },
    { u: 'meerak',  n: 'Meera Kapoor',   e: 'meera.kapoor@gmail.com', role: 'CELEBRITY', cat: 'Playback Singer', price: 499, followers: 22400, bio: 'Singer. I post the demos nobody else hears.' },
    { u: 'kabirr',  n: 'Kabir Raina',    e: 'kabir.raina@yahoo.com',  role: 'CELEBRITY', cat: 'Stand-up Comedian', price: 199, followers: 16500, bio: 'Jokes first, apologies later.' },
    { u: 'zoyaf',   n: 'Zoya Fernandes', e: 'zoya.f@outlook.com',     role: 'CELEBRITY', cat: 'Dancer', price: 249, followers: 6200, bio: 'Rehearsal clips live here for 30 days.' },
    { u: 'rohitd',  n: 'Rohit Desai',    e: 'rohit@desaistudio.in',   role: 'CELEBRITY', cat: 'Cinematographer', price: 149, followers: 4100, bio: 'I shoot other people for a living.' },
    { u: 'tanyab',  n: 'Tanya Bose',     e: 'tanya.bose@proton.me',   role: 'CELEBRITY', cat: 'Fashion Stylist', price: 99, pending: true, bio: 'Building slowly and on purpose.' },
    { u: 'rahulv',  n: 'Rahul Verma',    e: 'rahul@vibestar.app',     role: 'FAN' },
    { u: 'priyan',  n: 'Priya Nair',     e: 'priya.nair@hotmail.com', role: 'FAN' },
    { u: 'spambot', n: 'Spam Bot',       e: 'bot@throwaway.xyz',      role: 'FAN', suspended: 'Automated spam.' }
  ];

  const POSTS = [
    ['aarohi', 'IMAGE', 0, 'Exclusive preview from my upcoming movie!', 'PUBLIC'],
    ['meerak', 'IMAGE', 1, 'Scratch vocals from this morning. Raw, but honest.', 'PUBLIC'],
    ['kabirr', 'VIDEO', 2, 'Testing new material on a very unimpressed audience.', 'PUBLIC'],
    ['zoyaf',  'VIDEO', 3, 'Rehearsal, take 14. My knees are filing a complaint.', 'PUBLIC'],
    ['rohitd', 'IMAGE', 9, 'Golden hour lasted about nine minutes today.', 'PUBLIC'],
    ['aarohi', 'IMAGE', 1, 'Subscribers only: the script pages I should not show anyone.', 'SUBSCRIBERS'],
    ['meerak', 'IMAGE', 4, 'Gallery: the unreleased bridge. Do not share this one.', 'SUBSCRIBERS']
  ];

  return transact(
    ['Users', 'Posts', 'Follows', 'Likes', 'Comments', 'Subscriptions', 'Messages', 'VerificationRequests'],
    async (store) => {
      const ids = {};
      let created = 0;

      for (const spec of USERS) {
        const existing = store.users.find(
          (row) => String(row.email).toLowerCase() === spec.e.toLowerCase());
        if (existing) { ids[spec.u] = existing.id; continue; }

        const salt = newSalt();
        const uid = newId(spec.role === 'CELEBRITY' ? 'celeb' : 'fan');

        store.users.insert({
          id: uid,
          full_name: spec.n,
          username: spec.u,
          email: spec.e,
          password_hash: await hashPassword(PASSWORD, salt),
          password_salt: salt,
          role: spec.role,
          category: spec.cat || (spec.role === 'CELEBRITY' ? 'Creator' : ''),
          bio: spec.bio || '',
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
            id: newId('vreq'), user_id: uid, route: 'FOLLOWERS', platform: 'INSTAGRAM',
            profile_url: 'https://instagram.com/tanyabose', claimed_follower_count: 7300,
            status: 'PENDING', created_at: iso(Date.now())
          });
        }
      }

      for (const [author, type, ageDays, caption, visibility] of POSTS) {
        const createdAt = Date.now() - ageDays * DAY;
        const expiresAt = createdAt + 30 * DAY;
        store.posts.insert({
          id: newId('post'), author_id: ids[author], type, caption, media_url: '',
          status: expiresAt <= Date.now() ? 'EXPIRED' : 'ACTIVE',
          visibility, share_views: 0,
          created_at: iso(createdAt), expires_at: iso(expiresAt)
        });
      }

      const follows = [
        ['rahulv', 'aarohi'], ['rahulv', 'meerak'], ['priyan', 'aarohi'], ['priyan', 'zoyaf'],
        ['aarohi', 'meerak'], ['meerak', 'aarohi'], ['kabirr', 'aarohi'], ['admin', 'aarohi']
      ];
      for (const [follower, followee] of follows) {
        store.follows.insert({
          id: newId('flw'), follower_id: ids[follower], followee_id: ids[followee],
          created_at: iso(Date.now())
        });
      }

      // A live subscription, so the messenger and a private gallery are not empty.
      store.subscriptions.insert({
        id: newId('sub'), subscriber_id: ids.rahulv, celebrity_id: ids.aarohi,
        status: 'ACTIVE', created_at: iso(Date.now() - 3 * DAY),
        expires_at: iso(Date.now() + 27 * DAY)
      });

      for (const [from, text, minsAgo] of [
        ['rahulv', 'Just subscribed! Loved the trailer.', 180],
        ['aarohi', 'Thank you Rahul! Shooting the last scenes this week.', 150],
        ['rahulv', 'Any chance of a Kolkata screening?', 40]
      ]) {
        const at = Date.now() - minsAgo * 60000;
        store.messages.insert({
          id: newId('msg'), subscriber_id: ids.rahulv, celebrity_id: ids.aarohi,
          sender_id: ids[from], content: text, read_at: '', created_at: iso(at)
        });
      }

      return `Seeded ${created} accounts. Log in as admin@vibestar.app / demo1234`;
    }
  );
}
