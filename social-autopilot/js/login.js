/**
 * Login form: posts the password, then returns to the page the user came from.
 */
import { api } from './api.js';
import { withBusy } from './ui.js';

const form = document.getElementById('login-form');
const submit = document.getElementById('login-submit');
const params = new URLSearchParams(location.search);

/**
 * Only same-site paths are allowed as the redirect target.
 * @param {string | null} next
 */
function safeNext(next) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : 'index.html';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = form.elements.password.value;
  if (!password) {
    document.getElementById('login-error').textContent = 'Enter the dashboard password.';
    form.elements.password.focus();
    return;
  }
  document.getElementById('login-error').textContent = '';
  await withBusy(submit, 'Signing in…', async () => {
    await api('/api/login', { method: 'POST', body: { password } });
    location.href = safeNext(params.get('next'));
  });
});
