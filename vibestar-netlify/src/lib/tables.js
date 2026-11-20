/**
 * THE SCHEMA, INDEPENDENT OF WHERE IT IS STORED.
 *
 * VibeStar can run on either backend:
 *
 *   Google Sheets — a tab per table, readable by hand, hard rate ceiling
 *   Supabase / Postgres — real indexes, real transactions, no ceiling
 *
 * Both read their shape from this file, so a column is declared once and the
 * routes never learn which one is behind them. Column TYPES exist for the
 * spreadsheet's benefit — Postgres knows its own types, but a cell does not, so
 * `is_admin` has to be told it is a boolean rather than the string "TRUE".
 */

export const T = { TEXT: 'text', INT: 'int', NUM: 'num', BOOL: 'bool', TS: 'ts' };

/**
 * Column order is the spreadsheet's column order — adding a column here means
 * adding it at the right of that tab. Never reorder these; Sheets addresses
 * cells by position. Postgres does not care, but the two must agree.
 */
export const TABLES = {
  Users: {
    id: T.TEXT, full_name: T.TEXT, username: T.TEXT, email: T.TEXT,
    password_hash: T.TEXT, password_salt: T.TEXT, role: T.TEXT, category: T.TEXT,
    bio: T.TEXT, avatar_url: T.TEXT, banner_url: T.TEXT, monthly_price: T.INT,
    is_admin: T.BOOL, verification_status: T.TEXT, verification_route: T.TEXT,
    verified_follower_count: T.INT, verified_at: T.TS, status: T.TEXT,
    status_reason: T.TEXT, status_changed_at: T.TS, chat_theme: T.TEXT, created_at: T.TS
  },
  Posts: {
    id: T.TEXT, author_id: T.TEXT, type: T.TEXT, caption: T.TEXT, media_url: T.TEXT,
    status: T.TEXT, visibility: T.TEXT, share_views: T.INT, created_at: T.TS, expires_at: T.TS
  },
  Subscriptions: {
    id: T.TEXT, subscriber_id: T.TEXT, celebrity_id: T.TEXT, status: T.TEXT,
    expiring_notified_at: T.TS, expired_notified_at: T.TS, created_at: T.TS, expires_at: T.TS
  },
  Messages: {
    id: T.TEXT, subscriber_id: T.TEXT, celebrity_id: T.TEXT, sender_id: T.TEXT,
    content: T.TEXT, read_at: T.TS, created_at: T.TS
  },
  Follows: {
    id: T.TEXT, follower_id: T.TEXT, followee_id: T.TEXT, created_at: T.TS
  },
  Likes: {
    id: T.TEXT, post_id: T.TEXT, user_id: T.TEXT, created_at: T.TS
  },
  // Bookmarks. Private to the owner: a save count is never shown to anyone,
  // because "who saved this" is a much more revealing signal than "who liked it".
  Saves: {
    id: T.TEXT, user_id: T.TEXT, post_id: T.TEXT, created_at: T.TS
  },
  Comments: {
    id: T.TEXT, post_id: T.TEXT, user_id: T.TEXT, content: T.TEXT,
    status: T.TEXT, created_at: T.TS
  },
  Media: {
    id: T.TEXT, owner_id: T.TEXT, store_key: T.TEXT, kind: T.TEXT,
    mime_type: T.TEXT, bytes: T.INT, url: T.TEXT, created_at: T.TS
  },
  Payments: {
    id: T.TEXT, user_id: T.TEXT, purpose: T.TEXT, target_id: T.TEXT,
    beneficiary_id: T.TEXT, order_id: T.TEXT, payment_id: T.TEXT,
    amount_paise: T.INT, currency: T.TEXT, status: T.TEXT, mode: T.TEXT,
    commission_percent: T.NUM, commission_paise: T.INT, net_paise: T.INT,
    signature_verified: T.BOOL, failure_reason: T.TEXT,
    created_at: T.TS, paid_at: T.TS, granted_at: T.TS
  },
  VerificationRequests: {
    id: T.TEXT, user_id: T.TEXT, route: T.TEXT, platform: T.TEXT, profile_url: T.TEXT,
    claimed_follower_count: T.INT, fee_amount: T.INT, payment_reference: T.TEXT,
    status: T.TEXT, note: T.TEXT, reviewed_by: T.TEXT, reviewed_at: T.TS,
    verified_follower_count: T.INT, created_at: T.TS
  },
  Notifications: {
    id: T.TEXT, user_id: T.TEXT, type: T.TEXT, actor_id: T.TEXT, target_id: T.TEXT,
    count: T.INT, meta: T.TEXT, read_at: T.TS, created_at: T.TS
  },
  AppConfig: {
    key: T.TEXT, value: T.TEXT
  }
};

/**
 * How a row is identified for an update or a delete.
 *
 * The Sheets backend can use a row's position, but Postgres needs a real key —
 * and relying on position would be wrong there anyway, since SQL makes no
 * promise about row order.
 */
export const PRIMARY_KEYS = {
  AppConfig: 'key'
};
export const primaryKeyOf = (table) => PRIMARY_KEYS[table] || 'id';

/** Postgres table name for a logical table: Users -> users. */
export const sqlNameOf = (table) => ({
  VerificationRequests: 'verification_requests',
  AppConfig: 'app_config'
}[table] || table.toLowerCase());

export const TABLE_NAMES = Object.keys(TABLES);
export const columnsOf = (table) => Object.keys(TABLES[table]);
export const widthOf = (table) => columnsOf(table).length;

/** The Sheets tab used for mutual exclusion. Not a data table. */
export const LOCK_TAB = '_Lock';

// ------------------------------------------------------------- predicates
export const isActive = (row) => String(row?.status || 'ACTIVE').toUpperCase() === 'ACTIVE';

/** A subscription that is ACTIVE and has not run out. */
export function liveSubscription(row, now = Date.now()) {
  return String(row.status).toUpperCase() === 'ACTIVE' && new Date(row.expires_at).getTime() > now;
}

/**
 * A post is live if it says so AND its 30-day window is still open.
 *
 * Checking the clock rather than trusting the stored status is what lets the
 * feed avoid writing on every read — which mattered enormously on Sheets, where
 * write quota is scarce, and is simply tidier on Postgres. Either way expiry
 * becomes a property of time, and the scheduled job only catches the stored
 * value up afterwards.
 */
export function livePost(row, now = Date.now()) {
  return String(row.status).toUpperCase() === 'ACTIVE' && new Date(row.expires_at).getTime() > now;
}
