/** Tailwind theme for Ashirbad Enterprise. Run `npm run css` after changing classes in HTML/JS. */
module.exports = {
  content: ['./*.html', './assets/js/*.js'],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: '#12304d',
          orange: '#b84f17',   // accessible orange for text & buttons (WCAG AA on white)
          flame: '#e66825',    // original brand orange – decorative lines, borders, focus rings
          gold: '#e6a845',
          cream: '#fdf8ee'
        }
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif']
      }
    }
  }
};
