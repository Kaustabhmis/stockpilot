// safeEquals is imported as well as re-exported: `export … from` creates no
// local binding, and this module uses it in verifyMediaSignature. The
// implementation is the platform's, because constant-time comparison differs
// per runtime; callers still get it from here so there is one import site.
import { randomHex, hmacSha256Hex, safeEquals } from './platform.js';

export { safeEquals };
import {
  BADGE_TIERS, BADGE_MIN_FOLLOWERS, CHAT_THEMES, DEFAULT_CHAT_THEME,
  RECENCY_TIERS, SCORE_WEIGHTS, DAY_MS, MEDIA_SIGNATURE_TTL_MS, env
} from './config.js';

// ------------------------------------------------------------- responses
export function ok(data = {}) {
  return { statusCode: 200, body: JSON.stringify({ ok: true, ...data }) };
}

export function fail(error, statusCode = 200, extra = {}) {
  // Handled business failures return 200 with ok:false so the client can show
  // the message; only genuine transport/auth problems use error codes.
  return { statusCode, body: JSON.stringify({ ok: false, error, ...extra }) };
}

export const HTTP = {
  unauthorized: () => fail('SESSION_EXPIRED', 401),
  forbidden: () => fail('FORBIDDEN', 403),
  notFound: () => fail('Not found', 404),
  badRequest: (message) => fail(message || 'Bad request', 400),
  serverError: (message) => fail(message || 'Something went wrong.', 500)
};

// ---------------------------------------------------------------- ids
export function newId(prefix) {
  return `${prefix}_${randomHex(9)}`;
}

export function newToken() {
  return randomHex(32);
}

// --------------------------------------------------------- sanitisation
export function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

/** Only http(s) survives, so javascript: and data: URLs never reach the DOM. */
export function sanitizeUrl(value) {
  const url = String(value || '').trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(url) ? url : '';
}

export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ------------------------------------------------------------ formatting
export function toIso(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export function toMillis(value) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

// ------------------------------------------------------- domain helpers
/** Legacy-safe status read. */
export function userStatusOf(row) {
  return String(row?.status || 'ACTIVE').toUpperCase();
}

export function verificationStatusOf(row) {
  return String(row?.verification_status || 'NONE').toUpperCase();
}

export function chatThemeKeyOf(row) {
  const key = String(row?.chat_theme || '').toUpperCase();
  return CHAT_THEMES.some((t) => t.key === key) ? key : DEFAULT_CHAT_THEME;
}

/**
 * The badge, or null. Driven strictly by the admin-verified external follower
 * count — never by in-app follows, which could be farmed with throwaway
 * accounts to mint a top tier.
 */
export function badgeFor(row) {
  if (verificationStatusOf(row) !== 'APPROVED') return null;

  const followers = Number(row.verified_follower_count) || 0;
  if (followers < BADGE_MIN_FOLLOWERS) return null;

  const index = BADGE_TIERS.findIndex((t) => followers >= t.min);
  if (index === -1) return null;

  const tier = BADGE_TIERS[index];
  const next = index > 0 ? BADGE_TIERS[index - 1] : null;

  return {
    key: tier.key,
    label: tier.label,
    color: tier.color,
    minFollowers: tier.min,
    followers,
    nextTier: next
      ? { key: next.key, label: next.label, color: next.color, min: next.min, remaining: next.min - followers }
      : null
  };
}

export function isAdminUser(row) {
  if (!row) return false;
  if (row.is_admin === true) return true;
  return env.adminEmails().includes(String(row.email || '').toLowerCase());
}

/** The only user shape that leaves the server. Credentials are dropped. */
export function publicUser(row) {
  if (!row) return null;
  const status = verificationStatusOf(row);
  return {
    id: row.id,
    fullName: row.full_name,
    username: row.username,
    role: row.role,
    category: row.category || (row.role === 'CELEBRITY' ? 'Creator' : ''),
    bio: row.bio || '',
    avatarUrl: sanitizeUrl(row.avatar_url),
    bannerUrl: sanitizeUrl(row.banner_url),
    isVerified: status === 'APPROVED',
    verificationStatus: status,
    verifiedFollowerCount: Number(row.verified_follower_count) || 0,
    badge: badgeFor(row),
    isAdmin: isAdminUser(row),
    status: userStatusOf(row),
    chatTheme: chatThemeKeyOf(row),
    monthlyPrice: Number(row.monthly_price) || 0,
    createdAt: toIso(row.created_at)
  };
}

// -------------------------------------------------- private media signing
/**
 * Signs a media key for one viewer for a limited window.
 *
 * Bound to the viewer id as well as the key, so a subscriber cannot hand a
 * working link to someone who has not paid — and it expires, so even that
 * sharing has a short half-life.
 */
export function signMediaUrl(storeKey, viewerId, ttlMs = MEDIA_SIGNATURE_TTL_MS) {
  const expires = Date.now() + ttlMs;
  const signature = mediaSignature(storeKey, viewerId, expires);
  return `${env.siteUrl()}/media/${encodeURIComponent(storeKey)}`
       + `?v=${encodeURIComponent(viewerId)}&e=${expires}&s=${signature}`;
}

export function mediaSignature(storeKey, viewerId, expires) {
  return hmacSha256Hex(`${storeKey}|${viewerId}|${expires}`, env.mediaSecret());
}

export function verifyMediaSignature(storeKey, viewerId, expires, signature) {
  const expiryMs = Number(expires);
  if (!Number.isFinite(expiryMs) || expiryMs < Date.now()) return false;
  return safeEquals(mediaSignature(storeKey, viewerId, expiryMs), String(signature || ''));
}

/** The store key embedded in a /media/<key> URL, or '' if it is not one. */
export function mediaKeyFromUrl(url) {
  const match = /\/media\/([^/?#]+)/.exec(String(url || ''));
  return match ? decodeURIComponent(match[1]) : '';
}

// -------------------------------------------------------------- scoring
export function recencyWeight(createdAt) {
  const ageDays = (Date.now() - toMillis(createdAt)) / DAY_MS;
  const tier = RECENCY_TIERS.find((t) => ageDays <= t.maxDays);
  return tier ? tier.weight : RECENCY_TIERS[RECENCY_TIERS.length - 1].weight;
}

export function postScore({ likeCount = 0, commentCount = 0, shareViews = 0 }) {
  return likeCount * SCORE_WEIGHTS.like
       + commentCount * SCORE_WEIGHTS.comment
       + shareViews * SCORE_WEIGHTS.share;
}

/** Commission split. Floors the fee so rounding never shorts the creator. */
export function splitAmount(amountPaise, percent) {
  const gross = Math.max(0, Math.round(Number(amountPaise) || 0));
  const rate = Math.min(100, Math.max(0, Number(percent) || 0));
  const commission = Math.floor((gross * rate) / 100);
  return { gross, commission, net: gross - commission };
}
