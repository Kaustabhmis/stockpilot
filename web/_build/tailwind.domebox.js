/**
 * Tailwind config for the single-file app.
 *
 * Scans dist/index.html, which holds the markup AND every class string the
 * inline script builds, so dynamically composed classes are picked up too.
 *
 * The brand is applied by REDEFINING the ramps the app already uses rather than
 * by rewriting hundreds of class strings. `blue-600` still means "the action
 * colour" everywhere it appears; it is Dome Box corporate blue. `slate` carries
 * the navy sections, `gray` the cool neutrals, and `coral` (kept as a name) is
 * the teal accent. Brand palette: navy #13294b, blue #1e4fbf, teal #0f8f84,
 * gold #d4930f (decoration only — never text on white).
 */
module.exports = {
  content: [require('path').join(__dirname, '..', '..', 'dist', 'index.html')],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        /* Action — corporate blue. 600 is the one that matters: buttons, links,
           the active tab. It is categorical slot 1 and clears 7:1 on white. */
        blue: {
          50:'#eef3fb', 100:'#dbe6f7', 200:'#bccfee', 300:'#8fb0e0',
          400:'#5b87cc', 500:'#3466c8', 600:'#1e4fbf', 700:'#183f99',
          800:'#17366f', 900:'#13294b', 950:'#0c1a30',
        },
        /* The dark sections: navy. */
        slate: {
          50:'#f6f8fb', 100:'#eef2f7', 200:'#dde4ee', 300:'#c3cddc',
          400:'#94a3b8', 500:'#64748b', 600:'#475569', 700:'#334155',
          800:'#1c2f4f', 900:'#13294b', 950:'#0c1a30',
        },
        /* Neutrals — cool greys, the standard business surface. */
        gray: {
          50:'#f6f8fb', 100:'#eef1f6', 200:'#e2e7ef', 300:'#cdd5e1',
          400:'#8a94a6', 500:'#667085', 600:'#475467', 700:'#344054',
          800:'#1d2939', 900:'#0f1b2d', 950:'#0a1220',
        },
        /* Secondary accent — teal. Recognition, highlights, the good news. The
           ramp keeps its old name so no class string has to change. */
        coral: {
          50:'#effaf8', 100:'#d5f2ee', 200:'#ade4dc', 300:'#7dcfc5',
          400:'#3fb3a7', 500:'#0f8f84', 600:'#0c7a71', 700:'#0b625b',
          800:'#0a4f4a', 900:'#083f3b',
        },
      },
      borderRadius: { xl:'0.9rem', '2xl':'1.15rem', '3xl':'1.6rem' },
      boxShadow: {
        lift: '0 10px 24px -8px rgba(15,27,45,.16), 0 2px 6px -2px rgba(15,27,45,.08)',
      },
    },
  },
};
