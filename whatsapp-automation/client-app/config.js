/**
 * Client app configuration — edit this file for each installation / brand.
 *
 * apiUrl: your Apps Script Web App URL (Deploy → Manage deployments → Web app URL, ending in /exec).
 *         "?route=api" is added automatically. In the spreadsheet: WhatsApp Automation → Show Client App URLs.
 * Business details below are shown on legal.html (Terms / Privacy / Refund / Contact), which Razorpay
 * requires on your website before activating payments. Review that page with your advisor.
 */
window.APP_CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/PASTE_YOUR_DEPLOYMENT_ID/exec',
  brandName: 'Campaign Studio',          // shown on the sign-in page and browser tab
  logoUrl: '',                           // optional, e.g. 'logo.png' (put the file next to index.html)
  primaryColor: '#128c4a',               // buttons and accents (#RRGGBB)
  supportText: 'Your access code is emailed after you subscribe.',

  // Business details for legal.html (required by Razorpay)
  companyName: 'Your Company Name',      // registered business name
  contactEmail: 'support@example.com',
  contactPhone: '+91 00000 00000',
  address: 'Your registered business address, City, State, PIN',
  termsUrl: 'legal.html',
};
