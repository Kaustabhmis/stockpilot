/**
 * Stamps the dates on the legal pages. Kept out of the markup so the
 * "last updated" line cannot silently drift out of date across four documents.
 * Set LAST_UPDATED when you actually revise the text.
 */
const LAST_UPDATED = '2026-08-13';

document.querySelectorAll('[data-updated]').forEach((el) => {
  el.textContent = new Date(LAST_UPDATED).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
});

document.querySelectorAll('[data-year]').forEach((el) => {
  el.textContent = new Date().getFullYear();
});
