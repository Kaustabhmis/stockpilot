# Tests

These run the **real** `dist/code.gs` on an in-memory Google Apps Script shim,
and drive the **real** `dist/index.html` against it over HTTP. Nothing here
tests a mock of the delivered code — it tests the delivered code.

```bash
cd tests
npm i playwright            # browser test only
node lint-codegs.js         # static checks on the assembled file
node api-test.js            # 89 end-to-end API checks
node extra-test.js          # roles, tenant isolation, plan vocabulary
node auth-test.js           # hashing, migration, token forgery, throttle
node pay-test.js            # Razorpay signature forgery and replay

node server.js &            # then, for the browser test:
node ui-test.js
```

`gas-shim.js` implements only the Apps Script surface `code.gs` actually uses.
Anything it does not implement throws rather than silently passing.

`server.js` has two endpoints marked HARNESS ONLY (`/__setplan`, `/__history`)
used to put a tenant on a paid plan and to backdate delivery history for
screenshots. They are not part of `code.gs` and never reach production.
