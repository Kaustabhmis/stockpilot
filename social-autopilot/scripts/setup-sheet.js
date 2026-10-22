#!/usr/bin/env node
/**
 * Prepares a blank Google Sheet: creates every tab, writes the header rows and the
 * Profile keys. Safe to run again; existing data is left alone.
 * Run from the project folder after filling in .env:  npm run setup-sheet
 */
import { PROFILE_KEYS } from '../netlify/functions/lib/config.js';
import { createSheet, ensureSchema } from '../netlify/functions/lib/sheets.js';

const created = await ensureSchema();
console.log(created.length ? `Created tabs: ${created.join(', ')}` : 'All tabs already exist.');

const sheet = createSheet();
const profile = await sheet.getRows('Profile');
const existingKeys = new Set(profile.map((row) => row.key));
const missing = PROFILE_KEYS.filter((key) => !existingKeys.has(key));
await sheet.appendRows(
  'Profile',
  missing.map((key) => ({ key, value: key === 'auto_approve' ? 'FALSE' : '' })),
);
console.log(missing.length ? `Added ${missing.length} Profile keys.` : 'Profile keys are already present.');
console.log('Done. Share the Sheet with the service account as Editor if you have not already.');
