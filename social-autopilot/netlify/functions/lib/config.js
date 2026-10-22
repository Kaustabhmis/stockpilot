/**
 * Central configuration: external API versions, model names, limits and the
 * Google Sheet schema. Bump API versions here only; every module imports from this file.
 *
 * Versions last checked: 2026-10-22
 *  - Meta Graph API: v26.0 (https://developers.facebook.com/docs/graph-api/changelog)
 *  - LinkedIn-Version: 202608 (https://learn.microsoft.com/linkedin/marketing/integrations/community-management/versioning)
 */

// ---- External API versions -------------------------------------------------
export const GRAPH_VERSION = 'v26.0';
export const LINKEDIN_VERSION = '202608';
export const LINKEDIN_RESTLI_VERSION = '2.0.0';

// ---- AI models (used from Phase 3) ------------------------------------------
export const GEMINI_MODEL = 'gemini-2.5-flash';
export const GROQ_MODEL = 'llama-3.3-70b-versatile';
export const CF_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

// ---- OAuth scopes -----------------------------------------------------------
export const META_SCOPES = [
  'pages_show_list',
  'pages_manage_posts',
  'pages_read_engagement',
  'instagram_basic',
  'instagram_content_publish',
  'business_management',
];
export const LINKEDIN_SCOPES = ['openid', 'profile', 'w_member_social'];
export const LINKEDIN_ORG_SCOPES = ['w_organization_social', 'r_organization_admin'];

// ---- Limits -----------------------------------------------------------------
export const CHAR_LIMITS = { facebook: 63206, instagram: 2200, linkedin: 3000 };
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const LOGIN_RATE = { maxFailures: 5, windowMs: 15 * 60 * 1000 };
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
/** Time a synchronous function may spend polling Instagram before handing off to the cron. */
export const PUBLISH_BUDGET_MS = 20_000;

// ---- Storage ----------------------------------------------------------------
export const MEDIA_STORE = 'social-media';
export const RATE_LIMIT_STORE = 'rate-limit';

// ---- Sheet schema (row 1 of each tab) ---------------------------------------
export const SHEET_SCHEMA = {
  Profile: ['key', 'value'],
  Themes: ['id', 'title', 'weight', 'example_prompt', 'active'],
  Accounts: ['id', 'platform', 'external_id', 'name', 'access_token_enc', 'expires_at', 'connected_at', 'active'],
  Slots: ['id', 'platform', 'weekday', 'time', 'timezone'],
  Posts: [
    'id', 'theme_id', 'master_text', 'media_type', 'media_urls', 'video_plan', 'status',
    'scheduled_at', 'auto_approve', 'created_at', 'updated_at',
  ],
  Targets: [
    'id', 'post_id', 'account_id', 'caption', 'status', 'remote_post_id', 'permalink',
    'error', 'attempts', 'published_at',
  ],
};

export const PROFILE_KEYS = [
  'business_name', 'description', 'audience', 'tone', 'language', 'brand_primary',
  'brand_secondary', 'logo_url', 'website', 'hashtags_default', 'auto_approve',
];

export const POST_STATUSES = ['draft', 'pending_approval', 'approved', 'rendering', 'published', 'failed', 'rejected'];
export const MEDIA_TYPES = ['none', 'image', 'video'];
export const PLATFORMS = ['facebook', 'instagram', 'linkedin_person', 'linkedin_org'];
