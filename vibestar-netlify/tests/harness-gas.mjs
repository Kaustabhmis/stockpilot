/**
 * Apps Script harness for the shared route spec.
 *
 * Runs the routes against store-gas.js under a mocked Apps Script runtime, so
 * the Code.gs deployment is held to exactly the same 48 assertions as the
 * Netlify+Sheets and Supabase ones.
 */
import { installFakeAppsScript } from './fake-apps-script.mjs';

export async function gasHarness() {
  const fake = installFakeAppsScript();

  // The dispatchers detect Apps Script by the presence of SpreadsheetApp, so the
  // mock has to be installed before store.js and platform.js load.
  delete process.env.DATABASE_URL;
  delete process.env.GOOGLE_SHEET_ID;
  process.env.VIBESTAR_LOCAL_KV = '1';
  process.env.URL = 'https://vibestar.test';
  process.env.MEDIA_URL_SECRET = 'test-media-secret';
  // Apps Script has no scrypt, so accounts must be hashed portably.
  process.env.PASSWORD_ALGO = 'pbkdf2';
  process.env.PBKDF2_ITERATIONS = '1000';

  const store = await import('../src/lib/store.js');
  const platform = await import('../src/lib/platform.js');
  const { columnsOf, TABLE_NAMES } = await import('../src/lib/tables.js');

  if (store.BACKEND !== 'APPS_SCRIPT') {
    throw new Error(`expected the Apps Script backend, got ${store.BACKEND}`);
  }
  if (platform.PLATFORM !== 'APPS_SCRIPT') {
    throw new Error(`expected the Apps Script platform shim, got ${platform.PLATFORM}`);
  }

  return {
    label: 'apps-script',
    openStore: store.openStore,

    async reset() {
      for (const table of TABLE_NAMES) fake.seed(table, columnsOf(table));
      fake.seed('_Lock', ['lock'], [{ lock: '' }]);
    },

    async seed(table, rows) {
      fake.seed(table, columnsOf(table), rows);
    },

    writes: () => fake.stats.writes,
    // No unique indexes on a spreadsheet; LockService plus distinct counting.
    enforcesUniqueness: false,
    // Apps Script cannot serve binary, so there is no signed-URL path: an
    // entitled viewer gets the bytes inline instead. The invariant the spec
    // checks is the same — entitled viewers get media, others get nothing.
    privateMediaStyle: 'data-uri',

    stubRazorpay({ amount = 29900, status = 'captured', orderId = 'order_1' } = {}) {
      process.env.RAZORPAY_KEY_ID = 'rzp_test_abc';
      process.env.RAZORPAY_KEY_SECRET = 'secret_xyz';

      const json = (body, code = 200) => new Response(JSON.stringify(body), {
        status: code, headers: { 'Content-Type': 'application/json' }
      });

      globalThis.fetch = async (input) => {
        const url = input instanceof URL ? input : new URL(String(input));
        if (!url.href.startsWith('https://api.razorpay.com')) {
          throw new Error(`unexpected request to ${url.href}`);
        }
        if (url.pathname.endsWith('/orders')) return json({ id: orderId, amount, currency: 'INR' });
        if (url.pathname.includes('/payments/')) {
          return json({ id: url.pathname.split('/').pop(), order_id: orderId, amount, status, currency: 'INR' });
        }
        return json({ error: { description: 'unexpected' } }, 400);
      };
    },

    async teardown() { fake.restore(); }
  };
}
