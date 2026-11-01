/**
 * BISCS India's social profiles, in one place for the generated pages: the
 * guides and product pages (gen-seo.js) and the legal pages (gen-pages.js).
 * The home page (src/ui/00-home.html) and its structured data
 * (src/ui/01-head.html) carry the same three links; tests/seo-test.js checks
 * that they all agree.
 */
const SOCIALS = [
  { key: 'linkedin', name: 'LinkedIn', url: 'https://www.linkedin.com/in/biscs-india-7a0ab03a6',
    line: 'Product updates and launch news', bg: '#0A66C2' },
  { key: 'facebook', name: 'Facebook', url: 'https://www.facebook.com/share/1PyhN1vLey/',
    line: 'News for MSME owners', bg: '#1877F2' },
  { key: 'instagram', name: 'Instagram', url: 'https://www.instagram.com/biscsindia/',
    line: 'Behind the scenes at BISCS India',
    bg: 'linear-gradient(45deg,#f9a825 0%,#e1306c 50%,#833ab4 100%)' },
];

/* Drawn from plain shapes, white on the brand colour, so nothing is loaded
   from another site and the page's Content-Security-Policy is unchanged. */
const ICONS = {
  linkedin: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="#fff">' +
    '<circle cx="6.2" cy="6.4" r="1.9"/><rect x="4.5" y="9.4" width="3.4" height="10.1" rx=".4"/>' +
    '<path d="M10.2 9.4h3.2v1.5c.5-.9 1.7-1.8 3.4-1.8 2.9 0 3.7 1.9 3.7 4.6v5.8h-3.4v-5.1c0-1.3-.3-2.3-1.6-2.3s-1.9 1-1.9 2.4v5h-3.4z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="#fff">' +
    '<path d="M13.6 21.5v-7.6h2.6l.4-3h-3v-1.9c0-.9.3-1.5 1.5-1.5h1.6V4.8c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8v3h2.6v7.6z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="#fff" stroke-width="2">' +
    '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="3.9"/>' +
    '<circle cx="17.2" cy="6.8" r=".6" fill="#fff" stroke="none"/></svg>',
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
  '.social{max-width:800px;margin:6px auto 18px;text-align:left}' +
  '.social-h{font-size:12px!important;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#667085!important;margin:0 0 10px!important}' +
  '.social-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}' +
  '.social-card{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid #e2e7ef;border-radius:14px;' +
  'background:#fff;text-decoration:none!important;margin:0!important;transition:border-color .15s,box-shadow .15s}' +
  '.social-card:hover{border-color:#a9c1ec;box-shadow:0 6px 18px rgba(16,24,40,.08)}' +
  '.social-ic{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;flex-shrink:0}' +
  '.social-tx{min-width:0;flex:1}' +
  '.social-tx strong{display:block;color:#0f1b2d;font-size:14px;font-weight:800}' +
  '.social-tx span{display:block;color:#667085;font-size:12.5px;font-weight:600;line-height:1.35}' +
  '.social-go{color:#98a2b3;font-weight:900;font-size:16px}' +
  '@media(max-width:700px){.social-row{grid-template-columns:1fr}}';

module.exports = { SOCIALS, ICONS, socialCards, SOCIAL_CSS };
