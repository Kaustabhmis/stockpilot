/** The same route spec, on the Apps Script backend under a mocked runtime. */
import test from 'node:test';
import { gasHarness } from './harness-gas.mjs';
import { routeSpec } from './suite-routes.mjs';

const harness = await gasHarness();
await routeSpec(harness);
test.after(() => harness.teardown());
