'use strict';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-tab',
    title: 'Save to TabDen',
    contexts: ['page'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'save-tab' || !tab?.url) return;

  const { collections = [] } = await chrome.storage.local.get(['collections']);

  if (collections.length === 0) {
    collections.push({ id: uid(), name: 'General', color: '#6366f1', createdAt: Date.now(), tabs: [] });
  }

  const col = collections[0];
  if (!col.tabs.some(t => t.url === tab.url)) {
    col.tabs.push({ id: uid(), title: tab.title || tab.url, url: tab.url, favIconUrl: tab.favIconUrl || null, savedAt: Date.now() });
    await chrome.storage.local.set({ collections });
  }
});
