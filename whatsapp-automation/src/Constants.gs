/**
 * Constants.gs
 * Sheet names, column schemas, statuses and form field mapping.
 *
 * Nothing in this file is client-specific. Every business detail (name, image,
 * website, phone, CTA, message, audience) arrives through the Google Form.
 */

const SYSTEM_VERSION = '1.0.0';

const SHEETS = {
  SETTINGS: 'SETTINGS',
  FORM_RESPONSES: 'FORM_RESPONSES',
  CLIENTS: 'CLIENTS',
  CONTACTS: 'CONTACTS',
  CAMPAIGNS: 'CAMPAIGNS',
  MESSAGE_QUEUE: 'MESSAGE_QUEUE',
  LOGS: 'LOGS',
  RESPONSES: 'RESPONSES',
  TEMPLATES: 'TEMPLATES',
  DASHBOARD: 'DASHBOARD',
};

const HEADERS = {
  SETTINGS: ['Key', 'Value', 'Description'],
  CLIENTS: ['Client ID', 'Business Name', 'Client Email', 'Business Phone', 'Website', 'Status', 'Created At', 'Updated At'],
  CONTACTS: [
    'Contact ID', 'Client ID', 'Name', 'Phone', 'Email', 'Company', 'Tags', 'Audience', 'Opt In', 'Status',
    'Last Sent', 'Last Message ID', 'Last Response', 'Created At', 'Updated At',
  ],
  CAMPAIGNS: [
    'Campaign ID', 'Client ID', 'Client Name', 'Campaign Name', 'Status', 'Message', 'Image File ID', 'Image URL',
    'Website URL', 'Store Phone', 'CTA Text', 'CTA Type', 'CTA Value', 'Target Audience', 'Send Mode',
    'Schedule Date', 'Schedule Time', 'Timezone', 'Created At', 'Updated At', 'Submitted By', 'Notes',
  ],
  MESSAGE_QUEUE: [
    'Queue ID', 'Campaign ID', 'Client ID', 'Contact ID', 'Phone', 'Name', 'Rendered Message', 'Image File ID',
    'Image URL', 'CTA Type', 'CTA Text', 'CTA Value', 'Status', 'Attempts', 'Scheduled At', 'Started At',
    'Sent At', 'Message ID', 'Error', 'Last Attempt', 'Created At',
  ],
  LOGS: [
    'Timestamp', 'Level', 'Action', 'Client ID', 'Campaign ID', 'Contact ID', 'Phone', 'Message ID',
    'HTTP Status', 'Result', 'Error', 'Details',
  ],
  RESPONSES: [
    'Timestamp', 'Client ID', 'Campaign ID', 'Phone', 'Name', 'Message ID', 'Message Type', 'Message Text',
    'Event Type', 'Status', 'Raw Payload', 'Processed',
  ],
  TEMPLATES: [
    'Template ID', 'Template Name', 'Trigger', 'Reply Type', 'Reply Text', 'Image URL', 'Button Text',
    'Button Type', 'Button Value', 'Active',
  ],
};

const CAMPAIGN_STATUS = {
  DRAFT: 'DRAFT',
  VALIDATING: 'VALIDATING',
  READY: 'READY',
  SCHEDULED: 'SCHEDULED',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  ERROR: 'ERROR',
};

const QUEUE_STATUS = {
  PENDING: 'PENDING',       // waiting for its first send attempt
  PROCESSING: 'PROCESSING', // currently being sent by an execution
  QUEUED: 'QUEUED',         // waiting for a retry (backoff / rate limit)
  SENT: 'SENT',             // accepted by Maytapi
  DELIVERED: 'DELIVERED',   // delivery ack received via webhook
  READ: 'READ',             // read ack received via webhook
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',       // e.g. opted out after queueing
  CANCELLED: 'CANCELLED',
};

/** Progression rank used so a late "delivered" ack never downgrades a "read" row. */
const QUEUE_STATUS_RANK = { SENT: 1, DELIVERED: 2, READ: 3 };

const CTA_TYPES = ['URL', 'PHONE', 'QUICK_REPLY'];

const SEND_MODES = { NOW: 'SEND NOW', SCHEDULE: 'SCHEDULE' };

const LOG_LEVEL = { INFO: 'INFO', SUCCESS: 'SUCCESS', WARNING: 'WARNING', ERROR: 'ERROR' };

/**
 * Google Form question titles. Each key accepts several aliases so the admin can
 * rename questions slightly without breaking the parser.
 */
const FORM_FIELDS = {
  businessName: ['Client / Business Name', 'Business Name', 'Client Name'],
  campaignName: ['Campaign Name'],
  message: ['Campaign Message', 'Message'],
  image: ['Campaign Image', 'Image'],
  website: ['Website / Landing Page URL', 'Website', 'Landing Page URL'],
  storePhone: ['Store / Business Phone Number', 'Business Phone Number', 'Store Phone'],
  ctaText: ['CTA Button Text', 'CTA Text'],
  ctaType: ['CTA Button Type', 'CTA Type'],
  ctaValue: ['CTA Button Value', 'CTA Value'],
  audience: ['Target Audience', 'Audience'],
  date: ['Campaign Date', 'Schedule Date'],
  time: ['Campaign Time', 'Schedule Time'],
  email: ['Client Email', 'Email Address', 'Email'],
  notes: ['Additional Notes', 'Notes'],
  sendMode: ['Send Mode'],
};

/** Personalisation variables supported in campaign messages and reply templates. */
const TEMPLATE_VARIABLES = ['Name', 'Phone', 'Email', 'Company', 'ClientName', 'CampaignName', 'StorePhone', 'Website'];

/** WhatsApp-accepted image MIME types for regular image messages. */
const SUPPORTED_IMAGE_MIME = ['image/jpeg', 'image/png'];
