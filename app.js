/* Closet Outfit Maker — all data stays in this browser (IndexedDB). */
(() => {
  'use strict';

  // ---------- Reference data ----------
  const CATEGORIES = [
    { key: 'top', label: 'Top' },
    { key: 'bottom', label: 'Bottom' },
    { key: 'dress', label: 'Dress / one-piece' },
    { key: 'outerwear', label: 'Outerwear' },
    { key: 'shoes', label: 'Shoes' },
    { key: 'accessory', label: 'Accessory' },
  ];
  const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.key, c.label]));

  // neutral colors pair with anything; accents are limited per outfit
  const COLORS = [
    { key: 'black', hex: '#1f1f1f', neutral: true },
    { key: 'white', hex: '#f7f7f5', neutral: true },
    { key: 'grey', hex: '#9a9a9a', neutral: true },
    { key: 'navy', hex: '#24345c', neutral: true },
    { key: 'beige', hex: '#d9c7a7', neutral: true },
    { key: 'brown', hex: '#7a5134', neutral: true },
    { key: 'denim', hex: '#5677a3', neutral: true },
    { key: 'red', hex: '#c0392b' },
    { key: 'pink', hex: '#ec9fb6' },
    { key: 'orange', hex: '#e67e22' },
    { key: 'yellow', hex: '#f1c40f' },
    { key: 'green', hex: '#3f8f5a' },
    { key: 'olive', hex: '#7d7f3c' },
    { key: 'blue', hex: '#3b82c4' },
    { key: 'purple', hex: '#8e5ea2' },
    { key: 'pattern', hex: 'repeating-linear-gradient(45deg,#d9c7a7 0 6px,#c0392b 6px 12px)', pattern: true },
  ];
  const COLOR_BY_KEY = Object.fromEntries(COLORS.map(c => [c.key, c]));

  const SEASONS = ['spring', 'summer', 'fall', 'winter'];
  const OCCASIONS = ['casual', 'work', 'formal', 'sport', 'going out', 'lounge'];

  // ---------- Storage (IndexedDB, localStorage fallback) ----------
  const DB_NAME = 'closet-outfit-maker';
  let dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('no idb'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function load(key, fallback) {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const r = db.transaction('kv').objectStore('kv').get(key);
        r.onsuccess = () => resolve(r.result ?? fallback);
        r.onerror = () => reject(r.error);
      });
    } catch {
      try { return JSON.parse(localStorage.getItem(DB_NAME + ':' + key)) ?? fallback; } catch { return fallback; }
    }
  }
  async function save(key, value) {
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      try { localStorage.setItem(DB_NAME + ':' + key, JSON.stringify(value)); }
      catch { toast('Could not save — storage is full or blocked'); }
    }
  }

  // ---------- State ----------
  let items = [];
  let outfits = [];
  const current = {};          // slot -> itemId
  const locked = new Set();    // slots locked while shuffling
  let editingId = null;
  let pendingPhoto = null;     // data URL for item dialog
  let pickSlot = null;

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const $ = sel => document.querySelector(sel);

  function el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) n.append(c);
    return n;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- Rendering helpers ----------
  function thumb(item) {
    if (item.photo) return el('img', { class: 'thumb', src: item.photo, alt: item.name, loading: 'lazy' });
    const c = COLOR_BY_KEY[item.color];
    const bg = c ? c.hex : 'var(--border)';
    const dark = c && ['black', 'navy', 'brown', 'red', 'green', 'olive', 'blue', 'purple', 'denim'].includes(c.key);
    return el('div', { class: 'swatch-thumb', style: `background:${bg};${dark ? 'color:rgba(255,255,255,.75)' : ''}` },
      CATEGORY_LABEL[item.category]?.split(' ')[0] || '');
  }

  function colorDot(key) {
    const c = COLOR_BY_KEY[key];
    return c ? el('span', { class: 'dot', style: `background:${c.hex}`, title: key }) : null;
  }

  function itemCard(item, onclick) {
    return el('button', { class: 'card', type: 'button', onclick },
      thumb(item),
      el('div', { class: 'card-body' },
        el('div', { class: 'card-name' }, item.name),
        el('div', { class: 'card-meta' }, colorDot(item.color), CATEGORY_LABEL[item.category] || item.category)));
  }

  // ---------- Closet view ----------
  function renderCloset() {
    const cat = $('#filter-category').value;
    const q = $('#filter-search').value.trim().toLowerCase();
    const list = items
      .filter(i => !cat || i.category === cat)
      .filter(i => !q || i.name.toLowerCase().includes(q) || (i.color || '').includes(q));
    const grid = $('#closet-grid');
    grid.replaceChildren(...list.map(i => itemCard(i, () => openItemDialog(i))));
    $('#closet-empty').textContent = items.length === 0
      ? 'Your closet is empty. Add a few tops, bottoms and shoes to start making outfits.'
      : list.length === 0 ? 'No items match.' : '';
  }

  // ---------- Item dialog ----------
  function chipGroup(container, values, selected) {
    container.replaceChildren(...values.map(v =>
      el('label', { class: 'chip' },
        el('input', { type: 'checkbox', value: v, checked: selected.includes(v) }),
        el('span', {}, v))));
  }
  const checkedValues = container => [...container.querySelectorAll('input:checked')].map(i => i.value);

  function setPhotoPreview(src) {
    const img = $('#photo-preview');
    img.hidden = !src;
    if (src) img.src = src; else img.removeAttribute('src');
    $('#photo-placeholder').hidden = !!src;
  }

  function openItemDialog(item) {
    editingId = item ? item.id : null;
    pendingPhoto = item ? item.photo || null : null;
    $('#item-dialog-title').textContent = item ? 'Edit item' : 'Add item';
    $('#item-name').value = item ? item.name : '';
    $('#item-category').value = item ? item.category : 'top';
    $('#item-color').value = item ? item.color || '' : '';
    chipGroup($('#item-seasons'), SEASONS, item ? item.seasons || [] : []);
    chipGroup($('#item-occasions'), OCCASIONS, item ? item.occasions || [] : ['casual']);
    $('#delete-item-btn').hidden = !item;
    $('#item-photo').value = '';
    setPhotoPreview(pendingPhoto);
    $('#item-dialog').showModal();
  }

  // shrink photos so lots of items fit in browser storage
  function compressImage(file, max = 640) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }

  async function submitItem(e) {
    e.preventDefault();
    const name = $('#item-name').value.trim();
    if (!name) return;
    const data = {
      name,
      category: $('#item-category').value,
      color: $('#item-color').value,
      seasons: checkedValues($('#item-seasons')),
      occasions: checkedValues($('#item-occasions')),
      photo: pendingPhoto,
    };
    if (editingId) {
      const idx = items.findIndex(i => i.id === editingId);
      if (idx >= 0) items[idx] = { ...items[idx], ...data };
    } else {
      items.push({ id: uid(), createdAt: Date.now(), ...data });
    }
    await save('items', items);
    $('#item-dialog').close();
    toast(editingId ? 'Item updated' : 'Item added');
    renderAll();
  }

  async function deleteItem() {
    if (!editingId || !confirm('Delete this item from your closet?')) return;
    items = items.filter(i => i.id !== editingId);
    for (const slot of Object.keys(current)) if (current[slot] === editingId) { delete current[slot]; locked.delete(slot); }
    await save('items', items);
    $('#item-dialog').close();
    toast('Item deleted');
    renderAll();
  }

  // ---------- Outfit generator ----------
  const byId = id => items.find(i => i.id === id);

  function eligible(category) {
    const occ = $('#gen-occasion').value;
    const season = $('#gen-season').value;
    // untagged items count as "works for anything"
    return items.filter(i => i.category === category
      && (!occ || !i.occasions?.length || i.occasions.includes(occ))
      && (!season || !i.seasons?.length || i.seasons.includes(season)));
  }

  function wantedSlots(useDress) {
    const slots = useDress ? ['dress'] : ['top', 'bottom'];
    if ($('#gen-outerwear').checked) slots.push('outerwear');
    slots.push('shoes');
    if ($('#gen-accessory').checked) slots.push('accessory');
    return slots;
  }

  // lower is better: too many accent colors or clashing patterns cost points
  function clashScore(ids) {
    const colors = ids.map(id => COLOR_BY_KEY[byId(id)?.color]).filter(Boolean);
    const accents = new Set(colors.filter(c => !c.neutral && !c.pattern).map(c => c.key));
    const patterns = colors.filter(c => c.pattern).length;
    let score = 0;
    score += Math.max(0, accents.size - 2) * 3;
    score += Math.max(0, patterns - 1) * 3;
    if (patterns && accents.size >= 2) score += 1;
    if (colors.length && colors.every(c => c.key === colors[0].key) && colors.length > 2) score += 1; // all one color
    return score;
  }

  const pickRandom = arr => arr[Math.floor(Math.random() * arr.length)];

  function shuffle() {
    const allowDress = $('#gen-dress').checked;
    const dressPool = eligible('dress');
    const topPool = eligible('top');
    const bottomPool = eligible('bottom');
    const canSeparates = topPool.length && bottomPool.length;
    const canDress = allowDress && dressPool.length;

    // locks decide the mode when present
    let useDress;
    if (locked.has('dress') && current.dress) useDress = true;
    else if ((locked.has('top') && current.top) || (locked.has('bottom') && current.bottom)) useDress = false;
    else if (canSeparates && canDress) useDress = Math.random() < dressPool.length / (dressPool.length + Math.min(topPool.length, bottomPool.length));
    else useDress = !canSeparates && !!canDress;

    const slots = wantedSlots(useDress);
    const previous = slots.map(s => current[s]).join('|');

    let best = [], bestScore = Infinity;
    for (let attempt = 0; attempt < 80; attempt++) {
      const combo = {};
      for (const slot of slots) {
        if (locked.has(slot) && current[slot] && byId(current[slot])) { combo[slot] = current[slot]; continue; }
        const pool = eligible(slot);
        if (pool.length) combo[slot] = pickRandom(pool).id;
      }
      const ids = Object.values(combo);
      let score = clashScore(ids);
      if (slots.map(s => combo[s]).join('|') === previous) score += 0.5; // prefer something new
      if (score < bestScore) { bestScore = score; best = [combo]; }
      else if (score === bestScore) best.push(combo);
    }
    const chosen = pickRandom(best) || {};

    for (const k of Object.keys(current)) if (!slots.includes(k)) { delete current[k]; locked.delete(k); }
    for (const s of slots) { if (chosen[s]) current[s] = chosen[s]; else delete current[s]; }
    renderBoard(slots);
  }

  function currentSlots() {
    const useDress = !!current.dress && !current.top && !current.bottom;
    const wanted = wantedSlots(useDress);
    // keep any optional slot the user filled by hand even if its toggle is off
    return CATEGORIES.map(c => c.key).filter(s => wanted.includes(s)
      || (current[s] && (s === 'outerwear' || s === 'accessory')));
  }

  function renderBoard(slots = currentSlots()) {
    const board = $('#outfit-board');
    board.replaceChildren(...slots.map(slot => {
      const item = byId(current[slot]);
      const isLocked = locked.has(slot) && item;
      return el('div', { class: 'slot' + (isLocked ? ' locked' : '') },
        el('div', { class: 'slot-label' }, CATEGORY_LABEL[slot]),
        item ? el('button', {
          class: 'lock-btn', type: 'button',
          title: isLocked ? 'Unlock' : 'Lock this piece',
          'aria-label': isLocked ? 'Unlock ' + item.name : 'Lock ' + item.name,
          'aria-pressed': isLocked ? 'true' : 'false',
          onclick: () => { locked.has(slot) ? locked.delete(slot) : locked.add(slot); renderBoard(slots); },
        }, isLocked ? '🔒' : '🔓') : null,
        item ? itemCard(item, () => openPicker(slot))
             : el('button', { class: 'slot-empty', type: 'button', onclick: () => openPicker(slot) },
                 eligible(slot).length || items.some(i => i.category === slot) ? 'Choose…' : 'None in closet'));
    }));

    const msg = $('#outfit-message');
    if (!items.length) msg.textContent = 'Add clothes to your closet first.';
    else if (!slots.some(s => current[s])) msg.textContent = 'Nothing matches these filters — try "Any".';
    else msg.textContent = '';
  }

  function openPicker(slot) {
    pickSlot = slot;
    $('#pick-title').textContent = 'Choose ' + CATEGORY_LABEL[slot].toLowerCase();
    const pool = items.filter(i => i.category === slot);
    $('#pick-grid').replaceChildren(...(pool.length
      ? pool.map(i => itemCard(i, () => choose(i.id)))
      : [el('p', { class: 'empty' }, 'No items in this category yet.')]));
    $('#pick-dialog').showModal();
  }

  function choose(id) {
    const slot = pickSlot;
    if (id) {
      current[slot] = id;
      locked.add(slot); // a hand-picked piece stays put while shuffling
      if (slot === 'dress') { delete current.top; delete current.bottom; locked.delete('top'); locked.delete('bottom'); }
      if (slot === 'top' || slot === 'bottom') { delete current.dress; locked.delete('dress'); }
    } else {
      delete current[slot];
      locked.delete(slot);
    }
    $('#pick-dialog').close();
    renderBoard(slot === 'dress' ? wantedSlots(true) : (slot === 'top' || slot === 'bottom') ? wantedSlots(false) : undefined);
  }

  async function saveOutfit() {
    const slots = currentSlots();
    const ids = slots.map(s => current[s]).filter(id => byId(id));
    if (!ids.length) return toast('Shuffle or pick some pieces first');
    const name = $('#outfit-name').value.trim() || 'Outfit ' + (outfits.length + 1);
    outfits.unshift({ id: uid(), name, itemIds: ids, createdAt: Date.now() });
    await save('outfits', outfits);
    $('#outfit-name').value = '';
    toast('Outfit saved');
    renderSaved();
  }

  // ---------- Saved view ----------
  function renderSaved() {
    const list = $('#saved-list');
    list.replaceChildren(...outfits.map(o => {
      const pieces = o.itemIds.map(byId).filter(Boolean);
      return el('article', { class: 'saved' },
        el('div', { class: 'saved-head' },
          el('strong', {}, o.name),
          el('span', { class: 'card-meta' }, new Date(o.createdAt).toLocaleDateString()),
          el('button', { class: 'btn ghost', type: 'button', onclick: () => wearOutfit(o) }, 'Open'),
          el('button', { class: 'btn danger', type: 'button', onclick: () => deleteOutfit(o.id) }, 'Delete')),
        el('div', { class: 'saved-items' }, pieces.length
          ? pieces.map(p => el('div', { class: 'mini' }, thumb(p), el('span', {}, p.name)))
          : el('span', { class: 'card-meta' }, 'These items were removed from your closet.')));
    }));
    $('#saved-empty').textContent = outfits.length ? '' : 'No saved outfits yet.';
  }

  function wearOutfit(o) {
    for (const k of Object.keys(current)) delete current[k];
    locked.clear();
    for (const id of o.itemIds) { const it = byId(id); if (it) { current[it.category] = id; locked.add(it.category); } }
    switchView('create');
    renderBoard();
  }

  async function deleteOutfit(id) {
    if (!confirm('Delete this saved outfit?')) return;
    outfits = outfits.filter(o => o.id !== id);
    await save('outfits', outfits);
    renderSaved();
  }

  // ---------- Import / export ----------
  function exportData() {
    const blob = new Blob([JSON.stringify({ app: 'closet-outfit-maker', version: 1, items, outfits }, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'closet-backup.json' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function importData(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.items)) throw new Error('bad file');
      const clean = i => ({
        id: String(i.id || uid()), name: String(i.name || 'Item'),
        category: CATEGORY_LABEL[i.category] ? i.category : 'top',
        color: COLOR_BY_KEY[i.color] ? i.color : '',
        seasons: (i.seasons || []).filter(s => SEASONS.includes(s)),
        occasions: (i.occasions || []).filter(s => OCCASIONS.includes(s)),
        photo: typeof i.photo === 'string' && i.photo.startsWith('data:image/') ? i.photo : null,
        createdAt: Number(i.createdAt) || Date.now(),
      });
      const known = new Set(items.map(i => i.id));
      const newItems = data.items.map(clean).filter(i => !known.has(i.id));
      items = items.concat(newItems);
      const knownOutfits = new Set(outfits.map(o => o.id));
      const newOutfits = (data.outfits || [])
        .filter(o => o && Array.isArray(o.itemIds) && !knownOutfits.has(o.id))
        .map(o => ({ id: String(o.id || uid()), name: String(o.name || 'Outfit'), itemIds: o.itemIds.map(String), createdAt: Number(o.createdAt) || Date.now() }));
      outfits = outfits.concat(newOutfits);
      await save('items', items);
      await save('outfits', outfits);
      toast(`Imported ${newItems.length} items, ${newOutfits.length} outfits`);
      renderAll();
    } catch {
      toast('That file could not be imported');
    }
  }

  // ---------- Navigation ----------
  function switchView(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    if (name === 'create' && !Object.keys(current).length && items.length) shuffle();
  }

  function renderAll() {
    renderCloset();
    renderBoard();
    renderSaved();
  }

  // ---------- Setup ----------
  function fillSelect(select, options, keepFirst = true) {
    if (!keepFirst) select.replaceChildren();
    for (const o of options) select.append(el('option', { value: o.value }, o.label));
  }

  async function init() {
    fillSelect($('#filter-category'), CATEGORIES.map(c => ({ value: c.key, label: c.label })));
    fillSelect($('#item-category'), CATEGORIES.map(c => ({ value: c.key, label: c.label })), false);
    fillSelect($('#item-color'), [{ value: '', label: '—' }, ...COLORS.map(c => ({ value: c.key, label: c.key }))], false);
    fillSelect($('#gen-occasion'), OCCASIONS.map(o => ({ value: o, label: o })));
    fillSelect($('#gen-season'), SEASONS.map(s => ({ value: s, label: s })));

    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));
    $('#add-item-btn').addEventListener('click', () => openItemDialog(null));
    $('#filter-category').addEventListener('change', renderCloset);
    $('#filter-search').addEventListener('input', renderCloset);
    $('#item-form').addEventListener('submit', submitItem);
    $('#cancel-item-btn').addEventListener('click', () => $('#item-dialog').close());
    $('#delete-item-btn').addEventListener('click', deleteItem);
    $('#item-photo').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      try { pendingPhoto = await compressImage(f); setPhotoPreview(pendingPhoto); }
      catch { toast('Could not read that image'); }
    });
    $('#shuffle-btn').addEventListener('click', shuffle);
    ['#gen-occasion', '#gen-season', '#gen-outerwear', '#gen-accessory', '#gen-dress']
      .forEach(s => $(s).addEventListener('change', shuffle));
    $('#save-outfit-btn').addEventListener('click', saveOutfit);
    $('#pick-close-btn').addEventListener('click', () => $('#pick-dialog').close());
    $('#pick-none-btn').addEventListener('click', () => choose(null));
    $('#export-btn').addEventListener('click', exportData);
    $('#import-input').addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });

    items = await load('items', []);
    outfits = await load('outfits', []);
    renderAll();
  }

  init();
})();
