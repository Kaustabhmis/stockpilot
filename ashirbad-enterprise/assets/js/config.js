/**
 * Ashirbad Enterprise – site configuration
 * ---------------------------------------------------------------
 * DEMO MODE (default): leave APPS_SCRIPT_URL empty.
 *   All data (projects, posts, images, leads) is stored in the
 *   current browser only (IndexedDB). Good for previewing the admin
 *   panel, NOT for production – visitors will not see your edits.
 *
 * PRODUCTION MODE (private Google Sheet): follow README.md →
 *   "Google Sheets setup", then paste your Apps Script *Web App URL*
 *   below. The Google Sheet itself stays private – its link/ID is
 *   never placed on the website – and the admin password lives only
 *   inside the Apps Script (hashed), not in this file.
 */
window.APP_CONFIG = {
    APPS_SCRIPT_URL: '',       // e.g. 'https://script.google.com/macros/s/AKfy.../exec'

    GOOGLE_MAPS_API_KEY: 'YOUR_GOOGLE_MAPS_API_KEY',

    SITE_URL: 'https://www.ashirbadenterprise.com',
    WHATSAPP_NUMBER: '919876543210',
    PHONE: '+919876543210',
    PHONE_DISPLAY: '+91 98765 43210',
    EMAIL: 'info@ashirbadenterprise.com',
    ADDRESS: 'Rajarhat Expressway, Kolkata, West Bengal 700156',

    /** Official social profiles (leave '' to hide). Also used as "sameAs" in structured data. */
    SOCIAL: {
        facebook: '',   // e.g. 'https://www.facebook.com/ashirbadenterprise'
        instagram: '',
        youtube: '',
        linkedin: ''
    },

    /** Google Analytics 4 measurement ID, e.g. 'G-XXXXXXXXXX' (optional). */
    GA_MEASUREMENT_ID: '',

    /** Search Console / Bing verification codes (content="..." value only). Added by the build. */
    GOOGLE_SITE_VERIFICATION: '',
    BING_SITE_VERIFICATION: '',

    /**
     * Customer testimonials for the landing page. Use REAL reviews only, with the
     * customer's permission. The section stays hidden while this list is empty.
     * Example: { name: 'Rahul S.', project: 'Ashirbad Enclave', quote: '...', rating: 5 }
     */
    TESTIMONIALS: [],

    /** Hero carousel: time each live project stays on screen (ms). */
    CAROUSEL_DELAY_MS: 10000,

    /** Demo-mode admin password only. Ignored once APPS_SCRIPT_URL is set. */
    LOCAL_ADMIN_PASSWORD: 'ashirbad@admin'
};
