/** Tailwind theme for Ashirbad Enterprise ("Heritage" look). Run `npm run css` after changing classes in HTML/JS. */
module.exports = {
  content: ['./*.html', './assets/js/*.js', './tools/*.mjs'],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: '#12304d',
          ink: '#0b1c2c',      // deepest navy – footer, carousel stage
          orange: '#8a6420',   // bronze-gold for text & buttons on light backgrounds (WCAG AA)
          flame: '#c9973f',    // gold – decorative lines, borders, focus rings
          gold: '#e6a845',     // bright gold – text & buttons on navy
          cream: '#f7f3ea',    // page background
          sand: '#e4dccb'      // hairlines on cream
        }
      },
      fontFamily: {
        sans: ['Manrope', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
        display: ['"Cormorant Garamond"', 'Georgia', 'serif']
      }
    }
  }
};
