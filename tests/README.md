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
node multilevel-test.js     # who may assign to whom, and the approval chain
node kra-test.js            # KRA/KPI sets, profile standards, optional targets
node responsiveness-test.js # manager accountability (pure rules engine, no server)
node milestone-test.js      # stage-deadline scoring (pure rules engine, no server)
node project-test.js        # multi-stage projects end to end
node fairness-test.js       # load-credited scoring: 10 jobs beats 1 easy one
node recognition-test.js    # cookie points and the org chart
node priority-test.js       # the ranking and the horizons (pure rules engine)
node priority-api-test.js   # priority levels and the list, over the API
node audit-test.js          # the launch-audit findings, pinned so they stay shut
node mail-test.js           # every email leaves from info@biscsindia.com, or not at all
node perf-test.js           # sheet reads stay flat, and nothing is read back stale
node seo-test.js            # the generated pages, structured data and sitemap
node invoice-test.js        # GST arithmetic to the paisa, and a gapless number series
node repeat-test.js         # every cadence, and the two ways a repeat ends by itself

node server.js &            # then, for the browser tests:
node ui-test.js
node billing-ui-test.js     # the invoice details are asked for before the card
node repeat-ui-test.js      # setting a stop rule the way a person would
node manager-ui-test.js     # the held-review screens, end to end
node kra-ui-test.js         # the KRA/KPI overview and editor
node project-ui-test.js     # building a project and watching a stage release
node recognition-ui-test.js # cookie points, the org chart, the load explanation
node seed.js                # prints the seeded owner's email
node recurring-test.js <that-email>
```

`responsiveness-test.js`, `milestone-test.js`, `fairness-test.js` and
`priority-test.js` load
`domebox/domain.gs` straight into a sandbox, so they need no server and no
browser.

`gas-shim.js` implements only the Apps Script surface `code.gs` actually uses.
Anything it does not implement throws rather than silently passing.

`server.js` has three endpoints marked HARNESS ONLY (`/__setplan`, `/__history`,
`/__backdate`) used to put a tenant on a paid plan, to backdate delivery history
for screenshots, and to push a task's history back so the review clock can be
seen running without waiting three days. They are not part of `code.gs` and
never reach production.
