# The two files in this folder

| File | Where it goes |
|---|---|
| `code.gs` | Into a **new** Apps Script project made at **script.google.com** — not inside your Master sheet, and not pasted over your old script. |
| `index.html` | Nothing to do by hand. Netlify builds the website from the `netlify/` folder. |

**Starting fresh (no customers to move)?** Read **[`../FRESH-START.md`](../FRESH-START.md)** —
one function, `freshStart`, builds every sheet for you. Nothing to migrate.

**Moving existing customers' data across:** read **[`../DEPLOY-BOOK.pdf`](../DEPLOY-BOOK.pdf)** — simple words, a picture of every
screen. The same steps in text: [`../DEPLOY-SIMPLE.md`](../DEPLOY-SIMPLE.md).

Your old script inside the Master sheet keeps running your live site until the switch in
Part 2 of the book. Do not edit it.

Tested: 1,957 checks across fifty-one suites — server rules and the
real page in a browser. See `tests/README.md`.

## Before you advertise the site

1. **Build the demo company.** In the new Apps Script project, run `createDemoAccount` once
   (or `removeDemoAccount` then `createDemoAccount` to refresh it). The home page's
   "See the live demo" buttons open it view-only; until it exists they say the demo is being
   refreshed.
2. **Paste the new `domebox/reminders.gs`** alongside `code.gs`. It sends the trial emails
   (3 days, 1 day and the last day) instead of renewal notices.
3. Links you can use in ads, WhatsApp and email: `www.domebox.in/?signup=1` (straight to the
   free trial) and `www.domebox.in/?demo=owner` (straight into the live demo; also
   `?demo=manager` and `?demo=staff`).

