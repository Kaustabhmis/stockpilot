/**
 * BISCS India's social profiles, in one place for the generated pages: the
 * guides and product pages (gen-seo.js) and the legal pages (gen-pages.js).
 * The home page (src/ui/00-home.html) and its structured data
 * (src/ui/01-head.html) carry the same three links; tests/seo-test.js checks
 * that they all agree.
 */
/* Domebox's own colours, not each network's: the cards sit on the navy of
   the hero, with the gold of its buttons for the icon tiles. */
const NAVY = 'linear-gradient(135deg,#0a1628 0%,#13294b 60%,#1c3d73 100%)';
const TILE = '#f5c542', INK = '#0f1b2d';

const SOCIALS = [
  { key: 'linkedin', name: 'LinkedIn', url: 'https://www.linkedin.com/in/biscs-india-7a0ab03a6',
    line: 'Product updates and launch news', bg: TILE },
  { key: 'facebook', name: 'Facebook', url: 'https://www.facebook.com/share/1PyhN1vLey/',
    line: 'News for MSME owners', bg: TILE },
  { key: 'instagram', name: 'Instagram', url: 'https://www.instagram.com/biscsindia/',
    line: 'Behind the scenes at BISCS India', bg: TILE },
];

/* Drawn from plain shapes, navy on gold, so nothing is loaded
   from another site and the page's Content-Security-Policy is unchanged. */
const ICONS = {
  linkedin: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="' + INK + '">' +
    '<circle cx="6.2" cy="6.4" r="1.9"/><rect x="4.5" y="9.4" width="3.4" height="10.1" rx=".4"/>' +
    '<path d="M10.2 9.4h3.2v1.5c.5-.9 1.7-1.8 3.4-1.8 2.9 0 3.7 1.9 3.7 4.6v5.8h-3.4v-5.1c0-1.3-.3-2.3-1.6-2.3s-1.9 1-1.9 2.4v5h-3.4z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="' + INK + '">' +
    '<path d="M13.6 21.5v-7.6h2.6l.4-3h-3v-1.9c0-.9.3-1.5 1.5-1.5h1.6V4.8c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8v3h2.6v7.6z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="' + INK + '" stroke-width="2">' +
    '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="3.9"/>' +
    '<circle cx="17.2" cy="6.8" r=".6" fill="' + INK + '" stroke="none"/></svg>',
};

/** The cards, for a page with its own stylesheet: put SOCIAL_CSS in it. */
function socialCards() {
  return '<div class="social"><p class="social-h">Follow BISCS India</p><div class="social-row">' +
    SOCIALS.map((s) => '<a class="social-card" href="' + s.url + '" target="_blank" rel="noopener me">' +
      '<span class="social-ic" style="background:' + s.bg + '">' + ICONS[s.key] + '</span>' +
      '<span class="social-tx"><strong>' + s.name + '</strong><span>' + s.line + '</span></span>' +
      '<span class="social-go" aria-hidden="true">&#8599;</span></a>').join('') +
    '</div></div>';
}

const SOCIAL_CSS =
  '.social{max-width:800px;margin:6px auto 22px;text-align:left;background:' + NAVY + ';border-radius:18px;padding:18px 18px 20px}' +
  '.social-h{font-size:11px!important;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:#f5c542!important;margin:0 0 12px!important}' +
  '.social-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}' +
  '.social-card{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid rgba(255,255,255,.14);border-radius:14px;' +
  'background:rgba(255,255,255,.06);text-decoration:none!important;margin:0!important;transition:border-color .15s,background .15s}' +
  '.social-card:hover{border-color:#f5c542;background:rgba(255,255,255,.1)}' +
  '.social-card:hover .social-go{color:#f5c542}' +
  '.social-ic{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;flex-shrink:0}' +
  '.social-tx{min-width:0;flex:1}' +
  '.social-tx strong{display:block;color:#fff;font-size:14px;font-weight:800}' +
  '.social-tx span{display:block;color:#c9d6ea;font-size:12.5px;font-weight:600;line-height:1.35}' +
  '.social-go{color:#8fa6c8;font-weight:900;font-size:16px}' +
  '@media(max-width:700px){.social-row{grid-template-columns:1fr}}';

module.exports = { SOCIALS, ICONS, NAVY, TILE, INK, socialCards, SOCIAL_CSS };
