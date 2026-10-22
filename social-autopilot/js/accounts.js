/**
 * Accounts page: lists connected accounts, starts OAuth connect/reconnect, and disconnects.
 */
import { api } from './api.js';
import { badge, formatDate, h, initPage, platformLabel, toast, withBusy } from './ui.js';

initPage();

const params = new URLSearchParams(location.search);
const LISTS = {
  facebook: 'meta-list',
  instagram: 'meta-list',
  linkedin_person: 'linkedin-list',
  linkedin_org: 'org-list',
};
const CONNECT = {
  facebook: 'api/auth-meta/start',
  instagram: 'api/auth-meta/start',
  linkedin_person: 'api/auth-linkedin/start',
  linkedin_org: 'api/auth-linkedin/start',
};

/** Shows the result of an OAuth round trip once, then cleans the URL. */
function showCallbackMessages() {
  if (params.get('message')) toast(params.get('message'), 'success');
  if (params.get('error')) toast(params.get('error'), 'error');
  if (params.has('message') || params.has('error') || params.has('connected')) {
    history.replaceState(null, '', 'accounts.html');
  }
}

async function load() {
  try {
    const [accounts, features] = await Promise.all([api('/api/data/Accounts'), api('/api/features')]);
    document.getElementById('accounts-loading').hidden = true;
    document.getElementById('org-section').hidden = !features.linkedinOrg;
    for (const [platform, listId] of Object.entries(LISTS)) {
      const items = accounts.filter((a) => a.platform === platform);
      const list = document.getElementById(listId);
      list.replaceChildren(...(items.length ? items.map(accountRow) : [emptyRow()]));
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

/** Placeholder shown in a section that has no accounts yet. */
function emptyRow() {
  return h('li', { class: 'hint' }, 'Nothing connected yet.');
}

/**
 * One account: name, status, token expiry and actions.
 * @param {any} account
 */
function accountRow(account) {
  const status = account.active ? 'active' : 'disconnected';
  const expiry = account.expires_at
    ? `Token expires ${formatDate(account.expires_at)}`
    : 'Page token, no expiry';
  const button = h('button', { type: 'button', class: 'btn btn-ghost btn-danger' }, 'Disconnect');
  button.addEventListener('click', () => disconnect(account, button));

  return h('li', { class: 'account-row' },
    h('div', { class: 'account-row__head' },
      h('strong', null, account.name || platformLabel(account.platform)),
      badge(status),
    ),
    h('p', { class: 'hint' }, `${platformLabel(account.platform)} · ${expiry}`),
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn', href: CONNECT[account.platform] }, account.active ? 'Reconnect' : 'Connect'),
      account.active ? button : null,
    ),
  );
}

/**
 * Disconnects an account: its token is erased, so it stops publishing until reconnected.
 * @param {any} account
 * @param {HTMLButtonElement} button
 */
async function disconnect(account, button) {
  if (!confirm(`Disconnect ${account.name}? Posts will stop going to it until you reconnect.`)) return;
  const done = await withBusy(button, 'Disconnecting…', () =>
    api(`/api/data/Accounts/${encodeURIComponent(account.id)}`, { method: 'PUT', body: { active: false } }));
  if (done) {
    toast('Disconnected.', 'success');
    await load();
  }
}

showCallbackMessages();
load();
