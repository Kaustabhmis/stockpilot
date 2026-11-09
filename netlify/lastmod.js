/**
 * The date a page's content last really changed, for the sitemap's <lastmod>:
 * the last commit that touched the files the page is built from. A page with
 * changes not yet committed, or a build outside git, gets today. Search
 * engines — Bing especially — trust a lastmod only when it moves with the
 * content; one that is "today" on every page every build is ignored.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');
const today = () => new Date().toISOString().slice(0, 10);

/* What each kind of page is made from. */
const SOURCES = {
  home: ['src/ui'],
  content: ['netlify/seo-content.js', 'netlify/gen-seo.js', 'netlify/socials.js'],
  legal: ['netlify/gen-pages.js', 'netlify/site-config.json', 'netlify/socials.js'],
};
const LEGAL_SLUGS = ['privacy', 'terms', 'refund', 'contact'];

function lastChanged(paths) {
  try {
    const git = (args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (git(['status', '--porcelain', '--', ...paths])) return today();
    return git(['log', '-1', '--format=%cs', '--', ...paths]) || today();
  } catch (e) { return today(); }
}

/** lastmod for a page slug: '' (the home page), 'pricing', 'privacy', … */
function lastmodFor(slug) {
  const kind = !slug ? 'home' : LEGAL_SLUGS.indexOf(slug) > -1 ? 'legal' : 'content';
  return lastChanged(SOURCES[kind]);
}

module.exports = { lastmodFor, lastChanged };
