/**
 * Every tunable in one place. Values that an operator may want to change
 * without a deploy are read from the environment; the rest are product rules.
 */

/**
 * Reads a setting without importing the platform shim, which would create a
 * cycle: the shim's Apps Script implementation reads Script Properties, and this
 * file is loaded before it. The Apps Script bundle replaces this function.
 */
function env_raw(name) {
  // eslint-disable-next-line no-undef
  if (typeof process !== 'undefined' && process.env) return process.env[name];
  // eslint-disable-next-line no-undef
  if (typeof PropertiesService !== 'undefined') return PropertiesService.getScriptProperties().getProperty(name);
  return undefined;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export const POST_TTL_DAYS = 30;
export const SUBSCRIPTION_TTL_DAYS = 30;
export const SESSION_TTL_DAYS = 30;

// ---------------------------------------------------------------- auth
// scrypt, which Apps Script could not offer. The cost parameters below are the
// real security upgrade over the previous salted-SHA256 loop.
export const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/**
 * PBKDF2 parameters, used when PASSWORD_ALGO is 'pbkdf2' and always on Apps
 * Script, which has no scrypt.
 *
 * 210,000 is the OWASP figure for PBKDF2-SHA256 and is what Node uses. Apps
 * Script overrides it downwards in platform-gas.js territory — every iteration
 * there is a separate call across the JavaScript bridge, so the ceiling is a few
 * thousand before a login takes longer than a person will wait. The iteration
 * count is stored in the hash, so lowering it does not invalidate old hashes.
 */
export const PBKDF2 = {
  iterations: Number(env_raw('PBKDF2_ITERATIONS')) || 210000,
  keylen: 32
};

/**
 * Which algorithm new passwords use.
 *
 *   scrypt  (default) memory-hard, Node only
 *   pbkdf2            portable — set this if the SAME accounts must work on
 *                     both a Netlify and an Apps Script deployment
 */
export const PASSWORD_ALGO = (env_raw('PASSWORD_ALGO') || 'scrypt').toLowerCase();
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const PASSWORD_MIN_LENGTH = 8;

export const VALIDATION = {
  // Provider-agnostic: this is the app's own credential system, not Google
  // sign-in, so any well-formed address is valid.
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  username: /^[a-z0-9_]{3,20}$/
};

// -------------------------------------------------------- verification
export const VERIFICATION_FEE = 2500;
export const MIN_FOLLOWERS_TO_APPLY = 4000;
export const BADGE_MIN_FOLLOWERS = 5000;

/** Highest threshold first: the first match wins. */
export const BADGE_TIERS = [
  { key: 'PURPLE', label: 'Purple', color: '#a855f7', min: 20000 },
  { key: 'BLUE',   label: 'Blue',   color: '#3b82f6', min: 15000 },
  { key: 'RED',    label: 'Red',    color: '#ef4444', min: 10000 },
  { key: 'YELLOW', label: 'Yellow', color: '#eab308', min: 5000  }
];

export const SUPPORTED_PLATFORMS = ['FACEBOOK', 'INSTAGRAM', 'YOUTUBE', 'X', 'TIKTOK', 'OTHER'];

// ------------------------------------------------------------ payments
export const PAYMENT_CURRENCY = 'INR';
export const RAZORPAY_API = 'https://api.razorpay.com/v1';
export const DEFAULT_COMMISSION_PERCENT = 15;
export const TIP_MIN_RUPEES = 10;
export const TIP_MAX_RUPEES = 100000;

// ------------------------------------------------------------ reminders
export const REMINDER_LEAD_DAYS = 5;
export const WINBACK_WINDOW_DAYS = 7;
export const NOTIFICATION_TTL_DAYS = 60;

// --------------------------------------------------------------- media
// No base64 argument ceiling here, unlike Apps Script, so these are product
// choices rather than platform workarounds. Netlify caps a function request at
// 6MB after base64 inflation, so the client uploads binary via multipart.
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
export const MEDIA_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MEDIA_MAX_VIDEO_BYTES = 40 * 1024 * 1024;
// Avatars are downscaled to 512px by the client, so this only catches abuse.
export const MEDIA_MAX_AVATAR_BYTES = 4 * 1024 * 1024;

/**
 * Private media is served through short-lived signed URLs. A browser will not
 * attach an Authorization header to an <img> or <video> request, so a bearer
 * token cannot gate the file itself — the entitlement has to travel in the URL.
 * Links expire, so one leaked address does not become permanent access.
 */
export const MEDIA_SIGNATURE_TTL_MS = 6 * 60 * 60 * 1000;

// ------------------------------------------------------------ discovery
export const SCORE_WEIGHTS = {
  like: 1,
  comment: 3,
  share: 2,
  follower: 0.5,
  subscriber: 4
};

export const RECENCY_TIERS = [
  { maxDays: 2,   weight: 1.0 },
  { maxDays: 7,   weight: 0.75 },
  { maxDays: 14,  weight: 0.45 },
  { maxDays: 999, weight: 0.25 }
];

export const COMMENT_MAX_LENGTH = 500;
export const MESSAGE_MAX_LENGTH = 1000;

// ---------------------------------------------------------- chat themes
// Held server-side so the client only ever stores a key; a crafted preference
// string can never reach a style attribute.
export const CHAT_THEMES = [
  { key: 'MIDNIGHT', label: 'Midnight', ownFrom: '#C9A227', ownTo: '#A46E3C', peerBg: '#211C17', canvas: '#0A0908', accent: '#DCB854' },
  { key: 'AURORA',   label: 'Aurora',   ownFrom: '#14b8a6', ownTo: '#0ea5e9', peerBg: '#0f2e2c', canvas: '#04121a', accent: '#2dd4bf' },
  { key: 'SUNSET',   label: 'Sunset',   ownFrom: '#f97316', ownTo: '#e11d48', peerBg: '#2c1a1c', canvas: '#170a0d', accent: '#fb923c' },
  { key: 'ROSEGOLD', label: 'Rose Gold', ownFrom: '#f472b6', ownTo: '#f59e0b', peerBg: '#2b1c26', canvas: '#180e15', accent: '#f9a8d4' },
  { key: 'ROYAL',    label: 'Royal',    ownFrom: '#2563eb', ownTo: '#7e22ce', peerBg: '#161e37', canvas: '#070b1b', accent: '#60a5fa' },
  { key: 'NOIR',     label: 'Noir',     ownFrom: '#475569', ownTo: '#0f172a', peerBg: '#1c222c', canvas: '#0a0d12', accent: '#94a3b8' },
  { key: 'EMERALD',  label: 'Emerald',  ownFrom: '#059669', ownTo: '#15803d', peerBg: '#12241c', canvas: '#05120c', accent: '#34d399' },
  { key: 'CRIMSON',  label: 'Crimson',  ownFrom: '#e11d48', ownTo: '#9f1239', peerBg: '#2a151b', canvas: '#150609', accent: '#fb7185' }
];
export const DEFAULT_CHAT_THEME = 'MIDNIGHT';

export const NOTIFICATION_TYPES = [
  'FOLLOW', 'MESSAGE', 'SUBSCRIPTION', 'VERIFICATION', 'TIP',
  'SUB_EXPIRING', 'SUB_EXPIRED', 'SUB_CHURNED', 'LIKE', 'COMMENT'
];

/** Types where a burst from one actor stacks instead of flooding. */
export const COALESCING_TYPES = ['MESSAGE', 'FOLLOW', 'LIKE'];

// --------------------------------------------------------- environment
export const env = {
  /**
   * Either database will do; setting one selects it. Postgres wins if both are
   * set — see src/lib/store.js.
   *
   * Supabase: Project Settings → Database → Connection string. Use the POOLED
   * string (port 6543). Serverless functions open many short-lived connections
   * and the direct 5432 string will exhaust the connection limit.
   */
  databaseUrl: () => String(env_raw('DATABASE_URL') || '').trim(),

  // Google Sheets as the system of record. The service account must be given
  // Editor access to the spreadsheet by sharing it with GOOGLE_CLIENT_EMAIL —
  // creating the key alone grants nothing.
  spreadsheetId: () => String(env_raw('GOOGLE_SHEET_ID') || '').trim(),
  googleClientEmail: () => String(env_raw('GOOGLE_CLIENT_EMAIL') || '').trim(),
  googlePrivateKey: () => String(env_raw('GOOGLE_PRIVATE_KEY') || ''),
  razorpayKeyId: () => String(env_raw('RAZORPAY_KEY_ID') || '').trim(),
  razorpayKeySecret: () => String(env_raw('RAZORPAY_KEY_SECRET') || '').trim(),
  razorpayWebhookSecret: () => String(env_raw('RAZORPAY_WEBHOOK_SECRET') || '').trim(),
  // Signs private media URLs. Falls back to the Razorpay secret so the app
  // still gates correctly if this was never set, but set it explicitly:
  // rotating the payment secret would otherwise invalidate every media link.
  mediaSecret: () => String(env_raw('MEDIA_URL_SECRET') || env_raw('RAZORPAY_KEY_SECRET')
                      || 'vibestar-insecure-development-secret').trim(),
  adminEmails: () => String(env_raw('ADMIN_EMAILS') || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  commissionPercent: () => {
    const raw = env_raw('PLATFORM_COMMISSION_PERCENT');
    if (raw === undefined || String(raw).trim() === '') return DEFAULT_COMMISSION_PERCENT;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 100) return DEFAULT_COMMISSION_PERCENT;
    return value;
  },
  siteUrl: () => String(env_raw('URL') || env_raw('DEPLOY_PRIME_URL') || 'http://localhost:8888')
    .replace(/\/+$/, ''),
  /** RAZORPAY once both keys exist, otherwise DEMO. */
  paymentMode: () => (env.razorpayKeyId() && env.razorpayKeySecret() ? 'RAZORPAY' : 'DEMO'),
  isLiveKey: () => env.razorpayKeyId().startsWith('rzp_live')
};
