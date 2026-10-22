/**
 * Composer: write the master text, adjust each platform's caption, attach an image,
 * pick accounts, then save a draft or publish now.
 * A caption follows the master text until it is edited by hand.
 */
import { api } from './api.js';
import { captionKey, h, initPage, platformLabel, toast, withBusy } from './ui.js';

initPage();

const MAX_SIDE = 1350; // longest edge in px; Instagram's tallest allowed ratio is 4:5
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const PLATFORM_NAME = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn' };
const $ = (id) => document.getElementById(id);

const els = {
  form: $('composer'),
  title: $('page-title'),
  notice: $('notice'),
  master: $('master-text'),
  masterCount: $('master-count'),
  mediaInput: $('media-input'),
  mediaStatus: $('media-status'),
  mediaBox: $('media-box'),
  mediaImg: $('media-img'),
  mediaRemove: $('media-remove'),
  tabs: $('caption-tabs'),
  caption: $('caption'),
  captionLabel: $('caption-label'),
  captionCount: $('caption-count'),
  accounts: $('accounts'),
  accountsEmpty: $('accounts-empty'),
  preview: $('preview'),
  save: $('save-btn'),
  publish: $('publish-btn'),
  results: $('results'),
  resultList: $('result-list'),
};

const state = {
  postId: new URLSearchParams(location.search).get('id'),
  master: '',
  mediaUrl: '',
  activeTab: 'facebook',
  captions: { facebook: '', instagram: '', linkedin: '' },
  edited: { facebook: false, instagram: false, linkedin: false },
  accounts: [], // connected accounts only
  selected: new Set(), // account ids
  limits: { facebook: 63206, instagram: 2200, linkedin: 3000 },
};

async function init() {
  try {
    const [features, accounts] = await Promise.all([api('/api/features'), api('/api/data/Accounts?active=TRUE')]);
    state.limits = features.charLimits;
    state.accounts = accounts;
    if (state.postId) await loadPost(state.postId);
  } catch (err) {
    toast(err.message, 'error');
  }
  buildTabs();
  renderAccounts();
  selectTab(state.activeTab);
  renderMedia();
  bind();
}

/**
 * Fills the form from a saved post and its targets.
 * @param {string} id
 */
async function loadPost(id) {
  const [post, targets] = await Promise.all([
    api(`/api/data/Posts/${encodeURIComponent(id)}`),
    api(`/api/data/Targets?post_id=${encodeURIComponent(id)}`),
  ]);
  state.master = post.master_text || '';
  els.master.value = state.master;
  state.mediaUrl = (post.media_urls || [])[0] || '';
  els.title.textContent = 'Edit post';

  for (const target of targets) {
    const account = state.accounts.find((a) => a.id === target.account_id);
    if (!account) continue;
    const key = captionKey(account.platform);
    state.selected.add(account.id);
    state.captions[key] = target.caption || '';
    state.edited[key] = (target.caption || '') !== state.master;
  }
  for (const key of Object.keys(state.captions)) {
    if (!state.edited[key]) state.captions[key] = state.master;
  }
  if (post.status === 'published') {
    lockForm('This post is already published, so it cannot be edited. Create a new post to share something else.');
  }
}

function buildTabs() {
  els.tabs.replaceChildren(
    ...Object.entries(PLATFORM_NAME).map(([key, label]) => h('button', {
      type: 'button',
      role: 'tab',
      class: 'tab',
      id: `tab-${key}`,
      'aria-controls': 'caption-panel',
      'aria-selected': 'false',
      dataset: { tab: key },
      onclick: () => selectTab(key),
    }, label)),
  );
}

/** @param {string} key facebook | instagram | linkedin */
function selectTab(key) {
  state.activeTab = key;
  for (const button of els.tabs.querySelectorAll('[role="tab"]')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === key));
  }
  els.captionLabel.textContent = `${PLATFORM_NAME[key]} caption`;
  els.caption.value = state.captions[key];
  updateCounts();
  renderPreview();
}

function renderAccounts() {
  els.accountsEmpty.hidden = state.accounts.length > 0;
  els.accounts.replaceChildren(
    ...state.accounts.map((account) => {
      const id = `account-${account.id}`;
      return h('label', { for: id, class: 'check-row' },
        h('input', {
          type: 'checkbox',
          id,
          checked: state.selected.has(account.id),
          dataset: { accountId: account.id },
          onchange: (event) => toggleAccount(account.id, event.target.checked),
        }),
        h('span', null,
          account.name || platformLabel(account.platform),
          h('small', null, platformLabel(account.platform)),
        ),
      );
    }),
  );
}

/**
 * @param {string} accountId
 * @param {boolean} on
 */
function toggleAccount(accountId, on) {
  if (on) state.selected.add(accountId);
  else state.selected.delete(accountId);
  renderPreview();
}

function renderMedia() {
  const hasImage = Boolean(state.mediaUrl);
  els.mediaBox.hidden = !hasImage;
  if (hasImage) els.mediaImg.src = state.mediaUrl;
  els.mediaStatus.textContent = hasImage ? '' : 'Optional. Instagram posts need an image.';
}

/** @param {File} file */
async function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    toast('Choose an image file.', 'error');
    return;
  }
  els.mediaInput.disabled = true;
  try {
    els.mediaStatus.textContent = 'Preparing image…';
    const blob = await toJpeg(file);
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error('The image is still over 5 MB after resizing. Try a smaller photo.');
    els.mediaStatus.textContent = 'Uploading…';
    const { url } = await api('/api/upload-media', {
      method: 'POST',
      body: blob,
      headers: { 'Content-Type': 'image/jpeg' },
    });
    state.mediaUrl = url;
    renderMedia();
    renderPreview();
    els.mediaStatus.textContent = 'Image ready.';
  } catch (err) {
    els.mediaInput.value = '';
    els.mediaStatus.textContent = '';
    toast(err.message, 'error');
  } finally {
    els.mediaInput.disabled = false;
  }
}

/**
 * Converts any browser-readable image to a JPEG, resized so its longest side is at most MAX_SIDE.
 * Transparent areas are filled white.
 * @param {File} file
 * @returns {Promise<Blob>}
 */
async function toJpeg(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not convert the image'))), 'image/jpeg', 0.9);
  });
}

function removeImage() {
  state.mediaUrl = '';
  els.mediaInput.value = '';
  renderMedia();
  renderPreview();
}

function updateCounts() {
  els.masterCount.textContent = `${state.master.length.toLocaleString()} characters`;
  const text = state.captions[state.activeTab] || '';
  const limit = state.limits[state.activeTab];
  els.captionCount.textContent = `${text.length.toLocaleString()} / ${limit.toLocaleString()}`;
  els.captionCount.classList.toggle('is-over', text.length > limit);
}

function renderPreview() {
  const key = state.activeTab;
  const text = state.captions[key] || state.master;
  const names = state.accounts
    .filter((a) => state.selected.has(a.id) && captionKey(a.platform) === key)
    .map((a) => a.name);
  els.preview.replaceChildren(
    h('div', { class: 'preview__head' },
      h('span', { class: 'preview__avatar', 'aria-hidden': 'true' }),
      h('div', null,
        h('strong', null, names[0] || `Your ${PLATFORM_NAME[key]} page`),
        h('div', { class: 'preview__meta' }, `${PLATFORM_NAME[key]} · preview`),
      ),
    ),
    h('p', { class: 'preview__text' }, text || 'Your caption appears here.'),
    state.mediaUrl ? h('img', { src: state.mediaUrl, alt: 'Attached image' }) : null,
  );
}

/** Builds the save-post body from the form. */
function collectPayload() {
  const master = state.master.trim();
  const targets = state.accounts
    .filter((a) => state.selected.has(a.id))
    .map((a) => ({ account_id: a.id, caption: state.captions[captionKey(a.platform)] || master }));
  return {
    post_id: state.postId || undefined,
    master_text: master,
    media_type: state.mediaUrl ? 'image' : 'none',
    media_urls: state.mediaUrl ? [state.mediaUrl] : [],
    targets,
  };
}

/**
 * Explains the first problem with the payload, or returns '' when it is fine.
 * @param {ReturnType<typeof collectPayload>} payload
 * @param {boolean} publish
 */
function validate(payload, publish) {
  if (!payload.targets.length) return 'Choose at least one account.';
  if (!payload.master_text && payload.targets.every((t) => !t.caption)) return 'Write some text first.';
  for (const target of payload.targets) {
    const account = state.accounts.find((a) => a.id === target.account_id);
    const key = captionKey(account.platform);
    const limit = state.limits[key];
    if (target.caption.length > limit) {
      return `The ${PLATFORM_NAME[key]} caption is ${target.caption.length.toLocaleString()} characters. The limit is ${limit.toLocaleString()}.`;
    }
  }
  const wantsInstagram = payload.targets.some((t) => state.accounts.find((a) => a.id === t.account_id).platform === 'instagram');
  if (publish && wantsInstagram && !payload.media_urls.length) {
    return 'Instagram needs an image. Add one, or untick the Instagram account.';
  }
  return '';
}

/**
 * Saves the post; when `publish` is true, then publishes it to every selected account.
 * @param {boolean} publish
 */
async function save(publish) {
  const payload = collectPayload();
  const problem = validate(payload, publish);
  if (problem) {
    toast(problem, 'error');
    return;
  }
  const button = publish ? els.publish : els.save;
  const result = await withBusy(button, publish ? 'Publishing…' : 'Saving…', async () => {
    const saved = await api('/api/save-post', { method: 'POST', body: payload });
    state.postId = saved.post.id;
    history.replaceState(null, '', `compose.html?id=${encodeURIComponent(state.postId)}`);
    els.title.textContent = 'Edit post';
    if (!publish) {
      toast('Draft saved.', 'success');
      return null;
    }
    return api('/api/publish-now', { method: 'POST', body: { post_id: state.postId } });
  });
  if (!result) return;

  showResults(result.results);
  const failed = result.results.filter((r) => !r.ok && !r.pending).length;
  if (failed) toast(`${failed} account(s) failed. Fix the error and publish again.`, 'error');
  else toast('Published.', 'success');
  if (result.post_status === 'published') {
    lockForm('Published. This post can no longer be edited.');
  }
}

/** @param {{ platform: string, account_name: string, ok: boolean, pending: boolean, permalink: string, error: string }[]} results */
function showResults(results) {
  els.results.hidden = false;
  els.resultList.replaceChildren(
    ...results.map((r) => {
      let line;
      if (r.ok && safeLink(r.permalink)) {
        line = h('a', { href: safeLink(r.permalink), target: '_blank', rel: 'noopener noreferrer' }, 'Published. View post');
      } else if (r.ok) {
        line = 'Published';
      } else if (r.pending) {
        line = 'Still processing on Instagram. It will be finished by the scheduler.';
      } else {
        line = h('span', { class: 'error-text' }, r.error || 'Publishing failed');
      }
      return h('li', null,
        h('strong', null, `${r.account_name} · ${platformLabel(r.platform)}`),
        h('span', null, line),
      );
    }),
  );
}

/** @param {string} url only https links are shown as clickable */
function safeLink(url) {
  return url && url.startsWith('https://') ? url : '';
}

/**
 * Makes the form read-only (used after publishing or for published posts).
 * @param {string} message
 */
function lockForm(message) {
  els.notice.hidden = false;
  els.notice.textContent = message;
  for (const control of els.form.querySelectorAll('input, textarea, button')) control.disabled = true;
}

/** Wires every control on the page. */
function bind() {
  els.master.addEventListener('input', () => {
    state.master = els.master.value;
    for (const key of Object.keys(state.captions)) {
      if (!state.edited[key]) state.captions[key] = state.master;
    }
    els.caption.value = state.captions[state.activeTab];
    updateCounts();
    renderPreview();
  });
  els.caption.addEventListener('input', () => {
    state.captions[state.activeTab] = els.caption.value;
    state.edited[state.activeTab] = true;
    updateCounts();
    renderPreview();
  });
  els.mediaInput.addEventListener('change', () => {
    if (els.mediaInput.files[0]) handleFile(els.mediaInput.files[0]);
  });
  els.mediaRemove.addEventListener('click', removeImage);
  els.save.addEventListener('click', () => save(false));
  els.publish.addEventListener('click', () => save(true));
  els.form.addEventListener('submit', (event) => event.preventDefault());
}

init();
