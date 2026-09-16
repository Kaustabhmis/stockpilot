# netlify/ — the deployable site

| File | What it is |
|---|---|
| `AUDIT.md` | 28 findings. Read this first. |
| `DEPLOY.md` | Step-by-step Netlify deployment. |
| `REQUIRED-BEFORE-DEPLOY.md` | The company details you must supply, and why. |
| `site-config.json` | **Fill this in.** Drives the policy pages. |
| `prepare.js` | Patches your `index.html` with the audit fixes. Idempotent. |
| `gen-pages.js` | Builds the policy pages. Refuses to run on blank config. |
| `netlify.toml` / `_headers` | Security headers and caching. |
| `_redirects` | Clean URLs for the policy pages. |
| `robots.txt` / `sitemap.xml` | Search. Does not block ad landing URLs. |
| `og-cover.png` | 1200×630 social preview. |
| `favicon.svg` | Your existing dome mark, as a real file. |
| `tailwind.min.css` | Compiled stylesheet, 9.4 KB. |

`index.html` and the policy pages are **generated** and git-ignored. They are
built from your real source and your real config, so they never live in version
control with someone else's placeholder details baked in.

## Quick start

```bash
# 1. fill in site-config.json
node gen-pages.js
node prepare.js /path/to/your/index.html
python3 -m http.server 8080      # check it
# 2. drag this folder to https://app.netlify.com/drop
```
