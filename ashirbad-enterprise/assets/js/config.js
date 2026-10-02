/**
 * Ashirbad Enterprise – technical configuration
 * ---------------------------------------------------------------
 * Business details and ALL page texts (phone, address, WhatsApp,
 * GST numbers, headings, FAQ, SEO titles, social links, Google
 * Maps & Analytics IDs…) are edited in Admin → Website Content.
 * Only the three technical settings below live in this file.
 *
 * DEMO MODE (default): leave APPS_SCRIPT_URL empty – data is stored in
 *   this browser only. Good for previewing, NOT for production.
 * PRODUCTION: follow README.md → "Google Sheets setup" and paste your
 *   Apps Script Web App URL below. The Google Sheet itself stays private.
 */
window.APP_CONFIG = {
    APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxhYwcBC9QBgKXKVwvIteU8vg7Upo95onnhRLErRm7_kD07sgmkuW_4z7iPfQZePZEp/exec',       // e.g. 'https://script.google.com/macros/s/AKfy.../exec'

    /** Your website address – used for canonical URLs, sitemap and share links. */
    SITE_URL: 'https://ashirbadenterprise.in',

    /** Demo-mode admin password only. Ignored once APPS_SCRIPT_URL is set. */
    LOCAL_ADMIN_PASSWORD: 'ashirbad@admin'
};
