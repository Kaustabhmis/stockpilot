# Dome Box

Task and team management for Indian MSMEs. Assign work, chase nothing, and get
a performance score your team can see the working for.

**www.domebox.in** · by **BISCS India** · live, with paying customers.

---

## Setting it up

**→ [`SETUP.md`](SETUP.md)** — the whole thing in order, start to finish.
Backend, scheduler, payments, site, going live, with what to do when each step
fails.

**→ [`MANUAL.md`](MANUAL.md)** — the user manual, for your customers' teams.
How the score is calculated, what each tab is for, and what to do when it looks
wrong. `tests/manual-test.js` checks every number in it against the code.

Everything else here is the detail that guide links to.

## The two things you deploy

| | |
|---|---|
| `dist/code.gs` | The backend. One file, pasted into Apps Script. |
| `netlify/` | The site. Netlify builds `dist/index.html` into it. |

## Where everything lives

| Path | What it is |
|---|---|
| `src/*.gs` | The backend in readable files. `dist/code.gs` is these joined. |
| `src/ui/` | The front end. `dist/index.html` is these compiled. |
| `domebox/domain.gs` | The rules engine: scoring, priority, recurrence, projects. Pure logic, no I/O. |
| `domebox/plans.gs` | The plan table and every cap it enforces. |
| `domebox/reminders.gs` | The scheduler. A second file to add beside `code.gs`. |
| `domebox/backup.gs`, `remediate-sharing.gs` | Operator tools. |
| `netlify/` | The deployable site: build, content, policy pages, headers, redirects. |
| `tests/` | 34 suites against the **real** `dist/code.gs`, not a mock. |
| `web/_build/` | Compiles `src/ui/*` into `dist/index.html`. |

## Documents

| | |
|---|---|
| [`SETUP.md`](SETUP.md) | **Start here.** Zero to live. |
| [`MANUAL.md`](MANUAL.md) | The user manual — for the people who use it, not deploy it |
| [`DEPLOY-NEW.md`](DEPLOY-NEW.md) | The backend in detail — webhook, scheduler, mail quota, invoicing |
| [`netlify/DEPLOY.md`](netlify/DEPLOY.md) | The site in detail |
| [`netlify/REQUIRED-BEFORE-DEPLOY.md`](netlify/REQUIRED-BEFORE-DEPLOY.md) | The eight legal fields, and why each is required |
| [`FEATURES.md`](FEATURES.md) | Everything the product does, and why the scoring works as it does |
| [`LAUNCH-AUDIT.md`](LAUNCH-AUDIT.md) | What the launch audit found and fixed |
| [`SECURITY-CRITICAL.md`](SECURITY-CRITICAL.md) | What must be true before you sell another seat |

## Building and testing

```bash
node web/_build/build-index.js     # src/ui/*  ->  dist/index.html

cd tests
node lint-codegs.js                # static checks on the assembled file
node api-test.js                   # and the rest — tests/README.md lists all 34
node server.js &                   # then the browser suites
node ui-test.js
```

`dist/code.gs` is assembled from `src/*.gs` plus `domebox/{auth,plans,domain}.gs`.
Edit the source file, not the built one, or the next rebuild loses the change.

## One thing about Apps Script

Every `.gs` file in a project shares **one global scope**, and the last
definition of a name wins — silently, at parse time, with nothing in any log.
This has caught this project three times. `tests/scope-test.js` now pins it:
`reminders.gs`, `backup.gs` and `remediate-sharing.gs` are safe to add beside
`code.gs`; **`domebox/payments-secure.gs` is not** — it is superseded and says
so at the top of the file.
