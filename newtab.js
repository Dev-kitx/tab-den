'use strict';

// ── Constants ─────────────────────────────────────────────────────

const MOON_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
const SUN_SVG  = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;

const DRAG_HANDLE = `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="3" cy="2.5" r="1.2"/><circle cx="7" cy="2.5" r="1.2"/><circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/><circle cx="3" cy="11.5" r="1.2"/><circle cx="7" cy="11.5" r="1.2"/></svg>`;

const COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#f43f5e',
  '#f97316','#f59e0b','#10b981','#06b6d4','#3b82f6',
];

const GREETINGS = {
  morning:   ['Good morning', 'Rise and grind', 'Morning!'],
  afternoon: ['Good afternoon', 'Hey there', 'Good day'],
  evening:   ['Good evening', 'Wind down time', 'Evening!'],
  night:     ['Burning midnight oil?', 'Night owl mode', 'Up late?'],
};

// ── State ──────────────────────────────────────────────────────────

const state = {
  collections: [],
  pendingColor: COLORS[0],
  modalMode: 'create',
  editColId: null,
  addTabColId: null,
  addTabSelectedIdx: null,
  saveTabsSelected: new Set(),
  expandedColId: null,
  bulkMode: false,
  bulkSelected: new Set(),
};

// ── Helpers ────────────────────────────────────────────────────────

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const getDomain = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const getCol = id => state.collections.find(c => c.id === id);

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

async function loadData() {
  const { collections } = await chrome.storage.local.get(['collections']);
  state.collections = collections || [];
}

// ── Theme ──────────────────────────────────────────────────────────

async function initTheme() {
  const { theme = 'dark' } = await chrome.storage.local.get(['theme']);
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('btn-theme');
  if (btn) btn.innerHTML = theme === 'dark' ? MOON_SVG : SUN_SVG;
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  chrome.storage.local.set({ theme: next });
}

async function persist() {
  await chrome.storage.local.set({ collections: state.collections });
}

function findDuplicateCollections(url) {
  return state.collections.filter(c => c.tabs.some(t => t.url === url));
}

// ── Export / Import ────────────────────────────────────────────────

function dlBlob(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportAllJSON() {
  dlBlob(JSON.stringify({ v: 1, exportedAt: Date.now(), collections: state.collections }, null, 2), 'tabden-export.json', 'application/json');
  showToast('Exported as JSON', 'success');
}

function exportBookmarks() {
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>TabDen Export</TITLE><H1>TabDen</H1>',
    '<DL><p>',
  ];
  for (const col of state.collections) {
    lines.push(`  <DT><H3>${escHtml(col.name)}</H3>`, `  <DL><p>`);
    for (const t of col.tabs) lines.push(`    <DT><A HREF="${escHtml(t.url)}">${escHtml(t.title || t.url)}</A>`);
    lines.push(`  </DL><p>`);
  }
  lines.push('</DL><p>');
  dlBlob(lines.join('\n'), 'tabden-bookmarks.html', 'text/html');
  showToast('Exported as bookmarks', 'success');
}

async function importJSON(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data?.collections)) throw new Error();
    let added = 0;
    for (const col of data.collections) {
      if (!col?.name || !Array.isArray(col.tabs)) continue;
      const existing = state.collections.find(c => c.name === col.name);
      if (existing) {
        for (const t of col.tabs) {
          if (t.url && !existing.tabs.some(e => e.url === t.url)) {
            existing.tabs.push({ ...t, id: uid(), savedAt: t.savedAt || Date.now() });
            added++;
          }
        }
      } else {
        state.collections.push({ ...col, id: uid(), tabs: col.tabs.filter(t => t.url).map(t => ({ ...t, id: uid() })) });
        added += col.tabs.filter(t => t.url).length;
      }
    }
    persist();
    render();
    showToast(`Imported ${added} tab${added !== 1 ? 's' : ''}`, 'success');
  } catch {
    showToast('Import failed — invalid file', 'error');
  }
}

// ── Bulk Select Actions ────────────────────────────────────────────

let _bulkCountEl = null;

function updateBulkCount() {
  if (_bulkCountEl) {
    const n = state.bulkSelected.size;
    _bulkCountEl.textContent = `${n} tab${n !== 1 ? 's' : ''} selected`;
  }
}

function bulkDeleteSelected(colId) {
  const col = getCol(colId);
  if (!col || !state.bulkSelected.size) return;
  const count = state.bulkSelected.size;
  col.tabs = col.tabs.filter(t => !state.bulkSelected.has(t.id));
  state.bulkSelected.clear();
  state.bulkMode = false;
  persist();
  render();
  showToast(`${count} tab${count !== 1 ? 's' : ''} deleted`, 'success');
}

function bulkMoveSelected(srcColId, dstColId) {
  if (!state.bulkSelected.size || !dstColId) return;
  const src = getCol(srcColId);
  const dst = getCol(dstColId);
  if (!src || !dst) return;
  let moved = 0;
  const toMove = src.tabs.filter(t => state.bulkSelected.has(t.id));
  for (const tab of toMove) {
    if (!dst.tabs.some(t => t.url === tab.url)) { dst.tabs.push(tab); moved++; }
  }
  src.tabs = src.tabs.filter(t => !state.bulkSelected.has(t.id));
  state.bulkSelected.clear();
  state.bulkMode = false;
  persist();
  render();
  showToast(`${moved} tab${moved !== 1 ? 's' : ''} moved to "${dst.name}"`, 'success');
}

function favicon(tab, colColor) {
  if (tab.favIconUrl) {
    const img = document.createElement('img');
    img.className = 'tab-fav';
    img.src = tab.favIconUrl;
    img.onerror = () => img.replaceWith(faviconPh(tab.title, colColor));
    return img;
  }
  return faviconPh(tab.title, colColor);
}

function faviconPh(title, colColor) {
  const el = document.createElement('div');
  el.className = 'tab-fav-ph';
  el.textContent = (title || '?')[0].toUpperCase();
  if (colColor) {
    el.style.background = colColor + '28';
    el.style.color = colColor;
  }
  return el;
}

// ── Clock ──────────────────────────────────────────────────────────

function initClock() {
  const tick = () => {
    const d = new Date();
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    document.getElementById('clock').textContent = `${h}:${m}`;

    const slot = h < 6 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
    const msgs = GREETINGS[slot];
    document.getElementById('greeting').textContent = msgs[Math.floor(Math.random() * msgs.length)];
  };
  tick();
  setInterval(tick, 30000);
}

// ── Render ─────────────────────────────────────────────────────────

function render() {
  const board = document.getElementById('board');
  const welcome = document.getElementById('welcome');

  if (state.collections.length === 0) {
    board.classList.add('hidden');
    welcome.classList.remove('hidden');
    return;
  }

  board.classList.remove('hidden');
  welcome.classList.add('hidden');
  board.innerHTML = '';
  board.removeAttribute('style');

  if (state.expandedColId) {
    renderExpandedView(board, state.expandedColId);
  } else {
    renderTileGrid(board);
  }
}

// ── Tile Grid ──────────────────────────────────────────────────────

function renderTileGrid(board) {
  board.className = 'board board-tiles';

  for (const col of state.collections) {
    board.appendChild(buildTile(col));
  }

  const newTile = document.createElement('div');
  newTile.className = 'tile tile-new';
  newTile.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <path d="M12 5v14M5 12h14"/>
    </svg>
    <span>New Collection</span>`;
  newTile.addEventListener('click', () => openColModal());
  board.appendChild(newTile);
}

function buildTile(col) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  const [cr, cg, cb] = hexToRgb(col.color);
  tile.style.setProperty('--cr', cr);
  tile.style.setProperty('--cg', cg);
  tile.style.setProperty('--cb', cb);

  // Top color bar
  const bar = document.createElement('div');
  bar.className = 'tile-bar';

  // Body
  const body = document.createElement('div');
  body.className = 'tile-body';

  // Favicon preview row
  const favRow = document.createElement('div');
  favRow.className = 'tile-favs';
  col.tabs.slice(0, 7).forEach(tab => {
    if (!tab.favIconUrl) return;
    const img = document.createElement('img');
    img.className = 'tile-fav';
    img.src = tab.favIconUrl;
    img.onerror = () => img.remove();
    favRow.appendChild(img);
  });

  // Name
  const name = document.createElement('div');
  name.className = 'tile-name';
  const nameSpan = document.createElement('span');
  nameSpan.textContent = col.name;
  name.appendChild(nameSpan);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'tile-footer';

  const count = document.createElement('span');
  count.className = 'tile-count';
  count.textContent = `${col.tabs.length} tab${col.tabs.length !== 1 ? 's' : ''}`;

  const menuBtn = document.createElement('button');
  menuBtn.className = 'tile-menu-btn';
  menuBtn.title = 'Options';
  menuBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/></svg>`;
  menuBtn.addEventListener('click', e => { e.stopPropagation(); showColMenu(e, col); });

  footer.append(count, menuBtn);
  body.append(favRow, name, footer);
  tile.append(bar, body);

  tile.addEventListener('click', () => { state.expandedColId = col.id; render(); });
  tile.addEventListener('contextmenu', e => { e.preventDefault(); showColMenu(e, col); });
  return tile;
}

// ── Expanded View ──────────────────────────────────────────────────

function renderExpandedView(board, colId) {
  const col = getCol(colId);
  if (!col) { state.expandedColId = null; render(); return; }

  board.className = 'board board-expanded';
  const [cr, cg, cb] = hexToRgb(col.color);
  board.style.setProperty('--cr', cr);
  board.style.setProperty('--cg', cg);
  board.style.setProperty('--cb', cb);

  // ── Header ──
  const header = document.createElement('div');
  header.className = 'exp-header';

  const backBtn = document.createElement('button');
  backBtn.className = 'btn btn-ghost btn-sm';
  backBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg> Collections`;
  backBtn.addEventListener('click', () => { state.expandedColId = null; state.bulkMode = false; state.bulkSelected.clear(); render(); });

  const titleArea = document.createElement('div');
  titleArea.className = 'exp-title';

  const dot = document.createElement('span');
  dot.className = 'exp-dot';
  dot.style.cssText = `background:${col.color};box-shadow:0 0 8px rgba(${cr},${cg},${cb},0.55)`;

  const nameEl = document.createElement('span');
  nameEl.className = 'exp-name';
  nameEl.textContent = col.name;

  const countBadge = document.createElement('span');
  countBadge.className = 'exp-count';
  countBadge.textContent = col.tabs.length;

  titleArea.append(dot, nameEl, countBadge);

  const actions = document.createElement('div');
  actions.className = 'exp-actions';

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-ghost btn-sm';
  addBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Add Tab`;
  addBtn.addEventListener('click', () => openAddTabModal(col.id));

  const openAllBtn = document.createElement('button');
  openAllBtn.className = 'col-open-btn';
  openAllBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg> Open all ${col.tabs.length}`;
  openAllBtn.addEventListener('click', () => openAllTabs(col.id));

  const selectBtn = document.createElement('button');
  selectBtn.className = state.bulkMode ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
  selectBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="5" width="13" height="13" rx="2"/><path d="m7 11 2.5 2.5 4-4"/><path d="M21 8v13H8"/></svg> ${state.bulkMode ? 'Selecting' : 'Select'}`;
  selectBtn.addEventListener('click', () => {
    state.bulkMode = !state.bulkMode;
    if (!state.bulkMode) state.bulkSelected.clear();
    render();
  });

  const menuBtn = document.createElement('button');
  menuBtn.className = 'col-menu-btn';
  menuBtn.title = 'Options';
  menuBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="19" r="1" fill="currentColor"/></svg>`;
  menuBtn.addEventListener('click', e => showColMenu(e, col));

  actions.append(addBtn, openAllBtn, selectBtn, menuBtn);
  header.append(backBtn, titleArea, actions);

  // ── Tabs ──
  const tabsArea = document.createElement('div');
  tabsArea.className = 'exp-tabs';

  if (col.tabs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'exp-empty';
    empty.innerHTML = `
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.3"><rect x="2" y="6" width="20" height="15" rx="3"/><rect x="2" y="2" width="9" height="6" rx="2"/></svg>
      <p>No tabs in this collection yet</p>
      <button class="btn btn-primary btn-sm" id="exp-add-first">Add Tab</button>`;
    tabsArea.appendChild(empty);
    setTimeout(() => document.getElementById('exp-add-first')?.addEventListener('click', () => openAddTabModal(col.id)), 0);
  } else {
    for (const tab of [...col.tabs].reverse()) {
      tabsArea.appendChild(buildTabItem(tab, col));
    }
  }

  // ── Bulk Bar ──
  if (state.bulkMode) {
    const bulkBar = document.createElement('div');
    bulkBar.className = 'exp-bulk-bar';

    const countEl = document.createElement('span');
    countEl.className = 'exp-bulk-count';
    _bulkCountEl = countEl;
    updateBulkCount();

    const others = state.collections.filter(c => c.id !== colId);
    if (others.length > 0) {
      const wrap = document.createElement('div');
      wrap.className = 'exp-bulk-move-wrap';
      const lbl = document.createElement('label');
      lbl.textContent = 'Move to:';
      const sel = document.createElement('select');
      sel.className = 'bulk-move-sel';
      others.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        sel.appendChild(opt);
      });
      const moveBtn = document.createElement('button');
      moveBtn.className = 'btn btn-ghost btn-sm';
      moveBtn.textContent = 'Move';
      moveBtn.addEventListener('click', () => bulkMoveSelected(colId, sel.value));
      wrap.append(lbl, sel, moveBtn);
      bulkBar.appendChild(wrap);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-danger';
    delBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg> Delete`;
    delBtn.addEventListener('click', () => bulkDeleteSelected(colId));

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-ghost btn-sm';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { state.bulkMode = false; state.bulkSelected.clear(); render(); });

    bulkBar.append(countEl, delBtn, cancelBtn);
    board.append(header, tabsArea, bulkBar);
  } else {
    board.append(header, tabsArea);
  }
}

function buildColumn(col) {
  const el = document.createElement('div');
  el.className = 'col';
  el.style.setProperty('--col-color', col.color);
  el.dataset.colId = col.id;

  const [cr, cg, cb] = hexToRgb(col.color);
  el.style.setProperty('--cr', cr);
  el.style.setProperty('--cg', cg);
  el.style.setProperty('--cb', cb);

  // Header
  const header = document.createElement('div');
  header.className = 'col-header';

  const dot = document.createElement('div');
  dot.className = 'col-dot';
  dot.style.background = col.color;

  const name = document.createElement('div');
  name.className = 'col-name';
  name.textContent = col.name;
  name.contentEditable = 'true';
  name.spellcheck = false;
  name.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
    if (e.key === 'Escape') { name.textContent = col.name; name.blur(); }
  });
  name.addEventListener('blur', () => {
    const v = name.textContent.trim();
    if (v && v !== col.name) {
      col.name = v;
      persist();
      countEl.textContent = `${col.tabs.length}`;
    } else {
      name.textContent = col.name;
    }
  });

  const countEl = document.createElement('span');
  countEl.className = 'col-count';
  countEl.textContent = col.tabs.length;

  const menuBtn = document.createElement('button');
  menuBtn.className = 'col-menu-btn';
  menuBtn.title = 'Collection options';
  menuBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="19" r="1" fill="currentColor"/></svg>`;
  menuBtn.addEventListener('click', e => showColMenu(e, col));

  header.append(dot, name, countEl, menuBtn);

  // Tab list
  const tabList = document.createElement('div');
  tabList.className = 'col-tabs';

  if (col.tabs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'col-empty';
    empty.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>Drop tabs here or click + below`;
    tabList.appendChild(empty);
  } else {
    for (const tab of col.tabs) {
      tabList.appendChild(buildTabItem(tab, col));
    }
  }

  // Footer
  const footer = document.createElement('div');
  footer.className = 'col-footer';

  const addBtn = document.createElement('button');
  addBtn.className = 'col-add-btn';
  addBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Add Tab`;
  addBtn.addEventListener('click', () => openAddTabModal(col.id));

  const openBtn = document.createElement('button');
  openBtn.className = 'col-open-btn';
  openBtn.title = `Open all ${col.tabs.length} tabs`;
  openBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>${col.tabs.length}`;
  openBtn.addEventListener('click', () => openAllTabs(col.id));

  footer.append(addBtn, openBtn);

  el.append(header, tabList, footer);

  setupColDragDrop(el, col);
  return el;
}

function buildTabItem(tab, col) {
  const el = document.createElement('div');
  el.className = 'tab-item';
  el.dataset.tabId = tab.id;
  el.dataset.colId = col.id;

  if (state.bulkMode) {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'bulk-cb';
    cb.checked = state.bulkSelected.has(tab.id);
    cb.addEventListener('change', e => {
      e.stopPropagation();
      cb.checked ? state.bulkSelected.add(tab.id) : state.bulkSelected.delete(tab.id);
      updateBulkCount();
    });
    el.appendChild(cb);
    el.addEventListener('click', e => { if (e.target === cb) return; cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); });
  } else {
    el.draggable = true;
    const handle = document.createElement('div');
    handle.className = 'tab-drag';
    handle.innerHTML = DRAG_HANDLE;
    el.appendChild(handle);
    el.addEventListener('click', () => chrome.tabs.create({ url: tab.url }));
    el.addEventListener('contextmenu', e => { e.preventDefault(); showTabCtxMenu(e, tab, col); });
    el.addEventListener('dragstart', e => {
      el.classList.add('dragging');
      e.dataTransfer.setData('tabId', tab.id);
      e.dataTransfer.setData('srcColId', col.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  }

  const fav = favicon(tab, col.color);
  const info = document.createElement('div');
  info.className = 'tab-info';

  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = tab.title || getDomain(tab.url);

  const domain = document.createElement('div');
  domain.className = 'tab-domain';
  domain.textContent = getDomain(tab.url);

  info.append(title, domain);
  el.append(fav, info);

  if (!state.bulkMode) {
    const del = document.createElement('button');
    del.className = 'tab-del';
    del.title = 'Remove';
    del.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
    del.addEventListener('click', e => { e.stopPropagation(); removeTab(col.id, tab.id); });
    el.appendChild(del);
  }

  return el;
}

// ── Drag & Drop ────────────────────────────────────────────────────

function setupColDragDrop(colEl, col) {
  colEl.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    colEl.classList.add('drag-over');
  });
  colEl.addEventListener('dragleave', e => {
    if (!colEl.contains(e.relatedTarget)) colEl.classList.remove('drag-over');
  });
  colEl.addEventListener('drop', e => {
    e.preventDefault();
    colEl.classList.remove('drag-over');
    const tabId = e.dataTransfer.getData('tabId');
    const srcColId = e.dataTransfer.getData('srcColId');
    if (srcColId !== col.id) moveTab(srcColId, col.id, tabId);
  });
}

function moveTab(srcColId, dstColId, tabId) {
  const src = getCol(srcColId);
  const dst = getCol(dstColId);
  if (!src || !dst) return;
  const tab = src.tabs.find(t => t.id === tabId);
  if (!tab) return;
  if (dst.tabs.some(t => t.url === tab.url)) { showToast('Already saved in that collection'); return; }
  src.tabs = src.tabs.filter(t => t.id !== tabId);
  dst.tabs.push(tab);
  persist();
  render();
  showToast(`Moved to "${dst.name}"`, 'success');
}

// ── Collection Actions ─────────────────────────────────────────────

function createCollection(name, color) {
  const col = { id: uid(), name, color, createdAt: Date.now(), tabs: [] };
  state.collections.push(col);
  persist();
  render();
  return col;
}

function deleteCollection(id) {
  state.collections = state.collections.filter(c => c.id !== id);
  persist();
  render();
}

function removeTab(colId, tabId) {
  const col = getCol(colId);
  if (!col) return;
  col.tabs = col.tabs.filter(t => t.id !== tabId);
  persist();
  render();
}

function addTabToCol(colId, tabData, silent = false) {
  const col = getCol(colId);
  if (!col) return false;
  if (col.tabs.some(t => t.url === tabData.url)) {
    if (!silent) showToast('Already saved in this collection');
    return false;
  }
  col.tabs.push({ id: uid(), ...tabData, savedAt: Date.now() });
  return true;
}

async function openAllTabs(colId) {
  const col = getCol(colId);
  if (!col || !col.tabs.length) return;
  for (const tab of col.tabs) await chrome.tabs.create({ url: tab.url, active: false });
  showToast(`Opened ${col.tabs.length} tabs`, 'success');
}

// ── Collection Modal ───────────────────────────────────────────────

function openColModal(editId = null) {
  state.modalMode = editId ? 'edit' : 'create';
  state.editColId = editId;
  state.pendingColor = editId ? (getCol(editId)?.color ?? COLORS[0]) : COLORS[0];

  const col = editId ? getCol(editId) : null;
  document.getElementById('col-modal-title').textContent = editId ? 'Rename Collection' : 'New Collection';
  document.getElementById('col-name').value = col?.name || '';
  document.getElementById('col-confirm').textContent = editId ? 'Save' : 'Create';
  renderColorGrid();
  document.getElementById('col-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('col-name').focus(), 60);
}

function closeColModal() {
  document.getElementById('col-overlay').classList.add('hidden');
}

function renderColorGrid() {
  const grid = document.getElementById('col-colors');
  grid.innerHTML = '';
  for (const c of COLORS) {
    const sw = document.createElement('div');
    sw.className = 'c-swatch' + (c === state.pendingColor ? ' sel' : '');
    sw.style.background = c;
    sw.addEventListener('click', () => { state.pendingColor = c; renderColorGrid(); });
    grid.appendChild(sw);
  }
}

function confirmColModal() {
  const name = document.getElementById('col-name').value.trim();
  if (!name) { document.getElementById('col-name').focus(); return; }

  if (state.modalMode === 'create') {
    createCollection(name, state.pendingColor);
    showToast(`Collection "${name}" created`, 'success');
  } else {
    const col = getCol(state.editColId);
    if (col) { col.name = name; col.color = state.pendingColor; persist(); render(); }
    showToast('Collection updated', 'success');
  }
  closeColModal();
}

// ── Add Tab Modal ──────────────────────────────────────────────────

let addTabMode = 'open';

async function openAddTabModal(colId) {
  state.addTabColId = colId;
  state._addTabSelected = new Set();
  addTabMode = 'open';

  const col = getCol(colId);
  document.getElementById('add-col-name').textContent = col?.name || '';

  document.querySelectorAll('.src-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
  document.getElementById('add-open-list').classList.remove('hidden');
  document.getElementById('add-url-form').classList.add('hidden');
  document.getElementById('add-url').value = '';
  document.getElementById('add-title').value = '';
  document.getElementById('add-confirm').textContent = 'Add Tab';

  const tabs = await getOpenTabs();
  const list = document.getElementById('add-open-list');
  list.innerHTML = '';

  if (tabs.length === 0) {
    list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px">No open tabs found</div>';
  } else {
    const updateBtn = () => {
      const n = state._addTabSelected.size;
      document.getElementById('add-confirm').textContent = n > 1 ? `Add ${n} Tabs` : 'Add Tab';
    };
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const item = document.createElement('div');
      item.className = 'ot-item';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', () => {
        cb.checked ? state._addTabSelected.add(i) : state._addTabSelected.delete(i);
        updateBtn();
      });

      const fav = favicon(tab);
      const info = document.createElement('div');
      info.className = 'ot-info';
      info.innerHTML = `<div class="ot-title">${escHtml(tab.title || tab.url)}</div><div class="ot-url">${getDomain(tab.url)}</div>`;

      item.append(cb, fav, info);

      const addDups = findDuplicateCollections(tab.url);
      if (addDups.length > 0) {
        const badge = document.createElement('span');
        badge.className = 'dup-badge';
        badge.title = `Saved in: ${addDups.map(c => c.name).join(', ')}`;
        badge.textContent = `In: ${addDups.map(c => c.name).slice(0, 2).join(', ')}`;
        item.appendChild(badge);
      }

      item.addEventListener('click', e => { if (e.target !== cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); } });
      list.appendChild(item);
    }
    state._openTabsCache = tabs;
  }

  document.getElementById('add-overlay').classList.remove('hidden');
}

function closeAddTabModal() {
  document.getElementById('add-overlay').classList.add('hidden');
  state._openTabsCache = null;
  state._addTabSelected = new Set();
}

async function confirmAddTab() {
  if (addTabMode === 'open') {
    if (!state._addTabSelected?.size) { showToast('Select at least one tab'); return; }
    const tabs = state._openTabsCache || [];
    let saved = 0;
    for (const i of state._addTabSelected) {
      const tab = tabs[i];
      if (tab && addTabToCol(state.addTabColId, { title: tab.title, url: tab.url, favIconUrl: tab.favIconUrl || null }, true)) saved++;
    }
    if (saved) { persist(); render(); showToast(`${saved} tab${saved !== 1 ? 's' : ''} added!`, 'success'); }
  } else {
    const url = document.getElementById('add-url').value.trim();
    if (!url || !url.startsWith('http')) { showToast('Enter a valid URL'); return; }
    const title = document.getElementById('add-title').value.trim() || getDomain(url);
    const added = addTabToCol(state.addTabColId, { title, url, favIconUrl: null });
    if (added) { persist(); render(); showToast('Tab saved!', 'success'); }
  }
  closeAddTabModal();
}

// ── Save Open Tabs Modal ───────────────────────────────────────────

async function openSaveOpenTabsModal() {
  state.saveTabsSelected.clear();

  const tabs = await getOpenTabs();
  const list = document.getElementById('save-tabs-list');
  const selectAllCb = document.getElementById('save-select-all');
  list.innerHTML = '';
  selectAllCb.checked = false;
  selectAllCb.indeterminate = false;

  const updateCount = () => {
    document.getElementById('save-sel-count').textContent = `${state.saveTabsSelected.size} of ${tabs.length} selected`;
    const allChecked = state.saveTabsSelected.size === tabs.length;
    const noneChecked = state.saveTabsSelected.size === 0;
    selectAllCb.checked = allChecked;
    selectAllCb.indeterminate = !allChecked && !noneChecked;
  };

  const itemCheckboxes = [];

  if (tabs.length === 0) {
    list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px">No open tabs</div>';
  } else {
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const item = document.createElement('div');
      item.className = 'ot-item';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      itemCheckboxes.push(cb);
      cb.addEventListener('change', () => {
        cb.checked ? state.saveTabsSelected.add(i) : state.saveTabsSelected.delete(i);
        updateCount();
      });

      const fav = favicon(tab);
      const info = document.createElement('div');
      info.className = 'ot-info';
      info.innerHTML = `<div class="ot-title">${escHtml(tab.title || tab.url)}</div><div class="ot-url">${getDomain(tab.url)}</div>`;

      item.append(cb, fav, info);

      const saveDups = findDuplicateCollections(tab.url);
      if (saveDups.length > 0) {
        const badge = document.createElement('span');
        badge.className = 'dup-badge';
        badge.title = `Already saved in: ${saveDups.map(c => c.name).join(', ')}`;
        badge.textContent = `In: ${saveDups.map(c => c.name).slice(0, 2).join(', ')}`;
        item.appendChild(badge);
      }

      item.addEventListener('click', e => { if (e.target !== cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); } });
      list.appendChild(item);
    }
    state._saveTabs = tabs;
  }

  // Select All handler
  selectAllCb.onchange = () => {
    if (selectAllCb.checked) {
      tabs.forEach((_, i) => state.saveTabsSelected.add(i));
      itemCheckboxes.forEach(cb => { cb.checked = true; });
    } else {
      state.saveTabsSelected.clear();
      itemCheckboxes.forEach(cb => { cb.checked = false; });
    }
    updateCount();
  };

  // Populate collection select — default to current expanded collection
  const sel = document.getElementById('save-dest-select');
  sel.innerHTML = state.collections.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
  if (state.expandedColId) sel.value = state.expandedColId;

  document.getElementById('save-sel-count').textContent = `0 of ${tabs.length} selected`;
  document.getElementById('save-overlay').classList.remove('hidden');
}

function closeSaveModal() {
  document.getElementById('save-overlay').classList.add('hidden');
}

function confirmSaveOpenTabs() {
  if (state.saveTabsSelected.size === 0) { showToast('Select at least one tab'); return; }
  const colId = document.getElementById('save-dest-select').value;
  const tabs = state._saveTabs || [];
  let saved = 0;
  for (const idx of state.saveTabsSelected) {
    const t = tabs[idx];
    if (t && addTabToCol(colId, { title: t.title, url: t.url, favIconUrl: t.favIconUrl || null }, true)) saved++;
  }
  persist();
  render();
  closeSaveModal();
  showToast(`${saved} tab${saved !== 1 ? 's' : ''} saved`, 'success');
}

// ── Context Menus ──────────────────────────────────────────────────

function showColMenu(e, col) {
  e.stopPropagation();
  const items = [
    { label: 'Rename', icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`, action: () => openColModal(col.id) },
    { label: 'Open all tabs', icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`, action: () => openAllTabs(col.id) },
    { label: 'Export as JSON', icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`, action: () => {
      dlBlob(JSON.stringify({ v: 1, collections: [col] }, null, 2), `${col.name.replace(/\s+/g,'-')}.json`, 'application/json');
      showToast(`"${col.name}" exported`, 'success');
    }},
    { sep: true },
    { label: 'Delete collection', icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`, danger: true, action: () => { if (confirm(`Delete "${col.name}" and its ${col.tabs.length} tab(s)?`)) { deleteCollection(col.id); showToast('Collection deleted'); } } },
  ];
  showCtxMenu(e, items);
}

function showTabCtxMenu(e, tab, col) {
  const moveItems = state.collections
    .filter(c => c.id !== col.id)
    .map(c => ({
      label: c.name,
      icon: `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c.color}"></span>`,
      action: () => moveTab(col.id, c.id, tab.id),
    }));

  const items = [
    { label: 'Open tab', icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`, action: () => chrome.tabs.create({ url: tab.url }) },
    { label: 'Copy URL', icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`, action: () => { navigator.clipboard.writeText(tab.url); showToast('URL copied!', 'success'); } },
    ...(moveItems.length > 0 ? [{ sep: true }, { label: 'Move to', sublabel: true }, ...moveItems] : []),
    { sep: true },
    { label: 'Remove', icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`, danger: true, action: () => removeTab(col.id, tab.id) },
  ];
  showCtxMenu(e, items);
}

function showCtxMenu(e, items) {
  hideCtxMenu();
  const menu = document.getElementById('ctx-menu');
  menu.innerHTML = '';

  for (const item of items) {
    if (item.sep) {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      menu.appendChild(sep);
      continue;
    }
    if (item.sublabel) {
      const lbl = document.createElement('div');
      lbl.className = 'ctx-sub-label';
      lbl.textContent = item.label;
      menu.appendChild(lbl);
      continue;
    }
    const el = document.createElement('div');
    el.className = 'ctx-item' + (item.danger ? ' danger' : '');
    el.innerHTML = `<span>${item.icon || ''}</span>${escHtml(item.label)}`;
    el.addEventListener('click', () => { hideCtxMenu(); item.action?.(); });
    menu.appendChild(el);
  }

  menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect();
  let x = e.clientX, y = e.clientY;
  if (x + 200 > window.innerWidth)  x = window.innerWidth - 200;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
}

function hideCtxMenu() {
  document.getElementById('ctx-menu').classList.add('hidden');
}

// ── Open Tabs ──────────────────────────────────────────────────────

async function getOpenTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'));
}

// ── Search ─────────────────────────────────────────────────────────

function handleSearch(q) {
  const board = document.getElementById('board');
  const results = document.getElementById('search-results');

  if (!q) {
    board.classList.remove('hidden');
    results.classList.add('hidden');
    return;
  }

  board.classList.add('hidden');
  results.classList.remove('hidden');
  results.innerHTML = '';

  const ql = q.toLowerCase();
  let count = 0;

  const header = document.createElement('div');
  header.className = 'sr-header';
  results.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'sr-grid';

  for (const col of state.collections) {
    for (const tab of col.tabs) {
      if (!tab.title.toLowerCase().includes(ql) && !tab.url.toLowerCase().includes(ql)) continue;
      const card = document.createElement('div');
      card.className = 'sr-card';

      const fav = favicon(tab);
      const info = document.createElement('div');
      info.className = 'sr-card-info';
      info.innerHTML = `<div class="sr-card-title">${highlight(escHtml(tab.title || tab.url), q)}</div><div class="sr-card-domain">${getDomain(tab.url)}</div>`;

      const tag = document.createElement('span');
      tag.className = 'sr-tag';
      tag.textContent = col.name;
      tag.style.cssText = `background:${col.color}22;color:${col.color};border:1px solid ${col.color}44`;

      card.append(fav, info, tag);
      card.addEventListener('click', () => chrome.tabs.create({ url: tab.url }));
      card.addEventListener('contextmenu', e => { e.preventDefault(); showTabCtxMenu(e, tab, col); });
      grid.appendChild(card);
      count++;
    }
  }

  header.textContent = count === 0 ? 'No results' : `${count} result${count !== 1 ? 's' : ''} for "${q}"`;
  results.appendChild(grid);
}

function highlight(text, q) {
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(re, '<mark class="search-hl">$1</mark>');
}

// ── Toast ──────────────────────────────────────────────────────────

let toastTimer;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ` toast-${type}` : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2400);
}

// ── Utility ────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Init ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadData(), initTheme()]);
  initClock();
  render();

  // Search
  const searchInput = document.getElementById('search');
  const searchClear = document.getElementById('search-clear');

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    searchClear.classList.toggle('hidden', !q);
    handleSearch(q);
  });
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.classList.add('hidden');
    handleSearch('');
    searchInput.focus();
  });

  // Theme
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);

  // Export / Import button
  const btnIo = document.getElementById('btn-io');
  btnIo.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`;
  btnIo.addEventListener('click', e => {
    e.stopPropagation();
    showCtxMenu(e, [
      { label: 'Export all (JSON)', icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`, action: exportAllJSON },
      { label: 'Export as Bookmarks', icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`, action: exportBookmarks },
      { sep: true },
      { label: 'Import JSON…', icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`, action: () => document.getElementById('import-file').click() },
    ]);
  });

  document.getElementById('import-file').addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) importJSON(file);
    e.target.value = '';
  });

  // Buttons
  document.getElementById('btn-new-col').addEventListener('click', () => openColModal());
  document.getElementById('btn-open-tabs').addEventListener('click', openSaveOpenTabsModal);
  document.getElementById('welcome-btn').addEventListener('click', () => openColModal());

  // Collection modal
  document.getElementById('col-confirm').addEventListener('click', confirmColModal);
  document.getElementById('col-cancel').addEventListener('click', closeColModal);
  document.getElementById('col-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeColModal(); });
  document.getElementById('col-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmColModal();
    if (e.key === 'Escape') closeColModal();
  });

  // Add tab modal
  document.getElementById('add-confirm').addEventListener('click', confirmAddTab);
  document.getElementById('add-cancel').addEventListener('click', closeAddTabModal);
  document.getElementById('add-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeAddTabModal(); });
  document.querySelectorAll('.src-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.src-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      addTabMode = btn.dataset.src;
      document.getElementById('add-open-list').classList.toggle('hidden', addTabMode === 'url');
      document.getElementById('add-url-form').classList.toggle('hidden', addTabMode === 'open');
    });
  });

  // Save open tabs modal
  document.getElementById('save-confirm').addEventListener('click', confirmSaveOpenTabs);
  document.getElementById('save-cancel').addEventListener('click', closeSaveModal);
  document.getElementById('save-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeSaveModal(); });
  document.getElementById('save-new-col').addEventListener('click', () => {
    closeSaveModal();
    openColModal();
  });

  // Global dismiss
  document.addEventListener('click', e => {
    if (!document.getElementById('ctx-menu').contains(e.target)) hideCtxMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
    hideCtxMenu(); closeColModal(); closeAddTabModal(); closeSaveModal();
    if (state.expandedColId) { state.expandedColId = null; state.bulkMode = false; state.bulkSelected.clear(); render(); }
  }
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); searchInput.focus(); }
  });
});
