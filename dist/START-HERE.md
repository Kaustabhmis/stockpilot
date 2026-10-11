# The two files in this folder

| File | Where it goes |
|---|---|
| `code.gs` | Into a **new** Apps Script project made at **script.google.com** — not inside your Master sheet, and not pasted over your old script. |
| `index.html` | Nothing to do by hand. Netlify builds the website from the `netlify/` folder. |

**How to deploy:** read **[`../DEPLOY-BOOK.pdf`](../DEPLOY-BOOK.pdf)** — simple words, a picture of every
screen. The same steps in text: [`../DEPLOY-SIMPLE.md`](../DEPLOY-SIMPLE.md).

Your old script inside the Master sheet keeps running your live site until the switch in
Part 2 of the book. Do not edit it.

Tested: 1,803 checks across forty-five suites — 1,477 on the server rules, 326 driving the
real page in a browser. See `tests/README.md`.
