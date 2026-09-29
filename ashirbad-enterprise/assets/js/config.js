/**
 * Ashirbad Enterprise – site configuration
 * ---------------------------------------------------------------
 * DEMO MODE (default): leave SUPABASE_URL / SUPABASE_ANON_KEY empty.
 *   All data (projects, posts, images, leads) is stored in the
 *   current browser only (IndexedDB). Good for previewing the admin
 *   panel, NOT for production – visitors will not see your edits.
 *
 * PRODUCTION MODE: create a free Supabase project, run
 *   supabase/schema.sql in its SQL editor, then paste the project URL
 *   and the *anon / publishable* key below. Never put the service_role
 *   key in this file – it is public.
 */
window.APP_CONFIG = {
    SUPABASE_URL: '',          // e.g. 'https://abcdxyz.supabase.co'
    SUPABASE_ANON_KEY: '',     // e.g. 'eyJhbGciOi...' or 'sb_publishable_...'
    SUPABASE_BUCKET: 'media',  // public storage bucket for uploaded images

    GOOGLE_MAPS_API_KEY: 'YOUR_GOOGLE_MAPS_API_KEY',

    SITE_URL: 'https://www.ashirbadenterprise.com',
    WHATSAPP_NUMBER: '919876543210',
    PHONE: '+919876543210',
    PHONE_DISPLAY: '+91 98765 43210',
    EMAIL: 'info@ashirbadenterprise.com',
    ADDRESS: 'Rajarhat Expressway, Kolkata, West Bengal 700156',

    /** Hero carousel: time each live project stays on screen (ms). */
    CAROUSEL_DELAY_MS: 10000,

    /** Demo-mode admin password only. Ignored once Supabase is configured. */
    LOCAL_ADMIN_PASSWORD: 'ashirbad@admin'
};
