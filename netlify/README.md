# netlify/ — the deployable site

Deployed by Netlify with **base `netlify`, command `node build.js`, publish
`netlify`**, and `API_URL` set in the environment. See `DEPLOY.md`.

| File | What it is |
|---|---|
| `build.js` | **The build.** Everything below, in order, with no dependencies. |
| `site-config.json` | **Fill this in.** Eight blank fields; the build fails until they are filled. |
| `REQUIRED-BEFORE-DEPLOY.md` | What each of those fields is, and why it is required. |
| `DEPLOY.md` | Step by step, including what to check before pointing the domain. |
| `AUDIT.md` | The original 28 findings. |
| `SEO.md` | How the content pages and the sitemap are generated. |
| `seo-content.js` | The content of the 8 marketing pages — edit here, not in the HTML. |
| `gen-seo.js` | Renders those pages. Safe to `require`: it only writes when run. |
| `gen-pages.js` | Renders the 4 policy pages + a branded 404 from `site-config.json`. |
| `netlify.toml` / `_headers` | Security headers and caching. The CSP is in **both**, byte-identical. |
| `_redirects` | Clean URLs, and 301s for the variants people actually type. |
| `robots.txt` / `sitemap.xml` | Generated. The sitemap lists only pages that exist. |
| `og-cover.png` | 1200×630 social preview. |
| `favicon.svg` | The dome mark as a real file. |
| `prepare.js` | **Superseded.** Refuses to run — see below. |

Every `.html` file here is **generated and git-ignored**, including
`index.html`. They are built from the real source and the real config on each
deploy, so a copy carrying someone else's placeholder GSTIN can never be
committed.

## Checking it

```bash
node tests/netlify-test.js     # 71 checks, from the repository root
```

It runs the real build into a throwaway copy and asserts the things that are
invisible in review and obvious in production: a sitemap listing pages nobody
built, a redirect pointing at a file that is never generated, a CSP that lives
in one config file and not the other, an `index.html` shipped with the
placeholder API URL in it.

## prepare.js is superseded

It patched an `index.html` produced by a build that no longer exists — the
fixes it applied now live in `src/ui/01-head.html` and are compiled in by
`web/_build/build-index.js`. It also wrote to `index.html`, the same file
`build.js` now owns. It refuses to run rather than silently producing a broken
page; the code is kept only as a record of what the audit changed.
