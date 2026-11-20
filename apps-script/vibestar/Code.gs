/**
 * VibeStar — Google Apps Script build
 *
 * GENERATED FILE. Do not edit.
 *   Source:   vibestar-netlify/src/
 *   Rebuild:  npm run build:gas
 *
 * Built 2026-11-20T04:54:35.597Z
 *
 * ---------------------------------------------------------------------------
 * SETUP, IN ORDER
 *
 *   1. Extensions -> Apps Script from inside the spreadsheet you want to use.
 *      (Or a standalone project, with GOOGLE_SHEET_ID in Script properties.)
 *   2. Paste this file as Code.gs and Index.html as an HTML file named Index.
 *   3. Run setUpSpreadsheet() once from the editor. Approve the permissions
 *      when prompted — the prompt only appears on an editor run, which is why
 *      this step cannot be skipped.
 *   4. Run installTrigger() once, for nightly expiry and reminders.
 *   5. Deploy -> New deployment -> Web app.
 *        Execute as:      Me
 *        Who has access:  Anyone
 *   6. Optional: Project Settings -> Script properties
 *        RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET   to take real payments
 *        MEDIA_URL_SECRET                       any long random string
 *        ADMIN_EMAILS                           comma-separated bootstrap admins
 *        PBKDF2_ITERATIONS                      defaults to 4096 here
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS TARGET CANNOT DO, being honest about it
 *
 *   * NO LINK PREVIEW CARDS. The page is served inside a googleusercontent
 *     iframe, so a crawler never sees its Open Graph tags. Shared links work;
 *     they just render as a bare URL.
 *   * NO WEBHOOK SIGNATURE VERIFICATION. doPost exposes no request headers, so
 *     X-Razorpay-Signature is unreadable. The body is used only to decide which
 *     payment to re-fetch from Razorpay, which is what keeps it safe.
 *   * WEAKER PASSWORD HASHING. No scrypt, and every PBKDF2 iteration is a
 *     bridge call, so the count has to stay in the thousands.
 *   * SLOWER PRIVATE GALLERIES. Apps Script cannot serve binary, so
 *     subscriber-only media travels as a base64 data URI instead of a cacheable
 *     signed URL.
 *
 * The Netlify deployment does all four properly. This target exists because it
 * runs with nothing but a Google account.
 */



// ==========================================================================
// src/lib/tables.js
// ==========================================================================

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

const T = { TEXT: 'text', INT: 'int', NUM: 'num', BOOL: 'bool', TS: 'ts' };

/**
 * Column order is the spreadsheet's column order — adding a column here means
 * adding it at the right of that tab. Never reorder these; Sheets addresses
 * cells by position. Postgres does not care, but the two must agree.
 */
const TABLES = {
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
const PRIMARY_KEYS = {
  AppConfig: 'key'
};
const primaryKeyOf = (table) => PRIMARY_KEYS[table] || 'id';

/** Postgres table name for a logical table: Users -> users. */
const sqlNameOf = (table) => ({
  VerificationRequests: 'verification_requests',
  AppConfig: 'app_config'
}[table] || table.toLowerCase());

const TABLE_NAMES = Object.keys(TABLES);
const columnsOf = (table) => Object.keys(TABLES[table]);
const widthOf = (table) => columnsOf(table).length;

/** The Sheets tab used for mutual exclusion. Not a data table. */
const LOCK_TAB = '_Lock';

// ------------------------------------------------------------- predicates
const isActive = (row) => String(row?.status || 'ACTIVE').toUpperCase() === 'ACTIVE';

/** A subscription that is ACTIVE and has not run out. */
function liveSubscription(row, now = Date.now()) {
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
function livePost(row, now = Date.now()) {
  return String(row.status).toUpperCase() === 'ACTIVE' && new Date(row.expires_at).getTime() > now;
}


// ==========================================================================
// src/lib/config.js
// ==========================================================================

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
  // Script Properties are Apps Script's environment variables. Cached, because
  // getProperties is a service call and config is read repeatedly at load.
  if (!env_raw.cache) env_raw.cache = PropertiesService.getScriptProperties().getProperties();
  return env_raw.cache[name];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const POST_TTL_DAYS = 30;
const SUBSCRIPTION_TTL_DAYS = 30;
const SESSION_TTL_DAYS = 30;

// ---------------------------------------------------------------- auth
// scrypt, which Apps Script could not offer. The cost parameters below are the
// real security upgrade over the previous salted-SHA256 loop.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

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
const PBKDF2 = {
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
const PASSWORD_ALGO = (env_raw('PASSWORD_ALGO') || 'scrypt').toLowerCase();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 8;

const VALIDATION = {
  // Provider-agnostic: this is the app's own credential system, not Google
  // sign-in, so any well-formed address is valid.
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  username: /^[a-z0-9_]{3,20}$/
};

// -------------------------------------------------------- verification
const VERIFICATION_FEE = 2500;
const MIN_FOLLOWERS_TO_APPLY = 4000;
const BADGE_MIN_FOLLOWERS = 5000;

/** Highest threshold first: the first match wins. */
const BADGE_TIERS = [
  { key: 'PURPLE', label: 'Purple', color: '#a855f7', min: 20000 },
  { key: 'BLUE',   label: 'Blue',   color: '#3b82f6', min: 15000 },
  { key: 'RED',    label: 'Red',    color: '#ef4444', min: 10000 },
  { key: 'YELLOW', label: 'Yellow', color: '#eab308', min: 5000  }
];

const SUPPORTED_PLATFORMS = ['FACEBOOK', 'INSTAGRAM', 'YOUTUBE', 'X', 'TIKTOK', 'OTHER'];

// ------------------------------------------------------------ payments
const PAYMENT_CURRENCY = 'INR';
const RAZORPAY_API = 'https://api.razorpay.com/v1';
const DEFAULT_COMMISSION_PERCENT = 15;
const TIP_MIN_RUPEES = 10;
const TIP_MAX_RUPEES = 100000;

// ------------------------------------------------------------ reminders
const REMINDER_LEAD_DAYS = 5;
const WINBACK_WINDOW_DAYS = 7;
const NOTIFICATION_TTL_DAYS = 60;

// --------------------------------------------------------------- media
// No base64 argument ceiling here, unlike Apps Script, so these are product
// choices rather than platform workarounds. Netlify caps a function request at
// 6MB after base64 inflation, so the client uploads binary via multipart.
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const MEDIA_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MEDIA_MAX_VIDEO_BYTES = 40 * 1024 * 1024;
// Avatars are downscaled to 512px by the client, so this only catches abuse.
const MEDIA_MAX_AVATAR_BYTES = 4 * 1024 * 1024;

/**
 * Private media is served through short-lived signed URLs. A browser will not
 * attach an Authorization header to an <img> or <video> request, so a bearer
 * token cannot gate the file itself — the entitlement has to travel in the URL.
 * Links expire, so one leaked address does not become permanent access.
 */
const MEDIA_SIGNATURE_TTL_MS = 6 * 60 * 60 * 1000;

// ------------------------------------------------------------ discovery
const SCORE_WEIGHTS = {
  like: 1,
  comment: 3,
  share: 2,
  follower: 0.5,
  subscriber: 4
};

const RECENCY_TIERS = [
  { maxDays: 2,   weight: 1.0 },
  { maxDays: 7,   weight: 0.75 },
  { maxDays: 14,  weight: 0.45 },
  { maxDays: 999, weight: 0.25 }
];

const COMMENT_MAX_LENGTH = 500;
const MESSAGE_MAX_LENGTH = 1000;

// ---------------------------------------------------------- chat themes
// Held server-side so the client only ever stores a key; a crafted preference
// string can never reach a style attribute.
const CHAT_THEMES = [
  { key: 'MIDNIGHT', label: 'Midnight', ownFrom: '#C9A227', ownTo: '#A46E3C', peerBg: '#211C17', canvas: '#0A0908', accent: '#DCB854' },
  { key: 'AURORA',   label: 'Aurora',   ownFrom: '#14b8a6', ownTo: '#0ea5e9', peerBg: '#0f2e2c', canvas: '#04121a', accent: '#2dd4bf' },
  { key: 'SUNSET',   label: 'Sunset',   ownFrom: '#f97316', ownTo: '#e11d48', peerBg: '#2c1a1c', canvas: '#170a0d', accent: '#fb923c' },
  { key: 'ROSEGOLD', label: 'Rose Gold', ownFrom: '#f472b6', ownTo: '#f59e0b', peerBg: '#2b1c26', canvas: '#180e15', accent: '#f9a8d4' },
  { key: 'ROYAL',    label: 'Royal',    ownFrom: '#2563eb', ownTo: '#7e22ce', peerBg: '#161e37', canvas: '#070b1b', accent: '#60a5fa' },
  { key: 'NOIR',     label: 'Noir',     ownFrom: '#475569', ownTo: '#0f172a', peerBg: '#1c222c', canvas: '#0a0d12', accent: '#94a3b8' },
  { key: 'EMERALD',  label: 'Emerald',  ownFrom: '#059669', ownTo: '#15803d', peerBg: '#12241c', canvas: '#05120c', accent: '#34d399' },
  { key: 'CRIMSON',  label: 'Crimson',  ownFrom: '#e11d48', ownTo: '#9f1239', peerBg: '#2a151b', canvas: '#150609', accent: '#fb7185' }
];
const DEFAULT_CHAT_THEME = 'MIDNIGHT';

const NOTIFICATION_TYPES = [
  'FOLLOW', 'MESSAGE', 'SUBSCRIPTION', 'VERIFICATION', 'TIP',
  'SUB_EXPIRING', 'SUB_EXPIRED', 'SUB_CHURNED', 'LIKE', 'COMMENT'
];

/** Types where a burst from one actor stacks instead of flooding. */
const COALESCING_TYPES = ['MESSAGE', 'FOLLOW', 'LIKE'];

// --------------------------------------------------------- environment
const env = {
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


// ==========================================================================
// src/lib/platform-gas.js
// ==========================================================================

/* eslint-disable no-undef */
/**
 * THE APPS SCRIPT HALF OF THE PLATFORM SHIM.
 *
 * Same names as platform-node.js, implemented with Utilities and
 * PropertiesService. This file is never imported by the Node build — the Apps
 * Script bundler substitutes it for platform-node.js when generating Code.gs.
 *
 * Apps Script has no `crypto`, no Buffer and no environment variables, so each
 * primitive is rebuilt from what Utilities offers. Two of them are worth reading
 * carefully, because they are where the platform genuinely constrains the app:
 * password hashing and constant-time comparison.
 */

const PLATFORM = 'APPS_SCRIPT';

/** Utilities.getUuid is the only randomness Apps Script exposes. */
function randomHex(bytes) {
  let hex = '';
  while (hex.length < bytes * 2) {
    hex += Utilities.getUuid().replace(/-/g, '');
  }
  return hex.slice(0, bytes * 2);
}

function base64Encode(input) {
  if (typeof input === 'string') return Utilities.base64Encode(input, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(input);
}

/** Returns a byte array, which is what DriveApp and Utilities work in. */
function base64DecodeToBytes(base64) {
  return Utilities.base64Decode(String(base64));
}

function byteLength(bytes) {
  return bytes.length;
}

function toHex(byteArray) {
  let hex = '';
  for (let i = 0; i < byteArray.length; i += 1) {
    // Apps Script's digest bytes are signed, so negative values need the & 0xFF.
    const value = (byteArray[i] + 256) % 256;
    hex += (value < 16 ? '0' : '') + value.toString(16);
  }
  return hex;
}

function hmacSha256Hex(message, secret) {
  return toHex(Utilities.computeHmacSha256Signature(String(message), String(secret)));
}

function sha256Hex(message) {
  return toHex(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(message), Utilities.Charset.UTF_8));
}

/**
 * Length-independent comparison, done by hand.
 *
 * There is no timingSafeEqual here. This accumulates the difference across every
 * character rather than returning early, which is the property that matters —
 * though a JIT is free to be cleverer than the source suggests, so treat this as
 * a strong mitigation rather than a guarantee.
 */
function safeEquals(a, b) {
  const left = String(a);
  const right = String(b);
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Utilities.sleep blocks the whole execution, which is what is wanted here: Apps
 * Script runs each request as its own process, so a lock retry loop genuinely
 * has to wait for another process to finish rather than yield to an event loop
 * it does not share.
 */
function sleep(ms) {
  Utilities.sleep(ms);
  return Promise.resolve();
}

/** Script Properties stand in for environment variables. */
function envGet(name) {
  const cached = envGet.cache || (envGet.cache = PropertiesService.getScriptProperties().getProperties());
  return cached[name];
}

// ------------------------------------------------------- password hashing
/**
 * PBKDF2-HMAC-SHA256 only. There is no scrypt on this platform and no way to
 * build one that runs inside a request.
 *
 * The iteration count is a genuine constraint rather than a choice: every
 * iteration is a separate Utilities.computeHmacSha256Signature call across the
 * JavaScript bridge, so the practical ceiling is a few thousand — nowhere near
 * the 600,000 OWASP suggests for PBKDF2-SHA256. That is a real weakness of
 * running auth on Apps Script, and the reason config.js defaults Node
 * deployments to scrypt instead.
 */
const SUPPORTED_ALGOS = ['pbkdf2'];

function scryptHex() {
  throw new Error(
    'This deployment cannot verify scrypt password hashes. Apps Script has no '
    + 'scrypt. The account was created by a Node/Netlify deployment configured '
    + 'for scrypt — set PASSWORD_ALGO=pbkdf2 there and have the user reset '
    + 'their password, or sign in through that deployment instead.'
  );
}

/** Real PBKDF2: U1 = HMAC(pw, salt || INT32BE(1)), Un = HMAC(pw, Un-1), XORed. */
function pbkdf2Hex(password, salt, iterations, keylen) {
  const blocks = Math.ceil(keylen / 32);
  let out = [];

  for (let block = 1; block <= blocks; block += 1) {
    const blockSuffix = String.fromCharCode(
      (block >>> 24) & 0xFF, (block >>> 16) & 0xFF, (block >>> 8) & 0xFF, block & 0xFF);

    let u = Utilities.computeHmacSha256Signature(String(salt) + blockSuffix, String(password));
    const accumulator = u.slice();

    for (let i = 1; i < iterations; i += 1) {
      u = Utilities.computeHmacSha256Signature(u, String(password));
      for (let j = 0; j < accumulator.length; j += 1) accumulator[j] ^= u[j];
    }
    out = out.concat(accumulator);
  }

  return Promise.resolve(toHex(out.slice(0, keylen)));
}

// --------------------------------------------------------- private media
/**
 * A subscriber-only file, as a data URI.
 *
 * Apps Script cannot serve binary, so there is no signed-URL equivalent of the
 * Netlify path. Returning the bytes inline through the already-authenticated API
 * response is what keeps the paywall real on this platform. driveDataUri lives
 * in src/gas/media-gas.js and is inlined into Code.gs alongside this.
 */
async function presentPrivateMedia(url) {
  const text = String(url || '');

  // Uploaded through this app: held unshared in Drive, so the bytes come back
  // inline and have no URL anyone could pass on.
  // eslint-disable-next-line no-use-before-define
  if (/^vibestar-drive:\/\//.test(text) || /drive\.google\.com/.test(text)) return driveDataUri(text);

  // Anything else is hosted somewhere we do not control — a creator pasting an
  // image URL — and was public wherever it lives regardless. There is nothing to
  // gate, so an entitled viewer simply gets it.
  return /^https?:\/\/[^\s"'<>]+$/i.test(text) ? text : '';
}


// ==========================================================================
// src/lib/util.js
// ==========================================================================

// safeEquals is imported as well as re-exported: `export … from` creates no
// local binding, and this module uses it in verifyMediaSignature. The
// implementation is the platform's, because constant-time comparison differs
// per runtime; callers still get it from here so there is one import site.


// ------------------------------------------------------------- responses
function ok(data = {}) {
  return { statusCode: 200, body: JSON.stringify({ ok: true, ...data }) };
}

function fail(error, statusCode = 200, extra = {}) {
  // Handled business failures return 200 with ok:false so the client can show
  // the message; only genuine transport/auth problems use error codes.
  return { statusCode, body: JSON.stringify({ ok: false, error, ...extra }) };
}

const HTTP = {
  unauthorized: () => fail('SESSION_EXPIRED', 401),
  forbidden: () => fail('FORBIDDEN', 403),
  notFound: () => fail('Not found', 404),
  badRequest: (message) => fail(message || 'Bad request', 400),
  serverError: (message) => fail(message || 'Something went wrong.', 500)
};

// ---------------------------------------------------------------- ids
function newId(prefix) {
  return `${prefix}_${randomHex(9)}`;
}

function newToken() {
  return randomHex(32);
}

// --------------------------------------------------------- sanitisation
function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

/** Only http(s) survives, so javascript: and data: URLs never reach the DOM. */
function sanitizeUrl(value) {
  const url = String(value || '').trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(url) ? url : '';
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ------------------------------------------------------------ formatting
function toIso(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function toMillis(value) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

// ------------------------------------------------------- domain helpers
/** Legacy-safe status read. */
function userStatusOf(row) {
  return String(row?.status || 'ACTIVE').toUpperCase();
}

function verificationStatusOf(row) {
  return String(row?.verification_status || 'NONE').toUpperCase();
}

function chatThemeKeyOf(row) {
  const key = String(row?.chat_theme || '').toUpperCase();
  return CHAT_THEMES.some((t) => t.key === key) ? key : DEFAULT_CHAT_THEME;
}

/**
 * The badge, or null. Driven strictly by the admin-verified external follower
 * count — never by in-app follows, which could be farmed with throwaway
 * accounts to mint a top tier.
 */
function badgeFor(row) {
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

function isAdminUser(row) {
  if (!row) return false;
  if (row.is_admin === true) return true;
  return env.adminEmails().includes(String(row.email || '').toLowerCase());
}

/** The only user shape that leaves the server. Credentials are dropped. */
function publicUser(row) {
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
function signMediaUrl(storeKey, viewerId, ttlMs = MEDIA_SIGNATURE_TTL_MS) {
  const expires = Date.now() + ttlMs;
  const signature = mediaSignature(storeKey, viewerId, expires);
  return `${env.siteUrl()}/media/${encodeURIComponent(storeKey)}`
       + `?v=${encodeURIComponent(viewerId)}&e=${expires}&s=${signature}`;
}

function mediaSignature(storeKey, viewerId, expires) {
  return hmacSha256Hex(`${storeKey}|${viewerId}|${expires}`, env.mediaSecret());
}

function verifyMediaSignature(storeKey, viewerId, expires, signature) {
  const expiryMs = Number(expires);
  if (!Number.isFinite(expiryMs) || expiryMs < Date.now()) return false;
  return safeEquals(mediaSignature(storeKey, viewerId, expiryMs), String(signature || ''));
}

/** The store key embedded in a /media/<key> URL, or '' if it is not one. */
function mediaKeyFromUrl(url) {
  const match = /\/media\/([^/?#]+)/.exec(String(url || ''));
  return match ? decodeURIComponent(match[1]) : '';
}

// -------------------------------------------------------------- scoring
function recencyWeight(createdAt) {
  const ageDays = (Date.now() - toMillis(createdAt)) / DAY_MS;
  const tier = RECENCY_TIERS.find((t) => ageDays <= t.maxDays);
  return tier ? tier.weight : RECENCY_TIERS[RECENCY_TIERS.length - 1].weight;
}

function postScore({ likeCount = 0, commentCount = 0, shareViews = 0 }) {
  return likeCount * SCORE_WEIGHTS.like
       + commentCount * SCORE_WEIGHTS.comment
       + shareViews * SCORE_WEIGHTS.share;
}

/** Commission split. Floors the fee so rounding never shorts the creator. */
function splitAmount(amountPaise, percent) {
  const gross = Math.max(0, Math.round(Number(amountPaise) || 0));
  const rate = Math.min(100, Math.max(0, Number(percent) || 0));
  const commission = Math.floor((gross * rate) / 100);
  return { gross, commission, net: gross - commission };
}


// ==========================================================================
// src/gas/kv-gas.js
// ==========================================================================

/* eslint-disable no-undef */
/**
 * SESSIONS AND LOGIN THROTTLING, APPS SCRIPT EDITION.
 *
 * Same interface as src/lib/kv.js, which uses Netlify Blobs.
 *
 * Sessions live in a spreadsheet tab here, and that is a deliberate reversal of
 * the Netlify decision. There, sessions were kept OUT of the spreadsheet because
 * resolving a token meant an HTTP round trip against a 300-reads-per-minute
 * quota. SpreadsheetApp has no such quota and the read is a native call, so the
 * tab is both cheap and durable — better than CacheService, which expires after
 * six hours and would log everybody out twice a day.
 *
 * Throttle counters DO go in CacheService: they are worthless after fifteen
 * minutes by definition, and writing a row per failed login attempt would grow
 * the spreadsheet for no reason.
 */

const SESSION_TAB = 'Sessions';
const SESSION_COLUMNS = ['token', 'user_id', 'created_at', 'expires_at'];

function book() {
  const id = PropertiesService.getScriptProperties().getProperty('GOOGLE_SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function sessionSheet() {
  const spreadsheet = book();
  let sheet = spreadsheet.getSheetByName(SESSION_TAB);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SESSION_TAB);
    sheet.getRange(1, 1, 1, SESSION_COLUMNS.length)
      .setValues([SESSION_COLUMNS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readSessions() {
  const sheet = sessionSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet.getRange(2, 1, lastRow - 1, SESSION_COLUMNS.length).getValues()
    .map((cells, index) => ({
      row: index + 2,
      token: String(cells[0] || ''),
      userId: String(cells[1] || ''),
      expiresAt: cells[3] instanceof Date ? cells[3].getTime() : Date.parse(String(cells[3] || '')) || 0
    }))
    .filter((entry) => entry.token);
}

async function putSession(token, userId, expiresAtMs) {
  const sheet = sessionSheet();
  sheet.appendRow([
    token, userId, new Date().toISOString(), new Date(expiresAtMs).toISOString()
  ]);
}

async function readSession(token) {
  if (!token) return '';

  const match = readSessions().find((entry) => entry.token === String(token));
  if (!match) return '';

  if (!match.expiresAt || match.expiresAt <= Date.now()) {
    // Cleaned up as encountered, so dead rows do not accumulate unboundedly
    // while waiting for the nightly sweep.
    try { sessionSheet().deleteRow(match.row); } catch (err) { /* already gone */ }
    return '';
  }
  return match.userId;
}

async function deleteSession(token) {
  if (!token) return;
  const match = readSessions().find((entry) => entry.token === String(token));
  if (match) sessionSheet().deleteRow(match.row);
}

/** Every session for one user, which is what makes a suspension bite at once. */
async function deleteUserSessions(userId) {
  const doomed = readSessions().filter((entry) => entry.userId === String(userId));
  const sheet = sessionSheet();

  // Highest row first: deleting shifts everything beneath up.
  doomed.map((entry) => entry.row).sort((a, b) => b - a)
    .forEach((row) => sheet.deleteRow(row));

  return doomed.length;
}

/** Drops expired rows. Called by the nightly maintenance trigger. */
function pruneSessions() {
  const now = Date.now();
  const expired = readSessions().filter((entry) => !entry.expiresAt || entry.expiresAt <= now);
  const sheet = sessionSheet();

  expired.map((entry) => entry.row).sort((a, b) => b - a)
    .forEach((row) => sheet.deleteRow(row));

  return expired.length;
}

// ------------------------------------------------------------- throttling
const throttleKey = (email) => `login:${String(email).toLowerCase()}`;

async function readThrottle(email) {
  try {
    const raw = CacheService.getScriptCache().get(throttleKey(email));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

async function writeThrottle(email, record) {
  try {
    // 15 minutes, matching LOGIN_WINDOW_MS — after which the record is
    // meaningless and the cache dropping it is the correct outcome.
    CacheService.getScriptCache().put(throttleKey(email), JSON.stringify(record), 900);
  } catch (err) { /* throttling is a mitigation, never a hard dependency */ }
}

async function clearThrottle(email) {
  try {
    CacheService.getScriptCache().remove(throttleKey(email));
  } catch (err) { /* already gone */ }
}


// ==========================================================================
// src/gas/media-gas.js
// ==========================================================================

/* eslint-disable no-undef */
/**
 * MEDIA ON APPS SCRIPT — Google Drive.
 *
 * PUBLIC uploads are shared with anyone-who-has-the-link, so <img> and <video>
 * can hotlink them and a crawler can fetch them for a preview card.
 *
 * PRIVATE uploads are NOT shared. That is the important part. Apps Script cannot
 * serve binary — ContentService returns text, JSON or XML and nothing else — so
 * the trick the Netlify build uses (a signed URL to a function that streams the
 * bytes) has no equivalent here. A shared Drive link would be readable by
 * anybody who obtained it, which would make the subscription paywall
 * decoration.
 *
 * So subscriber-only files are delivered as a base64 data URI inside the
 * authenticated API response. The entitlement check happens where it always
 * does, in the route, and the bytes never have a URL at all. The cost is real:
 * a data URI cannot be cached by the browser and inflates the payload by a
 * third, so private galleries are slower here than on Netlify. That is the
 * honest trade for keeping the paywall intact on this platform.
 */

const FOLDER_PROPERTY = 'VIBESTAR_DRIVE_FOLDER';

function mediaFolder() {
  const properties = PropertiesService.getScriptProperties();
  const saved = properties.getProperty(FOLDER_PROPERTY);

  if (saved) {
    try { return DriveApp.getFolderById(saved); } catch (err) { /* recreate below */ }
  }

  const existing = DriveApp.getFoldersByName('VibeStar Media');
  const folder = existing.hasNext() ? existing.next() : DriveApp.createFolder('VibeStar Media');
  properties.setProperty(FOLDER_PROPERTY, folder.getId());
  return folder;
}

/** Uploads bytes and returns { url, fileId }. */
function driveUpload(bytes, mimeType, filename, isPrivate) {
  const blob = Utilities.newBlob(bytes, mimeType, filename);
  const file = mediaFolder().createFile(blob);

  if (isPrivate) {
    // Left unshared on purpose. Reachable only by this script, which is what
    // lets the route decide who sees it.
    return { url: `vibestar-drive://${file.getId()}`, fileId: file.getId() };
  }

  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { url: `https://drive.google.com/uc?export=view&id=${file.getId()}`, fileId: file.getId() };
}

function driveDelete(url) {
  const id = fileIdFromUrl(url);
  if (!id) return false;
  try { DriveApp.getFileById(id).setTrashed(true); return true; } catch (err) { return false; }
}

function fileIdFromUrl(url) {
  const text = String(url || '');
  const scheme = /^vibestar-drive:\/\/(.+)$/.exec(text);
  if (scheme) return scheme[1];
  const query = /[?&]id=([^&]+)/.exec(text);
  return query ? query[1] : '';
}

/**
 * A subscriber-only file as a data URI. Only ever called for a viewer the route
 * has already established is entitled.
 */
function driveDataUri(url) {
  const id = fileIdFromUrl(url);
  if (!id) return '';

  try {
    const file = DriveApp.getFileById(id);
    const blob = file.getBlob();
    return `data:${blob.getContentType()};base64,${Utilities.base64Encode(blob.getBytes())}`;
  } catch (err) {
    return '';
  }
}


// ==========================================================================
// src/lib/store-gas.js
// ==========================================================================

/* eslint-disable no-undef */





/**
 * THE APPS SCRIPT BACKEND
 *
 * Same interface as store-sheets.js and store-pg.js, so no route knows the
 * difference. What changes is that everything here is a native call rather than
 * an HTTP request, and that has three consequences worth knowing:
 *
 *   1. NO QUOTA IN THE SAME SENSE. SpreadsheetApp is not the Sheets REST API, so
 *      the ~300-reads-a-minute ceiling does not apply. Apps Script has its own
 *      limits — a 6-minute execution cap and a daily runtime budget — but a feed
 *      read no longer competes with everyone else's for a per-minute allowance.
 *
 *   2. A REAL LOCK. LockService gives genuine mutual exclusion, so the
 *      claim-pause-read-back mutex the REST backend has to emulate is
 *      unnecessary here. This is the one respect in which the Apps Script
 *      version is better than the Netlify+Sheets version.
 *
 *   3. SYNCHRONOUS IO. Reads and writes block. The interface stays async so the
 *      shared route code is unchanged; the promises simply resolve immediately.
 */

function spreadsheet() {
  // Container-bound scripts get the active spreadsheet; a standalone script
  // needs the id in Script Properties.
  const id = typeof PropertiesService !== 'undefined'
    ? PropertiesService.getScriptProperties().getProperty('GOOGLE_SHEET_ID')
    : '';

  if (id) return SpreadsheetApp.openById(id);

  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error(
      'No spreadsheet. Either bind this script to a spreadsheet (Extensions → '
      + 'Apps Script from inside the sheet) or set GOOGLE_SHEET_ID in '
      + 'Project Settings → Script properties.'
    );
  }
  return active;
}

function sheetFor(name) {
  const sheet = spreadsheet().getSheetByName(name);
  if (!sheet) throw new Error(`No tab named "${name}". Run setUpSpreadsheet() once.`);
  return sheet;
}

// ------------------------------------------------------------ coercion
function decode(value, type) {
  if (value === undefined || value === null || value === '') {
    return type === T.INT || type === T.NUM ? 0 : (type === T.BOOL ? false : '');
  }
  switch (type) {
    case T.INT: return Math.trunc(Number(value)) || 0;
    case T.NUM: return Number(value) || 0;
    case T.BOOL: {
      if (value === true) return true;
      const s = String(value).trim().toUpperCase();
      return s === 'TRUE' || s === 'YES' || s === '1';
    }
    case T.TS: {
      // A cell the operator retyped by hand can come back as a Date object.
      if (value instanceof Date) return value.toISOString();
      return String(value);
    }
    default: return String(value);
  }
}

function encode(value, type) {
  if (value === undefined || value === null) return '';
  switch (type) {
    case T.INT: return Math.trunc(Number(value) || 0);
    case T.NUM: return Number(value) || 0;
    case T.BOOL: return value ? 'TRUE' : 'FALSE';
    case T.TS: {
      if (value === '') return '';
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? '' : date.toISOString();
    }
    // A leading ' stops Sheets treating a value as a formula or a date.
    default: {
      const text = String(value);
      return /^[=+\-@]/.test(text) ? `'${text}` : text;
    }
  }
}

function rowToObject(table, cells, sheetRow) {
  const types = TABLES[table];
  const object = { _row: sheetRow, _table: table };
  Object.keys(types).forEach((column, index) => {
    object[column] = decode(cells[index], types[column]);
  });
  return object;
}

function objectToRow(table, object) {
  const types = TABLES[table];
  return Object.keys(types).map((column) => encode(object[column], types[column]));
}

// ---------------------------------------------------------------- table
class Table {
  constructor(store, name, rows) {
    this.store = store;
    this.name = name;
    this.rows = rows;
  }

  all() { return this.rows; }
  find(predicate) { return this.rows.find(predicate) || null; }
  filter(predicate) { return this.rows.filter(predicate); }
  count(predicate) { return predicate ? this.rows.reduce((n, r) => n + (predicate(r) ? 1 : 0), 0) : this.rows.length; }
  byId(id) { return id ? this.find((row) => row.id === id) : null; }

  insert(values) {
    const row = { _row: 0, _table: this.name, _new: true };
    for (const column of columnsOf(this.name)) {
      row[column] = values[column] !== undefined ? values[column] : defaultFor(this.name, column);
    }
    this.rows.push(row);
    this.store.pendingAppends.push(row);
    return row;
  }

  update(row, patch) {
    Object.assign(row, patch);
    if (!row._new) this.store.pendingUpdates.add(row);
    return row;
  }

  updateWhere(predicate, patch) {
    const matched = this.filter(predicate);
    matched.forEach((row) => this.update(row, patch));
    return matched;
  }

  remove(row) {
    const index = this.rows.indexOf(row);
    if (index >= 0) this.rows.splice(index, 1);

    if (row._new) {
      const queued = this.store.pendingAppends.indexOf(row);
      if (queued >= 0) this.store.pendingAppends.splice(queued, 1);
      return;
    }
    this.store.pendingUpdates.delete(row);
    this.store.pendingDeletes.push(row);
  }

  removeWhere(predicate) {
    const matched = this.filter(predicate);
    matched.forEach((row) => this.remove(row));
    return matched;
  }
}

function defaultFor(table, column) {
  const type = TABLES[table][column];
  if (type === T.INT || type === T.NUM) return 0;
  if (type === T.BOOL) return false;
  return '';
}

// ---------------------------------------------------------------- store
class Store {
  constructor(tables) {
    this.tables = tables;
    this.pendingAppends = [];
    this.pendingUpdates = new Set();
    this.pendingDeletes = [];
    for (const [name, table] of Object.entries(tables)) this[lower(name)] = table;
  }

  get dirty() {
    return this.pendingAppends.length > 0 || this.pendingUpdates.size > 0 || this.pendingDeletes.length > 0;
  }

  async flush() {
    if (!this.dirty) return;

    // Updates before deletes, for the same reason as the REST backend: a delete
    // shifts every row beneath it, so positions read earlier stop being true.
    if (this.pendingUpdates.size) {
      for (const row of this.pendingUpdates) {
        if (!row._row || row._row < 2) continue;
        const values = objectToRow(row._table, row);
        sheetFor(row._table)
          .getRange(row._row, 1, 1, values.length)
          .setValues([values]);
      }
      this.pendingUpdates.clear();
    }

    if (this.pendingDeletes.length) {
      const byTable = groupBy(this.pendingDeletes, (row) => row._table);
      for (const [table, rows] of Object.entries(byTable)) {
        const sheet = sheetFor(table);
        // Highest row first, so the remaining indices stay valid.
        [...new Set(rows.map((row) => row._row))]
          .filter((n) => n > 1)
          .sort((a, b) => b - a)
          .forEach((rowNumber) => sheet.deleteRow(rowNumber));
      }
      this.pendingDeletes = [];
    }

    if (this.pendingAppends.length) {
      const byTable = groupBy(this.pendingAppends, (row) => row._table);
      for (const [table, rows] of Object.entries(byTable)) {
        const sheet = sheetFor(table);
        const values = rows.map((row) => objectToRow(table, row));
        const firstRow = sheet.getLastRow() + 1;

        // One setValues for the whole batch rather than appendRow per record.
        sheet.getRange(firstRow, 1, values.length, widthOf(table)).setValues(values);
        rows.forEach((row, index) => {
          row._row = firstRow + index;
          delete row._new;
        });
      }
      this.pendingAppends = [];
    }

    SpreadsheetApp.flush();
  }
}

function lower(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function groupBy(items, key) {
  return items.reduce((acc, item) => {
    const k = key(item);
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}

async function openStore(names) {
  const wanted = [...new Set(names)];
  for (const name of wanted) {
    if (!TABLES[name]) throw new Error(`Unknown table "${name}".`);
  }

  const tables = {};
  for (const name of wanted) {
    const sheet = sheetFor(name);
    const lastRow = sheet.getLastRow();
    const rows = [];

    if (lastRow > 1) {
      const grid = sheet.getRange(2, 1, lastRow - 1, widthOf(name)).getValues();
      for (let i = 0; i < grid.length; i += 1) {
        const cells = grid[i];
        // A wholly blank line is a gap left by a hand edit, not a record.
        if (cells.every((cell) => cell === '' || cell === null || cell === undefined)) continue;
        rows.push(rowToObject(name, cells, i + 2));
      }
    }
    tables[name] = new Table(null, name, rows);
  }

  const store = new Store(tables);
  for (const table of Object.values(tables)) table.store = store;
  return store;
}

// ----------------------------------------------------------------- lock
/**
 * LockService — a real mutex, which is the one thing this platform does better
 * than the Netlify+Sheets deployment. No claim-and-read-back dance, and the lock
 * releases when the script ends even if it throws.
 */
async function withLock(fn, { timeoutMs = 20_000 } = {}) {
  const lock = LockService.getScriptLock();
  const deadline = Date.now() + timeoutMs;

  /**
   * tryLock is asked for a short slice at a time rather than the whole timeout.
   *
   * Waiting the full timeout inside one tryLock call would be simpler, but it
   * gives up the chance to notice the holder finishing early, and it makes the
   * behaviour untestable — a mocked LockService cannot block. Retrying in slices
   * with a sleep between them behaves the same way in production and can
   * actually be exercised by a test.
   */
  let held = false;
  while (Date.now() < deadline) {
    if (lock.tryLock(Math.min(2000, Math.max(200, deadline - Date.now())))) { held = true; break; }
    await sleep(150);
  }

  if (!held) throw new Error('The spreadsheet is busy. Please try again in a moment.');

  try {
    return await fn();
  } finally {
    lock.releaseLock();
  }
}

async function transact(names, fn) {
  return withLock(async () => {
    const store = await openStore(names);
    const result = await fn(store);
    await store.flush();
    return result;
  });
}

/** Creates every tab with its header row. Idempotent; run once after install. */
function createSpreadsheetTabs() {
  const book = spreadsheet();
  const made = [];

  for (const table of TABLE_NAMES) {
    let sheet = book.getSheetByName(table);
    if (!sheet) { sheet = book.insertSheet(table); made.push(table); }

    const headers = columnsOf(table);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  // Present for parity with the REST backend, which needs it as a mutex cell.
  // LockService covers that here, so the tab is unused — created anyway so one
  // spreadsheet can serve both deployments.
  if (!book.getSheetByName(LOCK_TAB)) {
    book.insertSheet(LOCK_TAB).getRange(1, 1).setValue('lock');
  }

  return `Ready. ${TABLE_NAMES.length} tables (${made.length} created).`;
}



// ==========================================================================
// src/lib/auth.js
// ==========================================================================





/**
 * PASSWORD HASHING, ACROSS TWO RUNTIMES.
 *
 * A stored hash records which algorithm produced it:
 *
 *   scrypt$16384$8$1$<hex>      memory-hard, the default on Node
 *   pbkdf2$210000$<hex>         interoperable; the only option on Apps Script
 *
 * Tagging the format is what makes the two deployments able to share a
 * database. Verification dispatches on the tag, so a hash written by either
 * platform is readable by any platform that can compute that algorithm — and
 * when it cannot, the error says so plainly instead of looking like a wrong
 * password.
 *
 * The asymmetry is real and worth stating: Apps Script has no scrypt, and every
 * PBKDF2 iteration there is a separate call across the JavaScript bridge, so its
 * iteration count has to stay in the low thousands. If you intend to run both
 * platforms against one database, set PASSWORD_ALGO=pbkdf2 so every account is
 * verifiable everywhere — and understand you are trading scrypt's memory
 * hardness for that portability.
 */
function newSalt() {
  return randomHex(16);
}

/** Hashes with the configured algorithm, returning the tagged form. */
async function hashPassword(password, salt, algo = PASSWORD_ALGO) {
  const chosen = SUPPORTED_ALGOS.includes(algo) ? algo : SUPPORTED_ALGOS[0];

  if (chosen === 'scrypt') {
    const hex = await scryptHex(password, salt, SCRYPT);
    return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${hex}`;
  }

  const hex = await pbkdf2Hex(password, salt, PBKDF2.iterations, PBKDF2.keylen);
  return `pbkdf2$${PBKDF2.iterations}$${hex}`;
}

/**
 * Verifies against whatever produced the stored hash.
 *
 * An untagged hash is treated as legacy scrypt with the current parameters,
 * which is what the pre-Apps-Script builds wrote.
 */
async function verifyPassword(password, salt, storedHash) {
  const stored = String(storedHash || '');
  if (!stored) return false;

  const parts = stored.split('$');

  if (parts.length === 1) {
    // Legacy: bare scrypt hex, no tag.
    if (!SUPPORTED_ALGOS.includes('scrypt')) throw new Error(UNSUPPORTED_MESSAGE);
    const hex = await scryptHex(password, salt, SCRYPT);
    return safeEquals(hex, stored);
  }

  const [algo, ...rest] = parts;

  if (algo === 'scrypt') {
    if (!SUPPORTED_ALGOS.includes('scrypt')) throw new Error(UNSUPPORTED_MESSAGE);
    const [N, r, p, hex] = rest;
    const candidate = await scryptHex(password, salt,
      { N: Number(N), r: Number(r), p: Number(p), keylen: SCRYPT.keylen });
    return safeEquals(candidate, hex);
  }

  if (algo === 'pbkdf2') {
    const [iterations, hex] = rest;
    // Length is derived from the stored hash, so an old hash with a different
    // key length still verifies.
    const candidate = await pbkdf2Hex(password, salt, Number(iterations), hex.length / 2);
    return safeEquals(candidate, hex);
  }

  return false;
}

const UNSUPPORTED_MESSAGE =
  'This deployment cannot verify that account\'s password format (scrypt). '
  + 'Sign in through the Netlify deployment, or set PASSWORD_ALGO=pbkdf2 there '
  + 'and reset the password so it works on both.';

// ------------------------------------------------------------- sessions
async function createSession(userId) {
  const token = newToken();
  await putSession(token, userId, Date.now() + SESSION_TTL_DAYS * DAY_MS);
  return token;
}

async function revokeSession(token) {
  await deleteSession(token);
}

async function revokeUserSessions(userId) {
  return deleteUserSessions(userId);
}

/**
 * Resolves a bearer token against an already-loaded store.
 *
 * The token lookup is a keyed blob read; the user row comes from the batch the
 * request already paid for, so authentication adds no spreadsheet reads at all.
 *
 * Account status is re-checked here rather than only at login, so suspending
 * someone ends their live session on their next request instead of leaving it
 * valid until the token expires.
 */
async function resolveUser(store, token) {
  const userId = await readSession(token);
  if (!userId) return null;

  const row = store.users.byId(userId);
  if (!row) return null;
  return userStatusOf(row) === 'ACTIVE' ? row : null;
}

/** Reads the token from an Authorization header or the legacy body field. */
function tokenFrom(event, body) {
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match) return match[1].trim();
  return body?.token ? String(body.token) : '';
}

/** Sentinel errors the router turns into 401/403. */
class SessionExpired extends Error {
  constructor() { super('SESSION_EXPIRED'); this.name = 'SessionExpired'; }
}
class Forbidden extends Error {
  constructor() { super('FORBIDDEN'); this.name = 'Forbidden'; }
}

async function requireUser(store, token) {
  const user = await resolveUser(store, token);
  if (!user) throw new SessionExpired();
  return user;
}

async function requireAdmin(store, token) {
  const user = await requireUser(store, token);
  if (!isAdminUser(user)) throw new Forbidden();
  return user;
}

// ------------------------------------------------------- login throttle
async function loginThrottled(email) {
  const record = await readThrottle(email);
  if (!record) return false;

  if (Date.now() - Number(record.firstAt || 0) > LOGIN_WINDOW_MS) {
    await clearThrottle(email);
    return false;
  }
  return Number(record.attempts || 0) >= MAX_LOGIN_ATTEMPTS;
}

async function recordFailedLogin(email) {
  const record = await readThrottle(email);
  const windowOpen = record && Date.now() - Number(record.firstAt || 0) <= LOGIN_WINDOW_MS;

  await writeThrottle(email, windowOpen
    ? { attempts: Number(record.attempts || 0) + 1, firstAt: record.firstAt }
    : { attempts: 1, firstAt: Date.now() });
}

async function clearLoginThrottle(email) {
  await clearThrottle(email);
}



// ==========================================================================
// src/lib/notify.js
// ==========================================================================



/**
 * Notification rows record who did what, never the content of what they did.
 * A MESSAGE notification deliberately carries no message body: threads are
 * subscription-gated, so copying their text into a second table would route
 * private content around that gate. `meta` is for small non-private values
 * only — a tip amount, days remaining.
 *
 * Writes go through the caller's store, so a request that emits three
 * notifications still costs one append.
 */
function emitNotification(store, recipientId, type, actorId, targetId = '', meta = '') {
  if (!recipientId || recipientId === actorId) return null;
  if (!NOTIFICATION_TYPES.includes(type)) return null;

  const notifications = store.notifications;
  if (!notifications) throw new Error('emitNotification needs the Notifications table loaded.');

  if (COALESCING_TYPES.includes(type)) {
    // Postgres did this with a partial unique index and an atomic upsert. A
    // spreadsheet has no such index, so the coalescing is a find-and-increment.
    // Two simultaneous emits can therefore leave two rows instead of one that
    // reads "2 messages" — a cosmetic duplicate in a notification list, which
    // is why this is not worth the cost of taking the lock on a chat send.
    const existing = notifications.find((row) => row.user_id === recipientId
      && row.type === type
      && row.actor_id === (actorId || '')
      && !row.read_at);

    if (existing) {
      notifications.update(existing, {
        count: Number(existing.count || 1) + 1,
        created_at: new Date().toISOString(),
        target_id: targetId || existing.target_id,
        meta: meta === '' || meta === null ? existing.meta : String(meta)
      });
      return existing.id;
    }
  }

  const id = newId('ntf');
  notifications.insert({
    id,
    user_id: recipientId,
    type,
    actor_id: actorId || '',
    target_id: targetId || '',
    count: 1,
    meta: meta === null ? '' : String(meta),
    read_at: '',
    created_at: new Date().toISOString()
  });
  return id;
}

/** Clears MESSAGE badges for one peer, when their thread is opened. */
function markMessageNotificationsRead(store, userId, actorId) {
  const now = new Date().toISOString();
  return store.notifications.updateWhere(
    (row) => row.user_id === userId && row.type === 'MESSAGE'
          && row.actor_id === actorId && !row.read_at,
    { read_at: now }
  ).length;
}


// ==========================================================================
// src/routes/auth.js
// ==========================================================================






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

async function signUp({ body }) {
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

async function logIn({ store, body }) {
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

async function logOut({ token }) {
  if (token) await revokeSession(token);
  return ok();
}

async function resumeSession({ user }) {
  return ok({ user: publicUser(user) });
}

// ------------------------------------------------------------- profile
async function getProfile({ store, user: viewer, body }) {
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
function countBy(rows, groupKey, distinctKey) {
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

async function updateProfile({ store, user, body }) {
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

async function changePassword({ store, user, body }) {
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
async function getChatThemes({ user }) {
  return ok({ themes: CHAT_THEMES, current: chatThemeKeyOf(user) });
}

async function setChatTheme({ store, user, body }) {
  const key = String(body?.themeKey || '').toUpperCase();
  const theme = CHAT_THEMES.find((t) => t.key === key);
  if (!theme) return fail('Unknown chat theme.');

  store.users.update(user, { chat_theme: key });
  return ok({ theme, message: `${theme.label} theme applied.` });
}



// ==========================================================================
// src/routes/content.js
// ==========================================================================







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
function markExpiredPosts(store, now = Date.now()) {
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
async function getPublicFeed({ store, user, body }) {
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
async function getCreators({ store, user }) {
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
async function createPost({ store, user, body }) {
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

async function deletePost({ store, user, body }) {
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

async function toggleLike({ store, user, body }) {
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
async function addComment({ store, user, body }) {
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

async function getComments({ store, user, body }) {
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

async function deleteComment({ store, user, body }) {
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
async function getCreatorGallery({ store, user, body }) {
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

async function search({ store, user, body }) {
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

async function toggleSave({ store, user, body }) {
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
async function getSavedPosts({ store, user }) {
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
async function buildSharePayload(postId, { countView = true, store = null } = {}) {
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

async function getSharedPost({ store, body }) {
  return ok(await buildSharePayload(body?.postId, { store }));
}

async function getShareLink({ store, body }) {
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


// ==========================================================================
// src/routes/social.js
// ==========================================================================





// -------------------------------------------------------------- follows
/**
 * Following is free, public and open to everyone — fans can follow fans. It is
 * not a subscription: it unlocks no private thread, and it has no bearing on
 * badge tiers, which run off the admin-verified external follower count.
 *
 * Takes the lock so a double request cannot leave two rows for one pair. Every
 * follower count in the app is a count of distinct ids as well, so even if a
 * duplicate did slip through it would not inflate anything.
 */
async function followUser({ user, body }) {
  const targetId = String(body?.userId || '');
  if (targetId === user.id) return fail('You cannot follow yourself.');

  const result = await transact(['Users', 'Follows', 'Notifications'], async (store) => {
    const target = store.users.byId(targetId);
    if (!target) return { error: 'That account does not exist.' };
    if (userStatusOf(target) !== 'ACTIVE') return { error: 'That account is not available.' };

    const existing = store.follows.find(
      (row) => row.follower_id === user.id && row.followee_id === targetId);

    if (!existing) {
      store.follows.insert({
        id: newId('flw'),
        follower_id: user.id,
        followee_id: targetId,
        created_at: new Date().toISOString()
      });
      emitNotification(store, targetId, 'FOLLOW', user.id);
    }

    return { name: target.full_name };
  });

  if (result.error) return fail(result.error);
  return ok({ following: true, message: `You now follow ${result.name}.` });
}

async function unfollowUser({ store, user, body }) {
  const removed = store.follows.removeWhere(
    (row) => row.follower_id === user.id && row.followee_id === String(body?.userId || ''));

  return ok({ following: false, message: removed.length ? 'Unfollowed.' : 'Not following.' });
}

async function getFollowList({ store, user, body }) {
  const targetId = String(body?.userId || user.id);
  const type = String(body?.type || 'FOLLOWERS').toUpperCase();

  // FOLLOWERS: rows pointing at the target, read across to the follower.
  // FOLLOWING: rows from the target, read across to the followee.
  const matchKey = type === 'FOLLOWING' ? 'follower_id' : 'followee_id';
  const readKey = type === 'FOLLOWING' ? 'followee_id' : 'follower_id';

  const viewerFollows = new Set(
    store.follows.filter((row) => row.follower_id === user.id).map((row) => row.followee_id));

  const seen = new Set();
  const people = store.follows
    .filter((row) => row[matchKey] === targetId)
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
    .map((row) => store.users.byId(row[readKey]))
    .filter((row) => {
      if (!row || userStatusOf(row) !== 'ACTIVE') return false;
      if (seen.has(row.id)) return false;   // a duplicated row must not list twice
      seen.add(row.id);
      return true;
    })
    .map((row) => {
      const person = publicUser(row);
      person.viewerFollows = viewerFollows.has(row.id);
      person.isSelf = row.id === user.id;
      return person;
    });

  return ok({ people, type, total: people.length });
}

// ------------------------------------------------------------- messaging
/**
 * Every thread is one (subscriber, celebrity) pair. The acting user's role
 * decides which side of that pair they are, so a caller cannot claim to be
 * someone else's counterparty.
 */
function resolveThread(actor, peer) {
  return actor.role === 'CELEBRITY'
    ? { subscriberId: peer.id, celebrityId: actor.id }
    : { subscriberId: actor.id, celebrityId: peer.id };
}

function activeSubscriptionExpiry(store, subscriberId, celebrityId) {
  const now = Date.now();
  const live = store.subscriptions
    .filter((row) => row.subscriber_id === subscriberId
                  && row.celebrity_id === celebrityId
                  && liveSubscription(row, now))
    .sort((a, b) => toMillis(b.expires_at) - toMillis(a.expires_at));

  return live.length ? live[0].expires_at : null;
}

async function getConversations({ store, user }) {
  const isCreator = user.role === 'CELEBRITY';
  const mineKey = isCreator ? 'celebrity_id' : 'subscriber_id';
  const peerKey = isCreator ? 'subscriber_id' : 'celebrity_id';
  const now = Date.now();

  const conversations = store.subscriptions
    .filter((row) => row[mineKey] === user.id && liveSubscription(row, now))
    .map((subscription) => {
      const peer = store.users.byId(subscription[peerKey]);
      if (!peer || userStatusOf(peer) !== 'ACTIVE') return null;

      const thread = store.messages.filter(
        (m) => m.subscriber_id === subscription.subscriber_id
            && m.celebrity_id === subscription.celebrity_id);

      const unreadCount = thread.filter((m) => m.sender_id !== user.id && !m.read_at).length;
      const sorted = thread.sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at));
      const latest = sorted[0] || null;

      return {
        peer: publicUser(peer),
        subscriptionExpiresAt: subscription.expires_at,
        unreadCount,
        lastMessage: latest
          ? { content: latest.content, createdAt: latest.created_at, fromMe: latest.sender_id === user.id }
          : null,
        lastActivityAt: latest ? latest.created_at : subscription.created_at
      };
    })
    .filter(Boolean)
    .sort((a, b) => toMillis(b.lastActivityAt) - toMillis(a.lastActivityAt));

  return ok({ conversations, role: user.role });
}

async function getChatMessages({ store, user, body }) {
  const peer = store.users.byId(String(body?.peerId || ''));
  if (!peer) return fail('That person does not exist.');
  if (peer.id === user.id) return fail('You cannot message yourself.');

  const thread = resolveThread(user, peer);

  // STRICT SERVER-SIDE AUTHORIZATION CHECK
  const expiresAt = activeSubscriptionExpiry(store, thread.subscriberId, thread.celebrityId);
  if (!expiresAt) {
    return ok({ authorized: false, subscriptionExpiresAt: null, peer: publicUser(peer), messages: [] });
  }

  const messages = store.messages
    .filter((m) => m.subscriber_id === thread.subscriberId && m.celebrity_id === thread.celebrityId)
    .sort((a, b) => toMillis(a.created_at) - toMillis(b.created_at));

  // Mark the peer's messages read. Read receipts have to reflect this open, so
  // the flags are set before the thread is serialised below.
  const now = new Date().toISOString();
  messages.forEach((message) => {
    if (message.sender_id !== user.id && !message.read_at) {
      store.messages.update(message, { read_at: now });
    }
  });
  markMessageNotificationsRead(store, user.id, peer.id);

  return ok({
    authorized: true,
    subscriptionExpiresAt: expiresAt,
    peer: publicUser(peer),
    messages: messages.map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      content: m.content,
      createdAt: m.created_at,
      // Read receipts reflect the peer actually opening the thread.
      readByPeer: m.sender_id === user.id ? Boolean(m.read_at) : true
    }))
  });
}

async function sendMessage({ store, user, body }) {
  const content = cleanText(body?.content, MESSAGE_MAX_LENGTH);
  if (!content) return fail('Message cannot be empty.');

  const peer = store.users.byId(String(body?.peerId || ''));
  if (!peer) return fail('That person does not exist.');
  if (peer.id === user.id) return fail('You cannot message yourself.');

  const thread = resolveThread(user, peer);

  // STRICT SERVER-SIDE AUTHORIZATION CHECK BEFORE SAVING
  const expiresAt = activeSubscriptionExpiry(store, thread.subscriberId, thread.celebrityId);
  if (!expiresAt) return fail('An active subscription is required for this conversation.');

  const id = newId('msg');
  const createdAt = new Date().toISOString();
  store.messages.insert({
    id,
    subscriber_id: thread.subscriberId,
    celebrity_id: thread.celebrityId,
    sender_id: user.id,
    content,
    read_at: '',
    created_at: createdAt
  });

  emitNotification(store, peer.id, 'MESSAGE', user.id);

  return ok({ message: { id, senderId: user.id, content, createdAt, readByPeer: false } });
}

// --------------------------------------------------------- notifications
async function getNotifications({ store, user, body }) {
  const limit = Math.min(Math.max(Number(body?.limit) || 30, 1), 100);
  const unreadOnly = body?.unreadOnly === true;

  const mine = store.notifications.filter((row) => row.user_id === user.id);
  const unreadCount = mine.filter((row) => !row.read_at).length;

  const notifications = mine
    .filter((row) => !unreadOnly || !row.read_at)
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
    .slice(0, limit)
    .map((row) => {
      const actor = row.actor_id ? store.users.byId(row.actor_id) : null;
      return {
        id: row.id,
        type: row.type,
        count: Number(row.count) || 1,
        meta: row.meta || '',
        read: Boolean(row.read_at),
        createdAt: row.created_at,
        targetId: row.target_id || '',
        // A suspended actor's notification survives but loses its identity.
        actor: actor && userStatusOf(actor) === 'ACTIVE' ? publicUser(actor) : null
      };
    });

  return ok({ notifications, unreadCount, total: mine.length });
}

async function markNotificationsRead({ store, user, body }) {
  const ids = Array.isArray(body?.notificationIds) ? new Set(body.notificationIds.map(String)) : null;
  const now = new Date().toISOString();

  // Always scoped to the caller, so one user cannot mark another's read.
  const marked = store.notifications.updateWhere(
    (row) => row.user_id === user.id && !row.read_at && (!ids || ids.has(row.id)),
    { read_at: now }
  );

  return ok({ marked: marked.length });
}

/** Scheduled cleanup: notifications past their 60-day life. */
function pruneNotifications(store, now = Date.now()) {
  const cutoff = now - NOTIFICATION_TTL_DAYS * DAY_MS;
  return store.notifications.removeWhere((row) => toMillis(row.created_at) < cutoff).length;
}


// ==========================================================================
// src/routes/money.js
// ==========================================================================






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

function hmacHex(message, secret) {
  return hmacSha256Hex(message, secret);
}

async function getPaymentConfig() {
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
async function createPaymentOrder({ store, user, body }) {
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
async function confirmPayment({ store, user, body }) {
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
async function settlePayment(orderId, paymentId, signatureVerified) {
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
async function processSubscription({ user, body }) {
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

async function cancelSubscription({ store, user, body }) {
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

async function getMyPayments({ store, user }) {
  const payments = store.payments
    .filter((row) => row.user_id === user.id)
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
    .slice(0, 100)
    .map(mapPayment);

  return ok({ payments, mode: env.paymentMode() });
}

/** What a creator has earned. DEMO rows are excluded: no money moved. */
async function getCreatorEarnings({ store, user }) {
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
function verificationConfig() {
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

async function getVerificationState({ store, user }) {
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

async function submitVerificationRequest({ user, body }) {
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

async function cancelVerificationRequest({ store, user }) {
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
function sendExpiryReminders(store, now = Date.now()) {
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


// ==========================================================================
// src/routes/admin.js
// ==========================================================================








/** Guards an admin against locking themselves out. */
function guardSelf(admin, targetId, action) {
  return admin.id === targetId ? `You cannot ${action} your own account.` : null;
}

function countActiveAdmins(store, excludeId) {
  const configured = env.adminEmails();
  return store.users.count((row) => userStatusOf(row) === 'ACTIVE'
    && row.id !== excludeId
    && (row.is_admin === true || configured.includes(String(row.email).toLowerCase())));
}

// ------------------------------------------------------------- overview
async function adminGetOverview({ store }) {
  const now = Date.now();
  const users = store.users.all();
  const posts = store.posts.all();
  const subscriptions = store.subscriptions.all();
  const requests = store.verificationRequests.all();

  const liveSubs = subscriptions.filter((row) => liveSubscription(row, now));
  const projected = liveSubs.reduce((total, row) => {
    const creator = store.users.byId(row.celebrity_id);
    return total + (creator ? Number(creator.monthly_price) || 0 : 0);
  }, 0);

  return ok({
    users: {
      total: users.length,
      creators: users.filter((u) => u.role === 'CELEBRITY').length,
      fans: users.filter((u) => u.role === 'FAN').length,
      admins: users.filter((u) => isAdminUser(u)).length,
      suspended: users.filter((u) => userStatusOf(u) === 'SUSPENDED').length,
      deleted: users.filter((u) => userStatusOf(u) === 'DELETED').length,
      verified: users.filter((u) => verificationStatusOf(u) === 'APPROVED').length
    },
    posts: {
      total: posts.length,
      // Counted against the clock, not the stored flag: a post whose window has
      // closed is expired whether or not maintenance has rewritten the row yet.
      active: posts.filter((p) => livePost(p, now)).length,
      expired: posts.filter((p) => String(p.status).toUpperCase() !== 'DELETED' && !livePost(p, now)).length,
      deleted: posts.filter((p) => String(p.status).toUpperCase() === 'DELETED').length,
      private: posts.filter((p) => p.visibility === 'SUBSCRIBERS' && livePost(p, now)).length
    },
    subscriptions: {
      total: subscriptions.length,
      active: liveSubs.length,
      projectedMonthlyValue: projected
    },
    messages: { total: store.messages.count() },
    follows: { total: store.follows.count() },
    engagement: {
      likes: store.likes.count(),
      comments: store.comments.count((c) => String(c.status).toUpperCase() === 'ACTIVE')
    },
    notifications: {
      total: store.notifications.count(),
      unread: store.notifications.count((n) => !n.read_at)
    },
    media: {
      count: store.media.count(),
      bytes: store.media.all().reduce((total, row) => total + (Number(row.bytes) || 0), 0)
    },
    verification: {
      pending: requests.filter((r) => r.status === 'PENDING').length,
      approved: requests.filter((r) => r.status === 'APPROVED').length,
      rejected: requests.filter((r) => r.status === 'REJECTED').length
    }
  });
}

async function adminGetRevenue({ store }) {
  const paid = store.payments.filter((row) => row.status === 'PAID' && row.mode !== 'DEMO');
  const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);

  const pick = (purpose) => {
    const rows = paid.filter((row) => row.purpose === purpose);
    return {
      count: rows.length,
      gross: sum(rows, 'amount_paise') / 100,
      commission: sum(rows, 'commission_paise') / 100
    };
  };

  const byCreator = new Map();
  for (const row of paid) {
    if (!row.beneficiary_id) continue;
    byCreator.set(row.beneficiary_id,
      (byCreator.get(row.beneficiary_id) || 0) + (Number(row.net_paise) || 0));
  }

  return ok({
    commissionPercent: env.commissionPercent(),
    grossProcessed: sum(paid, 'amount_paise') / 100,
    platformRevenue: sum(paid, 'commission_paise') / 100,
    owedToCreators: sum(paid, 'net_paise') / 100,
    payoutsPending: sum(paid, 'net_paise') / 100,
    breakdown: { subscriptions: pick('SUBSCRIPTION'), tips: pick('TIP'), verification: pick('VERIFICATION') },
    owed: [...byCreator.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([creatorId, net]) => {
        const creator = store.users.byId(creatorId);
        return { creatorId, creator: creator ? publicUser(creator) : null, net: net / 100 };
      })
  });
}

// ----------------------------------------------------------------- users
async function adminListUsers({ store, body }) {
  const search = cleanText(body?.query, 80).toLowerCase();
  const role = String(body?.role || 'ALL').toUpperCase();
  const status = String(body?.status || 'ALL').toUpperCase();
  const now = Date.now();

  const postCounts = countBy(store.posts.filter((p) => livePost(p, now)), 'author_id', 'id');
  const followerCounts = countBy(store.follows.all(), 'followee_id', 'follower_id');
  const liveSubs = store.subscriptions.filter((s) => liveSubscription(s, now));
  const subscriberCounts = countBy(liveSubs, 'celebrity_id', 'subscriber_id');
  const subscriptionCounts = countBy(liveSubs, 'subscriber_id', 'celebrity_id');

  const users = store.users
    .filter((row) => {
      if (role !== 'ALL' && row.role !== role) return false;
      if (status !== 'ALL' && userStatusOf(row) !== status) return false;
      if (search) {
        const haystack = `${row.full_name} ${row.username} ${row.email}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
    .map((row) => {
      const user = publicUser(row);
      // Admin-only fields, deliberately absent from publicUser.
      user.email = row.email;
      user.statusReason = row.status_reason || '';
      user.stats = {
        posts: postCounts.get(row.id) || 0,
        // In-app followers, for context only. Badge tiers still run off the
        // admin-verified external count so follows cannot be farmed into a tier.
        inAppFollowers: followerCounts.get(row.id) || 0,
        subscribers: subscriberCounts.get(row.id) || 0,
        subscriptions: subscriptionCounts.get(row.id) || 0
      };
      return user;
    });

  return ok({ users, total: users.length });
}

async function adminSetUserStatus({ user: admin, body }) {
  const targetId = String(body?.userId || '');
  const next = String(body?.status || '').toUpperCase();
  if (!['ACTIVE', 'SUSPENDED', 'DELETED'].includes(next)) {
    return fail('Status must be ACTIVE, SUSPENDED or DELETED.');
  }

  // Locked because of the last-admin guard: two admins demoting each other at
  // once would both read "another admin exists" and leave nobody able to log in.
  const result = await transact(['Users'], async (store) => {
    const target = store.users.byId(targetId);
    if (!target) return { error: 'That account does not exist.' };

    if (next !== 'ACTIVE') {
      const guard = guardSelf(admin, targetId, next === 'DELETED' ? 'delete' : 'suspend');
      if (guard) return { error: guard };

      // Never leave the platform without a reachable admin.
      if (isAdminUser(target) && countActiveAdmins(store, targetId) === 0) {
        return { error: 'This is the last active admin. Appoint another admin first.' };
      }
    }

    store.users.update(target, {
      status: next,
      status_reason: next === 'ACTIVE' ? '' : cleanText(body?.reason, 280),
      status_changed_at: new Date().toISOString()
    });

    return { name: target.full_name };
  });

  if (result.error) return fail(result.error);

  // Revoking sessions makes a suspension bite immediately, and resolveUser
  // re-checks status anyway so nothing survives on a warm path.
  if (next !== 'ACTIVE') await revokeUserSessions(targetId);

  const verb = { ACTIVE: 'restored', SUSPENDED: 'suspended', DELETED: 'deleted' }[next];
  return ok({ message: `${result.name} ${verb}.` });
}

async function adminSetUserRole({ store, user: admin, body }) {
  const targetId = String(body?.userId || '');
  const next = String(body?.role || '').toUpperCase();
  if (!['FAN', 'CELEBRITY'].includes(next)) return fail('Role must be FAN or CELEBRITY.');

  const target = store.users.byId(targetId);
  if (!target) return fail('That account does not exist.');

  const guard = guardSelf(admin, targetId, 'change the role of');
  if (guard) return fail(guard);

  if (next === 'FAN') {
    // Demoting must not leave a verified badge on an account that can no longer
    // publish or take subscribers.
    store.users.update(target, {
      role: 'FAN',
      verification_status: 'NONE',
      verification_route: '',
      verified_follower_count: 0,
      verified_at: '',
      monthly_price: 0
    });
  } else {
    store.users.update(target, {
      role: 'CELEBRITY',
      monthly_price: Number(target.monthly_price) > 0 ? Number(target.monthly_price) : 299,
      category: target.category || 'Creator'
    });
  }

  return ok({ message: `${target.full_name} is now a ${next === 'FAN' ? 'fan' : 'creator'}.` });
}

async function adminSetUserAdmin({ user: admin, body }) {
  const targetId = String(body?.userId || '');
  const grant = body?.makeAdmin === true || String(body?.makeAdmin).toLowerCase() === 'true';

  const result = await transact(['Users'], async (store) => {
    const target = store.users.byId(targetId);
    if (!target) return { error: 'That account does not exist.' };

    if (!grant) {
      const guard = guardSelf(admin, targetId, 'revoke admin on');
      if (guard) return { error: guard };
      if (countActiveAdmins(store, targetId) === 0) {
        return { error: 'This is the last active admin. Appoint another admin first.' };
      }
      // An ADMIN_EMAILS entry outranks the column, so the revoke would not stick.
      if (env.adminEmails().includes(String(target.email).toLowerCase())) {
        return { error: 'This account is an admin via the ADMIN_EMAILS environment variable. Remove it there first.' };
      }
    }

    store.users.update(target, { is_admin: grant });
    return { name: target.full_name };
  });

  if (result.error) return fail(result.error);
  return ok({ message: `${result.name}${grant ? ' is now an admin.' : ' is no longer an admin.'}` });
}

// ----------------------------------------------------------------- posts
async function adminListPosts({ store, user: admin, body }) {
  const status = String(body?.status || 'ALL').toUpperCase();
  const search = cleanText(body?.query, 80).toLowerCase();
  const visibility = String(body?.visibility || 'ALL').toUpperCase();

  const posts = store.posts
    .filter((row) => {
      if (status !== 'ALL' && String(row.status).toUpperCase() !== status) return false;
      if (visibility !== 'ALL' && (row.visibility || 'PUBLIC') !== visibility) return false;
      if (search) {
        const author = store.users.byId(row.author_id);
        const haystack = `${row.caption} ${author?.full_name || ''} ${author?.username || ''}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
    .slice(0, 300)
    .map((row) => {
      const author = store.users.byId(row.author_id);
      const raw = sanitizeUrl(row.media_url);
      const isPrivate = row.visibility === 'SUBSCRIBERS';
      const key = isPrivate ? mediaKeyFromUrl(raw) : '';

      return {
        id: row.id,
        type: row.type,
        caption: row.caption,
        // Private media is served only against a per-viewer signature, so the
        // raw URL would 403 even for an admin. Moderation is impossible without
        // being able to actually open the file, so sign it for them here.
        mediaUrl: isPrivate ? (key ? signMediaUrl(key, admin.id) : '') : raw,
        visibility: row.visibility || 'PUBLIC',
        status: row.status,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        shareViews: Number(row.share_views) || 0,
        author: author ? publicUser(author) : null
      };
    });

  return ok({ posts, total: posts.length });
}

async function adminSetPostStatus({ store, body }) {
  const next = String(body?.status || '').toUpperCase();
  if (!['ACTIVE', 'EXPIRED', 'DELETED'].includes(next)) {
    return fail('Status must be ACTIVE, EXPIRED or DELETED.');
  }

  const post = store.posts.byId(String(body?.postId || ''));
  if (!post) return fail('That post does not exist.');

  // Restoring only makes sense while the 30-day window is still open.
  if (next === 'ACTIVE' && toMillis(post.expires_at) <= Date.now()) {
    return fail('That post is past its 30-day window and cannot be restored.');
  }

  store.posts.update(post, { status: next });
  const verb = { ACTIVE: 'restored', EXPIRED: 'expired', DELETED: 'deleted' }[next];
  return ok({ message: `Post ${verb}.` });
}

// ---------------------------------------------------------- verification
async function listVerificationRequests({ store, body }) {
  const status = String(body?.statusFilter || body?.status || 'PENDING').toUpperCase();

  const requests = store.verificationRequests
    .filter((row) => status === 'ALL' || row.status === status)
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
    .map((row) => {
      const applicant = store.users.byId(row.user_id);
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
        verifiedFollowerCount: Number(row.verified_follower_count) || 0,
        applicant: applicant ? publicUser(applicant) : null
      };
    });

  return ok({ requests, config: verificationConfig() });
}

/**
 * Approves or rejects. On approval the admin sets the follower count they
 * actually confirmed, which is what decides the badge tier — the applicant's
 * claim is only a starting suggestion, so a creator cannot award themselves a
 * tier by typing a big number.
 *
 * Locked so two admins reviewing the same queue entry cannot both apply a
 * decision, leaving the applicant's account reflecting one and the request row
 * the other.
 */
async function reviewVerificationRequest({ user: admin, body }) {
  const approve = String(body?.decision || '').toUpperCase() === 'APPROVE';
  const note = cleanText(body?.note, 280);

  const result = await transact(
    ['Users', 'VerificationRequests', 'Notifications'],
    async (store) => {
      const request = store.verificationRequests.byId(String(body?.requestId || ''));
      if (!request) return { error: 'That request does not exist.' };
      if (request.status !== 'PENDING') return { error: 'That request was already reviewed.' };

      const applicant = store.users.byId(request.user_id);
      if (!applicant) return { error: 'The applicant no longer exists.' };

      const now = new Date().toISOString();

      if (!approve) {
        store.verificationRequests.update(request, {
          status: 'REJECTED', note, reviewed_by: admin.id, reviewed_at: now
        });
        store.users.update(applicant, { verification_status: 'REJECTED', verification_route: '' });
        emitNotification(store, applicant.id, 'VERIFICATION', admin.id, 'REJECTED');
        return { message: 'Request rejected.' };
      }

      const raw = body?.verifiedFollowerCount;
      const confirmed = (raw === '' || raw === null || raw === undefined)
        ? Number(request.claimed_follower_count) || 0
        : Number(raw);

      if (!Number.isFinite(confirmed) || confirmed < 0 || confirmed > 1_000_000_000) {
        return { error: 'Enter a realistic verified follower count.' };
      }

      store.verificationRequests.update(request, {
        status: 'APPROVED',
        note,
        reviewed_by: admin.id,
        reviewed_at: now,
        verified_follower_count: Math.floor(confirmed)
      });
      store.users.update(applicant, {
        verification_status: 'APPROVED',
        verification_route: request.route,
        verified_follower_count: Math.floor(confirmed),
        verified_at: now
      });

      emitNotification(store, applicant.id, 'VERIFICATION', admin.id, 'APPROVED');

      const badge = badgeFor(applicant);
      return {
        badge,
        message: badge
          ? `Approved. ${applicant.full_name} now holds the ${badge.label} badge.`
          : `Approved. The badge unlocks at ${BADGE_MIN_FOLLOWERS} verified followers.`
      };
    }
  );

  if (result.error) return fail(result.error);
  return ok({ message: result.message, badge: result.badge || null });
}

/** Admin-only follower recount, which is how a badge steps up a tier. */
async function setVerifiedFollowerCount({ store, body }) {
  const targetId = String(body?.userId || '');
  const value = Number(body?.count);
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000) {
    return fail('Enter a realistic follower count.');
  }

  const target = store.users.byId(targetId);
  if (!target) return fail('That account does not exist.');
  if (verificationStatusOf(target) !== 'APPROVED') {
    return fail('Verify the account before setting a follower count.');
  }

  store.users.update(target, {
    verified_follower_count: Math.floor(value),
    verified_at: new Date().toISOString()
  });
  const badge = badgeFor(target);

  return ok({
    message: badge
      ? `Updated. Badge is now ${badge.label}.`
      : `Updated. Below ${BADGE_MIN_FOLLOWERS} followers, so no badge is shown.`,
    badge
  });
}

// ----------------------------------------------------------- payments
async function adminListPayments({ store, body }) {
  const status = String(body?.status || 'ALL').toUpperCase();
  const purpose = String(body?.purpose || 'ALL').toUpperCase();

  const payments = store.payments
    .filter((row) => (status === 'ALL' || row.status === status)
                  && (purpose === 'ALL' || row.purpose === purpose))
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
    .slice(0, 300)
    .map((row) => {
      const payer = store.users.byId(row.user_id);
      const target = row.beneficiary_id ? store.users.byId(row.beneficiary_id) : null;
      return {
        id: row.id,
        purpose: row.purpose,
        orderId: row.order_id || '',
        paymentId: row.payment_id || '',
        amount: Number(row.amount_paise) / 100,
        commission: Number(row.commission_paise) / 100,
        net: Number(row.net_paise) / 100,
        status: row.status,
        mode: row.mode,
        failureReason: row.failure_reason || '',
        createdAt: row.created_at,
        paidAt: row.paid_at,
        payer: payer ? publicUser(payer) : null,
        target: target ? publicUser(target) : null
      };
    });

  const paid = payments.filter((p) => p.status === 'PAID');
  const sum = (list, key) => list.reduce((total, p) => total + p[key], 0);

  return ok({
    payments,
    mode: env.paymentMode(),
    totals: {
      collected: sum(paid, 'amount'),
      commission: sum(paid, 'commission'),
      netToCreators: sum(paid, 'net'),
      subscriptions: sum(paid.filter((p) => p.purpose === 'SUBSCRIPTION'), 'amount'),
      tips: sum(paid.filter((p) => p.purpose === 'TIP'), 'amount'),
      verification: sum(paid.filter((p) => p.purpose === 'VERIFICATION'), 'amount'),
      paidCount: paid.length,
      failedCount: payments.filter((p) => p.status === 'FAILED').length,
      pendingCount: payments.filter((p) => p.status === 'CREATED').length
    }
  });
}

// -------------------------------------------------------------- media
async function adminListMedia({ store }) {
  const media = store.media.all()
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
    .slice(0, 300)
    .map((row) => {
      const owner = store.users.byId(row.owner_id);
      return {
        id: row.id,
        storeKey: row.store_key,
        kind: row.kind,
        mimeType: row.mime_type,
        bytes: Number(row.bytes),
        url: sanitizeUrl(row.url),
        createdAt: row.created_at,
        owner: owner ? publicUser(owner) : null
      };
    });

  return ok({
    media,
    totalBytes: store.media.all().reduce((total, row) => total + (Number(row.bytes) || 0), 0),
    count: store.media.count()
  });
}


// ==========================================================================
// src/routes/media.js
// ==========================================================================




/**
 * MEDIA STORAGE
 *
 * Netlify Blobs, served back through /media/:key with a real content-type. That
 * matters twice over: <video> works (Drive hotlinks never did), and Open Graph
 * images resolve to a normal HTTPS URL a crawler can fetch, so link previews
 * carry the actual picture.
 */
const STORE_NAME = 'vibestar-media';

function mediaStore() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

const EXTENSIONS = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov'
};

async function uploadMedia({ store, user, body }) {
  // AVATAR and BANNER uploads are open to everyone, because every account has a
  // profile to decorate. POST uploads stay creator-only, since only creators
  // publish to the feed.
  const requested = String(body?.purpose || 'POST').toUpperCase();
  const purpose = ['AVATAR', 'BANNER'].includes(requested) ? requested : 'POST';
  if (purpose === 'POST' && user.role !== 'CELEBRITY') {
    return fail('Only creator accounts can publish media.');
  }

  const mimeType = String(body?.mimeType || '').toLowerCase().split(';')[0].trim();
  const isImage = ALLOWED_IMAGE_TYPES.includes(mimeType);
  const isVideo = ALLOWED_VIDEO_TYPES.includes(mimeType);

  // A profile picture or banner is a still image by definition.
  if (purpose !== 'POST' && !isImage) {
    return fail(`A profile ${purpose === 'BANNER' ? 'banner' : 'picture'} must be an image.`);
  }

  // SVG is excluded on purpose: it can carry script, and it would be served
  // from our own origin where that script would be same-origin.
  if (!isImage && !isVideo) {
    return fail('Unsupported file type. Use JPEG, PNG, WebP, GIF, MP4 or WebM.');
  }

  const base64 = String(body?.data || '').replace(/^data:[^,]*,/, '').replace(/\s/g, '');
  if (!base64) return fail('No file data was received.');

  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    return fail('That file could not be read.');
  }

  const cap = purpose !== 'POST'
    ? MEDIA_MAX_AVATAR_BYTES
    : (isVideo ? MEDIA_MAX_VIDEO_BYTES : MEDIA_MAX_IMAGE_BYTES);
  if (buffer.length > cap) {
    return fail(`${isVideo ? 'Video' : 'Image'} is too large (${Math.round(buffer.length / 1048576)}MB). `
              + `Limit is ${Math.round(cap / 1048576)}MB.`);
  }
  if (!buffer.length) return fail('That file is empty.');

  // The stored key is generated, never derived from the client's filename.
  const key = `${newId('media')}.${EXTENSIONS[mimeType] || 'bin'}`;

  try {
    await mediaStore().set(key, buffer, { metadata: { mimeType, ownerId: user.id } });
  } catch (err) {
    return fail(`That file could not be stored: ${err?.message || err}`);
  }

  const url = `${env.siteUrl()}/media/${key}`;
  const id = newId('med');

  // The file itself lives in Blobs; the spreadsheet keeps only the ledger row,
  // which is what the admin storage view and the delete path read.
  store.media.insert({
    id,
    owner_id: user.id,
    store_key: key,
    kind: isVideo ? 'VIDEO' : 'IMAGE',
    mime_type: mimeType,
    bytes: buffer.length,
    url,
    created_at: new Date().toISOString()
  });

  return ok({ url, key, id, purpose, kind: isVideo ? 'VIDEO' : 'IMAGE', bytes: buffer.length, mimeType });
}

async function getMediaLimits() {
  return ok({
    imageTypes: ALLOWED_IMAGE_TYPES,
    videoTypes: ALLOWED_VIDEO_TYPES,
    maxImageBytes: MEDIA_MAX_IMAGE_BYTES,
    maxVideoBytes: MEDIA_MAX_VIDEO_BYTES,
    maxAvatarBytes: MEDIA_MAX_AVATAR_BYTES
  });
}

async function deleteMedia({ store, user, body }) {
  const row = store.media.byId(String(body?.mediaId || ''));
  if (!row) return fail('That file no longer exists.');
  if (row.owner_id !== user.id && !isAdminUser(user)) {
    return fail('You can only delete your own uploads.');
  }

  try {
    await mediaStore().delete(row.store_key);
  } catch {
    // Already gone from the store; still drop the row so the ledger is honest.
  }

  store.media.remove(row);
  return ok({ message: 'File deleted.' });
}


// ==========================================================================
// src/gas/entry.js
// ==========================================================================

/* eslint-disable no-undef */













/**
 * APPS SCRIPT ENTRY POINTS
 *
 * The Netlify build routes over HTTP; here the client calls in through
 * google.script.run, which hands JavaScript values straight across. The routing
 * table is the same shape and carries the same two declarations per route —
 * authorisation level, and which tables to load — so authorisation stays a
 * property of the table rather than something each handler remembers.
 */
const ROUTES = {
  signUp:                    { level: 'PUBLIC', fn: signUp,            tables: [] },
  logIn:                     { level: 'PUBLIC', fn: logIn,             tables: ['Users'] },
  logOut:                    { level: 'PUBLIC', fn: logOut,            tables: [] },
  getSharedPost:             { level: 'PUBLIC', fn: getSharedPost,  tables: ['Posts', 'Users', 'Likes', 'Comments'] },

  resumeSession:             { level: 'USER', fn: resumeSession,       tables: [] },
  getProfile:                { level: 'USER', fn: getProfile,          tables: ['Posts', 'Follows', 'Subscriptions', 'Likes', 'Comments'] },
  updateProfile:             { level: 'USER', fn: updateProfile,       tables: [] },
  changePassword:            { level: 'USER', fn: changePassword,      tables: [] },
  getChatThemes:             { level: 'USER', fn: getChatThemes,       tables: [] },
  setChatTheme:              { level: 'USER', fn: setChatTheme,        tables: [] },

  getPublicFeed:             { level: 'USER', fn: getPublicFeed,    tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions', 'Saves'] },
  getCreators:               { level: 'USER', fn: getCreators,      tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions'] },
  search:                    { level: 'USER', fn: search,           tables: ['Posts', 'Likes', 'Comments', 'Follows', 'Subscriptions', 'Saves'] },
  toggleSave:                { level: 'USER', fn: toggleSave,       tables: ['Posts', 'Saves', 'Subscriptions'] },
  getSavedPosts:             { level: 'USER', fn: getSavedPosts,    tables: ['Posts', 'Saves', 'Likes', 'Comments', 'Subscriptions'] },
  createPost:                { level: 'USER', fn: createPost,       tables: ['Posts'] },
  deletePost:                { level: 'USER', fn: deletePost,       tables: ['Posts'] },
  toggleLike:                { level: 'USER', fn: toggleLike,       tables: ['Posts', 'Likes', 'Subscriptions', 'Notifications'] },
  addComment:                { level: 'USER', fn: addComment,       tables: ['Posts', 'Comments', 'Subscriptions', 'Notifications'] },
  getComments:               { level: 'USER', fn: getComments,      tables: ['Posts', 'Comments', 'Subscriptions'] },
  deleteComment:             { level: 'USER', fn: deleteComment,    tables: ['Posts', 'Comments'] },
  getShareLink:              { level: 'USER', fn: getShareLink,     tables: ['Posts'] },
  getCreatorGallery:         { level: 'USER', fn: getCreatorGallery, tables: ['Posts', 'Likes', 'Comments', 'Subscriptions', 'Saves'] },

  followUser:                { level: 'USER', fn: followUser,        tables: [] },
  unfollowUser:              { level: 'USER', fn: unfollowUser,      tables: ['Follows'] },
  getFollowList:             { level: 'USER', fn: getFollowList,     tables: ['Follows'] },
  getConversations:          { level: 'USER', fn: getConversations,  tables: ['Subscriptions', 'Messages'] },
  getChatMessages:           { level: 'USER', fn: getChatMessages,   tables: ['Subscriptions', 'Messages', 'Notifications'] },
  sendMessage:               { level: 'USER', fn: sendMessage,       tables: ['Subscriptions', 'Messages', 'Notifications'] },
  getNotifications:          { level: 'USER', fn: getNotifications,  tables: ['Notifications'] },
  markNotificationsRead:     { level: 'USER', fn: markNotificationsRead, tables: ['Notifications'] },

  getPaymentConfig:          { level: 'USER', fn: getPaymentConfig,   tables: [] },
  createPaymentOrder:        { level: 'USER', fn: createPaymentOrder, tables: ['Payments'] },
  confirmPayment:            { level: 'USER', fn: confirmPayment,     tables: ['Payments'] },
  processSubscription:       { level: 'USER', fn: processSubscription, tables: [] },
  cancelSubscription:        { level: 'USER', fn: cancelSubscription, tables: ['Subscriptions'] },
  getMyPayments:             { level: 'USER', fn: getMyPayments,      tables: ['Payments'] },
  getCreatorEarnings:        { level: 'USER', fn: getCreatorEarnings, tables: ['Payments'] },
  getVerificationState:      { level: 'USER', fn: getVerificationState, tables: ['VerificationRequests'] },
  submitVerificationRequest: { level: 'USER', fn: submitVerificationRequest, tables: [] },
  cancelVerificationRequest: { level: 'USER', fn: cancelVerificationRequest, tables: ['VerificationRequests'] },

  uploadMedia:               { level: 'USER', fn: uploadMedia,        tables: ['Media'] },
  getMediaLimits:            { level: 'USER', fn: getMediaLimits,     tables: [] },
  deleteMedia:               { level: 'USER', fn: deleteMedia,        tables: ['Media'] },

  adminGetOverview:          { level: 'ADMIN', fn: adminGetOverview,  tables: ['Posts', 'Subscriptions', 'Messages', 'Follows', 'Likes', 'Comments', 'Notifications', 'Media', 'VerificationRequests'] },
  adminGetRevenue:           { level: 'ADMIN', fn: adminGetRevenue,   tables: ['Payments'] },
  adminListUsers:            { level: 'ADMIN', fn: adminListUsers,    tables: ['Posts', 'Follows', 'Subscriptions'] },
  adminSetUserStatus:        { level: 'ADMIN', fn: adminSetUserStatus, tables: [] },
  adminSetUserRole:          { level: 'ADMIN', fn: adminSetUserRole,  tables: [] },
  adminSetUserAdmin:         { level: 'ADMIN', fn: adminSetUserAdmin, tables: [] },
  adminListPosts:            { level: 'ADMIN', fn: adminListPosts,    tables: ['Posts'] },
  adminSetPostStatus:        { level: 'ADMIN', fn: adminSetPostStatus, tables: ['Posts'] },
  adminListPayments:         { level: 'ADMIN', fn: adminListPayments, tables: ['Payments'] },
  adminListMedia:            { level: 'ADMIN', fn: adminListMedia,    tables: ['Media'] },
  listVerificationRequests:  { level: 'ADMIN', fn: listVerificationRequests, tables: ['VerificationRequests'] },
  reviewVerificationRequest: { level: 'ADMIN', fn: reviewVerificationRequest, tables: [] },
  setVerifiedFollowerCount:  { level: 'ADMIN', fn: setVerifiedFollowerCount, tables: [] }
};

/**
 * The single function the client calls, through google.script.run.
 *
 * Returns a JSON STRING rather than an object on purpose: google.script.run
 * serialises return values with its own rules, which drop undefined, convert
 * Dates and choke on anything non-plain. A string crosses the bridge untouched
 * and the client parses it, so the payload the browser sees is byte-identical to
 * the one the Netlify deployment produces.
 */
async function apiCall(action, payload, token) {
  const route = ROUTES[action];
  if (!route) return JSON.stringify({ ok: false, error: 'Not found' });

  const body = payload && typeof payload === 'object' ? payload : {};

  try {
    const tables = [...route.tables];
    if (route.level !== 'PUBLIC' || token) tables.push('Users');
    const store = await openStore(tables);

    let user = null;
    if (route.level !== 'PUBLIC') {
      user = await resolveUser(store, token);
      if (!user) return JSON.stringify({ ok: false, error: 'SESSION_EXPIRED' });
      if (route.level === 'ADMIN' && !isAdminUser(user)) {
        return JSON.stringify({ ok: false, error: 'FORBIDDEN' });
      }
    } else if (token) {
      user = await resolveUser(store, token);
    }

    const result = await route.fn({ store, user, body, token, event: { headers: {} } });
    await store.flush();
    return result.body;
  } catch (err) {
    // Logged in full for the operator; the client gets something generic, so a
    // stack trace cannot disclose the spreadsheet's structure.
    console.error(`apiCall:${action}`, err && err.stack ? err.stack : err);
    const message = String((err && err.message) || '');

    // Two failures are worth naming because the user can act on them.
    if (/busy/i.test(message)) {
      return JSON.stringify({ ok: false, error: 'The app is briefly busy. Try again in a moment.' });
    }
    if (/password format/i.test(message)) {
      return JSON.stringify({ ok: false, error: message });
    }
    return JSON.stringify({ ok: false, error: 'Something went wrong.' });
  }
}

/** Serves the app. */
function doGet(e) {
  const parameter = (e && e.parameter) || {};

  // /exec?p=<postId> is the share link. Rendered by the same page, which reads
  // the parameter and asks for the post — there is no server-rendered Open Graph
  // card here, because Apps Script serves the page inside a googleusercontent
  // iframe that crawlers cannot read. That is a real limitation of this target;
  // the Netlify deployment does render real preview cards.
  const template = HtmlService.createTemplateFromFile('Index');
  template.sharedPostId = parameter.p ? String(parameter.p) : '';

  return template.evaluate()
    .setTitle('VibeStar')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Razorpay webhook target.
 *
 * NOTE, and it matters: Apps Script's doPost exposes no request headers, so
 * X-Razorpay-Signature cannot be read and therefore cannot be verified. The body
 * is treated as an untrusted hint — it is used only to learn WHICH payment to
 * ask about, and the payment is then re-fetched from Razorpay before anything is
 * granted. The Netlify deployment verifies the signature properly; if payments
 * matter to you, run that one.
 */
function doPost(e) {
  const output = (body) => ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);

  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const entity = payload && payload.payload && payload.payload.payment
      && payload.payload.payment.entity;

    if (!entity || !entity.order_id || !entity.id) return output({ ok: true, ignored: true });

    // settlePayment re-fetches from Razorpay and settles under LockService, so a
    // forged body cannot grant anything and a duplicate delivery cannot grant
    // twice.
    const settled = JSON.parse(settlePaymentSync(entity.order_id, entity.id, false));
    return output({ ok: settled.ok === true });
  } catch (err) {
    console.error('doPost', err);
    return output({ ok: false });
  }
}

/** Lets Index.html pull in shared partials if it grows. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ------------------------------------------------------------ operations
/** Run once from the editor: creates every tab, and grants the OAuth scopes. */
function setUpSpreadsheet() {
  const message = createSpreadsheetTabs();

  // Touching DriveApp here is deliberate. Apps Script derives its OAuth scopes
  // from the code it can see, and only prompts on an editor run — so without
  // this, the first upload would fail with a permission error for a user who
  // cannot grant it themselves.
  const folder = DriveApp.getRootFolder();
  const probe = folder.createFile(
    Utilities.newBlob('vibestar authorisation probe', 'text/plain', 'vibestar-auth-check.txt'));
  probe.setTrashed(true);

  return `${message} Drive access granted.`;
}

/** Daily trigger: expiry, reminders, pruning. Install with installTrigger(). */
async function runMaintenance() {
  const result = await transact(
    ['Posts', 'Subscriptions', 'Users', 'Notifications'],
    async (store) => {
      const now = Date.now();
      const out = { expired: 0, expiringReminders: 0, lapsedReminders: 0, prunedNotifications: 0 };
      const failures = [];

      const steps = [
        ['expired', () => { out.expired = markExpiredPosts(store, now); }],
        ['reminders', () => {
          const sent = sendExpiryReminders(store, now);
          out.expiringReminders = sent.expiringReminders;
          out.lapsedReminders = sent.lapsedReminders;
        }],
        ['prune', () => { out.prunedNotifications = pruneNotifications(store, now); }]
      ];

      for (const [name, run] of steps) {
        try { run(); } catch (err) { failures.push(name); console.error(`maintenance:${name}`, err); }
      }
      return { ...out, failures };
    }
  );

  result.prunedSessions = pruneSessions();
  console.log('maintenance complete', JSON.stringify(result));
  return result;
}

/** Installs the nightly trigger. Run once from the editor. */
function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'runMaintenance')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('runMaintenance').timeBased().atHour(3).everyDays(1).create();
  return 'Nightly maintenance installed for ~3am.';
}


// ==========================================================================
// Apps Script glue
// ==========================================================================

/**
 * doPost cannot be async, so this unwraps the promise settlePayment returns.
 * Apps Script's V8 runtime runs microtasks to completion before the function
 * returns, which makes this safe here in a way it would not be on Node.
 */
function settlePaymentSync(orderId, paymentId, signatureVerified) {
  let captured = JSON.stringify({ ok: false, error: 'Settlement did not complete.' });
  settlePayment(orderId, paymentId, signatureVerified)
    .then((result) => { captured = result.body; })
    .catch((err) => { captured = JSON.stringify({ ok: false, error: String(err && err.message) }); });
  return captured;
}

/** Adds the demo accounts. Optional; run once from the editor. */
function seedDemoData() {
  return seedDemoAccounts();
}

/* eslint-disable no-undef */
/**
 * Demo data for the Apps Script build.
 *
 * scripts/seed.js does this for the Netlify targets; it cannot run here because
 * Apps Script has no Node. The fixture list is the same, and both write through
 * the store, so the two produce equivalent rows.
 */
async function seedDemoAccounts() {
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
