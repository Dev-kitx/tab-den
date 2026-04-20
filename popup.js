'use strict';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const getDomain = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

let toastTimer;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ` toast-${type}` : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2000);
}

document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { collections = [], theme = 'dark' } = await chrome.storage.local.get(['collections', 'theme']);
  document.documentElement.setAttribute('data-theme', theme);

  // Show current tab info
  if (tab) {
    const favEl = document.getElementById('ct-fav');
    if (tab.favIconUrl) {
      const img = document.createElement('img');
      img.src = tab.favIconUrl;
      img.onerror = () => { favEl.textContent = (tab.title || '?')[0]; };
      favEl.appendChild(img);
    } else {
      favEl.textContent = (tab.title || '?')[0].toUpperCase();
    }
    document.getElementById('ct-title').textContent = tab.title || tab.url;
    document.getElementById('ct-url').textContent = getDomain(tab.url);
  }

  // Populate collection select
  const sel = document.getElementById('col-select');
  if (collections.length === 0) {
    sel.innerHTML = '<option value="__new">+ New Collection</option>';
  } else {
    sel.innerHTML = collections.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }

  // Open link
  document.getElementById('open-link').addEventListener('click', e => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
    window.close();
  });

  // Save button
  document.getElementById('save-btn').addEventListener('click', async () => {
    if (!tab) return;
    const { collections: cols = [] } = await chrome.storage.local.get(['collections']);
    let colId = sel.value;

    if (colId === '__new' || cols.length === 0) {
      const col = { id: uid(), name: 'General', color: '#6366f1', createdAt: Date.now(), tabs: [] };
      cols.push(col);
      colId = col.id;
    }

    const col = cols.find(c => c.id === colId);
    if (!col) return;
    if (col.tabs.some(t => t.url === tab.url)) { showToast('Already saved!'); return; }

    col.tabs.push({ id: uid(), title: tab.title || tab.url, url: tab.url, favIconUrl: tab.favIconUrl || null, savedAt: Date.now() });
    await chrome.storage.local.set({ collections: cols });
    showToast(`Saved to "${col.name}"`, 'success');
    setTimeout(() => window.close(), 1000);
  });
});
