/**
 * Shared UI helpers: safe DOM building, toasts, busy buttons, navigation and dates.
 * Data from the server is always inserted with textContent or as DOM nodes, never innerHTML.
 */
import { api } from './api.js';

export const STATUSES = [
  'draft', 'pending_approval', 'approved', 'rendering', 'published', 'failed', 'rejected', 'active', 'disconnected',
];

/**
 * Creates an element. Strings become text nodes, so they are escaped by the browser.
 * @param {string} tag
 * @param {Record<string, any>} [props] class, dataset, on<event> handlers, value/checked/disabled, others as attributes
 * @param {...(Node | string | number | false | null | undefined | Array<any>)} children
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'value' || key === 'checked' || key === 'disabled') node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * Status pill. Unknown statuses fall back to "draft" so a bad value cannot inject a class name.
 * @param {string} status
 */
export function badge(status) {
  const safe = STATUSES.includes(status) ? status : 'draft';
  return h('span', { class: `badge badge--${safe}` }, safe.replace(/_/g, ' '));
}

/**
 * Shows a short message. Errors stay longer and can be dismissed by tapping them.
 * @param {string} message
 * @param {'info' | 'success' | 'error'} [kind]
 */
export function toast(message, kind = 'info') {
  const stack = document.getElementById('toasts');
  if (!stack) return;
  const node = h('div', { class: `toast toast--${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  node.addEventListener('click', () => node.remove());
  stack.append(node);
  setTimeout(() => node.remove(), kind === 'error' ? 8000 : 4000);
}

/**
 * Runs an async action with its button disabled and labelled. Errors become toasts.
 * @template T
 * @param {HTMLButtonElement} button
 * @param {string} busyText shown while the task runs
 * @param {() => Promise<T>} task
 * @returns {Promise<T | undefined>} the task result, or undefined if it failed
 */
export async function withBusy(button, busyText, task) {
  const label = button.textContent;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  if (busyText) button.textContent = busyText;
  try {
    return await task();
  } catch (err) {
    toast(err.message || 'Something went wrong. Please try again.', 'error');
    return undefined;
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = label;
  }
}

/** Marks the current page in the navigation and wires the logout button. */
export function initPage() {
  const current = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav a').forEach((link) => {
    if (link.getAttribute('href') === current) link.setAttribute('aria-current', 'page');
  });
  document.getElementById('logout')?.addEventListener('click', logout);
}

async function logout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } finally {
    location.href = 'login.html';
  }
}

/**
 * @param {string | undefined} iso
 * @returns {string} a readable local date and time, or an em dash
 */
export function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Human label for an account platform.
 * @param {string} platform
 */
export function platformLabel(platform) {
  return {
    facebook: 'Facebook Page',
    instagram: 'Instagram',
    linkedin_person: 'LinkedIn profile',
    linkedin_org: 'LinkedIn Page',
  }[platform] || platform;
}

/**
 * Which caption tab an account uses.
 * @param {string} platform
 * @returns {'facebook' | 'instagram' | 'linkedin'}
 */
export function captionKey(platform) {
  if (platform.startsWith('linkedin')) return 'linkedin';
  return platform === 'instagram' ? 'instagram' : 'facebook';
}
