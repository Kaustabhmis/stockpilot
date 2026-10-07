#!/usr/bin/env node
/**
 * The Netlify build. Runs on every deploy so the generated pages and the
 * sitemap are never stale relative to the content that produced them.
 *
 * The SEO pages always build. The LEGAL pages only build once site-config.json
 * is filled in — and the build says so loudly rather than failing, because a
 * missing registered address should not stop you shipping a content page. It
 * will still stop you taking payments, which is said here in as many words so
 * it cannot be missed in the deploy log.
 */
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const here = __dirname;
const run = (f) => execFileSync('node', [path.join(here, f)], { cwd: here, stdio: 'inherit' });

console.log('\n--- SEO and marketing pages ---');
run('gen-seo.js');

const cfg = JSON.parse(fs.readFileSync(path.join(here, 'site-config.json'), 'utf8'));
const REQUIRED = ['registeredAddress', 'phone', 'gstin', 'entityType', 'registrationNumber',
                  'grievanceOfficerName', 'jurisdictionCity', 'jurisdictionState'];
const missing = REQUIRED.filter((k) => !String(cfg[k] || '').trim());

console.log('\n--- legal pages ---');
if (!missing.length) {
  run('gen-pages.js');
} else {
  console.log('SKIPPED. site-config.json is missing: ' + missing.join(', '));
  console.log('');
  console.log('  The privacy, terms, refund and contact pages are NOT being built.');
  console.log('  Razorpay checks that the registered address on your site matches the');
  console.log('  account, and a named grievance officer is required by the Consumer');
  console.log('  Protection (E-Commerce) Rules 2020. Until these are filled in you');
  console.log('  cannot complete payment onboarding.');
  console.log('');
  console.log('  See netlify/REQUIRED-BEFORE-DEPLOY.md.');
}
console.log('');
