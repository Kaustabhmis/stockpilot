/** The route spec, on the Google Sheets backend. */
import test from 'node:test';
import { sheetsHarness } from './harness-sheets.mjs';
import { routeSpec } from './suite-routes.mjs';

const harness = await sheetsHarness();
await routeSpec(harness);
test.after(() => harness.teardown());
