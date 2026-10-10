/**
 * Tailwind config for the single-file app.
 *
 * Scans dist/index.html, which holds the markup AND every class string the
 * inline script builds, so dynamically composed classes are picked up too.
 *
 * The brand is applied by REDEFINING the ramps the app already uses rather than
 * by rewriting hundreds of class strings. `blue-600` still means "the action
 * colour" everywhere it appears; it is now Dome Box violet. `slate` carries the
 * dark sections and `gray` the neutrals, both warmed so the whole surface reads
 * like paper rather than like a spreadsheet.
 */
module.exports = {
  content: [require('path').join(__dirname, '..', '..', 'dist', 'index.html')],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        /* Action — a violet with some life in it. 600 is the one that matters;
           it is the validated categorical slot 1 and clears 4.5:1 on white. */
        blue: {
          50:'#f1eefe', 100:'#e4e0fc', 200:'#cdc5f8', 300:'#b3a7f2',
          400:'#8a79ea', 500:'#6f5ce2', 600:'#5b4bdb', 700:'#4a3bc4',
          800:'#3f2fa6', 900:'#2f2379', 950:'#1d1551',
        },
        /* The dark sections: plum-black, not navy. */
        slate: {
          50:'#f8f6f4', 100:'#f1ede9', 200:'#e3dcd5', 300:'#cdc3ba',
          400:'#a79c96', 500:'#857a80', 600:'#6a6072', 700:'#4e4559',
          800:'#2f2940', 900:'#1b1726', 950:'#120f1a',
        },
        /* Neutrals warmed a few degrees — paper, not printer paper. */
        gray: {
          50:'#faf8f5', 100:'#f3efe9', 200:'#e7e1d8', 300:'#d6cec3',
          400:'#a79f95', 500:'#7d7570', 600:'#5a5258', 700:'#453f4c',
          800:'#2e2937', 900:'#1b1726', 950:'#120f1a',
        },
        /* Secondary accent — the warm one. Used for recognition, highlights and
           anything meant to feel like a good day rather than a status. */
        coral: {
          50:'#fdf1ec', 100:'#fbe2d8', 200:'#f6c3ae', 300:'#ef9c7c',
          400:'#e8724b', 500:'#e0501f', 600:'#c7431a', 700:'#a33616',
          800:'#7d2a12', 900:'#5a1e0d',
        },
      },
      borderRadius: { xl:'0.9rem', '2xl':'1.15rem', '3xl':'1.6rem' },
      boxShadow: {
        lift: '0 10px 24px -8px rgba(27,23,38,.18), 0 2px 6px -2px rgba(27,23,38,.08)',
      },
    },
  },
};
