/**
 * Sheets harness for the shared route spec.
 *
 * Fixture rows go in through the fake spreadsheet grid directly, which is fast
 * and independent of the store's own insert path — so a bug in insert cannot
 * hide by also corrupting the fixtures.
 */
import { installFakeSheets } from './fake-sheets.mjs';

export async function sheetsHarness() {
  const fake = installFakeSheets();
  delete process.env.DATABASE_URL;   // make sure the dispatcher picks Sheets

  const store = await import('../src/lib/store.js');
  const { columnsOf, TABLE_NAMES } = await import('../src/lib/tables.js');

  if (store.BACKEND !== 'SHEETS') {
    throw new Error(`expected the Sheets backend, got ${store.BACKEND}`);
  }

  return {
    label: 'sheets',
    openStore: store.openStore,

    async reset() {
      for (const table of TABLE_NAMES) fake.seed(table, columnsOf(table));
      fake.seed('_Lock', ['lock'], [{ lock: '' }]);
    },

    async seed(table, rows) {
      fake.seed(table, columnsOf(table), rows);
    },

    writes: () => fake.stats.writes,
    // A spreadsheet has no unique indexes; correctness comes from distinct counting.
    enforcesUniqueness: false,

    stubRazorpay({ amount = 29900, status = 'captured', orderId = 'order_1' } = {}) {
      process.env.RAZORPAY_KEY_ID = 'rzp_test_abc';
      process.env.RAZORPAY_KEY_SECRET = 'secret_xyz';

      fake.onExternal(async (url) => {
        if (!url.href.startsWith('https://api.razorpay.com')) return null;
        if (url.pathname.endsWith('/orders')) {
          return fake.json({ id: orderId, amount, currency: 'INR' });
        }
        if (url.pathname.includes('/payments/')) {
          const id = url.pathname.split('/').pop();
          return fake.json({ id, order_id: orderId, amount, status, currency: 'INR' });
        }
        return fake.json({ error: { description: 'unexpected' } }, 400);
      });
    },

    async teardown() { fake.restore(); }
  };
}
