-- =============================================================================
-- VIBESTAR SCHEMA — Supabase / PostgreSQL
--
-- Apply with:  DATABASE_URL='postgres://…' npm run migrate
-- Safe to re-run: every statement is IF NOT EXISTS or otherwise idempotent.
--
-- This is the alternative to the Google Sheets backend. What it buys is the
-- thing a spreadsheet cannot give at any price: unique indexes and real
-- transactions, so the guarantees below are enforced by the database instead of
-- by holding a mutex across a read and a write. And no rate ceiling.
--
-- -----------------------------------------------------------------------------
-- TWO DELIBERATE DEPARTURES FROM TEXTBOOK SCHEMA DESIGN
--
-- 1. NO FOREIGN KEYS. The app runs on either backend, and Sheets cannot enforce
--    referential integrity, so every lookup in the codebase already null-checks
--    its referent. Adding FKs here would not make the app safer — it would make
--    the two backends behave DIFFERENTLY under the same admin action, which is
--    worse than declarative integrity the code does not rely on. Note also that
--    the app never hard-deletes an account: adminSetUserStatus writes
--    status='DELETED' precisely so content survives for moderation, and
--    ON DELETE CASCADE would have quietly destroyed exactly that.
--
-- 2. '' RATHER THAN NULL FOR ABSENT TEXT. A spreadsheet cell has no NULL, so the
--    store layer uses the empty string throughout. Matching that here keeps ONE
--    code path for both backends. The partial unique indexes are therefore
--    written `WHERE col <> ''` rather than `WHERE col IS NOT NULL` — with the
--    NULL form, two unpaid payments both holding '' would collide.
--    Timestamps are the exception: they are genuinely nullable, and the store
--    converts NULL to '' on read and '' to NULL on write.
-- =============================================================================

-- ---------------------------------------------------------------- users
CREATE TABLE IF NOT EXISTS users (
  id                       TEXT PRIMARY KEY,
  full_name                TEXT        NOT NULL DEFAULT '',
  username                 TEXT        NOT NULL DEFAULT '',
  email                    TEXT        NOT NULL DEFAULT '',
  password_hash            TEXT        NOT NULL DEFAULT '',
  password_salt            TEXT        NOT NULL DEFAULT '',
  role                     TEXT        NOT NULL DEFAULT 'FAN',
  category                 TEXT        NOT NULL DEFAULT '',
  bio                      TEXT        NOT NULL DEFAULT '',
  avatar_url               TEXT        NOT NULL DEFAULT '',
  banner_url               TEXT        NOT NULL DEFAULT '',
  monthly_price            INTEGER     NOT NULL DEFAULT 0 CHECK (monthly_price >= 0),
  is_admin                 BOOLEAN     NOT NULL DEFAULT FALSE,
  verification_status      TEXT        NOT NULL DEFAULT 'NONE',
  verification_route       TEXT        NOT NULL DEFAULT '',
  verified_follower_count  INTEGER     NOT NULL DEFAULT 0 CHECK (verified_follower_count >= 0),
  verified_at              TIMESTAMPTZ,
  status                   TEXT        NOT NULL DEFAULT 'ACTIVE',
  status_reason            TEXT        NOT NULL DEFAULT '',
  status_changed_at        TIMESTAMPTZ,
  chat_theme               TEXT        NOT NULL DEFAULT 'MIDNIGHT',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness. This pair is the whole reason the signup path can
-- drop its mutex on this backend: two simultaneous signups cannot both win.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key    ON users (lower(email))    WHERE email <> '';
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users (lower(username)) WHERE username <> '';
CREATE INDEX        IF NOT EXISTS users_role_status  ON users (role, status);

-- ---------------------------------------------------------------- posts
CREATE TABLE IF NOT EXISTS posts (
  id          TEXT PRIMARY KEY,
  author_id   TEXT        NOT NULL DEFAULT '',
  type        TEXT        NOT NULL DEFAULT 'IMAGE',
  caption     TEXT        NOT NULL DEFAULT '',
  media_url   TEXT        NOT NULL DEFAULT '',
  status      TEXT        NOT NULL DEFAULT 'ACTIVE',
  -- SUBSCRIBERS posts form a creator's private gallery.
  visibility  TEXT        NOT NULL DEFAULT 'PUBLIC',
  share_views INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_author     ON posts (author_id, status);
CREATE INDEX IF NOT EXISTS posts_live       ON posts (status, expires_at);
CREATE INDEX IF NOT EXISTS posts_recent     ON posts (created_at DESC);
CREATE INDEX IF NOT EXISTS posts_visibility ON posts (author_id, visibility, status);

-- -------------------------------------------------------- subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id                    TEXT PRIMARY KEY,
  subscriber_id         TEXT        NOT NULL DEFAULT '',
  celebrity_id          TEXT        NOT NULL DEFAULT '',
  status                TEXT        NOT NULL DEFAULT 'ACTIVE',
  expiring_notified_at  TIMESTAMPTZ,
  expired_notified_at   TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One live row per pair, so a renewal extends instead of stacking duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_active_pair
  ON subscriptions (subscriber_id, celebrity_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS subscriptions_celeb ON subscriptions (celebrity_id, status);

-- ------------------------------------------------------------- messages
CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,
  subscriber_id TEXT        NOT NULL DEFAULT '',
  celebrity_id  TEXT        NOT NULL DEFAULT '',
  sender_id     TEXT        NOT NULL DEFAULT '',
  content       TEXT        NOT NULL DEFAULT '',
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_thread ON messages (subscriber_id, celebrity_id, created_at);

-- -------------------------------------------------------------- follows
CREATE TABLE IF NOT EXISTS follows (
  id          TEXT PRIMARY KEY,
  follower_id TEXT        NOT NULL DEFAULT '',
  followee_id TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS follows_pair     ON follows (follower_id, followee_id);
CREATE INDEX        IF NOT EXISTS follows_followee ON follows (followee_id);

-- ---------------------------------------------------------------- likes
CREATE TABLE IF NOT EXISTS likes (
  id         TEXT PRIMARY KEY,
  post_id    TEXT        NOT NULL DEFAULT '',
  user_id    TEXT        NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Makes a double tap physically unable to create two likes. The app counts
-- likes as distinct user ids anyway — it has to, for the Sheets backend — so
-- this is belt and braces rather than the only defence.
CREATE UNIQUE INDEX IF NOT EXISTS likes_pair ON likes (post_id, user_id);

-- ---------------------------------------------------------------- saves
CREATE TABLE IF NOT EXISTS saves (
  id         TEXT PRIMARY KEY,
  user_id    TEXT        NOT NULL DEFAULT '',
  post_id    TEXT        NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS saves_pair ON saves (user_id, post_id);
CREATE INDEX        IF NOT EXISTS saves_user ON saves (user_id, created_at DESC);

-- ------------------------------------------------------------- comments
CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  post_id    TEXT        NOT NULL DEFAULT '',
  user_id    TEXT        NOT NULL DEFAULT '',
  content    TEXT        NOT NULL DEFAULT '',
  status     TEXT        NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_post ON comments (post_id, status, created_at);

-- --------------------------------------------------------------- media
CREATE TABLE IF NOT EXISTS media (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT        NOT NULL DEFAULT '',
  store_key  TEXT        NOT NULL DEFAULT '',
  kind       TEXT        NOT NULL DEFAULT 'IMAGE',
  mime_type  TEXT        NOT NULL DEFAULT '',
  bytes      BIGINT      NOT NULL DEFAULT 0,
  url        TEXT        NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX        IF NOT EXISTS media_owner ON media (owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS media_key   ON media (store_key) WHERE store_key <> '';

-- ------------------------------------------------------------- payments
CREATE TABLE IF NOT EXISTS payments (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT         NOT NULL DEFAULT '',
  purpose            TEXT         NOT NULL DEFAULT '',
  target_id          TEXT         NOT NULL DEFAULT '',
  beneficiary_id     TEXT         NOT NULL DEFAULT '',
  order_id           TEXT         NOT NULL DEFAULT '',
  payment_id         TEXT         NOT NULL DEFAULT '',
  amount_paise       BIGINT       NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  currency           TEXT         NOT NULL DEFAULT 'INR',
  status             TEXT         NOT NULL DEFAULT 'CREATED',
  mode               TEXT         NOT NULL DEFAULT 'RAZORPAY',
  commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  commission_paise   BIGINT       NOT NULL DEFAULT 0,
  net_paise          BIGINT       NOT NULL DEFAULT 0,
  signature_verified BOOLEAN      NOT NULL DEFAULT FALSE,
  failure_reason     TEXT         NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  paid_at            TIMESTAMPTZ,
  granted_at         TIMESTAMPTZ
);
-- The gateway's ids are unique, so a replayed callback or a duplicated webhook
-- cannot create a second settlement. Note `<> ''`: an unpaid order legitimately
-- holds '' in payment_id, and many of those must coexist.
CREATE UNIQUE INDEX IF NOT EXISTS payments_order       ON payments (order_id)   WHERE order_id   <> '';
CREATE UNIQUE INDEX IF NOT EXISTS payments_payment     ON payments (payment_id) WHERE payment_id <> '';
CREATE INDEX        IF NOT EXISTS payments_beneficiary ON payments (beneficiary_id, status);
CREATE INDEX        IF NOT EXISTS payments_user        ON payments (user_id, created_at DESC);

-- ------------------------------------------------ verification requests
CREATE TABLE IF NOT EXISTS verification_requests (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT        NOT NULL DEFAULT '',
  route                   TEXT        NOT NULL DEFAULT 'FOLLOWERS',
  platform                TEXT        NOT NULL DEFAULT '',
  profile_url             TEXT        NOT NULL DEFAULT '',
  claimed_follower_count  INTEGER     NOT NULL DEFAULT 0,
  fee_amount              INTEGER     NOT NULL DEFAULT 0,
  payment_reference       TEXT        NOT NULL DEFAULT '',
  status                  TEXT        NOT NULL DEFAULT 'PENDING',
  note                    TEXT        NOT NULL DEFAULT '',
  reviewed_by             TEXT        NOT NULL DEFAULT '',
  reviewed_at             TIMESTAMPTZ,
  verified_follower_count INTEGER     NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most one open request per creator.
CREATE UNIQUE INDEX IF NOT EXISTS verification_one_pending
  ON verification_requests (user_id) WHERE status = 'PENDING';

-- --------------------------------------------------------- notifications
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT        NOT NULL DEFAULT '',
  type       TEXT        NOT NULL DEFAULT '',
  actor_id   TEXT        NOT NULL DEFAULT '',
  target_id  TEXT        NOT NULL DEFAULT '',
  count      INTEGER     NOT NULL DEFAULT 1,
  meta       TEXT        NOT NULL DEFAULT '',
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, created_at DESC);
-- Coalescing target: one unread row per (recipient, type, actor).
CREATE UNIQUE INDEX IF NOT EXISTS notifications_coalesce
  ON notifications (user_id, type, actor_id) WHERE read_at IS NULL;

-- ---------------------------------------------------------------- config
-- Runtime settings. Script Properties in the Apps Script build, an AppConfig
-- tab on Sheets, a table here.
CREATE TABLE IF NOT EXISTS app_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- ------------------------------------------------------------ migrations
-- Additive, for databases created by an earlier version.
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT NOT NULL DEFAULT '';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'PUBLIC';
