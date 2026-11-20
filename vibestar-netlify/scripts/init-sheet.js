#!/usr/bin/env node
/**
 * Creates every tab the app needs in your Google Spreadsheet, with the right
 * header row, and freezes row 1 so scrolling keeps the column names in view.
 *
 * Safe to re-run: an existing tab keeps its data and only has its header row
 * rewritten. Run it again after any release that adds a column.
 *
 *   GOOGLE_SHEET_ID=... GOOGLE_CLIENT_EMAIL=... GOOGLE_PRIVATE_KEY=... npm run setup
 */
import { TABLES, LOCK_TAB, columnsOf } from '../src/lib/store.js';
import { addTab, spreadsheetTitle, setRow } from '../src/lib/sheets.js';

const required = ['GOOGLE_SHEET_ID', 'GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing environment variable(s): ${missing.join(', ')}`);
  console.error('\nSee README.md → "Google Sheets setup" for how to obtain them.');
  process.exit(1);
}

try {
  const title = await spreadsheetTitle();
  console.log(`Connected to "${title}".\n`);

  for (const table of Object.keys(TABLES)) {
    const headers = columnsOf(table);
    await addTab(table, headers);
    console.log(`  ${table.padEnd(22)} ${headers.length} columns`);
  }

  // Not a data table: one cell the app uses as a mutex, because a spreadsheet
  // has no unique indexes and no transactions to lean on instead.
  await addTab(LOCK_TAB, ['lock']);
  await setRow(LOCK_TAB, 2, ['']);
  console.log(`  ${LOCK_TAB.padEnd(22)} mutex cell`);

  console.log(`\nDone — ${Object.keys(TABLES).length} tables ready.`);
  console.log('Next: npm run seed  (optional demo data, password demo1234)');
} catch (err) {
  console.error(`\nSetup failed: ${err.message}`);
  if (/permission|forbidden|403/i.test(err.message)) {
    console.error('\nThe usual cause: the spreadsheet has not been shared with the service '
                + 'account.\nOpen it in Google Sheets, press Share, and give '
                + `${process.env.GOOGLE_CLIENT_EMAIL} Editor access.`);
  }
  if (/not found|404/i.test(err.message)) {
    console.error('\nCheck GOOGLE_SHEET_ID — it is the long id in the spreadsheet URL, '
                + 'between /d/ and /edit.');
  }
  process.exit(1);
}
