# Fill these in before you deploy

`site-config.json` has five blank fields. `node gen-pages.js` will refuse to run
until they are filled, and will tell you which are missing.

| Field | Why it is required | Where to find it |
|---|---|---|
| `registeredAddress` | Razorpay verifies the address on your site matches the account. Required on a Contact page by the Consumer Protection (E-Commerce) Rules. | Your GST or incorporation certificate |
| `phone` | Same rules require a working contact number, not just email. | — |
| `gstin` | Your B2B customers need it on invoices to claim input credit. Some will not buy without it. | GST certificate |
| `entityType` | e.g. "Proprietorship", "Private Limited", "LLP" | — |
| `registrationNumber` | CIN for a company, or your firm/GST registration number | — |
| `grievanceOfficerName` | A **named** person is mandatory under the Consumer Protection (E-Commerce) Rules 2020 and the IT Rules 2021. "Support team" is not sufficient. | Usually you |
| `jurisdictionCity` / `jurisdictionState` | Which courts hear a dispute. Without it the clause is unenforceable. | Where you are registered |

## One thing I cannot do for you

These pages are a solid, India-specific starting point covering what Razorpay
checks and what the DPDP Act 2023 requires. **They are not legal advice and I am
not a lawyer.** You hold employee performance data for other companies, which
makes you a Data Processor for your customers' employee records — that is a real
obligation with real liability, and it is worth an hour of a lawyer's time
before you sell another Pro seat.

Specifically get a view on:

- Whether you need a **Data Processing Agreement** with each customer. You almost
  certainly do, and none of your customers currently have one.
- Your **retention period** (`dataRetentionMonths`, currently 12). The DPDP Act
  requires erasure once the purpose is served. Twelve months after cancellation
  is defensible; indefinite is not.
- **Cross-border transfer**: your data sits in Google Sheets, so it may leave
  India. That needs disclosing.
- Whether your **appraisal scoring** counts as automated decision-making that
  affects a person's employment. If a customer uses a Dome Box score to decide
  someone's increment, the employee has a stake in how it was computed. The
  dispute path I recommended earlier is partly a legal safeguard, not just a
  nicety.
