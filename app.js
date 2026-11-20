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
    { key: 'black', hex: '#2b2926', neutral: true },
    { key: 'white', hex: '#f5f2ea', neutral: true },
    { key: 'grey', hex: '#a8a49c', neutral: true },
    { key: 'navy', hex: '#323d55', neutral: true },
    { key: 'beige', hex: '#d8c9ae', neutral: true },
    { key: 'brown', hex: '#7b5c44', neutral: true },
    { key: 'denim', hex: '#6a7f99', neutral: true },
    { key: 'red', hex: '#a6493a' },
    { key: 'pink', hex: '#d9a9a4' },
    { key: 'orange', hex: '#c27845' },
    { key: 'yellow', hex: '#d6b45c' },
    { key: 'green', hex: '#5e7d61' },
    { key: 'olive', hex: '#7c7a4e' },
    { key: 'blue', hex: '#5a7fa3' },
    { key: 'purple', hex: '#7d6684' },
    { key: 'pattern', hex: 'repeating-linear-gradient(135deg,#d8c9ae 0 8px,#7b5c44 8px 10px)', pattern: true },
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
  let dialogMode = 'closet';   // 'closet' or 'consider'
  let colorAuto = false;       // color was guessed from the photo
  let selectedCandidate = null;
  const closetItems = () => items.filter(i => !i.considering);
  const candidates = () => items.filter(i => i.considering);

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

  function askConfirm(message, okLabel = 'Delete') {
    return new Promise(resolve => {
      const d = $('#confirm-dialog');
      $('#confirm-text').textContent = message;
      $('#confirm-ok').textContent = okLabel;
      const done = v => { d.removeEventListener('close', onClose); $('#confirm-ok').onclick = $('#confirm-cancel').onclick = null; if (d.open) d.close(); resolve(v); };
      const onClose = () => done(false);
      $('#confirm-ok').onclick = () => done(true);
      $('#confirm-cancel').onclick = () => done(false);
      d.addEventListener('close', onClose);
      d.showModal();
    });
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
    const dark = c && ['black', 'navy', 'brown', 'red', 'green', 'olive', 'blue', 'purple', 'denim', 'orange'].includes(c.key);
    return el('div', { class: 'swatch-thumb' + (c?.pattern ? ' patterned' : ''), style: `background:${bg};${dark ? 'color:rgba(245,242,234,.7)' : ''}` },
      el('span', {}, CATEGORY_LABEL[item.category]?.split(' ')[0] || ''));
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
        el('div', { class: 'card-meta' }, colorDot(item.color), CATEGORY_LABEL[item.category] || item.category,
          item.onOrder ? el('span', { class: 'order-tag' }, 'on order') : null,
          item.considering ? el('span', { class: 'consider-tag' }, 'considering') : null,
          item.sample ? el('span', { class: 'sample-tag' }, 'sample') : null)));
  }

  // ---------- Closet view ----------
  function renderCloset() {
    const cat = $('#filter-category').value;
    const q = $('#filter-search').value.trim().toLowerCase();
    const owned = closetItems();
    const list = owned
      .filter(i => !cat || i.category === cat)
      .filter(i => !q || i.name.toLowerCase().includes(q) || (i.color || '').includes(q) || (i.shop || '').toLowerCase().includes(q));
    $('#sample-banner').hidden = !owned.some(i => i.sample);
    const grid = $('#closet-grid');
    grid.replaceChildren(...list.map(i => itemCard(i, () => openItemDialog(i))));
    $('#closet-empty').textContent = owned.length === 0
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

  function openItemDialog(item, mode) {
    editingId = item ? item.id : null;
    dialogMode = mode || (item?.considering ? 'consider' : 'closet');
    const considering = dialogMode === 'consider';
    pendingPhoto = item ? item.photo || null : null;
    colorAuto = false;
    $('#item-dialog-title').textContent = considering ? (item ? 'Edit piece' : 'Check a piece before buying') : item ? 'Edit item' : 'Add item';
    $('#item-submit').textContent = considering ? 'Check with my closet' : 'Save';
    $('#item-on-order').closest('label').hidden = considering;
    $('#color-hint').hidden = true;
    $('#item-name').value = item ? item.name : '';
    $('#item-category').value = item ? item.category : 'top';
    $('#item-color').value = item ? item.color || '' : '';
    chipGroup($('#item-seasons'), SEASONS, item ? item.seasons || [] : []);
    chipGroup($('#item-occasions'), OCCASIONS, item ? item.occasions || [] : ['casual']);
    $('#delete-item-btn').hidden = !item;
    $('#item-link').value = item?.link || '';
    $('#item-on-order').checked = !!item?.onOrder;
    $('#link-status').textContent = considering
      ? 'Paste the product link, or skip this and take a photo below.'
      : 'Paste a link to something you bought, and the details are read from it.';
    showLinkOpen(item?.link);
    $('#item-photo').value = '';
    $('#item-camera').value = '';
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
      link: safeLink($('#item-link').value) || '',
      shop: shopName($('#item-link').value),
      onOrder: dialogMode === 'consider' ? false : $('#item-on-order').checked,
      considering: dialogMode === 'consider',
    };
    let savedId = editingId;
    if (editingId) {
      const idx = items.findIndex(i => i.id === editingId);
      if (idx >= 0) items[idx] = { ...items[idx], ...data };
    } else {
      savedId = uid();
      items.push({ id: savedId, createdAt: Date.now(), ...data });
    }
    await save('items', items);
    $('#item-dialog').close();
    if (data.considering) {
      selectedCandidate = savedId;
      renderAll();
      switchView('try');
      return;
    }
    toast(editingId ? 'Item updated' : 'Item added');
    renderAll();
  }

  async function deleteItem() {
    const what = dialogMode === 'consider' ? 'Remove this piece from your list?' : 'Delete this item from your closet?';
    if (!editingId || !(await askConfirm(what, 'Remove'))) return;
    items = items.filter(i => i.id !== editingId);
    for (const slot of Object.keys(current)) if (current[slot] === editingId) { delete current[slot]; locked.delete(slot); }
    await save('items', items);
    $('#item-dialog').close();
    toast('Item deleted');
    renderAll();
  }

  // ---------- Add from a shop link ----------
  // Pages on other sites can't be fetched from here, so details are read from the link itself:
  // most shops put the product name in the URL (…/products/linen-wide-leg-trousers-sand).
  const CATEGORY_WORDS = [
    ['dress', /\b(dress|gown|jumpsuit|playsuit|romper|overall|dungaree|kaftan)s?\b/],
    ['outerwear', /\b(coat|jacket|blazer|parka|puffer|trench|gilet|vest|anorak|overcoat|bomber|raincoat|poncho|cape)s?\b/],
    ['shoes', /\b(shoe|sneaker|trainer|boot|loafer|sandal|heel|pump|flat|mule|clog|slipper|espadrille|oxfords|derby|derbies|brogue|slingback|stiletto)s?\b/],
    ['accessory', /\b(bag|tote|clutch|belt|scarf|hat|cap|beanie|earring|necklace|bracelet|ring|watch|sunglasses|glove|tie|backpack|purse|wallet|jewel(le)?ry|hairclip|scrunchie|brooch)s?\b/],
    ['bottom', /\b(jean|trouser|pant|short|skirt|chino|legging|jogger|culotte|slack|sweatpant|cargo)s?\b/],
    ['top', /\b(top|tee|t shirt|tshirt|shirt|blouse|sweater|jumper|cardigan|hoodie|sweatshirt|tank|cami|camisole|polo|knit|turtleneck|bodysuit|vest top|pullover|henley|tunic)s?\b/],
  ];
  const COLOR_WORDS = [
    ['pattern', /\b(stripe[sd]?|striped|floral|print(ed)?|check(ed)?|plaid|gingham|leopard|zebra|polka|dot(s|ted)?|paisley|houndstooth|tartan|camo|animal)\b/],
    ['black', /\b(black|jet|onyx|noir)\b/],
    ['white', /\b(white|ivory|ecru|off white|optic|chalk|snow)\b/],
    ['grey', /\b(gr[ae]y|charcoal|heather|silver|slate|ash|graphite|marl)\b/],
    ['navy', /\b(navy|midnight|ink)\b/],
    ['beige', /\b(beige|cream|camel|tan|sand|stone|oat(meal)?|nude|taupe|khaki|biscuit|ecru|natural|bone)\b/],
    ['brown', /\b(brown|chocolate|cognac|mocha|espresso|coffee|chestnut|walnut|tobacco)\b/],
    ['denim', /\b(denim|indigo wash|light wash|mid wash|dark wash|chambray)\b/],
    ['red', /\b(red|burgundy|wine|maroon|oxblood|cherry|scarlet|bordeaux|crimson)\b/],
    ['pink', /\b(pink|blush|rose|fuchsia|magenta|coral|salmon)\b/],
    ['orange', /\b(orange|rust|terracotta|burnt|tangerine|apricot|copper|amber)\b/],
    ['yellow', /\b(yellow|mustard|gold|lemon|butter|ochre)\b/],
    ['olive', /\b(olive|army|moss|military)\b/],
    ['green', /\b(green|sage|emerald|forest|mint|teal|bottle|jade|pistachio|khaki green)\b/],
    ['blue', /\b(blue|cobalt|sky|azure|cornflower|indigo|turquoise|aqua|powder)\b/],
    ['purple', /\b(purple|lilac|lavender|violet|plum|mauve|aubergine|grape)\b/],
  ];
  const SEASON_WORDS = [
    [['spring', 'summer'], /\b(linen|sandal|short|tank|cami|swim|bikini|espadrille|sundress|seersucker|cotton voile|crochet)s?\b/],
    [['fall', 'winter'], /\b(wool|cashmere|merino|puffer|parka|coat|boot|fleece|knit|sweater|jumper|turtleneck|beanie|shearling|corduroy|tweed|thermal|quilted|down)s?\b/],
  ];
  const OCCASION_WORDS = [
    ['work', /\b(blazer|trouser|tailored|oxford|blouse|pencil|loafer|suit|pleated|shirt)s?\b/],
    ['formal', /\b(gown|tuxedo|evening|satin|silk|cocktail|heel|stiletto|suit)s?\b/],
    ['going out', /\b(party|mini|sequin|heel|satin|slip|corset|going out)s?\b/],
    ['sport', /\b(running|gym|yoga|legging|jogger|sport|athletic|training|trainer|track)s?\b/],
    ['lounge', /\b(lounge|pajama|pyjama|sweatpant|robe|slipper|sleep)s?\b/],
  ];
  const SKIP_SEGMENTS = /^(p|dp|pd|ip|product|products|item|items|shop|store|buy|en|us|uk|gb|de|fr|en-[a-z]{2}|[a-z]{2}-[a-z]{2}|women|womens|men|mens|clothing|apparel|collections?|catalog|c|s|gp|detail|details|view|index|html?)$/i;

  function safeLink(raw) {
    try {
      const u = new URL(String(raw || '').trim());
      return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null;
    } catch { return null; }
  }
  function shopName(raw) {
    const href = safeLink(raw);
    if (!href) return '';
    const host = new URL(href).hostname.replace(/^(www|shop|store|m|eu|us|uk)\./, '');
    const name = host.split('.')[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  function parseProductLink(raw) {
    const href = safeLink(raw);
    if (!href) return null;
    const u = new URL(href);
    const segments = u.pathname.split('/').map(seg => {
      try { seg = decodeURIComponent(seg); } catch { /* keep as is */ }
      return seg.replace(/\.(html?|aspx?|php)$/i, '');
    }).filter(seg => seg && !SKIP_SEGMENTS.test(seg) && /[a-z]{3,}/i.test(seg));
    // the product slug is usually the longest word-like path segment
    const slug = segments.sort((a, b) => b.replace(/[^a-z]/gi, '').length - a.replace(/[^a-z]/gi, '').length)[0] || '';
    const words = slug
      .replace(/[-_+]+/g, ' ')
      .replace(/\b[a-z]*\d[a-z\d]*\b/gi, ' ')   // drop SKU-like tokens
      .replace(/\s+/g, ' ').trim();
    const extra = ['color', 'colour', 'variant_color', 'col'].map(k => u.searchParams.get(k) || '').join(' ');
    const text = (words + ' ' + extra).toLowerCase().replace(/-/g, ' ');
    if (!words) return { shop: shopName(href) };

    const find = list => list.find(([, re]) => re.test(text))?.[0];
    // tidy the display name: no gender prefix, repeated brand or trailing color word
    const brand = shopName(href).toLowerCase();
    let clean = words.toLowerCase()
      .replace(/^(womens?|mens?|women's|men's|unisex|ladies)\s+/, '');
    if (brand && clean.startsWith(brand + ' ')) clean = clean.slice(brand.length + 1).replace(/^design\s+/, '');
    for (let n = 0; n < 2; n++) {
      const last = clean.match(/(?:\s+in)?\s+(\S+)$/);
      if (last && COLOR_WORDS.some(([k, re]) => k !== 'pattern' && re.test(last[1]))) clean = clean.slice(0, last.index);
    }
    clean = clean.replace(/\s+(hot|neon|bright|light|dark|pale|deep|dusty|soft|washed|true|classic)$/, '')
      .replace(/\s+(in|with|and)$/, '').trim() || words.toLowerCase();
    const name = clean.charAt(0).toUpperCase() + clean.slice(1);
    const seasons = [...new Set(SEASON_WORDS.filter(([, re]) => re.test(text)).flatMap(([v]) => v))];
    const occasions = OCCASION_WORDS.filter(([, re]) => re.test(text)).map(([v]) => v);
    return {
      name: name.length > 60 ? name.slice(0, 60).replace(/\s\S*$/, '') : name,
      category: find(CATEGORY_WORDS),
      color: find(COLOR_WORDS) || (/\btrench\b/.test(text) ? 'beige' : undefined),
      seasons: seasons.length === 4 ? [] : seasons,
      occasions: occasions.length ? occasions : ['casual'],
      shop: shopName(href),
    };
  }

  function showLinkOpen(href) {
    const a = $('#item-link-open');
    const safe = safeLink(href);
    a.hidden = !safe;
    if (safe) { a.href = safe; a.textContent = `Open in ${shopName(safe) || 'shop'} ↗`; }
  }

  function fillFromLink() {
    const raw = $('#item-link').value;
    const info = parseProductLink(raw);
    const status = $('#link-status');
    if (!info) { status.textContent = 'That doesn’t look like a web link. It should start with https://'; return; }
    showLinkOpen(raw);
    if (!info.name) { status.textContent = `Saved the ${info.shop} link, but it has no product name in it. Type the details below.`; return; }
    $('#item-name').value = info.name;
    if (info.category) $('#item-category').value = info.category;
    if (info.color) $('#item-color').value = info.color;
    chipGroup($('#item-seasons'), SEASONS, info.seasons);
    chipGroup($('#item-occasions'), OCCASIONS, info.occasions);
    if (!editingId && dialogMode !== 'consider') $('#item-on-order').checked = true;
    if (info.color) { colorAuto = false; $('#color-hint').hidden = true; }
    const missing = [!info.category && 'category', !info.color && 'color'].filter(Boolean);
    status.textContent = `Filled in from ${info.shop}. Check the details${missing.length ? `, and pick the ${missing.join(' and ')}` : ''}. ` +
      'To add the photo, copy the product image in the shop and paste it here.';
  }

  async function usePhotoFile(file) {
    if (!file || !file.type.startsWith('image/')) return false;
    try { pendingPhoto = await compressImage(file); setPhotoPreview(pendingPhoto); }
    catch { toast('Could not read that image'); return false; }
    // guess the color unless the person (or the link) already chose one
    if (!$('#item-color').value || colorAuto) {
      const guess = await detectColor(pendingPhoto).catch(() => null);
      if (guess) {
        $('#item-color').value = guess;
        colorAuto = true;
        const hint = $('#color-hint');
        hint.textContent = `From the photo this looks ${guess}. Change it if not.`;
        hint.hidden = false;
      }
    }
    return true;
  }

  // reference shades for reading a garment's color from a photo
  const DETECT = {
    black: [30, 30, 32], white: [238, 236, 230], grey: [128, 128, 128], navy: [32, 42, 78], beige: [212, 192, 158],
    brown: [105, 72, 48], denim: [88, 115, 155], red: [180, 40, 45], pink: [232, 160, 178], orange: [222, 118, 45],
    yellow: [230, 198, 70], green: [60, 135, 80], olive: [112, 110, 55], blue: [55, 110, 195], purple: [118, 72, 145],
  };
  function nearestColor(r, g, b) {
    let best = null, bestD = Infinity;
    for (const [key, [R, G, B]] of Object.entries(DETECT)) {
      const d = 2 * (r - R) ** 2 + 4 * (g - G) ** 2 + 3 * (b - B) ** 2;
      if (d < bestD) { bestD = d; best = key; }
    }
    return best;
  }
  function detectColor(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const W = 48, H = 60;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, W, H);
        const px = ctx.getImageData(0, 0, W, H).data;
        const at = (x, y) => { const i = (y * W + x) * 4; return nearestColor(px[i], px[i + 1], px[i + 2]); };
        // the border is usually background (a white shop backdrop, a wall, a hanger rail)
        const border = {};
        for (let x = 0; x < W; x++) for (const y of [0, 1, H - 2, H - 1]) { const k = at(x, y); border[k] = (border[k] || 0) + 1; }
        for (let y = 0; y < H; y++) for (const x of [0, 1, W - 2, W - 1]) { const k = at(x, y); border[k] = (border[k] || 0) + 1; }
        const total = Object.values(border).reduce((a, b) => a + b, 0);
        const backdrop = Object.entries(border).filter(([, n]) => n / total > 0.45).map(([k]) => k);
        const counts = {};
        for (let y = Math.floor(H * 0.2); y < H * 0.8; y++) for (let x = Math.floor(W * 0.2); x < W * 0.8; x++) {
          const k = at(x, y); counts[k] = (counts[k] || 0) + 1;
        }
        const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const pick = ranked.find(([k, n]) => !backdrop.includes(k) && n > 30) || ranked[0];
        resolve(pick ? pick[0] : null);
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  // ---------- Outfit generator ----------
  const byId = id => items.find(i => i.id === id);

  function eligible(category) {
    const occ = $('#gen-occasion').value;
    const season = $('#gen-season').value;
    // untagged items count as "works for anything"
    return closetItems().filter(i => i.category === category
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

  const pickRandom = arr => arr[Math.floor(Math.random() * arr.length)];

  // ---------- Stylist ----------
  // Rules a stylist uses: one color story, matched formality, echoed colors, deliberate contrast.
  const HUE = { red: 5, orange: 28, yellow: 50, olive: 65, green: 135, blue: 210, purple: 275, pink: 340 };
  const WARMTH = { red: 'warm', orange: 'warm', yellow: 'warm', olive: 'warm', pink: 'warm', beige: 'warm', brown: 'warm',
    green: 'cool', blue: 'cool', purple: 'cool', navy: 'cool', denim: 'cool', grey: 'cool' };
  const DEPTH = { white: 0, beige: 0, pink: 0, yellow: 0, grey: 1, denim: 1, orange: 1, red: 1, olive: 1, green: 1,
    blue: 1, purple: 1, black: 2, navy: 2, brown: 2 };
  const FORMALITY = { lounge: 0, sport: 0, casual: 1, work: 2, 'going out': 2, formal: 3 };
  const DRESS_WORD = ['relaxed', 'easy', 'polished', 'dressy'];

  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  const the = item => 'the ' + item.name.charAt(0).toLowerCase() + item.name.slice(1);
  const plural = item => /s$/i.test(item.name.trim());
  const verb = (item, one, many) => plural(item) ? many : one;
  const avgOf = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const hueGap = (a, b) => { const d = Math.abs(HUE[a] - HUE[b]); return Math.min(d, 360 - d); };
  function formalityOf(item) {
    const v = (item.occasions || []).map(o => FORMALITY[o]).filter(n => n != null);
    return v.length ? avgOf(v) : null;
  }

  function styleOutfit(combo) {
    const pieces = Object.values(combo).map(byId).filter(Boolean);
    if (!pieces.length) return null;
    const colorOf = p => COLOR_BY_KEY[p.color];
    const notes = [];
    const flags = new Set();
    let score = 10, title;

    const accents = pieces.filter(p => colorOf(p) && !colorOf(p).neutral && !colorOf(p).pattern);
    const accentKeys = [...new Set(accents.map(p => p.color))];
    const prints = pieces.filter(p => colorOf(p)?.pattern);
    const base = pieces.filter(p => ['top', 'bottom', 'dress'].includes(p.category));

    // color story
    if (accentKeys.length === 0) {
      const warm = pieces.every(p => WARMTH[p.color] !== 'cool');
      title = prints.length ? 'Neutrals with a print' : warm ? 'Warm neutrals' : 'Quiet neutrals';
      notes.push(prints.length
        ? `A neutral base lets ${the(prints[0])} carry the interest.`
        : 'An all-neutral palette always reads considered. Let texture and fit do the talking.');
      score += 2;
    } else if (accentKeys.length === 1) {
      const hero = accents.find(p => p.category !== 'shoes' && p.category !== 'accessory');
      if (hero) {
        title = 'Built around ' + the(hero);
        notes.push(`${cap(the(hero))} ${verb(hero, 'is', 'are')} the focal point. Everything else stays neutral so the ${hero.color} can lead.`);
        score += 4;
      } else {
        const small = accents[0];
        title = 'Neutrals with a hit of ' + small.color;
        notes.push(`A neutral base finished with ${the(small)}: one small hit of color makes simple pieces look styled.`);
        score += 3;
      }
    } else if (accentKeys.length === 2) {
      const [a, b] = accentKeys, gap = hueGap(a, b);
      if (gap <= 50) {
        title = WARMTH[a] === 'warm' ? 'Tonal warmth' : 'Cool tones';
        notes.push(`${cap(a)} and ${b} sit side by side on the color wheel, so they blend instead of competing.`);
        score += 3;
      } else if (gap >= 140) {
        title = 'Complementary pop';
        notes.push(`${cap(a)} and ${b} are color-wheel opposites. It's a bold pairing, kept wearable by the neutrals around it.`);
        score += 1;
      } else {
        title = 'Mixed accents';
        notes.push(`${cap(a)} and ${b} pull in different directions. Swap one for a neutral to calm the look down.`);
        score -= 6; flags.add('color');
      }
    } else {
      title = 'Too many colors';
      notes.push(`${accentKeys.length} accent colors is a lot for one look. Keep it to one or two.`);
      score -= 10; flags.add('color');
    }

    // prints
    if (prints.length > 1) { score -= 8; flags.add('prints'); notes.push('Two prints fight for attention. Keep one and make the rest solid.'); }
    else if (prints.length === 1 && accentKeys.length >= 2) score -= 2;
    else if (prints.length === 1 && accentKeys.length === 1) {
      notes.push(`${cap(the(prints[0]))} ${verb(prints[0], 'is', 'are')} the only print, so ${verb(prints[0], 'it has', 'they have')} room to breathe next to solids.`);
    }

    // formality
    const levels = pieces.map(formalityOf).filter(v => v != null);
    if (levels.length >= 2) {
      const spread = Math.max(...levels) - Math.min(...levels);
      if (spread > 1.5) {
        const odd = pieces.filter(p => formalityOf(p) != null).sort((x, y) => formalityOf(x) - formalityOf(y))[0];
        notes.push(`${cap(the(odd))} is much more casual than the rest. Swap it for something closer in polish.`);
        score -= 10; flags.add('formality');
      } else if (spread > 1) {
        score -= 3; flags.add('formality');
      } else {
        notes.push(`Every piece sits at the same level of dress, so the look feels ${DRESS_WORD[Math.round(avgOf(levels))]} and intentional.`);
        score += 2;
      }
    }

    // a finishing piece that repeats a base color ties the outfit together
    const baseColors = base.map(p => p.color);
    const echo = pieces.find(p => ['shoes', 'accessory', 'outerwear'].includes(p.category)
      && colorOf(p) && !colorOf(p).pattern && !['black', 'white'].includes(p.color) && baseColors.includes(p.color));
    if (echo) {
      const src = base.find(p => p.color === echo.color);
      notes.push(`${cap(the(echo))} ${/s$/i.test(echo.name) ? 'repeat' : 'repeats'} the ${echo.color} of ${the(src)}, which ties the outfit together.`);
      score += 2;
    }

    // contrast between top and bottom
    const top = byId(combo.top), bottom = byId(combo.bottom);
    if (top && bottom && DEPTH[top.color] != null && DEPTH[bottom.color] != null) {
      const d = DEPTH[bottom.color] - DEPTH[top.color];
      if (Math.abs(d) === 2) {
        notes.push(d > 0 ? 'Light over dark gives a crisp, classic contrast.' : 'Dark over light is unexpected and modern, and draws the eye up.');
        score += 1;
      } else if (top.color === bottom.color) {
        notes.push('Matching top and bottom make one long column of color, which lengthens your frame.');
        score += 1;
      }
    }

    return { score, title, flags: [...flags], notes: notes.slice(0, 3), tip: stylingTip(combo, levels) };
  }

  function stylingTip(combo, levels) {
    const level = levels.length ? avgOf(levels) : 1;
    const coat = byId(combo.outerwear), acc = byId(combo.accessory), dress = byId(combo.dress), top = byId(combo.top);
    if (coat) return `Wear ${the(coat)} open so the layers underneath stay visible.`;
    if (dress) return level >= 2 ? 'Keep hair and jewelry simple so the dress stays the statement.' : 'Add a belt or knot at the waist to give the dress shape.';
    if (top && /sweater|knit|cardigan|jumper/i.test(top.name)) return 'Push the sleeves up to the forearm. It lightens a knit and shows a little wrist.';
    if (top && level >= 1.75) return 'Tuck the top in fully for a sharp, defined waist.';
    if (top && /shirt|blouse|oxford/i.test(top.name) && !/t-?shirt/i.test(top.name)) return 'Roll the sleeves twice and leave the top button open for an easy, lived-in finish.';
    if (top) return 'Try a loose half-tuck at the front. It shows your waist without looking fussy.';
    if (acc) return `Keep other jewelry minimal so ${the(acc)} has room.`;
    return '';
  }

  // ---------- Outfit search ----------
  function chooseMode(respectLocks) {
    const dressPool = eligible('dress'), topPool = eligible('top'), bottomPool = eligible('bottom');
    const canSeparates = topPool.length && bottomPool.length;
    const canDress = $('#gen-dress').checked && dressPool.length;
    if (respectLocks && locked.has('dress') && current.dress) return true;
    if (respectLocks && ((locked.has('top') && current.top) || (locked.has('bottom') && current.bottom))) return false;
    if (canSeparates && canDress) return Math.random() < dressPool.length / (dressPool.length + Math.min(topPool.length, bottomPool.length));
    return !canSeparates && !!canDress;
  }

  function randomCombo(respectLocks) {
    const combo = {};
    for (const slot of wantedSlots(chooseMode(respectLocks))) {
      if (respectLocks && locked.has(slot) && current[slot] && byId(current[slot])) { combo[slot] = current[slot]; continue; }
      const pool = eligible(slot);
      if (pool.length) combo[slot] = pickRandom(pool).id;
    }
    return combo;
  }

  const comboKey = c => Object.keys(c).sort().map(k => c[k]).join('|');

  // sample many outfits and rank them the way a stylist would
  function rankedLooks(respectLocks, samples) {
    const seen = new Map();
    for (let n = 0; n < samples; n++) {
      const combo = randomCombo(respectLocks);
      const key = comboKey(combo);
      if (!key || seen.has(key)) continue;
      const look = styleOutfit(combo);
      if (look) seen.set(key, { combo, key, ...look });
    }
    return [...seen.values()].sort((a, b) => b.score - a.score);
  }

  function applyCombo(combo, keepLocks) {
    for (const k of Object.keys(current)) delete current[k];
    if (!keepLocks) locked.clear();
    Object.assign(current, combo);
    for (const k of [...locked]) if (!current[k]) locked.delete(k);
  }

  let picks = [];

  function shuffle() {
    const previous = comboKey(current);
    const looks = rankedLooks(true, 160).filter(l => l.key !== previous);
    // pick among the strongest few so repeated shuffles still feel fresh
    const top = looks.filter(l => l.score >= (looks[0]?.score ?? 0) - 2).slice(0, 5);
    const chosen = pickRandom(top);
    if (chosen) applyCombo(chosen.combo, true);
    renderBoard();
    refreshPicks();
  }

  function refreshPicks() {
    const here = comboKey(current);
    const differs = (a, b) => { const x = a.split('|'), y = new Set(b.split('|')); return x.filter(id => !y.has(id)).length >= 2; };
    picks = [];
    for (const look of rankedLooks(false, 400)) {
      if (look.score < 12) break;
      if (look.key === here || !differs(look.key, here) || picks.some(p => !differs(p.key, look.key) || p.title === look.title)) continue;
      picks.push(look);
      if (picks.length === 3) break;
    }
    renderPicks();
  }

  function renderPicks() {
    $('#picks').hidden = !picks.length;
    $('#picks-list').replaceChildren(...picks.map(look => {
      const pieces = Object.values(look.combo).map(byId).filter(Boolean);
      return el('article', { class: 'pick' },
        el('div', { class: 'pick-items' }, pieces.map(p => el('div', { class: 'mini' }, thumb(p)))),
        el('h3', {}, look.title),
        el('p', {}, look.notes[0] || ''),
        el('button', { class: 'btn', type: 'button', onclick: () => {
          applyCombo(look.combo, false);
          renderBoard();
          refreshPicks();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } }, 'Wear this'));
    }));
  }

  function renderStylist(slots) {
    const combo = {};
    for (const s of slots) if (byId(current[s])) combo[s] = current[s];
    const look = styleOutfit(combo);
    $('#stylist').hidden = !look;
    if (!look) return;
    $('#stylist-title').textContent = look.title;
    $('#stylist-notes').replaceChildren(...look.notes.map(n => el('li', {}, n)));
    $('#stylist-tip').hidden = !look.tip;
    $('#stylist-tip').replaceChildren(el('strong', {}, 'Styling tip '), look.tip);
    $('#stylist-verdict').textContent = look.score >= 15 ? 'Stylist approved' : look.score >= 10 ? 'Works well' : 'Needs a rethink';
    $('#stylist-verdict').dataset.level = look.score >= 15 ? 'high' : look.score >= 10 ? 'mid' : 'low';
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
          title: isLocked ? 'Let this piece shuffle' : 'Keep this piece while shuffling',
          'aria-label': (isLocked ? 'Stop keeping ' : 'Keep ') + item.name,
          'aria-pressed': isLocked ? 'true' : 'false',
          onclick: () => { locked.has(slot) ? locked.delete(slot) : locked.add(slot); renderBoard(slots); },
        }, isLocked ? 'Kept' : 'Keep') : null,
        item ? itemCard(item, () => openPicker(slot))
             : el('button', { class: 'slot-empty', type: 'button', onclick: () => openPicker(slot) },
                 eligible(slot).length || closetItems().some(i => i.category === slot) ? 'Choose…' : 'None in closet'));
    }));

    const msg = $('#outfit-message');
    if (!closetItems().length) msg.textContent = 'Add clothes to your closet first.';
    else if (!slots.some(s => current[s])) msg.textContent = 'Nothing matches these filters — try "Any".';
    else msg.textContent = '';
    renderStylist(slots);
  }

  function openPicker(slot) {
    pickSlot = slot;
    $('#pick-title').textContent = 'Choose ' + CATEGORY_LABEL[slot].toLowerCase();
    const pool = closetItems().filter(i => i.category === slot);
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
    const look = styleOutfit(Object.fromEntries(slots.filter(sl => byId(current[sl])).map(sl => [sl, current[sl]])));
    const name = $('#outfit-name').value.trim() || look?.title || 'Outfit ' + (outfits.length + 1);
    outfits.unshift({ id: uid(), name, itemIds: ids, createdAt: Date.now() });
    await save('outfits', outfits);
    $('#outfit-name').value = '';
    toast('Outfit saved');
    renderSaved();
  }

  // ---------- Before you buy ----------
  const GOOD_LOOK = 12;
  const NEEDS = { top: ['bottom'], bottom: ['top'], dress: [], outerwear: [], shoes: [], accessory: [] };

  // build outfits that include the candidate, using only what's already in the closet
  function looksWith(cand, samples = 600) {
    const owned = closetItems();
    const pool = cat => owned.filter(i => i.category === cat);
    const seen = new Map();
    for (let n = 0; n < samples; n++) {
      let useDress;
      if (cand.category === 'dress') useDress = true;
      else if (cand.category === 'top' || cand.category === 'bottom') useDress = false;
      else {
        const canDress = pool('dress').length > 0, canSep = pool('top').length && pool('bottom').length;
        useDress = canDress && (!canSep || Math.random() < 0.35);
      }
      const slots = useDress ? ['dress'] : ['top', 'bottom'];
      if (cand.category === 'outerwear' || Math.random() < 0.35) slots.push('outerwear');
      slots.push('shoes');
      if (cand.category === 'accessory' || Math.random() < 0.5) slots.push('accessory');
      const combo = {};
      for (const slot of slots) {
        if (slot === cand.category) { combo[slot] = cand.id; continue; }
        const p = pool(slot);
        if (p.length) combo[slot] = pickRandom(p).id;
      }
      if (Object.keys(combo).length < 2) continue;
      const key = comboKey(combo);
      if (seen.has(key)) continue;
      const look = styleOutfit(combo);
      if (look) seen.set(key, { combo, key, ...look });
    }
    return [...seen.values()].sort((x, y) => y.score - x.score);
  }

  function assess(cand) {
    const owned = closetItems();
    const looks = looksWith(cand);
    const good = looks.filter(l => l.score >= GOOD_LOOK);
    const partnerIds = new Set(good.flatMap(l => Object.values(l.combo)).filter(id => id !== cand.id));
    const partners = [...partnerIds].map(byId).filter(Boolean);
    const similar = owned.filter(i => i.category === cand.category && i.color && i.color === cand.color);
    const missing = NEEDS[cand.category].filter(cat => !owned.some(i => i.category === cat));

    // three good ways to wear it that don't repeat each other
    const ways = [];
    const differs = (x, y) => { const a = x.split('|'), b = new Set(y.split('|')); return a.filter(id => !b.has(id)).length >= 2; };
    for (let l of good) {
      if (ways.some(w => !differs(w.key, l.key))) continue;
      // when the piece itself is the hero, name the look after what it's paired with
      if (l.title.includes(cand.name.toLowerCase())) {
        const ids = Object.values(l.combo).filter(id => id !== cand.id).map(byId);
        const partner = ids.find(p => ['bottom', 'top', 'dress'].includes(p.category)) || ids[0];
        l = { ...l, title: 'With ' + the(partner) };
      }
      if (ways.some(w => w.title === l.title)) continue;
      ways.push(l);
      if (ways.length === 3) break;
    }

    const reasons = [];
    let level;
    if (missing.length) {
      level = 'hard';
      reasons.push(`You don't own any ${missing.map(c => CATEGORY_LABEL[c].toLowerCase() + 's').join(' or ')} to wear it with yet.`);
    } else {
      // versatility: the share of possible outfits with it that a stylist would sign off on
      const share = looks.length ? good.length / looks.length : 0;
      if (share >= 0.3 && partners.length >= 5) level = 'great';
      else if (share >= 0.1 && good.length >= 2) level = 'some';
      else level = 'hard';
    }

    if (level !== 'great' && !missing.length) {
      const share = Math.round(100 * good.length / Math.max(1, looks.length));
      reasons.push(`Only about ${share}% of the outfits it could make with your closet work well.`);
      const tally = {};
      for (const l of looks.slice(0, 30)) for (const f of l.flags) tally[f] = (tally[f] || 0) + 1;
      const top = Object.entries(tally).sort((x, y) => y[1] - x[1])[0]?.[0];
      if (top === 'formality') reasons.push(`It's a different level of dress from most of your closet, so it will feel out of place with what you wear now.`);
      if (top === 'color') reasons.push(`Its ${cand.color || 'color'} competes with the colors you already own. A neutral version would be easier to wear.`);
      if (top === 'prints') reasons.push('Your closet already has prints that would compete with it.');
    }
    if (similar.length) {
      reasons.push(`You already own ${the(similar[0])}${similar.length > 1 ? ` and ${similar.length - 1} more like it` : ''}. Make sure this adds something new.`);
      if (level === 'great') level = 'some';
    }

    const count = good.length >= 20 ? '20+' : String(good.length);
    const headline = level === 'some' && similar.length && good.length >= 6
      ? 'Easy to wear, but you have one'
      : { great: 'A smart buy', some: 'Could work', hard: 'Hard to style with your closet' }[level];
    const summary = good.length
      ? `Makes ${count} strong outfit${good.length === 1 ? '' : 's'} with ${partners.length} piece${partners.length === 1 ? '' : 's'} you already own.`
      : 'It doesn’t make any strong outfits with what you own right now.';
    return { level, headline, summary, reasons, partners, ways };
  }

  function renderTry() {
    const list = candidates();
    if (!list.some(c => c.id === selectedCandidate)) selectedCandidate = list[list.length - 1]?.id || null;
    $('#consider-list').replaceChildren(...list.map(c => {
      const card = itemCard(c, () => { selectedCandidate = c.id; renderTry(); });
      if (c.id === selectedCandidate) card.classList.add('selected');
      return card;
    }));
    $('#consider-empty').textContent = list.length ? '' : 'Nothing on your list yet. Check a piece you’re thinking about buying.';
    const box = $('#assessment');
    const cand = byId(selectedCandidate);
    box.hidden = !cand;
    if (!cand) { box.replaceChildren(); return; }

    const a = assess(cand);
    const levelTag = { great: 'high', some: 'mid', hard: 'low' }[a.level];
    const verdictText = { great: 'Buy it', some: 'Think it over', hard: 'Probably skip' }[a.level];
    const pieceMini = (p, isCand) => el('div', { class: 'mini' + (isCand ? ' candidate' : '') }, thumb(p));

    box.replaceChildren(
      el('div', { class: 'verdict-head' },
        thumb(cand),
        el('div', { class: 'verdict-body' },
          el('div', { class: 'stylist-head' },
            el('span', { class: 'eyebrow' }, "Stylist's verdict"),
            el('span', { class: 'verdict', 'data-level': levelTag }, verdictText)),
          el('h2', {}, a.headline),
          el('p', { class: 'card-meta' }, cand.name, cand.shop ? ' · ' + cand.shop : ''),
          el('p', { class: 'summary' }, a.summary),
          a.reasons.length ? el('ul', {}, a.reasons.map(r => el('li', {}, r))) : null,
          a.partners.length ? el('div', {},
            el('p', { class: 'eyebrow' }, 'Works with'),
            el('div', { class: 'partners' }, a.partners.slice(0, 12).map(p => el('div', { class: 'mini', title: p.name }, thumb(p))))) : null,
          el('div', { class: 'verdict-actions' },
            el('button', { class: 'btn primary', type: 'button', onclick: () => boughtIt(cand) }, 'I bought it'),
            el('button', { class: 'btn', type: 'button', onclick: () => openItemDialog(cand, 'consider') }, 'Edit details'),
            cand.link ? el('a', { class: 'btn ghost', href: cand.link, target: '_blank', rel: 'noopener noreferrer' }, 'Open in shop ↗') : null,
            el('button', { class: 'btn danger', type: 'button', onclick: () => removeCandidate(cand) }, 'Remove')))),
      a.ways.length ? el('div', { class: 'ways' },
        el('h3', {}, 'Ways to wear it'),
        el('div', { class: 'ways-list' }, a.ways.map(w => el('article', { class: 'way' },
          el('div', { class: 'way-items' },
            CATEGORIES.map(c => c.key).filter(k => w.combo[k]).map(k => pieceMini(byId(w.combo[k]), w.combo[k] === cand.id))),
          el('div', {},
            el('h4', {}, w.title),
            w.notes.slice(0, 2).map(n => el('p', {}, n)),
            w.tip ? el('p', {}, el('strong', {}, 'Tip '), w.tip) : null,
            el('button', { class: 'btn ghost', type: 'button', onclick: () => tryLook(w.combo) }, 'Open in Make outfit')))))) : null);
  }

  async function boughtIt(cand) {
    Object.assign(cand, { considering: false, onOrder: true });
    await save('items', items);
    selectedCandidate = null;
    toast('Added to your closet, marked On order');
    renderAll();
  }

  async function removeCandidate(cand) {
    if (!(await askConfirm(`Remove ${the(cand)} from your list?`, 'Remove'))) return;
    items = items.filter(i => i.id !== cand.id);
    for (const slot of Object.keys(current)) if (current[slot] === cand.id) { delete current[slot]; locked.delete(slot); }
    await save('items', items);
    renderAll();
  }

  function tryLook(combo) {
    applyCombo(combo, false);
    for (const k of Object.keys(combo)) locked.add(k);
    switchView('create');
    renderBoard();
    refreshPicks();
    window.scrollTo({ top: 0 });
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
    refreshPicks();
  }

  async function deleteOutfit(id) {
    if (!(await askConfirm('Delete this saved outfit?'))) return;
    outfits = outfits.filter(o => o.id !== id);
    await save('outfits', outfits);
    renderSaved();
  }

  // ---------- Import / export ----------
  const backupJSON = () => JSON.stringify({ app: 'closet-outfit-maker', version: 1, items, outfits });

  function exportData() {
    $('#backup-text').value = backupJSON();
    $('#backup-dialog').showModal();
  }

  function downloadBackup() {
    const blob = new Blob([backupJSON()], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'closet-backup.json' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function copyBackup() {
    const ta = $('#backup-text');
    try { await navigator.clipboard.writeText(ta.value); toast('Backup copied'); }
    catch { ta.focus(); ta.select(); toast('Press Ctrl+C / Cmd+C to copy'); }
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
        sample: i.sample === true || undefined,
        link: safeLink(i.link) || '', shop: shopName(i.link), onOrder: i.onOrder === true, considering: i.considering === true,
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

  // ---------- Sample closet (first visit only) ----------
  const SAMPLES = [
    ['White oxford shirt', 'top', 'white', ['spring', 'summer', 'fall'], ['work', 'casual']],
    ['Striped breton tee', 'top', 'pattern', ['spring', 'summer'], ['casual']],
    ['Rust knit sweater', 'top', 'orange', ['fall', 'winter'], ['casual', 'work']],
    ['Straight-leg jeans', 'bottom', 'denim', [], ['casual']],
    ['Black tailored trousers', 'bottom', 'black', [], ['work', 'formal']],
    ['Olive midi skirt', 'bottom', 'olive', ['spring', 'fall'], ['casual', 'work']],
    ['Navy slip dress', 'dress', 'navy', ['spring', 'summer'], ['going out', 'formal']],
    ['Camel wool coat', 'outerwear', 'beige', ['fall', 'winter'], ['work', 'casual', 'formal']],
    ['Denim jacket', 'outerwear', 'denim', ['spring', 'fall'], ['casual']],
    ['White sneakers', 'shoes', 'white', [], ['casual', 'sport']],
    ['Brown leather loafers', 'shoes', 'brown', [], ['work', 'casual']],
    ['Black ankle boots', 'shoes', 'black', ['fall', 'winter'], ['going out', 'work', 'casual']],
    ['Gold hoop earrings', 'accessory', 'yellow', [], ['going out', 'work', 'casual']],
    ['Silk print scarf', 'accessory', 'pattern', [], ['work', 'casual']],
  ];

  function sampleItems() {
    return SAMPLES.map(([name, category, color, seasons, occasions], n) => ({
      id: 'sample-' + n, name, category, color, seasons, occasions, photo: null, createdAt: Date.now() + n, sample: true,
    }));
  }

  async function clearSamples() {
    items = items.filter(i => !i.sample);
    for (const slot of Object.keys(current)) if (!byId(current[slot])) { delete current[slot]; locked.delete(slot); }
    outfits = outfits.map(o => ({ ...o, itemIds: o.itemIds.filter(byId) })).filter(o => o.itemIds.length);
    await save('items', items);
    await save('outfits', outfits);
    toast('Samples cleared');
    renderAll();
  }

  // ---------- Navigation ----------
  function switchView(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    if (name === 'create' && !Object.keys(current).length && closetItems().length) shuffle();
  }

  function renderAll() {
    renderTry();
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
      await usePhotoFile(f);
    });
    $('#shuffle-btn').addEventListener('click', shuffle);
    ['#gen-occasion', '#gen-season', '#gen-outerwear', '#gen-accessory', '#gen-dress']
      .forEach(s => $(s).addEventListener('change', shuffle));
    $('#save-outfit-btn').addEventListener('click', saveOutfit);
    $('#pick-close-btn').addEventListener('click', () => $('#pick-dialog').close());
    $('#pick-none-btn').addEventListener('click', () => choose(null));
    $('#export-btn').addEventListener('click', exportData);
    $('#import-input').addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });

    $('#clear-samples-btn').addEventListener('click', clearSamples);
    $('#link-fill-btn').addEventListener('click', fillFromLink);
    $('#consider-btn').addEventListener('click', () => openItemDialog(null, 'consider'));
    $('#item-camera').addEventListener('change', async e => { if (e.target.files[0]) await usePhotoFile(e.target.files[0]); });
    $('#item-color').addEventListener('change', () => { colorAuto = false; $('#color-hint').hidden = true; });
    $('#item-link').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fillFromLink(); } });
    $('#item-link').addEventListener('paste', () => setTimeout(fillFromLink, 0));
    $('#item-dialog').addEventListener('paste', async e => {
      const file = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))?.getAsFile();
      if (file) { e.preventDefault(); if (await usePhotoFile(file)) toast('Photo added'); }
    });
    const drop = $('.photo-drop');
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragging'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('dragging'); usePhotoFile(e.dataTransfer.files[0]); });
    $('#backup-download').addEventListener('click', downloadBackup);
    $('#backup-copy').addEventListener('click', copyBackup);
    $('#backup-close').addEventListener('click', () => $('#backup-dialog').close());

    const stored = await load('items', null);
    items = stored ?? sampleItems();
    if (!stored) await save('items', items);
    outfits = await load('outfits', []);
    renderAll();
  }

  init();
})();
