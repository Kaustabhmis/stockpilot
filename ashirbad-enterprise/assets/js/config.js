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

    /** Hero carousel: time each live project stays on screen (ms). */
    CAROUSEL_DELAY_MS: 10000,

    /** Demo-mode admin password only. Ignored once APPS_SCRIPT_URL is set. */
    LOCAL_ADMIN_PASSWORD: 'ashirbad@admin'
};
