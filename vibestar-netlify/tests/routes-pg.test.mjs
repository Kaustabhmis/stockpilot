/**
 * The same route spec, on a real PostgreSQL database.
 *
 * Skipped when TEST_DATABASE_URL is unset so the suite still runs without a
 * database to hand. Set it and these become the assertions that matter most:
 * anything that passes on Sheets but fails here is a genuine difference between
 * the two backends.
 */
import test from 'node:test';
import { pgHarness, PG_URL } from './harness-pg.mjs';
import { routeSpec } from './suite-routes.mjs';

if (!PG_URL) {
  test('postgres route spec', { skip: 'TEST_DATABASE_URL is not set' }, () => {});
} else {
  const harness = await pgHarness();
  await routeSpec(harness);
  test.after(() => harness.teardown());
}
