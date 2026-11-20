import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Every function entry point must import cleanly and export a handler. Cheap,
 * and it catches the class of mistake a route-level test never reaches: a stale
 * import left behind by a refactor.
 */
process.env.VIBESTAR_LOCAL_KV = '1';

// store.js refuses to load with no database configured — deliberately, so a
// misconfigured deploy fails at startup with instructions rather than on the
// first request. Nothing here actually talks to it, so either backend will do.
process.env.GOOGLE_SHEET_ID = 'import-test-only';
process.env.GOOGLE_CLIENT_EMAIL = 'import-test@example.iam.gserviceaccount.com';
process.env.GOOGLE_PRIVATE_KEY = 'unused';
delete process.env.DATABASE_URL;

const ENTRY_POINTS = [
  '../netlify/functions/api.js',
  '../netlify/functions/share.js',
  '../netlify/functions/media.js',
  '../netlify/functions/webhook.js',
  '../netlify/functions/maintenance.js'
];

for (const path of ENTRY_POINTS) {
  test(`${path.split('/').pop()} imports and exports a handler`, async () => {
    const module = await import(path);
    assert.equal(typeof module.handler, 'function');
  });
}
