/**
 * Dashboard: the most recent posts with their status and per-account results.
 */
import { api } from './api.js';
import { badge, formatDate, h, initPage, platformLabel, toast } from './ui.js';

initPage();

const list = document.getElementById('post-list');
const empty = document.getElementById('post-empty');

/**
 * Loads posts, targets and accounts in parallel and renders the list.
 */
async function load() {
  list.replaceChildren(h('li', { class: 'hint' }, 'Loading posts…'));
  try {
    const [posts, targets, accounts] = await Promise.all([
      api('/api/data/Posts'),
      api('/api/data/Targets'),
      api('/api/data/Accounts'),
    ]);
    render(posts, targets, accounts);
  } catch (err) {
    list.replaceChildren();
    toast(err.message, 'error');
  }
}

/**
 * @param {any[]} posts
 * @param {any[]} targets
 * @param {any[]} accounts
 */
function render(posts, targets, accounts) {
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const platformOf = new Map(accounts.map((a) => [a.id, a.platform]));
  const targetsByPost = new Map();
  for (const target of targets) {
    if (!targetsByPost.has(target.post_id)) targetsByPost.set(target.post_id, []);
    targetsByPost.get(target.post_id).push(target);
  }

  const sorted = [...posts].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  empty.hidden = sorted.length > 0;
  list.replaceChildren(...sorted.map((post) => postCard(post, targetsByPost.get(post.id) || [], accountName, platformOf)));
}

/**
 * @param {any} post
 * @param {any[]} postTargets
 * @param {Map<string, string>} accountName
 * @param {Map<string, string>} platformOf
 */
function postCard(post, postTargets, accountName, platformOf) {
  const text = post.master_text || '(no text)';
  const failures = postTargets.filter((t) => t.status === 'failed');
  const nameOf = (t) => accountName.get(t.account_id) || platformLabel(platformOf.get(t.account_id) || '');

  return h('li', null,
    h('a', { class: 'post-card', href: `compose.html?id=${encodeURIComponent(post.id)}` },
      h('div', { class: 'post-card__head' },
        badge(post.status),
        h('time', { datetime: post.updated_at || '' }, formatDate(post.updated_at)),
      ),
      h('p', { class: 'post-card__text' }, text.length > 220 ? `${text.slice(0, 220)}…` : text),
      postTargets.length
        ? h('ul', { class: 'chips', 'aria-label': 'Accounts' },
          postTargets.map((t) => h('li', { class: `chip chip--${t.status || 'draft'}` },
            `${nameOf(t)}: ${(t.status || 'draft').replace(/_/g, ' ')}`)))
        : null,
      failures.map((t) => h('p', { class: 'error-text' }, `${nameOf(t)}: ${t.error || 'Publishing failed'}`)),
    ),
  );
}

load();
